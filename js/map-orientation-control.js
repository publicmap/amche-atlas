/**
 * Map orientation control - one button for GPS tracking and map bearing
 *
 * Replaces the pair of buttons that used to sit side by side in the top-left
 * row (a GeolocateControl subclass and a NavigationControl compass), which had
 * to reach across to each other to keep the bearing lock in sync. The symbol is
 * a compass rose inside a ring: the rose reports the map bearing, the ring
 * reports the GPS mode, and one click walks the cycle described in
 * js/map-orientation-modes.js.
 *
 * The GPS engine underneath is js/geolocation-watch.js; everything here is the
 * button, the bearing, and the device compass that can drive it.
 */

import { GeolocationWatch, WATCH, showGeolocationStatus } from './geolocation-watch.js';
import {
    MODE, MODE_MESSAGES, normalizeBearing, nextOrientationAction, buildOrientationTooltipLines
} from './map-orientation-modes.js';

// GPS state names line up with the modes of the same name; only ACTIVE splits
// in two, depending on whether the device compass is driving the bearing.
const WATCH_MODES = {
    [WATCH.OFF]: MODE.OFF,
    [WATCH.LOCATING]: MODE.LOCATING,
    [WATCH.UNLOCKED]: MODE.UNLOCKED,
    [WATCH.ERROR]: MODE.ERROR
};

// Everything the symbol needs to draw is a presentation attribute, so the icon
// is legible even before css/styles.css lands; the stylesheet only repaints the
// dial per mode. Rotation uses SVG's own transform attribute, which carries its
// centre of rotation with it and so needs no transform-box support.
const BUTTON_HTML = `
    <button type="button" class="map-orientation-btn" data-mode="off">
        <svg class="map-orientation-icon" width="28" height="28" viewBox="0 0 36 36" aria-hidden="true">
            <circle class="map-orientation-dial" cx="18" cy="18" r="13" fill="none" stroke="#6b7280" stroke-width="2"></circle>
            <g class="map-orientation-heading"><path d="M18 0.5 L20.8 5 L15.2 5 Z" fill="#ffffff"></path></g>
            <g class="map-orientation-needle">
                <path d="M18 8.5 L21.2 18 L14.8 18 Z" fill="#ef4444"></path>
                <path d="M18 27.5 L21.2 18 L14.8 18 Z" fill="#ffffff"></path>
            </g>
        </svg>
    </button>
`;

export class MapOrientationControl {
    constructor(options = {}) {
        this._mode = MODE.OFF;
        this._deviceBearing = null;
        this._lockedToDevice = false;
        this._wantDeviceLock = false;
        this._orientationPermissionAsked = false;
        this._lastDeviceEaseAt = 0;
        this._watch = new GeolocationWatch(this._onWatchState, options);
    }

    get mode() { return this._mode; }
    get isTracking() { return this._watch.isTracking; }
    get lastPosition() { return this._watch.lastPosition; }
    get lockedToDevice() { return this._lockedToDevice; }
    get deviceBearing() { return this._deviceBearing; }

    // Event surface kept compatible with the GeolocateControl this replaced -
    // map-nearby-features-control.js subscribes to 'geolocate' through
    // window.geolocationControl.
    on(type, listener) { this._watch.on(type, listener); return this; }
    once(type, listener) { this._watch.once(type, listener); return this; }
    off(type, listener) { this._watch.off(type, listener); return this; }

    getDefaultPosition() { return 'bottom-right'; }

    // Back-compat toggle for callers that only ever meant "on" or "off".
    trigger() {
        if (this.isTracking) this.turnOff();
        else this._watch.start('trigger()');
        return true;
    }

    turnOff() {
        this._releaseDeviceLock();
        this._watch.turnOff();
        this._easeTo({ bearing: 0, pitch: 0, duration: 1000 });
    }

    // Called twice by design: once directly in map-init.js, before
    // map.on('load'), so the GPS auto-start runs in parallel with style and
    // tile loading, and again by map.addControl() when the bottom-right corner
    // is assembled. The second call hands back the same element rather than
    // rebuilding it and starting a second watch.
    onAdd(map) {
        if (this._container) return this._container;
        this._map = map;
        console.log(`[GPS] MapOrientationControl.onAdd at t=${Math.round(performance.now())}ms`);

        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group map-orientation-control';
        this._container.innerHTML = BUTTON_HTML;
        this._button = this._container.querySelector('.map-orientation-btn');
        this._icon = this._container.querySelector('.map-orientation-icon');
        this._needle = this._container.querySelector('.map-orientation-needle');
        this._headingTick = this._container.querySelector('.map-orientation-heading');
        this._button.addEventListener('click', this._onClick);

        map.on('rotate', this._render);
        map.on('pitch', this._render);
        $(window).on('deviceorientationabsolute deviceorientation', this._onDeviceOrientation);
        this._watch.onAdd(map);

        this._render();
        return this._container;
    }

    onRemove() {
        this._map?.off('rotate', this._render);
        this._map?.off('pitch', this._render);
        $(window).off('deviceorientationabsolute deviceorientation', this._onDeviceOrientation);
        this._watch.onRemove();
        this._container?.remove();
        this._map = null;
    }

    // The watch reports GPS state only; which of the two locked modes that
    // means is this control's business, since it owns the device lock.
    _onWatchState = (state) => {
        const mode = state === WATCH.ACTIVE
            ? (this._wantDeviceLock ? MODE.FOLLOW_HEADING : MODE.FOLLOW_NORTH)
            : WATCH_MODES[state];
        this._setMode(mode);
    }

    _setMode(mode) {
        if (mode === this._mode) return this._render();
        this._mode = mode;
        if (mode === MODE.FOLLOW_HEADING) this._lockToDevice();
        else this._lockedToDevice = false;
        if (MODE_MESSAGES[mode]) showGeolocationStatus(MODE_MESSAGES[mode], mode === MODE.LOCATING ? 0 : 3000);
        this._render();
    }

    _onClick = () => {
        // A tap is an explicit "now", so drop any pending auto-activation and
        // act on the state the control is actually in.
        this._watch.cancelAutoActivate();
        const mapBearing = this._map ? this._map.getBearing() : 0;
        switch (nextOrientationAction({ mode: this._mode, mapBearing })) {
            case 'start': return this._start();
            case 'north': return this._faceNorth();
            case 'unlock': return this._unlockPosition();
            default: return this.turnOff();
        }
    }

    _start() {
        this._wantDeviceLock = this._canOfferDeviceLock();
        // iOS only hands out orientation events when asked from a user gesture,
        // so ask while the click that started GPS is still on the stack rather
        // than waiting for the first fix.
        if (this._wantDeviceLock) this._requestOrientationPermission();
        this._watch.start('button click');
    }

    _faceNorth() {
        this._releaseDeviceLock();
        this._easeTo({ bearing: 0, pitch: 0, duration: 500 });
        if (this._mode === MODE.FOLLOW_HEADING) this._setMode(MODE.FOLLOW_NORTH);
        else this._render();
    }

    _unlockPosition() {
        this._releaseDeviceLock();
        this._watch.unlockPosition();
    }

    _lockToDevice() {
        this._lockedToDevice = true;
        if (this._deviceBearing != null) this._easeToDeviceBearing(true);
    }

    _releaseDeviceLock() {
        this._wantDeviceLock = false;
        this._lockedToDevice = false;
    }

    _onDeviceOrientation = (event) => {
        const source = event.originalEvent || event;
        // iOS reports a true compass heading; everyone else reports alpha,
        // which counts counter-clockwise from north.
        const heading = source.webkitCompassHeading != null
            ? source.webkitCompassHeading
            : (source.absolute && source.alpha != null ? 360 - source.alpha : null);
        if (heading == null || Number.isNaN(heading)) return;

        this._deviceBearing = normalizeBearing(heading);
        if (this._lockedToDevice) this._easeToDeviceBearing();
        this._render();
    }

    // Orientation events fire at screen rate; ease at most every 100ms and only
    // for changes big enough to see.
    _easeToDeviceBearing(force = false) {
        if (!this._map || this._deviceBearing == null) return;
        const now = performance.now();
        if (!force) {
            if (now - this._lastDeviceEaseAt < 100) return;
            const delta = Math.abs(normalizeBearing(this._deviceBearing - this._map.getBearing() + 180) - 180);
            if (delta < 1) return;
        }
        this._lastDeviceEaseAt = now;
        this._easeTo({ bearing: this._deviceBearing, duration: 100 });
    }

    // geolocateSource marks every camera move this control makes as
    // programmatic. Without it GL JS reads its own bearing changes as the user
    // panning away and demotes ACTIVE_LOCK to BACKGROUND - which would unlock
    // the position the moment the map turned to face north or the device.
    _easeTo(options) {
        this._map?.easeTo(options, { geolocateSource: true });
    }

    _canOfferDeviceLock() {
        return this._deviceBearing != null || this._canRequestOrientationPermission();
    }

    // iOS 13+ withholds orientation events until asked, so a device lock is
    // still worth offering there before any heading has arrived.
    _canRequestOrientationPermission() {
        return typeof window.DeviceOrientationEvent?.requestPermission === 'function'
            && !this._orientationPermissionAsked;
    }

    async _requestOrientationPermission() {
        if (!this._canRequestOrientationPermission()) return;
        this._orientationPermissionAsked = true;
        try {
            await window.DeviceOrientationEvent.requestPermission();
        } catch (error) {
            console.warn('[Compass] Device orientation permission request failed:', error);
        }
        this._render();
    }

    // The tilt NavigationControl's visualizePitch used to give this symbol: the
    // whole rose lies back with the map, with the scale term countering the
    // vertical foreshortening rotateX introduces. Applied to the <svg> box, so
    // it composes over the in-plane rotations the needle and heading tick carry
    // as SVG transform attributes.
    _pitchTransform() {
        const pitch = this._map ? this._map.getPitch() : 0;
        if (!pitch) return '';
        return `scale(${1 / Math.pow(Math.cos(pitch * (Math.PI / 180)), 0.5)}) rotateX(${pitch}deg)`;
    }

    _render = () => {
        if (!this._button) return;
        const mapBearing = this._map ? this._map.getBearing() : 0;
        this._icon.style.transform = this._pitchTransform();

        // A pending auto-activation is a visual state only: the click cycle
        // still runs off the real mode, which is still OFF.
        this._button.dataset.mode = this._mode === MODE.OFF && this._watch.pendingAutoActivate
            ? MODE.LOCATING
            : this._mode;
        this._button.setAttribute('aria-pressed', String(this.isTracking));
        this._needle.setAttribute('transform', `rotate(${-normalizeBearing(mapBearing)} 18 18)`);
        if (this._deviceBearing == null) {
            this._headingTick.setAttribute('display', 'none');
        } else {
            this._headingTick.removeAttribute('display');
            this._headingTick.setAttribute('transform', `rotate(${normalizeBearing(this._deviceBearing - mapBearing)} 18 18)`);
        }

        const lines = buildOrientationTooltipLines({
            mode: this._mode,
            deviceBearing: this._deviceBearing,
            mapBearing,
            lockedToDevice: this._lockedToDevice,
            canOfferDeviceLock: this._canOfferDeviceLock()
        });
        this._button.setAttribute('title', lines.join('\n'));
        this._button.setAttribute('aria-label', lines.join('. '));
    }
}

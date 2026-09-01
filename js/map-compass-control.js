/**
 * Map compass with device-bearing lock
 *
 * Extends mapboxgl.NavigationControl - keeping its needle rotation and
 * drag-to-rotate/pitch handler - and replaces two things:
 *   - the "Reset bearing to north" tooltip, with a live readout of the device
 *     and map bearing plus what the next click will do
 *   - the click action, which now locks the map bearing to the device compass
 *     before offering a reset to north
 * The geolocation button drives that same lock while GPS is locked
 * (see js/button-geolocation-manager.js).
 */

const COMPASS_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function normalizeBearing(bearing) {
    return ((bearing % 360) + 360) % 360;
}

export function bearingToCompassPoint(bearing) {
    return COMPASS_POINTS[Math.round(normalizeBearing(bearing) / 22.5) % 16];
}

export function formatBearing(bearing) {
    const normalized = normalizeBearing(bearing);
    return `${bearingToCompassPoint(normalized)} ${Math.round(normalized) % 360}`;
}

// Builds the tooltip lines. Kept as a pure function of the compass state so the
// wording is testable without a map.
export function buildCompassTooltipLines({ deviceBearing, mapBearing, lockedToDevice, canOfferDeviceLock }) {
    const lines = [];
    if (deviceBearing != null) {
        lines.push(`Device Bearing ${formatBearing(deviceBearing)}`);
    }
    lines.push(lockedToDevice
        ? 'Map Bearing locked to device'
        : `Map Bearing ${formatBearing(mapBearing)}`);
    // With a device heading available the first click follows the device;
    // north is one more click away.
    lines.push(!lockedToDevice && canOfferDeviceLock
        ? 'Click to lock map bearing to device'
        : 'Click to lock map bearing to North');
    return lines;
}

export class MapCompassControl extends mapboxgl.NavigationControl {
    constructor(options = {}) {
        super({ showCompass: true, showZoom: false, visualizePitch: true, ...options });
        this._deviceBearing = null;
        this._lockedToDevice = false;
        this._orientationPermissionAsked = false;
        this._lastDeviceEaseAt = 0;
    }

    onAdd(map) {
        const container = super.onAdd(map);

        this._compassButton = this._compass || container.querySelector('.mapboxgl-ctrl-compass');
        // NavigationControl puts the tooltip on the icon span, not the button.
        this._compassTitleEl = this._compassIcon || this._compassButton?.firstElementChild || this._compassButton;

        // Capture on the container runs before the parent's click listener on
        // the button itself, so stopping propagation there is what lets us
        // replace "reset north" without touching the drag-rotate handler. A
        // drag that ends in a click is already suppressed by NavigationControl
        // at the window level, ahead of this listener.
        container.addEventListener('click', this._onContainerClickCapture, true);

        map.on('rotate', this._updateTooltip);
        $(window).on('deviceorientationabsolute deviceorientation', this._onDeviceOrientation);

        this._updateTooltip();

        return container;
    }

    onRemove() {
        this._container?.removeEventListener('click', this._onContainerClickCapture, true);
        this._map?.off('rotate', this._updateTooltip);
        $(window).off('deviceorientationabsolute deviceorientation', this._onDeviceOrientation);
        super.onRemove();
    }

    get lockedToDevice() {
        return this._lockedToDevice;
    }

    get deviceBearing() {
        return this._deviceBearing;
    }

    // Called by the geolocation button when GPS becomes locked, so the map top
    // always points where the device is facing. Locks synchronously except on
    // iOS, where the orientation permission prompt has to be answered first.
    lockToDevice() {
        if (this._lockedToDevice) return;
        if (this._canRequestOrientationPermission()) {
            this._requestOrientationPermission().then(granted => {
                if (granted) this._applyDeviceLock();
                else this._updateTooltip();
            });
            return;
        }
        this._applyDeviceLock();
    }

    _applyDeviceLock() {
        this._lockedToDevice = true;
        this._compassButton?.classList.add('compass-locked-device');
        if (this._deviceBearing != null) this._easeToDeviceBearing(true);
        this._updateTooltip();
    }

    // No-op unless currently following the device, so unlocking or turning off
    // GPS leaves a bearing the user set by hand alone.
    unlockFromDevice() {
        if (!this._lockedToDevice) return;
        this._lockedToDevice = false;
        this._compassButton?.classList.remove('compass-locked-device');
        this._updateTooltip();
    }

    _onContainerClickCapture = (event) => {
        if (!this._compassButton?.contains(event.target)) return;
        event.stopPropagation();
        event.preventDefault();
        this._onCompassClick();
    }

    _onCompassClick() {
        if (this._lockedToDevice) {
            this.unlockFromDevice();
            this._resetNorth();
        } else if (this._canOfferDeviceLock()) {
            this.lockToDevice();
        } else {
            this._resetNorth();
        }
    }

    _resetNorth() {
        if (!this._map) return;
        if (this.options.visualizePitch) this._map.resetNorthPitch();
        else this._map.resetNorth();
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
        this._updateTooltip();
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
        this._map.easeTo({ bearing: this._deviceBearing, duration: 100 });
    }

    // iOS 13+ withholds orientation events until asked, so a device lock is
    // still worth offering there before any heading has arrived.
    _canOfferDeviceLock() {
        return this._deviceBearing != null || this._canRequestOrientationPermission();
    }

    _canRequestOrientationPermission() {
        return typeof window.DeviceOrientationEvent?.requestPermission === 'function'
            && !this._orientationPermissionAsked;
    }

    async _requestOrientationPermission() {
        this._orientationPermissionAsked = true;
        try {
            return (await window.DeviceOrientationEvent.requestPermission()) === 'granted';
        } catch (error) {
            console.warn('[Compass] Device orientation permission request failed:', error);
            return false;
        }
    }

    _updateTooltip = () => {
        if (!this._compassTitleEl) return;
        const lines = buildCompassTooltipLines({
            deviceBearing: this._deviceBearing,
            mapBearing: this._map ? this._map.getBearing() : 0,
            lockedToDevice: this._lockedToDevice,
            canOfferDeviceLock: this._canOfferDeviceLock()
        });
        this._compassTitleEl.setAttribute('title', lines.join('\n'));
        this._compassButton?.setAttribute('aria-label', lines.join('. '));
    }
}

/**
 * Geolocation watch
 *
 * The GPS half of the orientation button (js/map-orientation-control.js):
 * wraps mapboxgl.GeolocateControl and keeps it as an engine only - the watch,
 * the location dot, the accuracy circle - with its own button never mounted.
 *
 * GL JS exposes no getter for the watch state, but _setWatchState keeps that
 * button's class list in exact sync with it, so the classes are read back here
 * as the source of truth. That also catches the ACTIVE_LOCK -> BACKGROUND
 * demotion GL JS applies on its own when the user pans away from their
 * location, which no public event distinguishes from switching off.
 */

import { trackEvent } from './analytics.js';
import { MapContextMessagesControl } from './map-context-messages-control.js';
import { showGeolocationErrorDialog, geolocationErrorMessage } from './geolocation-error-dialog.js';

const STATUS_MESSAGE_ID = 'geolocation-status';

export const WATCH = {
    OFF: 'off',
    LOCATING: 'locating',
    ACTIVE: 'active',
    UNLOCKED: 'unlocked',
    ERROR: 'error'
};

let statusMessageTimer = null;

// One status bar, reused by id, so consecutive changes replace each other in
// place rather than stacking.
export function showGeolocationStatus(html, autoCloseMs) {
    clearTimeout(statusMessageTimer);
    MapContextMessagesControl.show(html, { id: STATUS_MESSAGE_ID });
    if (autoCloseMs) {
        statusMessageTimer = setTimeout(() => MapContextMessagesControl.close(STATUS_MESSAGE_ID), autoCloseMs);
    }
}

export class GeolocationWatch {
    constructor(onStateChange, options = {}) {
        this._onStateChange = onStateChange;
        this._state = WATCH.OFF;
        this._errorCount = 0;
        this._autoActivateWatcher = null;
        // Last fix seen, kept so a consumer that starts listening mid-watch
        // (see map-nearby-features-control.js) has a position immediately
        // rather than waiting for the next one.
        this._lastPosition = null;
        // Set synchronously on the first start, so url-manager's later
        // applyURLParameters() can't re-toggle tracking off in the window
        // before the first GPS position arrives.
        this._started = false;

        this._control = new mapboxgl.GeolocateControl({
            showButton: false,
            showUserHeading: true,
            trackUserLocation: true,
            showAccuracyCircle: true,
            positionOptions: { enableHighAccuracy: true },
            fitBoundsOptions: { zoom: 18, padding: 20, maxZoom: 20 },
            ...options
        });

        $(document).on('url_updated', this._handleUrlUpdate);
    }

    get state() { return this._state; }
    get isTracking() { return this._state !== WATCH.OFF; }
    get pendingAutoActivate() { return this._autoActivateWatcher != null; }
    get lastPosition() { return this._lastPosition; }

    on(type, listener) { this._control.on(type, listener); return this; }
    once(type, listener) { this._control.once(type, listener); return this; }
    off(type, listener) { this._control.off(type, listener); return this; }

    // The returned element is deliberately never mounted; onAdd is called only
    // to wire up the watch and the location markers on this map.
    onAdd(map) {
        this._map = map;
        this._element = this._control.onAdd(map);
        this._control.on('geolocate', this._onGeolocate);
        this._control.on('error', this._onError);
        this._whenButtonReady(() => {
            this._sync();
            this._autoActivate();
        });
    }

    onRemove() {
        this._observer?.disconnect();
        this._cancelAutoActivate();
        $(document).off('url_updated', this._handleUrlUpdate);
        this._control.onRemove();
        this._map = null;
    }

    // GL JS builds its button only after an async geolocation-support check,
    // so wait for it rather than assuming onAdd left one behind.
    _whenButtonReady(callback) {
        const attach = () => {
            this._button = this._element.querySelector('.mapboxgl-ctrl-geolocate');
            if (!this._button) return false;
            this._observer = new MutationObserver(this._sync);
            this._observer.observe(this._button, { attributes: true, attributeFilter: ['class'] });
            callback();
            return true;
        };
        if (attach()) return;
        const pending = new MutationObserver(() => { if (attach()) pending.disconnect(); });
        pending.observe(this._element, { childList: true, subtree: true });
    }

    _sync = () => {
        const has = (suffix) => this._button.classList.contains(`mapboxgl-ctrl-geolocate-${suffix}`);
        // Order matters: the error and waiting states carry more than one of
        // these classes (see watchStateClasses in GL JS).
        let state;
        if (has('active-error') || has('background-error')) state = WATCH.ERROR;
        else if (has('waiting')) state = WATCH.LOCATING;
        else if (has('active')) state = WATCH.ACTIVE;
        else if (has('background')) state = WATCH.UNLOCKED;
        else state = WATCH.OFF;

        if (state === this._state) return;
        const previous = this._state;
        this._state = state;
        if (state === WATCH.OFF) this._started = false;
        // ?geolocate=true means "centre the map on the user", so it only
        // belongs in the URL while the camera is actually locked to them.
        // UNLOCKED keeps the dot but hands the camera back to the user, and a
        // reload from there has to land where they panned to, not snap back.
        const wants = (value) => value !== WATCH.OFF && value !== WATCH.UNLOCKED;
        if (wants(state) !== wants(previous)) {
            $(document).trigger('update_url', { geolocate: wants(state) });
        }
        this._onStateChange(state);
    }

    start(reason) {
        if (this.isTracking) return;
        this._started = true;
        // A previous unlockPosition() left followUserLocation false; without
        // restoring it the camera would drop back out of lock on the next fix.
        this._control.setFollowUserLocation(true);
        this._triggerStartedAt = performance.now();
        console.log(`[GPS] trigger() called at t=${Math.round(this._triggerStartedAt)}ms (${reason})`);
        this._control.trigger();
    }

    // ACTIVE_LOCK -> BACKGROUND: the dot and accuracy circle stay, the camera
    // stops following.
    unlockPosition() {
        this._control.setFollowUserLocation(false);
    }

    turnOff() {
        this._cancelAutoActivate();
        // GL JS reads a click in BACKGROUND as "re-centre", so trigger() alone
        // can't reach OFF from there and no public call can either. Putting the
        // watch state back to ACTIVE_LOCK first sends trigger() down its
        // turn-off branch, which then does the real work - clearing the watch
        // and resyncing the classes - itself. Should the private field ever be
        // renamed this degrades to GL JS's own behaviour (one more click to
        // turn off) rather than breaking.
        if (this._control._watchState === 'BACKGROUND' || this._control._watchState === 'BACKGROUND_ERROR') {
            this._control._watchState = 'ACTIVE_LOCK';
        }
        this._control.trigger();
        this._control.setFollowUserLocation(true);
    }

    // Two paths can ask for tracking on load: ?geolocate=true already in the
    // URL (share link, refresh), or the splash detecting GPS after onAdd runs
    // and writing the URL via history.replaceState - which fires no event, so
    // the second one has to be polled for.
    _autoActivate() {
        const wanted = () => new URLSearchParams(window.location.search).get('geolocate') === 'true'
            || !!window.loadingStartupState?.userLocation;
        const tryStart = (reason) => {
            if (this._started || this.isTracking) return true;
            if (!wanted()) return false;
            this.start(reason);
            return true;
        };
        if (tryStart('immediate: URL/userLocation already set')) return;

        // Poll every 100ms for up to 15s so the button can show the pending
        // activation instead of reading as plainly off.
        let attempts = 0;
        this._autoActivateWatcher = setInterval(() => {
            if (tryStart('watcher: splash wrote URL/userLocation') || ++attempts >= 150) this._cancelAutoActivate();
        }, 100);
        this._onStateChange(this._state);
    }

    cancelAutoActivate() { this._cancelAutoActivate(); }

    _cancelAutoActivate() {
        clearInterval(this._autoActivateWatcher);
        this._autoActivateWatcher = null;
        this._onStateChange(this._state);
    }

    _handleUrlUpdate = (event, params) => {
        // trigger() is a toggle, so calling it while a start is already in
        // flight would turn tracking back off. onAdd may have auto-started for
        // this same URL state already, in which case _started is true before
        // the first position arrives.
        if (params?.geolocate === true && !this._started && !this.isTracking) this.start('url_updated');
    }

    _onGeolocate = (event) => {
        this._lastPosition = { lng: event.coords.longitude, lat: event.coords.latitude };

        // geolocate fires continuously while tracking; report once per session
        if (!this._analyticsReported) {
            this._analyticsReported = true;
            trackEvent('geolocate', { status: 'success' });
        }
        this._errorCount = 0;
        const now = performance.now();
        const elapsed = this._triggerStartedAt
            ? `${Math.round(now - this._triggerStartedAt)}ms after trigger()`
            : '(no trigger timestamp)';
        console.log(
            `[GPS] First position from Mapbox at t=${Math.round(now)}ms (${elapsed}):`,
            `${event.coords.latitude.toFixed(6)}, ${event.coords.longitude.toFixed(6)}`
        );
    }

    _onError = (error) => {
        this._errorCount++;
        // The start has resolved, with failure; allow a retry from a later URL
        // update.
        this._started = false;
        console.warn('Geolocation error:', error);

        // macOS CoreLocation sporadically reports kCLErrorLocationUnknown
        // (code 2) and TIMEOUT (code 3) that recover on retry. Only surface the
        // dialog if errors persist, or immediately for PERMISSION_DENIED
        // (code 1), which won't resolve itself.
        const isTransient = error.code === 2 || error.code === 3;
        if (!isTransient || this._errorCount >= 3) {
            trackEvent('geolocate', { status: 'error', error_code: error.code });
            showGeolocationStatus(geolocationErrorMessage(error.code), 4000);
            showGeolocationErrorDialog(error);
        }

        setTimeout(() => { this._errorCount = 0; }, 60000);
    }
}

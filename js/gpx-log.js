/**
 * The device's GPS track log, shown in the place menu's Locate Me tab
 * (js/location-device.js) and drawn as the reserved `gpx` layer
 * (config/index.js).
 *
 * While Log Track is on, the latest fix from the map's own location watch
 * (window.geolocationControl, js/geolocation-watch.js) is added to this
 * session's track every interval; turning it on starts that watch if it is
 * off, and turning location off pauses the log. It never holds a watch of its
 * own: a second watch keeps the device's location provider running after the
 * map's is cleared, and a browser then answers the map's next start (which
 * asks for a fresh fix) only on the provider's next update - up to ~30s on a
 * stationary Mac. Tracks from this and past
 * sessions stay in localStorage, on this device only, until cleared. A session
 * is one browser tab (sessionStorage), so a reload keeps adding to its track.
 */
import { showSystemLayer, writeSystemLayer } from '../config/index.js';

const TRACKS_KEY = 'amche-gpx-tracks';
const SETTINGS_KEY = 'amche-gpx-settings';
const SESSION_KEY = 'amche-gpx-session';
const LAYER_ID = 'gpx';
const MAX_POINTS = 20000;
export const INTERVALS = [5, 10, 30, 60, 300];
const DEFAULTS = { logging: false, interval: 10 };

function store(name) {
    try { return window[name]; } catch { return null; }
}

function read(storage, key, fallback) {
    try { return JSON.parse(storage?.getItem(key)) ?? fallback; } catch { return fallback; }
}

function write(storage, key, value) {
    try { storage?.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

const round = (n, places) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(places)));

/** Metres along a track's points ([lng, lat, ...]). */
export function trackDistance(points) {
    let metres = 0;
    for (let i = 1; i < points.length; i++) {
        const [lng1, lat1] = points[i - 1];
        const [lng2, lat2] = points[i];
        const rad = Math.PI / 180;
        const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2;
        metres += 2 * 6371008.8 * Math.asin(Math.sqrt(a));
    }
    return metres;
}

export function formatDistance(metres) {
    return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(2)} km`;
}

export function trackName(track) {
    const date = new Date(track.startedAt);
    return `Track ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ` +
        date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** A track as a GPX 1.1 document. */
export function trackToGpx(track) {
    const escape = (text) => String(text).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
    const points = track.points.map(([lng, lat, time, , ele]) =>
        `      <trkpt lat="${lat}" lon="${lng}">${ele != null ? `<ele>${ele}</ele>` : ''}<time>${new Date(time).toISOString()}</time></trkpt>`);
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="Amche Atlas" xmlns="http://www.topografix.com/GPX/1/1">',
        `  <metadata><name>${escape(trackName(track))}</name><time>${new Date(track.startedAt).toISOString()}</time></metadata>`,
        '  <trk>',
        `    <name>${escape(trackName(track))}</name>`,
        '    <trkseg>',
        ...points,
        '    </trkseg>',
        '  </trk>',
        '</gpx>',
        ''
    ].join('\n');
}

/** Every track as a line (a lone point until it has two), and the current fix while logging. */
export function tracksToGeoJSON(tracks, currentId = null, fix = null) {
    const features = tracks.filter(track => track.points.length).map(track => {
        const coordinates = track.points.map(([lng, lat]) => [lng, lat]);
        const last = track.points[track.points.length - 1];
        return {
            type: 'Feature',
            id: track.id,
            geometry: coordinates.length > 1
                ? { type: 'LineString', coordinates }
                : { type: 'Point', coordinates: coordinates[0] },
            properties: {
                id: track.id,
                name: trackName(track),
                current: track.id === currentId,
                startedAt: new Date(track.startedAt).toLocaleString(),
                endedAt: new Date(last[2]).toLocaleString(),
                points: track.points.length,
                distance: formatDistance(trackDistance(track.points))
            }
        };
    });
    if (fix) {
        features.push({
            type: 'Feature',
            id: 'position',
            geometry: { type: 'Point', coordinates: [fix.lng, fix.lat] },
            properties: { id: 'position', name: 'Current position', current: true }
        });
    }
    return { type: 'FeatureCollection', features };
}

export class TrackLog {
    constructor({ storage = store('localStorage'), session = store('sessionStorage'), locator = () => window.geolocationControl } = {}) {
        this._storage = storage;
        this._locator = locator;
        this._listeners = new Set();
        this._timer = null;
        this.fix = null;
        this.error = null;
        this.settings = { ...DEFAULTS, ...read(storage, SETTINGS_KEY, {}) };
        this.sessionId = read(session, SESSION_KEY, null) || `t${Date.now().toString(36)}`;
        write(session, SESSION_KEY, this.sessionId);
    }

    get logging() { return this.settings.logging; }

    /** Log Track is on but location is off, so nothing is being logged. */
    get paused() { return this.logging && !this._locator()?.isTracking; }

    /** Newest first. */
    tracks() {
        return read(this._storage, TRACKS_KEY, []).sort((a, b) => b.startedAt - a.startedAt);
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    /** Draws the stored tracks, and resumes logging left on in an earlier visit. */
    start() {
        this._locator()?.on('geolocate', (event) => this._onPosition(event));
        if (this.logging) this._startLogging();
        this._changed();
    }

    setLogging(on) {
        this._saveSettings({ logging: !!on });
        if (on) this._startLogging();
        else this._stopLogging();
        this._changed();
    }

    setInterval(seconds) {
        this._saveSettings({ interval: seconds });
        if (this.logging) this._restartTimer();
        this._changed();
    }

    /** Removes one track, or every track when no id is given. */
    clear(id = null) {
        const tracks = id ? this.tracks().filter(track => track.id !== id) : [];
        if (tracks.length) write(this._storage, TRACKS_KEY, tracks);
        else this._storage?.removeItem(TRACKS_KEY);
        this._changed();
    }

    _saveSettings(changes) {
        this.settings = { ...this.settings, ...changes };
        write(this._storage, SETTINGS_KEY, this.settings);
    }

    _startLogging() {
        this.error = null;
        const control = this._locator();
        if (control && !control.isTracking) control.locate();
        this._restartTimer();
        showSystemLayer(LAYER_ID, true);
    }

    _stopLogging() {
        clearInterval(this._timer);
        this._timer = null;
    }

    _restartTimer() {
        clearInterval(this._timer);
        this._timer = setInterval(() => this._logFix(), this.settings.interval * 1000);
    }

    _onPosition({ coords, timestamp }) {
        const first = !this.fix;
        this.fix = {
            lng: coords.longitude,
            lat: coords.latitude,
            accuracy: coords.accuracy,
            altitude: coords.altitude,
            altitudeAccuracy: coords.altitudeAccuracy,
            heading: coords.heading,
            speed: coords.speed,
            timestamp: timestamp || Date.now()
        };
        this.error = null;
        if (first && this.logging) this._logFix();
    }

    // Adds the latest fix to this session's track, once per new fix.
    _logFix() {
        const fix = this.fix;
        if (!this.logging || !fix || fix.timestamp <= (this._loggedAt || 0)) return;
        this._loggedAt = fix.timestamp;
        const tracks = this.tracks();
        let track = tracks.find(t => t.id === this.sessionId);
        if (!track) {
            track = { id: this.sessionId, startedAt: fix.timestamp, points: [] };
            tracks.push(track);
        }
        track.points.push([round(fix.lng, 6), round(fix.lat, 6), fix.timestamp, round(fix.accuracy, 1), round(fix.altitude, 1)]);
        if (track.points.length > MAX_POINTS) track.points.splice(0, track.points.length - MAX_POINTS);
        if (!write(this._storage, TRACKS_KEY, tracks)) this.error = 'This device\'s storage is full';
        this._changed();
    }

    _changed() {
        writeSystemLayer(LAYER_ID, tracksToGeoJSON(this.tracks(), this.sessionId, this.logging ? this.fix : null));
        this._listeners.forEach(listener => listener());
    }
}

export const trackLog = new TrackLog();

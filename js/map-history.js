/**
 * Back / forward through the map's own history: every settled change to the
 * URL - the camera (the `#zoom/lat/lng` hash) or the query (layers, pins,
 * terrain, ...) - becomes a step, listed in the Share panel's History tab
 * (js/share-view-panel.js) to undo or redo, also with Ctrl/Cmd+Z and
 * Ctrl/Cmd+Shift+Z (js/keyboard-controller.js).
 *
 * The app writes the URL with history.replaceState, so the browser keeps no
 * entries of its own; the steps live in sessionStorage, which survives the
 * reload a step needs when it can't be applied live. A camera step eases the
 * map there; a step that only switches layers on or off toggles them; any
 * other step reloads at that URL.
 */
import { URLUtils } from './map-utils.js';
import { placeLine } from './map-search-toggle.js';

const STORAGE_KEY = 'amche_map_history';
const MAX_STEPS = 50;
const SETTLE_MS = 1200;

function load() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
        if (saved && Array.isArray(saved.steps)) return saved;
    } catch (error) { /* storage unavailable */ }
    return { steps: [], index: -1, pending: false };
}

export function parseCameraHash(hash) {
    const [zoom, lat, lng, bearing = 0, pitch = 0] = String(hash || '').replace(/^#/, '').split('/').map(Number);
    if (![zoom, lat, lng].every(Number.isFinite)) return null;
    return { zoom, center: [lng, lat], bearing: bearing || 0, pitch: pitch || 0 };
}

export function layerIds(search) {
    const param = new URLSearchParams(search).get('layers');
    return param
        ? URLUtils.parseLayersFromUrl(param).map(layer => (layer.rid ? `route-${layer.rid}` : layer.id)).filter(Boolean)
        : [];
}

function withoutLayers(search) {
    const params = new URLSearchParams(search);
    params.delete('layers');
    return params.toString();
}

/** What changed between two URLs: {kind: 'view'|'layers'|'settings', added, removed}. */
export function describeChange(fromUrl, toUrl) {
    if (!fromUrl) return { kind: 'view' };
    const from = new URL(fromUrl);
    const to = new URL(toUrl);
    const before = layerIds(from.search);
    const after = layerIds(to.search);
    const added = after.filter(id => !before.includes(id));
    const removed = before.filter(id => !after.includes(id));
    if (added.length || removed.length) return { kind: 'layers', added, removed };
    if (from.search !== to.search) return { kind: 'settings' };
    return { kind: 'view' };
}

export class MapHistory {
    constructor(map) {
        this._map = map;
        this._state = load();
        this._timer = null;
        this._listeners = new Set();
        this.navigating = this._state.pending;
        this._schedule = this._schedule.bind(this);
    }

    start() {
        const begin = () => {
            this._map.on('moveend', this._schedule);
            window.addEventListener('urlUpdated', this._schedule);
            window.addEventListener('mapLocationChanged', (e) => this._namePlace(e.detail?.address));
            this._schedule();
        };
        if (window.layersInitialized) begin();
        else window.addEventListener('layersInitialized', begin, { once: true });
    }

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    get steps() { return this._state.steps; }
    get index() { return this._state.index; }
    canBack() { return this._state.index > 0; }
    canForward() { return this._state.index < this._state.steps.length - 1; }
    // A change still settling counts as a step before stepping away from it.
    back() {
        if (!this.navigating) this._record();
        this.go(this._state.index - 1);
    }

    forward() { this.go(this._state.index + 1); }

    _schedule(e) {
        if (e?._isSearchPreview) return;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._record(), SETTLE_MS);
    }

    _save() {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this._state)); } catch (error) { /* storage unavailable */ }
        this._listeners.forEach(listener => listener());
    }

    _record() {
        const href = window.location.href;
        const { steps } = this._state;
        const current = steps[this._state.index];
        if (this.navigating) {
            // Landing on a step: it now holds the URL the map actually settled
            // at. Only a camera difference is the landing itself (easing ends a
            // hair off, a reload rewrites the URL); a layer change that arrived
            // meanwhile is a step of its own.
            const landed = this._state.pending || !current || describeChange(current.url, href).kind === 'view';
            this.navigating = false;
            this._state.pending = false;
            if (landed) {
                if (current) current.url = href;
                this._save();
                return;
            }
        }
        if (current?.url === href) return;
        steps.splice(this._state.index + 1);
        const step = { url: href, at: Date.now(), ...describeChange(current?.url, href) };
        // The first step's camera was geocoded before recording began.
        if (!current) step.place = placeLine(window.attributionControl?._address, 2) || undefined;
        steps.push(step);
        while (steps.length > MAX_STEPS) steps.shift();
        this._state.index = steps.length - 1;
        this._save();
    }

    // The reverse geocode for a camera lands after its step is recorded, so it
    // names the steps taken at that camera.
    _namePlace(address) {
        const name = placeLine(address, 2);
        const hash = window.location.hash;
        const unnamed = this._state.steps.filter(step => !step.place && new URL(step.url).hash === hash);
        if (!name || !unnamed.length) return;
        unnamed.forEach(step => { step.place = name; });
        this._save();
    }

    go(index) {
        const step = this._state.steps[index];
        if (!step || index === this._state.index) return;
        clearTimeout(this._timer);
        this._state.index = index;
        this.navigating = true;
        const current = new URL(window.location.href);
        const target = new URL(step.url);
        if (current.search === target.search) {
            this._save();
            this._moveTo(target.hash);
            return;
        }
        if (this._toggleLayers(layerIds(current.search), layerIds(target.search), current, target)) {
            this._save();
            this._moveTo(target.hash);
            return;
        }
        this._state.pending = true;
        this._save();
        window.location.replace(step.url);
    }

    _moveTo(hash) {
        const camera = parseCameraHash(hash);
        if (!camera) {
            this._schedule();
            return;
        }
        const here = parseCameraHash(window.location.hash);
        if (here && JSON.stringify(here) === JSON.stringify(camera)) {
            this._schedule();
            return;
        }
        this._map.easeTo({ ...camera, duration: 700 });
    }

    // Live when the step only switches known layers on or off; otherwise false.
    _toggleLayers(before, after, current, target) {
        const control = window.browserControl;
        const groups = window.layerControl?._state?.groups || [];
        if (!control || withoutLayers(current.search) !== withoutLayers(target.search)) return false;
        const added = after.filter(id => !before.includes(id));
        const removed = before.filter(id => !after.includes(id));
        const kept = after.filter(id => before.includes(id));
        const keptBefore = before.filter(id => after.includes(id));
        if (!added.length && !removed.length) return false;
        if (kept.join(',') !== keptBefore.join(',')) return false;
        if (![...added, ...removed].every(id => groups.some(g => g.id === id))) return false;
        removed.forEach(id => control._handleLayerToggle(id, false));
        added.forEach(id => control._handleLayerToggle(id, true));
        return true;
    }
}

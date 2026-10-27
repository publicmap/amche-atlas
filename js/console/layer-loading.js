/**
 * Which maps are on their way, for every eye in the console's lists
 * (js/console/find-rows.js eyeButton). A map switched from Find shows its new
 * state at once - pending until the map's own active layers catch up - and
 * while it is on but its data is still loading its eye carries a spinner, so
 * the lists show which maps are loading and which are ready.
 *
 * Eyes are swept in place on the map's data events rather than re-rendering
 * the lists, so a row is never rebuilt under the pointer just for a spinner.
 */
const PENDING_TIMEOUT = 20000;
const SOURCE_PREFIXES = ['vector', 'tms', 'wmts', 'wms', 'cog', 'geojson', 'geojson-overlay', 'csv'];

const pending = new Map();

const layerIds = (layer) => [layer?._prefixedId, layer?.id].filter(Boolean);
const map = () => window.map;

function liveId(layer) {
    return window.browserControl?._resolveLiveLayer?.(layer)?.id || layer.id;
}

export function eyeKey(layer) {
    return layer._prefixedId || layer.id;
}

/** The state a toggle from Find asked for, until the map has caught up. */
export function pendingState(layer) {
    const entry = layerIds(layer).map(id => pending.get(id)).find(Boolean);
    if (!entry) return undefined;
    if (Date.now() - entry.at > PENDING_TIMEOUT) {
        entry.ids.forEach(id => pending.delete(id));
        return undefined;
    }
    return entry.on;
}

export function setPending(layer, on) {
    const ids = [...new Set([...layerIds(layer), liveId(layer)])];
    const entry = { on, at: Date.now(), ids };
    ids.forEach(id => pending.set(id, entry));
}

/** Drops pending toggles the map's active layers now agree with. */
export function settlePending(active) {
    new Set(pending.values()).forEach(entry => {
        const isOn = entry.ids.some(id => active.has(id));
        if (isOn === entry.on) entry.ids.forEach(id => pending.delete(id));
    });
}

function sourceIds(id) {
    const api = window.layerControl?._mapboxAPI;
    return [api?.getSourceIdForGroup?.(id), id, ...SOURCE_PREFIXES.map(prefix => `${prefix}-${id}`)].filter(Boolean);
}

function sourcesLoaded(layer) {
    const m = map();
    if (!m?.getSource) return true;
    const id = liveId(layer);
    return sourceIds(id).every(sourceId => {
        try {
            return !m.getSource(sourceId) || m.isSourceLoaded(sourceId);
        } catch (error) {
            return true;
        }
    });
}

/** Whether a map that is on (or asked to be) is still loading its data. */
export function isLayerLoading(layer) {
    if (pendingState(layer) === true) return true;
    const loadingIds = window.layerControl?._loadingLayerIds;
    if (loadingIds && [...layerIds(layer), liveId(layer)].some(id => loadingIds.has(id))) return true;
    return !sourcesLoaded(layer);
}

const layersById = new Map();

/** Remembers the layer behind an eye so a sweep can find it again. */
export function trackEye(button, layer) {
    const key = eyeKey(layer);
    button.dataset.layerKey = key;
    layersById.set(key, layer);
}

/** Updates every console eye's spinner for what is loading right now. */
export function sweepEyes(root = document) {
    const active = window.browserControl?._getActiveLayers?.();
    if (active) settlePending(active);
    root.querySelectorAll('.console-eye[data-layer-key]').forEach(button => {
        const layer = layersById.get(button.dataset.layerKey);
        if (!layer) return;
        const on = button.classList.contains('on');
        button.classList.toggle('loading', on && isLayerLoading(layer));
    });
}

let sweepTimer = null;
function scheduleSweep() {
    if (sweepTimer) return;
    sweepTimer = setTimeout(() => {
        sweepTimer = null;
        sweepEyes();
    }, 150);
}

let watchedMap = null;
/** Keeps the eyes' spinners current as the map loads and settles. */
export function watchLoading(target = map()) {
    if (!target?.on || watchedMap === target) return;
    if (watchedMap) {
        watchedMap.off?.('sourcedata', scheduleSweep);
        watchedMap.off?.('idle', scheduleSweep);
    } else {
        window.addEventListener('layer-toggled', scheduleSweep);
    }
    watchedMap = target;
    target.on('sourcedata', scheduleSweep);
    target.on('idle', scheduleSweep);
}

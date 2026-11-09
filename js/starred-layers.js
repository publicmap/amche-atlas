/**
 * Starred maps: the maps a viewer marks to find again, kept in this browser
 * (localStorage) and shared by the map console and the layer editor
 * (map-creator.html, a same-origin iframe). An atlas's default maps - its
 * `initiallyChecked` ones - start starred; a viewer can unstar them, or star
 * any other map. The atlas overview lists starred maps, and the groups they
 * sit in, first (js/console/data-sources.js).
 */

const STORAGE_KEY = 'amche.starredLayers';
const EVENT = 'starred-layers-changed';

function load() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        return {};
    }
}

/** A map's key across atlases: its atlas-prefixed id (goa-local-body). */
export function layerKey(layer) {
    if (!layer) return '';
    if (layer._prefixedId) return layer._prefixedId;
    const id = String(layer.id || '');
    const atlas = layer._sourceAtlas;
    return atlas && !id.startsWith(`${atlas}-`) ? `${atlas}-${id}` : id;
}

/**
 * @param {Object} layer
 * @param {{isDefault?: boolean}} [options] - isDefault: one of its atlas's
 *   default maps, starred unless the viewer unstarred it
 */
export function isStarred(layer, { isDefault = !!layer?.initiallyChecked } = {}) {
    const choice = load()[layerKey(layer)];
    return choice === undefined ? isDefault : !!choice;
}

export function setStarred(layer, starred) {
    const key = layerKey(layer);
    if (!key) return;
    const all = load();
    all[key] = !!starred;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        // Private mode or storage full: the star lasts for this page only
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, starred: !!starred } }));
}

/** Calls `callback` when a star changes, here or in another window of this site. */
export function onStarredChange(callback) {
    const onStorage = (e) => {
        if (e.key === STORAGE_KEY) callback();
    };
    window.addEventListener(EVENT, callback);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(EVENT, callback);
        window.removeEventListener('storage', onStorage);
    };
}

/**
 * Each atlas's maps as they were left (MapBrowserControl.switchAtlasLive).
 * Switching away from an atlas keeps its link's query - the maps on the map,
 * their customizations and every other URL API setting - for this tab
 * (sessionStorage). Switching back to it reopens the page on that query with
 * the camera as it is now (the `#` hash), since a running map can't take a
 * whole link's settings back on; the map console comes back as it was
 * (atlas mode) once the page has loaded.
 */

const ATLAS_KEY = 'amche.atlasMemory';
const CONSOLE_KEY = 'amche.consoleReturn';
// Settings that only move the camera, which stays as it is now
const CAMERA_PARAMS = /^(geolocate|zoomTo|bearing|pitch)=/;

function read(key) {
    try {
        return JSON.parse(sessionStorage.getItem(key)) || null;
    } catch {
        return null;
    }
}

function write(key, value) {
    try {
        if (value === null) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage unavailable: atlases switch without being remembered
    }
}

/** Keeps the atlas's link query as it is now. */
export function rememberAtlas(atlasId) {
    if (!atlasId) return;
    window.urlManager?.flushURLUpdate?.();
    const all = read(ATLAS_KEY) || {};
    all[atlasId] = window.location.search;
    write(ATLAS_KEY, all);
}

/**
 * Reopens the page on the atlas's remembered query, keeping the camera hash.
 * @returns {boolean} whether it did - false for an atlas not left before
 */
export function restoreAtlas(atlasId, consoleState = null) {
    const saved = (read(ATLAS_KEY) || {})[atlasId];
    if (!saved) return false;
    // Kept as written (the layers list is not re-encoded), less the camera moves
    const kept = saved.replace(/^\?/, '').split('&').filter(part => part && !CAMERA_PARAMS.test(part));
    let query = kept.length ? `?${kept.join('&')}` : '';
    const params = new URLSearchParams(query);
    if (params.has('atlas') && params.get('atlas') !== atlasId) return false;
    // Named, so the page doesn't pick an atlas by location instead
    if (!params.has('atlas')) query += `${query ? '&' : '?'}atlas=${encodeURIComponent(atlasId)}`;
    write(CONSOLE_KEY, consoleState);
    window.location.assign(`${window.location.pathname}${query}${window.location.hash}`);
    return true;
}

/** The console's state to bring back after a restore, once. */
export function takeConsoleState() {
    const state = read(CONSOLE_KEY);
    write(CONSOLE_KEY, null);
    return state;
}

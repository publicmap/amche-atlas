/**
 * The maps each atlas has had on the map, in the order the console's Active
 * Maps list shows them (js/layer-stack-strip.js), kept in localStorage. A map
 * turned off stays in the list - in its place, to be turned back on - until
 * it is removed from there; a map turned on anywhere joins it again.
 *
 * A map the layer registry doesn't know (a layer given inline in the link, or
 * made in the layer editor) has its config kept too, so it can be listed and
 * added back once the link no longer carries it (js/map-browser-control.js).
 */
const KEY = 'amche-active-map-history';
const CONFIG_KEY = 'amche-active-map-configs';
const LIMIT = 60;
// A config bigger than this (inline GeoJSON, say) isn't kept
const MAX_CONFIG_CHARS = 200000;

let cache = null;
let configCache = null;
const listeners = new Set();

function readAll() {
    if (cache) return cache;
    try {
        const parsed = JSON.parse(localStorage.getItem(KEY));
        cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        cache = {};
    }
    return cache;
}

function write(atlasId, ids) {
    const all = readAll();
    all[atlasId] = ids.slice(0, LIMIT);
    try {
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) {
        // Storage full or blocked: the list still works for this visit
    }
}

function readConfigs() {
    if (configCache) return configCache;
    try {
        const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY));
        configCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        configCache = {};
    }
    return configCache;
}

function writeConfigs() {
    try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(readConfigs()));
    } catch (e) {
        // Storage full or blocked: the config lasts this visit
    }
}

// A config as plain data, without the app's own bookkeeping
function plainConfig(config) {
    try {
        const json = JSON.stringify(config, (key, value) => (key === '_originalJson' || typeof value === 'function' ? undefined : value));
        return json && json.length <= MAX_CONFIG_CHARS ? JSON.parse(json) : null;
    } catch (e) {
        return null;
    }
}

const unique = (ids) => [...new Set(ids.filter(id => typeof id === 'string' && id))];
const same = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

export const activeMapHistory = {
    list(atlasId) {
        const ids = readAll()[atlasId];
        return Array.isArray(ids) ? unique(ids) : [];
    },

    has(atlasId, id) {
        return this.list(atlasId).includes(id);
    },

    /** Adds the maps not in it yet, after the rest. */
    add(atlasId, ids) {
        const current = this.list(atlasId);
        const next = unique([...current, ...ids]);
        if (same(current, next)) return;
        write(atlasId, next);
    },

    /** The order the list shows: `ids` first, then the rest as they were. */
    setOrder(atlasId, ids) {
        const current = this.list(atlasId);
        const next = unique([...ids, ...current]);
        if (same(current, next)) return;
        write(atlasId, next);
    },

    remove(atlasId, id) {
        const current = this.list(atlasId);
        if (!current.includes(id)) return;
        write(atlasId, current.filter(other => other !== id));
        const configs = readConfigs()[atlasId];
        if (configs && id in configs) {
            delete configs[id];
            writeConfigs();
        }
        listeners.forEach(listener => listener(atlasId, id));
    },

    /** Keeps the config of a map the registry doesn't know, while it is in the list. */
    keepConfig(atlasId, config) {
        if (!config?.id) return;
        const plain = plainConfig(config);
        if (!plain) return;
        const all = readConfigs();
        all[atlasId] ||= {};
        if (JSON.stringify(all[atlasId][config.id]) === JSON.stringify(plain)) return;
        all[atlasId][config.id] = plain;
        writeConfigs();
    },

    /** A kept config, in this atlas's list or any other's. */
    config(id, atlasId = null) {
        const all = readConfigs();
        if (atlasId && all[atlasId]?.[id]) return all[atlasId][id];
        return Object.values(all).find(configs => configs?.[id])?.[id] || null;
    },

    /** @returns {() => void} unsubscribe */
    onRemove(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    /** Forgets the cached copy, e.g. after another tab changed it. */
    reload() {
        cache = null;
        configCache = null;
    }
};

/**
 * One list's order: the maps that are off stay where they were in `lastOrder`,
 * and the maps that are on fill the other places in `active`'s order (the
 * map's stack order). A map off that was never placed goes last.
 *
 * @param {string[]} active - ids on the map, in stack order
 * @param {string[]} inactive - ids off the map, kept in the list
 * @param {string[]} lastOrder - the list as it was last shown
 * @returns {string[]}
 */
export function keepPlaces(active, inactive, lastOrder = []) {
    const total = active.length + inactive.length;
    const slots = new Array(total).fill(null);
    const placed = inactive
        .map((id, i) => ({ id, at: lastOrder.indexOf(id), i }))
        .sort((a, b) => ((a.at < 0) - (b.at < 0)) || (a.at - b.at) || (a.i - b.i));
    // Each at its old place, unless that would crowd out the ones after it
    let previous = -1;
    placed.forEach(({ id, at }, i) => {
        const wanted = at < 0 ? Infinity : at;
        const index = Math.max(previous + 1, Math.min(wanted, total - (placed.length - i)));
        slots[index] = id;
        previous = index;
    });
    let next = 0;
    return slots.map(id => id ?? active[next++]);
}

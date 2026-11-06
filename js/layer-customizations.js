/**
 * What the user has changed on a map over its configured value: the fields
 * edited in the layer editor (`_editedFields`, see js/url-manager.js), its
 * opacity and its filter. Until saved elsewhere these live only in the link's
 * `?layers=` entry (docs/API.md), so this also measures the link: its length
 * against what browsers, servers and QR codes take, and which changes it can't
 * carry - a map that is off has no `?layers=` entry, and a link past the limit
 * is cut short by whatever it is pasted into.
 *
 * Used by the thumbnail's change badge (js/layer-change-badge.js) and the
 * editor's Save settings (js/creator-save-settings.js). Both may run in the
 * editor's iframe, so the map's state is read from the page that owns it.
 */

// Short enough for every chat app, browser and the share QR code
export const URL_SAFE_LENGTH = 2000;
// What servers and link shorteners commonly accept
export const URL_MAX_LENGTH = 8000;

/** The window that owns the map (the parent of the editor's iframe). */
export function mapWindow() {
    try {
        if (window.parent !== window && window.parent.layerControl) return window.parent;
    } catch {
        // A parent on another origin: this window is the map's own
    }
    return window;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function presetOf(layer) {
    const registry = mapWindow().layerRegistry;
    return registry?.getLayer?.(layer.id, layer._sourceAtlas, true) || registry?.getLayer?.(layer.id, null, true) || null;
}

/**
 * @param {Object} layer - the live layer (its entry in the layer control's state)
 * @returns {Array<{field: string, value: *, configured: *}>}
 */
export function layerCustomizations(layer) {
    if (!layer?.id) return [];
    const preset = presetOf(layer);
    const changes = [];
    const add = (field, value, configured) => {
        if (!changes.some(change => change.field === field)) changes.push({ field, value, configured });
    };
    (layer._editedFields || []).forEach(field => {
        if (field === 'id' || layer[field] === undefined || same(layer[field], preset?.[field])) return;
        add(field, layer[field], preset?.[field]);
    });
    const configuredOpacity = preset?.opacity ?? 1;
    if (layer.opacity != null && Number(layer.opacity) !== Number(configuredOpacity)) add('opacity', layer.opacity, configuredOpacity);
    if (layer.filter !== undefined && !same(layer.filter, preset?.filter)) add('filter', layer.filter, preset?.filter);
    return changes;
}

/** A value short enough for a tooltip line. */
export function formatValue(value, max = 48) {
    if (value === undefined || value === null || value === '') return 'not set';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The live layer with this id, from the map's layer control. */
export function liveLayer(id) {
    return mapWindow().layerControl?._state?.groups?.find(group => group.id === id) || null;
}

/** Splits `?layers=` on its top-level commas (inline JSON entries hold commas of their own). */
export function splitLayersParam(value) {
    const entries = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (quote) {
            if (ch === quote && value[i - 1] !== '\\') quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '{' || ch === '[' || ch === '(') depth++;
        else if (ch === '}' || ch === ']' || ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
            entries.push(value.slice(start, i));
            start = i + 1;
        }
    }
    if (value.length > start) entries.push(value.slice(start));
    return entries.map(entry => entry.trim()).filter(Boolean);
}

function entryId(entry) {
    if (!/^[{]/.test(entry)) return entry.split(/[:(]/)[0];
    const match = entry.match(/["']id["']\s*:\s*["']([^"']+)["']/);
    return match ? match[1] : null;
}

/**
 * How the link holds the map's changes.
 * @param {string} [href] - the link (the map's own by default)
 * @returns {{length: number, safe: number, max: number, entries: Array, unsaved: Array<{layer, changes, reason}>}}
 */
export function urlUsage(href = mapWindow().location.href) {
    const url = new URL(href);
    const length = href.length;
    const layersParam = url.searchParams.get('layers') || '';
    const prefix = href.length - encodeURIComponent(layersParam).length;
    let end = prefix;
    const entries = splitLayersParam(layersParam).map(text => {
        const size = encodeURIComponent(text).length + 1;
        end += size;
        return { id: entryId(text), text, size, fits: end <= URL_MAX_LENGTH };
    });
    const groups = mapWindow().layerControl?._state?.groups || [];
    const unsaved = [];
    groups.forEach(layer => {
        const changes = layerCustomizations(layer);
        if (!changes.length) return;
        const entry = entries.find(e => e.id === layer.id || e.id === layer._normalizedId);
        if (!entry) unsaved.push({ layer, changes, reason: 'The map is off, so the link leaves it out' });
        else if (!entry.fits) unsaved.push({ layer, changes, reason: `The link is over ${URL_MAX_LENGTH.toLocaleString()} characters by here` });
    });
    return { length, safe: URL_SAFE_LENGTH, max: URL_MAX_LENGTH, entries, unsaved };
}

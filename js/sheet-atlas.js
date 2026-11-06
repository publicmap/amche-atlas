/**
 * An atlas kept in a Google Sheet: `?atlas=<sheet url>` (see
 * docs/guides/sheet-atlas.md). Read by js/config-cache.js in place of a JSON
 * file, so everything that loads an atlas from a URL takes a sheet too.
 *
 * Tabs, found by name, all optional:
 *  - `atlas`: `key` | `value` rows - name, description, color, center
 *    ("lng, lat"), zoom, pitch, bearing, style, headerImage, areaOfInterest,
 *    saveUrl, routesTitle, and `config` for any other atlas field as JSON
 *  - `layers`: one row per map, in stack order (first on top). An `id` alone
 *    uses that map from the atlases; with a `type` it is a new map. Columns
 *    are the layer config fields of docs/API.md; `style`, `inspect` and
 *    `config` (anything else) hold JSON, `tags` is comma-separated,
 *    `read-only` becomes the layer's `readOnly` (no writes back to the sheet),
 *    `enabled` FALSE leaves a row out
 *  - `markers`: pins that are not stops of a route - id, name, lng, lat,
 *    description, pinned - the atlas's own `markers`
 *  - `waypoints` and `routes`: a route network (docs/route-sheets.md), drawn
 *    as one `routes` layer reading this same sheet, editable when the atlas
 *    tab names the Apps Script `saveUrl`
 */
import { extractSpreadsheetId, buildCsvUrl, buildEditUrl, fetchSheetTabs, fetchCsvRows } from './google-sheets-api.js';

const TABS = {
    atlas: /^(atlas|settings|config)$/i,
    layers: /^(layers|maps)$/i,
    markers: /^(markers|pins)$/i,
    waypoints: /^(waypoints?|stops)$/i,
    routes: /^routes?$/i
};
const JSON_FIELDS = new Set(['style', 'inspect', 'config', 'filter', 'bbox', 'legendMap', 'layers']);
const NUMBER_FIELDS = new Set(['opacity', 'minzoom', 'maxzoom', 'zoom', 'pitch', 'bearing', 'refresh']);
const BOOLEAN_FIELDS = new Set(['initiallyChecked', 'pinned']);

const clean = (value) => (value === undefined || value === null ? '' : String(value).trim());
const trimKeys = (row) => Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [clean(k), v]));

export function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    return /^(true|yes|y|1|on|x|✓)$/i.test(clean(value));
}

function parseJson(value, where) {
    const text = clean(value);
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch (error) {
        console.warn(`[sheet atlas] ${where}: not valid JSON, ignored:`, text.slice(0, 80));
        return undefined;
    }
}

function parseLngLat(value) {
    const parts = clean(value).split(/[\s,;/]+/).map(Number).filter(Number.isFinite);
    return parts.length >= 2 ? [parts[0], parts[1]] : null;
}

/** The `atlas` tab's key / value rows as atlas fields. */
export function atlasSettings(rows) {
    const settings = {};
    (rows || []).forEach(raw => {
        const row = trimKeys(raw);
        const key = clean(row.key ?? row.setting ?? row.field ?? Object.values(raw)[0]);
        const value = row.value ?? Object.values(raw)[1];
        if (!key || clean(value) === '') return;
        settings[key] = value;
    });
    const atlas = {};
    const map = {};
    Object.entries(settings).forEach(([key, value]) => {
        if (key === 'center') {
            const center = parseLngLat(value);
            if (center) map.center = center;
        } else if (['zoom', 'pitch', 'bearing'].includes(key)) {
            if (Number.isFinite(Number(value))) map[key] = Number(value);
        } else if (key === 'style') {
            map.style = clean(value);
        } else if (key === 'config' || key === 'json') {
            Object.assign(atlas, parseJson(value, 'atlas config') || {});
        } else {
            atlas[key] = clean(value);
        }
    });
    if (Object.keys(map).length) atlas.map = { ...(atlas.map || {}), ...map };
    return atlas;
}

/** One `layers` row as a layer config, or null for a row left out. */
export function layerFromRow(raw) {
    const row = trimKeys(raw);
    const id = clean(row.id);
    if (!id || (clean(row.enabled) !== '' && !parseBoolean(row.enabled))) return null;
    const layer = { id };
    Object.entries(row).forEach(([key, value]) => {
        if (!key || key === 'id' || key === 'enabled' || key === 'config' || clean(value) === '') return;
        if (JSON_FIELDS.has(key)) {
            const parsed = parseJson(value, `layer ${id} ${key}`);
            if (parsed !== undefined) layer[key] = parsed;
        } else if (NUMBER_FIELDS.has(key)) {
            if (Number.isFinite(Number(value))) layer[key] = Number(value);
        } else if (/^read[-_ ]?only$/i.test(key)) {
            layer.readOnly = parseBoolean(value);
        } else if (BOOLEAN_FIELDS.has(key)) {
            layer[key] = parseBoolean(value);
        } else if (key === 'tags') {
            layer.tags = clean(value).split(',').map(tag => tag.trim()).filter(Boolean);
        } else {
            layer[key] = clean(value);
        }
    });
    return { ...layer, ...(parseJson(row.config, `layer ${id} config`) || {}) };
}

export function markerFromRow(raw) {
    const row = trimKeys(raw);
    const id = clean(row.id);
    const lng = Number(row.lng ?? row.lon ?? row.longitude ?? row.x);
    const lat = Number(row.lat ?? row.latitude ?? row.y);
    if (!id || !Number.isFinite(lng) || !Number.isFinite(lat) || clean(row.lng ?? row.lon ?? row.longitude ?? row.x) === '') return null;
    return {
        id,
        coordinates: [lng, lat],
        ...(clean(row.name) ? { name: clean(row.name) } : {}),
        ...(clean(row.description) ? { description: clean(row.description) } : {}),
        ...(parseBoolean(row.pinned) ? { pinned: true } : {})
    };
}

function bboxOf(points) {
    if (!points.length) return null;
    const lngs = points.map(p => p[0]);
    const lats = points.map(p => p[1]);
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/**
 * The atlas a sheet's tabs make.
 * @param {{atlas?, layers?, markers?, waypoints?, routes?}} tabs - rows per tab
 * @param {{url: string, gids?: Object<string, string>}} source - the sheet, and its tabs' gids
 */
export function sheetToAtlas(tabs, { url, gids = {} } = {}) {
    const atlas = { name: 'Google Sheet atlas', ...atlasSettings(tabs.atlas) };
    const layers = (tabs.layers || []).map(layerFromRow).filter(Boolean);
    const markers = (tabs.markers || []).map(markerFromRow).filter(Boolean);
    const waypoints = (tabs.waypoints || []).map(markerFromRow).filter(Boolean);
    const hasRoutes = (tabs.routes || []).some(row => clean(trimKeys(row).id));

    if (hasRoutes && !layers.some(layer => layer.type === 'routes')) {
        layers.unshift({
            id: 'sheet-routes',
            title: atlas.routesTitle || 'Routes',
            type: 'routes',
            url,
            ...(atlas.saveUrl ? { saveUrl: atlas.saveUrl } : {}),
            ...(gids.waypoints ? { waypointsGid: gids.waypoints } : {}),
            ...(gids.routes ? { routesGid: gids.routes } : {}),
            initiallyChecked: true
        });
    }
    delete atlas.routesTitle;
    atlas.layers = [...layers, ...(atlas.layers || [])];
    if (markers.length) atlas.markers = markers;

    const bbox = bboxOf([...markers, ...waypoints].map(m => m.coordinates));
    if (bbox && !atlas.bbox) atlas.bbox = bbox;
    if (bbox && !atlas.map?.center) {
        atlas.map = { zoom: 13, ...(atlas.map || {}), center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] };
    }
    atlas.url = atlas.url || url;
    return atlas;
}

export function isSheetAtlasUrl(url) {
    return typeof url === 'string' && /docs\.google\.com\/spreadsheets\/d\//.test(url);
}

/** Reads every known tab of a sheet shared "Anyone with the link can view" and builds its atlas. */
export async function loadSheetAtlas(url) {
    const id = extractSpreadsheetId(url);
    if (!id) throw new Error('Not a Google Sheet URL');
    const found = await fetchSheetTabs(id);
    const gids = {};
    Object.entries(TABS).forEach(([key, pattern]) => {
        const tab = found.find(t => pattern.test(t.name.trim()));
        if (tab) gids[key] = tab.gid;
    });
    if (!Object.keys(gids).length) throw new Error('The sheet has none of the tabs atlas, layers, markers, waypoints, routes');
    const tabs = {};
    await Promise.all(Object.entries(gids).map(async ([key, gid]) => {
        tabs[key] = await fetchCsvRows(buildCsvUrl(id, gid));
    }));
    return sheetToAtlas(tabs, { url: buildEditUrl(id), gids });
}

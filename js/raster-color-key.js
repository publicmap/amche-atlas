/**
 * A raster layer's `colorKey`: one color turned transparent, every other pixel
 * kept as it is - `{ color: '#ffffff', alpha: 0, tolerance: 0.1 }`. alpha is
 * how opaque the matched pixels stay (0 removes them), tolerance how far from
 * the color (largest per-channel difference, 0..1) a pixel may be and match.
 *
 * Its `recolor`, `{ grayscale: true, invert: true }`, redraws the pixels left
 * after the key in greys and/or as a negative.
 *
 * Tile layers (tms, wms, wmts) draw through js/color-key-tile-provider.js,
 * which edits each tile's pixels; both ride in the tile URL's fragment
 * (`#ck=ffffff,0,0.1&rc=gi`) so changing them only reloads the source's tiles
 * (see setPixelEdits).
 */

export const KEY_DEFAULTS = { color: '#ffffff', alpha: 0, tolerance: 0.1 };
export const KEYABLE_TYPES = new Set(['tms', 'wms', 'wmts']);

const PROVIDER = 'colorkey';
const PROVIDER_URL = new URL('./color-key-tile-provider.js', import.meta.url).href;
const FRAGMENT = /#(ck|rc)=[^#]*$/;
const RECOLORS = { grayscale: 'g', invert: 'i' };
let registered = false;

/** Whether a layer can take a color key: a tile template the provider can fetch. */
export function canColorKey(layer) {
    if (!KEYABLE_TYPES.has(layer?.type) || !providerAvailable()) return false;
    const url = String(layer.url || '');
    return !url.startsWith('mapbox://') && !/\.pmtiles(\?|$)/.test(url);
}

export function normalizeKey(key) {
    if (!key || typeof key !== 'object') return null;
    const color = /^#[0-9a-f]{6}$/i.test(key.color) ? key.color.toLowerCase() : KEY_DEFAULTS.color;
    const alpha = Number.isFinite(Number(key.alpha)) ? Math.min(1, Math.max(0, Number(key.alpha))) : KEY_DEFAULTS.alpha;
    const tolerance = Number.isFinite(Number(key.tolerance)) ? Math.min(1, Math.max(0, Number(key.tolerance))) : KEY_DEFAULTS.tolerance;
    return { color, alpha, tolerance };
}

export function keyFragment(key) {
    const { color, alpha, tolerance } = normalizeKey(key);
    return `#ck=${color.slice(1)},${+alpha.toFixed(3)},${+tolerance.toFixed(3)}`;
}

export function normalizeRecolor(recolor) {
    if (!recolor || typeof recolor !== 'object') return null;
    const on = Object.keys(RECOLORS).filter(name => recolor[name]);
    return on.length ? Object.fromEntries(on.map(name => [name, true])) : null;
}

/** The tile URL fragment for a layer's colorKey and recolor, '' with neither. */
export function pixelFragment(config) {
    const key = normalizeKey(config?.colorKey);
    const recolor = normalizeRecolor(config?.recolor);
    const parts = [];
    if (key) parts.push(keyFragment(key).slice(1));
    if (recolor) parts.push(`rc=${Object.keys(recolor).map(name => RECOLORS[name]).join('')}`);
    return parts.length ? `#${parts.join('&')}` : '';
}

/** '#rrggbbaa' for a colour picker with opacity, and back. */
export function keyToHexa(key) {
    const { color, alpha } = normalizeKey(key) || KEY_DEFAULTS;
    return color + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

export function hexaToKey(hexa, tolerance) {
    const value = String(hexa || '').trim().toLowerCase();
    const color = /^#[0-9a-f]{6}/.test(value) ? value.slice(0, 7) : KEY_DEFAULTS.color;
    const alpha = /^#[0-9a-f]{8}$/.test(value) ? parseInt(value.slice(7, 9), 16) / 255 : 1;
    return normalizeKey({ color, alpha, tolerance });
}

// The editor runs in an iframe of the map's page: ask the page with the map.
function providerAvailable() {
    if (typeof window === 'undefined') return false;
    let gl = window.mapboxgl;
    try {
        gl = gl || window.top.mapboxgl;
    } catch (error) {
        return false;
    }
    return typeof gl?.addTileProvider === 'function';
}

function register() {
    if (registered) return;
    window.mapboxgl.addTileProvider(PROVIDER, PROVIDER_URL);
    registered = true;
}

const stripKey = (tile) => tile.replace(FRAGMENT, '');

/** A raster source's spec, drawn through the pixel provider when the layer has a key or recolor. */
export function withColorKey(sourceConfig, config) {
    const fragment = pixelFragment(config);
    if (!fragment || !Array.isArray(sourceConfig.tiles) || sourceConfig.provider || !canColorKey(config)) return sourceConfig;
    register();
    return { ...sourceConfig, provider: PROVIDER, tiles: sourceConfig.tiles.map(tile => stripKey(tile) + fragment) };
}

/** Apply (or clear) a layer's colorKey and recolor on its live raster source, reloading its tiles. */
export function setPixelEdits(source, config) {
    const options = source?._options;
    if (!options || !Array.isArray(options.tiles) || typeof source.setTiles !== 'function') return false;
    if (options.provider && options.provider !== PROVIDER) return false;
    const fragment = pixelFragment(config);
    if (fragment) register();
    options.provider = fragment ? PROVIDER : undefined;
    source.setTiles(options.tiles.map(tile => stripKey(tile) + fragment));
    return true;
}

/**
 * Dynamic Layer Shorthand — expands compact `type:id` references from the
 * `?layers=` URL API into full layer configs by hitting the matching
 * service's URL API module.
 *
 * Supported shorthand forms (see docs/API.md → "Dynamic Layer Shortcuts"):
 *   allmaps:bca064e512c963f0
 *   mapwarper:108838
 *   osm:relation/21057460
 *   stac:<url-encoded STAC Item or stac-map viewer URL>
 *   route:mapbox-driving-traffic(73.81/15.49|73.83/15.51)
 *   route:osrm-driving(73.81/15.49|73.83/15.51)
 *
 * The equivalent `{"type":"...","id":"..."}` object form is still accepted
 * on read (and is what opacity gets embedded into on write, since the plain
 * string form has nowhere to carry extra properties — see url-manager.js's
 * layerToURL).
 *
 * Each service's actual API calls live in its own module (allmaps-url-api.js,
 * mapwarper-url-api.js, osm-url-api.js, route-url-api.js) — this file dispatches to them via
 * js/layer-source-resolver.js's DYNAMIC_SHORTHAND_PROVIDERS table, the same
 * one map-creator.js's "Add Layer" URL box resolves full URLs through, so
 * adding a new service means adding one entry there plus its own module.
 */

import { DYNAMIC_SHORTHAND_PROVIDERS } from './layer-source-resolver.js';
import { OSMApi } from './osm-url-api.js';

const SHORTHAND_TYPES = new Set(['allmaps', 'mapwarper', 'osm', 'stac', 'route']);
const SHORTHAND_STRING_RE = /^(allmaps|mapwarper|osm|stac|route):(.+)$/;

/**
 * Parses the compact `type:id` string form (e.g. "osm:relation/21057460")
 * into a `{type, id}` object, or returns null if `str` isn't a recognized
 * shorthand string (including plain layer IDs, which must fall through
 * unchanged).
 */
export function parseDynamicLayerShorthandString(str) {
    if (typeof str !== 'string') return null;
    const match = str.match(SHORTHAND_STRING_RE);
    if (!match) return null;
    return { type: match[1], id: match[2] };
}

export function isDynamicLayerShorthand(layerConfig) {
    return !!layerConfig && typeof layerConfig === 'object' &&
        SHORTHAND_TYPES.has(layerConfig.type) && !!layerConfig.id;
}

/**
 * Resolves a shorthand layerConfig into a full layer config, or null on
 * failure (caller should drop the layer and warn, same as an unknown
 * registry ID). The returned config replaces the shorthand entirely — only
 * `_originalJson`/`initiallyChecked`/`opacity` should be carried over by the
 * caller, mirroring how registry-resolved layers are merged in map-init.js.
 */
export async function expandDynamicLayerShorthand(layerConfig) {
    const { type, id } = layerConfig;

    try {
        const provider = DYNAMIC_SHORTHAND_PROVIDERS[type];
        if (!provider) return null;

        return await provider.resolveFromId(id);
    } catch (error) {
        console.warn(`[Dynamic Layer] Failed to resolve "${type}:${id}":`, error);
        return null;
    }
}

/**
 * Pre-resolves every "osm:" shorthand layer in `layerConfigs` with a single
 * combined Overpass request instead of one request per layer — Overpass
 * aggressively rate-limits/times out when hit with several requests back to
 * back (e.g. `?layers=osm:relation/1,osm:relation/2,...`).
 *
 * Returns a Map keyed by the original layerConfig object references (not
 * copies) to their expanded config, or null if that ref failed to resolve.
 * Only entries this function actually batched are present in the map —
 * callers should fall back to expandDynamicLayerShorthand() for anything
 * missing (a lone osm: entry, or allmaps:/mapwarper: entries), and for the
 * whole thing if the combined request itself fails.
 */
export async function resolveDynamicLayerShorthands(layerConfigs) {
    const results = new Map();

    const osmRefs = layerConfigs
        .filter(layerConfig => isDynamicLayerShorthand(layerConfig) && layerConfig.type === 'osm')
        .map(layerConfig => ({ layerConfig, ref: OSMApi.extractRef(layerConfig.id) }))
        .filter(({ ref }) => !!ref);

    if (osmRefs.length < 2) return results;

    try {
        const configs = await OSMApi.createConfigsFromRefs(osmRefs.map(({ ref }) => ref));
        osmRefs.forEach(({ layerConfig, ref }) => {
            const entry = configs.get(`${ref.type}/${ref.id}`);
            if (entry instanceof Error) {
                console.warn(`[Dynamic Layer] Failed to resolve "osm:${layerConfig.id}":`, entry);
                results.set(layerConfig, null);
            } else {
                results.set(layerConfig, entry);
            }
        });
    } catch (error) {
        console.warn('[Dynamic Layer] Combined Overpass request failed, falling back to individual requests:', error);
    }

    return results;
}

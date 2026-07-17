/**
 * Dynamic Layer Shorthand — expands compact `type:id` references from the
 * `?layers=` URL API into full layer configs by hitting the matching
 * service's URL API module.
 *
 * Supported shorthand forms (see docs/API.md → "Dynamic Layer Shortcuts"):
 *   allmaps:bca064e512c963f0
 *   mapwarper:108838
 *   osm:relation/21057460
 *
 * The equivalent `{"type":"...","id":"..."}` object form is still accepted
 * on read (and is what opacity gets embedded into on write, since the plain
 * string form has nowhere to carry extra properties — see url-manager.js's
 * layerToURL).
 *
 * Each service's actual API calls live in its own module (allmaps-url-api.js,
 * mapwarper-url-api.js, osm-url-api.js) — this file only dispatches to them,
 * so adding a new service means adding one `case` here plus its own module.
 */

import { AllmapsAPI } from './allmaps-url-api.js';
import { MapWarperAPI } from './mapwarper-url-api.js';
import { OSMApi } from './osm-url-api.js';

const SHORTHAND_TYPES = new Set(['allmaps', 'mapwarper', 'osm']);
const SHORTHAND_STRING_RE = /^(allmaps|mapwarper|osm):(.+)$/;

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
        let expanded;
        switch (type) {
            case 'allmaps':
                expanded = await AllmapsAPI.createConfigFromId(id);
                break;
            case 'mapwarper':
                expanded = await MapWarperAPI.createConfigFromId(id);
                break;
            case 'osm':
                expanded = await OSMApi.createConfigFromRef(id);
                break;
            default:
                return null;
        }

        return expanded;
    } catch (error) {
        console.warn(`[Dynamic Layer] Failed to resolve "${type}:${id}":`, error);
        return null;
    }
}

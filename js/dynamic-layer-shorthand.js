/**
 * Dynamic Layer Shorthand — expands compact `{type, id}` references from the
 * `?layers=` URL API into full layer configs by hitting the matching
 * service's URL API module.
 *
 * Supported shorthand forms (see docs/API.md → "Dynamic Layer Shortcuts"):
 *   {"type":"allmaps","id":"bca064e512c963f0"}
 *   {"type":"mapwarper","id":"108838"}
 *   {"type":"osm","id":"relation/21057460"}
 *
 * Each service's actual API calls live in its own module (allmaps-url-api.js,
 * mapwarper-url-api.js, osm-url-api.js) — this file only dispatches to them,
 * so adding a new service means adding one `case` here plus its own module.
 */

import { AllmapsAPI } from './allmaps-url-api.js';
import { MapWarperAPI } from './mapwarper-url-api.js';
import { OSMApi } from './osm-url-api.js';

const SHORTHAND_TYPES = new Set(['allmaps', 'mapwarper', 'osm']);

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
        console.warn(`[Dynamic Layer] Failed to resolve {type:"${type}", id:"${id}"}:`, error);
        return null;
    }
}

/**
 * What a map row in the console's lists says about it: its path (atlas / tag
 * / tag) after the title, and its attribution on the line below. The same
 * whether the map is on or off - a row turned off is only dimmed - so the
 * atlas a map came from is remembered by its id for when it returns from the
 * registry without one.
 */
import { parseAttribution } from '../attribution.js';

const atlasOf = new Map();

function atlasName(atlasId) {
    return window.layerRegistry?.getAtlasMetadata?.(atlasId)?.name || atlasId;
}

export function layerPath(layer, fallbackAtlas = window.layerRegistry?.getCurrentAtlas?.()) {
    if (layer._sourceAtlas) atlasOf.set(layer.id, layer._sourceAtlas);
    const atlasId = layer._sourceAtlas || atlasOf.get(layer.id) || fallbackAtlas;
    return {
        path: [atlasId && atlasName(atlasId), ...(Array.isArray(layer.tags) ? layer.tags : [])].filter(Boolean).join(' / '),
        attribution: parseAttribution(layer.attribution).parts.map(part => part.text).join(', ')
    };
}

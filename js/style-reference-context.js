/**
 * What style references (js/style-references.js) resolve against, installed on
 * the map page as `window.styleRefContext`: the active atlas's `constants`, and
 * the style of any layer in it. Also lists the candidates the style editor
 * offers when linking a colour to something else.
 */

function activeGroups(win) {
    return win.layerControl?._state?.groups || [];
}

export function createStyleReferenceContext(win = window) {
    const registry = () => win.layerRegistry;

    const atlasId = () => registry()?.getCurrentAtlas?.() || 'index';

    const getConstants = (forAtlas) => {
        const meta = registry()?.getAtlasMetadata?.(forAtlas || atlasId());
        return (meta && meta.constants) || {};
    };

    const getLayerStyle = (layerId) => {
        const group = activeGroups(win).find(g => g.id === layerId || g._prefixedId === layerId);
        if (group && group.style) return group.style;
        const entry = registry()?.getLayer?.(layerId, null, true);
        return entry && entry.style ? entry.style : null;
    };

    const listLayers = () => {
        const byId = new Map();
        activeGroups(win).forEach(group => {
            if (group.id && group.style && group.id !== 'selection') byId.set(group.id, { id: group.id, title: group.title || group.id, style: group.style });
        });
        (registry()?.getAtlasLayers?.(atlasId()) || []).forEach(layer => {
            if (layer.id && layer.style && !byId.has(layer.id)) byId.set(layer.id, { id: layer.id, title: layer.title || layer.id, style: layer.style });
        });
        return [...byId.values()];
    };

    return { getConstants, getLayerStyle, listLayers };
}

export function installStyleReferenceContext(win = window) {
    win.styleRefContext = createStyleReferenceContext(win);
}

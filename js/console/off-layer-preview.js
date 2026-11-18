/**
 * A map that is off, shown on the map while its row in the On the map list
 * (js/layer-stack-strip.js) is hovered: its layers are added (or unhidden)
 * straight through mapbox-api, leaving the layer control, the URL and the
 * list as they are, and hidden again when the hover ends. The strip isolates
 * it the same as a map that is on.
 */
import { pendingState } from './layer-loading.js';

let shown = null;
let token = 0;

function groupFor(layer) {
    const groups = window.layerControl?._state?.groups || [];
    const group = groups.find(g => g.id === layer.id || g._prefixedId === layer.id);
    const registered = window.layerRegistry?.getLayer?.(layer.id) || null;
    return { ...(registered || {}), ...layer, ...(group || {}) };
}

/**
 * Show an off map for the hover.
 * @returns {Promise<string|null>} the map's group id once it is on the map, null if it was not shown
 */
export async function showOffLayer(layer) {
    hideOffLayer();
    const api = window.layerControl?._mapboxAPI;
    const config = groupFor(layer);
    if (!api || !config.type) return null;
    const mine = ++token;
    const id = config.id;
    shown = { id, config };
    if (api.hasLayerGroup(id, config)) {
        api.updateLayerGroupVisibility(id, config, true);
    } else {
        await api.createLayerGroup(id, config, { visible: true });
        if (config.opacity !== undefined && config.opacity !== 1) api.updateLayerOpacity(id, config, 1);
    }
    // Left (or moved on to another row) while it was being added
    if (mine !== token) {
        if (shown?.id !== id) putAway(id, config);
        return null;
    }
    return id;
}

/** Put the hovered off map away again - unless it has since been switched on. */
export function hideOffLayer() {
    token++;
    if (!shown) return;
    const { id, config } = shown;
    shown = null;
    putAway(id, config);
}

function putAway(id, config) {
    if (pendingState(config) === true || window.layerControl?.isolation?._getToggledOnLayers().has(id)) return;
    window.layerControl?._mapboxAPI?.updateLayerGroupVisibility(id, config, false);
}

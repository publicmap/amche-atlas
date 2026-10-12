/**
 * Feature property samples for a layer already on the map, used by the style
 * editor (js/symbology-editor.js) to list a field's categories and compute
 * numeric class breaks.
 *
 * Reads what the map has loaded (`querySourceFeatures`), so it reflects the
 * data in the loaded tiles rather than the whole dataset: for a vector-tile or
 * large GeoJSON layer that is the area being viewed.
 */

const DEFAULT_LIMIT = 5000;

/**
 * @param {Object} map - Mapbox GL map
 * @param {string[]} mapLayerIds - Style layer ids the layer group owns
 * @param {number} [limit] - Maximum properties objects returned
 * @returns {Object[]} One properties object per feature
 */
export function sampleMapLayerProperties(map, mapLayerIds, limit = DEFAULT_LIMIT) {
    const sources = new Map();
    mapLayerIds.forEach(id => {
        const layer = map.getLayer(id);
        if (!layer || !layer.source) return;
        const sourceLayer = layer.sourceLayer || '';
        sources.set(`${layer.source}\u0000${sourceLayer}`, { source: layer.source, sourceLayer });
    });

    const samples = [];
    for (const { source, sourceLayer } of sources.values()) {
        let features = [];
        try {
            features = map.querySourceFeatures(source, sourceLayer ? { sourceLayer } : undefined);
        } catch (error) {
            continue;
        }
        for (const feature of features) {
            if (feature.properties) samples.push(feature.properties);
            if (samples.length >= limit) return samples;
        }
    }
    return samples;
}

/**
 * The properties of every feature currently loaded for a layer group, as
 * `window.sampleLayerProperties(layerId, config)` for the embedded creator and
 * layer-info panels to call on their parent.
 */
export function installLayerSampler(win = window) {
    win.sampleLayerProperties = (layerId, config) => {
        const api = win.layerControl?._mapboxAPI;
        const map = win.map;
        if (!api || !map || !layerId) return [];
        try {
            return sampleMapLayerProperties(map, api.getLayerGroupIds(layerId, config || {}));
        } catch (error) {
            console.warn('[LayerSampler] Failed to sample layer', layerId, error);
            return [];
        }
    };
}

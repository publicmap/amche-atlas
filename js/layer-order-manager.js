/**
 * Handles the default ordering of different map layers based on their types and properties.
 */

export class LayerOrderManager {
    /**
     * Define the order of different layer types (higher order = rendered later = appears on top)
     */
    static LAYER_TYPE_ORDER = {
        'terrain': 1,
        'style': 10,
        'tms': 15,
        'wms': 15,
        'wmts': 15,
        'vector': 20,
        'csv': 40,
        'geojson': 50,
        'img': 60,
        'markers': 70,
        'layer-group': 80
    };

    /**
     * Define specific layer ID ordering overrides
     */
    static LAYER_ID_ORDER = {
        'osm': 14,
        'mask': 200
    };

    /**
     * Determines which slot to use for a layer based on its type
     * @param {string} type - Layer type
     * @param {string|null} layerType - Specific layer type
     * @returns {string} - Slot name ('bottom', 'middle', 'top')
     */
    static getSlotForLayerType(type, layerType) {
        const rasterTypes = ['tms', 'wmts', 'wms', 'img', 'raster-style-layer'];
        if (rasterTypes.includes(type)) {
            return 'bottom';
        }

        const vectorTypes = ['vector', 'geojson', 'csv', 'markers'];
        if (vectorTypes.includes(type)) {
            return 'middle';
        }

        return 'middle';
    }

    /**
     * Calculates the rendering position for a new layer using slot-based insertion
     * @param {Object} map - Mapbox map instance
     * @param {string} type - Layer type
     * @param {string|null} layerType - Specific layer type
     * @param {Object} currentGroup - Current layer group being processed
     * @param {Array} orderedGroups - All layer groups in their defined order
     * @returns {string|null} - The slot name to insert into
     */
    static getInsertPosition(map, type, layerType, currentGroup, orderedGroups) {
        return this.getSlotForLayerType(type, layerType);
    }

    /**
     * Shows the current layer stack order from bottom to top for debugging
     * @param {Object} map - Mapbox map instance
     * @param {string} label - Debug label
     */
    static logLayerStack(map, label = '') {
        if (!map) return;

        const layers = map.getStyle().layers;
        const layerStack = layers
            .filter(l => l.metadata?.groupId)
            .map((l, index) => `${index}: ${l.metadata.groupId} (${l.metadata.layerType})`);

        console.log(`[LayerOrder] ${label} - Layer stack (bottom to top):`, layerStack);
    }

    /**
     * Fixes the layer ordering for specific layers that need to be in a certain order
     * @param {Object} map - Mapbox map instance
     */
    static fixLayerOrdering(map) {
        if (!map) return;
    }
}

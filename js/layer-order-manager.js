/**
 * Centralized layer ordering logic for the map application
 *
 * Core Principles:
 * - URL order: [layer1, layer2, layer3] where layer1 is visually on top
 * - Map render order: [layer3, layer2, layer1] where layer3 is added first (at bottom)
 * - Basemap grouping: Basemaps always added before overlays (at the bottom of the stack)
 *
 * URL Structure: ?layers=overlay1,overlay2,basemap1,basemap2
 * Map Rendering: basemap1 → basemap2 → overlay1 → overlay2 (bottom to top)
 * Visual Result: overlay2 on top, basemap1 at bottom
 */

export class LayerOrderManager {
    /**
     * Check if a layer is a basemap
     * @param {Object} layer - Layer configuration
     * @returns {boolean} - True if layer is a basemap
     */
    static isBasemap(layer) {
        return layer && layer.tags && Array.isArray(layer.tags) && layer.tags.includes('basemap');
    }

    /**
     * Convert URL layer order to map rendering order
     * URL order: [overlay1, overlay2, basemap1, basemap2] (overlay1 visually on top)
     * Map order: [basemap2, basemap1, overlay2, overlay1] (reversed - last added = on top)
     *
     * Mapbox GL JS renders layers added FIRST at BOTTOM, layers added LAST on TOP
     * So to get overlay1 on top, we must add it LAST (reverse the order)
     *
     * @param {Array} urlLayers - Layers in URL order (first = on top)
     * @returns {Array} - Layers in map rendering order (reversed within groups, basemaps first)
     */
    static urlOrderToMapOrder(urlLayers) {
        if (!urlLayers || urlLayers.length === 0) {
            return [];
        }

        // Separate overlays and basemaps
        const overlays = [];
        const basemaps = [];

        urlLayers.forEach(layer => {
            if (this.isBasemap(layer)) {
                basemaps.push(layer);
            } else {
                overlays.push(layer);
            }
        });

        // Reverse both groups: URL first = on top visually, so must be added LAST
        const reversedBasemaps = basemaps.reverse();
        const reversedOverlays = overlays.reverse();

        // Combine: basemaps first (bottom slot), then overlays (middle slot)
        const mapOrder = [...reversedBasemaps, ...reversedOverlays];

        return mapOrder;
    }

    /**
     * Convert map layer order to URL order
     * Layers from getCurrentActiveLayers() are in MAP RENDERING order (first added = first in array)
     * URL order: [overlay1, overlay2, basemap1, basemap2] (overlay1 visually on top)
     *
     * Since Mapbox adds layers with "last added = on top", we need to reverse
     * to convert from rendering order to visual order for URL
     *
     * @param {Array} mapLayers - Layers in map rendering order (order they were added)
     * @returns {Array} - Layers in URL order (overlays first, then basemaps, reversed within groups)
     */
    static mapOrderToUrlOrder(mapLayers) {
        if (!mapLayers || mapLayers.length === 0) {
            return [];
        }

        // Separate overlays and basemaps
        const overlays = [];
        const basemaps = [];

        mapLayers.forEach(layer => {
            if (this.isBasemap(layer)) {
                basemaps.push(layer);
            } else {
                overlays.push(layer);
            }
        });

        // Reverse both groups: map first = added first = at bottom, so reverse to get visual order
        const reversedOverlays = overlays.reverse();
        const reversedBasemaps = basemaps.reverse();

        // Combine: overlays first (on top visually), then basemaps (at bottom)
        const urlOrder = [...reversedOverlays, ...reversedBasemaps];

        return urlOrder;
    }

    /**
     * Get layers in inspector display order (same as URL order for visual consistency)
     * The inspector shows layers in the same order as they appear in the URL,
     * which matches the visual stack on the map (first = on top)
     *
     * @param {Array} urlLayers - Layers in URL order
     * @returns {Object} - { overlays: Array, basemaps: Array }
     */
    static getInspectorDisplayOrder(urlLayers) {
        if (!urlLayers || urlLayers.length === 0) {
            return { overlays: [], basemaps: [] };
        }

        const overlays = [];
        const basemaps = [];

        // Keep URL order (first = on top in both URL and inspector)
        urlLayers.forEach(layer => {
            if (this.isBasemap(layer)) {
                basemaps.push(layer);
            } else {
                overlays.push(layer);
            }
        });

        return { overlays, basemaps };
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
        if (['tms', 'wmts', 'wms', 'img', 'raster-style-layer'].includes(type)) {
            return 'bottom';
        }

        if (['vector', 'geojson', 'csv'].includes(type)) {
            return 'middle';
        }

        return 'middle';
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
    }
}

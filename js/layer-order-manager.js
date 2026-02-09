/**
 * Centralized layer ordering logic for the map application
 *
 * Core Principles:
 * - URL order: [layer1, layer2, layer3] where layer1 is visually on top (first = top)
 * - Map render order: Layers are added in REVERSE of URL order (last to first)
 * - Mapbox rendering: Last layer added appears on top
 * - Basemap grouping: Basemaps always added before overlays (at the bottom of the stack)
 *
 * Example:
 * URL Structure: ?layers=overlay1,overlay2,basemap1,basemap2
 * Map Rendering Order (added): basemap2 → basemap1 → overlay2 → overlay1
 * Visual Stack (top to bottom): overlay1, overlay2, basemap1, basemap2
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
     * Map order: [basemap2, basemap1, overlay2, overlay1] (all reversed within groups)
     *
     * Mapbox GL JS renders layers added FIRST at BOTTOM, layers added LAST on TOP
     * To achieve the visual order where first in URL = on top, we reverse BOTH groups
     *
     * @param {Array} urlLayers - Layers in URL order (first = on top visually)
     * @returns {Array} - Layers in map rendering order (reversed, basemaps first)
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

        // Reverse BOTH groups: URL first = on top visually, so must be added LAST
        const reversedBasemaps = basemaps.reverse();
        const reversedOverlays = overlays.reverse();

        // Combine: basemaps first (bottom slot), then overlays (middle slot)
        const mapOrder = [...reversedBasemaps, ...reversedOverlays];

        return mapOrder;
    }

    /**
     * Convert map layer order to URL order
     * Layers from getCurrentActiveLayers() are in CONFIG/VISUAL order (not rendering order)
     * The layer control maintains layers in the order they should appear in the URL
     *
     * @param {Array} mapLayers - Layers in config/visual order (same as URL order)
     * @returns {Array} - Layers in URL order (overlays first, then basemaps, no reversal)
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

        // NO reversal: layers are already in the correct URL/visual order
        // Combine: overlays first (on top visually), then basemaps (at bottom)
        const urlOrder = [...overlays, ...basemaps];

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

    /**
     * Verifies that map layer order is the reverse of URL layer order
     * When using slots, checks the visual rendering order within each slot
     * @param {Object} map - Mapbox map instance
     * @param {Array} urlLayers - Layers in URL order (first = on top)
     * @returns {Object} - Verification result with details
     */
    static verifyLayerOrder(map, urlLayers) {
        if (!map || !urlLayers || urlLayers.length === 0) {
            return { valid: false, error: 'Invalid inputs' };
        }

        const styleLayers = map.getStyle().layers;
        const userLayerIds = urlLayers.map(l => l.id || l);

        const bottomSlotLayers = [];
        const middleSlotLayers = [];
        const topSlotLayers = [];

        styleLayers.forEach(layer => {
            const groupId = layer.metadata?.groupId;
            if (groupId && userLayerIds.includes(groupId)) {
                const slot = layer.slot || 'middle';
                if (slot === 'bottom' && !bottomSlotLayers.includes(groupId)) {
                    bottomSlotLayers.push(groupId);
                } else if (slot === 'middle' && !middleSlotLayers.includes(groupId)) {
                    middleSlotLayers.push(groupId);
                } else if (slot === 'top' && !topSlotLayers.includes(groupId)) {
                    topSlotLayers.push(groupId);
                }
            }
        });

        const visualOrder = [...bottomSlotLayers, ...middleSlotLayers, ...topSlotLayers];
        const expectedOrder = [...userLayerIds].reverse();
        const matches = visualOrder.length === expectedOrder.length &&
                       visualOrder.every((id, i) => id === expectedOrder[i]);

        return {
            valid: matches,
            urlOrder: userLayerIds,
            visualOrder: visualOrder,
            expectedOrder: expectedOrder,
            slots: {
                bottom: bottomSlotLayers,
                middle: middleSlotLayers,
                top: topSlotLayers
            },
            message: matches
                ? '✅ Layer order is correct (visual order is reverse of URL)'
                : '❌ Layer order mismatch'
        };
    }
}

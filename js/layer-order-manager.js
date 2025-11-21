/**
 * Handles the default ordering of different map layers based on their types and properties
 * IMPORTANT: Map Layer Rendering Order Logic
 *
 *  ========================================
 *  In Mapbox GL JS, layers are rendered in the order they appear in the style -
 *  layers added later appear ABOVE layers added earlier. This creates a visual stacking effect.
 *
 *  Config Order vs Visual Order:
 *  - Config order: weather-satellite (1st), modis-terra-truecolor (2nd), viirs-night-lights (3rd)
 *  - Visual result: weather-satellite (top), modis-terra-truecolor (middle), viirs-night-lights (bottom)
 *
 *  The getInsertPosition() function determines WHERE in the existing layer stack to insert each new layer.
 *  For same-type layers, we want layers defined first in the config to appear visually ABOVE later ones.
 *
 *  Define the order of different layer types (higher order = rendered later = appears on top)
 */
const LAYER_TYPE_ORDER = {
    'terrain': 1,
    'style': 10,
    'tms': 15,      // TMS raster layers should appear below vector layers
    'wms': 15,      // WMS raster layers should appear below vector layers  
    'wmts': 15,     // WMTS raster layers should appear below vector layers
    'vector': 20,
    'csv': 40,
    'geojson': 50,
    'img': 60,
    'markers': 70,
    'layer-group': 80
};

// Define specific layer ID ordering overrides
const LAYER_ID_ORDER = {
    'osm': 14,  // OSM should appear below other TMS layers
    'mask': 200 // Mask should appear on top of everything
};

/**
 * Determines which slot to use for a layer based on its type
 * @param {string} type - Layer type (tms, wmts, wms, vector, geojson, etc.)
 * @param {string|null} layerType - Specific layer type (for vector layers: fill, line, circle, symbol)
 * @returns {string} - Slot name ('bottom', 'middle', 'top')
 */
function getSlotForLayerType(type, layerType) {
    // Raster layers (TMS, WMTS, WMS, img) go to bottom slot
    const rasterTypes = ['tms', 'wmts', 'wms', 'img', 'raster-style-layer'];
    if (rasterTypes.includes(type)) {
        return 'bottom';
    }

    // Vector layers (vector, geojson, csv) go to middle slot
    const vectorTypes = ['vector', 'geojson', 'csv', 'markers'];
    if (vectorTypes.includes(type)) {
        return 'middle';
    }

    // Default to middle for unknown types
    return 'middle';
}

/**
 * Calculates the rendering position for a new layer using slot-based insertion
 * @param {Object} map - Mapbox map instance
 * @param {string} type - Layer type
 * @param {string|null} layerType - Specific layer type
 * @param {Object} currentGroup - Current layer group being processed
 * @param {Array} orderedGroups - All layer groups in their defined order
 * @returns {string|null} - The slot name to insert into ('bottom', 'middle', 'top'), or null for default
 */
function getInsertPosition(map, type, layerType, currentGroup, orderedGroups) {
    // Use slot-based insertion instead of layer ID-based insertion
    // This ensures proper layer ordering: rasters at bottom, vectors in middle
    const slot = getSlotForLayerType(type, layerType);

    // Return the slot name - Mapbox will handle insertion into the correct slot
    return slot;

    // Legacy layer ID-based insertion code below (kept for reference but not executed)
    // ==================================================================================
    const layers = map.getStyle().layers;

    // Try to extract URL parameter order from the current URL
    const urlParams = new URLSearchParams(window.location.search);
    const urlLayersParam = urlParams.get('layers');
    let urlLayerOrder = [];
    if (urlLayersParam) {
        urlLayerOrder = urlLayersParam.split(',').map(id => id.trim());
    }


    // Find current layer's index in the configuration
    const currentGroupIndex = orderedGroups.findIndex(group =>
        group.id === currentGroup?.id
    );


    // Get the order value for the current layer type
    // For vector layers, use the main type ('vector') not the sublayer type ('fill', 'line', etc.)
    const lookupType = (type === 'vector') ? type : (layerType || type);
    const currentTypeOrder = LAYER_TYPE_ORDER[lookupType] || Infinity;

    // Special case for layer ID-specific ordering
    const currentIdOrder = currentGroup && LAYER_ID_ORDER[currentGroup.id];
    const orderValue = currentIdOrder !== undefined ? currentIdOrder : currentTypeOrder;


    // For all other cases, go through layers in reverse to find insertion point
    for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];

        // Skip layers that don't have metadata (likely base layers)
        if (!layer.metadata || !layer.metadata.groupId) {
            // For layers without metadata, try to match by ID instead
            if (LAYER_ID_ORDER[layer.id] !== undefined && currentGroup) {
                // Compare using ID ordering directly
                const layerIdOrder = LAYER_ID_ORDER[layer.id];
                if (layerIdOrder < orderValue) {
                    return layers[i + 1]?.id;
                }
            }
            continue;
        }

        const groupId = layer.metadata.groupId;
        const layerGroupIndex = orderedGroups.findIndex(g => g.id === groupId);

        // Use explicit layer ID ordering if available
        const layerIdOrder = LAYER_ID_ORDER[groupId];

        // Get order value based on type or ID override
        // For vector layers, always use 'vector' as the lookup type regardless of sublayer type
        const existingLayerLookupType = layer.metadata.layerType === 'fill' ||
        layer.metadata.layerType === 'line' ||
        layer.metadata.layerType === 'circle' ||
        layer.metadata.layerType === 'symbol'
            ? 'vector'
            : layer.metadata.layerType;
        const thisLayerOrderValue = layerIdOrder !== undefined
            ? layerIdOrder
            : LAYER_TYPE_ORDER[existingLayerLookupType] || 0;

        // If this layer should be rendered before our new layer
        // Check if we're dealing with URL-specified layers by seeing if there are custom layers already loaded
        const customLayersAlreadyLoaded = layers.filter(l => l.metadata?.groupId);
        const isUrlBasedOrdering = urlLayerOrder.length > 0;

        if (isUrlBasedOrdering && customLayersAlreadyLoaded.length > 0) {
            // For URL-based ordering, find the correct position based on URL parameter sequence
            const currentLayerId = currentGroup?.id;
            const currentUrlIndex = urlLayerOrder.indexOf(currentLayerId);

            if (currentUrlIndex !== -1) {
                // For URL parameter order like "A,B,C,D":
                // A should be on top, B below A, C below B, D at bottom
                // When adding any layer, find the first already-loaded layer and insert before it
                // This puts each new layer at the bottom of the stack

                // Find ANY earlier layer in the URL sequence to insert before
                const firstExistingLayer = customLayersAlreadyLoaded[0]; // Get the first (bottommost) layer
                if (firstExistingLayer && currentUrlIndex > 0) {
                    return firstExistingLayer.id;
                }
            }
            break; // Exit the loop to append to end
        } else {
            // Use type-based ordering (prioritize type order over configuration order)
            if (thisLayerOrderValue < orderValue) {
                // Find the FIRST layer of this group (go backwards to find the start of the group)
                let firstLayerOfGroup = i;
                while (firstLayerOfGroup > 0 && layers[firstLayerOfGroup - 1].metadata?.groupId === groupId) {
                    firstLayerOfGroup--;
                }

                return layers[firstLayerOfGroup].id;
            }
        }
    }

    // Fallback: look for specific layer IDs to insert before based on type
    if (type === 'vector' || type === 'geojson') {
        // Insert vector/geojson layers before labels
        const labelsLayers = layers.filter(layer =>
                layer.type === 'symbol' && (
                    layer.id.includes('label') ||
                    layer.id.includes('place-') ||
                    layer.id.includes('-name') ||
                    layer.id === 'poi-label'
                )
        );

        if (labelsLayers.length > 0) {
            return labelsLayers[0].id;
        }
    }

    // If no position found, append to the end
    return null;
}

/**
 * Shows the current layer stack order from bottom to top for debugging
 * @param {Object} map - Mapbox map instance
 */
function logLayerStack(map, label = '') {
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
function fixLayerOrdering(map) {
    if (!map) {
        return;
    }
}

// Export the functions so they can be called from elsewhere
export {getInsertPosition, getSlotForLayerType, LAYER_TYPE_ORDER, LAYER_ID_ORDER, fixLayerOrdering, logLayerStack};
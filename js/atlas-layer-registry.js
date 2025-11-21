/**
 * Atlas Layer Registry - Central source of truth for all atlas layers
 * Handles cross-atlas layer management and ID normalization
 */

export class LayerRegistry {
    constructor() {
        this._registry = new Map(); // layerId -> layer config
        this._libraryLayers = new Map(); // library layer presets
        this._atlasLayers = new Map(); // atlasId -> array of layer configs
        this._atlasMetadata = new Map(); // atlasId -> atlas metadata (color, name, etc.)
        this._currentAtlas = 'index'; // default atlas
        this._initialized = false;
    }

    async initialize() {
        if (this._initialized) return;

        // Load layer library first
        try {
            const libraryResponse = await fetch('/config/_map-layer-presets.json');
            if (libraryResponse.ok) {
                const library = await libraryResponse.json();
                if (library.layers && Array.isArray(library.layers)) {
                    library.layers.forEach(layer => {
                        this._libraryLayers.set(layer.id, layer);
                    });
                }
            }
        } catch (error) {
            console.warn('[LayerRegistry] Failed to load layer library:', error);
        }

        // Load all atlas configurations
        // First, load the index.atlas.json to get the list of atlases
        let atlasConfigs = [];
        try {
            const indexResponse = await fetch(window.amche.DEFAULT_ATLAS);
            if (indexResponse.ok) {
                const indexConfig = await indexResponse.json();
                if (indexConfig.atlases && Array.isArray(indexConfig.atlases)) {
                    atlasConfigs = indexConfig.atlases;
                }
            }
        } catch (error) {
            console.warn('[LayerRegistry] Failed to load atlas list from index.atlas.json:', error);
            // Fallback to default list if loading fails
            atlasConfigs = [
                'osm', 'index', 'goa', 'mumbai', 'bombay', 'madras',
                'gurugram', 'maharashtra', 'telangana', 'kerala', 'india',
                'world', 'historic', 'community', 'mhadei', 'mapbox'
            ];
        }

        // Create a Set for fast lookup of known atlas IDs
        const knownAtlases = new Set(atlasConfigs);

        // Load all atlas configurations in parallel
        const atlasPromises = atlasConfigs.map(async (atlasId) => {
            try {
                const response = await fetch(`/config/${atlasId}.atlas.json`);
                if (response.ok) {
                    // Check Content-Type to ensure we're getting JSON, not HTML (e.g., 404 page)
                    const contentType = response.headers.get('content-type') || '';
                    if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
                        return {
                            atlasId,
                            error: `Invalid content type: ${contentType} (expected JSON)`,
                            success: false
                        };
                    }
                    
                    const config = await response.json();
                    return {atlasId, config, success: true};
                } else {
                    return {atlasId, error: `HTTP ${response.status}`, success: false};
                }
            } catch (error) {
                // Handle JSON parsing errors specifically
                if (error.message.includes('JSON') || error.message.includes('DOCTYPE')) {
                    return {
                        atlasId,
                        error: `Invalid JSON response (likely HTML/404 page)`,
                        success: false
                    };
                }
                return {atlasId, error: error.message, success: false};
            }
        });

        // Wait for all atlas fetches to complete (whether successful or not)
        const atlasResults = await Promise.allSettled(atlasPromises);

        // Process all successfully loaded atlas configurations
        for (const result of atlasResults) {
            if (result.status === 'fulfilled' && result.value.success) {
                const {atlasId, config} = result.value;

                // Store atlas metadata (color, name, etc.)
                this._atlasMetadata.set(atlasId, {
                    color: config.color || '#2563eb', // Default to blue if not specified
                    name: config.name || atlasId,
                    areaOfInterest: config.areaOfInterest || ''
                });

                if (config.layers && Array.isArray(config.layers)) {
                    this._atlasLayers.set(atlasId, config.layers);

                    // Register each layer with appropriate ID
                    config.layers.forEach(layer => {
                        const resolvedLayer = this._resolveLayer(layer, atlasId);
                        if (resolvedLayer) {
                            // Check if the layer ID already has an atlas prefix
                            const layerId = resolvedLayer.id;
                            let prefixedId;
                            let sourceAtlas = atlasId; // Default to current atlas

                            // If the ID already contains a dash and might be prefixed, check if it's a valid atlas prefix
                            if (layerId.includes('-')) {
                                const potentialPrefix = layerId.split('-')[0];
                                // If it's a known atlas prefix, use the ID as-is (it's already prefixed)
                                if (knownAtlases.has(potentialPrefix)) {
                                    prefixedId = layerId;
                                    // The source atlas should be the prefix, not the current atlas
                                    sourceAtlas = potentialPrefix;
                                } else {
                                    // Not a valid prefix, add the atlas prefix
                                    prefixedId = `${atlasId}-${layerId}`;
                                }
                            } else {
                                // No dash, definitely not prefixed
                                prefixedId = `${atlasId}-${layerId}`;
                            }

                            // Check if layer is already in registry
                            const existingEntry = this._registry.get(prefixedId);

                            if (!existingEntry) {
                                // Not in registry yet, add it
                                this._registry.set(prefixedId, {
                                    ...resolvedLayer,
                                    _sourceAtlas: sourceAtlas,
                                    _prefixedId: prefixedId,
                                    // Store the original unprefixed ID for reference
                                    _originalId: layerId
                                });
                            } else if (!resolvedLayer.type && !resolvedLayer.title) {
                                // This is a reference to a layer defined elsewhere, skip it
                                // The actual layer definition will be/has been loaded from its source atlas
                                // Do nothing - the complete layer definition takes precedence
                            } else if (existingEntry && (!existingEntry.type || !existingEntry.title)) {
                                // Registry has an incomplete entry (from a cross-atlas reference loaded earlier)
                                // Update it with the complete definition from the source atlas
                                this._registry.set(prefixedId, {
                                    ...resolvedLayer,
                                    _sourceAtlas: sourceAtlas,
                                    _prefixedId: prefixedId,
                                    _originalId: layerId,
                                    // Preserve any metadata from the incomplete entry
                                    ...(existingEntry._crossAtlasReference && {_crossAtlasReference: existingEntry._crossAtlasReference})
                                });
                            }
                            // If entry exists and is complete, leave it as-is (first complete definition wins)

                        }
                    });
                }
            } else {
                // Handle failed atlas loads
                const atlasId = result.status === 'fulfilled'
                    ? result.value.atlasId
                    : 'unknown';
                const error = result.status === 'fulfilled'
                    ? result.value.error
                    : result.reason?.message || 'Unknown error';
                console.warn(`[LayerRegistry] Failed to load atlas ${atlasId}:`, error);
            }
        }

        // After all atlases are loaded, resolve cross-atlas references
        this._resolveCrossAtlasReferences();

        // Create consolidated index of atlas to layer IDs
        const layerIndex = {};
        for (const [layerId, layer] of this._registry.entries()) {
            const atlasId = layer._sourceAtlas || 'unknown';
            if (!layerIndex[atlasId]) {
                layerIndex[atlasId] = [];
            }
            layerIndex[atlasId].push({
                id: layerId,
                title: layer.title || layer.name || layerId
            });
        }
        console.log(`[AtlasLayerRegistry] Loaded ${this._registry.size} layers from ${this._atlasLayers.size} atlases`, layerIndex);


        this._initialized = true;
    }

    /**
     * Resolve cross-atlas references after all atlases are loaded
     */
    _resolveCrossAtlasReferences() {
        // Find all layers that are incomplete (missing title, type, etc.)
        const incompleteLayers = [];
        for (const [layerId, layer] of this._registry.entries()) {
            // Check if layer is incomplete - missing type or title (or both)
            const isIncomplete = (!layer.type || !layer.title) && layer.id.includes('-');
            if (isIncomplete) {
                incompleteLayers.push({layerId, layer});
            }
        }

        // Try to resolve each incomplete layer
        for (const {layerId, layer} of incompleteLayers) {
            const potentialAtlas = layer.id.split('-')[0];
            const originalId = layer.id.substring(potentialAtlas.length + 1);

            // Try to find the original layer in the potential atlas
            const crossAtlasLayers = this._atlasLayers.get(potentialAtlas);
            if (crossAtlasLayers) {
                const originalLayer = crossAtlasLayers.find(l => l.id === originalId);
                if (originalLayer) {
                    // Found the original layer, update the registry entry
                    const resolvedLayer = {
                        ...originalLayer,
                        id: layer.id, // Keep the cross-atlas ID
                        _crossAtlasReference: true,
                        _originalAtlas: potentialAtlas,
                        _originalId: originalId,
                        _sourceAtlas: layer._sourceAtlas || potentialAtlas, // Use potentialAtlas as source if not set
                        _prefixedId: layer._prefixedId || layerId // Preserve the prefixed ID
                    };

                    console.debug(`[LayerRegistry] Resolved incomplete cross-atlas layer ${layerId} from ${potentialAtlas} atlas: ${originalId} -> type: ${originalLayer.type || 'missing'}`);
                    this._registry.set(layerId, resolvedLayer);
                }
            }
        }
    }

    /**
     * Set the current active atlas
     */
    setCurrentAtlas(atlasId) {
        this._currentAtlas = atlasId;
    }

    /**
     * Resolve a layer reference from library if needed
     */
    _resolveLayer(layer, atlasId) {
        // If layer only has an id, resolve it from library
        if (layer.id && !layer.type) {
            const libraryLayer = this._libraryLayers.get(layer.id);
            if (libraryLayer) {
                return {...libraryLayer, ...layer};
            }
        }
        return layer;
    }

    /**
     * Get a layer by ID, handling both prefixed and unprefixed IDs
     * @param {string} layerId - The layer ID (can be prefixed with atlas-)
     * @param {string} currentAtlas - The current atlas context (optional)
     * @returns {object|null} The layer configuration
     */
    getLayer(layerId, currentAtlas = null) {
        if (!layerId) return null;

        const contextAtlas = currentAtlas || this._currentAtlas;

        // First, try unprefixed ID in current atlas
        const currentAtlasId = `${contextAtlas}-${layerId}`;
        if (this._registry.has(currentAtlasId)) {
            return this._registry.get(currentAtlasId);
        }

        // Then try the ID as-is (might be prefixed)
        if (this._registry.has(layerId)) {
            return this._registry.get(layerId);
        }

        // Try to find in library
        if (this._libraryLayers.has(layerId)) {
            return this._libraryLayers.get(layerId);
        }

        console.warn(`[LayerRegistry] Layer not found: ${layerId} (context: ${contextAtlas})`);
        return null;
    }

    /**
     * Get all layers for a specific atlas
     */
    getAtlasLayers(atlasId) {
        return this._atlasLayers.get(atlasId) || [];
    }

    /**
     * Search layers across all atlases
     */
    searchLayers(searchTerm, excludeAtlas = null) {
        const results = [];
        const term = searchTerm.toLowerCase();

        for (const [prefixedId, layer] of this._registry.entries()) {
            // Skip layers from excluded atlas
            if (excludeAtlas && layer._sourceAtlas === excludeAtlas) {
                continue;
            }

            // Search in layer properties
            const matches =
                (layer.id && layer.id.toLowerCase().includes(term)) ||
                (layer.title && layer.title.toLowerCase().includes(term)) ||
                (layer.name && layer.name.toLowerCase().includes(term)) ||
                (layer.description && layer.description.toLowerCase().includes(term)) ||
                (layer.tags && Array.isArray(layer.tags) &&
                    layer.tags.some(tag => tag.toLowerCase().includes(term)));

            if (matches) {
                results.push(layer);
            }
        }

        return results;
    }

    /**
     * Normalize a layer ID for URL serialization
     * Removes atlas prefix if it matches current atlas
     */
    normalizeLayerId(layerId, currentAtlas = null) {
        const contextAtlas = currentAtlas || this._currentAtlas;
        const prefix = `${contextAtlas}-`;

        if (layerId.startsWith(prefix)) {
            return layerId.substring(prefix.length);
        }

        return layerId;
    }

    /**
     * Get the full prefixed ID for a layer
     */
    getPrefixedLayerId(layerId, atlasId = null) {
        const contextAtlas = atlasId || this._currentAtlas;

        // If already prefixed, return as-is
        if (layerId.includes('-')) {
            const potentialPrefix = layerId.split('-')[0];
            if (this._atlasLayers.has(potentialPrefix)) {
                return layerId;
            }
        }

        return `${contextAtlas}-${layerId}`;
    }

    /**
     * Check if two layer IDs refer to the same layer (accounting for prefixes)
     */
    isSameLayer(layerId1, layerId2) {
        const layer1 = this.getLayer(layerId1);
        const layer2 = this.getLayer(layerId2);

        if (!layer1 || !layer2) return false;

        // Compare the base IDs
        const baseId1 = layer1.id || layerId1;
        const baseId2 = layer2.id || layerId2;

        return baseId1 === baseId2;
    }

    /**
     * Get the current atlas ID
     */
    getCurrentAtlas() {
        return this._currentAtlas;
    }

    /**
     * Check if the registry is initialized
     */
    isInitialized() {
        return this._initialized;
    }

    /**
     * Get atlas metadata (color, name, etc.) by atlas ID
     * @param {string} atlasId - The atlas ID
     * @returns {object|null} The atlas metadata or null if not found
     */
    getAtlasMetadata(atlasId) {
        return this._atlasMetadata.get(atlasId) || null;
    }

    /**
     * Get the color for an atlas by ID
     * @param {string} atlasId - The atlas ID
     * @returns {string} The color hex code (defaults to blue if not found)
     */
    getAtlasColor(atlasId) {
        const metadata = this._atlasMetadata.get(atlasId);
        return metadata?.color || '#2563eb'; // Default to blue
    }
}

// Create global layer registry instance
const layerRegistry = new LayerRegistry();

// Make it available globally for backwards compatibility
if (typeof window !== 'undefined') {
    window.layerRegistry = layerRegistry;
}

export {layerRegistry};

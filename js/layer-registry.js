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
                    return { atlasId, config, success: true };
                } else {
                    return { atlasId, error: `HTTP ${response.status}`, success: false };
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
                return { atlasId, error: error.message, success: false };
            }
        });

        // Wait for all atlas fetches to complete (whether successful or not)
        const atlasResults = await Promise.allSettled(atlasPromises);

        // Process all successfully loaded atlas configurations
        for (const result of atlasResults) {
            if (result.status === 'fulfilled' && result.value.success) {
                const { atlasId, config } = result.value;

                // Store atlas metadata (color, name, etc.)
                this._atlasMetadata.set(atlasId, {
                    color: config.color || '#2563eb', // Default to blue if not specified
                    name: config.name || atlasId,
                    areaOfInterest: config.areaOfInterest || '',
                    bbox: this._extractBbox(config)
                });

                if (config.layers && Array.isArray(config.layers)) {
                    this._atlasLayers.set(atlasId, config.layers);

                    // Register each layer with appropriate ID
                    config.layers.forEach(layer => {
                        if (layer.id && layer.id.includes('bhuvan')) {
                            console.log(`[DEBUG REGISTRY] Loading layer from ${atlasId}:`, { id: layer.id, hasProxyUrl: !!layer.proxyUrl, proxyUrl: layer.proxyUrl, type: layer.type });
                        }
                        const resolvedLayer = this._resolveLayer(layer, atlasId);
                        if (layer.id && layer.id.includes('bhuvan')) {
                            console.log(`[DEBUG REGISTRY] After _resolveLayer:`, { id: resolvedLayer.id, hasProxyUrl: !!resolvedLayer.proxyUrl, proxyUrl: resolvedLayer.proxyUrl });
                        }
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
                                const registryEntry = {
                                    ...resolvedLayer,
                                    _sourceAtlas: sourceAtlas,
                                    _prefixedId: prefixedId,
                                    // Store the original unprefixed ID for reference
                                    _originalId: layerId
                                };
                                if (layerId.includes('bhuvan')) {
                                    console.log(`[DEBUG REGISTRY] Storing in registry with key ${prefixedId}:`, { hasProxyUrl: !!registryEntry.proxyUrl, proxyUrl: registryEntry.proxyUrl });
                                }
                                this._registry.set(prefixedId, registryEntry);
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
                                    ...(existingEntry._crossAtlasReference && { _crossAtlasReference: existingEntry._crossAtlasReference })
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
                incompleteLayers.push({ layerId, layer });
            }
        }

        // Try to resolve each incomplete layer
        for (const { layerId, layer } of incompleteLayers) {
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
                return {
                    ...libraryLayer,
                    ...layer,
                    // Preserve proxy settings from library if not overridden
                    ...(libraryLayer.proxyUrl && !layer.proxyUrl && {
                        proxyUrl: libraryLayer.proxyUrl,
                        proxyReferer: libraryLayer.proxyReferer
                    })
                };
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
            const layer = this._registry.get(currentAtlasId);
            if (layerId.includes('bhuvan')) {
                console.log(`[DEBUG REGISTRY] getLayer(${layerId}) found as ${currentAtlasId}:`, { hasProxyUrl: !!layer.proxyUrl, proxyUrl: layer.proxyUrl });
            }
            return layer;
        }

        // Then try the ID as-is (might be prefixed)
        if (this._registry.has(layerId)) {
            const layer = this._registry.get(layerId);
            if (layerId.includes('bhuvan')) {
                console.log(`[DEBUG REGISTRY] getLayer(${layerId}) found as-is:`, { hasProxyUrl: !!layer.proxyUrl, proxyUrl: layer.proxyUrl });
            }
            return layer;
        }

        // Try to find in library
        if (this._libraryLayers.has(layerId)) {
            const layer = this._libraryLayers.get(layerId);
            if (layerId.includes('bhuvan')) {
                console.log(`[DEBUG REGISTRY] getLayer(${layerId}) found in library:`, { hasProxyUrl: !!layer.proxyUrl, proxyUrl: layer.proxyUrl });
            }
            return layer;
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
     * Tries to load a layer from a different config file based on a prefix
     * @param {string} layerId - The ID of the layer to load (e.g., 'prefix-layerName')
     * @param {Object} layerConfig - The initial configuration for the layer
     * @returns {Promise<Object|null>} The loaded layer configuration or null if not found
     */
    async tryLoadCrossConfigLayer(layerId, layerConfig) {
        // Parse the layer ID to extract potential config prefix
        const dashIndex = layerId.indexOf('-');
        if (dashIndex === -1) return null;

        const configPrefix = layerId.substring(0, dashIndex);
        const originalLayerId = layerId.substring(dashIndex + 1);

        // Try to load the config file
        try {
            const configPath = `config/${configPrefix}.atlas.json`;
            const configResponse = await fetch(configPath);

            if (!configResponse.ok) {
                return null;
            }

            const crossConfig = await configResponse.json();

            // Look for the layer in the cross-config
            if (crossConfig.layers && Array.isArray(crossConfig.layers)) {
                const foundLayer = crossConfig.layers.find(layer => layer.id === originalLayerId);

                if (foundLayer) {

                    // Create a merged layer with the prefixed ID and source config info
                    return {
                        ...foundLayer,
                        id: layerId, // Keep the prefixed ID
                        title: `${foundLayer.title} (${configPrefix})`, // Add config source to title
                        _sourceConfig: configPrefix,
                        _originalId: originalLayerId,
                        // Preserve important URL-specific properties
                        ...(layerConfig._originalJson && { _originalJson: layerConfig._originalJson }),
                        ...(layerConfig.initiallyChecked !== undefined && { initiallyChecked: layerConfig.initiallyChecked }),
                        ...(layerConfig.opacity !== undefined && { opacity: layerConfig.opacity })
                    };
                }
            }

            // Also check if we need to load the cross-config's library
            try {
                const libraryResponse = await fetch('config/_map-layer-presets.json');
                const layerLibrary = await libraryResponse.json();

                // Look for the original layer ID in the main library
                const libraryLayer = layerLibrary.layers.find(lib => lib.id === originalLayerId);

                if (libraryLayer) {

                    return {
                        ...libraryLayer,
                        id: layerId, // Keep the prefixed ID
                        title: `${libraryLayer.title} (${configPrefix})`, // Add config source to title
                        _sourceConfig: configPrefix,
                        _originalId: originalLayerId,
                        // Preserve important URL-specific properties
                        ...(layerConfig._originalJson && { _originalJson: layerConfig._originalJson }),
                        ...(layerConfig.initiallyChecked !== undefined && { initiallyChecked: layerConfig.initiallyChecked }),
                        ...(layerConfig.opacity !== undefined && { opacity: layerConfig.opacity })
                    };
                }
            } catch (libraryError) {
                // Ignore library loading errors
            }

            return null;

        } catch (error) {
            return null;
        }
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

    /**
     * Extract bounding box from atlas config (supports bbox, map.bounds, and geojson)
     * @param {object} config - The atlas configuration object
     * @returns {array|null} Bounding box as [west, south, east, north] or null
     */
    _extractBbox(config) {
        // 1. Check for top-level bbox [west, south, east, north]
        if (config.bbox && Array.isArray(config.bbox) && config.bbox.length === 4) {
            return config.bbox;
        }

        // 2. Check for map.bounds format: [[west, south], [east, north]]
        if (config.map && config.map.bounds && Array.isArray(config.map.bounds)) {
            const bounds = config.map.bounds;
            if (bounds.length === 2 && Array.isArray(bounds[0]) && Array.isArray(bounds[1])) {
                const [sw, ne] = bounds;
                return [sw[0], sw[1], ne[0], ne[1]]; // Convert to [west, south, east, north]
            }
        }

        // 3. Fall back to geojson format
        if (config.geojson) {
            return this._extractBboxFromGeojson(config.geojson);
        }

        return null;
    }

    /**
     * Extract bounding box from GeoJSON
     * @param {object} geojson - The GeoJSON object
     * @returns {array|null} Bounding box as [west, south, east, north] or null
     */
    _extractBboxFromGeojson(geojson) {
        if (!geojson || !geojson.features || geojson.features.length === 0) {
            return null;
        }

        const feature = geojson.features[0];
        if (!feature.geometry || !feature.geometry.coordinates) {
            return null;
        }

        // For Polygon type, coordinates are [[[lon, lat], ...]]
        const coords = feature.geometry.coordinates[0];
        if (!coords || coords.length === 0) {
            return null;
        }

        // Calculate bbox from coordinates
        let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
        coords.forEach(([lon, lat]) => {
            west = Math.min(west, lon);
            south = Math.min(south, lat);
            east = Math.max(east, lon);
            north = Math.max(north, lat);
        });

        return [west, south, east, north];
    }

    /**
     * Check if a point (lng, lat) is within an atlas bbox
     * @param {string} atlasId - The atlas ID
     * @param {number} lng - Longitude
     * @param {number} lat - Latitude
     * @returns {boolean} True if point is within bbox
     */
    isPointInAtlasBbox(atlasId, lng, lat) {
        const metadata = this._atlasMetadata.get(atlasId);
        if (!metadata || !metadata.bbox) {
            return false;
        }

        const [west, south, east, north] = metadata.bbox;
        return lng >= west && lng <= east && lat >= south && lat <= north;
    }
}

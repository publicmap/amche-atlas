/**
 * URL API - Handles URL parameter synchronization for map layers
 * Supports deep linking with ?atlas=X and ?layers=X parameters
 */

import { LayerOrderManager } from './layer-order-manager.js';

export class URLManager {
    constructor(mapLayerControl, map) {
        this.mapLayerControl = mapLayerControl;
        this.map = map;
        this.isUpdatingFromURL = false; // Prevent circular updates
        this.pendingURLUpdate = null; // Debounce URL updates
        this.stateManager = null; // Reference to feature state manager

        // Set up browser history handling
        this.setupHistoryHandling();

        // Set up layer control event listeners for URL updates
        this.setupLayerControlEventListeners();

        $(document).on('update_url', this.updateGeolocateParam );
    }

    setStateManager(stateManager) {
        this.stateManager = stateManager;

        if (stateManager) {
            stateManager.addEventListener('state-change', (event) => {
                const { eventType, data } = event.detail;
                if (eventType === 'feature-click' ||
                    eventType === 'feature-click-multiple' ||
                    eventType === 'selections-cleared' ||
                    eventType === 'feature-deselected') {
                    if (!this.isUpdatingFromURL && !data?.fromURL) {
                        this.updateURL({ updateSelections: true, updateLayers: false });
                    }
                }
            });
        }
    }

    /**
     * Convert a layer config to a URL-friendly representation
     * Uses normalized IDs (without atlas prefix for current atlas layers)
     */
    layerToURL(layer) {
        // If the layer has an _originalJson property and no opacity override, use it to preserve the original formatting
        if (layer._originalJson && layer.opacity === undefined) {
            return layer._originalJson;
        }

        // Use normalized ID if available (removes current atlas prefix)
        let layerId = layer._normalizedId || layer.id;

        // If we don't have a normalized ID, try to get it from the registry
        if (!layer._normalizedId && window.layerRegistry) {
            layerId = window.layerRegistry.normalizeLayerId(layer.id);
        }

        // If it's a simple layer with just an ID (no opacity or other properties), return the normalized ID
        if (layer.id && Object.keys(layer).filter(k => !k.startsWith('_') && k !== 'tags' && k !== 'initiallyChecked').length === 1) {
            return layerId;
        }

        // If it's a layer with opacity or other properties, create a clean object
        const cleanLayer = { id: layerId };
        Object.keys(layer).forEach(key => {
            if (key !== '_originalJson' && key !== '_normalizedId' &&
                key !== '_sourceAtlas' && key !== '_prefixedId' &&
                key !== 'id' && key !== 'initiallyChecked' && key !== 'tags') {
                cleanLayer[key] = layer[key];
            }
        });

        // If it's just an ID, return it as string
        if (Object.keys(cleanLayer).length === 1) {
            return layerId;
        }

        // If it's a complex layer, return minified JSON
        const minified = JSON.stringify(cleanLayer);
        return minified;
    }

    /**
     * Parse layers from URL parameter (reusing existing logic from map-init.js)
     */
    parseLayersFromUrl(layersParam) {
        if (!layersParam) return [];

        const layers = [];
        let currentItem = '';
        let braceCount = 0;
        let inQuotes = false;
        let escapeNext = false;

        // Parse the comma-separated string, being careful about JSON objects
        for (let i = 0; i < layersParam.length; i++) {
            const char = layersParam[i];

            if (escapeNext) {
                currentItem += char;
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                currentItem += char;
                escapeNext = true;
                continue;
            }

            if (char === '"' && !escapeNext) {
                inQuotes = !inQuotes;
            }

            if (!inQuotes) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                }
            }

            if (char === ',' && braceCount === 0 && !inQuotes) {
                // Found a separator, process current item
                const trimmedItem = currentItem.trim();
                if (trimmedItem) {
                    if (trimmedItem.startsWith('{') && trimmedItem.endsWith('}')) {
                        try {
                            const parsedLayer = JSON.parse(trimmedItem);
                            layers.push(parsedLayer);
                        } catch (error) {
                            console.warn('Failed to parse layer JSON:', trimmedItem, error);
                            layers.push({ id: trimmedItem });
                        }
                    } else {
                        layers.push({ id: trimmedItem });
                    }
                }
                currentItem = '';
            } else {
                currentItem += char;
            }
        }

        // Process the last item
        const trimmedItem = currentItem.trim();
        if (trimmedItem) {
            if (trimmedItem.startsWith('{') && trimmedItem.endsWith('}')) {
                try {
                    const parsedLayer = JSON.parse(trimmedItem);
                    layers.push(parsedLayer);
                } catch (error) {
                    console.warn('Failed to parse layer JSON:', trimmedItem, error);
                    layers.push({ id: trimmedItem });
                }
            } else {
                layers.push({ id: trimmedItem });
            }
        }

        return layers;
    }

    /**
     * Get currently active layers from the map layer control
     * Returns layers with normalized IDs for URL serialization
     */
    getCurrentActiveLayers() {
        if (!this.mapLayerControl || !this.mapLayerControl._state) {
            return [];
        }

        const activeLayers = [];

        // Iterate through all groups in the layer control
        this.mapLayerControl._state.groups.forEach((group, groupIndex) => {
            if (this.isGroupActive(groupIndex)) {
                // Use the original layer configuration if it exists
                if (group._originalJson) {
                    // If this is a custom layer from URL, preserve the original JSON string
                    const layerObj = {
                        _originalJson: group._originalJson,
                        id: group.id,
                        _normalizedId: group._normalizedId
                    };
                    // Include opacity if it exists and is different from default (1)
                    if (group.opacity !== undefined && group.opacity !== 1) {
                        layerObj.opacity = group.opacity;
                    }
                    activeLayers.push(layerObj);
                } else if (group.id) {
                    // Get the proper normalized ID from the layer registry
                    let normalizedId = group._normalizedId;
                    if (!normalizedId && window.layerRegistry) {
                        normalizedId = window.layerRegistry.normalizeLayerId(group.id);
                    }

                    // Simple layer with just an ID
                    const layerObj = {
                        id: group.id,
                        _normalizedId: normalizedId
                    };
                    // Include opacity if it exists and is different from default (1)
                    if (group.opacity !== undefined && group.opacity !== 1) {
                        layerObj.opacity = group.opacity;
                    }
                    activeLayers.push(layerObj);
                } else if (group.layers && group.layers.length > 0) {
                    // For style groups with sublayers, check which sublayers are active
                    const activeSubLayers = this.getActiveSubLayers(groupIndex);
                    if (activeSubLayers.length > 0) {
                        // Get the proper normalized ID from the layer registry
                        let normalizedId = group._normalizedId;
                        if (!normalizedId && window.layerRegistry) {
                            normalizedId = window.layerRegistry.normalizeLayerId(group.id);
                        }

                        // Create a representation for this group's active sublayers
                        const layerObj = {
                            id: group.title || `group-${groupIndex}`,
                            sublayers: activeSubLayers,
                            _normalizedId: normalizedId
                        };
                        // Include opacity if it exists and is different from default (1)
                        if (group.opacity !== undefined && group.opacity !== 1) {
                            layerObj.opacity = group.opacity;
                        }
                        activeLayers.push(layerObj);
                    }
                } else {
                    // Get the proper normalized ID from the layer registry
                    let normalizedId = group._normalizedId;
                    if (!normalizedId && window.layerRegistry) {
                        normalizedId = window.layerRegistry.normalizeLayerId(group.id);
                    }

                    // Generic group
                    const layerObj = {
                        id: group.title || `group-${groupIndex}`,
                        type: group.type || 'source',
                        _normalizedId: normalizedId
                    };
                    // Include opacity if it exists and is different from default (1)
                    if (group.opacity !== undefined && group.opacity !== 1) {
                        layerObj.opacity = group.opacity;
                    }
                    activeLayers.push(layerObj);
                }
            }
        });

        // Also check for cross-atlas layers that might be active
        const crossAtlasLayers = this.getActiveCrossAtlasLayers();
        activeLayers.push(...crossAtlasLayers);

        // Enrich layers with full config to check basemap tags
        const enrichedLayers = activeLayers.map(layer => {
            const layerConfig = this.mapLayerControl._state.groups.find(g =>
                g.id === layer.id || g._prefixedId === layer.id
            );
            return {
                ...layer,
                tags: layerConfig?.tags || layer.tags
            };
        });

        // Use centralized ordering logic: map order → URL order
        // This handles: reversal + basemap grouping (overlays first, basemaps at end)
        return LayerOrderManager.mapOrderToUrlOrder(enrichedLayers);
    }

    /**
     * Check if a group is currently active/visible
     */
    isGroupActive(groupIndex) {
        if (!this.mapLayerControl._sourceControls || !this.mapLayerControl._sourceControls[groupIndex]) {
            return false;
        }

        const $groupControl = $(this.mapLayerControl._sourceControls[groupIndex]);
        const $toggle = $groupControl.find('.toggle-switch input[type="checkbox"]');
        const isChecked = $toggle.length > 0 && $toggle.prop('checked');

        return isChecked;
    }

    /**
     * Get active sublayers for a style group
     */
    getActiveSubLayers(groupIndex) {
        if (!this.mapLayerControl._sourceControls || !this.mapLayerControl._sourceControls[groupIndex]) {
            return [];
        }

        const $groupControl = $(this.mapLayerControl._sourceControls[groupIndex]);
        const $sublayerToggles = $groupControl.find('.layer-controls .toggle-switch input[type="checkbox"]');
        const activeSubLayers = [];

        $sublayerToggles.each((index, toggle) => {
            if ($(toggle).prop('checked')) {
                const layerId = $(toggle).attr('id');
                if (layerId) {
                    activeSubLayers.push(layerId);
                }
            }
        });

        return activeSubLayers;
    }

    /**
     * Get active cross-atlas layers
     */
    getActiveCrossAtlasLayers() {
        const activeLayers = [];

        // Find all cross-atlas layer elements that are currently active
        const $crossAtlasLayers = $('.cross-atlas-layer');

        $crossAtlasLayers.each((index, element) => {
            const $element = $(element);
            const $toggleInput = $element.find('.toggle-switch input[type="checkbox"]');

            if ($toggleInput.length > 0 && $toggleInput.prop('checked')) {
                const layerId = $element.attr('data-layer-id');
                if (layerId) {
                    // Find the layer in the state
                    const layer = this.mapLayerControl._state.groups.find(g => g.id === layerId || g._prefixedId === layerId);
                    if (layer) {
                        // Get the proper normalized ID from the layer registry
                        let normalizedId = layer._normalizedId;
                        if (!normalizedId && window.layerRegistry) {
                            normalizedId = window.layerRegistry.normalizeLayerId(layerId);
                        }

                        const layerObj = {
                            id: layerId,
                            _normalizedId: normalizedId
                        };

                        // Include opacity if it exists and is different from default (1)
                        if (layer.opacity !== undefined && layer.opacity !== 1) {
                            layerObj.opacity = layer.opacity;
                        }

                        activeLayers.push(layerObj);
                    }
                }
            }
        });

        return activeLayers;
    }

    /**
     * Update URL with current layer state
     */
    updateURL(options = {}) {
        if (this.isUpdatingFromURL) {
            return; // Prevent circular updates
        }

        // Debounce URL updates to avoid too many history entries
        if (this.pendingURLUpdate) {
            clearTimeout(this.pendingURLUpdate);
        }

        this.pendingURLUpdate = setTimeout(() => {
            this._performURLUpdate(options);
        }, 300);
    }

    _performURLUpdate(options = {}) {
        const urlParams = new URLSearchParams(window.location.search);
        let hasChanges = false;
        let layersParam = null;
        let atlasParam = null;
        let geolocateParam = null;
        let searchParam = null;
        let terrainParam = null;
        let animateParam = null;
        let fogParam = null;
        let wireframeParam = null;
        let terrainSourceParam = null;
        let selectedParam = null;

        // Handle layers parameter
        if (options.updateLayers !== false) {
            const activeLayers = this.getCurrentActiveLayers();
            const newLayersParam = this.serializeLayersForURL(activeLayers);
            const currentLayersParam = urlParams.get('layers');

            // Only update if the layers actually changed, not just formatting
            // This prevents reverting pretty URLs back to encoded versions
            if (newLayersParam !== currentLayersParam) {
                // Check if this is just a formatting difference (encoded vs unencoded)
                const normalizedNew = decodeURIComponent(newLayersParam || '');
                const normalizedCurrent = decodeURIComponent(currentLayersParam || '');

                if (normalizedNew !== normalizedCurrent) {
                    layersParam = newLayersParam;
                    hasChanges = true;
                }
            }
        }

        // Handle atlas parameter (preserve existing atlas config)
        if (options.atlas !== undefined) {
            if (options.atlas) {
                atlasParam = typeof options.atlas === 'string' ? options.atlas : JSON.stringify(options.atlas);
                if (urlParams.get('atlas') !== atlasParam) {
                    hasChanges = true;
                }
            } else {
                if (urlParams.has('atlas')) {
                    hasChanges = true;
                }
            }
        }

        // Handle geolocate parameter
        if (options.geolocate !== undefined) {
            const currentGeolocateParam = urlParams.get('geolocate');
            if (options.geolocate) {
                geolocateParam = 'true';
                if (currentGeolocateParam !== 'true') {
                    hasChanges = true;
                }
            } else {
                if (currentGeolocateParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle search query parameter
        if (options.search !== undefined) {
            const currentSearchParam = urlParams.get('q');
            if (options.search) {
                searchParam = options.search;
                if (currentSearchParam !== searchParam) {
                    hasChanges = true;
                }
            } else {
                if (currentSearchParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle terrain parameter
        if (options.terrain !== undefined) {
            const currentTerrainParam = urlParams.get('terrain');
            if (options.terrain !== null && options.terrain !== 0) {
                terrainParam = options.terrain.toString();
                if (currentTerrainParam !== terrainParam) {
                    hasChanges = true;
                }
            } else {
                // Set to 0 when disabled
                terrainParam = '0';
                if (currentTerrainParam !== '0') {
                    hasChanges = true;
                }
            }
        }

        // Handle animate parameter
        if (options.animate !== undefined) {
            const currentAnimateParam = urlParams.get('animate');
            if (options.animate) {
                animateParam = 'true';
                if (currentAnimateParam !== 'true') {
                    hasChanges = true;
                }
            } else {
                if (currentAnimateParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle fog parameter
        if (options.fog !== undefined) {
            const currentFogParam = urlParams.get('fog');
            if (options.fog === false) {
                // Only set fog parameter when it's explicitly disabled (default is true)
                fogParam = 'false';
                if (currentFogParam !== 'false') {
                    hasChanges = true;
                }
            } else {
                // Remove fog parameter when enabled (default behavior)
                if (currentFogParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle wireframe parameter
        if (options.wireframe !== undefined) {
            const currentWireframeParam = urlParams.get('wireframe');
            if (options.wireframe) {
                wireframeParam = 'true';
                if (currentWireframeParam !== 'true') {
                    hasChanges = true;
                }
            } else {
                if (currentWireframeParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle terrain source parameter
        if (options.terrainSource !== undefined) {
            const currentTerrainSourceParam = urlParams.get('terrainSource');
            if (options.terrainSource && options.terrainSource !== 'mapbox') {
                // Only set if not default (mapbox is default)
                terrainSourceParam = options.terrainSource;
                if (currentTerrainSourceParam !== terrainSourceParam) {
                    hasChanges = true;
                }
            } else {
                // Remove parameter when using default mapbox terrain
                if (currentTerrainSourceParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle selected features parameter
        if (options.updateSelections && this.stateManager) {
            const newSelectedParam = this.serializeSelectionsForURL();
            const currentSelectedParam = urlParams.get('selected');

            if (newSelectedParam !== currentSelectedParam) {
                selectedParam = newSelectedParam;
                hasChanges = true;
            }
        }

        // Update URL if there are changes
        if (hasChanges) {
            // Create a pretty, readable URL without URL encoding
            const baseUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
            const params = [];

            // Get other parameters (excluding the ones we manage)
            const otherParams = new URLSearchParams(window.location.search);
            otherParams.delete('layers');
            otherParams.delete('atlas');
            otherParams.delete('geolocate');
            otherParams.delete('q');
            otherParams.delete('terrain');
            otherParams.delete('animate');
            otherParams.delete('fog');
            otherParams.delete('wireframe');
            otherParams.delete('terrainSource');
            otherParams.delete('selected');

            // Add other parameters first (these will be URL-encoded by URLSearchParams)
            const otherParamsString = otherParams.toString();
            if (otherParamsString) {
                params.push(otherParamsString);
            }

            // Add atlas parameter if it exists (either new or preserved from current URL)
            const currentAtlas = atlasParam || (options.atlas === undefined ? urlParams.get('atlas') : null);
            if (currentAtlas) {
                // For atlas, we may need to preserve JSON, so add it manually
                params.push('atlas=' + encodeURIComponent(currentAtlas));
            }

            // Add layers parameter if present - this is the key fix for pretty URLs
            if (layersParam) {
                // Don't URL-encode the layers parameter to keep it readable
                params.push('layers=' + layersParam);
            } else if (options.updateLayers === false) {
                // If we're not updating layers, preserve the current layers parameter as-is
                const currentLayersParam = urlParams.get('layers');
                if (currentLayersParam) {
                    params.push('layers=' + currentLayersParam);
                }
            }

            // Add geolocate parameter if active (either new or preserved from current URL)
            const currentGeolocate = geolocateParam || (options.geolocate === undefined ? urlParams.get('geolocate') : null);
            if (currentGeolocate === 'true') {
                params.push('geolocate=true');
            }

            // Add search query parameter (either new or preserved from current URL)
            const currentSearch = searchParam !== null ? searchParam : (options.search === undefined ? urlParams.get('q') : null);
            if (currentSearch) {
                params.push('q=' + encodeURIComponent(currentSearch));
            }

            // Add terrain parameter (either new or preserved from current URL)
            const currentTerrain = terrainParam || (options.terrain === undefined ? urlParams.get('terrain') : null);
            if (currentTerrain) {
                params.push('terrain=' + currentTerrain);
            }

            // Add animate parameter (either new or preserved from current URL)
            const currentAnimate = animateParam || (options.animate === undefined ? urlParams.get('animate') : null);
            if (currentAnimate === 'true') {
                params.push('animate=true');
            }

            // Add fog parameter (either new or preserved from current URL)
            const currentFog = fogParam || (options.fog === undefined ? urlParams.get('fog') : null);
            if (currentFog === 'false') {
                params.push('fog=false');
            }

            // Add wireframe parameter (either new or preserved from current URL)
            const currentWireframe = wireframeParam || (options.wireframe === undefined ? urlParams.get('wireframe') : null);
            if (currentWireframe === 'true') {
                params.push('wireframe=true');
            }

            // Add terrain source parameter (either new or preserved from current URL)
            const currentTerrainSource = terrainSourceParam || (options.terrainSource === undefined ? urlParams.get('terrainSource') : null);
            if (currentTerrainSource && currentTerrainSource !== 'mapbox') {
                params.push('terrainSource=' + currentTerrainSource);
            }

            // Add selected features parameter
            if (selectedParam !== null && selectedParam !== '') {
                params.push('selected=' + selectedParam);
            } else if (options.updateSelections !== true) {
                // If we're not explicitly updating selections, preserve existing parameter
                const currentSelectedParam = urlParams.get('selected');
                if (currentSelectedParam) {
                    params.push('selected=' + currentSelectedParam);
                }
            }

            // Build the final pretty URL
            let newUrl = baseUrl;
            if (params.length > 0) {
                newUrl += '?' + params.join('&');
            }

            // Add hash if it exists
            if (window.location.hash) {
                newUrl += window.location.hash;
            }

            window.history.replaceState(null, '', newUrl);

            // Trigger custom event for other components (like ShareLink)
            window.dispatchEvent(new CustomEvent('urlUpdated', {
                detail: { url: newUrl, activeLayers: this.getCurrentActiveLayers() }
            }));
        }
    }

    /**
     * Serialize active layers for URL parameter
     */
    serializeLayersForURL(layers) {
        if (!layers || layers.length === 0) {
            return '';
        }

        const serialized = layers.map(layer => {
            return this.layerToURL(layer);
        }).join(',');

        return serialized;
    }

    serializeSelectionsForURL() {
        if (!this.stateManager) {
            return '';
        }

        const selectionsByLayer = new Map();

        this.stateManager._selectedFeatures.forEach(compositeKey => {
            const featureState = this.stateManager._featureStates.get(compositeKey);
            if (featureState) {
                const layerId = featureState.layerId;
                const featureId = this.stateManager._getFeatureId(featureState.feature);
                const rawFeatureId = this.stateManager._extractRawFeatureId(featureId);

                if (!selectionsByLayer.has(layerId)) {
                    selectionsByLayer.set(layerId, []);
                }
                selectionsByLayer.get(layerId).push(rawFeatureId);
            }
        });

        if (selectionsByLayer.size === 0) {
            return '';
        }

        const segments = [];
        selectionsByLayer.forEach((featureIds, layerId) => {
            const featureIdsStr = featureIds.join(',');
            segments.push(`${layerId}:${featureIdsStr}`);
        });

        return segments.join(';');
    }

    parseSelectionsFromURL(selectedParam) {
        if (!selectedParam) {
            return new Map();
        }

        const selectionsByLayer = new Map();

        const layerSegments = selectedParam.split(';');
        layerSegments.forEach(segment => {
            const colonIndex = segment.indexOf(':');
            if (colonIndex === -1) {
                console.warn(`Invalid selection segment: ${segment}`);
                return;
            }

            const layerId = segment.substring(0, colonIndex);
            const featureIdsStr = segment.substring(colonIndex + 1);
            const featureIds = featureIdsStr.split(',').map(id => id.trim()).filter(id => id);

            if (layerId && featureIds.length > 0) {
                selectionsByLayer.set(layerId, featureIds);
            }
        });

        return selectionsByLayer;
    }

    /**
     * Update URL when layers change
     */
    onLayersChanged() {
        this.updateURL({ updateLayers: true });
    }

    /**
     * Apply URL parameters to layer control (called on page load)
     */
    async applyURLParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const layersParam = urlParams.get('layers');
        const geolocateParam = urlParams.get('geolocate');
        const searchParam = urlParams.get('q');
        const terrainParam = urlParams.get('terrain');
        const animateParam = urlParams.get('animate');
        const fogParam = urlParams.get('fog');
        const wireframeParam = urlParams.get('wireframe');
        const terrainSourceParam = urlParams.get('terrainSource');
        const selectedParam = urlParams.get('selected');

        // Auto-add terrain parameter if not present
        if (!terrainParam) {
            this.autoAddTerrainParameter();
        }

        if (!layersParam && !geolocateParam && !searchParam && !terrainParam && !animateParam && !fogParam && !wireframeParam && !terrainSourceParam && !selectedParam) {
            return false;
        }

        this.isUpdatingFromURL = true;
        let applied = false;

        try {

            // Wait for map and layer control to be ready
            await this.waitForMapReady();

            // Parse layers from URL
            if (layersParam) {
                // Check if layers were already processed during initialization
                // If the layer control already has layers loaded, skip re-processing
                if (this.mapLayerControl && this.mapLayerControl._state && this.mapLayerControl._state.groups.length > 0) {
                    applied = true;
                } else {
                    const urlLayers = this.parseLayersFromUrl(layersParam);
                    // Apply the layer state
                    applied = await this.applyLayerState(urlLayers);
                }
            }

            // Handle geolocate parameter
            if (geolocateParam === 'true') {
                applied = true;
                this.triggerGeolocation();
            }

            // Handle search query parameter
            if (searchParam && window.searchControl) {
                applied = true;
                window.searchControl.setQueryFromURL(searchParam);
            }

            // Handle terrain parameter
            if (terrainParam && window.terrain3DControl) {
                applied = true;
                const exaggeration = parseFloat(terrainParam);
                if (!isNaN(exaggeration)) {
                    if (exaggeration === 0) {
                        window.terrain3DControl.setEnabled(false);
                    } else {
                        window.terrain3DControl.setExaggeration(exaggeration);
                        window.terrain3DControl.setEnabled(true);
                    }
                }
            }

            // Handle animate parameter
            if (animateParam && window.terrain3DControl) {
                applied = true;
                if (animateParam === 'true') {
                    window.terrain3DControl.setAnimate(true);
                } else {
                    window.terrain3DControl.setAnimate(false);
                }
            }

            // Handle fog parameter
            if (fogParam && window.terrain3DControl) {
                applied = true;
                if (fogParam === 'false') {
                    window.terrain3DControl.setFog(false);
                } else {
                    window.terrain3DControl.setFog(true);
                }
            }

            // Handle wireframe parameter
            if (wireframeParam && window.terrain3DControl) {
                applied = true;
                if (wireframeParam === 'true') {
                    window.terrain3DControl.setWireframe(true);
                } else {
                    window.terrain3DControl.setWireframe(false);
                }
            }

            // Handle terrain source parameter
            if (terrainSourceParam && window.terrain3DControl) {
                applied = true;
                window.terrain3DControl.setTerrainSource(terrainSourceParam);
            }

            // Handle selected features parameter
            if (selectedParam && this.stateManager) {
                applied = true;
                await this.applySelectionsFromURL(selectedParam);
            }

        } catch (error) {
            console.error('🔗 Error applying URL parameters:', error);
        } finally {
            this.isUpdatingFromURL = false;
        }

        return applied;
    }

    async applySelectionsFromURL(selectedParam) {
        if (!this.stateManager) {
            console.warn('[URL API] State manager not available for applying selections');
            return;
        }

        const selectionsByLayer = this.parseSelectionsFromURL(selectedParam);
        if (selectionsByLayer.size === 0) {
            return;
        }

        const layersReady = await this.waitForLayersReady(Array.from(selectionsByLayer.keys()));

        if (!layersReady) {
            console.warn('[URL API] Not all layers ready, attempting selection anyway');
        }

        await this.waitForMapIdle();

        const sources = [];
        selectionsByLayer.forEach((featureIds, layerId) => {
            const layerConfig = this.stateManager.getLayerConfig(layerId);
            if (layerConfig) {
                const sourceId = layerConfig.source || `${layerConfig.type}-${layerId}`;
                if (!sources.includes(sourceId)) {
                    sources.push(sourceId);
                }
            }
        });

        await this.waitForSourceData(sources);

        const allSelectedFeatures = [];

        for (const [layerId, featureIds] of selectionsByLayer.entries()) {
            if (!this.stateManager.isLayerRegistered(layerId)) {
                console.warn(`[URL API] Layer ${layerId} not registered, skipping selections`);
                continue;
            }

            const layerConfig = this.stateManager.getLayerConfig(layerId);
            if (!layerConfig) {
                console.warn(`[URL API] Layer config not found for ${layerId}`);
                continue;
            }

            for (const rawFeatureId of featureIds) {
                const selectedFeature = await this.selectFeatureFromURL(layerId, rawFeatureId, layerConfig);
                if (selectedFeature) {
                    allSelectedFeatures.push(selectedFeature);
                }
            }
        }

        if (allSelectedFeatures.length > 0) {
            this.stateManager._updateLineSortKeys();

            // Execute inspection handlers and emit events for each selected feature
            for (const selectedFeature of allSelectedFeatures) {
                const { feature, featureId, layerId, lngLat } = selectedFeature;

                // Execute inspection handler if configured
                await this.stateManager._executeInspectionHandler(feature, layerId, lngLat);

                // Emit individual feature-click event for each feature
                // This ensures the iframe receives the feature data
                this.stateManager._emitStateChange('feature-click', {
                    feature,
                    featureId,
                    layerId,
                    lngLat,
                    fromURL: true
                });
            }

            this.stateManager._emitStateChange('feature-click-multiple', {
                selectedFeatures: allSelectedFeatures,
                clearedFeatures: [],
                fromURL: true
            });
        }
    }

    async waitForMapIdle(timeout = 3000) {
        return new Promise((resolve) => {
            if (this.map.loaded() && this.map.areTilesLoaded()) {
                resolve();
                return;
            }

            const timeoutId = setTimeout(() => {
                resolve();
            }, timeout);

            const onIdle = () => {
                clearTimeout(timeoutId);
                this.map.off('idle', onIdle);
                resolve();
            };

            this.map.once('idle', onIdle);
        });
    }

    async waitForSourceData(sourceIds, timeout = 5000) {
        return new Promise((resolve) => {
            const loadedSources = new Set();
            const startTime = Date.now();

            const checkSources = () => {
                for (const sourceId of sourceIds) {
                    if (loadedSources.has(sourceId)) continue;

                    const source = this.map.getSource(sourceId);
                    if (!source) continue;

                    if (source.type === 'geojson' && source._data) {
                        loadedSources.add(sourceId);
                    } else if (source.type === 'vector' && this.map.isSourceLoaded(sourceId)) {
                        loadedSources.add(sourceId);
                    } else if (source.type === 'raster' && this.map.isSourceLoaded(sourceId)) {
                        loadedSources.add(sourceId);
                    }
                }

                if (loadedSources.size === sourceIds.length) {
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    const notLoaded = sourceIds.filter(id => !loadedSources.has(id));
                    console.warn(`[URL API] Timeout waiting for sources: ${notLoaded.join(', ')}`);
                    resolve();
                } else {
                    requestAnimationFrame(checkSources);
                }
            };

            checkSources();
        });
    }

    async waitForLayersReady(layerIds, timeout = 10000) {
        const startTime = Date.now();
        const checkInterval = 200;

        return new Promise((resolve) => {
            const checkLayers = () => {
                if (!this.stateManager) {
                    console.warn('[URL API] State manager not available');
                    resolve(false);
                    return;
                }

                const readyLayers = layerIds.filter(layerId =>
                    this.stateManager.isLayerRegistered(layerId)
                );

                const allReady = readyLayers.length === layerIds.length;

                if (allReady) {
                    resolve(true);
                } else if (Date.now() - startTime > timeout) {
                    const notReady = layerIds.filter(id => !readyLayers.includes(id));
                    console.warn(`[URL API] Timeout waiting for layers: ${notReady.join(', ')}`);
                    resolve(false);
                } else {
                    setTimeout(checkLayers, checkInterval);
                }
            };

            checkLayers();
        });
    }

    async selectFeatureFromURL(layerId, rawFeatureId, layerConfig, retries = 3, retryDelay = 500) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const features = this.map.querySourceFeatures(
                    layerConfig.source || `${layerConfig.type}-${layerId}`,
                    {
                        sourceLayer: layerConfig.sourceLayer
                    }
                );

                const matchingFeature = features.find(f => {
                    if (f.id !== undefined && f.id !== null && f.id.toString() === rawFeatureId.toString()) {
                        return true;
                    }
                    if (f.properties?.id !== undefined && f.properties?.id !== null && f.properties.id.toString() === rawFeatureId.toString()) {
                        return true;
                    }
                    if (f.properties?.fid !== undefined && f.properties?.fid !== null && f.properties.fid.toString() === rawFeatureId.toString()) {
                        return true;
                    }
                    return false;
                });

                if (matchingFeature) {
                    const featureId = this.stateManager._getFeatureId(matchingFeature);
                    const compositeKey = this.stateManager._getCompositeKey(layerId, featureId);

                    this.stateManager._updateFeatureState(compositeKey, {
                        feature: matchingFeature,
                        layerId,
                        isSelected: true,
                        timestamp: Date.now()
                    });

                    this.stateManager._selectedFeatures.add(compositeKey);
                    this.stateManager._setMapboxFeatureState(featureId, layerId, { selected: true });

                    return {
                        featureId,
                        layerId,
                        feature: matchingFeature,
                        lngLat: null
                    };
                }

                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            } catch (error) {
                console.warn(`[URL API] Error selecting feature ${rawFeatureId} from layer ${layerId} (attempt ${attempt + 1}/${retries + 1}):`, error);
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            }
        }

        console.warn(`[URL API] Feature ${rawFeatureId} not found in layer ${layerId} after ${retries + 1} attempts`);
        return null;
    }

    /**
     * Wait for map and layer control to be ready
     */
    async waitForMapReady() {
        return new Promise((resolve) => {
            const checkReady = () => {
                if (this.map && this.map.loaded() && this.mapLayerControl && this.mapLayerControl._state) {
                    resolve();
                } else {
                    setTimeout(checkReady, 100);
                }
            };
            checkReady();
        });
    }

    /**
     * Apply layer state from URL parameters
     */
    async applyLayerState(urlLayers) {
        // This would need to be implemented based on the specific layer control logic
        // For now, return true to indicate success
        return true;
    }

    /**
     * Set up browser history handling (back/forward buttons)
     */
    setupHistoryHandling() {
        window.addEventListener('popstate', (event) => {
            this.applyURLParameters();
        });
    }

    /**
     * Get current URL with all parameters
     */
    getCurrentURL() {
        return window.location.href;
    }

    /**
     * Get shareable URL for current state
     */
    getShareableURL() {
        // Return current URL which should already have the latest layer state
        return this.getCurrentURL();
    }

    /**
     * Initialize event listeners on the layer control
     */
    initializeLayerControlListeners() {
        if (!this.mapLayerControl) {
            console.warn('🔗 MapLayerControl not available for URL sync');
            return;
        }

        // Listen for layer toggle events
        // We'll need to patch into the layer control's toggle methods
        this.patchLayerControlMethods();
    }

    /**
     * Patch layer control methods to trigger URL updates
     */
    patchLayerControlMethods() {
        if (!this.mapLayerControl) return;

        // Store original method
        const originalToggleSourceControl = this.mapLayerControl._toggleSourceControl;

        // Patch the toggle method
        this.mapLayerControl._toggleSourceControl = (groupIndex, visible) => {
            // Call original method
            const result = originalToggleSourceControl.call(this.mapLayerControl, groupIndex, visible);

            // Update URL after layer change
            if (!this.isUpdatingFromURL) {
                this.onLayersChanged();
            }

            return result;
        };

    }

    /**
     * Listen for layer control events using DOM event delegation
     */
    setupLayerControlEventListeners() {
        // Prevent duplicate listener registration
        if (this._listenersRegistered) {
            return;
        }
        this._listenersRegistered = true;

        // Listen for checkbox changes in layer controls
        $(document).on('change', '.toggle-switch input[type="checkbox"]', () => {
            if (!this.isUpdatingFromURL) {
                this.onLayersChanged();
            }
        });

        // Listen for sl-show/sl-hide events on layer groups
        $(document).on('sl-show sl-hide', 'sl-details', () => {
            if (!this.isUpdatingFromURL) {
                this.onLayersChanged();
            }
        });

        // Listen for cross-atlas layer events
        $(document).on('sl-show sl-hide', '.cross-atlas-layer', () => {
            if (!this.isUpdatingFromURL) {
                this.onLayersChanged();
            }
        });

        // Listen for state manager events to catch layer registration/unregistration
        if (window.stateManager) {
            this._stateManagerListener = (event) => {
                const { eventType } = event.detail;
                if (eventType === 'layer-registered' || eventType === 'layer-unregistered') {
                    if (!this.isUpdatingFromURL) {
                        // Use a small delay to ensure the layer control state is updated
                        setTimeout(() => {
                            this.onLayersChanged();
                        }, 50);
                    }
                }
            };
            window.stateManager.addEventListener('state-change', this._stateManagerListener);
        } else {
            // Set up a delayed check for state manager
            setTimeout(() => {
                if (window.stateManager && !this._stateManagerListener) {
                    this._listenersRegistered = false; // Allow re-registration
                    this.setupLayerControlEventListeners();
                }
            }, 1000);
        }

        // Listen for custom layer toggle events
        this._layerToggledListener = (event) => {
            if (!this.isUpdatingFromURL) {
                this.onLayersChanged();
            }
        };
        window.addEventListener('layer-toggled', this._layerToggledListener);

    }

    /**
     * Manual sync method for external use
     */
    syncURL() {
        this.updateURL({ updateLayers: true });
    }

    /**
     * Trigger geolocation from URL parameter
     */
    triggerGeolocation() {
        $(document).trigger('url_updated', {geolocate: true});
    }

    /**
     * Update geolocate parameter in URL
     */
    updateGeolocateParam = (event, param) => {
        this.updateURL({geolocate: param.geolocate});
    }

    /**
     * Auto-add terrain parameter with default exaggeration from style
     */
    autoAddTerrainParameter() {
        if (!this.map) return;

        // Get the default exaggeration from the map style or use 1.5 as fallback
        let defaultExaggeration = 1.5;

        try {
            const style = this.map.getStyle();
            if (style && style.terrain && style.terrain.exaggeration) {
                const styleExaggeration = style.terrain.exaggeration;
                // Check if it's a simple number or a complex expression
                if (typeof styleExaggeration === 'number') {
                    defaultExaggeration = styleExaggeration;
                } else {
                    // If it's a complex expression (like interpolate), use the default
                    console.debug('Style terrain exaggeration is complex expression, using default:', defaultExaggeration);
                }
            }
        } catch (error) {
            console.debug('Could not get terrain exaggeration from style, using default:', defaultExaggeration);
        }

        // Add terrain parameter to URL
        this.updateURL({ terrain: defaultExaggeration });

        // Also initialize the 3D control if available
        if (window.terrain3DControl) {
            window.terrain3DControl.setExaggeration(defaultExaggeration);
            window.terrain3DControl.setEnabled(true);
        }
    }

    /**
     * Update terrain parameter in URL
     */
    updateTerrainParam(exaggeration) {
        this.updateURL({ terrain: exaggeration });
    }

    /**
     * Update animate parameter in URL
     */
    updateAnimateParam(animate) {
        this.updateURL({ animate: animate });
    }

    /**
     * Update fog parameter in URL
     */
    updateFogParam(enableFog) {
        this.updateURL({ fog: enableFog });
    }

    /**
     * Update wireframe parameter in URL
     */
    updateWireframeParam(showWireframe) {
        this.updateURL({ wireframe: showWireframe });
    }

    /**
     * Update terrain source parameter in URL
     */
    updateTerrainSourceParam(terrainSource) {
        this.updateURL({ terrainSource: terrainSource });
    }

    /**
     * Update search query parameter in URL
     */
    updateSearchParam(query) {
        this.updateURL({ search: query || '', updateLayers: false });
    }
}
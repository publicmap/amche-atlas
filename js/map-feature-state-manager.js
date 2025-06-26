/**
 * MapFeatureStateManager - Centralized feature state management
 * 
 * Single source of truth for all feature interactions across the application.
 * Uses event-driven architecture to notify components of state changes.
 */

export class MapFeatureStateManager extends EventTarget {
    constructor(map) {
        super();
        this._map = map;
        
        // Single source of truth for all feature states
        this._featureStates = new Map(); // featureId -> FeatureState
        this._activeHoverFeatures = new Map(); // layerId -> Set<featureId>
        this._selectedFeatures = new Map(); // layerId -> Set<featureId>
        
        // Layer configuration
        this._layerConfig = new Map(); // layerId -> LayerConfig
        this._activeInteractiveLayers = new Set();
        this._activeVisibleLayers = new Set();
        
        // Performance optimization
        this._renderScheduled = false;
        this._cleanupInterval = null;
        
        // No longer using click debouncing - handle multiple features directly
        
        // Hover debouncing to prevent rapid state changes
        this._hoverDebounceTimeout = null;
        this._currentHoverTarget = null;
        
        // Cache layer ID mappings to avoid expensive lookups
        this._layerIdCache = new Map(); // layerId -> actualLayerIds[]
        
        this._lastMapMoveTime = 0;
        this._debug = false;
        
        // Inspect mode control - reference to the feature control for inspect mode state
        this._featureControl = null;
        
        // Set up listeners for map changes to detect when new layers/sources are added
        this._setupMapChangeListeners();
        
        this._setupCleanup();
    }

    /**
     * Set the feature control reference for inspect mode state checking
     */
    setFeatureControl(featureControl) {
        this._featureControl = featureControl;
    }

    /**
     * Check if inspect mode is enabled
     */
    _isInspectModeEnabled() {
        return this._featureControl ? this._featureControl._inspectModeEnabled : false;
    }

    /**
     * Register a layer for tracking (both visible and potentially interactive)
     */
    registerLayer(layerConfig) {
        this._layerConfig.set(layerConfig.id, layerConfig);
        
        // All registered layers are considered visible/active
        this._activeVisibleLayers.add(layerConfig.id);
        
        // Only inspectable layers get interactive event handling
        if (layerConfig.inspect) {
            this._activeInteractiveLayers.add(layerConfig.id);
            this._setupLayerEventsWithRetry(layerConfig);
        }
        
        this._emitStateChange('layer-registered', { layerId: layerConfig.id });
    }

    /**
     * Unregister a layer (remove from both visible and interactive tracking)
     */
    unregisterLayer(layerId) {
        if (!this._layerConfig.has(layerId)) return;
        
        // Remove from both sets
        this._activeVisibleLayers.delete(layerId);
        this._activeInteractiveLayers.delete(layerId);
        
        this._removeLayerEvents(layerId);
        this._cleanupLayerFeatures(layerId);
        this._layerConfig.delete(layerId);
        this._layerIdCache.delete(layerId);
        
        this._emitStateChange('layer-unregistered', { layerId });
    }

    /**
     * Handle feature hover
     */
    onFeatureHover(feature, layerId, lngLat) {
        const featureId = this._getFeatureId(feature);
        const hoverTarget = `${layerId}:${featureId}`;
        
        // Skip if we're already hovering the same feature
        if (this._currentHoverTarget === hoverTarget) {
            return;
        }
        
        // Clear previous hover timeout
        if (this._hoverDebounceTimeout) {
            clearTimeout(this._hoverDebounceTimeout);
        }
        
        // Debounce hover to prevent rapid state changes
        this._hoverDebounceTimeout = setTimeout(() => {
            // Clear previous hover for this layer
            this._clearLayerHover(layerId);
            
            // Set new hover
            if (!this._activeHoverFeatures.has(layerId)) {
                this._activeHoverFeatures.set(layerId, new Set());
            }
            this._activeHoverFeatures.get(layerId).add(featureId);
            
            // Set Mapbox feature state for hover
            this._setMapboxFeatureState(featureId, layerId, { hover: true });
            
            // Update feature state
            this._updateFeatureState(featureId, {
                feature,
                layerId,
                lngLat,
                isHovered: true,
                timestamp: Date.now(),
                rawFeatureId: this._getRawFeatureIdFromFeature(feature) // Store raw ID for Mapbox
            });
            
            // Update DOM visual state for hover
            this._updateLayerDOMState(layerId, { hasHover: true });
            
            this._currentHoverTarget = hoverTarget;
            this._scheduleRender('feature-hover', { featureId, layerId, lngLat, feature });
        }, 10); // 10ms debounce
    }

    /**
     * Handle batch hover processing (PERFORMANCE OPTIMIZED)
     * Process all hovered features at once instead of individually
     */
    handleFeatureHovers(hoveredFeatures, lngLat) {
        // Clear previous hover timeout since we're processing a new hover event
        if (this._hoverDebounceTimeout) {
            clearTimeout(this._hoverDebounceTimeout);
        }
        
        // Get currently hovered feature identifiers for comparison
        const currentHoverTargets = new Set();
        this._activeHoverFeatures.forEach((featureIds, layerId) => {
            featureIds.forEach(featureId => {
                currentHoverTargets.add(`${layerId}:${featureId}`);
            });
        });
        
        // Get new hover targets
        const newHoverTargets = new Set();
        const hoveredFeatureMap = new Map(); // Store feature data for processing
        
        hoveredFeatures.forEach(({ feature, layerId, lngLat: featureLngLat }) => {
            const featureId = this._getFeatureId(feature);
            const hoverTarget = `${layerId}:${featureId}`;
            newHoverTargets.add(hoverTarget);
            hoveredFeatureMap.set(hoverTarget, { feature, layerId, featureId, lngLat: featureLngLat || lngLat });
        });
        
        // Check if hover state has actually changed
        const hoverSetsMatch = currentHoverTargets.size === newHoverTargets.size && 
            [...currentHoverTargets].every(target => newHoverTargets.has(target));
        
        if (hoverSetsMatch) {
            // No change in hover state, skip processing
            return;
        }
        
        // Debounce the actual state changes
        this._hoverDebounceTimeout = setTimeout(() => {
            // Clear all previous hover states
            this._clearAllHover();
            
            // Process new hover states in batch
            if (hoveredFeatures.length > 0) {
                const layersToUpdate = new Set();
                
                hoveredFeatures.forEach(({ feature, layerId }) => {
                    const featureId = this._getFeatureId(feature);
                    
                    // Set new hover state
                    if (!this._activeHoverFeatures.has(layerId)) {
                        this._activeHoverFeatures.set(layerId, new Set());
                    }
                    this._activeHoverFeatures.get(layerId).add(featureId);
                    
                    // Set Mapbox feature state for hover
                    this._setMapboxFeatureState(featureId, layerId, { hover: true });
                    
                    // Update feature state with the provided lngLat or use the feature's lngLat
                    this._updateFeatureState(featureId, {
                        feature,
                        layerId,
                        lngLat: lngLat,
                        isHovered: true,
                        timestamp: Date.now(),
                        rawFeatureId: this._getRawFeatureIdFromFeature(feature) // Store raw ID for Mapbox
                    });
                    
                    layersToUpdate.add(layerId);
                });
                
                // Update DOM visual states for all affected layers
                layersToUpdate.forEach(layerId => {
                    this._updateLayerDOMState(layerId, { hasHover: true });
                });
                
                // Update current hover target for compatibility
                if (hoveredFeatures.length === 1) {
                    const { feature, layerId } = hoveredFeatures[0];
                    const featureId = this._getFeatureId(feature);
                    this._currentHoverTarget = `${layerId}:${featureId}`;
                } else {
                    this._currentHoverTarget = `multiple:${hoveredFeatures.length}`;
                }
                
                // Emit a single batch hover event
                this._scheduleRender('features-batch-hover', { 
                    hoveredFeatures: hoveredFeatures.map(({ feature, layerId }) => ({
                        featureId: this._getFeatureId(feature),
                        layerId,
                        feature
                    })),
                    lngLat,
                    affectedLayers: Array.from(layersToUpdate)
                });
            } else {
                // No features to hover
                this._currentHoverTarget = null;
                this._scheduleRender('features-hover-cleared', { lngLat });
            }
        }, 5); // Shorter debounce for better responsiveness
    }

    /**
     * Handle when mouse leaves the entire map
     */
    handleMapMouseLeave() {
        // Clear hover timeout
        if (this._hoverDebounceTimeout) {
            clearTimeout(this._hoverDebounceTimeout);
            this._hoverDebounceTimeout = null;
        }
        
        this._currentHoverTarget = null;
        this._clearAllHover();
        
        // Clear all DOM visual states
        this._clearAllLayerDOMStates();
        
        this._scheduleRender('map-mouse-leave', {});
    }

    /**
     * Clear all hover states (optimized)
     */
    _clearAllHover() {
        const affectedLayers = Array.from(this._activeHoverFeatures.keys());
        
        this._activeHoverFeatures.forEach((featureIds, layerId) => {
            featureIds.forEach(featureId => {
                // Remove Mapbox feature state for hover
                this._removeMapboxFeatureState(featureId, layerId, 'hover');
                
                const state = this._featureStates.get(featureId);
                if (state && !state.isSelected) {
                    this._featureStates.delete(featureId);
                } else if (state) {
                    this._updateFeatureState(featureId, { isHovered: false });
                }
            });
        });
        
        this._activeHoverFeatures.clear();
        
        return affectedLayers;
    }

    /**
     * Handle multiple feature clicks directly (no debouncing)
     */
    handleFeatureClicks(clickedFeatures) {
        if (!clickedFeatures || clickedFeatures.length === 0) return;
        
        // Check if any of the clicked features are already selected
        const alreadySelectedFeatures = [];
        const newFeatures = [];
        
        clickedFeatures.forEach(({ feature, layerId, lngLat }) => {
            const featureId = this._getFeatureId(feature);
            const isSelected = this._selectedFeatures.get(layerId)?.has(featureId) || false;
            
            if (isSelected) {
                alreadySelectedFeatures.push({ featureId, layerId });
            } else {
                newFeatures.push({ feature, layerId, lngLat, featureId });
            }
        });
        
        // Only toggle off if ALL clicked features are identical to ALL currently selected features
        if (alreadySelectedFeatures.length > 0 && newFeatures.length === 0) {
            // Get all currently selected features across all layers
            const allCurrentlySelected = [];
            this._selectedFeatures.forEach((featureIds, layerId) => {
                featureIds.forEach(featureId => {
                    allCurrentlySelected.push({ featureId, layerId });
                });
            });
            
            // Check if the sets are identical (same features in same layers)
            const clickedSet = new Set(alreadySelectedFeatures.map(f => `${f.layerId}:${f.featureId}`));
            const selectedSet = new Set(allCurrentlySelected.map(f => `${f.layerId}:${f.featureId}`));
            
            const setsAreIdentical = clickedSet.size === selectedSet.size && 
                [...clickedSet].every(item => selectedSet.has(item));
            
            if (setsAreIdentical) {
                // Deselect all features at once
                const deselectedLayers = new Set();
                alreadySelectedFeatures.forEach(({ featureId, layerId }) => {
                    this._deselectFeatureInternal(featureId, layerId);
                    deselectedLayers.add(layerId);
                });
                
                // Emit a single batch event for all deselections
                this._scheduleRender('features-batch-deselected', { 
                    deselectedFeatures: alreadySelectedFeatures,
                    affectedLayers: Array.from(deselectedLayers)
                });
                
                // Don't select new features if we're toggling off existing ones
                return;
            }
        }
         
        // If we reach here, either:
        // 1. No features were already selected (newFeatures.length > 0, alreadySelectedFeatures.length = 0)
        // 2. Some clicked features are selected but the selection sets are different (mixed case)
        // In both cases, clear existing selections and select the new clicked features
        
        const clearedFeatures = this._clearAllSelections(true);
        
        const selectedFeatures = [];
        const layersWithSelections = new Set();
        
        clickedFeatures.forEach(({ feature, layerId, lngLat }) => {
            const featureId = this._getFeatureId(feature);
            
            // Set selection for this feature
            if (!this._selectedFeatures.has(layerId)) {
                this._selectedFeatures.set(layerId, new Set());
            }
            this._selectedFeatures.get(layerId).add(featureId);
            
            // Set Mapbox feature state for selection
            this._setMapboxFeatureState(featureId, layerId, { selected: true });
            
            // Update feature state
            this._updateFeatureState(featureId, {
                feature,
                layerId,
                lngLat,
                isSelected: true,
                timestamp: Date.now(),
                rawFeatureId: this._getRawFeatureIdFromFeature(feature) // Store raw ID for Mapbox
            });
            
            selectedFeatures.push({ featureId, layerId, feature });
            layersWithSelections.add(layerId);
        });
        
        // Update DOM visual states for all layers with new selections
        layersWithSelections.forEach(layerId => {
            this._updateLayerDOMState(layerId, { hasSelection: true });
        });
        
        // Emit event for all selections
        if (selectedFeatures.length === 1) {
            this._scheduleRender('feature-click', { 
                ...selectedFeatures[0],
                clearedFeatures 
            });
        } else {
            this._scheduleRender('feature-click-multiple', { 
                selectedFeatures,
                clearedFeatures 
            });
        }
    }

    /**
     * Handle feature leave
     */
    onFeatureLeave(layerId) {
        // Clear hover timeout if pending
        if (this._hoverDebounceTimeout) {
            clearTimeout(this._hoverDebounceTimeout);
            this._hoverDebounceTimeout = null;
        }
        
        this._currentHoverTarget = null;
        this._clearLayerHover(layerId);
        
        // Update DOM visual state for this layer
        this._updateLayerDOMStateFromFeatures(layerId);
        
        this._scheduleRender('feature-leave', { layerId });
    }

    /**
     * Close/remove a selected feature
     */
    closeSelectedFeature(featureId) {
        const featureState = this._featureStates.get(featureId);
        if (!featureState) return;
        
        this._deselectFeature(featureId, featureState.layerId);
    }

    /**
     * Deselect a feature (used for close operations - emits individual event)
     */
    _deselectFeature(featureId, layerId) {
        this._deselectFeatureInternal(featureId, layerId);
        
        // Emit individual deselection event to update UI
        this._scheduleRender('feature-deselected', { featureId, layerId });
    }

    /**
     * Internal deselection logic without event emission (for batch operations)
     */
    _deselectFeatureInternal(featureId, layerId) {
        // Remove from selected features
        const selectedSet = this._selectedFeatures.get(layerId);
        if (selectedSet) {
            selectedSet.delete(featureId);
            if (selectedSet.size === 0) {
                this._selectedFeatures.delete(layerId);
            }
        }
        
        // Remove Mapbox feature state for selection
        this._removeMapboxFeatureState(featureId, layerId, 'selected');
        
        // Update or remove feature state
        const featureState = this._featureStates.get(featureId);
        if (featureState) {
            if (!featureState.isHovered) {
                this._featureStates.delete(featureId);
            } else {
                this._updateFeatureState(featureId, { isSelected: false });
            }
        }
        
        // Update DOM visual state for this layer
        this._updateLayerDOMStateFromFeatures(layerId);
    }

    /**
     * Clear all selected features (public method)
     */
    clearAllSelections(suppressEvent = false) {
        const clearedFeatures = this._clearAllSelections(suppressEvent);
        
        // Force immediate re-render for manual clears (only if not suppressed)
        if (clearedFeatures.length > 0 && !suppressEvent) {
            this._emitStateChange('selections-cleared', { clearedFeatures, manual: true });
            // Also trigger a general re-render
            this._scheduleRender('selections-cleared', { clearedFeatures, manual: true });
        }
        
        return clearedFeatures;
    }

    _clearAllSelections(suppressEvent = false) {
        const clearedFeatures = [];
        const affectedLayers = new Set();
     
        this._selectedFeatures.forEach((features, layerId) => {
            affectedLayers.add(layerId);
            features.forEach(featureId => {
                const state = this._featureStates.get(featureId);
                if (state) {
                    clearedFeatures.push({ featureId, layerId });
                    
                    // Remove Mapbox feature state for selection
                    this._removeMapboxFeatureState(featureId, layerId, 'selected');
                    
                    if (!state.isHovered) {
                        this._featureStates.delete(featureId);
                    } else {
                        this._updateFeatureState(featureId, { isSelected: false });
                    }
                }
            });
        });
        
        this._selectedFeatures.clear();
        
        // Update DOM visual states for all affected layers
        affectedLayers.forEach(layerId => {
            this._updateLayerDOMStateFromFeatures(layerId);
        });
        
        // Emit event for cleared selections if any were cleared
        if (clearedFeatures.length > 0 && !suppressEvent) {
            this._emitStateChange('selections-cleared', { clearedFeatures });
        }
        
        return clearedFeatures;
    }

    /**
     * Get all features for a layer
     */
    getLayerFeatures(layerId) {
        const features = new Map();
        
        this._featureStates.forEach((state, featureId) => {
            if (state.layerId === layerId) {
                // Check if this feature is selected
                const isSelected = this._selectedFeatures.get(layerId)?.has(featureId) || false;
                
                // Enhance state with computed properties
                const enhancedState = {
                    ...state,
                    isSelected: isSelected
                };
                features.set(featureId, enhancedState);
            }
        });
        
        return features;
    }

    /**
     * Get all active layers (both visible and interactive layers)
     */
    getActiveLayers() {
        const activeLayers = new Map();
        
        // Include all visible layers (both inspectable and non-inspectable)
        this._activeVisibleLayers.forEach(layerId => {
            const layerConfig = this._layerConfig.get(layerId);
            const features = this.getLayerFeatures(layerId);
            
            if (layerConfig) {
                activeLayers.set(layerId, {
                    config: layerConfig,
                    features
                });
            }
        });
        
        return activeLayers;
    }

    /**
     * Get the layer configuration for a layer ID
     */
    getLayerConfig(layerId) {
        return this._layerConfig.get(layerId);
    }

    /**
     * Check if a layer is currently interactive
     */
    isLayerInteractive(layerId) {
        return this._activeInteractiveLayers.has(layerId);
    }

    /**
     * Set debug mode (for backwards compatibility with search control)
     */
    setDebug(enabled) {
        this._debug = enabled;
    }

    /**
     * Register selectable layers (for backwards compatibility with search control)
     */
    registerSelectableLayers(layers) {
        // This method is kept for backwards compatibility but the new architecture
        // handles layer registration differently through the layer control
    }

    /**
     * Register hoverable layers (for backwards compatibility with search control)
     */
    registerHoverableLayers(layers) {
        // This method is kept for backwards compatibility but the new architecture
        // handles layer registration differently through the layer control
    }

    /**
     * Watch for layer additions (for backwards compatibility with search control)
     */
    watchLayerAdditions() {
        // This method is kept for backwards compatibility but the new architecture
        // handles layer events differently
    }

    // Private methods
    _setupLayerEventsWithRetry(layerConfig, retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 300; // ms
        
        const matchingLayerIds = this._getMatchingLayerIds(layerConfig);
        
        if (matchingLayerIds.length === 0 && retryCount < maxRetries) {
            // Only log on final attempt to reduce noise
            if (retryCount === maxRetries - 1) {
                console.log(`[StateManager] No layers found for ${layerConfig.id} after ${maxRetries} attempts`);
            }
            setTimeout(() => {
                this._setupLayerEventsWithRetry(layerConfig, retryCount + 1);
            }, retryDelay);
            return;
        }
        
        if (matchingLayerIds.length === 0) {
            // Only warn if this layer was expected to be interactive
            if (layerConfig.inspect) {
                console.warn(`[StateManager] No interactive layers found for ${layerConfig.id}`);
                
                // For critical layers like plot, set up a longer-term retry mechanism
                if (layerConfig.id === 'plot' || layerConfig.id === 'goa-mask') {
                    this._setupLongTermRetry(layerConfig);
                }
            }
            return;
        }
        
        this._setupLayerEvents(layerConfig);
    }

    /**
     * Set up long-term retry for critical layers that might load asynchronously
     */
    _setupLongTermRetry(layerConfig) {
        const layerId = layerConfig.id;
        const maxLongRetries = 10;
        const longRetryDelay = 2000; // 2 seconds
        
        let longRetryCount = 0;
        
        const longRetryInterval = setInterval(() => {
            longRetryCount++;
            
            const matchingLayerIds = this._getMatchingLayerIds(layerConfig);
            
            if (matchingLayerIds.length > 0) {
                console.log(`[StateManager] Long-term retry successful for ${layerId} after ${longRetryCount} attempts`);
                this._setupLayerEvents(layerConfig);
                clearInterval(longRetryInterval);
            } else if (longRetryCount >= maxLongRetries) {
                console.warn(`[StateManager] Long-term retry failed for ${layerId} after ${maxLongRetries} attempts`);
                clearInterval(longRetryInterval);
            }
        }, longRetryDelay);
        
        // Store interval reference for cleanup
        if (!this._longRetryIntervals) {
            this._longRetryIntervals = new Map();
        }
        this._longRetryIntervals.set(layerId, longRetryInterval);
    }

    _setupLayerEvents(layerConfig) {
        const layerId = layerConfig.id;
        
        // Remove existing listeners first
        this._removeLayerEvents(layerId);
        
        // Get all possible layer IDs that might match this layer config
        const matchingLayerIds = this._getMatchingLayerIds(layerConfig);
        
        if (matchingLayerIds.length === 0) {
            console.warn(`[StateManager] No matching layers found for ${layerId}`);
            return;
        }
                
        // Add cursor and hover listeners to all matching layers
        // Note: mousemove and mouseleave are now handled globally by map-feature-control
        // for better performance (single queryRenderedFeatures call per mousemove)
        matchingLayerIds.forEach(actualLayerId => {
            // Add pointer cursor for better UX
            this._map.on('mouseenter', actualLayerId, () => {
                this._map.getCanvas().style.cursor = 'pointer';
            });
            
            this._map.on('mouseleave', actualLayerId, () => {
                this._map.getCanvas().style.cursor = '';
            });
            
            // Click handling is done globally by the map-feature-control
            // Hover handling is done globally by the map-feature-control
        });
    }

    _getMatchingLayerIds(layerConfig) {
        const layerId = layerConfig.id;
        
        // Check cache first
        if (this._layerIdCache.has(layerId)) {
            return this._layerIdCache.get(layerId);
        }
        
        const style = this._map.getStyle();
        if (!style.layers) {
            this._layerIdCache.set(layerId, []);
            return [];
        }
        
        const matchingIds = [];
        
        // Strategy 1: Direct ID match
        if (style.layers.some(l => l.id === layerId)) {
            matchingIds.push(layerId);
        }
        
        // Strategy 2: sourceLayer matching (primary for vector tiles)
        if (layerConfig.sourceLayer) {
            const sourceLayerMatches = style.layers
                .filter(l => l['source-layer'] === layerConfig.sourceLayer)
                .map(l => l.id);
            matchingIds.push(...sourceLayerMatches);
        }
        
        // Strategy 3: Vector layer matching (for custom vector layers)
        if (layerConfig.type === 'vector') {
            const vectorMatches = style.layers
                .filter(l => l.id.startsWith(`vector-layer-${layerId}`))
                .map(l => l.id);
            matchingIds.push(...vectorMatches);
        }
        
        // Strategy 4: GeoJSON source matching
        if (layerConfig.type === 'geojson') {
            const sourceId = `geojson-${layerId}`;
            const geojsonMatches = style.layers
                .filter(l => l.source === sourceId)
                .map(l => l.id);
            matchingIds.push(...geojsonMatches);
        }
        
        // Strategy 5: CSV layer matching
        if (layerConfig.type === 'csv') {
            const csvMatches = style.layers
                .filter(l => l.id.startsWith(`csv-${layerId}-`))
                .map(l => l.id);
            matchingIds.push(...csvMatches);
        }
        
        // Remove duplicates and filter out non-interactive layers
        const uniqueIds = [...new Set(matchingIds)];
        const filteredIds = uniqueIds.filter(id => {
            const layer = style.layers.find(l => l.id === id);
            if (!layer) return false;
            
            // Skip non-interactive layer types
            if (['background', 'raster', 'hillshade'].includes(layer.type)) {
                return false;
            }
            
            return true;
        });
        
        // Cache the result
        this._layerIdCache.set(layerId, filteredIds);
        
        return filteredIds;
    }

    _removeLayerEvents(layerId) {
        // Get all the actual layer IDs we might have set up events for
        const layerConfig = this._layerConfig.get(layerId);
        if (layerConfig) {
            const matchingIds = this._getMatchingLayerIds(layerConfig);
            matchingIds.forEach(actualLayerId => {
                try {
                    // Clean up cursor events
                    this._map.off('mouseenter', actualLayerId);
                    this._map.off('mouseleave', actualLayerId);
                    
                    // Clean up old event listeners (in case they exist)
                    this._map.off('mousemove', actualLayerId);
                    this._map.off('click', actualLayerId);
                } catch (error) {
                    // Layer might not exist, ignore errors
                }
            });
        }
        
        // Also try to remove events for the original layer ID (fallback)
        try {
            this._map.off('mouseenter', layerId);
            this._map.off('mouseleave', layerId);
            this._map.off('mousemove', layerId);
            this._map.off('click', layerId);
        } catch (error) {
            // Layer might not exist, ignore errors
        }
    }

    _updateFeatureState(featureId, updates) {
        const existing = this._featureStates.get(featureId) || {};
        this._featureStates.set(featureId, { ...existing, ...updates });
    }

    _clearLayerHover(layerId) {
        const hoveredFeatures = this._activeHoverFeatures.get(layerId);
        if (hoveredFeatures) {
            hoveredFeatures.forEach(featureId => {
                // Remove Mapbox feature state for hover
                this._removeMapboxFeatureState(featureId, layerId, 'hover');
                
                const state = this._featureStates.get(featureId);
                if (state && !state.isSelected) {
                    this._featureStates.delete(featureId);
                } else if (state) {
                    this._updateFeatureState(featureId, { isHovered: false });
                }
            });
            this._activeHoverFeatures.delete(layerId);
            
            // Update DOM visual state for this layer
            this._updateLayerDOMStateFromFeatures(layerId);
        }
    }

    _cleanupLayerFeatures(layerId) {
        const featuresToDelete = [];
        
        this._featureStates.forEach((state, featureId) => {
            if (state.layerId === layerId) {
                featuresToDelete.push(featureId);
            }
        });
        
        featuresToDelete.forEach(featureId => {
            this._featureStates.delete(featureId);
        });
        
        this._activeHoverFeatures.delete(layerId);
        this._selectedFeatures.delete(layerId);
    }

    _scheduleRender(eventType, data) {
        if (!this._renderScheduled) {
            this._renderScheduled = true;
            requestAnimationFrame(() => {
                this._emitStateChange(eventType, data);
                this._renderScheduled = false;
            });
        }
    }

    _emitStateChange(eventType, data) {
        this.dispatchEvent(new CustomEvent('state-change', {
            detail: { eventType, data, timestamp: Date.now() }
        }));
    }

    _getFeatureId(feature) {
        // STANDARDIZED: Use the same ID generation logic as map-feature-control
        // Priority 1: Use feature.id if available (most reliable)
        if (feature.id !== undefined && feature.id !== null) {
            return `feature-${feature.id}`;
        }
        
        // Priority 2: Use properties.id
        if (feature.properties?.id !== undefined && feature.properties?.id !== null) {
            return `feature-${feature.properties.id}`;
        }
        
        // Priority 3: Use properties.fid (common in vector tiles)
        if (feature.properties?.fid !== undefined && feature.properties?.fid !== null) {
            return `feature-${feature.properties.fid}`;
        }
        
        // Priority 4: Use layer-specific identifiers from the sample
        if (feature.properties?.giscode) {
            return `feature-${feature.properties.giscode}`;
        }
        
        // Priority 5: Combination approach using layer metadata + properties
        if (feature.layer?.metadata?.groupId && feature.properties) {
            const layerId = feature.layer.metadata.groupId;
            // Try common identifying properties
            const identifiers = ['survey', 'plot', 'village', 'name', 'title'];
            for (const prop of identifiers) {
                if (feature.properties[prop] !== undefined && feature.properties[prop] !== null) {
                    return `feature-${layerId}-${feature.properties[prop]}`.replace(/[^a-zA-Z0-9-_]/g, '-');
                }
            }
        }
        
        // Fallback: Geometry hash with layer prefix for consistency
        const layerId = feature.layer?.metadata?.groupId || 'unknown';
        const geomStr = JSON.stringify(feature.geometry);
        return `feature-${layerId}-${this._hashCode(geomStr)}`;
    }

    _hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    /**
     * Extract the raw feature ID that Mapbox recognizes from our internal prefixed format
     * CRITICAL: Mapbox setFeatureState needs the original feature ID, not our internal prefixed version
     */
    _extractRawFeatureId(internalFeatureId) {
        // Handle different internal ID formats:
        
        // 1. "feature-123" -> "123"
        if (internalFeatureId.startsWith('feature-')) {
            const rawId = internalFeatureId.substring(8); // Remove "feature-" prefix
            
            // Try to convert to number if it's numeric
            const numericId = Number(rawId);
            if (!isNaN(numericId) && isFinite(numericId)) {
                return numericId;
            }
            return rawId;
        }
        
        // 2. "feature-layerId-something" -> extract the meaningful part
        // Look for patterns like "feature-plot-274" where the last part might be the ID
        const parts = internalFeatureId.split('-');
        if (parts.length >= 3 && parts[0] === 'feature') {
            // Take the last part as the potential ID
            const lastPart = parts[parts.length - 1];
            const numericId = Number(lastPart);
            if (!isNaN(numericId) && isFinite(numericId)) {
                return numericId;
            }
            
            // If not numeric, might be a composite ID - return the meaningful part
            // For cases like "feature-plot-274/0", return "274/0"
            return parts.slice(2).join('-');
        }
        
        // 3. Raw ID without prefix (already compatible)
        const numericId = Number(internalFeatureId);
        if (!isNaN(numericId) && isFinite(numericId)) {
            return numericId;
        }
        
        // 4. Return as-is for other formats
        return internalFeatureId;
    }

    /**
     * Get the raw feature ID directly from a feature object (for Mapbox setFeatureState)
     * This bypasses our internal ID generation and gets the ID Mapbox expects
     */
    _getRawFeatureIdFromFeature(feature) {
        // Priority 1: Use feature.id if available (most reliable)
        if (feature.id !== undefined && feature.id !== null) {
            return feature.id;
        }
        
        // Priority 2: Use properties.id
        if (feature.properties?.id !== undefined && feature.properties?.id !== null) {
            return feature.properties.id;
        }
        
        // Priority 3: Use properties.fid (common in vector tiles)
        if (feature.properties?.fid !== undefined && feature.properties?.fid !== null) {
            return feature.properties.fid;
        }
        
        // Priority 4: Use layer-specific identifiers
        if (feature.properties?.giscode) {
            return feature.properties.giscode;
        }
        
        // Fallback: Use geometry hash (less reliable for feature state)
        const geomStr = JSON.stringify(feature.geometry);
        return this._hashCode(geomStr);
    }

    _setupCleanup() {
        this._cleanupInterval = setInterval(() => {
            this._cleanupStaleFeatures();
        }, 30000); // Clean up every 30 seconds
    }

    _cleanupStaleFeatures() {
        const now = Date.now();
        const maxAge = 60000; // 1 minute
        
        const featuresToDelete = [];
        
        this._featureStates.forEach((state, featureId) => {
            if (!state.isSelected && 
                (now - state.timestamp) > maxAge) {
                featuresToDelete.push(featureId);
            }
        });
        
        featuresToDelete.forEach(featureId => {
            this._featureStates.delete(featureId);
        });
        
        if (featuresToDelete.length > 0) {
            this._emitStateChange('cleanup', { removedFeatures: featuresToDelete });
        }
    }

    dispose() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
        }
        
        if (this._hoverDebounceTimeout) {
            clearTimeout(this._hoverDebounceTimeout);
        }
        
        // Clean up long-term retry intervals
        if (this._longRetryIntervals) {
            this._longRetryIntervals.forEach((interval, layerId) => {
                clearInterval(interval);
            });
            this._longRetryIntervals.clear();
        }
        
        this._activeInteractiveLayers.forEach(layerId => {
            this._removeLayerEvents(layerId);
        });
        
        this._featureStates.clear();
        this._activeHoverFeatures.clear();
        this._selectedFeatures.clear();
        this._layerConfig.clear();
        this._activeInteractiveLayers.clear();
        this._layerIdCache.clear();
    }

    /**
     * Set Mapbox feature state on the map - optimized to set once per source
     * FIXED: Extract raw feature ID for Mapbox (remove our internal prefix)
     */
    _setMapboxFeatureState(featureId, layerId, state) {
        try {
            // Get the layer config to find the source information
            const layerConfig = this._layerConfig.get(layerId);
            if (!layerConfig) return;

            // CRITICAL FIX: Get the raw feature ID that Mapbox knows about
            // Try to get it from stored feature state first (most reliable)
            const featureState = this._featureStates.get(featureId);
            let rawFeatureId;
            
            if (featureState && featureState.rawFeatureId !== undefined) {
                // Use the stored raw ID (most reliable)
                rawFeatureId = featureState.rawFeatureId;
            } else {
                // Fallback: Extract from our internal prefixed format
                rawFeatureId = this._extractRawFeatureId(featureId);
            }
            
            const matchingLayerIds = this._getMatchingLayerIds(layerConfig);
            
            // Group layers by source to avoid duplicate setFeatureState calls
            const sourceGroups = new Map();
            
            matchingLayerIds.forEach(actualLayerId => {
                const layer = this._map.getLayer(actualLayerId);
                if (layer && layer.source) {
                    const sourceKey = `${layer.source}:${layer['source-layer'] || 'default'}`;
                    if (!sourceGroups.has(sourceKey)) {
                        sourceGroups.set(sourceKey, {
                            source: layer.source,
                            sourceLayer: layer['source-layer'],
                            layerIds: []
                        });
                    }
                    sourceGroups.get(sourceKey).layerIds.push(actualLayerId);
                }
            });
            
            // Set feature state once per source
            sourceGroups.forEach((sourceInfo, sourceKey) => {
                try {
                    const featureIdentifier = {
                        source: sourceInfo.source,
                        id: rawFeatureId  // Use raw ID for Mapbox
                    };
                    
                    // Add source-layer if it exists (for vector tiles)
                    if (sourceInfo.sourceLayer) {
                        featureIdentifier.sourceLayer = sourceInfo.sourceLayer;
                    }
                    
                    this._map.setFeatureState(featureIdentifier, state);
                } catch (error) {
                    // Ignore errors for sources that don't support feature state
                    console.warn(`[StateManager] Could not set feature state for source ${sourceKey}:`, error.message);
                }
            });
        } catch (error) {
            console.warn(`[StateManager] Error setting Mapbox feature state:`, error);
        }
    }

    /**
     * Remove Mapbox feature state from the map - optimized to remove once per source
     * FIXED: Extract raw feature ID for Mapbox (remove our internal prefix)
     */
    _removeMapboxFeatureState(featureId, layerId, stateKey = null) {
        try {
            // Get the layer config to find the source information
            const layerConfig = this._layerConfig.get(layerId);
            if (!layerConfig) return;

            // CRITICAL FIX: Get the raw feature ID that Mapbox knows about
            // Try to get it from stored feature state first (most reliable)
            const featureState = this._featureStates.get(featureId);
            let rawFeatureId;
            
            if (featureState && featureState.rawFeatureId !== undefined) {
                // Use the stored raw ID (most reliable)
                rawFeatureId = featureState.rawFeatureId;
            } else {
                // Fallback: Extract from our internal prefixed format
                rawFeatureId = this._extractRawFeatureId(featureId);
            }

            const matchingLayerIds = this._getMatchingLayerIds(layerConfig);
            
            // Group layers by source to avoid duplicate removeFeatureState calls
            const sourceGroups = new Map();
            
            matchingLayerIds.forEach(actualLayerId => {
                const layer = this._map.getLayer(actualLayerId);
                if (layer && layer.source) {
                    const sourceKey = `${layer.source}:${layer['source-layer'] || 'default'}`;
                    if (!sourceGroups.has(sourceKey)) {
                        sourceGroups.set(sourceKey, {
                            source: layer.source,
                            sourceLayer: layer['source-layer'],
                            layerIds: []
                        });
                    }
                    sourceGroups.get(sourceKey).layerIds.push(actualLayerId);
                }
            });
            
            // Remove feature state once per source
            sourceGroups.forEach((sourceInfo, sourceKey) => {
                try {
                    const featureIdentifier = {
                        source: sourceInfo.source,
                        id: rawFeatureId  // Use raw ID for Mapbox
                    };
                    
                    // Add source-layer if it exists (for vector tiles)
                    if (sourceInfo.sourceLayer) {
                        featureIdentifier.sourceLayer = sourceInfo.sourceLayer;
                    }
                    
                    // Remove specific state key or all states
                    if (stateKey) {
                        this._map.removeFeatureState(featureIdentifier, stateKey);
                    } else {
                        this._map.removeFeatureState(featureIdentifier);
                    }
                } catch (error) {
                    // Ignore errors for sources that don't support feature state
                    console.warn(`[StateManager] Could not remove feature state for source ${sourceKey}:`, error.message);
                }
            });
        } catch (error) {
            console.warn(`[StateManager] Error removing Mapbox feature state:`, error);
        }
    }

    /**
     * Update DOM visual state for layer elements
     * Adds/removes CSS classes on elements with matching data-layer-id
     */
    _updateLayerDOMState(layerId, states) {
        // Find all elements with matching data-layer-id
        const layerElements = document.querySelectorAll(`[data-layer-id="${layerId}"]`);
        
        layerElements.forEach(element => {
            // Update CSS classes based on states
            if (states.hasHover === true) {
                element.classList.add('has-hover');
            } else if (states.hasHover === false) {
                element.classList.remove('has-hover');
            }
            
            if (states.hasSelection === true) {
                element.classList.add('has-selection');
            } else if (states.hasSelection === false) {
                element.classList.remove('has-selection');
            }
        });
    }

    /**
     * Update DOM visual state by examining current feature states
     */
    _updateLayerDOMStateFromFeatures(layerId) {
        const layerFeatures = this.getLayerFeatures(layerId);
        let hasHover = false;
        let hasSelection = false;
        
        layerFeatures.forEach((featureState) => {
            if (featureState.isHovered) hasHover = true;
            if (featureState.isSelected) hasSelection = true;
        });
        
        this._updateLayerDOMState(layerId, { hasHover, hasSelection });
    }

    /**
     * Clear all layer DOM visual states
     */
    _clearAllLayerDOMStates() {
        const layerElements = document.querySelectorAll('[data-layer-id]');
        layerElements.forEach(layerElement => {
            layerElement.classList.remove('has-hover', 'has-selection');
        });
    }

    /**
     * Set up listeners for map style changes to detect when new sources/layers are added
     */
    _setupMapChangeListeners() {
        // Listen for style data events which fire when sources/layers are added
        this._map.on('styledata', () => {
            // Clear cache when style changes so we re-check for layers
            this._layerIdCache.clear();
            
            // Re-try setup for layers that previously failed
            this._retryFailedLayers();
        });
        
        // Listen for source data events
        this._map.on('sourcedata', (e) => {
            if (e.isSourceLoaded) {
                // A source has finished loading, clear cache and retry
                this._layerIdCache.clear();
                setTimeout(() => {
                    this._retryFailedLayers();
                }, 100); // Small delay to ensure layers are added
            }
        });
    }

    /**
     * Retry setup for layers that previously failed to find matching layers
     */
    _retryFailedLayers() {
        const failedLayers = [];
        
        this._layerConfig.forEach((config, layerId) => {
            if (config.inspect && !this._activeInteractiveLayers.has(layerId)) {
                failedLayers.push(config);
            }
        });
        
        if (failedLayers.length > 0) {
            let successCount = 0;
            
            failedLayers.forEach(config => {
                const matchingLayerIds = this._getMatchingLayerIds(config);
                if (matchingLayerIds.length > 0) {
                    this._setupLayerEvents(config);
                    successCount++;
                }
            });
            
            // Only log if there were successful retries
            if (successCount > 0) {
                console.log(`[StateManager] Successfully set up ${successCount}/${failedLayers.length} failed layers after map change`);
            }
        }
    }
}

// Export for both ES6 modules and global usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapFeatureStateManager;
}
if (typeof window !== 'undefined') {
    window.MapFeatureStateManager = MapFeatureStateManager;
} 
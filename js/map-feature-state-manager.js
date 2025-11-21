/**
 * MapFeatureStateManager - Centralized feature state management
 * Manages hover, selection, and interaction states for map features across all layers
 */
import {MapboxAPI} from './mapbox-api.js';

export class MapFeatureStateManager extends EventTarget {
    constructor(map, mapboxAPI = null) {
        super();
        this._map = map;
        this._mapboxAPI = mapboxAPI || new MapboxAPI(map);
        this._registeredLayers = new Map(); // layerId -> config
        this._featureStates = new Map(); // compositeKey -> { feature, layerId, isHovered, isSelected, lngLat, timestamp }
        this._hoverTimeouts = new Map(); // featureId -> timeout
        this._selectedFeatures = new Set(); // Set of composite keys for quick lookup
        this._isDebug = false;
        this._cleanupInterval = null;
        this._retryAttempts = new Map(); // layerId -> retry count
        this._maxRetries = 10;
        this._retryDelay = 2000; // 2 seconds
        this._eventListenerRefs = new Map(); // Store event listener references for cleanup
        this._featureControl = null; // Reference to feature control for inspect mode checking

        // Performance optimization
        this._batchedUpdates = new Set();
        this._batchUpdateTimeout = null;

        // Map state tracking for re-registration after style changes
        this._isStyleChanging = false;
        this._pendingRegistrations = new Map();

        // Start cleanup process
        this._setupCleanup();

        // Set up map change listeners to handle dynamic layer additions
        this._setupMapChangeListeners();

        // Update the flag to track Cmd/Ctrl key state
        this._isCmdCtrlPressed = false;

        // Update event listeners for keydown and keyup to track Cmd/Ctrl key state
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Meta' || event.key === 'Control') {
                this._isCmdCtrlPressed = true;
            }
        });
        document.addEventListener('keyup', (event) => {
            if (event.key === 'Meta' || event.key === 'Control') {
                this._isCmdCtrlPressed = false;
            }
        });
    }

    /**
     * Set reference to feature control for inspect mode checking
     */
    setFeatureControl(featureControl) {
        this._featureControl = featureControl;
    }

    /**
     * Check if inspect mode is enabled in the feature control
     */
    _isInspectModeEnabled() {
        return this._featureControl?._inspectModeEnabled || false;
    }

    /**
     * Check if a layer is a raster layer that doesn't support feature interaction
     * @param {Object} layerConfig - Layer configuration
     * @returns {boolean} True if layer is raster-based
     */
    _isRasterLayer(layerConfig) {
        const rasterTypes = ['tms', 'wmts', 'img', 'raster-style-layer'];
        return rasterTypes.includes(layerConfig.type);
    }

    /**
     * Register a layer for feature interaction tracking
     * @param {Object} layerConfig - Layer configuration object with id, type, etc.
     */
    registerLayer(layerConfig) {
        const layerId = layerConfig.id;

        if (this._registeredLayers.has(layerId)) {
            // Layer already registered, skipping
            return;
        }

        this._registeredLayers.set(layerId, layerConfig);
        // Layer registered successfully

        // Check if this is a raster layer that doesn't need feature interaction
        if (this._isRasterLayer(layerConfig)) {
            // For raster layers, we still register them for inspection but don't set up feature events
            this._emitStateChange('layer-registered', {
                layerId,
                layerConfig,
                isRasterLayer: true
            });
            return;
        }

        // Set up layer events with retry mechanism for vector layers
        this._setupLayerEventsWithRetry(layerConfig);

        // Emit registration event
        this._emitStateChange('layer-registered', {
            layerId,
            layerConfig,
            isRasterLayer: false
        });
    }

    /**
     * Unregister a layer from feature interaction tracking
     * @param {string} layerId - Layer ID to unregister
     */
    unregisterLayer(layerId) {
        if (!this._registeredLayers.has(layerId)) {
            return;
        }

        // Clean up all features for this layer
        this._cleanupLayerFeatures(layerId);

        // Remove layer events
        this._removeLayerEvents(layerId);

        // Remove from registered layers
        this._registeredLayers.delete(layerId);

        // Remove retry attempts
        this._retryAttempts.delete(layerId);

        // Layer unregistered successfully

        // Emit unregistration event
        this._emitStateChange('layer-unregistered', {
            layerId
        });
    }

    /**
     * Handle feature hover (SINGLE FEATURE)
     * @param {Object} feature - The hovered feature
     * @param {string} layerId - Layer ID
     * @param {Object} lngLat - Mouse coordinates
     */
    onFeatureHover(feature, layerId, lngLat) {
        if (!feature || !layerId) return;

        const featureId = this._getFeatureId(feature);
        const compositeKey = this._getCompositeKey(layerId, featureId);

        // Clear existing hover timeout for this feature if any
        if (this._hoverTimeouts.has(compositeKey)) {
            clearTimeout(this._hoverTimeouts.get(compositeKey));
            this._hoverTimeouts.delete(compositeKey);
        }

        // Update feature state
        this._updateFeatureState(compositeKey, {
            feature,
            layerId,
            isHovered: true,
            lngLat,
            timestamp: Date.now()
        });

        // Set mapbox feature state for visual feedback
        this._setMapboxFeatureState(featureId, layerId, {hover: true});

        // Emit hover event
        this._emitStateChange('feature-hover', {
            featureId,
            layerId,
            feature,
            lngLat
        });

        // Removed verbose hover logging

        // DON'T set a timeout to clear hover state when mouse stops moving
        // Hover states should persist until mouse actually moves away from features
        // The timeout mechanism was causing premature clearing of hover states
    }

    /**
     * Handle feature hovers (BATCH PROCESSING for better performance)
     * @param {Array} hoveredFeatures - Array of {feature, layerId, lngLat} objects
     * @param {Object} globalLngLat - Global mouse coordinates
     */
    handleFeatureHovers(hoveredFeatures, globalLngLat) {
        if (!hoveredFeatures || hoveredFeatures.length === 0) {
            this.handleMapMouseLeave();
            return;
        }

        // Clear all existing hover states first
        this._clearAllHover();

        const affectedLayers = new Set();
        const processedFeatures = [];

        // Process each hovered feature
        hoveredFeatures.forEach(({feature, layerId, lngLat}) => {
            if (!feature || !layerId) return;

            const featureId = this._getFeatureId(feature);
            const compositeKey = this._getCompositeKey(layerId, featureId);

            // Update feature state
            this._updateFeatureState(compositeKey, {
                feature,
                layerId,
                isHovered: true,
                lngLat: lngLat || globalLngLat,
                timestamp: Date.now()
            });

            // Set mapbox feature state for visual feedback
            this._setMapboxFeatureState(featureId, layerId, {hover: true});

            affectedLayers.add(layerId);
            processedFeatures.push({
                featureId,
                layerId,
                feature
            });

            // Removed verbose batch hover logging
        });

        // Emit batch hover event for more efficient UI updates
        this._emitStateChange('features-batch-hover', {
            hoveredFeatures: processedFeatures,
            affectedLayers: Array.from(affectedLayers),
            lngLat: globalLngLat
        });

        // Clear any existing hover timeout
        this._hoverTimeouts.forEach(timeout => clearTimeout(timeout));
        this._hoverTimeouts.clear();

        // DON'T set a timeout to clear hover states when mouse stops moving
        // Hover states should persist until mouse actually moves away from features
        // Only clear hover states when:
        // 1. Mouse moves to different features (handled by _clearAllHover above)
        // 2. Mouse leaves map area (handled by handleMapMouseLeave)
        // 3. Explicit clear is called

        // Removed verbose hover state logging
    }

    /**
     * Handle mouse leaving the map area
     */
    handleMapMouseLeave() {
        // Clear all hover timeouts
        this._hoverTimeouts.forEach(timeout => clearTimeout(timeout));
        this._hoverTimeouts.clear();

        // Clear all hover states
        this._clearAllHover();

        // Emit map mouse leave event
        this._emitStateChange('map-mouse-leave', {
            timestamp: Date.now()
        });

    }

    /**
     * Clear all hover states across all features
     */
    _clearAllHover() {
        const clearedFeatures = [];

        this._featureStates.forEach((featureState, compositeKey) => {
            if (featureState.isHovered) {
                featureState.isHovered = false;

                // Remove mapbox feature state
                const {layerId, feature} = featureState;
                const featureId = this._getFeatureId(feature);
                this._removeMapboxFeatureState(featureId, layerId, 'hover');

                clearedFeatures.push({
                    featureId,
                    layerId,
                    feature: featureState.feature
                });
            }
        });

        // Removed verbose cleared hover logging

        return clearedFeatures;
    }

    /**
     * Handle feature clicks (BATCH PROCESSING for overlapping features)
     * @param {Array} clickedFeatures - Array of {feature, layerId, lngLat} objects
     */
    handleFeatureClicks(clickedFeatures) {
        if (!clickedFeatures || clickedFeatures.length === 0) {
            // Click on empty area - clear all selections
            this.clearAllSelections();
            return;
        }

        // Get currently selected features before clearing for the event
        const previouslySelected = Array.from(this._selectedFeatures).map(compositeKey => {
            const featureState = this._featureStates.get(compositeKey);
            if (featureState) {
                return {
                    featureId: this._getFeatureId(featureState.feature),
                    layerId: featureState.layerId,
                    feature: featureState.feature
                };
            }
            return null;
        }).filter(Boolean);

        // If Cmd/Ctrl is not pressed, clear existing selections FIRST (to emit proper clear events)
        const clearedFeatures = [];
        if (!this._isCmdCtrlPressed) {
            this._selectedFeatures.forEach(compositeKey => {
                const featureState = this._featureStates.get(compositeKey);
                if (featureState) {
                    featureState.isSelected = false;

                    // Remove mapbox feature state
                    const featureId = this._getFeatureId(featureState.feature);
                    this._removeMapboxFeatureState(featureId, featureState.layerId, 'selected');

                    clearedFeatures.push({
                        featureId,
                        layerId: featureState.layerId,
                        feature: featureState.feature
                    });
                }
            });

            this._selectedFeatures.clear();
        }

        // Process clicked features and select them
        const newSelections = [];

        clickedFeatures.forEach(({feature, layerId, lngLat}) => {
            if (!feature || !layerId) return;

            const featureId = this._getFeatureId(feature);
            const compositeKey = this._getCompositeKey(layerId, featureId);

            // Toggle selection if Cmd/Ctrl is pressed
            if (this._isCmdCtrlPressed && this._selectedFeatures.has(compositeKey)) {
                this._deselectFeature(featureId, layerId);
                return;
            }

            // Update feature state
            this._updateFeatureState(compositeKey, {
                feature,
                layerId,
                isSelected: true,
                lngLat,
                timestamp: Date.now()
            });

            // Add to selected features set
            this._selectedFeatures.add(compositeKey);

            // Set mapbox feature state for visual feedback
            this._setMapboxFeatureState(featureId, layerId, {selected: true});

            newSelections.push({
                featureId,
                layerId,
                feature,
                lngLat
            });

            // Removed verbose selection logging
        });

        // Emit appropriate events based on number of features clicked
        if (newSelections.length === 1) {
            // Single feature click
            const selection = newSelections[0];
            this._emitStateChange('feature-click', {
                ...selection,
                clearedFeatures
            });
        } else if (newSelections.length > 1) {
            // Multiple features clicked (overlapping)
            this._emitStateChange('feature-click-multiple', {
                selectedFeatures: newSelections,
                clearedFeatures
            });
        }

        // Removed verbose selection summary logging
    }

    /**
     * Handle feature leave - clear hover state for a specific layer
     * @param {string} layerId - Layer ID
     */
    onFeatureLeave(layerId) {
        this._clearLayerHover(layerId);

        // Emit feature leave event
        this._emitStateChange('feature-leave', {
            layerId,
            timestamp: Date.now()
        });

        // Removed verbose feature leave logging
    }

    /**
     * Close/deselect a specific selected feature by its ID
     * @param {string} featureId - Feature ID to close
     */
    closeSelectedFeature(featureId) {
        // Find and deselect the feature
        let found = false;
        this._featureStates.forEach((featureState, compositeKey) => {
            if (this._getFeatureId(featureState.feature) === featureId && featureState.isSelected) {
                this._deselectFeature(featureId, featureState.layerId);
                found = true;
            }
        });

        if (!found && this._isDebug) {
            console.warn(`[StateManager] Feature not found for closing: ${featureId}`);
        }
    }

    /**
     * Deselect a specific feature
     * @param {string} featureId - Feature ID
     * @param {string} layerId - Layer ID
     */
    _deselectFeature(featureId, layerId) {
        this._deselectFeatureInternal(featureId, layerId);

        // Emit deselection event
        this._emitStateChange('feature-deselected', {
            featureId,
            layerId
        });
    }

    /**
     * Internal deselection logic without event emission
     */
    _deselectFeatureInternal(featureId, layerId) {
        const compositeKey = this._getCompositeKey(layerId, featureId);
        const featureState = this._featureStates.get(compositeKey);

        if (!featureState || !featureState.isSelected) {
            return false;
        }

        // Update state
        featureState.isSelected = false;

        // Remove from selected set
        this._selectedFeatures.delete(compositeKey);

        // Remove mapbox feature state
        this._removeMapboxFeatureState(featureId, layerId, 'selected');

        // Removed verbose deselection logging

        return true;
    }

    /**
     * Clear all selected features
     * @param {boolean} suppressEvent - Whether to suppress the event emission
     */
    clearAllSelections(suppressEvent = false) {
        this._clearAllSelections(suppressEvent);
    }

    /**
     * Internal method to clear all selections
     * @param {boolean} suppressEvent - Whether to suppress the event emission
     */
    _clearAllSelections(suppressEvent = false) {
        const clearedFeatures = [];

        // Deselect all features
        this._selectedFeatures.forEach(compositeKey => {
            const featureState = this._featureStates.get(compositeKey);
            if (featureState && featureState.isSelected) {
                featureState.isSelected = false;

                // Remove mapbox feature state
                const featureId = this._getFeatureId(featureState.feature);
                this._removeMapboxFeatureState(featureId, featureState.layerId, 'selected');

                clearedFeatures.push({
                    featureId,
                    layerId: featureState.layerId,
                    feature: featureState.feature
                });
            }
        });

        this._selectedFeatures.clear();

        if (!suppressEvent && clearedFeatures.length > 0) {
            this._emitStateChange('selections-cleared', {
                clearedFeatures
            });
        }

        // Removed verbose selection clearing logging

        return clearedFeatures;
    }

    /**
     * Get all features for a layer
     */
    getLayerFeatures(layerId) {
        const layerFeatures = new Map();

        this._featureStates.forEach((featureState, compositeKey) => {
            if (featureState.layerId === layerId) {
                const featureId = this._getFeatureId(featureState.feature);

                // Check if this feature is selected
                const isSelected = this._selectedFeatures.has(compositeKey) || false;

                // Enhance state with computed properties
                layerFeatures.set(featureId, {
                    ...featureState,
                    isSelected,
                    featureId
                });
            }
        });

        return layerFeatures;
    }

    /**
     * Get all active layers with their features
     * @returns {Map} Map of layerId -> { config, features, isRaster, isInteractive }
     */
    getActiveLayers() {
        const activeLayers = new Map();

        // Include all visible layers (both inspectable and non-inspectable)
        this._registeredLayers.forEach((layerConfig, layerId) => {
            const features = this.getLayerFeatures(layerId);
            const isRaster = this._isRasterLayer(layerConfig);

            activeLayers.set(layerId, {
                config: layerConfig,
                features,
                isRaster,
                isInteractive: !isRaster
            });
        });

        return activeLayers;
    }

    /**
     * Get layer configuration by ID
     * @param {string} layerId - Layer ID
     * @returns {Object|null} Layer configuration or null if not found
     */
    getLayerConfig(layerId) {
        return this._registeredLayers.get(layerId);
    }

    /**
     * Check if a layer is interactive (registered for events)
     * @param {string} layerId - Layer ID
     * @returns {boolean} True if layer is interactive (supports feature clicks/hovers)
     */
    isLayerInteractive(layerId) {
        const layerConfig = this._registeredLayers.get(layerId);
        if (!layerConfig) return false;

        // Raster layers are registered but not interactive for feature selection
        return !this._isRasterLayer(layerConfig);
    }

    /**
     * Check if a layer is registered (available for inspection)
     * @param {string} layerId - Layer ID
     * @returns {boolean} True if layer is registered
     */
    isLayerRegistered(layerId) {
        return this._registeredLayers.has(layerId);
    }

    /**
     * Enable or disable debug logging
     * @param {boolean} enabled - Debug enabled state
     */
    setDebug(enabled) {
        this._isDebug = enabled;
    }

    /**
     * Register selectable layers (for backwards compatibility)
     * @deprecated Use registerLayer instead
     */
    registerSelectableLayers(layers) {
        layers.forEach(layerConfig => this.registerLayer(layerConfig));
    }

    /**
     * Register hoverable layers (for backwards compatibility)
     * @deprecated Use registerLayer instead
     */
    registerHoverableLayers(layers) {
        layers.forEach(layerConfig => this.registerLayer(layerConfig));
    }

    /**
     * Watch for layer additions and automatically register them
     */
    watchLayerAdditions() {
        // This is handled by _setupMapChangeListeners
    }

    /**
     * Set up layer events with retry mechanism for robustness
     */
    _setupLayerEventsWithRetry(layerConfig, retryCount = 0) {
        const success = this._setupLayerEvents(layerConfig);

        if (!success && retryCount < this._maxRetries) {
            // Immediate retry for first few attempts
            if (retryCount < 3) {
                setTimeout(() => {
                    this._setupLayerEventsWithRetry(layerConfig, retryCount + 1);
                }, 100 * (retryCount + 1)); // Exponential backoff: 100ms, 200ms, 300ms
            } else {
                // Longer term retry for persistent issues
                this._setupLongTermRetry(layerConfig);
            }
        } else if (!success) {
            console.warn(`[StateManager] Failed to setup events for ${layerConfig.id} after ${this._maxRetries} attempts`);
        } else {
            this._retryAttempts.delete(layerConfig.id);
        }
    }

    /**
     * Set up long-term retry for persistent layer setup failures
     */
    _setupLongTermRetry(layerConfig) {
        const currentAttempts = this._retryAttempts.get(layerConfig.id) || 0;

        if (currentAttempts < 5) { // Limit long-term retries to 5
            this._retryAttempts.set(layerConfig.id, currentAttempts + 1);


            setTimeout(() => {
                // Check if layer is still registered before retrying
                if (this._registeredLayers.has(layerConfig.id)) {
                    const success = this._setupLayerEvents(layerConfig);
                    if (!success) {
                        this._setupLongTermRetry(layerConfig);
                    } else {
                        this._retryAttempts.delete(layerConfig.id);
                    }
                }
            }, this._retryDelay);
        } else {
            console.error(`[StateManager] Gave up on setting up events for ${layerConfig.id} after 5 long-term retries`);
            this._retryAttempts.delete(layerConfig.id);
        }
    }

    /**
     * Set up hover and click events for a layer
     * @param {Object} layerConfig - Layer configuration
     * @returns {boolean} Success status
     */
    _setupLayerEvents(layerConfig) {
        try {
            const matchingLayerIds = this._getMatchingLayerIds(layerConfig);

            if (matchingLayerIds.length === 0) {
                // Don't warn here - the retry mechanism will handle it
                // Only warn if retries are exhausted (handled in _setupLayerEventsWithRetry)
                return false;
            }


            // Set up events for all matching layer IDs
            matchingLayerIds.forEach(actualLayerId => {
                this._setupSingleLayerEvents(actualLayerId, layerConfig);
            });

            return true;
        } catch (error) {
            console.error(`[StateManager] Error setting up events for ${layerConfig.id}:`, error);
            return false;
        }
    }

    /**
     * Set up events for a single layer ID
     */
    _setupSingleLayerEvents(actualLayerId, layerConfig) {
        // Store references for cleanup
        if (!this._eventListenerRefs.has(layerConfig.id)) {
            this._eventListenerRefs.set(layerConfig.id, []);
        }
        const refs = this._eventListenerRefs.get(layerConfig.id);

        // Note: We don't set up individual layer hover/click events here anymore
        // All interaction is handled by the global click handler in MapFeatureControl
        // This method exists for future extensibility if needed
    }

    /**
     * Get matching layer IDs from the map style for a layer config
     */
    _getMatchingLayerIds(layerConfig) {
        const style = this._mapboxAPI.getStyle();
        if (!style.layers) return [];

        const layerId = layerConfig.id;
        const matchingIds = [];

        // Strategy 1: Direct ID match (HIGHEST PRIORITY)
        const directMatches = style.layers.filter(l => l.id === layerId).map(l => l.id);
        matchingIds.push(...directMatches);

        // Strategy 2: Prefix matches (for geojson layers and others)
        const prefixMatches = style.layers
            .filter(l => l.id.startsWith(layerId + '-') || l.id.startsWith(layerId + ' '))
            .map(l => l.id);
        matchingIds.push(...prefixMatches);

        // Strategy 2.5: MapboxAPI generated layer names (vector-layer-{id}, tms-layer-{id}, wmts-layer-{id}, wms-layer-{id}, etc.)
        const generatedMatches = style.layers
            .filter(l =>
                l.id.startsWith(`vector-layer-${layerId}`) ||
                l.id.startsWith(`tms-layer-${layerId}`) ||
                l.id.startsWith(`wmts-layer-${layerId}`) ||
                l.id.startsWith(`wms-layer-${layerId}`) ||
                l.id.startsWith(`geojson-${layerId}`) ||
                l.id.startsWith(`csv-${layerId}`) ||
                l.id.startsWith(`markers-${layerId}`)
            )
            .map(l => l.id);
        matchingIds.push(...generatedMatches);

        // Strategy 2.6: raster-style-layer styleLayer property (for layers like mapbox-satellite)
        const styleLayerMatches = layerConfig.styleLayer ?
            style.layers.filter(l => l.id === layerConfig.styleLayer).map(l => l.id) : [];
        matchingIds.push(...styleLayerMatches);

        // If we have direct matches, prioritize them and be more restrictive with fallback strategies
        const hasDirectMatches = directMatches.length > 0 || prefixMatches.length > 0 || generatedMatches.length > 0 || styleLayerMatches.length > 0;

        // Strategy 3: Source layer matches (ONLY if no direct matches found)
        if (!hasDirectMatches && layerConfig.sourceLayer) {
            const sourceLayerMatches = style.layers
                .filter(l => l['source-layer'] === layerConfig.sourceLayer)
                .map(l => l.id);
            matchingIds.push(...sourceLayerMatches);
        }

        // Strategy 4: Source matches (ONLY if no direct matches found)
        if (!hasDirectMatches && layerConfig.source) {
            const sourceMatches = style.layers
                .filter(l => l.source === layerConfig.source)
                .map(l => l.id);
            matchingIds.push(...sourceMatches);
        }

        // Strategy 5: Legacy source layers array
        if (layerConfig.sourceLayers && Array.isArray(layerConfig.sourceLayers)) {
            const legacyMatches = style.layers
                .filter(l => l['source-layer'] && layerConfig.sourceLayers.includes(l['source-layer']))
                .map(l => l.id);
            matchingIds.push(...legacyMatches);
        }

        // Strategy 6: Grouped layers
        if (layerConfig.layers && Array.isArray(layerConfig.layers)) {
            layerConfig.layers.forEach(subLayer => {
                if (subLayer.sourceLayer) {
                    const subLayerMatches = style.layers
                        .filter(l => l['source-layer'] === subLayer.sourceLayer)
                        .map(l => l.id);
                    matchingIds.push(...subLayerMatches);
                }
            });
        }

        // Remove duplicates and return
        const finalMatches = [...new Set(matchingIds)];

        return finalMatches;
    }

    /**
     * Remove layer events
     */
    _removeLayerEvents(layerId) {
        // Get all the actual layer IDs we might have set up events for
        const layerConfig = this._registeredLayers.get(layerId);
        if (layerConfig) {
            const matchingIds = this._getMatchingLayerIds(layerConfig);

            matchingIds.forEach(actualLayerId => {
                // Remove events using the MapboxAPI
                const refs = this._eventListenerRefs.get(layerId);
                if (refs) {
                    refs.forEach(({type, listener, layerIdOrOptions}) => {
                        try {
                            this._mapboxAPI.off(type, listener, layerIdOrOptions);
                        } catch (error) {
                            console.warn(`[StateManager] Error removing event for ${layerId}:`, error);
                        }
                    });
                }
            });

            // Clear the references
            this._eventListenerRefs.delete(layerId);
        }
    }

    /**
     * Create a composite key for feature identification
     */
    _getCompositeKey(layerId, featureId) {
        return `${layerId}:${featureId}`;
    }

    /**
     * Update feature state data
     */
    _updateFeatureState(compositeKey, updates) {
        // Extract layerId from updates to create composite key
        const layerId = updates.layerId;
        if (!layerId) {
            console.error('[StateManager] LayerId required for feature state updates');
            return;
        }

        const existing = this._featureStates.get(compositeKey) || {};
        this._featureStates.set(compositeKey, {...existing, ...updates});
    }

    /**
     * Clear hover state for a specific layer
     */
    _clearLayerHover(layerId) {
        const clearedFeatures = [];

        this._featureStates.forEach((featureState, compositeKey) => {
            if (featureState.layerId === layerId && featureState.isHovered) {
                featureState.isHovered = false;

                // Remove mapbox feature state
                const featureId = this._getFeatureId(featureState.feature);
                this._removeMapboxFeatureState(featureId, layerId, 'hover');

                clearedFeatures.push({
                    featureId,
                    layerId,
                    feature: featureState.feature
                });
            }
        });

        // Removed verbose layer hover clearing logging
    }

    /**
     * Clean up features for a specific layer
     */
    _cleanupLayerFeatures(layerId) {
        const removedFeatures = [];

        // Remove all feature states for this layer
        this._featureStates.forEach((featureState, compositeKey) => {
            if (featureState.layerId === layerId) {
                const featureId = this._getFeatureId(featureState.feature);

                // Remove mapbox feature states
                this._removeMapboxFeatureState(featureId, layerId, 'hover');
                this._removeMapboxFeatureState(featureId, layerId, 'selected');

                this._featureStates.delete(compositeKey);
                this._selectedFeatures.delete(compositeKey);

                removedFeatures.push(featureId);
            }
        });

        // Clear hover timeouts for this layer
        this._hoverTimeouts.forEach((timeout, key) => {
            if (key.startsWith(`${layerId}:`)) {
                clearTimeout(timeout);
                this._hoverTimeouts.delete(key);
            }
        });

        // Emit cleanup event if features were removed
        if (removedFeatures.length > 0) {
            this._emitStateChange('cleanup', {
                layerId,
                removedFeatures
            });
        }
    }

    /**
     * Schedule a render update (legacy method for compatibility)
     */
    _scheduleRender(eventType, data) {
        this._emitStateChange(eventType, data);
    }

    /**
     * Emit a state change event
     */
    _emitStateChange(eventType, data) {
        this.dispatchEvent(new CustomEvent('state-change', {
            detail: {eventType, data}
        }));
    }

    /**
     * Get feature ID with consistent generation
     */
    _getFeatureId(feature) {
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

        // Priority 4: Use layer-specific identifiers
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

    /**
     * Simple hash function for generating feature IDs
     */
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
     * Extract raw feature ID from internal feature ID
     */
    _extractRawFeatureId(internalFeatureId) {
        // Remove the 'feature-' prefix and any layer prefix to get the raw ID
        let rawId = internalFeatureId;

        if (rawId.startsWith('feature-')) {
            rawId = rawId.substring(8); // Remove 'feature-' prefix
        }

        // If it contains a layer prefix (format: layerId-actualId), extract just the actual ID
        const layerPrefixMatch = rawId.match(/^[^-]+-(.+)$/);
        if (layerPrefixMatch) {
            rawId = layerPrefixMatch[1];
        }

        return rawId;
    }

    /**
     * Get raw feature ID from feature object for Mapbox API
     */
    _getRawFeatureIdFromFeature(feature) {
        // For Mapbox setFeatureState, we need the actual feature ID as stored in the source
        // Priority 1: Use feature.id if available
        if (feature.id !== undefined && feature.id !== null) {
            return feature.id;
        }

        // Priority 2: Use properties.id  
        if (feature.properties?.id !== undefined && feature.properties?.id !== null) {
            return feature.properties.id;
        }

        // Priority 3: Use properties.fid
        if (feature.properties?.fid !== undefined && feature.properties?.fid !== null) {
            return feature.properties.fid;
        }

        // Fallback: Use a property that's likely to be unique
        if (feature.properties?.giscode) {
            return feature.properties.giscode;
        }

        // Final fallback: generate a hash (not ideal for Mapbox feature state)
        const geomStr = JSON.stringify(feature.geometry);
        return this._hashCode(geomStr);
    }

    /**
     * Set up cleanup routine to remove stale features
     */
    _setupCleanup() {
        this._cleanupInterval = setInterval(() => {
            this._cleanupStaleFeatures();
        }, 60000); // Clean up every minute
    }

    /**
     * Clean up stale features (older than 5 minutes and not selected)
     */
    _cleanupStaleFeatures() {
        const now = Date.now();
        const maxAge = 5 * 60 * 1000; // 5 minutes
        const toRemove = [];

        this._featureStates.forEach((featureState, compositeKey) => {
            if (!featureState.isSelected &&
                !featureState.isHovered &&
                (now - featureState.timestamp) > maxAge) {
                toRemove.push(compositeKey);
            }
        });

        toRemove.forEach(compositeKey => {
            this._featureStates.delete(compositeKey);
        });

        // Removed verbose cleanup logging
    }

    /**
     * Dispose of the state manager and clean up all resources
     */
    dispose() {
        // Clear cleanup interval
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }

        // Clear all hover timeouts
        this._hoverTimeouts.forEach(timeout => clearTimeout(timeout));
        this._hoverTimeouts.clear();

        // Clear batch update timeout
        if (this._batchUpdateTimeout) {
            clearTimeout(this._batchUpdateTimeout);
            this._batchUpdateTimeout = null;
        }

        // Remove all event listeners
        this._registeredLayers.forEach((layerConfig, layerId) => {
            this._removeLayerEvents(layerId);
        });

        this._featureStates.clear();
        this._selectedFeatures.clear();
        this._registeredLayers.clear();
        this._retryAttempts.clear();
        this._eventListenerRefs.clear();

        // Remove keydown and keyup event listeners
        document.removeEventListener('keydown', this._keydownListener);
        document.removeEventListener('keyup', this._keyupListener);

        console.debug('[StateManager] Disposed');
    }

    /**
     * Set Mapbox feature state using the API
     */
    _setMapboxFeatureState(featureId, layerId, state) {
        try {
            // Get the layer config to find the source information
            const layerConfig = this._registeredLayers.get(layerId);
            if (!layerConfig) return;

            // Skip feature state for style layers since they don't have their own sources
            if (layerConfig.type === 'style') {
                // Skipping feature state for style layer (no custom source)
                return;
            }

            // Get raw feature ID for Mapbox
            const rawFeatureId = this._extractRawFeatureId(featureId);

            // Build feature identifier for Mapbox
            const featureIdentifier = {
                source: layerConfig.source || `${layerConfig.type}-${layerId}`,
                id: rawFeatureId
            };

            // Add sourceLayer if it exists
            if (layerConfig.sourceLayer) {
                featureIdentifier.sourceLayer = layerConfig.sourceLayer;
            }

            this._mapboxAPI.setFeatureState(featureIdentifier, state);

            // Removed verbose feature state set logging
        } catch (error) {
            if (this._isDebug) {
                console.warn(`[StateManager] Could not set feature state for ${featureId}:`, error);
            }
        }
    }

    /**
     * Remove Mapbox feature state using the API
     */
    _removeMapboxFeatureState(featureId, layerId, stateKey = null) {
        try {
            // Get the layer config to find the source information
            const layerConfig = this._registeredLayers.get(layerId);
            if (!layerConfig) return;

            // Skip feature state for style layers since they don't have their own sources
            if (layerConfig.type === 'style') {
                // Skipping feature state removal for style layer (no custom source)
                return;
            }

            // Get raw feature ID for Mapbox
            const rawFeatureId = this._extractRawFeatureId(featureId);

            // Build feature identifier for Mapbox
            const featureIdentifier = {
                source: layerConfig.source || `${layerConfig.type}-${layerId}`,
                id: rawFeatureId
            };

            // Add sourceLayer if it exists
            if (layerConfig.sourceLayer) {
                featureIdentifier.sourceLayer = layerConfig.sourceLayer;
            }

            this._mapboxAPI.removeFeatureState(featureIdentifier, stateKey);

            // Removed verbose feature state removal logging
        } catch (error) {
            if (this._isDebug) {
                console.warn(`[StateManager] Could not remove feature state for ${featureId}:`, error);
            }
        }
    }

    /**
     * Update layer DOM state (placeholder for future UI integration)
     */
    _updateLayerDOMState(layerId, states) {
        // This method is kept for compatibility with existing code
        // UI state updates are now handled by the MapFeatureControl
    }

    /**
     * Update layer DOM state from features (placeholder for future UI integration)
     */
    _updateLayerDOMStateFromFeatures(layerId) {
        // This method is kept for compatibility with existing code
        // UI state updates are now handled by the MapFeatureControl
    }

    /**
     * Clear all layer DOM states (placeholder for future UI integration)
     */
    _clearAllLayerDOMStates() {
        // This method is kept for compatibility with existing code
        // UI state updates are now handled by the MapFeatureControl
    }

    /**
     * Set up map change listeners to handle style changes and new layer additions
     */
    _setupMapChangeListeners() {
        // Listen for style data changes to re-register layers after style changes
        const handleStyleData = () => {
            if (this._isStyleChanging) {
                console.debug('[StateManager] Style change complete, re-registering layers');
                this._isStyleChanging = false;

                // Re-register all layers after style change
                const layersToReregister = Array.from(this._registeredLayers.entries());
                layersToReregister.forEach(([layerId, layerConfig]) => {
                    this._setupLayerEventsWithRetry(layerConfig);
                });
            } else {
                // Not a style change, but layers may have been added
                // Retry any failed layer registrations
                this._retryFailedLayers();
            }
        };

        const handleStyleStart = () => {
            console.debug('[StateManager] Style change starting');
            this._isStyleChanging = true;
        };

        // Use MapboxAPI for event handling
        this._mapboxAPI.on('styledata', handleStyleData);
        this._mapboxAPI.on('style.load', handleStyleStart);

        // Store references for cleanup
        this._eventListenerRefs.set('map-events', [
            {type: 'styledata', listener: handleStyleData},
            {type: 'style.load', listener: handleStyleStart}
        ]);
    }

    /**
     * Retry failed layer registrations
     */
    _retryFailedLayers() {
        const failedLayers = [];

        this._registeredLayers.forEach((config, layerId) => {
            // Skip raster layers - they don't need event setup
            if (this._isRasterLayer(config)) {
                return;
            }

            // Check if layer setup was successful by looking for matching style layers
            const matchingIds = this._getMatchingLayerIds(config);
            if (matchingIds.length === 0) {
                // Only retry if not already in a retry cycle (to avoid duplicate retries)
                // If it's already retrying, the existing retry will handle it
                if (!this._retryAttempts.has(layerId)) {
                    failedLayers.push(config);
                }
            }
        });

        if (failedLayers.length > 0) {
            console.debug(`[StateManager] Retrying ${failedLayers.length} failed layer registration(s)`);
            failedLayers.forEach(config => {
                this._setupLayerEventsWithRetry(config);
            });
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
/**
 * MapFeatureControl - Iframe-based version for layer inspection
 *
 * This control displays a toggle button and iframe panel for layer inspection.
 * Uses map-inspector.html for the UI instead of building it in JavaScript.
 */

export class MapFeatureControl {
    constructor() {
        this.options = {
            position: 'top-left',
            maxHeight: '600px',
            maxWidth: '350px',
            minWidth: '250px'
        };

        this._map = null;
        this._stateManager = null;
        this._container = null;
        this._panel = null;
        this._iframe = null;
        this._config = null;
        this._globalHandlersAdded = false;

        // Set up resize listener
        this._resizeListener = this._handleResize.bind(this);
        window.addEventListener('resize', this._resizeListener);
        window.addEventListener('orientationchange', this._resizeListener);
    }

    /**
     * Standard Mapbox GL JS control method - called when control is added to map
     */
    onAdd(map) {
        this._map = map;
        this._createContainer();
        this._setupMessageListener();
        return this._container;
    }

    /**
     * Standard Mapbox GL JS control method - called when control is removed from map
     */
    onRemove() {
        this._cleanup();
        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._map = null;
        this._stateManager = null;
    }

    /**
     * Standard Mapbox GL JS control method - returns default position
     */
    getDefaultPosition() {
        return this.options.position;
    }

    /**
     * Initialize the control with the centralized state manager
     */
    initialize(stateManager, config = null) {
        this._stateManager = stateManager;
        this._config = config;

        // If no config provided, try to get it from global state
        if (!this._config && window.layerControl && window.layerControl._config) {
            this._config = window.layerControl._config;
        }

        // Set up a periodic sync to ensure config stays up to date
        setInterval(() => {
            if (!this._config && window.layerControl && window.layerControl._config) {
                this._config = window.layerControl._config;
            }
        }, 1000);

        // Link the state manager to this control for inspect mode checking
        this._stateManager.setFeatureControl(this);

        // Listen to state changes from the centralized manager
        this._stateChangeListener = (event) => {
            this._handleStateChange(event.detail);
        };
        this._stateManager.addEventListener('state-change', this._stateChangeListener);

        // Set up global map interaction handlers for hover/click
        this._setupGlobalInteractionHandlers();

        // Send initial data to iframe
        this._sendDataToIframe();

        return this;
    }

    /**
     * Set the configuration reference
     */
    setConfig(config) {
        this._config = config;
        this._sendDataToIframe();
    }

    /**
     * Create the main container with toggle button and iframe panel
     */
    _createContainer() {
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';

        // Create button
        const button = document.createElement('button');
        button.className = 'mapboxgl-ctrl-icon map-feature-control-btn map-control-dark';
        button.type = 'button';
        button.setAttribute('aria-label', 'Map Inspector');
        button.innerHTML = '<span style="font-size: 18px;">ℹ️</span>';

        // Add event handlers
        button.addEventListener('click', () => {
            this._togglePanel();
        });

        this._container.appendChild(button);

        // Create panel with iframe
        this._createPanel();
    }

    /**
     * Create panel with iframe
     */
    _createPanel() {
        this._panel = document.createElement('div');
        this._panel.className = 'map-feature-panel';

        const isMobile = window.innerWidth <= 768;
        const initialHeight = isMobile ? '40vh' : '200px';

        this._panel.style.cssText = `
            display: none;
            position: fixed;
            top: 60px;
            right: 10px;
            width: ${this.options.maxWidth};
            max-width: calc(100vw - 70px);
            height: ${initialHeight};
            max-height: 90vh;
            background: #111827;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            overflow: hidden;
            transition: height 0.2s ease;
        `;

        // Create iframe
        this._iframe = document.createElement('iframe');
        this._iframe.src = 'map-inspector.html';
        this._iframe.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
        `;

        this._panel.appendChild(this._iframe);

        // Close panel when clicking outside
        setTimeout(() => {
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.map-feature-panel, .mapboxgl-ctrl-icon, .mapboxgl-canvas-container')) {
                    this._hidePanel();
                }
            });
        }, 100);

        // Add panel to map container
        this._map.getContainer().appendChild(this._panel);

        // Apply initial responsive sizing
        this._handleResize();
    }

    /**
     * Setup message listener for iframe communication
     */
    _setupMessageListener() {
        window.addEventListener('message', (event) => {
            if (event.data.type === 'request-inspector-data') {
                this._sendDataToIframe();
            } else if (event.data.type === 'isolate-layer') {
                this._isolateLayer(event.data.layerId);
            } else if (event.data.type === 'clear-layer-isolation') {
                this._clearLayerIsolation();
            } else if (event.data.type === 'update-layer-opacity') {
                this._updateLayerOpacity(event.data.layerId, event.data.opacity);
            } else if (event.data.type === 'zoom-to-layer') {
                this._zoomToLayer(event.data.layerId);
            } else if (event.data.type === 'remove-layer') {
                this._removeLayer(event.data.layerId);
            } else if (event.data.type === 'inspector-height-change') {
                this._adjustPanelHeight(event.data);
            }
        });
    }

    /**
     * Send data to iframe
     */
    _sendDataToIframe() {
        if (!this._iframe || !this._iframe.contentWindow) return;

        const activeLayers = this._getActiveLayersFromConfig();
        const layerConfigs = [];

        for (const [layerId, layerData] of activeLayers.entries()) {
            layerConfigs.push(layerData.config);
        }

        this._iframe.contentWindow.postMessage({
            type: 'inspector-data',
            activeLayers: layerConfigs,
            layerRegistry: window.layerRegistry
        }, '*');
    }

    /**
     * Handle state changes from the state manager
     */
    _handleStateChange(detail) {
        const { eventType, data } = detail;

        switch (eventType) {
            case 'feature-hover':
            case 'features-batch-hover':
                this._sendHighlightToIframe(data);
                break;
            case 'features-hover-cleared':
            case 'map-mouse-leave':
                this._clearHighlightInIframe();
                break;
            case 'feature-click':
                this._sendFeatureSelectionToIframe(data.layerId, data.feature);
                break;
            case 'layer-registered':
            case 'layer-unregistered':
                this._sendDataToIframe();
                break;
        }
    }

    /**
     * Send highlight message to iframe
     */
    _sendHighlightToIframe(data) {
        if (!this._iframe || !this._iframe.contentWindow) return;

        const layerIds = data.affectedLayers || [data.layerId];

        this._iframe.contentWindow.postMessage({
            type: 'highlight-layers',
            layerIds: layerIds
        }, '*');
    }

    /**
     * Clear highlights in iframe
     */
    _clearHighlightInIframe() {
        if (!this._iframe || !this._iframe.contentWindow) return;

        this._iframe.contentWindow.postMessage({
            type: 'clear-highlights'
        }, '*');
    }

    /**
     * Send feature selection to iframe
     */
    _sendFeatureSelectionToIframe(layerId, feature) {
        if (!this._iframe || !this._iframe.contentWindow) return;

        this._iframe.contentWindow.postMessage({
            type: 'feature-selected',
            layerId: layerId,
            feature: feature
        }, '*');
    }

    /**
     * Get active layers from state manager
     */
    _getActiveLayersFromConfig() {
        if (!this._stateManager) {
            return new Map();
        }

        const activeLayers = this._stateManager.getActiveLayers();
        return activeLayers;
    }

    /**
     * Isolate a layer by hiding all others
     */
    _isolateLayer(layerId) {
        const mapboxAPI = this._getMapboxAPI();
        if (!mapboxAPI) return;

        const activeLayers = this._getActiveLayersFromConfig();

        for (const [id, layerData] of activeLayers.entries()) {
            if (id !== layerId) {
                mapboxAPI.updateLayerGroupVisibility(id, layerData.config, false);
            }
        }
    }

    /**
     * Clear layer isolation (show all layers)
     */
    _clearLayerIsolation() {
        const mapboxAPI = this._getMapboxAPI();
        if (!mapboxAPI) return;

        const activeLayers = this._getActiveLayersFromConfig();

        for (const [id, layerData] of activeLayers.entries()) {
            mapboxAPI.updateLayerGroupVisibility(id, layerData.config, true);
        }
    }

    /**
     * Update layer opacity
     */
    _updateLayerOpacity(layerId, opacity) {
        const mapboxAPI = this._getMapboxAPI();
        if (!mapboxAPI) return;

        const activeLayers = this._getActiveLayersFromConfig();
        const layerData = activeLayers.get(layerId);

        if (layerData) {
            mapboxAPI.updateLayerOpacity(layerId, layerData.config, opacity);
            layerData.config.opacity = opacity;

            // Update URL if urlManager is available
            if (window.urlManager) {
                window.urlManager.updateURL();
            }
        }
    }

    /**
     * Zoom to layer bounds
     */
    _zoomToLayer(layerId) {
        const activeLayers = this._getActiveLayersFromConfig();
        const layerData = activeLayers.get(layerId);

        if (!layerData) return;

        const config = layerData.config;
        let bbox = config.bbox;

        // Try atlas bbox if layer doesn't have one
        if (!bbox && config._sourceAtlas && window.layerRegistry) {
            const atlasMetadata = window.layerRegistry.getAtlasMetadata(config._sourceAtlas);
            if (atlasMetadata && atlasMetadata.bbox) {
                bbox = atlasMetadata.bbox;
            }
        }

        if (bbox && this._map) {
            this._map.fitBounds([
                [bbox[0], bbox[1]],
                [bbox[2], bbox[3]]
            ], { padding: 50, duration: 1000 });
        }
    }

    /**
     * Remove a layer
     */
    _removeLayer(layerId) {
        if (window.layerControl) {
            window.layerControl.toggleLayerVisibility(layerId, false);
        }
    }

    /**
     * Get MapboxAPI reference from layer control
     */
    _getMapboxAPI() {
        if (this._mapboxAPI) {
            return this._mapboxAPI;
        }

        if (window.layerControl && window.layerControl._mapboxAPI) {
            return window.layerControl._mapboxAPI;
        }

        return null;
    }

    /**
     * Toggle panel visibility
     */
    _togglePanel() {
        if (this._panel.style.display === 'none') {
            this._showPanel();
        } else {
            this._hidePanel();
        }
    }

    _showPanel() {
        this._panel.style.display = 'block';
        this._sendDataToIframe();
    }

    _hidePanel() {
        this._panel.style.display = 'none';
    }

    /**
     * Handle resize events
     */
    _handleResize() {
        if (!this._panel) return;

        // Adjust panel size on mobile
        if (window.innerWidth <= 768) {
            this._panel.style.width = 'calc(100vw - 70px)';
            this._panel.style.maxWidth = 'calc(100vw - 70px)';
            this._panel.style.maxHeight = '40vh';
            this._panel.style.right = '42px';
            this._panel.style.left = 'auto';
        } else {
            this._panel.style.width = this.options.maxWidth;
            this._panel.style.maxWidth = 'calc(100vw - 70px)';
            this._panel.style.maxHeight = '85vh';
            this._panel.style.right = '42px';
            this._panel.style.left = 'auto';
        }

        // Request iframe to recalculate height
        if (this._iframe && this._iframe.contentWindow) {
            this._iframe.contentWindow.postMessage({
                type: 'request-height-update'
            }, '*');
        }
    }

    /**
     * Cleanup
     */
    _cleanup() {
        if (this._stateChangeListener && this._stateManager) {
            this._stateManager.removeEventListener('state-change', this._stateChangeListener);
        }

        window.removeEventListener('resize', this._resizeListener);
        window.removeEventListener('orientationchange', this._resizeListener);
    }

    /**
     * Set up global interaction handlers for hover and click
     */
    _setupGlobalInteractionHandlers() {
        if (this._globalHandlersAdded) return;

        // Click handler
        this._map.on('click', (e) => {
            let features = [];
            try {
                features = this._map.queryRenderedFeatures(e.point);
            } catch (error) {
                if (error.message && error.message.includes('out of range source coordinates for DEM data')) {
                    this._stateManager.clearAllSelections();
                    return;
                } else {
                    console.error('[MapFeatureControl] Error querying rendered features on click:', error);
                    throw error;
                }
            }

            const interactiveFeatures = [];
            features.forEach(feature => {
                const layerId = this._findLayerIdForFeature(feature);
                if (layerId && this._stateManager.isLayerInteractive(layerId)) {
                    interactiveFeatures.push({
                        feature,
                        layerId,
                        lngLat: e.lngLat
                    });
                }
            });

            if (interactiveFeatures.length > 0) {
                this._stateManager.handleFeatureClicks(interactiveFeatures);
            } else {
                this._stateManager.clearAllSelections();
            }
        });

        // Mousemove handler
        this._map.on('mousemove', (e) => {
            this._handleMouseMove(e);
        });

        // Mouse leave handlers
        this._map.on('mouseleave', () => {
            this._stateManager.handleMapMouseLeave();
        });

        this._map.on('mouseout', () => {
            this._stateManager.handleMapMouseLeave();
        });

        this._globalHandlersAdded = true;
    }

    /**
     * Handle mouse move events
     */
    _handleMouseMove(e) {
        let features = [];
        try {
            features = this._map.queryRenderedFeatures(e.point);
        } catch (error) {
            if (error.message && error.message.includes('out of range source coordinates for DEM data')) {
                this._stateManager.handleMapMouseLeave();
                this._updateCursor(false);
                return;
            } else {
                console.error('[MapFeatureControl] Error querying rendered features:', error);
                throw error;
            }
        }

        const layerGroups = new Map();
        features.forEach(feature => {
            const layerId = this._findLayerIdForFeature(feature);

            if (layerId && this._stateManager.isLayerInteractive(layerId)) {
                if (!layerGroups.has(layerId)) {
                    layerGroups.set(layerId, []);
                }

                const mapLayer = this._map.getLayer(feature.layer.id);
                const layerType = mapLayer?.type;

                layerGroups.get(layerId).push({
                    feature,
                    layerId,
                    layerType,
                    lngLat: e.lngLat
                });
            }
        });

        const interactiveFeatures = [];
        layerGroups.forEach((featuresInLayer, layerId) => {
            const fillFeatures = featuresInLayer.filter(f => f.layerType === 'fill');
            const lineFeatures = featuresInLayer.filter(f => f.layerType === 'line');

            let selectedFeature = null;
            if (fillFeatures.length > 0) {
                selectedFeature = fillFeatures[0];
            } else if (lineFeatures.length > 0) {
                selectedFeature = lineFeatures[0];
            } else {
                selectedFeature = featuresInLayer[0];
            }

            if (selectedFeature) {
                interactiveFeatures.push({
                    feature: selectedFeature.feature,
                    layerId: selectedFeature.layerId,
                    lngLat: selectedFeature.lngLat
                });
            }
        });

        this._updateCursor(interactiveFeatures.length > 0);
        this._stateManager.handleFeatureHovers(interactiveFeatures, e.lngLat);
    }

    /**
     * Find which registered layer a feature belongs to
     */
    _findLayerIdForFeature(feature) {
        if (!feature.layer || !feature.layer.id) return null;

        if (feature.layer.metadata && feature.layer.metadata.groupId) {
            const groupId = feature.layer.metadata.groupId;
            if (this._stateManager.isLayerInteractive(groupId)) {
                return groupId;
            }
        }

        const actualLayerId = feature.layer.id;
        const activeLayers = this._stateManager.getActiveLayers();

        for (const [layerId, layerData] of activeLayers) {
            const layerConfig = layerData.config;

            if (actualLayerId === layerId) {
                return layerId;
            }

            if (actualLayerId.startsWith(layerId + '-') || actualLayerId.startsWith(layerId + ' ')) {
                return layerId;
            }

            if (layerConfig.type === 'vector' && actualLayerId.startsWith(`vector-layer-${layerId}`)) {
                return layerId;
            }

            if (layerConfig.type === 'geojson' && actualLayerId.startsWith(`geojson-${layerId}-`)) {
                return layerId;
            }

            if (layerConfig.type === 'csv' && actualLayerId.startsWith(`csv-${layerId}-`)) {
                return layerId;
            }
        }

        for (const [layerId, layerData] of activeLayers) {
            const layerConfig = layerData.config;
            const matchingLayerIds = this._getMatchingLayerIds(layerConfig);
            if (matchingLayerIds.includes(actualLayerId)) {
                return layerId;
            }
        }

        return null;
    }

    /**
     * Get matching layer IDs for a layer config
     */
    _getMatchingLayerIds(layerConfig) {
        const style = this._map.getStyle();
        if (!style.layers) return [];

        const layerId = layerConfig.id;
        const matchingIds = [];

        const directMatches = style.layers.filter(l => l.id === layerId).map(l => l.id);
        matchingIds.push(...directMatches);

        const prefixMatches = style.layers
            .filter(l => l.id.startsWith(layerId + '-') || l.id.startsWith(layerId + ' '))
            .map(l => l.id);
        matchingIds.push(...prefixMatches);

        const hasDirectMatches = directMatches.length > 0 || prefixMatches.length > 0;

        if (!hasDirectMatches && layerConfig.sourceLayer) {
            const sourceLayerMatches = style.layers
                .filter(l => {
                    if (l['source-layer'] !== layerConfig.sourceLayer) return false;
                    return l.id.includes(layerId) || l.id === layerId;
                })
                .map(l => l.id);
            matchingIds.push(...sourceLayerMatches);
        }

        return matchingIds;
    }

    /**
     * Update cursor style
     */
    _updateCursor(hasFeatures) {
        if (this._map) {
            this._map.getCanvas().style.cursor = hasFeatures ? 'pointer' : '';
        }
    }

    /**
     * Adjust panel height based on content
     */
    _adjustPanelHeight(data) {
        if (!this._panel) return;

        const { overlayOpen, basemapOpen, overlayCount, basemapCount } = data;
        const headerHeight = 48;
        const sectionHeaderHeight = 40;
        const cardHeight = 60;
        const padding = 20;

        let totalHeight = headerHeight + (sectionHeaderHeight * 2) + padding;

        if (overlayOpen && overlayCount > 0) {
            totalHeight += Math.min(overlayCount * cardHeight, 300);
        }

        if (basemapOpen && basemapCount > 0) {
            totalHeight += Math.min(basemapCount * cardHeight, 200);
        }

        const isMobile = window.innerWidth <= 768;
        const maxHeight = isMobile ? window.innerHeight * 0.4 : window.innerHeight * 0.85;
        const minHeight = headerHeight + (sectionHeaderHeight * 2) + padding;

        const finalHeight = Math.min(Math.max(totalHeight, minHeight), maxHeight);

        this._panel.style.height = `${finalHeight}px`;
        this._panel.style.maxHeight = `${maxHeight}px`;
    }

    /**
     * Check if inspect mode is enabled (for state manager compatibility)
     */
    isInspectModeEnabled() {
        return true; // Always enabled for iframe version
    }
}

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
        this._isIframeReady = false;
        this._messageQueue = [];
        this._inspectorInitialized = false;

        // Click popup state
        this._clickPopup = null;
        this._showClickPopups = false;

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
        this._setupMapEventListeners();
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
        button.style.cssText = `
            width: 31px;
            height: 31px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
        `;
        button.innerHTML = '<span style="font-size: 20px; line-height: 1;"><sl-icon name="layers" style="font-size: 14px;" aria-hidden="true" library="default"></sl-icon></span>';

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
        const initialHeight = isMobile ? '40vh' : '500px';
        const maxHeight = isMobile ? '40vh' : '85vh';
        const panelWidth = isMobile ? '100%' : this.options.maxWidth;
        const panelMaxWidth = isMobile ? '100%' : 'calc(100vw - 70px)';
        const panelRight = isMobile ? '0' : '8px';

        this._panel.style.cssText = `
            display: none;
            position: fixed;
            top: 52px;
            right: ${panelRight};
            width: ${panelWidth};
            max-width: ${panelMaxWidth};
            height: ${initialHeight};
            max-height: ${maxHeight};
            background: #111827;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            overflow: hidden;
            transition: height 0.3s ease;
        `;

        // Create iframe
        this._iframe = document.createElement('iframe');
        this._iframe.src = 'map-inspector.html';
        this._iframe.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
            pointer-events: auto;
        `;

        this._panel.appendChild(this._iframe);

        // Create loading overlay in parent
        this._loadingOverlay = document.createElement('div');
        this._loadingOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: #111827;
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 20;
            flex-direction: column;
            gap: 16px;
            border-radius: 8px;
        `;

        const spinner = document.createElement('div');
        spinner.style.cssText = `
            width: 32px;
            height: 32px;
            border: 3px solid #374151;
            border-top-color: #3b82f6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        `;

        const loadingText = document.createElement('div');
        loadingText.style.cssText = 'color: #9ca3af; font-size: 12px;';
        loadingText.textContent = 'Loading inspector...';

        this._loadingOverlay.appendChild(spinner);
        this._loadingOverlay.appendChild(loadingText);
        this._panel.appendChild(this._loadingOverlay);

        // Create drag handle overlay (invisible, sits on top of iframe header "Map Layers" text only)
        this._dragHandle = document.createElement('div');
        this._dragHandle.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 120px;
            height: 48px;
            cursor: move;
            z-index: 10;
            background: transparent;
        `;
        this._panel.appendChild(this._dragHandle);

        // Setup drag on the panel itself
        this._setupPanelDrag();

        // Close panel when clicking outside
        setTimeout(() => {
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.map-feature-panel, .mapboxgl-ctrl-icon, .mapboxgl-canvas-container, .map-browser-panel, #map-browser-modal, .mapboxgl-ctrl-group')) {
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
     * Setup drag functionality on the panel
     */
    _setupPanelDrag() {
        let isDragging = false;
        let currentX = 0;
        let currentY = 0;
        let initialX = 0;
        let initialY = 0;
        let xOffset = 0;
        let yOffset = 0;

        const dragStart = (e) => {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            isDragging = true;

            // Disable iframe pointer events during drag
            this._iframe.style.pointerEvents = 'none';
            this._dragHandle.style.cursor = 'grabbing';
        };

        const dragEnd = () => {
            initialX = currentX;
            initialY = currentY;
            isDragging = false;

            // Re-enable iframe pointer events
            this._iframe.style.pointerEvents = 'auto';
            this._dragHandle.style.cursor = 'move';
        };

        const drag = (e) => {
            if (isDragging) {
                e.preventDefault();

                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                xOffset = currentX;
                yOffset = currentY;

                this._panel.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
            }
        };

        // Listen on the drag handle overlay
        this._dragHandle.addEventListener('mousedown', dragStart);
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('mousemove', drag);

        // Store listeners for cleanup
        this._panelDragListeners = {
            dragStart,
            dragEnd,
            drag
        };
    }

    /**
     * Setup map event listeners to send updates to iframe
     */
    _setupMapEventListeners() {
        if (!this._map) return;

        // Send bounds updates when map moves
        const sendBoundsUpdate = () => {
            if (!this._iframe || !this._iframe.contentWindow) return;

            const mapBounds = this._map.getBounds();
            const bounds = [
                mapBounds.getWest(),
                mapBounds.getSouth(),
                mapBounds.getEast(),
                mapBounds.getNorth()
            ];

            this._iframe.contentWindow.postMessage({
                type: 'bounds-update',
                bounds: bounds
            }, '*');
        };

        // Listen for map move end events
        this._map.on('moveend', sendBoundsUpdate);
        this._map.on('zoomend', sendBoundsUpdate);

        // Store the listener for cleanup
        this._boundsUpdateListener = sendBoundsUpdate;
    }

    /**
     * Setup message listener for iframe communication
     */
    _setupMessageListener() {
        window.addEventListener('message', async (event) => {
            if (event.data.type === 'inspector-ready') {
                this._isIframeReady = true;
                this._inspectorInitialized = true;
                this._flushMessageQueue();

                // Hide loading overlay when inspector is ready
                if (this._loadingOverlay) {
                    this._loadingOverlay.style.display = 'none';
                }
            } else if (event.data.type === 'request-inspector-data') {
                this._sendDataToIframe();
            } else if (event.data.type === 'isolate-layer') {
                this._isolateLayer(event.data.layerId, event.data.isBasemap);
            } else if (event.data.type === 'clear-layer-isolation') {
                this._clearLayerIsolation();
            } else if (event.data.type === 'update-layer-opacity') {
                this._updateLayerOpacity(event.data.layerId, event.data.opacity);
            } else if (event.data.type === 'zoom-to-layer') {
                this._zoomToLayer(event.data.layerId);
            } else if (event.data.type === 'remove-layer') {
                await this._removeLayer(event.data.layerId);
            } else if (event.data.type === 'inspector-height-change') {
                this._adjustPanelHeight(event.data);
            } else if (event.data.type === 'close-panel') {
                this._hidePanel();
            } else if (event.data.type === 'toggle-popups') {
                this._showClickPopups = event.data.enabled;
                if (!this._showClickPopups && this._clickPopup) {
                    this._clickPopup.remove();
                    this._clickPopup = null;
                }
            } else if (event.data.type === 'clear-all-selections') {
                if (this._stateManager) {
                    this._stateManager.clearAllSelections();
                }
            } else if (event.data.type === 'open-layer-info') {
                this._openLayerInfo(event.data.layer);
            } else if (event.data.type === 'hover-isolate-feature') {
                this._hoverIsolateFeature(event.data.layerId, event.data.featureId, event.data.feature);
            } else if (event.data.type === 'clear-feature-isolation') {
                this._clearFeatureIsolation(event.data.layerId);
            } else if (event.data.type === 'fit-bounds') {
                this._fitBounds(event.data.bounds, event.data.padding);
            } else if (event.data.type === 'zoom-to-selection') {
                this._zoomToSelection();
            } else if (event.data.type === 'zoom-to-feature') {
                this._zoomToFeature(event.data.layerId, event.data.featureId, event.data.feature);
            } else if (event.data.type === 'request-map-layer-stack') {
                this._sendMapLayerStack();
            }
        });
    }

    /**
     * Send actual map layer stack to inspector for debugging
     */
    _sendMapLayerStack() {
        if (!this._iframe || !this._iframe.contentWindow || !this._map) return;

        const style = this._map.getStyle();
        if (!style || !style.layers) return;

        // Get all layers from the map style
        const layerStack = style.layers.map(layer => ({
            id: layer.id,
            type: layer.type,
            source: layer.source,
            'source-layer': layer['source-layer'],
            metadata: layer.metadata
        }));

        this._iframe.contentWindow.postMessage({
            type: 'map-layer-stack',
            layerStack: layerStack
        }, '*');
    }

    /**
     * Open layer information modal
     */
    _openLayerInfo(layer) {
        const modal = document.getElementById('layer-info-modal');
        const iframe = document.getElementById('layer-info-iframe');

        if (!modal || !iframe) {
            console.warn('Layer info modal not found in page');
            return;
        }

        const layerJson = encodeURIComponent(JSON.stringify(layer));
        iframe.src = `map-information.html?layer=${layerJson}`;
        modal.style.display = 'block';

        const closeHandler = (e) => {
            if (e.data.type === 'close-layer-info') {
                modal.style.display = 'none';
                iframe.src = '';
                window.removeEventListener('message', closeHandler);
            }
        };

        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                modal.style.display = 'none';
                iframe.src = '';
                document.removeEventListener('keydown', keyHandler);
                window.removeEventListener('message', closeHandler);
            }
        };

        window.addEventListener('message', closeHandler);
        document.addEventListener('keydown', keyHandler);
    }

    /**
     * Hover isolate a specific feature on the map
     */
    _hoverIsolateFeature(layerId, featureId, feature) {
        if (!this._stateManager) return;

        this._stateManager.setFeatureHoverState(layerId, featureId, true);
    }

    /**
     * Clear feature isolation hover state
     */
    _clearFeatureIsolation(layerId) {
        if (!this._stateManager) return;

        this._stateManager.clearLayerHoverStates(layerId);
    }

    /**
     * Fit map to bounds
     */
    _fitBounds(bounds, padding = 50) {
        if (!this._map || !bounds) return;

        this._map.fitBounds(bounds, {
            padding: padding,
            duration: 1000
        });
    }

    /**
     * Zoom to all selected features using state manager data
     */
    _zoomToSelection() {
        if (!this._stateManager || !this._map) return;

        try {
            // Check if turf is available
            if (typeof turf === 'undefined') {
                console.error('[MapFeatureControl] Turf.js not loaded');
                return;
            }

            // Collect all selected features from state manager
            const features = [];
            const activeLayers = this._stateManager.getActiveLayers();

            activeLayers.forEach((layerData, layerId) => {
                layerData.features.forEach((featureState, featureId) => {
                    if (featureState.isSelected && featureState.feature) {
                        const feature = featureState.feature;

                        // Validate feature has geometry with coordinates
                        if (feature.geometry &&
                            feature.geometry.coordinates &&
                            Array.isArray(feature.geometry.coordinates)) {
                            features.push(feature);
                        }
                    }
                });
            });

            if (features.length === 0) {
                console.warn('[MapFeatureControl] No features with valid geometries to zoom to');
                return;
            }

            // Use Turf.js to calculate bounding box
            const featureCollection = turf.featureCollection(features);
            const bbox = turf.bbox(featureCollection);

            // Fit map to bounds
            this._map.fitBounds([
                [bbox[0], bbox[1]],
                [bbox[2], bbox[3]]
            ], {
                padding: 50,
                duration: 1000
            });
        } catch (error) {
            console.error('[MapFeatureControl] Error zooming to selection:', error);
        }
    }

    /**
     * Zoom to a specific feature using its geometry
     */
    _zoomToFeature(layerId, featureId, feature) {
        if (!this._map || !this._stateManager) return;

        try {
            if (typeof turf === 'undefined') {
                console.error('[MapFeatureControl] Turf.js not loaded');
                return;
            }

            // Get the feature from state manager which has full geometry
            const activeLayers = this._stateManager.getActiveLayers();
            const layerData = activeLayers.get(layerId);

            if (!layerData || !layerData.features) {
                console.warn('[MapFeatureControl] Layer not found in state manager');
                return;
            }

            const featureState = layerData.features.get(featureId);
            if (!featureState || !featureState.feature) {
                console.warn('[MapFeatureControl] Feature not found in state manager');
                return;
            }

            const featureWithGeometry = featureState.feature;

            if (!featureWithGeometry.geometry || !featureWithGeometry.geometry.coordinates) {
                console.warn('[MapFeatureControl] Feature has no valid geometry');
                return;
            }

            const bbox = turf.bbox(featureWithGeometry);

            this._map.fitBounds([
                [bbox[0], bbox[1]],
                [bbox[2], bbox[3]]
            ], {
                padding: 50,
                duration: 1000
            });
        } catch (error) {
            console.error('[MapFeatureControl] Error zooming to feature:', error);
        }
    }

    /**
     * Send data to iframe
     */
    _sendDataToIframe() {
        if (!this._iframe || !this._iframe.contentWindow) return;

        const activeLayers = this._getActiveLayersFromConfig();
        const layerConfigs = [];

        for (const [layerId, layerData] of activeLayers.entries()) {
            const config = { ...layerData.config };

            // Always resolve tags from registry to ensure cascaded tags are included
            if (window.layerRegistry) {
                const registryLayer = window.layerRegistry.getLayer(config.id);

                if (registryLayer && registryLayer.tags) {
                    if (!config.tags) {
                        config.tags = registryLayer.tags;
                    } else if (Array.isArray(config.tags) && Array.isArray(registryLayer.tags)) {
                        // Merge tags from registry with config tags
                        config.tags = [...new Set([...config.tags, ...registryLayer.tags])];
                    }
                }
            }

            layerConfigs.push(config);
        }

        // Sort layerConfigs by URL order to ensure inspector displays them correctly
        const urlParams = new URLSearchParams(window.location.search);
        const layersParam = urlParams.get('layers');
        if (layersParam) {
            // Parse URL layers to get order
            const urlLayerIds = layersParam.split(',').map(id => id.trim());
            const urlOrderMap = new Map();
            urlLayerIds.forEach((id, index) => {
                urlOrderMap.set(id, index);
            });

            // Sort layerConfigs by URL order
            layerConfigs.sort((a, b) => {
                const aOrder = urlOrderMap.get(a.id);
                const bOrder = urlOrderMap.get(b.id);

                // If both have URL order, sort by it
                if (aOrder !== undefined && bOrder !== undefined) {
                    return aOrder - bOrder;
                }
                // Layers not in URL go to the end
                if (aOrder !== undefined) return -1;
                if (bOrder !== undefined) return 1;
                return 0;
            });
        }

        // Get current map bounds
        let bounds = null;
        if (this._map) {
            const mapBounds = this._map.getBounds();
            bounds = [
                mapBounds.getWest(),
                mapBounds.getSouth(),
                mapBounds.getEast(),
                mapBounds.getNorth()
            ];
        }

        // Get URL search params from parent window
        const urlSearchParams = window.location.search;

        this._iframe.contentWindow.postMessage({
            type: 'inspector-data',
            activeLayers: layerConfigs,
            layerRegistry: window.layerRegistry,
            bounds: bounds,
            urlSearchParams: urlSearchParams
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
                this._sendBatchHoverToIframe(data);
                break;
            case 'features-hover-cleared':
            case 'map-mouse-leave':
                this._clearHighlightInIframe();
                this._sendHoverClearedToIframe();
                break;
            case 'feature-click':
                // Clear previously selected features if any (happens when clicking without Cmd/Ctrl)
                if (data.clearedFeatures && data.clearedFeatures.length > 0) {
                    data.clearedFeatures.forEach(cleared => {
                        this._sendFeatureDeselectedToIframe(cleared.layerId, cleared.featureId);
                    });
                }

                this._sendFeatureSelectionToIframe(data.layerId, data.feature, data.featureId);
                this._showPanel(); // Auto-open panel when feature is clicked

                // Show click popup if enabled
                if (this._showClickPopups) {
                    this._showClickPopupForFeature(data);
                }
                break;
            case 'feature-click-multiple':
                // Clear previously selected features if any
                if (data.clearedFeatures && data.clearedFeatures.length > 0) {
                    data.clearedFeatures.forEach(cleared => {
                        this._sendFeatureDeselectedToIframe(cleared.layerId, cleared.featureId);
                    });
                }

                // Send all new selections
                data.selectedFeatures.forEach(selection => {
                    this._sendFeatureSelectionToIframe(selection.layerId, selection.feature, selection.featureId);
                });
                this._showPanel();

                // Show click popup for the first selected feature if enabled
                if (this._showClickPopups && data.selectedFeatures.length > 0) {
                    const firstFeature = data.selectedFeatures[0];
                    this._showClickPopupForFeature(firstFeature);
                }
                break;
            case 'feature-inspection-data':
                this._sendInspectionDataToIframe(data);

                // Update popup if it's showing and matches this feature
                if (this._clickPopup && this._clickPopup._layerId === data.layerId &&
                    this._clickPopup._featureId === data.featureId && data.customHTML) {
                    this._updateClickPopupCustomHTML(data.layerId, data.featureId, data.customHTML);
                }
                break;
            case 'selections-cleared':
                this._sendAllSelectionsClearedToIframe(data.clearedFeatures || []);

                // Remove popup when selections are cleared
                if (this._clickPopup) {
                    this._clickPopup.remove();
                    this._clickPopup = null;
                }
                break;
            case 'feature-deselected':
                this._sendFeatureDeselectedToIframe(data.layerId, data.featureId);
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
    _sendFeatureSelectionToIframe(layerId, feature, featureId) {
        if (!this._iframe || !this._iframe.contentWindow) return;

        const message = {
            type: 'feature-selected',
            layerId: layerId,
            feature: feature,
            featureId: featureId
        };

        this._sendMessageToIframe(message);

        // Also send to browser iframe if it exists
        if (window.browserControl && window.browserControl._iframe && window.browserControl._iframe.contentWindow) {
            window.browserControl._iframe.contentWindow.postMessage(message, '*');
        }
    }

    /**
     * Send inspection data (custom HTML) to iframe
     */
    _sendInspectionDataToIframe(data) {
        if (!this._iframe || !this._iframe.contentWindow) return;

        const message = {
            type: 'feature-inspection-data',
            layerId: data.layerId,
            featureId: data.featureId,
            customHTML: data.customHTML
        };

        this._sendMessageToIframe(message);

        // Also send to browser iframe if it exists
        if (window.browserControl && window.browserControl._iframe && window.browserControl._iframe.contentWindow) {
            window.browserControl._iframe.contentWindow.postMessage(message, '*');
        }
    }

    /**
     * Send selection cleared message to iframe for a specific layer
     */
    _sendSelectionClearedToIframe(layerId) {
        if (!this._iframe || !this._iframe.contentWindow) return;

        const message = {
            type: 'selection-cleared',
            layerId: layerId
        };

        this._iframe.contentWindow.postMessage(message, '*');

        // Also send to browser iframe if it exists
        if (window.browserControl && window.browserControl._iframe && window.browserControl._iframe.contentWindow) {
            window.browserControl._iframe.contentWindow.postMessage(message, '*');
        }
    }

    /**
     * Send all selections cleared message to iframe
     */
    _sendAllSelectionsClearedToIframe(clearedFeatures) {
        if (!this._iframe || !this._iframe.contentWindow) return;

        const message = {
            type: 'clear-all-selections',
            clearedFeatures: clearedFeatures
        };

        this._iframe.contentWindow.postMessage(message, '*');

        // Also send to browser iframe if it exists
        if (window.browserControl && window.browserControl._iframe && window.browserControl._iframe.contentWindow) {
            window.browserControl._iframe.contentWindow.postMessage(message, '*');
        }
    }

    /**
     * Send feature deselected message to iframe
     */
    _sendFeatureDeselectedToIframe(layerId, featureId) {
        if (!this._iframe || !this._iframe.contentWindow) return;

        const message = {
            type: 'feature-deselected',
            layerId: layerId,
            featureId: featureId
        };

        this._iframe.contentWindow.postMessage(message, '*');

        // Also send to browser iframe if it exists
        if (window.browserControl && window.browserControl._iframe && window.browserControl._iframe.contentWindow) {
            window.browserControl._iframe.contentWindow.postMessage(message, '*');
        }
    }

    /**
     * Send batch hover data to iframe
     */
    _sendBatchHoverToIframe(data) {
        if (!this._iframe || !this._iframe.contentWindow) return;

        const message = {
            type: 'features-batch-hover',
            hoveredFeatures: data.hoveredFeatures || [],
            affectedLayers: data.affectedLayers || [],
            lngLat: data.lngLat
        };

        this._iframe.contentWindow.postMessage(message, '*');

        // Also send to browser iframe if it exists
        if (window.browserControl && window.browserControl._iframe && window.browserControl._iframe.contentWindow) {
            window.browserControl._iframe.contentWindow.postMessage(message, '*');
        }
    }

    /**
     * Send hover cleared message to iframe
     */
    _sendHoverClearedToIframe() {
        if (!this._iframe || !this._iframe.contentWindow) return;

        const message = {
            type: 'map-mouse-leave'
        };

        this._iframe.contentWindow.postMessage(message, '*');

        // Also send to browser iframe if it exists
        if (window.browserControl && window.browserControl._iframe && window.browserControl._iframe.contentWindow) {
            window.browserControl._iframe.contentWindow.postMessage(message, '*');
        }
    }

    /**
     * Get active layers from layer control and state manager
     */
    _getActiveLayersFromConfig() {
        const activeLayers = new Map();

        // Get layers from layer control's state (includes style layers)
        if (window.layerControl && window.layerControl._state && window.layerControl._state.groups) {
            window.layerControl._state.groups.forEach(group => {
                // Check if layer is actually visible on the map
                if (this._isLayerVisible(group)) {
                    activeLayers.set(group.id, {
                        config: group,
                        interactive: group.type !== 'style' && group.type !== 'raster-style-layer'
                    });
                }
            });
        }

        // Also get layers from state manager for interactive status
        if (this._stateManager) {
            const stateManagerLayers = this._stateManager.getActiveLayers();
            stateManagerLayers.forEach((layerData, layerId) => {
                if (activeLayers.has(layerId)) {
                    // Update interactive status from state manager
                    activeLayers.get(layerId).interactive = true;
                } else {
                    // Add if not already present
                    activeLayers.set(layerId, layerData);
                }
            });
        }

        return activeLayers;
    }

    /**
     * Check if a layer is actually visible on the map
     */
    _isLayerVisible(layerConfig) {
        if (!this._map) return false;

        try {
            // For style layers, check the layer control's state
            // Style layers control existing base style layers and don't create new layers
            if (layerConfig.type === 'style') {
                // Check if layer is in the visible state from layer control
                if (window.layerControl && window.layerControl._state) {
                    const stateGroup = window.layerControl._state.groups.find(g => g.id === layerConfig.id);
                    // If initiallyChecked or if we have state tracking, consider it visible
                    // Style layers don't create map layers, so we rely on the layer control state
                    return stateGroup && (stateGroup.initiallyChecked || this._hasVisibleStyleLayers(layerConfig));
                }
                // Fallback: check if it has initiallyChecked
                return layerConfig.initiallyChecked === true;
            }

            // For raster-style-layer, check if matching layers exist and are visible
            if (layerConfig.type === 'raster-style-layer') {
                const style = this._map.getStyle();
                if (!style || !style.layers) return false;

                // Check if any map layer matches this config
                const matchingLayers = style.layers.filter(layer => {
                    return layer.id === layerConfig.id ||
                        layer.id.startsWith(layerConfig.id + '-') ||
                        layer.id.startsWith(layerConfig.id + ' ');
                });

                // If we found matching layers, check if at least one is visible
                if (matchingLayers.length > 0) {
                    return matchingLayers.some(layer => {
                        const visibility = this._map.getLayoutProperty(layer.id, 'visibility');
                        return visibility !== 'none';
                    });
                }
                return false;
            }

            // For other layer types, check if the layer/source exists and is visible
            const layer = this._map.getLayer(layerConfig.id);
            if (layer) {
                const visibility = this._map.getLayoutProperty(layerConfig.id, 'visibility');
                return visibility !== 'none';
            }

            // Check for prefixed layer IDs
            const style = this._map.getStyle();
            if (style && style.layers) {
                const matchingLayers = style.layers.filter(layer => {
                    return layer.id.startsWith(layerConfig.id + '-') ||
                        layer.id.startsWith(layerConfig.id + ' ') ||
                        layer.id.startsWith(`geojson-${layerConfig.id}`) ||
                        layer.id.startsWith(`vector-layer-${layerConfig.id}`) ||
                        layer.id.startsWith(`csv-${layerConfig.id}`);
                });

                if (matchingLayers.length > 0) {
                    return matchingLayers.some(layer => {
                        const visibility = this._map.getLayoutProperty(layer.id, 'visibility');
                        return visibility !== 'none';
                    });
                }
            }

            return false;
        } catch (error) {
            console.warn(`[MapFeatureControl] Error checking visibility for layer ${layerConfig.id}:`, error);
            return false;
        }
    }

    /**
     * Check if any of a style layer's source layers are visible
     */
    _hasVisibleStyleLayers(layerConfig) {
        if (!layerConfig.layers || !Array.isArray(layerConfig.layers)) {
            return false;
        }

        const style = this._map.getStyle();
        if (!style || !style.layers) return false;

        // Check if any source layers from the config are visible
        return layerConfig.layers.some(configLayer => {
            const sourceLayer = configLayer.sourceLayer;
            if (!sourceLayer) return false;

            // Find map layers that use this source layer
            const matchingLayers = style.layers.filter(layer => {
                return layer['source-layer'] === sourceLayer;
            });

            // Check if any are visible
            return matchingLayers.some(layer => {
                const visibility = this._map.getLayoutProperty(layer.id, 'visibility');
                return visibility !== 'none';
            });
        });
    }

    /**
     * Isolate a layer by hiding all others in the same section
     */
    _isolateLayer(layerId, isBasemap) {
        const mapboxAPI = this._getMapboxAPI();
        if (!mapboxAPI) return;

        const activeLayers = this._getActiveLayersFromConfig();

        for (const [id, layerData] of activeLayers.entries()) {
            if (id !== layerId) {
                const layerIsBasemap = layerData.config.tags &&
                    Array.isArray(layerData.config.tags) &&
                    layerData.config.tags.includes('basemap');

                if (layerIsBasemap === isBasemap) {
                    mapboxAPI.updateLayerGroupVisibility(id, layerData.config, false);
                }
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

        if (!layerData) {
            // Try to get layer from registry even if not active
            if (window.layerRegistry) {
                const registryLayer = window.layerRegistry.getLayer(layerId);
                if (registryLayer) {
                    this._zoomToLayerConfig(registryLayer);
                    return;
                }
            }
            return;
        }

        this._zoomToLayerConfig(layerData.config);
    }

    _zoomToLayerConfig(config) {
        let bbox = config.bbox;

        // Try atlas bbox if layer doesn't have one
        if (!bbox && config._sourceAtlas && window.layerRegistry) {
            const atlasMetadata = window.layerRegistry.getAtlasMetadata(config._sourceAtlas);
            if (atlasMetadata && atlasMetadata.bbox) {
                bbox = atlasMetadata.bbox;
            }
        }

        if (bbox && this._map) {
            // Parse bbox if it's a string "minLng,minLat,maxLng,maxLat"
            let parsedBbox;
            if (typeof bbox === 'string') {
                const parts = bbox.split(',').map(parseFloat);
                if (parts.length === 4) {
                    parsedBbox = [[parts[0], parts[1]], [parts[2], parts[3]]];
                }
            } else if (Array.isArray(bbox)) {
                if (bbox.length === 4) {
                    parsedBbox = [[bbox[0], bbox[1]], [bbox[2], bbox[3]]];
                }
            }

            if (!parsedBbox) {
                return;
            }

            // Check if current map center is within the bbox
            let preservedCenter = null;
            if (config.minzoom !== undefined) {
                const currentCenter = this._map.getCenter();
                const [minLng, minLat] = parsedBbox[0];
                const [maxLng, maxLat] = parsedBbox[1];

                const isWithinBounds =
                    currentCenter.lng >= minLng &&
                    currentCenter.lng <= maxLng &&
                    currentCenter.lat >= minLat &&
                    currentCenter.lat <= maxLat;

                if (isWithinBounds) {
                    preservedCenter = currentCenter;
                }
            }

            // First fit bounds to show the full extent
            this._map.fitBounds(parsedBbox, { padding: 50, duration: 1000 });

            // If minzoom is defined, set zoom to minzoom + 1 after fitBounds completes
            if (config.minzoom !== undefined) {
                setTimeout(() => {
                    const targetZoom = config.minzoom + 1;
                    const currentZoom = this._map.getZoom();
                    // Only zoom in if current zoom is less than target
                    if (currentZoom < targetZoom) {
                        // Use preserved center if available, otherwise use current center from fitBounds
                        const centerToUse = preservedCenter || this._map.getCenter();
                        this._map.easeTo({
                            center: centerToUse,
                            zoom: targetZoom,
                            duration: 500
                        });
                    }
                }, 1100); // Wait for fitBounds animation to complete (1000ms + buffer)
            }
        }
    }

    /**
     * Remove a layer
     */
    async _removeLayer(layerId) {
        const mapLayerControl = window.layerControl;
        if (!mapLayerControl) {
            console.warn('[MapFeatureControl] Layer control not available');
            return;
        }

        let groupIndex = mapLayerControl._state.groups.findIndex(g =>
            g.id === layerId || g._prefixedId === layerId || g._originalId === layerId
        );

        let actualLayerId = layerId;
        if (groupIndex === -1 && layerId.includes('-')) {
            const parts = layerId.split('-');
            const unprefixedId = parts.slice(1).join('-');

            groupIndex = mapLayerControl._state.groups.findIndex(g =>
                g.id === unprefixedId || g._prefixedId === layerId || g._originalId === unprefixedId
            );

            if (groupIndex !== -1) {
                actualLayerId = unprefixedId;
            }
        }

        if (groupIndex === -1) {
            console.warn(`[MapFeatureControl] Layer ${layerId} not found in layer control state`);
            return;
        }

        const groupElement = mapLayerControl._sourceControls[groupIndex];
        if (!groupElement) {
            console.warn(`[MapFeatureControl] UI element for layer ${actualLayerId} not found`);
            return;
        }

        const checkbox = groupElement.querySelector('.toggle-switch input[type="checkbox"]');
        if (checkbox && checkbox.checked) {
            checkbox.checked = false;
            $(groupElement).hide();
            await mapLayerControl._toggleLayerGroup(groupIndex, false);

            if (window.urlManager) {
                window.urlManager.updateURL();
            }
        }

        this._sendDataToIframe();
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
        // Only show loading overlay if inspector hasn't been initialized yet
        if (this._loadingOverlay && !this._inspectorInitialized) {
            this._loadingOverlay.style.display = 'flex';
        }

        this._panel.style.display = 'block';
        this._sendDataToIframe();

        setTimeout(() => {
            if (this._iframe && this._iframe.contentWindow) {
                this._iframe.contentWindow.postMessage({
                    type: 'request-height-update'
                }, '*');
            }
        }, 200);
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
            this._panel.style.width = '100%';
            this._panel.style.maxWidth = '100%';
            this._panel.style.maxHeight = '40vh';
            this._panel.style.left = 'auto';
            this._panel.style.right = '0';
        } else {
            this._panel.style.width = this.options.maxWidth;
            this._panel.style.maxWidth = 'calc(100vw - 70px)';
            this._panel.style.maxHeight = '85vh';
            this._panel.style.left = 'auto';
            this._panel.style.right = '8px';
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

        // Clean up drag listeners
        if (this._panelDragListeners && this._dragHandle) {
            this._dragHandle.removeEventListener('mousedown', this._panelDragListeners.dragStart);
            document.removeEventListener('mouseup', this._panelDragListeners.dragEnd);
            document.removeEventListener('mousemove', this._panelDragListeners.drag);
        }

        // Clean up map event listeners
        if (this._map && this._boundsUpdateListener) {
            this._map.off('moveend', this._boundsUpdateListener);
            this._map.off('zoomend', this._boundsUpdateListener);
        }
    }

    /**
     * Set up global interaction handlers for hover and click
     */
    _setupGlobalInteractionHandlers() {
        if (this._globalHandlersAdded) return;

        // Track touch/long-press for mobile
        let touchTimer = null;
        let touchStartPoint = null;
        let isLongPress = false;

        // Touch start handler for long-press detection
        this._map.on('touchstart', (e) => {
            if (!e.originalEvent.touches || e.originalEvent.touches.length !== 1) return;

            touchStartPoint = e.point;
            isLongPress = false;

            // Set timer for long press (500ms)
            touchTimer = setTimeout(() => {
                isLongPress = true;
                // Simulate Cmd/Ctrl press for long-press
                this._stateManager._isCmdCtrlPressed = true;
            }, 500);
        });

        // Touch move handler - cancel long press if moved too much
        this._map.on('touchmove', (e) => {
            if (touchTimer && touchStartPoint) {
                const dx = Math.abs(e.point.x - touchStartPoint.x);
                const dy = Math.abs(e.point.y - touchStartPoint.y);

                // Cancel if moved more than 10 pixels
                if (dx > 10 || dy > 10) {
                    clearTimeout(touchTimer);
                    touchTimer = null;
                    isLongPress = false;
                }
            }
        });

        // Touch end handler - reset state
        this._map.on('touchend', () => {
            if (touchTimer) {
                clearTimeout(touchTimer);
                touchTimer = null;
            }
            // Reset Cmd/Ctrl state after a short delay
            setTimeout(() => {
                if (isLongPress) {
                    this._stateManager._isCmdCtrlPressed = false;
                    isLongPress = false;
                }
            }, 100);
        });

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

        // Mousemove handler (skip on touch devices to avoid hover/selection conflicts)
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (!isTouchDevice) {
            this._map.on('mousemove', (e) => {
                this._handleMouseMove(e);
            });
        }

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

        const { overlayOpen, basemapOpen, overlayHeight, basemapHeight, statusBarVisible } = data;
        const headerHeight = 48;
        const sectionHeaderHeight = 40;
        const padding = 24;
        const statusBarHeight = statusBarVisible ? 44 : 0;

        let contentHeight = headerHeight + padding + statusBarHeight;

        contentHeight += sectionHeaderHeight;

        if (overlayOpen && overlayHeight) {
            contentHeight += overlayHeight + 8;
        }

        contentHeight += sectionHeaderHeight;

        if (basemapOpen && basemapHeight) {
            contentHeight += basemapHeight + 8;
        }

        const isMobile = window.innerWidth <= 768;
        const maxHeight = isMobile ? window.innerHeight * 0.4 : window.innerHeight * 0.85;

        const minHeight = isMobile ? 200 : 400;

        const finalHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

        this._panel.style.height = `${finalHeight}px`;
    }

    /**
     * Toggle popup display for hovered/selected features
     */
    _togglePopups(enabled) {
        // Store the preference
        this._showPopups = enabled;

        // If disabling, remove any existing popups
        if (!enabled) {
            this._removeAllPopups();
        }

        // Update the state manager or map to show/hide popups
        // This would integrate with the map's popup system
        if (window.mapFeatureControl) {
            window.mapFeatureControl.options.showHoverPopups = enabled;
        }
    }

    /**
     * Remove all popups from the map
     */
    _removeAllPopups() {
        // Get all popups and remove them
        const popups = document.querySelectorAll('.mapboxgl-popup');
        popups.forEach(popup => {
            const popupInstance = popup._popup;
            if (popupInstance) {
                popupInstance.remove();
            }
        });
    }

    /**
     * Show click popup for a feature
     */
    _showClickPopupForFeature(data) {
        if (!this._map) return;

        const { layerId, feature, featureId, lngLat } = data;

        // Remove existing popup
        if (this._clickPopup) {
            this._clickPopup.remove();
        }

        // Get layer config
        const activeLayers = this._getActiveLayersFromConfig();
        const layerData = activeLayers.get(layerId);
        if (!layerData) return;

        const layerConfig = layerData.config;

        // Create popup content
        const content = this._createClickPopupContent(layerId, feature, featureId, layerConfig);

        // Create and show popup
        this._clickPopup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            maxWidth: '350px',
            className: 'click-popup'
        })
            .setLngLat(lngLat)
            .setDOMContent(content)
            .addTo(this._map);

        // Store metadata for updates
        this._clickPopup._layerId = layerId;
        this._clickPopup._featureId = featureId;

        // Remove popup reference when closed
        this._clickPopup.on('close', () => {
            this._clickPopup = null;
        });
    }

    /**
     * Create popup content with standardized layout
     */
    _createClickPopupContent(layerId, feature, featureId, layerConfig) {
        const container = document.createElement('div');
        container.style.cssText = 'padding: 8px;';

        const properties = feature.properties || {};
        const inspect = layerConfig.inspect || {};

        // 1. Feature Heading
        const heading = document.createElement('div');
        heading.style.cssText = 'font-weight: 600; font-size: 14px; margin-bottom: 8px; color: #f3f4f6; border-bottom: 1px solid #374151; padding-bottom: 8px;';

        let headerLabel = 'Feature ID';
        let headerValue = featureId;

        if (inspect.title && inspect.label) {
            headerLabel = inspect.title;
            headerValue = properties[inspect.label] || featureId;
        }

        heading.innerHTML = `<div style="color: #9ca3af; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">${headerLabel}</div><div>${headerValue}</div>`;
        container.appendChild(heading);

        // 2. Custom HTML placeholder
        const customHTMLDiv = document.createElement('div');
        customHTMLDiv.id = `popup-custom-${layerId}-${featureId}`;
        customHTMLDiv.style.cssText = 'margin-bottom: 8px;';
        container.appendChild(customHTMLDiv);

        // 3. Metadata table
        if (inspect.fields && inspect.fields.length > 0) {
            const table = document.createElement('div');
            table.style.cssText = 'font-size: 12px;';

            inspect.fields.forEach((fieldName, index) => {
                const value = properties[fieldName];
                if (value !== null && value !== undefined && value !== '') {
                    const fieldTitle = inspect.fieldTitles?.[index] || fieldName;

                    const row = document.createElement('div');
                    row.style.cssText = 'display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid #374151;';

                    const key = document.createElement('div');
                    key.style.cssText = 'color: #9ca3af; min-width: 80px; flex-shrink: 0;';
                    key.textContent = fieldTitle;

                    const val = document.createElement('div');
                    val.style.cssText = 'color: #f3f4f6; flex: 1; word-break: break-word;';
                    val.textContent = String(value);

                    row.appendChild(key);
                    row.appendChild(val);
                    table.appendChild(row);
                }
            });

            container.appendChild(table);
        }

        return container;
    }

    /**
     * Update popup with custom HTML from inspection handler
     */
    _updateClickPopupCustomHTML(layerId, featureId, customHTML) {
        if (!this._clickPopup) return;

        const customHTMLDiv = this._clickPopup._content.querySelector(`#popup-custom-${layerId}-${featureId}`);
        if (customHTMLDiv && customHTML) {
            customHTMLDiv.innerHTML = customHTML;
            customHTMLDiv.style.display = 'block';
        }
    }

    /**
     * Check if inspect mode is enabled (for state manager compatibility)
     */
    isInspectModeEnabled() {
        return true; // Always enabled for iframe version
    }

    /**
     * Send message to iframe, queueing if iframe not ready
     */
    _sendMessageToIframe(message) {
        if (this._isIframeReady && this._iframe && this._iframe.contentWindow) {
            this._iframe.contentWindow.postMessage(message, '*');
        } else {
            this._messageQueue.push(message);
        }
    }

    /**
     * Flush queued messages to iframe
     */
    _flushMessageQueue() {
        while (this._messageQueue.length > 0) {
            const message = this._messageQueue.shift();
            if (this._iframe && this._iframe.contentWindow) {
                this._iframe.contentWindow.postMessage(message, '*');
            }
        }
    }
}

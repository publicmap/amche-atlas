/**
 * MapFeatureControl - Iframe-based version for layer inspection
 *
 * This control displays a toggle button and iframe panel for layer inspection.
 * Uses map-inspector.html for the UI instead of building it in JavaScript.
 */

import { MapMarkerManager } from './map-marker-manager.js';
import ConfigManager from './config-manager.js';

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
        this._markerManager = null;
        this._container = null;
        this._panel = null;
        this._iframe = null;
        this._config = null;
        this._globalHandlersAdded = false;
        this._isMapDragging = false;
        this._isIframeReady = false;
        this._messageQueue = [];
        this._inspectorInitialized = false;

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
        this._setupKeyboardListeners();
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

        // Initialize marker manager
        this._markerManager = new MapMarkerManager(this._map, this._stateManager);

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
     * Toggle "add to selection" mode. Shared by the inspector panel's own
     * toggle button and the right-click/long-press shortcut menu, so both
     * stay in sync with the marker manager's selection mode.
     */
    setAddSelectionMode(enabled) {
        if (this._markerManager) {
            this._markerManager.setSelectionMode(enabled ? 'add' : 'replace');
        }
        if (this._iframe && this._iframe.contentWindow) {
            this._iframe.contentWindow.postMessage({
                type: 'add-selection-mode-changed',
                enabled
            }, '*');
        }
    }

    isAddSelectionModeEnabled() {
        return this._markerManager?.getSelectionMode?.() === 'add';
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

        // Create iframe element but defer setting src until preload() or first
        // open. This keeps the inspector bundle off the critical render path —
        // the iframe loads map-inspector.html in the background once the map
        // is idle (see preload()), so the panel opens instantly when clicked.
        this._iframe = document.createElement('iframe');
        this._iframe.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
            pointer-events: auto;
        `;
        this._iframeSrcLoaded = false;

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
                if (!e.target.closest('.map-feature-panel, .mapboxgl-ctrl-icon, .mapboxgl-canvas-container, .map-browser-panel, #map-browser-modal, .mapboxgl-ctrl-group, .mapboxgl-popup, .selection-popup')) {
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

    _setupKeyboardListeners() {
        this._keydownListener = (event) => {
            if (event.key === 'Meta' || event.key === 'Control') {
                if (this._iframe && this._iframe.contentWindow) {
                    this._iframe.contentWindow.postMessage({
                        type: 'add-selection-mode-changed',
                        enabled: true
                    }, '*');
                }
            }
        };

        this._keyupListener = (event) => {
            if (event.key === 'Meta' || event.key === 'Control') {
                if (this._iframe && this._iframe.contentWindow) {
                    this._iframe.contentWindow.postMessage({
                        type: 'add-selection-mode-changed',
                        enabled: false
                    }, '*');
                }
            }
        };

        document.addEventListener('keydown', this._keydownListener);
        document.addEventListener('keyup', this._keyupListener);
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
            } else if (event.data.type === 'hover-isolate-layer') {
                this._hoverIsolateLayer(event.data.layerId, event.data.isBasemap);
            } else if (event.data.type === 'clear-hover-layer-isolation') {
                this._clearHoverLayerIsolation();
            } else if (event.data.type === 'update-layer-opacity') {
                this._updateLayerOpacity(event.data.layerId, event.data.opacity);
            } else if (event.data.type === 'toggle-compare') {
                this._toggleCompare(event.data.layerId, event.data.enabled);
            } else if (event.data.type === 'zoom-to-layer') {
                this._zoomToLayer(event.data.layerId);
            } else if (event.data.type === 'remove-layer') {
                await this._removeLayer(event.data.layerId);
            } else if (event.data.type === 'inspector-height-change') {
                this._adjustPanelHeight(event.data);
            } else if (event.data.type === 'close-panel') {
                this._hidePanel();
            } else if (event.data.type === 'clear-all-selections') {
                if (this._stateManager) {
                    this._stateManager.clearAllSelections();
                }
            } else if (event.data.type === 'set-add-selection-mode') {
                if (this._markerManager) {
                    this._markerManager.setSelectionMode(event.data.enabled ? 'add' : 'replace');
                }
            } else if (event.data.type === 'open-layer-info') {
                this._openLayerInfo(event.data.layer, { edit: event.data.edit });
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
            } else if (event.data.type === 'reorder-layers') {
                this._reorderLayers(event.data.overlayOrder || [], event.data.basemapOrder || []);
            }
        });
    }

    /**
     * Reorder layers in the map and URL to match new visual order from inspector drag.
     * overlayOrder / basemapOrder: layer IDs first=top visually.
     */
    _reorderLayers(overlayOrder, basemapOrder) {
        if (!this._map || !window.layerControl) return;

        const newVisualOrder = [...overlayOrder, ...basemapOrder];
        if (newVisualOrder.length === 0) return;

        // Reorder _state.groups and _sourceControls so URL serialization picks up the new order.
        // Active group positions are replaced in-place with the sorted groups; inactive groups stay.
        const groups = window.layerControl._state.groups;
        const controls = window.layerControl._sourceControls;

        const activePositions = [];
        const activeGroups = [];
        groups.forEach((g, i) => {
            if (newVisualOrder.includes(g.id) || newVisualOrder.includes(g._prefixedId)) {
                activePositions.push(i);
                activeGroups.push(g);
            }
        });

        const sortedGroups = [...activeGroups].sort((a, b) => {
            const aId = a.id || a._prefixedId;
            const bId = b.id || b._prefixedId;
            return newVisualOrder.indexOf(aId) - newVisualOrder.indexOf(bId);
        });

        // Capture original indices before any mutation
        const originalIndices = sortedGroups.map(g => groups.indexOf(g));
        const originalControls = controls ? originalIndices.map(i => controls[i]) : null;

        activePositions.forEach((pos, i) => {
            groups[pos] = sortedGroups[i];
            if (controls && originalControls) controls[pos] = originalControls[i];
        });

        // Reorder actual Mapbox layers.
        // Render order (bottom→top) = reversed basemaps then reversed overlays.
        const renderOrder = [
            ...[...basemapOrder].reverse(),
            ...[...overlayOrder].reverse()
        ];

        const styleLayers = this._map.getStyle()?.layers || [];

        for (const groupId of renderOrder) {
            const subLayerIds = styleLayers
                .filter(l => l.metadata?.groupId === groupId)
                .map(l => l.id);

            for (const subLayerId of subLayerIds) {
                try {
                    this._map.moveLayer(subLayerId);
                } catch (e) {
                    // layer may not exist yet
                }
            }
        }

        // Sync URL
        if (window.urlManager) {
            window.urlManager.updateURL({ updateLayers: true });
        }
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
    _openLayerInfo(layer, options = {}) {
        const modal = document.getElementById('layer-info-modal');
        const iframe = document.getElementById('layer-info-iframe');

        if (!modal || !iframe) {
            console.warn('Layer info modal not found in page');
            return;
        }

        const layerJson = encodeURIComponent(JSON.stringify(layer));
        const editParam = options.edit ? '&edit=true' : '';
        iframe.src = `map-information.html?layer=${layerJson}${editParam}`;
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
            // Fill in fallback title/description/attribution derived from the
            // layer type and source URL so configs missing this metadata (e.g.
            // a minimal inline layer passed via the ?layers= URL param) still
            // display fully in the inspector.
            const config = ConfigManager.applyDefaultMetadata({ ...layerData.config });

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

            // Sort layerConfigs by URL order. Dynamic shorthand layers (e.g.
            // "allmaps:<id>") resolve to a different `.id` (e.g. "allmaps-<id>")
            // than the literal URL token, so match on `_originalJson` first —
            // it preserves the exact token that was in the `layers=` param.
            const getUrlOrder = (config) => {
                const originalOrder = urlOrderMap.get(config._originalJson);
                return originalOrder !== undefined ? originalOrder : urlOrderMap.get(config.id);
            };

            layerConfigs.sort((a, b) => {
                const aOrder = getUrlOrder(a);
                const bOrder = getUrlOrder(b);

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
                break;
            case 'feature-inspection-data':
                this._sendInspectionDataToIframe(data);
                break;
            case 'selections-cleared':
                this._sendAllSelectionsClearedToIframe(data.clearedFeatures || []);
                break;
            case 'feature-deselected':
                this._sendFeatureDeselectedToIframe(data.layerId, data.featureId);
                break;
            case 'selection-cleared':
                this._sendLayerSelectionsClearedToIframe(data.layerId);
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

    _sendLayerSelectionsClearedToIframe(layerId) {
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
            // The layer control checkbox is the authoritative signal for whether a
            // layer is active. It is the same source of truth url-manager uses to
            // build the `layers=` URL param, so consulting it here guarantees the
            // inspector list always matches the URL. It also avoids false positives
            // from the prefix-based map-layer matching below — a generic group id
            // (e.g. "vector-layer") would otherwise match unrelated map layers like
            // "vector-layer-osm-railways" and appear active when it isn't.
            if (window.layerControl && window.layerControl._state && window.layerControl._sourceControls) {
                const groupIndex = window.layerControl._state.groups.findIndex(g =>
                    g.id === layerConfig.id || g._prefixedId === layerConfig.id
                );
                if (groupIndex !== -1) {
                    const controlElement = window.layerControl._sourceControls[groupIndex];
                    if (controlElement) {
                        const checkbox = controlElement.querySelector('.toggle-switch input[type="checkbox"]');
                        if (checkbox) {
                            return checkbox.checked;
                        }
                    }
                }
            }

            // For style layers without a resolvable control, fall back to checking
            // whether the underlying base-style layers are visible.
            if (layerConfig.type === 'style') {
                return this._hasVisibleStyleLayers(layerConfig);
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
     * Get all user-toggled-on layers based on checkbox state, regardless of
     * current map visibility. Needed for isolation logic so we don't lose track
     * of layers that the user has enabled but are currently hidden by a prior
     * isolation.
     */
    _getToggledOnLayers() {
        const layers = new Map();
        if (!window.layerControl || !window.layerControl._state?.groups || !window.layerControl._sourceControls) {
            return layers;
        }

        window.layerControl._state.groups.forEach((group, index) => {
            const controlElement = window.layerControl._sourceControls[index];
            if (!controlElement) return;

            const checkbox = controlElement.querySelector('.toggle-switch input[type="checkbox"]');
            if (checkbox && checkbox.checked) {
                layers.set(group.id, { config: group });
            }
        });

        return layers;
    }

    /**
     * Persistent isolation (click): set state and apply.
     * If a hover-isolation is currently active, the persistent state is just
     * recorded — the new persistent isolation takes effect when hover ends.
     * This avoids the map briefly flashing the wrong layer when the user
     * clicks while their cursor is still over a card.
     */
    _isolateLayer(layerId, isBasemap) {
        this._persistentIsolation = { layerId, isBasemap };
        if (this._hoverIsolation) return;
        this._applyIsolation(layerId, isBasemap);
    }

    /**
     * Clear persistent isolation (click).
     */
    _clearLayerIsolation() {
        this._persistentIsolation = null;
        if (this._hoverIsolation) return;
        this._applyClearIsolation();
    }

    /**
     * Temporary isolation while hovering a layer card in the inspector.
     * On hover-leave, the prior persistent isolation (if any) is restored.
     */
    _hoverIsolateLayer(layerId, isBasemap) {
        if (this._hoverIsolation && this._hoverIsolation.layerId === layerId) return;
        this._hoverIsolation = { layerId, isBasemap };
        this._applyIsolation(layerId, isBasemap);
    }

    _clearHoverLayerIsolation() {
        if (!this._hoverIsolation) return;
        this._hoverIsolation = null;

        if (this._persistentIsolation) {
            this._applyIsolation(this._persistentIsolation.layerId, this._persistentIsolation.isBasemap);
        } else {
            this._applyClearIsolation();
        }
    }

    /**
     * Hide all toggled-on siblings in the same section as layerId.
     * Always clears prior isolation first so we have a clean baseline —
     * otherwise sibling layers hidden by a previous isolation stay invisible
     * to _getToggledOnLayers' loop and we leave the section dark.
     */
    _applyIsolation(layerId, isBasemap) {
        const mapboxAPI = this._getMapboxAPI();
        if (!mapboxAPI) return;

        this._applyClearIsolation();

        const activeLayers = this._getToggledOnLayers();
        for (const [id, layerData] of activeLayers.entries()) {
            if (id === layerId) continue;

            const layerIsBasemap = layerData.config.tags &&
                Array.isArray(layerData.config.tags) &&
                layerData.config.tags.includes('basemap');

            if (layerIsBasemap === isBasemap) {
                mapboxAPI.updateLayerGroupVisibility(id, layerData.config, false);
            }
        }
    }

    _applyClearIsolation() {
        const mapboxAPI = this._getMapboxAPI();
        if (!mapboxAPI) return;

        const activeLayers = this._getToggledOnLayers();
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
            // Set config.opacity first, then apply with a 1.0 multiplier — the
            // mapbox-api opacity setters treat the passed value as a multiplier
            // on top of config.opacity, so passing the new slider value as the
            // multiplier would compound with the previous config.opacity.
            layerData.config.opacity = opacity;
            mapboxAPI.updateLayerOpacity(layerId, layerData.config, 1.0);

            // Update URL if urlManager is available
            if (window.urlManager) {
                window.urlManager.updateURL({ updateLayers: true });
            }
        }
    }

    /**
     * Toggle swipe-comparison for a layer. The main map (with all current
     * layers) is the "before" side; a cloned map showing only the selected
     * layer over the basemap is the "after" side. Only one layer may be
     * compared at a time, so enabling a new one tears down the previous.
     */
    async _toggleCompare(layerId, enabled) {
        if (enabled) {
            await this._enableCompare(layerId);
        } else if (this._compareLayerId === layerId) {
            this._disableCompare();
        }
    }

    /**
     * Lazily load the mapbox-gl-compare plugin (attaches mapboxgl.Compare).
     */
    _loadCompareLib() {
        if (window.mapboxgl && window.mapboxgl.Compare) return Promise.resolve();
        if (this._compareLibPromise) return this._compareLibPromise;

        this._compareLibPromise = new Promise((resolve, reject) => {
            const cssHref = 'https://cdn.jsdelivr.net/npm/mapbox-gl-compare@0.4.2/dist/mapbox-gl-compare.css';
            if (!document.querySelector(`link[href="${cssHref}"]`)) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = cssHref;
                document.head.appendChild(link);
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/mapbox-gl-compare@0.4.2/dist/mapbox-gl-compare.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load mapbox-gl-compare'));
            document.head.appendChild(script);
        });

        return this._compareLibPromise;
    }

    /**
     * Build the set of group IDs that are tagged as basemaps.
     */
    _getBasemapGroupIds() {
        const ids = new Set();
        if (window.layerControl && window.layerControl._state && window.layerControl._state.groups) {
            window.layerControl._state.groups.forEach(group => {
                if (Array.isArray(group.tags) && group.tags.includes('basemap')) {
                    ids.add(group.id);
                    if (group._prefixedId) ids.add(group._prefixedId);
                }
            });
        }
        return ids;
    }

    async _enableCompare(layerId) {
        if (!this._map || !window.mapboxgl) return;

        // Only one comparison at a time — tear down any existing one first.
        if (this._compare) {
            this._disableCompare();
        }

        // Claim the active slot before the (possibly async) lib load so a
        // toggle-off or a switch to another layer mid-load can supersede us.
        this._compareLayerId = layerId;

        try {
            await this._loadCompareLib();
        } catch (e) {
            console.error('[MapFeatureControl]', e);
            this._notifyCompareDisabled();
            return;
        }

        // Superseded while the lib was loading (toggled off or switched layer).
        if (this._compareLayerId !== layerId) return;

        const mainContainer = this._map.getContainer();
        const parent = mainContainer.parentNode;
        if (!parent) return;

        // Build the "after" style: keep base style layers, basemap overlays and
        // the selected layer's sublayers; drop every other overlay group.
        const style = this._map.getStyle();
        const basemapGroupIds = this._getBasemapGroupIds();
        const keepLayer = (l) => {
            const gid = l.metadata && l.metadata.groupId;
            if (!gid) return true;
            if (gid === layerId) return true;
            return basemapGroupIds.has(gid);
        };
        const afterStyle = { ...style, layers: (style.layers || []).filter(keepLayer) };

        // Create the "after" map container, overlaying the main map exactly.
        const afterContainer = document.createElement('div');
        afterContainer.className = 'compare-after-map';
        afterContainer.style.cssText = 'position:absolute; top:0; bottom:0; left:0; right:0; z-index:1;';
        // clip (used by mapbox-gl-compare) only applies to positioned elements.
        this._compareMainPrevPosition = mainContainer.style.position;
        mainContainer.style.position = 'absolute';
        parent.appendChild(afterContainer);

        const afterMap = new window.mapboxgl.Map({
            container: afterContainer,
            style: afterStyle,
            center: this._map.getCenter(),
            zoom: this._map.getZoom(),
            bearing: this._map.getBearing(),
            pitch: this._map.getPitch(),
            interactive: true,
            attributionControl: false
        });

        // Mirror the before map's 3D/terrain view state (terrain, fog, projection,
        // field-of-view, wireframe) onto the after map once it has loaded. These
        // aren't all carried by the cloned style — fov and the wireframe flag are
        // runtime-only — so set them explicitly.
        if (afterMap.loaded()) {
            this._syncAfterMapView(afterMap);
        } else {
            afterMap.once('load', () => this._syncAfterMapView(afterMap));
        }

        this._compare = new window.mapboxgl.Compare(this._map, afterMap, parent, {});
        this._afterMap = afterMap;
        this._afterContainer = afterContainer;
        this._compareLayerId = layerId;

        // mapbox-gl-compare syncs camera (center/zoom/bearing/pitch) on move,
        // but terrain-3d-control mutates terrain/fog/fov/wireframe directly on
        // the before map with no event we can listen for. Register a callback
        // so those changes re-sync onto the after map while compare is active.
        if (window.terrain3DControl && window.terrain3DControl.setSyncCallback) {
            window.terrain3DControl.setSyncCallback(() => {
                if (this._afterMap) this._syncAfterMapView(this._afterMap);
            });
        }

        // The layer now lives on the "after" map only — hide it on the main
        // (before) map so it isn't shown on both sides. Restored on teardown.
        const mapboxAPI = this._getMapboxAPI();
        const layerData = this._getActiveLayersFromConfig().get(layerId);
        if (mapboxAPI && layerData) {
            this._compareHiddenConfig = layerData.config;
            mapboxAPI.updateLayerGroupVisibility(layerId, layerData.config, false);
        }

        // The before map container is clipped by the compare swiper and the
        // after map overlays it, so any UI living inside it (mapbox controls,
        // inspector / 3D panels) would be clipped or painted over. Lift those
        // overlays out into the comparison parent, above both maps and the
        // swiper, and restore them on teardown. The canvas stays put.
        this._compareLiftedNodes = [];
        const liftNode = (node) => {
            if (!node) return;
            this._compareLiftedNodes.push({ node, parentNode: node.parentNode, zIndex: node.style.zIndex });
            node.style.zIndex = '30';
            parent.appendChild(node);
        };
        Array.from(mainContainer.children).forEach((child) => {
            if (child.classList && child.classList.contains('mapboxgl-canvas-container')) return;
            liftNode(child);
        });

        // Persist to URL and reflect the active state in the inspector UI.
        if (window.urlManager) {
            window.urlManager.updateCompareParam(layerId);
        }
        if (this._iframe && this._iframe.contentWindow) {
            this._iframe.contentWindow.postMessage({ type: 'compare-enabled', layerId }, '*');
        }
    }

    /**
     * Copy the before map's terrain / 3D view state onto the after map. The
     * cloned style carries terrain/fog/projection, but field-of-view and the
     * wireframe debug flag (set directly on the map by terrain-3d-control) are
     * runtime-only, so they must be applied explicitly.
     */
    _syncAfterMapView(afterMap) {
        const src = this._map;
        if (!src || !afterMap) return;

        try {
            afterMap.jumpTo({
                center: src.getCenter(),
                zoom: src.getZoom(),
                bearing: src.getBearing(),
                pitch: src.getPitch()
            });

            // Terrain (the DEM source is already present in the cloned style).
            if (src.getTerrain) {
                afterMap.setTerrain(src.getTerrain() || null);
            }

            // Fog.
            if (src.getFog) {
                afterMap.setFog(src.getFog() || null);
            }

            // Projection (e.g. globe vs mercator).
            if (src.getProjection && afterMap.setProjection) {
                afterMap.setProjection(src.getProjection());
            }

            // Field of view — terrain-3d-control sets transform._fov directly.
            if (src.transform && afterMap.transform && typeof src.transform._fov === 'number') {
                afterMap.transform._fov = src.transform._fov;
                if (typeof afterMap.transform._calcMatrices === 'function') {
                    afterMap.transform._calcMatrices();
                }
            }

            // Terrain wireframe debug flag.
            if (typeof src.showTerrainWireframe === 'boolean') {
                afterMap.showTerrainWireframe = src.showTerrainWireframe;
            }

            afterMap.triggerRepaint();
        } catch (e) {
            console.warn('[MapFeatureControl] Error syncing compare view:', e);
        }
    }

    _disableCompare() {
        // Restore the layer that was hidden on the before map for comparison.
        if (this._compareHiddenConfig) {
            const mapboxAPI = this._getMapboxAPI();
            if (mapboxAPI) {
                mapboxAPI.updateLayerGroupVisibility(this._compareLayerId, this._compareHiddenConfig, true);
            }
            this._compareHiddenConfig = null;
        }

        // Clear the compare URL parameter.
        if (this._compareLayerId && window.urlManager) {
            window.urlManager.updateCompareParam(null);
        }

        // Stop mirroring terrain-3d-control changes onto the (now gone) after map.
        if (window.terrain3DControl && window.terrain3DControl.setSyncCallback) {
            window.terrain3DControl.setSyncCallback(null);
        }

        // Return any lifted UI overlays to the before map container.
        if (this._compareLiftedNodes) {
            this._compareLiftedNodes.forEach(({ node, parentNode, zIndex }) => {
                node.style.zIndex = zIndex;
                if (parentNode) parentNode.appendChild(node);
            });
            this._compareLiftedNodes = null;
        }

        if (this._compare) {
            try { this._compare.remove(); } catch (e) { /* noop */ }
            this._compare = null;
        }
        if (this._afterMap) {
            try { this._afterMap.remove(); } catch (e) { /* noop */ }
            this._afterMap = null;
        }
        if (this._afterContainer && this._afterContainer.parentNode) {
            this._afterContainer.parentNode.removeChild(this._afterContainer);
        }
        this._afterContainer = null;

        // Restore the main map container's position.
        if (this._map && this._compareMainPrevPosition !== undefined) {
            this._map.getContainer().style.position = this._compareMainPrevPosition;
            this._compareMainPrevPosition = undefined;
        }

        this._compareLayerId = null;
    }

    _notifyCompareDisabled() {
        this._compareLayerId = null;
        if (this._iframe && this._iframe.contentWindow) {
            this._iframe.contentWindow.postMessage({ type: 'compare-disabled' }, '*');
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

        // If this layer is being swipe-compared, tear that down first.
        if (this._compareLayerId === layerId) {
            this._disableCompare();
            this._notifyCompareDisabled();
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

        // Clear selections for this layer from state manager
        if (this._stateManager) {
            this._stateManager.clearLayerSelections(actualLayerId);
        }

        // Clear both hover and persistent isolation. The user typically hovers the
        // layer card (setting _hoverIsolation) and then clicks remove, so we must
        // reset both states — _clearLayerIsolation alone bails out when hover is
        // active and leaves sibling layers hidden after removal.
        this._hoverIsolation = null;
        this._persistentIsolation = null;
        this._applyClearIsolation();

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
                window.urlManager.updateURL({ updateSelections: true, updateLayers: true });
            }

            setTimeout(() => {
                this._sendDataToIframe();
            }, 100);
        } else {
            this._sendDataToIframe();
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

    preload() {
        if (this._iframeSrcLoaded || !this._iframe) return;
        this._iframe.src = 'map-inspector.html';
        this._iframeSrcLoaded = true;
    }

    /**
     * Open the selected-features panel and expand/scroll to a specific layer's
     * group within it. Used by hover actions elsewhere on the page (e.g. the
     * attribution control) that want to jump straight to a layer's selection.
     */
    showLayerSelection(layerId) {
        this._showPanel();
        this._sendMessageToIframe({ type: 'expand-layer', layerId });
    }

    _showPanel() {
        this.preload();

        // Only show loading overlay if inspector hasn't been initialized yet
        if (this._loadingOverlay && !this._inspectorInitialized) {
            this._loadingOverlay.style.display = 'flex';
        }

        this._panel.style.display = 'block';
        this._sendDataToIframe();

        this._sendMessageToIframe({ type: 'open-overlay-section' });

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
        this._disableCompare();

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

        // Clean up keyboard listeners
        if (this._keydownListener) {
            document.removeEventListener('keydown', this._keydownListener);
        }
        if (this._keyupListener) {
            document.removeEventListener('keyup', this._keyupListener);
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
        let touchMoved = false;
        let tapFallbackTimer = null;
        let touchStartTarget = null;

        // Touch start handler for long-press detection
        this._map.on('touchstart', (e) => {
            if (!e.originalEvent.touches || e.originalEvent.touches.length !== 1) {
                // Multi-touch gesture (pinch/rotate) — not a tap candidate.
                touchStartPoint = null;
                return;
            }

            touchStartPoint = e.point;
            touchStartTarget = e.originalEvent.target;
            isLongPress = false;
            touchMoved = false;

            // Start every tap from a clean add-mode state. Explicit add mode
            // (toggled via the shortcut menu or inspector panel) lives in the
            // marker manager's selectionMode and is preserved across taps.
            const explicitAddMode = this._markerManager?.getSelectionMode?.() === 'add';
            this._stateManager._isCmdCtrlPressed = explicitAddMode;

            // Set timer for long press (500ms). A long press now opens the
            // shortcut menu (shortcut-menu.js, via the browser's native
            // `contextmenu` event, which mobile browsers fire on long-press)
            // instead of arming add-selection mode, so the tap-fallback below
            // must skip it to avoid also selecting whatever feature is under
            // the finger.
            touchTimer = setTimeout(() => {
                isLongPress = true;
            }, 500);
        });

        // Touch move handler - cancel long press if moved too much
        this._map.on('touchmove', (e) => {
            if (touchTimer && touchStartPoint) {
                const dx = Math.abs(e.point.x - touchStartPoint.x);
                const dy = Math.abs(e.point.y - touchStartPoint.y);

                // Cancel if moved more than 10 pixels
                if (dx > 10 || dy > 10) {
                    touchMoved = true;
                    clearTimeout(touchTimer);
                    touchTimer = null;
                    isLongPress = false;
                }
            }
        });

        // Touch end handler - reset state
        this._map.on('touchend', (e) => {
            if (touchTimer) {
                clearTimeout(touchTimer);
                touchTimer = null;
            }

            // Tap-to-click fallback. Mapbox GL 3.23-rc suppresses the browser's
            // native click on touch and synthesizes its own `click` via tap
            // recognition — but with terrain enabled that synthesis never fires
            // (verified: touchstart/touchend fire, no DOM or mapbox `click`
            // follows), so the inspector/marker never opens on mobile. When this
            // was a clean single-finger tap and no real `click` arrives shortly,
            // run the selection logic ourselves from the tap point. The real
            // `click` handler cancels this timer, so devices/builds where mapbox
            // works never double-fire.
            // Only synthesize for taps that landed on the map canvas itself.
            // Taps on marker/popup/control overlays bubble up to mapbox's touch
            // handler too, but those elements have their own click handlers — if
            // we synthesized here we'd create a new selection instead of letting
            // the marker toggle its popup. Long presses are excluded entirely:
            // they open the shortcut menu (shortcut-menu.js) rather than
            // selecting a feature.
            const allFingersLifted = !e.originalEvent.touches || e.originalEvent.touches.length === 0;
            const tappedCanvas = touchStartTarget === this._map.getCanvas();
            if (!touchMoved && !isLongPress && touchStartPoint && allFingersLifted && tappedCanvas) {
                const tapPoint = touchStartPoint;
                if (tapFallbackTimer) clearTimeout(tapFallbackTimer);
                tapFallbackTimer = setTimeout(() => {
                    tapFallbackTimer = null;
                    const lngLat = this._map.unproject(tapPoint);
                    this._processClickAtPoint(tapPoint, lngLat);
                }, 60);
            }
        });

        // Click handler
        this._map.on('click', (e) => {
            // Real mapbox click arrived — cancel the touch fallback so we don't
            // process the same tap twice.
            if (tapFallbackTimer) {
                clearTimeout(tapFallbackTimer);
                tapFallbackTimer = null;
            }
            this._processClickAtPoint(e.point, e.lngLat);
        });

        // Mousemove handler (skip on touch devices to avoid hover/selection conflicts)
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (!isTouchDevice) {
            // Native mousemove can fire faster than the display refreshes, and
            // _handleMouseMove does several queryRenderedFeatures calls plus hover
            // state/DOM work per tick. Running that synchronously on every event backs
            // up the main thread — updates lag behind the cursor and catch up in a
            // burst once movement slows, instead of tracking smoothly. Coalesce to the
            // latest event once per animation frame.
            let mouseMoveEvent = null;
            let mouseMoveRAF = null;
            this._map.on('mousemove', (e) => {
                mouseMoveEvent = e;
                if (mouseMoveRAF) return;
                mouseMoveRAF = requestAnimationFrame(() => {
                    mouseMoveRAF = null;
                    this._handleMouseMove(mouseMoveEvent);
                });
            });
        }

        // Mouse leave handlers. The hover popup/marker is rendered as a sibling of the
        // map canvas, so moving the pointer onto it fires the canvas's `mouseout` even
        // though the pointer never left the map. Treating that as a real leave clears
        // the hover state and removes the marker, which drops the pointer back onto the
        // canvas and re-triggers hover — an endless flicker loop. Ignore leaves whose
        // related target is one of our own overlays so hover stays stable.
        this._map.on('mouseleave', (e) => {
            if (this._isPointerEnteringOwnOverlay(e)) return;
            this._stateManager.handleMapMouseLeave();
        });

        this._map.on('mouseout', (e) => {
            if (this._isPointerEnteringOwnOverlay(e)) return;
            this._stateManager.handleMapMouseLeave();
        });

        // Track map dragging state
        this._map.on('dragstart', () => {
            this._isMapDragging = true;
        });

        this._map.on('dragend', () => {
            this._isMapDragging = false;
        });

        // Window message listener for center selection (spacebar trigger)
        window.addEventListener('message', (event) => {
            if (event.data.type === 'trigger-center-selection') {
                this._stateManager.triggerCenterSelection();
            }
        });

        this._globalHandlersAdded = true;
    }

    /**
     * Query interactive features at a screen point and dispatch the selection.
     * Shared by the mapbox `click` handler and the touch tap fallback so both
     * paths behave identically.
     * @param {{x:number,y:number}} point - screen point
     * @param {{lng:number,lat:number}} lngLat - geographic coordinate
     */
    _processClickAtPoint(point, lngLat) {
        let interactiveFeatures = [];
        try {
            // Scope the query to interactive layers so clicks don't intersect
            // every layer in the style (expensive on mobile). Fall back to an
            // unscoped query if the layer list can't be resolved.
            const queryableLayers = this._stateManager.getInteractiveRenderedLayerIds();
            const queryOpts = queryableLayers.length ? { layers: queryableLayers } : undefined;

            let features = this._map.queryRenderedFeatures(point, queryOpts);

            if (!features.length) {
                const bufferSize = 5;
                const bbox = [
                    [point.x - bufferSize, point.y - bufferSize],
                    [point.x + bufferSize, point.y + bufferSize]
                ];
                const featuresInBuffer = this._map.queryRenderedFeatures(bbox, queryOpts);
                if (featuresInBuffer.length) {
                    features = [this._findClosestFeature(featuresInBuffer, point)];
                }
            }

            features.forEach(feature => {
                const layerId = this._findLayerIdForFeature(feature);
                if (layerId && this._stateManager.isLayerInteractive(layerId)) {
                    interactiveFeatures.push({ feature, layerId, lngLat });
                }
            });
        } catch (error) {
            if (error instanceof RangeError) {
                interactiveFeatures = this._stateManager.getFeaturesAtPoint(point, lngLat)
                    .filter(({ layerId }) => this._stateManager.isLayerInteractive(layerId));
            } else {
                console.error('[MapFeatureControl] Error querying rendered features on click:', error);
                throw error;
            }
        }

        if (interactiveFeatures.length > 0) {
            console.log('[TapDebug] processClick -> handleFeatureClicks (features)', {
                count: interactiveFeatures.length,
                layerIds: interactiveFeatures.map(f => f.layerId)
            });
            this._stateManager.handleFeatureClicks(interactiveFeatures);
        } else {
            // Pass lngLat for empty map clicks to allow marker creation
            console.log('[TapDebug] processClick -> handleFeatureClicks (empty)', { lngLat });
            this._stateManager.handleFeatureClicks([], lngLat);
        }
    }

    /**
     * Handle mouse move events
     */
    _handleMouseMove(e) {
        let rawFeatures = [];
        let usedFallback = false;
        try {
            rawFeatures = this._map.queryRenderedFeatures(e.point);

            if (!rawFeatures.length) {
                const bufferSize = 5;
                const bbox = [
                    [e.point.x - bufferSize, e.point.y - bufferSize],
                    [e.point.x + bufferSize, e.point.y + bufferSize]
                ];
                const featuresInBuffer = this._map.queryRenderedFeatures(bbox);
                if (featuresInBuffer.length) {
                    rawFeatures = [this._findClosestFeature(featuresInBuffer, e.point)];
                }
            }
        } catch (error) {
            if (error instanceof RangeError) {
                usedFallback = true;
            } else {
                console.error('[MapFeatureControl] Error querying rendered features:', error);
                throw error;
            }
        }

        const layerGroups = new Map();

        if (usedFallback) {
            this._stateManager.getFeaturesAtPoint(e.point, e.lngLat).forEach(({ feature, layerId }) => {
                if (this._stateManager.isLayerInteractive(layerId)) {
                    if (!layerGroups.has(layerId)) layerGroups.set(layerId, []);
                    const mapLayer = this._map.getLayer(feature.layer.id);
                    layerGroups.get(layerId).push({ feature, layerId, layerType: mapLayer?.type, lngLat: e.lngLat });
                }
            });
        } else {
            rawFeatures.forEach(feature => {
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
        }

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
     * True when a map mouseleave/mouseout is actually the pointer moving onto one of
     * our own map overlays (hover marker, selection marker, or popup) rather than
     * leaving the map. Used to suppress the hover-clear flicker loop those overlays
     * would otherwise cause when they sit under the cursor.
     */
    _isPointerEnteringOwnOverlay(e) {
        const related = e?.originalEvent?.relatedTarget;
        if (!related || typeof related.closest !== 'function') return false;
        return !!related.closest('.hover-marker, .selection-marker, .mapboxgl-popup');
    }

    /**
     * Find the closest feature to a given screen point
     * @param {Array} features - Array of features to search
     * @param {Object} point - Screen point {x, y}
     * @returns {Object} Closest feature
     */
    _findClosestFeature(features, point) {
        if (!features || features.length === 0) return null;
        if (features.length === 1) return features[0];

        let closestFeature = features[0];
        let minDistance = Infinity;

        for (const feature of features) {
            const distance = this._getFeatureDistanceToPoint(feature, point);
            if (distance < minDistance) {
                minDistance = distance;
                closestFeature = feature;
            }
        }

        return closestFeature;
    }

    /**
     * Calculate approximate distance from a feature to a screen point
     * @param {Object} feature - Mapbox feature
     * @param {Object} point - Screen point {x, y}
     * @returns {number} Distance in pixels
     */
    _getFeatureDistanceToPoint(feature, point) {
        if (!feature.geometry) return Infinity;

        const geomType = feature.geometry.type;
        let coords = feature.geometry.coordinates;

        // Get a representative point for the feature
        let representativeCoord;

        if (geomType === 'Point') {
            representativeCoord = coords;
        } else if (geomType === 'LineString') {
            // Use middle point of line
            const midIndex = Math.floor(coords.length / 2);
            representativeCoord = coords[midIndex];
        } else if (geomType === 'Polygon') {
            // Use first coordinate of outer ring
            representativeCoord = coords[0][0];
        } else if (geomType === 'MultiPoint') {
            // Use first point
            representativeCoord = coords[0];
        } else if (geomType === 'MultiLineString') {
            // Use middle point of first line
            const firstLine = coords[0];
            const midIndex = Math.floor(firstLine.length / 2);
            representativeCoord = firstLine[midIndex];
        } else if (geomType === 'MultiPolygon') {
            // Use first coordinate of first polygon
            representativeCoord = coords[0][0][0];
        } else {
            return Infinity;
        }

        // Project to screen coordinates
        const screenPoint = this._map.project(representativeCoord);

        // Calculate Euclidean distance
        const dx = screenPoint.x - point.x;
        const dy = screenPoint.y - point.y;
        return Math.sqrt(dx * dx + dy * dy);
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

            if (layerConfig.type === 'overpass' && actualLayerId.startsWith(`geojson-${layerId}-`)) {
                return layerId;
            }

            if (layerConfig.type === 'js' && actualLayerId.startsWith(`geojson-${layerId}-`)) {
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

        const { height } = data;
        if (!height) return;

        const isMobile = window.innerWidth <= 768;
        const maxHeight = isMobile ? window.innerHeight * 0.4 : window.innerHeight * 0.85;

        this._panel.style.height = `${Math.min(height, maxHeight)}px`;
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

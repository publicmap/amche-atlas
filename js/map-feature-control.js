/**
 * MapFeatureControl - Enhanced version using event-driven architecture
 * 
 * This control displays a list of active layers in the bottom right corner of the map.
 * When users interact with features, it shows the feature information under the relevant layer
 * instead of using overlapping popups.
 * 
 * Now uses centralized MapFeatureStateManager for all state management.
 * Updated to use config JSON as source of truth for active layers.
 */

export class MapFeatureControl {
    constructor(options = {}) {
        this.options = {
            position: 'bottom-right',
            maxHeight: '300px',
            maxWidth: '350px',
            minWidth: '250px',
            collapsed: false,
            showHoverPopups: true, // New option to control hover popups
            ...options
        };

        this._map = null;
        this._stateManager = null;
        this._container = null;
        this._layersContainer = null;
        this._isCollapsed = this.options.collapsed;
        this._config = null; // Store config reference
        
        // UI optimization - only re-render changed layers
        this._lastRenderState = new Map();
        this._stateChangeListener = null;
        this._renderScheduled = false;
        
        // Layer collapse state management
        this._layerCollapseStates = new Map(); // Track collapsed state for each layer
        
        // Hover popup management
        this._hoverPopup = null;
        this._currentHoveredFeature = null;
        
        // Drawer state tracking
        this._isDrawerOpen = false;
        this._drawerStateListeners = [];
        
        // Source layer links functionality moved from map-layer-controls.js
        /**
         * sourceLayerLinks: Array of link objects that appear in feature details for specific source layers
         * Each link object can have:
         * - name: Display name for the link
         * - sourceLayer: String or Array of strings specifying which source layers this link applies to
         * - renderHTML: Function that returns HTML content for the additional information
         *   - Functions receive: { feature, layerConfig, lat, lng, zoom, mercatorCoords }
         * 
         * The renderHTML function should return HTML that will be displayed in an additional table
         * below the main properties table in the feature details.
         */
        this._sourceLayerLinks = [];
        
        // Initialized
    }

    /**
     * Standard Mapbox GL JS control method - called when control is added to map
     */
    onAdd(map) {
        this._map = map;
        this._createContainer();
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
     * Public method to add the control to a map (following mapbox-choropleth pattern)
     */
    addTo(map) {
        map.addControl(this, this.options.position);
        return this;
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
        
        // Initialize sourceLayerLinks from config or set default
        this._initializeSourceLayerLinks();
        
        // State manager and config set
        
        // Listen to state changes from the centralized manager
        this._stateChangeListener = (event) => {
            this._handleStateChange(event.detail);
        };
        this._stateManager.addEventListener('state-change', this._stateChangeListener);
        
        // Set up drawer state tracking
        this._setupDrawerStateTracking();
        
        // Set up global click handler for feature interactions
        this._setupGlobalClickHandler();
        
        // Initial render
        this._render();
        
        return this;
    }

    /**
     * Set the configuration reference
     */
    setConfig(config) {
        this._config = config;
        this._initializeSourceLayerLinks();
        this._scheduleRender();
    }

    /**
     * Initialize source layer links from config or set default
     */
    _initializeSourceLayerLinks() {
        // Store sourceLayerLinks from config or set default
        this._sourceLayerLinks = this._config?.sourceLayerLinks || [{
            name: 'Bhunaksha',
            sourceLayer: 'Onemapgoa_GA_Cadastrals',

            renderHTML: ({ feature }) => {
                const plot = feature.properties.plot || '';
                const giscode = feature.properties.giscode || '';

                // Create a unique container ID for this specific render
                const containerId = `bhunaksha-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                // Create initial container with loading text
                const containerHTML = `
                    <div id="${containerId}" class="text-xs text-gray-600">
                        <div class="mb-2 font-semibold text-gray-800">Additional Information from Bhunaksha</div>
                        <span class="text-xs text-gray-600">Requesting Occupant Details...</span>
                    </div>
                `;

                // Set up async request after delay
                setTimeout(async () => {
                    try {
                        // Format giscode: insert commas after 2, 10, 18 characters
                        let levels = '';
                        if (giscode.length >= 18) {
                            const district = giscode.substring(0, 2);
                            const taluka = giscode.substring(2, 10);
                            const village = giscode.substring(10, 18);
                            const sheet = giscode.substring(18);
                            levels = `${district}%2C${taluka}%2C${village}%2C${sheet}`;
                        } else {
                            // Fallback to original if giscode format is unexpected
                            levels = '01%2C30010002%2C40107000%2C000VILLAGE';
                        }

                        // URL encode the plot number (replace / with %2F)
                        const plotEncoded = plot.replace(/\//g, '%2F');
                        const apiUrl = `https://bhunaksha.goa.gov.in/bhunaksha/ScalarDatahandler?OP=5&state=30&levels=${levels}%2C&plotno=${plotEncoded}`;

                        const response = await fetch(apiUrl);
                        const data = await response.json();

                        // Update the DOM with the response
                        const container = document.getElementById(containerId);
                        if (container) {
                            if (data.info && data.has_data === 'Y') {
                                let infoText;
                                
                                // Check if info contains HTML tags
                                const isHTML = /<[^>]*>/g.test(data.info);
                                
                                if (isHTML) {
                                    // If it's HTML, extract content from HTML tags and use directly
                                    // Remove outer <html> tags if present and clean up
                                    infoText = data.info
                                        .replace(/<\/?html>/gi, '')
                                        .replace(/<font[^>]*>/gi, '<span>')
                                        .replace(/<\/font>/gi, '</span>')
                                        .trim();
                                } else {
                                    // Parse and format the info text as plain text, filtering out first 3 lines
                                    const rawText = data.info.split('\n').slice(3).join('\n').replace(/-{10,}/g, '');
                                    // Format headers (text from start of line to colon) as bold with line breaks
                                    const formattedText = rawText.replace(/^([^:\n]+:)/gm, '<strong>$1</strong><br>');
                                    infoText = formattedText.replace(/\n/g, '<br>');
                                }
                                
                                container.innerHTML = `
                                    <div class="text-xs text-gray-600">
                                        <div class="mb-2 font-semibold text-gray-800">Additional Information from Bhunaksha</div>
                                        <div class="mb-2">${infoText}</div>
                                        <div class="italic text-xs text-gray-500">
                                            <svg class="inline w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
                                            </svg>
                                            Retrieved from <a href="${apiUrl}" target="_blank" class="text-blue-600 hover:text-blue-800">Bhunaksha/Dharani</a>. For information purposes only.
                                        </div>
                                    </div>
                                `;
                            } else {
                                container.innerHTML = `
                                    <div class="text-xs text-gray-600">
                                        <div class="mb-2 font-semibold text-gray-800">Additional Information from Bhunaksha</div>
                                        <span class="text-xs text-gray-500">No occupant data available</span>
                                    </div>
                                `;
                            }
                        } else {
                            console.warn('[Bhunaksha] Container not found for ID:', containerId);
                        }
                    } catch (error) {
                        console.error('[Bhunaksha] Error fetching occupant details:', error);
                        const container = document.getElementById(containerId);
                        if (container) {
                            container.innerHTML = `
                                <div class="text-xs text-gray-600">
                                    <div class="mb-2 font-semibold text-gray-800">Additional Information from Bhunaksha</div>
                                    <span class="text-xs text-red-500">Error loading details</span>
                                </div>
                            `;
                        }
                    }
                }, (() => {
                    // Check if 'esz' is in the layers URL parameter
                    const urlParams = new URLSearchParams(window.location.search);
                    const layersParam = urlParams.get('layers');
                    const hasEsz = layersParam && layersParam.includes('esz');
                    return hasEsz ? 0 : 5000;
                })());

                return containerHTML;
            }
        }];
    }

    /**
     * Create the main container and structure
     */
    _createContainer() {
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group map-feature-control';
        
        // Add custom styles
        this._container.style.cssText = `
            background: #666;
            box-shadow: 0 0 0 2px rgba(0,0,0,.1);
            max-height: ${this.options.maxHeight};
            max-width: ${this.options.maxWidth};
            min-width: ${this.options.minWidth};
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;

        this._createHeader();
        
        this._layersContainer = document.createElement('div');
        this._layersContainer.className = 'feature-control-layers';
        this._layersContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            max-height: calc(${this.options.maxHeight} - 50px);
            display: ${this._isCollapsed ? 'none' : 'block'};
        `;
        
        this._container.appendChild(this._layersContainer);
    }

    /**
     * Create the header with title and collapse button or options button
     */
    _createHeader() {
        const header = document.createElement('div');
        header.className = 'feature-control-header';
        header.style.cssText = `
            padding: 2px 12px;
            border-bottom: 1px solid #eee;
            background: #222;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
            color: white;
            cursor: pointer;
        `;

        const title = document.createElement('span');
        title.textContent = 'Map Information';
        
        // Create container for the button (will be updated dynamically)
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'feature-control-button-container';
        
        header.appendChild(title);
        header.appendChild(buttonContainer);

        // Add click handler to header (excluding the button area)
        header.addEventListener('click', (e) => {
            // Only toggle if click wasn't on the button container
            if (!buttonContainer.contains(e.target)) {
                this._toggleCollapse();
            }
        });

        this._container.appendChild(header);
        this._updateHeaderButton(); // Initial button state
    }

    /**
     * Toggle collapse state
     */
    _toggleCollapse() {
        this._isCollapsed = !this._isCollapsed;
        this._layersContainer.style.display = this._isCollapsed ? 'none' : 'block';
        this._updateHeaderButton();
    }

    /**
     * Update header button based on state
     */
    _updateHeaderButton() {
        const buttonContainer = this._container.querySelector('.feature-control-button-container');
        if (!buttonContainer) return;

        // Clear existing button
        buttonContainer.innerHTML = '';

        // Check if we should show Options button (when collapsed or no active layers)
        const shouldShowOptionsButton = this._isCollapsed || this._shouldShowOptionsButton();

        if (shouldShowOptionsButton) {
            // Create shoelace options button with state-aware styling
            const optionsBtn = document.createElement('sl-button');
            optionsBtn.setAttribute('variant', 'text');
            optionsBtn.setAttribute('size', 'small');
            
            // Style based on drawer state
            const isActive = this._isDrawerOpen;
            optionsBtn.setAttribute('data-drawer-open', isActive.toString());
            optionsBtn.style.cssText = `
                --sl-color-neutral-700: ${isActive ? '#fbbf24' : 'orange'};
                --sl-color-neutral-600: ${isActive ? '#fbbf24' : 'orange'};
                font-size: 10px;
                color: ${isActive ? '#fbbf24' : 'orange'};
                background-color: ${isActive ? 'rgba(251, 191, 36, 0.15)' : 'transparent'};
                border: 1px solid ${isActive ? '#fbbf24' : 'transparent'};
                border-radius: 4px;
                transition: all 0.2s ease;
            `;
            
            optionsBtn.innerHTML = `
                <sl-icon name="sliders" style="font-size: 10px;color: ${isActive ? '#fbbf24' : 'white'}"></sl-icon>
                <span style="margin-left: 4px; font-size: 10px;color: ${isActive ? '#fbbf24' : 'white'}">${isActive ? 'Close' : 'Options'}</span>
            `;

            // Add click handler to toggle layer drawer
            optionsBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent header click
                this._toggleLayerDrawer();
            });

            buttonContainer.appendChild(optionsBtn);
        } else {
            // Create normal toggle button
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'feature-control-toggle';
            toggleBtn.innerHTML = this._isCollapsed ? '▲' : '▼';
            toggleBtn.style.cssText = `
                background: none;
                border: none;
                font-size: 10px;
                cursor: pointer;
                color: white;
            `;

            // Add click handler for toggle
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent header click
                this._toggleCollapse();
            });

            buttonContainer.appendChild(toggleBtn);
        }
    }

    /**
     * Check if we should show the options button instead of toggle
     */
    _shouldShowOptionsButton() {
        // Show options button when there are no active layers
        if (!this._stateManager) return true;
        
        const activeLayers = this._stateManager.getActiveLayers();
        return activeLayers.size === 0;
    }

    /**
     * Set up drawer state tracking
     */
    _setupDrawerStateTracking() {
        const drawer = document.querySelector('.drawer-placement-start');
        if (!drawer) return;

        // Check initial drawer state
        this._isDrawerOpen = drawer.open || false;

        // Listen for drawer show/hide events
        const showListener = () => {
            this._isDrawerOpen = true;
            this._updateHeaderButton(); // Update button styling
        };

        const hideListener = () => {
            this._isDrawerOpen = false;
            this._updateHeaderButton(); // Update button styling
        };

        drawer.addEventListener('sl-show', showListener);
        drawer.addEventListener('sl-hide', hideListener);

        // Store listeners for cleanup
        this._drawerStateListeners.push(
            { element: drawer, event: 'sl-show', listener: showListener },
            { element: drawer, event: 'sl-hide', listener: hideListener }
        );
    }

    /**
     * Toggle the layer drawer from index.html
     */
    _toggleLayerDrawer() {
        const drawer = document.querySelector('.drawer-placement-start');
        if (drawer) {
            if (this._isDrawerOpen) {
                drawer.hide();
            } else {
                drawer.show();
            }
        }
    }

    /**
     * Handle state changes from the state manager
     */
    _handleStateChange(detail) {
        const { eventType, data } = detail;
        
        // Optimize rendering based on event type
        switch (eventType) {
            case 'feature-hover':
                this._handleFeatureHover(data);
                // Only update layer header styling for hover, don't render features
                this._updateLayerHeaderHoverState(data.layerId, true);
                break;
            case 'features-batch-hover':
                // Handle batch hover events (PERFORMANCE OPTIMIZED)
                this._handleBatchFeatureHover(data);
                // Update layer header styling for all affected layers
                data.affectedLayers.forEach(layerId => {
                    this._updateLayerHeaderHoverState(layerId, true);
                });
                break;
            case 'features-hover-cleared':
            case 'map-mouse-leave':
                // Clear all hover states
                this._handleAllFeaturesLeave();
                break;
            case 'feature-click':
                // Handle cleared features first if they exist, then the new selection
                if (data.clearedFeatures && data.clearedFeatures.length > 0) {
                    this._handleSelectionsCleared(data.clearedFeatures);
                }
                // Then render the clicked feature's layer
                this._renderLayer(data.layerId);
                break;
            case 'feature-click-multiple':
                // Handle multiple feature selections from overlapping click
                if (data.clearedFeatures && data.clearedFeatures.length > 0) {
                    this._handleSelectionsCleared(data.clearedFeatures);
                }
                // Render all affected layers
                const affectedLayers = new Set(data.selectedFeatures.map(f => f.layerId));
                affectedLayers.forEach(layerId => {
                    this._renderLayer(layerId);
                });
                break;
            case 'selections-cleared':
                this._handleSelectionsCleared(data.clearedFeatures);
                break;
            case 'feature-close':
                this._renderLayer(data.layerId);
                break;
            case 'feature-deselected':
                // Handle feature deselection (toggle off)
                this._renderLayer(data.layerId);
                break;
            case 'features-batch-deselected':
                // Handle batch deselection of multiple features
                data.affectedLayers.forEach(layerId => {
                    this._renderLayer(layerId);
                });
                break;
            case 'feature-leave':
                this._handleFeatureLeave(data);
                // Remove hover styling from layer header
                this._updateLayerHeaderHoverState(data.layerId, false);
                break;
            case 'layer-registered':
                // Re-render when layers are registered (turned on)
                this._scheduleRender();
                break;
            case 'layer-unregistered':
                // Re-render when layers are unregistered (turned off)
                // This ensures the feature control stays in sync with layer toggles
                this._scheduleRender();
                break;
            case 'cleanup':
                // Only re-render if visible features were cleaned up
                if (this._hasVisibleFeatures(data.removedFeatures)) {
                    this._scheduleRender();
                }
                break;
        }
    }

    /**
     * Update layer header visual state for hover indication
     */
    _updateLayerHeaderHoverState(layerId, isHovered) {
        const layerElement = this._layersContainer.querySelector(`[data-layer-id="${layerId}"]`);
        if (layerElement) {
            const headerElement = layerElement.querySelector('.feature-control-layer-header');
            if (headerElement) {
                if (isHovered) {
                    headerElement.style.borderColor = '#fbbf24'; // Yellow border for hover
                } else {
                    headerElement.style.borderColor = 'transparent'; // Back to transparent
                }
            }
        }
    }

    /**
     * Handle cleared selections - update UI for all cleared features
     */
    _handleSelectionsCleared(clearedFeatures) {
        
        // Get unique layer IDs that had selections cleared
        const affectedLayerIds = [...new Set(clearedFeatures.map(item => item.layerId))];
        
        // Force re-render of all affected layers by clearing their hash cache
        // This ensures the UI properly reflects the cleared state
        affectedLayerIds.forEach(layerId => {
            this._lastRenderState.delete(layerId); // Force update by clearing hash
            this._renderLayer(layerId);
        });
        
        // If no layers had selections, do a full render to ensure clean state
        if (affectedLayerIds.length === 0) {
            this._scheduleRender();
        }
    }

    /**
     * Get active layers from state manager - SINGLE SOURCE OF TRUTH
     */
    _getActiveLayersFromConfig() {
        // Always use state manager as the single source of truth
        // The state manager already knows which layers are registered and interactive
        if (!this._stateManager) {
            return new Map();
        }
        
        const activeLayers = this._stateManager.getActiveLayers();
        console.log(`[FeatureControl] Active layers count: ${activeLayers.size}`, Array.from(activeLayers.keys()));
        return activeLayers;
    }

    /**
     * Schedule a render to avoid excessive re-rendering
     */
    _scheduleRender() {
        if (this._renderScheduled) return;
        
        this._renderScheduled = true;
        // Use immediate requestAnimationFrame for better responsiveness
        requestAnimationFrame(() => {
            this._render();
            this._renderScheduled = false;
        });
    }

    /**
     * Get currently active layers from the layer control (DEPRECATED - kept for compatibility)
     */
    _getCurrentlyActiveLayers() {
        return this._getActiveLayersFromConfig();
    }

    /**
     * Render the control UI - uses state manager as single source of truth
     */
    _render() {
        if (!this._layersContainer || !this._stateManager) return;

        // Get active layers from state manager (single source of truth)
        const activeLayers = this._getActiveLayersFromConfig();
        
        // Don't show empty state immediately - layers might be loading
        if (activeLayers.size === 0) {
            // Only show empty state after a brief delay to avoid flicker during layer loading
            // Avoid duplicate logging by not calling _getActiveLayersFromConfig again
            setTimeout(() => {
                // Check state manager directly to avoid duplicate logging
                const currentActiveLayers = this._stateManager.getActiveLayers();
                if (currentActiveLayers.size === 0) {
                    this._renderEmptyState();
                    this._lastRenderState.clear();
                }
            }, 500);
            return;
        }

        // Clear empty state if it exists
        const emptyState = this._layersContainer.querySelector('.feature-control-empty');
        if (emptyState) {
            emptyState.remove();
        }
        
        // Update header button when layers are rendered
        this._updateHeaderButton();

        // Get current layer order from config to maintain stable ordering
        const configOrder = this._getConfigLayerOrder();
        const currentLayerIds = new Set(activeLayers.keys());
        const previousLayerIds = new Set(this._lastRenderState.keys());
        
        // Remove layers that are no longer active
        previousLayerIds.forEach(layerId => {
            if (!currentLayerIds.has(layerId)) {
                this._removeLayerElement(layerId);
                this._lastRenderState.delete(layerId);
            }
        });

        // Process layers in config order to maintain stable ordering
        configOrder.forEach(layerId => {
            if (activeLayers.has(layerId)) {
                const layerData = activeLayers.get(layerId);
                const layerHash = this._getLayerDataHash(layerData);
                const previousHash = this._lastRenderState.get(layerId);
                
                if (layerHash !== previousHash) {
                    this._updateSingleLayer(layerId, layerData);
                    this._lastRenderState.set(layerId, layerHash);
                }
            }
        });
    }

    /**
     * Get layer order from config to maintain stable ordering
     */
    _getConfigLayerOrder() {
        if (!this._config || !this._config.groups) {
            // Fallback to alphabetical ordering if no config
            return Array.from(this._stateManager.getActiveLayers().keys()).sort();
        }
        
        // Return layers in the order they appear in config
        // Include all interactive layers (geojson, vector, etc.), even if they don't have inspect properties
        return this._config.groups
            .filter(group => {
                // Include all interactive layers that are registered with the state manager
                return this._stateManager.isLayerInteractive(group.id) && 
                       // Only include layers that are vector-based or geojson (can have features)
                       (group.type === 'geojson' || group.type === 'vector' || 
                        group.type === 'csv' || group.inspect);
            })
            .map(group => group.id);
    }

    /**
     * Update a single layer (preserves position, only updates content)
     */
    _updateSingleLayer(layerId, layerData) {
        const { config, features } = layerData;
        
        // Find existing layer element or create new one
        let layerElement = this._layersContainer.querySelector(`[data-layer-id="${layerId}"]`);
        let isNewElement = false;
        
        if (!layerElement) {
            layerElement = document.createElement('div');
            layerElement.className = 'feature-control-layer';
            layerElement.setAttribute('data-layer-id', layerId);
            layerElement.style.cssText = `border-bottom: 1px solid #eee;`;
            isNewElement = true;
        }

        // Clear existing content
        layerElement.innerHTML = '';

        // Create layer header with collapse functionality
        const layerHeader = this._createLayerHeader(config, layerId);
        layerElement.appendChild(layerHeader);

        // Only show selected features in inspector
        const selectedFeatures = new Map();
        features.forEach((featureState, featureId) => {
            if (featureState.isSelected) {
                selectedFeatures.set(featureId, featureState);
            }
        });

        // Create features container if there are selected features
        // Show all layers (geojson, vector, csv) even if they don't have inspect properties
        if (selectedFeatures.size > 0 && (config.inspect || 
            config.type === 'geojson' || config.type === 'vector' || config.type === 'csv')) {
            const featuresContainer = document.createElement('div');
            featuresContainer.className = 'feature-control-features';
            featuresContainer.setAttribute('data-layer-features', layerId);
            // Add standardized ID for direct targeting
            featuresContainer.id = `features-container-${layerId}`;
            
            // Check if this layer is collapsed
            const isLayerCollapsed = this._layerCollapseStates.get(layerId) || false;
            
            featuresContainer.style.cssText = `
                max-height: 200px;
                overflow-y: auto;
                display: ${isLayerCollapsed ? 'none' : 'block'};
                transition: all 0.2s ease;
            `;

            // Sort and render only selected features
            const sortedFeatures = this._getSortedFeatures(selectedFeatures);
            sortedFeatures.forEach(([featureId, featureState]) => {
                this._renderFeature(featuresContainer, featureState, config, layerId);
            });

            layerElement.appendChild(featuresContainer);
        }
        
        // Add to container if it's a new element, maintaining config order
        if (isNewElement) {
            this._insertLayerInOrder(layerElement, layerId);
        }
    }

    /**
     * Insert layer element in the correct position based on config order
     */
    _insertLayerInOrder(layerElement, layerId) {
        const configOrder = this._getConfigLayerOrder();
        const layerIndex = configOrder.indexOf(layerId);
        
        if (layerIndex === -1) {
            // Not found in config, append at end
            this._layersContainer.appendChild(layerElement);
            return;
        }
        
        // Find the position to insert based on config order
        const existingLayers = Array.from(this._layersContainer.children);
        let insertBeforeElement = null;
        
        for (let i = layerIndex + 1; i < configOrder.length; i++) {
            const nextLayerId = configOrder[i];
            const nextElement = existingLayers.find(el => el.getAttribute('data-layer-id') === nextLayerId);
            if (nextElement) {
                insertBeforeElement = nextElement;
                break;
            }
        }
        
        if (insertBeforeElement) {
            this._layersContainer.insertBefore(layerElement, insertBeforeElement);
        } else {
            this._layersContainer.appendChild(layerElement);
        }
    }

    /**
     * Render empty state when no layers are active
     */
    _renderEmptyState() {
        // Clear existing content first
        this._layersContainer.innerHTML = '';
        
        const emptyState = document.createElement('div');
        emptyState.className = 'feature-control-empty';
        emptyState.style.cssText = `
            padding: 20px;
            text-align: center;
            color: #666;
            font-size: 12px;
        `;
        emptyState.textContent = 'No active layers to display';
        this._layersContainer.appendChild(emptyState);
        
        // Update header button when empty state is rendered
        this._updateHeaderButton();
    }

    /**
     * Render a single layer by ID (for selective updates)
     */
    _renderLayer(layerId) {
        if (!this._stateManager) return;
        
        const activeLayers = this._stateManager.getActiveLayers();
        const layerData = activeLayers.get(layerId);
        
        if (layerData) {
            this._updateSingleLayer(layerId, layerData);
            this._lastRenderState.set(layerId, this._getLayerDataHash(layerData));
        }
    }

    /**
     * Create layer header with background image support and collapse functionality
     */
    _createLayerHeader(config, layerId) {
        const layerHeader = document.createElement('div');
        layerHeader.className = 'feature-control-layer-header';
        
        let headerStyle = `
            padding: 0px 12px;
            font-size: 10px;
            font-weight: 600;
            color: #fff;
            border: 1px solid black;
            border-radius: 4px;
            position: relative;
            background: #333;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.7);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: background-color 0.2s ease;
        `;
        
        if (config.headerImage) {
            headerStyle += `
                background-image: url('${config.headerImage}');
                background-size: cover;
                background-position: center;
                background-repeat: no-repeat;
            `;
            
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.4);
                z-index: 1;
            `;
            layerHeader.appendChild(overlay);
        }
        
        layerHeader.style.cssText = headerStyle;
        
        // Header text container
        const headerText = document.createElement('span');
        headerText.style.cssText = 'position: relative; z-index: 2; flex: 1;';
        headerText.textContent = config.title || config.id;
        layerHeader.appendChild(headerText);

        // Toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'layer-toggle-btn';
        const isCollapsed = this._layerCollapseStates.get(layerId) || false;
        toggleBtn.innerHTML = isCollapsed ? '▲' : '▼';
        toggleBtn.style.cssText = `
            background: none;
            border: none;
            font-size: 10px;
            cursor: pointer;
            color: #fff;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.7);
            position: relative;
            z-index: 2;
            padding: 2px 4px;
            border-radius: 2px;
            transition: background-color 0.2s ease;
        `;

        // Hover effect for toggle button
        toggleBtn.addEventListener('mouseenter', () => {
            toggleBtn.style.backgroundColor = 'rgba(255,255,255,0.2)';
        });
        
        toggleBtn.addEventListener('mouseleave', () => {
            toggleBtn.style.backgroundColor = 'transparent';
        });

        layerHeader.appendChild(toggleBtn);

        // Add click handler for collapse functionality
        layerHeader.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent event bubbling
            
            // Toggle collapse state
            const currentState = this._layerCollapseStates.get(layerId) || false;
            const newState = !currentState;
            this._layerCollapseStates.set(layerId, newState);
            
            // Update toggle button
            toggleBtn.innerHTML = newState ? '▲' : '▼';
            
            // Find and toggle the features container
            const layerElement = layerHeader.closest('.feature-control-layer');
            const featuresContainer = layerElement.querySelector(`[data-layer-features="${layerId}"]`);
            
            if (featuresContainer) {
                featuresContainer.style.display = newState ? 'none' : 'block';
            }
        });

        // Add hover effect for the entire header
        layerHeader.addEventListener('mouseenter', () => {
            if (!config.headerImage) {
                layerHeader.style.backgroundColor = '#404040';
            }
        });
        
        layerHeader.addEventListener('mouseleave', () => {
            if (!config.headerImage) {
                layerHeader.style.backgroundColor = '#333';
            }
        });

        return layerHeader;
    }

    /**
     * Sort features by priority: selected first, then by timestamp
     */
    _getSortedFeatures(featuresMap) {
        const features = Array.from(featuresMap.entries());
        
        return features.sort(([aId, aData], [bId, bData]) => {
            // Sort by timestamp (most recent first)
            return bData.timestamp - aData.timestamp;
        });
    }

    /**
     * Render feature with improved interaction handling and standardized IDs
     */
    _renderFeature(container, featureState, layerConfig, layerId) {
        const featureElement = document.createElement('div');
        const featureId = this._getFeatureId(featureState.feature);
        
        featureElement.className = 'feature-control-feature selected';
        featureElement.setAttribute('data-feature-id', featureId);
        featureElement.setAttribute('data-layer-id', layerId);
        
        // Add standardized ID for direct targeting: inspector-{layerId}-{featureId}
        featureElement.id = `inspector-${layerId}-${featureId}`;
        
        // Selected feature styling
        featureElement.style.cssText = `
            border-bottom: 1px solid #f0f0f0;
            font-size: 11px;
            background:#eee;
            cursor: pointer;
            padding: 0;
        `;

        // Render detailed content for selected features
        const content = this._createFeatureContent(featureState, layerConfig, layerId, featureId);
        featureElement.appendChild(content);

        container.appendChild(featureElement);
    }

    /**
     * Create feature content with properties table and standardized IDs
     */
    _createFeatureContent(featureState, layerConfig, layerId, featureId) {
        const content = document.createElement('div');
        content.className = 'feature-inspector-content';
        content.id = `content-${layerId}-${featureId}`;
        content.style.cssText = 'padding: 0;';
        
        // Properties table content
        const tableContent = document.createElement('div');
        tableContent.className = 'feature-inspector-table-content';
        tableContent.id = `table-content-${layerId}-${featureId}`;
        tableContent.style.cssText = 'padding: 12px; max-height: 250px; overflow-y: auto;';
        
        // Build the properties table with intelligent formatting
        const table = document.createElement('table');
        table.className = 'feature-inspector-properties-table';
        table.id = `properties-table-${layerId}-${featureId}`;
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 8px;
            font-family: inherit;
            background-color: #ffffff;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        `;
        
        const properties = featureState.feature.properties || {};
        const inspect = layerConfig.inspect || {};
        
        // Get field configuration
        const priorityFields = inspect.fields || [];
        const fieldTitles = inspect.fieldTitles || [];
        const labelField = inspect.label;
        
        // Create field title mapping
        const fieldTitleMap = {};
        priorityFields.forEach((field, index) => {
            if (fieldTitles[index]) {
                fieldTitleMap[field] = fieldTitles[index];
            }
        });
        
        // Organize properties: label first, then priority fields, then remaining fields
        const organizedFields = [];
        
        // 1. Add label field first if it exists and has a value
        if (labelField && properties[labelField] !== undefined && properties[labelField] !== null && properties[labelField] !== '') {
            organizedFields.push({
                key: labelField,
                value: properties[labelField],
                isLabel: true,
                displayName: inspect.title || fieldTitleMap[labelField] || labelField
            });
        }
        
        // 2. Add priority fields in order (excluding label field to avoid duplication)
        priorityFields.forEach(field => {
            if (field !== labelField && properties[field] !== undefined && properties[field] !== null && properties[field] !== '') {
                organizedFields.push({
                    key: field,
                    value: properties[field],
                    isPriority: true,
                    displayName: fieldTitleMap[field] || field
                });
            }
        });
        
        // 3. Add remaining fields (for layers without inspect, show all non-empty properties)
        Object.entries(properties).forEach(([key, value]) => {
            // Skip if already added as label or priority field
            if (key === labelField || priorityFields.includes(key)) {
                return;
            }
            
            // For layers without inspect properties, be more inclusive
            // Skip empty values and internal/system fields
            if (value === undefined || value === null || value === '') {
                return;
            }
            
            // Skip common internal/system fields that aren't useful to display
            const systemFields = ['id', 'fid', '_id', 'objectid', 'gid', 'osm_id', 'way_id'];
            if (systemFields.includes(key.toLowerCase())) {
                return;
            }
            
            organizedFields.push({
                key: key,
                value: value,
                isOther: true,
                displayName: key
            });
        });
        
        // For layers without inspect properties, show at least some basic info if no fields were found
        if (organizedFields.length === 0 && !layerConfig.inspect) {
            // Show the first few properties or a generic message
            const basicFields = Object.entries(properties)
                .filter(([key, value]) => value !== undefined && value !== null && value !== '')
                .slice(0, 5); // Show first 5 non-empty properties
            
            if (basicFields.length > 0) {
                basicFields.forEach(([key, value]) => {
                    organizedFields.push({
                        key: key,
                        value: value,
                        isOther: true,
                        displayName: key
                    });
                });
            } else {
                // Show generic feature info if no properties available
                organizedFields.push({
                    key: 'type',
                    value: featureState.feature.geometry?.type || 'Feature',
                    isOther: true,
                    displayName: 'Geometry Type'
                });
            }
        }
        
        // Render the organized fields
        organizedFields.forEach(field => {
            const row = document.createElement('tr');
            
            // Set row background based on field type
            let rowBackgroundColor = '#ffffff'; // Default white background
            if (field.isLabel) {
                rowBackgroundColor = '#f8fafc'; // Very light blue-gray for label
            } else if (field.isPriority) {
                rowBackgroundColor = '#f9fafb'; // Very light gray for priority fields
            }
            
            row.style.cssText = `
                border-bottom: 1px solid #e5e7eb;
                background-color: ${rowBackgroundColor};
                transition: background-color 0.1s ease;
            `;
            
            // Add subtle hover effect for better UX
            row.addEventListener('mouseenter', () => {
                if (field.isLabel) {
                    row.style.backgroundColor = '#f1f5f9';
                } else if (field.isPriority) {
                    row.style.backgroundColor = '#f3f4f6';
                } else {
                    row.style.backgroundColor = '#f9fafb';
                }
            });
            
            row.addEventListener('mouseleave', () => {
                row.style.backgroundColor = rowBackgroundColor;
            });
            
            const keyCell = document.createElement('td');
            keyCell.style.cssText = `
                padding: 6px 8px;
                font-weight: 600;
                color: ${field.isLabel ? '#1f2937' : field.isPriority ? '#374151' : '#6b7280'};
                width: 40%;
                vertical-align: top;
                line-height: 1.3;
                font-size: ${field.isLabel ? '11px' : '10px'};
            `;
            
            // Simplified field name display - show only field title, add tooltip for original field name
            if (field.displayName !== field.key) {
                keyCell.textContent = field.displayName;
                keyCell.title = `Original field: ${field.key}`; // Tooltip showing original field name
                keyCell.style.cursor = 'help';
            } else {
                keyCell.textContent = field.displayName;
            }
            
            const valueCell = document.createElement('td');
            valueCell.style.cssText = `
                padding: 6px 8px;
                word-break: break-word;
                font-size: ${field.isLabel ? '12px' : '10px'};
                font-weight: ${field.isLabel ? '600' : '400'};
                color: ${field.isLabel ? '#1f2937' : '#374151'};
                line-height: 1.3;
                vertical-align: top;
            `;
            valueCell.textContent = String(field.value);
            
            row.appendChild(keyCell);
            row.appendChild(valueCell);
            table.appendChild(row);
        });
        
        tableContent.appendChild(table);
        
        content.appendChild(tableContent);
        
        // Add source layer links content if applicable
        this._addSourceLayerLinksContent(content, featureState, layerConfig);
        
        return content;
    }

    /**
     * Add source layer links content to the feature content
     */
    _addSourceLayerLinksContent(content, featureState, layerConfig) {
        if (!this._sourceLayerLinks || this._sourceLayerLinks.length === 0) {
            return;
        }

        const feature = featureState.feature;
        const sourceLayer = feature.sourceLayer || feature.layer?.sourceLayer;
        
        // Find applicable source layer links
        const applicableLinks = this._sourceLayerLinks.filter(link => {
            if (!link.sourceLayer) return false;
            
            // Handle both string and array for sourceLayer
            if (Array.isArray(link.sourceLayer)) {
                return link.sourceLayer.includes(sourceLayer);
            } else {
                return link.sourceLayer === sourceLayer;
            }
        });

        if (applicableLinks.length === 0) {
            return;
        }

        // Create container for additional information
        const additionalInfoContainer = document.createElement('div');
        additionalInfoContainer.className = 'feature-inspector-additional-info';
        additionalInfoContainer.style.cssText = `
            margin-top: 12px;
            padding: 12px;
            border-top: 1px solid #e5e7eb;
            background-color: #f9fafb;
            border-radius: 0 0 4px 4px;
        `;

        // Process each applicable link
        applicableLinks.forEach((link, index) => {
            if (link.renderHTML && typeof link.renderHTML === 'function') {
                try {
                    // Call the renderHTML function with feature data
                    const linkHTML = link.renderHTML({
                        feature: feature,
                        layerConfig: layerConfig,
                        lat: featureState.lngLat?.lat,
                        lng: featureState.lngLat?.lng,
                        zoom: this._map?.getZoom(),
                        mercatorCoords: this._getMercatorCoords(featureState.lngLat)
                    });

                    if (linkHTML) {
                        // Create a wrapper div for this link's content
                        const linkContainer = document.createElement('div');
                        linkContainer.className = `source-layer-link-${index}`;
                        linkContainer.innerHTML = linkHTML;
                        
                        // Add separator between multiple links
                        if (index > 0) {
                            const separator = document.createElement('div');
                            separator.style.cssText = 'border-top: 1px solid #e5e7eb; margin: 8px 0; padding-top: 8px;';
                            additionalInfoContainer.appendChild(separator);
                        }
                        
                        additionalInfoContainer.appendChild(linkContainer);
                    }
                } catch (error) {
                    console.error(`Error rendering source layer link "${link.name}":`, error);
                }
            }
        });

        // Only add the container if it has content
        if (additionalInfoContainer.children.length > 0) {
            content.appendChild(additionalInfoContainer);
        }
    }

    /**
     * Get mercator coordinates from lng/lat
     */
    _getMercatorCoords(lngLat) {
        if (!lngLat) return null;
        
        // Convert to Web Mercator coordinates
        const x = lngLat.lng * 20037508.34 / 180;
        const y = Math.log(Math.tan((90 + lngLat.lat) * Math.PI / 360)) / (Math.PI / 180);
        const mercatorY = y * 20037508.34 / 180;
        
        return { x, y: mercatorY };
    }



    /**
     * Get a unique identifier for a feature (STANDARDIZED)
     * Creates consistent IDs that can be used for DOM targeting
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

    /**
     * Get a feature ID specifically for deduplication purposes
     * Uses a more comprehensive approach to identify unique features
     */
    _getFeatureIdForDeduplication(feature) {
        // Try standard ID fields first
        if (feature.id !== undefined) return feature.id;
        if (feature.properties?.id) return feature.properties.id;
        if (feature.properties?.fid) return feature.properties.fid;
        
        // For features without explicit IDs, use a combination of key properties
        const props = feature.properties || {};
        
        // Try common identifying properties
        const identifyingProps = ['name', 'title', 'label', 'gid', 'objectid', 'osm_id'];
        for (const prop of identifyingProps) {
            if (props[prop] !== undefined && props[prop] !== null) {
                return `${prop}:${props[prop]}`;
            }
        }
        
        // Fallback to geometry hash for features without identifying properties
        const geomStr = JSON.stringify(feature.geometry);
        return `geom:${this._hashCode(geomStr)}`;
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

    // Helper methods for new architecture
    _removeLayerElement(layerId) {
        const existing = this._layersContainer.querySelector(`[data-layer-id="${layerId}"]`);
        if (existing) {
            existing.remove();
        }
    }

    /**
     * UTILITY METHODS FOR DIRECT DOM TARGETING
     * These methods provide consistent ways to target elements using the standardized ID schema
     */

    /**
     * Get a feature inspector element by layer and feature ID
     * @param {string} layerId - The layer ID
     * @param {string} featureId - The feature ID (with or without 'feature-' prefix)
     * @returns {HTMLElement|null} The feature inspector element
     */
    getFeatureInspectorElement(layerId, featureId) {
        // Ensure featureId has proper prefix
        const normalizedFeatureId = featureId.startsWith('feature-') ? featureId : `feature-${featureId}`;
        return document.getElementById(`inspector-${layerId}-${normalizedFeatureId}`);
    }

    /**
     * Get a feature's properties table by layer and feature ID
     * @param {string} layerId - The layer ID
     * @param {string} featureId - The feature ID (with or without 'feature-' prefix)
     * @returns {HTMLElement|null} The properties table element
     */
    getFeaturePropertiesTable(layerId, featureId) {
        const normalizedFeatureId = featureId.startsWith('feature-') ? featureId : `feature-${featureId}`;
        return document.getElementById(`properties-table-${layerId}-${normalizedFeatureId}`);
    }

    /**
     * Get a layer's features container
     * @param {string} layerId - The layer ID
     * @returns {HTMLElement|null} The features container element
     */
    getLayerFeaturesContainer(layerId) {
        return document.getElementById(`features-container-${layerId}`);
    }



    /**
     * Get a feature inspector element using feature object directly
     * @param {Object} feature - The feature object
     * @returns {HTMLElement|null} The feature inspector element
     */
    getFeatureInspectorElementByFeature(feature) {
        const layerId = feature.layer?.metadata?.groupId;
        const featureId = this._getFeatureId(feature);
        
        if (!layerId || !featureId) return null;
        
        return this.getFeatureInspectorElement(layerId, featureId);
    }

    _getLayerDataHash(layerData) {
        // Create a comprehensive hash that includes feature selection states
        const features = Array.from(layerData.features.entries());
        const featureHashes = features.map(([featureId, featureState]) => {
            return JSON.stringify({
                id: featureId,
                selected: featureState.isSelected || false,
                timestamp: featureState.timestamp
            });
        });
        
        return JSON.stringify({
            layerId: layerData.config.id,
            featureCount: features.length,
            featureHashes: featureHashes.sort() // Sort for consistent hashing
        });
    }

    _hasVisibleFeatures(removedFeatures) {
        // Check if any of the removed features were currently visible
        return removedFeatures.some(featureId => {
            return this._layersContainer.querySelector(`[data-feature-id="${featureId}"]`);
        });
    }

    /**
     * Set up global click handler to process all feature clicks at once
     */
    _setupGlobalClickHandler() {
        if (this._globalClickHandlerAdded) return;
        
        this._map.on('click', (e) => {
            // Query all features at the click point
            const features = this._map.queryRenderedFeatures(e.point);
            
            // Filter for interactive features from registered layers
            const interactiveFeatures = [];
            
            features.forEach(feature => {
                // Find which registered layer this feature belongs to
                const layerId = this._findLayerIdForFeature(feature);
                if (layerId && this._stateManager.isLayerInteractive(layerId)) {
                    interactiveFeatures.push({
                        feature,
                        layerId,
                        lngLat: e.lngLat
                    });
                }
            });
            
            // Pass all interactive features to the state manager
            if (interactiveFeatures.length > 0) {
                this._stateManager.handleFeatureClicks(interactiveFeatures);
                
                // Ease map to center on clicked location with mobile offset
                this._easeToCenterWithOffset(e.lngLat);
            } else {
                // Clear selections if clicking on empty area
                this._stateManager.clearAllSelections();
            }
        });
        
        // Set up global mousemove handler for better performance
        this._map.on('mousemove', (e) => {
            // Use queryRenderedFeatures with deduplication for optimal performance
            this._handleMouseMoveWithQueryRendered(e);
            
            // Update hover popup position to follow mouse smoothly
            this._updateHoverPopupPosition(e.lngLat);
        });
        
        // Set up global mouseleave handler for the entire map
        this._map.on('mouseleave', () => {
            this._stateManager.handleMapMouseLeave();
        });
        
        // Set up mouseout handler to ensure hover states are cleared when mouse moves to other DOM elements
        // mouseout is more reliable than mouseleave for detecting mouse leaving map area
        this._map.on('mouseout', () => {
            this._stateManager.handleMapMouseLeave();
            // Force clear hover popup immediately when mouse leaves map area
            this._removeHoverPopup();
        });
        
        this._globalClickHandlerAdded = true;
    }

    /**
     * Find which registered layer a feature belongs to (OPTIMIZED)
     * Uses feature metadata directly when available, falling back to layer matching
     */
    _findLayerIdForFeature(feature) {
        if (!feature.layer || !feature.layer.id) return null;
        
        // OPTIMIZATION: Use metadata.groupId directly if available
        // This avoids expensive layer matching loops
        if (feature.layer.metadata && feature.layer.metadata.groupId) {
            const groupId = feature.layer.metadata.groupId;
            
            // Verify this layer is actually registered and interactive
            if (this._stateManager.isLayerInteractive(groupId)) {
                return groupId;
            }
        }
        
        // Fallback to original method if metadata is not available or layer not registered
        const actualLayerId = feature.layer.id;
        
        // Check all registered layers to see which one this feature belongs to
        const activeLayers = this._stateManager.getActiveLayers();
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
     * Get matching layer IDs (simplified version of state manager's method)
     */
    _getMatchingLayerIds(layerConfig) {
        const style = this._map.getStyle();
        if (!style.layers) return [];
        
        const layerId = layerConfig.id;
        const matchingIds = [];
        
        // Direct ID match
        if (style.layers.some(l => l.id === layerId)) {
            matchingIds.push(layerId);
        }
        
        // Source layer matching (for vector layers)
        if (layerConfig.sourceLayer) {
            const sourceLayerMatches = style.layers
                .filter(l => l['source-layer'] === layerConfig.sourceLayer)
                .map(l => l.id);
            matchingIds.push(...sourceLayerMatches);
        }
        
        // GeoJSON layer matching
        if (layerConfig.type === 'geojson') {
            const geojsonMatches = style.layers
                .filter(l => l.id.startsWith(`geojson-${layerId}-`))
                .map(l => l.id);
            matchingIds.push(...geojsonMatches);
        }
        
        // Vector layer matching
        if (layerConfig.type === 'vector') {
            const vectorMatches = style.layers
                .filter(l => l.id.startsWith(`vector-layer-${layerId}`))
                .map(l => l.id);
            matchingIds.push(...vectorMatches);
        }
        
        // CSV layer matching
        if (layerConfig.type === 'csv') {
            const csvMatches = style.layers
                .filter(l => l.id.startsWith(`csv-${layerId}-`))
                .map(l => l.id);
            matchingIds.push(...csvMatches);
        }
        
        // Generic prefix matching (fallback)
        const prefixMatches = style.layers
            .filter(l => l.id.startsWith(`${layerId}-`))
            .map(l => l.id);
        matchingIds.push(...prefixMatches);
        
        return [...new Set(matchingIds)];
    }

    /**
     * Clean up event listeners and references
     */
    _cleanup() {
        if (this._stateManager && this._stateChangeListener) {
            this._stateManager.removeEventListener('state-change', this._stateChangeListener);
        }
        
        // Clean up drawer state listeners
        this._drawerStateListeners.forEach(({ element, event, listener }) => {
            element.removeEventListener(event, listener);
        });
        this._drawerStateListeners = [];
        
        // Clean up hover popup completely on cleanup
        this._removeHoverPopup();
        this._currentHoveredFeature = null;
        
        this._lastRenderState.clear();
    }

    // These public methods are no longer needed - the state manager handles layer management

    /**
     * Handle feature hover - create popup at mouse location
     */
    _handleFeatureHover(data) {
        const { featureId, layerId, lngLat, feature } = data;
        
        // Skip if hover popups are disabled
        if (!this.options.showHoverPopups) return;
        
        // Skip on mobile devices to avoid conflicts with touch interactions
        if ('ontouchstart' in window) return;
        
        // Update popup with all currently hovered features
        this._updateHoverPopup(lngLat);
    }

    /**
     * Handle batch feature hover (PERFORMANCE OPTIMIZED)
     */
    _handleBatchFeatureHover(data) {
        const { hoveredFeatures, lngLat, affectedLayers } = data;
        
        // Skip if hover popups are disabled
        if (!this.options.showHoverPopups) return;
        
        // Skip on mobile devices to avoid conflicts with touch interactions
        if ('ontouchstart' in window) return;
        
        // Update popup with all currently hovered features in a single operation
        this._updateHoverPopupFromBatch(hoveredFeatures, lngLat);
    }

    /**
     * Handle all features leaving (map mouse leave or hover cleared)
     */
    _handleAllFeaturesLeave() {
        // Clear all layer header hover states
        this._clearAllLayerHeaderHoverStates();
        
        // Remove hover popup completely when all features leave
        // This ensures clean state when mouse moves off map
        this._removeHoverPopup();
        this._currentHoveredFeature = null;
    }

    /**
     * Clear hover states from all layer headers
     */
    _clearAllLayerHeaderHoverStates() {
        const layerElements = this._layersContainer.querySelectorAll('.feature-control-layer');
        layerElements.forEach(layerElement => {
            const headerElement = layerElement.querySelector('.feature-control-layer-header');
            if (headerElement) {
                headerElement.style.borderColor = 'transparent';
            }
        });
    }

    /**
     * Handle feature leave - update or remove hover popup
     */
    _handleFeatureLeave(data) {
        // Check if there are any remaining hovered features
        const hasHoveredFeatures = this._hasAnyHoveredFeatures();
        
        if (!hasHoveredFeatures) {
            // No more hovered features, hide popup smoothly
            this._hideHoverPopup();
            this._currentHoveredFeature = null;
        } else {
            // Still have hovered features, update popup content
            this._updateHoverPopup();
        }
    }

    /**
     * Check if there are any currently hovered features across all layers
     */
    _hasAnyHoveredFeatures() {
        if (!this._stateManager) return false;
        
        const activeLayers = this._stateManager.getActiveLayers();
        for (const [layerId, layerData] of activeLayers) {
            for (const [featureId, featureState] of layerData.features) {
                if (featureState.isHovered) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Update hover popup with all currently hovered features
     */
    _updateHoverPopup(lngLat = null) {
        if (!this._map) return;
        
        // Get all currently hovered features from state manager
        const hoveredFeatures = this._getAllHoveredFeatures();
        
        if (hoveredFeatures.length === 0) {
            this._removeHoverPopup();
            return;
        }
        
        // Use provided lngLat or get from the first hovered feature
        const popupLocation = lngLat || hoveredFeatures[0].featureState.lngLat;
        if (!popupLocation) return;
        
        const content = this._createHoverPopupContent(hoveredFeatures);
        if (!content) return;
        
        // Remove existing popup and create new one
        this._removeHoverPopup();
        
        this._hoverPopup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            className: 'hover-popup'
        })
        .setLngLat(popupLocation)
        .setDOMContent(content)
        .addTo(this._map);
    }

    /**
     * Get all currently hovered features from the state manager
     * Returns features ordered by config layer order to match map information display
     */
    _getAllHoveredFeatures() {
        if (!this._stateManager) return [];
        
        const activeLayers = this._stateManager.getActiveLayers();
        const configOrder = this._getConfigLayerOrder();
        const hoveredFeatures = [];
        
        // Process layers in config order to maintain consistent ordering with main display
        configOrder.forEach(layerId => {
            const layerData = activeLayers.get(layerId);
            if (!layerData) return;
            
            const layerConfig = layerData.config;
            layerData.features.forEach((featureState, featureId) => {
                // Show hover popup for all interactive layers (geojson, vector, csv), not just those with inspect
                if (featureState.isHovered && (layerConfig.inspect || 
                    layerConfig.type === 'geojson' || layerConfig.type === 'vector' || layerConfig.type === 'csv')) {
                    hoveredFeatures.push({
                        featureId,
                        layerId,
                        layerConfig,
                        featureState
                    });
                }
            });
        });
        
        return hoveredFeatures;
    }

    /**
     * Remove hover popup completely (for cleanup)
     */
    _removeHoverPopup() {
        if (this._hoverPopup) {
            this._hoverPopup.remove();
            this._hoverPopup = null;
        }
    }

    /**
     * Create hover popup content for single or multiple features
     * Shows feature title, up to 2 additional fields, and layer name
     */
    _createHoverPopupContent(hoveredFeatures) {
        if (hoveredFeatures.length === 0) return null;
        
        const container = document.createElement('div');
        container.className = 'map-popup';
        container.style.cssText = `
            max-width: 280px;
            background: white;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            padding: 6px 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 11px;
            line-height: 1.3;
        `;

        // Render each feature with layer context
        hoveredFeatures.forEach((item, index) => {
            const { featureState, layerConfig, layerId } = item;
            const feature = featureState.feature;
            
            // Add separator between features
            if (index > 0) {
                const separator = document.createElement('div');
                separator.style.cssText = 'border-top: 1px solid #e5e7eb; margin: 6px -2px; padding-top: 6px;';
                container.appendChild(separator);
            }
            
            const featureDiv = document.createElement('div');
            featureDiv.style.cssText = 'padding: 2px;';
            
            // Get feature title from label field or fallback
            const inspect = layerConfig.inspect || {};
            let featureTitle = 'Feature';
            
            if (inspect.label && feature.properties[inspect.label]) {
                featureTitle = String(feature.properties[inspect.label]);
            } else if (feature.properties.name) {
                featureTitle = String(feature.properties.name);
            } else if (feature.properties.title) {
                featureTitle = String(feature.properties.title);
            }
            
            // Feature title with emphasis
            const titleDiv = document.createElement('div');
            titleDiv.style.cssText = 'font-weight: 700; color: #111827; margin-bottom: 3px; font-size: 12px;';
            titleDiv.textContent = featureTitle;
            featureDiv.appendChild(titleDiv);
            
            // Additional fields (up to 2) - handle layers with or without inspect properties
            const fieldsContainer = document.createElement('div');
            fieldsContainer.style.cssText = 'margin-bottom: 3px;';
            
            let fieldCount = 0;
            const maxFields = 2;
            
            if (inspect.fields && inspect.fields.length > 0) {
                // Use configured fields if available
                inspect.fields.forEach((field, fieldIndex) => {
                    if (fieldCount >= maxFields) return;
                    if (field === inspect.label) return; // Skip label field as it's the title
                    
                    const value = feature.properties[field];
                    if (value !== undefined && value !== null && value !== '') {
                        const fieldDiv = document.createElement('div');
                        fieldDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 1px;';
                        
                        const fieldName = document.createElement('span');
                        fieldName.style.cssText = 'color: #6b7280; font-size: 10px; font-weight: 500; flex-shrink: 0;';
                        fieldName.textContent = (inspect.fieldTitles && inspect.fieldTitles[fieldIndex]) || field;
                        
                        const fieldValue = document.createElement('span');
                        fieldValue.style.cssText = 'color: #374151; font-size: 10px; text-align: right; word-break: break-word;';
                        fieldValue.textContent = String(value);
                        
                        fieldDiv.appendChild(fieldName);
                        fieldDiv.appendChild(fieldValue);
                        fieldsContainer.appendChild(fieldDiv);
                        
                        fieldCount++;
                    }
                });
            } else {
                // For layers without inspect, show first few meaningful properties
                const properties = feature.properties || {};
                const systemFields = ['id', 'fid', '_id', 'objectid', 'gid', 'osm_id', 'way_id'];
                
                Object.entries(properties).forEach(([field, value]) => {
                    if (fieldCount >= maxFields) return;
                    
                    // Skip system fields and empty values
                    if (systemFields.includes(field.toLowerCase()) || 
                        value === undefined || value === null || value === '') {
                        return;
                    }
                    
                    // Skip if this is the field used as title
                    if ((field === 'name' && featureTitle === String(value)) ||
                        (field === 'title' && featureTitle === String(value))) {
                        return;
                    }
                    
                    const fieldDiv = document.createElement('div');
                    fieldDiv.style.cssText = 'display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 1px;';
                    
                    const fieldName = document.createElement('span');
                    fieldName.style.cssText = 'color: #6b7280; font-size: 10px; font-weight: 500; flex-shrink: 0;';
                    fieldName.textContent = field;
                    
                    const fieldValue = document.createElement('span');
                    fieldValue.style.cssText = 'color: #374151; font-size: 10px; text-align: right; word-break: break-word;';
                    fieldValue.textContent = String(value);
                    
                    fieldDiv.appendChild(fieldName);
                    fieldDiv.appendChild(fieldValue);
                    fieldsContainer.appendChild(fieldDiv);
                    
                    fieldCount++;
                });
            }
            
            if (fieldsContainer.children.length > 0) {
                featureDiv.appendChild(fieldsContainer);
            }
            
            // Layer name
            const layerDiv = document.createElement('div');
            layerDiv.style.cssText = 'font-size: 9px; color: #9ca3af; font-style: italic; margin-top: 2px;';
            layerDiv.textContent = `from ${layerConfig.title || layerId}`;
            featureDiv.appendChild(layerDiv);
            
            container.appendChild(featureDiv);
        });

        // Add "click for more" hint
        const hintDiv = document.createElement('div');
        hintDiv.style.cssText = 'font-size: 9px; color: #9ca3af; margin-top: 4px; padding-top: 4px; border-top: 1px solid #f3f4f6; text-align: center; font-style: italic;';
        hintDiv.textContent = hoveredFeatures.length === 1 ? 'Click for details' : `${hoveredFeatures.length} features - click for details`;
        container.appendChild(hintDiv);

        return container;
    }

    /**
     * Update hover popup with batch hover data (PERFORMANCE OPTIMIZED)
     */
    _updateHoverPopupFromBatch(hoveredFeatures, lngLat) {
        if (!this._map) return;
        
        // If no features to show, hide popup but keep it alive for smooth transitions
        if (!hoveredFeatures || hoveredFeatures.length === 0) {
            this._hideHoverPopup();
            return;
        }
        
        // Convert batch data to format expected by popup creation
        const featuresByLayer = new Map();
        hoveredFeatures.forEach(({ featureId, layerId, feature }) => {
            const layerConfig = this._stateManager.getLayerConfig(layerId);
            // Include all interactive layers (geojson, vector, csv), not just those with inspect
            if (layerConfig && (layerConfig.inspect || 
                layerConfig.type === 'geojson' || layerConfig.type === 'vector' || layerConfig.type === 'csv')) {
                featuresByLayer.set(layerId, {
                    featureId,
                    layerId,
                    layerConfig,
                    featureState: {
                        feature,
                        layerId,
                        lngLat,
                        isHovered: true
                    }
                });
            }
        });
        
        // Order features by config layer order to match main display
        const configOrder = this._getConfigLayerOrder();
        const formattedFeatures = [];
        
        configOrder.forEach(layerId => {
            if (featuresByLayer.has(layerId)) {
                formattedFeatures.push(featuresByLayer.get(layerId));
            }
        });
        
        if (formattedFeatures.length === 0) {
            this._hideHoverPopup();
            return;
        }
        
        const content = this._createHoverPopupContent(formattedFeatures);
        if (!content) {
            this._hideHoverPopup();
            return;
        }
        
        // Create popup if it doesn't exist, or update existing popup
        if (!this._hoverPopup) {
            this._createHoverPopup(lngLat, content);
        } else {
            // Update existing popup content and position
            this._hoverPopup.setDOMContent(content);
            this._hoverPopup.setLngLat(lngLat);
        }
        
        // Show popup if it was hidden
        this._showHoverPopup();
    }

    /**
     * Create a persistent hover popup that follows the mouse
     */
    _createHoverPopup(lngLat, content) {
        this._hoverPopup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            closeOnMove: false, // Don't close when map moves
            className: 'hover-popup',
            maxWidth: '280px',
            offset: [0, -2] // Position 2px above the cursor as requested
        })
        .setLngLat(lngLat)
        .setDOMContent(content)
        .addTo(this._map);
        
        // Make popup non-interactive so it doesn't interfere with mouse events
        const popupElement = this._hoverPopup.getElement();
        if (popupElement) {
            popupElement.style.pointerEvents = 'none';
            popupElement.style.userSelect = 'none';
            // Add smooth transitions
            popupElement.style.transition = 'opacity 0.15s ease-in-out';
        }
    }

    /**
     * Show hover popup with smooth fade-in
     */
    _showHoverPopup() {
        if (!this._hoverPopup) return;
        
        const popupElement = this._hoverPopup.getElement();
        if (popupElement) {
            popupElement.style.opacity = '1';
            popupElement.style.visibility = 'visible';
        }
    }

    /**
     * Hide hover popup with smooth fade-out (but keep it alive)
     */
    _hideHoverPopup() {
        if (!this._hoverPopup) return;
        
        const popupElement = this._hoverPopup.getElement();
        if (popupElement) {
            popupElement.style.opacity = '0';
            popupElement.style.visibility = 'hidden';
        }
    }

    /**
     * Handle mousemove using queryRenderedFeatures with deduplication
     */
    _handleMouseMoveWithQueryRendered(e) {
        // Query all features at the mouse point once
        const features = this._map.queryRenderedFeatures(e.point);
        
        // Debug: Log all features found
        if (features.length > 0) {
            const featureInfo = features.map(f => ({
                layerId: f.layer.id,
                sourceId: f.source,
                sourceLayer: f.sourceLayer
            }));
        }
        
        // Group features by layerId to ensure only one feature per layer
        const layerGroups = new Map(); // key: layerId, value: features array
        features.forEach(feature => {
            // Find which registered layer this feature belongs to
            const layerId = this._findLayerIdForFeature(feature);
            
            if (layerId && this._stateManager.isLayerInteractive(layerId)) {
                if (!layerGroups.has(layerId)) {
                    layerGroups.set(layerId, []);
                }
                
                // Get the actual map layer to check its type
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
        
        // Process each layer group to select only the first/topmost feature per layer
        const interactiveFeatures = [];
        
        layerGroups.forEach((featuresInLayer, layerId) => {
            // Prioritize fill over line layers if both exist
            const fillFeatures = featuresInLayer.filter(f => f.layerType === 'fill');
            const lineFeatures = featuresInLayer.filter(f => f.layerType === 'line');
            
            let selectedFeature = null;
            
            // Strategy: Pick the first fill feature if available, otherwise first line feature, otherwise first of any type
            if (fillFeatures.length > 0) {
                selectedFeature = fillFeatures[0]; // First (topmost) fill feature
            } else if (lineFeatures.length > 0) {
                selectedFeature = lineFeatures[0]; // First (topmost) line feature
            } else {
                selectedFeature = featuresInLayer[0]; // First feature of any type
            }
            
            // Add the single selected feature for this layer
            if (selectedFeature) {
                interactiveFeatures.push({
                    feature: selectedFeature.feature,
                    layerId: selectedFeature.layerId,
                    lngLat: selectedFeature.lngLat
                });
            }
        });
                
        // Pass all interactive features to the state manager for batch processing
        this._stateManager.handleFeatureHovers(interactiveFeatures, e.lngLat);
    }

    /**
     * Update hover popup position to follow mouse smoothly
     */
    _updateHoverPopupPosition(lngLat) {
        if (!this._hoverPopup) return;
        
        this._hoverPopup.setLngLat(lngLat);
    }

    /**
     * Ease map to center on location with mobile-specific offset
     * On mobile, centers at 25% from top to account for inspector panel
     */
    _easeToCenterWithOffset(lngLat) {
        if (!this._map || !lngLat) return;
        
        // Detect mobile/small screens
        const isMobile = this._isMobileScreen();
        
        // Calculate offset based on screen type
        let offsetY = 0; // Default: center of screen (50%)
        
        if (isMobile) {
            // On mobile, offset upward so content centers at ~25% from top
            // This accounts for the inspector panel covering bottom half
            const mapHeight = this._map.getContainer().clientHeight;
            offsetY = -mapHeight * 0.25; // Negative offset moves center point UP
        }
        
        // Ease to the clicked location with smooth animation
        this._map.easeTo({
            center: lngLat,
            offset: [0, offsetY], // [x, y] offset in pixels
            duration: 600, // Smooth 600ms animation
            essential: true // Ensures animation runs even if user prefers reduced motion
        });
    }

    /**
     * Detect if we're on a mobile or small screen device
     */
    _isMobileScreen() {
        // Check multiple indicators for mobile/small screens
        const hasTouch = 'ontouchstart' in window;
        const smallScreen = window.innerWidth <= 768; // Common mobile breakpoint
        const userAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // Consider it mobile if any of these conditions are true
        return hasTouch || smallScreen || userAgent;
    }
}

// Make available globally for backwards compatibility
if (typeof window !== 'undefined') {
    window.MapFeatureControl = MapFeatureControl;
}

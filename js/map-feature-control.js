/**
 * MapFeatureControl - Enhanced version using event-driven architecture
 * 
 * This control displays a list of active layers in the bottom right corner of the map.
 * When users interact with features, it shows the feature information under the relevant layer
 * instead of using overlapping popups.
 * 
 * Now uses centralized MapFeatureStateManager for all state management.
 * Updated to use config JSON as source of truth for active layers.
 * UI completely rewritten to use Shoelace details components with nested structure.
 */

import { drawerStateManager } from './drawer-state-manager.js';
import { convertToKML } from './map-utils.js';

export class MapFeatureControl {
    constructor(options = {}) {
        this.options = {
            position: 'bottom-right',
            maxHeight: '300px',
            maxWidth: '350px',
            minWidth: '250px',
            collapsed: false,
            showHoverPopups: true, // New option to control hover popups
            inspectMode: false, // Default inspect mode off
            ...options
        };

        this._map = null;
        this._stateManager = null;
        this._container = null;
        this._layersContainer = null;
        this._mainDetails = null; // Main "Map Layers" details component
        this._drawerSwitch = null; // Drawer toggle switch
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
        
        // Drawer state tracking via centralized manager
        this._drawerStateListener = null;
        
        // Inspection mode controls
        this._inspectModeEnabled = false; // Default off as requested
        this._inspectSwitch = null;
        
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
        
        // Layer isolation state management
        this._layerHoverState = {
            isActive: false,
            hiddenLayers: [], // Track which layers we've hidden
            hoveredLayerId: null
        };
        
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
        
        // Set up a periodic sync to ensure config stays up to date
        setInterval(() => {
            if (!this._config && window.layerControl && window.layerControl._config) {
                this._config = window.layerControl._config;
            }
        }, 1000);
        
        // Initialize sourceLayerLinks from config or set default
        this._initializeSourceLayerLinks();
        
        // State manager and config set
        
        // Link the state manager to this control for inspect mode checking
        this._stateManager.setFeatureControl(this);
        
        // Listen to state changes from the centralized manager
        this._stateChangeListener = (event) => {
            this._handleStateChange(event.detail);
        };
        this._stateManager.addEventListener('state-change', this._stateChangeListener);
        
        // Set up drawer state tracking
        this._setupDrawerStateTracking();
        
        // Set up initial switch state once drawer state manager is ready
        // Use a longer delay to ensure mobile/desktop drawer initialization is complete
        setTimeout(() => {
            this._updateDrawerSwitch();
            // Initialize inspect mode state
            this._inspectModeEnabled = this.options.inspectMode;
        }, 300);
        
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
                    <div id="${containerId}" class="text-xs">
                        <div class="mb-2 font-semibold">Additional Information from Bhunaksha</div>
                        <span class="text-xs">Requesting Occupant Details...</span>
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
                                    <div class="text-xs" style="color: #d1d5db;">
                                        <div class="mb-2 font-semibold" style="color: #f3f4f6;">Additional Information from Bhunaksha</div>
                                        <div class="mb-2" style="color: #e5e7eb;">${infoText}</div>
                                        <div class="italic text-xs" style="color: #9ca3af;">
                                            <svg class="inline w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
                                            </svg>
                                            Retrieved from <a href="${apiUrl}" target="_blank" style="color: #60a5fa;" onmouseover="this.style.color='#93c5fd'" onmouseout="this.style.color='#60a5fa'">Bhunaksha/Dharani</a>. For information purposes only.
                                        </div>
                                    </div>
                                `;
                            } else {
                                container.innerHTML = `
                                    <div class="text-xs" style="color: #d1d5db;">
                                        <div class="mb-2 font-semibold" style="color: #f3f4f6;">Additional Information from Bhunaksha</div>
                                        <span class="text-xs" style="color: #9ca3af;">No occupant data available</span>
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
                                <div class="text-xs" style="color: #d1d5db;">
                                    <div class="mb-2 font-semibold" style="color: #f3f4f6;">Additional Information from Bhunaksha</div>
                                    <span class="text-xs" style="color: #ef4444;">Error loading details</span>
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
     * Create the main container with Shoelace details structure
     */
    _createContainer() {
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group map-feature-control';
        
        // Add custom styles for the container
        this._container.style.cssText = `
            background: #666;
            box-shadow: 0 0 0 2px rgba(0,0,0,.1);
            max-height: ${this.options.maxHeight};
            max-width: ${this.options.maxWidth};
            min-width: ${this.options.minWidth};
            overflow: hidden;
            display: flex;
            flex-direction: column;
            border-radius: 4px;
        `;

        // Create main details component for "Map Layers"
        this._createMainDetails();
        
        this._container.appendChild(this._mainDetails);
    }

    /**
     * Create the main "Map Layers" details component with drawer switch
     */
    _createMainDetails() {
        this._mainDetails = document.createElement('sl-details');
        this._mainDetails.className = 'map-layers-main';
        this._mainDetails.open = !this._isCollapsed;
        
        // Set custom styles for the main details
        this._mainDetails.style.cssText = `
            background: transparent;
            border: none;
            border-radius: 0;
            overflow: visible;
        `;

        // Create simple summary with just the title
        const summary = document.createElement('div');
        summary.setAttribute('slot', 'summary');
        summary.className = 'map-layers-summary';
        summary.style.cssText = `
            padding: 0px;
            background: transparent;
            color: #1f2937;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            `;

        // Create title text
        const title = document.createElement('span');
        title.textContent = 'Map Layers';
        summary.appendChild(title);
        this._mainDetails.appendChild(summary);

        // Create actions section for main details
        const actionsSection = this._createMainDetailsActions();
        this._mainDetails.appendChild(actionsSection);

        // Create layers container
        this._layersContainer = document.createElement('div');
        this._layersContainer.className = 'feature-control-layers';
        this._layersContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            max-height: calc(${this.options.maxHeight} - 90px);
            background: transparent;
            padding: 0;
        `;
        
        this._mainDetails.appendChild(this._layersContainer);

        // Add toggle handler for main details
        this._mainDetails.addEventListener('sl-toggle', (e) => {
            this._isCollapsed = !this._mainDetails.open;
        });
    }

    /**
     * Create actions section for main details with drawer toggle, inspect mode, and clear selection
     */
    _createMainDetailsActions() {
        const actionsSection = document.createElement('div');
        actionsSection.className = 'map-layers-actions';
        actionsSection.style.cssText = `
            padding: 4px 4px;
            background: rgba(0, 0, 0, 0.02);
            border-bottom: 1px solid rgba(0, 0, 0, 0.08);
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        `;

        // Create drawer toggle switch
        this._drawerSwitch = document.createElement('sl-switch');
        this._drawerSwitch.size = 'small';
        this._drawerSwitch.style.cssText = `
            --sl-color-primary-600: #3b82f6;
            --sl-color-primary-500: #3b82f6;
        `;
        
        // Add click handler to toggle drawer
        this._drawerSwitch.addEventListener('sl-change', (e) => {
            this._toggleLayerDrawer();
        });

        // Create label for the drawer switch
        const drawerSwitchLabel = document.createElement('label');
        drawerSwitchLabel.style.cssText = `
            font-size: 12px;
            color: #6b7280;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
        `;
        drawerSwitchLabel.textContent = 'Layer List';
        
        // Make label clickable
        drawerSwitchLabel.addEventListener('click', () => {
            this._drawerSwitch.checked = !this._drawerSwitch.checked;
            this._toggleLayerDrawer();
        });

        // Create inspect mode toggle switch
        this._inspectSwitch = document.createElement('sl-switch');
        this._inspectSwitch.size = 'small';
        this._inspectSwitch.checked = this.options.inspectMode;
        this._inspectSwitch.style.cssText = `
            --sl-color-primary-600: #f59e0b;
            --sl-color-primary-500: #f59e0b;
        `;
        
        // Add click handler to toggle inspect mode
        this._inspectSwitch.addEventListener('sl-change', (e) => {
            this._toggleInspectMode();
        });

        // Create label for the inspect switch with icon
        const inspectSwitchLabel = document.createElement('label');
        inspectSwitchLabel.style.cssText = `
            font-size: 12px;
            color: #6b7280;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 4px;
        `;
        
        const inspectIcon = document.createElement('sl-icon');
        inspectIcon.name = 'hand-index-thumb';
        inspectIcon.style.fontSize = '12px';
        
        inspectSwitchLabel.appendChild(inspectIcon);
        inspectSwitchLabel.appendChild(document.createTextNode('Inspect'));
        
        // Make label clickable
        inspectSwitchLabel.addEventListener('click', () => {
            this._inspectSwitch.checked = !this._inspectSwitch.checked;
            this._toggleInspectMode();
        });

        // Create clear selection button
        const clearSelectionBtn = document.createElement('sl-button');
        clearSelectionBtn.size = 'small';
        clearSelectionBtn.variant = 'text';
        clearSelectionBtn.style.cssText = `
            --sl-color-danger-600: #ef4444;
            --sl-color-danger-500: #ef4444;
            color: #ef4444;
            font-size: 11px;
        `;
        
        const clearIcon = document.createElement('sl-icon');
        clearIcon.name = 'x-circle';
        clearIcon.setAttribute('slot', 'prefix');
        clearIcon.style.fontSize = '12px';
        
        clearSelectionBtn.appendChild(clearIcon);
        clearSelectionBtn.appendChild(document.createTextNode('Clear Selection'));
        
        // Add click handler to clear all selections
        clearSelectionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._clearAllSelections();
        });

        // Add all controls to the actions section
        actionsSection.appendChild(this._drawerSwitch);
        actionsSection.appendChild(drawerSwitchLabel);
        
        // Add separator
        const separator1 = document.createElement('div');
        separator1.style.cssText = 'width: 1px; height: 16px; background: rgba(0,0,0,0.1); margin: 0 4px;';
        actionsSection.appendChild(separator1);
        
        actionsSection.appendChild(this._inspectSwitch);
        actionsSection.appendChild(inspectSwitchLabel);
        
        // Add separator
        const separator2 = document.createElement('div');
        separator2.style.cssText = 'width: 1px; height: 16px; background: rgba(0,0,0,0.1); margin: 0 4px;';
        actionsSection.appendChild(separator2);
        
        actionsSection.appendChild(clearSelectionBtn);

        return actionsSection;
    }

    /**
     * Update drawer switch state based on centralized manager
     */
    _updateDrawerSwitch() {
        if (!this._drawerSwitch) return;
        
        const isOpen = drawerStateManager && drawerStateManager.isOpen() || false;
        
        // Only update if the switch state differs from the drawer state
        if (this._drawerSwitch.checked !== isOpen) {
            this._drawerSwitch.checked = isOpen;
            console.log('[MapFeatureControl] Updated drawer switch to match drawer state:', isOpen);
        }
    }

    /**
     * Set up drawer state tracking using centralized manager
     */
    _setupDrawerStateTracking() {
        // Listen to drawer state changes from the centralized manager
        this._drawerStateListener = (event) => {
            const { isOpen, eventType } = event.detail;
            console.log('[MapFeatureControl] Received drawer state change:', eventType, 'isOpen:', isOpen);
            this._updateDrawerSwitch(); // Update switch state based on drawer state
        };

        // Listen to the global drawer state change event
        window.addEventListener('drawer-state-change', this._drawerStateListener);
    }

    /**
     * Toggle the layer drawer using centralized manager
     */
    _toggleLayerDrawer() {
        console.log('[MapFeatureControl] Toggling drawer, current state:', drawerStateManager.isOpen());
        drawerStateManager.toggle();
    }

    /**
     * Toggle inspect mode (hover interactions and popups)
     */
    _toggleInspectMode() {
        this._inspectModeEnabled = this._inspectSwitch.checked;
        this.options.showHoverPopups = this._inspectModeEnabled;
        
        // If inspect mode is disabled, clear any existing hover popups
        if (!this._inspectModeEnabled) {
            this._removeHoverPopup();
            if (this._stateManager) {
                this._stateManager.handleMapMouseLeave();
            }
        }
        
        // Inspect mode toggled silently to reduce noise
    }

    /**
     * Clear all selections across all layers
     */
    _clearAllSelections() {
        if (this._stateManager) {
            this._stateManager.clearAllSelections();
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
                // Update layer visual state for hover
                this._updateLayerVisualState(data.layerId, { hasHover: true });
                break;
            case 'features-batch-hover':
                // Handle batch hover events (PERFORMANCE OPTIMIZED)
                this._handleBatchFeatureHover(data);
                // Update layer visual state for all affected layers
                data.affectedLayers.forEach(layerId => {
                    this._updateLayerVisualState(layerId, { hasHover: true });
                });
                break;
            case 'features-hover-cleared':
            case 'map-mouse-leave':
                // Clear all hover states
                this._handleAllFeaturesLeave();
                // Clear hover visual states for all layers
                this._clearAllLayerVisualStates();
                break;
            case 'feature-click':
                // Handle cleared features first if they exist, then the new selection
                if (data.clearedFeatures && data.clearedFeatures.length > 0) {
                    this._handleSelectionsCleared(data.clearedFeatures);
                }
                // Render the clicked feature's layer and ensure it's expanded
                this._renderLayer(data.layerId);
                this._expandLayerForFeatureSelection(data.layerId);
                // Update layer visual state for selection
                this._updateLayerVisualState(data.layerId, { hasSelection: true });
                break;
            case 'feature-click-multiple':
                // Handle multiple feature selections from overlapping click
                if (data.clearedFeatures && data.clearedFeatures.length > 0) {
                    this._handleSelectionsCleared(data.clearedFeatures);
                }
                // Render all affected layers and ensure they're expanded
                const affectedLayers = new Set(data.selectedFeatures.map(f => f.layerId));
                affectedLayers.forEach(layerId => {
                    this._renderLayer(layerId);
                    this._expandLayerForFeatureSelection(layerId);
                    // Update layer visual state for selection
                    this._updateLayerVisualState(layerId, { hasSelection: true });
                });
                break;
            case 'selections-cleared':
                this._handleSelectionsCleared(data.clearedFeatures);
                // Update visual states for all layers that had selections cleared
                const clearedLayerIds = [...new Set(data.clearedFeatures.map(item => item.layerId))];
                clearedLayerIds.forEach(layerId => {
                    this._updateLayerVisualState(layerId, { hasSelection: false });
                });
                break;
            case 'feature-close':
                this._renderLayer(data.layerId);
                // Check if layer still has selections to update visual state
                this._updateLayerVisualStateFromFeatures(data.layerId);
                break;
            case 'feature-deselected':
                // Handle feature deselection (toggle off)
                this._renderLayer(data.layerId);
                // Check if layer still has selections to update visual state
                this._updateLayerVisualStateFromFeatures(data.layerId);
                break;
            case 'features-batch-deselected':
                // Handle batch deselection of multiple features
                data.affectedLayers.forEach(layerId => {
                    this._renderLayer(layerId);
                    // Check if layer still has selections to update visual state
                    this._updateLayerVisualStateFromFeatures(layerId);
                });
                break;
            case 'feature-leave':
                this._handleFeatureLeave(data);
                // Update layer visual state (remove hover if no features are hovered)
                this._updateLayerVisualStateFromFeatures(data.layerId);
                break;
            case 'layer-registered':
                // Re-render when layers are registered (turned on)
                this._scheduleRender();
                
                // Ensure URL is updated when layers are turned on
                if (window.urlManager) {
                    setTimeout(() => {
                        window.urlManager.updateURL();
                    }, 50);
                }
                break;
            case 'layer-unregistered':
                // Re-render when layers are unregistered (turned off)
                // This ensures the feature control stays in sync with layer toggles
                this._scheduleRender();
                
                // Ensure URL is updated when layers are turned off
                if (window.urlManager) {
                    setTimeout(() => {
                        window.urlManager.updateURL();
                    }, 50);
                }
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
     * Expand layer details when a feature is selected to provide visual feedback
     */
    _expandLayerForFeatureSelection(layerId) {
        const layerElement = this._layersContainer.querySelector(`[data-layer-id="${layerId}"]`);
        if (layerElement) {
            // Expand the main layer details
            layerElement.open = true;
            
            // Find and expand the features details specifically
            const featuresDetails = layerElement.querySelector('.features-details');
            if (featuresDetails) {
                featuresDetails.open = true;
            }
        }
        
        // Also ensure the main control is expanded
        if (this._mainDetails) {
            this._mainDetails.open = true;
            this._isCollapsed = false;
        }
    }

    /**
     * Update layer visual state based on feature states (hover/selection)
     * Selection is "sticky" - red border stays until explicitly cleared
     */
    _updateLayerVisualState(layerId, states) {
        const layerElement = this._layersContainer.querySelector(`[data-layer-id="${layerId}"]`);
        if (!layerElement) return;
        
        // Update CSS classes based on states
        // Always update hover visual state (inspect mode only affects popups)
        if (states.hasHover === true) {
            layerElement.classList.add('has-hover');
        } else if (states.hasHover === false) {
            layerElement.classList.remove('has-hover');
        }
        
        // Selection state is sticky - only changes when explicitly set
        if (states.hasSelection === true) {
            layerElement.classList.add('has-selection');
        } else if (states.hasSelection === false) {
            layerElement.classList.remove('has-selection');
        }
    }

    /**
     * Update layer visual state by examining current feature states
     */
    _updateLayerVisualStateFromFeatures(layerId) {
        if (!this._stateManager) return;
        
        const layerFeatures = this._stateManager.getLayerFeatures(layerId);
        let hasHover = false;
        let hasSelection = false;
        
        layerFeatures.forEach((featureState) => {
            if (featureState.isHovered) hasHover = true;
            if (featureState.isSelected) hasSelection = true;
        });
        
        // Always update both states to ensure correct visual state
        this._updateLayerVisualState(layerId, { hasHover, hasSelection });
    }

    /**
     * Clear all layer hover states only (preserve selection states)
     */
    _clearAllLayerVisualStates() {
        const layerElements = this._layersContainer.querySelectorAll('[data-layer-id]');
        layerElements.forEach(layerElement => {
            // Only remove hover, not selection - selection should be persistent
            layerElement.classList.remove('has-hover');
            
            // Update selection state based on actual feature states
            const layerId = layerElement.getAttribute('data-layer-id');
            if (layerId) {
                this._updateLayerVisualStateFromFeatures(layerId);
            }
        });
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
        if (!this._config || !this._config.layers) {
            // Try to get config from layer control if not available
            if (window.layerControl && window.layerControl._config) {
                this._config = window.layerControl._config;
            } else {
                // Fallback to state manager ordering if no config
                const activeLayers = this._stateManager.getActiveLayers();
                return Array.from(activeLayers.keys());
            }
        }
        
        // Use the layers array from config to maintain the exact order specified
        if (this._config.layers && Array.isArray(this._config.layers)) {
            return this._config.layers
                .filter(layer => {
                    // Include all layers that are registered with the state manager (visible layers)
                    return this._stateManager.getLayerConfig(layer.id) !== undefined;
                })
                .map(layer => layer.id);
        }
        
        // Fallback to groups if layers array doesn't exist (older config format)
        if (this._config.groups && Array.isArray(this._config.groups)) {
            return this._config.groups
                .filter(group => {
                    // Include all layers that are registered with the state manager (visible layers)
                    return this._stateManager.getLayerConfig(group.id) !== undefined;
                })
                .map(group => group.id);
        }
        
        // Final fallback
        const activeLayers = this._stateManager.getActiveLayers();
        return Array.from(activeLayers.keys());
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
            layerElement = this._createLayerDetailsElement(layerId, config);
            isNewElement = true;
        }

        // Update layer content
        this._updateLayerContent(layerElement, layerId, config, features);
        
        // Add to container if it's a new element, maintaining config order
        if (isNewElement) {
            this._insertLayerInOrder(layerElement, layerId);
        }
    }

    /**
     * Create a layer details element with nested structure
     */
    _createLayerDetailsElement(layerId, config) {
        const layerDetails = document.createElement('sl-details');
        layerDetails.className = 'layer-details';
        layerDetails.setAttribute('data-layer-id', layerId);
        layerDetails.open = false; // Collapsed by default
        
        // Set custom styles for layer details
        layerDetails.style.cssText = `
            --sl-panel-background-color: #777;
            --sl-panel-border-color: #333;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border-bottom: 1px solid rgba(0, 0, 0, 0.2);
            border-left: 6px solid #ababab;
        `;

        // Create custom summary with background image support
        const summary = document.createElement('div');
        summary.setAttribute('slot', 'summary');
        summary.className = 'layer-summary';
        
        let summaryStyle = `
            font-size: 13px;
            font-weight: 600;
            color: #1f2937;
            cursor: pointer;
            position: relative;
            min-height: 32px;
            display: flex;
            align-items: center;
            background: transparent;
        `;
        
        summary.style.cssText = summaryStyle;
        
        // Add background image class if available
        if (config.headerImage) {
            layerDetails.classList.add('has-header-image');
            layerDetails.setAttribute('data-header-image', config.headerImage);
            this._addHeaderImageCSS(layerId, config.headerImage);
        }
        
        // Create title text
        const title = document.createElement('span');
        title.textContent = config.title || config.id;
        title.style.cssText = 'position: relative; z-index: 2; flex: 1;';
        summary.appendChild(title);
        
        layerDetails.appendChild(summary);
        
        // Add hover event handlers for layer isolation
        this._addLayerIsolationHoverHandlers(layerDetails, layerId, config);
        
        return layerDetails;
    }

    /**
     * Update layer content with action buttons and nested details
     */
    _updateLayerContent(layerElement, layerId, config, features) {
        // Clear existing content except summary
        const existingContent = layerElement.querySelector('.layer-content');
        if (existingContent) {
            existingContent.remove();
        }

        // Create main content container
        const contentContainer = document.createElement('div');
        contentContainer.className = 'layer-content';
        contentContainer.style.cssText = `
            background: transparent;
        `;

        // Create actions section
        const actionsSection = document.createElement('div');
        actionsSection.className = 'layer-actions-section';

        // Create action buttons
        const actionsContainer = this._createLayerActions(layerId, config);
        actionsSection.appendChild(actionsContainer);
        contentContainer.appendChild(actionsSection);

        // Create nested details group container for Source, Legend, and Features
        const detailsGroup = document.createElement('div');
        detailsGroup.className = `details-group-${layerId}`;

        // Create nested details for Source, Legend, and Features
        const nestedDetails = this._createNestedDetails(layerId, config, features);
        nestedDetails.forEach(detail => detailsGroup.appendChild(detail));

        // Set up accordion behavior - only one detail open at a time
        this._setupDetailsGroupAccordion(detailsGroup);

        contentContainer.appendChild(detailsGroup);
        layerElement.appendChild(contentContainer);
    }

    /**
     * Create action controls for the layer
     */
    _createLayerActions(layerId, config) {
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'layer-actions';
        actionsContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        // Create opacity dropdown
        const opacityDropdown = this._createOpacityDropdown(layerId, config);
        actionsContainer.appendChild(opacityDropdown);

        // Create remove layer button
        const removeBtn = document.createElement('sl-button');
        removeBtn.size = 'small';
        removeBtn.variant = 'text';
        removeBtn.innerHTML = '<sl-icon name="x"></sl-icon>';
        removeBtn.style.cssText = `
            min-width: auto;
        `;

        // Add click handler for layer removal
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._removeLayer(layerId);
        });

        actionsContainer.appendChild(removeBtn);

        return actionsContainer;
    }

    /**
     * Create opacity dropdown with various opacity stops
     */
    _createOpacityDropdown(layerId, config) {
        const dropdown = document.createElement('sl-dropdown');
        dropdown.setAttribute('data-layer-id', layerId);
        dropdown.style.cssText = 'flex: 1;';

        // Create trigger button
        const trigger = document.createElement('sl-button');
        trigger.setAttribute('slot', 'trigger');
        trigger.size = 'small';
        trigger.caret = true;
        trigger.style.cssText = `
            --sl-color-primary-600: #6b7280;
            --sl-color-primary-500: #6b7280;
            width: 100%;
            font-size: 11px;
        `;
        
        // Set initial text - default to "Opacity" to avoid NaN display
        const currentOpacity = this._getCurrentLayerOpacity(layerId, config);
        const opacityText = (!isNaN(currentOpacity) && isFinite(currentOpacity)) 
            ? `${Math.round(currentOpacity * 100)}% Opacity`
            : 'Opacity';
        trigger.innerHTML = `
            <sl-icon name="lightbulb" slot="prefix"></sl-icon>
            ${opacityText}
        `;

        // Create menu with opacity options
        const menu = document.createElement('sl-menu');
        
        const opacityOptions = [
            { value: 1.0, label: '100%' },
            { value: 0.9, label: '90%' },
            { value: 0.4, label: '40%' },
            { value: 0.1, label: '10%' }
        ];

        opacityOptions.forEach(option => {
            const menuItem = document.createElement('sl-menu-item');
            menuItem.setAttribute('value', option.value);
            menuItem.textContent = option.label;
            menuItem.style.fontSize = '11px';
            
            // Mark current opacity as checked
            if (Math.abs(currentOpacity - option.value) < 0.05) {
                menuItem.setAttribute('type', 'checkbox');
                menuItem.checked = true;
            }
            
            menu.appendChild(menuItem);
        });

        // Add event listener for opacity selection
        dropdown.addEventListener('sl-select', (e) => {
            const selectedValue = parseFloat(e.detail.item.value);
            
            // Update trigger text with safe NaN check
            const opacityText = (!isNaN(selectedValue) && isFinite(selectedValue)) 
                ? `${Math.round(selectedValue * 100)}% Opacity`
                : 'Opacity';
            trigger.innerHTML = `
                <sl-icon name="lightbulb" slot="prefix"></sl-icon>
                ${opacityText}
            `;
            
            // Apply opacity to layer
            this._applyLayerOpacity(layerId, config, selectedValue);
            
            // Update menu item checked states
            menu.querySelectorAll('sl-menu-item').forEach(item => {
                item.removeAttribute('type');
                item.checked = false;
            });
            e.detail.item.setAttribute('type', 'checkbox');
            e.detail.item.checked = true;
        });

        dropdown.appendChild(trigger);
        dropdown.appendChild(menu);

        return dropdown;
    }

    /**
     * Create nested details for Source, Legend, and Features
     */
    _createNestedDetails(layerId, config, features) {
        const details = [];

        // Source Details
        const sourceDetails = this._createSourceDetails(layerId, config);
        if (sourceDetails) details.push(sourceDetails);

        // Legend Details
        const legendDetails = this._createLegendDetails(layerId, config);
        if (legendDetails) details.push(legendDetails);

        // Features Details (only for vector and geojson layers)
        if (config.type === 'vector' || config.type === 'geojson') {
            const featuresDetails = this._createFeaturesDetails(layerId, config, features);
            if (featuresDetails) details.push(featuresDetails);
        }

        return details;
    }

    /**
     * Set up accordion behavior for details group - only one detail open at a time
     */
    _setupDetailsGroupAccordion(detailsGroup) {
        // Listen for sl-show events on any details within this group
        detailsGroup.addEventListener('sl-show', (event) => {
            // Only handle direct child sl-details elements
            if (event.target.localName === 'sl-details' && event.target.parentElement === detailsGroup) {
                // Close all other details in this group
                const allDetails = detailsGroup.querySelectorAll('sl-details');
                allDetails.forEach(detail => {
                    if (detail !== event.target) {
                        detail.open = false;
                    }
                });
            }
        });
    }

    /**
     * Add custom CSS for header background images
     */
    _addHeaderImageCSS(layerId, imageUrl) {
        // Create or get existing style element for header images
        let styleElement = document.getElementById('map-feature-control-header-images');
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = 'map-feature-control-header-images';
            document.head.appendChild(styleElement);
        }

        // Add CSS rule for this specific layer
        const cssRule = `
.map-feature-control .layer-details[data-layer-id="${layerId}"]::part(header) {
    background-image: linear-gradient(to right, rgba(255,255,255,0.9), rgba(255,255,255,0.5)), url('${imageUrl}') !important;
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
}`;

        // Append the rule to the style element
        styleElement.textContent += cssRule;
    }

    /**
     * Create Source details component
     */
    _createSourceDetails(layerId, config) {
        const hasContent = config.description || config.attribution;
        if (!hasContent) return null;

        const sourceDetails = document.createElement('sl-details');
        sourceDetails.className = 'source-details';
        sourceDetails.open = false; // Collapsed by default
        
        sourceDetails.style.cssText = `
            font-size: 11px;
        `;

        // Create summary with first line preview
        const summary = document.createElement('div');
        summary.setAttribute('slot', 'summary');
        summary.className = 'source-summary';
        summary.style.cssText = `
            padding: 6px 0;
            font-size: 11px;
            color: #374151;
        `;

        // Get first line of content for preview
        let firstLine = 'Source';
        if (config.description) {
            // Strip HTML and get first line
            const textContent = config.description.replace(/<[^>]*>/g, '').trim();
            firstLine = textContent.split('\n')[0].substring(0, 50);
            if (textContent.length > 50) firstLine += '...';
        } else if (config.attribution) {
            const textContent = config.attribution.replace(/<[^>]*>/g, '').trim();
            firstLine = textContent.split('\n')[0].substring(0, 50);
            if (textContent.length > 50) firstLine += '...';
        }

        summary.textContent = firstLine;
        sourceDetails.appendChild(summary);

        // Create content
        const content = document.createElement('div');
        content.style.cssText = `
            padding: 8px 0;
            background: transparent;
            font-size: 11px;
            line-height: 1.4;
            color: #6b7280;
        `;

        if (config.description) {
            const descDiv = document.createElement('div');
            descDiv.innerHTML = config.description;
            descDiv.style.cssText = 'margin-bottom: 8px;';
            content.appendChild(descDiv);
        }

        if (config.attribution) {
            const attrDiv = document.createElement('div');
            attrDiv.innerHTML = config.attribution;
            attrDiv.style.cssText = 'font-style: italic; color: #bbb;';
            content.appendChild(attrDiv);
        }

        sourceDetails.appendChild(content);
        return sourceDetails;
    }

    /**
     * Create Legend details component
     */
    _createLegendDetails(layerId, config) {
        const hasLegend = config.legend || config.legendImage;
        if (!hasLegend) return null;

        const legendDetails = document.createElement('sl-details');
        legendDetails.className = 'legend-details';
        legendDetails.open = false; // Collapsed by default
        
        legendDetails.style.cssText = `
            margin-bottom: 2px;
            font-size: 11px;
        `;

        // Create summary
        const summary = document.createElement('div');
        summary.setAttribute('slot', 'summary');
        summary.className = 'legend-summary';
        summary.style.cssText = `
            padding: 6px 0;
            font-size: 11px;
            font-weight: 600;
            color: #374151;
        `;
        summary.textContent = 'Legend';
        legendDetails.appendChild(summary);

        // Create content
        const content = document.createElement('div');
        content.style.cssText = `
            padding: 8px 0;
            background: transparent;
        `;

        if (config.legendImage) {
            const img = document.createElement('img');
            img.src = config.legendImage;
            img.style.cssText = `
                max-width: 100%;
                height: auto;
                border-radius: 4px;
                cursor: pointer;
            `;
            
            // Add click handler for modal view
            img.addEventListener('click', () => {
                this._showLegendModal(config.legendImage);
            });
            
            content.appendChild(img);
        } else if (config.legend) {
            const legendDiv = document.createElement('div');
            legendDiv.innerHTML = config.legend;
            legendDiv.style.cssText = 'font-size: 10px; color: #ddd;';
            content.appendChild(legendDiv);
        }

        legendDetails.appendChild(content);
        return legendDetails;
    }

    /**
     * Create Features details component
     */
    _createFeaturesDetails(layerId, config, features) {
        const featuresDetails = document.createElement('sl-details');
        featuresDetails.className = 'features-details';
        featuresDetails.setAttribute('data-layer-features', layerId);
        featuresDetails.id = `features-container-${layerId}`;
        featuresDetails.open = false; // Collapsed by default
        
        featuresDetails.style.cssText = `
            margin-bottom: 2px;
            font-size: 11px;
        `;

        // Create summary with feature count
        const summary = document.createElement('div');
        summary.setAttribute('slot', 'summary');
        summary.className = 'features-summary';
        summary.style.cssText = `
            padding: 6px 0;
            font-size: 11px;
            color: #374151;
        `;

        // Count selected features
        const selectedCount = Array.from(features.values()).filter(f => f.isSelected).length;
        summary.textContent = selectedCount > 0 ? `Features (${selectedCount})` : 'Features';
        featuresDetails.appendChild(summary);

                // Create content container for features
        const content = document.createElement('div');
        content.className = 'features-content';
        content.style.cssText = `
                max-height: 200px;
                overflow-y: auto;
            background: transparent;
            padding: 4px 0;
        `;

        // Only show selected features
        const selectedFeatures = new Map();
        features.forEach((featureState, featureId) => {
            if (featureState.isSelected) {
                selectedFeatures.set(featureId, featureState);
            }
        });

        if (selectedFeatures.size > 0) {
            const sortedFeatures = this._getSortedFeatures(selectedFeatures);
            sortedFeatures.forEach(([featureId, featureState]) => {
                this._renderFeatureInDetails(content, featureState, config, layerId);
            });
        } else {
            // Show empty state
            const emptyDiv = document.createElement('div');
            emptyDiv.style.cssText = `
                padding: 12px;
                text-align: center;
                color: #999;
                font-size: 10px;
                font-style: italic;
            `;
            emptyDiv.textContent = 'No features selected';
            content.appendChild(emptyDiv);
        }

        featuresDetails.appendChild(content);
        return featuresDetails;
    }

    /**
     * Render feature within details component structure
     */
    _renderFeatureInDetails(container, featureState, layerConfig, layerId) {
        const featureElement = document.createElement('div');
        const featureId = this._getFeatureId(featureState.feature);
        
        featureElement.className = 'feature-control-feature selected';
        featureElement.setAttribute('data-feature-id', featureId);
        featureElement.setAttribute('data-layer-id', layerId);
        
        // Add standardized ID for direct targeting: inspector-{layerId}-{featureId}
        featureElement.id = `inspector-${layerId}-${featureId}`;
        
        // Selected feature styling for the details structure
        featureElement.style.cssText = `
            border-bottom: 1px solid #555;
            font-size: 11px;
            background: #3a3a3a;
            cursor: pointer;
            padding: 0;
            margin-bottom: 4px;
            border-radius: 4px;
            overflow: hidden;
        `;

        // Render detailed content for selected features
        const content = this._createFeatureContentForDetails(featureState, layerConfig, layerId, featureId);
        featureElement.appendChild(content);

        container.appendChild(featureElement);
    }

    /**
     * Create feature content optimized for details structure
     */
    _createFeatureContentForDetails(featureState, layerConfig, layerId, featureId) {
        const content = document.createElement('div');
        content.className = 'feature-inspector-content';
        content.id = `content-${layerId}-${featureId}`;
        
        // Properties table content with compact styling for nested view
        const tableContent = document.createElement('div');
        tableContent.className = 'feature-inspector-table-content';
        tableContent.id = `table-content-${layerId}-${featureId}`;
        tableContent.style.cssText = 'max-height: 200px; overflow-y: auto;';
        
        // Build the properties table with intelligent formatting (reuse existing logic)
        const table = document.createElement('table');
        table.className = 'feature-inspector-properties-table';
        table.id = `properties-table-${layerId}-${featureId}`;
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 6px;
            font-family: inherit;
            background-color: #2a2a2a;
            border-radius: 4px;
            overflow: hidden;
            font-size: 10px;
        `;
        
        const properties = featureState.feature.properties || {};
        const inspect = layerConfig.inspect || {};
        
        // Get field configuration (reuse existing logic)
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
        
        // 3. Add remaining fields for completeness (limited to prevent clutter)
        Object.entries(properties).slice(0, 5).forEach(([key, value]) => {
            // Skip if already added as label or priority field
            if (key === labelField || priorityFields.includes(key)) {
                return;
            }
            
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
        
        // Render the organized fields with compact styling
        organizedFields.forEach(field => {
            const row = document.createElement('tr');
            
            // Set row background with darker theme for nested view
            let rowBackgroundColor = '#2a2a2a';
            if (field.isLabel) {
                rowBackgroundColor = '#333';
            } else if (field.isPriority) {
                rowBackgroundColor = '#2d2d2d';
            }
            
            row.style.cssText = `
                border-bottom: 1px solid #444;
                background-color: ${rowBackgroundColor};
                transition: background-color 0.1s ease;
            `;
            
            const keyCell = document.createElement('td');
            keyCell.style.cssText = `
                padding: 4px 6px;
                font-weight: 500;
                color: ${field.isLabel ? '#fff' : field.isPriority ? '#ddd' : '#bbb'};
                width: 40%;
                vertical-align: top;
                line-height: 1.2;
                font-size: 9px;
            `;
            keyCell.textContent = field.displayName;
            
            const valueCell = document.createElement('td');
            valueCell.style.cssText = `
                padding: 4px 6px;
                word-break: break-word;
                font-size: 9px;
                font-weight: ${field.isLabel ? '500' : '400'};
                color: ${field.isLabel ? '#fff' : '#ccc'};
                line-height: 1.2;
                vertical-align: top;
            `;
            valueCell.textContent = String(field.value);
            
            row.appendChild(keyCell);
            row.appendChild(valueCell);
            table.appendChild(row);
        });
        
        tableContent.appendChild(table);
        content.appendChild(tableContent);
        
        // Add source layer links content if applicable (simplified for nested view)
        this._addSourceLayerLinksContentToDetails(content, featureState, layerConfig);
        
        // Add feature actions footer
        this._addFeatureActionsToContent(content, featureState, layerConfig, layerId, featureId);
        
        return content;
    }

    /**
     * Add source layer links content optimized for details view
     */
    _addSourceLayerLinksContentToDetails(content, featureState, layerConfig) {
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

        // Create container for additional information with compact styling
        const additionalInfoContainer = document.createElement('div');
        additionalInfoContainer.className = 'feature-inspector-additional-info';
        additionalInfoContainer.style.cssText = `
            margin-top: 8px;
            padding: 6px;
            border-top: 1px solid #444;
            background-color: #333;
            border-radius: 0 0 4px 4px;
            font-size: 9px;
        `;

        // Process each applicable link (simplified rendering for nested view)
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
                        linkContainer.style.fontSize = '9px'; // Override for compact view
                        
                        // Add separator between multiple links
                        if (index > 0) {
                            const separator = document.createElement('div');
                            separator.style.cssText = 'border-top: 1px solid #444; margin: 4px 0; padding-top: 4px;';
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
     * Add feature actions footer with Export KML and Settings buttons
     */
    _addFeatureActionsToContent(content, featureState, layerConfig, layerId, featureId) {
        const feature = featureState.feature;
        
        // Create container for action buttons
        const actionContainer = document.createElement('div');
        actionContainer.className = 'feature-actions';
        actionContainer.style.cssText = `
            padding: 8px 6px;
            border-top: 1px solid #444;
            background-color: #2d2d2d;
            display: flex;
            gap: 8px;
            font-size: 10px;
            border-radius: 0 0 4px 4px;
            min-width: 0;
            flex-wrap: wrap;
        `;

        // Add settings button - always visible
        const settingsButton = document.createElement('button');
        settingsButton.className = 'feature-action-button';
        settingsButton.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            background: none;
            border: none;
            color: #bbb;
            cursor: pointer;
            padding: 4px 6px;
            border-radius: 3px;
            font-size: 10px;
            transition: all 0.2s ease;
            white-space: nowrap;
            min-width: auto;
            flex: 1 1 auto;
        `;
        
        settingsButton.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Settings</span>
        `;

        // Add hover effects
        settingsButton.addEventListener('mouseenter', () => {
            settingsButton.style.backgroundColor = '#444';
            settingsButton.style.color = '#fff';
        });
        
        settingsButton.addEventListener('mouseleave', () => {
            settingsButton.style.backgroundColor = 'transparent';
            settingsButton.style.color = '#bbb';
        });

        // Add click handler for settings button
        settingsButton.addEventListener('click', () => {
            this._showLayerSettings(layerConfig);
        });

        actionContainer.appendChild(settingsButton);

        // Add export KML button
        if (this._map) {
            const exportButton = document.createElement('button');
            exportButton.className = 'feature-action-button';
            exportButton.style.cssText = `
                display: flex;
                align-items: center;
                gap: 4px;
                background: none;
                border: none;
                color: #bbb;
                cursor: pointer;
                padding: 4px 6px;
                border-radius: 3px;
                font-size: 10px;
                transition: all 0.2s ease;
                white-space: nowrap;
                min-width: auto;
                flex: 1 1 auto;
            `;
            
            exportButton.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>Export KML</span>
            `;

            // Add hover effects
            exportButton.addEventListener('mouseenter', () => {
                exportButton.style.backgroundColor = '#444';
                exportButton.style.color = '#fff';
            });
            
            exportButton.addEventListener('mouseleave', () => {
                exportButton.style.backgroundColor = 'transparent';
                exportButton.style.color = '#bbb';
            });

            // Add click handler for export button
            exportButton.addEventListener('click', () => {
                this._exportFeatureAsKML(feature, layerConfig);
            });

            actionContainer.appendChild(exportButton);
        }

        content.appendChild(actionContainer);
    }

    /**
     * Export feature as KML file
     */
    _exportFeatureAsKML(feature, layerConfig) {
        try {
            // Generate meaningful filename from feature properties
            const fieldValues = layerConfig.inspect?.fields
                ? layerConfig.inspect.fields
                    .map(field => feature.properties[field])
                    .filter(value => value)
                    .join('_')
                : '';
            const groupTitle = feature.properties[layerConfig.inspect?.label] || 'Exported';
            const title = fieldValues
                ? `${fieldValues}_${groupTitle}`
                : feature.properties[layerConfig.inspect?.label] || 'Exported_Feature';
            const description = layerConfig.inspect?.title || 'Exported from Amche Goa';

            // Check if convertToKML function is available
            if (typeof convertToKML === 'undefined') {
                console.error('convertToKML function is not available');
                this._showToast('KML export function not available', 'error');
                return;
            }

            const kmlContent = convertToKML(feature, { title, description });

            const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });
            const url = URL.createObjectURL(blob);

            // Check if we're on iOS/iPadOS
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

            if (isIOS) {
                // iOS fallback method - open in new tab
                window.open(url, '_blank');

                // Show instructions
                this._showToast('On iPad: Tap and hold the page, then select "Download Linked File" to save the KML', 'info', 10000);

                // Clean up after delay
                setTimeout(() => {
                    URL.revokeObjectURL(url);
                }, 60000); // Keep available for 1 minute
            } else {
                // Regular download for other platforms
                const downloadLink = document.createElement('a');
                downloadLink.href = url;
                downloadLink.download = `${title}.kml`;
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                URL.revokeObjectURL(url);
            }

        } catch (error) {
            console.error('Error exporting KML:', error);
            this._showToast('Error exporting KML. Please check the console for details.', 'error');
        }
    }

    /**
     * Show layer settings modal
     */
    _showLayerSettings(layerConfig) {
        // Try to access the layer control's settings method
        if (window.layerControl && typeof window.layerControl._showLayerSettings === 'function') {
            window.layerControl._showLayerSettings(layerConfig);
        } else {
            console.warn('Layer settings functionality not available');
            this._showToast('Layer settings not available', 'warning');
        }
    }

    /**
     * Show toast notification
     */
    _showToast(message, type = 'success', duration = 3000) {
        // Try to use the layer control's toast method if available
        if (window.layerControl && typeof window.layerControl._showToast === 'function') {
            window.layerControl._showToast(message, type, duration);
            return;
        }

        // Fallback toast implementation
        const toast = document.createElement('div');
        toast.className = `map-feature-control-toast toast-${type}`;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : type === 'info' ? '#3b82f6' : '#10b981'};
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            font-size: 14px;
            max-width: 300px;
            word-wrap: break-word;
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
        `;
        toast.textContent = message;

        document.body.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        });

        // Auto remove
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, duration);
    }

    /**
     * Remove layer by directly targeting the layer control toggle
     * Uses jQuery and waits for Shoelace component to be ready
     */
    async _removeLayer(layerId) {
        try {
            // Use jQuery to find the layer element
            const $layerElement = $(`sl-details[data-layer-id="${layerId}"]`);
            
            if ($layerElement.length === 0) {
                console.warn(`[FeatureControl] Layer element with data-layer-id="${layerId}" not found`);
                return;
            }
            
            const layerElement = $layerElement[0];
            
            // Wait for Shoelace component to finish updating
            if (layerElement.updateComplete) {
                await layerElement.updateComplete;
            }
            
            // Use jQuery to find the toggle input with multiple selector attempts
            let $toggleInput = $layerElement.find('.toggle-switch input[type="checkbox"]');
            
            // Fallback selectors if the first one doesn't work
            if ($toggleInput.length === 0) {
                $toggleInput = $layerElement.find('input[type="checkbox"]');
            }
            
            // Additional fallback - search more broadly
            if ($toggleInput.length === 0) {
                $toggleInput = $layerElement.find('input');
            }
            
            console.log(`[FeatureControl] Debug - Layer ${layerId}:`, {
                layerElement: !!layerElement,
                toggleInput: $toggleInput.length > 0,
                isChecked: $toggleInput.length > 0 ? $toggleInput.prop('checked') : 'N/A',
                toggleInputElement: $toggleInput.length > 0 ? $toggleInput[0] : null,
                foundElements: $toggleInput.length
            });
            
            if ($toggleInput.length > 0) {
                // Use jQuery to uncheck and trigger change event
                $toggleInput.prop('checked', false);
                $toggleInput.trigger('change');
                
                // Close the details and remove active state using jQuery
                $layerElement.prop('open', false);
                $layerElement.removeClass('active');
                
                console.log(`[FeatureControl] Layer ${layerId} toggled off successfully`);
            } else {
                console.error(`[FeatureControl] No checkbox input found for layer ${layerId}`);
                
                // Last resort: try to find any clickable element that might toggle the layer
                const $anyToggle = $layerElement.find('[type="checkbox"], .toggle-switch, .toggle-slider');
                if ($anyToggle.length > 0) {
                    console.log(`[FeatureControl] Attempting to click any toggle element for ${layerId}`);
                    $anyToggle.first().click();
                }
            }
            
        } catch (error) {
            console.error(`[FeatureControl] Error removing layer ${layerId}:`, error);
        }
    }

    /**
     * Show legend in modal (reuse existing implementation)
     */
    _showLegendModal(imageSrc) {
        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'legend-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.75);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            opacity: 1;
            visibility: visible;
        `;

        const modalContent = document.createElement('div');
        modalContent.className = 'legend-modal-content';
        modalContent.style.cssText = `
            background: white;
            padding: 1rem;
            border-radius: 8px;
            position: relative;
            max-width: 90vw;
            max-height: 90vh;
            overflow: auto;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        `;

        const img = document.createElement('img');
        img.src = imageSrc;
        img.style.cssText = `
            display: block;
            max-width: 100%;
            height: auto;
        `;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'legend-modal-close';
        closeBtn.innerHTML = '×';
        closeBtn.style.cssText = `
            position: absolute;
            top: 0.5rem;
            right: 0.5rem;
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            background: white;
            border: none;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            color: #666;
        `;

        closeBtn.addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        modalContent.appendChild(img);
        modalContent.appendChild(closeBtn);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
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
        
        // Don't update header button here - let drawer state tracking handle it
        // The button state should be independent of layer state
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
            padding: 8px 12px;
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
            min-height: 32px;
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

        // Action button container
        const actionBtn = document.createElement('div');
        actionBtn.className = 'layer-action-btn';
        actionBtn.style.cssText = `
            position: relative;
            z-index: 2;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: background-color 0.2s ease;
        `;

        // Create and update the button based on collapse state
        this._updateActionButton(actionBtn, layerId, config);

        layerHeader.appendChild(actionBtn);

        // Add click handler for header (collapse/expand functionality only for inspectable layers)
        const isInspectable = config.inspect || config.type === 'geojson' || config.type === 'vector' || config.type === 'csv';
        
        if (isInspectable) {
            layerHeader.addEventListener('click', (e) => {
                // Check if click was on the action button
                if (actionBtn.contains(e.target)) {
                    return; // Let the button handle its own click
                }
                
                e.stopPropagation(); // Prevent event bubbling
                
                // Toggle collapse state
                const currentState = this._layerCollapseStates.get(layerId) || false;
                const newState = !currentState;
                this._layerCollapseStates.set(layerId, newState);
                
                // Update action button
                this._updateActionButton(actionBtn, layerId, config);
                
                // Find and toggle the features container
                const layerElement = layerHeader.closest('.feature-control-layer');
                const featuresContainer = layerElement.querySelector(`[data-layer-features="${layerId}"]`);
                
                if (featuresContainer) {
                    featuresContainer.style.display = newState ? 'none' : 'block';
                }
            });
        } else {
            // For non-inspectable layers, only show close button functionality
            layerHeader.style.cursor = 'default';
        }

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
     * Update the action button based on layer state (collapsed/expanded)
     */
    _updateActionButton(actionBtn, layerId, config) {
        const isInspectable = config.inspect || config.type === 'geojson' || config.type === 'vector' || config.type === 'csv';
        const isCollapsed = this._layerCollapseStates.get(layerId) || false;
        
        // Clear existing content
        actionBtn.innerHTML = '';
        
        // For non-inspectable layers, always show only the close button
        if (!isInspectable || isCollapsed) {
            // Show close button when collapsed
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '×';
            closeBtn.style.cssText = `
                background: none;
                border: none;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                color: #fff;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.7);
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: background-color 0.2s ease;
                padding: 0;
                margin: 0;
            `;
            
            // Hover effect
            closeBtn.addEventListener('mouseenter', () => {
                closeBtn.style.backgroundColor = 'rgba(255,0,0,0.2)';
            });
            
            closeBtn.addEventListener('mouseleave', () => {
                closeBtn.style.backgroundColor = 'transparent';
            });
            
            // Click handler to turn off layer
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._toggleLayerOff(layerId);
            });
            
            closeBtn.title = 'Turn off layer';
            actionBtn.appendChild(closeBtn);
            
        } else {
            // Show opacity lightbulb button when expanded
            const opacityBtn = document.createElement('sl-icon-button');
            opacityBtn.setAttribute('name', 'lightbulb-fill'); // Start with full lightbulb (high opacity)
            opacityBtn.setAttribute('data-opacity', '0.9'); // Start at high opacity so first click goes to low
            opacityBtn.setAttribute('data-hover-state', 'false'); // Track if we're in hover preview mode
            opacityBtn.title = 'Toggle opacity';
            opacityBtn.style.cssText = `
                --sl-color-neutral-600: #ffffff;
                --sl-color-primary-600: currentColor;
                --sl-color-primary-500: currentColor;
                color: #ffffff;
                font-size: 16px;
                opacity: 0.5;
                transition: opacity 0.2s ease;
                width: 24px;
                height: 24px;
                padding: 0;
                margin: 0;
            `;
            
            // Store original layer opacity for hover preview
            const originalOpacity = this._getCurrentLayerOpacity(layerId, config);
            
            // Hover handler - preview opacity change
            opacityBtn.addEventListener('mouseenter', (e) => {
                opacityBtn.style.opacity = '1.0';
                // Preview the opposite opacity state
                const currentOpacity = parseFloat(opacityBtn.getAttribute('data-opacity'));
                const previewOpacity = currentOpacity === 0.4 ? 0.9 : 0.4;
                
                // Store current icon state for restoration
                const currentIcon = opacityBtn.getAttribute('name');
                opacityBtn.setAttribute('data-original-icon', currentIcon);
                
                // Change icon to preview target state
                const previewIcon = previewOpacity === 0.9 ? 'lightbulb-fill' : 'lightbulb';
                opacityBtn.setAttribute('name', previewIcon);
                
                this._applyLayerOpacity(layerId, config, previewOpacity);
                opacityBtn.setAttribute('data-hover-state', 'true');
            });
            
            // Mouse leave handler - restore original opacity
            opacityBtn.addEventListener('mouseleave', (e) => {
                opacityBtn.style.opacity = '0.5';
                // Only restore if we haven't clicked (committed the change)
                if (opacityBtn.getAttribute('data-hover-state') === 'true') {
                    const currentOpacity = parseFloat(opacityBtn.getAttribute('data-opacity'));
                    
                    // Restore original icon
                    const originalIcon = opacityBtn.getAttribute('data-original-icon');
                    if (originalIcon) {
                        opacityBtn.setAttribute('name', originalIcon);
                    }
                    
                    this._applyLayerOpacity(layerId, config, currentOpacity);
                    opacityBtn.setAttribute('data-hover-state', 'false');
                }
            });
            
            // Click handler - commit opacity toggle
            opacityBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentOpacity = parseFloat(opacityBtn.getAttribute('data-opacity'));
                const newOpacityFactor = currentOpacity === 0.4 ? 0.9 : 0.4;
                
                // Update button state
                opacityBtn.setAttribute('data-opacity', newOpacityFactor);
                opacityBtn.setAttribute('name', newOpacityFactor === 0.9 ? 'lightbulb-fill' : 'lightbulb');
                opacityBtn.setAttribute('data-hover-state', 'false'); // Clear hover state
                
                // Apply the new opacity (this commits the change)
                this._applyLayerOpacity(layerId, config, newOpacityFactor);
            });
            
            actionBtn.appendChild(opacityBtn);
        }
    }

    /**
     * Toggle layer off by directly targeting the layer control toggle
     * Uses jQuery and waits for Shoelace component to be ready
     */
    async _toggleLayerOff(layerId) {
        try {
            // Use jQuery to find the layer element
            const $layerElement = $(`sl-details[data-layer-id="${layerId}"]`);
            
            if ($layerElement.length === 0) {
                console.warn(`[FeatureControl] Layer element with data-layer-id="${layerId}" not found`);
                return;
            }
            
            const layerElement = $layerElement[0];
            
            // Wait for Shoelace component to finish updating
            if (layerElement.updateComplete) {
                await layerElement.updateComplete;
            }
            
            // Use jQuery to find the toggle input with multiple selector attempts
            let $toggleInput = $layerElement.find('.toggle-switch input[type="checkbox"]');
            
            // Fallback selectors if the first one doesn't work
            if ($toggleInput.length === 0) {
                $toggleInput = $layerElement.find('input[type="checkbox"]');
            }
            
            // Additional fallback - search more broadly
            if ($toggleInput.length === 0) {
                $toggleInput = $layerElement.find('input');
            }
            
            if ($toggleInput.length > 0) {
                // Use jQuery to uncheck and trigger change event
                $toggleInput.prop('checked', false);
                $toggleInput.trigger('change');
                
                // Close the details and remove active state using jQuery
                $layerElement.prop('open', false);
                $layerElement.removeClass('active');
                
                console.log(`[FeatureControl] Layer ${layerId} toggled off successfully`);
            } else {
                console.error(`[FeatureControl] No checkbox input found for layer ${layerId}`);
                
                // Last resort: try to find any clickable element that might toggle the layer
                const $anyToggle = $layerElement.find('[type="checkbox"], .toggle-switch, .toggle-slider');
                if ($anyToggle.length > 0) {
                    console.log(`[FeatureControl] Attempting to click any toggle element for ${layerId}`);
                    $anyToggle.first().click();
                }
            }
            
        } catch (error) {
            console.error(`[FeatureControl] Error toggling layer ${layerId}:`, error);
        }
    }

    /**
     * Get current layer opacity
     */
    _getCurrentLayerOpacity(layerId, config) {
        // Return the current opacity values for the layer
        // This is used to restore state after hover preview
        if (config.type === 'vector') {
            const layerConfig = config._layerConfig;
            if (layerConfig && layerConfig.hasFillStyles) {
                const fillLayer = this._map.getLayer(`vector-layer-${layerId}`);
                if (fillLayer) {
                    return this._map.getPaintProperty(`vector-layer-${layerId}`, 'fill-opacity') || 1;
                }
            }
        } else if (config.type === 'tms') {
            const layerIdOnMap = `tms-layer-${layerId}`;
            if (this._map.getLayer(layerIdOnMap)) {
                return this._map.getPaintProperty(layerIdOnMap, 'raster-opacity') || 1;
            }
        } else if (config.type === 'img') {
            if (this._map.getLayer(layerId)) {
                return this._map.getPaintProperty(layerId, 'raster-opacity') || 1;
            }
        } else if (config.type === 'raster-style-layer') {
            const styleLayerId = config.styleLayer || layerId;
            if (this._map.getLayer(styleLayerId)) {
                return this._map.getPaintProperty(styleLayerId, 'raster-opacity') || 1;
            }
        } else if (config.type === 'geojson') {
            const sourceId = `geojson-${layerId}`;
            if (this._map.getLayer(`${sourceId}-line`)) {
                return this._map.getPaintProperty(`${sourceId}-line`, 'line-opacity') || 1;
            }
        }
        return 0.9; // Default high opacity
    }

    /**
     * Apply layer opacity changes based on layer type
     */
    _applyLayerOpacity(layerId, config, opacityFactor) {
        if (config.type === 'vector') {
            const layerConfig = config._layerConfig;
            if (layerConfig) {
                if (layerConfig.hasFillStyles) {
                    this._map.setPaintProperty(`vector-layer-${layerId}`, 'fill-opacity', (config._baseFillOpacity || 1) * opacityFactor);
                }
                if (layerConfig.hasLineStyles) {
                    this._map.setPaintProperty(`vector-layer-${layerId}-outline`, 'line-opacity', (config._baseLineOpacity || 1) * opacityFactor);
                }
                if (layerConfig.hasTextStyles) {
                    const baseTextOpacity = config.style?.['text-opacity'] || 1;
                    if (Array.isArray(baseTextOpacity)) {
                        const modifiedOpacity = [...baseTextOpacity];
                        modifiedOpacity[modifiedOpacity.length - 1] = 0.7 * opacityFactor;
                        this._map.setPaintProperty(`vector-layer-${layerId}-text`, 'text-opacity', modifiedOpacity);
                    } else {
                        this._map.setPaintProperty(`vector-layer-${layerId}-text`, 'text-opacity', baseTextOpacity * opacityFactor);
                    }
                }
            }
        } else if (config.type === 'tms') {
            const layerIdOnMap = `tms-layer-${layerId}`;
            if (this._map.getLayer(layerIdOnMap)) {
                this._map.setPaintProperty(layerIdOnMap, 'raster-opacity', opacityFactor);
            }
        } else if (config.type === 'img') {
            if (this._map.getLayer(layerId)) {
                this._map.setPaintProperty(layerId, 'raster-opacity', opacityFactor);
            }
        } else if (config.type === 'raster-style-layer') {
            const styleLayerId = config.styleLayer || layerId;
            if (this._map.getLayer(styleLayerId)) {
                const existingLayer = this._map.getLayer(styleLayerId);
                if (existingLayer.type === 'raster') {
                    this._map.setPaintProperty(styleLayerId, 'raster-opacity', opacityFactor);
                }
            }
        } else if (config.type === 'geojson') {
            const sourceId = `geojson-${layerId}`;
            if (this._map.getLayer(`${sourceId}-fill`)) {
                this._map.setPaintProperty(`${sourceId}-fill`, 'fill-opacity', opacityFactor * 0.5);
            }
            if (this._map.getLayer(`${sourceId}-line`)) {
                this._map.setPaintProperty(`${sourceId}-line`, 'line-opacity', opacityFactor);
            }
            if (this._map.getLayer(`${sourceId}-label`)) {
                this._map.setPaintProperty(`${sourceId}-label`, 'text-opacity', opacityFactor);
            }
            if (this._map.getLayer(`${sourceId}-circle`)) {
                this._map.setPaintProperty(`${sourceId}-circle`, 'circle-opacity', opacityFactor);
            }
        }
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
        
        // Clean up header image CSS for this layer
        this._removeHeaderImageCSS(layerId);
    }

    /**
     * Remove header image CSS for a specific layer
     */
    _removeHeaderImageCSS(layerId) {
        const styleElement = document.getElementById('map-feature-control-header-images');
        if (styleElement) {
            // Remove the CSS rule for this layer
            const cssText = styleElement.textContent;
            const layerRuleRegex = new RegExp(`\\.map-feature-control \\.layer-details\\[data-layer-id="${layerId}"\\]::part\\(header\\)[^}]+}`, 'g');
            styleElement.textContent = cssText.replace(layerRuleRegex, '');
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
     * Get matching layer IDs - comprehensive version based on map-layer-controls.js logic
     */
    _getMatchingLayerIds(layerConfig) {
        const style = this._map.getStyle();
        if (!style.layers) return [];
        
        const layerId = layerConfig.id;
        const matchingIds = [];
        
        // Strategy 1: Direct ID match
        const directMatches = style.layers.filter(l => l.id === layerId).map(l => l.id);
        matchingIds.push(...directMatches);
        
        // Strategy 2: Prefix matches (for geojson layers and others)
        const prefixMatches = style.layers
            .filter(l => l.id.startsWith(layerId + '-') || l.id.startsWith(layerId + ' '))
            .map(l => l.id);
        matchingIds.push(...prefixMatches);
        
        // Strategy 3: Source layer matches (for vector layers)
        if (layerConfig.sourceLayer) {
            const sourceLayerMatches = style.layers
                .filter(l => l['source-layer'] === layerConfig.sourceLayer)
                .map(l => l.id);
            matchingIds.push(...sourceLayerMatches);
        }
        
        // Strategy 4: Source matches (for vector tile sources)
        if (layerConfig.source) {
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
        
        // Strategy 7: GeoJSON source matching (enhanced)
        if (layerConfig.type === 'geojson') {
            const sourceId = `geojson-${layerId}`;
            
            // Check for source match
            const geojsonSourceMatches = style.layers
                .filter(l => l.source === sourceId)
                .map(l => l.id);
            matchingIds.push(...geojsonSourceMatches);
            
            // Check for specific geojson layer patterns
            const geojsonLayerPatterns = [
                `${sourceId}-fill`,
                `${sourceId}-line`,
                `${sourceId}-circle`,
                `${sourceId}-symbol`
            ];
            
            geojsonLayerPatterns.forEach(pattern => {
                const patternMatches = style.layers
                    .filter(l => l.id === pattern)
                    .map(l => l.id);
                matchingIds.push(...patternMatches);
            });
        }
        
        // Strategy 8: CSV layer matching
        if (layerConfig.type === 'csv') {
            const sourceId = `csv-${layerId}`;
            const csvMatches = style.layers
                .filter(l => l.source === sourceId || l.id === `${sourceId}-circle`)
                .map(l => l.id);
            matchingIds.push(...csvMatches);
        }
        
        // Strategy 9: Vector layer matching (enhanced)
        if (layerConfig.type === 'vector') {
            const sourceId = `vector-${layerId}`;
            const vectorSourceMatches = style.layers
                .filter(l => l.source === sourceId)
                .map(l => l.id);
            matchingIds.push(...vectorSourceMatches);
            
            const vectorLayerPatterns = [
                `vector-layer-${layerId}`,
                `vector-layer-${layerId}-outline`,
                `vector-layer-${layerId}-text`
            ];
            
            vectorLayerPatterns.forEach(pattern => {
                const patternMatches = style.layers
                    .filter(l => l.id === pattern)
                    .map(l => l.id);
                matchingIds.push(...patternMatches);
            });
        }
        
        // Strategy 10: TMS layer matching
        if (layerConfig.type === 'tms') {
            const tmsMatches = style.layers
                .filter(l => l.id === `tms-layer-${layerId}`)
                .map(l => l.id);
            matchingIds.push(...tmsMatches);
        }
        
        // Strategy 11: IMG layer matching
        if (layerConfig.type === 'img') {
            const imgMatches = style.layers
                .filter(l => l.id === layerId || l.id === `img-layer-${layerId}`)
                .map(l => l.id);
            matchingIds.push(...imgMatches);
        }
        
        // Strategy 12: Raster style layer matching
        if (layerConfig.type === 'raster-style-layer') {
            const styleLayerId = layerConfig.styleLayer || layerId;
            const rasterMatches = style.layers
                .filter(l => l.id === styleLayerId)
                .map(l => l.id);
            matchingIds.push(...rasterMatches);
        }
        
        // Strategy 13: Style layer matching (for layers with sublayers)
        if (layerConfig.type === 'style' && layerConfig.layers) {
            layerConfig.layers.forEach(layer => {
                if (layer.sourceLayer) {
                    const styleSubMatches = style.layers
                        .filter(l => l['source-layer'] === layer.sourceLayer)
                        .map(l => l.id);
                    matchingIds.push(...styleSubMatches);
                }
            });
        }
        
        // Remove duplicates and return
        return [...new Set(matchingIds)];
    }

    /**
     * Clean up event listeners and references
     */
    _cleanup() {
        if (this._stateManager && this._stateChangeListener) {
            this._stateManager.removeEventListener('state-change', this._stateChangeListener);
        }
        
        // Clean up drawer state listener
        if (this._drawerStateListener) {
            window.removeEventListener('drawer-state-change', this._drawerStateListener);
            this._drawerStateListener = null;
        }
        
        // Clean up layer isolation state
        this._restoreAllLayers();
        
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
        
        // Skip if inspect mode is disabled
        if (!this._inspectModeEnabled || !this.options.showHoverPopups) return;
        
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
        
        // Skip if inspect mode is disabled
        if (!this._inspectModeEnabled || !this.options.showHoverPopups) return;
        
        // Skip on mobile devices to avoid conflicts with touch interactions
        if ('ontouchstart' in window) return;
        
        // Update popup with all currently hovered features in a single operation
        this._updateHoverPopupFromBatch(hoveredFeatures, lngLat);
    }

    /**
     * Handle all features leaving (map mouse leave or hover cleared)
     */
    _handleAllFeaturesLeave() {
        // Remove hover popup completely when all features leave
        // This ensures clean state when mouse moves off map
        this._removeHoverPopup();
        this._currentHoveredFeature = null;
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

    /**
     * Add layer isolation hover handlers to layer details elements
     */
    _addLayerIsolationHoverHandlers(layerElement, layerId, config) {
        // Mouse enter handler - isolate the layer
        layerElement.addEventListener('mouseenter', (e) => {
            // Prevent multiple hover states
            if (this._layerHoverState.isActive && this._layerHoverState.hoveredLayerId === layerId) {
                return;
            }
            
            this._isolateLayer(layerId, config);
        });

        // Mouse leave handler - restore all layers
        layerElement.addEventListener('mouseleave', (e) => {
            this._restoreAllLayers();
        });
    }

    /**
     * Isolate a specific layer by hiding all other non-basemap layers
     */
    _isolateLayer(layerId, config) {
        if (!this._map) return;

        // Get matching style layers for the hovered config layer
        const hoveredLayerIds = this._getMatchingLayerIds(config);
        console.log(`Hovered layer ${layerId} matches style layers:`, hoveredLayerIds);
        
        // Get all basemap layer IDs from config
        const basemapLayerIds = this._getBasemapLayerIds();
        console.log(`Basemap layer IDs to preserve:`, basemapLayerIds);
        
        // Get all currently visible layers from the map
        const style = this._map.getStyle();
        if (!style.layers) return;

        const visibleLayers = style.layers.filter(layer => {
            const visibility = layer.layout?.visibility;
            return visibility === undefined || visibility === 'visible';
        });

        // Build list of layers to hide
        const layersToHide = [];
        const layersToKeep = [];
        
        visibleLayers.forEach(layer => {
            const styleLayerId = layer.id;
            
            // Skip if this layer belongs to the hovered config layer
            if (hoveredLayerIds.includes(styleLayerId)) {
                layersToKeep.push(styleLayerId + ' (hovered layer)');
                return;
            }
            
            // Skip if this layer belongs to a basemap config layer
            if (basemapLayerIds.includes(styleLayerId)) {
                layersToKeep.push(styleLayerId + ' (basemap)');
                return;
            }
            
            // Add to hide list
            layersToHide.push(styleLayerId);
        });

        console.log(`Layers to keep visible:`, layersToKeep);
        console.log(`Layers to hide:`, layersToHide);

        // Hide the layers
        layersToHide.forEach(styleLayerId => {
            try {
                this._map.setLayoutProperty(styleLayerId, 'visibility', 'none');
            } catch (error) {
                console.warn(`Failed to hide layer ${styleLayerId}:`, error);
            }
        });

        // Apply visual feedback to layer details UI elements
        this._applyLayerDetailsOpacityEffect(layerId);

        // Update hover state
        this._layerHoverState = {
            isActive: true,
            hiddenLayers: layersToHide,
            hoveredLayerId: layerId
        };

        console.log(`Isolated layer ${layerId}, hidden ${layersToHide.length} layers`);
    }

    /**
     * Restore visibility of all previously hidden layers
     */
    _restoreAllLayers() {
        if (!this._map || !this._layerHoverState.isActive) return;

        // Restore visibility of all hidden layers
        this._layerHoverState.hiddenLayers.forEach(layerId => {
            try {
                this._map.setLayoutProperty(layerId, 'visibility', 'visible');
            } catch (error) {
                console.warn(`Failed to restore layer ${layerId}:`, error);
            }
        });

        console.log(`Restored ${this._layerHoverState.hiddenLayers.length} layers`);

        // Restore opacity of all layer details UI elements
        this._restoreLayerDetailsOpacity();

        // Reset hover state
        this._layerHoverState = {
            isActive: false,
            hiddenLayers: [],
            hoveredLayerId: null
        };
    }

    /**
     * Get all matching style layer IDs for basemap config layers
     */
    _getBasemapLayerIds() {
        // Try to get config from multiple sources
        let config = this._config;
        if (!config && window.layerControl && window.layerControl._config) {
            config = window.layerControl._config;
        }
        
        if (!config) {
            console.warn('[MapFeatureControl] No config available for basemap detection');
            return [];
        }

        const basemapLayerIds = [];
        const basemapConfigs = [];
        
        // Find all config layers tagged with 'basemap'
        if (config.layers && Array.isArray(config.layers)) {
            config.layers.forEach(layer => {
                if (layer.tags && layer.tags.includes('basemap')) {
                    basemapConfigs.push(layer);
                    const matchingIds = this._getMatchingLayerIds(layer);
                    console.log(`Basemap config layer ${layer.id} matches style layers:`, matchingIds);
                    basemapLayerIds.push(...matchingIds);
                }
            });
        }

        // Also check groups if they exist (older config format)
        if (config.groups && Array.isArray(config.groups)) {
            config.groups.forEach(group => {
                if (group.tags && group.tags.includes('basemap')) {
                    basemapConfigs.push(group);
                    const matchingIds = this._getMatchingLayerIds(group);
                    console.log(`Basemap config group ${group.id} matches style layers:`, matchingIds);
                    basemapLayerIds.push(...matchingIds);
                }
            });
        }

        console.log(`Found ${basemapConfigs.length} basemap config entries:`, basemapConfigs.map(c => c.id));
        const uniqueBasemapIds = [...new Set(basemapLayerIds)];
        console.log(`Total unique basemap style layer IDs:`, uniqueBasemapIds);
        
        return uniqueBasemapIds;
    }

    /**
     * Apply opacity effect to layer details UI elements when a layer is isolated
     * Sets opacity to 0.5 for all layer details except the hovered one
     */
    _applyLayerDetailsOpacityEffect(hoveredLayerId) {
        if (!this._layersContainer) return;

        // Get all layer details elements
        const layerDetailsElements = this._layersContainer.querySelectorAll('.layer-details');
        
        layerDetailsElements.forEach(element => {
            const elementLayerId = element.getAttribute('data-layer-id');
            
            if (elementLayerId !== hoveredLayerId) {
                // Set opacity to 0.5 for non-hovered layers with smooth transition
                element.style.transition = 'opacity 0.2s ease-in-out';
                element.style.opacity = '0.5';
            } else {
                // Ensure hovered layer stays fully opaque
                element.style.transition = 'opacity 0.2s ease-in-out';
                element.style.opacity = '1';
            }
        });

        console.log(`Applied opacity effect - ${hoveredLayerId} remains opaque, others set to 0.5`);
    }

    /**
     * Restore opacity of all layer details UI elements to full opacity
     */
    _restoreLayerDetailsOpacity() {
        if (!this._layersContainer) return;

        // Get all layer details elements
        const layerDetailsElements = this._layersContainer.querySelectorAll('.layer-details');
        
        layerDetailsElements.forEach(element => {
            // Restore full opacity with smooth transition
            element.style.transition = 'opacity 0.2s ease-in-out';
            element.style.opacity = '1';
        });

        console.log(`Restored opacity for all layer details elements`);
    }
}

// Make available globally for backwards compatibility
if (typeof window !== 'undefined') {
    window.MapFeatureControl = MapFeatureControl;
}

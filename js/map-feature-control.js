/**
 * MapFeatureControl - Enhanced version using event-driven architecture
 *
 * This control displays a toggle button and panel for layer inspection.
 * When users interact with features, it shows the feature information under the relevant layer
 * instead of using overlapping popups.
 *
 * Now uses centralized MapFeatureStateManager for all state management.
 * Updated to use config JSON as source of truth for active layers.
 * UI uses a panel-based approach similar to 3D control with Shoelace details components.
 */

import { DrawerStateManager } from './drawer-state-manager.js';
import { GeoUtils } from './map-utils.js';
import { LayerSettingsModal } from './layer-settings-modal.js';
import { LayerCreatorUI } from './layer-creator-ui.js';
import { LayerStyleControl } from './layer-style-control.js';

export class MapFeatureControl {
    constructor() {
        this.options = {
            position: 'top-left',
            maxHeight: '600px', // Use viewport height instead of fixed pixels
            maxWidth: '350px',
            minWidth: '250px',
            showHoverPopups: true, // New option to control hover popups
            inspectMode: false, // Inspect mode disabled by default
            showLayerOptions: false, // Layer options (settings icon & Paint tab) disabled by default
        };

        this._map = null;
        this._stateManager = null;
        this.drawerStateManager = new DrawerStateManager();
        this._container = null;
        this._layersContainer = null;
        this._panel = null; // Main panel component
        this._drawerSwitch = null; // Drawer toggle switch
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

        // Layer settings modal - initialize after map is available
        this._layerSettingsModal = null;

        // Layer style control - initialize after map is available
        this._layerStyleControl = null;

        // Animation state tracking to prevent mouse interference during camera movements
        this._isAnimating = false;

        // Drag event listeners storage for cleanup
        this._dragListeners = null;

        // Footer auto-fade timeout
        this._footerTimeout = null;

        // Initialized

        // Set up resize listener for responsive height adjustments
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

        // Initialize layer settings modal now that we have a map reference
        this._layerSettingsModal = new LayerSettingsModal(this);

        return this._container;
    }

    /**
     * Get MapboxAPI reference from layer control
     */
    _getMapboxAPI() {
        if (this._mapboxAPI) {
            return this._mapboxAPI;
        }

        // Try to get from global layer control
        if (window.layerControl && window.layerControl._mapboxAPI) {
            return window.layerControl._mapboxAPI;
        }

        return null;
    }

    /**
     * Initialize layer style control if not already initialized
     */
    _ensureLayerStyleControl() {
        if (this._layerStyleControl) {
            return true;
        }

        const mapboxAPI = this._getMapboxAPI();
        if (mapboxAPI && this._map) {
            this._layerStyleControl = new LayerStyleControl(mapboxAPI, this._map);
            return true;
        }

        return false;
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
        this._layerSettingsModal = null;
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

        // Set initial clear button visibility (should be hidden initially)
        setTimeout(() => {
            this._updateClearSelectionButtonVisibility();
        }, 100);

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

                // Helper to generate header
                const getBhunakshaHeader = (options = {}) => {
                    const { withLink = false, color = '' } = options;
                    const style = color ? `style="color: ${color};"` : '';
                    const content = withLink
                        ? 'Additional Information from <a href="https://bhunaksha.goa.gov.in" target="_blank" style="color: #60a5fa;">Goa Bhunaksha</a>'
                        : 'Additional Information from Bhunaksha';
                    return `<div class="mb-2 font-semibold" ${style}>${content}</div>`;
                };

                // Create initial container with loading spinner
                const containerHTML = `
                    <div id="${containerId}" class="text-xs">
                        ${getBhunakshaHeader({ withLink: true })}
                        <div class="flex items-center gap-2">
                            <sl-spinner style="font-size: 0.875rem; --indicator-color: #9ca3af;"></sl-spinner>
                            <span class="text-xs">Requesting Occupant Details...</span>
                        </div>
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
                                    <div class="text-xs">
                                        ${getBhunakshaHeader()}
                                        <div class="mb-2">${infoText}</div>
                                        <div class="italic text-xs">
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
                                        ${getBhunakshaHeader({ color: '#f3f4f6' })}
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
                                <div class="text-xs">
                                    ${getBhunakshaHeader()}
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
     * Create the main container with toggle button similar to 3D control
     */
    _createContainer() {
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';

        // Create button
        const button = document.createElement('button');
        button.className = 'mapboxgl-ctrl-icon map-feature-control-btn';
        button.type = 'button';
        button.setAttribute('aria-label', 'Map Layers');

        // Create Shoelace icon
        const icon = document.createElement('sl-icon');
        icon.name = 'stack';

        button.appendChild(icon);

        // Add event handlers
        button.addEventListener('click', () => {
            this._togglePanel();
        });

        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = '#f0f0f0';
        });

        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = '#ffffff';
        });

        this._container.appendChild(button);

        // Create panel
        this._createPanel();

        // Add styles for visual feedback
        const style = document.createElement('style');
        style.textContent = `
            @keyframes layer-flash {
                0% { background-color: white; }
                50% { background-color: #eff6ff; } /* blue-50 */
                100% { background-color: white; }
            }
            .layer-flash {
                animation: layer-flash 0.5s ease-in-out;
            }

        `;
        document.head.appendChild(style);
    }

    /**
     * Create panel similar to 3D control
     */
    _createPanel() {
        this._panel = document.createElement('div');
        this._panel.className = 'map-feature-panel';

        // Create panel content wrapper
        const content = document.createElement('div');
        content.className = 'map-feature-panel-content';

        // Create Header (Layer Atlas + Actions)
        const header = document.createElement('div');
        header.className = 'map-feature-panel-header';

        // Layer Atlas Button Container (left side, expands to fill space)
        const layerAtlasContainer = document.createElement('div');
        layerAtlasContainer.className = 'map-feature-panel-header-left';
        const layerAtlasBtn = this._createLayerAtlasButton();
        layerAtlasContainer.appendChild(layerAtlasBtn);
        header.appendChild(layerAtlasContainer);

        // Header Actions Container (right side)
        const headerActions = document.createElement('div');
        headerActions.className = 'map-feature-panel-header-actions';

        // Add actions to header (without Layer Atlas, which is now on the left)
        const actions = this._createHeaderActions();
        actions.forEach(action => headerActions.appendChild(action));

        // Close button (integrated into header actions)
        const closeButton = document.createElement('sl-icon-button');
        closeButton.name = 'x-lg';
        closeButton.label = 'Close';
        closeButton.className = 'header-close-btn';
        closeButton.addEventListener('click', () => {
            this._hidePanel();
        });
        headerActions.appendChild(closeButton);

        header.appendChild(headerActions);

        // Add drag functionality to the header
        this._setupPanelDrag(header);

        // Create layers container
        this._layersContainer = document.createElement('div');
        this._layersContainer.className = 'feature-control-layers map-feature-panel-layers';

        // Assemble panel
        content.appendChild(header);
        content.appendChild(this._layersContainer);

        // Create Footer (Selection Summary)
        this._footer = document.createElement('div');
        this._footer.className = 'map-feature-footer';

        // Selection Text
        this._selectionText = document.createElement('span');
        this._selectionText.className = 'map-feature-footer-text';
        this._footer.appendChild(this._selectionText);

        // Footer Clear Button
        const footerClearBtn = document.createElement('button');
        footerClearBtn.textContent = 'Clear Selection';
        footerClearBtn.className = 'map-feature-footer-btn';
        footerClearBtn.addEventListener('mouseenter', () => {
            footerClearBtn.style.background = '#e0f2fe';
        });
        footerClearBtn.addEventListener('mouseleave', () => {
            footerClearBtn.style.background = 'transparent';
        });
        footerClearBtn.addEventListener('click', () => {
            this._clearAllSelections();
        });
        this._footer.appendChild(footerClearBtn);

        content.appendChild(this._footer);

        this._panel.appendChild(content);

        // Close panel when clicking outside (but not on map features)
        // Use a timeout to avoid immediate hiding due to event bubbling
        setTimeout(() => {
            document.addEventListener('click', (e) => {
                // Don't close panel if clicking on the panel itself, control button, map canvas, or layer drawer
                if (!e.target.closest('.map-feature-panel, .mapboxgl-ctrl-icon, .mapboxgl-canvas-container, #map-controls-drawer')) {
                    this._hidePanel();
                }
            });
        }, 100);

        // Add panel to map container
        this._map.getContainer().appendChild(this._panel);
    }

    /**
     * Setup drag functionality for the panel using the title as drag handle
     */
    _setupPanelDrag(dragHandle) {
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        const dragStart = (e) => {
            if (e.type === "touchstart") {
                initialX = e.touches[0].clientX - xOffset;
                initialY = e.touches[0].clientY - yOffset;
            } else {
                initialX = e.clientX - xOffset;
                initialY = e.clientY - yOffset;
            }

            if (e.target === dragHandle) {
                isDragging = true;
            }
        };

        const dragEnd = (e) => {
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
        };

        const drag = (e) => {
            if (isDragging) {
                e.preventDefault();

                if (e.type === "touchmove") {
                    currentX = e.touches[0].clientX - initialX;
                    currentY = e.touches[0].clientY - initialY;
                } else {
                    currentX = e.clientX - initialX;
                    currentY = e.clientY - initialY;
                }

                xOffset = currentX;
                yOffset = currentY;

                this._setTranslate(currentX, currentY, this._panel);
            }
        };

        const _setTranslate = (xPos, yPos, el) => {
            el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
        };

        this._setTranslate = _setTranslate;

        // Add event listeners
        dragHandle.addEventListener("mousedown", dragStart);
        dragHandle.addEventListener("touchstart", dragStart);

        document.addEventListener("mouseup", dragEnd);
        document.addEventListener("touchend", dragEnd);

        document.addEventListener("mousemove", drag);
        document.addEventListener("touchmove", drag);

        // Store listeners for cleanup
        this._dragListeners = {
            dragHandle,
            dragStart,
            dragEnd,
            drag
        };
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
        this._panel.style.display = 'flex';
    }

    _hidePanel() {
        this._panel.style.display = 'none';
    }

    /**
     * Create Layer Atlas button (left side of header)
     */
    _createLayerAtlasButton() {
        const layerAtlasBtn = document.createElement('button');
        layerAtlasBtn.className = 'layer-atlas-btn primary-action-btn';

        // Get current atlas name
        const currentAtlas = window.layerRegistry?._currentAtlas || 'index';
        const atlasMetadata = window.layerRegistry?.getAtlasMetadata(currentAtlas);
        const atlasName = atlasMetadata?.name || 'Browse Maps';

        layerAtlasBtn.innerHTML = `
            <sl-icon name="globe" style="font-size: 14px; margin-right: 6px;"></sl-icon>
            <span>${atlasName}</span>
        `;

        layerAtlasBtn.addEventListener('click', () => {
            this._openLayerDrawer();
        });

        return layerAtlasBtn;
    }

    /**
     * Create header actions (New Data Source, Settings) - Layer Atlas is now separate
     */
    _createHeaderActions() {
        const actions = [];

        // 1. New Data Source Button (Icon only)
        const newDataSourceBtn = document.createElement('sl-icon-button');
        newDataSourceBtn.name = 'plus-square';
        newDataSourceBtn.label = 'New Data Source';
        newDataSourceBtn.className = 'header-icon-btn';
        // Add tooltip
        const newSourceTooltip = document.createElement('sl-tooltip');
        newSourceTooltip.content = 'New Data Source';
        newSourceTooltip.appendChild(newDataSourceBtn);

        newDataSourceBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            LayerCreatorUI.openLayerCreatorDialog();
        });
        actions.push(newSourceTooltip);

        // 3. Settings Menu (Popover)
        const settingsBtn = document.createElement('sl-icon-button');
        settingsBtn.name = 'gear';
        settingsBtn.label = 'Settings';
        settingsBtn.className = 'header-icon-btn';

        // Create settings popover content
        const settingsPopover = document.createElement('sl-dropdown');
        settingsPopover.distance = 5;
        settingsPopover.placement = 'bottom-end';

        // Trigger
        const trigger = document.createElement('div');
        trigger.setAttribute('slot', 'trigger');
        trigger.appendChild(settingsBtn);
        settingsPopover.appendChild(trigger);

        // Menu
        const menu = document.createElement('sl-menu');

        // Tooltip Toggle Item
        const tooltipItem = document.createElement('sl-menu-item');
        tooltipItem.value = 'tooltips';

        // Create switch for menu item
        const tooltipSwitch = document.createElement('sl-switch');
        tooltipSwitch.checked = this.options.inspectMode;
        tooltipSwitch.size = 'small';
        tooltipSwitch.style.pointerEvents = 'none'; // Let menu item handle click

        const tooltipLabel = document.createElement('span');
        tooltipLabel.textContent = 'Show Tooltips';
        tooltipLabel.style.marginLeft = '8px';

        tooltipItem.appendChild(tooltipSwitch);
        tooltipItem.appendChild(tooltipLabel);

        // Handle toggle
        tooltipItem.addEventListener('click', (e) => {
            // Prevent menu from closing immediately if desired, or let it close
            e.stopPropagation(); // Keep menu open
            tooltipSwitch.checked = !tooltipSwitch.checked;
            this._inspectSwitch.checked = tooltipSwitch.checked; // Sync with original switch
            this._toggleInspectMode();
        });

        // Sync switch state when menu opens
        settingsPopover.addEventListener('sl-show', () => {
            tooltipSwitch.checked = this._inspectModeEnabled;
        });

        menu.appendChild(tooltipItem);

        // Layer Options Toggle Item
        const layerOptionsItem = document.createElement('sl-menu-item');
        layerOptionsItem.value = 'layer-options';

        // Create switch for menu item
        const layerOptionsSwitch = document.createElement('sl-switch');
        layerOptionsSwitch.checked = this.options.showLayerOptions;
        layerOptionsSwitch.size = 'small';
        layerOptionsSwitch.style.pointerEvents = 'none'; // Let menu item handle click

        const layerOptionsLabel = document.createElement('span');
        layerOptionsLabel.textContent = 'Show Advanced Options';
        layerOptionsLabel.style.marginLeft = '8px';

        layerOptionsItem.appendChild(layerOptionsSwitch);
        layerOptionsItem.appendChild(layerOptionsLabel);

        // Handle toggle
        layerOptionsItem.addEventListener('click', (e) => {
            e.stopPropagation(); // Keep menu open
            layerOptionsSwitch.checked = !layerOptionsSwitch.checked;
            this.options.showLayerOptions = layerOptionsSwitch.checked;
            this._toggleLayerOptions();
        });

        // Sync switch state when menu opens
        settingsPopover.addEventListener('sl-show', () => {
            layerOptionsSwitch.checked = this.options.showLayerOptions;
        });

        menu.appendChild(layerOptionsItem);
        settingsPopover.appendChild(menu);

        // Store reference to update later
        this._settingsPopover = settingsPopover;

        actions.push(settingsPopover);

        // 4. Clear Selection (Moved to footer)
        // this._clearSelectionBtn removed from header actions

        // Re-initialize inspect switch for internal state logic (hidden)
        this._inspectSwitch = document.createElement('sl-switch');
        this._inspectSwitch.checked = this.options.inspectMode;
        this._inspectSwitch.style.display = 'none';

        return actions;
    }

    /**
     * Update drawer switch state based on centralized manager
     */
    _updateDrawerSwitch() {
        // No longer needed since we use an action button instead of a toggle
    }

    /**
     * Set up drawer state tracking using centralized manager
     */
    _setupDrawerStateTracking() {
        // Listen to drawer state changes from the centralized manager
        this._drawerStateListener = (event) => {
            const { isOpen, eventType } = event.detail;
            // No longer need to update switch state since we use an action button
        };

        // Listen to the global drawer state change event
        window.addEventListener('drawer-state-change', this._drawerStateListener);
    }

    /**
     * Open the layer drawer using centralized manager
     */
    _openLayerDrawer() {
        this.drawerStateManager.open();
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
     * Toggle layer options (settings icon and Paint tab visibility)
     */
    _toggleLayerOptions() {
        // Update visibility of all layer settings buttons
        const settingsBtns = this._layersContainer.querySelectorAll('.layer-settings-btn');
        settingsBtns.forEach(btn => {
            btn.style.display = this.options.showLayerOptions ? '' : 'none';
        });

        // Re-render all layers to update tab visibility
        this._scheduleRender();
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
     * Check if mobile screen
     */
    _isMobileScreen() {
        return window.innerWidth <= 768 || ('ontouchstart' in window);
    }

    /**
     * Update footer visibility and text based on selections
     */
    _updateSelectionFooter() {
        if (!this._footer) return;

        // Count selections
        let featureCount = 0;
        let layerCount = 0;

        // Iterate through layer items to find selections
        const layerItems = this._layersContainer.querySelectorAll('.layer-card');
        layerItems.forEach(item => {
            if (item.classList.contains('has-selection')) {
                layerCount++;
                // In a real implementation, we'd need a way to count features per layer.
                // For now, we'll assume 1 feature per selected layer unless we can query the details.
                // If the details panel is populated, we might count rows, but 'has-selection' is a good proxy for "at least one".
                // Let's try to be more specific if possible, but 'has-selection' is what we have easily.
                // Actually, let's look for selected rows if they exist
                const selectedRows = item.querySelectorAll('tr.selected-row');
                if (selectedRows.length > 0) {
                    featureCount += selectedRows.length;
                } else {
                    // Fallback if rows aren't marked with a specific class or if it's just the layer marked
                    featureCount++;
                }
            }
        });

        if (layerCount > 0) {
            this._selectionText.textContent = `${featureCount} feature${featureCount !== 1 ? 's' : ''} selected across ${layerCount} layer${layerCount !== 1 ? 's' : ''}`;

            // Show footer
            this._footer.style.display = 'flex';
            // Force reflow to ensure transition works
            void this._footer.offsetWidth;
            this._footer.style.opacity = '1';

            // Clear existing timeout
            if (this._footerTimeout) {
                clearTimeout(this._footerTimeout);
            }

            // Set new timeout to fade out
            this._footerTimeout = setTimeout(() => {
                this._footer.style.opacity = '0';
                // Wait for transition to finish before hiding
                setTimeout(() => {
                    // Only hide if opacity is still 0 (in case it was re-shown)
                    if (this._footer.style.opacity === '0') {
                        this._footer.style.display = 'none';
                    }
                }, 500);
            }, 5000);

        } else {
            this._footer.style.display = 'none';
            this._footer.style.opacity = '0';
            if (this._footerTimeout) {
                clearTimeout(this._footerTimeout);
            }
        }
    }

    /**
     * Update clear selection button visibility - Redirects to new footer method
     */
    _updateClearSelectionButtonVisibility() {
        this._updateSelectionFooter();
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

                // Ensure panel is visible when a new layer is added
                this._showPanel();

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
            // Expand the layer if it's collapsed
            const isCollapsed = this._layerCollapseStates.get(layerId) || false;
            if (isCollapsed) {
                this._toggleLayerCollapse(layerId, layerElement);
            }

            // Find the tab group
            const tabGroup = layerElement.querySelector('sl-tab-group');
            if (tabGroup) {
                // Switch to features tab
                tabGroup.show('features');
            }

            // Scroll the layer card into view if needed
            layerElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        // Ensure the panel is visible when a feature is selected
        if (this._panel && this._panel.style.display === 'none') {
            this._showPanel();
        }

        // Close the layer list drawer to prevent it from obscuring feature details
        this.drawerStateManager.close();
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
            // Update clear button visibility when selections change
            this._updateClearSelectionButtonVisibility();
        } else if (states.hasSelection === false) {
            layerElement.classList.remove('has-selection');
            // Update clear button visibility when selections change
            this._updateClearSelectionButtonVisibility();
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

        // Update clear button visibility after selections are cleared
        this._updateClearSelectionButtonVisibility();
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

        // Process layers in reverse config order so newest layers appear first
        // Create a reversed array to process newest layers first
        const reversedConfigOrder = [...configOrder].reverse();
        reversedConfigOrder.forEach(layerId => {
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
    /**
     * Get layer config, using registry as fallback for cross-atlas layers
     */
    _getLayerConfig(layerId) {
        // First try state manager
        let config = this._stateManager.getLayerConfig(layerId);

        // If not found and registry is available, try the registry
        if (!config && window.layerRegistry) {
            config = window.layerRegistry.getLayer(layerId);
        }

        return config;
    }

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
                    return this._getLayerConfig(layer.id) !== undefined;
                })
                .map(layer => layer.id);
        }

        // Fallback to groups if layers array doesn't exist (older config format)
        if (this._config.groups && Array.isArray(this._config.groups)) {
            return this._config.groups
                .filter(group => {
                    // Include all layers that are registered with the state manager (visible layers)
                    return this._getLayerConfig(group.id) !== undefined;
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
        } else {
            // Existing element updated - trigger flash animation
            layerElement.classList.remove('layer-flash');
            // Force reflow
            void layerElement.offsetWidth;
            layerElement.classList.add('layer-flash');

            // Remove class after animation
            setTimeout(() => {
                if (layerElement) {
                    layerElement.classList.remove('layer-flash');
                }
            }, 500);
        }
    }

    /**
     * Create a layer details element with custom card structure
     */
    _createLayerDetailsElement(layerId, config) {
        const layerCard = document.createElement('div');
        layerCard.className = 'layer-card';
        layerCard.setAttribute('data-layer-id', layerId);

        // Add hover effect
        layerCard.addEventListener('mouseenter', () => {
            layerCard.style.boxShadow = '0 4px 6px rgba(0,0,0,0.05)';
        });
        layerCard.addEventListener('mouseleave', () => {
            layerCard.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
        });

        // Set initial collapse state based on screen size
        const isMobile = this._isMobileScreen();
        if (!this._layerCollapseStates.has(layerId)) {
            this._layerCollapseStates.set(layerId, isMobile);
        }
        const isCollapsed = this._layerCollapseStates.get(layerId);

        // Create Card Header
        const header = document.createElement('div');
        header.className = 'layer-card-header';

        // Add hover effect to header
        header.addEventListener('mouseenter', () => {
            header.style.backgroundColor = '#374151';
        });
        header.addEventListener('mouseleave', () => {
            header.style.backgroundColor = '#1f2937';
        });

        // Add background image class if available
        if (config.headerImage) {
            layerCard.classList.add('has-header-image');
            layerCard.setAttribute('data-header-image', config.headerImage);
            header.style.backgroundImage = `linear-gradient(to right, rgba(0,0,0,0.6), rgba(0,0,0,0.4)), url('${config.headerImage}')`;
            header.style.backgroundSize = 'cover';
            header.style.backgroundPosition = 'center';
        }

        // Collapse Indicator Icon
        const collapseIcon = document.createElement('sl-icon');
        collapseIcon.name = isCollapsed ? 'chevron-right' : 'chevron-down';
        collapseIcon.className = 'collapse-indicator';
        header.appendChild(collapseIcon);

        // Title
        const title = document.createElement('div');
        title.textContent = config.title || config.id;
        title.className = 'layer-card-title';
        header.appendChild(title);

        // Actions Container (Opacity, Zoom, Remove)
        const actionsContainer = this._createLayerActions(layerId, config);
        header.appendChild(actionsContainer);

        // Add click handler to header for collapse toggle
        header.addEventListener('click', (e) => {
            if (e.target.closest('.layer-actions')) {
                return;
            }
            this._toggleLayerCollapse(layerId, layerCard);
        });

        layerCard.appendChild(header);

        // Content Container (Tabs + Content)
        const contentContainer = document.createElement('div');
        contentContainer.className = 'layer-content';
        contentContainer.style.display = isCollapsed ? 'none' : 'block';
        layerCard.appendChild(contentContainer);

        // Add hover event handlers for layer isolation
        this._addLayerIsolationHoverHandlers(layerCard, layerId, config);

        return layerCard;
    }

    /**
     * Toggle layer collapse/expand state
     */
    _toggleLayerCollapse(layerId, layerCard) {
        const currentState = this._layerCollapseStates.get(layerId) || false;
        const newState = !currentState;
        this._layerCollapseStates.set(layerId, newState);

        const collapseIcon = layerCard.querySelector('.collapse-indicator');
        const contentContainer = layerCard.querySelector('.layer-content');
        const actionsContainer = layerCard.querySelector('.layer-actions');

        if (collapseIcon) {
            collapseIcon.name = newState ? 'chevron-right' : 'chevron-down';
        }

        if (contentContainer) {
            contentContainer.style.display = newState ? 'none' : 'block';
        }

        if (actionsContainer) {
            const opacityBtn = actionsContainer.querySelector('[aria-label="Opacity"]')?.closest('sl-dropdown');
            const settingsBtn = actionsContainer.querySelector('[title="Layer Settings"]');

            if (opacityBtn) {
                opacityBtn.style.display = newState ? 'none' : '';
            }
            if (settingsBtn) {
                // Settings button should be hidden if collapsed OR if showLayerOptions is disabled
                settingsBtn.style.display = (newState || !this.options.showLayerOptions) ? 'none' : '';
            }
        }
    }

    /**
     * Update layer content with tabs and flattened details
     */
    _updateLayerContent(layerElement, layerId, config, features) {
        // Get content container
        let contentContainer = layerElement.querySelector('.layer-content');
        if (!contentContainer) {
            contentContainer = document.createElement('div');
            contentContainer.className = 'layer-content';
            layerElement.appendChild(contentContainer);
        }

        // Clear existing content
        contentContainer.replaceChildren();

        // Check content availability
        const hasLegend = config.legend || config.legendImage;
        const hasInfo = config.description || config.attribution;
        // Check type OR if we actually have features (fallback for missing type)
        const hasFeatures = (config.type === 'vector' || config.type === 'geojson' || (features && features.size > 0));
        const hasSelectedFeatures = hasFeatures && features && Array.from(features.values()).some(f => f.isSelected);
        // Check if layer has style properties that can be edited
        this._ensureLayerStyleControl();
        const mapboxAPI = this._getMapboxAPI();
        let hasStyleControls = false;
        if (this._layerStyleControl && mapboxAPI) {
            const layerGroupIds = mapboxAPI.getLayerGroupIds(layerId, config);
            hasStyleControls = layerGroupIds.length > 0;
        }

        // If no content at all, don't show tabs
        if (!hasLegend && !hasInfo && !hasFeatures && !hasStyleControls) {
            const emptyMsg = document.createElement('div');
            emptyMsg.textContent = 'No details available';
            emptyMsg.className = 'empty-state';
            contentContainer.appendChild(emptyMsg);
            return;
        }

        // Create Tab Group
        // Define Tabs based on availability
        const tabs = [];

        if (hasInfo) {
            tabs.push({ id: 'info', label: 'Info', icon: 'info-circle' });
        }

        if (hasLegend) {
            tabs.push({ id: 'legend', label: 'Legend', icon: 'list-ul' });
        }

        // Only add Features tab if layer type supports it or we have features
        if (hasFeatures) {
            const selectedCount = hasSelectedFeatures ? Array.from(features.values()).filter(f => f.isSelected).length : 0;
            tabs.push({
                id: 'features',
                label: `Features${selectedCount > 0 ? ' (' + selectedCount + ')' : ''}`,
                icon: 'geo-alt'
            });
        }

        // Add Style tab if layer has editable style properties AND showLayerOptions is enabled
        if (hasStyleControls && this.options.showLayerOptions) {
            tabs.push({ id: 'style', label: 'Paint', icon: 'palette' });
            console.log('[MapFeatureControl] Added Paint tab for layer', layerId);
        }

        // Check if we have multiple tabs or just one
        if (tabs.length === 1) {
            // Single tab - Render content directly without tab headers
            const tab = tabs[0];
            const panel = document.createElement('div');
            panel.className = 'single-tab-panel';

            // Add content based on the single tab type
            if (tab.id === 'info') {
                panel.style.padding = '10px';
                const infoContent = this._createSourceContent(layerId, config);
                panel.appendChild(infoContent);
            } else if (tab.id === 'legend') {
                panel.style.padding = '10px';
                const legendContent = this._createLegendContent(layerId, config);
                panel.appendChild(legendContent);
            } else if (tab.id === 'features') {
                panel.style.padding = '0';
                const featuresContent = this._createFeaturesContent(layerId, config, features);
                panel.appendChild(featuresContent);
            } else if (tab.id === 'style' && this.options.showLayerOptions) {
                panel.style.padding = '0';
                const styleContent = this._createStyleContent(layerId, config);
                panel.appendChild(styleContent);
            }

            contentContainer.appendChild(panel);
        } else if (tabs.length > 1) {
            // Multiple tabs - Create Tab Group
            const tabGroup = document.createElement('sl-tab-group');
            tabGroup.classList.add('feature-tab-group');
            tabGroup.style.cssText = `
                --indicator-color: #3b82f6;
                --track-color: #f3f4f6;
            `;

            // Inject styles into shadow DOM to fix scrolling issue
            tabGroup.updateComplete.then(() => {
                const sheet = new CSSStyleSheet();
                sheet.replaceSync(`
                    .tab-group__nav {
                        overflow-x: visible !important;
                    }
                `);
                tabGroup.shadowRoot.adoptedStyleSheets = [
                    ...tabGroup.shadowRoot.adoptedStyleSheets,
                    sheet
                ];
            });

            // Create Tab Headers
            tabs.forEach(tab => {
                const slTab = document.createElement('sl-tab');
                slTab.slot = 'nav';
                slTab.panel = tab.id;

                // Custom styling for tabs to make them compact
                slTab.style.cssText = `
                    padding: 0 8px;
                    font-size: 10px;
                    height: 24px;
                    line-height: 24px;
                    display: inline-flex;
                    align-items: center;
                `;

                // Add icon
                const icon = document.createElement('sl-icon');
                icon.name = tab.icon;
                icon.style.marginRight = '4px';
                icon.style.fontSize = '10px';
                slTab.appendChild(icon);

                slTab.appendChild(document.createTextNode(tab.label));
                tabGroup.appendChild(slTab);
            });

            // Create Tab Panels

            // 1. Info Panel (Source)
            if (hasInfo) {
                const infoPanel = document.createElement('sl-tab-panel');
                infoPanel.name = 'info';
                infoPanel.style.cssText = '--padding: 10px;';

                const infoContent = this._createSourceContent(layerId, config);
                infoPanel.appendChild(infoContent);
                tabGroup.appendChild(infoPanel);
            }

            // 2. Legend Panel
            if (hasLegend) {
                const legendPanel = document.createElement('sl-tab-panel');
                legendPanel.name = 'legend';
                legendPanel.style.cssText = '--padding: 10px;';

                const legendContent = this._createLegendContent(layerId, config);
                legendPanel.appendChild(legendContent);
                tabGroup.appendChild(legendPanel);
            }

            // 3. Features Panel
            if (hasFeatures) {
                const featuresPanel = document.createElement('sl-tab-panel');
                featuresPanel.name = 'features';
                featuresPanel.style.cssText = '--padding: 0;'; // No padding for features list

                const featuresContent = this._createFeaturesContent(layerId, config, features);
                featuresPanel.appendChild(featuresContent);
                tabGroup.appendChild(featuresPanel);
            }

            // 4. Style Panel
            if (hasStyleControls && this.options.showLayerOptions) {
                const stylePanel = document.createElement('sl-tab-panel');
                stylePanel.name = 'style';
                stylePanel.style.cssText = '--padding: 0;';

                const styleContent = this._createStyleContent(layerId, config);
                stylePanel.appendChild(styleContent);
                tabGroup.appendChild(stylePanel);
            }

            // Append tab group to container FIRST (important for Shoelace initialization)
            contentContainer.appendChild(tabGroup);

            // THEN set active tab
            // Priority: Features (if selected) -> Info -> Legend
            requestAnimationFrame(() => {
                if (hasSelectedFeatures && hasFeatures) {
                    tabGroup.show('features');
                } else if (hasInfo) {
                    tabGroup.show('info');
                } else if (hasLegend) {
                    tabGroup.show('legend');
                } else if (hasFeatures) {
                    tabGroup.show('features');
                }
            });
        }
    }

    /**
     * Create action controls for the layer (Compact version for header)
     */
    _createLayerActions(layerId, config) {
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'layer-actions';

        const isCollapsed = this._layerCollapseStates.get(layerId) || false;

        // Opacity Button (Popover)
        const opacityBtn = document.createElement('sl-icon-button');
        opacityBtn.name = 'lightbulb';
        opacityBtn.style.fontSize = '14px';
        opacityBtn.style.color = 'white';
        opacityBtn.style.opacity = '0.9';
        opacityBtn.label = 'Opacity';
        opacityBtn.title = 'Opacity';

        opacityBtn.addEventListener('mouseenter', () => {
            opacityBtn.style.opacity = '1';
        });
        opacityBtn.addEventListener('mouseleave', () => {
            opacityBtn.style.opacity = '0.9';
        });

        // Create opacity popover
        const opacityPopover = document.createElement('sl-dropdown');
        opacityPopover.distance = 5;
        opacityPopover.placement = 'bottom-end';
        opacityPopover.style.display = isCollapsed ? 'none' : '';

        const opacityTrigger = document.createElement('div');
        opacityTrigger.setAttribute('slot', 'trigger');
        opacityTrigger.appendChild(opacityBtn);
        opacityPopover.appendChild(opacityTrigger);

        const opacityPanel = document.createElement('div');
        opacityPanel.className = 'opacity-panel';

        // Reuse existing opacity slider logic but adapted for popover
        const sliderContainer = this._createOpacityDropdown(layerId, config);
        opacityPanel.appendChild(sliderContainer);

        opacityPopover.appendChild(opacityPanel);
        actionsContainer.appendChild(opacityPopover);

        // Settings Button (if available)
        const settingsBtn = document.createElement('sl-icon-button');
        settingsBtn.name = 'gear';
        settingsBtn.className = 'layer-settings-btn';
        settingsBtn.style.color = 'white';
        settingsBtn.style.opacity = '0.9';
        // Hide if collapsed OR if showLayerOptions is disabled
        settingsBtn.style.display = (isCollapsed || !this.options.showLayerOptions) ? 'none' : '';
        settingsBtn.setAttribute('title', 'Layer Settings');

        settingsBtn.addEventListener('mouseenter', () => {
            settingsBtn.style.opacity = '1';
        });
        settingsBtn.addEventListener('mouseleave', () => {
            settingsBtn.style.opacity = '0.9';
        });

        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openLayerSettings(layerId);
        });

        actionsContainer.appendChild(settingsBtn);

        // Zoom Button
        if (config.bbox || config.metadata?.bbox) {
            const zoomBtn = document.createElement('sl-icon-button');
            zoomBtn.name = 'zoom-in';
            zoomBtn.label = 'Zoom to layer';
            zoomBtn.className = 'layer-zoom-btn';

            zoomBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._zoomToLayerBounds(layerId, config);
            });

            actionsContainer.appendChild(zoomBtn);
        }

        // Remove Button
        const removeBtn = document.createElement('sl-icon-button');
        removeBtn.name = 'trash';
        removeBtn.label = 'Remove layer';
        removeBtn.className = 'layer-remove-btn';
        removeBtn.style.color = '#ef4444';

        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._removeLayer(layerId);
        });

        actionsContainer.appendChild(removeBtn);

        return actionsContainer;
    }

    /**
     * Create opacity slider with continuous range control
     */
    _createOpacityDropdown(layerId, config) {
        const container = document.createElement('div');
        container.setAttribute('data-layer-id', layerId);
        container.className = 'opacity-dropdown-container';

        // Create label with icon
        const label = document.createElement('div');
        label.className = 'opacity-label';

        // Create icon container for layered effect
        const iconContainer = document.createElement('div');
        iconContainer.className = 'opacity-icon-container';

        // Base lightbulb icon
        const iconBase = document.createElement('sl-icon');
        iconBase.name = 'lightbulb';
        iconBase.className = 'opacity-icon-base';

        // Dark overlay lightbulb icon (opacity will be inversely controlled)
        const iconOverlay = document.createElement('sl-icon');
        iconOverlay.name = 'lightbulb-fill';
        iconOverlay.className = 'opacity-icon-overlay';

        iconContainer.appendChild(iconBase);
        iconContainer.appendChild(iconOverlay);

        const labelText = document.createElement('span');
        labelText.textContent = 'Opacity';

        label.appendChild(iconContainer);
        label.appendChild(labelText);

        // Create range slider
        const slider = document.createElement('sl-range');
        slider.min = 0;
        slider.max = 100;
        slider.step = 1;
        slider.tooltip = 'right';

        // Set initial value - convert from 0-1 scale to 0-100 scale
        // First check if config.opacity exists (from URL or layer config), otherwise query the map
        let currentOpacity;
        if (config.opacity !== undefined) {
            currentOpacity = config.opacity;
        } else {
            currentOpacity = this._getCurrentLayerOpacity(layerId, config);
        }
        const opacityPercent = (!isNaN(currentOpacity) && isFinite(currentOpacity))
            ? Math.round(currentOpacity * 100)
            : 90; // Default to 90%
        slider.value = opacityPercent;

        // Set initial overlay opacity (inverse of slider value)
        iconOverlay.style.opacity = (1 - (opacityPercent / 100)).toString();

        // Custom tooltip formatter to show percentage
        slider.tooltipFormatter = (value) => `${value}%`;

        slider.className = 'opacity-slider';

        // Add click handler to label for opacity toggle
        label.addEventListener('click', () => {
            const currentValue = parseInt(slider.value);
            let newValue;

            // Toggle logic: if not 0 or 100, go to 0 first
            if (currentValue !== 0 && currentValue !== 100) {
                newValue = 0;
            } else if (currentValue === 0) {
                newValue = 100;
            } else {
                newValue = 0;
            }

            // Update slider value
            slider.value = newValue;

            // Update overlay opacity (inverse of slider value)
            iconOverlay.style.opacity = (1 - (newValue / 100)).toString();

            // Apply the new opacity
            const opacityValue = newValue / 100;
            this._applyLayerOpacity(layerId, config, opacityValue);

            // Update config.opacity to persist the value
            config.opacity = opacityValue;

            // Trigger URL update if urlManager is available
            if (window.urlManager) {
                window.urlManager.updateURL();
            }
        });

        // Add hover effect to label
        label.addEventListener('mouseenter', () => {
            label.style.color = '#374151';
        });

        label.addEventListener('mouseleave', () => {
            label.style.color = '#6b7280';
        });

        // Add event listener for real-time opacity changes as user drags
        slider.addEventListener('sl-input', (e) => {
            const opacityPercent = parseInt(e.target.value);
            const opacityValue = opacityPercent / 100;

            // Update overlay opacity (inverse of slider value)
            iconOverlay.style.opacity = (1 - (opacityPercent / 100)).toString();

            // Apply opacity to layer in real-time
            this._applyLayerOpacity(layerId, config, opacityValue);
        });

        // Add event listener for when user finishes adjusting (optional, for any final actions)
        slider.addEventListener('sl-change', (e) => {
            const opacityPercent = parseInt(e.target.value);
            const opacityValue = opacityPercent / 100;

            // Update overlay opacity (inverse of slider value)
            iconOverlay.style.opacity = (1 - (opacityPercent / 100)).toString();

            // Ensure final opacity is applied
            this._applyLayerOpacity(layerId, config, opacityValue);

            // Update config.opacity to persist the value
            config.opacity = opacityValue;

            // Trigger URL update if urlManager is available
            if (window.urlManager) {
                window.urlManager.updateURL();
            }
        });

        container.appendChild(label);
        container.appendChild(slider);

        return container;
    }

    /**
     * Create zoom button for layers with bbox
     */
    _createZoomButton(layerId, config) {
        const zoomBtn = document.createElement('sl-button');
        zoomBtn.size = 'small';
        zoomBtn.variant = 'text';
        zoomBtn.innerHTML = '<sl-icon name="zoom-in"></sl-icon>';
        zoomBtn.setAttribute('aria-label', 'Zoom to layer extent');
        zoomBtn.title = 'Zoom to layer extent';
        zoomBtn.style.cssText = `
            min-width: auto;
            --sl-color-primary-600: #3b82f6;
            --sl-color-primary-500: #3b82f6;
        `;

        // Add click handler for zooming to layer bounds
        zoomBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._zoomToLayerBounds(layerId, config);
        });

        return zoomBtn;
    }

    /**
     * Zoom to layer bounds using bbox
     */
    _zoomToLayerBounds(layerId, config) {
        // Get bbox from either direct property or metadata
        const bbox = config.bbox || config.metadata?.bbox;

        if (!bbox || !this._map) {
            console.warn('No bbox available for layer or map not initialized');
            return;
        }

        // Check if bbox is valid (not unrectified map)
        if (bbox === "0.0,0.0,0.0,0.0") {
            console.log('Cannot zoom: layer has no valid bbox (unrectified map)');
            this._showToast('Cannot zoom to layer: no valid geographic bounds available', 'warning');
            return;
        }

        try {
            // Parse bbox string "minLng,minLat,maxLng,maxLat"
            const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(parseFloat);

            // Validate coordinates
            if (isNaN(minLng) || isNaN(minLat) || isNaN(maxLng) || isNaN(maxLat)) {
                console.warn('Invalid bbox coordinates:', bbox);
                this._showToast('Cannot zoom to layer: invalid coordinates', 'error');
                return;
            }

            // Create bounds array for Mapbox: [[minLng, minLat], [maxLng, maxLat]]
            const bounds = [[minLng, minLat], [maxLng, maxLat]];

            console.log('Zooming to layer bounds:', bounds);

            // Fit map to bounds with some padding
            this._map.fitBounds(bounds, {
                padding: {
                    top: 50,
                    bottom: 50,
                    left: 50,
                    right: 50
                },
                maxZoom: 16, // Don't zoom in too close
                duration: 1000 // Smooth animation
            });

            // Show success toast
            this._showToast(`Zoomed to ${config.title || layerId}`, 'success', 2000);

        } catch (error) {
            console.error('Error zooming to layer bounds:', error);
            this._showToast('Error zooming to layer', 'error');
        }
    }

    /**
     * Open layer settings modal
     */
    _openLayerSettings(layerId) {
        const config = this._getLayerConfig(layerId);
        if (config && this._layerSettingsModal) {
            this._layerSettingsModal.show(config);
        } else {
            console.warn(`Cannot open settings for layer ${layerId}: config or modal not available`);
        }
    }

    /**
     * Create Source content for Info tab
     */
    _createSourceContent(layerId, config) {
        const hasContent = config.description || config.attribution;
        if (!hasContent) return null;

        // Create content container
        const content = document.createElement('div');
        content.className = 'source-content';
        content.style.cssText = `
            padding: 0;
            font-size: 11px;
            line-height: 1.4;
            color: #000; /* Darker text for better visibility */
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
            attrDiv.style.cssText = 'font-style: italic; color: #4b5563; margin-top: 4px;';
            content.appendChild(attrDiv);
        }

        return content;
    }

    /**
     * Create Legend content for Legend tab
     */
    _createLegendContent(layerId, config) {
        const hasLegend = config.legend || config.legendImage;
        if (!hasLegend) return null;

        // Create content container
        const content = document.createElement('div');
        content.className = 'legend-content';
        content.style.cssText = `
            padding: 0;
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
            legendDiv.style.cssText = 'font-size: 10px; color: #374151;';
            content.appendChild(legendDiv);
        }

        return content;
    }

    /**
     * Create Style content for Style tab
     */
    _createStyleContent(layerId, config) {
        if (!this._layerStyleControl) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'empty-state';
            emptyDiv.textContent = 'Style editor not available';
            return emptyDiv;
        }

        return this._layerStyleControl.renderStyleEditor(layerId, config);
    }

    /**
     * Create Features content for Features tab
     */
    _createFeaturesContent(layerId, config, features) {
        // Create content container for features
        const content = document.createElement('div');
        content.className = 'features-content';
        content.id = `features-container-${layerId}`;
        content.setAttribute('data-layer-features', layerId);
        content.style.cssText = `
            overflow-y: auto;
            background: transparent;
            padding: 4px 0;
            max-height: 300px; /* Limit height for features list */
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
            emptyDiv.className = 'empty-state';
            emptyDiv.textContent = 'No features selected. Click on map features to inspect them.';
            content.appendChild(emptyDiv);
        }

        return content;
    }

    /**
     * Convert URLs in text to clickable links
     * @param {string} text - The text that may contain URLs
     * @param {boolean} isDarkTheme - Whether the link should use dark theme colors (default: false)
     * @returns {HTMLElement} - A container element with clickable links
     */
    _makeUrlsClickable(text, isDarkTheme = false) {
        const container = document.createElement('span');
        const textStr = String(text);

        // URL regex pattern: matches http://, https://, or www. URLs
        const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
        const parts = textStr.split(urlRegex);

        // Choose link color based on theme
        const linkColor = isDarkTheme ? '#60a5fa' : '#2563eb'; // Lighter blue for dark theme, darker blue for light theme

        parts.forEach(part => {
            // Check if part matches URL pattern without using test() to avoid regex state issues
            const urlMatch = part.match(/^(https?:\/\/[^\s]+|www\.[^\s]+)$/i);
            if (urlMatch) {
                // This is a URL - create a clickable link
                const link = document.createElement('a');
                let href = part;

                // Add http:// if it starts with www.
                if (part.toLowerCase().startsWith('www.')) {
                    href = 'http://' + part;
                }

                link.href = href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = part;
                link.style.cssText = `
                    color: ${linkColor};
                    text-decoration: underline;
                    cursor: pointer;
                `;

                container.appendChild(link);
            } else if (part) {
                // Regular text - create text node
                container.appendChild(document.createTextNode(part));
            }
        });

        return container;
    }

    /**
     * Render feature within details component structure
     */
    _renderFeatureInDetails(container, featureState, layerConfig, layerId) {
        const featureElement = document.createElement('div');
        const featureId = this._getFeatureId(featureState.feature);

        featureElement.className = 'feature-control-feature selected feature-element-details';
        featureElement.setAttribute('data-feature-id', featureId);
        featureElement.setAttribute('data-layer-id', layerId);

        // Add standardized ID for direct targeting: inspector-{layerId}-{featureId}
        featureElement.id = `inspector-${layerId}-${featureId}`;

        // Selected feature styling for the details structure (Light Theme)
        featureElement.style.cssText = `
            border: 1px solid #e5e7eb;
            font-size: 11px;
            background: #f9fafb;
            cursor: pointer;
            padding: 0;
            margin-bottom: 8px;
            border-radius: 6px;
            overflow: hidden;
            color: black;
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
        tableContent.style.cssText = 'overflow-y: auto;';

        // Build the properties table with intelligent formatting (reuse existing logic)
        let table = document.createElement('table');
        table.className = 'feature-inspector-properties-table';
        table.id = `properties-table-${layerId}-${featureId}`;
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 0;
            font-family: inherit;
            background-color: white;
            border-radius: 0;
            overflow: hidden;
            font-size: 11px;
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

        // 3. Add remaining fields (only if inspect.fields is not defined)
        const hasConfiguredFields = priorityFields.length > 0;

        if (!hasConfiguredFields) {
            Object.entries(properties).forEach(([key, value]) => {
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
        }

        // Render the organized fields with compact styling
        organizedFields.forEach((field, index) => {
            const row = document.createElement('tr');

            // Set row background with alternating colors
            let rowBackgroundColor;
            if (field.isLabel) {
                rowBackgroundColor = '#f3f4f6';
            } else if (index % 2 === 0) {
                rowBackgroundColor = 'white';
            } else {
                rowBackgroundColor = '#f9fafb';
            }

            row.style.cssText = `
                border-bottom: 1px solid #f3f4f6;
                background-color: ${rowBackgroundColor};
                transition: background-color 0.1s ease;
            `;

            const keyCell = document.createElement('td');
            keyCell.style.cssText = `
                padding: 3px 6px;
                font-weight: 600;
                color: ${field.isLabel ? '#111827' : field.isPriority ? '#374151' : '#6b7280'};
                width: 35%;
                vertical-align: top;
                line-height: 1.4;
                font-size: 11px;
                border-right: 1px solid #f3f4f6;
            `;
            keyCell.textContent = field.displayName;

            const valueCell = document.createElement('td');
            valueCell.style.cssText = `
                padding: 3px 6px;
                word-break: break-word;
                font-size: 11px;
                font-weight: ${field.isLabel ? '600' : '400'};
                color: ${field.isLabel ? '#111827' : '#4b5563'};
                line-height: 1.4;
                vertical-align: top;
            `;
            // Make URLs clickable (light theme for nested details view)
            const urlContainer = this._makeUrlsClickable(field.value, false);
            valueCell.appendChild(urlContainer);

            row.appendChild(keyCell);
            row.appendChild(valueCell);
            table.appendChild(row);
        });

        tableContent.appendChild(table);

        // Add "View Raw" button if fields are configured
        if (hasConfiguredFields) {
            const viewRawButton = document.createElement('button');
            viewRawButton.textContent = 'View Raw';
            viewRawButton.className = 'view-raw-button';
            viewRawButton.style.cssText = `
                margin-top: 4px;
                margin-bottom: 4px;
                margin-left: 8px;
                padding: 2px 6px;
                font-size: 10px;
                border: 1px solid #d1d5db;
                background-color: #f9fafb;
                color: #374151;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.15s ease;
                font-weight: 500;
            `;

            viewRawButton.addEventListener('mouseenter', () => {
                viewRawButton.style.backgroundColor = '#f3f4f6';
                viewRawButton.style.borderColor = '#9ca3af';
            });

            viewRawButton.addEventListener('mouseleave', () => {
                viewRawButton.style.backgroundColor = '#f9fafb';
                viewRawButton.style.borderColor = '#d1d5db';
            });

            let showingRaw = false;
            viewRawButton.addEventListener('click', () => {
                if (!showingRaw) {
                    // Replace table with raw properties
                    const rawTable = document.createElement('table');
                    rawTable.className = 'feature-inspector-properties-table';
                    rawTable.id = `properties-table-${layerId}-${featureId}`;
                    rawTable.style.cssText = table.style.cssText;

                    Object.entries(properties).forEach(([key, value], index) => {
                        if (value === undefined || value === null || value === '') return;

                        const row = document.createElement('tr');
                        const rowBackgroundColor = index % 2 === 0 ? 'white' : '#f9fafb';
                        row.style.cssText = `
                            border-bottom: 1px solid #f3f4f6;
                            background-color: ${rowBackgroundColor};
                            transition: background-color 0.1s ease;
                        `;

                        const keyCell = document.createElement('td');
                        keyCell.style.cssText = `
                            padding: 3px 6px;
                            font-weight: 600;
                            color: #6b7280;
                            width: 35%;
                            vertical-align: top;
                            line-height: 1.4;
                            font-size: 11px;
                            border-right: 1px solid #f3f4f6;
                        `;
                        keyCell.textContent = key;

                        const valueCell = document.createElement('td');
                        valueCell.style.cssText = `
                            padding: 3px 6px;
                            word-break: break-word;
                            font-size: 11px;
                            font-weight: 400;
                            color: #4b5563;
                            line-height: 1.4;
                            vertical-align: top;
                        `;
                        const urlContainer = this._makeUrlsClickable(value, false);
                        valueCell.appendChild(urlContainer);

                        row.appendChild(keyCell);
                        row.appendChild(valueCell);
                        rawTable.appendChild(row);
                    });

                    table.replaceWith(rawTable);
                    table = rawTable;
                    viewRawButton.textContent = 'View Formatted';
                    showingRaw = true;
                } else {
                    // Replace with filtered table
                    const filteredTable = document.createElement('table');
                    filteredTable.className = 'feature-inspector-properties-table';
                    filteredTable.id = `properties-table-${layerId}-${featureId}`;
                    filteredTable.style.cssText = table.style.cssText;

                    organizedFields.forEach(field => {
                        const row = document.createElement('tr');
                        let rowBackgroundColor = 'white';
                        if (field.isLabel) {
                            rowBackgroundColor = '#f3f4f6';
                        } else if (field.isPriority) {
                            rowBackgroundColor = '#f9fafb';
                        }

                        row.style.cssText = `
                            border-bottom: 1px solid #f3f4f6;
                            background-color: ${rowBackgroundColor};
                            transition: background-color 0.1s ease;
                        `;

                        const keyCell = document.createElement('td');
                        keyCell.style.cssText = `
                            padding: 6px 8px;
                            font-weight: 600;
                            color: ${field.isLabel ? '#111827' : field.isPriority ? '#374151' : '#6b7280'};
                            width: 35%;
                            vertical-align: top;
                            line-height: 1.4;
                            font-size: 11px;
                            border-right: 1px solid #f3f4f6;
                        `;
                        keyCell.textContent = field.displayName;

                        const valueCell = document.createElement('td');
                        valueCell.style.cssText = `
                            padding: 6px 8px;
                            word-break: break-word;
                            font-size: 11px;
                            font-weight: ${field.isLabel ? '600' : '400'};
                            color: ${field.isLabel ? '#111827' : '#4b5563'};
                            line-height: 1.4;
                            vertical-align: top;
                        `;
                        const urlContainer = this._makeUrlsClickable(field.value, false);
                        valueCell.appendChild(urlContainer);

                        row.appendChild(keyCell);
                        row.appendChild(valueCell);
                        filteredTable.appendChild(row);
                    });

                    table.replaceWith(filteredTable);
                    table = filteredTable;
                    viewRawButton.textContent = 'View Raw';
                    showingRaw = false;
                }
            });

            tableContent.appendChild(viewRawButton);
        }

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
            margin-top: 0;
            padding: 8px;
            border-top: 1px solid #e5e7eb;
            background-color: #f9fafb;
            color: #1f2937;
            border-radius: 0;
            font-size: 11px;
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
                            separator.style.cssText = 'border-top: 1px solid #e5e7eb; margin: 6px 0; padding-top: 6px;';
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
     * Add feature actions footer (export functionality moved to map-export-control.js)
     */
    _addFeatureActionsToContent(content, featureState, layerConfig, layerId, featureId) {
        const feature = featureState.feature;

        // Create container for action buttons
        const actionContainer = document.createElement('div');
        actionContainer.className = 'feature-actions';
        actionContainer.style.cssText = `
            padding: 8px 10px;
            border-top: 1px solid #e5e7eb;
            background-color: #f9fafb;
            display: flex;
            gap: 8px;
            font-size: 11px;
            border-radius: 0 0 6px 6px;
            min-width: 0;
            flex-wrap: wrap;
        `;

        content.appendChild(actionContainer);
    }


    /**
     * Show layer settings modal
     */
    _showLayerSettings(layerConfig) {
        // Use our own layer settings modal instance
        if (this._layerSettingsModal) {
            this._layerSettingsModal.show(layerConfig);
        } else {
            // Fallback to layer control's settings modal if available
            if (window.layerControl && window.layerControl._layerSettingsModal) {
                window.layerControl._layerSettingsModal.show(layerConfig);
            } else {
                console.warn('Layer settings functionality not available');
                this._showToast('Layer settings not available', 'warning');
            }
        }
    }

    /**
     * Save layer settings - delegate to the main layer control
     * This method is called by the LayerSettingsModal when settings are saved
     */
    _saveLayerSettingsInternal(newConfig) {
        // Delegate to the main layer control if available
        if (window.layerControl && typeof window.layerControl._saveLayerSettingsInternal === 'function') {
            window.layerControl._saveLayerSettingsInternal(newConfig);
            this._showToast('Layer settings saved successfully', 'success');
        } else {
            console.warn('Cannot save layer settings: main layer control not available');
            this._showToast('Unable to save layer settings', 'error');
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

            if ($toggleInput.length > 0) {
                // Use jQuery to uncheck and trigger change event
                $toggleInput.prop('checked', false);
                $toggleInput.trigger('change');

                // Close the details and remove active state using jQuery
                $layerElement.prop('open', false);
                $layerElement.removeClass('active');

                // IMPORTANT: Restore all layers that may have been hidden by layer isolation
                this._restoreAllLayers();

            } else {
                console.error(`[FeatureControl] No checkbox input found for layer ${layerId}`);

                // Last resort: try to find any clickable element that might toggle the layer
                const $anyToggle = $layerElement.find('[type="checkbox"], .toggle-switch, .toggle-slider');
                if ($anyToggle.length > 0) {
                    $anyToggle.first().click();
                }
            }

        } catch (error) {
            console.error(`[FeatureControl] Error removing layer ${layerId}:`, error);
        }

        // IMPORTANT: Always restore all layers after removal attempt to fix layer isolation issue
        this._restoreAllLayers();
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
            left: 10px;
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
        closeBtn.setAttribute('aria-label', 'Close legend');
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
        // Insert new layers at the top (beginning) so newest layers appear first
        const firstChild = this._layersContainer.firstChild;
        if (firstChild) {
            this._layersContainer.insertBefore(layerElement, firstChild);
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
                left: 10px;
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
            closeBtn.setAttribute('aria-label', 'Close');
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
            opacityBtn.setAttribute('aria-label', 'Toggle opacity');
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

            } else {
                console.error(`[FeatureControl] No checkbox input found for layer ${layerId}`);

                // Last resort: try to find any clickable element that might toggle the layer
                const $anyToggle = $layerElement.find('[type="checkbox"], .toggle-switch, .toggle-slider');
                if ($anyToggle.length > 0) {
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
            // Try to update all possible vector layer variants
            if (this._map.getLayer(`vector-layer-${layerId}`)) {
                this._map.setPaintProperty(`vector-layer-${layerId}`, 'fill-opacity', opacityFactor);
            }
            if (this._map.getLayer(`vector-layer-${layerId}-outline`)) {
                this._map.setPaintProperty(`vector-layer-${layerId}-outline`, 'line-opacity', opacityFactor);
            }
            if (this._map.getLayer(`vector-layer-${layerId}-circle`)) {
                this._map.setPaintProperty(`vector-layer-${layerId}-circle`, 'circle-opacity', opacityFactor);
            }
            if (this._map.getLayer(`vector-layer-${layerId}-text`)) {
                this._map.setPaintProperty(`vector-layer-${layerId}-text`, 'text-opacity', opacityFactor);
            }
        } else if (config.type === 'tms') {
            const layerIdOnMap = `tms-layer-${layerId}`;
            if (this._map.getLayer(layerIdOnMap)) {
                this._map.setPaintProperty(layerIdOnMap, 'raster-opacity', opacityFactor);
            }
        } else if (config.type === 'wmts') {
            const layerIdOnMap = `wmts-layer-${layerId}`;
            if (this._map.getLayer(layerIdOnMap)) {
                this._map.setPaintProperty(layerIdOnMap, 'raster-opacity', opacityFactor);
            }
        } else if (config.type === 'wms') {
            const layerIdOnMap = `wms-layer-${layerId}`;
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
        let table = document.createElement('table');
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

        // 3. Add remaining fields (only if inspect.fields is not defined)
        const hasConfiguredFields = priorityFields.length > 0;

        if (!hasConfiguredFields) {
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
        }

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
        organizedFields.forEach((field, index) => {
            const row = document.createElement('tr');

            // Set row background with alternating colors
            let rowBackgroundColor;
            if (field.isLabel) {
                rowBackgroundColor = '#f8fafc';
            } else if (index % 2 === 0) {
                rowBackgroundColor = '#ffffff';
            } else {
                rowBackgroundColor = '#f9fafb';
            }

            row.style.cssText = `
                border-bottom: 1px solid #e5e7eb;
                background-color: ${rowBackgroundColor};
                transition: background-color 0.1s ease;
            `;

            // Add subtle hover effect for better UX
            row.addEventListener('mouseenter', () => {
                row.style.backgroundColor = '#f3f4f6';
            });

            row.addEventListener('mouseleave', () => {
                row.style.backgroundColor = rowBackgroundColor;
            });

            const keyCell = document.createElement('td');
            keyCell.style.cssText = `
                padding: 3px 6px;
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
                keyCell.title = `Original field: ${field.key}`;
                keyCell.style.cursor = 'help';
            } else {
                keyCell.textContent = field.displayName;
            }

            const valueCell = document.createElement('td');
            valueCell.style.cssText = `
                padding: 3px 6px;
                word-break: break-word;
                font-size: ${field.isLabel ? '12px' : '10px'};
                font-weight: ${field.isLabel ? '600' : '400'};
                color: ${field.isLabel ? '#1f2937' : '#374151'};
                line-height: 1.3;
                vertical-align: top;
            `;
            // Make URLs clickable (light theme for main panel view)
            const urlContainer = this._makeUrlsClickable(field.value, false);
            valueCell.appendChild(urlContainer);

            row.appendChild(keyCell);
            row.appendChild(valueCell);
            table.appendChild(row);
        });

        tableContent.appendChild(table);

        // Add "View Raw" button if fields are configured
        if (hasConfiguredFields) {
            const viewRawButton = document.createElement('button');
            viewRawButton.textContent = 'View Raw';
            viewRawButton.className = 'view-raw-button';
            viewRawButton.style.cssText = `
                margin-top: 8px;
                padding: 4px 12px;
                font-size: 10px;
                border: 1px solid #d1d5db;
                background-color: #f9fafb;
                color: #374151;
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.15s ease;
                font-weight: 500;
            `;

            viewRawButton.addEventListener('mouseenter', () => {
                viewRawButton.style.backgroundColor = '#f3f4f6';
                viewRawButton.style.borderColor = '#9ca3af';
            });

            viewRawButton.addEventListener('mouseleave', () => {
                viewRawButton.style.backgroundColor = '#f9fafb';
                viewRawButton.style.borderColor = '#d1d5db';
            });

            let showingRaw = false;
            viewRawButton.addEventListener('click', () => {
                if (!showingRaw) {
                    // Replace table with raw properties
                    const rawTable = document.createElement('table');
                    rawTable.className = 'feature-inspector-properties-table';
                    rawTable.id = `properties-table-${layerId}-${featureId}`;
                    rawTable.style.cssText = table.style.cssText;

                    Object.entries(properties).forEach(([key, value], index) => {
                        if (value === undefined || value === null || value === '') return;

                        const row = document.createElement('tr');
                        const rowBackgroundColor = index % 2 === 0 ? '#ffffff' : '#f9fafb';
                        row.style.cssText = `
                            border-bottom: 1px solid #e5e7eb;
                            background-color: ${rowBackgroundColor};
                            transition: background-color 0.1s ease;
                        `;

                        row.addEventListener('mouseenter', () => {
                            row.style.backgroundColor = '#f3f4f6';
                        });

                        row.addEventListener('mouseleave', () => {
                            row.style.backgroundColor = rowBackgroundColor;
                        });

                        const keyCell = document.createElement('td');
                        keyCell.style.cssText = `
                            padding: 3px 6px;
                            font-weight: 600;
                            color: #6b7280;
                            width: 40%;
                            vertical-align: top;
                            line-height: 1.3;
                            font-size: 10px;
                        `;
                        keyCell.textContent = key;

                        const valueCell = document.createElement('td');
                        valueCell.style.cssText = `
                            padding: 3px 6px;
                            word-break: break-word;
                            font-size: 10px;
                            font-weight: 400;
                            color: #374151;
                            line-height: 1.3;
                            vertical-align: top;
                        `;
                        const urlContainer = this._makeUrlsClickable(value, false);
                        valueCell.appendChild(urlContainer);

                        row.appendChild(keyCell);
                        row.appendChild(valueCell);
                        rawTable.appendChild(row);
                    });

                    table.replaceWith(rawTable);
                    table = rawTable;
                    viewRawButton.textContent = 'View Formatted';
                    showingRaw = true;
                } else {
                    // Replace with filtered table
                    const filteredTable = document.createElement('table');
                    filteredTable.className = 'feature-inspector-properties-table';
                    filteredTable.id = `properties-table-${layerId}-${featureId}`;
                    filteredTable.style.cssText = table.style.cssText;

                    organizedFields.forEach((field, index) => {
                        const row = document.createElement('tr');
                        let rowBackgroundColor;
                        if (field.isLabel) {
                            rowBackgroundColor = '#f8fafc';
                        } else if (index % 2 === 0) {
                            rowBackgroundColor = '#ffffff';
                        } else {
                            rowBackgroundColor = '#f9fafb';
                        }

                        row.style.cssText = `
                            border-bottom: 1px solid #e5e7eb;
                            background-color: ${rowBackgroundColor};
                            transition: background-color 0.1s ease;
                        `;

                        row.addEventListener('mouseenter', () => {
                            row.style.backgroundColor = '#f3f4f6';
                        });

                        row.addEventListener('mouseleave', () => {
                            row.style.backgroundColor = rowBackgroundColor;
                        });

                        const keyCell = document.createElement('td');
                        keyCell.style.cssText = `
                            padding: 3px 6px;
                            font-weight: 600;
                            color: ${field.isLabel ? '#1f2937' : field.isPriority ? '#374151' : '#6b7280'};
                            width: 40%;
                            vertical-align: top;
                            line-height: 1.3;
                            font-size: ${field.isLabel ? '11px' : '10px'};
                        `;

                        if (field.displayName !== field.key) {
                            keyCell.textContent = field.displayName;
                            keyCell.title = `Original field: ${field.key}`;
                            keyCell.style.cursor = 'help';
                        } else {
                            keyCell.textContent = field.displayName;
                        }

                        const valueCell = document.createElement('td');
                        valueCell.style.cssText = `
                            padding: 3px 6px;
                            word-break: break-word;
                            font-size: ${field.isLabel ? '12px' : '10px'};
                            font-weight: ${field.isLabel ? '600' : '400'};
                            color: ${field.isLabel ? '#1f2937' : '#374151'};
                            line-height: 1.3;
                            vertical-align: top;
                        `;
                        const urlContainer = this._makeUrlsClickable(field.value, false);
                        valueCell.appendChild(urlContainer);

                        row.appendChild(keyCell);
                        row.appendChild(valueCell);
                        filteredTable.appendChild(row);
                    });

                    table.replaceWith(filteredTable);
                    table = filteredTable;
                    viewRawButton.textContent = 'View Raw';
                    showingRaw = false;
                }
            });

            tableContent.appendChild(viewRawButton);
        }

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
            color: #1f2937;
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
            // Add slide-out animation class
            existing.classList.add('layer-slide-out');

            // Wait for animation to complete before removing
            setTimeout(() => {
                if (existing && existing.parentNode) {
                    existing.remove();
                }
            }, 400); // Match CSS animation duration
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
            // Query all features at the click point with error handling for DEM data
            let features = [];
            try {
                features = this._map.queryRenderedFeatures(e.point);
            } catch (error) {
                // Handle DEM data range errors gracefully
                if (error.message && error.message.includes('out of range source coordinates for DEM data')) {
                    // Clear selections if DEM query fails at click location
                    this._stateManager.clearAllSelections();
                    return;
                } else {
                    // Re-throw other errors as they might be more serious
                    console.error('[MapFeatureControl] Error querying rendered features on click:', error);
                    throw error;
                }
            }

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

                // Map recentering disabled - features are selected without changing map center
                // Previously: setTimeout(() => { this._easeToCenterWithOffset(e.lngLat); }, 100);
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
     * Uses feature metadata directly when available, falling back to precise layer matching
     * FIXED: More precise matching to avoid cross-layer contamination
     */
    _findLayerIdForFeature(feature) {
        if (!feature.layer || !feature.layer.id) return null;

        // OPTIMIZATION: Use metadata.groupId directly if available
        // This avoids expensive layer matching loops and is most reliable
        if (feature.layer.metadata && feature.layer.metadata.groupId) {
            const groupId = feature.layer.metadata.groupId;

            // Verify this layer is actually registered and interactive
            if (this._stateManager.isLayerInteractive(groupId)) {
                return groupId;
            }
        }

        // Fallback to improved method if metadata is not available
        const actualLayerId = feature.layer.id;

        // IMPROVED: Check for exact ID matches first to avoid cross-contamination
        const activeLayers = this._stateManager.getActiveLayers();

        // Pass 1: Look for direct/exact matches only
        for (const [layerId, layerData] of activeLayers) {
            const layerConfig = layerData.config;

            // Check for exact ID match first
            if (actualLayerId === layerId) {
                return layerId;
            }

            // Check for exact prefix matches (geojson, vector patterns)
            if (actualLayerId.startsWith(layerId + '-') || actualLayerId.startsWith(layerId + ' ')) {
                return layerId;
            }

            // Check type-specific exact patterns
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

        // Pass 2: Only if no exact matches found, use broader matching
        // This prevents features from matching multiple layers with shared sources
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
     * FIXED: More precise matching to avoid cross-matches between layers with same sourceLayer
     */
    _getMatchingLayerIds(layerConfig) {
        const style = this._map.getStyle();
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

        // If we have direct matches, prioritize them and be more restrictive with fallback strategies
        const hasDirectMatches = directMatches.length > 0 || prefixMatches.length > 0;

        // Strategy 3: Source layer matches with additional layer ID filtering (ONLY if no direct matches found)
        // This prevents cross-matches when multiple configs share the same sourceLayer
        if (!hasDirectMatches && layerConfig.sourceLayer) {
            const sourceLayerMatches = style.layers
                .filter(l => {
                    // Must match the sourceLayer
                    if (l['source-layer'] !== layerConfig.sourceLayer) return false;

                    // Additional filtering to prevent cross-matches:
                    // Only include style layers that contain the config layerId in their ID
                    // This ensures we don't pick up style layers from other config layers
                    return l.id.includes(layerId) || l.id === layerId;
                })
                .map(l => l.id);
            matchingIds.push(...sourceLayerMatches);
        }

        // Strategy 4: Source matches with additional layer ID filtering (ONLY if no direct matches found)
        // This prevents cross-matches when multiple configs share the same source
        if (!hasDirectMatches && layerConfig.source) {
            const sourceMatches = style.layers
                .filter(l => {
                    // Must match the source
                    if (l.source !== layerConfig.source) return false;

                    // Additional filtering to prevent cross-matches:
                    // Only include style layers that contain the config layerId in their ID
                    // This ensures we don't pick up style layers from other config layers
                    return l.id.includes(layerId) || l.id === layerId;
                })
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

        // Strategy 12: WMS layer matching
        if (layerConfig.type === 'wms') {
            const wmsMatches = style.layers
                .filter(l => l.id === `wms-layer-${layerId}`)
                .map(l => l.id);
            matchingIds.push(...wmsMatches);
        }

        // Strategy 13: WMTS layer matching
        if (layerConfig.type === 'wmts') {
            const wmtsMatches = style.layers
                .filter(l => l.id === `wmts-layer-${layerId}`)
                .map(l => l.id);
            matchingIds.push(...wmtsMatches);
        }

        // Strategy 14: Raster style layer matching
        if (layerConfig.type === 'raster-style-layer') {
            const styleLayerId = layerConfig.styleLayer || layerId;
            const rasterMatches = style.layers
                .filter(l => l.id === styleLayerId)
                .map(l => l.id);
            matchingIds.push(...rasterMatches);
        }

        // Strategy 14: Style layer matching (for layers with sublayers)
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

        // Clean up resize listener
        if (this._resizeListener) {
            window.removeEventListener('resize', this._resizeListener);
            window.removeEventListener('orientationchange', this._resizeListener);
            this._resizeListener = null;
        }

        // Clean up drag listeners
        if (this._dragListeners) {
            const { dragHandle, dragStart, dragEnd, drag } = this._dragListeners;
            dragHandle.removeEventListener("mousedown", dragStart);
            dragHandle.removeEventListener("touchstart", dragStart);
            document.removeEventListener("mouseup", dragEnd);
            document.removeEventListener("touchend", dragEnd);
            document.removeEventListener("mousemove", drag);
            document.removeEventListener("touchmove", drag);
            this._dragListeners = null;
        }

        // Clean up layer isolation state
        this._restoreAllLayers();

        // Clean up hover popup completely on cleanup
        this._removeHoverPopup();
        this._currentHoveredFeature = null;

        // Reset cursor to default grab state
        this._updateCursorForFeatures([]);

        // Reset animation state
        this._isAnimating = false;

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

        // Reset cursor to default grab when no features are hovered
        this._updateCursorForFeatures([]);
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
        // Skip mouse tracking during camera animations to prevent interference with feature selection
        if (this._isAnimating) {
            return;
        }

        // Query all features at the mouse point once with error handling for DEM data
        let features = [];
        try {
            features = this._map.queryRenderedFeatures(e.point);
        } catch (error) {
            // Handle DEM data range errors gracefully
            if (error.message && error.message.includes('out of range source coordinates for DEM data')) {
                // Clear any existing hover states when DEM query fails
                this._stateManager.handleMapMouseLeave();
                this._updateCursorForFeatures([]);
                return;
            } else {
                // Re-throw other errors as they might be more serious
                console.error('[MapFeatureControl] Error querying rendered features:', error);
                throw error;
            }
        }

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

        // Update cursor based on whether we have interactive features
        this._updateCursorForFeatures(interactiveFeatures);

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
     * Update cursor based on whether there are interactive features under the mouse
     */
    _updateCursorForFeatures(interactiveFeatures) {
        if (!this._map) return;

        const canvas = this._map.getCanvas();

        if (interactiveFeatures && interactiveFeatures.length > 0) {
            // Change cursor to pointer when hovering over interactive features
            canvas.style.cursor = 'pointer';
        } else {
            // Reset cursor to default grab when no interactive features
            canvas.style.cursor = 'grab';
        }
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

        // Temporarily disable mouse tracking during animation to prevent deselection
        this._isAnimating = true;

        // Ease to the clicked location with smooth animation
        this._map.easeTo({
            center: lngLat,
            offset: [0, offsetY], // [x, y] offset in pixels
            duration: 600, // Smooth 600ms animation
            essential: true // Ensures animation runs even if user prefers reduced motion
        });

        // Re-enable mouse tracking after animation completes
        setTimeout(() => {
            this._isAnimating = false;
        }, 650); // Slightly longer than animation duration to ensure it's complete
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
     * Ensures basemap layers (tagged with 'basemap') remain visible for reference
     */
    _isolateLayer(layerId, config) {
        if (!this._map) return;

        // Get matching style layers for the hovered config layer
        const hoveredLayerIds = this._getMatchingLayerIds(config);

        // Get all basemap layer IDs from config - CRITICAL: these must remain visible
        const basemapLayerIds = this._getBasemapLayerIds();

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

            // CRITICAL: Skip if this layer belongs to a basemap config layer
            // Basemap layers (like satellite imagery) must remain visible for reference
            if (basemapLayerIds.includes(styleLayerId)) {
                layersToKeep.push(styleLayerId + ' (basemap)');
                return;
            }

            // Add to hide list
            layersToHide.push(styleLayerId);
        });

        // Hide the layers
        layersToHide.forEach(styleLayerId => {
            try {
                // Skip slot layers (Mapbox GL JS v3+ feature) - they can't be hidden
                const layer = this._map.getLayer(styleLayerId);
                if (!layer || layer.type === 'slot') {
                    return;
                }

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

        // Update attribution to reflect only visible layers (isolated layer + basemaps)
        if (window.attributionControl) {
            window.attributionControl._updateAttribution();
        }

    }

    /**
     * Restore visibility of all previously hidden layers
     */
    _restoreAllLayers() {
        if (!this._map || !this._layerHoverState.isActive) return;

        // Restore visibility of all hidden layers
        this._layerHoverState.hiddenLayers.forEach(layerId => {
            try {
                // Skip slot layers (Mapbox GL JS v3+ feature) - they can't be hidden
                const layer = this._map.getLayer(layerId);
                if (!layer || layer.type === 'slot') {
                    return;
                }

                this._map.setLayoutProperty(layerId, 'visibility', 'visible');
            } catch (error) {
                console.warn(`Failed to restore layer ${layerId}:`, error);
            }
        });

        // Restore opacity of all layer details UI elements
        this._restoreLayerDetailsOpacity();

        // Reset hover state
        this._layerHoverState = {
            isActive: false,
            hiddenLayers: [],
            hoveredLayerId: null
        };

        // Update attribution to reflect all visible layers
        if (window.attributionControl) {
            window.attributionControl._updateAttribution();
        }
    }

    /**
     * Get all matching style layer IDs for basemap config layers
     * Basemap layers are identified by having the 'basemap' tag in their config
     * These layers remain visible during layer isolation to provide reference background
     * Checks both current config and layer registry for cross-atlas basemap layers
     */
    _getBasemapLayerIds() {
        const basemapLayerIds = [];
        const basemapConfigs = [];

        // Helper function to check if a layer has basemap tag
        const hasBasemapTag = (layer) => {
            return layer.tags && (
                (Array.isArray(layer.tags) && layer.tags.includes('basemap')) ||
                (typeof layer.tags === 'string' && layer.tags === 'basemap')
            );
        };

        // Helper function to process a layer config and add matching style layer IDs
        const processBasemapLayer = (layer) => {
            if (hasBasemapTag(layer)) {
                basemapConfigs.push(layer);
                const matchingIds = this._getMatchingLayerIds(layer);
                basemapLayerIds.push(...matchingIds);
            }
        };

        // Strategy 1: Check current config (for current atlas layers)
        let config = this._config;
        if (!config && window.layerControl && window.layerControl._config) {
            config = window.layerControl._config;
        }

        if (config) {
            // Find all config layers tagged with 'basemap'
            if (config.layers && Array.isArray(config.layers)) {
                config.layers.forEach(layer => processBasemapLayer(layer));
            }

            // Also check groups if they exist (older config format)
            if (config.groups && Array.isArray(config.groups)) {
                config.groups.forEach(group => processBasemapLayer(group));
            }
        }

        // Strategy 2: Check active layers from state manager (layers currently on the map)
        // This ensures we catch basemap layers that are already active
        if (this._stateManager) {
            const activeLayers = this._stateManager.getActiveLayers();
            if (activeLayers && activeLayers.size > 0) {
                for (const [layerId, layerData] of activeLayers.entries()) {
                    let layerConfig = layerData.config;

                    // If config doesn't have tags, try to get it from registry (for cross-atlas layers)
                    if (layerConfig && !layerConfig.tags && window.layerRegistry) {
                        const registryConfig = window.layerRegistry.getLayer(layerId);
                        if (registryConfig && registryConfig.tags) {
                            // Merge registry config tags into the layer config
                            layerConfig = { ...layerConfig, tags: registryConfig.tags };
                        }
                    }

                    if (layerConfig && hasBasemapTag(layerConfig)) {
                        // This basemap layer is currently active, process it
                        processBasemapLayer(layerConfig);
                    }
                }
            }
        }

        // Strategy 3: Check layer registry for basemap layers across ALL atlases
        // This is critical for cross-atlas scenarios (e.g., mapbox-satellite from mapbox atlas)
        if (window.layerRegistry && typeof window.layerRegistry.isInitialized === 'function' && window.layerRegistry.isInitialized()) {
            // Check if we can access atlas layers (may be private property)
            const atlasLayers = window.layerRegistry._atlasLayers;
            if (atlasLayers && typeof atlasLayers.entries === 'function') {
                // Iterate through all atlases in the registry
                for (const [atlasId, layers] of atlasLayers.entries()) {
                    if (Array.isArray(layers)) {
                        layers.forEach(layer => {
                            // Check if this layer has basemap tag (check original config, not prefixed)
                            if (hasBasemapTag(layer)) {
                                // Get the layer ID - could be prefixed or not
                                const layerId = layer.id;

                                // Try to get the full resolved layer config from registry
                                // First try with atlas prefix, then without
                                let fullLayerConfig = null;
                                const prefixedId = `${atlasId}-${layerId}`;

                                // Try prefixed ID first
                                if (window.layerRegistry.getLayer) {
                                    fullLayerConfig = window.layerRegistry.getLayer(prefixedId) ||
                                        window.layerRegistry.getLayer(layerId);
                                }

                                // Fallback to original layer config if registry lookup fails
                                fullLayerConfig = fullLayerConfig || layer;

                                // Process the basemap layer
                                processBasemapLayer(fullLayerConfig);
                            }
                        });
                    }
                }
            }
        }

        // Strategy 4: Direct check of map style layers for basemap layers
        // This is a fallback to catch basemap layers that might not be in config/registry
        // Check for common basemap layer IDs directly on the map
        if (this._map) {
            try {
                const style = this._map.getStyle();
                if (style && style.layers) {
                    // Common basemap layer IDs to check
                    const commonBasemapIds = ['satellite', 'gebco-bathymetry'];

                    commonBasemapIds.forEach(basemapId => {
                        const styleLayer = style.layers.find(l => l.id === basemapId);
                        if (styleLayer && !basemapLayerIds.includes(basemapId)) {
                            basemapLayerIds.push(basemapId);
                        }
                    });
                }
            } catch (error) {
                // Silently handle errors
            }
        }

        // Remove duplicates and return unique basemap layer IDs
        const uniqueBasemapIds = [...new Set(basemapLayerIds)];

        return uniqueBasemapIds;
    }

    /**
     * Apply opacity effect to layer details UI elements when a layer is isolated
     * Sets opacity to 0.3 and grayscale for all layer details except the hovered one
     */
    _applyLayerDetailsOpacityEffect(hoveredLayerId) {
        if (!this._layersContainer) return;

        // Get all layer card elements
        const layerDetailsElements = this._layersContainer.querySelectorAll('.layer-card');

        layerDetailsElements.forEach(element => {
            const elementLayerId = element.getAttribute('data-layer-id');

            if (elementLayerId !== hoveredLayerId) {
                // Set opacity to 0.3 and grayscale for non-hovered layers with smooth transition
                element.style.transition = 'opacity 0.2s ease-in-out, filter 0.2s ease-in-out';
                element.style.opacity = '0.3';
                element.style.filter = 'grayscale(100%)';
            } else {
                // Ensure hovered layer stays fully opaque and colored
                element.style.transition = 'opacity 0.2s ease-in-out, filter 0.2s ease-in-out';
                element.style.opacity = '1';
                element.style.filter = 'none';
            }
        });

    }

    /**
     * Restore opacity of all layer details UI elements to full opacity
     */
    _restoreLayerDetailsOpacity() {
        if (!this._layersContainer) return;

        // Get all layer card elements
        const layerDetailsElements = this._layersContainer.querySelectorAll('.layer-card');

        layerDetailsElements.forEach(element => {
            // Restore full opacity and color with smooth transition
            element.style.transition = 'opacity 0.2s ease-in-out, filter 0.2s ease-in-out';
            element.style.opacity = '1';
            element.style.filter = 'none';
        });

    }

    /**
     * Handle window resize and orientation changes to update responsive height
     */
    _handleResize() {
        if (!this._container) return;

        // Calculate new responsive max height based on current screen height
        const screenHeight = window.innerHeight;
        const maxHeightValue = this.options.maxHeight;

        // Handle both pixel and viewport height values
        let responsiveMaxHeight;
        if (maxHeightValue.includes('vh')) {
            // Extract viewport height percentage
            const vhPercentage = parseFloat(maxHeightValue) / 100;
            responsiveMaxHeight = screenHeight * vhPercentage;
        } else {
            // Handle pixel values
            const pixelValue = parseInt(maxHeightValue);
            responsiveMaxHeight = Math.min(screenHeight * 0.5, pixelValue);
        }

        // Update container max height
        this._container.style.maxHeight = `${responsiveMaxHeight}px`;

        // Update layers container max height
        if (this._layersContainer) {
            this._layersContainer.style.maxHeight = `calc(50vh - 90px)`;
        }

    }
}
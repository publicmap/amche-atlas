/**
 * MapLayerControl - UI control for managing map layers using MapboxAPI abstraction
 *
 * This refactored version delegates all Mapbox-specific operations to the MapboxAPI class,
 * keeping this class focused on UI management and configuration handling.
 */
import { LayerSettingsModal } from './layer-settings-modal.js';
import { MapboxAPI } from './mapbox-api.js';
import { deepMerge } from './map-utils.js';

export class MapLayerControl {
    constructor(options) {
        // Handle options structure for groups and configuration
        if (Array.isArray(options)) {
            this._state = { groups: options };
            this._config = {};
        } else if (options && options.groups) {
            this._state = { groups: options.groups };
            this._config = options;
        } else {
            this._state = { groups: [options] };
            this._config = {};
        }


        this._domCache = {};
        this._instanceId = (MapLayerControl.instances || 0) + 1;
        MapLayerControl.instances = this._instanceId;
        this._initialized = false;
        this._sourceControls = [];
        this._editMode = false;

        // Cache for loaded legend images to avoid reloading
        this._legendImageCache = new Map();

        // Global click handler tracking
        this._globalClickHandlerAdded = false;

        // MapboxAPI instance will be initialized when map is available
        this._mapboxAPI = null;

        // Initialize default styles (will be populated by _loadDefaultStyles)
        this._defaultStyles = {};

        // Initialize UI components
        this._initializeEditMode();
        this._initializeShareLink();
        this._layerSettingsModal = null;
        this._stateManager = null;

        // Load default styles asynchronously
        this._loadDefaultStyles();
    }

    /**
     * Initialize the control with map and container
     */
    async renderToContainer(container, map) {
        this._container = container;
        this._map = map;

        // Make sure default styles are loaded BEFORE creating MapboxAPI
        await this._ensureDefaultStylesLoaded();

        // Initialize MapboxAPI with the map and atlas configuration
        this._mapboxAPI = new MapboxAPI(map, {
            styles: this._defaultStyles,
            orderedGroups: this._state.groups
        });

        // Initialize layer settings modal
        this._layerSettingsModal = new LayerSettingsModal(this);

        // Add global click handler early
        this._addGlobalClickHandler();

        // Add drawer focus management to prevent aria-hidden accessibility issues
        this._setupDrawerFocusManagement();

        // Initialize the control UI
        if (this._map.isStyleLoaded()) {
            this._initializeControl($(container));
            this._initializeFilterControls();
        } else {
            // Add a fallback timeout in case style.load event doesn't fire
            // This can happen when map.isStyleLoaded() returns false even though the style is loaded
            const fallbackTimeout = setTimeout(() => {
                if (this._map.getStyle()) {
                    console.debug('[MapLayerControl] Style appears to be loaded despite isStyleLoaded() returning false, initializing control');
                    this._initializeControl($(container));
                    this._initializeFilterControls();
                }
            }, 1000);

            this._map.on('style.load', () => {
                clearTimeout(fallbackTimeout);
                this._initializeControl($(container));
                this._initializeFilterControls();
            });
        }

        $(container).append($('<div>', { class: 'layer-control' }));
    }

    /**
     * Load default styles configuration
     */
    async _loadDefaultStyles() {
        try {
            const defaultsResponse = await fetch('/config/_defaults.json');
            const configResponse = await fetch(window.amche.DEFAULT_ATLAS);

            if (!defaultsResponse.ok || !configResponse.ok) {
                throw new Error('Failed to load configuration files');
            }

            const defaults = await defaultsResponse.json();
            const config = await configResponse.json();

            // Extract styles from defaults configuration
            if (defaults.layer && defaults.layer.style) {
                this._defaultStyles = defaults.layer.style || {};
            } else if (defaults.style) {
                this._defaultStyles = defaults.style || {};
            } else if (defaults.styles) {
                this._defaultStyles = defaults.styles || {};
            } else {
                console.warn('Could not find styles in defaults structure:', Object.keys(defaults));
                this._defaultStyles = {};
            }

            // Ensure _defaultStyles is never null or undefined
            if (!this._defaultStyles || typeof this._defaultStyles !== 'object') {
                this._defaultStyles = {};
            }

            // Merge with config overrides
            if (config.styles) {
                const merged = deepMerge(config.styles, this._defaultStyles);
                this._defaultStyles = merged || {};
            }

        } catch (error) {
            console.error('Error loading default styles:', error);
            this._defaultStyles = this._getFallbackStyles();
        }
    }

    /**
     * Get fallback default styles if loading fails
     */
    _getFallbackStyles() {
        return {
            vector: {
                fill: { 'fill-color': '#000000', 'fill-opacity': 0.5 },
                line: { 'line-color': '#000000', 'line-width': 1 },
                text: { 'text-color': '#000000', 'text-halo-width': 1 },
                circle: { 'circle-radius': 5, 'circle-color': '#000000' }
            },
            raster: { 'raster-opacity': 1 }
        };
    }

    /**
     * Ensure default styles are loaded
     */
    async _ensureDefaultStylesLoaded() {
        // Ensure _defaultStyles exists and has content
        if (this._defaultStyles && typeof this._defaultStyles === 'object' && Object.keys(this._defaultStyles).length > 0) {
            return;
        }
        await this._loadDefaultStyles();
    }

    /**
     * Update state with new configuration
     */
    _updateState(newState) {
        this._state = {
            ...this._state,
            groups: newState.groups.map(newGroup => {
                const existingGroup = this._state.groups.find(g => g.id === newGroup.id);
                return existingGroup ? { ...existingGroup, ...newGroup } : newGroup;
            })
        };

        // Update the ordered groups in MapboxAPI
        if (this._mapboxAPI) {
            this._mapboxAPI._orderedGroups = this._state.groups;
        }

        this._cleanupLayers();
        this._rebuildUI();
    }

    /**
     * Clean up existing layers using MapboxAPI
     */
    _cleanupLayers() {
        if (!this._mapboxAPI) return;


        // Remove all custom layers and sources using MapboxAPI
        this._state.groups.forEach(group => {
            this._mapboxAPI.removeLayerGroup(group.id, group);
        });
    }

    /**
     * Rebuild the UI
     */
    _rebuildUI() {
        if (this._container) {
            this._container.innerHTML = '';
            this._sourceControls = [];
            this._initializeControl($(this._container));
        }
    }

    /**
     * Load external configuration
     */
    async loadExternalConfig(url) {
        try {
            const response = await fetch(url);
            const configText = await response.text();

            let config;
            let fullConfig;

            // Handle JS or JSON format
            if (configText.trim().startsWith('let') || configText.trim().startsWith('const')) {
                const extractConfig = new Function(`
                    ${configText}
                    return layers;
                `);
                config = extractConfig();
            } else {
                fullConfig = JSON.parse(configText);
                config = fullConfig.layers && Array.isArray(fullConfig.layers) ?
                    fullConfig.layers : fullConfig;
            }

            this._updateState({ groups: config });

        } catch (error) {
            console.error('Error loading external config:', error);
            alert('Failed to load external configuration. Please check the console for details.');
            throw error;
        }
    }

    /**
     * Initialize the main control UI
     */
    _initializeControl($container) {
        // Add current atlas layers
        this._state.groups.forEach((group, groupIndex) => {
            const $groupHeader = this._createGroupHeader(group, groupIndex);
            $container.append($groupHeader);
        });

        // Initialize all layers explicitly after UI is set up
        this._initializeAllLayers();

        if (!this._initialized) {
            this._initializeWithAnimation();
        }
    }

    /**
     * Initialize all layers to their proper visibility states
     */
    _initializeAllLayers() {
        this._state.groups.forEach((group, groupIndex) => {
            // Initialize the layer state using MapboxAPI
            // For all layers, explicitly set their initial visibility state
            if (group.initiallyChecked) {
                requestAnimationFrame(() => {
                    this._toggleLayerGroup(groupIndex, true);
                });
            } else {
                // Explicitly hide layers that should not be visible initially
                // This is especially important for style layers which are visible by default
                // For style layers, we need to ensure the map style is loaded before hiding
                const shouldDelay = group.type === 'style' && !this._map.getStyle();

                if (shouldDelay) {
                    // Wait for style to load before hiding style layers
                    this._map.once('style.load', () => {
                        requestAnimationFrame(() => {
                            this._toggleLayerGroup(groupIndex, false);
                        });
                    });
                } else {
                    requestAnimationFrame(() => {
                        this._toggleLayerGroup(groupIndex, false);
                    });
                }
            }
        });
    }

    /**
     * Create group header UI element
     */
    _createGroupHeader(group, groupIndex) {
        const $groupHeader = $('<sl-details>', {
            class: 'group-header w-full map-controls-group',
            open: group.initiallyChecked || false
        });

        $groupHeader.attr('data-layer-id', group.id);
        this._sourceControls[groupIndex] = $groupHeader[0];

        // Set up event handlers
        this._setupGroupHeaderEvents($groupHeader, group, groupIndex);

        // Create summary section
        const $summary = this._createGroupSummary(group);
        $groupHeader.append($summary);

        // Add description and attribution
        this._addGroupMetadata($groupHeader, group);

        // Add type-specific content
        this._addTypeSpecificContent($groupHeader, group, groupIndex);

        // If layer is initially checked and expanded, load legend image immediately
        if (group.initiallyChecked && group.legendImage) {
            // Use setTimeout to ensure DOM is fully ready
            setTimeout(() => {
                this._loadLegendImageIfNeeded($groupHeader[0], group.legendImage);
            }, 100);
        }

        return $groupHeader;
    }



    /**
     * Set up group header event handlers
     */
    _setupGroupHeaderEvents($groupHeader, group, groupIndex) {
        $groupHeader[0].addEventListener('sl-show', (event) => {
            this._handleGroupShow(event, group, groupIndex);

            // Load legend image when details panel is expanded (if layer is enabled)
            const toggleInput = event.target.querySelector('.toggle-switch input[type="checkbox"]');
            if (toggleInput && toggleInput.checked && group.legendImage) {
                this._loadLegendImageIfNeeded(event.target, group.legendImage);
            }
        });

        $groupHeader[0].addEventListener('sl-hide', (event) => {
            this._handleGroupHide(event, group, groupIndex);
        });
    }

    /**
     * Handle group show event
     */
    _handleGroupShow(event, group, groupIndex) {
        const toggleInput = event.target.querySelector('.toggle-switch input[type="checkbox"]');

        if (toggleInput && !toggleInput.checked) {
            toggleInput.checked = true;
        }

        // For style layers, sync sublayer states
        if (group.type === 'style' && group.layers) {
            this._syncStyleLayerSubToggles(event.target, group, true);
        }

        // Determine if this is a cross-atlas layer
        const isCrossAtlas = $(event.target).hasClass('cross-atlas-layer');
        const effectiveGroupIndex = isCrossAtlas ? -1 : groupIndex;

        this._toggleLayerGroup(effectiveGroupIndex, true);

        $(event.target).closest('.group-header').addClass('active');

        // Load legend image if it exists and hasn't been loaded yet
        this._loadLegendImageIfNeeded(event.target, group.legendImage);

        // Dispatch custom event for URL sync
        console.log('🔗 LayerControl: Dispatching layer-toggled event (show)', {
            layerId: group.id,
            visible: true,
            isCrossAtlas: isCrossAtlas
        });
        window.dispatchEvent(new CustomEvent('layer-toggled', {
            detail: { layerId: group.id, visible: true, isCrossAtlas: isCrossAtlas }
        }));

        // Auto-collapse the drawer when a layer is toggled on
        if (drawerStateManager && drawerStateManager.isOpen()) {
            drawerStateManager.close();
        }
    }

    /**
     * Handle group hide event
     */
    _handleGroupHide(event, group, groupIndex) {
        const toggleInput = event.target.querySelector('.toggle-switch input[type="checkbox"]');

        if (toggleInput && toggleInput.checked) {
            toggleInput.checked = false;
        }

        // For style layers, sync sublayer states
        if (group.type === 'style' && group.layers) {
            this._syncStyleLayerSubToggles(event.target, group, false);
        }

        // Determine if this is a cross-atlas layer
        const isCrossAtlas = $(event.target).hasClass('cross-atlas-layer');
        const effectiveGroupIndex = isCrossAtlas ? -1 : groupIndex;

        this._toggleLayerGroup(effectiveGroupIndex, false);

        $(event.target).closest('.group-header').removeClass('active');

        // Dispatch custom event for URL sync
        console.log('🔗 LayerControl: Dispatching layer-toggled event (hide)', {
            layerId: group.id,
            visible: false,
            isCrossAtlas: isCrossAtlas
        });
        window.dispatchEvent(new CustomEvent('layer-toggled', {
            detail: { layerId: group.id, visible: false, isCrossAtlas: isCrossAtlas }
        }));
    }



    /**
     * Sync sublayer toggle states for style layers
     */
    _syncStyleLayerSubToggles(groupElement, group, isVisible) {
        const $sublayerToggles = $(groupElement).find('.layer-controls .toggle-switch input[type="checkbox"]');

        if (isVisible) {
            // When showing, set sublayer toggles to match actual layer visibility
            $sublayerToggles.each((index, toggle) => {
                const layer = group.layers[index];
                if (layer) {
                    const actualVisibility = this._getStyleLayerVisibility(layer);
                    $(toggle).prop('checked', actualVisibility);
                }
            });
        } else {
            // When hiding, turn off all sublayer toggles and hide the layers
            $sublayerToggles.prop('checked', false);
            group.layers.forEach(layer => {
                this._handleStyleLayerToggle(layer, false);
            });
        }
    }

    /**
     * Toggle layer group visibility using MapboxAPI
     */
    async _toggleLayerGroup(groupIndex, visible) {
        let group;

        // Handle cross-atlas layers (groupIndex = -1)
        if (groupIndex === -1) {
            // For cross-atlas layers, we need to find the group by the element that triggered this
            const activeElement = document.activeElement;
            const groupElement = activeElement ? activeElement.closest('.group-header') : null;
            if (groupElement) {
                const groupId = groupElement.getAttribute('data-layer-id');
                group = this._allAtlasLayers.find(layer => layer.id === groupId);
            }
            if (!group) {
                console.warn('Could not find cross-atlas layer group');
                return;
            }
        } else {
            group = this._state.groups[groupIndex];
        }

        if (!this._mapboxAPI) {
            console.warn('MapboxAPI not initialized');
            return;
        }

        try {
            // If type is missing, try to resolve it from the registry
            if (!group.type && group.id && window.layerRegistry) {
                const resolvedLayer = window.layerRegistry.getLayer(group.id);
                if (resolvedLayer && resolvedLayer.type) {
                    console.warn(`[MapLayerControl] Resolved missing type for layer ${group.id} from registry: ${resolvedLayer.type}`);
                    group = { ...group, type: resolvedLayer.type };
                    // Update the group in state so we don't have to resolve it again
                    const stateGroupIndex = this._state.groups.findIndex(g => g.id === group.id);
                    if (stateGroupIndex !== -1) {
                        this._state.groups[stateGroupIndex] = group;
                    }
                }
            }

            // Validate that group has required properties
            if (!group.type) {
                console.error(`[MapLayerControl] Cannot toggle layer ${group.id} - missing type property. This usually indicates a registry resolution issue.`);
                return;
            }

            if (visible) {
                // Create or show the layer group
                await this._mapboxAPI.createLayerGroup(group.id, group, { visible: true });

                // Apply initial opacity from config if it exists
                // Note: Pass 1.0 as the opacity value so the multiplier logic in mapbox-api.js
                // correctly applies config.opacity (e.g., 1.0 * 0.44 = 0.44)
                if (group.opacity !== undefined && group.opacity !== 1) {
                    this._mapboxAPI.updateLayerOpacity(group.id, group, 1.0);
                }

                // For style layers, ensure sublayers are properly synchronized
                if (group.type === 'style' && group.layers) {
                    // Find the group header element to sync sublayer toggles
                    const groupElement = this._container.querySelector(`[data-layer-id="${group.id}"]`);
                    if (groupElement) {
                        // Use a small delay to ensure the main layer is fully processed
                        setTimeout(() => {
                            this._syncStyleLayerSubToggles(groupElement, group, true);
                        }, 50);
                    }
                }

                // Register with state manager if available
                if (this._stateManager) {
                    this._registerLayerWithStateManager(group);
                }

                // Update attribution after layer is added
                if (window.attributionControl) {
                    window.attributionControl._updateAttribution();
                }
            } else {
                // Hide the layer group
                this._mapboxAPI.updateLayerGroupVisibility(group.id, group, false);

                // Unregister with state manager if available
                if (this._stateManager) {
                    this._unregisterLayerWithStateManager(group.id);
                }

                // Update attribution after layer is removed (with small delay to ensure layer is fully removed)
                setTimeout(() => {
                    if (window.attributionControl) {
                        window.attributionControl._updateAttribution();
                    } else {
                        console.warn('[LayerControl] Attribution control not available');
                    }
                }, 50);
            }
        } catch (error) {
            console.error(`Error toggling layer group ${group.id}:`, error);
        }
    }

    /**
     * Get atlas ID for a layer
     */
    _getAtlasIdForLayer(group) {
        // First check if group already has _sourceAtlas set
        if (group._sourceAtlas) {
            return group._sourceAtlas;
        }

        // Try to get from layer registry
        if (window.layerRegistry) {
            const resolvedLayer = window.layerRegistry.getLayer(group.id);

            if (resolvedLayer && resolvedLayer._sourceAtlas) {
                return resolvedLayer._sourceAtlas;
            }
        }

        return null;
    }

    /**
     * Create group summary section
     */
    _createGroupSummary(group) {
        const $summary = $('<div>', {
            slot: 'summary',
            class: 'flex items-center relative w-full h-12 bg-gray-800'
        });

        const $contentWrapper = $('<div>', {
            class: 'flex items-center gap-2 relative z-10 w-full p-2'
        });

        const $toggleTitleContainer = this._createToggleTitle(group);
        $contentWrapper.append($toggleTitleContainer);

        // Add atlas badge (right-aligned)
        const atlasId = this._getAtlasIdForLayer(group);
        if (atlasId) {
            // Capitalize first letter
            const displayName = atlasId.charAt(0).toUpperCase() + atlasId.slice(1);

            // Get color from registry, fallback to blue-600 if not available
            let badgeColor = '#2563eb'; // Default blue
            if (window.layerRegistry) {
                badgeColor = window.layerRegistry.getAtlasColor(atlasId);
            }

            const $atlasBadge = $('<span>', {
                class: 'text-xs text-white px-2 py-1 rounded ml-auto cursor-pointer hover:opacity-80 transition-opacity',
                style: `background-color: ${badgeColor};`,
                text: displayName,
                title: `Switch to ${displayName} atlas`
            });

            // Make badge clickable to navigate to atlas
            $atlasBadge.on('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._navigateToAtlas(atlasId);
            });

            $contentWrapper.append($atlasBadge);
        }

        // If headerImage is missing, try to resolve from registry
        let headerImage = group.headerImage;
        if (!headerImage && group.id && window.layerRegistry) {
            const resolvedLayer = window.layerRegistry.getLayer(group.id);
            if (resolvedLayer && resolvedLayer.headerImage) {
                headerImage = resolvedLayer.headerImage;
            }
        }

        // Add header background if exists
        if (headerImage) {
            const $headerBg = $('<div>', {
                class: 'absolute top-0 left-0 right-0 w-full h-full bg-cover bg-center bg-no-repeat',
                style: `background-image: url('${headerImage}')`
            });

            const $headerOverlay = $('<div>', {
                class: 'absolute top-0 left-0 right-0 w-full h-full bg-black bg-opacity-40',
                style: 'opacity:0.4'
            });

            $summary.append($headerBg, $headerOverlay, $contentWrapper);
        } else {
            $summary.append($contentWrapper);
        }

        return $summary;
    }

    /**
     * Create toggle title section
     */
    _createToggleTitle(group) {
        const $toggleLabel = $('<label>', { class: 'toggle-switch' });
        const $toggleInput = $('<input>', {
            type: 'checkbox',
            checked: group.initiallyChecked || false
        });
        const $toggleSlider = $('<span>', { class: 'toggle-slider' });

        $toggleLabel.append($toggleInput, $toggleSlider);

        // If no title, try to resolve from registry
        let title = group.title;
        if (!title && group.id && window.layerRegistry) {
            const resolvedLayer = window.layerRegistry.getLayer(group.id);
            if (resolvedLayer && resolvedLayer.title) {
                title = resolvedLayer.title;
                console.warn(`[MapLayerControl] Had to resolve title for ${group.id} from registry: ${title}`);
            }
        }

        const $titleSpan = $('<span>', {
            text: title || group.id || 'Unknown Layer',
            class: 'control-title text-sm font-medium font-bold text-white'
        });

        const $toggleTitleContainer = $('<div>', {
            class: 'flex items-center gap-2 cursor-pointer'
        });

        $toggleTitleContainer.append($toggleLabel, $titleSpan);
        return $toggleTitleContainer;
    }

    /**
     * Add group metadata (description, attribution)
     */
    _addGroupMetadata($groupHeader, group) {
        // If metadata is missing, try to resolve from registry
        let description = group.description;
        let attribution = group.attribution;

        if ((!description || !attribution) && group.id && window.layerRegistry) {
            const resolvedLayer = window.layerRegistry.getLayer(group.id);
            if (resolvedLayer) {
                description = description || resolvedLayer.description;
                attribution = attribution || resolvedLayer.attribution;
            }
        }

        if (description || attribution) {
            const $contentArea = $('<div>', { class: 'description-area' });

            if (description) {
                const $description = $('<div>', {
                    class: 'text-sm layer-description',
                    html: description
                });
                $contentArea.append($description);
            }

            if (attribution) {
                const $attribution = $('<div>', {
                    class: 'layer-attribution',
                    html: `Source: ${attribution.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ')}`
                });
                $contentArea.append($attribution);
            }

            $groupHeader.append($contentArea);
        }
    }

    /**
     * Add type-specific content
     */
    _addTypeSpecificContent($groupHeader, group, groupIndex) {
        switch (group.type) {
            case 'layer-group':
                this._addLayerGroupContent($groupHeader, group);
                break;
            case 'style':
                this._addStyleLayerContent($groupHeader, group);
                break;

            default:
                // Most layer types don't need special content
                break;
        }

        // Add legend container if available (but don't load image yet)
        if (group.legendImage) {
            const $legendContainer = $('<div>', {
                class: 'legend-container',
                'data-legend-url': group.legendImage,
                'data-legend-loaded': 'false'
            });
            $groupHeader.append($legendContainer);
        }
    }

    /**
     * Add layer group specific content
     */
    _addLayerGroupContent($groupHeader, group) {
        if (!group.groups) return;

        const $radioGroup = $('<div>', { class: 'radio-group mt-2' });

        group.groups.forEach((subGroup, index) => {
            const $radioLabel = this._createRadioOption(subGroup, group, index);
            $radioGroup.append($radioLabel);
        });

        const $contentArea = $('<div>');
        $contentArea.append($radioGroup);
        $groupHeader.append($contentArea);
    }

    /**
     * Create radio option for layer groups
     */
    _createRadioOption(subGroup, parentGroup, index) {
        const $radioLabel = $('<label>', { class: 'radio-label' });
        const $radio = $('<input>', {
            type: 'radio',
            name: `layer-group-${this._instanceId}-${parentGroup.id}`,
            value: subGroup.id,
            checked: index === 0
        });

        $radio.on('change', () => {
            this._handleLayerGroupChange(subGroup.id, parentGroup.groups);
        });

        $radioLabel.append(
            $radio,
            $('<span>', { text: subGroup.title })
        );

        // Add attribution and location links
        if (subGroup.attribution || subGroup.location) {
            const links = [];
            if (subGroup.attribution) {
                links.push(`<a href="${subGroup.attribution}" target="_blank" class="hover:underline">Source</a>`);
            }
            if (subGroup.location) {
                links.push(`<a href="#" class="hover:underline view-link" data-location="${subGroup.location}">View</a>`);
            }

            const $infoDiv = $('<div>', {
                class: 'layer-info text-xs pl-5',
                html: links.join(' | ')
            });

            $infoDiv.find('.view-link').on('click', (e) => {
                e.preventDefault();
                this._flyToLocation(subGroup.location);
            });

            $radioLabel.append($infoDiv);
        }

        return $radioLabel;
    }

    /**
     * Handle layer group change using MapboxAPI
     */
    _handleLayerGroupChange(selectedId, groups) {
        if (!this._mapboxAPI) return;

        // Hide all layers in the group
        groups.forEach(group => {
            this._mapboxAPI.updateLayerGroupVisibility(group.id, group, false);
        });

        // Show selected layer
        const selectedGroup = groups.find(g => g.id === selectedId);
        if (selectedGroup) {
            this._mapboxAPI.updateLayerGroupVisibility(selectedGroup.id, selectedGroup, true);
        }
    }

    /**
     * Add style layer specific content
     */
    _addStyleLayerContent($groupHeader, group) {
        if (!group.layers) return;

        const $layerControls = $('<div>', { class: 'layer-controls mt-3' });

        group.layers.forEach((layer, index) => {
            const $layerControl = this._createStyleLayerControl(layer, group, index);
            $layerControls.append($layerControl);
        });

        $groupHeader.append($layerControls);
    }

    /**
     * Create style layer control
     */
    _createStyleLayerControl(layer, parentGroup, index) {
        const layerId = `sublayer-${parentGroup.id}-${index}`;
        const $layerControl = $('<div>', { class: 'flex items-center gap-2 text-black' });

        const $sublayerToggleLabel = $('<label>', { class: 'toggle-switch' });

        // Check actual layer visibility instead of just parentGroup.initiallyChecked
        const isLayerVisible = this._getStyleLayerVisibility(layer);

        const $sublayerToggleInput = $('<input>', {
            type: 'checkbox',
            id: layerId,
            checked: isLayerVisible
        });
        const $sublayerToggleSlider = $('<span>', { class: 'toggle-slider' });

        $sublayerToggleLabel.append($sublayerToggleInput, $sublayerToggleSlider);

        $sublayerToggleInput.on('change', (e) => {
            this._handleStyleLayerToggle(layer, e.target.checked);
        });

        const $label = $('<label>', {
            for: layerId,
            class: 'text-sm cursor-pointer flex-grow'
        }).text(layer.title);

        $layerControl.append($sublayerToggleLabel, $label);
        return $layerControl;
    }

    /**
     * Get the visibility state of a style layer
     */
    _getStyleLayerVisibility(layer) {
        if (!this._map || !layer.sourceLayer) return false;

        try {
            const styleLayers = this._map.getStyle().layers;
            const matchingLayers = styleLayers.filter(styleLayer =>
                styleLayer['source-layer'] === layer.sourceLayer
            );

            // If any matching layer is visible, consider the layer visible
            return matchingLayers.some(styleLayer => {
                const layerVisibility = this._map.getLayoutProperty(styleLayer.id, 'visibility');
                return layerVisibility !== 'none';
            });
        } catch (error) {
            console.warn('Error checking style layer visibility:', error);
            return false;
        }
    }

    /**
     * Handle style layer toggle
     */
    _handleStyleLayerToggle(layer, isChecked) {
        const styleLayers = this._map.getStyle().layers;
        const layersToToggle = styleLayers
            .filter(styleLayer => styleLayer['source-layer'] === layer.sourceLayer)
            .map(styleLayer => styleLayer.id);

        layersToToggle.forEach(layerId => {
            if (this._map.getLayer(layerId)) {
                this._map.setLayoutProperty(
                    layerId,
                    'visibility',
                    isChecked ? 'visible' : 'none'
                );
            }
        });
    }

    /**
     * Add terrain specific content
     */


    /**
     * Create terrain controls (simplified version)
     */
    _createTerrainControls() {
        const $controlsContainer = $('<div>', { class: 'terrain-controls' });

        // Add exaggeration slider
        const $exaggerationSlider = $('<input>', {
            type: 'range',
            min: '0',
            max: '10',
            step: '0.2',
            value: '1.5',
            class: 'w-full'
        });

        const $exaggerationValue = $('<span>', {
            class: 'text-sm text-gray-600 ml-2',
            text: '1.5x'
        });

        $exaggerationSlider.on('input', (e) => {
            const value = parseFloat(e.target.value);
            $exaggerationValue.text(`${value}x`);
            if (this._map.getTerrain()) {
                this._map.setTerrain({
                    'source': 'mapbox-dem',
                    'exaggeration': value
                });
            }
        });

        $controlsContainer.append(
            $('<label>', { class: 'block text-sm text-gray-700 mb-1', text: 'Terrain Exaggeration' }),
            $('<div>', { class: 'flex items-center' }).append($exaggerationSlider, $exaggerationValue)
        );

        return $controlsContainer;
    }

    /**
     * Load legend image on-demand when layer is enabled and expanded
     */
    _loadLegendImageIfNeeded(groupElement, legendImageUrl) {
        if (!legendImageUrl || !groupElement) return;

        const $legendContainer = $(groupElement).find('.legend-container');
        if ($legendContainer.length === 0) return;

        // Check if already loaded
        const isLoaded = $legendContainer.attr('data-legend-loaded') === 'true';
        if (isLoaded) return;

        // Check if image is cached
        if (this._legendImageCache.has(legendImageUrl)) {
            const cachedContent = this._legendImageCache.get(legendImageUrl);
            $legendContainer.html(cachedContent);
            $legendContainer.attr('data-legend-loaded', 'true');
            return;
        }

        // Render and cache the legend image
        const legendContent = this._renderLegendImage(legendImageUrl);
        $legendContainer.html(legendContent);
        $legendContainer.attr('data-legend-loaded', 'true');

        // Cache the content for future use
        this._legendImageCache.set(legendImageUrl, legendContent);
    }

    /**
     * Render legend image (PDF or regular image)
     */
    _renderLegendImage(legendImageUrl) {
        if (!legendImageUrl) return '';

        if (legendImageUrl.toLowerCase().endsWith('.pdf')) {
            return `
                <div class="legend-pdf-container">
                    <a href="${legendImageUrl}" target="_blank" class="pdf-legend-link">
                        <sl-icon name="file-earmark-pdf" style="color: red; font-size: 1.5rem;"></sl-icon>
                        <span>View Legend PDF</span>
                    </a>
                </div>
            `;
        } else {
            // Use loading="lazy" for better performance, but still load when needed
            return `<img src="${legendImageUrl}" alt="Legend" class="legend-image" loading="lazy">`;
        }
    }

    /**
     * Initialize with animation
     */
    _initializeWithAnimation() {
        const allToggles = this._container.querySelectorAll('.group-header .toggle-switch input[type="checkbox"]');
        const groupHeaders = Array.from(allToggles).filter(toggle =>
            !toggle.closest('.layer-controls')
        );

        groupHeaders.forEach((toggleInput, index) => {
            const group = this._state.groups[index];
            const shouldBeChecked = group?.initiallyChecked ?? false;
            toggleInput.checked = shouldBeChecked;

            void toggleInput.offsetHeight;
            const toggleSlider = toggleInput.nextElementSibling;
            if (toggleSlider && toggleSlider.classList.contains('toggle-slider')) {
                void toggleSlider.offsetHeight;
            }

            toggleInput.dispatchEvent(new Event('change'));
        });

        if (!this._initialized) {
            this._container.classList.add('no-transition');
            void this._container.offsetWidth;
            this._container.classList.remove('no-transition');
            this._initialized = true;
        }

        requestAnimationFrame(() => {
            this._container.classList.add('collapsed');
        });
    }

    /**
     * Fly to location using geocoding
     */
    async _flyToLocation(location) {
        try {
            const response = await fetch(
                `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(location)}.json?access_token=${mapboxgl.accessToken}&country=in`
            );
            const data = await response.json();

            if (data.features && data.features.length > 0) {
                const [lng, lat] = data.features[0].center;
                this._map.flyTo({
                    center: [lng, lat],
                    zoom: 12,
                    duration: 2000
                });
            }
        } catch (error) {
            console.error('Error flying to location:', error);
        }
    }

    /**
     * Toggle control visibility
     */
    toggleControl() {
        requestAnimationFrame(() => {
            this._container.classList.toggle('collapsed');
        });
        this._toggleButton.classList.toggle('is-open');
    }

    /**
     * Set state manager reference
     */
    setStateManager(stateManager) {
        this._stateManager = stateManager;
        // Register all active layers immediately
        this._registerAllActiveLayers();
    }

    /**
     * Register all active layers with state manager
     */
    _registerAllActiveLayers() {
        if (!this._stateManager) return;

        this._state.groups.forEach(group => {
            if (group.initiallyChecked) {
                this._registerLayerWithStateManager(group);
            }
        });
    }

    /**
     * Register layer with state manager
     */
    _registerLayerWithStateManager(layerConfig) {
        if (!this._stateManager) return;

        // Register layer attribution if available
        // We do this BEFORE potentially skipping style layers for state management
        if (layerConfig.attribution && window.attributionControl) {
            if (layerConfig.type === 'style' || layerConfig.type === 'raster-style-layer') {
                // For style layers, we need to register attribution for all actual map layers
                // This ensures attribution shows up even if the config ID doesn't match the style ID
                if (this._mapboxAPI) {
                    const layerIds = this._mapboxAPI.getLayerGroupIds(layerConfig.id, layerConfig);
                    console.log(`[Attribution Debug] Layer ${layerConfig.id} (${layerConfig.type}) resolved to IDs:`, layerIds);
                    layerIds.forEach(id => {
                        console.log(`[Attribution Debug] Registering attribution for ${id}: ${layerConfig.attribution}`);
                        window.attributionControl.addLayerAttribution(id, layerConfig.attribution);
                    });
                }
            } else {
                // Standard registration for other layer types
                window.attributionControl.addLayerAttribution(layerConfig.id, layerConfig.attribution);
            }
        }

        // Skip style layers as they don't have their own sources/features
        if (layerConfig.type === 'style') {
            return;
        }

        // Skip layers without a type - they can't be properly handled
        if (!layerConfig.type) {
            console.warn(`[MapLayerControl] Skipping state manager registration for layer ${layerConfig.id} - missing type property`);
            return;
        }

        // Register the layer - MapFeatureStateManager will handle raster vs vector distinction
        this._stateManager.registerLayer(layerConfig);
    }

    /**
     * Unregister layer with state manager
     */
    _unregisterLayerWithStateManager(layerId) {
        if (this._stateManager) {
            this._stateManager.unregisterLayer(layerId);
        }

        // Remove layer attribution
        if (window.attributionControl) {
            // Check if we need to remove attribution for multiple layer IDs (style layers)
            // We need to look up the group from state to know the type
            const group = this._state.groups.find(g => g.id === layerId);

            if (group && (group.type === 'style' || group.type === 'raster-style-layer') && this._mapboxAPI) {
                const layerIds = this._mapboxAPI.getLayerGroupIds(layerId, group);
                layerIds.forEach(id => {
                    window.attributionControl.removeLayerAttribution(id);
                });
            } else {
                window.attributionControl.removeLayerAttribution(layerId);
            }
        }
    }

    /**
     * Save layer settings
     */
    _saveLayerSettingsInternal(newConfig) {
        try {
            const groupIndex = this._state.groups.findIndex(g => g.id === newConfig.id);
            if (groupIndex === -1) {
                throw new Error('Could not find layer configuration to update');
            }

            const newGroups = [...this._state.groups];
            newGroups[groupIndex] = newConfig;

            this._updateState({ groups: newGroups });
        } catch (error) {
            console.error('Error saving layer settings:', error);
            alert('Failed to save layer settings. Please check the console for details.');
        }
    }

    /**
     * Initialize edit mode
     */
    _initializeEditMode() {
        const editModeToggle = document.getElementById('edit-mode-toggle');
        if (editModeToggle) {
            editModeToggle.addEventListener('click', () => {
                this._editMode = !this._editMode;
                editModeToggle.classList.toggle('active');
            });
        }
    }

    /**
     * Initialize share link functionality
     */
    _initializeShareLink() {
        const shareButton = document.getElementById('share-link');
        if (!shareButton) return;

        shareButton.addEventListener('click', () => {
            // If URL manager is available, use it instead of our own logic
            if (window.urlManager) {
                // Let URL manager handle the URL update
                window.urlManager.syncURL();

                // Get the current URL from the URL manager
                const currentUrl = window.urlManager.getCurrentURL();

                navigator.clipboard.writeText(currentUrl).then(() => {
                    this._showToast('Link copied to clipboard!');
                    this._showQRCode(shareButton, currentUrl);
                }).catch(err => {
                    console.error('Failed to copy link:', err);
                    this._showToast('Failed to copy link', 'error');
                });
            } else {
                // Fallback to our own logic if URL manager is not available
                const visibleLayers = this._getVisibleLayers();
                const url = new URL(window.location.href);

                if (visibleLayers.length > 0) {
                    url.searchParams.set('layers', visibleLayers.join(','));
                } else {
                    url.searchParams.delete('layers');
                }

                const prettyUrl = decodeURIComponent(url.toString()).replace(/\+/g, ' ');
                window.history.replaceState({}, '', prettyUrl);

                navigator.clipboard.writeText(prettyUrl).then(() => {
                    this._showToast('Link copied to clipboard!');
                    this._showQRCode(shareButton, prettyUrl);
                }).catch(err => {
                    console.error('Failed to copy link:', err);
                    this._showToast('Failed to copy link', 'error');
                });
            }
        });
    }

    /**
     * Get visible layers
     */
    _getVisibleLayers() {
        const visibleLayers = [];

        // Check all layer controls (including cross-atlas layers)
        const allLayerControls = document.querySelectorAll('.group-header');

        allLayerControls.forEach((groupHeader) => {
            const toggleInput = groupHeader.querySelector('.toggle-switch input[type="checkbox"]');

            if (toggleInput && toggleInput.checked) {
                const layerId = groupHeader.getAttribute('data-layer-id');
                if (layerId) {
                    // Find the group in state
                    const group = this._state.groups.find(g => g.id === layerId || g._prefixedId === layerId);

                    if (group) {
                        if (group.type === 'layer-group') {
                            const radioGroup = groupHeader.querySelector('.radio-group');
                            const selectedRadio = radioGroup?.querySelector('input[type="radio"]:checked');
                            if (selectedRadio) {
                                visibleLayers.push(selectedRadio.value);
                            }
                        } else {
                            visibleLayers.push(group._originalJson || group.id);
                        }
                    }
                }
            }
        });

        return visibleLayers;
    }

    /**
     * Show toast notification
     */
    _showToast(message, type = 'success', duration = 3000) {
        let toast = document.querySelector('.toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast-notification';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.remove('success', 'error', 'info');
        toast.classList.add(type);

        requestAnimationFrame(() => {
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }, duration);
        });
    }

    /**
     * Show QR code for sharing
     */
    _showQRCode(shareButton, url) {
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(url)}`;
        const qrCode = document.createElement('img');
        qrCode.src = qrCodeUrl;
        qrCode.alt = 'QR Code';
        qrCode.className = 'qr-share-icon';

        const originalContent = shareButton.innerHTML;
        shareButton.innerHTML = '';
        shareButton.appendChild(qrCode);

        qrCode.addEventListener('click', (e) => {
            e.stopPropagation();
            shareButton.innerHTML = originalContent;
            this._showFullScreenQR(qrCodeUrl);
        });

        setTimeout(() => {
            if (shareButton.contains(qrCode)) {
                shareButton.innerHTML = originalContent;
            }
        }, 30000);
    }

    /**
     * Show full screen QR code
     */
    _showFullScreenQR(qrCodeUrl) {
        const overlay = document.createElement('div');
        overlay.className = 'qr-fullscreen-overlay';

        const largeQRCode = document.createElement('img');
        largeQRCode.src = qrCodeUrl;
        largeQRCode.alt = 'QR Code';
        largeQRCode.className = 'qr-fullscreen-image';

        overlay.addEventListener('click', () => document.body.removeChild(overlay));
        overlay.appendChild(largeQRCode);
        document.body.appendChild(overlay);
    }

    /**
     * Add global click handler
     */
    _addGlobalClickHandler() {
        if (this._globalClickHandlerAdded) return;

        this._map.on('click', (e) => {
            setTimeout(() => {
                // Query rendered features with error handling for DEM data
                let features = [];
                try {
                    features = this._map.queryRenderedFeatures(e.point);
                } catch (error) {
                    // Handle DEM data range errors gracefully
                    if (error.message && error.message.includes('out of range source coordinates for DEM data')) {
                        console.debug('[MapLayerControls] DEM data out of range at click location, skipping query');
                        return;
                    } else {
                        // Re-throw other errors as they might be more serious
                        console.error('[MapLayerControls] Error querying rendered features on click:', error);
                        throw error;
                    }
                }
                const customFeatures = features.filter(feature => {
                    const layerId = feature.layer?.id;
                    return layerId && (
                        layerId.includes('vector-layer-') ||
                        layerId.includes('geojson-') ||
                        layerId.includes('csv-') ||
                        layerId.includes('tms-layer-') ||
                        layerId.includes('markers-')
                    );
                });

                if (customFeatures.length === 0) {
                    if (this._stateManager) {
                        this._stateManager.clearAllSelections();
                    }

                    this._map.getCanvas().style.cursor = '';
                    const popups = document.querySelectorAll('.mapboxgl-popup');
                    popups.forEach(popup => {
                        const popupInstance = popup._popup;
                        if (popupInstance) {
                            popupInstance.remove();
                        }
                    });
                }
            }, 0);
        });

        this._globalClickHandlerAdded = true;
    }

    /**
     * Set up drawer focus management to prevent aria-hidden accessibility issues
     * Blurs focused elements inside the drawer before it's hidden
     */
    _setupDrawerFocusManagement() {
        // Wait for drawer to be available
        const findDrawer = () => {
            const drawer = document.querySelector('#map-controls-drawer');
            if (drawer) {
                // Listen for drawer hide event (fires before hiding)
                drawer.addEventListener('sl-hide', () => {
                    // Check if the currently focused element is inside the drawer
                    const activeElement = document.activeElement;
                    if (activeElement && drawer.contains(activeElement)) {
                        // Blur the focused element to prevent aria-hidden accessibility violation
                        activeElement.blur();
                    }
                });
            } else {
                // Retry if drawer not found yet
                setTimeout(findDrawer, 100);
            }
        };
        findDrawer();
    }

    /**
     * Initialize filter controls
     */
    _initializeFilterControls() {
        setTimeout(() => {
            const searchInput = document.getElementById('layer-search-input');
            const newLayerBtn = document.getElementById('new-layer-btn');
            const atlasFilterBtn = document.getElementById('atlas-filter-select');
            const atlasFilterText = document.getElementById('atlas-filter-text');
            const atlasViewLocationBtn = document.getElementById('atlas-view-location-btn');

            // Initialize search input
            if (searchInput) {
                // Update placeholder with layer count
                this._updateSearchPlaceholder();

                searchInput.addEventListener('sl-input', (e) => {
                    this._applyAllFilters();
                });
                searchInput.addEventListener('sl-clear', () => {
                    this._applyAllFilters();
                });
            }

            // Initialize New Layer button
            if (newLayerBtn) {
                newLayerBtn.addEventListener('click', () => {
                    if (typeof openLayerCreatorDialog === 'function') {
                        openLayerCreatorDialog();
                    }
                });
            }

            // Initialize atlas filter
            if (atlasFilterBtn) {
                // Set initial text to current atlas name
                this._updateAtlasButtonText();

                // Create and populate atlas dropdown menu
                this._createAtlasDropdownMenu(atlasFilterBtn);
            }

            // Initialize View Location button
            if (atlasViewLocationBtn) {
                atlasViewLocationBtn.addEventListener('click', () => {
                    if (this._selectedAtlasFilter) {
                        this._navigateToAtlasLocation(this._selectedAtlasFilter);
                    }
                });
            }
        }, 100);
    }

    /**
     * Update the atlas button text to show current atlas or default
     */
    _updateAtlasButtonText() {
        const atlasFilterText = document.getElementById('atlas-filter-text');
        if (!atlasFilterText || !window.layerRegistry) return;

        const currentAtlas = window.layerRegistry._currentAtlas || 'index';
        const atlasMetadata = window.layerRegistry.getAtlasMetadata(currentAtlas);

        if (this._selectedAtlasFilter) {
            // Show selected filter atlas
            const selectedMetadata = window.layerRegistry.getAtlasMetadata(this._selectedAtlasFilter);
            atlasFilterText.textContent = selectedMetadata?.name || this._selectedAtlasFilter;
        } else {
            // Show current atlas as default
            atlasFilterText.textContent = atlasMetadata?.name || 'All Atlases';
        }
    }

    /**
     * Update the search input placeholder with layer count
     */
    _updateSearchPlaceholder() {
        const searchInput = document.getElementById('layer-search-input');
        if (!searchInput || !window.layerRegistry) return;

        let layerCount = 0;

        if (this._selectedAtlasFilter) {
            // Count layers in selected atlas
            const atlasLayers = window.layerRegistry.getAtlasLayers(this._selectedAtlasFilter);
            layerCount = atlasLayers.length;
        } else {
            // Count all layers from current atlas
            layerCount = this._state.groups.length;
        }

        searchInput.placeholder = `Search from ${layerCount} maps...`;
    }

    /**
     * Create dropdown menu for atlas selection
     */
    _createAtlasDropdownMenu(buttonElement) {
        if (!window.layerRegistry || !window.layerRegistry._atlasMetadata) return;

        // Store parent node before any manipulation
        const parentNode = buttonElement.parentNode;

        // Create dropdown element
        const dropdown = document.createElement('sl-dropdown');
        dropdown.distance = 5;
        dropdown.placement = 'bottom-start';
        dropdown.style.width = '100%';

        // Create menu
        const menu = document.createElement('sl-menu');
        menu.style.minWidth = '200px';

        // Add divider
        const divider = document.createElement('sl-divider');
        menu.appendChild(divider);

        // Get all atlases from the registry
        const atlases = Array.from(window.layerRegistry._atlasMetadata.entries());

        // Sort atlases alphabetically by name
        atlases.sort((a, b) => {
            const nameA = a[1].name || a[0];
            const nameB = b[1].name || b[0];
            return nameA.localeCompare(nameB);
        });

        // Add options for each atlas
        atlases.forEach(([atlasId, metadata]) => {
            const option = document.createElement('sl-menu-item');
            option.value = atlasId;

            // Add a colored badge using the atlas color
            if (metadata.color) {
                option.innerHTML = `
                    <span class="atlas-color-badge" style="background-color: ${metadata.color};" slot="prefix"></span>
                    <span>${metadata.name || atlasId}</span>
                `;
            } else {
                option.textContent = metadata.name || atlasId;
            }

            option.addEventListener('click', () => {
                this._selectedAtlasFilter = atlasId;
                this._updateAtlasButtonText();
                this._applyAllFilters();
                dropdown.hide();
            });

            menu.appendChild(option);
        });

        // Append menu to dropdown
        dropdown.appendChild(menu);

        // Set button as trigger and append to dropdown
        buttonElement.setAttribute('slot', 'trigger');
        dropdown.appendChild(buttonElement);

        // Insert dropdown into parent where button was
        parentNode.appendChild(dropdown);
    }

    /**
     * Apply all filters (search, hide inactive, and atlas) - uses layer registry for cross-atlas search
     */
    _applyAllFilters() {
        try {
            if (!this._container || !window.layerRegistry) return;

            const searchInput = document.getElementById('layer-search-input');

            const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
            const selectedAtlas = this._selectedAtlasFilter || '';
            const isSearching = searchTerm.length > 0;
            const isAtlasFiltering = selectedAtlas.length > 0;

            const layerGroups = this._container.querySelectorAll('.group-header');

            // If searching, use the layer registry to find cross-atlas matches
            let crossAtlasResults = [];
            if (isSearching) {
                const currentAtlas = window.layerRegistry._currentAtlas;
                crossAtlasResults = window.layerRegistry.searchLayers(searchTerm, currentAtlas);
            }

            // If atlas filtering, get all layers from the selected atlas
            let atlasLayers = [];
            if (isAtlasFiltering) {
                atlasLayers = window.layerRegistry.getAtlasLayers(selectedAtlas);
            }

            // Get current atlas layer IDs for deduplication
            const currentLayerIds = new Set();
            this._state.groups.forEach(group => {
                currentLayerIds.add(group.id);
            });

            // Apply visibility to existing layers
            layerGroups.forEach(groupElement => {
                const groupId = groupElement.getAttribute('data-layer-id');
                if (!groupId) return;

                // Find group data
                const groupData = this._state.groups.find(g => g.id === groupId);
                if (!groupData) return;

                const searchMatches = this._layerMatchesSearch(groupData, searchTerm);

                // Check if layer matches atlas filter
                let atlasMatches = true;
                if (isAtlasFiltering) {
                    const atlasId = this._getAtlasIdForLayer(groupData);
                    atlasMatches = atlasId === selectedAtlas;
                }

                const toggleInput = groupElement.querySelector('.toggle-switch input[type="checkbox"]');

                // Show if matches all filters
                groupElement.style.display = (searchMatches && atlasMatches) ? '' : 'none';
            });

            // Add cross-atlas search results dynamically (if not already in current atlas)
            if (isSearching && crossAtlasResults.length > 0) {
                this._showCrossAtlasSearchResults(crossAtlasResults, currentLayerIds);
            } else if (isAtlasFiltering && atlasLayers.length > 0) {
                // Show all layers from the selected atlas
                this._showAtlasFilterResults(atlasLayers, selectedAtlas, currentLayerIds);
            } else {
                this._hideCrossAtlasSearchResults();
            }
        } catch (error) {
            console.error('[Filter] Error applying filters:', error);
        }
    }

    /**
     * Check if a layer matches the search term
     */
    _layerMatchesSearch(groupData, searchTerm) {
        if (!searchTerm) return true;

        return (groupData.id && groupData.id.toLowerCase().includes(searchTerm)) ||
            (groupData.name && groupData.name.toLowerCase().includes(searchTerm)) ||
            (groupData.title && groupData.title.toLowerCase().includes(searchTerm)) ||
            (groupData.description && groupData.description.toLowerCase().includes(searchTerm)) ||
            (groupData.tags && Array.isArray(groupData.tags) &&
                groupData.tags.some(tag => tag && tag.toLowerCase().includes(searchTerm)));
    }

    /**
     * Show cross-atlas search results
     */
    _showCrossAtlasSearchResults(results, currentLayerIds) {
        // Check if we already have a cross-atlas container
        let $crossAtlasContainer = $(this._container).find('.cross-atlas-results');

        if ($crossAtlasContainer.length === 0) {
            // Create container for cross-atlas results
            $crossAtlasContainer = $('<div>', {
                class: 'cross-atlas-results mt-4 border-t-2 border-gray-700 pt-4'
            });
            $(this._container).append($crossAtlasContainer);
        }

        // Clear existing results
        $crossAtlasContainer.empty();

        // Add header
        $crossAtlasContainer.append($('<div>', {
            class: 'text-sm text-gray-400 mb-2 px-2',
            text: 'From other atlases:'
        }));

        // Add each result (skipping duplicates)
        results.forEach(layer => {
            // Skip if already in current atlas
            if (currentLayerIds.has(layer.id)) {
                return;
            }

            // Create layer element with cross-atlas styling
            const $layerElement = this._createCrossAtlasLayerElement(layer);
            $crossAtlasContainer.append($layerElement);
        });
    }

    /**
     * Show atlas filter results - displays all layers from selected atlas
     */
    _showAtlasFilterResults(layers, atlasId, currentLayerIds) {
        // Check if we already have a cross-atlas container
        let $crossAtlasContainer = $(this._container).find('.cross-atlas-results');

        if ($crossAtlasContainer.length === 0) {
            // Create container for cross-atlas results
            $crossAtlasContainer = $('<div>', {
                class: 'cross-atlas-results mt-4 border-t-2 border-gray-700 pt-4'
            });
            $(this._container).append($crossAtlasContainer);
        }

        // Clear existing results
        $crossAtlasContainer.empty();

        // Get atlas metadata for header
        const atlasMetadata = window.layerRegistry.getAtlasMetadata(atlasId);
        const atlasName = atlasMetadata?.name || atlasId;
        const atlasColor = atlasMetadata?.color || '#2563eb';

        // Get atlas configuration to access map location
        const atlasLayers = window.layerRegistry.getAtlasLayers(atlasId);
        const atlasConfig = atlasLayers.length > 0 ? atlasLayers[0] : null;

        // Add header with atlas name, color, and View Location button
        const $header = $('<div>', {
            class: 'text-sm text-gray-400 mb-2 px-2 flex items-center gap-2 justify-between'
        });

        const $leftSection = $('<div>', {
            class: 'flex items-center gap-2',
            html: `
                <span class="atlas-color-badge" style="background-color: ${atlasColor};"></span>
                <span>Layers from ${atlasName}:</span>
            `
        });

        const $viewLocationBtn = $('<button>', {
            class: 'atlas-view-location-btn',
            html: '<sl-icon name="geo-alt" style="font-size: 12px; margin-right: 4px;"></sl-icon><span>View Location</span>'
        });

        // Add click handler to navigate to atlas location
        $viewLocationBtn.on('click', () => {
            this._navigateToAtlasLocation(atlasId);
        });

        $header.append($leftSection, $viewLocationBtn);
        $crossAtlasContainer.append($header);

        // Add each layer from the atlas (skipping duplicates)
        layers.forEach(layer => {
            // Resolve the layer to get full details
            const resolvedLayer = window.layerRegistry.getLayer(layer.id, atlasId);
            if (!resolvedLayer) return;

            // Skip if already in current atlas (visible in main list)
            const layerIdToCheck = resolvedLayer._originalId || resolvedLayer.id || layer.id;
            if (currentLayerIds.has(layerIdToCheck)) {
                return;
            }

            // Create layer element with cross-atlas styling
            const $layerElement = this._createCrossAtlasLayerElement(resolvedLayer);
            $crossAtlasContainer.append($layerElement);
        });
    }

    /**
     * Hide cross-atlas search results
     */
    _hideCrossAtlasSearchResults() {
        const $crossAtlasContainer = $(this._container).find('.cross-atlas-results');
        $crossAtlasContainer.remove();
    }

    /**
     * Create a layer element for cross-atlas search results
     */
    _createCrossAtlasLayerElement(layer) {
        const $groupHeader = $('<sl-details>', {
            class: 'group-header w-full map-controls-group cross-atlas-layer',
            'data-layer-id': layer._prefixedId || layer.id
        });

        // Create summary section
        const $summary = $('<div>', {
            slot: 'summary',
            class: 'flex items-center relative w-full h-12 bg-gray-800 opacity-75'
        });

        const $contentWrapper = $('<div>', {
            class: 'flex items-center gap-2 relative z-10 w-full p-2'
        });

        // Add toggle and title
        const $toggleLabel = $('<label>', { class: 'toggle-switch' });
        const $toggleInput = $('<input>', { type: 'checkbox', checked: false });
        const $toggleSlider = $('<span>', { class: 'toggle-slider' });
        $toggleLabel.append($toggleInput, $toggleSlider);

        const $titleSpan = $('<span>', {
            text: layer.title || layer.id,
            class: 'control-title text-sm font-medium text-white'
        });

        // Add atlas badge
        const displayAtlasName = layer._sourceAtlas.charAt(0).toUpperCase() + layer._sourceAtlas.slice(1);

        // Get color from registry, fallback to blue-600 if not available
        let badgeColor = '#2563eb'; // Default blue
        if (window.layerRegistry) {
            badgeColor = window.layerRegistry.getAtlasColor(layer._sourceAtlas);
        }

        const $atlasBadge = $('<span>', {
            class: 'text-xs text-white px-2 py-1 rounded ml-auto cursor-pointer hover:opacity-80 transition-opacity',
            style: `background-color: ${badgeColor};`,
            text: displayAtlasName,
            title: `Switch to ${displayAtlasName} atlas`
        });

        // Make badge clickable to navigate to atlas
        $atlasBadge.on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._navigateToAtlas(layer._sourceAtlas);
        });

        $contentWrapper.append($toggleLabel, $titleSpan, $atlasBadge);

        // Add header background if exists (resolve from layer data)
        let headerImage = layer.headerImage;
        if (!headerImage && layer.id && window.layerRegistry) {
            const resolvedLayer = window.layerRegistry.getLayer(layer._prefixedId || layer.id);
            if (resolvedLayer && resolvedLayer.headerImage) {
                headerImage = resolvedLayer.headerImage;
            }
        }

        if (headerImage) {
            const $headerBg = $('<div>', {
                class: 'absolute top-0 left-0 right-0 w-full h-full bg-cover bg-center bg-no-repeat',
                style: `background-image: url('${headerImage}')`
            });

            const $headerOverlay = $('<div>', {
                class: 'absolute top-0 left-0 right-0 w-full h-full bg-black bg-opacity-40'
            });

            $summary.append($headerBg, $headerOverlay, $contentWrapper);
        } else {
            $summary.append($contentWrapper);
        }

        $groupHeader.append($summary);

        // Add description if available
        if (layer.description) {
            const $description = $('<div>', {
                class: 'text-sm text-gray-600 p-2',
                html: layer.description
            });
            $groupHeader.append($description);
        }

        // Set up event handlers
        $groupHeader[0].addEventListener('sl-show', async () => {
            $toggleInput.prop('checked', true);
            // Add layer to state and activate it
            await this._addCrossAtlasLayer(layer);
        });

        $groupHeader[0].addEventListener('sl-hide', () => {
            $toggleInput.prop('checked', false);
            // Remove layer from state
            this._removeCrossAtlasLayer(layer._prefixedId || layer.id);
        });

        return $groupHeader;
    }

    /**
     * Add a cross-atlas layer to the active state
     */
    async _addCrossAtlasLayer(layer) {
        // Add to state with prefixed ID
        const layerWithPrefix = {
            ...layer,
            id: layer._prefixedId || layer.id,
            initiallyChecked: true
        };

        // Set the normalized ID for URL serialization using the registry
        if (window.layerRegistry) {
            layerWithPrefix._normalizedId = window.layerRegistry.normalizeLayerId(layerWithPrefix.id);
        }

        this._state.groups.push(layerWithPrefix);

        // Activate the layer
        if (this._mapboxAPI) {
            await this._mapboxAPI.createLayerGroup(layerWithPrefix.id, layerWithPrefix, { visible: true });
        }

        // Register with state manager if available
        if (this._stateManager) {
            this._registerLayerWithStateManager(layerWithPrefix);
        }

        // Update attribution after layer is added
        if (window.attributionControl) {
            window.attributionControl._updateAttribution();
        }

        // Update URL to reflect the change
        if (window.urlManager) {
            window.urlManager.onLayersChanged();
        }

        // Dispatch custom event for URL sync
        window.dispatchEvent(new CustomEvent('layer-toggled', {
            detail: { layerId: layerWithPrefix.id, visible: true, isCrossAtlas: true }
        }));
    }

    /**
     * Navigate to a different atlas
     */
    _navigateToAtlas(atlasId) {
        if (!atlasId) return;

        const url = new URL(window.location.href);
        url.searchParams.set('atlas', atlasId);

        // Navigate to the new URL
        window.location.href = url.toString();
    }

    /**
     * Navigate map to the atlas's defined location
     */
    _navigateToAtlasLocation(atlasId) {
        if (!atlasId || !this._map) return;

        // Fetch the atlas configuration to get map location
        fetch(`/config/${atlasId}.atlas.json`)
            .then(response => response.json())
            .then(config => {
                if (config.map) {
                    const { center, zoom } = config.map;
                    if (center && zoom !== undefined) {
                        // Animate to the atlas location
                        this._map.flyTo({
                            center: center,
                            zoom: zoom,
                            duration: 2000,
                            essential: true
                        });
                    }
                }
            })
            .catch(error => {
                console.error(`Failed to load atlas configuration for ${atlasId}:`, error);
            });
    }


    /**
     * Remove a cross-atlas layer from the active state
     */
    _removeCrossAtlasLayer(layerId) {
        // Find and save the layer before removing it
        const index = this._state.groups.findIndex(g => g.id === layerId || g._prefixedId === layerId);
        if (index === -1) {
            console.warn(`[LayerControl] Layer ${layerId} not found in state for removal`);
            return;
        }

        // Save layer reference before removing from array
        const layer = this._state.groups[index];

        // Hide the layer first
        if (this._mapboxAPI && layer) {
            this._mapboxAPI.updateLayerGroupVisibility(layerId, layer, false);
        }

        // Now remove from state
        this._state.groups.splice(index, 1);

        // Unregister with state manager if available
        if (this._stateManager) {
            this._unregisterLayerWithStateManager(layerId);
        }

        // Update attribution after layer removal
        if (window.attributionControl) {
            window.attributionControl._updateAttribution();
        }

        // Update URL to reflect the change
        if (window.urlManager) {
            window.urlManager.onLayersChanged();
        }

        // Dispatch custom event for URL sync
        window.dispatchEvent(new CustomEvent('layer-toggled', {
            detail: { layerId: layerId, visible: false, isCrossAtlas: true }
        }));
    }


    /**
     * Cleanup resources
     */
    cleanup() {
        if (this._mapboxAPI) {
            this._mapboxAPI.cleanup();
        }
    }
}

// Make available globally for backwards compatibility
if (typeof window !== 'undefined') {
    window.MapLayerControl = MapLayerControl;
} 
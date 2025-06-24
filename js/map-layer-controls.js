import { getQueryParameters, convertToWebMercator, convertStyleToLegend, deepMerge, isObject } from './map-utils.js';
import { convertToKML, gstableToArray } from './map-utils.js';
import { parseCSV, rowsToGeoJSON } from './map-utils.js';
import { getInsertPosition } from './layer-order-manager.js';
import { fixLayerOrdering } from './layer-order-manager.js';
import { localization } from './localization.js';
import { fetchTileJSON } from './map-utils.js';

/**
 * MapLayerControl - Controls layer visibility and interaction for a Mapbox GL JS map
 * 
 * Configuration options:
 * - showPopupsOnHover: boolean (default: true) - Controls whether popups are shown on feature hover
 * - showPopupsOnClick: boolean (default: false) - Controls whether popups are shown on feature click
 * - groups: Array of layer group configurations
 * - sourceLayerLinks: Array of link objects for specific source layers
 */
export class MapLayerControl {
    constructor(options) {
        // Handle options structure for groups and configuration
        if (Array.isArray(options)) {
            // Legacy array of groups format
            this._state = { groups: options };
            this._config = {};
        } else if (options && options.groups) {
            // New object format with groups and other config
            this._state = { groups: options.groups };
            this._config = options;
        } else {
            // Single group format
            this._state = { groups: [options] };
            this._config = {};
        }

        // Set popup configuration with default values
        this._config.showPopupsOnHover = this._config.showPopupsOnHover !== undefined ? this._config.showPopupsOnHover : true;
        this._config.showPopupsOnClick = this._config.showPopupsOnClick !== undefined ? this._config.showPopupsOnClick : false;

        // sourceLayerLinks functionality has been moved to MapFeatureControl

        // Default styles will be loaded from config/index.atlas.json styles object
        this._defaultStyles = {};

        this._domCache = {};
        this._instanceId = (MapLayerControl.instances || 0) + 1;
        MapLayerControl.instances = this._instanceId;
        this._initialized = false;
        this._sourceControls = [];
        this._editMode = false;

        // Global click handler tracking (selected features now managed by state manager)
        this._globalClickHandlerAdded = false; // Track if global handler is added

        // Initialize edit mode toggle
        this._initializeEditMode();

        // Add share link handler
        this._initializeShareLink();

        // Add modal container
        this._initializeSettingsModal();

        this._consolidatedHoverPopup = null;
        this._stateManager = null; // Reference to the centralized state manager

        // Load default styles
        this._loadDefaultStyles();

        // Comprehensive Mapbox GL Style Spec property mapping
        this._stylePropertyMapping = this._initializeStylePropertyMapping();
    }

    /**
     * Initialize comprehensive mapping of all Mapbox GL style properties
     * categorized by layer type and property type (paint vs layout)
     */
    _initializeStylePropertyMapping() {
        return {
            // Common layout properties (apply to all layer types)
            layout: {
                common: ['visibility'],
                fill: ['fill-sort-key'],
                line: ['line-cap', 'line-join', 'line-miter-limit', 'line-round-limit', 'line-sort-key', 'line-elevation-reference', 'line-cross-slope', 'line-z-offset'],
                symbol: [
                    'icon-allow-overlap', 'icon-anchor', 'icon-ignore-placement', 'icon-image', 'icon-keep-upright',
                    'icon-offset', 'icon-optional', 'icon-padding', 'icon-pitch-alignment', 'icon-rotate',
                    'icon-rotation-alignment', 'icon-size', 'icon-text-fit', 'icon-text-fit-padding',
                    'symbol-avoid-edges', 'symbol-elevation-reference', 'symbol-placement', 'symbol-sort-key',
                    'symbol-spacing', 'symbol-z-elevate', 'symbol-z-order',
                    'text-allow-overlap', 'text-anchor', 'text-field', 'text-font', 'text-ignore-placement',
                    'text-justify', 'text-keep-upright', 'text-letter-spacing', 'text-line-height',
                    'text-max-angle', 'text-max-width', 'text-offset', 'text-optional', 'text-padding',
                    'text-pitch-alignment', 'text-radial-offset', 'text-rotate', 'text-rotation-alignment',
                    'text-size', 'text-transform', 'text-variable-anchor', 'text-writing-mode'
                ],
                circle: ['circle-sort-key', 'circle-elevation-reference'],
                raster: [], // Raster layers have no layout properties except visibility
                'raster-particle': [],
                'fill-extrusion': [],
                heatmap: [],
                hillshade: [],
                background: [],
                sky: [],
                model: ['model-id']
            },

            // Paint properties by layer type
            paint: {
                fill: [
                    'fill-antialias', 'fill-color', 'fill-emissive-strength', 'fill-opacity',
                    'fill-outline-color', 'fill-pattern', 'fill-pattern-cross-fade', 'fill-translate',
                    'fill-translate-anchor', 'fill-z-offset'
                ],
                line: [
                    'line-blur', 'line-color', 'line-dasharray', 'line-emissive-strength', 'line-gap-width',
                    'line-gradient', 'line-occlusion-opacity', 'line-offset', 'line-opacity', 'line-pattern',
                    'line-pattern-cross-fade', 'line-translate', 'line-translate-anchor', 'line-trim-color',
                    'line-trim-fade-range', 'line-trim-offset', 'line-width', 'line-z-offset'
                ],
                symbol: [
                    'icon-color', 'icon-color-brightness-max', 'icon-color-brightness-min', 'icon-color-contrast',
                    'icon-color-saturation', 'icon-emissive-strength', 'icon-halo-blur', 'icon-halo-color',
                    'icon-halo-width', 'icon-image-cross-fade', 'icon-occlusion-opacity', 'icon-opacity',
                    'icon-translate', 'icon-translate-anchor', 'symbol-z-offset',
                    'text-color', 'text-emissive-strength', 'text-halo-blur', 'text-halo-color',
                    'text-halo-width', 'text-occlusion-opacity', 'text-opacity', 'text-translate',
                    'text-translate-anchor'
                ],
                circle: [
                    'circle-blur', 'circle-color', 'circle-emissive-strength', 'circle-opacity',
                    'circle-pitch-alignment', 'circle-pitch-scale', 'circle-radius', 'circle-stroke-color',
                    'circle-stroke-opacity', 'circle-stroke-width', 'circle-translate', 'circle-translate-anchor'
                ],
                raster: [
                    'raster-array-band', 'raster-brightness-max', 'raster-brightness-min', 'raster-color',
                    'raster-color-mix', 'raster-color-range', 'raster-contrast', 'raster-elevation',
                    'raster-emissive-strength', 'raster-fade-duration', 'raster-hue-rotate', 'raster-opacity',
                    'raster-resampling', 'raster-saturation'
                ],
                'raster-particle': [
                    'raster-particle-array-band', 'raster-particle-color', 'raster-particle-count',
                    'raster-particle-elevation', 'raster-particle-fade-opacity-factor', 'raster-particle-max-speed',
                    'raster-particle-reset-rate-factor', 'raster-particle-speed-factor'
                ],
                'fill-extrusion': [
                    'fill-extrusion-ambient-occlusion-ground-attenuation', 'fill-extrusion-ambient-occlusion-ground-radius',
                    'fill-extrusion-ambient-occlusion-intensity', 'fill-extrusion-ambient-occlusion-radius',
                    'fill-extrusion-ambient-occlusion-wall-radius', 'fill-extrusion-base', 'fill-extrusion-base-alignment',
                    'fill-extrusion-cast-shadows', 'fill-extrusion-color', 'fill-extrusion-cutoff-fade-range',
                    'fill-extrusion-edge-radius', 'fill-extrusion-emissive-strength', 'fill-extrusion-flood-light-color',
                    'fill-extrusion-flood-light-ground-attenuation', 'fill-extrusion-flood-light-ground-radius',
                    'fill-extrusion-flood-light-intensity', 'fill-extrusion-flood-light-wall-radius',
                    'fill-extrusion-height', 'fill-extrusion-height-alignment', 'fill-extrusion-line-width',
                    'fill-extrusion-opacity', 'fill-extrusion-pattern', 'fill-extrusion-pattern-cross-fade',
                    'fill-extrusion-rounded-roof', 'fill-extrusion-translate', 'fill-extrusion-translate-anchor',
                    'fill-extrusion-vertical-gradient', 'fill-extrusion-vertical-scale'
                ],
                heatmap: [
                    'heatmap-color', 'heatmap-intensity', 'heatmap-opacity', 'heatmap-radius', 'heatmap-weight'
                ],
                hillshade: [
                    'hillshade-accent-color', 'hillshade-emissive-strength', 'hillshade-exaggeration',
                    'hillshade-highlight-color', 'hillshade-illumination-anchor', 'hillshade-illumination-direction',
                    'hillshade-shadow-color'
                ],
                background: [
                    'background-color', 'background-emissive-strength', 'background-opacity', 'background-pattern',
                    'background-pitch-alignment'
                ],
                sky: [
                    'sky-atmosphere-color', 'sky-atmosphere-halo-color', 'sky-atmosphere-sun',
                    'sky-atmosphere-sun-intensity', 'sky-gradient', 'sky-gradient-center', 'sky-gradient-radius',
                    'sky-opacity', 'sky-type'
                ],
                model: [
                    'model-ambient-occlusion-intensity', 'model-cast-shadows', 'model-color', 'model-color-mix-intensity',
                    'model-cutoff-fade-range', 'model-emissive-strength', 'model-height-based-emissive-strength-multiplier',
                    'model-opacity', 'model-receive-shadows', 'model-rotation', 'model-roughness', 'model-scale',
                    'model-translation', 'model-type'
                ]
            }
        };
    }

    /**
     * Categorize style properties into paint and layout based on layer type
     * @param {Object} style - Style object with mixed paint/layout properties
     * @param {string} layerType - The layer type (e.g., 'raster', 'fill', 'line')
     * @returns {Object} - Object with separate paint and layout properties
     */
    _categorizeStyleProperties(style, layerType) {
        if (!style || typeof style !== 'object') {
            return { paint: {}, layout: {} };
        }

        const paint = {};
        const layout = {};

        // Get property lists for this layer type
        const layoutProps = [
            ...(this._stylePropertyMapping.layout.common || []),
            ...(this._stylePropertyMapping.layout[layerType] || [])
        ];
        const paintProps = this._stylePropertyMapping.paint[layerType] || [];

        // Categorize each property in the style object
        Object.keys(style).forEach(property => {
            // First check if this property is valid for this layer type
            const isValidForLayerType = this._isPropertyValidForLayerType(property, layerType);
            if (!isValidForLayerType) {
                // Skip invalid properties completely - don't add them to either paint or layout
                return;
            }

            if (layoutProps.includes(property)) {
                layout[property] = style[property];
            } else if (paintProps.includes(property)) {
                paint[property] = style[property];
            } else {
                // If property is not in our mapping, make an educated guess
                // Most properties are paint properties, layout properties are fewer
                if (property === 'visibility' || property.includes('-sort-key') ||
                    property.includes('-placement') || property.includes('-anchor') ||
                    property.includes('-field') || property.includes('-font') ||
                    property.includes('-size') || property.includes('-image') ||
                    property.includes('-cap') || property.includes('-join')) {
                    layout[property] = style[property];
                } else {
                    paint[property] = style[property];
                }
            }
        });

        return { paint, layout };
    }

    /**
     * Check if a property is valid for a given layer type
     * @param {string} property - The property name
     * @param {string} layerType - The layer type (fill, line, symbol, circle, etc.)
     * @returns {boolean} - True if property is valid for this layer type
     */
    _isPropertyValidForLayerType(property, layerType) {
        // Define invalid property patterns for each layer type
        const invalidPatterns = {
            symbol: [
                /^fill-/,        // fill-color, fill-opacity, etc.
                /^line-/,        // line-color, line-width, etc.
                /^circle-/       // circle-radius, circle-color, etc.
            ],
            fill: [
                /^line-/,        // line-color, line-width, etc.
                /^text-/,        // text-color, text-field, etc.
                /^icon-/,        // icon-image, icon-color, etc.
                /^circle-/       // circle-radius, circle-color, etc.
            ],
            line: [
                /^fill-/,        // fill-color, fill-opacity, etc.
                /^text-/,        // text-color, text-field, etc.
                /^icon-/,        // icon-image, icon-color, etc.
                /^circle-/       // circle-radius, circle-color, etc.
            ],
            circle: [
                /^fill-/,        // fill-color, fill-opacity, etc.
                /^line-/,        // line-color, line-width, etc.
                /^text-/,        // text-color, text-field, etc.
                /^icon-/         // icon-image, icon-color, etc.
            ]
        };

        const patterns = invalidPatterns[layerType];
        if (!patterns) {
            // For unknown layer types, be permissive
            return true;
        }

        // Check if property matches any invalid pattern
        return !patterns.some(pattern => pattern.test(property));
    }

    /**
     * Apply style properties to a layer, automatically categorizing into paint/layout
     * @param {string} layerId - The layer ID
     * @param {Object} style - Style object with mixed properties
     * @param {string} layerType - The layer type
     * @param {Object} defaultStyle - Default style to merge with
     */
    _applyLayerStyle(layerId, style, layerType, defaultStyle = {}) {
        if (!this._map.getLayer(layerId)) {
            console.warn(`Layer ${layerId} not found, cannot apply style`);
            return;
        }

        // Merge with defaults
        const mergedStyle = { ...defaultStyle, ...style };

        // Categorize properties
        const { paint, layout } = this._categorizeStyleProperties(mergedStyle, layerType);

        // Apply paint properties
        Object.keys(paint).forEach(property => {
            try {
                this._map.setPaintProperty(layerId, property, paint[property]);
            } catch (error) {
                console.warn(`Failed to set paint property ${property} on layer ${layerId}:`, error);
            }
        });

        // Apply layout properties
        Object.keys(layout).forEach(property => {
            try {
                this._map.setLayoutProperty(layerId, property, layout[property]);
            } catch (error) {
                console.warn(`Failed to set layout property ${property} on layer ${layerId}:`, error);
            }
        });
    }

    /**
     * Create layer configuration with properly categorized paint/layout properties
     * @param {Object} config - Layer configuration
     * @param {string} layerType - The layer type
     * @returns {Object} - Layer configuration with separated paint/layout
     */
    _createLayerConfig(config, layerType) {
        const { paint, layout } = this._categorizeStyleProperties(config.style || {}, layerType);

        const layerConfig = {
            id: config.id,
            type: layerType,
            source: config.source,
            layout: {
                visibility: config.initiallyChecked !== false ? 'visible' : 'none',
                ...layout
            },
            paint: paint
        };

        // Add optional properties
        if (config['source-layer']) {
            layerConfig['source-layer'] = config['source-layer'];
        }
        if (config.filter) {
            layerConfig.filter = config.filter;
        }
        if (config.metadata) {
            layerConfig.metadata = config.metadata;
        }
        if (config.minzoom !== undefined) {
            layerConfig.minzoom = config.minzoom;
        }
        if (config.maxzoom !== undefined) {
            layerConfig.maxzoom = config.maxzoom;
        }

        return layerConfig;
    }

    // Load default styles from index.json instead of default-styles.json
    async _loadDefaultStyles() {
        try {
            // Load and merge both config files
            const defaultsResponse = await fetch('/config/_defaults.json');
            const configResponse = await fetch('/config/index.atlas.json');

            if (!defaultsResponse.ok || !configResponse.ok) {
                throw new Error('Failed to load configuration files');
            }

            const defaults = await defaultsResponse.json();
            const config = await configResponse.json();

            // Add debugging to see the actual structure
            console.debug('Defaults structure:', defaults);
            console.debug('Config structure:', config);

            // Get styles from _defaults.json - check for different possible structures
            if (defaults.layer && defaults.layer.style) {
                this._defaultStyles = defaults.layer.style;
            } else if (defaults.style) {
                this._defaultStyles = defaults.style;
            } else if (defaults.styles) {
                this._defaultStyles = defaults.styles;
            } else {
                console.warn('Could not find styles in defaults structure:', Object.keys(defaults));
                this._defaultStyles = {};
            }

            // If config has style overrides, merge them (but don't let them override defaults)
            if (config.styles) {
                this._defaultStyles = deepMerge(config.styles, this._defaultStyles);
            }

            console.debug('Final styles configuration:', this._defaultStyles);

        } catch (error) {
            console.error('Error loading default styles:', error);
            // Set minimal fallback default styles for critical properties
            this._defaultStyles = {
                vector: {
                    fill: { 'fill-color': '#000000', 'fill-opacity': 0.5 },
                    line: { 'line-color': '#000000', 'line-width': 1 },
                    text: { 'text-color': '#000000', 'text-halo-width': 1 },
                    circle: { 'circle-radius': 5, 'circle-color': '#000000' }
                },
                raster: {
                    'raster-opacity': 1
                }
            };
        }
    }

    // Add new state management methods
    _updateState(newState) {
        // Deep merge the new state
        this._state = {
            ...this._state,
            groups: newState.groups.map(newGroup => {
                const existingGroup = this._state.groups.find(g => g.id === newGroup.id);
                return existingGroup ? { ...existingGroup, ...newGroup } : newGroup;
            })
        };

        // Clean up existing layers
        this._cleanupLayers();

        // Rebuild the UI
        this._rebuildUI();
    }

    _cleanupLayers() {
        // Remove all existing custom layers and sources
        const style = this._map.getStyle();
        if (!style) return;

        // First disable terrain if it exists
        if (this._map.getTerrain()) {
            this._map.setTerrain(null);
        }

        // Get all our custom layer IDs
        const customLayerIds = this._state.groups.flatMap(group => {
            if (group.type === 'vector') {
                return [
                    `vector-layer-${group.id}`,
                    `vector-layer-${group.id}-outline`,
                    `vector-layer-${group.id}-text`,
                    `vector-layer-${group.id}-circle`
                ];
            } else if (group.type === 'geojson') {
                return [
                    `geojson-${group.id}-fill`,
                    `geojson-${group.id}-line`,
                    `geojson-${group.id}-label`,
                    `geojson-${group.id}-circle`
                ];
            } else if (group.type === 'tms') {
                return [`tms-layer-${group.id}`];
            } else if (group.type === 'csv') {
                // Clear any refresh timers
                if (group._refreshTimer) {
                    clearInterval(group._refreshTimer);
                    group._refreshTimer = null;
                }
                return [`csv-${group.id}-circle`];
            } else if (group.type === 'raster-style-layer') {
                // For raster-style-layer, we need to reset the existing layer to its original state
                const styleLayerId = group.styleLayer || group.id;
                if (this._map.getLayer(styleLayerId)) {
                    // Only reset visibility if the layer is not initially checked
                    // If it's initially checked, leave it as is to avoid hiding it
                    if (!group.initiallyChecked) {
                        this._map.setLayoutProperty(styleLayerId, 'visibility', 'none');
                    }
                    // Note: We don't reset other properties as they might be part of the original style
                    // and we don't have a way to know the original values
                }
                return []; // Don't remove the layer as it's part of the base style
            } else {
                return [];
            }
        });

        // Get all our custom source IDs
        const customSourceIds = this._state.groups.flatMap(group => {
            if (group.type === 'vector') {
                return [`vector-${group.id}`];
            } else if (group.type === 'geojson') {
                return [`geojson-${group.id}`];
            } else if (group.type === 'tms') {
                return [`tms-${group.id}`];
            } else if (group.type === 'csv') {
                return [`csv-${group.id}`];
            } else {
                return [];
            }
        });

        // Remove layers
        for (const id of customLayerIds) {
            if (this._map.getLayer(id)) {
                this._map.removeLayer(id);
            }
        }

        // Remove sources
        for (const id of customSourceIds) {
            if (this._map.getSource(id)) {
                this._map.removeSource(id);
            }
        }
    }

    _rebuildUI() {
        // Clear existing controls
        if (this._container) {
            this._container.innerHTML = '';
            this._sourceControls = [];

            // Re-render with current state
            this._initializeControl($(this._container));
        }
    }

    // Update _saveLayerSettings to use state management
    _saveLayerSettings() {
        const modal = document.getElementById('layer-settings-modal');
        const configTextarea = modal.querySelector('.config-json');

        try {
            // Parse the edited configuration
            const newConfig = JSON.parse(configTextarea.value);

            // Find and update the group in state
            const groupIndex = this._state.groups.findIndex(g => g.id === newConfig.id);
            if (groupIndex === -1) {
                throw new Error('Could not find layer configuration to update');
            }

            // Create new state with the updated group
            const newGroups = [...this._state.groups];
            newGroups[groupIndex] = newConfig;

            // Update state which will trigger rebuild
            this._updateState({ groups: newGroups });

            modal.hide();

        } catch (error) {
            console.error('Error saving layer settings:', error);
            alert('Failed to save layer settings. Please check the console for details.');
        }
    }

    // Add method to load external config
    async loadExternalConfig(url) {
        try {
            const response = await fetch(url);
            const configText = await response.text();

            // Handle JS format (assuming it starts with 'let' or 'const')
            let config;
            let fullConfig;
            if (configText.trim().startsWith('let') || configText.trim().startsWith('const')) {
                try {
                    // Create a new Function that returns the array directly
                    const extractConfig = new Function(`
                        ${configText}
                        return layers;
                    `);

                    // Execute the function to get the config
                    config = extractConfig();

                } catch (evalError) {
                    console.error('Error evaluating JS config:', evalError);
                    // Fallback to regex extraction if evaluation fails
                    const match = configText.match(/=\s*(\[[\s\S]*\])\s*;?\s*$/);
                    if (match) {
                        config = JSON.parse(match[1]);
                    } else {
                        throw new Error('Could not extract configuration array');
                    }
                }
            } else {
                // Assume JSON format
                fullConfig = JSON.parse(configText);

                // Check if the config has a layers property
                if (fullConfig.layers && Array.isArray(fullConfig.layers)) {
                    config = fullConfig.layers;
                } else {
                    config = fullConfig; // Use the full object if no layers property
                }
            }

            // Apply localization if full config is available
            if (fullConfig) {
                localization.loadStrings(fullConfig);
                // Force update UI elements after localization
                setTimeout(() => {
                    localization.forceUpdateUIElements();
                }, 100);
            }

            // Update state with new config
            this._updateState({ groups: config });

        } catch (error) {
            console.error('Error loading external config:', error);
            alert('Failed to load external configuration. Please check the console for details.');
            // Rethrow to allow caller to handle the error
            throw error;
        }
    }

    // Update the render method to handle initial config URL
    async renderToContainer(container, map) {
        this._container = container;
        this._map = map;

        // Make sure default styles are loaded before proceeding
        await this._ensureDefaultStylesLoaded();

        // Add global click handler early
        this._addGlobalClickHandler();

        // Proceed with normal initialization since layers are already loaded from map-init.js
        if (this._map.isStyleLoaded()) {
            this._initializeControl($(container));
        } else {
            this._map.on('style.load', () => {
                this._initializeControl($(container));
            });
        }

        $(container).append($('<div>', { class: 'layer-control' }));
    }

    // Ensure default styles are loaded before proceeding with initialization
    async _ensureDefaultStylesLoaded() {
        // If styles are already loaded, return
        if (Object.keys(this._defaultStyles).length > 0) {
            return;
        }

        // Wait for styles to load
        await this._loadDefaultStyles();
    }

    _initializeShareLink() {
        const shareButton = document.getElementById('share-link');
        if (!shareButton) return;

        shareButton.addEventListener('click', () => {
            // Get all visible layers
            const visibleLayers = this._getVisibleLayers();

            // Create new URL with layers parameter
            const url = new URL(window.location.href);

            // Set layers parameter with all visible layers including streetmap
            if (visibleLayers.length > 0) {
                url.searchParams.set('layers', visibleLayers.join(','));
            } else {
                url.searchParams.delete('layers');
            }

            // Create pretty URL by manually replacing encoded characters
            const prettyUrl = decodeURIComponent(url.toString())
                .replace(/\+/g, ' '); // Replace plus signs with spaces if needed

            // Update browser URL without reloading the page
            window.history.replaceState({}, '', prettyUrl);

            // Copy to clipboard
            navigator.clipboard.writeText(prettyUrl).then(() => {
                // Show toast notification
                this._showToast('Link copied to clipboard!');

                // Generate QR code using the pretty URL
                const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(prettyUrl)}`;

                // Create QR code image for button
                const qrCode = document.createElement('img');
                qrCode.src = qrCodeUrl;
                qrCode.alt = 'QR Code';
                qrCode.style.width = '30px';
                qrCode.style.height = '30px';
                qrCode.style.cursor = 'pointer';

                // Store original button content
                const originalContent = shareButton.innerHTML;

                // Replace button content with QR code
                shareButton.innerHTML = '';
                shareButton.appendChild(qrCode);

                // Add click handler to QR code to show full screen overlay
                qrCode.addEventListener('click', (e) => {
                    e.stopPropagation();

                    // Reset button content immediately when QR code is viewed
                    shareButton.innerHTML = originalContent;

                    // Create full screen overlay
                    const overlay = document.createElement('div');
                    overlay.style.position = 'fixed';
                    overlay.style.top = '0';
                    overlay.style.left = '0';
                    overlay.style.width = '100%';
                    overlay.style.height = '100%';
                    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
                    overlay.style.display = 'flex';
                    overlay.style.justifyContent = 'center';
                    overlay.style.alignItems = 'center';
                    overlay.style.zIndex = '9999';
                    overlay.style.cursor = 'pointer';
                    overlay.style.padding = '10px'; // Add padding to ensure some space from edges

                    // Create large QR code
                    const largeQRCode = document.createElement('img');
                    largeQRCode.src = qrCodeUrl; // Use the same high-res QR code
                    largeQRCode.alt = 'QR Code';
                    largeQRCode.style.width = 'auto';
                    largeQRCode.style.height = 'auto';
                    largeQRCode.style.maxWidth = 'min(500px, 90vw)'; // Use the smaller of 500px or 90% viewport width
                    largeQRCode.style.maxHeight = '90vh'; // Maximum 90% of viewport height
                    largeQRCode.style.objectFit = 'contain'; // Maintain aspect ratio

                    // Close overlay when clicked
                    overlay.addEventListener('click', () => {
                        document.body.removeChild(overlay);
                    });

                    overlay.appendChild(largeQRCode);
                    document.body.appendChild(overlay);
                });

                // Auto-revert after 30 seconds (if user hasn't clicked the QR code)
                setTimeout(() => {
                    if (shareButton.contains(qrCode)) {
                        shareButton.innerHTML = originalContent;
                    }
                }, 30000);
            }).catch(err => {
                console.error('Failed to copy link:', err);
                this._showToast('Failed to copy link', 'error');
            });
        });
    }

    _showToast(message, type = 'success', duration = 3000) {
        // Create toast element if it doesn't exist
        let toast = document.querySelector('.toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast-notification';
            document.body.appendChild(toast);
        }

        // Set message and style based on type
        toast.textContent = message;
        toast.style.backgroundColor = type === 'success' ? '#4CAF50' :
            type === 'error' ? '#f44336' :
                type === 'info' ? '#2196F3' : '#4CAF50';

        // Show toast
        requestAnimationFrame(() => {
            toast.classList.add('show');

            // Hide toast after specified duration
            setTimeout(() => {
                toast.classList.remove('show');

                // Remove element after animation
                setTimeout(() => {
                    toast.remove();
                }, 300);
            }, duration);
        });
    }

    _getVisibleLayers() {
        const visibleLayers = [];

        this._sourceControls.forEach((groupHeader, index) => {
            const group = this._state.groups[index];
            const toggleInput = groupHeader?.querySelector('.toggle-switch input[type="checkbox"]');

            if (toggleInput && toggleInput.checked) {
                if (group.type === 'layer-group') {
                    // Find which radio button is selected in this group
                    const radioGroup = groupHeader?.querySelector('.radio-group');
                    const selectedRadio = radioGroup?.querySelector('input[type="radio"]:checked');
                    if (selectedRadio) {
                        visibleLayers.push(selectedRadio.value);
                    }
                } else {
                    // If this is a custom layer with original JSON, use that
                    if (group._originalJson) {
                        visibleLayers.push(group._originalJson);
                    } else {
                        visibleLayers.push(group.id);
                    }
                }
            } else {
                console.log('Layer not checked:', group.id, 'checked:', toggleInput?.checked);
            }
        });

        return visibleLayers;
    }

    /**
     * Set the state manager reference for layer registration
     */
    setStateManager(stateManager) {
        this._stateManager = stateManager;
        
        // Register all currently active layers with the state manager
        this._registerAllActiveLayers();
    }

    /**
     * Register all currently active layers with the state manager
     */
    _registerAllActiveLayers() {
        if (!this._stateManager) return;
        
        this._state.groups.forEach(group => {
            if (group.initiallyChecked) {
                // Register ALL initially checked layers (both inspectable and non-inspectable)
                this._registerLayerWithStateManager(group);
            }
        });
    }

    /**
     * Register a layer with the state manager when it becomes active
     */
    _registerLayerWithStateManager(layerConfig) {
        if (!this._stateManager) {
            return;
        }
        
        // Register ALL visible layers (both inspectable and non-inspectable)
        // This allows the feature control to show all visible layers
        // Non-inspectable layers will be displayed but won't have expand/collapse functionality
        
        // For non-inspectable layers, we still want to register them for visibility tracking
        // but we don't need to validate matching layers for raster/style layers
        const nonInteractiveTypes = ['raster', 'style', 'terrain', 'layer-group'];
        if (nonInteractiveTypes.includes(layerConfig.type)) {
            // Register without validation for non-interactive layers
            this._stateManager.registerLayer(layerConfig);
            return;
        }
        
        // For potentially interactive layers, pre-validate that this layer has matching layers 
        // in the map style to avoid unnecessary registrations and console noise
        if (!this._hasMatchingLayers(layerConfig)) {
            // Still register for visibility tracking even if no matching layers found
            this._stateManager.registerLayer(layerConfig);
            return;
        }
        
        this._stateManager.registerLayer(layerConfig);
    }

    /**
     * Check if a layer config has matching layers in the current map style
     */
    _hasMatchingLayers(layerConfig) {
        const style = this._map.getStyle();
        if (!style.layers) return false;
        
        const layerId = layerConfig.id;
        
        // Strategy 1: Direct ID match
        if (style.layers.some(l => l.id === layerId)) {
            return true;
        }
        
        // Strategy 2: Prefix matches (for geojson layers)
        if (style.layers.some(l => l.id.startsWith(layerId + '-') || l.id.startsWith(layerId + ' '))) {
            return true;
        }
        
        // Strategy 3: Source layer matches (for vector layers)
        if (layerConfig.sourceLayer) {
            if (style.layers.some(l => l['source-layer'] === layerConfig.sourceLayer)) {
                return true;
            }
        }
        
        // Strategy 4: Source matches (for vector tile sources)
        if (layerConfig.source) {
            if (style.layers.some(l => l.source === layerConfig.source)) {
                return true;
            }
        }
        
        // Strategy 5: Legacy source layers array
        if (layerConfig.sourceLayers && Array.isArray(layerConfig.sourceLayers)) {
            if (style.layers.some(l => l['source-layer'] && layerConfig.sourceLayers.includes(l['source-layer']))) {
                return true;
            }
        }
        
        // Strategy 6: Grouped layers
        if (layerConfig.layers && Array.isArray(layerConfig.layers)) {
            return layerConfig.layers.some(subLayer => {
                if (subLayer.sourceLayer) {
                    return style.layers.some(l => l['source-layer'] === subLayer.sourceLayer);
                }
                return false;
            });
        }
        
        // Strategy 7: GeoJSON source matching (enhanced)
        if (layerConfig.type === 'geojson') {
            const sourceId = `geojson-${layerId}`;
            
            // Check for source match
            if (style.layers.some(l => l.source === sourceId)) {
                return true;
            }
            
            // Check for specific geojson layer patterns
            const geojsonLayerPatterns = [
                `${sourceId}-fill`,
                `${sourceId}-line`,
                `${sourceId}-circle`,
                `${sourceId}-symbol`
            ];
            
            if (geojsonLayerPatterns.some(pattern => 
                style.layers.some(l => l.id === pattern)
            )) {
                return true;
            }
        }
        
        // Strategy 8: CSV layer matching
        if (layerConfig.type === 'csv') {
            const sourceId = `csv-${layerId}`;
            if (style.layers.some(l => l.source === sourceId || l.id === `${sourceId}-circle`)) {
                return true;
            }
        }
        
        // Strategy 9: Vector layer matching (enhanced)
        if (layerConfig.type === 'vector') {
            const sourceId = `vector-${layerId}`;
            const vectorLayerPatterns = [
                `vector-layer-${layerId}`,
                `vector-layer-${layerId}-outline`,
                `vector-layer-${layerId}-text`
            ];
            
            if (style.layers.some(l => l.source === sourceId) || 
                vectorLayerPatterns.some(pattern => 
                    style.layers.some(l => l.id === pattern)
                )) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Unregister a layer with the state manager when it becomes inactive
     */
    /**
     * Unregister a layer with the state manager using the correct layer ID
     */
    _unregisterLayerWithCorrectId(group) {
        if (!this._stateManager) {
            return;
        }
        
        // Always use the group ID as the key for unregistration since that's what we register with
        this._stateManager.unregisterLayer(group.id);
    }

    _unregisterLayerWithStateManager(layerId) {
        if (this._stateManager) {
            // Only unregister if the layer is actually registered
            // Check using the state manager's getLayerConfig method (works for all layer types)
            if (this._stateManager.getLayerConfig(layerId)) {
                this._stateManager.unregisterLayer(layerId);
            }
        }
    }

    _initializeControl($container) {

        this._state.groups.forEach((group, groupIndex) => {
            const $groupHeader = $('<sl-details>', {
                class: 'group-header w-full map-controls-group',
                open: group.initiallyChecked || false
            });
            this._sourceControls[groupIndex] = $groupHeader[0];

            // Create buttons first so they can be referenced in event handlers
            const $settingsButton = $('<sl-icon-button>', {
                name: 'gear-fill',
                class: 'settings-button ml-auto hidden', // Add hidden class by default
                label: 'Layer Settings'
            });

            const $opacityButton = ['tms', 'vector', 'geojson', 'layer-group', 'img', 'raster-style-layer'].includes(group.type)
                ? $('<sl-icon-button>', {
                    class: 'opacity-toggle hidden',
                    'data-opacity': '0.4',
                    title: 'Toggle opacity',
                    name: 'lightbulb-fill',
                    'font-size': '2.5rem'
                }).css({
                    '--sl-color-neutral-600': '#ffffff',
                    '--sl-color-primary-600': 'currentColor',
                    '--sl-color-primary-500': 'currentColor',
                    'color': '#ffffff'
                })
                : $('<span>');

            // Update the sl-show/hide event handlers to handle both opacity and settings buttons
            $groupHeader[0].addEventListener('sl-show', (event) => {
                const group = this._state.groups[groupIndex];
                const toggleInput = event.target.querySelector('.toggle-switch input[type="checkbox"]');

                if (toggleInput && !toggleInput.checked) {
                    toggleInput.checked = true;
                }

                if (group.type === 'style') {
                    // Update sublayer toggles
                    const $sublayerToggles = $(event.target).find('.layer-controls .toggle-switch input[type="checkbox"]');
                    $sublayerToggles.prop('checked', true);

                    // Update layer visibility
                    if (group.layers) {
                        const styleLayers = this._map.getStyle().layers;
                        group.layers.forEach(layer => {
                            const layerIds = styleLayers
                                .filter(styleLayer => styleLayer['source-layer'] === layer.sourceLayer)
                                .map(styleLayer => styleLayer.id);

                            layerIds.forEach(layerId => {
                                if (this._map.getLayer(layerId)) {
                                    this._map.setLayoutProperty(layerId, 'visibility', 'visible');
                                }
                            });
                        });
                    }
                } else {
                    this._toggleSourceControl(groupIndex, true);
                }

                // Show both opacity and settings buttons
                $opacityButton.toggleClass('hidden', false);
                $settingsButton.toggleClass('hidden', false);
                $(event.target).closest('.group-header').addClass('active');
            });

            $groupHeader[0].addEventListener('sl-hide', (event) => {
                const group = this._state.groups[groupIndex];
                const toggleInput = event.target.querySelector('.toggle-switch input[type="checkbox"]');

                if (toggleInput && toggleInput.checked) {
                    toggleInput.checked = false;
                }

                if (group.type === 'style') {
                    // Update sublayer toggles
                    const $sublayerToggles = $(event.target).find('.layer-controls .toggle-switch input[type="checkbox"]');
                    $sublayerToggles.prop('checked', false);

                    // Update layer visibility
                    if (group.layers) {
                        const styleLayers = this._map.getStyle().layers;
                        group.layers.forEach(layer => {
                            const layerIds = styleLayers
                                .filter(styleLayer => styleLayer['source-layer'] === layer.sourceLayer)
                                .map(styleLayer => styleLayer.id);

                            layerIds.forEach(layerId => {
                                if (this._map.getLayer(layerId)) {
                                    this._map.setLayoutProperty(layerId, 'visibility', 'none');
                                }
                            });
                        });
                    }
                } else {
                    this._toggleSourceControl(groupIndex, false);
                }

                // Hide both opacity and settings buttons
                $opacityButton.toggleClass('hidden', true);
                $settingsButton.toggleClass('hidden', true);
                $(event.target).closest('.group-header').removeClass('active');
            });

            // Initialize visibility based on initial state
            if (group.initiallyChecked) {
                // Set active class based on initial state
                $groupHeader.addClass('active');

                // Use requestAnimationFrame to ensure DOM is ready
                requestAnimationFrame(() => {
                    this._toggleSourceControl(groupIndex, true);
                    if (['tms', 'vector', 'geojson', 'layer-group', 'img', 'raster-style-layer'].includes(group.type)) {
                        $opacityButton.toggleClass('hidden', false);
                        $settingsButton.toggleClass('hidden', false);
                    }
                });
            } else {
                // Ensure layers and buttons are hidden if not initially checked
                requestAnimationFrame(() => {
                    this._toggleSourceControl(groupIndex, false);
                    $opacityButton.toggleClass('hidden', true);
                    $settingsButton.toggleClass('hidden', true);
                });
            }

            // Add empty slots to remove the icons
            $groupHeader.append(
                $('<span>', { slot: 'expand-icon' }),
                $('<span>', { slot: 'collapse-icon' })
            );

            const $summary = $('<div>', {
                slot: 'summary',
                class: 'flex items-center relative w-full h-12 bg-gray-800'
            });

            // Add a click handler to the summary to control how clicks are processed
            $summary.on('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Always handle the click through our custom logic
                const $toggle = $summary.find('.toggle-switch input');
                const newState = !$toggle.prop('checked');

                // Update the toggle state
                $toggle.prop('checked', newState);

                // For style layers, handle visibility directly
                if (group.type === 'style') {
                    // Update sl-details state
                    $groupHeader[0].open = newState;

                    // Update sublayer toggles
                    const $sublayerToggles = $groupHeader.find('.layer-controls .toggle-switch input[type="checkbox"]');
                    $sublayerToggles.prop('checked', newState);

                    // Update layer visibility
                    if (group.layers) {
                        const styleLayers = this._map.getStyle().layers;
                        group.layers.forEach(layer => {
                            const layerIds = styleLayers
                                .filter(styleLayer => styleLayer['source-layer'] === layer.sourceLayer)
                                .map(styleLayer => styleLayer.id);

                            layerIds.forEach(layerId => {
                                if (this._map.getLayer(layerId)) {
                                    this._map.setLayoutProperty(layerId, 'visibility', newState ? 'visible' : 'none');
                                }
                            });
                        });
                    }

                    // Update active class
                    $groupHeader.toggleClass('active', newState);
                } else {
                    // For non-style layers, trigger the change event
                    $toggle.trigger('change');
                }
            });

            const $contentWrapper = $('<div>', {
                class: 'flex items-center gap-2 relative z-10 w-full p-2'
            });

            // Replace checkbox with toggle switch
            const $toggleLabel = $('<label>', {
                class: 'toggle-switch'
            });

            const $toggleInput = $('<input>', {
                type: 'checkbox',
                checked: group.initiallyChecked || false
            }).on('change', (e) => {
                const isChecked = e.target.checked;
                const group = this._state.groups[groupIndex];

                // Special handling for style type layers
                if (group.type === 'style') {
                    // Update sl-details state
                    $groupHeader[0].open = isChecked;

                    // Update sublayer toggles to match parent visibility
                    const $sublayerToggles = $groupHeader.find('.layer-controls .toggle-switch input[type="checkbox"]');
                    $sublayerToggles.prop('checked', isChecked);

                    // Update layer visibility
                    if (group.layers) {
                        const styleLayers = this._map.getStyle().layers;
                        group.layers.forEach(layer => {
                            const layerIds = styleLayers
                                .filter(styleLayer => styleLayer['source-layer'] === layer.sourceLayer)
                                .map(styleLayer => styleLayer.id);

                            layerIds.forEach(layerId => {
                                if (this._map.getLayer(layerId)) {
                                    this._map.setLayoutProperty(layerId, 'visibility', isChecked ? 'visible' : 'none');
                                }
                            });
                        });
                    }
                } else {
                    // Existing handling for non-style layers
                    if (isChecked !== $groupHeader[0].open) {
                        const self = this;
                        const handler = function (event) {
                            const checked = event.target.checked;
                            if (checked !== $groupHeader[0].open) {
                                $toggleInput.off('change', handler);
                                $groupHeader[0].open = checked;
                                setTimeout(() => {
                                    $toggleInput.on('change', handler);
                                }, 0);
                            }
                            $groupHeader.toggleClass('active', checked);
                        };
                        handler.call(this, e);
                    }
                }

                // Update active class
                $groupHeader.toggleClass('active', isChecked);
            });

            const $toggleSlider = $('<span>', {
                class: 'toggle-slider'
            });

            $toggleLabel.append($toggleInput, $toggleSlider);

            const $titleSpan = $('<span>', {
                text: group.title,
                class: 'control-title text-sm font-medium font-bold text-white'
            });

            // Simplify the toggle title container to just hold the elements
            const $toggleTitleContainer = $('<div>', {
                class: 'flex items-center gap-2 cursor-pointer'
            });
            $toggleTitleContainer.append($toggleLabel, $titleSpan);

            // Add click handler directly to the settings button
            $settingsButton[0].addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._showLayerSettings(group);
            });

            // Update the order of buttons in the content wrapper
            $contentWrapper.append($toggleTitleContainer, $settingsButton, $opacityButton);

            $opacityButton[0]?.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const currentOpacity = parseFloat($opacityButton.attr('data-opacity'));
                // Toggle between 0.4 (40%) and 0.9 (90%)
                const newOpacityFactor = currentOpacity === 0.4 ? 0.9 : 0.4;
                $opacityButton.attr('data-opacity', newOpacityFactor);
                $opacityButton.title = `Toggle opacity`;
                $opacityButton.attr('name', newOpacityFactor === 0.9 ? 'lightbulb-fill' : 'lightbulb');

                if (group.type === 'vector') {
                    const layerConfig = group._layerConfig;
                    if (!layerConfig) return;

                    if (layerConfig.hasFillStyles) {
                        this._map.setPaintProperty(`vector-layer-${group.id}`, 'fill-opacity', (group._baseFillOpacity || 1) * newOpacityFactor);
                    }
                    if (layerConfig.hasLineStyles) {
                        this._map.setPaintProperty(`vector-layer-${group.id}-outline`, 'line-opacity', (group._baseLineOpacity || 1) * newOpacityFactor);
                    }
                    if (layerConfig.hasTextStyles) {
                        const baseTextOpacity = group.style?.['text-opacity'] || this._defaultStyles.vector.text['text-opacity'];
                        if (Array.isArray(baseTextOpacity)) {
                            // For case expressions, modify the default opacity value (last item)
                            const modifiedOpacity = [...baseTextOpacity];
                            modifiedOpacity[modifiedOpacity.length - 1] = 0.7 * newOpacityFactor;
                            this._map.setPaintProperty(`vector-layer-${group.id}-text`, 'text-opacity', modifiedOpacity);
                        } else {
                            this._map.setPaintProperty(`vector-layer-${group.id}-text`, 'text-opacity', baseTextOpacity * newOpacityFactor);
                        }
                    }
                } else if (group.type === 'tms') {
                    const layerId = `tms-layer-${group.id}`;
                    if (this._map.getLayer(layerId)) {
                        this._map.setPaintProperty(layerId, 'raster-opacity', newOpacityFactor);
                    }
                } else if (group.type === 'img') {
                    // Add opacity toggle for 'img' layer type
                    if (this._map.getLayer(group.id)) {
                        this._map.setPaintProperty(group.id, 'raster-opacity', newOpacityFactor);
                    }
                } else if (group.type === 'raster-style-layer') {
                    // Add opacity toggle for 'raster-style-layer' type
                    const styleLayerId = group.styleLayer || group.id;
                    if (this._map.getLayer(styleLayerId)) {
                        const existingLayer = this._map.getLayer(styleLayerId);
                        if (existingLayer.type === 'raster') {
                            this._map.setPaintProperty(styleLayerId, 'raster-opacity', newOpacityFactor);
                        }
                    }
                } else if (group.type === 'geojson') {
                    // Add opacity toggle for 'geojson' layer type
                    const sourceId = `geojson-${group.id}`;
                    if (this._map.getLayer(`${sourceId}-fill`)) {
                        this._map.setPaintProperty(`${sourceId}-fill`, 'fill-opacity', newOpacityFactor * 0.5);
                    }
                    if (this._map.getLayer(`${sourceId}-line`)) {
                        this._map.setPaintProperty(`${sourceId}-line`, 'line-opacity', newOpacityFactor);
                    }
                    if (this._map.getLayer(`${sourceId}-label`)) {
                        this._map.setPaintProperty(`${sourceId}-label`, 'text-opacity', newOpacityFactor);
                    }
                    if (this._map.getLayer(`${sourceId}-circle`)) {
                        this._map.setPaintProperty(`${sourceId}-circle`, 'circle-opacity', newOpacityFactor);
                    }
                }
            });

            // Add header background if exists
            if (group.headerImage) {
                const $headerBg = $('<div>', {
                    class: 'absolute top-0 left-0 right-0 w-full h-full bg-cover bg-center bg-no-repeat',
                    style: `background-image: url('${group.headerImage}')`
                });

                const $headerOverlay = $('<div>', {
                    class: 'absolute top-0 left-0 right-0 w-full h-full bg-black bg-opacity-40'
                });

                $summary.append($headerBg, $headerOverlay, $contentWrapper);
            } else {
                $summary.append($contentWrapper);
            }

            // Add source control to sl-details content
            const $sourceControl = $('<div>', {
                class: 'source-control mt-3 terrain-control-container'
            });

            $container.append($groupHeader);

            if (group.description) {
                const $description = $('<div>', {
                    class: 'text-sm text-gray-600',
                    html: group.description  // Using html instead of text to allow HTML in descriptions
                });
                // Add description directly after the group header content
                const $contentArea = $('<div>', { class: 'description-area' });
                $contentArea.append($description);
                $groupHeader.append($contentArea);
            }

            // Add attribution with proper styling
            if (group.attribution) {
                const $attribution = $('<div>', {
                    class: 'layer-attribution',
                    html: `Source: ${group.attribution.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ')}`
                });

                // Add attribution to description area
                const $descriptionArea = $groupHeader.find('.description-area');
                if ($descriptionArea.length) {
                    $descriptionArea.append($attribution);
                } else {
                    const $newDescriptionArea = $('<div>', { class: 'description-area' });
                    $newDescriptionArea.append($attribution);
                    $groupHeader.append($newDescriptionArea);
                }
            }

            if (group.type === 'layer-group') {
                const $radioGroup = $('<div>', { class: 'radio-group mt-2' });
                const $contentArea = $('<div>');

                group.groups.forEach((subGroup, index) => {
                    const $radioLabel = $('<label>', { class: 'radio-label' });
                    const $radio = $('<input>', {
                        type: 'radio',
                        name: `layer-group-${this._instanceId}-${groupIndex}`,
                        value: subGroup.id,
                        checked: index === 0
                    });

                    $radio.on('change', () => this._handleLayerGroupChange(subGroup.id, group.groups));

                    $radioLabel.append(
                        $radio,
                        $('<span>', { text: subGroup.title })
                    );
                    $radioGroup.append($radioLabel);

                    if (subGroup.attribution || subGroup.location) {
                        const links = [];
                        if (subGroup.attribution) {
                            links.push(`<a href="${subGroup.attribution}" target="_blank" class="hover:underline">Source</a>`);
                        }
                        if (subGroup.location) {
                            links.push(`<a href="#" class="hover:underline view-link" data-location="${subGroup.location}">View</a>`);
                        }

                        const $infoDiv = $('<div>', {
                            class: 'layer-info text-xs pl-5 text-gray-600',
                            html: links.join(' | ')
                        });

                        $infoDiv.find('.view-link').on('click', (e) => {
                            e.preventDefault();
                            this._flyToLocation(subGroup.location);
                        });

                        $radioLabel.append($infoDiv);
                    }
                });

                // Add radio group to content area
                $contentArea.append($radioGroup);

                // Add content area to sl-details
                $groupHeader.append($contentArea);
            } else if (group.type === 'geojson') {
                // Don't add GeoJSON source and layers here - will be loaded when toggled on
            } else if (group.type === 'terrain') {
                const $sliderContainer = $('<div>', {
                    class: 'terrain-settings-section' // Add terrain-settings-section class
                });

                const $contoursContainer = $('<div>', { class: 'mb-4' });
                const $contoursLabel = $('<label>', { class: 'flex items-center' });

                // Replace checkbox with toggle switch
                const $contoursToggleLabel = $('<label>', {
                    class: 'toggle-switch mr-2'
                });

                const $contoursToggleInput = $('<input>', {
                    type: 'checkbox',
                    checked: false
                });

                const $contoursToggleSlider = $('<span>', {
                    class: 'toggle-slider'
                });

                $contoursToggleLabel.append($contoursToggleInput, $contoursToggleSlider);

                $contoursToggleInput.on('change', (e) => {
                    const contourLayers = [
                        'contour lines',
                        'contour labels'
                    ];

                    contourLayers.forEach(layerId => {
                        if (this._map.getLayer(layerId)) {
                            this._map.setLayoutProperty(
                                layerId,
                                'visibility',
                                e.target.checked ? 'visible' : 'none'
                            );
                        }
                    });
                });

                $contoursLabel.append(
                    $contoursToggleLabel,
                    $('<span>', {
                        class: 'text-sm text-gray-700',
                        text: 'Contours'
                    })
                );

                $contoursContainer.append($contoursLabel);
                $sourceControl.append($contoursContainer);
                $groupHeader.append($sourceControl);

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

                const $fogContainer = $('<div>', { class: 'mt-4' });
                const $fogSlider = $('<div>', { class: 'fog-range-slider' });

                const $fogStartSlider = $('<input>', {
                    type: 'range',
                    id: `fog-start-${this._instanceId}`,
                    min: '-20',
                    max: '20',
                    step: '0.5',
                    value: '0',
                    class: 'w-full'
                });

                const $fogEndSlider = $('<input>', {
                    type: 'range',
                    id: `fog-end-${this._instanceId}`,
                    min: '-20',
                    max: '20',
                    step: '0.5',
                    value: '10',
                    class: 'w-full'
                });

                const $fogValue = $('<span>', {
                    class: 'text-sm text-gray-600 ml-2',
                    text: '[0, 10]'
                });

                const $horizonContainer = $('<div>', { class: 'mt-4' });
                const $horizonSlider = $('<input>', {
                    type: 'range',
                    id: `horizon-blend-${this._instanceId}`,
                    min: '0',
                    max: '1',
                    step: '0.01',
                    value: '0.3',
                    class: 'w-full'
                });

                const $horizonValue = $('<span>', {
                    class: 'text-sm text-gray-600 ml-2',
                    text: '0.3'
                });

                const $colorContainer = $('<div>', { class: 'mt-4' });
                const $colorPicker = $('<input>', {
                    type: 'color',
                    id: `fog-color-${this._instanceId}`,
                    value: '#ffffff',
                    class: 'w-8 h-8 rounded cursor-pointer'
                });

                const $colorValue = $('<span>', {
                    class: 'text-sm text-gray-600 ml-2',
                    text: '#ffffff'
                });

                const $highColorPicker = $('<input>', {
                    type: 'color',
                    id: `fog-high-color-${this._instanceId}`,
                    value: '#add8e6',
                    class: 'w-8 h-8 rounded cursor-pointer'
                });

                const $highColorValue = $('<span>', {
                    class: 'text-sm text-gray-600 ml-2',
                    text: '#add8e6'
                });

                const $spaceColorPicker = $('<input>', {
                    type: 'color',
                    id: `fog-space-color-${this._instanceId}`,
                    value: '#d8f2ff',
                    class: 'w-8 h-8 rounded cursor-pointer'
                });

                const $spaceColorValue = $('<span>', {
                    class: 'text-sm text-gray-600 ml-2',
                    text: '#d8f2ff'
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

                const updateFog = () => {
                    const start = parseFloat($fogStartSlider.val());
                    const end = parseFloat($fogEndSlider.val());
                    const horizonBlend = parseFloat($horizonSlider.val());
                    const fogColor = $colorPicker.val();
                    const highColor = $highColorPicker.val();
                    const spaceColor = $spaceColorPicker.val();

                    $fogValue.text(`[${start.toFixed(1)}, ${end.toFixed(1)}]`);

                    if (this._map.getFog()) {
                        this._map.setFog({
                            'range': [start, end],
                            'horizon-blend': horizonBlend,
                            'color': fogColor,
                            'high-color': highColor,
                            'space-color': spaceColor,
                            'star-intensity': 0.0
                        });
                    }
                };

                $fogStartSlider.on('input', (e) => {
                    const start = parseFloat(e.target.value);
                    const end = parseFloat($fogEndSlider.val());
                    if (start < end) {
                        updateFog();
                    }
                });

                $fogEndSlider.on('input', (e) => {
                    const start = parseFloat($fogStartSlider.val());
                    const end = parseFloat(e.target.value);
                    if (end > start) {
                        updateFog();
                    }
                });

                $horizonSlider.on('input', (e) => {
                    const value = parseFloat(e.target.value);
                    $horizonValue.text(value.toFixed(2));
                    updateFog();
                });

                $colorPicker.on('input', (e) => {
                    const color = e.target.value;
                    $colorValue.text(color);
                    updateFog();
                });

                $highColorPicker.on('input', (e) => {
                    const color = e.target.value;
                    $highColorValue.text(color);
                    updateFog();
                });

                $spaceColorPicker.on('input', (e) => {
                    const color = e.target.value;
                    $spaceColorValue.text(color);
                    updateFog();
                });

                $sliderContainer.append(
                    $('<label>', {
                        class: 'block text-sm text-gray-700 mb-1',
                        text: 'Terrain Exaggeration'
                    }),
                    $('<div>', { class: 'flex items-center' }).append($exaggerationSlider, $exaggerationValue)
                );

                $fogContainer.append(
                    $('<label>', {
                        class: 'block text-sm text-gray-700 mb-1',
                        text: 'Fog Range'
                    }),
                    $fogSlider.append($fogStartSlider, $fogEndSlider),
                    $('<div>', { class: 'flex items-center' }).append($fogValue)
                );

                $horizonContainer.append(
                    $('<label>', {
                        class: 'block text-sm text-gray-700 mb-1',
                        text: 'Horizon Blend'
                    }),
                    $('<div>', { class: 'flex items-center' }).append($horizonSlider, $horizonValue)
                );

                $colorContainer.append(
                    $('<label>', {
                        class: 'block text-sm text-gray-700 mb-2', // Increase bottom margin
                        text: 'Fog Color'
                    }),
                    $('<div>', { class: 'flex items-center mb-3' }).append($colorPicker, $colorValue), // Add bottom margin

                    $('<label>', {
                        class: 'block text-sm text-gray-700 mb-2', // Increase bottom margin
                        text: 'High Color'
                    }),
                    $('<div>', { class: 'flex items-center mb-3' }).append($highColorPicker, $highColorValue), // Add bottom margin

                    $('<label>', {
                        class: 'block text-sm text-gray-700 mb-2', // Increase bottom margin
                        text: 'Space Color'
                    }),
                    $('<div>', { class: 'flex items-center' }).append($spaceColorPicker, $spaceColorValue)
                );

                // Update the fog settings container and controls
                const $fogSettingsContainer = $('<div>', {
                    class: 'mt-4 mb-4' // Add bottom margin
                });

                const $fogSettingsLabel = $('<label>', {
                    class: 'flex items-center mb-2' // Add margin bottom
                });

                const $fogSettingsCheckbox = $('<input>', {
                    type: 'checkbox',
                    class: 'mr-2',
                    checked: false
                });

                $fogSettingsLabel.append(
                    $fogSettingsCheckbox,
                    $('<span>', {
                        class: 'text-sm text-gray-700',
                        text: 'Fog Settings'
                    })
                );

                // Update the fog settings content container
                const $fogSettingsContent = $('<div>', {
                    class: 'fog-settings-content mt-2 hidden pb-4 terrain-settings-section' // Add terrain-settings-section class
                });

                $fogSettingsContent.append(
                    $fogContainer,
                    $horizonContainer,
                    $colorContainer
                );

                // Add the toggle behavior back
                $fogSettingsCheckbox.on('change', (e) => {
                    $fogSettingsContent.toggleClass('hidden', !e.target.checked);
                });

                // Append everything to the container
                $fogSettingsContainer.append($fogSettingsLabel, $fogSettingsContent);

                $sourceControl.append(
                    $sliderContainer,
                    $fogSettingsContainer
                );
            } else if (group.type === 'tms') {
                const sourceId = `tms-${group.id}`;
                const layerId = `tms-layer-${group.id}`;

                if (!this._map.getSource(sourceId)) {
                    // Check if it's a Mapbox hosted raster tileset
                    if (group.url.startsWith('mapbox://')) {
                        this._map.addSource(sourceId, {
                            type: 'raster',
                            url: group.url,  // Keep the mapbox:// URL as is
                            tileSize: 256,
                            maxzoom: group.maxzoom || 22,
                        });
                    } else {
                        this._map.addSource(sourceId, {
                            type: 'raster',
                            tiles: [group.url],
                            tileSize: 256,
                            maxzoom: group.maxzoom || 22,
                        });
                    }

                    // Create layer config using the new flexible style system
                    const layerConfig = this._createLayerConfig({
                        id: layerId,
                        source: sourceId,
                        style: {
                            // Merge default raster styles with user-defined styles
                            ...(this._defaultStyles.raster || {}),
                            ...(group.style || {}),
                            // Fallback to legacy opacity property if no raster-opacity is specified
                            'raster-opacity': group.style?.['raster-opacity'] || group.opacity || this._defaultStyles.raster?.['raster-opacity'] || 1
                        },
                        initiallyChecked: false // Always start hidden in _initializeLayers
                    }, 'raster');

                    this._map.addLayer(layerConfig, this._getInsertPosition('tms'));
                }
            } else if (group.type === 'vector') {
                const sourceId = `vector-${group.id}`;
                const hasFillStyles = group.style && (group.style['fill-color'] || group.style['fill-opacity']);
                const hasLineStyles = group.style && (group.style['line-color'] || group.style['line-width']);

                // Determine the main layer ID based on the primary style type
                const mainLayerId = hasFillStyles ? `vector-layer-${group.id}` : `vector-layer-${group.id}-outline`;

                if (!this._map.getSource(sourceId)) {
                    // Check if it's a Mapbox hosted tileset
                    if (group.url.startsWith('mapbox://')) {
                        this._map.addSource(sourceId, {
                            type: 'vector',
                            url: group.url,  // Keep the mapbox:// URL as is
                            maxzoom: group.maxzoom || 22,
                            promoteId: {
                                [group.sourceLayer]: group.inspect?.id // Add this line for vector tiles
                            }
                        });
                    } else {
                        // Handle other vector tile sources
                        this._map.addSource(sourceId, {
                            type: 'vector',
                            tiles: [group.url],
                            maxzoom: group.maxzoom || 22,
                            promoteId: {
                                [group.sourceLayer]: group.inspect?.id // Add this line for vector tiles
                            }
                        });
                    }

                    // Only add fill layer if fill styles are defined
                    if (hasFillStyles) {
                        const fillLayerConfig = {
                            id: `vector-layer-${group.id}`,
                            type: 'fill',
                            source: sourceId,
                            'source-layer': group.sourceLayer || 'default',
                            layout: {
                                visibility: 'none'
                            },
                            paint: {
                                'fill-color': this._combineWithDefaultStyle(group.style?.['fill-color'], this._defaultStyles.vector.fill['fill-color']),
                                'fill-opacity': group.style?.['fill-opacity'] || this._defaultStyles.vector.fill['fill-opacity']
                            },
                            metadata: {
                                groupId: group.id,
                                layerType: 'fill'
                            }
                        };

                        // Only add filter if it's defined
                        if (group.filter) {
                            fillLayerConfig.filter = group.filter;
                        }

                        this._map.addLayer(fillLayerConfig, this._getInsertPosition('vector', 'fill'));
                    }

                    // Add line layer if line styles are defined
                    if (hasLineStyles) {
                        const lineLayerConfig = {
                            id: `vector-layer-${group.id}-outline`,
                            type: 'line',
                            source: sourceId,
                            'source-layer': group.sourceLayer || 'default',
                            layout: {
                                visibility: 'none'
                            },
                            paint: {
                                'line-color': this._combineWithDefaultStyle(group.style?.['line-color'], this._defaultStyles.vector.line['line-color']),
                                'line-width': group.style?.['line-width'] || this._defaultStyles.vector.line['line-width'],
                                'line-opacity': group.style?.['line-opacity'] || this._defaultStyles.vector.line['line-opacity']
                            }
                        };

                        // Only add filter if it's defined
                        if (group.filter) {
                            lineLayerConfig.filter = group.filter;
                        }

                        this._map.addLayer(lineLayerConfig, this._getInsertPosition('vector', 'line'));
                    }

                    // Add text layer if text styles are defined
                    if (group.style?.['text-field']) {
                        // Use the proper style categorization to handle all properties correctly
                        const { paint: textPaint, layout: textLayout } = this._categorizeStyleProperties(group.style, 'symbol');

                        const textLayerConfig = {
                            id: `vector-layer-${group.id}-text`,
                            type: 'symbol',
                            source: sourceId,
                            'source-layer': group.sourceLayer || 'default',
                            layout: {
                                // Default layout properties
                                'text-font': ['Open Sans Bold'],
                                'text-anchor': 'center',
                                'text-justify': 'center',
                                'text-allow-overlap': false,
                                'text-offset': [0, 0],
                                'text-transform': 'none',
                                'text-size': 12,
                                // Apply categorized layout properties (including text-padding)
                                ...textLayout
                            },
                            paint: {
                                // Default paint properties
                                'text-color': '#000000',
                                'text-halo-color': '#ffffff',
                                'text-halo-width': 1,
                                'text-halo-blur': 1,
                                'text-opacity': [
                                    'case',
                                    ['boolean', ['feature-state', 'selected'], false],
                                    1,
                                    ['boolean', ['feature-state', 'hover'], false],
                                    0.9,
                                    0.7
                                ],
                                // Apply categorized paint properties
                                ...textPaint
                            }
                        };

                        // Only add filter if it's defined
                        if (group.filter) {
                            textLayerConfig.filter = group.filter;
                        }

                        this._map.addLayer(textLayerConfig, this._getInsertPosition('vector', 'symbol'));
                    }

                    // Add inspect functionality if configured
                    if (group.inspect) {
                        const popup = new mapboxgl.Popup({
                            closeButton: true,
                            closeOnClick: true
                        });

                        const hoverPopup = new mapboxgl.Popup({
                            closeButton: false,
                            closeOnClick: false,
                            className: 'hover-popup'
                        });

                        let hoveredFeatureId = null;
                        let selectedFeatureId = null;

                        // Add event listeners to both fill and line layers if they exist
                        const layerIds = [];
                        if (hasFillStyles) layerIds.push(`vector-layer-${group.id}`);
                        if (hasLineStyles) layerIds.push(`vector-layer-${group.id}-outline`);
                        if (group.style?.['text-field']) layerIds.push(`vector-layer-${group.id}-text`);

                        this._setupLayerInteractivity(group, layerIds, sourceId);
                    }
                }

                // Store the layer configuration for later use
                group._layerConfig = {
                    hasFillStyles,
                    hasLineStyles,
                    hasTextStyles: !!group.style?.['text-field'],
                    mainLayerId
                };
            } else if (group.type === 'markers' && group.dataUrl) {
                // Markers are now loaded on demand when the user toggles them on
                // The actual loading happens in _toggleSourceControl
            } else if (group.type === 'csv') {
                // Don't set up CSV layer yet - will be loaded when toggled on
            } else if (group.type === 'img') {
                // Don't create image source and layer here
                // Will be loaded on-demand when toggled on in _toggleSourceControl

                // If configured to be initially checked/visible, toggle it on
                if (group.initiallyChecked) {
                    // Use requestAnimationFrame to ensure DOM is fully initialized
                    requestAnimationFrame(() => {
                        this._toggleSourceControl(groupIndex, true);
                    });
                }

                // Check for "layers" URL parameter
                const urlParams = new URLSearchParams(window.location.search);
                if (urlParams.get('layers')) {
                    const activeLayers = urlParams.get('layers').split(',').map(s => s.trim());
                    // If layer is in URL parameter list, toggle it on
                    if (activeLayers.includes(group.id)) {
                        requestAnimationFrame(() => {
                            this._toggleSourceControl(groupIndex, true);
                        });
                    }
                }

                // Create the UI toggle for the image layer
                const $layerToggle = $('<div>', {
                    class: 'layer-toggle',
                    'data-layer-id': group.id
                });

                const $checkbox = $('<input>', {
                    type: 'checkbox',
                    id: `layer-${this._instanceId}-${group.id}`,
                    checked: group.initiallyChecked
                });

                $checkbox.on('change', (e) => {
                    this._toggleSourceControl(groupIndex, e.target.checked);
                });

                const $label = $('<label>', {
                    for: `layer-${this._instanceId}-${group.id}`,
                    text: group.title
                });

                $layerToggle.append($checkbox, $label);
                $sourceControl.append($layerToggle);
            } else {
                const $radioGroup = $('<div>', { class: 'radio-group' });

                if (group.layers) {
                    group.layers.forEach((layer, index) => {
                        const $radioLabel = $('<label>', { class: 'radio-label' });
                        const $radio = $('<input>', {
                            type: 'radio',
                            name: `layer-group-${this._instanceId}-${groupIndex}`,
                            value: layer.id,
                            checked: index === 0
                        });

                        $radio.on('change', () => this._handleLayerChange(layer.id, group.layers));

                        $radioLabel.append(
                            $radio,
                            $('<span>', { text: layer.label })
                        );
                        $radioGroup.append($radioLabel);
                    });

                    $sourceControl.append($radioGroup);
                }
            }

            // When rendering legend images, we need to check if it's a PDF and handle it differently
            if (group.legendImage) {
                $groupHeader.append(`
                    <div class="legend-container">
                        ${this._renderLegendImage(group.legendImage)}
                    </div>
                `);
            }

            // Add sublayer controls for style type
            if (group.type === 'style' && group.layers) {
                const $layerControls = $('<div>', {
                    class: 'layer-controls mt-3'
                });

                $layerControls.append(group.layers.map((layer, index) => {
                    const layerId = `sublayer-${groupIndex}-${index}`;
                    const $layerControl = $('<div>', {
                        class: 'flex items-center gap-2 text-black'
                    });

                    // Replace checkbox with toggle switch for sublayers
                    const $sublayerToggleLabel = $('<label>', {
                        class: 'toggle-switch'
                    });

                    const $sublayerToggleInput = $('<input>', {
                        type: 'checkbox',
                        id: layerId,
                        checked: group.initiallyChecked || false
                    });

                    const $sublayerToggleSlider = $('<span>', {
                        class: 'toggle-slider'
                    });

                    $sublayerToggleLabel.append($sublayerToggleInput, $sublayerToggleSlider);

                    // Add change event listener for the toggle
                    $sublayerToggleInput.on('change', (e) => {
                        const styleLayers = this._map.getStyle().layers;
                        const layersToToggle = styleLayers
                            .filter(styleLayer => styleLayer['source-layer'] === layer.sourceLayer)
                            .map(styleLayer => styleLayer.id);

                        layersToToggle.forEach(toggleLayerId => {
                            if (this._map.getLayer(toggleLayerId)) {
                                this._map.setLayoutProperty(
                                    toggleLayerId,
                                    'visibility',
                                    e.target.checked ? 'visible' : 'none'
                                );
                            }
                        });

                        // Notify feature control about layer visibility changes
                        // Layer visibility changed - register/unregister with state manager
                    });

                    // Create a clickable label that will toggle the switch
                    const $label = $('<label>', {
                        for: layerId,
                        class: 'text-sm cursor-pointer flex-grow'
                    }).text(layer.title).on('click', (e) => {
                        // Prevent default behavior to avoid double-toggling
                        e.preventDefault();

                        // Toggle the input and trigger change event
                        $sublayerToggleInput.prop('checked', !$sublayerToggleInput.prop('checked'));
                        $sublayerToggleInput.trigger('change');
                    });

                    $layerControl.append($sublayerToggleLabel, $label);
                    return $layerControl;
                }));

                $groupHeader.append($layerControls);
            }

            // Add this after creating the radio group for layer-group types
            if (group.type === 'layer-group' && group.initiallyChecked) {
                // Find which subgroup should be selected based on URL parameters
                const activeSubgroupId = group.groups.find(subgroup =>
                    activeLayers.includes(subgroup.id)
                )?.id || group.groups[0].id;

                // Set the correct radio button as checked
                requestAnimationFrame(() => {
                    const radioGroup = $groupHeader.find('.radio-group');
                    const radio = radioGroup.find(`input[value="${activeSubgroupId}"]`);
                    if (radio.length) {
                        radio.prop('checked', true);
                        this._handleLayerGroupChange(activeSubgroupId, group.groups);
                    }
                });
            }

            // Add contentWrapper to summary and summary to groupHeader
            $contentWrapper.append($toggleTitleContainer, $settingsButton, $opacityButton);
            $summary.append($contentWrapper);
            $groupHeader.append($summary);
        });

        if (!this._initialized) {
            this._initializeWithAnimation();
        }

        // Fix layer ordering after all layers have been initialized
        // We need to wait until the map is fully loaded and idle
        this._map.once('idle', () => {
            // Apply layer ordering fixes
            fixLayerOrdering(this._map);
        });
    }

    _initializeLayers() {
        this._state.groups.forEach(group => {
            if (!group.layers || group.type === 'terrain' || group.type === 'raster-style-layer') return;

            group.layers.forEach(layer => {
                if (this._map.getLayer(layer.id)) {
                    // Set initial visibility
                    this._map.setLayoutProperty(
                        layer.id,
                        'visibility',
                        'none'
                    );

                    // Apply filter if defined in group config
                    if (group.filter) {
                        this._map.setFilter(layer.id, group.filter);
                    }
                }
            });

            // Don't initialize CSV layers here - they'll be loaded on demand
            // when the user toggles them on
        });

        // Check if this is a vector layer type
        if (group.type === 'vector') {
            // Determine the geometry type of the layer based on style properties
            const hasLineStyle = group.style && ('line-color' in group.style || 'line-width' in group.style);
            const hasFillStyle = group.style && ('fill-color' in group.style || 'fill-opacity' in group.style);
            const hasCircleStyle = group.style && ('circle-color' in group.style || 'circle-radius' in group.style);

            // For layers with circle styles, add a circle layer
            if (hasCircleStyle) {
                // Add circle layer
                this.map.addLayer({
                    'id': `${layerId}-circle`,
                    'type': 'circle',
                    'source': sourceId,
                    'source-layer': group.sourceLayer,
                    'layout': {
                        'visibility': visible ? 'visible' : 'none'
                    },
                    'paint': {
                        'circle-radius': group.style['circle-radius'] || this._defaultStyles.vector.circle['circle-radius'],
                        'circle-color': group.style['circle-color'] || this._defaultStyles.vector.circle['circle-color'],
                        'circle-opacity': group.style['circle-opacity'] !== undefined ? group.style['circle-opacity'] : this._defaultStyles.vector.circle['circle-opacity'],
                        'circle-stroke-width': group.style['circle-stroke-width'] !== undefined ? group.style['circle-stroke-width'] : this._defaultStyles.vector.circle['circle-stroke-width'],
                        'circle-stroke-color': group.style['circle-stroke-color'] || this._defaultStyles.vector.circle['circle-stroke-color'],
                        'circle-stroke-opacity': group.style['circle-stroke-opacity'] !== undefined ? group.style['circle-stroke-opacity'] : this._defaultStyles.vector.circle['circle-stroke-opacity'],
                        'circle-blur': group.style['circle-blur'] !== undefined ? group.style['circle-blur'] : this._defaultStyles.vector.circle['circle-blur'],
                        'circle-translate': group.style['circle-translate'] || this._defaultStyles.vector.circle['circle-translate'],
                        'circle-translate-anchor': group.style['circle-translate-anchor'] || this._defaultStyles.vector.circle['circle-translate-anchor'],
                        'circle-pitch-alignment': group.style['circle-pitch-alignment'] || this._defaultStyles.vector.circle['circle-pitch-alignment'],
                        'circle-pitch-scale': group.style['circle-pitch-scale'] || this._defaultStyles.vector.circle['circle-pitch-scale']
                    },
                    'filter': group.filter || null
                }, this._getInsertPosition(group.type, 'circle'));

                // Add this layer to the list of layers that we setup interactivity for
                layerIds.push(`${layerId}-circle`);
            }

            // For line-only layers (like lineaments), we only need to add a line layer
            if (hasLineStyle && !hasFillStyle) {
                // Add line layer only
                this.map.addLayer({
                    'id': layerId,
                    'type': 'line',
                    'source': sourceId,
                    'source-layer': group.sourceLayer,
                    'layout': {
                        'visibility': visible ? 'visible' : 'none',
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    'paint': {
                        'line-color': group.style['line-color'] || 'black',
                        'line-width': group.style['line-width'] || 1,
                        'line-opacity': group.style['line-opacity'] !== undefined ? group.style['line-opacity'] : 1
                    },
                    'filter': group.filter || null
                }, this._getInsertPosition(group.type));

                this._setupLayerInteractivity(group, [layerId], sourceId);
            } else {
                // Add both fill and line layers as before for features with both types
                // ... existing fill and line layer code ...
            }
        }
    }

    _toggleSourceControl(groupIndex, visible) {
        const group = this._state.groups[groupIndex];
        this._currentGroup = group;

        // For non-visible layers, unregister immediately using the correct layer ID
        if (!visible) {
            this._unregisterLayerWithCorrectId(group);
        }
        
        // For visible layers, register AFTER the layers are added to the map
        // (this will be done at the end of this method)

        if (group.type === 'style') {
            // Get all style layers
            const styleLayers = this._map.getStyle().layers;

            // If group has specific layers defined, use those
            if (group.layers) {
                // Update sublayer toggles to match parent visibility
                const $groupHeader = $(this._sourceControls[groupIndex]);
                const $sublayerToggles = $groupHeader.find('.layer-controls .toggle-switch input[type="checkbox"]');
                $sublayerToggles.prop('checked', visible);

                group.layers.forEach(layer => {
                    const layerIds = styleLayers
                        .filter(styleLayer => styleLayer['source-layer'] === layer.sourceLayer)
                        .map(styleLayer => styleLayer.id);

                    layerIds.forEach(layerId => {
                        if (this._map.getLayer(layerId)) {
                            this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
                        }
                    });
                });
            }
            // If sourceLayers are defined, use those
            else if (group.sourceLayers) {
                styleLayers.forEach(layer => {
                    if (layer['source-layer'] && group.sourceLayers.includes(layer['source-layer'])) {
                        this._map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
                    }
                });
            }
            return; // Exit after handling style layers
        }

        if (group.type === 'style') {
            // Get all style layers
            const styleLayers = this._map.getStyle().layers;

            // If group has specific layers defined, use those
            if (group.layers) {
                group.layers.forEach(layer => {
                    const layerIds = styleLayers
                        .filter(styleLayer => styleLayer['source-layer'] === layer.sourceLayer)
                        .map(styleLayer => styleLayer.id);

                    layerIds.forEach(layerId => {
                        if (this._map.getLayer(layerId)) {
                            this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
                        }
                    });
                });
            }
            // If sourceLayers are defined, use those
            else if (group.sourceLayers) {
                styleLayers.forEach(layer => {
                    if (layer['source-layer'] && group.sourceLayers.includes(layer['source-layer'])) {
                        this._map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
                    }
                });
            }
            return; // Exit after handling style layers
        }

        if (group.type === 'layer-group') {
            group.groups.forEach(subGroup => {
                const allLayers = this._map.getStyle().layers
                    .map(layer => layer.id)
                    .filter(id =>
                        id === subGroup.id ||
                        id.startsWith(`${subGroup.id}-`) ||
                        id.startsWith(`${subGroup.id} `)
                    );
                this._updateLayerVisibility(allLayers, visible);
            });
        } else if (group.type === 'geojson') {
            const sourceId = `geojson-${group.id}`;

            // Only add source and layers if they don't exist yet and should be visible
            if (visible && !this._map.getSource(sourceId)) {
                // Determine data source - use inline data if available, otherwise use URL
                let dataSource;
                if (group.data) {
                    // Use inline data - handle both FeatureCollection and individual features
                    if (group.data.type === 'FeatureCollection') {
                        dataSource = group.data;
                    } else if (group.data.type === 'Feature') {
                        // Wrap individual feature in FeatureCollection
                        dataSource = {
                            type: 'FeatureCollection',
                            features: [group.data]
                        };
                    } else if (group.data.type && group.data.coordinates) {
                        // Handle raw geometry - wrap in Feature and FeatureCollection
                        dataSource = {
                            type: 'FeatureCollection',
                            features: [{
                                type: 'Feature',
                                geometry: group.data,
                                properties: {}
                            }]
                        };
                    } else {
                        console.error('Invalid GeoJSON data format in group:', group.id);
                        return;
                    }
                } else if (group.url) {
                    // Use URL as before
                    dataSource = group.url;
                } else {
                    console.error('GeoJSON layer missing both data and URL:', group.id);
                    return;
                }

                // Add source
                this._map.addSource(sourceId, {
                    type: 'geojson',
                    data: dataSource,
                    promoteId: group.inspect?.id
                });

                // Add fill layer
                this._map.addLayer({
                    id: `${sourceId}-fill`,
                    type: 'fill',
                    source: sourceId,
                    paint: {
                        'fill-color': group.style?.['fill-color'] || this._defaultStyles.geojson.fill['fill-color'],
                        'fill-opacity': [
                            'case',
                            ['boolean', ['feature-state', 'hover'], false],
                            0.8,
                            group.style?.['fill-opacity'] || this._defaultStyles.geojson.fill['fill-opacity']
                        ]
                    },
                    layout: {
                        visibility: 'visible'
                    }
                }, this._getInsertPosition('geojson', 'fill'));

                // Add line layer
                this._map.addLayer({
                    id: `${sourceId}-line`,
                    type: 'line',
                    source: sourceId,
                    paint: {
                        'line-color': this._combineWithDefaultStyle(group.style?.['line-color'], this._defaultStyles.geojson.line['line-color']),
                        'line-width': group.style?.['line-width'] || this._defaultStyles.geojson.line['line-width'],
                        'line-opacity': group.style?.['line-opacity'] !== undefined ? group.style['line-opacity'] : (this._defaultStyles.geojson.line['line-opacity'] || 1),
                        // Only set line-dasharray if it's defined to avoid undefined errors
                        ...(group.style?.['line-dasharray'] || this._defaultStyles.geojson.line?.['line-dasharray'] ?
                            { 'line-dasharray': group.style?.['line-dasharray'] || this._defaultStyles.geojson.line['line-dasharray'] } : {})
                    },
                    layout: {
                        'visibility': 'visible',
                        'line-join': 'round',
                        'line-cap': 'round'
                    }
                }, this._getInsertPosition('geojson', 'line'));

                // Add circle layer if circle properties are defined
                if (group.style?.['circle-radius'] || group.style?.['circle-color']) {
                    this._map.addLayer({
                        id: `${sourceId}-circle`,
                        type: 'circle',
                        source: sourceId,
                        paint: {
                            'circle-radius': group.style['circle-radius'] || this._defaultStyles.geojson.circle?.['circle-radius'] || 5,
                            'circle-color': group.style['circle-color'] || this._defaultStyles.geojson.circle?.['circle-color'] || '#FF0000',
                            'circle-opacity': group.style['circle-opacity'] !== undefined ? group.style['circle-opacity'] : (this._defaultStyles.geojson.circle?.['circle-opacity'] || 0.8),
                            'circle-stroke-width': group.style['circle-stroke-width'] !== undefined ? group.style['circle-stroke-width'] : (this._defaultStyles.geojson.circle?.['circle-stroke-width'] || 1),
                            'circle-stroke-color': group.style['circle-stroke-color'] || this._defaultStyles.geojson.circle?.['circle-stroke-color'] || '#FFFFFF',
                            'circle-stroke-opacity': group.style['circle-stroke-opacity'] !== undefined ? group.style['circle-stroke-opacity'] : (this._defaultStyles.geojson.circle?.['circle-stroke-opacity'] || 1),
                            'circle-blur': group.style['circle-blur'] !== undefined ? group.style['circle-blur'] : (this._defaultStyles.geojson.circle?.['circle-blur'] || 0),
                            'circle-translate': group.style['circle-translate'] || this._defaultStyles.geojson.circle?.['circle-translate'] || [0, 0],
                            'circle-translate-anchor': group.style['circle-translate-anchor'] || this._defaultStyles.geojson.circle?.['circle-translate-anchor'] || 'map',
                            'circle-pitch-alignment': group.style['circle-pitch-alignment'] || this._defaultStyles.geojson.circle?.['circle-pitch-alignment'] || 'viewport',
                            'circle-pitch-scale': group.style['circle-pitch-scale'] || this._defaultStyles.geojson.circle?.['circle-pitch-scale'] || 'map'
                        },
                        layout: {
                            'visibility': 'visible'
                        }
                    }, this._getInsertPosition('geojson', 'circle'));
                }

                // Add text layer if text properties are defined
                if (group.style?.['text-field'] || group.style?.['text-size']) {
                    // Use proper style categorization to handle all properties correctly
                    const { paint: textPaint, layout: textLayout } = this._categorizeStyleProperties(group.style, 'symbol');

                    this._map.addLayer({
                        id: `${sourceId}-label`,
                        type: 'symbol',
                        source: sourceId,
                        layout: {
                            // Default layout properties
                            'text-font': ['Open Sans Bold'],
                            'text-field': this._defaultStyles.geojson.text['text-field'],
                            'text-size': this._defaultStyles.geojson.text['text-size'],
                            'text-anchor': this._defaultStyles.geojson.text['text-anchor'],
                            'text-justify': this._defaultStyles.geojson.text['text-justify'],
                            'text-allow-overlap': this._defaultStyles.geojson.text['text-allow-overlap'],
                            'text-offset': this._defaultStyles.geojson.text['text-offset'],
                            'text-transform': this._defaultStyles.geojson.text['text-transform'],
                            // Only set text-padding if it's defined to avoid undefined errors
                            ...(group.style?.['text-padding'] !== undefined ? { 'text-padding': group.style['text-padding'] } : {}),
                            visibility: 'visible',
                            // Apply categorized layout properties (including text-padding)
                            ...textLayout
                        },
                        paint: {
                            // Default paint properties
                            'text-color': '#000000',
                            'text-halo-color': '#ffffff',
                            'text-halo-width': 1,
                            'text-halo-blur': 1,
                            // Apply categorized paint properties
                            ...textPaint
                        }
                    }, this._getInsertPosition('geojson', 'symbol'));
                }

                // Fix interactivity by adding event listeners
                const layerIds = [`${sourceId}-fill`, `${sourceId}-line`];
                if (group.style?.['text-field'] || group.style?.['text-size']) {
                    layerIds.push(`${sourceId}-label`);
                }
                if (group.style?.['circle-radius'] || group.style?.['circle-color']) {
                    layerIds.push(`${sourceId}-circle`);
                }

                this._setupLayerInteractivity(group, layerIds, sourceId);
            } else {
                // Just update visibility for existing layers
                ['fill', 'line', 'label', 'circle'].forEach(type => {
                    const layerId = `${sourceId}-${type}`;
                    if (this._map.getLayer(layerId)) {
                        this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
                    }
                });
            }
        } else if (group.type === 'tms') {
            const sourceId = `tms-${group.id}`;
            const layerId = `tms-layer-${group.id}`;

            // Only add source and layer if they don't exist yet and should be visible
            if (visible && !this._map.getSource(sourceId)) {
                // Check if it's a Mapbox hosted raster tileset
                if (group.url.startsWith('mapbox://')) {
                    this._map.addSource(sourceId, {
                        type: 'raster',
                        url: group.url,  // Keep the mapbox:// URL as is
                        tileSize: 256,
                        maxzoom: group.maxzoom || 22,
                    });
                } else {
                    this._map.addSource(sourceId, {
                        type: 'raster',
                        tiles: [group.url],
                        tileSize: 256,
                        maxzoom: group.maxzoom || 22,
                    });
                }

                // Create layer config using the new flexible style system
                const layerConfig = this._createLayerConfig({
                    id: layerId,
                    source: sourceId,
                    style: {
                        // Merge default raster styles with user-defined styles
                        ...(this._defaultStyles.raster || {}),
                        ...(group.style || {}),
                        // Fallback to legacy opacity property if no raster-opacity is specified
                        'raster-opacity': group.style?.['raster-opacity'] || group.opacity || this._defaultStyles.raster?.['raster-opacity'] || 1
                    },
                    initiallyChecked: true // Make visible when toggled on
                }, 'raster');

                this._map.addLayer(layerConfig, this._getInsertPosition('tms'));
            } else if (this._map.getLayer(layerId)) {
                // Just update visibility for existing layer
                this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
            }
        } else if (group.type === 'csv') {
            const sourceId = `csv-${group.id}`;
            const layerId = `${sourceId}-circle`;

            // Only set up CSV layer when visible and not already created
            if (visible && !this._map.getSource(sourceId)) {
                // Lazy load CSV data when layer is made visible
                this._setupCsvLayer(group);
            } else if (this._map.getLayer(layerId)) {
                // Just update visibility for existing layer
                this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');

                // Reset refresh timer when toggling visibility (only for URL-based data)
                if (visible && group.refresh && group.url && !group._refreshTimer) {
                    this._setupCsvRefresh(group);
                } else if (!visible && group._refreshTimer) {
                    clearInterval(group._refreshTimer);
                    group._refreshTimer = null;
                }
            }
        } else if (group.type === 'vector') {
            const sourceId = `vector-${group.id}`;
            const hasFillStyles = group.style && (group.style['fill-color'] || group.style['fill-opacity']);
            const hasLineStyles = group.style && (group.style['line-color'] || group.style['line-width']);

            // Determine the main layer ID based on the primary style type
            const mainLayerId = hasFillStyles ? `vector-layer-${group.id}` : `vector-layer-${group.id}-outline`;

            // Only add source and layers if they don't exist yet and should be visible
            if (visible && !this._map.getSource(sourceId)) {
                // Check if it's a Mapbox hosted tileset
                if (group.url.startsWith('mapbox://')) {
                    this._map.addSource(sourceId, {
                        type: 'vector',
                        url: group.url,  // Keep the mapbox:// URL as is
                        maxzoom: group.maxzoom || 22,
                        promoteId: {
                            [group.sourceLayer]: group.inspect?.id
                        }
                    });
                } else {
                    // Handle other vector tile sources
                    this._map.addSource(sourceId, {
                        type: 'vector',
                        tiles: [group.url],
                        maxzoom: group.maxzoom || 22,
                        promoteId: {
                            [group.sourceLayer]: group.inspect?.id
                        }
                    });
                }

                // Only add fill layer if fill styles are defined
                if (hasFillStyles) {
                    const fillLayerConfig = {
                        id: `vector-layer-${group.id}`,
                        type: 'fill',
                        source: sourceId,
                        'source-layer': group.sourceLayer || 'default',
                        layout: {
                            visibility: 'visible'
                        },
                        paint: {
                            'fill-color': group.style?.['fill-color'] || this._defaultStyles.vector.fill['fill-color'],
                            'fill-opacity': group.style?.['fill-opacity'] || this._defaultStyles.vector.fill['fill-opacity']
                        },
                        metadata: {
                            groupId: group.id,
                            layerType: 'fill'
                        }
                    };

                    // Only add filter if it's defined
                    if (group.filter) {
                        fillLayerConfig.filter = group.filter;
                    }

                    this._map.addLayer(fillLayerConfig, this._getInsertPosition('vector', 'fill'));
                }

                // Add line layer if line styles are defined
                if (hasLineStyles) {
                    const lineLayerConfig = {
                        id: `vector-layer-${group.id}-outline`,
                        type: 'line',
                        source: sourceId,
                        'source-layer': group.sourceLayer || 'default',
                        layout: {
                            visibility: 'visible'
                        },
                        paint: {
                            'line-color': this._combineWithDefaultStyle(group.style?.['line-color'], this._defaultStyles.vector.line['line-color']),
                            'line-width': group.style?.['line-width'] || this._defaultStyles.vector.line['line-width'],
                            'line-opacity': group.style?.['line-opacity'] || this._defaultStyles.vector.line['line-opacity']
                        }
                    };

                    // Only add filter if it's defined
                    if (group.filter) {
                        lineLayerConfig.filter = group.filter;
                    }

                    this._map.addLayer(lineLayerConfig, this._getInsertPosition('vector', 'line'));
                }

                // Add text layer if text styles are defined
                if (group.style?.['text-field']) {
                    const textLayerConfig = {
                        id: `vector-layer-${group.id}-text`,
                        type: 'symbol',
                        source: sourceId,
                        'source-layer': group.sourceLayer || 'default',
                        layout: {
                            'text-font': group.style?.['text-font'] || ['Open Sans Bold'],
                            'text-field': group.style?.['text-field'],
                            'text-size': group.style?.['text-size'] || 12,
                            'text-anchor': group.style?.['text-anchor'] || 'center',
                            'text-justify': group.style?.['text-justify'] || 'center',
                            'text-allow-overlap': group.style?.['text-allow-overlap'] || false,
                            'text-offset': group.style?.['text-offset'] || [0, 0],
                            'text-transform': group.style?.['text-transform'] || 'none',
                            'text-padding': group.style?.['text-padding'],
                            visibility: 'visible'
                        },
                        paint: {
                            'text-color': group.style?.['text-color'] || '#000000',
                            'text-halo-color': group.style?.['text-halo-color'] || '#ffffff',
                            'text-halo-width': group.style?.['text-halo-width'] !== undefined ? group.style['text-halo-width'] : 1,
                            'text-halo-blur': group.style?.['text-halo-blur'] !== undefined ? group.style['text-halo-blur'] : 1,
                            'text-opacity': group.style?.['text-opacity'] || [
                                'case',
                                ['boolean', ['feature-state', 'selected'], false],
                                1,
                                ['boolean', ['feature-state', 'hover'], false],
                                0.9,
                                0.7
                            ]
                        }
                    };

                    // Only add filter if it's defined
                    if (group.filter) {
                        textLayerConfig.filter = group.filter;
                    }

                    this._map.addLayer(textLayerConfig, this._getInsertPosition('vector', 'symbol'));
                }

                // Setup interactivity
                if (group.inspect) {
                    // Add event listeners to both fill and line layers if they exist
                    const layerIds = [];
                    if (hasFillStyles) layerIds.push(`vector-layer-${group.id}`);
                    if (hasLineStyles) layerIds.push(`vector-layer-${group.id}-outline`);
                    if (group.style?.['text-field']) layerIds.push(`vector-layer-${group.id}-text`);

                    this._setupLayerInteractivity(group, layerIds, sourceId);
                }

                // Store the layer configuration for later use
                group._layerConfig = {
                    hasFillStyles,
                    hasLineStyles,
                    hasTextStyles: !!group.style?.['text-field'],
                    mainLayerId
                };
            } else {
                // Just update visibility for existing layers
                const layerConfig = group._layerConfig;
                if (!layerConfig) return;

                if (layerConfig.hasFillStyles) {
                    const fillLayerId = `vector-layer-${group.id}`;
                    if (this._map.getLayer(fillLayerId)) {
                        this._map.setLayoutProperty(fillLayerId, 'visibility', visible ? 'visible' : 'none');
                    }
                }

                if (layerConfig.hasLineStyles) {
                    const lineLayerId = `vector-layer-${group.id}-outline`;
                    if (this._map.getLayer(lineLayerId)) {
                        this._map.setLayoutProperty(lineLayerId, 'visibility', visible ? 'visible' : 'none');
                    }
                }

                if (group.style?.['text-field']) {
                    const textLayerId = `vector-layer-${group.id}-text`;
                    if (this._map.getLayer(textLayerId)) {
                        this._map.setLayoutProperty(textLayerId, 'visibility', visible ? 'visible' : 'none');
                    }
                }
            }
        } else if (group.type === 'markers' && group.dataUrl) {
            const sourceId = `markers-${group.id}`;
            const layerId = `${sourceId}-circles`;

            if (visible && !this._map.getSource(sourceId)) {
                // Fetch data only when layer is made visible
                fetch(group.dataUrl)
                    .then(response => response.text())
                    .then(data => {
                        // Special handling for Google Sheets data
                        if (group.dataUrl.includes('spreadsheets.google.com')) {
                            data = gstableToArray(JSON.parse(data.slice(47, -2)).table);

                            const geojson = {
                                type: 'FeatureCollection',
                                features: data.map(row => {
                                    const coords = [row.Longitude, row.Latitude] || [0, 0];
                                    return {
                                        type: 'Feature',
                                        geometry: {
                                            type: 'Point',
                                            coordinates: coords
                                        },
                                        properties: row
                                    };
                                })
                            };

                            // Only add source and layer if they should be visible
                            if (visible) {
                                this._map.addSource(sourceId, {
                                    type: 'geojson',
                                    data: geojson,
                                    promoteId: group.inspect?.id
                                });

                                this._map.addLayer({
                                    id: layerId,
                                    type: 'circle',
                                    source: sourceId,
                                    paint: {
                                        ...this._defaultStyles.markers.circle,
                                        'circle-radius': group.style?.['circle-radius'] || this._defaultStyles.markers.circle['circle-radius'],
                                        'circle-color': group.style?.['circle-color'] || group.style?.['fill-color'] || this._defaultStyles.markers.circle['circle-color'],
                                        'circle-opacity': group.style?.['circle-opacity'] !== undefined ? group.style['circle-opacity'] : this._defaultStyles.markers.circle['circle-opacity'],
                                        'circle-stroke-width': group.style?.['circle-stroke-width'] !== undefined ? group.style['circle-stroke-width'] : this._defaultStyles.markers.circle['circle-stroke-width'],
                                        'circle-stroke-color': group.style?.['circle-stroke-color'] || this._defaultStyles.markers.circle['circle-stroke-color'],
                                        'circle-stroke-opacity': group.style?.['circle-stroke-opacity'] !== undefined ? group.style['circle-stroke-opacity'] : this._defaultStyles.markers.circle['circle-stroke-opacity'],
                                        'circle-blur': group.style?.['circle-blur'] !== undefined ? group.style['circle-blur'] : this._defaultStyles.markers.circle['circle-blur'],
                                        'circle-translate': group.style?.['circle-translate'] || this._defaultStyles.markers.circle['circle-translate'],
                                        'circle-translate-anchor': group.style?.['circle-translate-anchor'] || this._defaultStyles.markers.circle['circle-translate-anchor'],
                                        'circle-pitch-alignment': group.style?.['circle-pitch-alignment'] || this._defaultStyles.markers.circle['circle-pitch-alignment'],
                                        'circle-pitch-scale': group.style?.['circle-pitch-scale'] || this._defaultStyles.markers.circle['circle-pitch-scale']
                                    },
                                    layout: {
                                        'visibility': 'visible'
                                    }
                                });

                                this._map.on('click', layerId, (e) => {
                                    if (e.features.length > 0 && this._config.showPopupsOnClick) {
                                        const feature = e.features[0];
                                        const coordinates = feature.geometry.coordinates.slice();
                                        const content = this._createPopupContent(feature, group, false, {
                                            lng: coordinates[0],
                                            lat: coordinates[1]
                                        });
                                        if (content) {
                                            new mapboxgl.Popup()
                                                .setLngLat(coordinates)
                                                .setDOMContent(content)
                                                .addTo(this._map);
                                        }
                                    }
                                });
                            }
                        }
                    });
            } else if (this._map.getLayer(layerId)) {
                this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
            }
        } else if (group.type === 'img') {
            // For image layers, set them up or toggle visibility
            if (visible && !this._map.getSource(group.id)) {
                // Check if we have a URL
                if (!group.url) {
                    console.error(`Image layer ${group.id} is missing URL. Properties available:`, Object.keys(group));
                    return;
                }

                // Check for either bounds or bbox property
                const bounds = group.bounds || group.bbox;
                if (!bounds || bounds.length !== 4) {
                    console.error(`Image layer ${group.id} has invalid bounds/bbox.`);
                    return;
                }

                // Store bounds for later use
                group.bounds = bounds;


                // Add cache-busting parameter for dynamic images
                const url = group.refresh ?
                    (group.url.includes('?') ? `${group.url}&_t=${Date.now()}` : `${group.url}?_t=${Date.now()}`) :
                    group.url;

                // First load the image to ensure it exists
                const img = new Image();
                img.crossOrigin = "Anonymous"; // Enable CORS if needed

                img.onload = () => {

                    // Create image source and layer for satellite imagery
                    // Use the normalized bounds
                    const bounds = group.bounds;

                    this._map.addSource(group.id, {
                        type: 'image',
                        url: url,
                        coordinates: [
                            [bounds[0], bounds[3]], // top-left (longitude, latitude)
                            [bounds[2], bounds[3]], // top-right
                            [bounds[2], bounds[1]], // bottom-right
                            [bounds[0], bounds[1]]  // bottom-left
                        ]
                    });

                    // Create layer config using the new flexible style system
                    const layerConfig = this._createLayerConfig({
                        id: group.id,
                        source: group.id,
                        style: {
                            // Merge default raster styles with user-defined styles
                            ...(this._defaultStyles.raster || {}),
                            ...(group.style || {}),
                            // Fallback to legacy opacity property if no raster-opacity is specified
                            'raster-opacity': group.style?.['raster-opacity'] || group.opacity || this._defaultStyles.raster?.['raster-opacity'] || 0.85,
                            'raster-fade-duration': 0
                        },
                        initiallyChecked: true // Make visible when toggled on
                    }, 'raster');

                    this._map.addLayer(layerConfig, this._getInsertPosition('img'));

                    // Setup refresh timer if configured
                    if (visible && group.refresh && !group._refreshTimer) {
                        this._setupImgRefresh(group);
                    }
                };

                img.onerror = (e) => {
                    console.error(`Failed to load image for layer ${group.id}: ${url}`, e);
                };

                // Start loading the image
                img.src = url;
            } else if (this._map.getLayer(group.id)) {
                // For image layers, simply change the visibility
                this._map.setLayoutProperty(group.id, 'visibility', visible ? 'visible' : 'none');

                // Reset refresh timer when toggling visibility
                if (visible && group.refresh && !group._refreshTimer) {
                    this._setupImgRefresh(group);
                } else if (!visible && group._refreshTimer) {
                    clearInterval(group._refreshTimer);
                    group._refreshTimer = null;
                }
            }
        } else if (group.type === 'raster-style-layer') {
            // Handle raster-style-layer type - applies styles to existing style layer
            const styleLayerId = group.styleLayer || group.id;

            if (this._map.getLayer(styleLayerId)) {
                // Set visibility
                this._map.setLayoutProperty(styleLayerId, 'visibility', visible ? 'visible' : 'none');

                // Apply custom style properties if provided and layer is visible
                if (visible && group.style) {
                    // Get the existing layer to determine its type
                    const existingLayer = this._map.getLayer(styleLayerId);
                    const layerType = existingLayer.type;

                    // Categorize the style properties based on layer type
                    const { paint, layout } = this._categorizeStyleProperties(group.style, layerType);

                    // Apply paint properties
                    Object.entries(paint).forEach(([property, value]) => {
                        try {
                            this._map.setPaintProperty(styleLayerId, property, value);
                        } catch (error) {
                            console.warn(`Failed to set paint property ${property} on layer ${styleLayerId}:`, error);
                        }
                    });

                    // Apply layout properties (excluding visibility which we already set)
                    Object.entries(layout).forEach(([property, value]) => {
                        if (property !== 'visibility') {
                            try {
                                this._map.setLayoutProperty(styleLayerId, property, value);
                            } catch (error) {
                                console.warn(`Failed to set layout property ${property} on layer ${styleLayerId}:`, error);
                            }
                        }
                    });
                }
            } else {
                console.warn(`Style layer '${styleLayerId}' not found in map style`);
            }
        } else if (group.type === 'terrain') {
            // Toggle terrain
            this._map.setTerrain(visible ? { source: 'mapbox-dem', exaggeration: 1.5 } : null);
            // Toggle fog for better visual effect with terrain
            this._map.setFog(visible ? {
                'color': 'white',
                'horizon-blend': 0.1,
                'high-color': '#add8e6',
                'star-intensity': 0.1
            } : null);
        }

        // Register with state manager AFTER layers are added to the map
        // This ensures _hasMatchingLayers() can find the newly added layers
        if (visible) {
            // Register ALL visible layers (both inspectable and non-inspectable)
            // Use a small delay to ensure layers are fully added to the map style
            requestAnimationFrame(() => {
                this._registerLayerWithStateManager(group);
            });
        }

        // Feature control notifications no longer needed - state manager handles interactions
    }

    _handleLayerChange(selectedLayerId, layers) {
        const allLayers = this._map.getStyle().layers.map(layer => layer.id);

        layers.forEach(layer => {
            const matchingLayers = allLayers.filter(layerId =>
                layerId === layer.id || layerId.startsWith(`${layer.id} `)
            );

            matchingLayers.forEach(layerId => {
                if (this._map.getLayer(layerId)) {
                    const isVisible = layer.id === selectedLayerId;
                    this._map.setLayoutProperty(
                        layerId,
                        'visibility',
                        isVisible ? 'visible' : 'none'
                    );
                }
            });

            const $radioInput = $(`input[value="${layer.id}"]`, this._container);
            if ($radioInput.length) {
                const $label = $radioInput.closest('.radio-label');
                $('.layer-info', $label.parent()).remove();

                if (isVisible) {
                    const links = [];
                    if (layer.location) {
                        links.push(`<a href="#" class="hover:underline view-link" data-location="${layer.location}">View</a>`);
                    }

                    const $infoDiv = $('<div>', {
                        class: 'layer-info text-xs pl-5 text-gray-600',
                        html: links.join(' | ')
                    });

                    $infoDiv.find('.view-link').on('click', (e) => {
                        e.preventDefault();
                        this._flyToLocation(layer.location);
                    });

                    $infoDiv.insertAfter($label);
                }
            }
        });

        // Feature control notifications no longer needed - state manager handles interactions
    }

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

    _initializeWithAnimation() {
        // Get all toggle switches in group headers, but exclude sublayer ones
        const allToggles = this._container.querySelectorAll('.group-header .toggle-switch input[type="checkbox"]');
        const groupHeaders = Array.from(allToggles).filter(toggle => {
            // Exclude toggles that are inside .layer-controls (sublayers)
            return !toggle.closest('.layer-controls');
        });

        groupHeaders.forEach((toggleInput, index) => {
            const group = this._state.groups[index];
            const shouldBeChecked = group?.initiallyChecked ?? false;
            toggleInput.checked = shouldBeChecked;

            // Force visual update by triggering a reflow
            void toggleInput.offsetHeight;

            // Also force update on the toggle slider element
            const toggleSlider = toggleInput.nextElementSibling;
            if (toggleSlider && toggleSlider.classList.contains('toggle-slider')) {
                void toggleSlider.offsetHeight;
            }

            toggleInput.dispatchEvent(new Event('change'));
        });

        // Feature control notifications no longer needed - state manager handles interactions

        if (!this._initialized) {
            // Add no-transition class initially
            this._container.classList.add('no-transition');
            // Force a reflow
            void this._container.offsetWidth;
            // Remove no-transition class
            this._container.classList.remove('no-transition');

            this._initialized = true;
        }

        // Add collapsed class after a brief delay to ensure initial render is complete
        requestAnimationFrame(() => {
            this._container.classList.add('collapsed');
        });
    }

    toggleControl() {
        // Ensure smooth animation by using requestAnimationFrame
        requestAnimationFrame(() => {
            this._container.classList.toggle('collapsed');
        });
        this._toggleButton.classList.toggle('is-open');
    }

    _createPopupContent(feature, group, isHover = false, lngLat = null) {
        // Check configuration settings for popup display
        if (isHover && !this._config.showPopupsOnHover) {
            return null;
        }
        
        if (!isHover && !this._config.showPopupsOnClick) {
            return null;
        }

        // Disable hover popups on mobile devices
        if (isHover && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
            return null;
        }

        if (isHover) {
            return this._createHoverPopupContent(feature, group);
        }

        return this._createDetailedPopupContent(feature, group, lngLat);
    }

    _createHoverPopupContent(feature, group) {
        if (!this._hoverTemplate) {
            this._hoverTemplate = document.createElement('div');
            this._hoverTemplate.className = 'map-popup p-0 font-sans';
        }
        const content = this._hoverTemplate.cloneNode(true);

        if (group.inspect?.label) {
            const labelValue = feature.properties[group.inspect.label];
            if (labelValue) {
                const labelDiv = document.createElement('div');
                labelDiv.className = 'text-base font-medium';
                labelDiv.textContent = labelValue;
                content.appendChild(labelDiv);

                if (group.inspect?.fields) {
                    group.inspect.fields.forEach(field => {
                        const value = feature.properties[field];
                        if (value) {
                            const fieldDiv = document.createElement('div');
                            fieldDiv.className = 'text-sm';
                            fieldDiv.textContent = value;
                            content.appendChild(fieldDiv);
                        }
                    });
                }
            }
        }
        return content;
    }

    _createDetailedPopupContent(feature, group, lngLat = null) {
        // ... existing detailed popup content code ...
        // Copy all the code that was previously in _createPopupContent after the isHover check
        const content = document.createElement('div');
        content.className = 'map-popup p-4 font-sans';

        // If there's a header image, add it as a background
        if (group.headerImage) {
            content.style.backgroundImage = `linear-gradient(to bottom, rgba(255, 255, 255, 0.3) 0px, rgba(255, 255, 255, 1) 60px), url('${group.headerImage}')`;
            content.style.backgroundSize = 'auto';
            content.style.backgroundPosition = 'left top';
            content.style.backgroundRepeat = 'no-repeat';
        }

        // Add layer name at the top
        const layerName = document.createElement('div');
        layerName.className = 'text-xs uppercase tracking-wider text-gray-400';
        layerName.textContent = group.title;
        content.appendChild(layerName);

        if (group.inspect?.title) {
            const title = document.createElement('h3');
            title.className = 'text-xs uppercase tracking-wider text-gray-500 font-medium';
            title.textContent = group.inspect.title;
            content.appendChild(title);
        }

        const grid = document.createElement('div');
        grid.className = 'grid';

        if (group.inspect?.label) {
            const labelValue = feature.properties[group.inspect.label];
            if (labelValue) {
                const labelDiv = document.createElement('div');
                labelDiv.className = 'text-2xl font-light mb-2 text-right';
                labelDiv.textContent = labelValue;
                grid.appendChild(labelDiv);
            }
        }

        if (group.inspect?.fields) {
            const fieldsGrid = document.createElement('div');
            fieldsGrid.className = 'grid grid-cols-2 text-sm';

            group.inspect.fields.forEach((field, index) => {
                if (feature.properties.hasOwnProperty(field) && field !== group.inspect.label) {
                    const value = feature.properties[field];

                    const fieldContainer = document.createElement('div');
                    fieldContainer.className = 'col-span-2 grid grid-cols-2 gap-2 border-t border-b border-gray-100 py-2';

                    const fieldLabel = document.createElement('div');
                    fieldLabel.className = 'text-gray-500 uppercase text-xs tracking-wider';
                    fieldLabel.textContent = group.inspect?.fieldTitles?.[index] || field;
                    fieldContainer.appendChild(fieldLabel);

                    const fieldValue = document.createElement('div');
                    fieldValue.className = 'font-medium text-xs text-right';
                    fieldValue.textContent = value;
                    fieldContainer.appendChild(fieldValue);

                    fieldsGrid.appendChild(fieldContainer);
                }
            });

            if (fieldsGrid.children.length > 0) {
                grid.appendChild(fieldsGrid);
            }
        }

        content.appendChild(grid);

        // Add custom HTML if it exists
        if (group.inspect?.customHtml) {
            const customContent = document.createElement('div');
            customContent.className = 'text-xs text-gray-600 pt-3 pb-3 border-t border-gray-200';
            customContent.innerHTML = group.inspect.customHtml;
            content.appendChild(customContent);
        }

        // Add attribution section if it exists
        if (group.attribution) {
            const attributionContainer = document.createElement('div');
            attributionContainer.className = 'text-xs text-gray-600 pt-3 border-t border-gray-200 attribution-container';

            const attributionContent = document.createElement('div');
            attributionContent.className = 'attribution-content line-clamp-2'; // Initially show 2 lines
            attributionContent.innerHTML = `Source: ${group.attribution.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ')}`;

            const expandButton = document.createElement('button');
            expandButton.className = 'text-blue-600 hover:text-blue-800 text-xs mt-1 hidden expand-attribution';
            expandButton.textContent = 'Show more';

            attributionContainer.appendChild(attributionContent);
            attributionContainer.appendChild(expandButton);

            // Check if content needs expand button
            setTimeout(() => {
                if (attributionContent.scrollHeight > attributionContent.clientHeight) {
                    expandButton.classList.remove('hidden');

                    expandButton.addEventListener('click', () => {
                        if (attributionContent.classList.contains('line-clamp-2')) {
                            attributionContent.classList.remove('line-clamp-2');
                            expandButton.textContent = 'Show less';
                        } else {
                            attributionContent.classList.add('line-clamp-2');
                            expandButton.textContent = 'Show more';
                        }
                    });
                }
            }, 0);

            content.appendChild(attributionContainer);
        }

        const lat = lngLat ? lngLat.lat : feature.geometry.coordinates[1];
        const lng = lngLat ? lngLat.lng : feature.geometry.coordinates[0];
        const zoom = this._map.getZoom();

        const mercatorCoords = convertToWebMercator(lng, lat);
        const oneMapGoaLayerList = '&l=gp_police_station_a9c73118_2035_466c_9f5d_8888580816a0%21%2Cdma_garbage_treatment_plant_fc46bf4b_245c_4856_be7b_568b46a117c4%21%2Cdma_mrf_faciltiy_polygon_93c1ae1a_ea42_46c5_bbec_ed589e08d8c0%21%2Cdma_bio_methanation_plant_polygon_bdeb7c4d_17ec_4d9f_9e4a_3bf702905e1a%21%2Cdma_weighing_bridge_54e8be7c_e105_4098_a5fa_fb939eeba75e%21%2Cdma_mrf_faciltiy_95b4b5a3_a2ce_481b_9711_7f049ca1e244%21%2Cdma_incinerator_2d57ae07_9b3e_4168_ac8b_7f2187d5681a%21%2Cdma_ccp_biodigester_84960e2a_0ddf_465a_9bca_9bb35c4abcb4%21%2Cdma_bio_methanation_plant__f0edd163_cf6b_4084_9122_893ebc83d4fe%21%2Cdma_waste_management_sities_fa8b2c94_d4cd_4533_9c7e_8cf0d3b30b87%21%2Cdma_windrows_composting_shed_30ef18af_c8a7_45a9_befb_0b6c555bd263%21%2Cdgm_leases_f7677297_2e19_4d40_850f_0835388ecf18%21%2Cdgm_lease_names_fdb18573_adc9_4a60_9f1e_6c22c04d7871%21%2Cgdms_landslide_vulnerable_ced97822_2753_4958_9edc_7f221a6b52c9%21%2Cgdm_flooding_areas_1be469a8_af9d_46cf_953e_49256db7fe1d%21%2Cgsidc_sewerage_line_bddff132_f998_4be1_be43_b0fb71520499%21%2Cgsidc_sewerage_manhole_0654846e_5144_4d1f_977e_58d9c2c9a724%21%2Cged_division_boundary_04fe437b_405f_45fa_8357_02f0d564bdd4%21%2Cged_substation_4c686ea3_95a6_43e8_b136_e338a3a47e79%21%2Cged_rmu_2f2632f4_6ced_4eae_8ff8_6c2254697f13%21%2Cged_lv_wire_ca1f9541_7be0_4230_a760_a3b66507fc06%21%2Cged_lv_cable_9b8d0330_64e5_4bbf_bdb5_4927b39b2ef2%21%2Cged_hv_wire_a60bb861_6972_4f27_86a4_21492b59ede2%21%2Cged_hv_cable_54dae74c_08af_44f0_af49_ec3b5fcab581%21%2Cged_ehv_wire_68331f46_1c8f_4f85_99b0_151656c3b0c8%21%2Cged_ehv_cable_04580bfe_0d1c_4422_bec6_4093984ffa6d%21%2Cged_transformer_a967dbae_dbc2_487f_9fff_14865a65d8d6%21%2Cged_solar_generation_bbeed839_8737_421d_b5bc_277357dcd727%21%2Cged_towers_3c2b9c53_8aa0_4538_b969_731b66b98189%21%2Cged_protective_equipment_fa242976_c97c_4006_aeb1_8c32669f3477%21%2Cged_pole_240bac2f_8d3b_4989_bc0b_b34d9d78e018%21%2Cged_govt_connection__b89e0eff_2812_425e_aa29_4039e1489126%21%2Cged_cabinet_e3e83e28_cff8_4acc_855e_5572b21a8302%21%2Cgbbn_24F_150a4ba3_5e6e_4490_87cd_9a67a51f9a95%21%2Cgbbn_6F_7d67c332_14a0_433b_9036_d3edb7acfe1f%21%2Cgbbn_48F_87fa8495_0a7b_4a37_9154_5d749eb826e6%21%2Cgbbn_vgp_ce657914_2bc0_437a_b558_d614529d0d70%21%2Cgbbn_vgp1_da280706_4a39_4581_98f6_76a4a8258ee2%21%2Cgbbn_olt_afb08f2e_83de_4493_a04a_4eeee53cdabb%21%2Cgwrd_reservoirs_806646ae_e1d3_4b00_9afb_0659fea342cf%21%2Cgwrd_jackwell_casarwali_ad327886_70e4_4b98_bf5e_41da1e9240d0%21%2Cgwrd_pump_house_49ad2817_feb7_4bd4_beaa_2b8908823881%21%2Cgwrd_pumping_sub_station_219578a4_9fba_4c21_bfdf_6793c0e2ec9e%21%2Cgwrd_floodplains_0178162a_bedc_4875_bc74_c2eeba2a040b%21%2Cgwrd_floodembankments_6de30dc4_675b_4ef9_b204_cf2352c1fe9b%21%2Cgpwd_waterline_ffe24b0d_7e83_43e7_8d7f_e5bd2a0d49da%21%2Cgwrd_pipeline_82478411_6595_487b_b524_abb8931946a6%21%2Cgwrd_canal_c36fddaf_564b_43c5_ba74_86e46ca22995%21%2Cgwrd_end_of_pipeline_5518b446_8ff1_4d17_a28f_344dfa3e7901%21%2Cgwrd_tapping_point_401aac7c_77a1_47e2_8470_71a4880294a7%21%2Cgwrd_rain_guages___flood_monitors_ae6547a5_6eca_4932_a1c8_f80c8e04551b%21%2Cgsa_goa_sports_complex_3e450e4c_9a69_4cf7_94ac_2c9082e5388a%21%2Cgie_verna_industrial_estate_81926f17_e182_42a7_9614_0160bf19fa34%21%2Cgie_quittol_industrial_estate_5d5aadba_071c_432d_b424_6c3644c29338%21%2Cgie_latambarcem_industrail_estate_919dd4d4_d8ae_44cc_aff0_bd27fbe1e0a3%21%2Cgcsca_fps_godowns_a3b498e8_fda8_4249_b17b_8c0acbb444d7%21%2Cgcsca_fps_shops_debfb1ee_0fb9_4cfe_95a7_8d9880d22deb%21%2Cgargi_seed_farm_519a1d9c_7a62_4906_a44c_7f7a6d8744b4%21%2Cdfg_ramps_8fb28e3c_4344_409b_9e47_b19c1b8c5fe0%21%2Cdfg_jetty_6a70f09c_fc73_4c48_be61_c35b9f2a7094%21%2Cdfg_fish_landing_centers_b5f571c3_5a64_4ae9_8413_289a912e2f37%21%2Cdfg_aqua_culture_005788c0_d630_42c1_a61f_178234cc61f4%21%2Cdah_cattle_feed_factory_d4f517d5_db91_493c_8b8c_d3cb1062d369%21%2Cdah_egg_production_ff7dac52_5c84_4f17_96eb_2621f7ed01c4%21%2Cdah_veterinary_centres_b9b0b3ac_35e7_4973_a175_f515fbc0efd5%21%2Cdah_sumul_dairy_a0d775d5_8048_4858_869b_3083b34c0bcf%21%2Cdah_production_cattle_244945b5_f092_4644_a585_1601ce097c6c%21%2Cdah_milk_production_70534439_ebaa_4c88_bbb9_f44cae179078%21%2Cdah_milk_processing_unit_8d3ff9f8_387c_4d52_b5a5_ad0ab020fc10%21%2Cdah_farms_e208fb45_f1d4_4489_ae7b_753fc32d4b07%21%2Cgagri_landform_1b36389a_a5c2_4307_8515_beb0e49ceef6%2Cdslr_goa_villages_c9939cd5_f3c8_4e94_8125_38adb10e6f45%2Cdaa_asi_sites_9b100a72_f84f_4114_b81f_42f5e46334b1%2Ctdc_gurudwara_e1ff2fde_1fbd_41aa_b1af_0f844ebdbee8%2Ctdc_mosque_05493477_4f6f_4973_8edc_ae8d6e1dc2ef%2Ctdc_church_ca9f3144_cca2_402a_bb7c_85126a42a69b%2Ctdc_temple_33d6e141_2ae9_4a43_909a_f252ef6f27d6%2Cgfd_range_ac0c898d_b912_43e5_8641_cc8d558b96c2%21%2Cgfd_wls_29b8d326_2d60_4bde_b743_6a239516c86c%21%2Cgfd_eco_sensitive_zone_451208a2_46f8_45aa_ba54_a5e5278aa824%21%2Cdhs_institute_63eb16bc_7d5c_4804_b7c3_99b9481eae1d%21%2Cdhs_hospital_c90b25e4_f64d_49f5_8696_410dfe8b18bd%21%2Cdhs_uhc_882ec1f1_633e_4411_b223_c0fe874575b2%21%2Cdhs_phc_771cb209_c40a_4786_ab15_122f5b8caf7f%21%2Cdhs_chc_43f53098_e034_404f_a7c4_bbc949038e5a%21%2Cdhs_ayurvedic___homeopathic_dispensaries_339b4c62_c1a7_4b6b_b8c6_272ec8a7e46a%21%2Cdhs_hsc_0e3ffe3f_21f5_4201_8596_d6b37a1d8f10%21%2Cdot_bus_stop_9a5e21ba_b562_45bc_a372_dfe71301af16%21%2Cgkr_railway_line_943f6fe0_5c1d_461e_bf1f_e914b2991191%21%2Cdot_rto_checkpost__af7f50e9_7412_4658_a40a_5d88d303d3ab%21%2Cdot_traffic_signal_b29280ac_53eb_4207_b713_5d965dd36f5c%21%2Cdot_depot_c46b1f5c_d838_4bab_bac3_6f9eb54bd7e5%21%2Cgkr_railway_station_eeffd0d6_ac46_4f69_a6b3_952cf2687ea2%21%2Cktc_bus_stops_1272f729_fbe6_49fb_9873_5d2d6fb2f99d%21%2Cgdte_schools_a53455c4_c969_4bc6_af70_e0403df19623%2Cdtw_ashram_school_8e3e826e_8cc5_4ebb_b7b6_e159a591143d%2Cgdte_iti_college_5c51844a_d03d_4745_9a27_dfc44351d160%2Cgdte_government_institute_976db146_84af_4c70_80cf_625726d858bf%2Cgdte_college_26d0511b_5a9d_4c94_983a_4d99d24ee293%2Cgoa_villages_f7a04d50_013c_4d33_b3f0_45e1cd5ed8fc%2Cgoa_taluka_boundary_9e52e7ed_a0ef_4390_b5dc_64ab281214f5%2Cgoa_district_boundary_81d4650d_4cdd_42c3_bd42_03a4a958b5dd%21%2Cgoa_boundary_ae71ccc6_6c5c_423a_b4fb_42f925d7ddc0';


        // Navigation links moved to map-links.js plugin

        // Add sourceLayer-specific links if they exist for this feature's sourceLayer
        const currentSourceLayer = group.sourceLayer;
        const relevantSourceLayerLinks = this._sourceLayerLinks.filter(link => {
            if (!currentSourceLayer) return false;

            // Support both string and array of strings for sourceLayer
            if (Array.isArray(link.sourceLayer)) {
                return link.sourceLayer.includes(currentSourceLayer);
            } else {
                return link.sourceLayer === currentSourceLayer;
            }
        });

        if (relevantSourceLayerLinks.length > 0) {
            const sourceLayerLinksHTML = relevantSourceLayerLinks.map(link => {
                // Check if link has renderHTML function - if so, use it instead of URL generation
                if (typeof link.renderHTML === 'function') {
                    return link.renderHTML({ feature, group, lat, lng, zoom, mercatorCoords });
                }

                // Original URL-based link generation
                let finalUrl = link.url;
                if (typeof link.url === 'function') {
                    // If URL is a function, call it with feature context
                    finalUrl = link.url({ feature, group, lat, lng, zoom, mercatorCoords });
                } else if (typeof link.url === 'string') {
                    // If URL is a template string, replace placeholders
                    finalUrl = link.url
                        .replace(/\${lat}/g, lat)
                        .replace(/\${lng}/g, lng)
                        .replace(/\${zoom}/g, zoom)
                        .replace(/\${mercatorCoords\.x}/g, mercatorCoords.x)
                        .replace(/\${mercatorCoords\.y}/g, mercatorCoords.y);

                    // Replace feature property placeholders like ${feature.properties.FIELD_NAME}
                    finalUrl = finalUrl.replace(/\${feature\.properties\.([^}]+)}/g, (match, propName) => {
                        return feature.properties[propName] || '';
                    });
                }

                return `<a href="${finalUrl}" target="_blank" class="flex items-center gap-1 hover:text-gray-900" title="${link.name}">
                    ${link.icon ? `<img src="${link.icon}" class="w-5 h-5 !max-w-none" alt="${link.name}">` : ''}
                    ${link.text ? `<span class="text-xs text-gray-600">${link.text}</span>` : ''}
                </a>`;
            }).join('');
            const sourceLayerLinksSection = `<div class="text-xs text-gray-600 pt-3 mt-3 border-t border-gray-200 flex flex-wrap gap-3">${sourceLayerLinksHTML}</div>`;
            content.innerHTML += sourceLayerLinksSection;
        }

        // Navigation links removed - now available in navbar via map-links.js plugin

        // Create container for action buttons
        const $actionContainer = $('<div>', {
            class: 'text-xs text-gray-600 pt-3 mt-3 border-t border-gray-200 flex gap-3'
        });

        // Add settings button - always visible
        const $settingsButton = $('<button>', {
            class: 'flex items-center gap-1 hover:text-gray-900 cursor-pointer',
            html: `
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>Settings</span>
            `
        });

        // Add click handler for settings button
        $settingsButton.on('click', () => {
            // Close the popup
            this._map.getCanvas().click();
            // Show layer settings
            this._showLayerSettings(group);
        });

        // Add settings button to container
        $actionContainer.append($settingsButton);

        // Add export KML button only if zoom level >= 14
        if (this._map.getZoom() >= 14) {
            const $exportButton = $('<button>', {
                class: 'flex items-center gap-1 hover:text-gray-900 cursor-pointer',
                html: `
                    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Export KML</span>
                `
            });

            $exportButton.on('click', () => {
                try {
                    const fieldValues = group.inspect?.fields
                        ? group.inspect.fields
                            .map(field => feature.properties[field])
                            .filter(value => value)
                            .join('_')
                        : '';
                    const groupTitle = feature.properties[group.inspect?.label] || 'Exported';
                    const title = fieldValues
                        ? `${fieldValues}_${groupTitle}`
                        : feature.properties[group.inspect?.label] || 'Exported_Feature';
                    const description = group.inspect?.title || 'Exported from Amche Goa';

                    const kmlContent = convertToKML(feature, { title, description });

                    const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });
                    const url = URL.createObjectURL(blob);

                    // Try direct download first
                    const $downloadLink = $('<a>', {
                        href: url,
                        download: `${title}.kml`
                    });

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
                        }, 10000); // Keep available for 1 minute
                    } else {
                        // Regular download for other platforms
                        $('body').append($downloadLink);
                        $downloadLink[0].click();
                        $downloadLink.remove();
                        URL.revokeObjectURL(url);
                    }

                } catch (error) {
                    console.error('Error exporting KML:', error);
                    alert('Error exporting KML. Please check the console for details.');
                }
            });

            $actionContainer.append($exportButton);
        }

        $(content).append($actionContainer);

        return content;
    }

    _getInsertPosition(type, layerType = null) {
        return getInsertPosition(
            this._map,
            type,
            layerType,
            this._currentGroup,
            this._state.groups
        );
    }

    _handleLayerGroupChange(selectedId, groups) {
        const allLayers = this._map.getStyle().layers
            .map(layer => layer.id)
            .filter(id => groups.some(group =>
                id === group.id ||
                id.startsWith(`${group.id}-`) ||
                id.startsWith(`${group.id} `)
            ));

        this._updateLayerVisibility(allLayers, false);

        const selectedLayers = allLayers.filter(id =>
            id === selectedId ||
            id.startsWith(`${selectedId}-`) ||
            id.startsWith(`${selectedId} `)
        );
        this._updateLayerVisibility(selectedLayers, true);
    }

    _updateLayerVisibility(layers, isVisible) {
        if (typeof this._map.batch === 'function') {
            this._map.batch(() => {
                this._updateLayerVisibilityImpl(layers, isVisible);
            });
        } else {
            this._updateLayerVisibilityImpl(layers, isVisible);
        }
    }

    _updateLayerVisibilityImpl(layers, isVisible) {
        layers.forEach(layerId => {
            if (this._map.getLayer(layerId)) {
                this._map.setLayoutProperty(
                    layerId,
                    'visibility',
                    isVisible ? 'visible' : 'none'
                );
            }
        });

        // Feature control notifications no longer needed - state manager handles interactions
    }

    _cleanup() {
        this._visibilityCache?.clear();
        this._domCache = {};
        if (this._resizeTimeout) {
            clearTimeout(this._resizeTimeout);
        }
        // Clean up consolidated hover popup
        if (this._consolidatedHoverPopup) {
            this._consolidatedHoverPopup.remove();
            this._consolidatedHoverPopup = null;
        }
        // Selected features now managed by state manager
    }

    _setupLayerInteractivity(group, layerIds, sourceId) {
        if (!group.inspect) return;

        const popup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: true
        });

        // Create consolidated hover popup if it doesn't exist
        if (!this._consolidatedHoverPopup) {
            this._consolidatedHoverPopup = new mapboxgl.Popup({
                closeButton: false,
                closeOnClick: false,
                className: 'hover-popup consolidated-hover-popup'
            });
        }

        let hoveredFeatureId = null;
        let selectedFeatureId = null;

        // Helper function to create feature state params based on layer type
        const getFeatureStateParams = (id) => {
            const params = { source: sourceId, id };
            if (group.type === 'vector') {
                params.sourceLayer = group.sourceLayer;
            }
            return params;
        };

        // Helper function to update consolidated hover popup (now simplified since state manager handles features)
        const updateConsolidatedHoverPopup = (e) => {
            // Consolidated hover popup functionality simplified - state manager handles feature tracking
            if (e && e.lngLat) {
                // Simple hover popup could be implemented here if needed
                // For now, the state manager handles all feature interactions
            }
        };

        layerIds.forEach(layerId => {
            // Mousemove handler - state manager handles hover states
            this._map.on('mousemove', layerId, (e) => {
                if (e.features.length > 0) {
                    const feature = e.features[0];

                    // Handle hover popup content
                    if (group.inspect?.label && this._config.showPopupsOnHover) {
                        // Update the consolidated hover popup
                        updateConsolidatedHoverPopup(e);
                    }
                    
                    // Feature hover state now fully managed by state manager
                }
            });

            // Mouseleave handler - state manager handles hover states
            this._map.on('mouseleave', layerId, () => {
                // Update consolidated popup (will be removed if no features remain)
                updateConsolidatedHoverPopup();

                // Feature leave interactions now fully managed by state manager
            });

            // Click handler - state manager handles selection states
            this._map.on('click', layerId, (e) => {
                if (e.features.length > 0) {
                    const feature = e.features[0];

                    // Remove hover popup
                    this._consolidatedHoverPopup.remove();

                    // Only show click popup if enabled
                    if (this._config.showPopupsOnClick) {
                        const content = this._createPopupContent(feature, group, false, e.lngLat);
                        if (content) {
                            popup
                                .setLngLat(e.lngLat)
                                .setDOMContent(content)
                                .addTo(this._map);
                        }
                    }

                    // Feature click interactions and selection state now fully managed by state manager
                }
            });

            // Add pointer cursor
            this._map.on('mouseenter', layerId, () => {
                this._map.getCanvas().style.cursor = 'pointer';
            });

            this._map.on('mouseleave', layerId, () => {
                this._map.getCanvas().style.cursor = '';
            });
        });
    }

    // When rendering legend images, we need to check if it's a PDF and handle it differently
    _renderLegendImage(legendImageUrl) {
        if (!legendImageUrl) return '';

        // Check if the file is a PDF
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
            // Handle regular image files as before
            return `<img src="${legendImageUrl}" alt="Legend" class="legend-image">`;
        }
    }

    _initializeSettingsModal() {
        if (!document.getElementById('layer-settings-modal')) {
            const modalHTML = `
                <sl-dialog id="layer-settings-modal" label="" class="layer-settings-dialog">
                    <div slot="label" class="settings-header">
                        <div class="header-bg">
                        <div class="header-overlay"></div>
                        <h2 class="header-title text-white relative z-10 px-4"></h2></div>
                    </div>
                    <div class="layer-settings-content">
                        <div class="settings-body grid grid-cols-2 gap-4">
                            <div class="col-1">
                                <div class="description mb-4"></div>
                                <div class="attribution mb-4"></div>
                                <div class="data-source mb-4">
                                    <h3 class="text-sm font-bold mb-2">Data Source</h3>
                                    <div class="source-details"></div>
                                </div>
                                <sl-details class="tilejson-section mb-4">
                                    <div slot="summary" class="text-sm font-bold">View Metadata</div>
                                    <div class="tilejson-content font-mono text-xs"></div>
                                </sl-details>
                                <sl-details class="advanced-section">
                                    <div slot="summary" class="text-sm font-bold">Edit Settings</div>
                                    <div class="config-editor mt-2"></div>
                                </sl-details>
                            </div>
                            <div class="col-2">
                                <div class="legend mb-4"></div>
                                <div class="style-section mb-4">
                                    <div class="style-editor"></div>
                                    <div class="inspect-section mb-4">
                                    <div class="inspect-editor"></div>
                                </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div slot="footer" class="flex justify-end gap-2">
                        <sl-button variant="default" class="cancel-button">Close</sl-button>
                        <sl-button variant="primary" class="save-button" style="display: none;">Save Changes</sl-button>
                    </div>
                </sl-dialog>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);

            // Add event listeners
            const modal = document.getElementById('layer-settings-modal');
            modal.querySelector('.cancel-button').addEventListener('click', () => modal.hide());
            modal.querySelector('.save-button').addEventListener('click', () => this._saveLayerSettings());
        }
    }

    async _showLayerSettings(group) {
        const modal = document.getElementById('layer-settings-modal');
        const content = modal.querySelector('.layer-settings-content');
        const saveButton = modal.querySelector('.save-button');

        // Reset save button visibility
        saveButton.style.display = 'none';

        // Store original config for comparison
        this._originalConfig = JSON.stringify(group);

        // Update header with background image
        const headerBg = modal.querySelector('.header-bg');
        const headerTitle = modal.querySelector('.header-title');

        headerTitle.textContent = group.title;

        if (group.headerImage) {
            headerBg.style.backgroundImage = `url('${group.headerImage}')`;
            headerBg.style.opacity = '1';
        } else {
            headerBg.style.backgroundImage = '';
            headerBg.style.opacity = '0';
        }

        // Update description
        const descriptionEl = content.querySelector('.description');
        if (group.description) {
            descriptionEl.innerHTML = `
                <div class="text-m">${group.description}</div>
            `;
            descriptionEl.style.display = '';
        } else {
            descriptionEl.style.display = 'none';
        }

        // Update attribution
        const attributionEl = content.querySelector('.attribution');
        if (group.attribution) {
            attributionEl.innerHTML = `
                <h3 class="text-sm font-bold mb-2">Attribution</h3>
                <div class="text-sm">${group.attribution}</div>
            `;
            attributionEl.style.display = '';
        } else {
            attributionEl.style.display = 'none';
        }

        // Update data source section and TileJSON
        const sourceDetails = content.querySelector('.source-details');
        const tileJSONSection = content.querySelector('.tilejson-section');
        sourceDetails.innerHTML = '';

        if (group.type === 'tms' || group.type === 'vector' || group.type === 'geojson' || group.type === 'raster-style-layer') {
            sourceDetails.innerHTML = `
                <div class="source-details-content bg-gray-100 rounded">
                    <div class="mb-2">
                        <div class="text-xs text-gray-600">Format</div>
                        <div class="font-mono text-sm">${group.type.toUpperCase()}</div>
                    </div>
                    ${group.type !== 'raster-style-layer' ? `
                        <div class="mb-2">
                            <div class="text-xs text-gray-600">URL</div>
                            <div class="font-mono text-sm break-all">${group.url}</div>
                        </div>
                    ` : `
                        <div class="mb-2">
                            <div class="text-xs text-gray-600">Style Layer</div>
                            <div class="font-mono text-sm">${group.styleLayer || group.id}</div>
                        </div>
                    `}
                    ${group.type === 'vector' ? `
                        <div class="mb-2">
                            <div class="text-xs text-gray-600">Source Layer</div>
                            <div class="font-mono text-sm">${group.sourceLayer || ''}</div>
                        </div>
                        <div>
                            <div class="text-xs text-gray-600">Max Zoom</div>
                            <div class="font-mono text-sm">${group.maxzoom || 'Not set'}</div>
                        </div>
                    ` : ''}
                </div>
            `;

            // Fetch and display TileJSON if available
            if ((group.type === 'vector' || group.type === 'tms') && group.url) {
                const tileJSON = await fetchTileJSON(group.url);
                if (tileJSON) {
                    content.querySelector('.tilejson-content').innerHTML = `
                        <div class="p-3 bg-gray-100 rounded">
                            <pre class="whitespace-pre-wrap">${JSON.stringify(tileJSON, null, 2)}</pre>
                        </div>
                    `;
                    tileJSONSection.style.display = '';
                } else {
                    tileJSONSection.style.display = 'none';
                }
            } else {
                tileJSONSection.style.display = 'none';
            }
        } else {
            sourceDetails.parentElement.style.display = 'none';
            tileJSONSection.style.display = 'none';
        }

        // Update legend
        const legendEl = content.querySelector('.legend');
        if (group.legendImage) {
            legendEl.innerHTML = `
                <h3 class="text-sm font-bold mb-2">Legend</h3>
                <img src="${group.legendImage}" alt="Legend" style="max-width: 100%">
            `;
            legendEl.style.display = '';
        } else {
            legendEl.style.display = 'none';
        }

        // Update style section
        const styleEditor = content.querySelector('.style-editor');
        if (group.style) {
            let styleHtml = `
                <div class="vector-legend">
                    <h3 class="text-base font-bold mb-3">Legend</h3>
                    <div class="legend-container p-3 bg-gray-100 rounded-lg">
                        <div class="legend-items space-y-2">`;

            // Helper function to extract simple value from expression
            const getSimpleValue = (value) => {
                if (typeof value === 'string') return value;
                if (typeof value === 'number') return value;
                if (Array.isArray(value)) {
                    // Handle common Mapbox expressions
                    if (value[0] === 'match' || value[0] === 'case' || value[0] === 'step') {
                        // Return the first non-expression value as default
                        for (let i = 1; i < value.length; i++) {
                            if (typeof value[i] === 'string' || typeof value[i] === 'number') {
                                return value[i];
                            }
                        }
                    }
                }
                return null;
            };

            // Helper function to parse match expression
            const parseMatchExpression = (expr) => {
                if (!Array.isArray(expr) || expr[0] !== 'match') return null;

                const field = expr[1];
                const cases = [];

                // Extract field name from ['get', 'fieldname']
                const fieldName = Array.isArray(field) && field[0] === 'get' ? field[1] : null;
                if (!fieldName) return null;

                // Parse cases - they come in pairs except for the default value at the end
                for (let i = 2; i < expr.length - 1; i += 2) {
                    const condition = expr[i];
                    const value = expr[i + 1];

                    // Handle both single values and arrays of values
                    const conditions = Array.isArray(condition) ? condition : [condition];
                    conditions.forEach(cond => {
                        cases.push({
                            field: fieldName,
                            value: cond,
                            result: value
                        });
                    });
                }

                // Add default case
                if (expr.length % 2 === 1) {
                    cases.push({
                        field: fieldName,
                        value: 'Other',
                        result: expr[expr.length - 1],
                        isDefault: true
                    });
                }

                return cases;
            };

            // Get style values
            const fillColor = group.style['fill-color'];
            const fillOpacity = getSimpleValue(group.style['fill-opacity']) || 0.5;
            const lineColor = group.style['line-color'];
            const lineWidth = group.style['line-width'];
            const lineDash = getSimpleValue(group.style['line-dasharray']);
            const textColor = group.style['text-color'];
            const textHaloColor = group.style['text-halo-color'];
            const textHaloWidth = group.style['text-halo-width'];

            // Parse match expressions
            const fillMatches = Array.isArray(fillColor) ? parseMatchExpression(fillColor) : null;
            const lineMatches = Array.isArray(lineColor) ? parseMatchExpression(lineColor) : null;
            const textMatches = Array.isArray(textColor) ? parseMatchExpression(textColor) : null;
            const haloMatches = Array.isArray(textHaloColor) ? parseMatchExpression(textHaloColor) : null;

            // Combine all unique match conditions
            const allMatches = new Map();

            const addMatches = (matches, type) => {
                if (!matches) return;
                matches.forEach(match => {
                    const key = `${match.field}:${match.value}`;
                    if (!allMatches.has(key)) {
                        allMatches.set(key, { ...match, styles: {} });
                    }
                    allMatches.get(key).styles[type] = match.result;
                });
            };

            addMatches(fillMatches, 'fill');
            addMatches(lineMatches, 'line');
            addMatches(textMatches, 'text');
            addMatches(haloMatches, 'halo');

            // If we have any matches, create legend items for each unique case
            if (allMatches.size > 0) {
                Array.from(allMatches.values()).forEach(match => {
                    const currentFillColor = match.styles.fill || (fillColor && getSimpleValue(fillColor));
                    const currentLineColor = match.styles.line || (lineColor && getSimpleValue(lineColor)) || '#000000';
                    const currentTextColor = match.styles.text || (textColor && getSimpleValue(textColor)) || '#000000';
                    const currentHaloColor = match.styles.halo || (textHaloColor && getSimpleValue(textHaloColor)) || '#ffffff';

                    styleHtml += `
                        <div class="legend-item flex items-center gap-3">
                            <div class="legend-symbol flex items-center">
                                <svg width="24" height="24" viewBox="0 0 24 24">
                                    <rect x="2" y="2" width="20" height="20" 
                                        fill="${currentFillColor || 'none'}" 
                                        fill-opacity="${fillOpacity}"
                                        stroke="${currentLineColor}" 
                                        stroke-width="${getSimpleValue(lineWidth) || 2}"
                                        ${lineDash ? `stroke-dasharray="${lineDash}"` : ''}
                                    />
                                </svg>
                            </div>
                            <div class="legend-info flex-grow">
                                <div class="legend-title text-sm"
                                    style="color: ${currentTextColor}; 
                                           text-shadow: 0 0 ${getSimpleValue(textHaloWidth) || 1}px ${currentHaloColor};">
                                    ${match.value}
                                </div>
                            </div>
                        </div>`;
                });
            } else {
                // Create single legend item for non-match cases
                const hasFill = fillColor && fillOpacity > 0;
                const simpleFillColor = getSimpleValue(fillColor);
                const simpleLineColor = getSimpleValue(lineColor) || '#000000';
                const simpleTextColor = getSimpleValue(textColor) || '#000000';
                const simpleHaloColor = getSimpleValue(textHaloColor) || '#ffffff';

                styleHtml += `
                    <div class="legend-item flex items-center gap-3">
                        <div class="legend-symbol flex items-center">
                            <svg width="24" height="24" viewBox="0 0 24 24">
                                <rect x="2" y="2" width="20" height="20" 
                                    fill="${hasFill && simpleFillColor ? simpleFillColor : 'none'}" 
                                    fill-opacity="${fillOpacity}"
                                    stroke="${simpleLineColor}" 
                                    stroke-width="${getSimpleValue(lineWidth) || 2}"
                                    ${lineDash ? `stroke-dasharray="${lineDash}"` : ''}
                                />
                            </svg>
                        </div>
                        <div class="legend-info flex-grow">
                            <div class="legend-title text-sm"
                                style="color: ${simpleTextColor}; 
                                       text-shadow: 0 0 ${getSimpleValue(textHaloWidth) || 1}px ${simpleHaloColor};">
                                ${group.inspect?.title || group.title}
                            </div>
                        </div>
                    </div>`;
            }

            // If it's a point feature, add circle symbol
            if (group.style['circle-radius'] || group.style['circle-color']) {
                const circleColor = getSimpleValue(group.style['circle-color']) || '#FF0000';
                const circleRadius = getSimpleValue(group.style['circle-radius']) || 6;
                const circleStrokeColor = getSimpleValue(group.style['circle-stroke-color']) || '#ffffff';
                const circleStrokeWidth = getSimpleValue(group.style['circle-stroke-width']) || 1;
                const circleOpacity = getSimpleValue(group.style['circle-opacity']) || 0.9;
                const circleStrokeOpacity = getSimpleValue(group.style['circle-stroke-opacity']) || 1;
                const circleBlur = getSimpleValue(group.style['circle-blur']) || 0;

                const blurStyle = circleBlur > 0 ? `filter: blur(${circleBlur}px);` : '';
                const opacityStyle = `opacity: ${circleOpacity};`;
                const strokeOpacityStyle = `opacity: ${circleStrokeOpacity};`;

                styleHtml += `
                    <div class="legend-item flex items-center gap-3">
                        <div class="legend-symbol flex items-center justify-center" style="width: 24px;">
                            <div class="legend-circle" style="
                                width: ${circleRadius * 2}px;
                                height: ${circleRadius * 2}px;
                                background-color: ${circleColor};
                                border: ${circleStrokeWidth}px solid ${circleStrokeColor};
                                border-radius: 50%;
                                ${blurStyle}
                                ${opacityStyle}
                            "></div>
                        </div>
                        <div class="legend-info">
                            <div class="legend-title text-sm">Point Feature</div>
                        </div>
                    </div>`;
            }

            styleHtml += `
                        </div>
                    </div>
                </div>`;

            styleEditor.innerHTML = styleHtml;
            styleEditor.parentElement.style.display = '';
        } else {
            styleEditor.parentElement.style.display = 'none';
        }

        // Update inspect section
        const inspectEditor = content.querySelector('.inspect-editor');
        if (group.inspect) {
            inspectEditor.innerHTML = `
                <sl-textarea
                    rows="10"
                    class="inspect-json"
                    label="Inspect Popup Settings"
                    value='${JSON.stringify(group.inspect, null, 2)}'
                ></sl-textarea>
            `;
            inspectEditor.parentElement.style.display = '';
        } else {
            inspectEditor.parentElement.style.display = 'none';
        }

        // Update advanced section
        const configEditor = content.querySelector('.config-editor');
        const configTextarea = document.createElement('sl-textarea');
        configTextarea.setAttribute('rows', '15');
        configTextarea.setAttribute('class', 'config-json');
        configTextarea.value = JSON.stringify(group, null, 2);

        // Add change listener to track modifications
        configTextarea.addEventListener('input', () => {
            try {
                const newConfig = JSON.parse(configTextarea.value);
                const hasChanges = this._originalConfig !== JSON.stringify(newConfig);
                saveButton.style.display = hasChanges ? '' : 'none';
            } catch (e) {
                // If JSON is invalid, keep save button hidden
                saveButton.style.display = 'none';
            }
        });

        configEditor.innerHTML = '';
        configEditor.appendChild(configTextarea);

        modal.show();
    }

    _saveLayerSettings() {
        const modal = document.getElementById('layer-settings-modal');
        const configTextarea = modal.querySelector('.config-json');

        try {
            // Parse the edited configuration
            const newConfig = JSON.parse(configTextarea.value);

            // Find the group that was being edited
            const groupIndex = this._state.groups.findIndex(g => g.id === newConfig.id);
            if (groupIndex === -1) {
                throw new Error('Could not find layer configuration to update');
            }

            const oldConfig = this._state.groups[groupIndex];

            // Update the configuration
            this._state.groups[groupIndex] = newConfig;

            // Remove old layers based on type
            if (oldConfig.type === 'vector') {
                const layerIds = [
                    `vector-layer-${oldConfig.id}`,
                    `vector-layer-${oldConfig.id}-outline`,
                    `vector-layer-${oldConfig.id}-text`,
                    `vector-layer-${oldConfig.id}-circle`
                ];
                layerIds.forEach(id => {
                    if (this._map.getLayer(id)) {
                        this._map.removeLayer(id);
                    }
                });
                if (this._map.getSource(`vector-${oldConfig.id}`)) {
                    this._map.removeSource(`vector-${oldConfig.id}`);
                }
            } else if (oldConfig.type === 'geojson') {
                const layerIds = [
                    `geojson-${oldConfig.id}-fill`,
                    `geojson-${oldConfig.id}-line`,
                    `geojson-${oldConfig.id}-label`,
                    `geojson-${oldConfig.id}-circle`
                ];
                layerIds.forEach(id => {
                    if (this._map.getLayer(id)) {
                        this._map.removeLayer(id);
                    }
                });
                if (this._map.getSource(`geojson-${oldConfig.id}`)) {
                    this._map.removeSource(`geojson-${oldConfig.id}`);
                }
            } else if (oldConfig.type === 'tms') {
                const layerId = `tms-layer-${oldConfig.id}`;
                if (this._map.getLayer(layerId)) {
                    this._map.removeLayer(layerId);
                }
                if (this._map.getSource(`tms-${oldConfig.id}`)) {
                    this._map.removeSource(`tms-${oldConfig.id}`);
                }
            }

            // Add new layers with updated configuration
            if (newConfig.type === 'vector') {
                const sourceId = `vector-${newConfig.id}`;
                const hasFillStyles = newConfig.style && (newConfig.style['fill-color'] || newConfig.style['fill-opacity']);
                const hasLineStyles = newConfig.style && (newConfig.style['line-color'] || newConfig.style['line-width']);
                const hasCircleStyles = newConfig.style && (newConfig.style['circle-color'] || newConfig.style['circle-radius']);

                // Add source with proper handling of Mapbox hosted tilesets
                const sourceConfig = {
                    type: 'vector',
                    maxzoom: newConfig.maxzoom || 22
                };

                // Handle Mapbox hosted tilesets differently
                if (newConfig.url.startsWith('mapbox://')) {
                    sourceConfig.url = newConfig.url;
                } else {
                    // For other vector tile sources, use tiles array
                    sourceConfig.tiles = [newConfig.url];
                }

                this._map.addSource(sourceId, sourceConfig);

                // Add fill layer if styles exist
                if (hasFillStyles) {
                    this._map.addLayer({
                        id: `vector-layer-${newConfig.id}`,
                        type: 'fill',
                        source: sourceId,
                        'source-layer': newConfig.sourceLayer,
                        paint: {
                            'fill-color': newConfig.style['fill-color'] || this._defaultStyles.vector.fill['fill-color'],
                            'fill-opacity': newConfig.style['fill-opacity'] || this._defaultStyles.vector.fill['fill-opacity']
                        },
                        layout: {
                            visibility: 'none'
                        }
                    });
                }

                // Add line layer if styles exist
                if (hasLineStyles) {
                    this._map.addLayer({
                        id: `vector-layer-${newConfig.id}-outline`,
                        type: 'line',
                        source: sourceId,
                        'source-layer': newConfig.sourceLayer,
                        paint: {
                            'line-color': this._combineWithDefaultStyle(newConfig.style?.['line-color'], this._defaultStyles.vector.line['line-color']),
                            'line-width': newConfig.style?.['line-width'] || this._defaultStyles.vector.line['line-width']
                        },
                        layout: {
                            visibility: 'none'
                        }
                    });
                }

                // Add circle layer if styles exist
                if (hasCircleStyles) {
                    this._map.addLayer({
                        id: `vector-layer-${newConfig.id}-circle`,
                        type: 'circle',
                        source: sourceId,
                        'source-layer': newConfig.sourceLayer,
                        paint: {
                            'circle-radius': newConfig.style['circle-radius'] || this._defaultStyles.vector.circle['circle-radius'],
                            'circle-color': newConfig.style['circle-color'] || this._defaultStyles.vector.circle['circle-color'],
                            'circle-opacity': newConfig.style['circle-opacity'] !== undefined ? newConfig.style['circle-opacity'] : this._defaultStyles.vector.circle['circle-opacity'],
                            'circle-stroke-width': newConfig.style['circle-stroke-width'] !== undefined ? newConfig.style['circle-stroke-width'] : this._defaultStyles.vector.circle['circle-stroke-width'],
                            'circle-stroke-color': newConfig.style['circle-stroke-color'] || this._defaultStyles.vector.circle['circle-stroke-color'],
                            'circle-stroke-opacity': newConfig.style['circle-stroke-opacity'] !== undefined ? newConfig.style['circle-stroke-opacity'] : this._defaultStyles.vector.circle['circle-stroke-opacity'],
                            'circle-blur': newConfig.style['circle-blur'] !== undefined ? newConfig.style['circle-blur'] : this._defaultStyles.vector.circle['circle-blur'],
                            'circle-translate': newConfig.style['circle-translate'] || this._defaultStyles.vector.circle['circle-translate'],
                            'circle-translate-anchor': newConfig.style['circle-translate-anchor'] || this._defaultStyles.vector.circle['circle-translate-anchor'],
                            'circle-pitch-alignment': newConfig.style['circle-pitch-alignment'] || this._defaultStyles.vector.circle['circle-pitch-alignment'],
                            'circle-pitch-scale': newConfig.style['circle-pitch-scale'] || this._defaultStyles.vector.circle['circle-pitch-scale']
                        },
                        layout: {
                            visibility: 'none'
                        }
                    });
                }

                // Add text layer if configured
                if (newConfig.style?.['text-field']) {
                    this._map.addLayer({
                        id: `${sourceId}-label`,
                        type: 'symbol',
                        source: sourceId,
                        layout: {
                            'text-font': newConfig.style?.['text-font'] || ['Open Sans Bold'],
                            'text-field': newConfig.style['text-field'],
                            'text-size': newConfig.style['text-size'] || 12,
                            'text-anchor': newConfig.style?.['text-anchor'] || 'center',
                            'text-justify': newConfig.style?.['text-justify'] || 'center',
                            'text-allow-overlap': newConfig.style?.['text-allow-overlap'] || false,
                            'text-offset': newConfig.style?.['text-offset'] || [0, 0],
                            'text-transform': newConfig.style?.['text-transform'] || 'none',
                            // Only set text-padding if it's defined to avoid undefined errors
                            ...(newConfig.style?.['text-padding'] !== undefined ? { 'text-padding': newConfig.style['text-padding'] } : {}),
                            visibility: 'visible'
                        },
                        paint: {
                            'text-color': newConfig.style?.['text-color'] || '#000000',
                            'text-halo-color': newConfig.style?.['text-halo-color'] || '#ffffff',
                            'text-halo-width': newConfig.style?.['text-halo-width'] !== undefined ? newConfig.style['text-halo-width'] : 1,
                            'text-halo-blur': newConfig.style?.['text-halo-blur'] !== undefined ? newConfig.style['text-halo-blur'] : 1,
                            'text-opacity': newConfig.style?.['text-opacity'] || [
                                'case',
                                ['boolean', ['feature-state', 'selected'], false],
                                1,
                                ['boolean', ['feature-state', 'hover'], false],
                                0.9,
                                0.7
                            ]
                        }
                    });
                }
            } else if (newConfig.type === 'geojson') {
                const sourceId = `geojson-${newConfig.id}`;

                // Add source
                this._map.addSource(sourceId, {
                    type: 'geojson',
                    data: newConfig.url
                });

                // Add fill layer
                this._map.addLayer({
                    id: `${sourceId}-fill`,
                    type: 'fill',
                    source: sourceId,
                    paint: {
                        'fill-color': newConfig.style?.['fill-color'] || this._defaultStyles.geojson.fill['fill-color'],
                        'fill-opacity': newConfig.style?.['fill-opacity'] || this._defaultStyles.geojson.fill['fill-opacity']
                    },
                    layout: {
                        visibility: 'none'
                    }
                });

                // Add line layer
                this._map.addLayer({
                    id: `${sourceId}-line`,
                    type: 'line',
                    source: sourceId,
                    paint: {
                        'line-color': this._combineWithDefaultStyle(newConfig.style?.['line-color'], this._defaultStyles.geojson.line['line-color']),
                        'line-width': newConfig.style?.['line-width'] || this._defaultStyles.geojson.line['line-width'],
                        'line-opacity': newConfig.style?.['line-opacity'] !== undefined ? newConfig.style['line-opacity'] : (this._defaultStyles.geojson.line['line-opacity'] || 1),
                        // Only set line-dasharray if it's defined to avoid undefined errors
                        ...(newConfig.style?.['line-dasharray'] || this._defaultStyles.geojson.line?.['line-dasharray'] ?
                            { 'line-dasharray': newConfig.style?.['line-dasharray'] || this._defaultStyles.geojson.line['line-dasharray'] } : {})
                    },
                    layout: {
                        'visibility': 'visible',
                        'line-join': 'round',
                        'line-cap': 'round'
                    }
                }, this._getInsertPosition('geojson', 'line'));

                // Add circle layer if circle properties are defined
                if (newConfig.style?.['circle-radius'] || newConfig.style?.['circle-color']) {
                    this._map.addLayer({
                        id: `${sourceId}-circle`,
                        type: 'circle',
                        source: sourceId,
                        paint: {
                            'circle-radius': newConfig.style['circle-radius'] || this._defaultStyles.geojson.circle?.['circle-radius'] || 5,
                            'circle-color': newConfig.style['circle-color'] || this._defaultStyles.geojson.circle?.['circle-color'] || '#FF0000',
                            'circle-opacity': newConfig.style['circle-opacity'] !== undefined ? newConfig.style['circle-opacity'] : (this._defaultStyles.geojson.circle?.['circle-opacity'] || 0.8),
                            'circle-stroke-width': newConfig.style['circle-stroke-width'] !== undefined ? newConfig.style['circle-stroke-width'] : (this._defaultStyles.geojson.circle?.['circle-stroke-width'] || 1),
                            'circle-stroke-color': newConfig.style['circle-stroke-color'] || this._defaultStyles.geojson.circle?.['circle-stroke-color'] || '#FFFFFF',
                            'circle-stroke-opacity': newConfig.style['circle-stroke-opacity'] !== undefined ? newConfig.style['circle-stroke-opacity'] : (this._defaultStyles.geojson.circle?.['circle-stroke-opacity'] || 1),
                            'circle-blur': newConfig.style['circle-blur'] !== undefined ? newConfig.style['circle-blur'] : (this._defaultStyles.geojson.circle?.['circle-blur'] || 0),
                            'circle-translate': newConfig.style['circle-translate'] || this._defaultStyles.geojson.circle?.['circle-translate'] || [0, 0],
                            'circle-translate-anchor': newConfig.style['circle-translate-anchor'] || this._defaultStyles.geojson.circle?.['circle-translate-anchor'] || 'map',
                            'circle-pitch-alignment': newConfig.style['circle-pitch-alignment'] || this._defaultStyles.geojson.circle?.['circle-pitch-alignment'] || 'viewport',
                            'circle-pitch-scale': newConfig.style['circle-pitch-scale'] || this._defaultStyles.geojson.circle?.['circle-pitch-scale'] || 'map'
                        },
                        layout: {
                            visibility: 'none'
                        }
                    });
                }

                // Add text layer if configured
                if (newConfig.style?.['text-field']) {
                    this._map.addLayer({
                        id: `${sourceId}-label`,
                        type: 'symbol',
                        source: sourceId,
                        layout: {
                            'text-font': newConfig.style?.['text-font'] || ['Open Sans Bold'],
                            'text-field': newConfig.style['text-field'],
                            'text-size': newConfig.style['text-size'] || 12,
                            'text-anchor': newConfig.style?.['text-anchor'] || 'center',
                            'text-justify': newConfig.style?.['text-justify'] || 'center',
                            'text-allow-overlap': newConfig.style?.['text-allow-overlap'] || false,
                            'text-offset': newConfig.style?.['text-offset'] || [0, 0],
                            'text-transform': newConfig.style?.['text-transform'] || 'none',
                            // Only set text-padding if it's defined to avoid undefined errors
                            ...(newConfig.style?.['text-padding'] !== undefined ? { 'text-padding': newConfig.style['text-padding'] } : {}),
                            visibility: 'visible'
                        },
                        paint: {
                            'text-color': newConfig.style?.['text-color'] || '#000000',
                            'text-halo-color': newConfig.style?.['text-halo-color'] || '#ffffff',
                            'text-halo-width': newConfig.style?.['text-halo-width'] !== undefined ? newConfig.style['text-halo-width'] : 1,
                            'text-halo-blur': newConfig.style?.['text-halo-blur'] !== undefined ? newConfig.style['text-halo-blur'] : 1,
                            'text-opacity': newConfig.style?.['text-opacity'] || [
                                'case',
                                ['boolean', ['feature-state', 'selected'], false],
                                1,
                                ['boolean', ['feature-state', 'hover'], false],
                                0.9,
                                0.7
                            ]
                        }
                    });
                }
            } else if (newConfig.type === 'tms') {
                const sourceId = `tms-${newConfig.id}`;
                const layerId = `tms-layer-${newConfig.id}`;

                // Add source
                // Check if it's a Mapbox hosted raster tileset
                if (newConfig.url.startsWith('mapbox://')) {
                    this._map.addSource(sourceId, {
                        type: 'raster',
                        url: newConfig.url,  // Keep the mapbox:// URL as is
                        tileSize: 256,
                        maxzoom: newConfig.maxzoom || 22
                    });
                } else {
                    this._map.addSource(sourceId, {
                        type: 'raster',
                        tiles: [newConfig.url],
                        tileSize: 256,
                        maxzoom: newConfig.maxzoom || 22
                    });
                }

                // Create layer config using the new flexible style system
                const layerConfig = this._createLayerConfig({
                    id: layerId,
                    source: sourceId,
                    style: {
                        // Merge default raster styles with user-defined styles
                        ...(this._defaultStyles.raster || {}),
                        ...(newConfig.style || {}),
                        // Fallback to legacy opacity property if no raster-opacity is specified
                        'raster-opacity': newConfig.style?.['raster-opacity'] || newConfig.opacity || this._defaultStyles.raster?.['raster-opacity'] || 1
                    },
                    initiallyChecked: false // Always start hidden in settings save
                }, 'raster');

                this._map.addLayer(layerConfig, this._getInsertPosition('tms'));
            }

            // Update UI
            const $groupHeader = $(this._sourceControls[groupIndex]);
            const $title = $groupHeader.find('.control-title');
            $title.text(newConfig.title);

            // If the layer was visible, make it visible again
            if ($groupHeader.find('.toggle-switch input').prop('checked')) {
                this._toggleSourceControl(groupIndex, true);
            }

            modal.hide();

        } catch (error) {
            console.error('Error saving layer settings:', error);
            alert('Failed to save layer settings. Please check the console for details.');
        }
    }

    _createLayerControls($groupHeader, group, groupIndex) {
        // ... existing code for creating layer controls ...

        // Add settings button next to opacity button
        const $settingsButton = $('<sl-icon-button>', {
            name: 'gear-fill',
            class: 'settings-button ml-2',
            label: 'Layer Settings'
        });

        $settingsButton.on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._showLayerSettings(group);
        });

        // Add settings button to content wrapper after opacity button
        $contentWrapper.append($settingsButton);

        // ... rest of the existing code ...
    }

    _initializeEditMode() {
        const editModeToggle = document.getElementById('edit-mode-toggle');
        if (editModeToggle) {
            editModeToggle.addEventListener('click', () => {
                this._editMode = !this._editMode;
                editModeToggle.classList.toggle('active');
                editModeToggle.style.backgroundColor = this._editMode ? '#006dff' : '';
            });
        }
    }

    _createConsolidatedHoverContent() {
        // Consolidated hover content now handled by state manager
        return null;


    }

    async _setupCsvLayer(group) {
        if (!group.data && !group.url) {
            console.error('CSV layer missing both data and URL:', group);
            return;
        }

        const sourceId = `csv-${group.id}`;
        const layerId = `${sourceId}-circle`;

        try {
            let geojson;
            
            if (group.data) {
                // Use inline data
                if (Array.isArray(group.data)) {
                    // Data is already parsed rows - convert directly to GeoJSON
                    geojson = rowsToGeoJSON(group.data);
                } else if (typeof group.data === 'string') {
                    // Data is CSV text - parse it first
                    let rows;
                    if (group.csvParser) {
                        rows = group.csvParser(group.data);
                    } else {
                        rows = parseCSV(group.data);
                    }
                    geojson = rowsToGeoJSON(rows);
                } else {
                    console.error('Invalid CSV data format in group:', group.id, 'Expected array of objects or CSV string');
                    return;
                }
            } else {
                // Fetch CSV data from URL
                const response = await fetch(group.url);
                let csvText = await response.text();

                // Parse CSV data
                let rows;
                if (group.csvParser) {
                    rows = group.csvParser(csvText);
                } else {
                    rows = parseCSV(csvText);
                }

                // Convert to GeoJSON
                geojson = rowsToGeoJSON(rows);
            }

            // Add source if it doesn't exist
            if (!this._map.getSource(sourceId)) {
                this._map.addSource(sourceId, {
                    type: 'geojson',
                    data: geojson
                });

                // Check if layer should be visible based on URL parameters or initiallyChecked
                const urlParams = new URLSearchParams(window.location.search);
                const activeLayers = urlParams.get('layers') ?
                    urlParams.get('layers').split(',').map(s => s.trim()) :
                    this._state.groups
                        .filter(g => g.initiallyChecked)
                        .map(g => g.id);

                const isVisible = activeLayers.includes(group.id);

                // Add circle layer with correct initial visibility
                this._map.addLayer({
                    id: layerId,
                    type: 'circle',
                    source: sourceId,
                    paint: {
                        'circle-radius': group.style?.['circle-radius'] || 5,
                        'circle-color': group.style?.['circle-color'] || '#3887be',
                        'circle-opacity': group.style?.['circle-opacity'] || 0.7,
                        'circle-stroke-width': group.style?.['circle-stroke-width'] || 1.5,
                        'circle-stroke-color': group.style?.['circle-stroke-color'] || '#ffffff',
                        'circle-stroke-opacity': group.style?.['circle-stroke-opacity'] || 1,
                        'circle-blur': group.style?.['circle-blur'] || 0,
                        'circle-translate': group.style?.['circle-translate'] || [0, 0],
                        'circle-translate-anchor': group.style?.['circle-translate-anchor'] || 'map',
                        'circle-pitch-alignment': group.style?.['circle-pitch-alignment'] || 'viewport',
                        'circle-pitch-scale': group.style?.['circle-pitch-scale'] || 'map'
                    },
                    layout: {
                        'visibility': isVisible ? 'visible' : 'none'
                    }
                }, this._getInsertPosition('csv'));

                // Set up interactivity
                this._setupLayerInteractivity(group, [layerId], sourceId);

                // Ensure visibility state is properly set after layer is added
                this._map.once('idle', () => {
                    if (isVisible) {
                        this._map.setLayoutProperty(layerId, 'visibility', 'visible');
                    }
                });
            } else {
                // Update existing source with new data
                this._map.getSource(sourceId).setData(geojson);
            }

            // Set up refresh interval if specified (only for URL-based data)
            if (group.refresh && group.url) {
                this._setupCsvRefresh(group);
            }

        } catch (error) {
            console.error(`Error loading CSV layer '${group.id}':`, error);
        }
    }

    _setupCsvRefresh(group) {
        // Clear any existing timer
        if (group._refreshTimer) {
            clearInterval(group._refreshTimer);
        }

        const sourceId = `csv-${group.id}`;

        // Set up new refresh timer
        group._refreshTimer = setInterval(async () => {
            if (!this._map.getSource(sourceId)) {
                clearInterval(group._refreshTimer);
                group._refreshTimer = null;
                return;
            }

            try {
                // Fetch updated CSV data
                const response = await fetch(group.url);
                let csvText = await response.text();

                // Parse CSV data
                let rows;
                if (group.csvParser) {
                    rows = group.csvParser(csvText);
                } else {
                    rows = parseCSV(csvText);
                }

                // Convert to GeoJSON
                const geojson = rowsToGeoJSON(rows);

                // Update source data
                this._map.getSource(sourceId).setData(geojson);
            } catch (error) {
                console.error('Error refreshing CSV layer:', error);
            }
        }, group.refresh);
    }

    // Add this function after _setupCsvRefresh
    _setupImgRefresh(group) {
        // Clear any existing timer
        if (group._refreshTimer) {
            clearInterval(group._refreshTimer);
        }

        // Set up interval to refresh the image source
        group._refreshTimer = setInterval(() => {
            if (!this._map.getSource(group.id)) {
                clearInterval(group._refreshTimer);
                group._refreshTimer = null;
                return;
            }

            // Update the image URL with a cache-busting parameter
            const timestamp = Date.now();
            const url = group.url.includes('?')
                ? `${group.url}&_t=${timestamp}`
                : `${group.url}?_t=${timestamp}`;

            // First preload the new image to ensure it exists
            const img = new Image();
            img.crossOrigin = "Anonymous"; // Enable CORS if needed

            img.onload = () => {
                // Once image is loaded, update the map source
                try {
                    const source = this._map.getSource(group.id);
                    if (!source) {
                        console.error(`Source not found for image layer ${group.id} during refresh`);
                        return;
                    }

                    source.updateImage({
                        url: url,
                        coordinates: source.coordinates
                    });
                } catch (err) {
                    console.error(`Error updating image layer ${group.id}:`, err);
                }
            };

            img.onerror = (err) => {
                console.error(`Failed to refresh image for layer ${group.id}:`, err);
            };

            // Start loading the new image
            img.src = url;

        }, group.refresh);
    }

    _combineWithDefaultStyle(userColor, defaultStyleExpression) {
        // If no user color is provided, return the default style unchanged
        if (!userColor) return defaultStyleExpression;

        // If default style is not an expression (just a simple color), return user color
        if (!Array.isArray(defaultStyleExpression)) return userColor;

        // If user color contains a zoom expression (interpolate/step with zoom), use it directly
        if (Array.isArray(userColor) && this._hasZoomExpression(userColor)) {
            return userColor;
        }

        // Clone the default style expression to avoid modifying the original
        const result = JSON.parse(JSON.stringify(defaultStyleExpression));

        // Handle different types of expressions
        if (result[0] === 'case') {
            // Simple case expression - replace the fallback color (last value)
            result[result.length - 1] = userColor;
        } else if (result[0] === 'interpolate' && result[2] && Array.isArray(result[2]) && result[2][0] === 'zoom') {
            // Interpolate expression with zoom - replace fallback colors in nested case expressions
            this._replaceColorsInInterpolateExpression(result, userColor);
        } else {
            // For other expression types, return user color directly
            return userColor;
        }

        return result;
    }

    _hasZoomExpression(expression) {
        if (!Array.isArray(expression)) return false;

        // Check if this is an interpolate or step expression with zoom
        if ((expression[0] === 'interpolate' || expression[0] === 'step') &&
            expression.length > 2 &&
            Array.isArray(expression[2]) &&
            expression[2][0] === 'zoom') {
            return true;
        }

        // Recursively check nested expressions
        for (let i = 1; i < expression.length; i++) {
            if (Array.isArray(expression[i]) && this._hasZoomExpression(expression[i])) {
                return true;
            }
        }

        return false;
    }

    _replaceColorsInInterpolateExpression(interpolateExpr, newColor) {
        // For interpolate expressions like: ["interpolate", ["linear"], ["zoom"], 6, caseExpr1, 16, caseExpr2]
        // We need to replace the fallback color in each case expression
        for (let i = 4; i < interpolateExpr.length; i += 2) {
            const valueExpr = interpolateExpr[i];
            if (Array.isArray(valueExpr) && valueExpr[0] === 'case') {
                // Replace the fallback color (last value) in the case expression
                valueExpr[valueExpr.length - 1] = newColor;
            }
        }
    }

    // Helper function to calculate bounding box from center coordinates and zoom
    _calculateBbox(centerLng, centerLat, zoom) {
        // Calculate an approximate bbox based on zoom level
        // Higher zoom = smaller area
        const offset = 0.5 / Math.pow(2, zoom - 10); // Adjust multiplier as needed
        return {
            west: centerLng - offset,
            south: centerLat - offset,
            east: centerLng + offset,
            north: centerLat + offset
        };
    }

    _clearAllSelectedFeatures() {
        // Selected features are now managed by the state manager
        // This method is kept for backwards compatibility but simplified
    }

    _addGlobalClickHandler() {
        if (this._globalClickHandlerAdded) return;

        this._map.on('click', (e) => {
            // Use setTimeout to ensure this runs after layer-specific click handlers
            setTimeout(() => {
                // Check if the click was on any feature by querying all rendered features at the point
                const features = this._map.queryRenderedFeatures(e.point);

                // Filter out base map features - only check for our custom layers
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

                // If no custom features were clicked (empty area), clear all selections
                if (customFeatures.length === 0) {
                    // Use state manager to clear selections if available
                    if (this._stateManager) {
                        this._stateManager.clearAllSelections();
                    }

                    // Also close any open popups
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
}

// Make available globally for backwards compatibility
if (typeof window !== 'undefined') {
    window.MapLayerControl = MapLayerControl;
} 
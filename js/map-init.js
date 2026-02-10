import { URLManager } from './url-manager.js';
import { TimeControl } from './time-control.js';
import { MapLayerControl } from './map-layer-controls.js';
import { LayerOrderManager } from './layer-order-manager.js';
import { StatePersistence } from './state-persistence.js';
import { MapSearchControl } from './map-search-control.js';
import { MapExportControl } from './map-export-control.js';
import { Terrain3DControl } from './terrain-3d-control.js';
import { MapFeatureControl } from './map-feature-control-iframe.js';
import { MapBrowserControl } from './map-browser-control.js';
import { MapAttributionControl } from './map-attribution-control.js';
import { ButtonExternalMapLinks } from './button-external-map-links.js';
import { MapFeatureStateManager } from './map-feature-state-manager.js';
import { ButtonGeolocationManager } from './button-geolocation-manager.js';
import { DataUtils, MapUtils, URLUtils } from './map-utils.js';

export class MapInitializer {
    // Function to load configuration
    static async loadConfiguration() {
        // Initialize the layer registry first
        await layerRegistry.initialize();

        // Check if a specific config is requested via URL parameter
        var configParam = URLUtils.getUrlParameter('atlas');
        var layersParam = URLUtils.getUrlParameter('layers');

        let configPath = window.amche.DEFAULT_ATLAS;
        let config;
        let atlasId = 'index'; // Track which atlas we're using
        let isImportedAtlas = false; // Track if this is an imported atlas

        // If a config parameter is provided, determine how to handle it
        if (configParam) {
            // Check if the config parameter is a JSON string
            if (configParam.startsWith('{') && configParam.endsWith('}')) {
                try {
                    config = JSON.parse(configParam); // Parse JSON directly

                    // Minify the JSON by removing whitespace and rewrite the URL
                    const minifiedJson = JSON.stringify(config);
                    if (minifiedJson !== configParam) {
                        // Update the URL with minified JSON without URL encoding
                        const url = new URL(window.location);
                        const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
                        const otherParams = new URLSearchParams(url.search);
                        otherParams.delete('atlas'); // Remove existing atlas param

                        // Build the new URL manually to avoid URL encoding the JSON
                        let newUrl = baseUrl;
                        if (otherParams.toString()) {
                            newUrl += '?' + otherParams.toString() + '&atlas=' + minifiedJson;
                        } else {
                            newUrl += '?atlas=' + minifiedJson;
                        }

                        // Add hash if it exists
                        if (url.hash) {
                            newUrl += url.hash;
                        }

                        window.history.replaceState({}, '', newUrl);
                    }
                } catch (error) {
                    console.error('Failed to parse atlas JSON from URL parameter:', error);
                    throw new Error('Invalid JSON in atlas parameter');
                }
            }
            // Check if the config parameter is a URL
            else if (configParam.startsWith('http://') || configParam.startsWith('https://')) {
                configPath = configParam; // Use the URL directly
                atlasId = 'imported'; // Mark as imported atlas
                isImportedAtlas = true; // Flag as imported
            } else {
                configPath = `config/${configParam}.atlas.json`; // Treat as local file
                atlasId = configParam; // Use the config name as atlas ID
            }
        }

        // Load the configuration file (only if we didn't parse JSON directly)
        if (!config) {
            const configResponse = await fetch(configPath);
            config = await configResponse.json();
        }

        // Set current atlas in registry
        layerRegistry.setCurrentAtlas(atlasId);

        // Mark as imported atlas if loaded via URL
        if (isImportedAtlas) {
            // Store the imported atlas metadata with '*' prefix and register layers
            const atlasName = config.name || 'Imported Map';
            layerRegistry.markImportedAtlas(atlasId, {
                name: `* ${atlasName}`,
                originalName: atlasName,
                color: config.color || '#059669',
                areaOfInterest: config.areaOfInterest || '',
                description: config.description || '',
                bbox: layerRegistry._extractBbox(config),
                isImported: true,
                sourceUrl: configPath
            }, config);
        }

        // Parse layers from URL parameter if provided
        console.log('🔍 Checking layersParam:', layersParam);
        if (layersParam) {
            const urlLayers = URLUtils.parseLayersFromUrl(layersParam);
            console.log('🔍 Parsed URL layers:', urlLayers.map(l => l.id));

            // Set URL layers to be visible by default and maintain order
            if (urlLayers.length > 0) {
                console.log('🔍 Processing', urlLayers.length, 'URL layers');
                // Set initiallyChecked to true for all URL layers
                const processedUrlLayers = urlLayers.map(layer => ({
                    ...layer,
                    initiallyChecked: true,
                    // Preserve the original JSON for custom layers
                    ...(layer._originalJson && { _originalJson: layer._originalJson })
                }));

                // When URL layers are specified, set ALL existing layers to initiallyChecked: false
                // This ensures only URL-specified layers are visible
                const existingLayers = config.layers || [];
                const urlLayerIds = new Set(processedUrlLayers.map(l => l.id));

                // Reset all existing layers to not be initially checked
                existingLayers.forEach(layer => {
                    if (!urlLayerIds.has(layer.id)) {
                        layer.initiallyChecked = false;
                    }
                });

                // Create minified layers parameter for URL rewriting
                const minifiedLayersParam = processedUrlLayers.map(layer => {
                    return layer._originalJson || layer.id;
                }).join(',');

                // Check if we need to create a pretty URL (either layers changed or URL has encoded params)
                const shouldPrettifyURL = minifiedLayersParam !== layersParam || URLUtils.needsURLPrettification();

                if (shouldPrettifyURL) {
                    const url = new URL(window.location);
                    const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
                    const otherParams = new URLSearchParams(url.search);
                    otherParams.delete('layers'); // Remove existing layers param

                    // Build a clean, pretty URL without URL encoding the layers parameter
                    let newUrl = baseUrl;
                    const params = [];

                    // Add other parameters first (these may be URL-encoded)
                    const otherParamsString = otherParams.toString();
                    if (otherParamsString) {
                        params.push(otherParamsString);
                    }

                    // Add layers parameter without URL encoding to keep it readable
                    if (minifiedLayersParam) {
                        params.push('layers=' + minifiedLayersParam);
                    }

                    // Build the final URL
                    if (params.length > 0) {
                        newUrl += '?' + params.join('&');
                    }

                    // Add hash if it exists
                    if (url.hash) {
                        newUrl += url.hash;
                    }

                    // Update to ensure we have a pretty URL
                    window.history.replaceState({}, '', newUrl);
                }

                // Keep layers in URL/visual order (first = top)
                // The conversion to map rendering order will happen when layers are added to the map
                console.log('🔍 Processing URL layers (keeping in visual order):');
                console.log('  URL order:', processedUrlLayers.map(l => l.id));

                // Build final layers array by merging with existing config
                const finalLayers = [];

                // Add URL layers in URL/visual order (first = top)
                processedUrlLayers.forEach(urlLayer => {
                    // Find matching layer in existing config to merge properties
                    const existingLayer = existingLayers.find(layer => layer.id === urlLayer.id);

                    if (existingLayer) {
                        // Merge existing layer with URL layer properties
                        finalLayers.push({
                            ...existingLayer,
                            ...urlLayer,
                            // Ensure critical URL properties are preserved
                            ...(urlLayer._originalJson && { _originalJson: urlLayer._originalJson }),
                            ...(urlLayer.initiallyChecked !== undefined && { initiallyChecked: urlLayer.initiallyChecked }),
                            ...(urlLayer.opacity !== undefined && { opacity: urlLayer.opacity })
                        });
                    } else {
                        // New layer not in existing config
                        finalLayers.push(urlLayer);
                    }
                });

                // Add any remaining layers from existing config that weren't in URL (set to not initially checked)
                existingLayers.forEach(layer => {
                    if (!urlLayerIds.has(layer.id)) {
                        finalLayers.push({
                            ...layer,
                            initiallyChecked: false
                        });
                    }
                });

                config.layers = finalLayers;

            }
        }

        // Load defaults
        try {
            const configDefaultsResponse = await fetch('config/_defaults.json');
            const configDefaults = await configDefaultsResponse.json();

            // Merge defaults with anyoverrides in config
            config.defaults = config.defaults ?
                DataUtils.deepMerge(configDefaults, config.defaults) :
                configDefaults;
        } catch (error) {
            console.warn('Default configuration values not found or invalid:', error);
        }

        // Process each layer in the config using the layer registry
        if (config.layers && Array.isArray(config.layers)) {
            const validLayers = [];
            const invalidLayers = [];

            // Process layers one by one
            for (const layerConfig of config.layers) {
                // If the layer only has an id (or minimal properties), look it up using the registry
                if (layerConfig.id && !layerConfig.type) {
                    // Try to resolve the layer from the registry
                    // This handles both current atlas layers and cross-atlas references
                    let resolvedLayer = layerRegistry.getLayer(layerConfig.id, atlasId);

                    // If not found in primary registry, try cross-config loading
                    if (!resolvedLayer) {
                        // Using the new method on layerRegistry
                        resolvedLayer = await layerRegistry.tryLoadCrossConfigLayer(layerConfig.id, layerConfig);
                    }

                    if (resolvedLayer) {
                        if (!resolvedLayer.type) {
                            console.warn(`[LayerRegistry] Resolved layer ${layerConfig.id} from registry is missing type property. Registry entry:`, resolvedLayer);
                        }

                        // Merge the resolved layer with any custom overrides from config
                        // Preserve important URL-specific properties
                        // Note: layerConfig is spread after resolvedLayer, so it can override properties
                        // But we explicitly preserve critical properties from resolvedLayer if layerConfig doesn't provide them
                        // Preserve type before merging - critical for cross-atlas references
                        const preservedType = layerConfig.type || resolvedLayer.type;

                        const mergedLayer = {
                            ...resolvedLayer,
                            ...layerConfig,
                            // Explicitly set type to ensure it's never lost during merge
                            // layerConfig.type takes precedence if provided, otherwise use resolvedLayer.type
                            type: preservedType,
                            // Preserve proxy settings from resolved layer if not overridden
                            ...(resolvedLayer.proxyUrl && !layerConfig.proxyUrl && {
                                proxyUrl: resolvedLayer.proxyUrl,
                                proxyReferer: resolvedLayer.proxyReferer
                            }),
                            // Ensure these critical properties are preserved
                            ...(layerConfig._originalJson && { _originalJson: layerConfig._originalJson }),
                            ...(layerConfig.initiallyChecked !== undefined && { initiallyChecked: layerConfig.initiallyChecked }),
                            ...(layerConfig.opacity !== undefined && { opacity: layerConfig.opacity }),
                            // Store normalized ID for URL serialization
                            _normalizedId: layerRegistry.normalizeLayerId(layerConfig.id, atlasId)
                        };

                        // Verify the merge preserved important properties
                        if (!mergedLayer.title) {
                            console.warn(`[LayerRegistry] Cross-atlas layer ${layerConfig.id} from ${resolvedLayer._sourceAtlas} atlas missing title after merge (this is unusual)`);
                        }
                        if (!mergedLayer.type) {
                            console.warn(`[LayerRegistry] Cross-atlas layer ${layerConfig.id} from ${resolvedLayer._sourceAtlas} atlas missing type after merge - this may cause layer creation to fail`);
                        }

                        validLayers.push(mergedLayer);
                    } else {
                        // Layer not found in registry - check if it came from URL
                        if (layerConfig.initiallyChecked === true) {
                            console.warn(`[LayerRegistry] Unknown layer ID from URL: "${layerConfig.id}" - ignoring.`);
                            invalidLayers.push(layerConfig.id);
                        } else {
                            console.warn(`[LayerRegistry] Layer "${layerConfig.id}" not found in registry, using as-is (might be missing metadata)`);
                            // For non-URL layers, keep them as-is (they might be fully defined custom layers)
                            validLayers.push(layerConfig);
                        }
                    }
                } else {
                    validLayers.push(layerConfig);
                }
            }

            config.layers = validLayers;

            // If we found invalid layers from URL, update the URL to remove them
            if (invalidLayers.length > 0 && layersParam) {
                console.warn(`Removing invalid layer IDs from URL: ${invalidLayers.join(', ')}`);

                // Get the remaining valid layers that were originally from URL
                const validUrlLayers = validLayers.filter(layer => layer.initiallyChecked === true);

                // Reconstruct the layers parameter with only valid layers
                const newLayersParam = validUrlLayers.map(layer => {
                    return layer._originalJson || layer._normalizedId || layer.id;
                }).join(',');

                // Update the URL
                const url = new URL(window.location);
                const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
                const otherParams = new URLSearchParams(url.search);
                otherParams.delete('layers');

                let newUrl = baseUrl;
                if (newLayersParam) {
                    // Only add layers parameter if there are valid layers
                    if (otherParams.toString()) {
                        newUrl += '?' + otherParams.toString() + '&layers=' + newLayersParam;
                    } else {
                        newUrl += '?layers=' + newLayersParam;
                    }
                } else {
                    // No valid layers left, just add other parameters if any
                    if (otherParams.toString()) {
                        newUrl += '?' + otherParams.toString();
                    }
                }

                // Add hash if it exists
                if (url.hash) {
                    newUrl += url.hash;
                }

                window.history.replaceState({}, '', newUrl);
            }
        }

        // Final check: prettify URL if it still has encoded parameters (e.g., terrain parameter)
        if (URLUtils.needsURLPrettification()) {
            const url = new URL(window.location);
            const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
            const params = new URLSearchParams(url.search);

            // Manually build pretty URL without re-encoding
            let newUrl = baseUrl;
            const prettyParams = [];

            for (const [key, value] of params.entries()) {
                if (key === 'layers') {
                    // Keep layers parameter unencoded for readability
                    prettyParams.push(`${key}=${value}`);
                } else {
                    // For other parameters, we can allow minimal encoding if needed
                    prettyParams.push(`${key}=${value}`);
                }
            }

            if (prettyParams.length > 0) {
                newUrl += '?' + prettyParams.join('&');
            }

            // Add hash if it exists
            if (url.hash) {
                newUrl += url.hash;
            }

            window.history.replaceState({}, '', newUrl);
        }

        return config;
    }

    // Initialize the map with the configuration
    static async initializeMap() {
        const config = await this.loadConfiguration();
        const layers = config.layers || [];
        console.log('🔍 Final layers for MapLayerControl:', layers.filter(l => l.initiallyChecked).map(l => l.id));

        // Apply defaults from config.defaults.map first
        if (config.defaults && config.defaults.map) {
            Object.assign(window.amche.MAPBOX_MAP_OPTIONS, config.defaults.map);
        }

        // Then apply atlas-specific overrides from config.map
        if (config.map) {
            Object.assign(window.amche.MAPBOX_MAP_OPTIONS, config.map);
        }

        const map = new mapboxgl.Map(window.amche.MAPBOX_MAP_OPTIONS);

        // Make map accessible globally for debugging
        window.map = map;

        // Setup proper cursor handling for map dragging
        map.on('load', () => {
            // Initialize slot layers for proper layer ordering
            // Reference: https://docs.mapbox.com/style-spec/reference/slots/
            // Initialize slot layers for proper layer ordering
            // Reference: https://docs.mapbox.com/style-spec/reference/slots/
            MapUtils.initializeSlotLayers(map);

            // Add debugging method to global scope
            window.verifyLayerOrder = () => {
                const urlParams = new URLSearchParams(window.location.search);
                const layersParam = urlParams.get('layers');
                if (!layersParam) {
                    console.error('No layers parameter in URL');
                    return;
                }
                const urlLayers = layersParam.split(',').map(id => ({ id: id.trim() }));
                const result = LayerOrderManager.verifyLayerOrder(map, urlLayers);
                console.group('🔍 Layer Order Verification');
                console.log(result.message);
                console.log('URL order (first = on top):', result.urlOrder);
                console.log('Visual order (first = on bottom):', result.visualOrder);
                console.log('Expected visual order:', result.expectedOrder);
                console.log('Slots:', result.slots);
                if (!result.valid) {
                    console.error('❌ Mismatch detected!');
                }
                console.groupEnd();
                return result;
            };

            const canvas = map.getCanvas();

            // Set default cursor
            canvas.style.cursor = 'grab';

            // Handle mouse events for proper cursor states
            map.on('mousedown', () => {
                canvas.style.cursor = 'grabbing';
            });

            map.on('mouseup', () => {
                canvas.style.cursor = 'grab';
            });

            map.on('mouseleave', () => {
                canvas.style.cursor = 'grab';
            });

            // Handle drag events
            map.on('dragstart', () => {
                canvas.style.cursor = 'grabbing';
            });

            map.on('dragend', () => {
                canvas.style.cursor = 'grab';
            });

            // Initialize centralized state manager (NEW ARCHITECTURE)
            const stateManager = new MapFeatureStateManager(map);

            // Enable debug logging temporarily to diagnose layer matching issues
            stateManager.setDebug(true);

            // Hide loader and show controls
            document.getElementById('map-layer-filter').classList.remove('hidden');

            // Initialize layer control & Make it globally accessible
            window.layerControl = new MapLayerControl(layers);
            window.layerControl.renderToContainer('#layer-controls-container', map);
            window.layerControl.setStateManager(stateManager);

            // Make components globally accessible
            window.stateManager = stateManager;

            // Add custom attribution control that handles formatting and removes duplicates
            window.attributionControl = new MapAttributionControl();
            // Add 3D terrain control (will be initialized after URL manager is ready)
            window.terrain3DControl = new Terrain3DControl();
            // Initialize the feature control with state manager and config
            window.featureControl = new MapFeatureControl();

            // Add map browser control to header instead of map
            window.browserControl = new MapBrowserControl();
            const browserControlContainer = document.getElementById('map-browser-control-container');
            if (browserControlContainer) {
                const controlElement = window.browserControl.onAdd(map);
                browserControlContainer.appendChild(controlElement);
            }

            // Add geolocation control to header instead of map
            window.geolocationControl = new ButtonGeolocationManager();
            const geolocationControlContainer = document.getElementById('geolocation-control-container');
            if (geolocationControlContainer) {
                const controlElement = window.geolocationControl.onAdd(map);
                geolocationControlContainer.appendChild(controlElement);
            }
            map.addControl(window.featureControl, 'top-right');
            map.addControl(new TimeControl(), 'top-right');
            map.addControl(window.terrain3DControl, 'top-right');
            map.addControl(window.attributionControl, 'bottom-right');
            map.addControl(new MapExportControl(), 'bottom-right');
            map.addControl(new ButtonExternalMapLinks(), 'bottom-right');
            map.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true }));
            map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');

            // Show feature control panel by default on initial load
            // Show feature control panel by default on initial load
            window.featureControl.initialize(stateManager, config);
            window.featureControl._showPanel();

            // Initialize 3D control from URL parameters after URL manager is ready
            window.terrain3DControl.initializeFromURL();

            // Initialize state persistence and try to restore saved state
            const statePersistence = new StatePersistence();
            const stateRestored = statePersistence.restoreStateOnLoad();

            // Initialize URL manager after layer control is ready
            const urlManager = new URLManager(window.layerControl, map);
            urlManager.setupLayerControlEventListeners();

            // Make URL manager globally accessible
            window.urlManager = urlManager;

            // Connect URL manager with state manager for feature selection URL sync
            urlManager.setStateManager(stateManager);

            // Apply URL parameters (including geolocate parameter)
            // Skip URL parameter application if state was restored from localStorage
            if (!stateRestored) {
                urlManager.applyURLParameters();
            } else {
                // If state was restored, still need to apply URL parameters for restored URL
                setTimeout(() => {
                    urlManager.applyURLParameters();
                }, 100);
            }

            // Initialize state persistence event listeners after URL manager is ready
            statePersistence.initialize();

            // Make URL manager globally accessible for ShareLink
            window.urlManager = urlManager;

            // Update attribution with location name on map movement
            let reverseGeocodeTimeout;
            const updateAttributionLocation = async () => {
                try {
                    const center = map.getCenter();
                    const zoom = map.getZoom();
                    const latRounded = Math.round(center.lat * 100000) / 100000;
                    const lngRounded = Math.round(center.lng * 100000) / 100000;
                    const nominatimZoom = Math.max(0, Math.min(18, Math.round(zoom)));
                    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latRounded}&lon=${lngRounded}&zoom=${nominatimZoom}&addressdetails=1`;

                    const response = await fetch(url, {
                        headers: { 'User-Agent': 'AMChe-Goa-Map/1.0' }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        if (data.display_name && window.attributionControl) {
                            window.attributionControl.setLocation(data.display_name);
                        }
                    }
                } catch (e) {
                    console.debug('Reverse geocoding failed', e);
                }
            };

            map.on('moveend', () => {
                clearTimeout(reverseGeocodeTimeout);
                reverseGeocodeTimeout = setTimeout(updateAttributionLocation, 1000);
            });

            updateAttributionLocation();

            // Only set camera position if there's no hash in URL
            if (!window.location.hash) {
                setTimeout(() => {
                    // Use config center and zoom if available, otherwise fallback to hardcoded values
                    const flyToOptions = {
                        center: config.map?.center || [73.8274, 15.4406],
                        zoom: config.map?.zoom || 9,
                        pitch: 28,
                        bearing: 0,
                        duration: 3000,
                        essential: true,
                        curve: 1.42,
                        speed: 0.6
                    };
                    map.flyTo(flyToOptions);
                }, 2000);
            }

            // Add global keyboard shortcuts
            document.addEventListener('keydown', (event) => {
                // Toggle layer drawer with '/' key
                if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                    // First, check if the event target itself is an input field
                    const target = event.target;
                    const isTargetInput = target && (
                        target.tagName === 'INPUT' ||
                        target.tagName === 'TEXTAREA' ||
                        target.contentEditable === 'true' ||
                        target.tagName === 'SL-INPUT' ||
                        target.tagName === 'SL-TEXTAREA' ||
                        target.tagName === 'MAPBOX-SEARCH-BOX' ||
                        target.type === 'text' ||
                        target.type === 'search' ||
                        target.type === 'email' ||
                        target.type === 'password' ||
                        target.type === 'number' ||
                        target.type === 'tel' ||
                        target.type === 'url'
                    );

                    if (isTargetInput) {
                        return; // Don't prevent default, let the input handle the key
                    }
                    // Check if we're in an input field or search box
                    const activeElement = document.activeElement;

                    // Comprehensive check for input fields including shadow DOM
                    const isInputField = activeElement && (
                        // Direct input elements
                        activeElement.tagName === 'INPUT' ||
                        activeElement.tagName === 'TEXTAREA' ||
                        activeElement.contentEditable === 'true' ||
                        activeElement.tagName === 'SL-INPUT' ||
                        activeElement.tagName === 'SL-TEXTAREA' ||
                        activeElement.tagName === 'MAPBOX-SEARCH-BOX' ||

                        // Check if element is inside any input container
                        activeElement.closest('mapbox-search-box') ||
                        activeElement.closest('input') ||
                        activeElement.closest('textarea') ||
                        activeElement.closest('[contenteditable="true"]') ||
                        activeElement.closest('sl-input') ||
                        activeElement.closest('sl-textarea') ||
                        activeElement.closest('sl-select') ||
                        activeElement.closest('sl-combobox') ||

                        // Check if element is inside a shadow DOM input
                        activeElement.closest('*').shadowRoot?.querySelector('input:focus') ||
                        activeElement.closest('*').shadowRoot?.querySelector('textarea:focus') ||

                        // Check for common input-related classes and attributes
                        activeElement.classList.contains('search-input') ||
                        activeElement.classList.contains('geocoder-input') ||
                        activeElement.hasAttribute('data-input') ||
                        activeElement.hasAttribute('role') && activeElement.getAttribute('role') === 'combobox' ||

                        // Check if the element or its parent has input-related properties
                        activeElement.type === 'text' ||
                        activeElement.type === 'search' ||
                        activeElement.type === 'email' ||
                        activeElement.type === 'password' ||
                        activeElement.type === 'number' ||
                        activeElement.type === 'tel' ||
                        activeElement.type === 'url'
                    );

                    // If we're in any input field, don't trigger the shortcut
                    if (isInputField) {
                        return; // Don't prevent default, let the input handle the key
                    }

                    // Additional check for Mapbox search box shadow DOM
                    const mapboxSearchBox = document.querySelector('mapbox-search-box');
                    if (mapboxSearchBox && mapboxSearchBox.shadowRoot) {
                        const shadowInput = mapboxSearchBox.shadowRoot.querySelector('input:focus');
                        if (shadowInput) {
                            return; // Don't prevent default, let the input handle the key
                        }
                    }

                    // Prevent default behavior (e.g., quick search in browsers)
                    event.preventDefault();

                    // Special case: if focused on the layer search input, blur it and toggle
                    if (activeElement && activeElement.id === 'layer-search-input') {
                        // Blur the search input and toggle the drawer
                        activeElement.blur();
                    }
                }
            });

            // Emit mapReady event for plugins
            const mapReadyEvent = new CustomEvent('mapReady', {
                detail: { map: map }
            });
            window.dispatchEvent(mapReadyEvent);

            // Hide loading overlay after initialization is complete
            requestAnimationFrame(() => {
                const loadingOverlay = document.getElementById('loading-overlay');
                if (loadingOverlay) {
                    loadingOverlay.style.opacity = '0';
                    loadingOverlay.style.transition = 'opacity 0.3s ease';
                    setTimeout(() => {
                        loadingOverlay.style.display = 'none';
                    }, 300);
                }
            });
        });
    }

    // Initialize search box with enhanced functionality
    static initializeSearch() {
        // Note: We now need to use the global map variable
        const searchSetup = () => {
            // Initialize the feature state manager
            const featureStateManager = new MapFeatureStateManager(window.map);

            // Start watching for layer additions
            featureStateManager.watchLayerAdditions();

            // Initialize the enhanced search control
            const searchControl = new MapSearchControl(window.map);

            // Connect the feature state manager to the search control
            searchControl.setFeatureStateManager(featureStateManager);

            // Make both globally accessible for debugging
            window.featureStateManager = featureStateManager;
            window.searchControl = searchControl;

        };

        // Wait for style to load before setting up search
        if (window.map) {
            window.map.on('style.load', searchSetup);
        } else {
            // If map isn't available yet, set up a listener to check when it becomes available
            const checkMapInterval = setInterval(() => {
                if (window.map) {
                    clearInterval(checkMapInterval);
                    window.map.on('style.load', searchSetup);
                }
            }, 100);
        }
    }
}
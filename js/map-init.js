import { URLManager } from './url-manager.js';
import { TimeControl } from './time-control.js';
import { ButtonShareLink } from './button-share-link.js';
import { MapLayerControl } from './map-layer-controls.js';
import { StatePersistence } from './state-persistence.js';
import { MapSearchControl } from './map-search-control.js';
import { MapExportControl } from './map-export-control.js';
import { Terrain3DControl } from './terrain-3d-control.js';
import { MapFeatureControl } from './map-feature-control.js';
import { ButtonResetMapView } from './button-reset-map-view.js';
import { MapAttributionControl } from './map-attribution-control.js';
import { ButtonExternalMapLinks } from './button-external-map-links.js';
import { MapFeatureStateManager } from './map-feature-state-manager.js';
import { ButtonGeolocationManager } from './button-geolocation-manager.js';

// Function to get URL parameters
function getUrlParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// Function to parse layers from URL parameter
function parseLayersFromUrl(layersParam) {
    if (!layersParam) return [];

    const layers = [];
    let currentItem = '';
    let braceCount = 0;
    let inQuotes = false;
    let quoteChar = null; // Track which quote character we're inside
    let escapeNext = false;

    // Parse the comma-separated string, being careful about JSON objects
    for (let i = 0; i < layersParam.length; i++) {
        const char = layersParam[i];

        // Handle escape sequences
        if (escapeNext) {
            currentItem += char;
            escapeNext = false;
            continue;
        }

        if (char === '\\') {
            currentItem += char;
            escapeNext = true;
            continue;
        }

        // Handle quote toggling - only toggle if we encounter the matching quote type
        if (char === '"' || char === "'") {
            if (!inQuotes) {
                // Starting a quoted string
                inQuotes = true;
                quoteChar = char;
            } else if (char === quoteChar) {
                // Ending a quoted string (matching quote type)
                inQuotes = false;
                quoteChar = null;
            }
            // If we're in quotes but encounter a different quote type, just add it
            currentItem += char;
            continue;
        }

        // Track brace depth only when outside quotes
        if (!inQuotes) {
            if (char === '{') {
                braceCount++;
            } else if (char === '}') {
                braceCount--;
            }
        }

        // Check for comma separator (only outside braces and quotes)
        if (char === ',' && braceCount === 0 && !inQuotes) {
            // Found a separator, process current item
            const trimmedItem = currentItem.trim();
            if (trimmedItem) {
                if (trimmedItem.startsWith('{') && trimmedItem.endsWith('}')) {
                    try {
                        // Convert single-quoted JSON to double-quoted JSON
                        // First unescape escaped single quotes, then replace single quotes with double quotes
                        const jsonString = trimmedItem.replace(/\\'/g, '\u0001').replace(/'/g, '"').replace(/\u0001/g, "'");
                        const parsedLayer = JSON.parse(jsonString);
                        // Minify the JSON by removing extra whitespace and use single quotes
                        const minifiedItem = JSON.stringify(parsedLayer).replace(/'/g, "\\'").replace(/"/g, "'");
                        layers.push({ ...parsedLayer, _originalJson: minifiedItem });
                    } catch (error) {
                        console.warn('Failed to parse layer JSON:', trimmedItem, error);
                        // Treat as layer ID if JSON parsing fails
                        layers.push({ id: trimmedItem });
                    }
                } else {
                    // Simple layer ID
                    layers.push({ id: trimmedItem });
                }
            }
            currentItem = '';
        } else {
            currentItem += char;
        }
    }

    // Process the last item
    const trimmedItem = currentItem.trim();
    if (trimmedItem) {
        if (trimmedItem.startsWith('{') && trimmedItem.endsWith('}')) {
            try {
                // Convert single-quoted JSON to double-quoted JSON
                // First unescape escaped single quotes, then replace single quotes with double quotes
                const jsonString = trimmedItem.replace(/\\'/g, '\u0001').replace(/'/g, '"').replace(/\u0001/g, "'");
                const parsedLayer = JSON.parse(jsonString);
                // Minify the JSON by removing extra whitespace and use single quotes
                const minifiedItem = JSON.stringify(parsedLayer).replace(/'/g, "\\'").replace(/"/g, "'");
                layers.push({ ...parsedLayer, _originalJson: minifiedItem });
            } catch (error) {
                console.warn('Failed to parse layer JSON:', trimmedItem, error);
                // Treat as layer ID if JSON parsing fails
                layers.push({ id: trimmedItem });
            }
        } else {
            // Simple layer ID
            layers.push({ id: trimmedItem });
        }
    }

    return layers;
}

// Function to check if URL needs prettification (has URL-encoded parameters)
function needsURLPrettification() {
    const currentURL = window.location.href;
    return currentURL.includes('%2C') || currentURL.includes('%7B') || currentURL.includes('%7D') || currentURL.includes('%22');
}

// Helper function to get available config files
async function getAvailableConfigs() {
    // Return a list of known config files based on the file structure
    // This could be made dynamic by fetching a directory listing in the future
    return ['index', 'maharashtra', 'community', 'historic', 'bombay', 'mumbai', 'madras', 'gurugram'].join(', ');
}

// Helper function to try loading a layer from a different config file
async function tryLoadCrossConfigLayer(layerId, layerConfig) {

    // Parse the layer ID to extract potential config prefix
    const dashIndex = layerId.indexOf('-');
    if (dashIndex === -1) return null;

    const configPrefix = layerId.substring(0, dashIndex);
    const originalLayerId = layerId.substring(dashIndex + 1);


    // Try to load the config file
    try {
        const configPath = `config/${configPrefix}.atlas.json`;
        const configResponse = await fetch(configPath);

        if (!configResponse.ok) {
            return null;
        }

        const crossConfig = await configResponse.json();

        // Look for the layer in the cross-config
        if (crossConfig.layers && Array.isArray(crossConfig.layers)) {
            const foundLayer = crossConfig.layers.find(layer => layer.id === originalLayerId);

            if (foundLayer) {

                // Create a merged layer with the prefixed ID and source config info
                return {
                    ...foundLayer,
                    id: layerId, // Keep the prefixed ID
                    title: `${foundLayer.title} (${configPrefix})`, // Add config source to title
                    _sourceConfig: configPrefix,
                    _originalId: originalLayerId,
                    // Preserve important URL-specific properties
                    ...(layerConfig._originalJson && { _originalJson: layerConfig._originalJson }),
                    ...(layerConfig.initiallyChecked !== undefined && { initiallyChecked: layerConfig.initiallyChecked }),
                    ...(layerConfig.opacity !== undefined && { opacity: layerConfig.opacity })
                };
            }
        }

        // Also check if we need to load the cross-config's library
        try {
            const libraryResponse = await fetch('config/_map-layer-presets.json');
            const layerLibrary = await libraryResponse.json();

            // Look for the original layer ID in the main library
            const libraryLayer = layerLibrary.layers.find(lib => lib.id === originalLayerId);

            if (libraryLayer) {

                return {
                    ...libraryLayer,
                    id: layerId, // Keep the prefixed ID
                    title: `${libraryLayer.title} (${configPrefix})`, // Add config source to title
                    _sourceConfig: configPrefix,
                    _originalId: originalLayerId,
                    // Preserve important URL-specific properties
                    ...(layerConfig._originalJson && { _originalJson: layerConfig._originalJson }),
                    ...(layerConfig.initiallyChecked !== undefined && { initiallyChecked: layerConfig.initiallyChecked }),
                    ...(layerConfig.opacity !== undefined && { opacity: layerConfig.opacity })
                };
            }
        } catch (libraryError) {
        }

        return null;

    } catch (error) {
        return null;
    }
}

// Function to load configuration
async function loadConfiguration() {
    // Initialize the layer registry first
    await layerRegistry.initialize();

    // Check if a specific config is requested via URL parameter
    var configParam = getUrlParameter('atlas');
    var layersParam = getUrlParameter('layers');

    let configPath = window.amche.DEFAULT_ATLAS;
    let config;
    let atlasId = 'index'; // Track which atlas we're using

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
            atlasId = 'custom'; // Mark as custom atlas
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

    // Parse layers from URL parameter if provided
    if (layersParam) {
        const urlLayers = parseLayersFromUrl(layersParam);

        // Set URL layers to be visible by default and maintain order
        if (urlLayers.length > 0) {
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
            const shouldPrettifyURL = minifiedLayersParam !== layersParam || needsURLPrettification();

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

            // Merge URL layers while preserving the original config order and respecting URL ordering
            const urlLayersMap = new Map(processedUrlLayers.map(l => [l.id, l]));

            // Build final layers array
            const finalLayers = [...existingLayers];

            // Process URL layers in the order they appear in the URL
            let lastInsertedIndex = -1;

            processedUrlLayers.forEach((urlLayer, urlIndex) => {
                const existingIndex = finalLayers.findIndex(layer => layer.id === urlLayer.id);

                if (existingIndex !== -1) {
                    // Merge existing layer with URL layer properties (preserving all config properties while adding URL-specific ones)
                    finalLayers[existingIndex] = {
                        ...finalLayers[existingIndex],
                        ...urlLayer,
                        // Ensure critical URL properties are preserved
                        ...(urlLayer._originalJson && { _originalJson: urlLayer._originalJson }),
                        ...(urlLayer.initiallyChecked !== undefined && { initiallyChecked: urlLayer.initiallyChecked }),
                        ...(urlLayer.opacity !== undefined && { opacity: urlLayer.opacity })
                    };
                    lastInsertedIndex = existingIndex;
                } else {
                    // This is a new layer - insert it in the right position based on URL order
                    let insertPosition;

                    if (lastInsertedIndex !== -1) {
                        // Insert after the last processed URL layer
                        insertPosition = lastInsertedIndex + 1;
                    } else {
                        // First new layer - find where to insert based on previous URL layers
                        let insertAfterIndex = -1;

                        // Look for the previous URL layer in the URL list
                        for (let i = urlIndex - 1; i >= 0; i--) {
                            const prevUrlLayer = processedUrlLayers[i];
                            const prevLayerIndex = finalLayers.findIndex(layer => layer.id === prevUrlLayer.id);
                            if (prevLayerIndex !== -1) {
                                insertAfterIndex = prevLayerIndex;
                                break;
                            }
                        }

                        insertPosition = insertAfterIndex !== -1 ? insertAfterIndex + 1 : 0;
                    }

                    // Insert the new layer
                    finalLayers.splice(insertPosition, 0, urlLayer);
                    lastInsertedIndex = insertPosition;
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
            deepMerge(configDefaults, config.defaults) :
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

                if (resolvedLayer) {
                    // Debug: Check if resolvedLayer has type
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
                // If it's a fully defined layer, return as is
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
    if (needsURLPrettification()) {
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

// Helper function to deep merge objects
function deepMerge(target, source) {
    const output = Object.assign({}, target);

    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target)) {
                    Object.assign(output, { [key]: source[key] });
                } else {
                    output[key] = deepMerge(target[key], source[key]);
                }
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }

    return output;
}

function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

// Default map options
/**
 * Initialize slot layers for proper layer ordering
 * Slots provide well-defined insertion points in the style's layer stack
 * Reference: https://docs.mapbox.com/style-spec/reference/slots/
 * @param {mapboxgl.Map} map - The Mapbox map instance
 */
function _initializeSlotLayers(map) {
    try {
        const style = map.getStyle();
        if (!style || !style.layers) {
            console.warn('[MapInit] Cannot initialize slots: style or layers not available');
            return;
        }

        // Find the water layer to insert slots after it
        const waterLayerIndex = style.layers.findIndex(layer => layer.id === 'water');

        if (waterLayerIndex === -1) {
            console.warn('[MapInit] Water layer not found, inserting slots at the beginning');
        }

        // Determine the layer to insert before (the layer after water)
        const beforeLayerId = waterLayerIndex >= 0 && waterLayerIndex < style.layers.length - 1
            ? style.layers[waterLayerIndex + 1].id
            : null;

        // Add three slot layers: bottom (for rasters), middle (for vectors), top (for overlays)
        // Reference: https://docs.mapbox.com/style-spec/reference/layers/#layer-properties
        const slots = ['bottom', 'middle', 'top'];

        slots.forEach(slotName => {
            // Check if slot already exists
            if (!map.getLayer(slotName)) {
                try {
                    map.addLayer({
                        id: slotName,
                        type: 'slot'
                    }, beforeLayerId);
                } catch (error) {
                    console.error(`[MapInit] Failed to add slot layer ${slotName}:`, error);
                }
            }
        });
    } catch (error) {
        console.error('[MapInit] Error initializing slot layers:', error);
    }
}

// Initialize the map with the configuration
export async function initializeMap() {
    const config = await loadConfiguration();
    const layers = config.layers || [];

    // Apply map settings from config if available
    const mapOptions = {
        container: 'map',
        style: 'mapbox://styles/planemad/cm3gyibd3004x01qz08rohcsg',
        center: [73.9414, 15.4121],
        zoom: 9.99,
        hash: true,
        attributionControl: false,
        preserveDrawingBuffer: true
    };
    if (config.map) {
        // Apply all properties from config.map to mapOptions
        Object.assign(mapOptions, config.map);
    }

    const map = new mapboxgl.Map(mapOptions);

    // Make map accessible globally for debugging
    window.map = map;

    // Setup proper cursor handling for map dragging
    map.on('load', () => {
        // Initialize slot layers for proper layer ordering
        // Reference: https://docs.mapbox.com/style-spec/reference/slots/
        _initializeSlotLayers(map);

        // Add debugging method to global scope

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
        // Initialize layer control
        const layerControl = new MapLayerControl(layers);
        const container = document.getElementById('layer-controls-container');

        // Hide loader and show controls
        document.getElementById('map-layer-filter').classList.remove('hidden');
        container.classList.remove('hidden');

        // Initialize layer control with state manager
        layerControl.renderToContainer(container, map);
        layerControl.setStateManager(stateManager);

        // Make layer control globally accessible
        window.layerControl = layerControl;

        // Make components globally accessible
        window.stateManager = stateManager;

        // Add custom attribution control that handles formatting and removes duplicates
        window.attributionControl = new MapAttributionControl();
        // Add 3D terrain control (will be initialized after URL manager is ready)
        window.terrain3DControl = new Terrain3DControl();
        // Initialize the feature control with state manager and config
        window.featureControl = new MapFeatureControl();

        map.addControl(window.featureControl, 'top-left');
        map.addControl(new TimeControl(), 'top-right');
        map.addControl(window.terrain3DControl, 'top-right');
        map.addControl(new ButtonResetMapView(), 'top-right');
        map.addControl(new ButtonGeolocationManager(), 'top-right');
        map.addControl(window.attributionControl, 'bottom-right');
        map.addControl(new MapExportControl(), 'bottom-right');
        map.addControl(new ButtonExternalMapLinks(), 'bottom-right');
        map.addControl(new mapboxgl.NavigationControl({showCompass: true, showZoom: true}));
        map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');
        map.addControl(new ButtonShareLink({
            url: () => window.location.href,
            showToast: true,
            qrCodeSize: 500
        }), 'bottom-right');

        // Show feature control panel by default on initial load
        const config = loadConfiguration();
        window.featureControl.initialize(stateManager, config);
        window.featureControl._showPanel();

        // Initialize 3D control from URL parameters after URL manager is ready
        window.terrain3DControl.initializeFromURL();

        // Initialize state persistence and try to restore saved state
        const statePersistence = new StatePersistence();
        const stateRestored = statePersistence.restoreStateOnLoad();

        // Initialize URL manager after layer control is ready
        const urlManager = new URLManager(layerControl, map);
        urlManager.setupLayerControlEventListeners();

        // Make URL manager globally accessible
        window.urlManager = urlManager;

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

                const drawerStateManager = new DrawerStateManager();
                // Special case: if focused on the layer search input, blur it and toggle
                if (activeElement && activeElement.id === 'layer-search-input') {
                    // Blur the search input and toggle the drawer
                    activeElement.blur();
                }
                drawerStateManager.toggle();
            }
        });

        // Emit mapReady event for plugins
        const mapReadyEvent = new CustomEvent('mapReady', {
            detail: { map: map }
        });
        window.dispatchEvent(mapReadyEvent);
    });
}

// Initialize search box with enhanced functionality
export function initializeSearch() {
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
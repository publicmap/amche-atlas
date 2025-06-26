import { MapLayerControl } from './map-layer-controls.js';
import { MapFeatureControl } from './map-feature-control.js';
import { MapFeatureStateManager } from './map-feature-state-manager.js';
import { configControl } from './config-control.js';
import { localization } from './localization.js';
import { URLManager } from './url-api.js';
import { permalinkHandler } from './permalink-handler.js';

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
    let escapeNext = false;
    
    // Parse the comma-separated string, being careful about JSON objects
    for (let i = 0; i < layersParam.length; i++) {
        const char = layersParam[i];
        
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
        
        if (char === '"' && !escapeNext) {
            inQuotes = !inQuotes;
        }
        
        if (!inQuotes) {
            if (char === '{') {
                braceCount++;
            } else if (char === '}') {
                braceCount--;
            }
        }
        
        if (char === ',' && braceCount === 0 && !inQuotes) {
            // Found a separator, process current item
            const trimmedItem = currentItem.trim();
            if (trimmedItem) {
                if (trimmedItem.startsWith('{') && trimmedItem.endsWith('}')) {
                    try {
                        const parsedLayer = JSON.parse(trimmedItem);
                        // Minify the JSON by removing extra whitespace
                        const minifiedItem = JSON.stringify(parsedLayer);
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
                const parsedLayer = JSON.parse(trimmedItem);
                // Minify the JSON by removing extra whitespace
                const minifiedItem = JSON.stringify(parsedLayer);
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

// Function to load configuration
async function loadConfiguration() {
    // Check for permalink first - this takes precedence over direct URL parameters
    const permalinkParams = await permalinkHandler.checkForPermalink();
    
    if (permalinkParams) {
        // Apply the resolved permalink URL and let the normal parameter parsing handle it
        permalinkHandler.applyPermalinkToURL(permalinkParams);
        
        // Use the resolved parameters directly
        var configParam = permalinkParams.atlas;
        var layersParam = permalinkParams.layers;
    } else {
        // Check if a specific config is requested via URL parameter
        var configParam = getUrlParameter('atlas');
        var layersParam = getUrlParameter('layers');
    }
    
    let configPath = 'config/index.atlas.json';
    let config;
    
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
        } else {
            configPath = `config/${configParam}.atlas.json`; // Treat as local file
        }
    }
    
    // Load the configuration file (only if we didn't parse JSON directly)
    if (!config) {
        const configResponse = await fetch(configPath);
        config = await configResponse.json();
    }
    
            // Parse layers from URL parameter if provided
        if (layersParam) {
            console.log('Parsing layers from URL parameter:', layersParam);
            const urlLayers = parseLayersFromUrl(layersParam);
            console.log('Parsed URL layers:', urlLayers);
            
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
                
                console.log('[MapInit] Set initial layer states based on URL parameters:', 
                    existingLayers.map(l => ({ id: l.id, initiallyChecked: l.initiallyChecked })));
            
            // Create minified layers parameter for URL rewriting
            const minifiedLayersParam = processedUrlLayers.map(layer => {
                return layer._originalJson || layer.id;
            }).join(',');
            
            // Rewrite URL with minified layers parameter if it's different
            if (minifiedLayersParam !== layersParam) {
                const url = new URL(window.location);
                const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
                const otherParams = new URLSearchParams(url.search);
                otherParams.delete('layers'); // Remove existing layers param
                
                // Build the new URL manually to avoid URL encoding the JSON
                let newUrl = baseUrl;
                if (otherParams.toString()) {
                    newUrl += '?' + otherParams.toString() + '&layers=' + minifiedLayersParam;
                } else {
                    newUrl += '?layers=' + minifiedLayersParam;
                }
                
                // Add hash if it exists
                if (url.hash) {
                    newUrl += url.hash;
                }
                
                console.log('Rewriting URL from:', window.location.href);
                console.log('Rewriting URL to:', newUrl);
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
                        ...(urlLayer.initiallyChecked !== undefined && { initiallyChecked: urlLayer.initiallyChecked })
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
            
            console.log('Final merged layers with URL order preserved:', config.layers);
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

    // Try to load the map layer library
    try {
        const libraryResponse = await fetch('config/_map-layer-presets.json');
        const layerLibrary = await libraryResponse.json();
        
        // Process each layer in the config and merge with library definitions
        if (config.layers && Array.isArray(config.layers)) {
            const validLayers = [];
            const invalidLayers = [];
            
            config.layers.forEach(layerConfig => {
                // If the layer only has an id (or minimal properties), look it up in the library
                if (layerConfig.id && !layerConfig.type) {
                    // Find the matching layer in the library
                    const libraryLayer = layerLibrary.layers.find(lib => lib.id === layerConfig.id);
                    
                    if (libraryLayer) {
                        // Merge the library layer with any custom overrides from config
                        // Preserve important URL-specific properties like _originalJson and initiallyChecked
                        validLayers.push({ 
                            ...libraryLayer, 
                            ...layerConfig,
                            // Ensure these critical properties are preserved
                            ...(layerConfig._originalJson && { _originalJson: layerConfig._originalJson }),
                            ...(layerConfig.initiallyChecked !== undefined && { initiallyChecked: layerConfig.initiallyChecked })
                        });
                    } else {
                        // Layer not found in library - check if it came from URL
                        if (layerConfig.initiallyChecked === true) {
                            console.warn(`Unknown layer ID from URL: "${layerConfig.id}" - ignoring`);
                            invalidLayers.push(layerConfig.id);
                        } else {
                            // For non-URL layers, keep them as-is (they might be fully defined custom layers)
                            validLayers.push(layerConfig);
                        }
                    }
                } else {
                    // If it's a fully defined layer, return as is
                    validLayers.push(layerConfig);
                }
            });
            
            config.layers = validLayers;
            
            // If we found invalid layers from URL, update the URL to remove them
            if (invalidLayers.length > 0 && layersParam) {
                console.log(`Removing invalid layer IDs from URL: ${invalidLayers.join(', ')}`);
                
                // Get the remaining valid layers that were originally from URL
                const validUrlLayers = validLayers.filter(layer => layer.initiallyChecked === true);
                
                // Reconstruct the layers parameter with only valid layers
                const newLayersParam = validUrlLayers.map(layer => {
                    return layer._originalJson || layer.id;
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
                
                console.log('Updated URL to remove invalid layers:', newUrl);
                window.history.replaceState({}, '', newUrl);
            }
        }
    } catch (error) {
        console.warn('Map layer library not found or invalid, using only config file:', error);
    }
    
    // Load and apply localized UI strings
    localization.loadStrings(config);
    
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

// Initialize the map
mapboxgl.accessToken = 'pk.eyJ1Ijoib3NtaW5kaWEiLCJhIjoiY202czRpbWdpMDNyZjJwczJqZXdkMGR1eSJ9.eQQf--msfqtZIamJN-KKVQ';

// Default map options
const defaultMapOptions = {
    container: 'map',
    style: 'mapbox://styles/planemad/cm3gyibd3004x01qz08rohcsg',
    center: [73.9414, 15.4121],
    zoom: 9.99,
    hash: true,
    attributionControl: false
};

// Initialize the map with the configuration
async function initializeMap() {
    const config = await loadConfiguration();
    const layers = config.layers || [];
    
    // Apply map settings from config if available
    const mapOptions = { ...defaultMapOptions };
    if (config.map) {
        // Apply all properties from config.map to mapOptions
        Object.assign(mapOptions, config.map);
    }
    
    const map = new mapboxgl.Map(mapOptions);

    // Make map accessible globally for debugging
    window.map = map;

    // Add attribution control
    map.addControl(new mapboxgl.AttributionControl({
        compact: true
    }), 'bottom-right');

    // Add 3D terrain on map load
    map.on('load', () => {
        // Only add terrain if not already in style
        const style = map.getStyle();
        const hasTerrain = style.sources && style.sources['mapbox-dem'];
        
        if (!hasTerrain) {
            map.addSource('mapbox-dem', {
                'type': 'raster-dem',
                'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                'tileSize': 512,
                'maxzoom': 14
            });
            
            map.setTerrain({
                'source': 'mapbox-dem',
                'exaggeration': 1.5
            });
        }
        
        // Initialize geolocation
        new GeolocationManager(map);
        
        // Add view control
        map.addControl(new ViewControl(), 'top-right');
        
        // Initialize centralized state manager (NEW ARCHITECTURE)
        const stateManager = new MapFeatureStateManager(map);
        console.log('[MapInit] Initialized centralized feature state manager');
        
        // Initialize layer control
        const layerControl = new MapLayerControl(layers);
        const container = document.getElementById('layer-controls-container');
        
        // Hide loader and show controls
        document.getElementById('layer-controls-loader').classList.add('hidden');
        document.getElementById('map-layer-filter').classList.remove('hidden');
        container.classList.remove('hidden');
        
        // Initialize layer control with state manager
        layerControl.renderToContainer(container, map);
        layerControl.setStateManager(stateManager);
        
        // Make layer control globally accessible
        window.layerControl = layerControl;
        
        // Initialize the feature control with state manager and config
        const featureControl = new MapFeatureControl({
            position: 'bottom-right',
            maxHeight: '500px',
            maxWidth: '350px'
        });
        featureControl.addTo(map);
        featureControl.initialize(stateManager, config);
        
        // Make components globally accessible
        window.featureControl = featureControl;
        window.stateManager = stateManager;
        
        console.log('[MapInit] Initialized event-driven architecture');
        
        // Initialize URL manager after layer control is ready
        const urlManager = new URLManager(layerControl, map);
        urlManager.setupLayerControlEventListeners();
        
        // Make URL manager globally accessible for ShareLink
        window.urlManager = urlManager;
        
        // Force update localization after DOM elements are ready
        setTimeout(() => {
            localization.forceUpdateUIElements();
        }, 100);
        
        // Initialize config control after layer control is ready
        configControl.initialize(layerControl);
        
        // Add navigation controls
        map.addControl(new mapboxgl.NavigationControl({
            showCompass: true,
            showZoom: true
        }));
        
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
        
        // Emit mapReady event for plugins
        const mapReadyEvent = new CustomEvent('mapReady', {
            detail: { map: map }
        });
        window.dispatchEvent(mapReadyEvent);
    });
}

// Start initialization
window.addEventListener('load', () => {
    // Only call initializeMap() - don't call initializeSearch() directly
    initializeMap().then(() => {
        // Now window.map exists, so we can initialize search
        initializeSearch();
    });
});

// Initialize search box with enhanced functionality
function initializeSearch() {
    // Note: We now need to use the global map variable
    const searchSetup = () => {
        // Check if MapSearchControl is available
        if (typeof MapSearchControl === 'undefined') {
            console.error('MapSearchControl class not found. Make sure map-search-control.js is loaded.');
            return;
        }
        
        // Check if MapFeatureStateManager is available
        if (typeof MapFeatureStateManager === 'undefined') {
            console.error('MapFeatureStateManager class not found. Make sure map-feature-state-manager.js is loaded.');
            return;
        }
        
        // Initialize the feature state manager
        const featureStateManager = new MapFeatureStateManager(window.map);
        
        // Enable debug logging for development
        featureStateManager.setDebug(true);
        
        // Register the cadastral layer for selection
        featureStateManager.registerSelectableLayers([
            {
                id: 'cadastral-fill', // Adjust this to match your actual layer ID
                source: 'vector-plot',
                sourceLayer: 'Onemapgoa_GA_Cadastrals',
                idProperty: 'id'
            }
        ]);
        
        // Register the cadastral layer for hover effects too
        featureStateManager.registerHoverableLayers([
            {
                id: 'cadastral-fill', // Adjust this to match your actual layer ID
                source: 'vector-plot',
                sourceLayer: 'Onemapgoa_GA_Cadastrals',
                idProperty: 'id'
            }
        ]);
        
        // Start watching for layer additions
        featureStateManager.watchLayerAdditions();
        
        // Initialize the enhanced search control
        const searchControl = new MapSearchControl(window.map, {
            // You can add custom options here if needed
            proximity: '73.87916,15.26032', // Goa center
            country: 'IN',
            language: 'en'
        });
        
        // Connect the feature state manager to the search control
        searchControl.setFeatureStateManager(featureStateManager);
        
        // Make both globally accessible for debugging
        window.searchControl = searchControl;
        window.featureStateManager = featureStateManager;
        
        console.log('Enhanced search control initialized with cadastral layer support');
        console.log('Feature state manager initialized and connected to search control');
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
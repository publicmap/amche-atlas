import { fetchTileJSON } from './map-utils.js';

// Get all layers from the current atlas configuration
function getCurrentAtlasLayers() {
    if (!window.layerControl || !window.layerControl._state || !window.layerControl._state.groups) {
        return [];
    }
    
    const layers = [];
    window.layerControl._state.groups.forEach(group => {
        if (group.title && group.id) {
            layers.push({
                id: group.id,
                title: group.title,
                format: getLayerFormat(group),
                config: group
            });
        }
    });
    
    return layers;
}

// Determine the data format from layer configuration
function getLayerFormat(layer) {
    if (!layer.type && !layer.url) return 'unknown';
    
    // Check by layer type first
    switch (layer.type) {
        case 'vector':
            return 'pbf/mvt';
        case 'geojson':
            return 'geojson';
        case 'tms':
        case 'raster':
            return 'raster';
        case 'csv':
            return 'csv';
        case 'style':
            return 'style';
        case 'layer-group':
            return 'group';
        case 'terrain':
            return 'terrain';
        case 'atlas':
            return 'atlas';
        case 'img':
            return 'img';
        case 'raster-style-layer':
            return 'raster';
        case 'markers':
            return 'markers';
    }
    
    // If no type, try to guess from URL
    if (layer.url) {
        const url = layer.url.toLowerCase();
        if (url.includes('.geojson') || url.includes('geojson')) return 'geojson';
        if (url.includes('.pbf') || url.includes('.mvt') || url.includes('vector')) return 'pbf/mvt';
        if (url.includes('.png')) return 'png';
        if (url.includes('.jpg') || url.includes('.jpeg')) return 'jpg';
        if (url.includes('.tiff') || url.includes('.tif')) return 'tiff';
        if (url.includes('.csv')) return 'csv';
        if (url.includes('{z}') && (url.includes('.png') || url.includes('.jpg'))) return 'raster';
        if (url.includes('mapbox://')) return 'mapbox';
    }
    
    return 'unknown';
}

// Create and inject the dialog HTML only once
function createLayerCreatorDialog() {
    if (document.getElementById('layer-creator-dialog')) return;
    const dialogHtml = `
    <sl-dialog id="layer-creator-dialog" label="Add new data source or atlas">
        <form id="layer-creator-form" class="flex flex-col gap-4">
            <sl-select id="layer-preset-dropdown" placeholder="Select from current atlas layers">
                <sl-icon slot="prefix" name="layers"></sl-icon>
            </sl-select>
            <div class="text-xs text-gray-500">
                Or add a new data source:
            </div>
            <sl-input id="layer-url" placeholder="URL to map data or atlas configuration JSON">
                <sl-icon slot="prefix" name="link"></sl-icon>
            </sl-input>
            <div id="layer-url-help" class="text-xs text-gray-500">
                Supported: Raster/Vector tile URLs, GeoJSON, Atlas JSON.<br>
                Examples:<br>
                <span class="block">Raster: <code>https://warper.wmflabs.org/maps/tile/4749/{z}/{x}/{y}.png</code></span>
                <span class="block">Vector: <code>https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt</code></span>
                <span class="block">GeoJSON: <code>https://gist.githubusercontent.com/planemad/e5ccc47bf2a1aa458a86d6839476f539/raw/6922fcc2d5ffd4d58b0fb069b9f57334f13cd953/goa-water-bodies.geojson</code></span>
                <span class="block">Atlas: <code>https://jsonkeeper.com/b/RQ0Y</code></span>
            </div>
            <sl-textarea id="layer-config-json" rows="10" resize="vertical" class="font-mono text-xs" placeholder="Atlas Layer JSON"></sl-textarea>
            <div class="flex justify-end gap-2">
                <sl-button type="button" variant="default" id="cancel-layer-creator">Cancel</sl-button>
                <sl-button type="submit" variant="primary" id="submit-layer-creator">Add to map</sl-button>
            </div>
        </form>
    </sl-dialog>
    `;
    $(document.body).append(dialogHtml);
}

function guessLayerType(url) {
    if (/\.geojson($|\?)/i.test(url)) return 'geojson';
    if (url.includes('{z}') && (url.includes('.pbf') || url.includes('.mvt') || url.includes('vector.openstreetmap.org') || url.includes('/vector/'))) return 'vector';
    if (url.includes('{z}') && (url.includes('.png') || url.includes('.jpg'))) return 'raster';
    if (/\.json($|\?)/i.test(url)) return 'atlas';
    return 'unknown';
}

function makeLayerConfig(url, tilejson) {
    const type = guessLayerType(url);
    let config = {};
    if (type === 'vector') {
        // Generate a random color in hex format
        const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        
        // Extract map_id from URL if it's an api-main URL
        let attribution = tilejson?.attribution || '© OpenStreetMap contributors';
        let mapId = null;
        if (url.includes('api-main')) {
            const urlObj = new URL(url);
            mapId = urlObj.searchParams.get('map_id');
            if (mapId) {
                attribution = `© Original Creator - via <a href='https://www.maphub.co/map/${mapId}'>Maphub</a>`;
            }
        }
        
        config = {
            title: tilejson?.name || 'Vector Tile Layer',
            description: tilejson?.description || 'Vector tile layer from custom source',
            type: 'vector',
            id: (tilejson?.name || 'vector-layer').toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 8),
            url: (tilejson?.tiles && tilejson.tiles[0]) || url,
            sourceLayer: tilejson?.vector_layers?.[0]?.id || 'default',
            minzoom: tilejson?.minzoom || 0,
            maxzoom: tilejson?.maxzoom || 14,
            attribution: attribution,
            initiallyChecked: false,
            inspect: {
                id: tilejson?.vector_layers?.[0]?.fields?.gid ? "gid" : (tilejson?.vector_layers?.[0]?.fields?.id ? "id" : "gid"),
                title: tilejson?.vector_layers?.[0]?.fields?.mon_name ? "Monument Name" : "Name",
                label: tilejson?.vector_layers?.[0]?.fields?.mon_name ? "mon_name" : (tilejson?.vector_layers?.[0]?.fields?.name ? "name" : "mon_name"),
                fields: tilejson?.vector_layers?.[0]?.fields ? 
                    Object.keys(tilejson.vector_layers[0].fields).slice(0, 6) : 
                    ["id", "description", "class", "type"],
                fieldTitles: tilejson?.vector_layers?.[0]?.fields ? 
                    Object.keys(tilejson.vector_layers[0].fields).slice(0, 6).map(field => 
                        field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                    ) : 
                    ["ID", "Description", "Class", "Type"]
            }
        };
        // Add headerImage for api-main URLs and override sourceLayer
        if (url.includes('api-main')) {
            config.sourceLayer = 'vector';
            if (mapId) {
                config.headerImage = `https://api-main-432878571563.europe-west4.run.app/maps/${mapId}/thumbnail`;
            }
        }
    } else if (type === 'raster') {
        config = {
            title: 'Raster Layer',
            type: 'tms',
            id: 'raster-' + Math.random().toString(36).slice(2, 8),
            url,
            style: {
                'raster-opacity': [
                    'interpolate', ['linear'], ['zoom'], 6, 0.95, 18, 0.8, 19, 0.3
                ]
            },
            initiallyChecked: false
        };
    } else if (type === 'geojson') {
        config = {
            title: 'GeoJSON Layer',
            type: 'geojson',
            id: 'geojson-' + Math.random().toString(36).slice(2, 8),
            url,
            initiallyChecked: false,
            inspect: {
                id: "id",
                title: "Name",
                label: "name",
                fields: ["id", "description", "class", "type"],
                fieldTitles: ["ID", "Description", "Class", "Type"]
            }
        };
    } else if (type === 'atlas') {
        config = {
            type: 'atlas',
            url,
            inspect: {
                id: "id",
                title: "Name",
                label: "name",
                fields: ["id", "description", "class", "type"],
                fieldTitles: ["ID", "Description", "Class", "Type"]
            }
        };
    } else {
        config = { url };
    }
    return config;
}

async function handleUrlInput(url) {
    let actualUrl = url;
    let tilejson = null;
    
    // Special handling for indianopenmaps.fly.dev view URLs
    if (url.includes('indianopenmaps.fly.dev') && url.includes('/view')) {
        try {
            // Convert view URL to tile URL pattern
            // Example: https://indianopenmaps.fly.dev/not-so-open/cultural/monuments/zones/asi/bhuvan/view#6.81/22.273/74.559
            // Becomes: https://indianopenmaps.fly.dev/not-so-open/cultural/monuments/zones/asi/bhuvan/{z}/{x}/{y}.pbf
            const baseUrl = url.split('/view')[0];
            actualUrl = `${baseUrl}/{z}/{x}/{y}.pbf`;
            
            // Also fetch the TileJSON
            const tilejsonUrl = `${baseUrl}/tiles.json`;
            tilejson = await fetchTileJSON(tilejsonUrl);
        } catch (error) {
            console.warn('Failed to fetch TileJSON from indianopenmaps.fly.dev view URL:', error);
        }
    }
    
    const type = guessLayerType(actualUrl);
    let config = {};
    if (type === 'vector') {
        // Special handling for indianopenmaps.fly.dev tile URLs (if not already handled above)
        if (!tilejson && actualUrl.includes('indianopenmaps.fly.dev') && actualUrl.includes('{z}')) {
            try {
                // Convert tile URL to TileJSON URL by replacing the tile template with tiles.json
                const tilejsonUrl = actualUrl.replace(/\{z\}\/\{x\}\/\{y\}\.pbf$/, 'tiles.json');
                tilejson = await fetchTileJSON(tilejsonUrl);
            } catch (error) {
                console.warn('Failed to fetch TileJSON from indianopenmaps.fly.dev:', error);
            }
        }
        
        // Fallback: try to fetch TileJSON from the original URL
        if (!tilejson) {
            tilejson = await fetchTileJSON(actualUrl);
        }
        
        config = makeLayerConfig(actualUrl, tilejson);
    } else {
        config = makeLayerConfig(actualUrl);
    }
    return config;
}

function getShareableUrl() {
    // Try to get the ShareLink instance from the share button container
    const shareBtn = document.getElementById('share-link');
    if (window.shareLinkInstance && typeof window.shareLinkInstance.getCurrentURL === 'function') {
        return window.shareLinkInstance.getCurrentURL();
    }
    // fallback: try to get from the share button's data-url attribute if set
    if (shareBtn && shareBtn.dataset && shareBtn.dataset.url) {
        return shareBtn.dataset.url;
    }
    // fallback: use window.location.href
    return window.location.href;
}

function openLayerCreatorDialog() {
    createLayerCreatorDialog();
    const dialog = document.getElementById('layer-creator-dialog');
    const presetDropdown = document.getElementById('layer-preset-dropdown');
    const urlInput = document.getElementById('layer-url');
    const configTextarea = document.getElementById('layer-config-json');
    const form = document.getElementById('layer-creator-form');
    const cancelBtn = document.getElementById('cancel-layer-creator');
    
    // Clear inputs
    configTextarea.value = '';
    urlInput.value = '';
    
    // Populate dropdown with current atlas layers
    const currentLayers = getCurrentAtlasLayers();
    presetDropdown.innerHTML = '';
    
    // Add empty option
    const emptyOption = document.createElement('sl-option');
    emptyOption.value = '';
    emptyOption.textContent = 'Select a layer...';
    presetDropdown.appendChild(emptyOption);
    
    // Add layers to dropdown
    currentLayers.forEach(layer => {
        const option = document.createElement('sl-option');
        option.value = layer.id;
        option.dataset.config = JSON.stringify(layer.config);
        
        // Create HTML content with title and format indicator
        option.innerHTML = `
            <div class="flex justify-between items-center w-full">
                <span class="flex-1 truncate">${layer.title}</span>
                <span class="text-xs text-gray-500 ml-2 flex-shrink-0">${layer.format}</span>
            </div>
        `;
        
        presetDropdown.appendChild(option);
    });
    
    dialog.show();
    
    let lastUrl = '';
    let lastConfig = '';
    
    // Remove previous listeners to avoid duplicates
    presetDropdown.onchange = null;
    urlInput.oninput = null;
    form.onsubmit = null;
    
    // Handle preset dropdown selection
    presetDropdown.addEventListener('sl-change', (e) => {
        const selectedOption = presetDropdown.querySelector(`sl-option[value="${e.target.value}"]`);
        if (selectedOption && selectedOption.dataset.config) {
            const config = JSON.parse(selectedOption.dataset.config);
            configTextarea.value = JSON.stringify(config, null, 2);
            // Clear URL input when preset is selected
            urlInput.value = '';
        }
    });
    
    // Handle URL input
    urlInput.addEventListener('input', async (e) => {
        const url = e.target.value.trim();
        if (!url || url === lastUrl) return;
        lastUrl = url;
        
        // Clear preset dropdown when URL is entered
        presetDropdown.value = '';
        
        configTextarea.value = 'Loading...';
        const config = await handleUrlInput(url);
        lastConfig = JSON.stringify(config, null, 2);
        configTextarea.value = lastConfig;
    });
    
    cancelBtn.onclick = () => dialog.hide();
    
    form.onsubmit = (e) => {
        e.preventDefault();
        let configJson = configTextarea.value.trim();
        if (!configJson) return;
        try {
            const configObj = JSON.parse(configJson);
            // Use the current shareable URL as base
            let baseUrl = getShareableUrl();
            let url = new URL(baseUrl);
            // Preserve hash
            const hash = url.hash;
            // Add or prepend to layers param
            let layers = url.searchParams.get('layers') || '';
            // Insert minified JSON at the beginning
            if (layers) {
                layers = JSON.stringify(configObj) + ',' + layers;
            } else {
                layers = JSON.stringify(configObj);
            }
            url.searchParams.set('layers', layers);
            // Re-apply hash
            url.hash = hash;
            // Open the new URL as if it was clicked
            window.location.href = url.toString();
        } catch (err) {
            alert('Invalid JSON in config');
        }
    };
}

// Attach to button
$(document).on('click', '#add-layer-btn', openLayerCreatorDialog); 
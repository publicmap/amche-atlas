/**
 * Layer Creator UI and Configuration Generator.
 */

import { MapUtils } from './map-utils.js';

export class LayerConfigGenerator {
    /**
     * Get all layers from the current atlas configuration
     * @returns {Array} Array of layer objects
     */
    static getCurrentAtlasLayers() {
        if (!window.layerControl || !window.layerControl._state || !window.layerControl._state.groups) {
            return [];
        }

        const layers = [];
        window.layerControl._state.groups.forEach(group => {
            if (group.title && group.id) {
                layers.push({
                    id: group.id,
                    title: group.title,
                    format: this.getLayerFormat(group),
                    config: group
                });
            }
        });

        return layers;
    }

    /**
     * Determine the data format from layer configuration
     * @param {Object} layer - Layer configuration
     * @returns {string} Format name
     */
    static getLayerFormat(layer) {
        if (!layer.type && !layer.url) return 'unknown';

        switch (layer.type) {
            case 'vector': return 'pbf/mvt';
            case 'geojson': return 'geojson';
            case 'tms':
            case 'raster': return 'raster';
            case 'csv': return 'csv';
            case 'style': return 'style';
            case 'layer-group': return 'group';
            case 'terrain': return 'terrain';
            case 'atlas': return 'atlas';
            case 'img': return 'img';
            case 'raster-style-layer': return 'raster';
            case 'markers': return 'markers';
        }

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

    /**
     * Guesses the layer type from URL
     * @param {string} url - Data URL
     * @returns {string} Guessed type
     */
    static guessLayerType(url) {
        if (/\.geojson($|\?)/i.test(url)) return 'geojson';
        if (url.includes('{z}') && (url.includes('.pbf') || url.includes('.mvt') || url.includes('vector.openstreetmap.org') || url.includes('/vector/'))) return 'vector';
        if (url.includes('{z}') && (url.includes('.png') || url.includes('.jpg'))) return 'raster';
        if (/\.json($|\?)/i.test(url)) return 'atlas';
        return 'unknown';
    }

    /**
     * Creates a layer configuration object
     * @param {string} url - Data URL
     * @param {Object} tilejson - TileJSON object
     * @param {Object} metadata - Optional metadata
     * @returns {Object} Layer configuration
     */
    static makeLayerConfig(url, tilejson, metadata = null) {
        const type = this.guessLayerType(url);
        let config = {};
        if (type === 'vector') {
            let attribution = tilejson?.attribution || '© OpenStreetMap contributors';
            let mapId = null;
            if (url.includes('api-main')) {
                const urlObj = new URL(url);
                mapId = urlObj.searchParams.get('map_id');
                if (mapId) {
                    attribution = `© Original Creator - via <a href='https://www.maphub.co/map/${mapId}'>Maphub</a>`;
                }
            }

            if (attribution && typeof attribution === 'string') {
                attribution = attribution.replace(/"/g, "'");
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
            if (url.includes('api-main')) {
                config.sourceLayer = 'vector';
                if (mapId) {
                    config.headerImage = `https://api-main-432878571563.europe-west4.run.app/maps/${mapId}/thumbnail`;
                }
            }
        } else if (type === 'raster') {
            const cleanTitle = (title) => {
                if (!title) return 'Raster Layer';
                let cleaned = title;
                if (cleaned.startsWith('File:')) cleaned = cleaned.substring(5);
                cleaned = cleaned.replace(/\.(jpg|jpeg|png|gif|tiff|tif|pdf)$/i, '');
                return cleaned.trim();
            };

            const formatWikiLink = (url, text) => {
                if (url && url.includes('commons.wikimedia.org/wiki/File:')) {
                    const fileName = url.split('/').pop();
                    const displayText = text || fileName;
                    return `<a href='${url}' target='_blank'>${displayText}</a>`;
                }
                return text || url;
            };

            const formatDescription = (description) => {
                if (!description) return undefined;
                const fromMatch = description.match(/From:\s*(https?:\/\/[^\s]+)/);
                if (fromMatch) {
                    const url = fromMatch[1];
                    if (url.includes('commons.wikimedia.org/wiki/File:')) {
                        const fileName = url.split('/').pop();
                        return `From: ${formatWikiLink(url, fileName)}`;
                    }
                }
                return description;
            };

            const formatAttribution = (metadata) => {
                if (!metadata) return undefined;
                const sourceUrl = metadata.source;
                const originalUrl = metadata.originalUrl;
                let attribution = '';
                if (sourceUrl && sourceUrl.includes('commons.wikimedia.org/wiki/File:')) {
                    const fileName = sourceUrl.split('/').pop();
                    attribution += formatWikiLink(sourceUrl, fileName);
                }
                if (originalUrl) {
                    attribution += attribution ? ' via ' : '';
                    attribution += `<a href='${originalUrl}' target='_blank'>MapWarper</a>`;
                }
                return attribution || undefined;
            };

            config = {
                title: metadata ? cleanTitle(metadata.title) : 'Raster Layer',
                description: metadata ? formatDescription(metadata.description) : undefined,
                source: metadata ? formatWikiLink(metadata.source) : undefined,
                dateDepicted: metadata ? metadata.dateDepicted : undefined,
                type: 'tms',
                id: metadata ? `mapwarper-${metadata.mapId}` : 'raster-' + Math.random().toString(36).slice(2, 8),
                url,
                style: {
                    'raster-opacity': [
                        'interpolate', ['linear'], ['zoom'], 6, 0.95, 18, 0.8, 19, 0.3
                    ]
                },
                attribution: metadata ? formatAttribution(metadata) : undefined,
                headerImage: metadata ? metadata.thumbnail : undefined,
                bbox: metadata && metadata.bbox ? metadata.bbox : undefined,
                initiallyChecked: false
            };

            Object.keys(config).forEach(key => {
                if (config[key] === undefined) delete config[key];
            });
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

    /**
     * Processes a URL input to generate layer configuration
     * @param {string} url - Input URL
     * @returns {Promise<Object>} Layer configuration
     */
    static async handleUrlInput(url) {
        let actualUrl = url;
        let tilejson = null;
        let mapwarperMetadata = null;

        if (url.includes('mapwarper.net/maps/') || url.includes('warper.wmflabs.org/maps/')) {
            try {
                const mapIdMatch = url.match(/\/maps\/(\d+)/);
                if (mapIdMatch) {
                    const mapId = mapIdMatch[1];
                    let baseUrl = url.includes('mapwarper.net') ? 'https://mapwarper.net' : 'https://warper.wmflabs.org';

                    if (baseUrl) {
                        actualUrl = `${baseUrl}/maps/tile/${mapId}/{z}/{x}/{y}.png`;
                        const sanitizedUrl = url.split('#')[0];
                        try {
                            const apiUrl = `${baseUrl}/api/v1/maps/${mapId}`;
                            const response = await fetch(apiUrl);
                            if (response.ok) {
                                const apiResponse = await response.json();
                                const mapData = apiResponse.data?.attributes || {};
                                const links = apiResponse.data?.links || {};
                                mapwarperMetadata = {
                                    title: mapData.title || `MapWarper Map ${mapId}`,
                                    description: mapData.description || '',
                                    source: mapData.source_uri || '',
                                    attribution: mapData.attribution || '',
                                    dateDepicted: mapData.date_depicted || '',
                                    thumbnail: links.thumb ? `${baseUrl}${links.thumb}` : null,
                                    baseUrl: baseUrl,
                                    mapId: mapId,
                                    originalUrl: sanitizedUrl,
                                    bbox: mapData.bbox || null
                                };
                            }
                        } catch (apiError) {
                            console.warn('Failed to fetch MapWarper API data:', apiError);
                        }
                    }
                }
            } catch (error) {
                console.warn('Failed to process MapWarper URL:', error);
            }
        } else if (url.includes('indianopenmaps.fly.dev') && url.includes('/view')) {
            try {
                const baseUrl = url.split('/view')[0];
                actualUrl = `${baseUrl}/{z}/{x}/{y}.pbf`;
                const tilejsonUrl = `${baseUrl}/tiles.json`;
                tilejson = await MapUtils.fetchTileJSON(tilejsonUrl);
            } catch (error) {
                console.warn('Failed to fetch TileJSON from indianopenmaps.fly.dev view URL:', error);
            }
        }

        const type = this.guessLayerType(actualUrl);
        if (type === 'vector') {
            if (!tilejson && actualUrl.includes('indianopenmaps.fly.dev') && actualUrl.includes('{z}')) {
                try {
                    const tilejsonUrl = actualUrl.replace(/\{z\}\/\{x\}\/\{y\}\.pbf$/, 'tiles.json');
                    tilejson = await MapUtils.fetchTileJSON(tilejsonUrl);
                } catch (error) {
                    console.warn('Failed to fetch TileJSON from indianopenmaps.fly.dev:', error);
                }
            }
            if (!tilejson) {
                tilejson = await MapUtils.fetchTileJSON(actualUrl);
            }
        }

        return this.makeLayerConfig(actualUrl, tilejson, mapwarperMetadata);
    }

    /**
     * Fit map bounds to layer bbox if available
     * @param {Object} layerConfig - Layer configuration
     */
    static fitBoundsToMapwarperLayer(layerConfig) {
        const bbox = layerConfig?.bbox || layerConfig?.metadata?.bbox;
        if (!bbox || !window.map || bbox === "0.0,0.0,0.0,0.0") return;

        try {
            const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(parseFloat);
            if (isNaN(minLng) || isNaN(minLat) || isNaN(maxLng) || isNaN(maxLat)) return;
            const bounds = [[minLng, minLat], [maxLng, maxLat]];
            window.map.fitBounds(bounds, {
                padding: 50,
                maxZoom: 16,
                duration: 1000
            });
        } catch (error) {
            console.error('Error fitting bounds to layer:', error);
        }
    }

    /**
     * Gets current shareable URL
     * @returns {string} URL
     */
    static getShareableUrl() {
        const shareBtn = document.getElementById('share-link');
        if (window.shareLinkInstance && typeof window.shareLinkInstance.getCurrentURL === 'function') {
            return window.shareLinkInstance.getCurrentURL();
        }
        if (shareBtn && shareBtn.dataset && shareBtn.dataset.url) {
            return shareBtn.dataset.url;
        }
        return window.location.href;
    }
}

export class LayerCreatorUI {
    /**
     * Create and inject the dialog HTML only once
     */
    static createLayerCreatorDialog() {
        if (document.getElementById('layer-creator-dialog')) return;
        const dialogHtml = `
        <sl-dialog id="layer-creator-dialog" label="Add new data source or atlas" class="layer-creator-modal">
            <form id="layer-creator-form" class="flex flex-col gap-4">
                <sl-select id="layer-preset-dropdown" placeholder="Select from current atlas layers">
                    <sl-icon slot="prefix" name="layers"></sl-icon>
                </sl-select>
                <div class="text-xs text-gray-300">Or add a new data source:</div>
                <sl-input id="layer-url" placeholder="URL to map data or atlas configuration JSON">
                    <sl-icon slot="prefix" name="link"></sl-icon>
                </sl-input>
                <div id="layer-url-help" class="text-xs text-gray-300">
                    Supported: Raster/Vector tile URLs, GeoJSON, Atlas JSON, MapWarper URLs.<br>
                    Examples:<br>
                    <span class="block">Raster: <code>https://warper.wmflabs.org/maps/tile/4749/{z}/{x}/{y}.png</code></span>
                    <span class="block">MapWarper: <code>https://mapwarper.net/maps/95676#Export_tab</code></span>
                    <span class="block">MapWarper: <code>https://warper.wmflabs.org/maps/8940#Show_tab</code></span>
                    <span class="block">Vector: <code>https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt</code></span>
                    <span class="block">GeoJSON: <code>https://gist.githubusercontent.com/planemad/e5ccc47bf2a1aa458a86d6839476f539/raw/6922fcc2d5ffd4d58b0fb069b9f57334f13cd953/goa-water-bodies.geojson</code></span>
                    <span class="block">Atlas: <code>https://jsonkeeper.com/b/RQ0Y</code></span>
                </div>
                <sl-textarea id="layer-config-json" rows="10" resize="vertical" class="font-mono text-xs" placeholder="Atlas Layer JSON"></sl-textarea>
                <div class="flex justify-end gap-2">
                    <sl-button type="button" variant="default" id="cancel-layer-creator" class="layer-creator-btn">Cancel</sl-button>
                    <sl-button type="submit" variant="primary" id="submit-layer-creator" class="layer-creator-btn">Add to map</sl-button>
                </div>
            </form>
        </sl-dialog>
        `;
        $(document.body).append(dialogHtml);
    }

    /**
     * Opens the layer creator dialog
     */
    static openLayerCreatorDialog() {
        this.createLayerCreatorDialog();
        const dialog = document.getElementById('layer-creator-dialog');
        const presetDropdown = document.getElementById('layer-preset-dropdown');
        const urlInput = document.getElementById('layer-url');
        const configTextarea = document.getElementById('layer-config-json');
        const form = document.getElementById('layer-creator-form');
        const cancelBtn = document.getElementById('cancel-layer-creator');

        configTextarea.value = '';
        urlInput.value = '';

        const currentLayers = LayerConfigGenerator.getCurrentAtlasLayers();
        presetDropdown.innerHTML = '';

        const emptyOption = document.createElement('sl-option');
        emptyOption.value = '';
        emptyOption.textContent = 'Duplicate existing layer...';
        presetDropdown.appendChild(emptyOption);

        currentLayers.forEach(layer => {
            const option = document.createElement('sl-option');
            option.value = layer.id;
            option.dataset.config = JSON.stringify(layer.config);
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

        presetDropdown.onchange = null;
        urlInput.oninput = null;
        form.onsubmit = null;

        presetDropdown.addEventListener('sl-change', (e) => {
            const selectedOption = presetDropdown.querySelector(`sl-option[value="${e.target.value}"]`);
            if (selectedOption && selectedOption.dataset.config) {
                const config = JSON.parse(selectedOption.dataset.config);
                configTextarea.value = JSON.stringify(config, null, 2);
                urlInput.value = '';
            }
        });

        urlInput.addEventListener('input', async (e) => {
            const url = e.target.value.trim();
            if (!url || url === lastUrl) return;
            lastUrl = url;
            presetDropdown.value = '';
            configTextarea.value = 'Loading...';
            const config = await LayerConfigGenerator.handleUrlInput(url);
            configTextarea.value = JSON.stringify(config, null, 2);
        });

        cancelBtn.onclick = () => dialog.hide();

        form.onsubmit = (e) => {
            e.preventDefault();
            let configJson = configTextarea.value.trim();
            if (!configJson) return;
            try {
                const configObj = JSON.parse(configJson);
                LayerConfigGenerator.fitBoundsToMapwarperLayer(configObj);

                let baseUrl = LayerConfigGenerator.getShareableUrl();
                let url = new URL(baseUrl);
                const hash = url.hash;
                let layers = url.searchParams.get('layers') || '';
                let jsonString = JSON.stringify(configObj);
                jsonString = jsonString.replace(/'/g, "\\'").replace(/"/g, "'");
                layers = layers ? jsonString + ',' + layers : jsonString;
                url.searchParams.set('layers', layers);
                url.hash = hash;
                window.location.href = url.toString();
            } catch (err) {
                alert('Invalid JSON in config');
            }
        };
    }
}

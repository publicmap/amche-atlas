/**
 * Layer Creator UI and Configuration Generator.
 */

import { MapUtils } from './map-utils.js';
import { MapWarperAPI } from './mapwarper-url-api.js';

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
     * Check if input is a Mapbox tileset ID (format: username.tilesetid)
     * @param {string} input - Input string
     * @returns {boolean} True if it's a Mapbox tileset ID
     */
    static isMapboxTilesetId(input) {
        // Mapbox tileset IDs are in format: username.tilesetid (alphanumeric with dots)
        // They should not contain slashes, protocols, or common URL patterns
        if (!input || input.includes('/') || input.includes('://') || input.includes('{z}')) {
            return false;
        }
        // Match pattern: word.alphanumeric (e.g., planemad.np3cjv7ukkcy)
        return /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(input);
    }

    /**
     * Check if URL is a .pbf or .mvt tile with actual coordinates
     * @param {string} url - URL to check
     * @returns {boolean} True if it's a tile URL with coordinates
     */
    static isPbfTileUrl(url) {
        // Match pattern like /12/2875/1827.pbf or /12/2875/1827.mvt
        return /\/\d+\/\d+\/\d+\.(pbf|mvt)($|\?)/i.test(url);
    }

    /**
     * Check if URL has actual tile coordinates (z/x/y pattern) with or without extension
     * @param {string} url - URL to check
     * @returns {boolean} True if it's a tile URL with coordinates
     */
    static isTileUrl(url) {
        // Match pattern like /15/23112/14953 or /12/2875/1827.png
        return /\/\d+\/\d+\/\d+(\.(pbf|mvt|png|jpg|jpeg|webp))?($|\?)/i.test(url);
    }

    /**
     * Convert a .pbf tile URL with actual coordinates to a template URL
     * @param {string} url - URL with actual tile coordinates
     * @returns {string} Template URL with {z}/{x}/{y} placeholders
     */
    static convertPbfTileUrlToTemplate(url) {
        // Replace pattern /12/2875/1827.pbf with /{z}/{x}/{y}.pbf
        return url.replace(/\/\d+\/\d+\/\d+\.(pbf|mvt)($|\?)/i, '/{z}/{x}/{y}.$1$2');
    }

    /**
     * Convert a tile URL with actual coordinates to a template URL
     * @param {string} url - URL with actual tile coordinates
     * @param {string} defaultExtension - Optional extension to add if none present
     * @returns {string} Template URL with {z}/{x}/{y} placeholders
     */
    static convertTileUrlToTemplate(url, defaultExtension = null) {
        // Replace pattern /15/23112/14953 or /15/23112/14953.ext with /{z}/{x}/{y} or /{z}/{x}/{y}.ext
        return url.replace(/\/\d+\/\d+\/\d+(\.(pbf|mvt|png|jpg|jpeg|webp))?($|\?)/i, (match, ext, extName, end) => {
            if (!ext && defaultExtension) {
                return `/{z}/{x}/{y}.${defaultExtension}${end}`;
            }
            return `/{z}/{x}/{y}${ext || ''}${end}`;
        });
    }

    /**
     * Guesses the layer type from URL
     * @param {string} url - Data URL
     * @returns {string} Guessed type
     */
    static guessLayerType(url) {
        if (this.isMapboxTilesetId(url)) return 'mapbox-tileset';
        if (url.startsWith('mapbox://')) return 'mapbox-tileset';
        if (url.includes('earthengine.googleapis.com') && url.includes('/tiles/')) return 'raster';
        if (/\.geojson($|\?)/i.test(url)) return 'geojson';
        if (this.isPbfTileUrl(url)) return 'vector';
        if (url.includes('{z}') && (url.includes('.pbf') || url.includes('.mvt') || url.includes('vector.openstreetmap.org') || url.includes('/vector/'))) return 'vector';
        if (url.includes('{z}') && (url.includes('.png') || url.includes('.jpg') || url.includes('.webp'))) return 'raster';
        if (url.includes('{x}') && url.includes('{y}') && url.includes('{z}')) return 'raster';
        if (this.isTileUrl(url)) {
            const hasVectorExt = /\.(pbf|mvt)($|\?)/i.test(url);
            return hasVectorExt ? 'vector' : 'raster';
        }
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
                const source = metadata.source;
                const originalUrl = metadata.originalUrl;
                let attribution = '';
                
                // Use source if it exists
                if (source) {
                    if (source.includes('commons.wikimedia.org/wiki/File:')) {
                        // Format wikimedia commons URLs as links
                        const fileName = source.split('/').pop();
                        attribution += formatWikiLink(source, fileName);
                    } else if (source.startsWith('http://') || source.startsWith('https://')) {
                        // Format other URLs as links
                        attribution += `<a href='${source}' target='_blank'>${source}</a>`;
                    } else {
                        // Plain text source
                        attribution += source;
                    }
                }
                
                if (originalUrl) {
                    attribution += attribution ? ' via ' : '';
                    attribution += `<a href='${originalUrl}' target='_blank'>MapWarper</a>`;
                }
                return attribution || undefined;
            };

            const isEarthEngine = url.includes('earthengine.googleapis.com');
            const isAutoDetected = metadata?.autoDetected;

            config = {
                title: metadata ? cleanTitle(metadata.title) : (isEarthEngine ? 'Google Earth Engine Image' : 'Raster Layer'),
                description: metadata ? formatDescription(metadata.description) : (isEarthEngine ? "XYZ tiles generated from <a href='https://developers.google.com/earth-engine/datasets/'>Google Earth Engine</a>" : (isAutoDetected ? "Auto-detected as raster tiles. If tiles don't load, try changing type to 'vector' and add a sourceLayer." : undefined)),
                date: metadata ? metadata.date : undefined,
                type: 'tms',
                id: metadata ? `mapwarper-${metadata.mapId}` : (isEarthEngine ? 'earthengine-' + Math.random().toString(36).slice(2, 8) : 'raster-' + Math.random().toString(36).slice(2, 8)),
                url,
                style: {
                    'raster-opacity': [
                        'interpolate', ['linear'], ['zoom'], 6, 0.95, 18, 0.8, 19, 0.3
                    ]
                },
                attribution: metadata ? formatAttribution(metadata) : (isEarthEngine ? '© Google Earth Engine' : undefined),
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
        } else if (type === 'mapbox-tileset') {
            // Handle Mapbox tileset IDs (e.g., planemad.np3cjv7ukkcy)
            const tilesetId = url.startsWith('mapbox://') ? url.replace('mapbox://', '') : url;
            const mapboxUrl = `mapbox://${tilesetId}`;
            
            config = {
                title: tilejson?.name || `Mapbox Tileset: ${tilesetId}`,
                description: tilejson?.description || 'Mapbox vector tileset',
                type: 'vector',
                id: tilesetId.replace(/\./g, '-') + '-' + Math.random().toString(36).slice(2, 8),
                url: mapboxUrl,
                sourceLayer: tilejson?.vector_layers?.[0]?.id || tilesetId.split('.')[1] || 'default',
                minzoom: tilejson?.minzoom || 0,
                maxzoom: tilejson?.maxzoom || 22,
                attribution: tilejson?.attribution || '© Mapbox',
                initiallyChecked: false,
                inspect: {
                    id: tilejson?.vector_layers?.[0]?.fields?.id ? "id" : "gid",
                    title: "Name",
                    label: tilejson?.vector_layers?.[0]?.fields?.name ? "name" : "id",
                    fields: tilejson?.vector_layers?.[0]?.fields ?
                        Object.keys(tilejson.vector_layers[0].fields).slice(0, 6) :
                        ["id", "name", "type", "class"],
                    fieldTitles: tilejson?.vector_layers?.[0]?.fields ?
                        Object.keys(tilejson.vector_layers[0].fields).slice(0, 6).map(field =>
                            field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                        ) :
                        ["ID", "Name", "Type", "Class"]
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
        let metadata = null;
        let wasConverted = false;

        // Convert .pbf tile URLs with actual coordinates to template URLs
        if (this.isPbfTileUrl(url)) {
            actualUrl = this.convertPbfTileUrlToTemplate(url);
            wasConverted = true;
        }
        // Convert generic tile URLs with actual coordinates to template URLs
        else if (this.isTileUrl(url)) {
            actualUrl = this.convertTileUrlToTemplate(url);
            wasConverted = true;
        }

        // Handle Mapbox tileset IDs (e.g., planemad.np3cjv7ukkcy)
        if (this.isMapboxTilesetId(url)) {
            const tilesetId = url;
            // Try to fetch TileJSON metadata from Mapbox API if access token is available
            if (window.MAPBOX_ACCESS_TOKEN || window.mapboxgl?.accessToken) {
                const accessToken = window.MAPBOX_ACCESS_TOKEN || window.mapboxgl.accessToken;
                try {
                    const tilejsonUrl = `https://api.mapbox.com/v4/${tilesetId}.json?access_token=${accessToken}`;
                    const response = await fetch(tilejsonUrl);
                    if (response.ok) {
                        tilejson = await response.json();
                    }
                } catch (error) {
                    console.warn('Failed to fetch Mapbox TileJSON:', error);
                }
            }
            return this.makeLayerConfig(url, tilejson, null);
        }

        if (MapWarperAPI.isMapWarperUrl(url)) {
            try {
                const config = await MapWarperAPI.createConfigFromUrl(url);
                return config;
            } catch (error) {
                console.warn('Failed to process MapWarper URL:', error);
            }
        }

        if (url.includes('indianopenmaps.fly.dev') && url.includes('/view')) {
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

        if (wasConverted && type === 'raster') {
            metadata = { autoDetected: true };
        }

        return this.makeLayerConfig(actualUrl, tilejson, metadata);
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


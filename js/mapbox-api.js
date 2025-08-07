import { getInsertPosition } from './layer-order-manager.js';
import { parseCSV, rowsToGeoJSON, gstableToArray } from './map-utils.js';

/**
 * MapboxAPI - Abstracts Mapbox GL JS operations for layer management
 * Handles rendering, updating, and removing different layer types on a Mapbox map
 */
export class MapboxAPI {
    constructor(map, atlasConfig = {}) {
        this._map = map;
        this._atlasConfig = atlasConfig;
        this._defaultStyles = atlasConfig.styles || {};
        this._layerCache = new Map(); // Cache for layer configurations
        this._sourceCache = new Map(); // Cache for sources
        this._refreshTimers = new Map(); // Cache for refresh timers
        this._eventListeners = new Map(); // Cache for event listeners
        
        // Initialize style property mapping for different layer types
        this._stylePropertyMapping = this._initializeStylePropertyMapping();
    }

    /**
     * Initialize comprehensive mapping of Mapbox GL style properties
     */
    _initializeStylePropertyMapping() {
        return {
            layout: {
                common: ['visibility'],
                fill: ['fill-sort-key'],
                line: ['line-cap', 'line-join', 'line-miter-limit', 'line-round-limit', 'line-sort-key'],
                symbol: ['icon-allow-overlap', 'icon-anchor', 'icon-image', 'icon-size', 'text-field', 'text-font', 'text-size', 'text-anchor', 'text-line-height', 'text-max-width', 'text-justify', 'text-allow-overlap', 'text-transform', 'text-offset', 'text-rotation-alignment', 'text-pitch-alignment', 'text-writing-mode', 'text-variable-anchor', 'text-radial-offset', 'text-keep-upright'],
                circle: ['circle-sort-key'],
                raster: [],
                background: [],
                hillshade: []
            },
            paint: {
                fill: ['fill-color', 'fill-opacity', 'fill-outline-color', 'fill-translate'],
                line: ['line-color', 'line-width', 'line-opacity', 'line-dasharray', 'line-translate'],
                symbol: ['icon-color', 'icon-opacity', 'text-color', 'text-halo-color', 'text-halo-width', 'text-opacity'],
                circle: ['circle-radius', 'circle-color', 'circle-opacity', 'circle-stroke-width', 'circle-stroke-color'],
                raster: ['raster-opacity', 'raster-contrast', 'raster-saturation', 'raster-brightness-min', 'raster-brightness-max'],
                background: ['background-color', 'background-opacity'],
                hillshade: ['hillshade-exaggeration', 'hillshade-highlight-color', 'hillshade-shadow-color']
            }
        };
    }

    /**
     * Create a layer group on the map
     * @param {string} groupId - Unique identifier for the layer group
     * @param {Object} config - Layer configuration object
     * @param {Object} options - Additional options
     * @returns {Promise<boolean>} - Success status
     */
    async createLayerGroup(groupId, config, options = {}) {
        try {
            const { visible = false, currentGroup = null } = options;
            
            switch (config.type) {
                case 'style':
                    return this._createStyleLayer(groupId, config, visible);
                case 'vector':
                    return this._createVectorLayer(groupId, config, visible);
                case 'tms':
                    return this._createTMSLayer(groupId, config, visible);
                case 'geojson':
                    return this._createGeoJSONLayer(groupId, config, visible);
                case 'csv':
                    return this._createCSVLayer(groupId, config, visible);
                case 'markers':
                    return this._createMarkersLayer(groupId, config, visible);
                case 'img':
                    return this._createImageLayer(groupId, config, visible);
                case 'raster-style-layer':
                    return this._createRasterStyleLayer(groupId, config, visible);
                case 'terrain':
                    return this._createTerrainLayer(groupId, config, visible);
                case 'layer-group':
                    return this._createLayerGroupToggle(groupId, config, visible);
                default:
                    console.warn(`Unknown layer type: ${config.type}`);
                    return false;
            }
        } catch (error) {
            console.error(`Error creating layer group ${groupId}:`, error);
            return false;
        }
    }

    /**
     * Update layer group visibility
     * @param {string} groupId - Layer group identifier
     * @param {Object} config - Layer configuration
     * @param {boolean} visible - Visibility state
     * @returns {boolean} - Success status
     */
    updateLayerGroupVisibility(groupId, config, visible) {
        try {
            switch (config.type) {
                case 'style':
                    return this._updateStyleLayerVisibility(groupId, config, visible);
                case 'vector':
                    return this._updateVectorLayerVisibility(groupId, config, visible);
                case 'tms':
                    return this._updateTMSLayerVisibility(groupId, config, visible);
                case 'geojson':
                    return this._updateGeoJSONLayerVisibility(groupId, config, visible);
                case 'csv':
                    return this._updateCSVLayerVisibility(groupId, config, visible);
                case 'markers':
                    return this._updateMarkersLayerVisibility(groupId, config, visible);
                case 'img':
                    return this._updateImageLayerVisibility(groupId, config, visible);
                case 'raster-style-layer':
                    return this._updateRasterStyleLayerVisibility(groupId, config, visible);
                case 'terrain':
                    return this._updateTerrainLayerVisibility(groupId, config, visible);
                case 'layer-group':
                    return this._updateLayerGroupToggleVisibility(groupId, config, visible);
                default:
                    return false;
            }
        } catch (error) {
            console.error(`Error updating layer group visibility ${groupId}:`, error);
            return false;
        }
    }

    /**
     * Remove a layer group from the map
     * @param {string} groupId - Layer group identifier
     * @param {Object} config - Layer configuration
     * @returns {boolean} - Success status
     */
    removeLayerGroup(groupId, config) {
        try {
            // Clear any refresh timers
            if (this._refreshTimers.has(groupId)) {
                clearInterval(this._refreshTimers.get(groupId));
                this._refreshTimers.delete(groupId);
            }

            switch (config.type) {
                case 'style':
                    return this._removeStyleLayer(groupId, config);
                case 'vector':
                    return this._removeVectorLayer(groupId, config);
                case 'tms':
                    return this._removeTMSLayer(groupId, config);
                case 'geojson':
                    return this._removeGeoJSONLayer(groupId, config);
                case 'csv':
                    return this._removeCSVLayer(groupId, config);
                case 'markers':
                    return this._removeMarkersLayer(groupId, config);
                case 'img':
                    return this._removeImageLayer(groupId, config);
                case 'raster-style-layer':
                    return this._removeRasterStyleLayer(groupId, config);
                case 'terrain':
                    return this._removeTerrainLayer(groupId, config);
                default:
                    return true; // No-op for unknown types
            }
        } catch (error) {
            console.error(`Error removing layer group ${groupId}:`, error);
            return false;
        }
    }

    /**
     * Update layer opacity
     * @param {string} groupId - Layer group identifier
     * @param {Object} config - Layer configuration
     * @param {number} opacity - Opacity value (0-1)
     * @returns {boolean} - Success status
     */
    updateLayerOpacity(groupId, config, opacity) {
        try {
            switch (config.type) {
                case 'vector':
                    return this._updateVectorLayerOpacity(groupId, config, opacity);
                case 'tms':
                    return this._updateTMSLayerOpacity(groupId, config, opacity);
                case 'geojson':
                    return this._updateGeoJSONLayerOpacity(groupId, config, opacity);
                case 'img':
                    return this._updateImageLayerOpacity(groupId, config, opacity);
                case 'raster-style-layer':
                    return this._updateRasterStyleLayerOpacity(groupId, config, opacity);
                default:
                    return false;
            }
        } catch (error) {
            console.error(`Error updating layer opacity ${groupId}:`, error);
            return false;
        }
    }

    // Style layer methods
    _createStyleLayer(groupId, config, visible) {
        // Style layers are already in the map, just need to control visibility
        if (config.layers) {
            const styleLayers = this._map.getStyle().layers;
            let totalLayersProcessed = 0;
            
            config.layers.forEach(layer => {
                const layerIds = styleLayers
                    .filter(styleLayer => styleLayer['source-layer'] === layer.sourceLayer)
                    .map(styleLayer => styleLayer.id);

                if (layerIds.length === 0) {
                    console.debug(`[MapboxAPI] No style layers found for sourceLayer: ${layer.sourceLayer}`);
                } else {
                    console.debug(`[MapboxAPI] Found ${layerIds.length} style layers for sourceLayer: ${layer.sourceLayer}`, layerIds);
                }

                layerIds.forEach(layerId => {
                    if (this._map.getLayer(layerId)) {
                        // When creating/showing a style layer, make sure visibility matches the expected state
                        this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
                        totalLayersProcessed++;
                        console.debug(`[MapboxAPI] Set layer ${layerId} visibility to ${visible ? 'visible' : 'none'}`);
                    } else {
                        console.warn(`[MapboxAPI] Layer ${layerId} not found in map style`);
                    }
                });
            });
            
            console.debug(`[MapboxAPI] Style layer ${groupId}: processed ${totalLayersProcessed} layers, visible: ${visible}`);
            return true;
        }
        return false;
    }

    _updateStyleLayerVisibility(groupId, config, visible) {
        return this._createStyleLayer(groupId, config, visible);
    }

    _removeStyleLayer(groupId, config) {
        // Style layers are part of the base style, just hide them
        return this._updateStyleLayerVisibility(groupId, config, false);
    }

    // Vector layer methods
    _createVectorLayer(groupId, config, visible) {
        const sourceId = `vector-${groupId}`;
        
        if (!this._map.getSource(sourceId)) {
            // Add source
            const sourceConfig = {
                type: 'vector',
                maxzoom: config.maxzoom || 22
            };

            if (config.url.startsWith('mapbox://')) {
                sourceConfig.url = config.url;
            } else {
                sourceConfig.tiles = [config.url];
            }

            if (config.inspect?.id) {
                sourceConfig.promoteId = { [config.sourceLayer]: config.inspect.id };
            }

            this._map.addSource(sourceId, sourceConfig);

            // Add layers based on style properties
            this._addVectorLayers(groupId, config, sourceId, visible);
        } else {
            // Update visibility only
            this._updateVectorLayerVisibility(groupId, config, visible);
        }
        
        return true;
    }

    _addVectorLayers(groupId, config, sourceId, visible) {
        // Get default styles for checking what layer types should be created
        const defaultStyles = this._defaultStyles.vector || {};
        
        // Check if user has explicitly defined any styles
        const userHasFillStyles = config.style && (config.style['fill-color'] || config.style['fill-opacity']);
        const userHasLineStyles = config.style && (config.style['line-color'] || config.style['line-width']);
        const userHasTextStyles = config.style && config.style['text-field'];
        
        // If user has only line styles defined, treat this as a linestring layer and don't apply fill styles
        const userOnlyHasLineStyles = userHasLineStyles && !userHasFillStyles && !userHasTextStyles;
        
        // Check if fill layer should be created
        // If user only has line styles, don't create fill layer even if defaults exist
        const hasFillStyles = userHasFillStyles || 
                             (!userOnlyHasLineStyles && defaultStyles.fill && (defaultStyles.fill['fill-color'] || defaultStyles.fill['fill-opacity']));
        
        // Check if line layer should be created (user styles or defaults)
        const hasLineStyles = userHasLineStyles ||
                             (defaultStyles.line && (defaultStyles.line['line-color'] || defaultStyles.line['line-width']));
        
        // Check if text layer should be created (user styles or defaults)
        const hasTextStyles = userHasTextStyles ||
                             (defaultStyles.text && defaultStyles.text['text-field']);

        // Add fill layer
        if (hasFillStyles) {
            // Filter style to only include fill-related properties
            const fillStyle = this._filterStyleForLayerType(config.style, 'fill');
            
            const layerConfig = this._createLayerConfig({
                id: `vector-layer-${groupId}`,
                type: 'fill',
                source: sourceId,
                'source-layer': config.sourceLayer || 'default',
                style: fillStyle,
                filter: config.filter,
                visible
            }, 'fill');

            this._map.addLayer(layerConfig, getInsertPosition(this._map, 'vector', 'fill', config, []));
        }

        // Add line layer
        if (hasLineStyles) {
            // Filter style to only include line-related properties
            const lineStyle = this._filterStyleForLayerType(config.style, 'line');
            
            const layerConfig = this._createLayerConfig({
                id: `vector-layer-${groupId}-outline`,
                type: 'line',
                source: sourceId,
                'source-layer': config.sourceLayer || 'default',
                style: lineStyle,
                filter: config.filter,
                visible
            }, 'line');

            this._map.addLayer(layerConfig, getInsertPosition(this._map, 'vector', 'line', config, []));
        }

        // Add text layer
        if (hasTextStyles) {
            // Filter style to only include symbol/text-related properties
            const symbolStyle = this._filterStyleForLayerType(config.style, 'symbol');
            
            const layerConfig = this._createLayerConfig({
                id: `vector-layer-${groupId}-text`,
                type: 'symbol',
                source: sourceId,
                'source-layer': config.sourceLayer || 'default',
                style: symbolStyle,
                filter: config.filter,
                visible
            }, 'symbol');

            this._map.addLayer(layerConfig, getInsertPosition(this._map, 'vector', 'symbol', config, []));
        }
    }

    _updateVectorLayerVisibility(groupId, config, visible) {
        const layers = [
            `vector-layer-${groupId}`,
            `vector-layer-${groupId}-outline`,
            `vector-layer-${groupId}-text`
        ];

        layers.forEach(layerId => {
            if (this._map.getLayer(layerId)) {
                this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
            }
        });

        return true;
    }

    _removeVectorLayer(groupId, config) {
        const sourceId = `vector-${groupId}`;
        const layers = [
            `vector-layer-${groupId}`,
            `vector-layer-${groupId}-outline`,
            `vector-layer-${groupId}-text`
        ];

        // Remove layers
        layers.forEach(layerId => {
            if (this._map.getLayer(layerId)) {
                this._map.removeLayer(layerId);
            }
        });

        // Remove source
        if (this._map.getSource(sourceId)) {
            this._map.removeSource(sourceId);
        }

        return true;
    }

    _updateVectorLayerOpacity(groupId, config, opacity) {
        if (this._map.getLayer(`vector-layer-${groupId}`)) {
            this._map.setPaintProperty(`vector-layer-${groupId}`, 'fill-opacity', opacity);
        }
        if (this._map.getLayer(`vector-layer-${groupId}-outline`)) {
            this._map.setPaintProperty(`vector-layer-${groupId}-outline`, 'line-opacity', opacity);
        }
        if (this._map.getLayer(`vector-layer-${groupId}-text`)) {
            this._map.setPaintProperty(`vector-layer-${groupId}-text`, 'text-opacity', opacity);
        }
        return true;
    }

    // TMS layer methods
    _createTMSLayer(groupId, config, visible) {
        const sourceId = `tms-${groupId}`;
        const layerId = `tms-layer-${groupId}`;

        if (!this._map.getSource(sourceId)) {
            const sourceConfig = {
                type: 'raster',
                tileSize: 256,
                maxzoom: config.maxzoom || 22
            };

            if (config.url.startsWith('mapbox://')) {
                sourceConfig.url = config.url;
            } else {
                sourceConfig.tiles = [config.url];
            }

            this._map.addSource(sourceId, sourceConfig);

            const layerConfig = this._createLayerConfig({
                id: layerId,
                source: sourceId,
                style: {
                    ...(this._defaultStyles.raster || {}),
                    ...(config.style || {}),
                    'raster-opacity': config.style?.['raster-opacity'] || config.opacity || this._defaultStyles.raster?.['raster-opacity'] || 1
                },
                visible
            }, 'raster');

            this._map.addLayer(layerConfig, getInsertPosition(this._map, 'tms', null, config, []));
        } else {
            this._updateTMSLayerVisibility(groupId, config, visible);
        }

        return true;
    }

    _updateTMSLayerVisibility(groupId, config, visible) {
        const layerId = `tms-layer-${groupId}`;
        if (this._map.getLayer(layerId)) {
            this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        }
        return true;
    }

    _removeTMSLayer(groupId, config) {
        const sourceId = `tms-${groupId}`;
        const layerId = `tms-layer-${groupId}`;

        if (this._map.getLayer(layerId)) {
            this._map.removeLayer(layerId);
        }
        if (this._map.getSource(sourceId)) {
            this._map.removeSource(sourceId);
        }
        return true;
    }

    _updateTMSLayerOpacity(groupId, config, opacity) {
        const layerId = `tms-layer-${groupId}`;
        if (this._map.getLayer(layerId)) {
            this._map.setPaintProperty(layerId, 'raster-opacity', opacity);
        }
        return true;
    }

    // GeoJSON layer methods
    async _createGeoJSONLayer(groupId, config, visible) {
        const sourceId = `geojson-${groupId}`;

        if (!this._map.getSource(sourceId) && visible) {
            let dataSource;
            
            if (config.data) {
                dataSource = this._processGeoJSONData(config.data);
            } else if (config.url) {
                dataSource = config.url;
            } else {
                console.error('GeoJSON layer missing both data and URL:', groupId);
                return false;
            }

            const sourceConfig = {
                type: 'geojson',
                data: dataSource
            };

            if (config.inspect?.id) {
                sourceConfig.promoteId = config.inspect.id;
            }

            this._map.addSource(sourceId, sourceConfig);
            this._addGeoJSONLayers(groupId, config, sourceId, visible);
        } else {
            this._updateGeoJSONLayerVisibility(groupId, config, visible);
        }

        return true;
    }

    _processGeoJSONData(data) {
        if (data.type === 'FeatureCollection') {
            return data;
        } else if (data.type === 'Feature') {
            return { type: 'FeatureCollection', features: [data] };
        } else if (data.type && data.coordinates) {
            return {
                type: 'FeatureCollection',
                features: [{ type: 'Feature', geometry: data, properties: {} }]
            };
        }
        throw new Error('Invalid GeoJSON data format');
    }

    _addGeoJSONLayers(groupId, config, sourceId, visible) {
        // Get default styles for checking what layer types should be created
        const defaultStyles = this._defaultStyles.vector || {};
        
        // Check if user has explicitly defined any styles
        const userHasFillStyles = config.style && (config.style['fill-color'] || config.style['fill-opacity']);
        const userHasLineStyles = config.style && (config.style['line-color'] || config.style['line-width']);
        const userHasTextStyles = config.style && config.style['text-field'];
        const userHasCircleStyles = config.style && (config.style['circle-radius'] || config.style['circle-color']);
        
        // Check if fill layer should be created (user styles or defaults)
        const hasFillStyles = userHasFillStyles || 
                             (defaultStyles.fill && (defaultStyles.fill['fill-color'] || defaultStyles.fill['fill-opacity']));
        
        // Check if line layer should be created (user styles or defaults)
        const hasLineStyles = userHasLineStyles ||
                             (defaultStyles.line && (defaultStyles.line['line-color'] || defaultStyles.line['line-width']));
        
        // Check if text layer should be created (user styles or defaults)
        const hasTextStyles = userHasTextStyles ||
                             (defaultStyles.text && defaultStyles.text['text-field']);
        
        // Check if circle layer should be created (only if user explicitly defines circle properties)
        const hasCircleStyles = userHasCircleStyles;

        // Add fill layer
        if (hasFillStyles) {
            // Filter style to only include fill-related properties
            const fillStyle = this._filterStyleForLayerType(config.style, 'fill');
            
            const fillLayerConfig = this._createLayerConfig({
                id: `${sourceId}-fill`,
                type: 'fill',
                source: sourceId,
                style: fillStyle,
                visible
            }, 'fill');

            this._map.addLayer(fillLayerConfig, getInsertPosition(this._map, 'vector', 'fill', config, []));
        }

        // Add line layer
        if (hasLineStyles) {
            // Filter style to only include line-related properties
            const lineStyle = this._filterStyleForLayerType(config.style, 'line');
            
            const lineLayerConfig = this._createLayerConfig({
                id: `${sourceId}-line`,
                type: 'line',
                source: sourceId,
                style: lineStyle,
                visible
            }, 'line');

            console.log(`[MapboxAPI] Final layer config for geojson layer. The final line-width is`, lineLayerConfig.paint['line-width']);

            this._map.addLayer(lineLayerConfig, getInsertPosition(this._map, 'vector', 'line', config, []));
        }

        // Add circle layer if circle properties are defined
        if (hasCircleStyles) {
            // Filter style to only include circle-related properties
            const circleStyle = this._filterStyleForLayerType(config.style, 'circle');
            
            const circleLayerConfig = this._createLayerConfig({
                id: `${sourceId}-circle`,
                type: 'circle',
                source: sourceId,
                style: circleStyle,
                visible
            }, 'circle');

            this._map.addLayer(circleLayerConfig, getInsertPosition(this._map, 'vector', 'circle', config, []));
        }

        // Add text layer if text properties are defined
        if (hasTextStyles) {
            // Filter style to only include symbol/text-related properties
            const symbolStyle = this._filterStyleForLayerType(config.style, 'symbol');
            
            const textLayerConfig = this._createLayerConfig({
                id: `${sourceId}-label`,
                type: 'symbol',
                source: sourceId,
                style: symbolStyle,
                visible
            }, 'symbol');

            this._map.addLayer(textLayerConfig, getInsertPosition(this._map, 'vector', 'symbol', config, []));
        }
    }

    _updateGeoJSONLayerVisibility(groupId, config, visible) {
        const sourceId = `geojson-${groupId}`;
        const layers = [`${sourceId}-fill`, `${sourceId}-line`, `${sourceId}-label`, `${sourceId}-circle`];

        layers.forEach(layerId => {
            if (this._map.getLayer(layerId)) {
                this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
            }
        });

        return true;
    }

    _removeGeoJSONLayer(groupId, config) {
        const sourceId = `geojson-${groupId}`;
        const layers = [`${sourceId}-fill`, `${sourceId}-line`, `${sourceId}-label`, `${sourceId}-circle`];

        layers.forEach(layerId => {
            if (this._map.getLayer(layerId)) {
                this._map.removeLayer(layerId);
            }
        });

        if (this._map.getSource(sourceId)) {
            this._map.removeSource(sourceId);
        }

        return true;
    }

    _updateGeoJSONLayerOpacity(groupId, config, opacity) {
        const sourceId = `geojson-${groupId}`;
        
        if (this._map.getLayer(`${sourceId}-fill`)) {
            this._map.setPaintProperty(`${sourceId}-fill`, 'fill-opacity', opacity * 0.5);
        }
        if (this._map.getLayer(`${sourceId}-line`)) {
            this._map.setPaintProperty(`${sourceId}-line`, 'line-opacity', opacity);
        }
        if (this._map.getLayer(`${sourceId}-label`)) {
            this._map.setPaintProperty(`${sourceId}-label`, 'text-opacity', opacity);
        }
        if (this._map.getLayer(`${sourceId}-circle`)) {
            this._map.setPaintProperty(`${sourceId}-circle`, 'circle-opacity', opacity);
        }

        return true;
    }

    // CSV layer methods
    async _createCSVLayer(groupId, config, visible) {
        const sourceId = `csv-${groupId}`;
        const layerId = `${sourceId}-circle`;

        if (!this._map.getSource(sourceId) && visible) {
            try {
                let geojson;

                if (config.data) {
                    geojson = this._processCSVData(config.data, config.csvParser);
                } else if (config.url) {
                    const response = await fetch(config.url);
                    const csvText = await response.text();
                    geojson = this._processCSVData(csvText, config.csvParser);
                } else {
                    console.error('CSV layer missing both data and URL:', groupId);
                    return false;
                }

                this._map.addSource(sourceId, {
                    type: 'geojson',
                    data: geojson
                });

                const layerConfig = this._createLayerConfig({
                    id: layerId,
                    type: 'circle',
                    source: sourceId,
                    style: {
                        'circle-radius': config.style?.['circle-radius'] || 5,
                        'circle-color': config.style?.['circle-color'] || '#3887be',
                        'circle-opacity': config.style?.['circle-opacity'] || 0.7,
                        'circle-stroke-width': config.style?.['circle-stroke-width'] || 1.5,
                        'circle-stroke-color': config.style?.['circle-stroke-color'] || '#ffffff'
                    },
                    visible
                }, 'circle');

                this._map.addLayer(layerConfig, getInsertPosition(this._map, 'csv', null, config, []));

                // Set up refresh if specified
                if (config.refresh && config.url) {
                    this._setupCSVRefresh(groupId, config);
                }
            } catch (error) {
                console.error(`Error loading CSV layer '${groupId}':`, error);
                return false;
            }
        } else {
            this._updateCSVLayerVisibility(groupId, config, visible);
        }

        return true;
    }

    _processCSVData(data, csvParser) {
        let rows;
        if (Array.isArray(data)) {
            rows = data;
        } else if (typeof data === 'string') {
            rows = csvParser ? csvParser(data) : parseCSV(data);
        } else {
            throw new Error('Invalid CSV data format');
        }
        return rowsToGeoJSON(rows);
    }

    _setupCSVRefresh(groupId, config) {
        if (this._refreshTimers.has(groupId)) {
            clearInterval(this._refreshTimers.get(groupId));
        }

        const timer = setInterval(async () => {
            const sourceId = `csv-${groupId}`;
            if (!this._map.getSource(sourceId)) {
                clearInterval(timer);
                this._refreshTimers.delete(groupId);
                return;
            }

            try {
                const response = await fetch(config.url);
                const csvText = await response.text();
                const geojson = this._processCSVData(csvText, config.csvParser);
                this._map.getSource(sourceId).setData(geojson);
            } catch (error) {
                console.error('Error refreshing CSV layer:', error);
            }
        }, config.refresh);

        this._refreshTimers.set(groupId, timer);
    }

    _updateCSVLayerVisibility(groupId, config, visible) {
        const layerId = `csv-${groupId}-circle`;
        if (this._map.getLayer(layerId)) {
            this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        }

        if (visible && config.refresh && config.url && !this._refreshTimers.has(groupId)) {
            this._setupCSVRefresh(groupId, config);
        } else if (!visible && this._refreshTimers.has(groupId)) {
            clearInterval(this._refreshTimers.get(groupId));
            this._refreshTimers.delete(groupId);
        }

        return true;
    }

    _removeCSVLayer(groupId, config) {
        const sourceId = `csv-${groupId}`;
        const layerId = `${sourceId}-circle`;

        if (this._map.getLayer(layerId)) {
            this._map.removeLayer(layerId);
        }
        if (this._map.getSource(sourceId)) {
            this._map.removeSource(sourceId);
        }

        return true;
    }

    // Markers layer methods
    async _createMarkersLayer(groupId, config, visible) {
        const sourceId = `markers-${groupId}`;
        const layerId = `${sourceId}-circles`;

        if (!this._map.getSource(sourceId) && visible && config.dataUrl) {
            try {
                const response = await fetch(config.dataUrl);
                const data = await response.text();

                let geojson;
                if (config.dataUrl.includes('spreadsheets.google.com')) {
                    const parsedData = gstableToArray(JSON.parse(data.slice(47, -2)).table);
                    geojson = {
                        type: 'FeatureCollection',
                        features: parsedData.map(row => ({
                            type: 'Feature',
                            geometry: {
                                type: 'Point',
                                coordinates: [row.Longitude || 0, row.Latitude || 0]
                            },
                            properties: row
                        }))
                    };
                } else {
                    throw new Error('Unsupported markers data source format');
                }

                const sourceConfig = {
                    type: 'geojson',
                    data: geojson
                };

                if (config.inspect?.id) {
                    sourceConfig.promoteId = config.inspect.id;
                }

                this._map.addSource(sourceId, sourceConfig);

                const layerConfig = this._createLayerConfig({
                    id: layerId,
                    type: 'circle',
                    source: sourceId,
                    style: {
                        'circle-radius': config.style?.['circle-radius'] || 6,
                        'circle-color': config.style?.['circle-color'] || '#FF0000',
                        'circle-opacity': config.style?.['circle-opacity'] || 0.9,
                        'circle-stroke-width': 1,
                        'circle-stroke-color': '#ffffff'
                    },
                    visible
                }, 'circle');

                this._map.addLayer(layerConfig);
            } catch (error) {
                console.error(`Error loading markers layer '${groupId}':`, error);
                return false;
            }
        } else {
            this._updateMarkersLayerVisibility(groupId, config, visible);
        }

        return true;
    }

    _updateMarkersLayerVisibility(groupId, config, visible) {
        const layerId = `markers-${groupId}-circles`;
        if (this._map.getLayer(layerId)) {
            this._map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
        }
        return true;
    }

    _removeMarkersLayer(groupId, config) {
        const sourceId = `markers-${groupId}`;
        const layerId = `${sourceId}-circles`;

        if (this._map.getLayer(layerId)) {
            this._map.removeLayer(layerId);
        }
        if (this._map.getSource(sourceId)) {
            this._map.removeSource(sourceId);
        }

        return true;
    }

    // Image layer methods
    async _createImageLayer(groupId, config, visible) {
        if (!this._map.getSource(groupId) && visible) {
            if (!config.url || !config.bounds) {
                console.error(`Image layer ${groupId} missing URL or bounds`);
                return false;
            }

            try {
                const url = config.refresh ? 
                    (config.url.includes('?') ? `${config.url}&_t=${Date.now()}` : `${config.url}?_t=${Date.now()}`) :
                    config.url;

                await this._loadImage(url);

                const bounds = config.bounds || config.bbox;
                this._map.addSource(groupId, {
                    type: 'image',
                    url: url,
                    coordinates: [
                        [bounds[0], bounds[3]], // top-left
                        [bounds[2], bounds[3]], // top-right
                        [bounds[2], bounds[1]], // bottom-right
                        [bounds[0], bounds[1]]  // bottom-left
                    ]
                });

                const layerConfig = this._createLayerConfig({
                    id: groupId,
                    source: groupId,
                    style: {
                        'raster-opacity': config.style?.['raster-opacity'] || config.opacity || 0.85,
                        'raster-fade-duration': 0
                    },
                    visible
                }, 'raster');

                this._map.addLayer(layerConfig, getInsertPosition(this._map, 'img', null, config, []));

                if (config.refresh) {
                    this._setupImageRefresh(groupId, config);
                }
            } catch (error) {
                console.error(`Failed to load image for layer ${groupId}:`, error);
                return false;
            }
        } else {
            this._updateImageLayerVisibility(groupId, config, visible);
        }

        return true;
    }

    _loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    _setupImageRefresh(groupId, config) {
        if (this._refreshTimers.has(groupId)) {
            clearInterval(this._refreshTimers.get(groupId));
        }

        const timer = setInterval(async () => {
            if (!this._map.getSource(groupId)) {
                clearInterval(timer);
                this._refreshTimers.delete(groupId);
                return;
            }

            try {
                const timestamp = Date.now();
                const url = config.url.includes('?') ?
                    `${config.url}&_t=${timestamp}` :
                    `${config.url}?_t=${timestamp}`;

                await this._loadImage(url);
                
                const source = this._map.getSource(groupId);
                source.updateImage({
                    url: url,
                    coordinates: source.coordinates
                });
            } catch (error) {
                console.error(`Error refreshing image layer ${groupId}:`, error);
            }
        }, config.refresh);

        this._refreshTimers.set(groupId, timer);
    }

    _updateImageLayerVisibility(groupId, config, visible) {
        if (this._map.getLayer(groupId)) {
            this._map.setLayoutProperty(groupId, 'visibility', visible ? 'visible' : 'none');
        }

        if (visible && config.refresh && !this._refreshTimers.has(groupId)) {
            this._setupImageRefresh(groupId, config);
        } else if (!visible && this._refreshTimers.has(groupId)) {
            clearInterval(this._refreshTimers.get(groupId));
            this._refreshTimers.delete(groupId);
        }

        return true;
    }

    _removeImageLayer(groupId, config) {
        if (this._map.getLayer(groupId)) {
            this._map.removeLayer(groupId);
        }
        if (this._map.getSource(groupId)) {
            this._map.removeSource(groupId);
        }
        return true;
    }

    _updateImageLayerOpacity(groupId, config, opacity) {
        if (this._map.getLayer(groupId)) {
            this._map.setPaintProperty(groupId, 'raster-opacity', opacity);
        }
        return true;
    }

    // Raster style layer methods
    _createRasterStyleLayer(groupId, config, visible) {
        const styleLayerId = config.styleLayer || groupId;
        
        if (this._map.getLayer(styleLayerId)) {
            this._map.setLayoutProperty(styleLayerId, 'visibility', visible ? 'visible' : 'none');
            
            if (visible && config.style) {
                this._applyStyleProperties(styleLayerId, config.style);
            }
        } else {
            console.warn(`Style layer '${styleLayerId}' not found in map style`);
            return false;
        }
        
        return true;
    }

    _applyStyleProperties(layerId, style) {
        const existingLayer = this._map.getLayer(layerId);
        const layerType = existingLayer.type;
        const { paint, layout } = this._categorizeStyleProperties(style, layerType);

        Object.entries(paint).forEach(([property, value]) => {
            try {
                this._map.setPaintProperty(layerId, property, value);
            } catch (error) {
                console.warn(`Failed to set paint property ${property} on layer ${layerId}:`, error);
            }
        });

        Object.entries(layout).forEach(([property, value]) => {
            if (property !== 'visibility') {
                try {
                    this._map.setLayoutProperty(layerId, property, value);
                } catch (error) {
                    console.warn(`Failed to set layout property ${property} on layer ${layerId}:`, error);
                }
            }
        });
    }

    _updateRasterStyleLayerVisibility(groupId, config, visible) {
        return this._createRasterStyleLayer(groupId, config, visible);
    }

    _removeRasterStyleLayer(groupId, config) {
        return this._updateRasterStyleLayerVisibility(groupId, config, false);
    }

    _updateRasterStyleLayerOpacity(groupId, config, opacity) {
        const styleLayerId = config.styleLayer || groupId;
        if (this._map.getLayer(styleLayerId)) {
            const existingLayer = this._map.getLayer(styleLayerId);
            if (existingLayer.type === 'raster') {
                this._map.setPaintProperty(styleLayerId, 'raster-opacity', opacity);
            }
        }
        return true;
    }

    // Terrain layer methods
    _createTerrainLayer(groupId, config, visible) {
        this._map.setTerrain(visible ? { source: 'mapbox-dem', exaggeration: 1.5 } : null);
        this._map.setFog(visible ? {
            'color': 'white',
            'horizon-blend': 0.1,
            'high-color': '#add8e6',
            'star-intensity': 0.1
        } : null);
        return true;
    }

    _updateTerrainLayerVisibility(groupId, config, visible) {
        return this._createTerrainLayer(groupId, config, visible);
    }

    _removeTerrainLayer(groupId, config) {
        this._map.setTerrain(null);
        this._map.setFog(null);
        return true;
    }

    // Layer group toggle methods
    _createLayerGroupToggle(groupId, config, visible) {
        if (config.groups) {
            config.groups.forEach(subGroup => {
                const allLayers = this._map.getStyle().layers
                    .map(layer => layer.id)
                    .filter(id =>
                        id === subGroup.id ||
                        id.startsWith(`${subGroup.id}-`) ||
                        id.startsWith(`${subGroup.id} `)
                    );
                this._updateLayerVisibility(allLayers, visible);
            });
        }
        return true;
    }

    _updateLayerGroupToggleVisibility(groupId, config, visible) {
        return this._createLayerGroupToggle(groupId, config, visible);
    }

    _updateLayerVisibility(layers, isVisible) {
        layers.forEach(layerId => {
            if (this._map.getLayer(layerId)) {
                this._map.setLayoutProperty(
                    layerId,
                    'visibility',
                    isVisible ? 'visible' : 'none'
                );
            }
        });
    }

    /**
     * Get all layers associated with a layer group
     * @param {string} groupId - Layer group identifier
     * @param {Object} config - Layer configuration
     * @returns {Array} - Array of layer IDs
     */
    getLayerGroupIds(groupId, config) {
        switch (config.type) {
            case 'vector':
                return [
                    `vector-layer-${groupId}`,
                    `vector-layer-${groupId}-outline`,
                    `vector-layer-${groupId}-text`
                ].filter(id => this._map.getLayer(id));
            case 'tms':
                return [`tms-layer-${groupId}`].filter(id => this._map.getLayer(id));
            case 'geojson':
                const sourceId = `geojson-${groupId}`;
                return [`${sourceId}-fill`, `${sourceId}-line`, `${sourceId}-label`, `${sourceId}-circle`]
                    .filter(id => this._map.getLayer(id));
            case 'csv':
                return [`csv-${groupId}-circle`].filter(id => this._map.getLayer(id));
            case 'markers':
                return [`markers-${groupId}-circles`].filter(id => this._map.getLayer(id));
            case 'img':
            case 'raster-style-layer':
                return [config.styleLayer || groupId].filter(id => this._map.getLayer(id));
            default:
                return [];
        }
    }

    /**
     * Check if a layer group exists on the map
     * @param {string} groupId - Layer group identifier
     * @param {Object} config - Layer configuration
     * @returns {boolean} - True if layer group exists
     */
    hasLayerGroup(groupId, config) {
        const layerIds = this.getLayerGroupIds(groupId, config);
        return layerIds.length > 0;
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
        // Note: text- properties are NOT filtered out because text layers are created separately as symbol type
        const invalidPatterns = {
            symbol: [
                /^fill-/,        // fill-color, fill-opacity, etc.
                /^line-/,        // line-color, line-width, etc.
                /^circle-/       // circle-radius, circle-color, etc.
            ],
            fill: [
                /^line-/,        // line-color, line-width, etc.
                /^icon-/,        // icon-image, icon-color, etc.
                /^circle-/,      // circle-radius, circle-color, etc.
                /^text-/         // text-field, text-color, etc.
            ],
            line: [
                /^fill-/,        // fill-color, fill-opacity, etc.
                /^icon-/,        // icon-image, icon-color, etc.
                /^circle-/,      // circle-radius, circle-color, etc.
                /^text-/         // text-field, text-color, etc.
            ],
            circle: [
                /^fill-/,        // fill-color, fill-opacity, etc.
                /^line-/,        // line-color, line-width, etc.
                /^icon-/,        // icon-image, icon-color, etc.
                /^text-/         // text-field, text-color, etc.
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
     * Filter style properties to only include those valid for the specified layer type
     * @param {Object} style - The complete style object
     * @param {string} layerType - The layer type (fill, line, symbol, circle, etc.)
     * @returns {Object} - Filtered style object
     */
    _filterStyleForLayerType(style, layerType) {
        if (!style || typeof style !== 'object') {
            return {};
        }

        const filteredStyle = {};
        
        Object.keys(style).forEach(property => {
            if (this._isPropertyValidForLayerType(property, layerType)) {
                filteredStyle[property] = style[property];
            }
        });

        return filteredStyle;
    }

    /**
     * Create layer configuration with properly categorized paint/layout properties
     * @param {Object} config - Layer configuration
     * @param {string} layerType - The layer type
     * @returns {Object} - Layer configuration with separated paint/layout
     */
    _createLayerConfig(config, layerType) {
        // Get default styles for this layer type
        const defaultStyles = this._getDefaultStylesForLayerType(layerType);
        
        // Intelligently merge user styles with defaults (preserving feature-state logic)
        const mergedStyles = this._intelligentStyleMerge(config.style || {}, defaultStyles);
        
        const { paint, layout } = this._categorizeStyleProperties(mergedStyles, layerType);

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

    /**
     * Get default styles for a specific layer type
     * @param {string} layerType - The layer type (fill, line, symbol, circle, etc.)
     * @returns {Object} - Default styles for this layer type
     */
    _getDefaultStylesForLayerType(layerType) {
        if (!this._defaultStyles || !this._defaultStyles.vector) {
            return {};
        }

        // Map layer types to default style categories
        const styleMap = {
            'fill': this._defaultStyles.vector.fill || {},
            'line': this._defaultStyles.vector.line || {},
            'symbol': this._defaultStyles.vector.text || {},
            'circle': this._defaultStyles.vector.circle || {},
            'raster': this._defaultStyles.raster || {}
        };

        return styleMap[layerType] || {};
    }

    /**
     * Intelligently combine user color with default style expression (preserving feature-state logic)
     * @param {*} userColor - User-provided color value
     * @param {*} defaultStyleExpression - Default style expression (may contain feature-state logic)
     * @returns {*} - Combined style expression
     */
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

    /**
     * Check if an expression contains zoom-based logic
     * @param {*} expression - The expression to check
     * @returns {boolean} - True if expression has zoom logic
     */
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

    /**
     * Replace colors in interpolate expressions while preserving structure
     * @param {Array} interpolateExpr - The interpolate expression to modify
     * @param {*} newColor - The new color to use
     */
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

    /**
     * Intelligently merge user styles with default styles
     * @param {Object} userStyles - User-provided styles
     * @param {Object} defaultStyles - Default styles with feature-state logic
     * @returns {Object} - Merged styles
     */
    _intelligentStyleMerge(userStyles, defaultStyles) {
        if (!defaultStyles || typeof defaultStyles !== 'object') {
            return userStyles || {};
        }
        if (!userStyles || typeof userStyles !== 'object') {
            return defaultStyles;
        }

        const mergedStyles = {};

        // First, add all default styles
        Object.keys(defaultStyles).forEach(property => {
            mergedStyles[property] = defaultStyles[property];
        });

        // Then, intelligently merge user styles
        Object.keys(userStyles).forEach(property => {
            const userValue = userStyles[property];
            const defaultValue = defaultStyles[property];

            // For color properties, use intelligent combining
            if (property.includes('-color') && defaultValue) {
                mergedStyles[property] = this._combineWithDefaultStyle(userValue, defaultValue);
            } else {
                // For non-color properties, user value takes precedence
                mergedStyles[property] = userValue;
            }
        });

        // Special handling for text-halo-color: use fill-color as fallback if text-halo-color not provided
        if (!userStyles['text-halo-color'] && userStyles['fill-color'] && defaultStyles['text-halo-color']) {
            mergedStyles['text-halo-color'] = this._combineWithDefaultStyle(
                userStyles['fill-color'], 
                defaultStyles['text-halo-color']
            );
        }

        return mergedStyles;
    }

    /**
     * Cleanup all layer groups and dispose of the API
     */
    cleanup() {
        // Clean up all event listeners
        this._eventListeners.forEach((listeners, eventType) => {
            listeners.forEach(listener => {
                try {
                    this._map.off(eventType, listener);
                } catch (error) {
                    console.warn(`Failed to remove event listener for ${eventType}:`, error);
                }
            });
        });
        
        // Clear all refresh timers
        this._refreshTimers.forEach(timer => clearInterval(timer));
        this._refreshTimers.clear();
        
        // Clear caches
        this._layerCache.clear();
        this._sourceCache.clear();
        
        // Clean up all layer groups
        this._layerGroups.forEach((groupData, groupId) => {
            this.removeLayerGroup(groupId, groupData.config);
        });
        
        this._layerGroups.clear();
        this._eventListeners.clear();
        this._map = null;
    }

    // ===========================================
    // MAP QUERY AND INTERACTION METHODS
    // ===========================================

    /**
     * Query rendered features at a point or within a geometry
     * @param {Array|Object} pointOrGeometry - Point [x, y] or geometry object
     * @param {Object} options - Query options
     * @returns {Array} Array of features
     */
    queryRenderedFeatures(pointOrGeometry, options = {}) {
        return this._map.queryRenderedFeatures(pointOrGeometry, options);
    }

    /**
     * Get current map zoom level
     * @returns {number} Current zoom level
     */
    getZoom() {
        return this._map.getZoom();
    }

    /**
     * Get current map center
     * @returns {LngLat} Current center coordinates
     */
    getCenter() {
        return this._map.getCenter();
    }

    /**
     * Ease map to a location with options
     * @param {Object} options - Ease options (center, zoom, duration, offset, etc.)
     */
    easeTo(options) {
        return this._map.easeTo(options);
    }

    /**
     * Fly to a location with options
     * @param {Object} options - Fly options (center, zoom, duration, etc.)
     */
    flyTo(options) {
        return this._map.flyTo(options);
    }

    // ===========================================
    // MAP STYLE AND LAYER INSPECTION METHODS
    // ===========================================

    /**
     * Get the current map style
     * @returns {Object} Current style object
     */
    getStyle() {
        return this._map.getStyle();
    }

    /**
     * Get a specific layer by ID
     * @param {string} layerId - Layer ID
     * @returns {Object|null} Layer object or null if not found
     */
    getLayer(layerId) {
        return this._map.getLayer(layerId);
    }

    /**
     * Get paint property value for a layer
     * @param {string} layerId - Layer ID
     * @param {string} property - Paint property name
     * @returns {*} Property value
     */
    getPaintProperty(layerId, property) {
        return this._map.getPaintProperty(layerId, property);
    }

    /**
     * Get layout property value for a layer
     * @param {string} layerId - Layer ID
     * @param {string} property - Layout property name
     * @returns {*} Property value
     */
    getLayoutProperty(layerId, property) {
        return this._map.getLayoutProperty(layerId, property);
    }

    /**
     * Set paint property for a layer
     * @param {string} layerId - Layer ID
     * @param {string} property - Paint property name
     * @param {*} value - Property value
     */
    setPaintProperty(layerId, property, value) {
        return this._map.setPaintProperty(layerId, property, value);
    }

    /**
     * Set layout property for a layer
     * @param {string} layerId - Layer ID
     * @param {string} property - Layout property name
     * @param {*} value - Property value
     */
    setLayoutProperty(layerId, property, value) {
        return this._map.setLayoutProperty(layerId, property, value);
    }

    // ===========================================
    // FEATURE STATE MANAGEMENT METHODS
    // ===========================================

    /**
     * Set feature state for a specific feature
     * @param {Object} feature - Feature identifier with source and sourceLayer
     * @param {Object} state - State object to set
     */
    setFeatureState(feature, state) {
        return this._map.setFeatureState(feature, state);
    }

    /**
     * Remove feature state for a specific feature
     * @param {Object} feature - Feature identifier with source and sourceLayer
     * @param {string} stateKey - Optional state key to remove (removes all if not specified)
     */
    removeFeatureState(feature, stateKey = null) {
        if (stateKey) {
            return this._map.removeFeatureState(feature, stateKey);
        } else {
            return this._map.removeFeatureState(feature);
        }
    }

    /**
     * Get feature state for a specific feature
     * @param {Object} feature - Feature identifier with source and sourceLayer
     * @returns {Object} Current feature state
     */
    getFeatureState(feature) {
        return this._map.getFeatureState(feature);
    }

    // ===========================================
    // EVENT HANDLING METHODS
    // ===========================================

    /**
     * Add event listener to the map
     * @param {string} type - Event type
     * @param {Function} listener - Event listener function
     * @param {Object} layerIdOrOptions - Layer ID or options object
     */
    on(type, listener, layerIdOrOptions) {
        // Store the listener for cleanup
        if (!this._eventListeners.has(type)) {
            this._eventListeners.set(type, new Set());
        }
        this._eventListeners.get(type).add(listener);

        if (layerIdOrOptions) {
            return this._map.on(type, layerIdOrOptions, listener);
        } else {
            return this._map.on(type, listener);
        }
    }

    /**
     * Remove event listener from the map
     * @param {string} type - Event type
     * @param {Function} listener - Event listener function
     * @param {Object} layerIdOrOptions - Layer ID or options object
     */
    off(type, listener, layerIdOrOptions) {
        // Remove from our tracking
        if (this._eventListeners.has(type)) {
            this._eventListeners.get(type).delete(listener);
        }

        if (layerIdOrOptions) {
            return this._map.off(type, layerIdOrOptions, listener);
        } else {
            return this._map.off(type, listener);
        }
    }

    /**
     * Add one-time event listener to the map
     * @param {string} type - Event type
     * @param {Function} listener - Event listener function
     * @param {Object} layerIdOrOptions - Layer ID or options object
     */
    once(type, listener, layerIdOrOptions) {
        const wrappedListener = (...args) => {
            // Remove from our tracking when it fires
            if (this._eventListeners.has(type)) {
                this._eventListeners.get(type).delete(wrappedListener);
            }
            return listener(...args);
        };

        // Store the wrapped listener for cleanup
        if (!this._eventListeners.has(type)) {
            this._eventListeners.set(type, new Set());
        }
        this._eventListeners.get(type).add(wrappedListener);

        if (layerIdOrOptions) {
            return this._map.once(type, layerIdOrOptions, wrappedListener);
        } else {
            return this._map.once(type, wrappedListener);
        }
    }

    // ===========================================
    // CONTAINER AND DOM METHODS
    // ===========================================

    /**
     * Get the map container element
     * @returns {HTMLElement} Map container
     */
    getContainer() {
        return this._map.getContainer();
    }

    /**
     * Get the map canvas element
     * @returns {HTMLCanvasElement} Map canvas
     */
    getCanvas() {
        return this._map.getCanvas();
    }

    // ===========================================
    // UTILITY METHODS
    // ===========================================

    /**
     * Check if a layer exists on the map
     * @param {string} layerId - Layer ID to check
     * @returns {boolean} True if layer exists
     */
    hasLayer(layerId) {
        return !!this._map.getLayer(layerId);
    }

    /**
     * Check if a source exists on the map
     * @param {string} sourceId - Source ID to check
     * @returns {boolean} True if source exists
     */
    hasSource(sourceId) {
        return !!this._map.getSource(sourceId);
    }

    /**
     * Get a source by ID
     * @param {string} sourceId - Source ID
     * @returns {Object|null} Source object or null if not found
     */
    getSource(sourceId) {
        return this._map.getSource(sourceId);
    }

    /**
     * Get all layer IDs that match a specific pattern or criteria
     * @param {string|RegExp|Function} matcher - String pattern, RegExp, or function to match layers
     * @returns {Array} Array of matching layer IDs
     */
    getMatchingLayerIds(matcher) {
        const style = this.getStyle();
        if (!style.layers) return [];

        return style.layers
            .filter(layer => {
                if (typeof matcher === 'string') {
                    return layer.id.includes(matcher);
                } else if (matcher instanceof RegExp) {
                    return matcher.test(layer.id);
                } else if (typeof matcher === 'function') {
                    return matcher(layer);
                }
                return false;
            })
            .map(layer => layer.id);
    }

    /**
     * Batch update multiple paint properties for a layer
     * @param {string} layerId - Layer ID
     * @param {Object} properties - Object with property names as keys and values as values
     */
    batchSetPaintProperties(layerId, properties) {
        Object.entries(properties).forEach(([property, value]) => {
            this.setPaintProperty(layerId, property, value);
        });
    }

    /**
     * Batch update multiple layout properties for a layer
     * @param {string} layerId - Layer ID
     * @param {Object} properties - Object with property names as keys and values as values
     */
    batchSetLayoutProperties(layerId, properties) {
        Object.entries(properties).forEach(([property, value]) => {
            this.setLayoutProperty(layerId, property, value);
        });
    }
} 
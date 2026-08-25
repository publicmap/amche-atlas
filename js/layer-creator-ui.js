/**
 * Layer Creator UI and Configuration Generator.
 *
 * File-upload parsing (KML/CSV/GeoJSON pasted or dropped in directly) and the
 * localStorage bridge for inline-data layers live here. URL-based source
 * detection/resolution (paste a link, guess its type, fetch+build a config)
 * lives in js/layer-source-resolver.js instead — see handleURLImport() in
 * js/map-creator.js for how the two are used together.
 */

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
     * Store GeoJSON data in localStorage
     * @param {string} id - Unique identifier for the data
     * @param {Object} geojson - GeoJSON data
     */
    static storeGeoJSONData(id, geojson) {
        try {
            const key = `geojson_${id}`;
            localStorage.setItem(key, JSON.stringify(geojson));
        } catch (error) {
            console.error('Failed to store GeoJSON in localStorage:', error);
            throw new Error('GeoJSON data too large to store locally');
        }
    }

    /**
     * Retrieve GeoJSON data from localStorage
     * @param {string} id - Unique identifier for the data
     * @returns {Object|null} GeoJSON data or null if not found
     */
    static retrieveGeoJSONData(id) {
        try {
            const key = `geojson_${id}`;
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Failed to retrieve GeoJSON from localStorage:', error);
            return null;
        }
    }

    /**
     * Get GeoJSON data for a layer, from localStorage or embedded in config
     * @param {Object} layerConfig - Layer configuration
     * @returns {Object|null} GeoJSON data or null if not available
     */
    static getLayerGeoJSON(layerConfig) {
        if (layerConfig.geojson) {
            return layerConfig.geojson;
        }

        if (layerConfig.dataSource === 'localStorage' && layerConfig.id) {
            return this.retrieveGeoJSONData(layerConfig.id);
        }

        return null;
    }

    /**
     * Handles file upload and converts to GeoJSON
     * @param {File} file - Uploaded file (KML, GeoJSON, or CSV)
     * @returns {Promise<Object>} Layer configuration with GeoJSON reference
     */
    static async handleFileUpload(file) {
        const fileName = file.name;
        const fileExt = fileName.split('.').pop().toLowerCase();

        let geojson = null;
        let fileContent = null;

        if (fileExt === 'geojson' || fileExt === 'json') {
            fileContent = await file.text();
            geojson = JSON.parse(fileContent);
            if (!geojson.type || (geojson.type !== 'FeatureCollection' && geojson.type !== 'Feature')) {
                throw new Error('Invalid GeoJSON file');
            }
            if (geojson.type === 'Feature') {
                geojson = { type: 'FeatureCollection', features: [geojson] };
            }
        } else if (fileExt === 'kml') {
            fileContent = await file.text();
            geojson = await this.parseKML(fileContent);
        } else if (fileExt === 'csv') {
            fileContent = await file.text();
            geojson = await this.parseCSV(fileContent);
        } else {
            throw new Error(`Unsupported file type: ${fileExt}`);
        }

        const cleanTitle = fileName.replace(/\.(geojson|json|kml|csv)$/i, '');
        const layerId = 'upload-' + cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();

        this.storeGeoJSONData(layerId, geojson);

        const bbox = this.calculateBBox(geojson);

        const config = {
            title: cleanTitle,
            type: 'geojson',
            id: layerId,
            dataSource: 'localStorage',
            bbox: bbox,
            initiallyChecked: false,
            inspect: {
                id: "id",
                title: "Name",
                label: "name",
                fields: this.detectGeoJSONFields(geojson),
                fieldTitles: this.detectGeoJSONFields(geojson).map(field =>
                    field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                )
            }
        };

        return config;
    }

    /**
     * Parse KML to GeoJSON
     * @param {string} kmlString - KML file content
     * @returns {Promise<Object>} GeoJSON FeatureCollection
     */
    static async parseKML(kmlString) {
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlString, 'text/xml');

        if (kmlDoc.querySelector('parsererror')) {
            throw new Error('Invalid KML file');
        }

        const features = [];
        const placemarks = kmlDoc.querySelectorAll('Placemark');

        placemarks.forEach(placemark => {
            const feature = this.placemarkToGeoJSON(placemark);
            if (feature) features.push(feature);
        });

        return {
            type: 'FeatureCollection',
            features: features
        };
    }

    /**
     * Convert KML Placemark to GeoJSON Feature
     * @param {Element} placemark - KML Placemark element
     * @returns {Object|null} GeoJSON Feature
     */
    static placemarkToGeoJSON(placemark) {
        const properties = {};
        const nameEl = placemark.querySelector('name');
        const descEl = placemark.querySelector('description');

        if (nameEl) properties.name = nameEl.textContent;
        if (descEl) properties.description = descEl.textContent;

        const extendedData = placemark.querySelectorAll('ExtendedData Data');
        extendedData.forEach(data => {
            const name = data.getAttribute('name');
            const value = data.querySelector('value')?.textContent;
            if (name && value) properties[name] = value;
        });

        let geometry = null;
        const point = placemark.querySelector('Point coordinates');
        const lineString = placemark.querySelector('LineString coordinates');
        const polygon = placemark.querySelector('Polygon outerBoundaryIs LinearRing coordinates');

        if (point) {
            const coords = point.textContent.trim().split(',').map(parseFloat);
            geometry = { type: 'Point', coordinates: [coords[0], coords[1]] };
        } else if (lineString) {
            const coords = lineString.textContent.trim().split(/\s+/).map(coord => {
                const [lng, lat] = coord.split(',').map(parseFloat);
                return [lng, lat];
            });
            geometry = { type: 'LineString', coordinates: coords };
        } else if (polygon) {
            const coords = polygon.textContent.trim().split(/\s+/).map(coord => {
                const [lng, lat] = coord.split(',').map(parseFloat);
                return [lng, lat];
            });
            geometry = { type: 'Polygon', coordinates: [coords] };
        }

        if (!geometry) return null;

        return {
            type: 'Feature',
            properties: properties,
            geometry: geometry
        };
    }

    /**
     * Parse CSV to GeoJSON
     * @param {string} csvString - CSV file content
     * @returns {Promise<Object>} GeoJSON FeatureCollection
     */
    static async parseCSV(csvString) {
        const lines = csvString.split('\n').filter(line => line.trim());
        if (lines.length < 2) throw new Error('CSV file is empty or has no data rows');

        const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));

        const latFields = ['lat', 'latitude', 'y'];
        const lngFields = ['lng', 'lon', 'longitude', 'long', 'x'];

        const latIndex = headers.findIndex(h => latFields.includes(h.toLowerCase()));
        const lngIndex = headers.findIndex(h => lngFields.includes(h.toLowerCase()));

        if (latIndex === -1 || lngIndex === -1) {
            throw new Error('CSV must contain latitude and longitude columns (lat/latitude/y and lng/lon/longitude/long/x)');
        }

        const features = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
            if (values.length !== headers.length) continue;

            const lat = parseFloat(values[latIndex]);
            const lng = parseFloat(values[lngIndex]);

            if (isNaN(lat) || isNaN(lng)) continue;

            const properties = {};
            headers.forEach((header, idx) => {
                if (idx !== latIndex && idx !== lngIndex) {
                    properties[header] = values[idx];
                }
            });

            features.push({
                type: 'Feature',
                properties: properties,
                geometry: {
                    type: 'Point',
                    coordinates: [lng, lat]
                }
            });
        }

        if (features.length === 0) {
            throw new Error('No valid coordinates found in CSV');
        }

        return {
            type: 'FeatureCollection',
            features: features
        };
    }

    /**
     * Detect common fields from GeoJSON features
     * @param {Object} geojson - GeoJSON FeatureCollection
     * @returns {Array<string>} Array of field names
     */
    static detectGeoJSONFields(geojson) {
        if (!geojson.features || geojson.features.length === 0) {
            return ["id", "name", "description"];
        }

        const allFields = new Set();
        geojson.features.slice(0, 10).forEach(feature => {
            if (feature.properties) {
                Object.keys(feature.properties).forEach(key => allFields.add(key));
            }
        });

        const fieldsArray = Array.from(allFields);
        const priorityFields = ['name', 'title', 'description', 'type', 'class', 'category'];
        const sortedFields = fieldsArray.sort((a, b) => {
            const aIndex = priorityFields.indexOf(a.toLowerCase());
            const bIndex = priorityFields.indexOf(b.toLowerCase());
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.localeCompare(b);
        });

        return sortedFields.slice(0, 6);
    }

    /**
     * Calculate bounding box for GeoJSON data
     * @param {Object} geojson - GeoJSON FeatureCollection
     * @returns {Array<number>|null} [minLng, minLat, maxLng, maxLat] or null if no features
     */
    static calculateBBox(geojson) {
        if (!geojson || !geojson.features || geojson.features.length === 0) {
            return null;
        }

        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;

        const processCoordinates = (coords) => {
            if (typeof coords[0] === 'number') {
                minLng = Math.min(minLng, coords[0]);
                maxLng = Math.max(maxLng, coords[0]);
                minLat = Math.min(minLat, coords[1]);
                maxLat = Math.max(maxLat, coords[1]);
            } else {
                coords.forEach(coord => processCoordinates(coord));
            }
        };

        geojson.features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates) {
                processCoordinates(feature.geometry.coordinates);
            }
        });

        if (!isFinite(minLng) || !isFinite(minLat) || !isFinite(maxLng) || !isFinite(maxLat)) {
            return null;
        }

        return [minLng, minLat, maxLng, maxLat];
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


/**
 * Utility classes for data manipulation, geographic conversions, URL handling, and map operations.
 */

export class DataUtils {
    /**
     * Checks if an item is a plain object (not null, not array, not function)
     * @param {*} item - The item to check
     * @returns {boolean} True if the item is a plain object
     */
    static isObject(item) {
        return (item && typeof item === 'object' && !Array.isArray(item));
    }

    /**
     * Performs a deep merge of two objects, recursively merging nested objects
     * @param {Object} target - The target object to merge into
     * @param {Object} source - The source object to merge from
     * @returns {Object} A new object with merged properties
     */
    static deepMerge(target, source) {
        const output = Object.assign({}, target);
        if (this.isObject(target) && this.isObject(source)) {
            Object.keys(source).forEach(key => {
                if (this.isObject(source[key])) {
                    if (!(key in target))
                        Object.assign(output, { [key]: source[key] });
                    else
                        output[key] = this.deepMerge(target[key], source[key]);
                } else {
                    Object.assign(output, { [key]: source[key] });
                }
            });
        }
        return output;
    }

    /**
     * Converts Google Sheets table data to an array of objects
     * @param {Object} tableData - Google Sheets table data
     * @returns {Array} Array of objects with column headers as keys
     */
    static gstableToArray(tableData) {
        const { cols, rows } = tableData;
        const headers = cols.map(col => col.label);
        const result = rows.map(row => {
            const obj = {};
            row.c.forEach((cell, index) => {
                const key = headers[index];
                obj[key] = cell ? cell.v : null;
                if (cell && cell.v && key.toLowerCase().includes('timestamp')) {
                    let timestamp = new Date(...cell.v.match(/\d+/g).map((v, i) => i === 1 ? +v - 1 : +v));
                    timestamp = timestamp.setMonth(timestamp.getMonth() + 1)
                    const now = new Date();
                    const diffTime = Math.abs(now - timestamp);
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                    let daysAgoText;
                    if (diffDays === 0) {
                        daysAgoText = 'Today';
                    } else if (diffDays === 1) {
                        daysAgoText = 'Yesterday';
                    } else {
                        daysAgoText = `${diffDays} days ago`;
                    }
                    obj[`${key}_ago`] = daysAgoText;
                }
            });
            return obj;
        });
        return result;
    }

    /**
     * Parses CSV text into an array of objects with header fields as keys
     * @param {string} csvText - Raw CSV text
     * @returns {Array} Array of objects representing rows
     */
    static parseCSV(csvText) {
        if (!csvText) return [];

        const records = this.parseCSVRecords(csvText);
        if (records.length === 0) return [];

        const headers = records[0];
        let dataStartIndex = 1;

        for (let i = 1; i < records.length; i++) {
            if (records[i].length === headers.length &&
                records[i].every((val, idx) => val.trim() === headers[idx].trim())) {
                dataStartIndex = i + 1;
            } else {
                break;
            }
        }

        const rows = [];
        for (let i = dataStartIndex; i < records.length; i++) {
            const values = records[i];
            if (values.length !== headers.length) continue;
            const row = {};
            headers.forEach((header, index) => {
                row[header.trim()] = values[index];
            });
            rows.push(row);
        }
        return rows;
    }

    static parseCSVRecords(csvText) {
        const records = [];
        let currentRecord = [];
        let currentField = '';
        let inQuotes = false;

        for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const nextChar = i + 1 < csvText.length ? csvText[i + 1] : null;

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    currentField += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                currentRecord.push(currentField);
                currentField = '';
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                if (char === '\r' && nextChar === '\n') {
                    i++;
                }
                if (currentField.length > 0 || currentRecord.length > 0) {
                    currentRecord.push(currentField);
                    if (currentRecord.some(f => f.trim().length > 0)) {
                        records.push(currentRecord);
                    }
                    currentRecord = [];
                    currentField = '';
                }
            } else {
                currentField += char;
            }
        }

        if (currentField.length > 0 || currentRecord.length > 0) {
            currentRecord.push(currentField);
            if (currentRecord.some(f => f.trim().length > 0)) {
                records.push(currentRecord);
            }
        }

        return records;
    }

    /**
     * Parses a single CSV line respecting quoted fields with commas
     * @param {string} line - A single line of CSV text
     * @returns {Array} Array of field values
     */
    static parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    /**
     * Parses a "dirty" JSON string (e.g. from URL) that may have unquoted keys or values
     * @param {string} jsonString - The dirty JSON string
     * @returns {Object|null} The parsed object or null if parsing fails
     */
    static parseDirtyJson(jsonString) {
        if (!jsonString) return null;

        // First try standard JSON parsing
        try {
            return JSON.parse(jsonString);
        } catch (e) {
            // Check if it's a simple unquoted string that failed
            if (!jsonString.startsWith('{') && !jsonString.startsWith('[')) {
                return null;
            }
        }

        try {
            let fixed = jsonString;

            // 1. Replace single quotes with double quotes (handling escaped quotes)
            fixed = fixed.replace(/\\'/g, '\u0001')
                .replace(/'/g, '"')
                .replace(/\u0001/g, "'");

            // 2. Quote unquoted keys
            // Looks for key: that isn't preceded by a quote
            fixed = fixed.replace(/([{,]\s*)([a-zA-Z0-9_\-]+?)\s*:/g, '$1"$2":');

            // 3. Quote unquoted string values
            // Looks for values that are NOT:
            // - true/false/null
            // - numbers
            // - ALREADY quoted strings
            // - objects/arrays ({ or [)
            fixed = fixed.replace(/:\s*(?!(?:true|false|null|[-0-9]|\"|\'|\{|\[))([a-zA-Z0-9_\-\.\/]+?)\s*(?=[,}])/g, ':"$1"');

            return JSON.parse(fixed);
        } catch (error) {
            console.warn('Failed to parse dirty JSON:', jsonString, error);
            return null;
        }
    }
}

export class GeoUtils {
    /**
     * Escapes XML special characters
     * @param {string} unsafe - Unsafe string
     * @returns {string} Safe string
     */
    static escapeXml(unsafe) {
        if (!unsafe) return '';
        return unsafe.toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * Converts a GeoJSON feature to KML format
     * @param {Object} feature - GeoJSON feature object
     * @param {Object} options - Options for KML generation
     * @returns {string} KML document as a string
     */
    static convertToKML(feature, options) {
        const { title, description } = options;
        let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${this.escapeXml(title)}</name>
    <description>${this.escapeXml(description)}</description>
    <Placemark>
      <name>${this.escapeXml(title)}</name>
      <description><![CDATA[`;

        for (const [key, value] of Object.entries(feature.properties)) {
            if (value) {
                kml += `<strong>${this.escapeXml(key)}:</strong> ${this.escapeXml(value)}<br/>`;
            }
        }

        kml += `]]></description>`;

        if (feature.geometry.type === 'Polygon') {
            kml += `
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>`;
            feature.geometry.coordinates[0].forEach(coord => {
                kml += `${coord[0]},${coord[1]},0 `;
            });
            kml += `</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>`;
        }

        kml += `
    </Placemark>
  </Document>
</kml>`;
        return kml;
    }

    /**
     * Converts an array of row objects to GeoJSON features
     * @param {Array} rows - Array of objects with coordinate fields
     * @param {boolean} debug - Enable debug logging
     * @returns {Object} GeoJSON FeatureCollection
     */
    static rowsToGeoJSON(rows, debug = false, explicitLatField = null, explicitLonField = null) {
        if (!rows || rows.length === 0) {
            if (debug) console.warn('No rows provided to rowsToGeoJSON');
            return { type: 'FeatureCollection', features: [] };
        }

        let lonField = explicitLonField;
        let latField = explicitLatField;

        if (!lonField || !latField) {
            const lonPatterns = [
                'lon', 'lng', 'longitude', 'long',
                'x', 'easting',
                'lon_dd', 'lng_dd', 'decimal_longitude',
                'gps_lon', 'gps_lng',
                'geo_lon', 'geo_lng',
                'point_x', 'coord_x'
            ];
            const latPatterns = [
                'lat', 'latitude',
                'y', 'northing',
                'lat_dd', 'decimal_latitude',
                'gps_lat',
                'geo_lat',
                'point_y', 'coord_y'
            ];

            const firstRow = rows[0];
            const matchesPattern = (field, pattern) => {
                const fieldLower = field.trim().toLowerCase();
                const patternLower = pattern.toLowerCase();
                if (fieldLower === patternLower) return 2;
                if (fieldLower.includes(patternLower)) return 1;
                return 0;
            };

            let bestLonScore = 0;
            let bestLatScore = 0;

            for (const field of Object.keys(firstRow)) {
                for (const pattern of lonPatterns) {
                    const score = matchesPattern(field, pattern);
                    if (score > bestLonScore) {
                        bestLonScore = score;
                        lonField = field;
                    }
                }
                for (const pattern of latPatterns) {
                    const score = matchesPattern(field, pattern);
                    if (score > bestLatScore) {
                        bestLatScore = score;
                        latField = field;
                    }
                }
            }

            if (debug) {
                console.log('CSV field detection:', {
                    columns: Object.keys(firstRow),
                    detectedLat: latField,
                    detectedLon: lonField,
                    latScore: bestLatScore,
                    lonScore: bestLonScore
                });
            }
        }

        if (!lonField || !latField) return null;

        const parseCoordinate = (value) => {
            if (value === null || value === undefined || value === '') return NaN;
            if (typeof value === 'number') return value;
            if (typeof value === 'string') {
                value = value.replace(',', '.');
                const match = value.match(/-?\d+(\.\d+)?/);
                if (match) return parseFloat(match[0]);
            }
            return parseFloat(value);
        };

        const parsePropertyValue = (value) => {
            if (value === null || value === undefined || value === '') return value;
            if (typeof value !== 'string') return value;
            if (value.toLowerCase() === 'true') return true;
            if (value.toLowerCase() === 'false') return false;
            if (/^-?\d+$/.test(value)) return parseInt(value, 10);
            if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
            if (/^-?\d+,\d+$/.test(value)) return parseFloat(value.replace(',', '.'));
            return value;
        };

        const features = [];
        rows.forEach((row) => {
            if (!(lonField in row) || !(latField in row)) return;
            const lon = parseCoordinate(row[lonField]);
            const lat = parseCoordinate(row[latField]);
            if (isNaN(lon) || isNaN(lat)) return;
            if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return;

            const parsedProperties = {};
            for (const [key, value] of Object.entries(row)) {
                parsedProperties[key] = parsePropertyValue(value);
            }

            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lon, lat] },
                properties: parsedProperties
            });
        });

        return { type: 'FeatureCollection', features: features };
    }
}

export class URLUtils {
    /**
     * Extracts and parses query parameters from the URL
     * @returns {Object} Object containing query parameters as key-value pairs
     */
    static getQueryParameters() {
        const params = {};
        window.location.search.substring(1).split('&').forEach(param => {
            const [key, value] = param.split('=');
            if (key) params[key] = decodeURIComponent(value || '');
        });
        return params;
    }

    /**
     * Gets a specific URL parameter by name
     * @param {string} name - The name of the parameter to retrieve
     * @returns {string|null} The value of the parameter or null if not found
     */
    static getUrlParameter(name) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    }

    /**
     * Checks if URL needs prettification (has URL-encoded parameters)
     * @returns {boolean} True if the URL contains encoded characters
     */
    static needsURLPrettification() {
        const currentURL = window.location.href;
        return currentURL.includes('%2C') || currentURL.includes('%7B') || currentURL.includes('%7D') || currentURL.includes('%22');
    }

    /**
     * Parses layers from URL parameter, handling JSON objects and legacy formats
     * @param {string} layersParam - The layers parameter string from URL
     * @returns {Array} Array of layer objects or IDs
     */
    static parseLayersFromUrl(layersParam) {
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
                            const parsedLayer = DataUtils.parseDirtyJson(trimmedItem);
                            if (parsedLayer) {
                                // Minify the JSON by removing extra whitespace and use single quotes for storage/URL
                                const minifiedItem = JSON.stringify(parsedLayer).replace(/'/g, "\\'").replace(/"/g, "'");
                                layers.push({ ...parsedLayer, _originalJson: minifiedItem });
                            } else {
                                // If parsing returns null, treat as ID
                                layers.push({ id: trimmedItem });
                            }
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
                    const parsedLayer = DataUtils.parseDirtyJson(trimmedItem);
                    if (parsedLayer) {
                        const minifiedItem = JSON.stringify(parsedLayer).replace(/'/g, "\\'").replace(/"/g, "'");
                        layers.push({ ...parsedLayer, _originalJson: minifiedItem });
                    } else {
                        layers.push({ id: trimmedItem });
                    }
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
}

export class MapUtils {
    // Cache for parsed geometries and bboxes (cleared on layer updates)
    static _geometryCache = new Map(); // layerId -> { bbox, geojson, lastUpdated }

    /**
     * Clear the geometry cache (call when layers are updated)
     */
    static clearGeometryCache() {
        this._geometryCache.clear();
    }

    /**
     * Get or create cached geometry data for a layer
     * @private
     */
    static _getCachedGeometry(layer) {
        const layerId = layer.id;

        // Check cache first
        if (this._geometryCache.has(layerId)) {
            return this._geometryCache.get(layerId);
        }

        // Parse and cache geometry data
        const cached = {
            bbox: this.parseBbox(layer.bbox),
            geojson: null,
            hasGeojson: false
        };

        // Check if layer has geojson
        if (layer.geojson) {
            cached.hasGeojson = true;
            // Don't parse geojson yet - do it lazily when needed
            cached.geojsonRaw = layer.geojson;
        } else if (layer.data && typeof layer.data === 'object' && layer.data.type === 'FeatureCollection') {
            cached.hasGeojson = true;
            cached.geojson = layer.data;
        }

        this._geometryCache.set(layerId, cached);
        return cached;
    }

    /**
     * Converts longitude and latitude coordinates to Web Mercator projection
     * @param {number} lng - Longitude coordinate
     * @param {number} lat - Latitude coordinate
     * @returns {Object} Object with x and y coordinates in Web Mercator
     */
    static convertToWebMercator(lng, lat) {
        const x = (lng * 20037508.34) / 180;
        let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
        y = (y * 20037508.34) / 180;
        return { x, y };
    }

    /**
     * Fetches TileJSON from a URL
     * @param {string} url - TileJSON URL or tile template
     * @returns {Promise<Object|null>} TileJSON object or null
     */
    static async fetchTileJSON(url) {
        try {
            let tileJSONUrl = url;
            let isApiMain = false;

            if (url.includes('api-main')) {
                isApiMain = true;
                const urlObj = new URL(url);
                const mapId = urlObj.searchParams.get('map_id');
                if (mapId) {
                    const baseUrl = url.split('/tiler/')[0];
                    tileJSONUrl = `${baseUrl}/maps/${mapId}/layer_info`;
                }
            } else if (url.includes('{z}')) {
                tileJSONUrl = url.split('/{z}')[0];
                if (!tileJSONUrl.endsWith('.json')) tileJSONUrl += '/tiles.json';
            } else if (url.startsWith('mapbox://')) {
                const tilesetId = url.replace('mapbox://', '');
                tileJSONUrl = `https://api.mapbox.com/v4/${tilesetId}.json?access_token=${mapboxgl.accessToken}`;
            }

            const response = await fetch(tileJSONUrl);
            if (!response.ok) throw new Error('Failed to fetch TileJSON');
            const tileJSON = await response.json();

            if (isApiMain && tileJSON && 'max_zoom' in tileJSON) {
                tileJSON.maxzoom = tileJSON.max_zoom;
                delete tileJSON.max_zoom;
            }
            return tileJSON;
        } catch (error) {
            console.warn('Failed to fetch TileJSON:', error);
            return null;
        }
    }

    /**
     * Gets list of available configuration files
     * @returns {Promise<string>} Comma-separated list of config names
     */
    static async getAvailableConfigs() {
        // Return a list of known config files based on the file structure
        // This could be made dynamic by fetching a directory listing in the future
        return ['index', 'maharashtra', 'community', 'historic', 'bombay', 'mumbai', 'madras', 'gurugram'].join(', ');
    }

    /**
     * Parse bbox from various formats (string, array) to [west, south, east, north] array
     * @param {string|Array} bbox - Bounding box as string "w,s,e,n" or array [w,s,e,n]
     * @returns {Array|null} Parsed bbox as [west, south, east, north] or null if invalid
     */
    static parseBbox(bbox) {
        if (!bbox) return null;

        let parsed;
        if (typeof bbox === 'string') {
            parsed = bbox.split(',').map(parseFloat);
        } else if (Array.isArray(bbox)) {
            parsed = bbox;
        } else {
            return null;
        }

        if (parsed.length !== 4 || parsed.some(isNaN)) return null;
        return parsed;
    }

    /**
     * Check if a layer's bbox intersects with given bounds
     * Optimized two-stage approach: bbox check first, then geojson if needed
     * @param {Object} layer - Layer object with bbox and/or geojson property
     * @param {Array} bounds - Current map bounds [west, south, east, north]
     * @param {boolean} usePreciseCheck - If true, use geojson for precise check when available
     * @returns {boolean} True if layer is in view (or has no bbox), false otherwise
     */
    static isLayerInView(layer, bounds, usePreciseCheck = true) {
        if (!bounds) return true;

        // Get cached geometry data
        const cached = this._getCachedGeometry(layer);

        // Stage 1: Fast bbox rejection test
        if (cached.bbox) {
            const [layerW, layerS, layerE, layerN] = cached.bbox;
            const [boundsW, boundsS, boundsE, boundsN] = bounds;

            // Quick rejection: no intersection at all
            if (layerE < boundsW || layerW > boundsE ||
                layerN < boundsS || layerS > boundsN) {
                return false;
            }

            // Quick acceptance: layer bbox completely contains view bounds
            if (layerW <= boundsW && layerE >= boundsE &&
                layerS <= boundsS && layerN >= boundsN) {
                return true;
            }

            // If no geojson or precise check disabled, accept bbox intersection
            if (!cached.hasGeojson || !usePreciseCheck) {
                return true;
            }
        } else if (!cached.hasGeojson) {
            // No bbox and no geojson - assume it's in view
            return true;
        }

        // Stage 2: Precise geojson intersection (only if Turf.js available)
        if (cached.hasGeojson && typeof turf !== 'undefined') {
            try {
                // Parse geojson if not already parsed
                if (!cached.geojson && cached.geojsonRaw) {
                    if (typeof cached.geojsonRaw === 'string') {
                        cached.geojson = JSON.parse(cached.geojsonRaw);
                    } else {
                        cached.geojson = cached.geojsonRaw;
                    }
                }

                if (cached.geojson) {
                    const boundsPolygon = turf.bboxPolygon(bounds);

                    // Handle FeatureCollection
                    if (cached.geojson.type === 'FeatureCollection') {
                        // Check if any feature intersects
                        for (const feature of cached.geojson.features) {
                            if (turf.booleanIntersects(feature, boundsPolygon)) {
                                return true;
                            }
                        }
                        return false;
                    }

                    // Handle single Feature or Geometry
                    return turf.booleanIntersects(cached.geojson, boundsPolygon);
                }
            } catch (e) {
                // Fall back to bbox result if geojson check fails
                console.warn('GeoJSON intersection check failed:', e);
            }
        }

        // Default: if bbox intersected, accept it
        return cached.bbox ? true : true;
    }

    /**
     * Calculate the area of a bounding box
     * @param {string|Array} bbox - Bounding box as string or array
     * @returns {number} Area in square meters (if Turf available) or square degrees, or Infinity if invalid
     */
    static calculateBboxArea(bbox) {
        const parsed = this.parseBbox(bbox);
        if (!parsed) return Infinity;

        // Use Turf.js for accurate area calculation in square meters
        if (typeof turf !== 'undefined') {
            try {
                const polygon = turf.bboxPolygon(parsed);
                return turf.area(polygon); // Returns area in square meters
            } catch (e) {
                // Fall back to simple calculation
            }
        }

        // Fallback: simple calculation in square degrees
        const [west, south, east, north] = parsed;
        const width = east - west;
        const height = north - south;
        return width * height;
    }

    /**
     * Calculate distance from bbox center to a reference point
     * @param {string|Array} bbox - Bounding box as string or array
     * @param {number} refLng - Reference longitude
     * @param {number} refLat - Reference latitude
     * @returns {number} Distance in kilometers (if Turf available) or Euclidean distance in degrees, or Infinity if invalid
     */
    static calculateBboxDistance(bbox, refLng, refLat) {
        const parsed = this.parseBbox(bbox);
        if (!parsed) return Infinity;

        const [west, south, east, north] = parsed;
        const centerLng = (west + east) / 2;
        const centerLat = (south + north) / 2;

        // Use Turf.js for accurate geodesic distance calculation
        if (typeof turf !== 'undefined') {
            try {
                const from = turf.point([refLng, refLat]);
                const to = turf.point([centerLng, centerLat]);
                return turf.distance(from, to); // Returns distance in kilometers
            } catch (e) {
                // Fall back to simple calculation
            }
        }

        // Fallback: simple Euclidean distance in degrees
        const dx = centerLng - refLng;
        const dy = centerLat - refLat;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Get the center point of a bounding box
     * @param {string|Array} bbox - Bounding box as string or array
     * @returns {Object|null} Object with lng and lat properties, or null if invalid
     */
    static getBboxCenter(bbox) {
        const parsed = this.parseBbox(bbox);
        if (!parsed) return null;

        // Use Turf.js for accurate centroid calculation
        if (typeof turf !== 'undefined') {
            try {
                const polygon = turf.bboxPolygon(parsed);
                const center = turf.center(polygon);
                return {
                    lng: center.geometry.coordinates[0],
                    lat: center.geometry.coordinates[1]
                };
            } catch (e) {
                // Fall back to simple calculation
            }
        }

        // Fallback: simple midpoint calculation
        const [west, south, east, north] = parsed;
        return {
            lng: (west + east) / 2,
            lat: (south + north) / 2
        };
    }

    /**
     * Check if a layer is a global/world layer based on bbox and metadata
     * @param {Object} layer - Layer object
     * @param {Object} atlasData - Atlas metadata object (optional)
     * @returns {boolean} True if layer is global
     */
    static isGlobalLayer(layer, atlasData = null) {
        // Check atlas name for global indicators
        const atlasName = (atlasData?.name || layer._sourceAtlas || '').toLowerCase();
        if (atlasName.includes('world') || atlasName.includes('global') ||
            atlasName.includes('mapbox') || atlasName.includes('osm')) {
            return true;
        }

        // Check if layer type is a Mapbox style layer
        if (layer.type === 'style' || layer.type === 'raster-style-layer') {
            return true;
        }

        // Check if layer ID suggests it's global
        const layerId = (layer.id || '').toLowerCase();
        if (layerId.startsWith('mapbox-') || layerId.startsWith('osm-') ||
            layerId.includes('world-') || layerId.includes('global-')) {
            return true;
        }

        // Check if bbox covers entire world
        if (layer.bbox) {
            const parsed = this.parseBbox(layer.bbox);
            if (parsed) {
                const [west, south, east, north] = parsed;
                if (west <= -170 && east >= 170 && south <= -80 && north >= 80) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Initialize slot layers for proper layer ordering
     * Slots provide well-defined insertion points in the style's layer stack
     * Reference: https://docs.mapbox.com/style-spec/reference/slots/
     * @param {mapboxgl.Map} map - The Mapbox map instance
     */
    static initializeSlotLayers(map) {
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
}

export class StyleUtils {
    /**
     * Converts a layer style configuration into a human-readable legend format
     * @param {Object} style - The style configuration object
     * @returns {Object} Grouped legend items
     */
    static convertStyleToLegend(style) {
        if (!style) return {};

        const legend = [];
        const formatPropertyName = (prop) => prop.replace(/([A-Z])/g, ' $1').replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase()).trim();
        const formatColorValue = (value) => (typeof value === 'string' ? { type: 'color', value } : { type: 'expression', value: JSON.stringify(value, null, 2) });
        const formatNumericValue = (value) => (typeof value === 'number' ? { type: 'number', value } : { type: 'expression', value: JSON.stringify(value, null, 2) });

        const styleProperties = {
            'fill-color': { category: 'Fill', format: formatColorValue },
            'fill-opacity': { category: 'Fill', format: formatNumericValue },
            'line-color': { category: 'Line', format: formatColorValue },
            'line-width': { category: 'Line', format: formatNumericValue },
            'line-opacity': { category: 'Line', format: formatNumericValue },
            'line-dasharray': { category: 'Line', format: (value) => ({ type: 'dash-pattern', value: Array.isArray(value) ? value : JSON.stringify(value) }) },
            'text-field': { category: 'Text', format: (value) => ({ type: 'text', value: typeof value === 'string' ? value : JSON.stringify(value) }) },
            'text-size': { category: 'Text', format: formatNumericValue },
            'text-color': { category: 'Text', format: formatColorValue },
            'text-halo-color': { category: 'Text', format: formatColorValue },
            'text-halo-width': { category: 'Text', format: formatNumericValue },
            'text-font': { category: 'Text', format: (value) => ({ type: 'font', value: Array.isArray(value) ? value.join(', ') : value }) },
            'text-transform': { category: 'Text', format: (value) => ({ type: 'text', value }) },
            'circle-radius': { category: 'Circle', format: formatNumericValue },
            'circle-color': { category: 'Circle', format: formatColorValue },
            'circle-opacity': { category: 'Circle', format: formatNumericValue },
            'circle-stroke-width': { category: 'Circle', format: formatNumericValue },
            'circle-stroke-color': { category: 'Circle', format: formatColorValue }
        };

        for (const [prop, value] of Object.entries(style)) {
            if (styleProperties[prop]) {
                const { category, format } = styleProperties[prop];
                legend.push({ category, property: formatPropertyName(prop), ...format(value) });
            }
        }

        return legend.reduce((acc, item) => {
            if (!acc[item.category]) acc[item.category] = [];
            acc[item.category].push(item);
            return acc;
        }, {});
    }
}

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
        const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length === 0) return [];

        let headerLine = lines[0];
        let dataStartIndex = 1;
        const headers = this.parseCSVLine(headerLine);

        for (let i = 1; i < lines.length; i++) {
            const currentLine = this.parseCSVLine(lines[i]);
            if (currentLine.length === headers.length &&
                currentLine.every((val, idx) => val.trim() === headers[idx].trim())) {
                dataStartIndex = i + 1;
            } else {
                break;
            }
        }

        const rows = [];
        for (let i = dataStartIndex; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length !== headers.length) continue;
            const row = {};
            headers.forEach((header, index) => {
                row[header.trim()] = values[index];
            });
            rows.push(row);
        }
        return rows;
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
    static rowsToGeoJSON(rows, debug = false) {
        if (!rows || rows.length === 0) {
            if (debug) console.warn('No rows provided to rowsToGeoJSON');
            return { type: 'FeatureCollection', features: [] };
        }

        const lonPatterns = ['lon', 'lng', 'longitude', 'x', 'long'];
        const latPatterns = ['lat', 'latitude', 'y'];
        let lonField = null;
        let latField = null;

        const firstRow = rows[0];
        const matchesPattern = (field, pattern) => {
            const fieldLower = field.toLowerCase();
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

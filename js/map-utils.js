/**
 * Checks if an item is a plain object (not null, not array, not function)
 * @param {*} item - The item to check
 * @returns {boolean} True if the item is a plain object
 */
export function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

/**
 * Performs a deep merge of two objects, recursively merging nested objects
 * @param {Object} target - The target object to merge into
 * @param {Object} source - The source object to merge from
 * @returns {Object} A new object with merged properties
 */
export function deepMerge(target, source) {
    const output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target))
                    Object.assign(output, {[key]: source[key]});
                else
                    output[key] = deepMerge(target[key], source[key]);
            } else {
                Object.assign(output, {[key]: source[key]});
            }
        });
    }
    return output;
}

/**
 * Converts a GeoJSON feature to KML format
 * @param {Object} feature - GeoJSON feature object
 * @param {Object} options - Options for KML generation
 * @param {string} options.title - Title for the KML document and placemark
 * @param {string} options.description - Description for the KML document
 * @returns {string} KML document as a string
 */
function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export function convertToKML(feature, options) {
    const {title, description} = options;

    // Start KML document with escaped values
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(title)}</name>
    <description>${escapeXml(description)}</description>
    <Placemark>
      <name>${escapeXml(title)}</name>
      <description><![CDATA[`;

    // Add properties as description
    for (const [key, value] of Object.entries(feature.properties)) {
        if (value) {
            kml += `<strong>${escapeXml(key)}:</strong> ${escapeXml(value)}<br/>`;
        }
    }

    kml += `]]></description>`;

    // Add geometry
    if (feature.geometry.type === 'Polygon') {
        kml += `
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>`;

        // Add coordinates (KML uses lon,lat,alt format)
        feature.geometry.coordinates[0].forEach(coord => {
            kml += `${coord[0]},${coord[1]},0 `;
        });

        kml += `</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>`;
    }

    // Close KML document
    kml += `
    </Placemark>
  </Document>
</kml>`;

    return kml;
}

/**
 * Converts Google Sheets table data to an array of objects
 * @param {Object} tableData - Google Sheets table data
 * @returns {Array} Array of objects with column headers as keys
 */
export function gstableToArray(tableData) {
    const {cols, rows} = tableData;
    const headers = cols.map(col => col.label);
    const result = rows.map(row => {
        const obj = {};
        row.c.forEach((cell, index) => {
            const key = headers[index];
            // Check if this is a timestamp column and has a value
            obj[key] = cell ? cell.v : null;
            if (cell && cell.v && key.toLowerCase().includes('timestamp')) {
                let timestamp = new Date(...cell.v.match(/\d+/g).map((v, i) => i === 1 ? +v - 1 : +v));
                timestamp = timestamp.setMonth(timestamp.getMonth() + 1)
                const now = new Date();
                const diffTime = Math.abs(now - timestamp);
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                // Create a human-readable "days ago" string
                let daysAgoText;
                if (diffDays === 0) {
                    daysAgoText = 'Today';
                } else if (diffDays === 1) {
                    daysAgoText = 'Yesterday';
                } else {
                    daysAgoText = `${diffDays} days ago`;
                }
                // Add the days ago text as a new field
                obj[`${key}_ago`] = daysAgoText;
            }
        });
        return obj;
    });
    return result;
}

/**
 * Extracts and parses query parameters from the URL
 * @returns {Object} Object containing query parameters as key-value pairs
 */
export function getQueryParameters() {
    const params = {};
    window.location.search.substring(1).split('&').forEach(param => {
        const [key, value] = param.split('=');
        if (key) params[key] = decodeURIComponent(value || '');
    });
    return params;
}

/**
 * Converts longitude and latitude coordinates to Web Mercator projection
 * @param {number} lng - Longitude coordinate
 * @param {number} lat - Latitude coordinate
 * @returns {Object} Object with x and y coordinates in Web Mercator
 */
export function convertToWebMercator(lng, lat) {
    const x = (lng * 20037508.34) / 180;
    let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
    y = (y * 20037508.34) / 180;
    return {x, y};
}

/**
 * Converts a layer style configuration into a human-readable legend format
 * @param {Object} style - The style configuration object
 * @returns {Array} Array of style properties with readable descriptions
 */
export function convertStyleToLegend(style) {
    if (!style) return [];

    const legend = [];

    // Helper function to convert camelCase/kebab-case to Title Case
    const formatPropertyName = (prop) => {
        return prop
            .replace(/([A-Z])/g, ' $1') // Convert camelCase
            .replace(/-/g, ' ') // Convert kebab-case
            .replace(/^\w/, c => c.toUpperCase()) // Capitalize first letter
            .trim();
    };

    // Helper function to format color values
    const formatColorValue = (value) => {
        if (typeof value === 'string') {
            return {
                type: 'color',
                value: value
            };
        }
        return {
            type: 'expression',
            value: JSON.stringify(value, null, 2)
        };
    };

    // Helper function to format numeric values
    const formatNumericValue = (value) => {
        if (typeof value === 'number') {
            return {
                type: 'number',
                value: value
            };
        }
        return {
            type: 'expression',
            value: JSON.stringify(value, null, 2)
        };
    };

    // Process common style properties
    const styleProperties = {
        // Fill properties
        'fill-color': {
            category: 'Fill',
            format: formatColorValue
        },
        'fill-opacity': {
            category: 'Fill',
            format: formatNumericValue
        },

        // Line properties
        'line-color': {
            category: 'Line',
            format: formatColorValue
        },
        'line-width': {
            category: 'Line',
            format: formatNumericValue
        },
        'line-opacity': {
            category: 'Line',
            format: formatNumericValue
        },
        'line-dasharray': {
            category: 'Line',
            format: (value) => ({
                type: 'dash-pattern',
                value: Array.isArray(value) ? value : JSON.stringify(value)
            })
        },

        // Text properties
        'text-field': {
            category: 'Text',
            format: (value) => ({
                type: 'text',
                value: typeof value === 'string' ? value : JSON.stringify(value)
            })
        },
        'text-size': {
            category: 'Text',
            format: formatNumericValue
        },
        'text-color': {
            category: 'Text',
            format: formatColorValue
        },
        'text-halo-color': {
            category: 'Text',
            format: formatColorValue
        },
        'text-halo-width': {
            category: 'Text',
            format: formatNumericValue
        },
        'text-font': {
            category: 'Text',
            format: (value) => ({
                type: 'font',
                value: Array.isArray(value) ? value.join(', ') : value
            })
        },
        'text-transform': {
            category: 'Text',
            format: (value) => ({
                type: 'text',
                value: value
            })
        },

        // Circle properties
        'circle-radius': {
            category: 'Circle',
            format: formatNumericValue
        },
        'circle-color': {
            category: 'Circle',
            format: formatColorValue
        },
        'circle-opacity': {
            category: 'Circle',
            format: formatNumericValue
        },
        'circle-stroke-width': {
            category: 'Circle',
            format: formatNumericValue
        },
        'circle-stroke-color': {
            category: 'Circle',
            format: formatColorValue
        }
    };

    // Process each style property
    for (const [prop, value] of Object.entries(style)) {
        if (styleProperties[prop]) {
            const {category, format} = styleProperties[prop];
            const formattedValue = format(value);

            legend.push({
                category,
                property: formatPropertyName(prop),
                ...formattedValue
            });
        }
    }

    // Group by category
    const groupedLegend = legend.reduce((acc, item) => {
        if (!acc[item.category]) {
            acc[item.category] = [];
        }
        acc[item.category].push(item);
        return acc;
    }, {});

    return groupedLegend;
}

/**
 * Converts an array of row objects to GeoJSON features
 * @param {Array} rows - Array of objects with coordinate fields
 * @param {boolean} debug - Enable debug logging (default: false)
 * @returns {Object} GeoJSON FeatureCollection
 */
export function rowsToGeoJSON(rows, debug = false) {
    if (!rows || rows.length === 0) {
        if (debug) console.warn('No rows provided to rowsToGeoJSON');
        return {
            type: 'FeatureCollection',
            features: []
        };
    }

    // Coordinate field name patterns to look for
    const lonPatterns = ['lon', 'lng', 'longitude', 'x', 'long'];
    const latPatterns = ['lat', 'latitude', 'y'];

    // Find coordinate field names
    let lonField = null;
    let latField = null;

    const firstRow = rows[0];
    if (debug) console.log('Available fields for GeoJSON conversion:', Object.keys(firstRow).join(', '));

    // Helper function to check if a field matches a pattern
    const matchesPattern = (field, pattern) => {
        const fieldLower = field.toLowerCase();
        const patternLower = pattern.toLowerCase();

        // First try exact match
        if (fieldLower === patternLower) {
            if (debug) console.log(`Found exact match for "${pattern}": ${field}`);
            return 2; // Higher score for exact match
        }

        // Then try contains match
        if (fieldLower.includes(patternLower)) {
            if (debug) console.log(`Found partial match for "${pattern}": ${field}`);
            return 1; // Lower score for partial match
        }

        return 0; // No match
    };

    // Find best matching fields
    let bestLonScore = 0;
    let bestLatScore = 0;

    for (const field of Object.keys(firstRow)) {
        // Check longitude patterns
        for (const pattern of lonPatterns) {
            const score = matchesPattern(field, pattern);
            if (score > bestLonScore) {
                bestLonScore = score;
                lonField = field;
            }
        }

        // Check latitude patterns
        for (const pattern of latPatterns) {
            const score = matchesPattern(field, pattern);
            if (score > bestLatScore) {
                bestLatScore = score;
                latField = field;
            }
        }
    }

    if (debug) console.log(`Selected coordinate fields - Longitude: "${lonField}" (score: ${bestLonScore}), Latitude: "${latField}" (score: ${bestLatScore})`);

    if (!lonField || !latField) {
        if (debug) {
            console.warn('Could not find coordinate fields in the data. Available fields:', Object.keys(firstRow));
            console.warn('Looking for longitude patterns:', lonPatterns.join(', '));
            console.warn('Looking for latitude patterns:', latPatterns.join(', '));
        }
        return null;
    }

    // Validate that we found the correct fields by checking first row values
    const sampleLon = firstRow[lonField];
    const sampleLat = firstRow[latField];
    if (debug) console.log(`Validating coordinate fields - Longitude: ${sampleLon}, Latitude: ${sampleLat}`);

    // Basic validation of coordinate values
    const parsedLon = parseFloat(sampleLon);
    const parsedLat = parseFloat(sampleLat);
    if (isNaN(parsedLon) || isNaN(parsedLat) ||
        parsedLon < -180 || parsedLon > 180 ||
        parsedLat < -90 || parsedLat > 90) {
        if (debug) {
            console.error('Invalid coordinate values in first row:', {
                [lonField]: sampleLon,
                [latField]: sampleLat,
                parsed: {lon: parsedLon, lat: parsedLat}
            });
        }
        return null;
    }

    // Helper function to parse coordinates correctly
    const parseCoordinate = (value) => {
        if (value === null || value === undefined || value === '') {
            return NaN;
        }

        if (typeof value === 'number') {
            return value;
        }

        // Handle string values
        if (typeof value === 'string') {
            // Replace any commas with periods (for European number format)
            value = value.replace(',', '.');
            // Extract the first number if there's extra text
            const match = value.match(/-?\d+(\.\d+)?/);
            if (match) {
                return parseFloat(match[0]);
            }
        }

        return parseFloat(value);
    };

    // Helper function to detect and parse property values
    const parsePropertyValue = (value) => {
        if (value === null || value === undefined || value === '') {
            return value;
        }

        // Already a non-string type
        if (typeof value !== 'string') {
            return value;
        }

        // Check for boolean values
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;

        // Check for integer
        if (/^-?\d+$/.test(value)) {
            return parseInt(value, 10);
        }

        // Check for float
        if (/^-?\d+\.\d+$/.test(value)) {
            return parseFloat(value);
        }

        // Handle European number format (comma as decimal separator)
        if (/^-?\d+,\d+$/.test(value)) {
            return parseFloat(value.replace(',', '.'));
        }

        // Return original string if no numeric pattern detected
        return value;
    };

    // Convert rows to GeoJSON features
    const features = [];
    let validCount = 0;
    let invalidCount = 0;

    rows.forEach((row, index) => {
        // Check if coordinate fields exist in this row
        if (!(lonField in row) || !(latField in row)) {
            if (debug) console.warn(`Row ${index} is missing coordinate fields (${lonField}, ${latField})`);
            invalidCount++;
            return;
        }

        const lon = parseCoordinate(row[lonField]);
        const lat = parseCoordinate(row[latField]);

        // Skip invalid or missing coordinates
        if (isNaN(lon) || isNaN(lat)) {
            invalidCount++;
            if (debug && invalidCount <= 5) {
                console.warn(`Invalid coordinates at row ${index}:`, {
                    [lonField]: row[lonField],
                    [latField]: row[latField],
                    parsed: {lon, lat}
                });
            }
            return;
        }

        // Skip obviously invalid coordinates
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
            invalidCount++;
            if (debug && invalidCount <= 5) {
                console.warn(`Out of range coordinates at row ${index}:`, {lon, lat});
            }
            return;
        }

        // Parse property values to appropriate types
        const parsedProperties = {};
        for (const [key, value] of Object.entries(row)) {
            parsedProperties[key] = parsePropertyValue(value);
        }

        validCount++;
        features.push({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [lon, lat]
            },
            properties: parsedProperties
        });
    });

    if (debug) console.log(`GeoJSON conversion results: ${validCount} valid features, ${invalidCount} invalid coordinates skipped`);

    if (validCount === 0 && rows.length > 0) {
        if (debug) {
            console.error('Failed to generate any valid GeoJSON features despite having input rows');
            console.log('First row for debugging:', rows[0]);
            console.log(`Longitude field (${lonField})`, rows[0][lonField], typeof rows[0][lonField]);
            console.log(`Latitude field (${latField})`, rows[0][latField], typeof rows[0][latField]);
        }
    }

    return {
        type: 'FeatureCollection',
        features: features
    };
}

/**
 * Parses CSV text into an array of objects with header fields as keys
 * @param {string} csvText - Raw CSV text
 * @returns {Array} Array of objects representing rows
 */
export function parseCSV(csvText) {
    if (!csvText) return [];

    // Split into lines and remove empty lines
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    // Find the first header line
    // Some CSV APIs may include duplicate headers, so we need to find the first one
    let headerLine = lines[0];
    let dataStartIndex = 1;

    // Parse the header fields
    const headers = parseCSVLine(headerLine);

    // Handle cases where the same header appears multiple times
    for (let i = 1; i < lines.length; i++) {
        const currentLine = parseCSVLine(lines[i]);
        // If this line has the same fields as the header, it's a duplicate header
        if (currentLine.length === headers.length &&
            currentLine.every((val, idx) => val.trim() === headers[idx].trim())) {
            dataStartIndex = i + 1;
        } else {
            break;
        }
    }

    // Parse data rows
    const rows = [];
    for (let i = dataStartIndex; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);

        // Skip rows with incorrect number of fields
        if (values.length !== headers.length) continue;

        // Create object with header keys and row values
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
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            // Handle escaped quotes
            if (i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // End of field
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    // Add the last field
    result.push(current);

    return result;
}

export async function fetchTileJSON(url) {
    try {
        // Handle different URL formats
        let tileJSONUrl = url;
        let isApiMain = false;

        // Handle maphub.co API URLs
        if (url.includes('api-main')) {
            isApiMain = true;
            // Extract map_id from URL if present
            const urlObj = new URL(url);
            const mapId = urlObj.searchParams.get('map_id');

            if (mapId) {
                // Construct the layer_info endpoint
                const baseUrl = url.split('/tiler/')[0];
                tileJSONUrl = `${baseUrl}/maps/${mapId}/layer_info`;
            }
        }
        // If it's a tile template URL, try to convert to TileJSON URL
        else if (url.includes('{z}')) {
            // Remove the template parameters and try common TileJSON paths
            tileJSONUrl = url.split('/{z}')[0];
            if (!tileJSONUrl.endsWith('.json')) {
                tileJSONUrl += '/tiles.json';
            }
        }
        // For Mapbox hosted tilesets
        else if (url.startsWith('mapbox://')) {
            const tilesetId = url.replace('mapbox://', '');
            tileJSONUrl = `https://api.mapbox.com/v4/${tilesetId}.json?access_token=${mapboxgl.accessToken}`;
        }

        const response = await fetch(tileJSONUrl);
        if (!response.ok) throw new Error('Failed to fetch TileJSON');
        const tileJSON = await response.json();

        // Transform TileJSON for api-main URLs
        if (isApiMain && tileJSON) {
            // Rename max_zoom to maxzoom if it exists
            if ('max_zoom' in tileJSON) {
                tileJSON.maxzoom = tileJSON.max_zoom;
                delete tileJSON.max_zoom;
            }
        }

        return tileJSON;
    } catch (error) {
        console.warn('Failed to fetch TileJSON:', error);
        return null;
    }
} 
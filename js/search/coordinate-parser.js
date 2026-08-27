/**
 * Coordinate / map-URL parsing, extracted from map-search-control.js.
 * Pure functions, no map or DOM dependency.
 */

const INDIA_COORDINATE_BOUNDS = { latMin: 6, latMax: 37, lngMin: 68, lngMax: 97 }

/**
 * Parse coordinate string in various formats
 * Supports:
 * - Decimal degrees: "15.4921, 73.8435" or "73.8435, 15.4921"
 * - Space separated: "15.4921 73.8435" or "73.8435 15.4921"
 * - DMS: "15°29'31.5\"N 73°50'36.5\"E"
 * - URLs from OSM, Google Maps, and other mapping services
 * Note: Shortened URLs (maps.app.goo.gl) are not supported - open them in a browser and copy the full URL
 * @param {string} input - Input string to parse
 * @returns {Object|null} Object with {lat, lng, format} or null if not parseable
 */
export function parseCoordinateInput(input) {
    if (!input || typeof input !== 'string') {
        return null
    }

    input = input.trim()

    return parseMapURL(input) || parseDMS(input) || parseDecimalDegrees(input)
}

/**
 * Parse mapping service URLs using regex patterns
 * Works with any mapping service that uses standard coordinate URL formats
 * Note: Shortened URLs (goo.gl) require JavaScript and cannot be parsed
 * @param {string} url - URL string
 * @returns {Object|null} Coordinate object or null
 */
function parseMapURL(url) {
    try {
        const patterns = [
            {
                regex: /#map=([\d.]+)\/([-\d.]+)\/([-\d.]+)/,
                latIndex: 2,
                lngIndex: 3,
                name: 'Hash map format'
            },
            {
                regex: /#([\d.]+)\/([-\d.]+)\/([-\d.]+)/,
                latIndex: 2,
                lngIndex: 3,
                name: 'Hash zoom/lat/lng format'
            },
            {
                regex: /@([-\d.]+),([-\d.]+),[\d.]+[mz]/,
                latIndex: 1,
                lngIndex: 2,
                name: 'Google Maps @ format'
            },
            {
                regex: /ll=([-\d.]+),([-\d.]+)/,
                latIndex: 1,
                lngIndex: 2,
                name: 'LL parameter format'
            },
            {
                regex: /\?lat=([-\d.]+)&lon=([-\d.]+)/,
                latIndex: 1,
                lngIndex: 2,
                name: 'Query param lat/lon format'
            },
            {
                regex: /\?lon=([-\d.]+)&lat=([-\d.]+)/,
                latIndex: 2,
                lngIndex: 1,
                name: 'Query param lon/lat format'
            }
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern.regex);
            if (match) {
                const lat = parseFloat(match[pattern.latIndex]);
                const lng = parseFloat(match[pattern.lngIndex]);

                if (!isNaN(lat) && !isNaN(lng) && isValidCoordinate(lat, lng)) {
                    const hostname = extractHostname(url);
                    const displayName = hostname ? `${hostname} URL (${pattern.name})` : `Map URL (${pattern.name})`;
                    return { lat, lng, format: displayName };
                }
            }
        }
    } catch (error) {
    }
    return null;
}

/**
 * Extract hostname from URL for display purposes
 * @param {string} url - URL string
 * @returns {string|null} Hostname or null
 */
function extractHostname(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch (error) {
        return null;
    }
}

/**
 * Parse decimal degrees (handles both lat,lng and lng,lat with smart detection)
 * @param {string} input - Coordinate string
 * @returns {Object|null} Coordinate object or null
 */
function parseDecimalDegrees(input) {
    const commaMatch = input.match(/^([-+]?\d+\.?\d*)\s*[,]\s*([-+]?\d+\.?\d*)$/);
    const spaceMatch = input.match(/^([-+]?\d+\.?\d*)\s+([-+]?\d+\.?\d*)$/);

    const match = commaMatch || spaceMatch;
    if (!match) {
        return null;
    }

    const num1 = parseFloat(match[1]);
    const num2 = parseFloat(match[2]);

    if (isNaN(num1) || isNaN(num2)) {
        return null;
    }

    const result = determineCoordinateOrder(num1, num2);
    if (result && isValidCoordinate(result.lat, result.lng)) {
        result.format = commaMatch ? 'Decimal degrees (comma)' : 'Decimal degrees (space)';
        return result;
    }

    return null;
}

/**
 * Parse DMS (Degrees, Minutes, Seconds) notation
 * Supports formats like: 15°29'31.5"N 73°50'36.5"E
 * @param {string} input - DMS string
 * @returns {Object|null} Coordinate object or null
 */
function parseDMS(input) {
    const dmsPattern = /(\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*([NSEW])?/gi;
    const matches = [...input.matchAll(dmsPattern)];

    if (matches.length < 2) {
        return null;
    }

    const convertDMSToDecimal = (degrees, minutes, seconds, direction) => {
        let decimal = parseFloat(degrees) + parseFloat(minutes) / 60 + parseFloat(seconds) / 3600;
        if (direction === 'S' || direction === 'W') {
            decimal = -decimal;
        }
        return decimal;
    };

    const coord1 = convertDMSToDecimal(
        matches[0][1],
        matches[0][2],
        matches[0][3],
        matches[0][4]
    );

    const coord2 = convertDMSToDecimal(
        matches[1][1],
        matches[1][2],
        matches[1][3],
        matches[1][4]
    );

    const dir1 = matches[0][4]?.toUpperCase();
    const dir2 = matches[1][4]?.toUpperCase();

    let lat, lng;
    if (dir1 === 'N' || dir1 === 'S') {
        lat = coord1;
        lng = coord2;
    } else if (dir2 === 'N' || dir2 === 'S') {
        lat = coord2;
        lng = coord1;
    } else {
        const result = determineCoordinateOrder(coord1, coord2);
        if (!result) return null;
        lat = result.lat;
        lng = result.lng;
    }

    if (isValidCoordinate(lat, lng)) {
        return { lat, lng, format: 'DMS notation' };
    }

    return null;
}

/**
 * Determine coordinate order based on India bounds
 * @param {number} num1 - First number
 * @param {number} num2 - Second number
 * @returns {Object|null} {lat, lng} or null
 */
function determineCoordinateOrder(num1, num2) {
    const { latMin, latMax, lngMin, lngMax } = INDIA_COORDINATE_BOUNDS;

    const num1InLatRange = num1 >= latMin && num1 <= latMax;
    const num1InLngRange = num1 >= lngMin && num1 <= lngMax;
    const num2InLatRange = num2 >= latMin && num2 <= latMax;
    const num2InLngRange = num2 >= lngMin && num2 <= lngMax;

    if (num1InLatRange && num2InLngRange) {
        return { lat: num1, lng: num2 };
    }

    if (num1InLngRange && num2InLatRange) {
        return { lat: num2, lng: num1 };
    }

    if (num1 >= -90 && num1 <= 90 && num2 >= -180 && num2 <= 180) {
        return { lat: num1, lng: num2 };
    }

    if (num2 >= -90 && num2 <= 90 && num1 >= -180 && num1 <= 180) {
        return { lat: num2, lng: num1 };
    }

    return null;
}

/**
 * Validate coordinates are within global bounds
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean} True if valid
 */
export function isValidCoordinate(lat, lng) {
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

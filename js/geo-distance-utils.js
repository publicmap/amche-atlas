/**
 * GeoDistanceUtils - dependency-free great-circle distance/bearing helpers
 * (haversine formula), used by NearbyFeaturesControl to show distance and
 * compass bearing between a live device position and map features.
 */

const EARTH_RADIUS_METERS = 6371000;
const COMPASS_ABBR = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const COMPASS_WORD = [
    'north', 'north-northeast', 'northeast', 'east-northeast',
    'east', 'east-southeast', 'southeast', 'south-southeast',
    'south', 'south-southwest', 'southwest', 'west-southwest',
    'west', 'west-northwest', 'northwest', 'north-northwest'
];

function toRadians(deg) { return (deg * Math.PI) / 180; }
function toDegrees(rad) { return (rad * 180) / Math.PI; }

export function haversineDistanceMeters(a, b) {
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function initialBearingDeg(a, b) {
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const dLng = toRadians(b.lng - a.lng);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function formatDistance(meters) {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
}

function compassIndex(bearingDeg) {
    return Math.round(bearingDeg / 22.5) % 16;
}

export function bearingToCompassAbbr(bearingDeg) {
    return COMPASS_ABBR[compassIndex(bearingDeg)];
}

export function bearingToCompassWord(bearingDeg) {
    return COMPASS_WORD[compassIndex(bearingDeg)];
}

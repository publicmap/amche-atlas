/**
 * The map preview for an address part hovered in the place menu
 * (js/map-location-menu-control.js): its extent (bounding box), its point, and
 * a dotted line to that point from the current location labelled with how far
 * and which way it is - "1.2 km Southwest to Mapusa".
 */
const SOURCE = '_map-location-hover-bbox';
const FILL_LAYER = '_map-location-hover-bbox-fill';
const LINE_LAYER = '_map-location-hover-bbox-line';
const LEG_LAYER = '_map-location-hover-leg';
const LEG_LABEL_LAYER = '_map-location-hover-leg-label';
const POINT_LAYER = '_map-location-hover-point';
const LAYERS = [LEG_LABEL_LAYER, POINT_LAYER, LEG_LAYER, FILL_LAYER, LINE_LAYER];
const COLOR = '#000000';
const EARTH_RADIUS_M = 6371008.8;
const HERE_M = 10;
const COMPASS = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];

const rad = (deg) => deg * Math.PI / 180;

/** Distance and compass direction from one [lng, lat] to another: {meters, compass, text}. */
export function directionTo([lng1, lat1], [lng2, lat2]) {
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    const meters = 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
    const y = Math.sin(dLng) * Math.cos(rad(lat2));
    const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLng);
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const compass = COMPASS[Math.round(bearing / 45) % 8];
    if (meters < HERE_M) return { meters, compass: null, text: 'here' };
    const distance = meters < 1000 ? `${Math.round(meters / 10) * 10} m`
        : meters < 10000 ? `${(meters / 1000).toFixed(1)} km`
        : `${Math.round(meters / 1000)} km`;
    return { meters, compass, text: `${distance} ${compass}` };
}

function clear(map) {
    LAYERS.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}

function addLayers(map) {
    const polygons = ['==', ['geometry-type'], 'Polygon'];
    const lines = ['==', ['geometry-type'], 'LineString'];
    const labelled = ['has', 'label'];
    map.addLayer({ id: FILL_LAYER, type: 'fill', source: SOURCE, filter: polygons, paint: { 'fill-color': COLOR, 'fill-opacity': 0.08 } });
    map.addLayer({ id: LINE_LAYER, type: 'line', source: SOURCE, filter: polygons, paint: { 'line-color': COLOR, 'line-width': 2 } });
    map.addLayer({
        id: LEG_LAYER,
        type: 'line',
        source: SOURCE,
        filter: lines,
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': COLOR, 'line-width': 4, 'line-dasharray': [0, 2] }
    });
    map.addLayer({
        id: POINT_LAYER,
        type: 'circle',
        source: SOURCE,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', labelled]],
        paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': COLOR, 'circle-stroke-width': 2.5 }
    });
    map.addLayer({
        id: LEG_LABEL_LAYER,
        type: 'symbol',
        source: SOURCE,
        filter: labelled,
        layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Open Sans Bold'],
            'text-size': 13,
            'text-max-width': 30,
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },
        paint: { 'text-color': COLOR, 'text-halo-color': '#ffffff', 'text-halo-width': 2 }
    });
}

/**
 * @param {Object|null} located - {center: [lng, lat], bbox: [minLat, maxLat, minLon, maxLon]|null}; null clears
 * @param {[number, number]|null} origin - the current location the line starts at
 * @param {string} name - the part's name, for the line's label
 */
export function drawHoverPreview(map, located, origin = null, name = '') {
    if (!map) return;
    const features = [];
    if (located?.bbox) {
        const [minLat, maxLat, minLon, maxLon] = located.bbox;
        features.push({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]] }
        });
    }
    const center = located?.center?.every(Number.isFinite) ? located.center : null;
    if (center) {
        const leg = origin && directionTo(origin, center);
        if (leg?.compass) {
            // The label sits on a point midway, not along the line: a long
            // line is cut at tile edges and would be labelled once per piece.
            const middle = [(origin[0] + center[0]) / 2, (origin[1] + center[1]) / 2];
            features.push(
                { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [origin, center] } },
                { type: 'Feature', properties: { label: `${leg.text} to ${name}` }, geometry: { type: 'Point', coordinates: middle } }
            );
        }
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: center } });
    }
    if (!features.length) {
        clear(map);
        return;
    }
    const data = { type: 'FeatureCollection', features };
    if (map.getSource(SOURCE)) {
        map.getSource(SOURCE).setData(data);
        return;
    }
    map.addSource(SOURCE, { type: 'geojson', data });
    addLayers(map);
}

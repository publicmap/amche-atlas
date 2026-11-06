/**
 * Distance rings around the stop picked out on an open route card
 * (js/console/route-actions.js's highlightStop): a yellow outline 250 metres
 * out, labelled from zoom 17, with 50 and 100 metre rings and their labels
 * from zoom 18. Drawn in the map, so they sit under every location's pin.
 * A basemap switch drops added layers; they are put back on `style.load`.
 */
const SOURCE = 'route-stop-rings';
const RINGS = [250, 100, 50];
const NEAR_ZOOM = 18;
const LABEL_ZOOM = 17;
const STEPS = 96;
const METRES_PER_DEGREE = 111320;
const YELLOW = '#facc15';

let shown = null;

function ring([lng, lat], metres) {
    const dLat = metres / METRES_PER_DEGREE;
    const dLng = metres / (METRES_PER_DEGREE * Math.cos(lat * Math.PI / 180));
    const coordinates = Array.from({ length: STEPS + 1 }, (_, i) => {
        const a = (i / STEPS) * Math.PI * 2;
        return [lng + dLng * Math.sin(a), lat + dLat * Math.cos(a)];
    });
    return { type: 'Feature', properties: { metres, label: `${metres} metres` }, geometry: { type: 'LineString', coordinates } };
}

const far = ['==', ['get', 'metres'], RINGS[0]];
const near = ['!=', ['get', 'metres'], RINGS[0]];

function layers() {
    const line = { type: 'line', source: SOURCE, paint: { 'line-color': YELLOW, 'line-width': 2 } };
    const label = {
        type: 'symbol',
        source: SOURCE,
        layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 220,
            'text-field': ['get', 'label'],
            'text-size': 12,
            'text-font': ['Open Sans Bold'],
            'text-allow-overlap': true,
            'text-ignore-placement': true
        },
        paint: { 'text-color': YELLOW, 'text-halo-color': 'rgba(17, 24, 39, 0.85)', 'text-halo-width': 1.5 }
    };
    return [
        { ...line, id: `${SOURCE}-far`, filter: far },
        { ...line, id: `${SOURCE}-near`, filter: near, minzoom: NEAR_ZOOM },
        { ...label, id: `${SOURCE}-far-label`, filter: far, minzoom: LABEL_ZOOM },
        { ...label, id: `${SOURCE}-near-label`, filter: near, minzoom: NEAR_ZOOM }
    ];
}

function draw(map) {
    if (!shown || !map?.isStyleLoaded?.()) return;
    const data = { type: 'FeatureCollection', features: RINGS.map(metres => ring(shown, metres)) };
    const source = map.getSource(SOURCE);
    if (source) source.setData(data);
    else map.addSource(SOURCE, { type: 'geojson', data });
    layers().forEach(layer => { if (!map.getLayer(layer.id)) map.addLayer(layer); });
}

/** Rings around `point` ([lng, lat]), replacing any shown before. */
export function showStopRings(map, point) {
    if (!map || !point) return;
    shown = point;
    if (!map._stopRingsBound) {
        map._stopRingsBound = true;
        map.on('style.load', () => draw(map));
    }
    if (map.isStyleLoaded()) draw(map);
    else map.once('idle', () => draw(map));
}

export function clearStopRings(map) {
    shown = null;
    if (!map?.getStyle?.()) return;
    layers().forEach(layer => { if (map.getLayer(layer.id)) map.removeLayer(layer.id); });
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}

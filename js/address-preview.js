const SOURCE = '_address-preview';
const LAYERS = ['_address-preview-fill', '_address-preview-line', '_address-preview-point'];
const COLOR = '#f59e0b';

export function showAddressPreview(map, { lng, lat, bbox = null }) {
    if (!map || !Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const features = [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }];
    if (Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite)) {
        const [minLat, maxLat, minLng, maxLng] = bbox;
        features.push({
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'Polygon',
                coordinates: [[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]]
            }
        });
    }
    const data = { type: 'FeatureCollection', features };

    const source = map.getSource(SOURCE);
    if (source) {
        source.setData(data);
        return;
    }
    map.addSource(SOURCE, { type: 'geojson', data });
    map.addLayer({
        id: LAYERS[0], type: 'fill', source: SOURCE, filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': COLOR, 'fill-opacity': 0.15 }
    });
    map.addLayer({
        id: LAYERS[1], type: 'line', source: SOURCE, filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': COLOR, 'line-width': 2 }
    });
    map.addLayer({
        id: LAYERS[2], type: 'circle', source: SOURCE, filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 7, 'circle-color': COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }
    });
}

export function clearAddressPreview(map) {
    if (!map) return;
    LAYERS.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}

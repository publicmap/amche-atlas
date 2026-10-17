const FIT_PADDING = 5;

let state = null;
let restoreTimer = null;

function cameraOf(map) {
    const center = map.getCenter();
    return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}

function sameCamera(a, b) {
    return Math.abs(a.center[0] - b.center[0]) < 1e-6
        && Math.abs(a.center[1] - b.center[1]) < 1e-6
        && Math.abs(a.zoom - b.zoom) < 1e-3
        && Math.abs(a.bearing - b.bearing) < 0.01
        && Math.abs(a.pitch - b.pitch) < 0.01;
}

function positionsOf(coordinates, out = []) {
    if (typeof coordinates?.[0] === 'number') out.push(coordinates);
    else (coordinates || []).forEach(c => positionsOf(c, out));
    return out;
}

function geometryBbox(geometry) {
    const positions = geometry?.type === 'GeometryCollection'
        ? geometry.geometries.flatMap(g => positionsOf(g.coordinates))
        : positionsOf(geometry?.coordinates);
    if (!positions.length) return null;
    const lngs = positions.map(p => p[0]);
    const lats = positions.map(p => p[1]);
    return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

function paddingAround(map, avoid) {
    const padding = { top: FIT_PADDING, bottom: FIT_PADDING, left: FIT_PADDING, right: FIT_PADDING };
    const canvas = map.getCanvas?.().getBoundingClientRect();
    if (!avoid || !canvas?.width) return padding;
    const limit = canvas.width * 0.6;
    if (avoid.left + avoid.width / 2 < canvas.left + canvas.width / 2) {
        padding.left = Math.min(limit, Math.max(FIT_PADDING, avoid.right - canvas.left + FIT_PADDING));
    } else {
        padding.right = Math.min(limit, Math.max(FIT_PADDING, canvas.right - avoid.left + FIT_PADDING));
    }
    return padding;
}

export function fitToFeature(map, geometry, avoid = null) {
    clearTimeout(restoreTimer);
    const bbox = geometryBbox(geometry);
    if (!map || !bbox || (bbox[0][0] === bbox[1][0] && bbox[0][1] === bbox[1][1])) return;

    const continuing = state && (!state.fitted || sameCamera(cameraOf(map), state.fitted));
    const current = { previous: continuing ? state.previous : cameraOf(map), fitted: null };
    state = current;
    map.once('moveend', () => {
        if (state === current) current.fitted = cameraOf(map);
    });
    map.fitBounds(bbox, { padding: paddingAround(map, avoid) });
}

export function restoreFeatureFit(map) {
    if (!state || !map) return;
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
        const current = state;
        state = null;
        if (current && (!current.fitted || sameCamera(cameraOf(map), current.fitted))) {
            map.easeTo(current.previous);
        }
    }, 0);
}

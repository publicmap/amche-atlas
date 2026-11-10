/**
 * Where a camera move is headed, told as it starts: flyTo and fitBounds know
 * their destination before the map moves, so anything keyed to the view (the
 * console's place name, js/map-init.js) can be fetched during the flight
 * instead of after it lands.
 *
 * The move may not land there - the user can grab the map mid-flight - so
 * `landed()` says whether the map came to rest where the last move was going.
 */
const LANDED_PX = 2;

function toLngLat(center) {
    if (Array.isArray(center)) return { lng: Number(center[0]), lat: Number(center[1]) };
    return { lng: Number(center.lng ?? center.lon), lat: Number(center.lat) };
}

/**
 * @param {mapboxgl.Map} map
 * @param {(target: {center: {lng: number, lat: number}, zoom: number}, eventData?: Object) => void} onTarget
 * @returns {{landed: () => boolean}}
 */
export function watchCameraTarget(map, onTarget) {
    let target = null;
    let inFit = false;
    const announce = (camera, eventData) => {
        if (!camera?.center) return;
        target = { center: toLngLat(camera.center), zoom: camera.zoom ?? map.getZoom() };
        onTarget(target, eventData);
    };

    const flyTo = map.flyTo.bind(map);
    map.flyTo = (options = {}, eventData) => {
        if (!inFit) announce(options, eventData);
        return flyTo(options, eventData);
    };

    // fitBounds goes through flyTo or easeTo itself; its own camera is the one announced
    const fitBounds = map.fitBounds.bind(map);
    map.fitBounds = (bounds, options = {}, eventData) => {
        let camera = null;
        try {
            camera = map.cameraForBounds(bounds, options);
        } catch {}
        if (camera) announce({ ...camera, zoom: Math.min(camera.zoom, options.maxZoom ?? Infinity) }, eventData);
        inFit = true;
        try {
            return fitBounds(bounds, options, eventData);
        } finally {
            inFit = false;
        }
    };

    return {
        landed() {
            const last = target;
            target = null;
            if (!last || Math.round(last.zoom) !== Math.round(map.getZoom())) return false;
            const at = map.project(last.center);
            const center = map.project(map.getCenter());
            return Math.hypot(at.x - center.x, at.y - center.y) <= LANDED_PX;
        }
    };
}

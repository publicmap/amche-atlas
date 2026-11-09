/**
 * The point picked on atlas mode's small maps: a click on the Data Sources
 * map (js/console/sources-map.js) sets it, and both that map and the atlas
 * globe (js/console/atlas-map.js) mark it and filter their lists to it.
 * Clicking either marker clears it. Kept while the page is open, across
 * redraws and atlas switches.
 */

let point = null;
const listeners = new Set();

/** [lng, lat], or null. */
export function getPoint() {
    return point;
}

export function setPoint(at) {
    point = at || null;
    listeners.forEach(listener => listener(point));
}

export function onPoint(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The red marker both maps draw at the point; clicking it clears the point. */
export function pointMarker(map, at) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'sources-map-pin';
    dot.title = 'Remove this point and its filter';
    dot.setAttribute('aria-label', dot.title);
    dot.addEventListener('click', (e) => {
        e.stopPropagation();
        setPoint(null);
    });
    return new window.mapboxgl.Marker({ element: dot }).setLngLat(at).addTo(map);
}

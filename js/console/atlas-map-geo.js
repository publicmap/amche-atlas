/**
 * Geometry for the atlas globe (js/console/atlas-map.js): what to draw for an
 * atlas, a bbox as a polygon, and the extent of a GeoJSON shape.
 */
import { parseBbox } from './find-scope.js';

export function bboxPolygon([w, s, e, n]) {
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } };
}

export function isGlobal(box) {
    return !box || (box[2] - box[0] >= 359 && box[3] - box[1] >= 170);
}

/** [west, south, east, north] of any GeoJSON, or null. */
export function extentOf(geojson) {
    let box = null;
    const visit = (coords) => {
        if (!Array.isArray(coords)) return;
        if (typeof coords[0] === 'number') {
            box = box
                ? [Math.min(box[0], coords[0]), Math.min(box[1], coords[1]), Math.max(box[2], coords[0]), Math.max(box[3], coords[1])]
                : [coords[0], coords[1], coords[0], coords[1]];
        } else coords.forEach(visit);
    };
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'FeatureCollection') node.features?.forEach(walk);
        else if (node.type === 'Feature') walk(node.geometry);
        else if (node.type === 'GeometryCollection') node.geometries?.forEach(walk);
        else visit(node.coordinates);
    };
    walk(geojson);
    return box;
}

/** What to draw for an atlas: its outline or bbox, else only where to put its button. */
export function shapeOf(meta) {
    const box = parseBbox(meta?.bbox);
    const geojson = meta?.geojson;
    if (geojson && typeof geojson === 'object' && geojson.type) return { feature: geojson, box };
    if (box && !isGlobal(box)) return { feature: bboxPolygon(box), box };
    const center = Array.isArray(meta?.map?.center) ? meta.map.center : null;
    if (center && !isGlobal(box)) return { point: center, box };
    return { global: true };
}

/** What to fit when zooming to a shape: its outline, or a small box around its point. */
export function fitTarget(shape) {
    if (shape.feature) return shape.feature;
    const [lng, lat] = shape.point;
    return bboxPolygon([lng - 1.5, lat - 1, lng + 1.5, lat + 1]);
}

/**
 * The atlas's shapes on the main map, from atlas mode's overview
 * (js/console/atlas-overview.js): Show Map Outlines draws the atlas's own
 * outline - its `geojson`, else its bbox - and the extent of each of its maps
 * that has one of its own, named; Reset Zoom fits the map to the atlas when
 * the view doesn't already take all of it in.
 */
import { parseBbox, viewBbox } from './find-scope.js';
import { atlasLayers } from './find-browse.js';

const SOURCE = 'atlas-outlines';
const LAYERS = ['atlas-outlines-maps', 'atlas-outlines-atlas', 'atlas-outlines-labels'];
const FIT_PADDING = 40;
const HOLD_TOLERANCE = 0.02;

let shownFor = null;
let restyleBound = false;

const map = () => window.map;
const isGlobal = (box) => !box || (box[2] - box[0] >= 359 && box[3] - box[1] >= 170);

function polygon(box, properties) {
    const [w, s, e, n] = box;
    return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } };
}

function features(geojson) {
    if (!geojson || typeof geojson !== 'object') return [];
    if (geojson.type === 'FeatureCollection') return geojson.features || [];
    if (geojson.type === 'Feature') return [geojson];
    return geojson.type ? [{ type: 'Feature', properties: {}, geometry: geojson }] : [];
}

function extentOf(geojson) {
    let box = null;
    const visit = (coords) => {
        if (typeof coords[0] === 'number') {
            box = box ? [Math.min(box[0], coords[0]), Math.min(box[1], coords[1]), Math.max(box[2], coords[0]), Math.max(box[3], coords[1])] : [coords[0], coords[1], coords[0], coords[1]];
        } else coords.forEach(visit);
    };
    features(geojson).forEach(feature => feature.geometry?.coordinates && visit(feature.geometry.coordinates));
    return box;
}

/** The atlas's own extent: its outline's, else its bbox; null for a global atlas. */
export function atlasExtent(atlasId) {
    const meta = window.layerRegistry?.getAtlasMetadata(atlasId);
    const box = extentOf(meta?.geojson) || parseBbox(meta?.bbox);
    return isGlobal(box) ? null : box;
}

/** Whether the map's view takes in all of the atlas. */
export function viewHoldsAtlas(atlasId) {
    const box = atlasExtent(atlasId);
    const view = viewBbox();
    if (!box || !view) return true;
    // A sliver at the edge (the map's own padding) still counts as all of it
    const dx = (box[2] - box[0]) * HOLD_TOLERANCE;
    const dy = (box[3] - box[1]) * HOLD_TOLERANCE;
    return view[0] <= box[0] + dx && view[1] <= box[1] + dy && view[2] >= box[2] - dx && view[3] >= box[3] - dy;
}

export function zoomToAtlas(atlasId) {
    const box = atlasExtent(atlasId);
    if (box) map()?.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: FIT_PADDING, duration: 1000 });
}

function collection(atlasId) {
    const meta = window.layerRegistry?.getAtlasMetadata(atlasId);
    const atlas = features(meta?.geojson).map(feature => ({ ...feature, properties: { kind: 'atlas', name: meta?.name || atlasId } }));
    const atlasBox = parseBbox(meta?.bbox);
    if (!atlas.length && atlasBox && !isGlobal(atlasBox)) atlas.push(polygon(atlasBox, { kind: 'atlas', name: meta?.name || atlasId }));
    const maps = [];
    atlasLayers(atlasId).forEach(layer => {
        const box = parseBbox(layer.bbox) || parseBbox(layer.bounds);
        if (!box || isGlobal(box)) return;
        const name = layer.title || layer.id;
        maps.push(polygon(box, { kind: 'map', name }));
        maps.push({ type: 'Feature', properties: { kind: 'label', name }, geometry: { type: 'Point', coordinates: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] } });
    });
    return { type: 'FeatureCollection', features: [...maps, ...atlas] };
}

function draw() {
    const target = map();
    if (!target || !shownFor || !target.isStyleLoaded?.()) return;
    const data = collection(shownFor);
    const source = target.getSource(SOURCE);
    if (source) {
        source.setData(data);
        return;
    }
    target.addSource(SOURCE, { type: 'geojson', data });
    target.addLayer({
        id: LAYERS[0], type: 'line', source: SOURCE, filter: ['==', ['get', 'kind'], 'map'],
        paint: { 'line-color': '#7cb4ff', 'line-width': 1, 'line-opacity': 0.8, 'line-dasharray': [2, 2] }
    });
    target.addLayer({
        id: LAYERS[1], type: 'line', source: SOURCE, filter: ['==', ['get', 'kind'], 'atlas'],
        paint: { 'line-color': '#ffbf00', 'line-width': 3, 'line-opacity': 0.9 }
    });
    target.addLayer({
        id: LAYERS[2], type: 'symbol', source: SOURCE, filter: ['==', ['get', 'kind'], 'label'],
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-max-width': 10 },
        paint: { 'text-color': '#dbeafe', 'text-halo-color': '#111827', 'text-halo-width': 1.5 }
    });
}

function clear() {
    const target = map();
    if (!target) return;
    LAYERS.forEach(id => target.getLayer?.(id) && target.removeLayer(id));
    if (target.getSource?.(SOURCE)) target.removeSource(SOURCE);
}

/** Draws the atlas's outlines on the main map, or takes them off (null). */
export function showOutlines(atlasId) {
    shownFor = atlasId || null;
    if (!shownFor) {
        clear();
        return;
    }
    // A new base style drops added layers: draw them again on it
    if (!restyleBound && map()) {
        restyleBound = true;
        map().on('style.load', () => draw());
    }
    if (map()?.isStyleLoaded?.()) draw();
    else map()?.once('idle', draw);
}

export function outlinesShownFor() {
    return shownFor;
}

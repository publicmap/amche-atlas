/**
 * The small maps in Find's atlas mode - the atlas globe (js/console/atlas-map.js)
 * and the Data Sources map (js/console/sources-map.js) - in one grey style:
 * countries from the Mapbox Boundaries tileset (config/mapbox.atlas.json's
 * `countries`), drawn for the locale's worldview (js/locale-manager.js), a
 * graticule, and the main map's view as a dashed box.
 *
 * Each is made once and kept across redraws, then handed to whoever draws on
 * it now (its `owner`): every new map would be another map load and WebGL
 * context.
 */
import { el } from './find-rows.js';
import { viewBbox } from './find-scope.js';
import { localeManager } from '../locale-manager.js';
import { bboxPolygon } from './atlas-map-geo.js';

// Worldviews the Mapbox Boundaries tileset draws; others fall back to US
const WORLDVIEWS = ['CN', 'IN', 'JP', 'US'];
const EMPTY = { type: 'FeatureCollection', features: [] };
const maps = new Map();

function worldview() {
    const code = localeManager.getCountry?.()?.code;
    return WORLDVIEWS.includes(code) ? code : 'US';
}

const worldviewFilter = () => ['any', ['==', ['get', 'worldview'], 'all'], ['in', worldview(), ['get', 'worldview']]];

function graticule(step = 15) {
    const lines = [];
    for (let lng = -180; lng < 180; lng += step) lines.push([...Array(37)].map((_, i) => [lng, -90 + i * 5]));
    for (let lat = -75; lat <= 75; lat += step) lines.push([...Array(73)].map((_, i) => [-180 + i * 5, lat]));
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
}

function style() {
    return {
        version: 8,
        sources: {
            countries: { type: 'vector', url: 'mapbox://mapbox.country-boundaries-v1' },
            graticule: { type: 'geojson', data: graticule() },
            view: { type: 'geojson', data: EMPTY }
        },
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#0d0d0d' } },
            { id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': '#2e2e2e', 'line-width': 0.5 } },
            { id: 'countries', type: 'fill', source: 'countries', 'source-layer': 'country_boundaries', filter: worldviewFilter(), paint: { 'fill-color': '#5c5c5c' } },
            { id: 'countries-edge', type: 'line', source: 'countries', 'source-layer': 'country_boundaries', filter: worldviewFilter(), paint: { 'line-color': '#d6d6d6', 'line-width': 0.4 } },
            { id: 'view', type: 'line', source: 'view', paint: { 'line-color': '#7cb4ff', 'line-width': 1, 'line-dasharray': [2, 1.5] } }
        ],
        fog: { color: '#000000', 'high-color': '#000000', 'space-color': '#000000', 'horizon-blend': 0.02, 'star-intensity': 0 }
    };
}

/**
 * The small map kept under `key`, made the first time.
 * @returns {{map: Object, container: HTMLElement, owner: Object|null}|null} null without Mapbox GL
 */
export function miniMap(key, { projection = 'mercator' } = {}) {
    if (maps.has(key)) return maps.get(key);
    const gl = window.mapboxgl;
    if (!gl?.Map) return null;
    const container = el('div', 'mini-map');
    const map = new gl.Map({
        container,
        style: style(),
        projection,
        center: [78, 20],
        zoom: 1,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false
    });
    localeManager.onChange?.(() => {
        if (!map.isStyleLoaded()) return;
        map.setFilter('countries', worldviewFilter());
        map.setFilter('countries-edge', worldviewFilter());
    });
    // Built while hidden (atlas mode not yet open), the map would keep its
    // fallback size: it follows its container instead
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(() => {
            if (container.offsetWidth) map.resize();
        }).observe(container);
    }
    const entry = { map, container, owner: null };
    maps.set(key, entry);
    return entry;
}

/** Calls `ready` once the map is sized to its new place and its style has loaded. */
export function whenPlaced(entry, ready) {
    requestAnimationFrame(() => {
        entry.map.resize();
        if (entry.map.isStyleLoaded()) ready();
        else entry.map.once('load', ready);
    });
}

/** Adds a GeoJSON source once, with its layers placed under the view box - or on top. */
export function ensureLayers(map, sourceId, layers, { onTop = false, ...options } = {}) {
    if (!map.getSource(sourceId)) map.addSource(sourceId, { type: 'geojson', data: EMPTY, ...options });
    layers.forEach(layer => {
        if (!map.getLayer(layer.id)) map.addLayer({ ...layer, source: sourceId }, onTop ? undefined : 'view');
    });
}

/** The main map's view as the dashed box. */
export function showView(map) {
    const box = viewBbox();
    map?.getSource('view')?.setData(box ? bboxPolygon(box) : EMPTY);
}

/**
 * The Data Sources map in atlas mode (js/console/atlas-overview.js), beside
 * the tree: the atlas's outline - its `geojson`, else its bbox - in amber and
 * the extent of each of its maps that has one of its own, as on the main map
 * with Show Map Outlines (js/console/atlas-outlines.js), over the grey
 * mini-map style (js/console/mini-map.js), and the main map's viewport,
 * followed live - cyan while the main map moves, blue once it settles.
 *
 * It fits the atlas and the viewport, with 10% padding, and fits again each
 * time the main map settles, so zoomed out to the world the atlas is a dot.
 *
 * Pointing at the map filters the tree to the maps there: every map with an
 * extent of its own that takes in that point, large or small (maps without
 * one, which only inherit their atlas's, are left out). Clicking drops a
 * marker there and keeps that filter, the map fitted to the atlas and the
 * marker; clicking the marker takes it away, the filter and the fit with it.
 *
 * The map pointed at is the one whose outline lies under the pointer, else
 * the smallest that takes in the point - so a small map inside larger ones
 * can be picked out: its outline turns white, its thumbnail and name show
 * across the top of the map.
 */
import { el, layerThumb } from './find-rows.js';
import { parseBbox, viewBbox } from './find-scope.js';
import { bboxPolygon, extentOf, isGlobal } from './atlas-map-geo.js';
import { miniMap, whenPlaced, ensureLayers } from './mini-map.js';
import { getPoint, setPoint, onPoint, pointMarker } from './atlas-point.js';

const FIT_PADDING = 16;
const FIT_SHARE = 0.1;
const VIEW_STATIC = '#7cb4ff';
const VIEW_ACTIVE = '#22d3ee';
const EMPTY = { type: 'FeatureCollection', features: [] };

const union = (boxes) => {
    const valid = boxes.filter(Boolean);
    if (!valid.length) return null;
    return [Math.min(...valid.map(b => b[0])), Math.min(...valid.map(b => b[1])), Math.max(...valid.map(b => b[2])), Math.max(...valid.map(b => b[3]))];
};
const contains = (box, [lng, lat]) => !!box && lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3];
const areaOf = (box) => (box ? (box[2] - box[0]) * (box[3] - box[1]) : Infinity);
// How near the pointer an outline counts as under it, in pixels
const EDGE_HIT = 4;

const SOURCE_LAYERS = [
    {
        id: 'source-maps-fill', type: 'fill', filter: ['==', ['get', 'kind'], 'map'],
        paint: { 'fill-color': '#7cb4ff', 'fill-opacity': ['case', ['any', ['boolean', ['feature-state', 'target'], false], ['boolean', ['feature-state', 'hover'], false]], 0.05, 0.01] }
    },
    {
        id: 'source-maps-edge', type: 'line', filter: ['==', ['get', 'kind'], 'map'],
        paint: {
            'line-color': ['case', ['boolean', ['feature-state', 'target'], false], '#ffffff', '#7cb4ff'],
            'line-width': ['case', ['any', ['boolean', ['feature-state', 'target'], false], ['boolean', ['feature-state', 'hover'], false]], 1, 0.1],
            // Active or pointed at: full; an outline of its own (`geojson`): half; a bbox only: faint
            'line-opacity': ['case',
                ['any', ['boolean', ['feature-state', 'target'], false], ['boolean', ['feature-state', 'hover'], false]], 1,
                ['boolean', ['get', 'outlined'], false], 0.5,
                0.1]
        }
    },
    {
        id: 'source-atlas-edge', type: 'line', filter: ['==', ['get', 'kind'], 'atlas'],
        paint: { 'line-color': '#ffbf00', 'line-width': 2 }
    }
];

// The main map's viewport, on top of everything else
const VIEWPORT_LAYERS = [
    { id: 'source-viewport-fill', type: 'fill', paint: { 'fill-color': VIEW_STATIC, 'fill-opacity': 0.12 } },
    { id: 'source-viewport-edge', type: 'line', paint: { 'line-color': VIEW_STATIC, 'line-width': 2 } }
];

const rowOf = (key) => document.querySelector(`.console-tree-item[data-layer-key="${CSS.escape(key)}"]`);

// The point is shared with the atlas globe (js/console/atlas-point.js): it
// reaches whichever SourcesMap is showing
let current = null;
onPoint(at => current?._applyPin(at));

export class SourcesMap {
    /**
     * @param {{atlasId: string, layers: Array, keyOf: (layer) => string, onFilter?: (keys: Set|null, at: number[]|null) => void}} options -
     *   keyOf: the id the tree's rows carry as data-layer-key; onFilter: the maps
     *   to list (null for all) and the point they were found at
     */
    constructor({ atlasId, layers, keyOf, onFilter }) {
        this._onFilter = onFilter;
        this.el = el('div', 'console-atlas-map console-sources-map');
        const meta = window.layerRegistry?.getAtlasMetadata(atlasId);
        const atlas = meta?.geojson?.type ? meta.geojson : (parseBbox(meta?.bbox) && !isGlobal(parseBbox(meta.bbox)) ? bboxPolygon(parseBbox(meta.bbox)) : null);
        this._atlasBox = extentOf(atlas);
        this._extents = new Map();
        this._keys = layers.map(keyOf);
        this._layers = new Map(layers.map(layer => [keyOf(layer), layer]));
        const features = [];
        layers.forEach(layer => {
            // A map's own outline (`geojson`, as an atlas has), else its bbox
            const outline = layer.geojson?.type ? layer.geojson : null;
            const box = extentOf(outline) || parseBbox(layer.bbox) || parseBbox(layer.bounds);
            if (!box || isGlobal(box)) return;
            const key = keyOf(layer);
            this._extents.set(key, box);
            const parts = outline ? (outline.type === 'FeatureCollection' ? outline.features : [outline]) : [bboxPolygon(box)];
            parts.forEach(part => features.push({
                type: 'Feature',
                id: key,
                geometry: part.geometry || part,
                properties: { kind: 'map', key, outlined: !!outline }
            }));
        });
        const atlasParts = atlas ? (atlas.type === 'FeatureCollection' ? atlas.features : [atlas]) : [];
        atlasParts.forEach(part => features.push({ type: 'Feature', geometry: part.geometry || part, properties: { kind: 'atlas' } }));
        this._data = { type: 'FeatureCollection', features };

        const entry = miniMap('sources', { projection: 'mercator' });
        if (!entry) {
            this.el.appendChild(el('div', 'console-hint', 'The map needs Mapbox GL.'));
            return;
        }
        this._entry = entry;
        entry.owner = this;
        current = this;
        entry.pin?.remove();
        entry.pin = null;
        // The map pointed at, named across the top of the map
        this._caption = el('div', 'sources-map-label');
        this._caption.hidden = true;
        this.el.append(entry.container, this._caption);
        this._bind();
        whenPlaced(entry, () => {
            if (entry.owner !== this) return;
            ensureLayers(entry.map, 'sources', SOURCE_LAYERS, { promoteId: 'key' });
            ensureLayers(entry.map, 'viewport', VIEWPORT_LAYERS, { onTop: true });
            entry.map.getSource('sources').setData(this._data);
            this._ready = true;
            this.updateView();
            if (getPoint()) this._applyPin(getPoint(), { animate: false });
            // Hidden still (atlas mode not open), it is fitted once it has a size
            else if (entry.container.offsetWidth) this._refit({ animate: false });
        });
        // Fitted again once it has its real size (it is built while hidden)
        if (typeof ResizeObserver === 'function') {
            let lastWidth = 0;
            new ResizeObserver(() => {
                const width = entry.container.offsetWidth;
                if (entry.owner !== this || !width || width === lastWidth || !this._ready) return;
                lastWidth = width;
                this._refit({ animate: false });
            }).observe(entry.container);
        }
    }

    _bind() {
        const entry = this._entry;
        if (entry.bound) return;
        entry.bound = true;
        const { map } = entry;
        // Clicks and hovers go to whichever SourcesMap now owns the map
        map.on('click', (e) => entry.owner?._clickAt(e.lngLat));
        map.on('mousemove', (e) => entry.owner?._hoverAt(e.lngLat, e.point));
        map.getContainer().addEventListener('mouseleave', () => entry.owner?._hoverAt(null));
        // The main map's viewport, followed as it moves; fitted again once it settles
        const main = window.map;
        if (!main?.on) return;
        let frame = null;
        main.on('move', () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                entry.owner?.updateView({ moving: true });
            });
        });
        main.on('moveend', () => {
            // A frame still pending from the move would paint it moving again
            cancelAnimationFrame(frame);
            frame = null;
            entry.owner?.updateView({ moving: false });
            entry.owner?._refit();
        });
    }

    // ---------- Fitting ----------

    _padding(share) {
        const { width, height } = this._entry.map.getContainer().getBoundingClientRect();
        return { top: height * share, bottom: height * share, left: width * share, right: width * share };
    }

    _fit(box, { animate = true, pad = FIT_PADDING } = {}) {
        if (!box || !this._entry) return;
        // A point alone (no extent) is given some room around it
        const [w, s, e, n] = box[0] === box[2] && box[1] === box[3] ? [box[0] - 0.05, box[1] - 0.05, box[2] + 0.05, box[3] + 0.05] : box;
        this._entry.map.fitBounds([[w, s], [e, n]], { padding: pad, duration: animate ? 500 : 0, maxZoom: 16 });
    }

    /** The atlas and the viewport - or, with a marker, the atlas and the marker - with 10% padding. */
    _refit(options = {}) {
        if (!this._ready || !this._entry?.container.offsetWidth) return;
        const other = this._pinAt ? [...this._pinAt, ...this._pinAt] : viewBbox();
        this._fit(union([this._atlasBox, other]), { ...options, pad: this._padding(FIT_SHARE) });
    }

    // ---------- Filtering by place ----------

    /**
     * Every map at a point: its extent takes it in, or - without one - its atlas
     * does. `own`: only maps with an extent of their own (the lists the map
     * filters, which the inheriting maps would otherwise fill).
     */
    keysAt(at, { own = false } = {}) {
        const inAtlas = !own && contains(this._atlasBox, at);
        return new Set(this._keys.filter(key => (this._extents.has(key) ? contains(this._extents.get(key), at) : inAtlas)));
    }

    /** The map pointed at: an outline under the pointer, else the smallest taking in the point. */
    _targetAt(point, keys) {
        const map = this._entry.map;
        const near = [[point.x - EDGE_HIT, point.y - EDGE_HIT], [point.x + EDGE_HIT, point.y + EDGE_HIT]];
        const edges = map.getLayer('source-maps-edge')
            ? [...new Set(map.queryRenderedFeatures(near, { layers: ['source-maps-edge'] }).map(f => f.properties.key))]
            : [];
        const candidates = edges.length ? edges : [...keys];
        return candidates.sort((a, b) => areaOf(this._extents.get(a)) - areaOf(this._extents.get(b)))[0] || null;
    }

    _hoverAt(lngLat, point) {
        const at = lngLat ? [lngLat.lng, lngLat.lat] : null;
        const keys = at ? this.keysAt(at, { own: true }) : null;
        this._highlight(keys);
        this._target(at && point ? this._targetAt(point, keys) : null);
        // Pointing filters for as long as it points; a marker's filter stays beneath
        if (at) this._onFilter?.(keys, at);
        else this._onFilter?.(this._pinAt ? this.keysAt(this._pinAt, { own: true }) : null, this._pinAt);
    }

    /** One map singled out: its outline white, its thumbnail and name at its middle. */
    _target(key) {
        if (key === this._targetKey) return;
        const entry = this._entry;
        const map = entry.map;
        if (this._targetKey && map.getSource('sources')) map.setFeatureState({ source: 'sources', id: this._targetKey }, { target: false });
        this._targetKey = key;
        this._caption.hidden = true;
        document.querySelectorAll('.console-tree-item.map-target').forEach(row => row.classList.remove('map-target'));
        if (!key) return;
        map.setFeatureState({ source: 'sources', id: key }, { target: true });
        rowOf(key)?.classList.add('map-target');
        const layer = this._layers.get(key);
        const thumb = layerThumb(layer, 18);
        thumb.classList.add('console-tree-thumb');
        this._caption.replaceChildren(thumb, el('span', 'sources-map-label-name', layer?.title || layer?.name || key));
        this._caption.hidden = false;
    }


    _highlight(keys) {
        const map = this._entry?.map;
        if (!map?.getSource('sources')) return;
        this._extents.forEach((box, key) => map.setFeatureState({ source: 'sources', id: key }, { hover: !!keys?.has(key) }));
    }

    /** A click sets the shared point there (js/console/atlas-point.js); its marker clears it. */
    _clickAt(lngLat) {
        setPoint([lngLat.lng, lngLat.lat]);
    }

    /** The point's marker, the tree filtered to the maps at it, the map fitted to the atlas and it. */
    _applyPin(at, options = {}) {
        const entry = this._entry;
        if (!entry) return;
        entry.pin?.remove();
        entry.pin = at ? pointMarker(entry.map, at) : null;
        this._pinAt = at;
        const keys = at ? this.keysAt(at, { own: true }) : null;
        this._highlight(keys);
        this._onFilter?.(keys, at);
        this._refit(options);
    }

    /** Hovering a map's row in the tree: its extent highlighted here. */
    hover(key, on) {
        if (!key) return;
        const map = this._entry?.map;
        if (this._extents.has(key) && map?.getSource('sources')) map.setFeatureState({ source: 'sources', id: key }, { hover: on });
        rowOf(key)?.classList.toggle('map-hover', on);
    }

    /** The main map's viewport; cyan while the main map moves, blue once it settles. */
    updateView({ moving = false } = {}) {
        const map = this._entry?.map;
        if (!map?.getSource('viewport')) return;
        const box = viewBbox();
        map.getSource('viewport').setData(box ? bboxPolygon(box) : EMPTY);
        const color = moving ? VIEW_ACTIVE : VIEW_STATIC;
        map.setPaintProperty('source-viewport-edge', 'line-color', color);
        map.setPaintProperty('source-viewport-fill', 'fill-color', color);
        map.setPaintProperty('source-viewport-fill', 'fill-opacity', moving ? 0.25 : 0.12);
    }
}

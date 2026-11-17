/**
 * Draw points, lines and areas on the map for the layer editor's Features
 * section (js/creator-features.js). Runs on the map's own page; the editor's
 * iframe turns it on and off by message (see MapBrowserControl) and gets each
 * finished geometry back.
 *
 * Every click adds a vertex. Clicking the only vertex again makes a point;
 * clicking the last vertex ends a line; clicking the first vertex of three or
 * more closes an area. Escape drops the sketch, Backspace its last vertex.
 * While drawing, map clicks don't select features.
 */

const SOURCE = 'feature-draw-sketch';
const HIT_PX = 10;
const COLOR = '#ffbf00';

const LAYERS = [
    { id: 'feature-draw-fill', type: 'fill', filter: ['==', ['get', 'part'], 'area'], paint: { 'fill-color': COLOR, 'fill-opacity': 0.15 } },
    { id: 'feature-draw-line', type: 'line', filter: ['==', ['get', 'part'], 'line'], paint: { 'line-color': COLOR, 'line-width': 2.5 } },
    { id: 'feature-draw-guide', type: 'line', filter: ['==', ['get', 'part'], 'guide'], paint: { 'line-color': COLOR, 'line-width': 1.5, 'line-dasharray': [2, 2] } },
    {
        id: 'feature-draw-vertex', type: 'circle', filter: ['==', ['get', 'part'], 'vertex'],
        paint: {
            'circle-radius': ['case', ['get', 'end'], 6, 4],
            'circle-color': ['case', ['get', 'first'], COLOR, '#ffffff'],
            'circle-stroke-color': COLOR,
            'circle-stroke-width': 2
        }
    }
];

/**
 * What a click on the sketch does.
 * @param {number} count - vertices so far
 * @param {number} hit - index of the vertex clicked, or -1 for empty map
 * @returns {'add'|'point'|'line'|'area'|'ignore'}
 */
export function drawStep(count, hit) {
    if (hit < 0) return 'add';
    if (count === 1 && hit === 0) return 'point';
    if (count >= 3 && hit === 0) return 'area';
    if (count >= 2 && hit === count - 1) return 'line';
    return 'ignore';
}

/** The finished geometry for a sketch. */
export function sketchGeometry(kind, vertices) {
    if (kind === 'point') return { type: 'Point', coordinates: vertices[0] };
    if (kind === 'line') return { type: 'LineString', coordinates: vertices.slice() };
    return { type: 'Polygon', coordinates: [[...vertices, vertices[0]]] };
}

const feature = (properties, geometry) => ({ type: 'Feature', properties, geometry });

export class FeatureDrawTool {
    constructor(map) {
        this.map = map;
        this.active = false;
        this.vertices = [];
        this.pointer = null;
        this._onClick = this._onClick.bind(this);
        this._onMove = this._onMove.bind(this);
        this._onKey = this._onKey.bind(this);
        this._onStyle = () => this._render();
    }

    /**
     * @param {{onComplete: function(Object), onChange?: function(number)}} handlers
     */
    start({ onComplete, onChange } = {}) {
        this.onComplete = onComplete;
        this.onChange = onChange;
        if (this.active) return;
        this.active = true;
        const map = this.map;
        const features = window.featureControl;
        this._autoSelect = features?.isAutoSelectEnabled?.() ?? true;
        features?.setAutoSelectEnabled?.(false);
        this._doubleClickZoom = map.doubleClickZoom.isEnabled();
        map.doubleClickZoom.disable();
        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', this._onClick);
        map.on('mousemove', this._onMove);
        map.on('style.load', this._onStyle);
        window.addEventListener('keydown', this._onKey, true);
        this._render();
        this.onChange?.(0);
    }

    stop() {
        if (!this.active) return;
        this.active = false;
        const map = this.map;
        map.off('click', this._onClick);
        map.off('mousemove', this._onMove);
        map.off('style.load', this._onStyle);
        window.removeEventListener('keydown', this._onKey, true);
        map.getCanvas().style.cursor = '';
        if (this._doubleClickZoom) map.doubleClickZoom.enable();
        window.featureControl?.setAutoSelectEnabled?.(this._autoSelect);
        this.vertices = [];
        this.pointer = null;
        this._removeLayers();
    }

    cancelSketch() {
        this.vertices = [];
        this._render();
        this.onChange?.(0);
    }

    undoVertex() {
        this.vertices.pop();
        this._render();
        this.onChange?.(this.vertices.length);
    }

    _hitIndex(point) {
        let best = -1;
        let bestDistance = HIT_PX;
        this.vertices.forEach((vertex, index) => {
            const p = this.map.project(vertex);
            const distance = Math.hypot(p.x - point.x, p.y - point.y);
            if (distance <= bestDistance) {
                best = index;
                bestDistance = distance;
            }
        });
        return best;
    }

    _onClick(event) {
        const step = drawStep(this.vertices.length, this._hitIndex(event.point));
        if (step === 'ignore') return;
        if (step === 'add') {
            this.vertices.push([event.lngLat.lng, event.lngLat.lat]);
            this._render();
            this.onChange?.(this.vertices.length);
            return;
        }
        const geometry = sketchGeometry(step, this.vertices);
        this.vertices = [];
        this._render();
        this.onChange?.(0);
        this.onComplete?.(geometry);
    }

    _onMove(event) {
        this.pointer = [event.lngLat.lng, event.lngLat.lat];
        const hit = this.vertices.length ? this._hitIndex(event.point) : -1;
        this.map.getCanvas().style.cursor = hit >= 0 && drawStep(this.vertices.length, hit) !== 'ignore' ? 'pointer' : 'crosshair';
        if (this.vertices.length) this._render();
    }

    _onKey(event) {
        if (!this.vertices.length) return;
        if (event.key === 'Escape') this.cancelSketch();
        else if (event.key === 'Backspace' && !/^(INPUT|TEXTAREA)$/.test(event.target?.tagName)) this.undoVertex();
        else return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    _sketch() {
        const v = this.vertices;
        const features = [];
        if (v.length >= 3) features.push(feature({ part: 'area' }, { type: 'Polygon', coordinates: [[...v, v[0]]] }));
        if (v.length >= 2) features.push(feature({ part: 'line' }, { type: 'LineString', coordinates: v }));
        if (v.length && this.pointer) features.push(feature({ part: 'guide' }, { type: 'LineString', coordinates: [v[v.length - 1], this.pointer] }));
        v.forEach((vertex, index) => features.push(feature(
            { part: 'vertex', first: index === 0, end: index === 0 || index === v.length - 1 },
            { type: 'Point', coordinates: vertex }
        )));
        return { type: 'FeatureCollection', features };
    }

    _render() {
        const map = this.map;
        if (!this.active) return;
        const data = this._sketch();
        try {
            const source = map.getSource(SOURCE);
            if (source) source.setData(data);
            else map.addSource(SOURCE, { type: 'geojson', data });
            LAYERS.forEach(layer => {
                if (!map.getLayer(layer.id)) map.addLayer({ ...layer, source: SOURCE });
                else map.moveLayer(layer.id);
            });
        } catch (error) {
            // The style is being replaced; 'style.load' draws the sketch again.
        }
    }

    _removeLayers() {
        const map = this.map;
        try {
            LAYERS.forEach(layer => { if (map.getLayer(layer.id)) map.removeLayer(layer.id); });
            if (map.getSource(SOURCE)) map.removeSource(SOURCE);
        } catch (error) {
            // The style was replaced and took the sketch with it.
        }
    }
}

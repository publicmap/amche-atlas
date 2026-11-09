/**
 * The atlas globe in Find's atlas mode (js/console/find-atlases.js): a small
 * Mapbox GL globe in greys - countries from the Mapbox Boundaries tileset
 * (config/mapbox.atlas.json's `countries`), drawn for the locale's worldview
 * (js/locale-manager.js), and a graticule - with every regional atlas listed
 * on it: its `geojson` outline, else its bbox, and a button with its icon at
 * its middle (an atlas with neither, at its map centre). The main map's view
 * is the dashed box, kept current as the map moves. Global atlases have
 * nothing to draw; they head the list beside the globe instead.
 *
 * Dragging turns the globe and the wheel zooms it. Clicking an atlas - its
 * button, its outline, or its row in the list - flies the globe to fit it with
 * 10% padding and offers Select Atlas; clicking anywhere else goes back to the
 * whole globe. The current atlas is outlined in amber; hovering an atlas here
 * or in the list highlights it in both.
 *
 * The globe is the shared 'atlases' mini-map (js/console/mini-map.js), made
 * once and kept across redraws.
 */
import { el, icon } from './find-rows.js';
import { previewAtlas, clearPreview } from './find-browse.js';
import { shapeOf, fitTarget, extentOf } from './atlas-map-geo.js';
import { miniMap, whenPlaced, ensureLayers, showView } from './mini-map.js';
import { getPoint, onPoint, pointMarker } from './atlas-point.js';

const FOCUS_PAD = 0.1;
const PIN = 20;
const HOME_ZOOM = 0.6;
const LARGE_SHARE = 0.6;

const nameOf = (shape) => shape.meta?.name || shape.id;
const centerOf = (shape) => {
    if (shape.point) return shape.point;
    const [w, s, e, n] = extentOf(shape.feature);
    return [(w + e) / 2, (s + n) / 2];
};

const ATLAS_LAYERS = [
    {
        id: 'atlas-fill', type: 'fill',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.3, 0.06] }
    },
    {
        id: 'atlas-edge', type: 'line',
        paint: {
            'line-color': ['case', ['boolean', ['get', 'current'], false], '#ffbf00', ['get', 'color']],
            'line-width': ['case', ['boolean', ['get', 'current'], false], 2, ['boolean', ['feature-state', 'hover'], false], 2, 1]
        }
    }
];

// The point picked on the Data Sources map (js/console/atlas-point.js) reaches
// whichever AtlasMap is showing
let current = null;
onPoint(at => current?.applyPoint(at));

export class AtlasMap {
    /** @param {{entries: Array, onPick: (id: string) => void}} options - entries as from atlasesForSelector */
    /** onFilter: the atlases to list (null for all) as the picked point changes */
    constructor({ entries, onPick, onFilter }) {
        this._onPick = onPick;
        this._onFilter = onFilter;
        current = this;
        this.el = el('div', 'console-atlas-map');
        this._popup = el('div', 'atlas-map-popup');
        this._popup.hidden = true;
        const everything = entries.map(entry => ({ ...entry, ...shapeOf(entry.meta) }));
        this._shapes = new Map(everything.map(shape => [shape.id, shape]));
        this._regional = everything.filter(shape => !shape.global);
        this._markers = new Map();
        this._home = this._homeView();
        const globe = miniMap('atlases', { projection: 'globe' });
        if (!globe) {
            this.el.appendChild(el('div', 'console-hint', 'The globe needs Mapbox GL.'));
            return;
        }
        this._globe = globe;
        globe.owner = this;
        globe.pin?.remove();
        globe.pin = null;
        this.el.append(globe.container, this._popup);
        this._bindMap();
        whenPlaced(globe, () => {
            if (globe.owner !== this) return;
            ensureLayers(globe.map, 'atlases', ATLAS_LAYERS, { promoteId: 'id' });
            globe.map.jumpTo(this._home);
            this._drawAtlases();
            this.updateView();
        });
    }

    _homeView() {
        if (!this._regional.length) return { center: [0, 20], zoom: HOME_ZOOM };
        const boxes = this._regional.map(shape => (shape.feature ? extentOf(shape.feature) : [...shape.point, ...shape.point]));
        const west = Math.min(...boxes.map(b => b[0]));
        const south = Math.min(...boxes.map(b => b[1]));
        const east = Math.max(...boxes.map(b => b[2]));
        const north = Math.max(...boxes.map(b => b[3]));
        return { center: [(west + east) / 2, (south + north) / 2], zoom: HOME_ZOOM };
    }

    _drawAtlases() {
        const { map } = this._globe;
        const features = this._regional.filter(shape => shape.feature).flatMap(shape => {
            const parts = shape.feature.type === 'FeatureCollection' ? shape.feature.features : [shape.feature];
            return parts.map(part => ({
                type: 'Feature',
                geometry: part.geometry || part,
                properties: { id: shape.id, color: shape.meta?.color || '#7cb4ff', current: !!shape.current }
            }));
        });
        map.getSource('atlases')?.setData({ type: 'FeatureCollection', features });
        this._markers.forEach(marker => marker.remove());
        this._markers.clear();
        this._regional.forEach(shape => {
            const at = centerOf(shape);
            // A dot; the selected atlas, or one pointed at, shows its icon and name
            const marker = el('div', 'atlas-map-marker' + (shape.current ? ' current' : ''));
            marker.style.setProperty('--atlas-color', shape.meta?.color || '#7cb4ff');
            const button = el('button', 'atlas-map-pin');
            button.type = 'button';
            button.dataset.atlasId = shape.id;
            button.title = nameOf(shape);
            button.setAttribute('aria-label', nameOf(shape));
            if (shape.meta?.icon) {
                const img = el('img');
                img.src = shape.meta.icon;
                img.alt = '';
                button.appendChild(img);
            } else button.textContent = nameOf(shape).charAt(0);
            marker.append(button, el('span', 'atlas-map-name', nameOf(shape)));
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.focus(shape.id);
            });
            button.addEventListener('mouseenter', () => this.hover(shape.id, true));
            button.addEventListener('mouseleave', () => this.hover(shape.id, false));
            this._markers.set(shape.id, new window.mapboxgl.Marker({ element: marker }).setLngLat(at).addTo(map));
        });
    }

    _bindMap() {
        const globe = this._globe;
        if (globe.bound) return;
        globe.bound = true;
        const { map } = globe;
        // Clicks and hovers go to whichever AtlasMap now owns the globe
        map.on('click', (e) => globe.owner?._clickAt(e.point));
        map.on('mousemove', (e) => globe.owner?._hoverAt(e.point));
        map.getContainer().addEventListener('mouseleave', () => globe.owner?._hoverAt(null));
    }

    /** The smallest atlas outline under a point - not one wider than most of the view. */
    _atlasAt(point) {
        const { map } = this._globe;
        if (!point || !map.getLayer('atlas-fill')) return null;
        const bounds = map.getBounds();
        const viewArea = Math.abs((bounds.getEast() - bounds.getWest()) * (bounds.getNorth() - bounds.getSouth())) || 1;
        const area = (id) => {
            const box = extentOf(this._shapes.get(id)?.feature);
            return box ? (box[2] - box[0]) * (box[3] - box[1]) : Infinity;
        };
        const ids = [...new Set(map.queryRenderedFeatures(point, { layers: ['atlas-fill'] }).map(f => f.properties.id))]
            .filter(id => area(id) < viewArea * LARGE_SHARE)
            .sort((a, b) => area(a) - area(b));
        return ids[0] || null;
    }

    _clickAt(point) {
        const id = this._atlasAt(point);
        if (id) this.focus(id);
        else this.reset();
    }

    _hoverAt(point) {
        const id = this._atlasAt(point);
        if (id === this._hovered) return;
        if (this._hovered) this.hover(this._hovered, false);
        if (id) this.hover(id, true);
    }

    /** Hovering an atlas, here or in the list: highlighted in both, previewed on the main map. */
    hover(id, on) {
        if (!id) return;
        this._hovered = on ? id : null;
        const map = this._globe?.map;
        if (map?.getSource('atlases') && this._regional.some(shape => shape.id === id && shape.feature)) {
            map.setFeatureState({ source: 'atlases', id }, { hover: on });
        }
        this._markers.get(id)?.getElement().classList.toggle('hovered', on);
        document.querySelector(`.atlas-tree-item[data-atlas-id="${CSS.escape(id)}"]`)?.classList.toggle('map-hover', on);
        if (on) previewAtlas(id);
        else clearPreview();
    }

    highlight(id) {
        this._markers.forEach((marker, key) => marker.getElement().classList.toggle('hovered', key === id));
    }

    /** Flies the globe to fit an atlas, and offers to select it; a global one, the whole globe. */
    focus(id) {
        const shape = this._shapes.get(id);
        if (!shape) return;
        const map = this._globe?.map;
        if (map) {
            if (shape.global) map.flyTo({ ...this._home, duration: 800 });
            else {
                const [w, s, e, n] = extentOf(fitTarget(shape));
                const { width, height } = map.getContainer().getBoundingClientRect();
                const pad = { top: height * FOCUS_PAD, bottom: height * FOCUS_PAD + 34, left: width * FOCUS_PAD, right: width * FOCUS_PAD };
                map.fitBounds([[w, s], [e, n]], { padding: pad, duration: 800, maxZoom: 9 });
            }
        }
        this._markers.forEach((marker, key) => marker.getElement().classList.toggle('focused', key === id));
        document.querySelectorAll('.atlas-tree-item').forEach(row => row.classList.toggle('focused', row.dataset.atlasId === id));
        this._showPopup(shape);
    }

    /** The atlases covering a point - a global one covers everywhere. */
    idsAt([lng, lat]) {
        return new Set([...this._shapes.values()].filter(shape => {
            if (shape.global) return true;
            const box = extentOf(fitTarget(shape));
            return !!box && lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3];
        }).map(shape => shape.id));
    }

    /** The picked point: its marker on the globe, the list filtered to the atlases there. */
    applyPoint(at = getPoint()) {
        const globe = this._globe;
        if (globe) {
            globe.pin?.remove();
            globe.pin = at ? pointMarker(globe.map, at) : null;
        }
        this._onFilter?.(at ? this.idsAt(at) : null, at);
    }

    reset() {
        this._globe?.map.flyTo({ ...this._home, duration: 800 });
        this._markers.forEach(marker => marker.getElement().classList.remove('focused'));
        document.querySelectorAll('.atlas-tree-item.focused').forEach(row => row.classList.remove('focused'));
        this._showPopup(null);
    }

    _showPopup(shape) {
        this._popup.hidden = !shape;
        if (!shape) return;
        const button = el('button', 'atlas-map-load');
        button.type = 'button';
        button.disabled = !!shape.current;
        button.append(icon(shape.current ? 'eye-fill' : 'check2'), el('span', '', shape.current ? 'Selected' : 'Select Atlas'));
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._onPick?.(shape.id);
        });
        this._popup.replaceChildren(el('span', 'atlas-map-popup-name', nameOf(shape)), button);
    }

    /** The main map's view as a dashed box. */
    updateView() {
        showView(this._globe?.map);
    }
}

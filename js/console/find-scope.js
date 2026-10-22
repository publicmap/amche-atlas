/**
 * Find's view scope (js/console/find-panel.js): every list is limited to what
 * lies in the current map view unless "Include outside this view" is on. The
 * choice is remembered per viewer and also decides whether picking an atlas
 * turns on its default maps that lie outside the view
 * (MapBrowserControl.switchAtlasLive).
 *
 * Things outside the view keep a zoom button, so the list says where they are
 * and one click takes the map there.
 */
import { el, icon } from './find-rows.js';

const STORAGE_KEY = 'findIncludeOutside';
const ZOOM_PADDING = 60;

function load() {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

let includeOutside = load();

export function isIncludingOutside() {
    return includeOutside;
}

export function setIncludeOutside(on) {
    includeOutside = !!on;
    try {
        localStorage.setItem(STORAGE_KEY, includeOutside ? '1' : '0');
    } catch {}
    window.dispatchEvent(new CustomEvent('find-scope-changed', { detail: { includeOutside } }));
}

export function parseBbox(value) {
    const parts = typeof value === 'string' ? value.split(',').map(parseFloat) : value;
    return Array.isArray(parts) && parts.length === 4 && parts.every(Number.isFinite) ? parts : null;
}

// getBounds() can throw mid camera transition with terrain on (an
// unprojectable corner); everything then counts as in view this time.
export function viewBbox() {
    try {
        const bounds = window.map?.getBounds?.();
        return bounds ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] : null;
    } catch (error) {
        return null;
    }
}

export function bboxInView(bbox, view = viewBbox()) {
    const box = parseBbox(bbox);
    if (!box || !view) return true;
    return box[0] <= view[2] && box[2] >= view[0] && box[1] <= view[3] && box[3] >= view[1];
}

export function pointInView(lngLat, view = viewBbox()) {
    const point = toPoint(lngLat);
    if (!point || !view) return true;
    return point[0] >= view[0] && point[0] <= view[2] && point[1] >= view[1] && point[1] <= view[3];
}

/** A layer's own extent, else its atlas's; null for a global layer. */
export function layerBbox(layer) {
    const own = parseBbox(layer?.bbox) || parseBbox(layer?.bounds);
    if (own) return own;
    const meta = layer?._sourceAtlas ? window.layerRegistry?.getAtlasMetadata(layer._sourceAtlas) : null;
    return parseBbox(meta?.bbox) || parseBbox(meta?.bounds);
}

export function routeBbox(route) {
    const points = (route?.waypoints || []).filter(p => Array.isArray(p) && p.length >= 2);
    if (!points.length) return null;
    const lngs = points.map(p => p[0]);
    const lats = points.map(p => p[1]);
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function toPoint(lngLat) {
    if (!lngLat) return null;
    if (Array.isArray(lngLat)) return lngLat.length >= 2 && lngLat.every(Number.isFinite) ? lngLat : null;
    return Number.isFinite(lngLat.lng) && Number.isFinite(lngLat.lat) ? [lngLat.lng, lngLat.lat] : null;
}

export function zoomTo({ bbox = null, lngLat = null } = {}) {
    const map = window.map;
    const box = parseBbox(bbox);
    const point = toPoint(lngLat);
    if (!map) return;
    if (box && (box[0] !== box[2] || box[1] !== box[3])) {
        map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: ZOOM_PADDING, duration: 1000, maxZoom: 17 });
    } else if (box || point) {
        map.flyTo({ center: point || [box[0], box[1]], zoom: Math.max(map.getZoom(), 15), duration: 1000 });
    }
}

/** The trailing button of a row that lies outside the view. */
export function zoomButton(target, title = 'Outside this view - zoom to it') {
    const button = el('button', 'console-zoom');
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.appendChild(icon('zoom-in'));
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomTo(target);
    });
    return button;
}

/**
 * Splits `items` into those in view and those outside; with the scope
 * including outside, all are shown in their own (ranked) order, the outside
 * ones marked, and `hidden` is 0.
 */
export function scoped(items, where) {
    const view = viewBbox();
    const inside = [];
    const outside = [];
    items.forEach(item => {
        const target = where(item);
        const inView = !target || (target.bbox ? bboxInView(target.bbox, view) : pointInView(target.lngLat, view));
        (inView ? inside : outside).push(item);
    });
    return includeOutside
        ? { shown: items, outside: new Set(outside), hidden: 0 }
        : { shown: inside, outside: new Set(), hidden: outside.length };
}

/** The switch at the head of Find's results: "Include N outside this view". */
export function scopeToggle(hiddenCount) {
    const button = el('button', 'console-scope' + (includeOutside ? ' on' : ''));
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(includeOutside));
    const track = el('span', 'console-scope-track');
    track.appendChild(el('span', 'console-scope-knob'));
    const label = includeOutside
        ? 'Including results outside this view'
        : (hiddenCount ? `Include ${hiddenCount} more outside this view` : 'Include results outside this view');
    button.append(track, el('span', 'console-scope-label', label));
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        setIncludeOutside(!includeOutside);
    });
    return button;
}

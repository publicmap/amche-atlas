import { LayerThumbnail } from './layer-thumbnail.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PADDING_RATIO = 0.12;
const POINT_RADIUS_RATIO = 0.09;
const POINT_STROKE_RATIO = 0.04;
const VIEWPORT_STROKE = '#dc2626';
const VIEWPORT_FILL = 'rgba(220, 38, 38, 0.2)';
const DRAG_THRESHOLD = 3;
const boundMaps = new WeakSet();
const FIGURE_FILL = '#cbd5e1';
const FIGURE_STROKE = '#1f2937';

function ringsOf(geometry) {
    if (!geometry) return { points: [], lines: [], polygons: [] };
    const out = { points: [], lines: [], polygons: [] };
    const walk = (g) => {
        const { type, coordinates: c } = g;
        if (type === 'Point') out.points.push(c);
        else if (type === 'MultiPoint') out.points.push(...c);
        else if (type === 'LineString') out.lines.push(c);
        else if (type === 'MultiLineString') out.lines.push(...c);
        else if (type === 'Polygon') out.polygons.push(c);
        else if (type === 'MultiPolygon') out.polygons.push(...c);
        else if (type === 'GeometryCollection') g.geometries.forEach(walk);
    };
    walk(geometry);
    return out;
}

function makeProjector(shapes, size, extra = []) {
    const all = [
        ...extra,
        ...shapes.points,
        ...shapes.lines.flat(),
        ...shapes.polygons.flat(2)
    ];
    if (!all.length) return null;

    const lngs = all.map(p => p[0]);
    const lats = all.map(p => p[1]);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const width = (maxLng - minLng) * cosLat;
    const height = maxLat - minLat;
    const span = Math.max(width, height);
    const inner = size * (1 - PADDING_RATIO * 2);
    const scale = span > 0 ? inner / span : 0;
    const offsetX = (size - width * scale) / 2;
    const offsetY = (size - height * scale) / 2;

    const project = ([lng, lat]) => [
        offsetX + (lng - minLng) * cosLat * scale,
        offsetY + (maxLat - lat) * scale
    ];
    project.params = { minLng, maxLat, cosLat, scale, offsetX, offsetY };
    return project;
}

function projectWith(params, [lng, lat]) {
    return [
        params.offsetX + (lng - params.minLng) * params.cosLat * params.scale,
        params.offsetY + (params.maxLat - lat) * params.scale
    ];
}

function viewportRect(map, params) {
    const bounds = map.getBounds();
    const [x1, y1] = projectWith(params, [bounds.getWest(), bounds.getNorth()]);
    const [x2, y2] = projectWith(params, [bounds.getEast(), bounds.getSouth()]);
    return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

function applyViewport(rect, map, params) {
    Object.entries(viewportRect(map, params)).forEach(([k, v]) => rect.setAttribute(k, v.toFixed(2)));
}

function viewportOverlay(size, map, params) {
    const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
    svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    const rect = el('rect', {
        class: 'feature-thumbnail-viewport',
        fill: VIEWPORT_FILL,
        stroke: VIEWPORT_STROKE,
        'stroke-width': 1
    });
    rect.style.cssText = 'pointer-events:all;cursor:grab;touch-action:none;';
    applyViewport(rect, map, params);
    svg.appendChild(rect);
    return svg;
}

function syncViewports(map) {
    document.querySelectorAll('.feature-thumbnail[data-projection]').forEach(box => {
        const rect = box.querySelector('.feature-thumbnail-viewport');
        if (!rect) return;
        try {
            applyViewport(rect, map, JSON.parse(box.dataset.projection));
        } catch (error) {
            return;
        }
    });
}

function bindDrag(map) {
    document.addEventListener('pointerdown', (down) => {
        const rect = down.target.closest?.('.feature-thumbnail-viewport');
        const box = rect?.closest('.feature-thumbnail[data-projection]');
        if (!box) return;

        let params;
        try {
            params = JSON.parse(box.dataset.projection);
        } catch (error) {
            return;
        }
        const startCenter = map.getCenter();
        let dragging = false;

        const move = (e) => {
            const dx = e.clientX - down.clientX;
            const dy = e.clientY - down.clientY;
            if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            dragging = true;
            rect.style.cursor = 'grabbing';
            map.jumpTo({
                center: [
                    startCenter.lng - dx / (params.scale * params.cosLat),
                    startCenter.lat + dy / params.scale
                ]
            });
        };
        const end = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
            rect.style.cursor = 'grab';
            if (!dragging) return;
            const swallow = (e) => e.stopPropagation();
            window.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', swallow, true), 0);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    }, true);
}

function bindLocatorClick(map) {
    const center = (e) => {
        const locator = e.target.closest?.('.feature-thumbnail-locator');
        if (!locator) return;
        e.stopPropagation();
        e.preventDefault();
        map.easeTo({ center: [parseFloat(locator.dataset.lng), parseFloat(locator.dataset.lat)] });
    };
    document.addEventListener('click', center, true);
    document.addEventListener('touchend', center, true);
}

function bindMap(map) {
    if (!map || boundMaps.has(map)) return;
    boundMaps.add(map);
    bindDrag(map);
    bindLocatorClick(map);
    let frame = null;
    map.on('move', () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = null;
            syncViewports(map);
        });
    });
}

function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([k, v]) => { if (v != null) node.setAttribute(k, v); });
    return node;
}

function pathData(rings, project, close) {
    return rings.map(ring => ring.map((p, i) => {
        const [x, y] = project(p);
        return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join('') + (close ? 'Z' : '')).join('');
}

function drawFigure(svg, shapes, project, size) {
    const scale = size / 40;
    const lineWidth = Math.max(1, 1.5 * scale);

    if (shapes.polygons.length) {
        svg.appendChild(el('path', {
            d: shapes.polygons.map(poly => pathData(poly, project, true)).join(''),
            'fill-rule': 'evenodd',
            fill: FIGURE_FILL,
            stroke: FIGURE_STROKE,
            'stroke-width': lineWidth,
            'stroke-linejoin': 'round'
        }));
    }

    if (shapes.lines.length) {
        svg.appendChild(el('path', {
            d: pathData(shapes.lines, project, false),
            fill: 'none',
            stroke: FIGURE_STROKE,
            'stroke-width': lineWidth,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
        }));
    }

    shapes.points.forEach(point => {
        const [cx, cy] = shapes.points.length === 1 ? [size / 2, size / 2] : project(point);
        svg.appendChild(el('circle', { cx, cy, r: Math.max(2, size * 0.1), fill: FIGURE_STROKE }));
    });
}

function pointMarker(size, lngLat, project) {
    const [cx, cy] = project ? project([lngLat.lng, lngLat.lat]) : [size / 2, size / 2];
    const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
    svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    const locator = el('circle', {
        class: 'feature-thumbnail-locator',
        'data-lng': lngLat.lng,
        'data-lat': lngLat.lat,
        cx, cy,
        r: size * POINT_RADIUS_RATIO,
        fill: 'black',
        stroke: 'white',
        'stroke-width': Math.max(1, size * POINT_STROKE_RATIO)
    });
    locator.style.cssText = 'pointer-events:all;cursor:pointer;';
    svg.appendChild(locator);
    return svg;
}

function shell(size) {
    const box = document.createElement('div');
    box.className = 'feature-thumbnail';
    box.style.cssText = `width:${size}px;height:${size}px;border-radius:5px;overflow:hidden;position:relative;flex:none;background:#fff;`;
    return box;
}

export class FeatureThumbnail {
    /**
     * @param {{lngLat?: {lng:number,lat:number}, tiles?: Array}} options -
     *   the clicked point, drawn as a black dot with a white outline, the raster tile images, and the
     *   map whose viewport is outlined and kept in sync as it moves
     */
    static generate(f, layerConfig, size = 28, options = {}) {
        if (f?.isRasterInspection) return FeatureThumbnail._raster(f, size, options);
        return FeatureThumbnail._vector(f, size, options) || FeatureThumbnail._fallback(layerConfig, size);
    }

    static _fallback(layerConfig, size) {
        if (!layerConfig) return null;
        const thumbnail = LayerThumbnail.generate(layerConfig, size, { interactive: false });
        thumbnail.style.borderRadius = '5px';
        thumbnail.style.margin = '0';
        return thumbnail;
    }

    static _vector(f, size, { lngLat, map } = {}) {
        const shapes = ringsOf(f.feature?.geometry);
        const project = makeProjector(shapes, size, lngLat ? [[lngLat.lng, lngLat.lat]] : []);
        if (!project) return null;

        const box = shell(size);
        const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
        drawFigure(svg, shapes, project, size);
        box.appendChild(svg);
        if (typeof map?.getBounds === 'function') {
            box.dataset.projection = JSON.stringify(project.params);
            box.appendChild(viewportOverlay(size, map, project.params));
            bindMap(map);
        }
        if (lngLat) box.appendChild(pointMarker(size, lngLat, project));
        return box;
    }

    static _raster(f, size, { lngLat, tiles = [], map } = {}) {
        const box = shell(size);
        if (f.pixelHex && !tiles.length) box.style.background = f.pixelHex;
        tiles.forEach(({ url, left, top, width }) => {
            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.draggable = false;
            img.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${width}px;max-width:none;`;
            box.appendChild(img);
        });
        box.appendChild(pointMarker(size, lngLat || f.lngLat, null));
        if (typeof map?.getBounds === 'function') bindMap(map);
        return box;
    }
}

import { collectStylePasses, resolveValue, extractIconUrl } from './layer-style-utils.js';
import { LayerThumbnail } from './layer-thumbnail.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PADDING_RATIO = 0.12;
const POINT_RADIUS = 0.5;
const POINT_STROKE = 0.5;

const COMPARATORS = {
    '==': (a, b) => a === b,
    '!=': (a, b) => a !== b,
    '>': (a, b) => a > b,
    '>=': (a, b) => a >= b,
    '<': (a, b) => a < b,
    '<=': (a, b) => a <= b
};

function evaluate(expr, props) {
    if (!Array.isArray(expr)) return expr;
    const [op, ...args] = expr;
    if (typeof op === 'number') return expr;
    const ev = (e) => evaluate(e, props);

    switch (op) {
        case 'literal': return args[0];
        case 'get': return props?.[args[0]];
        case 'has': return props != null && args[0] in props;
        case 'to-string': return String(ev(args[0]));
        case 'to-number': return Number(ev(args[0]));
        case '!': return !ev(args[0]);
        case 'all': return args.every(a => ev(a));
        case 'any': return args.some(a => ev(a));
        case 'coalesce': {
            for (const a of args) {
                const v = ev(a);
                if (v !== null && v !== undefined) return v;
            }
            return undefined;
        }
        case 'match': {
            const input = ev(args[0]);
            for (let i = 1; i < args.length - 1; i += 2) {
                const key = args[i];
                if (Array.isArray(key) ? key.includes(input) : key === input) return ev(args[i + 1]);
            }
            return ev(args[args.length - 1]);
        }
        case 'case': {
            for (let i = 0; i < args.length - 1; i += 2) {
                if (ev(args[i])) return ev(args[i + 1]);
            }
            return ev(args[args.length - 1]);
        }
        case 'step': {
            const input = Number(ev(args[0]));
            let picked = args[1];
            for (let i = 2; i < args.length - 1; i += 2) {
                if (input >= args[i]) picked = args[i + 1];
            }
            return ev(picked);
        }
        default:
            if (COMPARATORS[op]) return COMPARATORS[op](ev(args[0]), ev(args[1]));
            return undefined;
    }
}

function paint(value, props, fallback) {
    const evaluated = Array.isArray(value) && value[0] !== 'interpolate' ? evaluate(value, props) : value;
    const resolved = typeof evaluated === 'string' || typeof evaluated === 'number'
        ? evaluated
        : resolveValue(value, fallback);
    return resolved == null ? fallback : resolved;
}

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

    return ([lng, lat]) => [
        offsetX + (lng - minLng) * cosLat * scale,
        offsetY + (maxLat - lat) * scale
    ];
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

function drawVector(svg, passes, shapes, project, props, size) {
    const scale = size / 40;
    const hasPolygons = shapes.polygons.length > 0;

    if (hasPolygons) {
        passes.fill.forEach(pass => {
            const stroke = paint(pass.style['line-color'], props, pass.strokeColor);
            const strokeWidth = paint(pass.style['line-width'], props, pass.strokeWidth);
            svg.appendChild(el('path', {
                d: shapes.polygons.map(poly => pathData(poly, project, true)).join(''),
                'fill-rule': 'evenodd',
                fill: paint(pass.colorExpr, props, pass.color),
                'fill-opacity': paint(pass.style['fill-opacity'], props, pass.opacity),
                stroke: stroke || null,
                'stroke-width': stroke ? Math.max(0.5, Math.min((strokeWidth || 1) * scale, size * 0.08)) : null,
                'stroke-linejoin': 'round'
            }));
        });
    }

    const lineRings = [...shapes.lines, ...(hasPolygons && !passes.fill.length ? shapes.polygons.flat() : [])];
    if (lineRings.length) {
        passes.line.forEach(pass => {
            const dash = paint(pass.style['line-dasharray'], props, null);
            svg.appendChild(el('path', {
                d: pathData(lineRings, project, false),
                fill: 'none',
                stroke: paint(pass.colorExpr, props, pass.color),
                'stroke-opacity': paint(pass.style['line-opacity'], props, pass.opacity),
                'stroke-width': Math.max(1, Math.min(paint(pass.style['line-width'], props, pass.width) * scale, size * 0.14)),
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                'stroke-dasharray': Array.isArray(dash) ? dash.map(d => d * scale).join(' ') : null
            }));
        });
    }

    if (shapes.points.length) {
        passes.circle.forEach(pass => {
            const radius = Math.max(2, Math.min(paint(pass.style['circle-radius'], props, pass.radius) * scale * 1.5, size * 0.3));
            const strokeWidth = paint(pass.style['circle-stroke-width'], props, pass.strokeWidth);
            shapes.points.forEach(point => {
                const [cx, cy] = project(point);
                svg.appendChild(el('circle', {
                    cx: shapes.points.length === 1 ? size / 2 : cx,
                    cy: shapes.points.length === 1 ? size / 2 : cy,
                    r: radius,
                    fill: paint(pass.colorExpr, props, pass.color),
                    'fill-opacity': paint(pass.style['circle-opacity'], props, pass.opacity),
                    stroke: paint(pass.style['circle-stroke-color'], props, pass.strokeColor) || null,
                    'stroke-width': strokeWidth ? Math.max(0.5, strokeWidth * scale) : null
                }));
            });
        });
    }
}

function pointMarker(size, lngLat, project) {
    const [cx, cy] = project ? project([lngLat.lng, lngLat.lat]) : [size / 2, size / 2];
    const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
    svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    svg.appendChild(el('circle', {
        cx, cy,
        r: POINT_RADIUS,
        fill: 'black',
        stroke: 'black',
        'stroke-width': POINT_STROKE
    }));
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
     *   the clicked point, drawn as a black dot, and the raster tile images
     */
    static generate(f, layerConfig, size = 28, options = {}) {
        if (f?.isRasterInspection) return FeatureThumbnail._raster(f, size, options);
        return FeatureThumbnail._vector(f, layerConfig, size, options) || FeatureThumbnail._fallback(layerConfig, size);
    }

    static _fallback(layerConfig, size) {
        if (!layerConfig) return null;
        const thumbnail = LayerThumbnail.generate(layerConfig, size, { interactive: false });
        thumbnail.style.borderRadius = '5px';
        thumbnail.style.margin = '0';
        return thumbnail;
    }

    static _vector(f, layerConfig, size, { lngLat } = {}) {
        if (!layerConfig) return null;
        const props = f.feature?.properties || {};
        const style = layerConfig.style || layerConfig;
        const passes = collectStylePasses(style);
        const shapes = ringsOf(f.feature?.geometry);
        const project = makeProjector(shapes, size, lngLat ? [[lngLat.lng, lngLat.lat]] : []);
        if (!project) return null;

        const box = shell(size);
        const iconImage = passes.base['icon-image'] || layerConfig['icon-image'];
        const iconUrl = iconImage && extractIconUrl(evaluate(iconImage, props) ?? iconImage);
        const hasGeometryStyle = passes.fill.length || passes.line.length || passes.circle.length;

        if (iconUrl && !hasGeometryStyle) {
            box.style.background = `#fff center / 70% no-repeat url('${iconUrl}')`;
            return box;
        }
        if (!hasGeometryStyle) return null;

        const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
        drawVector(svg, passes, shapes, project, props, size);
        box.appendChild(svg);
        if (lngLat) box.appendChild(pointMarker(size, lngLat, project));
        return box;
    }

    static _raster(f, size, { lngLat, tiles = [] } = {}) {
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
        return box;
    }
}

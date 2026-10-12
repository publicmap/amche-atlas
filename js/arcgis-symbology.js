/**
 * Turns an ArcGIS layer's authored symbology (`drawingInfo` from a
 * FeatureServer / MapServer layer's `?f=json`) into this app's flat `style`.
 *
 *   simple      -> literal colours / widths
 *   uniqueValue -> a "match" per property on the renderer's field
 *   classBreaks -> a stepped expression per property on the renderer's field
 *
 * The expressions are the ones the style editor writes (js/style-expressions.js),
 * so the result opens straight in its By-data controls. Anything ArcGIS can draw
 * that Mapbox GL can't (hatch and picture fills, heatmaps, Arcade) is
 * approximated or skipped, and reported in `warnings` rather than dropped silently.
 */

import { buildCategorized, buildGraduated } from './style-expressions.js';
import { hatchImageName } from './hatch-patterns.js';

const POINTS_TO_PIXELS = 4 / 3;
const WEB_MERCATOR_512_SCALE = 591657550.5;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const DASH_PATTERNS = {
    esriSLSDash: [4, 3],
    esriSLSDot: [1, 2],
    esriSLSDashDot: [4, 2, 1, 2],
    esriSLSDashDotDot: [4, 2, 1, 2, 1, 2],
    esriSLSLongDash: [8, 3],
    esriSLSShortDash: [3, 2],
    esriSLSShortDot: [1, 1],
    esriSLSShortDashDot: [3, 2, 1, 2],
    esriSLSShortDashDotDot: [3, 2, 1, 2, 1, 2],
    esriSLSLongDashDot: [8, 3, 1, 3]
};

// ArcGIS line-hatch fills, drawn with Mapbox `fill-pattern` (js/hatch-patterns.js).
const HATCH_KINDS = {
    esriSFSHorizontal: 'horizontal',
    esriSFSVertical: 'vertical',
    esriSFSForwardDiagonal: 'forward-diagonal',
    esriSFSBackwardDiagonal: 'backward-diagonal',
    esriSFSCross: 'cross',
    esriSFSDiagonalCross: 'diagonal-cross'
};

const GEOMETRY_FAMILY = {
    esriGeometryPoint: 'point', esriGeometryMultipoint: 'point',
    esriGeometryPolyline: 'line', esriGeometryPolygon: 'area', esriGeometryEnvelope: 'area'
};

/** `[r, g, b, a]` (alpha 0-255) as a CSS colour. */
export function esriColor(color) {
    if (!Array.isArray(color) || color.length < 3) return null;
    const [r, g, b] = color.map(c => Math.max(0, Math.min(255, Math.round(c))));
    const alpha = color.length > 3 ? Math.max(0, Math.min(255, color[3])) / 255 : 1;
    if (alpha >= 0.995) return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
    return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

const pixels = (points) => Math.max(0.5, Math.round(points * POINTS_TO_PIXELS * 2) / 2);

/** Map zoom (512px tiles) at which an ArcGIS scale denominator is shown. */
export function scaleToZoom(scale) {
    return Math.round(Math.log2(WEB_MERCATOR_512_SCALE / scale) * 10) / 10;
}

/**
 * The paint properties one symbol contributes. `notes` collects what was
 * approximated so the caller can report it once.
 */
function symbolProperties(symbol, family, notes) {
    const props = {};
    if (!symbol) return props;
    const outline = symbol.outline && symbol.outline.style !== 'esriSLSNull' ? symbol.outline : null;

    if (family === 'area') {
        const hatch = HATCH_KINDS[symbol.style];
        const hollow = symbol.style === 'esriSFSNull' || !!hatch;
        if (symbol.style && !hatch && !['esriSFSSolid', 'esriSFSNull'].includes(symbol.style)) notes.add('pattern fills are drawn solid');
        if (symbol.type === 'esriPFS') notes.add('picture fills are drawn as a flat colour');
        // A hatch is lines over no background, so the plain fill is transparent
        // and the pattern - a separate overlay layer - supplies the lines.
        if (hatch) props.hatch = hatchImageName({ kind: hatch, color: esriColor(symbol.color) || '#000000' });
        props['fill-color'] = hollow ? TRANSPARENT : esriColor(symbol.color) || TRANSPARENT;
        props['line-color'] = outline ? esriColor(outline.color) || TRANSPARENT : TRANSPARENT;
        props['line-width'] = outline ? pixels(outline.width ?? 1) : 0;
        if (outline && DASH_PATTERNS[outline.style]) props['line-dasharray'] = DASH_PATTERNS[outline.style];
    } else if (family === 'line') {
        props['line-color'] = esriColor(symbol.color) || TRANSPARENT;
        props['line-width'] = pixels(symbol.width ?? 1);
        if (DASH_PATTERNS[symbol.style]) props['line-dasharray'] = DASH_PATTERNS[symbol.style];
    } else {
        if (symbol.type === 'esriPMS') notes.add('picture markers are drawn as circles');
        if (symbol.style && !['esriSMSCircle', undefined].includes(symbol.style)) notes.add('marker shapes are drawn as circles');
        props['circle-color'] = esriColor(symbol.color) || TRANSPARENT;
        props['circle-radius'] = Math.max(1, Math.round(((symbol.size ?? 6) * POINTS_TO_PIXELS) / 2 * 2) / 2);
        props['circle-stroke-color'] = outline ? esriColor(outline.color) || TRANSPARENT : TRANSPARENT;
        props['circle-stroke-width'] = outline ? pixels(outline.width ?? 1) : 0;
    }
    return props;
}

// Features that match no class aren't drawn in ArcGIS, so a missing default
// symbol means "nothing": transparent colours, zero widths.
function nothingFor(key) {
    return /-color$/.test(key) ? TRANSPARENT : 0;
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Combine the per-class properties into one style: a literal where every class
 * agrees, otherwise an expression keyed on the renderer's field.
 */
function combine(classes, defaultProps, keyBuilder, notes) {
    const keys = new Set([...classes.flatMap(c => Object.keys(c.props)), ...Object.keys(defaultProps)]);
    keys.delete('hatch');
    const style = {};
    keys.forEach(key => {
        const values = classes.map(c => c.props[key]);
        const fallback = defaultProps[key] !== undefined ? defaultProps[key] : nothingFor(key);
        if (values.every(v => sameValue(v, values[0])) && (defaultProps[key] === undefined || sameValue(defaultProps[key], values[0]))) {
            style[key] = values[0];
        } else if (key === 'line-dasharray') {
            style[key] = defaultProps[key] || values.find(Boolean);
            notes.add('dash patterns that differ per class use one pattern');
        } else {
            style[key] = keyBuilder(classes.map((c, i) => ({ ...c, output: values[i] ?? nothingFor(key) })), fallback);
        }
    });
    return style;
}

function uniqueValueStyle(renderer, family, notes) {
    const fields = [renderer.field1, renderer.field2, renderer.field3].filter(Boolean);
    const delimiter = renderer.fieldDelimiter || ', ';
    const input = fields.length === 1
        ? ['to-string', ['get', fields[0]]]
        : ['concat', ...fields.flatMap((f, i) => (i ? [delimiter, ['to-string', ['get', f]]] : [['to-string', ['get', f]]]))];

    const classes = (renderer.uniqueValueInfos || []).map(info => ({
        value: String(info.value), props: symbolProperties(info.symbol, family, notes)
    }));
    const defaults = symbolProperties(renderer.defaultSymbol, family, notes);

    const style = combine(classes, defaults, (items, fallback) => {
        const match = buildCategorized({
            field: fields[0], fallback,
            categories: items.map(({ value, output }) => ({ value, output }))
        });
        // Several fields match on their joined text, which the by-data editor opens as JSON.
        return Array.isArray(match) && fields.length > 1 ? [match[0], input, ...match.slice(2)] : match;
    }, notes);

    // Hatched classes get a second layer limited to just those values, drawing
    // each class's own pattern over the (transparent) plain fill.
    const hatched = classes.filter(c => c.props.hatch);
    const overlay = hatched.length ? {
        'hatch/filter': ['in', input, ['literal', hatched.map(c => c.value)]],
        'hatch/fill-pattern': ['match', input, ...hatched.flatMap(c => [c.value, c.props.hatch]), hatched[0].props.hatch]
    } : {};
    return { style, overlay, summary: `Unique values on ${fields.join(' + ')} (${classes.length} categories)` };
}

function classBreaksStyle(renderer, family, notes) {
    const infos = renderer.classBreakInfos || [];
    const classes = infos.map(info => ({ max: info.classMaxValue, props: symbolProperties(info.symbol, family, notes) }));
    const defaults = symbolProperties(renderer.defaultSymbol, family, notes);
    const breaks = classes.slice(0, -1).map(c => c.max);

    const style = combine(classes, defaults, (items, fallback) => buildGraduated({
        field: renderer.field, kind: 'step', breaks, outputs: items.map(i => i.output), fallback
    }), notes);

    const hatched = classes.filter(c => c.props.hatch);
    const input = ['get', renderer.field];
    const stepOver = (outputs) => ['step', input, outputs[0], ...breaks.flatMap((b, i) => [b, outputs[i + 1]])];
    const overlay = hatched.length ? {
        'hatch/filter': ['all', ['==', ['typeof', input], 'number'], ['==', stepOver(classes.map(c => (c.props.hatch ? 1 : 0))), 1]],
        'hatch/fill-pattern': stepOver(classes.map(c => c.props.hatch || hatched[0].props.hatch))
    } : {};
    return { style, overlay, summary: `Graduated on ${renderer.field} (${classes.length} classes)` };
}

function labelStyle(labelingInfo) {
    const label = Array.isArray(labelingInfo) ? labelingInfo.find(l => l.labelExpression || l.labelExpressionInfo) : null;
    if (!label) return {};

    const text = label.labelExpression || label.labelExpressionInfo?.expression || '';
    const field = (/^\s*\[([^\]]+)\]\s*$/.exec(text) || /^\s*\$feature(?:\.([\w]+)|\["([^"]+)"\])\s*$/.exec(text) || []).slice(1).find(Boolean);
    if (!field) return {};

    const style = { 'text-field': ['to-string', ['get', field]] };
    const symbol = label.symbol || {};
    const color = esriColor(symbol.color);
    if (color) style['text-color'] = color;
    if (symbol.font && symbol.font.size) style['text-size'] = Math.round(symbol.font.size * POINTS_TO_PIXELS);
    return style;
}

/**
 * @param {Object} drawingInfo - The layer's `drawingInfo`
 * @param {string} geometryType - e.g. 'esriGeometryPolygon'
 * @param {Object} [layer] - The layer JSON, for its scale range
 * @returns {{style: Object, summary: string, warnings: string[], minzoom?: number, maxzoom?: number}|null}
 *          null when the layer carries no usable renderer
 */
export function drawingInfoToStyle(drawingInfo, geometryType, layer = {}) {
    const renderer = drawingInfo && drawingInfo.renderer;
    const family = GEOMETRY_FAMILY[geometryType];
    if (!renderer || !family) return null;

    const notes = new Set();
    let converted;
    if (renderer.type === 'simple') {
        const props = symbolProperties(renderer.symbol, family, notes);
        const { hatch, ...plain } = props;
        converted = { style: hatch ? { ...plain, 'fill-pattern': hatch } : plain, summary: 'Single symbol' };
    } else if (renderer.type === 'uniqueValue') {
        converted = uniqueValueStyle(renderer, family, notes);
    } else if (renderer.type === 'classBreaks') {
        converted = classBreaksStyle(renderer, family, notes);
    } else {
        return { style: null, summary: '', warnings: [`${renderer.type} renderers can't be converted`] };
    }

    // Colours already carry their own alpha, so the layer defaults' translucent
    // fills would dim them a second time; only the layer's transparency applies.
    const opacity = Math.round((1 - (drawingInfo.transparency || 0) / 100) * 100) / 100;
    // Overlay keys come first: the renderer stacks style variants in reverse key
    // order, so this puts the hatch layer above the plain fill.
    const overlay = converted.overlay || {};
    if (overlay['hatch/fill-pattern']) overlay['hatch/fill-opacity'] = opacity;
    const style = { ...overlay, ...converted.style };
    if (family === 'area') { style['fill-opacity'] = opacity; style['line-opacity'] = opacity; }
    if (family === 'line') style['line-opacity'] = opacity;
    if (family === 'point') { style['circle-opacity'] = opacity; style['circle-stroke-opacity'] = opacity; }
    Object.assign(style, labelStyle(drawingInfo.labelingInfo));

    const result = { style, summary: converted.summary, warnings: [...notes] };
    if (layer.minScale > 0) result.minzoom = Math.max(0, scaleToZoom(layer.minScale));
    if (layer.maxScale > 0) result.maxzoom = Math.min(22, scaleToZoom(layer.maxScale));
    return result;
}

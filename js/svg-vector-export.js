/**
 * Rebuilds the atlas's own overlay layers (fill/line/circle/symbol-text) as
 * real SVG <path>/<circle>/<text> elements instead of relying on a rasterized
 * canvas snapshot for them. Used by MapExportControl._exportSVG so the
 * resulting file can be edited (paths and labels selected/moved/recolored)
 * in Inkscape or similar vector editors.
 *
 * The basemap and any raster/hillshade/heatmap layers are intentionally left
 * out of scope and stay part of the rasterized background image — only the
 * layers the atlas itself renders (the ones toggled in the layer control)
 * are vectorized.
 */

import { geoPath, geoTransform } from 'd3-geo';

const MAX_FEATURES_PER_LAYER = 8000;

const KNOWN_OPERATORS = new Set([
    'literal', 'get', 'has', 'feature-state', 'zoom', 'id', 'geometry-type', 'properties',
    'to-string', 'to-number', 'to-boolean', 'boolean', '!', '==', '!=', '<', '<=', '>', '>=',
    'all', 'any', 'coalesce', 'case', 'match', 'step', 'interpolate', 'format'
]);

const ANCHOR_MAP = {
    center: { anchor: 'middle', baseline: 'central' },
    left: { anchor: 'start', baseline: 'central' },
    right: { anchor: 'end', baseline: 'central' },
    top: { anchor: 'middle', baseline: 'hanging' },
    bottom: { anchor: 'middle', baseline: 'alphabetic' },
    'top-left': { anchor: 'start', baseline: 'hanging' },
    'top-right': { anchor: 'end', baseline: 'hanging' },
    'bottom-left': { anchor: 'start', baseline: 'alphabetic' },
    'bottom-right': { anchor: 'end', baseline: 'alphabetic' }
};

/**
 * Evaluates a (small, practical subset of a) Mapbox GL style expression.
 * Plain literal values/arrays (e.g. text-offset [0,-0.4], text-font
 * ["Open Sans Bold"]) are returned as-is — only arrays whose first element
 * is a recognized operator name are treated as expressions.
 */
export function evaluateExpression(expr, ctx) {
    if (!Array.isArray(expr)) return expr;
    const [op, ...args] = expr;
    if (typeof op !== 'string' || !KNOWN_OPERATORS.has(op)) {
        return expr;
    }

    const ev = (e) => evaluateExpression(e, ctx);

    switch (op) {
        case 'literal':
            return args[0];
        case 'get': {
            const key = ev(args[0]);
            const obj = args.length > 1 ? ev(args[1]) : (ctx.feature && ctx.feature.properties) || {};
            return obj ? obj[key] : undefined;
        }
        case 'has': {
            const key = ev(args[0]);
            const obj = args.length > 1 ? ev(args[1]) : (ctx.feature && ctx.feature.properties) || {};
            return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
        }
        case 'feature-state': {
            const key = ev(args[0]);
            return ctx.featureState ? ctx.featureState[key] : undefined;
        }
        case 'zoom':
            return ctx.zoom;
        case 'id':
            return ctx.feature ? ctx.feature.id : undefined;
        case 'geometry-type':
            return ctx.feature && ctx.feature.geometry ? ctx.feature.geometry.type : undefined;
        case 'properties':
            return (ctx.feature && ctx.feature.properties) || {};
        case 'to-string': {
            const v = ev(args[0]);
            return v === undefined || v === null ? '' : String(v);
        }
        case 'to-number': {
            const v = Number(ev(args[0]));
            if (!Number.isNaN(v)) return v;
            return args[1] !== undefined ? ev(args[1]) : 0;
        }
        case 'to-boolean': {
            const v = ev(args[0]);
            return !!v && v !== 'false';
        }
        case 'boolean': {
            for (const a of args) {
                const v = ev(a);
                if (typeof v === 'boolean') return v;
            }
            return false;
        }
        case '!':
            return !ev(args[0]);
        case '==':
            return ev(args[0]) === ev(args[1]);
        case '!=':
            return ev(args[0]) !== ev(args[1]);
        case '<':
            return ev(args[0]) < ev(args[1]);
        case '<=':
            return ev(args[0]) <= ev(args[1]);
        case '>':
            return ev(args[0]) > ev(args[1]);
        case '>=':
            return ev(args[0]) >= ev(args[1]);
        case 'all':
            return args.every(a => ev(a));
        case 'any':
            return args.some(a => ev(a));
        case 'coalesce': {
            for (const a of args) {
                const v = ev(a);
                if (v !== null && v !== undefined) return v;
            }
            return null;
        }
        case 'case': {
            for (let i = 0; i < args.length - 1; i += 2) {
                if (ev(args[i])) return ev(args[i + 1]);
            }
            return args.length % 2 === 1 ? ev(args[args.length - 1]) : undefined;
        }
        case 'match': {
            const input = ev(args[0]);
            for (let i = 1; i < args.length - 1; i += 2) {
                const labels = args[i];
                const labelList = Array.isArray(labels) ? labels : [labels];
                if (labelList.includes(input)) return ev(args[i + 1]);
            }
            return args.length % 2 === 0 ? ev(args[args.length - 1]) : undefined;
        }
        case 'step': {
            const input = ev(args[0]);
            let result = ev(args[1]);
            for (let i = 2; i < args.length - 1; i += 2) {
                if (input >= ev(args[i])) {
                    result = ev(args[i + 1]);
                } else {
                    break;
                }
            }
            return result;
        }
        case 'interpolate': {
            const input = ev(args[1]);
            const stopPairs = [];
            for (let i = 2; i < args.length; i += 2) {
                stopPairs.push([ev(args[i]), args[i + 1]]);
            }
            if (!stopPairs.length) return undefined;
            if (input <= stopPairs[0][0]) return ev(stopPairs[0][1]);
            for (let i = 0; i < stopPairs.length - 1; i++) {
                const [s0, o0] = stopPairs[i];
                const [s1, o1] = stopPairs[i + 1];
                if (input >= s0 && input <= s1) {
                    const out0 = ev(o0);
                    const out1 = ev(o1);
                    if (typeof out0 === 'number' && typeof out1 === 'number') {
                        const t = s1 === s0 ? 0 : (input - s0) / (s1 - s0);
                        return out0 + (out1 - out0) * t;
                    }
                    return out1;
                }
            }
            return ev(stopPairs[stopPairs.length - 1][1]);
        }
        case 'format': {
            // ["format", content1, options1, content2, options2, ...] — the
            // per-section styling options are ignored; sections are just
            // concatenated into plain text.
            let result = '';
            for (let i = 0; i < args.length; i += 2) {
                const value = ev(args[i]);
                result += (value === undefined || value === null) ? '' : String(value);
            }
            return result;
        }
        default:
            return undefined;
    }
}

function getRawStyleValue(map, layerId, kind, prop) {
    try {
        return kind === 'paint' ? map.getPaintProperty(layerId, prop) : map.getLayoutProperty(layerId, prop);
    } catch (e) {
        return undefined;
    }
}

// A layer's raw paint/layout value (the style-spec literal or expression)
// is the same for every feature — only its *evaluation* is per-feature.
// Fetching it via map.getPaintProperty()/getLayoutProperty() inside the
// per-feature loop (as this module used to) turns into tens of thousands
// of redundant calls for a real-world layer with thousands of features,
// which is what made large layers (e.g. a city cadastral/parcels layer)
// slow enough to stall the export. Callers fetch each raw value once per
// layer via getLayerRawStyle() and evaluate it per feature with evalRaw().
function getLayerRawStyle(map, layer, specs) {
    const raw = {};
    for (const [kind, prop] of specs) {
        raw[prop] = getRawStyleValue(map, layer.id, kind, prop);
    }
    return raw;
}

function evalRaw(raw, ctx, fallback) {
    if (raw === undefined) return fallback;
    try {
        const value = evaluateExpression(raw, ctx);
        return value === undefined || value === null ? fallback : value;
    } catch (e) {
        return fallback;
    }
}

function getFeatureState(map, layer, feature) {
    if (feature.id === undefined || feature.id === null) return {};
    try {
        return map.getFeatureState({
            source: layer.source,
            sourceLayer: layer['source-layer'],
            id: feature.id
        }) || {};
    } catch (e) {
        return {};
    }
}

function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    }[c]));
}

function fmt(n) {
    return Math.round(n * 100) / 100;
}

// map.project() returns Number.MAX_VALUE (not Infinity/NaN, so it passes a
// plain isFinite check) as a sentinel for points it can't meaningfully
// project — e.g. beyond the horizon at a pitched camera. Reject anything
// past a generous real-world pixel range too, not just non-finite values.
const MAX_VALID_PROJECTED_COORD = 1e7;

function isValidProjectedCoord(v) {
    return Number.isFinite(v) && Math.abs(v) <= MAX_VALID_PROJECTED_COORD;
}

function projectPoint(map, lngLat, scaleFactor) {
    const p = map.project(lngLat);
    if (!isValidProjectedCoord(p.x) || !isValidProjectedCoord(p.y)) return null;
    return { x: p.x * scaleFactor, y: p.y * scaleFactor };
}

/**
 * A d3-geo path generator whose "projection" is just map.project() wrapped
 * via geoTransform — the standard way to let d3-geo's geoPath (ring closing,
 * holes, multi-part geometries) drive a non-geographic, already-projected
 * point source like a Mapbox/Leaflet map instead of a real d3 projection.
 */
function createPathGenerator(map, scaleFactor) {
    return geoPath(geoTransform({
        point(lng, lat) {
            const p = map.project([lng, lat]);
            if (isValidProjectedCoord(p.x) && isValidProjectedCoord(p.y)) {
                this.stream.point(p.x * scaleFactor, p.y * scaleFactor);
            }
        }
    }));
}

/**
 * Style layers among activeLayerIds that can be redrawn as real vector
 * shapes, in the same bottom-to-top order Mapbox renders them in.
 */
export function getVectorLayers(map, activeLayerIds) {
    const styleLayers = (map.getStyle() || {}).layers || [];
    return styleLayers.filter(l =>
        activeLayerIds.has(l.id) &&
        (l.type === 'fill' || l.type === 'line' || l.type === 'circle' || l.type === 'symbol')
    );
}

/**
 * Must be called while the layers are still visible/rendered (i.e. before
 * hideVectorLayersForRaster runs), so queryRenderedFeatures actually returns
 * their features.
 */
export function captureVectorLayers(map, layers) {
    return layers
        .map(layer => {
            let features = map.queryRenderedFeatures({ layers: [layer.id] });
            if (features.length > MAX_FEATURES_PER_LAYER) {
                console.warn(`[SVG export] Layer "${layer.id}" has ${features.length} features; truncating to ${MAX_FEATURES_PER_LAYER} for vector export.`);
                features = features.slice(0, MAX_FEATURES_PER_LAYER);
            }
            return { layer, features };
        })
        .filter(entry => entry.features.length > 0);
}

/**
 * Removes captured layers from the next rendered frame so the raster
 * snapshot doesn't duplicate what we're about to redraw as real vectors.
 * Fill/line/circle layers are hidden outright; symbol layers only have their
 * text suppressed so any icon stays part of the raster background (icons
 * aren't vectorized). Returns a function that undoes the change.
 */
export function hideVectorLayersForRaster(map, captured) {
    const touched = [];
    for (const { layer } of captured) {
        if (layer.type === 'symbol') {
            map.setPaintProperty(layer.id, 'text-opacity', 0);
            touched.push({ id: layer.id, prop: 'text-opacity', kind: 'paint' });
        } else {
            map.setLayoutProperty(layer.id, 'visibility', 'none');
            touched.push({ id: layer.id, prop: 'visibility', kind: 'layout' });
        }
    }
    return function restore() {
        for (const { id, prop, kind } of touched) {
            if (kind === 'paint') {
                map.setPaintProperty(id, prop, undefined);
            } else {
                map.setLayoutProperty(id, prop, undefined);
            }
        }
    };
}

function buildFillElement(feature, ctx, rawStyle, pathGenerator) {
    const geom = feature.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return '';

    const d = pathGenerator(feature);
    if (!d) return '';

    const fillColor = evalRaw(rawStyle['fill-color'], ctx, '#888888');
    const fillOpacity = evalRaw(rawStyle['fill-opacity'], ctx, 1);

    return `<path d="${d}" fill="${escapeXml(fillColor)}" fill-opacity="${fmt(fillOpacity)}" fill-rule="evenodd" stroke="none" />`;
}

const LINE_RENDERABLE_GEOMETRY_TYPES = new Set([
    'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'
]);

function buildLineElement(feature, ctx, scaleFactor, rawStyle, pathGenerator) {
    const geom = feature.geometry;
    // A Mapbox 'line' layer commonly strokes a Polygon's ring boundaries
    // (e.g. an administrative-boundary outline drawn over the same source
    // as its fill) — not just LineString data.
    if (!geom || !LINE_RENDERABLE_GEOMETRY_TYPES.has(geom.type)) return '';

    const d = pathGenerator(feature);
    if (!d) return '';

    const lineColor = evalRaw(rawStyle['line-color'], ctx, '#000000');
    const lineWidth = Number(evalRaw(rawStyle['line-width'], ctx, 1));
    const lineOpacity = evalRaw(rawStyle['line-opacity'], ctx, 1);
    const lineCap = evalRaw(rawStyle['line-cap'], ctx, 'butt');
    const lineJoin = evalRaw(rawStyle['line-join'], ctx, 'miter');
    const dashArray = evalRaw(rawStyle['line-dasharray'], ctx, null);

    const strokeWidth = lineWidth * scaleFactor;
    const dashAttr = Array.isArray(dashArray)
        ? ` stroke-dasharray="${dashArray.map(v => fmt(v * strokeWidth)).join(',')}"`
        : '';

    return `<path d="${d}" fill="none" stroke="${escapeXml(lineColor)}" stroke-width="${fmt(strokeWidth)}" ` +
        `stroke-opacity="${fmt(lineOpacity)}" stroke-linecap="${escapeXml(lineCap)}" stroke-linejoin="${escapeXml(lineJoin)}"${dashAttr} />`;
}

function buildCircleElement(map, feature, ctx, scaleFactor, rawStyle) {
    const geom = feature.geometry;
    if (!geom) return '';
    const points = geom.type === 'Point' ? [geom.coordinates]
        : geom.type === 'MultiPoint' ? geom.coordinates
            : null;
    if (!points) return '';

    const radius = Number(evalRaw(rawStyle['circle-radius'], ctx, 5));
    const color = evalRaw(rawStyle['circle-color'], ctx, '#000000');
    const opacity = evalRaw(rawStyle['circle-opacity'], ctx, 1);
    const strokeColor = evalRaw(rawStyle['circle-stroke-color'], ctx, null);
    const strokeWidth = Number(evalRaw(rawStyle['circle-stroke-width'], ctx, 0));
    const strokeOpacity = evalRaw(rawStyle['circle-stroke-opacity'], ctx, 1);

    return points.map(coord => {
        const p = projectPoint(map, coord, scaleFactor);
        if (!p) return '';
        const strokeAttr = strokeColor
            ? ` stroke="${escapeXml(strokeColor)}" stroke-width="${fmt(strokeWidth * scaleFactor)}" stroke-opacity="${fmt(strokeOpacity)}"`
            : '';
        return `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(radius * scaleFactor)}" fill="${escapeXml(color)}" fill-opacity="${fmt(opacity)}"${strokeAttr} />`;
    }).join('');
}

function fontAttrsFromTextFont(fontList) {
    const names = Array.isArray(fontList) ? fontList : [String(fontList)];
    const first = names[0] || 'sans-serif';
    const bold = /bold/i.test(first);
    const italic = /italic/i.test(first);
    const family = first.replace(/\s*(bold|italic)\s*/gi, '').trim() || 'sans-serif';
    return {
        fontFamily: `'${family}', sans-serif`,
        fontWeight: bold ? 'bold' : 'normal',
        fontStyle: italic ? 'italic' : 'normal'
    };
}

function wrapText(text, maxWidthEm) {
    if (!maxWidthEm || maxWidthEm <= 0) return [text];
    const approxCharsPerLine = Math.max(4, Math.round(maxWidthEm / 0.55));
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > approxCharsPerLine && current) {
            lines.push(current);
            current = word;
        } else {
            current = candidate;
        }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [text];
}

function buildTextElement(map, pathGenerator, feature, ctx, scaleFactor, rawStyle) {
    const geom = feature.geometry;
    if (!geom) return '';

    let anchorPoints;
    if (geom.type === 'Point' || geom.type === 'MultiPoint') {
        const coords = geom.type === 'Point' ? [geom.coordinates] : geom.coordinates;
        anchorPoints = coords.map(coord => projectPoint(map, coord, scaleFactor)).filter(Boolean);
    } else if (LINE_RENDERABLE_GEOMETRY_TYPES.has(geom.type)) {
        // A Polygon/LineString symbol layer (e.g. a ward-boundary label)
        // gets one label at a representative point, same as Mapbox — not
        // one per vertex.
        const c = pathGenerator.centroid(feature);
        anchorPoints = (Number.isFinite(c[0]) && Number.isFinite(c[1])) ? [{ x: c[0], y: c[1] }] : [];
    } else {
        anchorPoints = [];
    }
    if (!anchorPoints.length) return '';

    const textFieldRaw = evalRaw(rawStyle['text-field'], ctx, '');
    const text = (textFieldRaw === undefined || textFieldRaw === null ? '' : String(textFieldRaw)).trim();
    if (!text) return '';

    const textSize = Number(evalRaw(rawStyle['text-size'], ctx, 16)) * scaleFactor;
    const textColor = evalRaw(rawStyle['text-color'], ctx, '#000000');
    const textOpacity = evalRaw(rawStyle['text-opacity'], ctx, 1);
    const haloColor = evalRaw(rawStyle['text-halo-color'], ctx, null);
    const haloWidth = Number(evalRaw(rawStyle['text-halo-width'], ctx, 0));
    const textFont = evalRaw(rawStyle['text-font'], ctx, ['sans-serif']);
    const anchorKey = evalRaw(rawStyle['text-anchor'], ctx, 'center');
    const offset = evalRaw(rawStyle['text-offset'], ctx, [0, 0]);
    const lineHeight = Number(evalRaw(rawStyle['text-line-height'], ctx, 1.2));
    const maxWidth = Number(evalRaw(rawStyle['text-max-width'], ctx, 10));
    const transform = evalRaw(rawStyle['text-transform'], ctx, 'none');

    const displayText = transform === 'uppercase' ? text.toUpperCase()
        : transform === 'lowercase' ? text.toLowerCase()
            : text;

    const { anchor, baseline } = ANCHOR_MAP[anchorKey] || ANCHOR_MAP.center;
    const { fontFamily, fontWeight, fontStyle } = fontAttrsFromTextFont(textFont);

    const offsetXPx = (Array.isArray(offset) ? offset[0] : 0) * textSize;
    const offsetYPx = (Array.isArray(offset) ? offset[1] : 0) * textSize;

    const lines = wrapText(displayText, maxWidth);
    const startDy = anchorKey.includes('bottom') ? -(lines.length - 1) * lineHeight
        : anchorKey.includes('top') ? 0
            : -((lines.length - 1) / 2) * lineHeight;

    const haloAttrs = haloColor
        ? ` stroke="${escapeXml(haloColor)}" stroke-width="${fmt(haloWidth * 2 * scaleFactor)}" paint-order="stroke fill" stroke-linejoin="round"`
        : '';

    return anchorPoints.map(p => {
        const x = fmt(p.x + offsetXPx);
        const y = fmt(p.y + offsetYPx);
        const tspans = lines.map((line, i) =>
            `<tspan x="${x}" dy="${i === 0 ? fmt(startDy) : fmt(lineHeight)}em">${escapeXml(line)}</tspan>`
        ).join('');
        return `<text x="${x}" y="${y}" font-family="${escapeXml(fontFamily)}" font-size="${fmt(textSize)}" ` +
            `font-weight="${fontWeight}" font-style="${fontStyle}" fill="${escapeXml(textColor)}" fill-opacity="${fmt(textOpacity)}" ` +
            `text-anchor="${anchor}" dominant-baseline="${baseline}"${haloAttrs}>${tspans}</text>`;
    }).join('');
}

const STYLE_SPECS_BY_TYPE = {
    fill: [['paint', 'fill-color'], ['paint', 'fill-opacity']],
    line: [
        ['paint', 'line-color'], ['paint', 'line-width'], ['paint', 'line-opacity'],
        ['layout', 'line-cap'], ['layout', 'line-join'], ['paint', 'line-dasharray']
    ],
    circle: [
        ['paint', 'circle-radius'], ['paint', 'circle-color'], ['paint', 'circle-opacity'],
        ['paint', 'circle-stroke-color'], ['paint', 'circle-stroke-width'], ['paint', 'circle-stroke-opacity']
    ],
    symbol: [
        ['layout', 'text-field'], ['layout', 'text-size'], ['paint', 'text-color'], ['paint', 'text-opacity'],
        ['paint', 'text-halo-color'], ['paint', 'text-halo-width'], ['layout', 'text-font'],
        ['layout', 'text-anchor'], ['layout', 'text-offset'], ['layout', 'text-line-height'],
        ['layout', 'text-max-width'], ['layout', 'text-transform']
    ]
};

/**
 * Builds a single <g> of real vector elements (paths/circles/text) for the
 * captured layers, in the same order they were rendered by the map so
 * z-order matches. scaleFactor converts CSS-pixel map.project() coordinates
 * into the device-pixel space of the raster background image (i.e. the
 * ratio between the exported canvas's actual pixel size and its CSS size).
 */
export function buildVectorSVGGroup(map, captured, scaleFactor) {
    const zoom = map.getZoom();
    const pathGenerator = createPathGenerator(map, scaleFactor);
    const parts = ['<g id="amche-vector-overlay">'];

    for (const { layer, features } of captured) {
        const rawStyle = getLayerRawStyle(map, layer, STYLE_SPECS_BY_TYPE[layer.type] || []);
        const layerMarkup = [];
        for (const feature of features) {
            const ctx = {
                zoom,
                feature,
                featureState: getFeatureState(map, layer, feature)
            };
            try {
                let markup = '';
                switch (layer.type) {
                    case 'fill':
                        markup = buildFillElement(feature, ctx, rawStyle, pathGenerator);
                        break;
                    case 'line':
                        markup = buildLineElement(feature, ctx, scaleFactor, rawStyle, pathGenerator);
                        break;
                    case 'circle':
                        markup = buildCircleElement(map, feature, ctx, scaleFactor, rawStyle);
                        break;
                    case 'symbol':
                        markup = buildTextElement(map, pathGenerator, feature, ctx, scaleFactor, rawStyle);
                        break;
                }
                if (markup) layerMarkup.push(markup);
            } catch (e) {
                console.warn(`[SVG export] Failed to vectorize a feature in layer "${layer.id}"`, e);
            }
        }
        if (layerMarkup.length) {
            parts.push(`<g data-layer-id="${escapeXml(layer.id)}">${layerMarkup.join('')}</g>`);
        }
    }

    parts.push('</g>');
    return parts.join('');
}

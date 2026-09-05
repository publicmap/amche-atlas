/**
 * Shared style parsing for legends and thumbnails.
 *
 * A layer style is rarely a flat set of paint properties:
 *  - "prefix/property" keys split the style into ordered variants, each drawn
 *    as its own map layer (see MapboxAPI._parseStyleVariants). Cased route
 *    lines, direction arrows and waypoint circles are expressed this way.
 *  - values are Mapbox expressions (match / case / step / interpolate /
 *    coalesce) rather than literals.
 *
 * These helpers flatten both forms into concrete drawing passes so a swatch
 * can be drawn to look like what the map actually renders.
 */

const EXPRESSION_OPERATORS = new Set([
    'get', 'has', 'id', 'zoom', 'properties', 'geometry-type', 'feature-state',
    'literal', 'at', 'in', 'index-of', 'length', 'slice',
    'linear', 'exponential', 'cubic-bezier',
    'to-string', 'to-number', 'to-boolean', 'to-color', 'to-rgba',
    'string', 'number', 'boolean', 'object', 'array', 'collator', 'format', 'image',
    'match', 'case', 'step', 'interpolate', 'coalesce', 'concat', 'let', 'var',
    'all', 'any', '!', '==', '!=', '>', '<', '>=', '<=',
    '+', '-', '*', '/', '%', '^', 'min', 'max', 'abs', 'round', 'floor', 'ceil'
]);

const ZOOM_STOP_OPERATORS = new Set(['interpolate', 'interpolate-hcl', 'interpolate-lab']);

/**
 * Split a style object on "prefix/property" keys into ordered variants.
 * Mirrors MapboxAPI._parseStyleVariants: the first prefix encountered in
 * reverse key iteration is the bottom-most variant, later entries draw on top.
 * @param {Object} style
 * @returns {Array<{prefix: string, style: Object}>}
 */
export function parseStyleVariants(style) {
    if (!style || typeof style !== 'object') return [{ prefix: '', style: {} }];

    const order = [];
    const byPrefix = new Map();
    const keys = Object.keys(style);

    for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        const slashIdx = key.indexOf('/');
        const prefix = slashIdx > 0 ? key.substring(0, slashIdx) : '';
        const prop = slashIdx > 0 ? key.substring(slashIdx + 1) : key;

        if (!byPrefix.has(prefix)) {
            byPrefix.set(prefix, {});
            order.push(prefix);
        }
        byPrefix.get(prefix)[prop] = style[key];
    }

    return order.map(prefix => ({ prefix, style: byPrefix.get(prefix) }));
}

/**
 * Does a match expression key select the given branch key? Keys can be single
 * values or arrays of alternatives on either side ("motorway" vs
 * ["motorway", "trunk"]), so any overlap counts as a hit.
 */
function keyMatches(exprKey, branchKey) {
    if (Array.isArray(exprKey) && Array.isArray(branchKey)) {
        return exprKey.some(key => branchKey.includes(key));
    }
    if (Array.isArray(exprKey)) return exprKey.includes(branchKey);
    if (Array.isArray(branchKey)) return branchKey.includes(exprKey);
    return exprKey === branchKey;
}

/**
 * Reduce a Mapbox expression to a single representative value.
 * Branching expressions collapse to their fallback (what most features get)
 * unless `branchKey` names the branch to follow — which also applies to
 * matches nested inside a zoom interpolation, so a "motorway" row picks up the
 * motorway width. Zoom-driven expressions are evaluated at a mid-range zoom.
 *
 * @param {*} value - Literal or expression
 * @param {*} defaultValue - Returned when nothing concrete can be extracted
 * @param {{zoom?: number, branchKey?: *}} options
 */
export function resolveValue(value, defaultValue = null, options = {}) {
    const { zoom = 16 } = options;
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (!Array.isArray(value) || value.length === 0) return defaultValue;

    // Literal arrays (line-dasharray, text-offset) begin with a number
    if (typeof value[0] === 'number') return value;

    const op = value[0];

    if (ZOOM_STOP_OPERATORS.has(op)) {
        const stops = [];
        for (let i = 3; i < value.length - 1; i += 2) {
            if (typeof value[i] === 'number') stops.push({ zoom: value[i], value: value[i + 1] });
        }
        if (!stops.length) return defaultValue;

        let lower = stops[0];
        let upper = stops[stops.length - 1];
        for (const stop of stops) {
            if (stop.zoom <= zoom) lower = stop;
            if (stop.zoom >= zoom) { upper = stop; break; }
        }

        const from = resolveValue(lower.value, defaultValue, options);
        const to = resolveValue(upper.value, defaultValue, options);
        if (lower === upper || upper.zoom === lower.zoom) return from;

        const progress = (zoom - lower.zoom) / (upper.zoom - lower.zoom);
        if (typeof from === 'number' && typeof to === 'number') {
            return from + (to - from) * progress;
        }
        return progress >= 0.5 ? to : from;
    }

    if (op === 'step') {
        let picked = value[2];
        for (let i = 3; i < value.length - 1; i += 2) {
            if (typeof value[i] === 'number' && zoom >= value[i]) picked = value[i + 1];
        }
        return resolveValue(picked, defaultValue, options);
    }

    if (op === 'match') {
        if (options.branchKey !== undefined) {
            for (let i = 2; i < value.length - 1; i += 2) {
                if (keyMatches(value[i], options.branchKey)) return resolveValue(value[i + 1], defaultValue, options);
            }
        }
        return resolveValue(value[value.length - 1], defaultValue, options);
    }

    // A case expression falls back to its default output, which is what
    // features hitting no branch render as
    if (op === 'case') {
        return resolveValue(value[value.length - 1], defaultValue, options);
    }

    if (op === 'coalesce') {
        for (let i = 1; i < value.length; i++) {
            const resolved = resolveValue(value[i], null, options);
            if (resolved !== null && resolved !== undefined) return resolved;
        }
        return defaultValue;
    }

    if (op === 'literal') return value[1] !== undefined ? value[1] : defaultValue;

    // Property lookups and zoom carry no drawable value of their own
    if (op === 'get' || op === 'zoom' || op === 'feature-state' || op === 'id' || op === 'geometry-type') {
        return defaultValue;
    }

    // Unknown wrapper (to-string, concat, arithmetic…): first concrete operand
    for (let i = 1; i < value.length; i++) {
        const item = value[i];
        if (Array.isArray(item)) {
            const nested = resolveValue(item, null, options);
            if (nested !== null && nested !== undefined) return nested;
        } else if ((typeof item === 'string' || typeof item === 'number') && !EXPRESSION_OPERATORS.has(item)) {
            return item;
        }
    }

    return defaultValue;
}

/**
 * Expand a match/case expression into its branches so each one can become its
 * own legend row or thumbnail symbol.
 * @returns {Array<{key: *, value: *, isDefault: boolean, source: Array}>|null}
 *          null when the value is not a branching expression
 */
export function extractBranches(value) {
    if (!Array.isArray(value) || value.length < 4) return null;

    if (value[0] === 'match') {
        const branches = [];
        for (let i = 2; i < value.length - 1; i += 2) {
            branches.push({ key: value[i], value: value[i + 1], isDefault: false, source: value });
        }
        branches.push({ key: null, value: value[value.length - 1], isDefault: true, source: value });
        return branches;
    }

    if (value[0] === 'case' && value.length % 2 === 0) {
        const branches = [];
        for (let i = 2; i < value.length - 1; i += 2) {
            branches.push({ key: null, value: value[i], isDefault: false, source: value });
        }
        branches.push({ key: null, value: value[value.length - 1], isDefault: true, source: value });
        return branches;
    }

    return null;
}

/**
 * Branches of a colour expression, only when there is more than one distinct
 * colour worth drawing separately.
 */
export function colorBranches(value) {
    const branches = extractBranches(value);
    if (!branches) return null;
    const colors = branches.filter(b => typeof b.value === 'string');
    if (colors.length < 2) return null;
    const distinct = new Set(colors.map(b => b.value));
    return distinct.size > 1 ? colors : null;
}

/**
 * Resolve a property for one branch of a branching expression, so a "waypoint"
 * circle picks up the radius and stroke declared for that same key and a
 * "motorway" line picks up the motorway width.
 * @param {*} expr - Property value (literal or expression)
 * @param {Object|null} branch - Branch from extractBranches()
 * @param {*} fallback
 */
export function branchValue(expr, branch, fallback = null) {
    if (expr === null || expr === undefined) return fallback;
    if (!branch) return resolveValue(expr, fallback);

    // The expression the branch came from already knows its own output
    if (expr === branch.source) return resolveValue(branch.value, fallback);

    if (branch.isDefault || branch.key === null) return resolveValue(expr, fallback);

    return resolveValue(expr, fallback, { branchKey: branch.key });
}

function hasProp(style, ...props) {
    return props.some(prop => style[prop] !== undefined);
}

/**
 * Flatten a style into the ordered drawing passes it produces, bottom-most
 * first. A variant can contribute to more than one bucket (a polygon variant
 * with an outline lands in both `fill` and `line`).
 *
 * @param {Object} style - Layer style, possibly using "prefix/property" keys
 * @returns {{variants: Array, fill: Array, line: Array, circle: Array, icon: Object|null, base: Object}}
 */
export function collectStylePasses(style) {
    const variants = parseStyleVariants(style);
    const fill = [];
    const line = [];
    const circle = [];
    let icon = null;

    variants.forEach(({ prefix, style: variantStyle }) => {
        if (hasProp(variantStyle, 'fill-color', 'fill-opacity')) {
            fill.push({
                prefix,
                style: variantStyle,
                colorExpr: variantStyle['fill-color'],
                color: resolveValue(variantStyle['fill-color'], '#3b82f6'),
                opacity: resolveValue(variantStyle['fill-opacity'], 0.5),
                strokeColor: resolveValue(variantStyle['line-color'], null),
                strokeWidth: resolveValue(variantStyle['line-width'], null)
            });
        }

        if (hasProp(variantStyle, 'line-color', 'line-width')) {
            line.push({
                prefix,
                style: variantStyle,
                colorExpr: variantStyle['line-color'],
                color: resolveValue(variantStyle['line-color'], 'black'),
                width: resolveValue(variantStyle['line-width'], 2),
                opacity: resolveValue(variantStyle['line-opacity'], 1),
                dasharray: resolveValue(variantStyle['line-dasharray'], null),
                offset: resolveValue(variantStyle['line-offset'], 0)
            });
        }

        if (hasProp(variantStyle, 'circle-color', 'circle-radius')) {
            circle.push({
                prefix,
                style: variantStyle,
                colorExpr: variantStyle['circle-color'],
                color: resolveValue(variantStyle['circle-color'], '#3b82f6'),
                radius: resolveValue(variantStyle['circle-radius'], 6),
                opacity: resolveValue(variantStyle['circle-opacity'], 0.9),
                strokeColor: resolveValue(variantStyle['circle-stroke-color'], null),
                strokeWidth: resolveValue(variantStyle['circle-stroke-width'], null)
            });
        }

        if (!icon && variantStyle['icon-image']) {
            icon = { prefix, iconImage: variantStyle['icon-image'] };
        }
    });

    const base = variants.find(v => v.prefix === '')?.style || {};
    return { variants, fill, line, circle, icon, base };
}

/**
 * Turn a variant prefix or match key into a human label.
 */
export function formatLabel(value) {
    if (value === null || value === undefined || value === '') return '';
    if (Array.isArray(value)) return value.map(formatLabel).join(', ');
    return String(value)
        .replace(/_+/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Scale a set of stroke widths into pixels for a swatch.
 * Stacked passes (a cased line) are normalised against the widest pass so the
 * casing stays visible; a lone pass keeps its natural weight.
 * @param {number[]} widths
 * @param {{maxPx: number, minPx: number, scale: number}} options
 * @returns {(width: number) => number}
 */
export function strokeScaler(widths, { maxPx = 8, minPx = 1.5, scale = 1 } = {}) {
    const positive = widths.filter(w => typeof w === 'number' && w > 0);
    const max = positive.length ? Math.max(...positive) : 0;
    if (!max) return () => minPx;

    if (widths.length > 1) {
        return (width) => {
            const w = typeof width === 'number' && width > 0 ? width : max;
            return Math.max(minPx, Math.min((w / max) * maxPx, maxPx));
        };
    }

    return (width) => {
        const w = typeof width === 'number' && width > 0 ? width : max;
        return Math.max(minPx, Math.min(w * scale, maxPx));
    };
}

/**
 * Extract the first usable icon URL from an icon-image value or expression.
 */
export function extractIconUrl(iconImage) {
    if (typeof iconImage === 'string') {
        return looksLikeIconPath(iconImage) ? iconImage : null;
    }

    if (Array.isArray(iconImage)) {
        for (const item of iconImage) {
            if (typeof item === 'string') {
                if (looksLikeIconPath(item)) return item;
            } else if (Array.isArray(item)) {
                const nested = extractIconUrl(item);
                if (nested) return nested;
            }
        }
    }

    return null;
}

function looksLikeIconPath(value) {
    return /\.(png|jpe?g|svg|gif|webp)(\?|$)/i.test(value) ||
        value.startsWith('http') ||
        value.startsWith('assets/') ||
        value.startsWith('data/') ||
        value.startsWith('images/');
}

/**
 * Pure helpers behind the symbology editor (js/symbology-editor.js): build,
 * parse and classify the Mapbox expressions a data-driven style is made of.
 *
 * A style value is modelled as
 *   { mode: 'single' | 'categorized' | 'graduated' | 'custom', ..., hover?, selected? }
 * where `hover` / `selected` are optional per-state outputs. A value in any
 * other shape parses as 'custom' and stays in the JSON editor untouched.
 *
 * Generated shapes (kept stable so parseSymbology can read them back):
 *   categorized  ["match", ["to-string", ["get", f]], "a", out, ..., fallback]
 *   graduated    ["case", ["==", ["typeof", ["get", f]], "number"],
 *                  ["step" | "interpolate", ..., ["get", f], ...], fallback]
 *   states       ["case", <selected>, out, <hover>, out, base]
 */

const isLiteral = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

const stateCondition = (name) => ['boolean', ['feature-state', name], false];

function stateName(condition) {
    if (!Array.isArray(condition) || condition[0] !== 'boolean' || condition.length !== 3) return null;
    const inner = condition[1];
    if (!Array.isArray(inner) || inner[0] !== 'feature-state') return null;
    return inner[1] === 'hover' || inner[1] === 'selected' ? inner[1] : null;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** Wrap a base value so hover / selected features take their own output. */
export function withStates(base, { hover, selected } = {}) {
    const branches = [];
    if (selected !== undefined) branches.push(stateCondition('selected'), selected);
    if (hover !== undefined) branches.push(stateCondition('hover'), hover);
    return branches.length ? ['case', ...branches, base] : base;
}

/** The inverse of withStates: `{ base, hover, selected }`. */
export function splitStates(value) {
    if (!Array.isArray(value) || value[0] !== 'case' || value.length < 4 || value.length % 2 !== 0) {
        return { base: value };
    }
    const found = {};
    for (let i = 1; i < value.length - 1; i += 2) {
        const name = stateName(value[i]);
        if (!name || found[name] !== undefined) return { base: value };
        found[name] = value[i + 1];
    }
    return { base: value[value.length - 1], ...found };
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * Match a property's value to an output per category. Values are compared as
 * strings (`to-string`) so numeric and text fields behave the same, and
 * `match` can't choke on non-integer numeric labels.
 */
export function buildCategorized({ field, categories, fallback, raw = false }) {
    const seen = new Set();
    const pairs = [];
    categories.forEach(({ value, output }) => {
        const labels = (Array.isArray(value) ? value : [value])
            .filter(v => v !== '' && v !== undefined && v !== null)
            .map(v => (raw ? v : String(v)))
            .filter(v => !seen.has(v));
        if (!labels.length || output === undefined) return;
        labels.forEach(v => seen.add(v));
        pairs.push(labels.length === 1 ? labels[0] : labels, output);
    });
    if (!pairs.length) return fallback;
    const input = raw ? ['get', field] : ['to-string', ['get', field]];
    return ['match', input, ...pairs, fallback];
}

/**
 * Colour or size by a numeric field. `kind: 'step'` gives one output per class
 * (outputs.length === breaks.length + 1); `'interpolate'` blends between stops
 * (outputs.length === breaks.length). Features without a numeric value take
 * the fallback.
 */
export function buildGraduated({ field, kind = 'step', breaks, outputs, fallback }) {
    const order = breaks.map((value, i) => ({ value, output: outputs[kind === 'step' ? i + 1 : i] }))
        .filter(stop => Number.isFinite(stop.value))
        .sort((a, b) => a.value - b.value)
        .filter((stop, i, all) => i === 0 || stop.value !== all[i - 1].value);
    const first = outputs[0];
    if (kind === 'interpolate' && !order.length) return fallback;

    const input = ['get', field];
    const inner = kind === 'step'
        ? ['step', input, first, ...order.flatMap(stop => [stop.value, stop.output])]
        : ['interpolate', ['linear'], input, ...order.flatMap(stop => [stop.value, stop.output])];
    return ['case', ['==', ['typeof', input], 'number'], inner, fallback];
}

/** Serialize a model back to the value written into `style`. */
export function serializeSymbology(model) {
    let base;
    if (model.mode === 'categorized') {
        base = buildCategorized(model);
    } else if (model.mode === 'graduated') {
        base = buildGraduated(model);
    } else {
        base = model.coalesce && model.coalesce.length ? ['coalesce', ...model.coalesce, model.single] : model.single;
    }
    return withStates(base, model);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function fieldOf(input) {
    if (!Array.isArray(input)) return null;
    if (input[0] === 'get' && typeof input[1] === 'string' && input.length === 2) return { field: input[1], raw: true };
    if (input[0] === 'to-string' && input.length === 2) {
        const inner = fieldOf(input[1]);
        return inner && inner.raw ? { field: inner.field, raw: false } : null;
    }
    return null;
}

function parseMatch(base) {
    if (base[0] !== 'match' || base.length < 5 || base.length % 2 === 0) return null;
    const input = fieldOf(base[1]);
    const fallback = base[base.length - 1];
    if (!input || !isLiteral(fallback)) return null;

    const categories = [];
    for (let i = 2; i < base.length - 1; i += 2) {
        if (!isLiteral(base[i + 1])) return null;
        categories.push({ value: base[i], output: base[i + 1] });
    }
    return { field: input.field, raw: input.raw, categories, fallback };
}

function parseStops(inner) {
    const isInterpolate = inner[0] === 'interpolate';
    const isStep = inner[0] === 'step';
    if (!isInterpolate && !isStep) return null;
    if (isInterpolate && !(Array.isArray(inner[1]) && inner[1][0] === 'linear')) return null;

    const inputIndex = isInterpolate ? 2 : 1;
    const input = fieldOf(inner[inputIndex]);
    if (!input || !input.raw) return null;

    const breaks = [];
    const outputs = [];
    let i = inputIndex + 1;
    if (isStep) {
        if (!isLiteral(inner[i])) return null;
        outputs.push(inner[i++]);
    }
    for (; i < inner.length; i += 2) {
        if (typeof inner[i] !== 'number' || !isLiteral(inner[i + 1])) return null;
        breaks.push(inner[i]);
        outputs.push(inner[i + 1]);
    }
    return { field: input.field, kind: isStep ? 'step' : 'interpolate', breaks, outputs };
}

function parseGraduated(base) {
    if (!Array.isArray(base)) return null;
    if (base[0] === 'case' && base.length === 4) {
        const test = base[1];
        const typed = Array.isArray(test) && test[0] === '==' && test[2] === 'number'
            && Array.isArray(test[1]) && test[1][0] === 'typeof';
        const stops = typed && Array.isArray(base[2]) ? parseStops(base[2]) : null;
        const fieldMatches = stops && fieldOf(test[1][1])?.field === stops.field;
        return fieldMatches && isLiteral(base[3]) ? { ...stops, fallback: base[3] } : null;
    }
    const stops = parseStops(base);
    return stops ? { ...stops, fallback: undefined } : null;
}

function parseCoalesce(base) {
    if (base[0] !== 'coalesce' || base.length < 3) return null;
    const literal = base[base.length - 1];
    const prefix = base.slice(1, -1);
    const allGets = prefix.every(part => Array.isArray(part) && part[0] === 'get');
    return isLiteral(literal) && allGets ? { single: literal, coalesce: prefix } : null;
}

/** Read a style value into the editor's model. */
export function parseSymbology(value) {
    const { base, hover, selected } = splitStates(value);
    const states = { hover, selected };

    if (isLiteral(base)) return { mode: 'single', single: base, ...states };
    if (!Array.isArray(base)) return { mode: 'custom' };

    const match = parseMatch(base);
    if (match) return { mode: 'categorized', ...match, ...states };

    const graduated = parseGraduated(base);
    if (graduated) return { mode: 'graduated', ...graduated, ...states };

    const coalesce = parseCoalesce(base);
    if (coalesce) return { mode: 'single', ...coalesce, ...states };

    return { mode: 'custom' };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Distinct non-empty values with their frequency, most frequent first. */
export function uniqueValues(values, limit = 200) {
    const counts = new Map();
    values.forEach(value => {
        if (value === null || value === undefined || value === '') return;
        const key = String(value);
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, undefined, { numeric: true }))
        .slice(0, limit);
}

export function numericValues(values) {
    return values.filter(v => typeof v === 'number' && Number.isFinite(v));
}

function quantile(sorted, q) {
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

// Round to roughly three significant digits of the data range, so breaks read
// as 12.5 rather than 12.499999.
function roundToRange(value, range) {
    if (!(range > 0)) return value;
    const digits = Math.max(0, 2 - Math.floor(Math.log10(range)));
    const factor = 10 ** Math.min(digits, 10);
    return Math.round(value * factor) / factor;
}

/**
 * Break values for a numeric field. `step` makes `classes` bins (classes - 1
 * breaks); `interpolate` makes `classes` stops from min to max.
 */
export function classBreaks(numbers, { classes = 5, method = 'equal', kind = 'step' } = {}) {
    if (!numbers.length) return [];
    const sorted = [...numbers].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;
    const count = Math.max(1, Math.floor(classes));

    const positions = kind === 'step'
        ? Array.from({ length: count - 1 }, (_, i) => (i + 1) / count)
        : Array.from({ length: count }, (_, i) => (count === 1 ? 0 : i / (count - 1)));

    const raw = positions.map(p => (method === 'quantile' ? quantile(sorted, p) : min + range * p));
    return raw.map(v => roundToRange(v, range)).filter((v, i, all) => i === 0 || v !== all[i - 1]);
}

// ---------------------------------------------------------------------------
// Colour ramps
// ---------------------------------------------------------------------------

export const COLOR_RAMPS = {
    Viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    Blues: ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
    'Yellow-Orange-Red': ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'],
    Greens: ['#edf8e9', '#bae4b3', '#74c476', '#31a354', '#006d2c'],
    Purples: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'],
    Spectral: ['#d7191c', '#fdae61', '#ffffbf', '#abdda4', '#2b83ba'],
    'Red-Blue': ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0']
};

export const CATEGORICAL_PALETTES = {
    'Tableau 10': ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
    'Set 3': ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5', '#ffed6f'],
    Dark: ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666']
};

const hexToRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** `count` evenly spaced colours along a ramp's stops. */
export function sampleRamp(stops, count) {
    if (count <= 1) return [stops[0]];
    return Array.from({ length: count }, (_, i) => {
        const position = (i / (count - 1)) * (stops.length - 1);
        const lower = Math.floor(position);
        const upper = Math.min(lower + 1, stops.length - 1);
        const t = position - lower;
        const a = hexToRgb(stops[lower]);
        const b = hexToRgb(stops[upper]);
        return rgbToHex(a.map((channel, k) => channel + (b[k] - channel) * t));
    });
}

/** `count` evenly spaced numbers from `from` to `to` (for size / opacity). */
export function sampleNumbers(from, to, count) {
    if (count <= 1) return [from];
    return Array.from({ length: count }, (_, i) => Math.round((from + ((to - from) * i) / (count - 1)) * 100) / 100);
}

/** A palette colour for the nth category, cycling when there are more categories than colours. */
export function paletteColor(palette, index) {
    return palette[index % palette.length];
}

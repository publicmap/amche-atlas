/**
 * Consolidates the branching expressions of a layer's style into one list of
 * rules.
 *
 * A data-driven style spreads its logic over many properties: `fill-color`
 * matches on `use_zones`, so do `line-color` and `line-width`, and a hatch
 * overlay carries its own filter. Read per property that is a wall of
 * branches; read per rule ("use_zones = G1") it is a handful of symbols.
 *
 * A rule is a set of conditions - from `match` labels, `case` tests and
 * `step` classes, nested to any depth, in the order they were nested. Every
 * distinct condition path found in any property becomes a row; each property
 * is then resolved under that row's conditions to find the value it
 * contributes, and a variant's own `filter` decides whether its properties
 * apply. A final row, with no conditions, collects the fallbacks.
 *
 * Conditions are compared as expressions, so two properties that test the same
 * input line up on one row even when nested differently.
 */

import { splitStates } from './style-expressions.js';
import { resolveValue } from './layer-style-utils.js';
import { baseProperty, variantPrefix } from './style-categories.js';

const MAX_ROWS = 400;
const MAX_JSON_LENGTH = 90;

const sig = (expr) => JSON.stringify(expr);

// -- reading expressions ------------------------------------------------------

/** The data field an input expression reads, for ["get", f] and ["to-string", ["get", f]]. */
export function fieldName(input) {
    if (!Array.isArray(input)) return null;
    if (input[0] === 'get' && typeof input[1] === 'string' && input.length === 2) return input[1];
    if (input[0] === 'to-string' && input.length === 2) return fieldName(input[1]);
    return null;
}

const isNumberGuard = (test) => Array.isArray(test) && test[0] === '==' && test[2] === 'number'
    && Array.isArray(test[1]) && test[1][0] === 'typeof';

/**
 * What kind of branching an expression is, or null for a plain value. States
 * (hover / selected) are looked through: they are not rules.
 */
export function parseBranching(node) {
    if (!Array.isArray(node) || node.length < 3) return null;

    if (node[0] === 'match' && node.length % 2 === 1 && node.length >= 5) {
        const branches = [];
        for (let i = 2; i < node.length - 1; i += 2) {
            branches.push({ labels: Array.isArray(node[i]) ? node[i] : [node[i]], index: i + 1, out: node[i + 1] });
        }
        return { type: 'match', input: node[1], inputSig: sig(node[1]), field: fieldName(node[1]), branches, fallbackIndex: node.length - 1 };
    }

    if (node[0] === 'case' && node.length >= 4 && node.length % 2 === 0) {
        const branches = [];
        for (let i = 1; i < node.length - 1; i += 2) branches.push({ test: node[i], index: i + 1, out: node[i + 1] });
        const guard = branches.length === 1 && isNumberGuard(branches[0].test)
            ? sig(branches[0].test[1][1]) : null;
        return { type: 'case', branches, guard, fallbackIndex: node.length - 1 };
    }

    if (node[0] === 'step' && node.length >= 3) {
        const classes = [{ index: 2, from: -Infinity, out: node[2] }];
        for (let i = 3; i < node.length - 1; i += 2) classes.push({ index: i + 1, from: node[i], out: node[i + 1] });
        classes.forEach((c, i) => { c.to = i + 1 < classes.length ? classes[i + 1].from : Infinity; });
        return { type: 'step', input: node[1], inputSig: sig(node[1]), field: fieldName(node[1]), classes };
    }

    return null;
}

/** Whether a style value is data-driven (a match, case or step, beneath any states). */
export function isBranching(value) {
    return parseBranching(splitStates(value).base) !== null;
}

// -- conditions ---------------------------------------------------------------

function matchCondition(branching, label) {
    return { kind: 'match', inputSig: branching.inputSig, field: branching.field, label: String(label) };
}

function rangeCondition(branching, cls) {
    // A value inside the class, so every other property can be resolved against it.
    const value = cls.from === -Infinity ? (Number.isFinite(cls.to) ? cls.to - 1 : 0) : cls.from;
    return { kind: 'range', inputSig: branching.inputSig, field: branching.field, from: cls.from, to: cls.to, value };
}

function caseCondition(test) {
    return { kind: 'case', sig: sig(test), expr: test };
}

export function conditionKey(c) {
    if (c.kind === 'match') return `m|${c.inputSig}|${c.label}`;
    if (c.kind === 'range') return `r|${c.inputSig}|${c.from}|${c.to}`;
    return `c|${c.sig}`;
}

function compact(value) {
    const text = JSON.stringify(value);
    return text.length > MAX_JSON_LENGTH ? `${text.slice(0, MAX_JSON_LENGTH - 1)}…` : text;
}

/**
 * A readable form of an expression used as a condition. `complex` is true when
 * it fell back to JSON because the pattern isn't one it recognises.
 */
function listText(values) {
    const items = values.map(String);
    return items.length > 6 ? `${items.slice(0, 5).join(', ')}, … (${items.length} values)` : items.join(', ');
}

export function describeExpression(expr) {
    const comparison = { '==': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤' };
    if (Array.isArray(expr)) {
        const [op, a, b] = expr;
        // The legacy filter syntax names the field as a plain string.
        if (typeof a === 'string' && comparison[op] && expr.length === 3) return { text: `${a} ${comparison[op]} ${b}`, complex: false };
        if (typeof a === 'string' && (op === 'in' || op === '!in')) {
            return { text: `${a} ${op === 'in' ? 'in' : 'not in'} ${listText(expr.slice(2))}`, complex: false };
        }
        if (op === '!has' && typeof a === 'string') return { text: `not has ${a}`, complex: false };
        if (comparison[op] && fieldName(a) !== null && !Array.isArray(b)) {
            return { text: `${fieldName(a)} ${comparison[op]} ${b}`, complex: false };
        }
        if (op === 'has' && typeof a === 'string') return { text: `has ${a}`, complex: false };
        if (op === 'in' && fieldName(a) !== null && Array.isArray(b) && b[0] === 'literal') {
            return { text: `${fieldName(a)} in ${listText(b[1])}`, complex: false };
        }
        if (op === 'boolean' && Array.isArray(a) && a[0] === 'feature-state') {
            return { text: `${a[1]} state`, complex: false };
        }
        if ((op === 'all' || op === 'any') && expr.length > 2) {
            const parts = expr.slice(1).map(describeExpression);
            return { text: parts.map(p => p.text).join(op === 'all' ? ' and ' : ' or '), complex: parts.some(p => p.complex) };
        }
        if (op === '!' && expr.length === 2) {
            const inner = describeExpression(a);
            return { text: `not (${inner.text})`, complex: inner.complex };
        }
    }
    return { text: compact(expr), complex: true };
}

export function describeCondition(c) {
    if (c.kind === 'match') return { text: `${c.field ?? compact(JSON.parse(c.inputSig))} = ${c.label}`, complex: c.field === null };
    if (c.kind === 'range') {
        const field = c.field ?? 'value';
        if (c.from === -Infinity) return { text: `${field} < ${c.to}`, complex: false };
        if (c.to === Infinity) return { text: `${field} ≥ ${c.from}`, complex: false };
        return { text: `${c.from} ≤ ${field} < ${c.to}`, complex: false };
    }
    return describeExpression(c.expr);
}

// -- enumerating rules --------------------------------------------------------

function* leafPaths(node, path = []) {
    const { base } = splitStates(node);
    const branching = parseBranching(base);
    if (!branching) { yield path; return; }

    if (branching.type === 'match') {
        for (const branch of branching.branches) {
            for (const label of branch.labels) yield* leafPaths(branch.out, [...path, matchCondition(branching, label)]);
        }
        yield* leafPaths(base[branching.fallbackIndex], path);
    } else if (branching.type === 'case') {
        if (branching.guard) {
            yield* leafPaths(branching.branches[0].out, path);
        } else {
            for (const branch of branching.branches) yield* leafPaths(branch.out, [...path, caseCondition(branch.test)]);
        }
        yield* leafPaths(base[branching.fallbackIndex], path);
    } else {
        for (const cls of branching.classes) yield* leafPaths(cls.out, [...path, rangeCondition(branching, cls)]);
    }
}

function assumptionsOf(path) {
    const A = { match: new Map(), case: new Set(), range: new Map() };
    path.forEach(c => {
        if (c.kind === 'match') A.match.set(c.inputSig, c.label);
        else if (c.kind === 'range') A.range.set(c.inputSig, c.value);
        else A.case.add(c.sig);
    });
    return A;
}

// -- resolving a property under a rule ----------------------------------------

/**
 * The value a style value takes under a rule's conditions. `branch` says a
 * rule-specific branch was followed (not just fallbacks), `path` is where the
 * value sits in the expression, for writing an edit back.
 */
export function resolveUnder(node, A, path = []) {
    const split = splitStates(node);
    if (split.base !== node) return resolveUnder(split.base, A, [...path, node.length - 1]);

    const branching = parseBranching(node);
    if (!branching) return { value: node, branch: false, path };

    if (branching.type === 'match') {
        const label = A.match.get(branching.inputSig);
        const hit = label === undefined ? null : branching.branches.find(b => b.labels.map(String).includes(label));
        if (hit) return { ...resolveUnder(hit.out, A, [...path, hit.index]), branch: true };
        return resolveUnder(node[branching.fallbackIndex], A, [...path, branching.fallbackIndex]);
    }

    if (branching.type === 'case') {
        if (branching.guard) {
            const numeric = [...A.range.keys()].includes(branching.guard);
            const target = numeric ? branching.branches[0] : null;
            return target
                ? resolveUnder(target.out, A, [...path, target.index])
                : resolveUnder(node[branching.fallbackIndex], A, [...path, branching.fallbackIndex]);
        }
        const hit = branching.branches.find(b => A.case.has(sig(b.test)));
        if (hit) return { ...resolveUnder(hit.out, A, [...path, hit.index]), branch: true };
        return resolveUnder(node[branching.fallbackIndex], A, [...path, branching.fallbackIndex]);
    }

    const value = A.range.get(branching.inputSig);
    if (value === undefined) return resolveUnder(branching.classes[0].out, A, [...path, branching.classes[0].index]);
    const cls = branching.classes.find(c => value >= c.from && value < c.to) || branching.classes[0];
    return { ...resolveUnder(cls.out, A, [...path, cls.index]), branch: cls !== branching.classes[0] || branching.classes.length === 1 };
}

/** Three-valued evaluation of a variant filter under a rule: true, false or undefined (unknown). */
export function evalFilter(filter, A) {
    if (!Array.isArray(filter)) return undefined;
    const [op, a, b] = filter;

    if ((op === 'in' || op === '==') && Array.isArray(a)) {
        const label = A.match.get(sig(a));
        if (label === undefined) return undefined;
        const values = op === 'in' ? (Array.isArray(b) && b[0] === 'literal' ? b[1] : null) : [b];
        return values ? values.map(String).includes(label) : undefined;
    }
    if (op === 'all' || op === 'any') {
        const results = filter.slice(1).map(f => evalFilter(f, A));
        if (op === 'all') return results.includes(false) ? false : results.every(r => r === true) ? true : undefined;
        return results.includes(true) ? true : results.every(r => r === false) ? false : undefined;
    }
    if (op === '!') {
        const inner = evalFilter(a, A);
        return inner === undefined ? undefined : !inner;
    }
    // A typeof-number guard is true whenever the rule pins a numeric value.
    if (isNumberGuard(filter)) return A.range.has(sig(filter[1][1])) ? true : undefined;
    return undefined;
}

// -- the consolidated view ----------------------------------------------------

/**
 * @param {Object} style - A layer style (references already resolved)
 * @returns {{rows: Array, ruleCount: number, branchingKeys: string[], literalKeys: string[]}}
 *   Each row: `{ id, conditions, isDefault, resolved, contributors, shared, gated }`
 *   where `resolved[key] = { value, branch, path }`.
 */
export function analyzeRules(style) {
    const keys = Object.keys(style || {}).filter(key => baseProperty(key) !== 'filter');
    const filters = {};
    Object.keys(style || {}).forEach(key => {
        if (baseProperty(key) === 'filter') filters[variantPrefix(key)] = style[key];
    });

    const branchingKeys = keys.filter(key => isBranching(style[key]));
    const literalKeys = keys.filter(key => !branchingKeys.includes(key));

    // Rows come from the busiest property first, so its order leads the table.
    const sources = branchingKeys
        .map(key => ({ key, paths: [...leafPaths(style[key])] }))
        .sort((a, b) => b.paths.length - a.paths.length);

    const seen = new Map();
    sources.forEach(({ paths }) => {
        paths.forEach(path => {
            if (!path.length) return;
            const id = path.map(conditionKey).sort().join('&');
            if (!seen.has(id) && seen.size < MAX_ROWS) seen.set(id, path);
        });
    });
    const paths = [...seen.entries()].map(([id, path]) => ({ id, path }));
    paths.push({ id: '', path: [] });

    const rows = paths.map(({ id, path }) => {
        const A = assumptionsOf(path);
        const resolved = {};
        const gated = [];
        keys.forEach(key => {
            const prefix = variantPrefix(key);
            if (prefix && prefix in filters && evalFilter(filters[prefix], A) !== true) {
                gated.push(key);
                return;
            }
            resolved[key] = resolveUnder(style[key], A);
        });

        const isDefault = path.length === 0;
        const contributors = Object.keys(resolved).filter(key => (isDefault ? branchingKeys.includes(key) : resolved[key].branch));
        const shared = Object.keys(resolved).filter(key => literalKeys.includes(key));
        return { id: id || 'default', conditions: path, isDefault, resolved, contributors, shared, gated };
    });

    return { rows, ruleCount: rows.length - 1, branchingKeys, literalKeys };
}

// -- writing an edit back -----------------------------------------------------

/** A copy of `value` with the node at `path` replaced. */
export function setAtPath(value, path, replacement) {
    if (!path.length) return replacement;
    const copy = [...value];
    copy[path[0]] = setAtPath(value[path[0]], path.slice(1), replacement);
    return copy;
}

/** Representative plain value of a resolved style value, for drawing a symbol. */
export function displayValue(value) {
    if (typeof value === 'string' || typeof value === 'number') return value;
    return resolveValue(value, null);
}

// -- data filters -------------------------------------------------------------

/** The key that stands for the layer config's own `filter` (as opposed to one inside `style`). */
export const LAYER_FILTER_KEY = '@layer';

/**
 * Every filter a layer applies, for the Rules tab: the layer's own `filter`
 * (which decides what is drawn at all) and the filters inside `style` - a
 * `<prefix>/filter` limits that overlay's properties to the features it
 * matches, a bare `filter` does the same for the base style.
 *
 * @param {Object} style
 * @param {*} [layerFilter] - The layer config's `filter`
 * @returns {Array<{key: string, scope: string, kind: 'layer'|'variant', value: *, governs: string[]}>}
 */
export function collectFilters(style, layerFilter) {
    const filters = [];
    if (layerFilter !== undefined && layerFilter !== null) {
        filters.push({ key: LAYER_FILTER_KEY, scope: 'Layer', kind: 'layer', value: layerFilter, governs: [] });
    }
    Object.keys(style || {}).forEach(key => {
        if (baseProperty(key) !== 'filter') return;
        const prefix = variantPrefix(key);
        filters.push({
            key, scope: prefix ? `Overlay “${prefix}”` : 'Base style', kind: 'variant', value: style[key],
            governs: Object.keys(style).filter(k => variantPrefix(k) === prefix && baseProperty(k) !== 'filter')
        });
    });
    return filters;
}

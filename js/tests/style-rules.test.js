import { describe, it, expect } from 'vitest';
import {
    analyzeRules, parseBranching, describeCondition, describeExpression, evalFilter, resolveUnder, setAtPath, fieldName
} from '../style-rules.js';
import { categoryOf, groupForAllTab, tabForKey, STYLE_TABS, tabMatches } from '../style-categories.js';

const INPUT = ['to-string', ['get', 'use_zones']];
const match = (pairs, fallback, input = INPUT) => ['match', input, ...pairs.flat(), fallback];

const LANDUSE = {
    'hatch/filter': ['in', INPUT, ['literal', ['G1', 'T1']]],
    'hatch/fill-pattern': match([['G1', 'hatch|forward-diagonal|#000000|8|1'], ['T1', 'hatch|vertical|#000000|8|1']], 'hatch|cross|#000000|8|1'),
    'fill-color': match([['R', '#f59e0b'], ['G1', 'rgba(0, 0, 0, 0)'], ['T1', 'rgba(0, 0, 0, 0)']], 'rgba(0, 0, 0, 0)'),
    'line-color': match([['R', '#9c9c9c'], ['G1', '#000000'], ['T1', '#000000']], 'rgba(0, 0, 0, 0)'),
    'line-width': match([['R', 0.5], ['G1', 0.5], ['T1', 0.5]], 0),
    'fill-opacity': 1,
    'text-size': 5
};

const rowFor = (analysis, text) => analysis.rows.find(r => r.conditions.map(c => describeCondition(c).text).join(' › ') === text);

describe('categories', () => {
    it('gives every property one home, grouping variants with the property they style', () => {
        expect(categoryOf('fill-color')).toBe('area');
        expect(categoryOf('hatch/fill-pattern')).toBe('area');
        expect(categoryOf('line-width')).toBe('line');
        expect(categoryOf('text-field')).toBe('label');
        expect(categoryOf('circle-radius')).toBe('point');
        expect(categoryOf('circle-blur')).toBe('circle');
        expect(categoryOf('icon-image')).toBe('icon');
        expect(categoryOf('symbol-placement')).toBe('icon');
        expect(categoryOf('hatch/filter')).toBeNull();
        expect(categoryOf('visibility')).toBeNull();
    });

    it('filters tabs and lists the "*" tab with unclaimed properties first, then by section', () => {
        expect(tabMatches('area', 'fill-opacity')).toBe(true);
        expect(tabMatches('line', 'fill-opacity')).toBe(false);
        expect(tabMatches('all', 'anything')).toBe(true);
        expect(tabMatches('rules', 'fill-color')).toBe(false);
        expect(STYLE_TABS.map(t => t.id)).toEqual(['rules', 'point', 'line', 'area', 'label', 'circle', 'icon', 'all']);

        const groups = groupForAllTab(['text-size', 'fill-color', 'hatch/filter', 'line-width', 'circle-blur', 'icon-size', 'circle-color']);
        expect(groups.map(g => [g.category, g.keys])).toEqual([
            ['other', ['hatch/filter']], ['point', ['circle-color']], ['line', ['line-width']], ['area', ['fill-color']],
            ['label', ['text-size']], ['circle', ['circle-blur']], ['icon', ['icon-size']]
        ]);
        expect(tabForKey('fill-color')).toBe('area');
        expect(tabForKey('hatch/filter')).toBe('all');
    });
});

describe('reading conditions', () => {
    it('finds the field behind an input expression', () => {
        expect(fieldName(['get', 'a'])).toBe('a');
        expect(fieldName(INPUT)).toBe('use_zones');
        expect(fieldName(['zoom'])).toBeNull();
    });

    it('describes common tests readably and falls back to JSON for the rest', () => {
        expect(describeExpression(['==', ['get', 'kind'], 'park'])).toEqual({ text: 'kind = park', complex: false });
        expect(describeExpression(['>=', ['get', 'area'], 50])).toEqual({ text: 'area ≥ 50', complex: false });
        expect(describeExpression(['all', ['has', 'name'], ['!=', ['get', 'x'], 1]])).toEqual({ text: 'has name and x ≠ 1', complex: false });
        const odd = describeExpression(['within', { type: 'Polygon' }]);
        expect(odd.complex).toBe(true);
        expect(odd.text.startsWith('["within"')).toBe(true);
    });

    it('treats hover / selected as states, not rules', () => {
        const hover = ['case', ['boolean', ['feature-state', 'hover'], false], '#ff0', match([['A', '#111']], '#222')];
        expect(parseBranching(hover)).toMatchObject({ type: 'case' });
        const { rows } = analyzeRules({ 'fill-color': hover });
        expect(rows.map(r => r.conditions.map(c => c.label))).toEqual([['A'], []]);
    });
});

describe('analyzeRules', () => {
    const analysis = analyzeRules(LANDUSE);

    it('makes one row per condition across every property, plus a default row last', () => {
        expect(analysis.rows.map(r => r.conditions.map(c => c.label))).toEqual([['R'], ['G1'], ['T1'], []]);
        expect(analysis.ruleCount).toBe(3);
        expect(analysis.rows.at(-1).isDefault).toBe(true);
        expect(analysis.branchingKeys).toEqual(expect.arrayContaining(['fill-color', 'line-color', 'line-width', 'hatch/fill-pattern']));
        expect(analysis.literalKeys.sort()).toEqual(['fill-opacity', 'text-size']);
    });

    it('resolves every property under a rule, and says which contribute', () => {
        const g1 = rowFor(analysis, 'use_zones = G1');
        expect(g1.resolved['fill-color'].value).toBe('rgba(0, 0, 0, 0)');
        expect(g1.resolved['line-color'].value).toBe('#000000');
        expect(g1.resolved['hatch/fill-pattern'].value).toBe('hatch|forward-diagonal|#000000|8|1');
        expect(g1.contributors).toEqual(expect.arrayContaining(['fill-color', 'line-color', 'line-width', 'hatch/fill-pattern']));
        expect(g1.shared.sort()).toEqual(['fill-opacity', 'text-size']);
    });

    it('applies a variant only to the rules its filter covers', () => {
        const r = rowFor(analysis, 'use_zones = R');
        expect(r.gated).toEqual(['hatch/fill-pattern']);
        expect(r.resolved['hatch/fill-pattern']).toBeUndefined();
        expect(analysis.rows.at(-1).gated).toEqual(['hatch/fill-pattern']);
    });

    it('collects every property\'s fallback on the default row', () => {
        const fallback = analysis.rows.at(-1);
        expect(fallback.resolved['fill-color'].value).toBe('rgba(0, 0, 0, 0)');
        expect(fallback.resolved['line-width'].value).toBe(0);
        expect(fallback.contributors).toEqual(expect.arrayContaining(['fill-color', 'line-color']));
    });

    it('has just the default row for a style with no branching', () => {
        const flat = analyzeRules({ 'fill-color': '#fff', 'line-width': 2 });
        expect(flat.ruleCount).toBe(0);
        expect(flat.rows).toHaveLength(1);
        expect(flat.rows[0].shared.sort()).toEqual(['fill-color', 'line-width']);
    });
});

describe('graduated classes', () => {
    const area = ['case', ['==', ['typeof', ['get', 'area']], 'number'], ['step', ['get', 'area'], '#aaa', 10, '#bbb', 50, '#ccc'], '#ddd'];
    const width = ['case', ['==', ['typeof', ['get', 'area']], 'number'], ['step', ['get', 'area'], 1, 10, 2, 50, 3], 0];

    it('makes a row per class, resolving other properties that step on the same field', () => {
        const analysis = analyzeRules({ 'fill-color': area, 'line-width': width });
        expect(analysis.rows.map(r => r.conditions.map(c => describeCondition(c).text).join())).toEqual([
            'area < 10', '10 ≤ area < 50', 'area ≥ 50', ''
        ]);
        const middle = analysis.rows[1];
        expect(middle.resolved['fill-color'].value).toBe('#bbb');
        expect(middle.resolved['line-width'].value).toBe(2);
        expect(analysis.rows[3].resolved['fill-color'].value).toBe('#ddd');
    });
});

describe('nested conditions', () => {
    const isUrban = ['==', ['get', 'urban'], true];
    const nested = ['case', isUrban, match([['G1', '#111111'], ['R', '#222222']], '#333333'), '#999999'];
    const flat = match([['G1', 4]], 1);

    it('keeps the nesting as an ordered path and matches it against shallower properties', () => {
        const analysis = analyzeRules({ 'fill-color': nested, 'line-width': flat });
        const texts = analysis.rows.map(r => r.conditions.map(c => describeCondition(c).text).join(' › '));
        expect(texts).toContain('urban = true › use_zones = G1');
        expect(texts).toContain('use_zones = G1');

        const deep = rowFor(analysis, 'urban = true › use_zones = G1');
        expect(deep.resolved['fill-color']).toMatchObject({ value: '#111111', branch: true });
        // line-width only knows use_zones, so it contributes its G1 branch to the deep rule too
        expect(deep.resolved['line-width'].value).toBe(4);

        const shallow = rowFor(analysis, 'use_zones = G1');
        expect(shallow.resolved['fill-color'].value).toBe('#999999');
        expect(shallow.resolved['line-width'].value).toBe(4);
    });

    it('shows a test it cannot read as JSON and flags it complex', () => {
        const odd = ['within', { type: 'Polygon', coordinates: [] }];
        const { rows } = analyzeRules({ 'fill-color': ['case', odd, '#000', '#fff'] });
        expect(describeCondition(rows[0].conditions[0]).complex).toBe(true);
    });
});

describe('filters', () => {
    it('evaluates in / == / all / any / ! with unknowns', () => {
        const A = { match: new Map([[JSON.stringify(INPUT), 'G1']]), case: new Set(), range: new Map() };
        expect(evalFilter(['in', INPUT, ['literal', ['G1', 'T1']]], A)).toBe(true);
        expect(evalFilter(['in', INPUT, ['literal', ['R']]], A)).toBe(false);
        expect(evalFilter(['==', INPUT, 'G1'], A)).toBe(true);
        expect(evalFilter(['!', ['==', INPUT, 'G1']], A)).toBe(false);
        expect(evalFilter(['all', ['==', INPUT, 'G1'], ['has', 'x']], A)).toBeUndefined();
        expect(evalFilter(['any', ['==', INPUT, 'G1'], ['has', 'x']], A)).toBe(true);
        expect(evalFilter(['in', ['get', 'other'], ['literal', ['a']]], A)).toBeUndefined();
    });
});

describe('writing an edit back', () => {
    it('replaces just the branch a rule resolved to', () => {
        const analysis = analyzeRules(LANDUSE);
        const g1 = rowFor(analysis, 'use_zones = G1');
        const { path } = g1.resolved['line-color'];
        const next = setAtPath(LANDUSE['line-color'], path, '#ff0000');

        expect(resolveUnder(next, { match: new Map([[JSON.stringify(INPUT), 'G1']]), case: new Set(), range: new Map() }).value).toBe('#ff0000');
        expect(next[next.indexOf('R') + 1]).toBe('#9c9c9c');
        expect(LANDUSE['line-color'][LANDUSE['line-color'].indexOf('G1') + 1]).toBe('#000000');
    });

    it('edits the fallback through the default row', () => {
        const fallback = analyzeRules(LANDUSE).rows.at(-1);
        const next = setAtPath(LANDUSE['line-width'], fallback.resolved['line-width'].path, 3);
        expect(next.at(-1)).toBe(3);
    });
});

import { collectFilters, LAYER_FILTER_KEY } from '../style-rules.js';

describe('describing filters', () => {
    it('reads the legacy filter syntax, which names the field as a plain string', () => {
        expect(describeExpression(['==', 'kind', 'park']).text).toBe('kind = park');
        expect(describeExpression(['>=', 'area', 10]).text).toBe('area ≥ 10');
        expect(describeExpression(['in', 'use', 'A', 'B']).text).toBe('use in A, B');
        expect(describeExpression(['!in', 'use', 'A']).text).toBe('use not in A');
        expect(describeExpression(['!has', 'name']).text).toBe('not has name');
        expect(describeExpression(['all', ['==', 'a', 1], ['has', 'b']]).text).toBe('a = 1 and has b');
    });

    it('shortens a long list of values', () => {
        const text = describeExpression(['in', INPUT, ['literal', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']]]).text;
        expect(text).toBe('use_zones in a, b, c, d, e, … (8 values)');
    });
});

describe('collectFilters', () => {
    it('lists the layer filter and each overlay filter with the properties it governs', () => {
        const filters = collectFilters(LANDUSE, ['==', ['get', 'zone'], 'N']);
        expect(filters.map(f => [f.key, f.scope, f.kind])).toEqual([
            [LAYER_FILTER_KEY, 'Layer', 'layer'],
            ['hatch/filter', 'Overlay “hatch”', 'variant']
        ]);
        expect(filters[1].governs).toEqual(['hatch/fill-pattern']);
    });

    it('includes a bare style filter as the base style\'s, and nothing when there are none', () => {
        const [only] = collectFilters({ filter: ['has', 'x'], 'fill-color': '#fff' });
        expect(only).toMatchObject({ key: 'filter', scope: 'Base style', governs: ['fill-color'] });
        expect(collectFilters({ 'fill-color': '#fff' })).toEqual([]);
        expect(collectFilters({}, null)).toEqual([]);
    });
});

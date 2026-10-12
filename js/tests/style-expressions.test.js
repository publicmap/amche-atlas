import { describe, it, expect } from 'vitest';
import {
    withStates, splitStates, buildCategorized, buildGraduated, serializeSymbology, parseSymbology,
    uniqueValues, numericValues, classBreaks, sampleRamp, sampleNumbers, COLOR_RAMPS
} from '../style-expressions.js';

const selected = ['boolean', ['feature-state', 'selected'], false];
const hover = ['boolean', ['feature-state', 'hover'], false];

describe('states', () => {
    it('wraps a base value with selected before hover, so selection wins', () => {
        expect(withStates('#aaa', { hover: '#0f0', selected: '#f00' })).toEqual(['case', selected, '#f00', hover, '#0f0', '#aaa']);
        expect(withStates('#aaa', {})).toBe('#aaa');
        expect(withStates('#aaa', { hover: '#0f0' })).toEqual(['case', hover, '#0f0', '#aaa']);
    });

    it('splits them back out, leaving unrelated case expressions alone', () => {
        expect(splitStates(['case', selected, 1, hover, 2, 3])).toEqual({ base: 3, selected: 1, hover: 2 });
        const other = ['case', ['==', ['get', 'a'], 1], 'x', 'y'];
        expect(splitStates(other)).toEqual({ base: other });
    });
});

describe('categorized', () => {
    const categories = [{ value: 'Park', output: '#0a0' }, { value: 'Road', output: '#555' }];

    it('matches on the stringified field with a fallback', () => {
        expect(buildCategorized({ field: 'use', categories, fallback: '#ccc' })).toEqual(
            ['match', ['to-string', ['get', 'use']], 'Park', '#0a0', 'Road', '#555', '#ccc']
        );
    });

    it('drops blank and duplicate labels, which match would reject', () => {
        const built = buildCategorized({
            field: 'use', fallback: '#ccc',
            categories: [...categories, { value: 'Park', output: '#f00' }, { value: '', output: '#000' }]
        });
        expect(built).toEqual(['match', ['to-string', ['get', 'use']], 'Park', '#0a0', 'Road', '#555', '#ccc']);
    });

    it('collapses to the fallback when there are no categories', () => {
        expect(buildCategorized({ field: 'use', categories: [], fallback: '#ccc' })).toBe('#ccc');
    });

    it('round-trips through parseSymbology, including states', () => {
        const model = { mode: 'categorized', field: 'use', raw: false, categories, fallback: '#ccc', hover: '#ff0', selected: '#f00' };
        expect(parseSymbology(serializeSymbology(model))).toEqual(model);
    });
});

describe('graduated', () => {
    it('builds step classes with a non-numeric fallback', () => {
        const built = buildGraduated({ field: 'area', kind: 'step', breaks: [10, 20], outputs: ['#a', '#b', '#c'], fallback: '#ccc' });
        expect(built).toEqual(['case', ['==', ['typeof', ['get', 'area']], 'number'],
            ['step', ['get', 'area'], '#a', 10, '#b', 20, '#c'], '#ccc']);
    });

    it('builds continuous stops in ascending order without duplicate stops', () => {
        const built = buildGraduated({ field: 'a', kind: 'interpolate', breaks: [20, 10, 10], outputs: ['#b', '#a', '#x'], fallback: '#ccc' });
        expect(built[2]).toEqual(['interpolate', ['linear'], ['get', 'a'], 10, '#a', 20, '#b']);
    });

    it('round-trips step and interpolate models', () => {
        const step = { mode: 'graduated', field: 'a', kind: 'step', breaks: [1, 2], outputs: [5, 6, 7], fallback: 0 };
        const stops = { mode: 'graduated', field: 'a', kind: 'interpolate', breaks: [1, 2], outputs: ['#000000', '#ffffff'], fallback: '#999999' };
        expect(parseSymbology(serializeSymbology(step))).toEqual(step);
        expect(parseSymbology(serializeSymbology(stops))).toEqual(stops);
    });

    it('reads a bare interpolate expression with no fallback', () => {
        const parsed = parseSymbology(['interpolate', ['linear'], ['get', 'a'], 0, '#000', 10, '#fff']);
        expect(parsed).toMatchObject({ mode: 'graduated', kind: 'interpolate', fallback: undefined });
    });
});

describe('parseSymbology', () => {
    it('reads literals and the creator\'s coalesce colour as a single value', () => {
        expect(parseSymbology('#123456')).toEqual({ mode: 'single', single: '#123456', hover: undefined, selected: undefined });
        const coalesce = ['coalesce', ['get', 'fill-color'], ['get', 'color'], '#3b82f6'];
        const parsed = parseSymbology(coalesce);
        expect(parsed).toMatchObject({ mode: 'single', single: '#3b82f6', coalesce: [['get', 'fill-color'], ['get', 'color']] });
        expect(serializeSymbology(parsed)).toEqual(coalesce);
    });

    it('treats zoom-driven and unknown expressions as custom', () => {
        expect(parseSymbology(['interpolate', ['linear'], ['zoom'], 5, 1, 10, 2]).mode).toBe('custom');
        expect(parseSymbology(['match', ['get', 'a'], 'x', ['get', 'b'], '#000']).mode).toBe('custom');
        expect(parseSymbology(undefined).mode).toBe('custom');
    });
});

describe('classification', () => {
    it('counts distinct values, most common first, skipping blanks', () => {
        expect(uniqueValues(['b', 'a', 'b', '', null, undefined, 'c', 'b', 'a'])).toEqual([
            { value: 'b', count: 3 }, { value: 'a', count: 2 }, { value: 'c', count: 1 }
        ]);
    });

    it('keeps only finite numbers', () => {
        expect(numericValues([1, '2', NaN, null, 3.5, Infinity])).toEqual([1, 3.5]);
    });

    it('makes equal-interval breaks: classes - 1 for step, classes for interpolate', () => {
        const data = [0, 10, 20, 30, 40];
        expect(classBreaks(data, { classes: 4, kind: 'step' })).toEqual([10, 20, 30]);
        expect(classBreaks(data, { classes: 5, kind: 'interpolate' })).toEqual([0, 10, 20, 30, 40]);
    });

    it('makes quantile breaks that follow the data distribution', () => {
        const skewed = [1, 1, 1, 1, 2, 2, 3, 50, 100, 100];
        const breaks = classBreaks(skewed, { classes: 2, method: 'quantile', kind: 'step' });
        expect(breaks).toHaveLength(1);
        expect(breaks[0]).toBeLessThan(10);
    });

    it('handles empty and constant data', () => {
        expect(classBreaks([], { classes: 5 })).toEqual([]);
        expect(classBreaks([7, 7, 7], { classes: 3, kind: 'step' })).toEqual([7]);
    });

    it('samples a colour ramp end to end and interpolates between stops', () => {
        const colors = sampleRamp(['#000000', '#ffffff'], 3);
        expect(colors).toEqual(['#000000', '#808080', '#ffffff']);
        expect(sampleRamp(COLOR_RAMPS.Viridis, 5)).toEqual(COLOR_RAMPS.Viridis);
        expect(sampleNumbers(1, 5, 3)).toEqual([1, 3, 5]);
    });
});

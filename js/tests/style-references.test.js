import { describe, it, expect, vi } from 'vitest';
import {
    parseStyleReference, formatStyleReference, resolveStyleReferences, previewReference, referenceCandidates
} from '../style-references.js';

const MATCH = ['match', ['to-string', ['get', 'use']], 'Park', '#16a34a', '#9ca3af'];

const context = {
    getConstants: () => ({ brand: '#ff0000', zones: MATCH, alias: '$brand' }),
    getLayerStyle: (id) => ({
        roads: { 'line-color': '#222222', 'fill-color': '@line-color' },
        loop: { 'fill-color': '@loop#line-color', 'line-color': '@loop#fill-color' }
    }[id] || null),
    listLayers: () => [{ id: 'roads', title: 'Roads', style: {} }, { id: 'self', title: 'Self', style: {} }]
};

describe('parse / format', () => {
    it('reads the three reference forms and rejects ordinary values', () => {
        expect(parseStyleReference('$brand')).toEqual({ kind: 'constant', name: 'brand' });
        expect(parseStyleReference('@fill-color')).toEqual({ kind: 'property', layerId: null, property: 'fill-color' });
        expect(parseStyleReference('@my-layer-01#fill-color')).toEqual({ kind: 'property', layerId: 'my-layer-01', property: 'fill-color' });
        expect(parseStyleReference('#ff0000')).toBeNull();
        expect(parseStyleReference('cost $5')).toBeNull();
        expect(parseStyleReference(['get', 'x'])).toBeNull();
    });

    it('round-trips', () => {
        ['$brand', '@fill-color', '@roads#line-color', '@overlay/line-color'].forEach(text => {
            expect(formatStyleReference(parseStyleReference(text))).toBe(text);
        });
    });
});

describe('resolveStyleReferences', () => {
    it('lets line-color inherit the full categorized mapping from fill-color', () => {
        const style = { 'fill-color': MATCH, 'line-color': '@fill-color', 'line-width': 2 };
        const resolved = resolveStyleReferences(style, context);
        expect(resolved['line-color']).toEqual(MATCH);
        expect(resolved['line-width']).toBe(2);
        expect(style['line-color']).toBe('@fill-color');
    });

    it('inherits hover / selected states along with the mapping', () => {
        const stateful = ['case', ['boolean', ['feature-state', 'hover'], false], '#ff0', MATCH];
        const resolved = resolveStyleReferences({ 'fill-color': stateful, 'line-color': '@fill-color' }, context);
        expect(resolved['line-color']).toEqual(stateful);
    });

    it('resolves atlas constants, including a constant that names another', () => {
        const resolved = resolveStyleReferences({ 'fill-color': '$zones', 'line-color': '$alias' }, context);
        expect(resolved['fill-color']).toEqual(MATCH);
        expect(resolved['line-color']).toBe('#ff0000');
        resolved['fill-color'][4] = 'mutated';
        expect(context.getConstants().zones[4]).toBe('#9ca3af');
    });

    it('reads another layer\'s style, following that layer\'s own references', () => {
        const resolved = resolveStyleReferences({ 'fill-color': '@roads#fill-color' }, context);
        expect(resolved['fill-color']).toBe('#222222');
    });

    it('follows chains within one style, across variant prefixes', () => {
        const resolved = resolveStyleReferences({ 'fill-color': '#abcdef', 'line-color': '@fill-color', 'overlay/line-color': '@line-color' }, context);
        expect(resolved['overlay/line-color']).toBe('#abcdef');
    });

    it('drops a reference that cannot resolve instead of leaking the "@..." string', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const resolved = resolveStyleReferences({
            'fill-color': '@missing', 'line-color': '@nowhere#line-color', 'circle-color': '#fff'
        }, context);
        expect(resolved).toEqual({ 'circle-color': '#fff' });
        warn.mockRestore();
    });

    it('breaks circular references by dropping them', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(resolveStyleReferences({ 'fill-color': '@line-color', 'line-color': '@fill-color' }, context)).toEqual({});
        expect(resolveStyleReferences({ 'fill-color': '@loop#fill-color' }, context)).toEqual({});
        warn.mockRestore();
    });

    it('leaves an unknown constant as-is, like atlas-file substitution, and never touches non-colour properties', () => {
        const resolved = resolveStyleReferences({ 'fill-color': '$unknown', 'text-field': '$brand' }, context);
        expect(resolved).toEqual({ 'fill-color': '$unknown', 'text-field': '$brand' });
    });

    it('returns the same object when there is nothing to resolve', () => {
        const style = { 'fill-color': '#fff' };
        expect(resolveStyleReferences(style, context)).toBe(style);
    });
});

describe('helpers for the editor', () => {
    it('previews what a reference points at, or undefined when broken', () => {
        expect(previewReference('@fill-color', { 'fill-color': MATCH }, context)).toEqual(MATCH);
        expect(previewReference('@nope', { 'fill-color': MATCH }, context)).toBeUndefined();
        expect(previewReference('$unknown', {}, context)).toBeUndefined();
    });

    it('lists constants and other layers, minus the one being edited', () => {
        const candidates = referenceCandidates('self', context);
        expect(Object.keys(candidates.constants)).toContain('brand');
        expect(candidates.layers.map(l => l.id)).toEqual(['roads']);
        expect(referenceCandidates('x', null)).toEqual({ constants: {}, layers: [] });
    });
});

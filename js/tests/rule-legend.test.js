import { describe, it, expect } from 'vitest';
import { ruleLegendItems, ruleFilter } from '../rule-legend.js';

const zones = (extra = {}) => ({
    inspect: { label: 'use_zones' },
    style: {
        'fill-color': ['match', ['to-string', ['get', 'use_zones']], 'A1', '#ffebbe', 'P1', '#267300', '#cccccc'],
        'line-width': 0.5,
        ...extra
    }
});

describe('ruleLegendItems', () => {
    it('has no items for a style without rules', () => {
        expect(ruleLegendItems({ style: { 'fill-color': '#ff0000' } })).toEqual([]);
    });

    it('titles each rule by the inspect.label value and shows the data expression beneath', () => {
        const items = ruleLegendItems(zones());
        expect(items.map(i => [i.title, i.subtitle])).toEqual([
            ['A1', 'use_zones = A1'],
            ['P1', 'use_zones = P1'],
            ['Other', 'all other features']
        ]);
    });

    it('falls back to the expression as the title when the rule is not about the label field', () => {
        const items = ruleLegendItems({ ...zones(), inspect: { label: 'name' } });
        expect(items[0]).toMatchObject({ title: 'use_zones = A1', subtitle: '' });
    });

    it('draws each rule from the properties that apply to it', () => {
        const [a1] = ruleLegendItems(zones());
        expect(a1.row.resolved['fill-color'].value).toBe('#ffebbe');
    });
});

describe('ruleFilter', () => {
    const KIND = ['==', ['to-string', ['to-string', ['get', 'use_zones']]], 'A1'];

    it('keeps the features a rule draws', () => {
        expect(ruleFilter(zones(), 'm|["to-string",["get","use_zones"]]|A1')).toEqual(KIND);
    });

    it('keeps what no other rule matches for the fallback', () => {
        const filter = ruleFilter(zones(), 'default');
        expect(filter[0]).toBe('!');
        expect(filter[1][0]).toBe('any');
        expect(filter[1]).toHaveLength(3);
    });

    it('is null for an unknown rule', () => {
        expect(ruleFilter(zones(), 'nope')).toBeNull();
    });

    it('is null when the rule tests feature state', () => {
        const style = { 'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#fff', '#000'] };
        const rows = ruleLegendItems({ style });
        rows.forEach(item => expect(ruleFilter({ style }, item.id)).toBeNull());
    });
});

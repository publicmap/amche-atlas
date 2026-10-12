import { describe, it, expect } from 'vitest';
import { ruleLegendItems } from '../rule-legend.js';

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

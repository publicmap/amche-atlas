// @vitest-environment jsdom

import { tagFilterBar, filterByTags } from '../console/tag-filter.js';

const layers = [
    { id: 'a', tags: ['Regulatory', 'slope'] },
    { id: 'b', tags: ['Regulatory', 'crz'] },
    { id: 'c', tags: ['amenity'] },
    { id: 'd', tags: ['Regulatory', 'crz', '2011'] },
    { id: 'e' }
];

const rows = (bar) => [...bar.querySelectorAll('.console-tag-row')]
    .map(row => [...row.querySelectorAll('.console-tag-chip')].map(chip => chip.textContent));

describe('Find tag filters', () => {
    it('lists top-level tags alphabetically with counts', () => {
        expect(rows(tagFilterBar(layers, [], () => {}))).toEqual([['amenity(1)', 'Regulatory(3)']]);
    });

    it('adds a row for the next level of each chosen tag', () => {
        expect(rows(tagFilterBar(layers, ['Regulatory', 'crz'], () => {}))).toEqual([
            ['amenity(1)', 'Regulatory(3)'],
            ['crz(2)', 'slope(1)'],
            ['2011(1)']
        ]);
    });

    it('narrows maps to the chosen path', () => {
        expect(filterByTags(layers, ['Regulatory', 'crz']).map(l => l.id)).toEqual(['b', 'd']);
        expect(filterByTags(layers, []).length).toBe(5);
    });

    it('steps back a level when a chosen tag is picked again', () => {
        let next = null;
        const bar = tagFilterBar(layers, ['Regulatory', 'crz'], path => { next = path; });
        bar.querySelectorAll('.console-tag-row')[1].querySelector('.selected').click();
        expect(next).toEqual(['Regulatory']);
    });

    it('leads the first row with the modes, chosen only while no tag is', () => {
        const modes = [{ id: 'active', label: 'Active', count: 2 }, { id: 'all', label: 'All', count: 5 }];
        const bar = tagFilterBar(layers, [], () => {}, { modes, mode: 'active' });
        expect(rows(bar)).toEqual([['Active(2)', 'All(5)', 'amenity(1)', 'Regulatory(3)']]);
        expect(bar.querySelector('.selected').textContent).toBe('Active(2)');
        const narrowed = tagFilterBar(layers, ['amenity'], () => {}, { modes, mode: 'all' });
        expect([...narrowed.querySelectorAll('.selected')].map(chip => chip.textContent)).toEqual(['amenity(1)']);
    });

    it('reports a mode click, and shows the modes when no map has tags', () => {
        let picked = null;
        const bar = tagFilterBar([{ id: 'x' }], [], () => {}, { modes: [{ id: 'all', label: 'All', count: 1 }], mode: 'active', onMode: id => { picked = id; } });
        bar.querySelector('.console-mode-chip').click();
        expect(picked).toBe('all');
        expect(tagFilterBar([{ id: 'x' }], [], () => {})).toBeNull();
    });
});

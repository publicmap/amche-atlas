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
});

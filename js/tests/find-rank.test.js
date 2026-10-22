import { matchRank, byRank } from '../console/find-rank.js';

describe('Find name ranking', () => {
    it('ranks starts-with, whole word, word start, substring, then other text', () => {
        expect(matchRank('CRZ Maps 2011', 'crz')).toBe(0);
        expect(matchRank('Goa CRZ 2011', 'crz')).toBe(1);
        expect(matchRank('Goa (CRZ) zones', 'crz')).toBe(1);
        expect(matchRank('Goa CRZones', 'crz')).toBe(2);
        expect(matchRank('NoCRZ areas', 'crz')).toBe(3);
        expect(matchRank('Coastal zones', 'crz', ['crz notification'])).toBe(4);
        expect(matchRank('Coastal zones', 'crz')).toBe(5);
    });

    it('sorts by rank and keeps the original order within a rank', () => {
        const names = ['NoCRZ areas', 'Goa CRZ 2019', 'CRZ 2011', 'Goa CRZ 2011', 'Goa CRZones', 'CRZ 1991'];
        expect(byRank(names, 'crz', name => name)).toEqual([
            'CRZ 2011', 'CRZ 1991', 'Goa CRZ 2019', 'Goa CRZ 2011', 'Goa CRZones', 'NoCRZ areas'
        ]);
    });
});

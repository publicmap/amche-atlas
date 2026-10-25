import { describe, it, expect } from 'vitest';
import { placeLine } from '../map-search-toggle.js';

describe('placeLine', () => {
    it('reads neighbourhood, then quarter or suburb, then town or city', () => {
        expect(placeLine({ neighbourhood: 'Fontainhas', suburb: 'Altinho', quarter: 'Mala', city: 'Panaji', county: 'Tiswadi' }))
            .toBe('Fontainhas, Mala, Panaji');
        expect(placeLine({ neighbourhood: 'Fontainhas', suburb: 'Altinho', city: 'Panaji' })).toBe('Fontainhas, Altinho, Panaji');
        expect(placeLine({ suburb: 'Bainguinim', town: 'Old Goa', city: 'Panaji' })).toBe('Bainguinim, Old Goa');
    });

    it('fills from coarser units where the finer ones are missing', () => {
        expect(placeLine({ suburb: 'Bainguinim', city: 'Panaji', county: 'Tiswadi', state: 'Goa' })).toBe('Bainguinim, Panaji, Tiswadi');
        expect(placeLine({ village: 'Aldona', county: 'Bardez', state: 'Goa' })).toBe('Aldona, Bardez, Goa');
    });

    it('skips repeated names and honours the count', () => {
        expect(placeLine({ suburb: 'Panaji', city: 'Panaji', county: 'Tiswadi' }, 2)).toBe('Panaji, Tiswadi');
        expect(placeLine(null)).toBe('');
    });
});

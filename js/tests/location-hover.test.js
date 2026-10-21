import { describe, it, expect } from 'vitest';
import { directionTo } from '../location-hover.js';

describe('location-hover', () => {
    const PANAJI = [73.8278, 15.4909];

    it('gives the distance and compass direction to a place', () => {
        expect(directionTo(PANAJI, [73.8148, 15.5937]).text).toBe('12 km North');
        expect(directionTo(PANAJI, [73.80, 15.47]).compass).toBe('Southwest');
        expect(directionTo(PANAJI, [73.8278, 15.4949]).text).toBe('440 m North');
        expect(directionTo(PANAJI, [73.85, 15.50]).text).toBe('2.6 km Northeast');
    });

    it('calls a place under the current location here', () => {
        expect(directionTo(PANAJI, [73.82781, 15.49091])).toMatchObject({ compass: null, text: 'here' });
    });
});

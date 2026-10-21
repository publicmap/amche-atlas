import { scaleDenominator, formatScale, zoomForScale, scaleOptions } from '../map-scale-control.js';
import { scaleBarSpec } from '../map-scale-bar.js';

describe('map scale bar', () => {
    it('picks the largest 1, 2 or 5 distance that fits', () => {
        expect(scaleBarSpec(3, 100)).toEqual({ width: 200 / 3, total: 200, half: 100, unit: 'm' });
        expect(scaleBarSpec(60, 100)).toEqual({ width: 5000 / 60, total: 5, half: 2.5, unit: 'km' });
        expect(scaleBarSpec(10, 100)).toEqual({ width: 100, total: 1, half: 0.5, unit: 'km' });
    });

    it('is empty for an unusable resolution', () => {
        expect(scaleBarSpec(NaN)).toBeNull();
        expect(scaleBarSpec(0)).toBeNull();
    });
});

describe('map scale control', () => {
    it('computes the representative fraction at the equator', () => {
        expect(scaleDenominator(0, 0)).toBeCloseTo(295829355, -3);
        expect(scaleDenominator(0, 10)).toBeCloseTo(288896, -1);
    });

    it('shrinks with latitude', () => {
        expect(scaleDenominator(60, 10)).toBeCloseTo(scaleDenominator(0, 10) / 2, 0);
    });

    it('rounds to three significant figures', () => {
        expect(formatScale(288896)).toBe(`Scale: 1:${(289000).toLocaleString()}`);
        expect(formatScale(1234.5)).toBe(`Scale: 1:${(1230).toLocaleString()}`);
        expect(formatScale(42.4)).toBe('Scale: 1:42');
    });

    it('inverts the scale back to a zoom', () => {
        expect(zoomForScale(15, scaleDenominator(15, 12.5))).toBeCloseTo(12.5, 6);
    });

    it('lists zooms and common scales together, zoomed out first', () => {
        const options = scaleOptions(15);
        const zooms = options.filter(option => option.label);
        expect(zooms.map(option => option.label)).toEqual(Array.from({ length: 20 }, (_, z) => `z${z}`));
        const denominators = options.map(option => option.denominator);
        expect(denominators).toEqual([...denominators].sort((a, b) => b - a));
        expect(options.some(option => !option.label && option.denominator === 50000)).toBe(true);
    });

    it('keeps to the zooms the map allows', () => {
        const options = scaleOptions(15, 5, 16);
        expect(options.every(option => option.zoom >= 5 && option.zoom <= 16)).toBe(true);
        expect(options.some(option => option.denominator === 500)).toBe(false);
    });

    it('is blank for an unusable value', () => {
        expect(formatScale(NaN)).toBe('');
        expect(formatScale(0)).toBe('');
    });
});

import { describe, it, expect } from 'vitest';

const { styleLiteral, toHexColor, colorAlpha } = await import('../map-creator.js');

describe('styleLiteral', () => {
    it('unwraps the coalesce form buildStyleFromControls emits', () => {
        expect(styleLiteral(['coalesce', ['get', 'fill-color'], ['get', 'color'], '#10b981'])).toBe('#10b981');
    });

    it('passes plain literals through and rejects other expressions', () => {
        expect(styleLiteral('#10b981')).toBe('#10b981');
        expect(styleLiteral(2)).toBe(2);
        expect(styleLiteral(['interpolate', ['linear'], ['zoom'], 0, 1])).toBeUndefined();
        expect(styleLiteral(undefined)).toBeUndefined();
    });
});

describe('toHexColor', () => {
    it('converts rgb/rgba to the #rrggbb an <input type="color"> needs', () => {
        expect(toHexColor('rgba(16,185,129,0.25)')).toBe('#10b981');
        expect(toHexColor('rgb(1, 106, 71)')).toBe('#016a47');
    });

    it('normalizes hex shorthands and drops any alpha channel', () => {
        expect(toHexColor('#fff')).toBe('#ffffff');
        expect(toHexColor('#10B981')).toBe('#10b981');
        expect(toHexColor('#10b981ff')).toBe('#10b981');
    });

    it('leaves the control alone for values it cannot represent', () => {
        expect(toHexColor('rebeccapurple')).toBeUndefined();
        expect(toHexColor('#12345')).toBeUndefined();
        expect(toHexColor(undefined)).toBeUndefined();
    });
});

describe('colorAlpha', () => {
    it('lifts the alpha baked into a colour', () => {
        expect(colorAlpha('rgba(16,185,129,0.25)')).toBe(0.25);
        expect(colorAlpha('#10b98180')).toBeCloseTo(0.502, 2);
    });

    it('returns undefined for fully opaque forms', () => {
        expect(colorAlpha('rgb(16,185,129)')).toBeUndefined();
        expect(colorAlpha('#10b981')).toBeUndefined();
    });
});

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { fallbackLiteral } from '../layer-style-utils.js';
import { pickedColor, createColorSwatch } from '../color-swatch.js';

describe('fallbackLiteral', () => {
    it('takes the default branch of a match or case', () => {
        expect(fallbackLiteral(['match', ['get', 'use'], 'Road', '#000', 'Park', '#0f0', '#999'])).toBe('#999');
        expect(fallbackLiteral(['case', ['boolean', ['feature-state', 'hover'], false], '#ff0', '#123456'])).toBe('#123456');
    });

    it('takes the last value of a coalesce and the base of a step', () => {
        expect(fallbackLiteral(['coalesce', ['get', 'fill-color'], ['get', 'color'], '#10b981'])).toBe('#10b981');
        expect(fallbackLiteral(['step', ['get', 'area'], '#eee', 10, '#888', 100, '#111'])).toBe('#eee');
    });

    it('takes the first stop of an interpolation and unwraps nested fallbacks', () => {
        expect(fallbackLiteral(['interpolate', ['linear'], ['zoom'], 8, 1, 16, 4])).toBe(1);
        expect(fallbackLiteral(['case', ['==', ['get', 'a'], 1], 'red', ['match', ['get', 'b'], 'x', 'blue', 'rgba(0, 0, 0, 0.5)']])).toBe('rgba(0, 0, 0, 0.5)');
    });

    it('passes literals through and gives nothing for a bare lookup', () => {
        expect(fallbackLiteral('#abc')).toBe('#abc');
        expect(fallbackLiteral(3)).toBe(3);
        expect(fallbackLiteral(['get', 'color'])).toBeUndefined();
        expect(fallbackLiteral(undefined)).toBeUndefined();
    });
});

describe('pickedColor', () => {
    it('writes an opaque colour as #rrggbb and a translucent one as rgba()', () => {
        expect(pickedColor('#ff0000ff')).toBe('#ff0000');
        expect(pickedColor('#0000ff80')).toBe('rgba(0, 0, 255, 0.5)');
        expect(pickedColor('rgba(1, 2, 3, 0.25)')).toBe('rgba(1, 2, 3, 0.25)');
        expect(pickedColor('not a colour')).toBeNull();
    });
});

describe('createColorSwatch', () => {
    it('shows the colour with its alpha and reports what is picked', () => {
        const picked = [];
        const swatch = createColorSwatch('rgba(255, 0, 0, 0.4)', (color) => picked.push(color));
        expect(swatch.tagName).toBe('SL-COLOR-PICKER');
        expect(swatch.hasAttribute('opacity')).toBe(true);
        expect(swatch.value).toBe('rgba(255, 0, 0, 0.4)');

        swatch.value = '#00ff0033';
        swatch.dispatchEvent(new Event('sl-input'));
        expect(picked).toEqual(['rgba(0, 255, 0, 0.2)']);
    });
});

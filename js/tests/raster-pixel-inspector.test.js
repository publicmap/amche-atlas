import { describe, it, expect } from 'vitest';
import { RasterPixelInspector } from '../raster-pixel-inspector.js';

const WORLDCOVER_LEGEND = [
    { value: 10, color: '#006400', label: 'Tree cover' },
    { value: 50, color: '#fa0000', label: 'Built-up' },
    { value: 80, color: '#0064c8', label: 'Permanent water bodies' }
];

describe('RasterPixelInspector.matchClass', () => {
    it('matches an exact color to its class', () => {
        const match = RasterPixelInspector.matchClass(WORLDCOVER_LEGEND, { r: 0, g: 100, b: 0, a: 255 });
        expect(match?.label).toBe('Tree cover');
    });

    it('matches a slightly off color (tile compression/antialiasing) within tolerance', () => {
        const match = RasterPixelInspector.matchClass(WORLDCOVER_LEGEND, { r: 2, g: 98, b: 3, a: 255 });
        expect(match?.label).toBe('Tree cover');
    });

    it('returns null when no class is close enough', () => {
        const match = RasterPixelInspector.matchClass(WORLDCOVER_LEGEND, { r: 255, g: 255, b: 255, a: 255 });
        expect(match).toBeNull();
    });

    it('returns null for a fully transparent pixel', () => {
        const match = RasterPixelInspector.matchClass(WORLDCOVER_LEGEND, { r: 0, g: 100, b: 0, a: 0 });
        expect(match).toBeNull();
    });

    it('returns null for an empty or missing legendMap', () => {
        expect(RasterPixelInspector.matchClass([], { r: 0, g: 100, b: 0, a: 255 })).toBeNull();
        expect(RasterPixelInspector.matchClass(null, { r: 0, g: 100, b: 0, a: 255 })).toBeNull();
    });

    it('picks the nearest class when two are both within tolerance', () => {
        const legend = [
            { value: 1, color: '#000000', label: 'Black' },
            { value: 2, color: '#0a0a0a', label: 'Near-black' }
        ];
        const match = RasterPixelInspector.matchClass(legend, { r: 8, g: 8, b: 8, a: 255 });
        expect(match?.label).toBe('Near-black');
    });
});

describe('RasterPixelInspector.sample', () => {
    it('returns null when the map has no canvas', () => {
        expect(RasterPixelInspector.sample({ getCanvas: () => null }, { x: 0, y: 0 })).toBeNull();
    });

    it('returns null when the canvas has no WebGL context', () => {
        const map = { getCanvas: () => ({ getContext: () => null }) };
        expect(RasterPixelInspector.sample(map, { x: 0, y: 0 })).toBeNull();
    });
});

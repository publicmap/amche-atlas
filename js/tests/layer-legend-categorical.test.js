// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { LayerLegend } from '../layer-legend.js';

describe('LayerLegend categorical (legendMap) rendering', () => {
    it('renders one swatch row per legendMap entry', () => {
        const layer = {
            legendMap: [
                { value: 10, color: '#006400', label: 'Tree cover' },
                { value: 80, color: '#0064c8', label: 'Permanent water bodies' }
            ]
        };

        const el = LayerLegend.generate(layer);
        expect(el).not.toBeNull();
        expect(el.className).toBe('legend-categorical');

        const rows = el.children;
        expect(rows.length).toBe(2);
        expect(rows[0].textContent).toBe('Tree cover');
        expect(rows[1].textContent).toBe('Permanent water bodies');
    });

    it('prefers legendMap over legendImage when both are present', () => {
        const layer = {
            legendImage: 'assets/some-legend.png',
            legendMap: [{ value: 1, color: '#ff0000', label: 'Only class' }]
        };

        const el = LayerLegend.generate(layer);
        expect(el.className).toBe('legend-categorical');
    });

    it('falls back to legendImage when legendMap is absent', () => {
        const layer = { legendImage: 'assets/some-legend.png' };
        const el = LayerLegend.generate(layer);
        expect(el.className).toBe('legend-raster');
    });

    it('returns null for an empty legendMap array', () => {
        const layer = { legendMap: [] };
        expect(LayerLegend.generate(layer)).toBeNull();
    });
});

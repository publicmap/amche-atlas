import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeKey, keyFragment, keyToHexa, hexaToKey, canColorKey, withColorKey, setPixelEdits, pixelFragment } from '../raster-color-key.js';

describe('raster color key', () => {
    beforeEach(() => {
        globalThis.window = { mapboxgl: { addTileProvider: () => {} } };
    });

    it('fills in and clamps a key', () => {
        expect(normalizeKey(null)).toBeNull();
        expect(normalizeKey({ color: '#FFAA00', alpha: 2, tolerance: -1 })).toEqual({ color: '#ffaa00', alpha: 1, tolerance: 0 });
        expect(normalizeKey({})).toEqual({ color: '#ffffff', alpha: 0, tolerance: 0.1 });
    });

    it('round-trips the picker value with its opacity', () => {
        expect(keyToHexa({ color: '#ffffff', alpha: 0 })).toBe('#ffffff00');
        expect(hexaToKey('#ff000080', 0.2)).toEqual({ color: '#ff0000', alpha: 128 / 255, tolerance: 0.2 });
        expect(hexaToKey('#00ff00', 0.1).alpha).toBe(1);
    });

    it('writes the key into the tile fragment', () => {
        expect(keyFragment({ color: '#ffffff', alpha: 0, tolerance: 0.1 })).toBe('#ck=ffffff,0,0.1');
    });

    it('only keys tile layers it can fetch', () => {
        expect(canColorKey({ type: 'tms', url: 'https://x/{z}/{x}/{y}.png' })).toBe(true);
        expect(canColorKey({ type: 'tms', url: 'mapbox://mapbox.satellite' })).toBe(false);
        expect(canColorKey({ type: 'img', url: 'https://x/a.png' })).toBe(false);
        globalThis.window.mapboxgl = {};
        expect(canColorKey({ type: 'wms', url: 'https://x/wms' })).toBe(false);
    });

    it('routes a keyed source through the provider', () => {
        const source = { type: 'raster', tiles: ['https://x/{z}/{x}/{y}.png'] };
        const config = { type: 'tms', url: source.tiles[0], colorKey: { color: '#ffffff', alpha: 0, tolerance: 0.1 } };
        expect(withColorKey(source, { ...config, colorKey: undefined })).toBe(source);
        const keyed = withColorKey(source, config);
        expect(keyed.provider).toBe('colorkey');
        expect(keyed.tiles[0]).toBe('https://x/{z}/{x}/{y}.png#ck=ffffff,0,0.1');
    });

    it('re-keys and clears a live source', () => {
        const source = { _options: { tiles: ['https://x/{z}/{x}/{y}.png#ck=ffffff,0,0.1'], provider: 'colorkey' }, setTiles(tiles) { this._options.tiles = tiles; } };
        setPixelEdits(source, { colorKey: { color: '#000000', alpha: 0.5, tolerance: 0.2 } });
        expect(source._options.tiles[0]).toBe('https://x/{z}/{x}/{y}.png#ck=000000,0.5,0.2');
        setPixelEdits(source, { recolor: { invert: true } });
        expect(source._options.tiles[0]).toBe('https://x/{z}/{x}/{y}.png#rc=i');
        setPixelEdits(source, {});
        expect(source._options.provider).toBeUndefined();
        expect(source._options.tiles[0]).toBe('https://x/{z}/{x}/{y}.png');
    });

    it('carries the recolor beside the key', () => {
        expect(pixelFragment({})).toBe('');
        expect(pixelFragment({ recolor: { grayscale: false } })).toBe('');
        expect(pixelFragment({ colorKey: { color: '#ffffff', alpha: 0, tolerance: 0.1 }, recolor: { grayscale: true, invert: true } }))
            .toBe('#ck=ffffff,0,0.1&rc=gi');
        const keyed = withColorKey({ tiles: ['https://x/{z}/{x}/{y}.png'] }, { type: 'tms', url: 'https://x/{z}/{x}/{y}.png', recolor: { grayscale: true } });
        expect(keyed.provider).toBe('colorkey');
        expect(keyed.tiles[0]).toBe('https://x/{z}/{x}/{y}.png#rc=g');
    });
});

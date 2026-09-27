/**
 * `map.style: null` asks for a base map that draws nothing of its own.
 *
 * gl-compat.js is a classic script, not a module - it runs as an IIFE against
 * `window`, so it gets loaded here the same way the browser loads it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';

const source = fs.readFileSync('js/gl-compat.js', 'utf8');

/** Run gl-compat.js against a fresh fake window for the given renderer. */
function loadGlCompat(renderer) {
    const win = { amche: { RENDERER: renderer, MAPBOXGL_ACCESS_TOKEN: 'pk.test', MAPBOX_MAP_OPTIONS: {} } };
    // MapLibre bails early with a console error when the global is missing;
    // these tests only exercise the blank-style helpers, which run before that.
    new Function('window', 'console', source)(win, { ...console, error: () => {} });
    return win.amche;
}

let mapbox;
let maplibre;

beforeEach(() => {
    mapbox = loadGlCompat('mapbox');
    maplibre = loadGlCompat('maplibre');
});

describe('isBlankStyle', () => {
    it('treats null as the request for no base map', () => {
        expect(mapbox.isBlankStyle(null)).toBe(true);
    });

    it('accepts the string spellings, for configs where a null could get stripped', () => {
        expect(mapbox.isBlankStyle('blank')).toBe(true);
        expect(mapbox.isBlankStyle('none')).toBe(true);
        expect(mapbox.isBlankStyle('empty')).toBe(true);
        expect(mapbox.isBlankStyle('BLANK')).toBe(true);
    });

    it('does not treat undefined as blank - that means unset, so inherit', () => {
        expect(mapbox.isBlankStyle(undefined)).toBe(false);
    });

    it('leaves real style URLs alone', () => {
        expect(mapbox.isBlankStyle('mapbox://styles/mapbox/standard')).toBe(false);
        expect(mapbox.isBlankStyle('https://example.com/style.json')).toBe(false);
    });
});

describe('buildBlankStyle', () => {
    it('has no sources and nothing but a background layer', () => {
        const style = mapbox.buildBlankStyle();
        expect(style.version).toBe(8);
        expect(style.sources).toEqual({});
        expect(style.layers).toHaveLength(1);
        expect(style.layers[0].type).toBe('background');
    });

    it('takes the background colour from the map block', () => {
        expect(mapbox.buildBlankStyle({ backgroundColor: '#0b1b2b' })
            .layers[0].paint['background-color']).toBe('#0b1b2b');
    });

    it('sets glyphs under Mapbox GL JS, which has no font fallback', () => {
        expect(mapbox.buildBlankStyle().glyphs).toContain('mapbox://fonts/');
    });

    it('omits glyphs under MapLibre, so the browser shapes Indic text itself', () => {
        expect(maplibre.buildBlankStyle().glyphs).toBeUndefined();
        // ...unless the atlas asks for a specific endpoint.
        expect(maplibre.buildBlankStyle({ glyphs: 'https://example.com/{fontstack}/{range}.pbf' }).glyphs)
            .toBe('https://example.com/{fontstack}/{range}.pbf');
    });

    it('ships a sprite so icon-image still resolves', () => {
        expect(mapbox.buildBlankStyle().sprite).toContain('mapbox://sprites/');
        expect(maplibre.buildBlankStyle({ sprite: 'https://example.com/sprite' }).sprite)
            .toBe('https://example.com/sprite');
    });
});

describe('resolveMapboxStyle', () => {
    it('returns a real style object for null, under either renderer', async () => {
        expect((await mapbox.resolveMapboxStyle(null)).version).toBe(8);
        expect((await maplibre.resolveMapboxStyle(null)).version).toBe(8);
    });

    it('passes a normal style URL straight through under Mapbox GL JS', async () => {
        const url = 'mapbox://styles/mapbox/standard';
        expect(await mapbox.resolveMapboxStyle(url)).toBe(url);
    });
});

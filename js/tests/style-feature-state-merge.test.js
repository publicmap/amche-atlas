import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';

// mapbox-api.js is a browser module; the merge logic under test is pure, so
// pull the three methods off the prototype rather than constructing a map.
const { MapboxAPI } = await import('../mapbox-api.js');

const defaultStyles = JSON.parse(fs.readFileSync('config/_defaults.json', 'utf8')).layer.style;

let api;
beforeAll(() => {
    api = Object.create(MapboxAPI.prototype);
    api._defaultStyles = defaultStyles;
});

const hasFeatureState = (value) => JSON.stringify(value).includes('feature-state');

describe('_hasFeatureState', () => {
    it('finds feature-state at any depth and ignores expressions without it', () => {
        expect(api._hasFeatureState(defaultStyles.vector.line['line-width'])).toBe(true);
        expect(api._hasFeatureState(defaultStyles.vector.fill['fill-opacity'])).toBe(true);
        expect(api._hasFeatureState(defaultStyles.vector.text['text-size'])).toBe(false);
        expect(api._hasFeatureState('#10b981')).toBe(false);
        expect(api._hasFeatureState(2)).toBe(false);
        expect(api._hasFeatureState(undefined)).toBe(false);
    });
});

describe('_intelligentStyleMerge keeps hover/selection branches', () => {
    it('composes a pinned line-width instead of flattening the highlight', () => {
        const merged = api._intelligentStyleMerge(
            { 'line-width': 2, 'line-color': '#10b981' },
            api._getDefaultStylesForLayerType('line')
        );

        expect(hasFeatureState(merged['line-width'])).toBe(true);
        // The user's width lands in each zoom stop's fallback branch.
        expect(merged['line-width'][4][merged['line-width'][4].length - 1]).toBe(2);
        expect(merged['line-width'][6][merged['line-width'][6].length - 1]).toBe(2);
    });

    it('composes fill-opacity, which an overpass/creator style pins', () => {
        const merged = api._intelligentStyleMerge(
            { 'fill-opacity': 0.25 },
            api._getDefaultStylesForLayerType('fill')
        );

        expect(hasFeatureState(merged['fill-opacity'])).toBe(true);
        expect(merged['fill-opacity'][4][merged['fill-opacity'][4].length - 1]).toBe(0.25);
    });

    it('still composes colors, including the coalesce form the creator emits', () => {
        const userColor = ['coalesce', ['get', 'stroke-color'], ['get', 'color'], '#10b981'];
        const merged = api._intelligentStyleMerge(
            { 'line-color': userColor },
            api._getDefaultStylesForLayerType('line')
        );

        expect(merged['line-color'][0]).toBe('case');
        expect(hasFeatureState(merged['line-color'])).toBe(true);
        expect(merged['line-color'][merged['line-color'].length - 1]).toEqual(userColor);
    });

    it('keeps an explicit 0 rather than falling back to the default', () => {
        const merged = api._intelligentStyleMerge(
            { 'line-opacity': 0 },
            api._getDefaultStylesForLayerType('line')
        );
        expect(merged['line-opacity'][merged['line-opacity'].length - 1]).toBe(0);
    });

    it('lets the user win outright where the default carries no feature-state', () => {
        const textField = ['to-string', ['get', 'name']];
        const merged = api._intelligentStyleMerge(
            { 'text-field': textField, 'circle-radius': 5 },
            api._getDefaultStylesForLayerType('symbol')
        );
        expect(merged['text-field']).toEqual(textField);
        expect(merged['circle-radius']).toBe(5);
    });

    it('defers to a user value that already ramps with zoom', () => {
        const zoomWidth = ['interpolate', ['linear'], ['zoom'], 10, 1, 18, 6];
        const merged = api._intelligentStyleMerge(
            { 'line-width': zoomWidth },
            api._getDefaultStylesForLayerType('line')
        );
        expect(merged['line-width']).toEqual(zoomWidth);
    });
});

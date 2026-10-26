import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { ROUTE_STYLE } from '../search/route-geojson.js';

describe('the directions layer in config/index.atlas.json', () => {
    it('is styled exactly like the routes drawn from links (ROUTE_STYLE)', () => {
        const atlas = JSON.parse(readFileSync(new URL('../../config/index.atlas.json', import.meta.url), 'utf8'));
        const directions = atlas.layers.find(layer => layer.id === 'directions');
        expect(directions.style).toEqual(JSON.parse(JSON.stringify(ROUTE_STYLE)));
    });
});

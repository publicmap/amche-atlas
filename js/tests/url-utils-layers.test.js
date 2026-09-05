import { describe, it, expect } from 'vitest';
import { URLUtils } from '../map-utils.js';

describe('URLUtils.parseLayersFromUrl', () => {
    it('splits plain layer ids on commas as before', () => {
        expect(URLUtils.parseLayersFromUrl('mapbox-streets,forests')).toEqual([
            { id: 'mapbox-streets' },
            { id: 'forests' }
        ]);
    });

    it('does not split a route-<rid>: shorthand entry on the commas inside its parens', () => {
        const layers = URLUtils.parseLayersFromUrl('mapbox-streets,route-1:mapbox-walking(1,2,3),forests');
        expect(layers).toEqual([
            { id: 'mapbox-streets' },
            { type: 'route', rid: '1', id: 'mapbox-walking(1,2,3)', _originalJson: 'route-1:mapbox-walking(1,2,3)' },
            { id: 'forests' }
        ]);
    });

    it('handles a route entry as the last item in the list', () => {
        const layers = URLUtils.parseLayersFromUrl('forests,route-1:mapbox-walking(1,2)');
        expect(layers[1]).toEqual({ type: 'route', rid: '1', id: 'mapbox-walking(1,2)', _originalJson: 'route-1:mapbox-walking(1,2)' });
    });

    it('still respects brace depth for inline JSON layer objects', () => {
        const layers = URLUtils.parseLayersFromUrl('{"id":"custom","opacity":0.5},forests');
        expect(layers[0]).toEqual({ id: 'custom', opacity: 0.5, _originalJson: "{'id':'custom','opacity':0.5}" });
        expect(layers[1]).toEqual({ id: 'forests' });
    });
});

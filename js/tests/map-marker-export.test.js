// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';

const { MapMarkerManager } = await import('../map-marker-manager.js');

/**
 * A vector tile only carries the part of a feature that falls inside it, so one
 * multipolygon spanning tiles reaches the map as several fragments. These cover
 * the reassembly the export actions run them through - on a bare prototype
 * instance with a stubbed source query, no map needed.
 *
 * turf is a global loaded from a CDN in index.html and is absent here, so these
 * exercise the concatenation path the merge falls back on.
 */
function makeManager(sourceFeatures = []) {
    const manager = Object.create(MapMarkerManager.prototype);
    manager._stateManager = { getLayerConfig: () => ({ type: 'vector', sourceLayer: 'plots' }) };
    manager._map = { querySourceFeatures: () => sourceFeatures };
    return manager;
}

const LAYER_CONFIG = { type: 'vector', sourceLayer: 'plots' };

function polygonFragment(id, x) {
    return {
        id,
        properties: { name: 'Assagao' },
        geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] }
    };
}

describe('tile fragment reassembly', () => {
    it('stitches every fragment of the clicked feature into one geometry', () => {
        const manager = makeManager([polygonFragment(7, 0), polygonFragment(7, 1), polygonFragment(9, 5)]);

        const merged = manager._assembleTiledFeature(polygonFragment(7, 0), 'plots', LAYER_CONFIG);

        expect(merged.geometry.type).toBe('MultiPolygon');
        expect(merged.geometry.coordinates).toHaveLength(2);
        expect(merged.properties).toEqual({ name: 'Assagao' });
    });

    it('leaves a feature whose fragments are all in one tile as it came', () => {
        const only = polygonFragment(7, 0);
        const merged = makeManager([only])._assembleTiledFeature(only, 'plots', LAYER_CONFIG);

        expect(merged.geometry).toEqual(only.geometry);
    });

    it('will not merge features it cannot identify', () => {
        const anonymous = { properties: { name: 'Assagao' }, geometry: polygonFragment(7, 0).geometry };
        const other = { properties: { name: 'Assagao' }, geometry: polygonFragment(7, 1).geometry };

        const merged = makeManager([anonymous, other])._assembleTiledFeature(anonymous, 'plots', LAYER_CONFIG);

        expect(merged.geometry.type).toBe('Polygon');
    });

    it('falls back to properties.id and properties.fid for identity', () => {
        const manager = makeManager();
        expect(manager._tileFragmentKey({ id: 7, properties: { fid: 9 } })).toBe('id:7');
        expect(manager._tileFragmentKey({ properties: { id: 'a' } })).toBe('id:a');
        expect(manager._tileFragmentKey({ properties: { fid: 3 } })).toBe('fid:3');
        expect(manager._tileFragmentKey({ properties: { name: 'Assagao' } })).toBeNull();
    });

    it('drops the duplicate fragments a source query answers with', () => {
        const clicked = polygonFragment(7, 0);
        const manager = makeManager([clicked, polygonFragment(7, 0), polygonFragment(7, 1)]);

        const merged = manager._assembleTiledFeature(clicked, 'plots', LAYER_CONFIG);

        expect(merged.geometry.coordinates).toHaveLength(2);
    });

    it('groups a whole layer by feature, leaving unidentifiable ones alone', () => {
        const anonymous = { properties: {}, geometry: polygonFragment(9, 9).geometry };
        const features = [polygonFragment(7, 0), polygonFragment(7, 1), polygonFragment(8, 3), anonymous];

        const reassembled = makeManager()._reassembleTiledFeatures(features);

        expect(reassembled).toHaveLength(3);
        expect(reassembled.find(f => f.id === 7).geometry.type).toBe('MultiPolygon');
        expect(reassembled.find(f => f.id === 8).geometry.type).toBe('Polygon');
    });

    it('rejoins line fragments as a MultiLineString', () => {
        const manager = makeManager();
        const merged = manager._mergeFragmentGeometries([
            { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            { type: 'MultiLineString', coordinates: [[[1, 1], [2, 2]], [[2, 2], [3, 3]]] }
        ]);

        expect(merged.type).toBe('MultiLineString');
        expect(merged.coordinates).toHaveLength(3);
    });

    it('unwraps the mapbox Feature objects a source query returns', () => {
        const plain = polygonFragment(7, 1);
        const manager = makeManager([{ id: 7, toJSON: () => plain }]);

        const merged = manager._assembleTiledFeature(polygonFragment(7, 0), 'plots', LAYER_CONFIG);

        expect(merged.geometry.coordinates).toHaveLength(2);
    });
});

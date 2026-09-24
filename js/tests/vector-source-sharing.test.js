/**
 * Vector layers reading different source-layers out of one tileset share a
 * single map source - see MapboxAPI._acquireVectorSource. A source each meant
 * the same tile was fetched and decoded once per layer (11x, for the OSM atlas
 * on shortbread tiles).
 */
import { describe, it, expect, beforeEach } from 'vitest';

const { MapboxAPI } = await import('../mapbox-api.js');

const SHORTBREAD = 'https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt';

function osmLayer(id, sourceLayer, idProperty) {
    return {
        id,
        type: 'vector',
        url: SHORTBREAD,
        maxzoom: 14,
        sourceLayer,
        ...(idProperty ? { inspect: { id: idProperty } } : {})
    };
}

/** Enough of a Map to track sources; layers are stubbed out. */
function fakeMap() {
    const sources = new Map();
    return {
        sources,
        getSource: (id) => sources.get(id),
        addSource: (id, config) => sources.set(id, config),
        removeSource: (id) => sources.delete(id),
        getLayer: () => undefined,
        removeLayer: () => {}
    };
}

let api;
let map;

beforeEach(() => {
    map = fakeMap();
    api = Object.create(MapboxAPI.prototype);
    api._map = map;
    api._sharedVectorSources = new Map();
    api._vectorSourceByGroup = new Map();
    api._orderedGroups = [];
});

describe('_acquireVectorSource', () => {
    it('gives layers on the same tiles and zoom range one source', () => {
        const groups = [
            osmLayer('osm-roads', 'streets', 'kind'),
            osmLayer('osm-paths', 'streets', 'kind'),
            osmLayer('osm-places', 'place_labels', 'name'),
            osmLayer('osm-pois', 'pois', 'name')
        ];
        api._orderedGroups = groups;

        const ids = groups.map(g => api._acquireVectorSource(g.id, g));

        expect(new Set(ids).size).toBe(1);
        expect(map.sources.size).toBe(1);
        // Named after the first consumer, so ids stay readable.
        expect(ids[0]).toBe('vector-osm-roads');
        // And reported back by group id, since it's no longer derivable.
        expect(api.getSourceIdForGroup('osm-places')).toBe('vector-osm-roads');
    });

    it('carries the promoteId of every layer sharing the source', () => {
        const groups = [
            osmLayer('osm-roads', 'streets', 'kind'),
            osmLayer('osm-places', 'place_labels', 'name'),
            osmLayer('osm-ocean', 'ocean')
        ];
        api._orderedGroups = groups;

        groups.forEach(g => api._acquireVectorSource(g.id, g));

        expect(map.sources.get('vector-osm-roads').promoteId).toEqual({
            streets: 'kind',
            place_labels: 'name'
        });
    });

    it('keeps zoom ranges apart - they change which tiles are requested', () => {
        const a = osmLayer('osm-roads', 'streets', 'kind');
        const b = { ...osmLayer('osm-landuse', 'land', 'kind'), maxzoom: 17 };
        api._orderedGroups = [a, b];

        expect(api._acquireVectorSource(a.id, a)).toBe('vector-osm-roads');
        expect(api._acquireVectorSource(b.id, b)).toBe('vector-osm-landuse');
        expect(map.sources.size).toBe(2);
    });

    it('does not share when two layers claim one source-layer with different ids', () => {
        const a = osmLayer('osm-roads', 'streets', 'kind');
        const b = osmLayer('osm-other-roads', 'streets', 'osm_id');
        api._orderedGroups = [a, b];

        const aSource = api._acquireVectorSource(a.id, a);
        const bSource = api._acquireVectorSource(b.id, b);

        // Neither gets the ambiguous source-layer from the shared promoteId...
        expect(map.sources.get(aSource).promoteId).toBeUndefined();
        // ...and the second falls back to a private source with its own.
        expect(bSource).toBe('vector-osm-other-roads');
        expect(map.sources.get(bSource).promoteId).toEqual({ streets: 'osm_id' });
    });

    it('rebuilds after a setStyle wipes the sources out from under it', () => {
        const a = osmLayer('osm-roads', 'streets', 'kind');
        api._orderedGroups = [a];

        api._acquireVectorSource(a.id, a);
        map.sources.clear();

        expect(api._acquireVectorSource(a.id, a)).toBe('vector-osm-roads');
        expect(map.sources.size).toBe(1);
    });
});

describe('_releaseVectorSource', () => {
    it('keeps the source until the last layer using it goes', () => {
        const groups = [
            osmLayer('osm-roads', 'streets', 'kind'),
            osmLayer('osm-places', 'place_labels', 'name')
        ];
        api._orderedGroups = groups;
        groups.forEach(g => api._acquireVectorSource(g.id, g));

        api._releaseVectorSource('osm-roads', groups[0]);
        expect(map.sources.size).toBe(1);

        api._releaseVectorSource('osm-places', groups[1]);
        expect(map.sources.size).toBe(0);
    });

    it('lets a released layer re-join the source it left', () => {
        const groups = [
            osmLayer('osm-roads', 'streets', 'kind'),
            osmLayer('osm-places', 'place_labels', 'name')
        ];
        api._orderedGroups = groups;
        groups.forEach(g => api._acquireVectorSource(g.id, g));

        api._releaseVectorSource('osm-roads', groups[0]);
        expect(api.getSourceIdForGroup('osm-roads')).toBeUndefined();

        expect(api._acquireVectorSource('osm-roads', groups[0])).toBe('vector-osm-roads');
        expect(map.sources.size).toBe(1);
    });

    it('removes a source with a single owner', () => {
        const a = osmLayer('osm-roads', 'streets', 'kind');
        api._orderedGroups = [a];
        api._acquireVectorSource(a.id, a);

        api._releaseVectorSource(a.id, a);
        expect(map.sources.size).toBe(0);
    });
});

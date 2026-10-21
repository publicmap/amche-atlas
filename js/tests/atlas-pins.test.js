import { describe, it, expect, vi } from 'vitest';
import { atlasMarkersParam, atlasMarkerEntries, atlasRouteShorthands, atlasPinsJson, atlasPinsUrl } from '../atlas-pins.js';
import { parseMarkersParam } from '../marker-registry.js';

const markers = [
    { id: 'church', coordinates: [73.8301, 15.4986], name: 'Our Lady of the Immaculate Conception', pinned: true },
    { id: 'fontainhas', coordinates: [73.8341, 15.4971], name: 'Fontainhas', description: 'Latin quarter of old Panjim' },
    { id: 'market', coordinates: [73.8278, 15.4989], name: 'Panjim Market', offset: [140, -80] }
];

describe('atlas-pins', () => {
    it('turns config markers into a markers= value that parses back to the same pins', () => {
        const parsed = parseMarkersParam(atlasMarkersParam(markers));
        expect(parsed.map(m => m.id)).toEqual(['church', 'fontainhas', 'market']);
        expect(parsed[0]).toMatchObject({ lng: 73.8301, lat: 15.4986, name: 'Our Lady of the Immaculate Conception', pinned: true });
        expect(parsed[1].description).toBe('Latin quarter of old Panjim');
        expect(parsed[2].offset).toEqual({ x: 140, y: -80 });
    });

    it('drops markers without a usable id or coordinates', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const entries = atlasMarkerEntries([{ id: 'ok', coordinates: [1, 2] }, { id: 'bad id', coordinates: [1, 2] }, { id: 'x', coordinates: ['a', 2] }, null]);
        expect(entries.map(e => e.id)).toEqual(['ok']);
        warn.mockRestore();
    });

    it('returns an empty markers= value for an atlas without pins', () => {
        expect(atlasMarkersParam(undefined)).toBe('');
    });

    it('turns config routes into route-<rid>: layer entries', () => {
        const routes = [
            { id: 'walk', waypoints: ['church', 'fontainhas', 'market'], service: 'mapbox', profile: 'walking', color: '#F59E0B' },
            { id: '2', waypoints: ['church', 'market'] },
            { id: '3', waypoints: ['church', 'market'], service: 'osrm' }
        ];
        expect(atlasRouteShorthands(routes, markers.map(m => m.id))).toEqual([
            'route-walk:mapbox-walking(church,fontainhas,market,#f59e0b)',
            'route-2:(church,market)',
            'route-3:osrm(church,market)'
        ]);
    });

    it('drops a route whose waypoints are not all pins', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(atlasRouteShorthands([{ id: 'r', waypoints: ['church', 'nowhere'] }], ['church'])).toEqual([]);
        expect(atlasRouteShorthands([{ id: 'r', waypoints: ['church'] }], ['church'])).toEqual([]);
        warn.mockRestore();
    });

    it('builds the link that opens an atlas with its pins and routes', () => {
        const routes = [{ id: 'walk', waypoints: ['church', 'market'], service: 'mapbox', profile: 'walking' }];
        const next = new URL(atlasPinsUrl('https://amche.in/?atlas=goa&layers=goa-local-body,streets', markers, routes));
        expect(parseMarkersParam(next.searchParams.get('markers')).map(m => m.id)).toEqual(['church', 'fontainhas', 'market']);
        expect(next.searchParams.get('layers')).toBe('route-walk:mapbox-walking(church,market),goa-local-body,streets');
        expect(next.searchParams.get('atlas')).toBe('goa');
    });

    it('leaves a link that already has pins or routes, or an atlas without pins', () => {
        expect(atlasPinsUrl('https://amche.in/?atlas=goa&markers=a(1,2)', markers, [])).toBeNull();
        expect(atlasPinsUrl('https://amche.in/?atlas=goa&layers=streets,route-1:(a,b)', markers, [])).toBeNull();
        expect(atlasPinsUrl('https://amche.in/?atlas=goa', [], [])).toBeNull();
    });

    it('writes live pins and routes back as config JSON', () => {
        const json = atlasPinsJson(
            [{ id: 'church', lng: 73.83010004, lat: 15.4986, name: 'Church', pinned: true, offset: { x: 0, y: 0 } }],
            [{ rid: 'walk', markerIds: ['church', 'market'], engine: 'mapbox', profile: 'walking', color: '#f59e0b' }]
        );
        expect(json).toEqual({
            markers: [{ id: 'church', coordinates: [73.8301, 15.4986], name: 'Church', pinned: true }],
            routes: [{ id: 'walk', waypoints: ['church', 'market'], service: 'mapbox', profile: 'walking', color: '#f59e0b' }]
        });
    });
});

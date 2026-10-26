import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchRouteForWaypoints, parseRoutingEngineProfile } from '../search/directions-router.js';
import { buildRouteFeatureCollection } from '../search/route-geojson.js';

const WAYPOINTS = [[73.81, 15.49], [73.83, 15.51]];

function apiRoute(duration, coords) {
    return { routes: [{ geometry: { type: 'LineString', coordinates: coords }, distance: 2000, duration, legs: [] }], waypoints: [] };
}

function mockMapbox(responses) {
    global.fetch = vi.fn(async (url) => {
        const profile = url.match(/mapbox\/([^/]+)\//)[1];
        const body = responses[profile];
        if (!body) return { ok: false, status: 500 };
        return { ok: true, json: async () => body };
    });
}

beforeEach(() => { global.mapboxgl = { accessToken: 'test' }; });
afterEach(() => { delete global.fetch; delete global.mapboxgl; });

describe('Mapbox driving', () => {
    it('routes with live traffic and keeps the route ignoring traffic as the alternative', async () => {
        mockMapbox({
            'driving-traffic': apiRoute(900, [[73.81, 15.49], [73.82, 15.5], [73.83, 15.51]]),
            driving: apiRoute(600, [[73.81, 15.49], [73.83, 15.51]])
        });
        const result = await fetchRouteForWaypoints(WAYPOINTS, { engine: 'mapbox', profile: 'driving' });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(result.profile).toBe('driving');
        expect(result.duration).toBe(900);
        expect(result.alternative).toEqual({ geometry: { type: 'LineString', coordinates: [[73.81, 15.49], [73.83, 15.51]] }, distance: 2000, duration: 600 });
    });

    it('still makes a route when only one of the two requests succeeds', async () => {
        mockMapbox({ driving: apiRoute(600, WAYPOINTS) });
        const result = await fetchRouteForWaypoints(WAYPOINTS, { engine: 'mapbox', profile: 'driving' });
        expect(result.duration).toBe(600);
        expect(result.alternative).toBeUndefined();
    });

    it('asks once for walking and cycling', async () => {
        mockMapbox({ walking: apiRoute(1800, WAYPOINTS) });
        const result = await fetchRouteForWaypoints(WAYPOINTS, { engine: 'mapbox', profile: 'walking' });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(result.alternative).toBeUndefined();
    });

    it('reads older driving-traffic links as driving', () => {
        expect(parseRoutingEngineProfile('mapbox-driving-traffic')).toEqual({ engine: 'mapbox', profile: 'driving' });
    });

    it('draws the alternative as a second line after the route', () => {
        const geojson = buildRouteFeatureCollection({
            geometry: { type: 'LineString', coordinates: WAYPOINTS }, distance: 2000, duration: 900, legs: [],
            alternative: { geometry: { type: 'LineString', coordinates: WAYPOINTS }, distance: 1800, duration: 600 }
        }, WAYPOINTS, { profile: 'driving', source: 'mapbox' });
        const byKind = (kind) => geojson.features.find(f => f.properties.kind === kind);
        const [route, alternative] = [byKind('route'), byKind('route-alternative')];
        expect(geojson.features[0]).toBe(route);
        expect(route.properties.alternative).toBeUndefined();
        expect(byKind('route-badge')).toMatchObject({ geometry: { type: 'Point' }, properties: { profile: 'driving' } });
        expect(alternative.properties).toMatchObject({ kind: 'route-alternative', profile: 'driving', duration: 600, travelText: '10 min driving' });
    });
});

describe('route colours', () => {
    it('gives routes through the same stops one colour, whatever their travel mode', async () => {
        const { RouteStore } = await import('../search/route-store.js');
        const store = new RouteStore();
        const route = (rid, profile, waypoints, markerIds = []) => ({ id: `route-${rid}:0`, rid: String(rid), groupId: `route-${rid}`, profile, waypoints, markerIds });
        store._routes = [
            route(4, 'driving', [[73.8031, 15.6127], [73.8005, 15.6174]], ['m1', 'm2']),
            route(5, 'walking', [[73.8032, 15.6128], [73.8004, 15.6175]], ['m1', 'm2']),
            route(6, 'cycling', [[73.8031, 15.6127], [73.8005, 15.6174]]),
            route(7, 'driving', [[73.81, 15.49], [73.83, 15.51]])
        ];
        store._recolor();
        const [a, b, c, d] = store._routes.map(r => r.color);
        expect(b).toBe(a);
        expect(c).toBe(a);
        expect(d).not.toBe(a);
    });
});

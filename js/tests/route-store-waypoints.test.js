// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RouteStore } from '../search/route-store.js';

function markerManager(byUrlId) {
    const live = new Map(Object.values(byUrlId).map(id => [id, {}]));
    return { _markers: live, getMarkerByUrlId: (urlId) => byUrlId[urlId] || null };
}

describe('RouteStore.resolveWaypointMarkers', () => {
    let store;
    let changes;
    const onChange = () => changes++;

    beforeEach(() => {
        changes = 0;
        window.addEventListener('routes-changed', onChange);
        window.layerControl = { _state: { groups: [{ id: 'route-1', _waypointMarkerIds: ['home', 'kaju'] }] } };
        store = new RouteStore();
        store._routes = [{ id: 'route-1:0', groupId: 'route-1', waypoints: [[73.79, 15.6], [73.78, 15.6]], markerIds: [] }];
    });

    afterEach(() => {
        window.removeEventListener('routes-changed', onChange);
        delete window.layerControl;
        delete window.featureControl;
    });

    it('binds a shared-link route to its stops once their markers are restored', () => {
        window.featureControl = { _markerManager: markerManager({}) };
        store.resolveWaypointMarkers();
        expect(store._routes[0].markerIds).toEqual([]);

        window.featureControl = { _markerManager: markerManager({ home: 'marker-a', kaju: 'marker-b' }) };
        store.resolveWaypointMarkers();
        expect(store._routes[0].markerIds).toEqual(['marker-a', 'marker-b']);
        expect(changes).toBe(1);
    });

    it('rebinds stops whose markers were rebuilt, and leaves live ones alone', () => {
        store._routes[0].markerIds = ['marker-old-a', 'marker-old-b'];
        window.featureControl = { _markerManager: markerManager({ home: 'marker-a', kaju: 'marker-b' }) };
        store.resolveWaypointMarkers();
        expect(store._routes[0].markerIds).toEqual(['marker-a', 'marker-b']);

        store.resolveWaypointMarkers();
        expect(changes).toBe(1);
    });

    it('binds a sheet route to its stops by the markerId on its waypoints, and gives them drag handlers', () => {
        window.layerControl._state.groups = [{
            id: 'sheet-routes',
            geojson: { features: [
                { properties: { kind: 'waypoint', routeId: 'sheet-routes:R1', index: 1, markerId: 'kaju' } },
                { properties: { kind: 'waypoint', routeId: 'sheet-routes:R1', index: 0, markerId: 'home' } }
            ] }
        }];
        store._routes = [{ id: 'sheet-routes:R1', groupId: 'sheet-routes', waypoints: [[73.79, 15.6], [73.78, 15.6]], markerIds: [] }];
        const manager = markerManager({ home: 'marker-a', kaju: 'marker-b' });
        manager.adoptAsWaypoint = vi.fn((id, handlers) => { manager._markers.get(id).onDrag = handlers.onDrag; });
        window.featureControl = { _markerManager: manager };
        store.resolveWaypointMarkers();
        expect(store._routes[0].markerIds).toEqual(['marker-a', 'marker-b']);
        expect(manager.adoptAsWaypoint).toHaveBeenCalledTimes(2);
        store.resolveWaypointMarkers();
        expect(manager.adoptAsWaypoint).toHaveBeenCalledTimes(2);
    });
});

describe('RouteStore.moveLocation', () => {
    let store;
    let resolved;

    beforeEach(() => {
        vi.useFakeTimers();
        store = new RouteStore();
        store._routes = [
            { id: 'a', waypoints: [[0, 0], [1, 1]], markerIds: ['m1', 'm2'] },
            { id: 'b', waypoints: [[1, 1], [2, 2], [3, 3]], markerIds: ['m2', 'm3', 'm4'] },
            { id: 'c', waypoints: [[5, 5], [6, 6]], markerIds: ['m5', 'm6'] }
        ];
        resolved = [];
        store._resolve = vi.fn(async (route) => {
            resolved.push(route.id);
            route._routedKey = JSON.stringify(route.waypoints);
        });
    });

    afterEach(() => vi.useRealTimers());

    it('moves the location on every route stopping there, re-routing 100 ms per route after the drag pauses', () => {
        store.moveLocation('m2', { lng: 9, lat: 9 }, { live: true });
        expect(store._routes[0].waypoints[1]).toEqual([9, 9]);
        expect(store._routes[1].waypoints[0]).toEqual([9, 9]);
        vi.advanceTimersByTime(150);
        store.moveLocation('m2', { lng: 8, lat: 8 }, { live: true });
        vi.advanceTimersByTime(199);
        expect(resolved).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(resolved).toEqual(['a', 'b']);
    });

    it('re-routes at once on release, only the routes not yet routed through the final position', () => {
        store.moveLocation('m2', { lng: 9, lat: 9 }, { live: true });
        vi.advanceTimersByTime(200);
        expect(resolved).toEqual(['a', 'b']);
        store.moveLocation('m2', { lng: 9, lat: 9 });
        expect(resolved).toEqual(['a', 'b']);
        store.moveLocation('m2', { lng: 7, lat: 7 });
        expect(resolved).toEqual(['a', 'b', 'a', 'b']);
        vi.advanceTimersByTime(1000);
        expect(resolved).toHaveLength(4);
    });

    it('leaves a location on no route alone', () => {
        store.moveLocation('m9', { lng: 1, lat: 1 });
        expect(resolved).toEqual([]);
    });
});

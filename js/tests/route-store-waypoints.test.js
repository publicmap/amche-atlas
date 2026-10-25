// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
});

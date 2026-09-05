import { describe, it, expect, beforeEach } from 'vitest';
import { RouteApi } from '../route-url-api.js';
import { setAll } from '../marker-registry.js';

describe('RouteApi.parseId', () => {
    beforeEach(() => {
        setAll([
            { id: '1', lng: 73.81, lat: 15.49, name: '', description: '' },
            { id: '2', lng: 73.83, lat: 15.51, name: '', description: '' },
            { id: 'home', lng: 73.8, lat: 15.5, name: '', description: '' }
        ]);
    });

    it('resolves marker ids to their registered coordinates', () => {
        const parsed = RouteApi.parseId('mapbox-walking(1,2)');
        expect(parsed.engine).toBe('mapbox');
        expect(parsed.profile).toBe('walking');
        expect(parsed.markerIds).toEqual(['1', '2']);
        expect(parsed.waypoints).toEqual([[73.81, 15.49], [73.83, 15.51]]);
    });

    it('accepts a user-renamed (non-numeric) marker id', () => {
        const parsed = RouteApi.parseId('mapbox-driving(home,2)');
        expect(parsed.waypoints).toEqual([[73.8, 15.5], [73.83, 15.51]]);
    });

    it('tolerates a bare "engine-profile:ids" and plain "ids" form', () => {
        expect(RouteApi.parseId('mapbox-walking:1,2').waypoints).toHaveLength(2);
        expect(RouteApi.parseId('1,2').waypoints).toHaveLength(2);
    });

    it('drops the route when an id is not registered', () => {
        expect(RouteApi.parseId('mapbox-walking(1,unknown)')).toBeNull();
    });

    it('drops the route when fewer than two ids are given', () => {
        expect(RouteApi.parseId('mapbox-walking(1)')).toBeNull();
    });
});

import { describe, it, expect, vi } from 'vitest';
import {
    routesToRows, rowsToRoutes, toAmcheUrl, toCsv, fromCsv, routesFromGeojson, routesFromCsv,
    WAYPOINT_COLUMNS, ROUTE_COLUMNS, freshId
} from '../route-sheet-format.js';
import { parseMarkersParam, setAll } from '../marker-registry.js';
import { RouteApi } from '../route-url-api.js';
import { URLUtils } from '../map-utils.js';
import { buildRouteFeatureCollection } from '../search/route-geojson.js';

const markers = [
    { id: 'panjim', lng: 73.8278, lat: 15.4989, name: 'Panjim Market', description: '' },
    { id: 'ribandar', lng: 73.8597, lat: 15.5008, name: 'Ribandar ferry, south', description: '100% flat (mostly)' },
    { id: 'old_goa', lng: 73.9116, lat: 15.5009, name: 'Old Goa', description: 'Basilica' },
    { id: 'miramar', lng: 73.8079, lat: 15.4826, name: 'Miramar', description: '' }
];
const routes = [
    { id: 'heritage', name: 'Heritage ride', service: 'mapbox', profile: 'cycling', color: '#e32017', waypoints: ['panjim', 'ribandar', 'old_goa'] },
    { id: 'beach', name: 'Beach loop', service: 'mapbox', profile: 'walking', waypoints: ['panjim', 'miramar'] }
];

/** Reads a link back the way the app does: markers= into the registry, then each route-<rid>: entry. */
function readLink(href) {
    const url = new URL(href);
    const pins = parseMarkersParam(url.searchParams.get('markers'));
    setAll(pins);
    const layers = URLUtils.parseLayersFromUrl(url.searchParams.get('layers') || '');
    return { pins, layers, parsed: layers.map(layer => ({ rid: layer.rid, ...RouteApi.parseId(layer.id) })) };
}

describe('route-sheet-format rows', () => {
    it('round-trips routes and markers through sheet rows', () => {
        const rows = routesToRows(routes, markers);
        expect(Object.keys(rows.waypoints[0])).toEqual(WAYPOINT_COLUMNS.slice(0, 5));
        expect(Object.keys(rows.routes[0])).toEqual(ROUTE_COLUMNS.slice(0, 6));
        expect(rows.routes[0].waypoints).toBe('panjim,ribandar,old_goa');
        const back = rowsToRoutes(rows.waypoints, rows.routes);
        expect(back.errors).toEqual([]);
        expect(back.markers).toEqual(markers);
        expect(back.routes).toEqual(routes);
    });

    it('accepts route-store and atlas shapes', () => {
        const rows = routesToRows(
            [{ rid: '1', markerIds: ['a', 'b'], engine: 'osrm', profile: 'driving' }],
            [{ id: 'a', coordinates: [73.8, 15.5] }, { id: 'b', coordinates: [73.9, 15.6] }]
        );
        expect(rows.routes[0]).toMatchObject({ id: '1', service: 'osrm', waypoints: 'a,b' });
        expect(rows.waypoints[1]).toMatchObject({ id: 'b', lng: 73.9, lat: 15.6 });
    });

    it('reads loosely written sheets: header aliases, spaces between stops, bare colours', () => {
        const { routes: r, markers: m, errors } = rowsToRoutes(
            [{ ID: 'a', Longitude: '73.8', Latitude: '15.5' }, { ID: 'b', lon: '73.9', lat: '15.6', Name: 'B' }],
            [{ Route_ID: 'route-7', Stops: 'a  b', Colour: 'E32017', Mode: 'Walking' }]
        );
        expect(errors).toEqual([]);
        expect(m[1]).toMatchObject({ id: 'b', name: 'B' });
        expect(r[0]).toEqual({ id: '7', name: '', service: 'mapbox', profile: 'walking', color: '#e32017', waypoints: ['a', 'b'] });
    });

    it('reports rows it cannot use, by sheet line', () => {
        const { routes: r, markers: m, errors } = rowsToRoutes(
            [{ id: 'a', lng: '73.8', lat: '15.5' }, { id: 'a', lng: '1', lat: '1' }, { id: 'c', lng: 'x', lat: '15' }, { id: 'd', lng: '200', lat: '1' }],
            [
                { id: 'ok', waypoints: 'a,a' },
                { id: 'no stops', waypoints: 'a,a' },
                { id: 'r2', waypoints: 'a,missing' },
                { id: 'r3', waypoints: 'a' },
                { id: 'r4', waypoints: 'a,a', profile: 'flying' },
                { id: 'r5', waypoints: 'a,a', service: 'teleport' },
                { id: 'r6', waypoints: 'a,a', color: 'red' },
                { id: 'ok', waypoints: 'a,a' }
            ]
        );
        expect(m.map(x => x.id)).toEqual(['a']);
        expect(r.map(x => x.id)).toEqual(['ok', 'r6']);
        expect(r[1].color).toBeUndefined();
        const lines = errors.map(e => `${e.table}:${e.row}`);
        expect(lines).toEqual(['waypoints:3', 'waypoints:4', 'waypoints:5', 'routes:3', 'routes:4', 'routes:5', 'routes:6', 'routes:7', 'routes:8', 'routes:9']);
        expect(errors.find(e => e.id === 'r2').message).toMatch(/missing/);
    });

    it('makes fresh ids for copies', () => {
        expect(freshId('heritage', ['heritage', 'heritage_2'], { route: true })).toBe('heritage_3');
        expect(freshId('café', ['café'])).toBe('café_2');
        expect(freshId('bad-id!', ['x'], { route: true })).toBe('bad_id');
    });
});

describe('toAmcheUrl', () => {
    it('writes a link the app parses back into the same pins and routes', () => {
        const href = toAmcheUrl({ routes, markers }, { base: 'https://amche.in/', atlas: 'goa' });
        expect(href).toMatch(/^https:\/\/amche\.in\/\?atlas=goa&markers=panjim\(73\.8278,15\.4989,Panjim%20Market\),/);
        expect(href).toContain('layers=route-heritage:mapbox-cycling(panjim,ribandar,old_goa,%23e32017),route-beach:mapbox-walking(panjim,miramar)');
        const { pins, parsed } = readLink(href);
        expect(pins.map(({ id, lng, lat, name, description }) => ({ id, lng, lat, name, description }))).toEqual(markers);
        expect(parsed).toEqual([
            expect.objectContaining({ rid: 'heritage', engine: 'mapbox', profile: 'cycling', color: '#e32017', markerIds: ['panjim', 'ribandar', 'old_goa'], waypoints: [[73.8278, 15.4989], [73.8597, 15.5008], [73.9116, 15.5009]] }),
            expect.objectContaining({ rid: 'beach', engine: 'mapbox', profile: 'walking', color: null, markerIds: ['panjim', 'miramar'] })
        ]);
    });

    it('matches the example link in docs/route-sheets.md', () => {
        const waypoints = [
            ['panjim_market', 'Panjim Market', 73.8278, 15.4989, 'Start of every ride'],
            ['ribandar', 'Ribandar Causeway', 73.8597, 15.5008, 'Flat ride along the Mandovi'],
            ['old_goa', 'Basilica of Bom Jesus', 73.9116, 15.5009, '']
        ].map(([id, name, lng, lat, description]) => ({ id, name, lng, lat, description }));
        const net = rowsToRoutes(waypoints, [{ id: 'heritage', profile: 'cycling', service: 'mapbox', color: '#e32017', waypoints: 'panjim_market ribandar old_goa' }]);
        expect(toAmcheUrl(net, { atlas: 'goa' })).toBe('https://amche.in/?atlas=goa&markers=panjim_market(73.8278,15.4989,Panjim%20Market,Start%20of%20every%20ride),ribandar(73.8597,15.5008,Ribandar%20Causeway,Flat%20ride%20along%20the%20Mandovi),old_goa(73.9116,15.5009,Basilica%20of%20Bom%20Jesus)&layers=route-heritage:mapbox-cycling(panjim_market,ribandar,old_goa,%23e32017)');
    });

    it('links one route with only the markers it passes through', () => {
        const href = toAmcheUrl({ routes, markers }, { base: 'https://amche.in/?atlas=goa', routeIds: ['beach'] });
        const { pins, parsed } = readLink(href);
        expect(href.startsWith('https://amche.in/?atlas=goa&markers=')).toBe(true);
        expect(pins.map(p => p.id)).toEqual(['panjim', 'miramar']);
        expect(parsed.map(p => p.rid)).toEqual(['beach']);
    });

    it('keeps ids with non-ASCII characters', () => {
        const href = toAmcheUrl({ routes: [{ id: 'r', waypoints: ['café', 'b'] }], markers: [{ id: 'café', lng: 1, lat: 2, name: 'Café' }, { id: 'b', lng: 3, lat: 4 }] });
        const { pins, parsed } = readLink(href);
        expect(pins[0]).toMatchObject({ id: 'café', name: 'Café' });
        expect(parsed[0].markerIds).toEqual(['café', 'b']);
    });
});

describe('CSV', () => {
    it('round-trips rows with quotes, commas and line breaks', () => {
        const rows = routesToRows(routes, markers);
        rows.waypoints[0].description = 'Says "hi",\nthen leaves';
        const text = toCsv(rows.waypoints, WAYPOINT_COLUMNS);
        expect(text.split('\n')[0]).toBe(WAYPOINT_COLUMNS.join(','));
        const back = fromCsv(text);
        expect(back[0].description).toBe('Says "hi",\nthen leaves');
        expect(back[1].$row).toBe(3);
        const fromSheets = rowsToRoutes(back, fromCsv(toCsv(rows.routes, ROUTE_COLUMNS)));
        expect(fromSheets.routes).toEqual(routes);
        expect(routesFromCsv(text, toCsv(rows.routes)).routes).toEqual(routes);
    });
});

/** A route layer's GeoJSON as route-store.js writes it, from a fake Directions response. */
function exportedLayer(route, coords, { routeId, routeName, color, colorCustom }) {
    const legs = coords.slice(1).map(() => ({ distance: 1000 }));
    const fc = buildRouteFeatureCollection(
        { geometry: { type: 'LineString', coordinates: coords }, distance: 3000, duration: 600, legs },
        coords,
        { profile: route.profile, source: route.service, names: route.names }
    );
    fc.features.forEach(f => Object.assign(f.properties, { id: `${routeId}-${f.properties.id}`, routeId, routeName, color, colorCustom }));
    return fc.features;
}

describe('routesFromGeojson', () => {
    it('reads an exported route layer back into the same link', () => {
        vi.spyOn(Date, 'now').mockReturnValue(0);
        const features = [
            ...exportedLayer({ profile: 'cycling', service: 'mapbox', names: ['Panjim Market', 'Ribandar', 'Old Goa'] },
                [[73.8278, 15.4989], [73.8597, 15.5008], [73.9116, 15.5009]], { routeId: 'route-1', routeName: 'Heritage', color: '#1da1f2', colorCustom: false }),
            ...exportedLayer({ profile: 'driving', service: 'osrm', names: ['Panjim Market', 'Miramar'] },
                [[73.8278, 15.4989], [73.8079, 15.4826]], { routeId: 'route-2', routeName: '', color: '#ff00aa', colorCustom: true })
        ];
        const net = routesFromGeojson({ type: 'FeatureCollection', features });
        expect(net.markers.map(m => m.id)).toEqual(['Panjim_Market', 'Ribandar', 'Old_Goa', 'Miramar']);
        expect(net.routes).toEqual([
            { id: '1', name: 'Heritage', service: 'mapbox', profile: 'cycling', waypoints: ['Panjim_Market', 'Ribandar', 'Old_Goa'] },
            { id: '2', name: '', service: 'osrm', profile: 'driving', color: '#ff00aa', waypoints: ['Panjim_Market', 'Miramar'] }
        ]);

        const { parsed } = readLink(toAmcheUrl(net));
        expect(parsed[0]).toMatchObject({ rid: '1', engine: 'mapbox', profile: 'cycling', waypoints: [[73.8278, 15.4989], [73.8597, 15.5008], [73.9116, 15.5009]] });
        expect(parsed[1]).toMatchObject({ rid: '2', engine: 'osrm', profile: 'driving', color: '#ff00aa' });

        const csvExport = toCsv(features.map(f => ({ ...f.properties, X: f.geometry.coordinates[0]?.toString?.() ?? '', Y: f.geometry.coordinates[1]?.toString?.() ?? '', layer_url: 'https://amche.in/' })));
        const fromExport = routesFromCsv(csvExport);
        expect(fromExport.routes).toEqual(net.routes);
        expect(fromExport.markers).toEqual(net.markers);

        const rows = routesToRows(net.routes, net.markers);
        expect(rowsToRoutes(rows.waypoints, rows.routes).routes).toEqual(net.routes);
        vi.restoreAllMocks();
    });

    it('prefers a markerId the export carries', () => {
        const features = [
            { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { kind: 'waypoint', index: 1, markerId: 'b' } },
            { type: 'Feature', geometry: { type: 'Point', coordinates: [3, 4] }, properties: { kind: 'waypoint', index: 0, markerId: 'a' } }
        ];
        const net = routesFromGeojson(features);
        expect(net.routes[0]).toMatchObject({ id: '1', waypoints: ['a', 'b'], service: 'mapbox', profile: 'driving' });
    });
});

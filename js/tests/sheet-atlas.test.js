import { describe, it, expect } from 'vitest';
import { sheetToAtlas, layerFromRow, markerFromRow, atlasSettings, parseBoolean, isSheetAtlasUrl } from '../sheet-atlas.js';

const URL = 'https://docs.google.com/spreadsheets/d/abc123/edit';

describe('sheet atlas', () => {
    it('reads atlas settings, with center, zoom and a JSON config', () => {
        const atlas = atlasSettings([
            { key: 'name', value: 'Goa cycle network' },
            { key: 'center', value: '73.84, 15.55' },
            { key: 'zoom', value: '12.5' },
            { key: 'color', value: '#e32017' },
            { key: 'config', value: '{"areaOfInterest":"Goa","map":{"pitch":30}}' }
        ]);
        expect(atlas).toMatchObject({ name: 'Goa cycle network', color: '#e32017', areaOfInterest: 'Goa' });
        expect(atlas.map).toEqual({ pitch: 30, center: [73.84, 15.55], zoom: 12.5 });
    });

    it('turns a layers row into a layer config, JSON columns parsed and empty cells left out', () => {
        const layer = layerFromRow({
            id: 'wells', title: 'Wells', type: 'csv', url: 'https://example.com/wells.csv',
            initiallyChecked: 'TRUE', tags: 'water, survey', opacity: '0.8',
            style: '{"circle-color":"#0ea5e9"}', inspect: '', config: '{"attribution":"Survey 2026"}'
        });
        expect(layer).toEqual({
            id: 'wells', title: 'Wells', type: 'csv', url: 'https://example.com/wells.csv', initiallyChecked: true,
            tags: ['water', 'survey'], opacity: 0.8, style: { 'circle-color': '#0ea5e9' }, attribution: 'Survey 2026'
        });
    });

    it('keeps an id-only row as a reference and drops disabled rows', () => {
        expect(layerFromRow({ id: 'mapbox-satellite', initiallyChecked: 'yes' })).toEqual({ id: 'mapbox-satellite', initiallyChecked: true });
        expect(layerFromRow({ id: 'old', enabled: 'FALSE' })).toBeNull();
        expect(layerFromRow({ id: 'r', 'read-only': 'TRUE' })).toEqual({ id: 'r', readOnly: true });
        expect(layerFromRow({ id: 'w', 'read-only': 'FALSE' })).toEqual({ id: 'w', readOnly: false });
        expect(layerFromRow({ id: 'plain', 'read-only': '' })).toEqual({ id: 'plain' });
        expect(layerFromRow({ id: '' })).toBeNull();
    });

    it('reads markers and skips rows without coordinates', () => {
        expect(markerFromRow({ id: 'cafe', name: 'Cafe', lng: '73.83', lat: '15.50', pinned: 'TRUE' }))
            .toEqual({ id: 'cafe', coordinates: [73.83, 15.5], name: 'Cafe', pinned: true });
        expect(markerFromRow({ id: 'nowhere', lng: '', lat: '' })).toBeNull();
    });

    it('adds a routes layer for the waypoints and routes tabs, and centres on the points', () => {
        const atlas = sheetToAtlas({
            atlas: [{ key: 'name', value: 'Test' }, { key: 'saveUrl', value: 'https://script.google.com/macros/s/X/exec' }],
            layers: [{ id: 'mapbox-streets', initiallyChecked: 'TRUE' }],
            markers: [{ id: 'cafe', lng: '73.80', lat: '15.50' }],
            waypoints: [{ id: 'a', lng: '73.82', lat: '15.52' }, { id: 'b', lng: '73.84', lat: '15.54' }],
            routes: [{ id: 'R1', profile: 'cycling', waypoints: 'a,b' }]
        }, { url: URL, gids: { waypoints: '11', routes: '22' } });
        expect(atlas.layers[0]).toEqual({
            id: 'sheet-routes', title: 'Routes', type: 'routes', url: URL,
            saveUrl: 'https://script.google.com/macros/s/X/exec', waypointsGid: '11', routesGid: '22', initiallyChecked: true
        });
        expect(atlas.layers[1]).toEqual({ id: 'mapbox-streets', initiallyChecked: true });
        expect(atlas.markers).toEqual([{ id: 'cafe', coordinates: [73.8, 15.5] }]);
        expect(atlas.bbox).toEqual([73.8, 15.5, 73.84, 15.54]);
        expect(atlas.map.center[0]).toBeCloseTo(73.82);
    });

    it('recognises sheet URLs and spreadsheet booleans', () => {
        expect(isSheetAtlasUrl(URL)).toBe(true);
        expect(isSheetAtlasUrl('https://example.com/a.atlas.json')).toBe(false);
        expect(['TRUE', 'yes', '1', 'x'].every(parseBoolean)).toBe(true);
        expect(['FALSE', 'no', '', '0'].some(parseBoolean)).toBe(false);
    });
});

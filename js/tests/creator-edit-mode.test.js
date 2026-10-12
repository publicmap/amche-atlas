import { describe, it, expect } from 'vitest';
import {
    describeLayerSource, reconcileInspect, mergeEditedLayer, styleTypesOf, stripInternal
} from '../creator-edit-mode.js';

describe('stripInternal', () => {
    it('drops the bookkeeping keys the app adds', () => {
        expect(stripInternal({ id: 'a', _sourceAtlas: 'goa', _originalJson: '{}', title: 'A' })).toEqual({ id: 'a', title: 'A' });
        expect(stripInternal(null)).toEqual({});
    });
});

describe('describeLayerSource', () => {
    it('finds a URL source, pinning an ArcGIS layer to the paged type it already is', () => {
        expect(describeLayerSource({ type: 'geojson', url: 'https://x/a.geojson' }))
            .toEqual({ kind: 'url', value: 'https://x/a.geojson', resolveOptions: {} });
        expect(describeLayerSource({ type: 'arcgis', url: 'https://x/FeatureServer/1' }).resolveOptions).toEqual({ output: 'arcgis' });
        expect(describeLayerSource({ type: 'vector', url: 'mapbox://a.b' }).kind).toBe('url');
    });

    it('finds an Overpass query, locally stored data and inline data', () => {
        expect(describeLayerSource({ type: 'overpass', query: 'nwr[amenity];out;' })).toEqual({ kind: 'overpass', value: 'nwr[amenity];out;' });
        expect(describeLayerSource({ type: 'geojson', dataSource: 'localStorage' }).kind).toBe('local');
        const data = { type: 'FeatureCollection', features: [] };
        expect(describeLayerSource({ type: 'geojson', geojson: data })).toEqual({ kind: 'inline', data });
        expect(describeLayerSource({ type: 'geojson', data }).kind).toBe('inline');
    });

    it('has no source to edit for layers that style the base map or group other layers', () => {
        ['style', 'layer-group', 'wmts', 'img', 'raster-style-layer', 'js'].forEach(type => {
            expect(describeLayerSource({ type, url: 'x' }).kind).toBe('unsupported');
        });
        expect(describeLayerSource({ type: 'geojson' }).kind).toBe('unsupported');
        expect(describeLayerSource(null).kind).toBe('unsupported');
    });
});

describe('reconcileInspect', () => {
    const existing = { id: 'fid', title: 'Place', label: 'name', fields: ['name', 'kind', 'gone'], fieldTitles: ['Name', 'Kind', 'Gone'], onClick: 'x' };

    it('keeps the layer\'s inspect settings, narrowed to the fields the data has', () => {
        const result = reconcileInspect(existing, { id: 'objectid', label: 'zone', fields: ['zone'] }, ['fid', 'name', 'kind']);
        expect(result).toMatchObject({ id: 'fid', label: 'name', title: 'Place', onClick: 'x', fields: ['name', 'kind'], fieldTitles: ['Name', 'Kind'] });
    });

    it('falls back to the generated id, label and fields when the new data lacks them', () => {
        const result = reconcileInspect(existing, { id: 'objectid', label: 'zone', fields: ['zone', 'area'] }, ['objectid', 'zone', 'area']);
        expect(result).toMatchObject({ id: 'objectid', label: 'zone', fields: ['zone', 'area'], title: 'Place', onClick: 'x' });
        expect(result.fieldTitles).toBeUndefined();
    });

    it('uses the generated inspect when the layer has none, and the layer\'s when nothing generated it', () => {
        expect(reconcileInspect(undefined, { id: 'a' }, [])).toEqual({ id: 'a' });
        expect(reconcileInspect(existing, undefined, undefined)).toMatchObject({ id: 'fid', fields: ['name', 'kind', 'gone'] });
    });
});

describe('mergeEditedLayer', () => {
    const layer = {
        id: 'zones', title: 'My zones', description: 'Mine', attribution: 'old.org', type: 'arcgis',
        url: 'https://old/FeatureServer/1', pageSize: 2000, opacity: 0.7, minzoom: 8, filter: ['has', 'x'],
        inspect: { id: 'fid', label: 'name', fields: ['name'] }, style: { 'fill-color': '#ff0000' }, _sourceAtlas: 'goa'
    };
    const generated = {
        id: 'fresh-12', title: 'Fresh', attribution: 'new.org', type: 'geojson', url: 'https://new/query?f=geojson',
        inspect: { id: 'objectid', label: 'zone', fields: ['zone'] }, style: { 'fill-color': '#3b82f6' }
    };

    it('leaves the layer as it was when the source is unchanged', () => {
        const merged = mergeEditedLayer(generated, layer, { sourceChanged: false });
        expect(merged).toMatchObject({ id: 'zones', title: 'My zones', type: 'arcgis', url: 'https://old/FeatureServer/1', pageSize: 2000, opacity: 0.7 });
        expect(merged.style).toEqual({ 'fill-color': '#ff0000' });
        expect(merged._sourceAtlas).toBeUndefined();
    });

    it('takes the data from the new source and keeps the rest, when the source is replaced', () => {
        const merged = mergeEditedLayer(generated, layer, { sourceChanged: true, keepStyle: true, fields: ['objectid', 'zone', 'name'] });
        expect(merged).toMatchObject({
            id: 'zones', title: 'My zones', description: 'Mine', opacity: 0.7, minzoom: 8, filter: ['has', 'x'],
            type: 'geojson', url: 'https://new/query?f=geojson', attribution: 'new.org'
        });
        expect(merged.pageSize).toBeUndefined();
        expect(merged.style).toEqual({ 'fill-color': '#ff0000' });
        expect(merged.inspect).toMatchObject({ id: 'objectid', label: 'name', fields: ['name'] });
    });

    it('restyles from the generated style when asked, and drops the style if the source gave none', () => {
        const restyled = mergeEditedLayer(generated, layer, { sourceChanged: true, keepStyle: false, fields: [] });
        expect(restyled.style).toEqual({ 'fill-color': '#3b82f6' });
        const bare = mergeEditedLayer({ type: 'tms', url: 'u' }, layer, { sourceChanged: true, keepStyle: false });
        expect(bare.style).toBeUndefined();
    });
});

describe('styleTypesOf', () => {
    it('says which of the creator\'s style sections a style uses, looking through variant prefixes', () => {
        expect(styleTypesOf({ 'fill-color': '#fff', 'hatch/fill-pattern': 'p', 'line-width': 1, 'text-field': ['get', 'n'] }))
            .toEqual({ point: false, line: true, area: true, label: true, circle: false, icon: false });
        expect(styleTypesOf({ 'circle-radius': 4, 'circle-blur': 0.2, 'icon-image': 'marker-15' }))
            .toEqual({ point: true, line: false, area: false, label: false, circle: true, icon: true });
        expect(styleTypesOf(undefined).area).toBe(false);
    });
});

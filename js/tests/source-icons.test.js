import { describe, it, expect } from 'vitest';
import { describeSource, SOURCE_CATEGORIES, LAYER_TYPE_LABELS } from '../source-icons.js';

describe('describeSource', () => {
    it('uses the icons for each kind of data', () => {
        const icon = (source) => describeSource(source).icon;
        expect(icon({ layerType: 'vector', url: 'https://x/{z}/{x}/{y}.pbf' })).toBe('bounding-box-circles');
        expect(icon({ layerType: 'tms', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' })).toBe('image');
        expect(icon({ layerType: 'cog', url: 'https://x/a.tif' })).toBe('image');
        expect(icon({ layerType: 'csv', url: 'https://x/a.csv' })).toBe('filetype-csv');
        expect(icon({ layerType: 'sheet', url: 'https://docs.google.com/spreadsheets/d/abc/edit' })).toBe('filetype-csv');
        expect(icon({ layerType: 'geojson', url: 'https://x/a.geojson' })).toBe('filetype-json');
        expect(icon({ layerType: 'geojson', url: 'https://x/a.kml' })).toBe('filetype-xml');
        expect(icon({ url: 'https://x/a.gpkg' })).toBe('file-earmark-zip');
    });

    it('uses the globe for web services and APIs', () => {
        expect(describeSource({ layerType: 'wms', url: 'https://x/wms?service=WMS&request=GetMap&layers=a' }).icon).toBe('globe');
        expect(describeSource({ layerType: 'overpass' }).icon).toBe('globe');
        expect(describeSource({ url: 'https://overpass-turbo.eu/s/abc' }).icon).toBe('globe');
        expect(describeSource({ url: 'https://annotations.allmaps.org/images/bca064e512c963f0' }).icon).toBe('globe');
        expect(describeSource({ url: 'https://mapwarper.net/maps/95676' }).icon).toBe('globe');
    });

    it('goes by the link when it names a service, even for a layer typed as plain GeoJSON', () => {
        const arcgisQuery = 'https://gis.dda.org.in/server/rest/services/Hosted/X/FeatureServer/8/query?where=1%3D1&outFields=*&f=geojson';
        const described = describeSource({ layerType: 'geojson', url: arcgisQuery });
        expect(described.icon).toBe('globe');
        expect(described.subtitle).toBe('GeoJSON · ArcGIS');
    });

    it('subtitles with the layer type, or what was detected from the link, or the kind', () => {
        expect(describeSource({ layerType: 'vector', url: 'https://x/{z}/{x}/{y}.pbf' }).subtitle).toBe('Vector tiles');
        expect(describeSource({ layerType: 'arcgis', url: 'https://h/server/rest/services/S/FeatureServer/1' }).subtitle).toBe('ArcGIS layer');
        expect(describeSource({ url: 'https://x/a.csv' }).subtitle).toBe('CSV');
        expect(describeSource({}).subtitle).toBe('Data source');
        expect(describeSource({ layerType: 'unheard-of' }).subtitle).toBe('unheard-of');
    });

    it('carries a tooltip describing the kind, and falls back to a neutral link icon', () => {
        expect(describeSource({ layerType: 'tms' }).tooltip).toBe(SOURCE_CATEGORIES.raster.tooltip);
        expect(describeSource({ layerType: 'overpass' }).tooltip).toContain('third-party');
        const nothing = describeSource({});
        expect(nothing).toMatchObject({ category: 'unknown', icon: 'link-45deg' });
    });

    it('names every layer type the editor can show', () => {
        ['geojson', 'csv', 'sheet', 'vector', 'tms', 'wms', 'cog', 'arcgis', 'overpass'].forEach(type => {
            expect(LAYER_TYPE_LABELS[type]).toBeTruthy();
        });
    });
});

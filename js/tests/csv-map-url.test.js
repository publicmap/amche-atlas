import { describe, it, expect } from 'vitest';
import { DataUtils, GeoUtils } from '../map-utils.js';
import { parseMapURL } from '../search/coordinate-parser.js';

describe('parseMapURL', () => {
    it.each([
        ['https://www.openstreetmap.in/#17/15.612573/73.802941', 15.612573, 73.802941],
        ['https://www.google.com/maps/@15.6127617,73.805971,740m/data=!3m1!1e3?entry=ttu&g_ep=EgoyMDI2MTAyMC4wIKXMDSoASAFQAw%3D%3D', 15.6127617, 73.805971],
        ['https://www.openstreetmap.org/#map=18/15.612841/73.802628', 15.612841, 73.802628],
        ['https://www.google.com/maps/place/X/@15.6,73.8,17z/data=!4m6!3m5!8m2!3d15.6131!4d73.8042', 15.6131, 73.8042],
        ['https://www.openstreetmap.org/?mlat=15.61&mlon=73.80#map=17/15.5/73.7', 15.61, 73.80]
    ])('%s', (url, lat, lng) => {
        const parsed = parseMapURL(url);
        expect(parsed.lat).toBeCloseTo(lat, 6);
        expect(parsed.lng).toBeCloseTo(lng, 6);
    });

    it('returns null for non-map text', () => {
        expect(parseMapURL('https://example.com/page')).toBeNull();
    });
});

describe('rowsToGeoJSON map column', () => {
    it('locates rows from a map URL column when there are no lat/lng columns', () => {
        const geojson = GeoUtils.rowsToGeoJSON([
            { name: 'A', Map: 'https://www.openstreetmap.org/#map=18/15.612841/73.802628' },
            { name: 'B', Map: 'not a link' }
        ]);
        expect(geojson.features).toHaveLength(1);
        expect(geojson.features[0].geometry.coordinates).toEqual([73.802628, 15.612841]);
    });

    it('does not take words containing x / y / lat as coordinate columns', () => {
        const fields = ['Extent and limits of the ward\nPart Number of Assembly Constituency', 'Population', 'Map'];
        expect(GeoUtils.detectCoordinateField(fields, GeoUtils.LAT_PATTERNS)).toBe('');
        expect(GeoUtils.detectCoordinateField(fields, GeoUtils.LON_PATTERNS)).toBe('');
        expect(GeoUtils.detectCoordinateField(['Latitude (WGS84)', 'gps_lng'], GeoUtils.LAT_PATTERNS)).toBe('Latitude (WGS84)');

        const geojson = GeoUtils.rowsToGeoJSON([
            { 'Extent': 'Part 1 24- Mormugao A.C.', 'Constituency': 'Part 2', Map: 'https://www.google.com/maps/@15.6164708,73.8136922,20.17z?entry=ttu' }
        ]);
        expect(geojson.features.map(f => f.geometry.coordinates)).toEqual([[73.8136922, 15.6164708]]);
    });

    it('keeps the map column through re-typed header rows repeated per section', () => {
        const csv = [
            'Council,Ward No.,Remark,Map',
            'Mormugao,I,,',
            'Margao Municipal Council.,,,',
            ',,,',
            'Coun cil,Ward No.,R emark,',
            'Mapusa,I,,https://www.openstreetmap.org/#map=18/15.612841/73.802628'
        ].join('\n');
        const rows = DataUtils.parseCSV(csv);
        expect(rows.at(-1)).toMatchObject({ Council: 'Mapusa', Map: 'https://www.openstreetmap.org/#map=18/15.612841/73.802628' });
        expect(GeoUtils.rowsToGeoJSON(rows).features).toHaveLength(1);
    });

    it('prefers lat/lng columns and falls back to the map URL per row', () => {
        const geojson = GeoUtils.rowsToGeoJSON([
            { lat: '15.1', lng: '73.1', map: 'https://www.openstreetmap.in/#17/15.612573/73.802941' },
            { lat: '', lng: '', map: 'https://www.openstreetmap.in/#17/15.612573/73.802941' }
        ]);
        expect(geojson.features.map(f => f.geometry.coordinates)).toEqual([
            [73.1, 15.1],
            [73.802941, 15.612573]
        ]);
    });
});

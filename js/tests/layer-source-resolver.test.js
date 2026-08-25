import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    SOURCE_TYPES,
    detectLayerSourceType,
    parseIndianOpenMapsViewerUrl,
    isIndianOpenMapsViewerUrl,
    isIndianOpenMapsFlyDevViewUrl,
    isMapboxTilesetId,
    generateLayerId,
    createWMSConfig,
    guessLayerType,
    resolveTileSource,
    resolveCsvSource,
    resolveLayerSource,
    DYNAMIC_SHORTHAND_PROVIDERS
} from '../layer-source-resolver.js';

function mockFetchJson(map) {
    return vi.fn((url) => {
        const body = map[url];
        if (!body) {
            return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}), text: () => Promise.resolve('not found') });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
    });
}

describe('detectLayerSourceType', () => {
    beforeEach(() => {
        global.window = {};
    });

    it('detects a bare Mapbox tileset ID without requiring a protocol prefix (the old isValidDataUrl gated this behind a http(s)://mapbox:// check, making it unreachable)', () => {
        expect(detectLayerSourceType('planemad.np3cjv7ukkcy')).toBe(SOURCE_TYPES.MAPBOX_TILESET);
    });

    it('detects an overpass-turbo.eu share URL', () => {
        expect(detectLayerSourceType('https://overpass-turbo.eu/s/abc123')).toBe(SOURCE_TYPES.OVERPASS_SHARE);
    });

    it('detects a bharatlas community URL', () => {
        expect(detectLayerSourceType('https://bharatlas.com/c/abc123')).toBe(SOURCE_TYPES.BHARATLAS);
    });

    it('detects a Gist URL', () => {
        expect(detectLayerSourceType('https://gist.github.com/user/0123456789abcdef')).toBe(SOURCE_TYPES.GIST);
    });

    it('detects a WMS GetMap URL', () => {
        expect(detectLayerSourceType('https://example.com/wms?service=WMS&request=GetMap&layers=foo')).toBe(SOURCE_TYPES.WMS);
    });

    it('detects a Google Sheets URL as CSV', () => {
        expect(detectLayerSourceType('https://docs.google.com/spreadsheets/d/abc123/edit')).toBe(SOURCE_TYPES.CSV);
    });

    it('detects an Allmaps URL', () => {
        expect(detectLayerSourceType('https://annotations.allmaps.org/images/0123456789abcdef')).toBe(SOURCE_TYPES.ALLMAPS);
    });

    it('detects an OSM element URL', () => {
        expect(detectLayerSourceType('https://www.openstreetmap.org/relation/21057460')).toBe(SOURCE_TYPES.OSM);
    });

    it('detects a MapWarper map URL', () => {
        expect(detectLayerSourceType('https://mapwarper.net/maps/108838')).toBe(SOURCE_TYPES.MAPWARPER);
    });

    it('detects a MapWarper mosaic URL (previously unreachable via map-creator.js\'s narrower "/maps/" substring check)', () => {
        expect(detectLayerSourceType('https://mapwarper.net/layers/123')).toBe(SOURCE_TYPES.MAPWARPER);
    });

    it('detects a plain .geojson file', () => {
        expect(detectLayerSourceType('https://example.com/data.geojson')).toBe(SOURCE_TYPES.GEOJSON_FILE);
    });

    it('detects a plain .json file as an unresolved atlas/config candidate', () => {
        expect(detectLayerSourceType('https://example.com/data.json')).toBe(SOURCE_TYPES.JSON_FILE);
    });

    it('detects a .kml file', () => {
        expect(detectLayerSourceType('https://example.com/data.kml')).toBe(SOURCE_TYPES.KML);
    });

    it('detects a .geojsonl / .ndjson / .jsonl file', () => {
        expect(detectLayerSourceType('https://example.com/data.geojsonl')).toBe(SOURCE_TYPES.GEOJSONL);
        expect(detectLayerSourceType('https://example.com/data.ndjson')).toBe(SOURCE_TYPES.GEOJSONL);
    });

    it('detects a .gpkg file', () => {
        expect(detectLayerSourceType('https://example.com/data.gpkg')).toBe(SOURCE_TYPES.GPKG);
    });

    it('detects a .zip (Shapefile) file', () => {
        expect(detectLayerSourceType('https://example.com/data.zip')).toBe(SOURCE_TYPES.SHAPEFILE);
    });

    it('detects an indianopenmaps.com viewer URL (previously unreachable — guessLayerType() never checked for it)', () => {
        expect(detectLayerSourceType('https://indianopenmaps.com/viewer#source=/not-so-open/foo/')).toBe(SOURCE_TYPES.INDIANOPENMAPS);
    });

    it('detects an indianopenmaps.fly.dev /view URL', () => {
        expect(detectLayerSourceType('https://indianopenmaps.fly.dev/not-so-open/foo/view')).toBe(SOURCE_TYPES.INDIANOPENMAPS);
    });

    it('detects a vector tile template URL', () => {
        expect(detectLayerSourceType('https://example.com/{z}/{x}/{y}.pbf')).toBe(SOURCE_TYPES.VECTOR_TILE);
    });

    it('detects a raster tile template URL', () => {
        expect(detectLayerSourceType('https://example.com/{z}/{x}/{y}.png')).toBe(SOURCE_TYPES.RASTER_TILE);
    });

    it('returns null for an unrecognized URL', () => {
        expect(detectLayerSourceType('https://example.com/whatever')).toBeNull();
    });

    it('returns null for garbage input', () => {
        expect(detectLayerSourceType('')).toBeNull();
        expect(detectLayerSourceType(null)).toBeNull();
    });
});

describe('parseIndianOpenMapsViewerUrl', () => {
    it('extracts the first source from a single-source viewer URL', () => {
        const url = 'https://indianopenmaps.com/viewer#source=/not-so-open/cadastrals/tamil-nadu/coastal/ncscm/&map=14.61/13.04314/80.24872&terrain=false&base=Carto+OSM+Dark';
        expect(parseIndianOpenMapsViewerUrl(url)).toBe('https://indianopenmaps.com/not-so-open/cadastrals/tamil-nadu/coastal/ncscm');
    });

    it('extracts only the first source from a multi-source (%2C-separated) viewer URL', () => {
        const url = 'https://indianopenmaps.com/viewer#source=/not-so-open/cadastrals/tamil-nadu/coastal/ncscm/%2C/not-so-open/urban/slums/tamil-nadu/tngis/&map=14.61/13.04314/80.24872';
        expect(parseIndianOpenMapsViewerUrl(url)).toBe('https://indianopenmaps.com/not-so-open/cadastrals/tamil-nadu/coastal/ncscm');
    });

    it('returns null when there is no source param', () => {
        expect(parseIndianOpenMapsViewerUrl('https://indianopenmaps.com/viewer#map=14.61/13.04314/80.24872')).toBeNull();
    });
});

describe('isIndianOpenMapsViewerUrl / isIndianOpenMapsFlyDevViewUrl / isMapboxTilesetId', () => {
    it('recognizes both indianopenmaps hosts', () => {
        expect(isIndianOpenMapsViewerUrl('https://indianopenmaps.com/viewer#source=/x/')).toBe(true);
        expect(isIndianOpenMapsFlyDevViewUrl('https://indianopenmaps.fly.dev/x/view')).toBe(true);
    });

    it('rejects tileset-id-shaped strings that are actually URLs or templates', () => {
        expect(isMapboxTilesetId('https://example.com/a.b')).toBe(false);
        expect(isMapboxTilesetId('mapbox://a.b')).toBe(false);
        expect(isMapboxTilesetId('a.b/{z}')).toBe(false);
    });
});

describe('generateLayerId', () => {
    it('slugifies a title with a random suffix', () => {
        const id = generateLayerId('My Cool Layer');
        expect(id).toMatch(/^my-cool-layer-\d{2}$/);
    });

    it('returns empty string for falsy input', () => {
        expect(generateLayerId('')).toBe('');
    });
});

describe('createWMSConfig', () => {
    it('builds a wms config from query params', () => {
        const config = createWMSConfig('https://services.terrascope.be/wms/v2?service=WMS&request=GetMap&layers=WORLDCOVER_2021_MAP&version=1.3.0');
        expect(config.type).toBe('wms');
        expect(config.title).toBe('WORLDCOVER_2021_MAP');
        expect(config.url).toContain('WORLDCOVER_2021_MAP');
        expect(config.srs).toBe('EPSG:3857');
    });
});

describe('guessLayerType', () => {
    it('still classifies plain vector/raster/geojson URLs the same as before', () => {
        expect(guessLayerType('https://example.com/{z}/{x}/{y}.pbf')).toBe('vector');
        expect(guessLayerType('https://example.com/{z}/{x}/{y}.png')).toBe('raster');
        expect(guessLayerType('https://example.com/data.geojson')).toBe('geojson');
        expect(guessLayerType('mapbox://user.tileset')).toBe('mapbox-tileset');
    });
});

describe('resolveTileSource (mocked fetch)', () => {
    beforeEach(() => {
        global.window = {};
    });

    it('resolves an indianopenmaps.com viewer URL to a vector layer config using the first source', async () => {
        const tilejson = { name: 'NCSCM', minzoom: 0, maxzoom: 14, vector_layers: [{ id: 'ncscm', fields: { gid: 'int' } }] };
        global.fetch = mockFetchJson({
            'https://indianopenmaps.com/not-so-open/cadastrals/tamil-nadu/coastal/ncscm/tiles.json': tilejson
        });

        const url = 'https://indianopenmaps.com/viewer#source=/not-so-open/cadastrals/tamil-nadu/coastal/ncscm/&map=14.61/13.04314/80.24872';
        const { layerType, config } = await resolveTileSource(url);

        expect(layerType).toBe('vector');
        expect(config.type).toBe('vector');
        expect(config.title).toBe('NCSCM');
        expect(config.sourceLayer).toBe('ncscm');
    });

    it('does not throw when the tiles.json fetch fails, falling back to a generic vector config', async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));
        const url = 'https://indianopenmaps.com/viewer#source=/not-so-open/missing/';
        const { layerType, config } = await resolveTileSource(url);
        expect(layerType).toBe('vector');
        expect(config.type).toBe('vector');
    });
});

describe('resolveCsvSource (mocked fetch)', () => {
    it('fetches a plain (non-Google-Sheet) CSV URL directly', async () => {
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve('name,lat,lng\nFoo,10,20\n') }));

        const result = await resolveCsvSource('https://example.com/data.csv', {});
        expect(result.status).toBe('ok');
        expect(result.layerType).toBe('csv');
        expect(result.combined).toBe(false);
        expect(result.rows.length).toBe(1);
        expect(result.rows[0].name).toBe('Foo');
    });
});

describe('resolveLayerSource — needs-input cases', () => {
    it('returns a needs-input atlas-layers result for a multi-layer JSON config', async () => {
        const atlasJson = { name: 'My Atlas', layers: [{ id: 'a', title: 'A', type: 'geojson' }] };
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(atlasJson) }));

        const result = await resolveLayerSource('https://example.com/atlas.json');
        expect(result.status).toBe('needs-input');
        expect(result.kind).toBe('atlas-layers');
        expect(result.atlasData.name).toBe('My Atlas');
    });

    it('returns an ok geojson result for a plain FeatureCollection JSON URL', async () => {
        const fc = { type: 'FeatureCollection', features: [] };
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fc) }));

        const result = await resolveLayerSource('https://example.com/data.json');
        expect(result.status).toBe('ok');
        expect(result.layerType).toBe('geojson');
        expect(result.geojson).toEqual(fc);
    });

    it('returns unknown for an unrecognized URL', async () => {
        const result = await resolveLayerSource('https://example.com/whatever-unrecognized');
        expect(result.status).toBe('unknown');
    });
});

describe('DYNAMIC_SHORTHAND_PROVIDERS', () => {
    it('exposes exactly the allmaps/mapwarper/osm providers dynamic-layer-shorthand.js dispatches to', () => {
        expect(Object.keys(DYNAMIC_SHORTHAND_PROVIDERS).sort()).toEqual(['allmaps', 'mapwarper', 'osm']);
        expect(typeof DYNAMIC_SHORTHAND_PROVIDERS.allmaps.resolveFromId).toBe('function');
        expect(typeof DYNAMIC_SHORTHAND_PROVIDERS.mapwarper.resolveFromId).toBe('function');
        expect(typeof DYNAMIC_SHORTHAND_PROVIDERS.osm.resolveFromId).toBe('function');
    });
});

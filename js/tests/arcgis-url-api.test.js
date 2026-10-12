import { describe, it, expect, vi, afterEach } from 'vitest';
import { ArcgisAPI } from '../arcgis-url-api.js';
import { detectLayerSourceType, resolveLayerSource, SOURCE_TYPES } from '../layer-source-resolver.js';

const ROOT = 'https://gis.example.org/server/rest/services';
const LAYER = `${ROOT}/Hosted/PLAN/FeatureServer/1`;

function mockFetch(routes) {
    global.fetch = vi.fn(async (input) => {
        const url = String(input);
        const key = Object.keys(routes).find(k => url.startsWith(k) && (!routes[k].match || routes[k].match(url)));
        if (!key) return { ok: false, status: 404, json: async () => ({}) };
        const body = routes[key].body;
        return { ok: true, json: async () => (typeof body === 'function' ? body(url) : body) };
    });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('ArcgisAPI.parseUrl', () => {
    it('classifies directory, folder, service and layer URLs', () => {
        expect(ArcgisAPI.parseUrl(`${ROOT}/`).kind).toBe('root');
        expect(ArcgisAPI.parseUrl(`${ROOT}/Hosted`).kind).toBe('folder');
        expect(ArcgisAPI.parseUrl(`${ROOT}/Hosted/PLAN/FeatureServer`).kind).toBe('service');
        const layer = ArcgisAPI.parseUrl(LAYER);
        expect(layer).toMatchObject({ kind: 'layer', layerId: 1, serviceType: 'FeatureServer', url: LAYER });
    });

    it('strips the /query operation and keeps only a non-default where', () => {
        const pasted = `${LAYER}/query?f=pbf&where=1%3D1&outFields=objectid%2Czone&geometry=%7B%7D`;
        expect(ArcgisAPI.parseUrl(pasted)).toMatchObject({ kind: 'layer', url: LAYER, where: null });
        expect(ArcgisAPI.parseUrl(`${LAYER}/query?where=zone%3D%27A%27`).where).toBe("zone='A'");
    });

    it('lists the nodes to expand from the directory down to the target', () => {
        expect(ArcgisAPI.ancestorUrls(ArcgisAPI.parseUrl(LAYER))).toEqual([
            ROOT, `${ROOT}/Hosted`, `${ROOT}/Hosted/PLAN/FeatureServer`
        ]);
    });
});

describe('ArcgisAPI.listChildren', () => {
    it('lists folders and browsable services, dropping unsupported service types', async () => {
        mockFetch({ [ROOT]: { body: {
            folders: ['Hosted'],
            services: [{ name: 'Hosted/Parks', type: 'FeatureServer' }, { name: 'Geo', type: 'GeocodeServer' }]
        } } });
        const nodes = await ArcgisAPI.listChildren({ kind: 'root', url: ROOT });
        expect(nodes.map(n => [n.kind, n.name])).toEqual([['folder', 'Hosted'], ['service', 'Parks']]);
        expect(nodes[1].url).toBe(`${ROOT}/Hosted/Parks/FeatureServer`);
    });

    it('nests MapServer sublayers under their group and marks tables unselectable', async () => {
        mockFetch({ [`${ROOT}/M/MapServer`]: { body: {
            layers: [
                { id: 0, name: 'Group', parentLayerId: -1, subLayerIds: [1] },
                { id: 1, name: 'Roads', parentLayerId: 0, geometryType: 'esriGeometryPolyline' }
            ],
            tables: [{ id: 2, name: 'Stats' }]
        } } });
        const nodes = await ArcgisAPI.listChildren({ kind: 'service', url: `${ROOT}/M/MapServer`, root: ROOT });
        expect(nodes.map(n => n.name)).toEqual(['Group', 'Stats']);
        expect(nodes[0].children[0]).toMatchObject({ name: 'Roads', selectable: true, url: `${ROOT}/M/MapServer/1` });
        expect(nodes[1].selectable).toBe(false);
    });
});

describe('ArcgisAPI.describeLayer', () => {
    const info = (over = {}) => ({
        name: 'ZONE_BOUNDARY', type: 'Feature Layer', geometryType: 'esriGeometryPolygon', maxRecordCount: 2000,
        supportedQueryFormats: 'JSON, geoJSON, PBF', objectIdField: 'objectid', displayField: 'zone',
        supportsAdvancedQueries: true, copyrightText: '',
        fields: [{ name: 'objectid' }, { name: 'zone' }, { name: 'SHAPE__Area' }], ...over
    });

    function mockLayer(count, infoOver) {
        mockFetch({ [LAYER]: { body: (url) => {
            if (url.includes('returnCountOnly')) return { count };
            if (url.includes('returnExtentOnly')) return { extent: { xmin: 76, ymin: 28, xmax: 77, ymax: 29 } };
            return info(infoOver);
        } } });
    }

    it('picks a plain GeoJSON URL layer when the whole layer fits in one response', async () => {
        mockLayer(18);
        const d = await ArcgisAPI.describeLayer(`${LAYER}/query?f=pbf`);
        expect(d.output).toBe('geojson');
        expect(d.config).toMatchObject({ type: 'geojson', bbox: [76, 28, 77, 29] });
        expect(d.config.url).toContain('/query?where=1%3D1&outFields=*&outSR=4326');
        expect(d.config.inspect).toMatchObject({ id: 'objectid', label: 'zone', fields: ['zone'] });
        expect(d.geometryTypes).toEqual(['Polygon', 'MultiPolygon']);
    });

    it('switches to the paged arcgis type when the layer exceeds the record limit', async () => {
        mockLayer(5000);
        const d = await ArcgisAPI.describeLayer(LAYER);
        expect(d.config).toMatchObject({ type: 'arcgis', url: LAYER, pageSize: 2000, orderBy: 'objectid' });
    });

    it('honours an explicit output override', async () => {
        mockLayer(18, { name: 'X' });
        expect((await ArcgisAPI.describeLayer(LAYER, { output: 'arcgis' })).config.type).toBe('arcgis');
        expect((await ArcgisAPI.describeLayer(LAYER, { output: 'snapshot' })).output).toBe('snapshot');
    });

    it('offers raster export only for MapServer layers', async () => {
        const mapLayer = `${ROOT}/M/MapServer/3`;
        mockFetch({ [mapLayer]: { body: () => info() }, [LAYER]: { body: () => info() } });
        const d = await ArcgisAPI.describeLayer(mapLayer, { output: 'raster' });
        expect(d.config).toMatchObject({ type: 'tms', tileSize: 256 });
        expect(d.config.url).toContain('{bbox-epsg-3857}');
        expect(d.config.url).toContain('layers=show%3A3');
        expect((await ArcgisAPI.describeLayer(LAYER)).outputs.map(o => o.id)).not.toContain('raster');
    });

    it('rejects tables that have no geometry', async () => {
        mockLayer(3, { type: 'Table', geometryType: undefined });
        await expect(ArcgisAPI.describeLayer(LAYER)).rejects.toThrow(/table/i);
    });
});

describe('ArcgisAPI.fetchAllFeatures', () => {
    it('pages through every record and keeps order', async () => {
        const offsets = [];
        mockFetch({ [LAYER]: { body: (url) => {
            if (url.includes('returnCountOnly')) return { count: 5 };
            const offset = Number(new URL(url).searchParams.get('resultOffset'));
            offsets.push(offset);
            return { features: [offset, offset + 1].filter(n => n < 5).map(n => ({ type: 'Feature', properties: { n } })) };
        } } });
        const fc = await ArcgisAPI.fetchAllFeatures({ url: `${LAYER}/query`, pageSize: 2 });
        expect(fc.features.map(f => f.properties.n)).toEqual([0, 1, 2, 3, 4]);
        expect(offsets.sort()).toEqual([0, 2, 4]);
    });

    it('stops at a short page when the count is unavailable and caps at maxFeatures', async () => {
        mockFetch({ [LAYER]: { body: (url) => {
            if (url.includes('returnCountOnly')) return { error: { message: 'unsupported' } };
            const offset = Number(new URL(url).searchParams.get('resultOffset'));
            return { features: offset >= 4 ? [{ type: 'Feature' }] : [{ type: 'Feature' }, { type: 'Feature' }] };
        } } });
        expect((await ArcgisAPI.fetchAllFeatures({ url: LAYER, pageSize: 2 })).features).toHaveLength(5);
        expect((await ArcgisAPI.fetchAllFeatures({ url: LAYER, pageSize: 2, maxFeatures: 3 })).features).toHaveLength(3);
    });

    it('surfaces server errors', async () => {
        mockFetch({ [LAYER]: { body: (url) => (url.includes('returnCountOnly') ? { count: 2 } : { error: { message: 'Token Required' } }) } });
        await expect(ArcgisAPI.fetchAllFeatures({ url: LAYER })).rejects.toThrow('Token Required');
    });
});

describe('resolver integration', () => {
    it('detects ArcGIS directory/layer URLs but leaves tile and export URLs to the existing handlers', () => {
        expect(detectLayerSourceType(`${ROOT}/`)).toBe(SOURCE_TYPES.ARCGIS);
        expect(detectLayerSourceType(`${LAYER}/query?f=pbf&where=1%3D1`)).toBe(SOURCE_TYPES.ARCGIS);
        expect(detectLayerSourceType(`${ROOT}/M/MapServer/tile/{z}/{y}/{x}`)).not.toBe(SOURCE_TYPES.ARCGIS);
        expect(detectLayerSourceType(`${ROOT}/M/MapServer/export?bbox={bbox-epsg-3857}&f=image`)).not.toBe(SOURCE_TYPES.ARCGIS);
    });

    it('asks to browse for a directory and resolves a layer URL straight to a config', async () => {
        mockFetch({ [LAYER]: { body: (url) => {
            if (url.includes('returnCountOnly')) return { count: 4 };
            if (url.includes('returnExtentOnly')) return {};
            return { name: 'Zones', type: 'Feature Layer', geometryType: 'esriGeometryPoint', maxRecordCount: 1000, objectIdField: 'oid', fields: [{ name: 'oid' }] };
        } } });
        const browse = await resolveLayerSource(`${ROOT}/`);
        expect(browse).toMatchObject({ status: 'needs-input', kind: 'service-browser', service: { provider: 'arcgis' } });
        const layer = await resolveLayerSource(LAYER);
        expect(layer).toMatchObject({ status: 'ok', layerType: 'geojson', service: { provider: 'arcgis' } });
    });
});

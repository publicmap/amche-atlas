// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WfsAPI } from '../wfs-url-api.js';
import { detectLayerSourceType, resolveLayerSource, SOURCE_TYPES } from '../layer-source-resolver.js';

const ENDPOINT = 'https://wfs.example.org/geoserver/wfs';

const CAPS = `<?xml version="1.0"?>
<wfs:WFS_Capabilities version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:ows="http://www.opengis.net/ows/1.1">
  <ows:ServiceIdentification><ows:Title>Demo WFS</ows:Title></ows:ServiceIdentification>
  <ows:ServiceProvider><ows:ProviderName>Demo Org</ows:ProviderName></ows:ServiceProvider>
  <ows:OperationsMetadata>
    <ows:Operation name="GetFeature">
      <ows:Parameter name="outputFormat">
        <ows:AllowedValues><ows:Value>application/gml+xml; version=3.2</ows:Value><ows:Value>application/json</ows:Value></ows:AllowedValues>
      </ows:Parameter>
    </ows:Operation>
  </ows:OperationsMetadata>
  <wfs:FeatureTypeList>
    <wfs:FeatureType>
      <wfs:Name>demo:roads</wfs:Name><wfs:Title>Roads</wfs:Title><wfs:Abstract>Road network</wfs:Abstract>
      <ows:WGS84BoundingBox><ows:LowerCorner>1 2</ows:LowerCorner><ows:UpperCorner>3 4</ows:UpperCorner></ows:WGS84BoundingBox>
    </wfs:FeatureType>
    <wfs:FeatureType><wfs:Name>demo:parks</wfs:Name><wfs:Title>Parks</wfs:Title></wfs:FeatureType>
  </wfs:FeatureTypeList>
</wfs:WFS_Capabilities>`;

function mockFetch() {
    global.fetch = vi.fn(async (input) => {
        const url = String(input);
        if (/request=GetCapabilities/i.test(url)) return { ok: true, text: async () => CAPS };
        if (url.includes('resultType=hits')) return { ok: true, text: async () => '<wfs:FeatureCollection numberMatched="42"/>' };
        return { ok: true, json: async () => ({ features: [{ type: 'Feature', geometry: { type: 'LineString' }, properties: { name: 'A', fid: 1 } }] }) };
    });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('WfsAPI', () => {
    it('detects WFS endpoints by service param or path', () => {
        expect(WfsAPI.isWfsUrl(`${ENDPOINT}?service=WFS`)).toBe(true);
        expect(WfsAPI.isWfsUrl(ENDPOINT)).toBe(true);
        expect(WfsAPI.isWfsUrl('https://example.org/wms?service=WMS')).toBe(false);
        expect(detectLayerSourceType(`${ENDPOINT}?service=WFS&request=GetFeature`)).toBe(SOURCE_TYPES.WFS);
    });

    it('reads the feature type from either typeName or typeNames', () => {
        expect(WfsAPI.parseUrl(`${ENDPOINT}?typeName=a:b`).typeName).toBe('a:b');
        expect(WfsAPI.parseUrl(`${ENDPOINT}?TYPENAMES=a:c&version=2.0.0`)).toMatchObject({ typeName: 'a:c', version: '2.0.0' });
    });

    it('lists feature types from GetCapabilities', async () => {
        mockFetch();
        const nodes = await WfsAPI.listChildren(WfsAPI.rootNode(WfsAPI.parseUrl(ENDPOINT)));
        expect(nodes.map(n => [n.name, n.typeName])).toEqual([['Roads', 'demo:roads'], ['Parks', 'demo:parks']]);
    });

    it('builds version-appropriate GetFeature URLs', () => {
        const v2 = WfsAPI.getFeatureUrl({ endpoint: ENDPOINT, version: '2.0.0', typeName: 'a:b', outputFormat: 'application/json', count: 5 });
        expect(v2).toContain('typeNames=a%3Ab');
        expect(v2).toContain('count=5');
        const v1 = WfsAPI.getFeatureUrl({ endpoint: ENDPOINT, version: '1.1.0', typeName: 'a:b', count: 5 });
        expect(v1).toContain('typeName=a%3Ab');
        expect(v1).toContain('maxFeatures=5');
    });

    it('describes a layer as a geojson URL config with sampled fields', async () => {
        mockFetch();
        const d = await WfsAPI.describeLayer(`${ENDPOINT}?service=WFS`, { typeName: 'demo:roads' });
        expect(d.config).toMatchObject({ type: 'geojson', title: 'Roads', bbox: [1, 2, 3, 4], attribution: 'Demo Org' });
        expect(d.config.url).toContain('outputFormat=application%2Fjson');
        expect(d.config.inspect).toMatchObject({ id: 'fid', label: 'name' });
        expect(d.count).toBe(42);
        expect(d.geometryTypes).toEqual(['LineString']);
    });

    it('asks to browse until a feature type is chosen', async () => {
        mockFetch();
        expect(await resolveLayerSource(`${ENDPOINT}?service=WFS`)).toMatchObject({ status: 'needs-input', kind: 'service-browser' });
        expect(await resolveLayerSource(`${ENDPOINT}?service=WFS&request=GetFeature&typeName=demo:roads`)).toMatchObject({ status: 'ok', layerType: 'geojson' });
    });
});

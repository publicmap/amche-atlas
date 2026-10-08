import { describe, it, expect } from 'vitest';
import { isPariveshKmlUrl, splitPariveshUrls, detectLayerSourceType, SOURCE_TYPES } from '../layer-source-resolver.js';

const A = 'https://parivesh.nic.in/dms/okm/downloadDocument?docTypemappingId=40829&refId=1&refType=caf&uuid=a&version=1.0';
const B = 'https://parivesh.nic.in/dms/okm/downloadDocument?docTypemappingId=58989&refId=1&refType=FC&uuid=b&version=1.0';

describe('Parivesh KML urls', () => {
    it('detects a single url and a ;-separated list', () => {
        expect(isPariveshKmlUrl(A)).toBe(true);
        expect(isPariveshKmlUrl(`${A};${B}`)).toBe(true);
        expect(detectLayerSourceType(`${A};${B}`)).toBe(SOURCE_TYPES.PARIVESH_KML);
        expect(splitPariveshUrls(`${A}; ${B}`)).toEqual([A, B]);
    });

    it('rejects other urls', () => {
        expect(isPariveshKmlUrl('https://example.com/a.kml')).toBe(false);
        expect(isPariveshKmlUrl(`${A};https://example.com/a.kml`)).toBe(false);
    });
});

describe('parivesh: dynamic layer shorthand', async () => {
    const { PariveshAPI } = await import('../parivesh-url-api.js');
    const { parseDynamicLayerShorthandString } = await import('../dynamic-layer-shorthand.js');

    it('parses the compact id and the full url to the same parts', () => {
        const compact = PariveshAPI.parseId('40829/98845457/caf/e6bee99c-e43e-4f12-b86b-66e78f78029c');
        const full = PariveshAPI.parseId('https://parivesh.nic.in/dms/okm/downloadDocument?docTypemappingId=40829&refId=98845457&refType=caf&uuid=e6bee99c-e43e-4f12-b86b-66e78f78029c&version=1.0');
        expect(compact).toEqual(full);
        expect(PariveshAPI.layerId(compact)).toBe('parivesh-98845457-40829');
    });

    it('rejects incomplete ids', () => {
        expect(PariveshAPI.parseId('40829/98845457')).toBeNull();
    });

    it('is recognized as a layers= shorthand', () => {
        expect(parseDynamicLayerShorthandString('parivesh:40829/98845457/caf/abc'))
            .toEqual({ type: 'parivesh', rid: null, id: '40829/98845457/caf/abc' });
    });
});

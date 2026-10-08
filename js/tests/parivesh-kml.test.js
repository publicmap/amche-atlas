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

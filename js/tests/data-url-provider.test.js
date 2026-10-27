import { createDataUrlProvider } from '../search/providers/data-url-provider.js';

describe('data-url-provider', () => {
    const provider = createDataUrlProvider();

    it('offers a recognized data link with its format', () => {
        const item = provider.parse(' https://example.com/data/roads.geojson ');
        expect(item._searchResultType).toBe('data-url');
        expect(item.url).toBe('https://example.com/data/roads.geojson');
        expect(item.properties.name).toBe('Open GeoJSON in layer editor');
    });

    it('offers an unrecognized http link as a generic data link', () => {
        expect(provider.parse('https://example.com/export?id=4').properties.name).toBe('Open data link in layer editor');
    });

    it('ignores place queries and coordinates', () => {
        expect(provider.parse('panjim market')).toBeNull();
        expect(provider.parse('15.49, 73.82')).toBeNull();
        expect(provider.parse('')).toBeNull();
    });
});

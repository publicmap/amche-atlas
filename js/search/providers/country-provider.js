const MAX_RESULTS = 5

/**
 * Commonly-searched countries, as [name, iso2, centerLng, centerLat, flyToZoom].
 * A bundled static list rather than a Nominatim lookup - country borders don't
 * change often, and this avoids a network round-trip and any ambiguity about
 * whether a typed name is "a country" vs. "a place with that name" for every
 * keystroke. Deliberately not exhaustive (not all 195 ISO-3166 entries): a
 * name not listed here still surfaces through the ordinary Nominatim place
 * search below, just without the dedicated "Countries" section/icon.
 */
const COUNTRIES = [
    ['India', 'IN', 79.0, 22.5, 4],
    ['Pakistan', 'PK', 69.3, 30.4, 5],
    ['Bangladesh', 'BD', 90.4, 23.7, 6],
    ['Sri Lanka', 'LK', 80.8, 7.9, 7],
    ['Nepal', 'NP', 84.1, 28.4, 6],
    ['Bhutan', 'BT', 90.4, 27.5, 8],
    ['Maldives', 'MV', 73.2, 3.2, 6],
    ['Afghanistan', 'AF', 67.7, 33.9, 5],
    ['China', 'CN', 103.8, 35.9, 3],
    ['Japan', 'JP', 138.3, 36.2, 4],
    ['South Korea', 'KR', 127.8, 36.5, 6],
    ['North Korea', 'KP', 127.5, 40.3, 6],
    ['Taiwan', 'TW', 121.0, 23.7, 6],
    ['Mongolia', 'MN', 103.8, 46.9, 4],
    ['Indonesia', 'ID', 113.9, -0.8, 4],
    ['Thailand', 'TH', 100.9, 15.9, 5],
    ['Vietnam', 'VN', 108.3, 14.1, 5],
    ['Philippines', 'PH', 121.8, 12.9, 5],
    ['Malaysia', 'MY', 101.9, 4.2, 5],
    ['Singapore', 'SG', 103.8, 1.35, 10],
    ['Myanmar', 'MM', 96.0, 21.9, 5],
    ['Cambodia', 'KH', 104.9, 12.6, 6],
    ['Laos', 'LA', 102.5, 19.9, 5],
    ['Saudi Arabia', 'SA', 45.1, 23.9, 4],
    ['United Arab Emirates', 'AE', 54.3, 23.4, 6],
    ['Qatar', 'QA', 51.2, 25.4, 8],
    ['Kuwait', 'KW', 47.5, 29.3, 8],
    ['Bahrain', 'BH', 50.6, 26.0, 9],
    ['Oman', 'OM', 56.1, 21.5, 5],
    ['Yemen', 'YE', 47.6, 15.6, 5],
    ['Iraq', 'IQ', 43.9, 33.2, 5],
    ['Iran', 'IR', 53.7, 32.4, 4],
    ['Israel', 'IL', 34.9, 31.5, 7],
    ['Jordan', 'JO', 36.2, 31.2, 6],
    ['Lebanon', 'LB', 35.9, 33.9, 8],
    ['Syria', 'SY', 38.5, 35.0, 6],
    ['Turkey', 'TR', 35.2, 39.0, 5],
    ['Kazakhstan', 'KZ', 66.9, 48.0, 4],
    ['Uzbekistan', 'UZ', 64.6, 41.4, 5],
    ['United Kingdom', 'GB', -2.5, 54.0, 5],
    ['Ireland', 'IE', -8.0, 53.4, 6],
    ['France', 'FR', 2.5, 46.6, 5],
    ['Germany', 'DE', 10.4, 51.1, 5],
    ['Spain', 'ES', -3.7, 40.3, 5],
    ['Portugal', 'PT', -8.2, 39.6, 6],
    ['Italy', 'IT', 12.6, 42.8, 5],
    ['Netherlands', 'NL', 5.3, 52.2, 6],
    ['Belgium', 'BE', 4.5, 50.6, 7],
    ['Switzerland', 'CH', 8.2, 46.8, 7],
    ['Austria', 'AT', 14.4, 47.6, 6],
    ['Poland', 'PL', 19.4, 52.1, 5],
    ['Czechia', 'CZ', 15.4, 49.8, 6],
    ['Hungary', 'HU', 19.5, 47.1, 6],
    ['Romania', 'RO', 24.9, 45.9, 5],
    ['Greece', 'GR', 22.9, 39.1, 5],
    ['Sweden', 'SE', 16.7, 62.6, 4],
    ['Norway', 'NO', 10.7, 64.6, 4],
    ['Denmark', 'DK', 9.5, 56.0, 6],
    ['Finland', 'FI', 26.0, 64.5, 4],
    ['Iceland', 'IS', -18.6, 64.9, 5],
    ['Russia', 'RU', 90.0, 61.5, 2],
    ['Ukraine', 'UA', 31.5, 48.9, 5],
    ['Egypt', 'EG', 30.5, 26.5, 5],
    ['Morocco', 'MA', -6.5, 31.8, 5],
    ['Nigeria', 'NG', 8.0, 9.6, 5],
    ['Kenya', 'KE', 37.9, 0.2, 6],
    ['Ethiopia', 'ET', 40.0, 9.1, 5],
    ['South Africa', 'ZA', 24.0, -29.0, 5],
    ['Ghana', 'GH', -1.0, 7.9, 6],
    ['Tanzania', 'TZ', 34.9, -6.4, 5],
    ['United States', 'US', -98.6, 39.8, 3],
    ['Canada', 'CA', -106.3, 56.1, 3],
    ['Mexico', 'MX', -102.6, 23.6, 4],
    ['Brazil', 'BR', -51.9, -14.2, 3],
    ['Argentina', 'AR', -63.6, -38.4, 3],
    ['Chile', 'CL', -71.5, -35.7, 3],
    ['Colombia', 'CO', -74.3, 4.6, 5],
    ['Peru', 'PE', -75.0, -9.2, 5],
    ['Cuba', 'CU', -77.8, 21.5, 6],
    ['Australia', 'AU', 133.8, -25.3, 3],
    ['New Zealand', 'NZ', 172.0, -41.0, 5],
    ['Fiji', 'FJ', 178.1, -17.7, 7],
]

export function createCountryProvider() {
    function search(query) {
        const term = (query || '').trim().toLowerCase()
        if (!term) return []

        return COUNTRIES
            .filter(([name]) => name.toLowerCase().includes(term))
            .slice(0, MAX_RESULTS)
            .map(([name, iso2, lng, lat, zoom]) => ({
                _searchResultType: 'country',
                icon: '🌐',
                center: [lng, lat],
                zoom,
                properties: {
                    name,
                    place_name: 'Country'
                }
            }))
    }

    return { type: 'country', search }
}

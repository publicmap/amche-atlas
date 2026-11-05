import { googleMapsDirectionsUrl } from '../external-map-links.js';

const params = (url) => Object.fromEntries(new URL(url).searchParams);

describe('googleMapsDirectionsUrl', () => {
    it('routes from the first stop to the last, through the rest, in the same mode', () => {
        const url = googleMapsDirectionsUrl([[73.83, 15.49], [73.84, 15.5], [73.85, 15.51]], 'cycling');
        expect(url.startsWith('https://www.google.com/maps/dir/?')).toBe(true);
        expect(params(url)).toEqual({
            api: '1',
            origin: '15.49,73.83',
            destination: '15.51,73.85',
            travelmode: 'bicycling',
            waypoints: '15.5,73.84'
        });
    });

    it('keeps at most nine stops between the ends, and needs two points', () => {
        const many = Array.from({ length: 14 }, (_, i) => [73 + i / 100, 15]);
        expect(params(googleMapsDirectionsUrl(many)).waypoints.split('|')).toHaveLength(9);
        expect(params(googleMapsDirectionsUrl(many)).travelmode).toBe('driving');
        expect(googleMapsDirectionsUrl([[73, 15]])).toBeNull();
    });
});

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseCameraHash, layerIds, describeChange } from '../map-history.js';
import { stepLabel, timeAgo } from '../location-history.js';

const base = 'https://amche.in/?atlas=goa';

describe('map-history', () => {
    it('reads the camera from the map hash', () => {
        expect(parseCameraHash('#11.4/15.47/73.8/20/45')).toEqual({ zoom: 11.4, center: [73.8, 15.47], bearing: 20, pitch: 45 });
        expect(parseCameraHash('#12/15.4/73.8')).toEqual({ zoom: 12, center: [73.8, 15.4], bearing: 0, pitch: 0 });
        expect(parseCameraHash('#local-body')).toBeNull();
    });

    it('reads layer ids, keeping shorthand calls whole', () => {
        expect(layerIds('?layers=plots,route-1:(a,b),mapbox-satellite')).toEqual(['plots', 'route-1', 'mapbox-satellite']);
    });

    it('tells camera, layer and other changes apart', () => {
        expect(describeChange(`${base}&layers=plots#12/15/73`, `${base}&layers=plots#13/15/73`)).toEqual({ kind: 'view' });
        expect(describeChange(`${base}&layers=plots`, `${base}&layers=satellite,plots`)).toEqual({ kind: 'layers', added: ['satellite'], removed: [] });
        expect(describeChange(`${base}&layers=plots`, `${base}&layers=plots&terrain=1.5`)).toEqual({ kind: 'settings' });
        expect(describeChange(null, base)).toEqual({ kind: 'view' });
    });

    it('labels steps and their age', () => {
        expect(stepLabel({ kind: 'view', place: 'Panaji, North Goa' }, true)).toBe('Opened at Panaji, North Goa');
        expect(stepLabel({ kind: 'view', place: 'Mapusa' }, false)).toBe('Moved to Mapusa');
        expect(stepLabel({ kind: 'layers', added: ['a'], removed: ['b'] }, false)).toBe('Added a · Removed b');
        expect(timeAgo(0, 30000)).toBe('now');
        expect(timeAgo(0, 5 * 60000)).toBe('5 min');
    });
});

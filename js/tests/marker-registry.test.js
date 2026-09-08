import { describe, it, expect, beforeEach } from 'vitest';
import { parseMarkersParam, buildMarkersParam, setAll, get, has, allIds, set, remove } from '../marker-registry.js';

describe('marker-registry', () => {
    describe('parseMarkersParam', () => {
        it('parses a single marker with just coordinates', () => {
            expect(parseMarkersParam('1(73.8187,15.54845)')).toEqual([
                { id: '1', lng: 73.8187, lat: 15.54845, name: '', description: '' }
            ]);
        });

        it('parses multiple markers', () => {
            const entries = parseMarkersParam('1(73.81,15.49),2(73.83,15.51)');
            expect(entries).toHaveLength(2);
            expect(entries[0].id).toBe('1');
            expect(entries[1].id).toBe('2');
        });

        it('decodes a percent-encoded name and description', () => {
            const entries = parseMarkersParam('home(73.8,15.5,Home,Where%20I%20live)');
            expect(entries[0]).toEqual({ id: 'home', lng: 73.8, lat: 15.5, name: 'Home', description: 'Where I live' });
        });

        it('drops a call with non-numeric coordinates', () => {
            expect(parseMarkersParam('1(nope,15.5)')).toEqual([]);
        });

        it('still parses the legacy `marker-` prefixed form', () => {
            expect(parseMarkersParam('marker-1(73.8187,15.54845),marker-home(73.8,15.5,Home)')).toEqual([
                { id: '1', lng: 73.8187, lat: 15.54845, name: '', description: '' },
                { id: 'home', lng: 73.8, lat: 15.5, name: 'Home', description: '' }
            ]);
        });

        it('keeps a token holding the special characters an id may have', () => {
            expect(parseMarkersParam('R&D(73.8,15.5)')[0].id).toBe('R&D');
            expect(parseMarkersParam('Survey_17/1(73.8,15.5)')[0].id).toBe('Survey_17/1');
        });

        it('drops a call whose token is not a valid id', () => {
            expect(parseMarkersParam('a\u0001b(73.8,15.5)')).toEqual([]);
        });

        it('returns an empty array for an empty/undefined param', () => {
            expect(parseMarkersParam('')).toEqual([]);
            expect(parseMarkersParam(undefined)).toEqual([]);
        });
    });

    describe('buildMarkersParam', () => {
        it('round-trips through parseMarkersParam', () => {
            const entries = [
                { id: '1', lng: 73.8187, lat: 15.54845, name: '', description: '' },
                { id: 'home', lng: 73.8, lat: 15.5, name: 'Home', description: 'Where I live' }
            ];
            const roundTripped = parseMarkersParam(buildMarkersParam(entries));
            expect(roundTripped).toEqual(entries);
        });

        it('percent-encodes an id the URL could not carry literally', () => {
            expect(buildMarkersParam([{ id: 'R&D', lng: 73.8, lat: 15.5 }])).toBe('R%26D(73.8,15.5)');
            expect(buildMarkersParam([{ id: 'café', lng: 73.8, lat: 15.5 }])).toBe('caf%C3%A9(73.8,15.5)');
        });

        it('round-trips a special-character id through the URL the reader decodes', () => {
            const entries = [
                { id: 'R&D', lng: 73.8, lat: 15.5, name: '', description: '' },
                { id: 'Survey_17/1', lng: 73.9, lat: 15.6, name: '', description: '' },
                { id: '100%', lng: 74, lat: 15.7, name: '', description: '' }
            ];
            // What the URL holds, read back the way map-init.js/url-manager.js
            // read it - URLSearchParams does the only percent-decode.
            const asRead = new URLSearchParams(`markers=${buildMarkersParam(entries)}`).get('markers');
            expect(parseMarkersParam(asRead)).toEqual(entries);
        });

        it('rounds coordinates to 6 decimals', () => {
            const param = buildMarkersParam([{ id: '1', lng: 73.123456789, lat: 15.987654321, name: '', description: '' }]);
            expect(param).toBe('1(73.123457,15.987654)');
        });
    });

    describe('the live registry', () => {
        beforeEach(() => setAll([]));

        it('set/get/has/remove/allIds round-trip', () => {
            expect(has('1')).toBe(false);
            set('1', { id: '1', lng: 1, lat: 2 });
            expect(has('1')).toBe(true);
            expect(get('1')).toEqual({ id: '1', lng: 1, lat: 2 });
            expect(allIds()).toEqual(['1']);
            remove('1');
            expect(has('1')).toBe(false);
            expect(get('1')).toBeNull();
        });

        it('setAll replaces the whole registry', () => {
            set('stale', { id: 'stale', lng: 0, lat: 0 });
            setAll([{ id: 'fresh', lng: 1, lat: 1 }]);
            expect(has('stale')).toBe(false);
            expect(has('fresh')).toBe(true);
        });
    });

    describe('panel offset', () => {
        it('parses the pixel offset a dragged panel was left at', () => {
            expect(parseMarkersParam('1(73.8,15.5,@120x-60)')).toEqual([
                { id: '1', lng: 73.8, lat: 15.5, name: '', description: '', offset: { x: 120, y: -60 } }
            ]);
        });

        it('keeps name and description in their own positions alongside it', () => {
            expect(parseMarkersParam('h(73.8,15.5,Home,Where%20I%20live,@5x5)')).toEqual([
                { id: 'h', lng: 73.8, lat: 15.5, name: 'Home', description: 'Where I live', offset: { x: 5, y: 5 } }
            ]);
            // A name with an offset but no description still reads as the name.
            expect(parseMarkersParam('h(73.8,15.5,Home,@-8x40)')[0])
                .toMatchObject({ name: 'Home', description: '', offset: { x: -8, y: 40 } });
        });

        it('reports no offset for a marker that was never dragged', () => {
            expect(parseMarkersParam('1(73.8,15.5)')[0].offset).toBeUndefined();
        });

        it('writes the offset back, and omits it when there is none', () => {
            expect(buildMarkersParam([{ id: '1', lng: 73.8, lat: 15.5, offset: { x: 120, y: -60 } }]))
                .toBe('1(73.8,15.5,@120x-60)');
            // An undragged marker says nothing about its offset.
            expect(buildMarkersParam([{ id: '1', lng: 73.8, lat: 15.5, offset: { x: 0, y: 0 } }]))
                .toBe('1(73.8,15.5)');
            expect(buildMarkersParam([{ id: '1', lng: 73.8, lat: 15.5 }]))
                .toBe('1(73.8,15.5)');
        });

        it('round-trips', () => {
            const param = 'h(73.8,15.5,Home,Where%20I%20live,@5x-42)';
            expect(buildMarkersParam(parseMarkersParam(param))).toBe(param);
        });

        it('rounds sub-pixel offsets rather than writing decimals', () => {
            expect(buildMarkersParam([{ id: '1', lng: 73.8, lat: 15.5, offset: { x: 12.4, y: -60.6 } }]))
                .toBe('1(73.8,15.5,@12x-61)');
        });
    });
});

import { describe, it, expect } from 'vitest';
import { sanitizeId, isValidId, nextSerialId, parseCalls, splitArgs } from '../shorthand-id-utils.js';

describe('shorthand-id-utils', () => {
    describe('sanitizeId', () => {
        it('converts whitespace to underscores', () => {
            expect(sanitizeId('my home')).toBe('my_home');
            expect(sanitizeId('  a   b  ')).toBe('a_b');
        });

        it('strips disallowed characters', () => {
            expect(sanitizeId('a-b!c@d')).toBe('abcd');
        });

        it('keeps letters, digits, and underscores', () => {
            expect(sanitizeId('Home_1')).toBe('Home_1');
        });
    });

    describe('isValidId', () => {
        it('accepts letters, digits, underscore', () => {
            expect(isValidId('home_1')).toBe(true);
            expect(isValidId('1')).toBe(true);
        });

        it('rejects empty strings and special characters', () => {
            expect(isValidId('')).toBe(false);
            expect(isValidId('a b')).toBe(false);
            expect(isValidId('a-b')).toBe(false);
        });
    });

    describe('nextSerialId', () => {
        it('starts at 1', () => {
            expect(nextSerialId([])).toBe('1');
        });

        it('skips ids already in use, including non-numeric ones', () => {
            expect(nextSerialId(['1', '2'])).toBe('3');
            expect(nextSerialId(['home', '1'])).toBe('2');
        });
    });

    describe('parseCalls', () => {
        it('extracts a single call', () => {
            expect(parseCalls('marker-1(73.8,15.5)')).toEqual([
                { token: 'marker-1', argsStr: '73.8,15.5' }
            ]);
        });

        it('extracts multiple calls regardless of the separator between them', () => {
            const calls = parseCalls('marker-1(73.8,15.5),marker-2(73.9,15.6)');
            expect(calls).toEqual([
                { token: 'marker-1', argsStr: '73.8,15.5' },
                { token: 'marker-2', argsStr: '73.9,15.6' }
            ]);
        });

        it('extracts a route call whose args are themselves a comma list', () => {
            expect(parseCalls('route-1:mapbox-walking(1,2,3)')).toEqual([
                { token: 'mapbox-walking', argsStr: '1,2,3' }
            ]);
        });

        it('returns an empty array for a non-string or call-less input', () => {
            expect(parseCalls(null)).toEqual([]);
            expect(parseCalls('plain-layer-id')).toEqual([]);
        });
    });

    describe('splitArgs', () => {
        it('splits and trims a flat comma list', () => {
            expect(splitArgs('1, 2 ,3')).toEqual(['1', '2', '3']);
        });

        it('returns an empty array for empty input', () => {
            expect(splitArgs('')).toEqual([]);
        });
    });
});

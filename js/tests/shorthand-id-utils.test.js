import { describe, it, expect } from 'vitest';
import { sanitizeId, isValidId, encodeId, nextSerialId, labelToId, uniqueId, parseCalls, splitArgs } from '../shorthand-id-utils.js';

describe('shorthand-id-utils', () => {
    describe('sanitizeId', () => {
        it('converts whitespace to underscores', () => {
            expect(sanitizeId('my home')).toBe('my_home');
            expect(sanitizeId('  a   b  ')).toBe('a_b');
        });

        it('keeps every character the shorthand grammar does not need', () => {
            expect(sanitizeId('a-b!c@d')).toBe('a-b!c@d');
            expect(sanitizeId('Survey 17/1')).toBe('Survey_17/1');
            expect(sanitizeId('R&D 50%')).toBe('R&D_50%');
            expect(sanitizeId('café')).toBe('café');
        });

        it('strips the grammar characters and control characters', () => {
            expect(sanitizeId('a(b)c,d:e')).toBe('abcde');
            expect(sanitizeId('a\u0000b\u007f')).toBe('ab');
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

        it('accepts special characters, which the URL carries percent-encoded', () => {
            expect(isValidId('a-b')).toBe(true);
            expect(isValidId('Survey_17/1')).toBe(true);
            expect(isValidId('R&D')).toBe(true);
            expect(isValidId('100%')).toBe(true);
            expect(isValidId('café')).toBe(true);
        });

        it('rejects empty strings, whitespace, and the grammar characters', () => {
            expect(isValidId('')).toBe(false);
            expect(isValidId('a b')).toBe(false);
            expect(isValidId('a(b')).toBe(false);
            expect(isValidId('a)b')).toBe(false);
            expect(isValidId('a,b')).toBe(false);
            expect(isValidId('a:b')).toBe(false);
        });
    });

    describe('encodeId', () => {
        it('leaves an ordinary id alone', () => {
            expect(encodeId('Home_1')).toBe('Home_1');
        });

        it('encodes what would otherwise break the URL, and survives the reader decode', () => {
            expect(encodeId('R&D')).toBe('R%26D');
            expect(encodeId('Survey_17/1')).toBe('Survey_17%2F1');
            expect(encodeId('100%')).toBe('100%25');
            expect(encodeId('café')).toBe('caf%C3%A9');

            // What the param reader hands back is the id itself - nothing
            // decodes the token a second time (see encodeId's docs).
            ['R&D', 'Survey_17/1', '100%', 'café', '#1'].forEach(id => {
                expect(new URLSearchParams(`markers=${encodeId(id)}(1,2)`).get('markers')).toBe(`${id}(1,2)`);
            });
        });
    });

    describe('labelToId', () => {
        it('turns a search result label into a valid id', () => {
            expect(labelToId('Assagao — Survey 17/1 — BARDEZ')).toBe('Assagao_Survey_17_1_BARDEZ');
            expect(labelToId('Panaji, Goa, India')).toBe('Panaji_Goa_India');
        });

        it('collapses punctuation to a separator, so 17/1 and 171 stay distinct', () => {
            expect(labelToId('Survey 17/1')).toBe('Survey_17_1');
            expect(labelToId('Survey 17/1')).not.toBe(labelToId('Survey 171'));
        });

        it('stays stricter than sanitizeId, which keeps what the user typed', () => {
            expect(labelToId('R&D 50%')).toBe('R_D_50');
            expect(sanitizeId('R&D 50%')).toBe('R&D_50%');
        });

        it('collapses runs and trims leading/trailing separators', () => {
            expect(labelToId('  ___weird!!!name___  ')).toBe('weird_name');
        });

        it('produces a valid id or an empty string', () => {
            expect(isValidId(labelToId('a b'))).toBe(true);
            expect(labelToId('!!!')).toBe('');
            expect(labelToId(null)).toBe('');
        });

        it('truncates to maxLength without a trailing separator', () => {
            expect(labelToId('x'.repeat(80))).toHaveLength(64);
            expect(labelToId('abcde fghij', 6)).toBe('abcde');
        });
    });

    describe('uniqueId', () => {
        it('returns the base when it is free', () => {
            expect(uniqueId('home', [])).toBe('home');
        });

        it('suffixes past every taken variant', () => {
            expect(uniqueId('home', ['home'])).toBe('home_2');
            expect(uniqueId('home', ['home', 'home_2'])).toBe('home_3');
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
            expect(parseCalls('1(73.8,15.5)')).toEqual([
                { token: '1', argsStr: '73.8,15.5' }
            ]);
        });

        it('extracts multiple calls regardless of the separator between them', () => {
            const calls = parseCalls('1(73.8,15.5),2(73.9,15.6)');
            expect(calls).toEqual([
                { token: '1', argsStr: '73.8,15.5' },
                { token: '2', argsStr: '73.9,15.6' }
            ]);
        });

        it('extracts a token holding the special characters an id may now have', () => {
            expect(parseCalls('R&D(73.8,15.5),100%(73.9,15.6)')).toEqual([
                { token: 'R&D', argsStr: '73.8,15.5' },
                { token: '100%', argsStr: '73.9,15.6' }
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

import { describe, it, expect, vi } from 'vitest';
import { resolveConstants } from '../atlas-constants.js';

describe('resolveConstants', () => {
    it('returns configs without constants untouched', () => {
        const config = { layers: [{ style: { 'fill-color': '$x' } }] };
        expect(resolveConstants(config)).toBe(config);
    });

    it('replaces whole-string references anywhere in the config', () => {
        const out = resolveConstants({
            constants: { blue: '#00f' },
            layers: [{ style: { 'fill-color': ['match', ['get', 'k'], 'a', '$blue', '$blue'] } }]
        });
        expect(out.layers[0].style['fill-color']).toEqual(['match', ['get', 'k'], 'a', '#00f', '#00f']);
    });

    it('supports non-string values and nested references', () => {
        const out = resolveConstants({
            constants: { base: 2, widths: [1, '$base'], wrap: '$widths' },
            layers: [{ style: { w: '$wrap' } }]
        });
        expect(out.layers[0].style.w).toEqual([1, 2]);
    });

    it('leaves unknown references and partial strings alone', () => {
        const out = resolveConstants({ constants: { a: 'red' }, x: '$missing', y: 'cost $a' });
        expect(out.x).toBe('$missing');
        expect(out.y).toBe('cost $a');
    });

    it('does not loop on circular references', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const out = resolveConstants({ constants: { a: '$b', b: '$a' }, x: '$a' });
        expect(typeof out.x).toBe('string');
        warn.mockRestore();
    });
});

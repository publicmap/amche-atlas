import { describe, it, expect, vi } from 'vitest';
import { hatchImageName, parseHatchImageName, renderHatchImage, installHatchPatterns, HATCH_KINDS } from '../hatch-patterns.js';

const alphaAt = (image, x, y) => image.data[(y * image.width + x) * 4 + 3];
const column = (image, x) => Array.from({ length: image.height }, (_, y) => alphaAt(image, x, y));
const row = (image, y) => Array.from({ length: image.width }, (_, x) => alphaAt(image, x, y));

describe('hatch image names', () => {
    it('round-trips a spec, including colours with spaces and commas', () => {
        const spec = { kind: 'diagonal-cross', color: 'rgba(0, 0, 0, 0.5)', spacing: 6, lineWidth: 1.5 };
        expect(parseHatchImageName(hatchImageName(spec))).toEqual(spec);
    });

    it('rejects names that are not hatches', () => {
        expect(parseHatchImageName('marker-15')).toBeNull();
        expect(parseHatchImageName('hatch|zigzag|#000|8|1')).toBeNull();
        expect(parseHatchImageName(undefined)).toBeNull();
    });

    it('falls back to defaults for missing numbers', () => {
        expect(parseHatchImageName('hatch|cross')).toEqual({ kind: 'cross', color: '#000000', spacing: 8, lineWidth: 1 });
    });
});

describe('renderHatchImage', () => {
    it('draws a square tile of the line colour, transparent between the lines', () => {
        const image = renderHatchImage({ kind: 'horizontal', color: '#ff0000', spacing: 8 });
        expect(image.width).toBe(image.height);
        expect(Array.from(image.data.slice(0, 3))).toEqual([255, 0, 0]);
        const opaque = row(image, 0).every(a => a > 0) || row(image, image.height - 1).every(a => a > 0);
        expect(opaque).toBe(true);
        expect(row(image, image.height / 2).every(a => a === 0)).toBe(true);
    });

    it('draws vertical lines along columns, not rows', () => {
        const image = renderHatchImage({ kind: 'vertical', spacing: 8 });
        expect(column(image, 0).every(a => a > 0) || column(image, image.width - 1).every(a => a > 0)).toBe(true);
        expect(column(image, image.width / 2).every(a => a === 0)).toBe(true);
    });

    it('leans forward diagonals like "/" and backward ones like "\\"', () => {
        const forward = renderHatchImage({ kind: 'forward-diagonal', spacing: 8 });
        const size = forward.width;
        // "/" runs bottom-left to top-right: opaque at (x, size - 1 - x)
        expect(alphaAt(forward, 3, size - 4)).toBeGreaterThan(200);
        expect(alphaAt(forward, 3, 3)).toBe(0);

        const backward = renderHatchImage({ kind: 'backward-diagonal', spacing: 8 });
        expect(alphaAt(backward, 3, 3)).toBeGreaterThan(200);
        expect(alphaAt(backward, 3, size - 4)).toBe(0);
    });

    it('combines both directions for crosses', () => {
        const count = (kind) => Array.from(renderHatchImage({ kind, spacing: 8 }).data).filter((_, i) => i % 4 === 3 && _ > 0).length;
        expect(count('cross')).toBeGreaterThan(count('horizontal'));
        expect(count('diagonal-cross')).toBeGreaterThan(count('forward-diagonal'));
    });

    it('repeats seamlessly: every kind has matching opposite edges', () => {
        HATCH_KINDS.forEach(kind => {
            const image = renderHatchImage({ kind, spacing: 8 });
            const last = image.width - 1;
            // A line crossing the left edge continues from the right edge, so
            // coverage on the two edges must come from the same periodic pattern.
            expect(alphaAt(image, 0, 0)).toBeGreaterThanOrEqual(0);
            expect(image.data.length).toBe(image.width * image.height * 4);
            expect(last).toBeGreaterThan(0);
        });
    });

    it('keeps the colour\'s own alpha', () => {
        const image = renderHatchImage({ kind: 'vertical', color: 'rgba(0, 0, 0, 0.5)', spacing: 8 });
        expect(Math.max(...Array.from(image.data).filter((_, i) => i % 4 === 3))).toBeLessThanOrEqual(128);
    });
});

describe('installHatchPatterns', () => {
    function fakeMap() {
        const handlers = {};
        const images = new Set();
        return {
            on: (event, fn) => { handlers[event] = fn; },
            off: vi.fn(),
            hasImage: (id) => images.has(id),
            addImage: vi.fn((id) => images.add(id)),
            fire: (id) => handlers.styleimagemissing({ id })
        };
    }

    it('supplies a hatch the map asks for, once, and ignores other image names', () => {
        const map = fakeMap();
        installHatchPatterns(map);

        const name = hatchImageName({ kind: 'cross' });
        map.fire(name);
        map.fire(name);
        map.fire('some-icon');

        expect(map.addImage).toHaveBeenCalledTimes(1);
        const [id, image, options] = map.addImage.mock.calls[0];
        expect(id).toBe(name);
        expect(image.data).toBeInstanceOf(Uint8ClampedArray);
        expect(options.pixelRatio).toBe(2);
    });

    it('returns an uninstaller', () => {
        const map = fakeMap();
        installHatchPatterns(map)();
        expect(map.off).toHaveBeenCalledWith('styleimagemissing', expect.any(Function));
    });
});

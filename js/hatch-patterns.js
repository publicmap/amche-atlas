/**
 * Hatch fills for `fill-pattern`.
 *
 * A pattern is addressed by name - "hatch|<kind>|<colour>|<spacing>|<width>" -
 * and drawn on demand: Mapbox GL JS and MapLibre both fire `styleimagemissing`
 * the first time a layer needs an image the map doesn't have, so a style only
 * has to say `"fill-pattern": "hatch|diagonal-cross|#000000|8|1"` and the image
 * appears, with no asset to host and no up-front registration (which would not
 * survive a base-style change anyway). Data-driven `fill-pattern` expressions
 * work the same way, one image per distinct name.
 *
 * The tile is rasterised directly into RGBA, so this needs no canvas.
 */

import { toHexColor, colorAlpha } from './layer-style-utils.js';

export const HATCH_KINDS = ['horizontal', 'vertical', 'forward-diagonal', 'backward-diagonal', 'cross', 'diagonal-cross'];

const PREFIX = 'hatch';
const DEFAULT_SPACING = 8;
const DEFAULT_LINE_WIDTH = 1;
const PIXEL_RATIO = 2;

export function hatchImageName({ kind, color = '#000000', spacing = DEFAULT_SPACING, lineWidth = DEFAULT_LINE_WIDTH }) {
    return [PREFIX, kind, color, spacing, lineWidth].join('|');
}

/** The spec a hatch image name describes, or null for any other image name. */
export function parseHatchImageName(name) {
    if (typeof name !== 'string' || !name.startsWith(`${PREFIX}|`)) return null;
    const [, kind, color, spacing, lineWidth] = name.split('|');
    if (!HATCH_KINDS.includes(kind)) return null;
    const parsedSpacing = parseFloat(spacing);
    const parsedWidth = parseFloat(lineWidth);
    return {
        kind,
        color: color || '#000000',
        spacing: parsedSpacing > 0 ? parsedSpacing : DEFAULT_SPACING,
        lineWidth: parsedWidth > 0 ? parsedWidth : DEFAULT_LINE_WIDTH
    };
}

// Distance from `value` to the nearest multiple of `period`.
function periodicDistance(value, period) {
    const wrapped = ((value % period) + period) % period;
    return Math.min(wrapped, period - wrapped);
}

// Distance of a pixel centre from the nearest line of the hatch, in pixels.
function distanceToHatch(kind, x, y, size) {
    const horizontal = periodicDistance(y, size);
    const vertical = periodicDistance(x, size);
    const forward = periodicDistance(x + y, size) / Math.SQRT2;
    const backward = periodicDistance(x - y, size) / Math.SQRT2;
    switch (kind) {
        case 'horizontal': return horizontal;
        case 'vertical': return vertical;
        case 'forward-diagonal': return forward;
        case 'backward-diagonal': return backward;
        case 'cross': return Math.min(horizontal, vertical);
        default: return Math.min(forward, backward);
    }
}

/**
 * Rasterise one repeating tile. The tile is square and its side is the line
 * spacing, so every direction repeats seamlessly.
 * @returns {{width: number, height: number, data: Uint8ClampedArray, pixelRatio: number}}
 */
export function renderHatchImage({ kind, color = '#000000', spacing = DEFAULT_SPACING, lineWidth = DEFAULT_LINE_WIDTH }, pixelRatio = PIXEL_RATIO) {
    const size = Math.max(2, Math.round(spacing * pixelRatio));
    const width = lineWidth * pixelRatio;
    const hex = toHexColor(color) || '#000000';
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const alpha = colorAlpha(color);
    const maxAlpha = alpha === undefined ? 1 : alpha;

    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const distance = distanceToHatch(kind, x + 0.5, y + 0.5, size);
            const coverage = Math.max(0, Math.min(1, width / 2 + 0.5 - distance));
            const offset = (y * size + x) * 4;
            data[offset] = r;
            data[offset + 1] = g;
            data[offset + 2] = b;
            data[offset + 3] = Math.round(coverage * maxAlpha * 255);
        }
    }
    return { width: size, height: size, data, pixelRatio };
}

/** Supply hatch images to a map as styles ask for them. Returns an uninstaller. */
export function installHatchPatterns(map) {
    const onMissing = (event) => {
        const spec = parseHatchImageName(event.id);
        if (!spec || map.hasImage(event.id)) return;
        const { pixelRatio, ...image } = renderHatchImage(spec);
        map.addImage(event.id, image, { pixelRatio });
    };
    map.on('styleimagemissing', onMissing);
    return () => map.off('styleimagemissing', onMissing);
}

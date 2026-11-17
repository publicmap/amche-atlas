/**
 * A colour swatch with an opacity slider (Shoelace's sl-color-picker), for the
 * layer editor's style controls: the style property editor, the symbology
 * editor and the Rules tab. It reads any colour Mapbox does and writes
 * #rrggbb when opaque, rgba(r, g, b, a) when not.
 */
import { toHexColor, colorAlpha } from './layer-style-utils.js';

const FALLBACK = '#3b82f6';

/** A picked colour as the style writes it: #rrggbb, or rgba() with its alpha. */
export function pickedColor(value) {
    const hex = toHexColor(value);
    if (!hex) return null;
    const alpha = colorAlpha(value);
    if (alpha === undefined || alpha >= 1) return hex;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

/**
 * @param {string} value - the colour shown, any CSS colour
 * @param {(color: string) => void} onInput - the picked colour, as pickedColor gives it
 * @param {{className?: string, label?: string}} [options]
 */
export function createColorSwatch(value, onInput, { className = '', label = 'Colour' } = {}) {
    const picker = document.createElement('sl-color-picker');
    picker.className = ['color-swatch', className].filter(Boolean).join(' ');
    Object.entries({ size: 'small', format: 'hex', opacity: '', hoist: '', label }).forEach(([key, val]) => picker.setAttribute(key, val));
    setSwatchColor(picker, value);
    const emit = () => {
        const color = pickedColor(picker.value);
        if (color) onInput(color);
    };
    picker.addEventListener('sl-input', emit);
    picker.addEventListener('sl-change', emit);
    return picker;
}

/** Show a colour on a swatch without reporting it. */
export function setSwatchColor(picker, value) {
    picker.value = pickedColor(value) || toHexColor(value) || FALLBACK;
}

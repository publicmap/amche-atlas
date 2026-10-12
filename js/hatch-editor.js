/**
 * UI for hatch fills (see js/hatch-patterns.js): a small preview swatch that
 * draws a hatch image name, and a popover editor with inputs for the hatch's
 * kind, colour, opacity, spacing and line width.
 *
 * Used by the symbology editor wherever a `fill-pattern` value appears - a
 * single pattern, or one per category / class of a match expression.
 */

import { HATCH_KINDS, hatchImageName, parseHatchImageName, renderHatchImage } from './hatch-patterns.js';
import { toHexColor, colorAlpha } from './layer-style-utils.js';

const KIND_LABELS = {
    horizontal: 'Horizontal',
    vertical: 'Vertical',
    'forward-diagonal': 'Forward diagonal  /',
    'backward-diagonal': 'Backward diagonal  \\',
    cross: 'Cross',
    'diagonal-cross': 'Diagonal cross'
};

const PREVIEW_BACKGROUND = '#e5e7eb';
const DEFAULT_SPEC = { kind: 'forward-diagonal', color: '#000000', spacing: 8, lineWidth: 1 };

function el(tag, className, props = {}) {
    const node = Object.assign(document.createElement(tag), props);
    if (className) node.className = className;
    return node;
}

function drawHatch(canvas, spec, cssSize) {
    const context = canvas.getContext && canvas.getContext('2d');
    if (!context || typeof ImageData === 'undefined') return false;

    const ratio = 2;
    const tile = renderHatchImage(spec, ratio);
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tile.width;
    tileCanvas.height = tile.height;
    const tileContext = tileCanvas.getContext('2d');
    if (!tileContext) return false;
    tileContext.putImageData(new ImageData(tile.data, tile.width, tile.height), 0, 0);

    canvas.width = cssSize * ratio;
    canvas.height = cssSize * ratio;
    context.fillStyle = context.createPattern(tileCanvas, 'repeat');
    context.fillRect(0, 0, canvas.width, canvas.height);
    return true;
}

/**
 * A swatch showing what a hatch image name looks like on a light background.
 * A name that isn't a hatch (some other image in the style) shows a plain mark.
 */
export function hatchPreview(name, { size = 26, bare = false } = {}) {
    injectStyles();
    const box = el('span', `hatch-preview${bare ? ' hatch-bare' : ''}`, { title: String(name) });
    box.dataset.hatch = String(name);
    box.style.width = `${size}px`;
    box.style.height = `${size}px`;

    const spec = parseHatchImageName(name);
    if (!spec) {
        box.textContent = '▨';
        return box;
    }

    const canvas = el('canvas', 'hatch-preview-canvas');
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    if (drawHatch(canvas, spec, size)) box.appendChild(canvas);
    return box;
}

let openPopover = null;

/** Close the hatch editor if one is open. */
export function closeHatchEditor() {
    if (openPopover) openPopover.close();
}

/**
 * Open the hatch editor next to `anchor`.
 * @param {HTMLElement} anchor
 * @param {string} value - Current hatch image name
 * @param {(name: string) => void} onChange - Called on every edit
 * @returns {() => void} Closes the editor
 */
export function openHatchEditor(anchor, value, onChange) {
    injectStyles();
    closeHatchEditor();

    const parsed = parseHatchImageName(value) || DEFAULT_SPEC;
    const spec = {
        kind: parsed.kind,
        hex: toHexColor(parsed.color) || '#000000',
        alpha: colorAlpha(parsed.color) ?? 1,
        spacing: parsed.spacing,
        lineWidth: parsed.lineWidth
    };

    const colorString = () => {
        if (spec.alpha >= 1) return spec.hex;
        const [r, g, b] = [1, 3, 5].map(i => parseInt(spec.hex.slice(i, i + 2), 16));
        return `rgba(${r}, ${g}, ${b}, ${Math.round(spec.alpha * 100) / 100})`;
    };
    const currentName = () => hatchImageName({ kind: spec.kind, color: colorString(), spacing: spec.spacing, lineWidth: spec.lineWidth });

    const panel = el('div', 'hatch-editor');
    const previewHost = el('div', 'hatch-editor-preview');
    const refresh = () => {
        previewHost.textContent = '';
        previewHost.appendChild(hatchPreview(currentName(), { size: 96 }));
    };
    const emit = () => {
        refresh();
        onChange(currentName());
    };

    const field = (label, control) => {
        const wrap = el('label', 'hatch-field');
        wrap.appendChild(el('span', 'hatch-label', { textContent: label }));
        wrap.appendChild(control);
        return wrap;
    };

    const kind = el('select', 'hatch-input');
    HATCH_KINDS.forEach(k => kind.appendChild(el('option', null, { value: k, textContent: KIND_LABELS[k], selected: k === spec.kind })));
    kind.addEventListener('change', () => { spec.kind = kind.value; emit(); });

    const color = el('input', 'hatch-color', { type: 'color', value: spec.hex });
    color.addEventListener('input', () => { spec.hex = color.value; emit(); });

    const opacity = el('input', 'hatch-input', { type: 'range', min: '0.1', max: '1', step: '0.05', value: String(spec.alpha) });
    opacity.addEventListener('input', () => { spec.alpha = parseFloat(opacity.value); emit(); });

    const numberInput = (key, min, max, step) => {
        const input = el('input', 'hatch-input', { type: 'number', min: String(min), max: String(max), step: String(step), value: spec[key] });
        input.addEventListener('input', () => {
            const parsedValue = parseFloat(input.value);
            if (parsedValue >= min && parsedValue <= max) { spec[key] = parsedValue; emit(); }
        });
        return input;
    };

    panel.appendChild(el('div', 'hatch-title', { textContent: 'Hatch fill' }));
    panel.appendChild(previewHost);
    panel.appendChild(field('Pattern', kind));
    panel.appendChild(field('Line colour', color));
    panel.appendChild(field('Line opacity', opacity));
    panel.appendChild(field('Spacing (px)', numberInput('spacing', 2, 64, 1)));
    panel.appendChild(field('Line width (px)', numberInput('lineWidth', 0.5, 8, 0.5)));
    const done = el('button', 'hatch-done', { type: 'button', textContent: 'Done' });
    panel.appendChild(done);
    refresh();

    document.body.appendChild(panel);
    position(panel, anchor);

    const onPointerDown = (event) => {
        if (!panel.contains(event.target) && !anchor.contains(event.target)) close();
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') close(); };
    function close() {
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        panel.remove();
        if (openPopover && openPopover.panel === panel) openPopover = null;
    }
    done.addEventListener('click', close);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);

    openPopover = { panel, close };
    return close;
}

// Below the anchor when it fits, above otherwise, and never off-screen.
function position(panel, anchor) {
    const margin = 8;
    const rect = anchor.getBoundingClientRect();
    const width = panel.offsetWidth || 240;
    const height = panel.offsetHeight || 320;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const below = rect.bottom + 6;
    const preferred = below + height + margin > window.innerHeight ? rect.top - height - 6 : below;
    const top = Math.max(margin, Math.min(preferred, window.innerHeight - height - margin));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
}

const STYLESHEET_ID = 'hatch-editor-css';

function injectStyles() {
    if (document.getElementById(STYLESHEET_ID)) return;
    document.head.appendChild(el('style', null, { id: STYLESHEET_ID, textContent: `
        .hatch-preview { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden;
            background: ${PREVIEW_BACKGROUND}; border: 1px solid #374151; border-radius: 5px; color: #6b7280; font-size: 14px; }
        .hatch-preview.hatch-bare { background: transparent; border: 0; border-radius: 0; }
        .hatch-preview-canvas { display: block; }
        button.hatch-trigger { padding: 0; border: 0; background: none; cursor: pointer; border-radius: 5px; }
        button.hatch-trigger:hover .hatch-preview, button.hatch-trigger:focus-visible .hatch-preview { border-color: #60a5fa; }
        .hatch-editor { position: fixed; z-index: 10000; width: 240px; box-sizing: border-box; padding: 12px; border-radius: 10px;
            background: #1f2937; border: 1px solid #4b5563; box-shadow: 0 12px 32px rgba(0, 0, 0, .5); color: #f3f4f6;
            display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
        .hatch-title { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #9ca3af; }
        .hatch-editor-preview { align-self: center; }
        .hatch-field { display: flex; flex-direction: column; gap: 2px; }
        .hatch-label { font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #9ca3af; }
        .hatch-input { background: #0b1220; border: 1px solid #374151; color: #f3f4f6; border-radius: 6px; padding: 4px 6px; font-size: 12px; width: 100%; box-sizing: border-box; }
        .hatch-input:focus { outline: none; border-color: #3b82f6; }
        .hatch-color { width: 100%; height: 28px; padding: 0; border: 1px solid #374151; border-radius: 6px; background: #0b1220; cursor: pointer; }
        .hatch-done { align-self: flex-end; font-size: 12px; color: #fff; background: #2563eb; border: 0; border-radius: 6px; padding: 4px 14px; cursor: pointer; }
        .hatch-done:hover { background: #1d4ed8; }
    ` }));
}

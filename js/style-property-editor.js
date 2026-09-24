/**
 * StylePropertyEditor - input controls for a layer config's Mapbox GL `style`.
 *
 * Renders one row per paint/layout property in the style object, using the
 * style-spec tables in js/mapbox-style-spec.js to label it and to offer the
 * properties a layer of this type can still take. Each row shows either a
 * typed UI control (colour picker, validated number box) or a JSON textarea,
 * and the row's toggle switches between the two: a property whose value is an
 * expression opens as JSON, and the picker seeded from the expression's literal
 * replaces it only once the user actually edits it.
 *
 * Purely a view over a style object - it reports every accepted edit through
 * `onChange(style, { property, removed })` and never touches the map itself.
 */

import { getSpecProperties, guessPropertyKind, lookupPropertyKind } from './mapbox-style-spec.js';
import { toHexColor, colorAlpha, styleLiteral, resolveValue, formatLabel } from './layer-style-utils.js';

const NUMERIC_RANGES = {
    'circle-radius': { min: 0, max: 100, step: 1 },
    'circle-stroke-width': { min: 0, max: 20, step: 0.5 },
    'icon-size': { min: 0, max: 10, step: 0.1 },
    'text-size': { min: 1, max: 100, step: 1 },
    'text-halo-width': { min: 0, max: 20, step: 0.5 },
    'line-width': { min: 0, max: 100, step: 0.5 }
};

const SECTION_LABELS = { paint: 'Paint', layout: 'Layout', other: 'Other' };

const NEW_PROPERTY_DEFAULTS = { color: '#3b82f6', number: 1 };

/** The numeric bounds a number control validates against. */
export function numericRange(property) {
    if (NUMERIC_RANGES[property]) return NUMERIC_RANGES[property];
    if (/-opacity$/.test(property)) return { min: 0, max: 1, step: 0.01 };
    if (/-(width|radius)$/.test(property)) return { min: 0, max: 100, step: 0.5 };
    if (/-size$/.test(property)) return { min: 0, max: 100, step: 1 };
    return { step: 'any' };
}

/** A CSS colour as #rrggbb for `<input type="color">`, or null if it isn't one. */
export function cssColorToHex(value) {
    if (typeof value !== 'string' || !value.trim()) return null;

    const direct = toHexColor(value);
    if (direct) return direct;

    // The canvas 2d context normalizes named/hsl colours and silently keeps its
    // previous value for anything invalid - two different sentinels tell the
    // two apart without a DOM node. Where no canvas is available (jsdom), only
    // the forms toHexColor handles above are recognised.
    const ctx = colorContext();
    if (!ctx) return null;

    const probe = (sentinel) => {
        ctx.fillStyle = sentinel;
        ctx.fillStyle = value;
        return ctx.fillStyle;
    };
    const first = probe('#010203');
    return first === probe('#040506') ? toHexColor(first) || null : null;
}

let _colorContext;

function colorContext() {
    if (_colorContext === undefined) {
        try {
            _colorContext = document.createElement('canvas').getContext('2d') || null;
        } catch (e) {
            _colorContext = null;
        }
    }
    return _colorContext;
}

/**
 * Which typed control a property can offer: 'color' and 'number' come from the
 * property name first (a `-color` property is a colour however it is written),
 * then from the value's own type. null means only the JSON textarea fits.
 */
export function uiControlKind(property, value) {
    if (/-color$/.test(property)) return 'color';
    if (/-(radius|width|size)$/.test(property)) return 'number';
    if (typeof value === 'string' && cssColorToHex(value)) return 'color';
    if (typeof value === 'number' && Number.isFinite(value)) return 'number';
    if (/-opacity$/.test(property)) return 'number';
    return null;
}

/** The property name without its variant prefix ("overlay/line-color"). */
function propertyName(key) {
    const slash = key.indexOf('/');
    return slash > 0 ? key.substring(slash + 1) : key;
}

function sectionFor(key) {
    const property = propertyName(key);
    return lookupPropertyKind(property) ? guessPropertyKind(property) : 'other';
}

/** The literal hiding inside an expression, used to seed a UI control. */
function literalOf(value) {
    const literal = styleLiteral(value);
    return literal !== undefined ? literal : resolveValue(value, null);
}

/**
 * A short value stays on one line - `[2, 2]` or `["get","name"]` read better
 * whole than spread over three lines of a small textarea; anything longer is
 * indented so its structure is visible.
 */
function formatJson(value) {
    const compact = JSON.stringify(value === undefined ? null : value);
    return compact.length <= 60 ? compact : JSON.stringify(value, null, 1);
}

function el(tag, className, props = {}) {
    const node = Object.assign(document.createElement(tag), props);
    if (className) node.className = className;
    return node;
}

export class StylePropertyEditor {
    constructor({ onChange } = {}) {
        this._onChange = onChange || (() => {});
        this._style = {};
        this._layerType = null;
        // Per-property control choice ('ui' | 'json'), kept across re-renders so
        // a row the user switched stays switched.
        this._modes = new Map();
        // Properties added from the picker that have no valid value yet, so are
        // shown as a row but not yet part of the style.
        this._drafts = new Set();

        injectStyles();
        this.element = el('div', 'spe-root');
    }

    /**
     * (Re)build the controls for a layer config's style. Per-row control
     * choices are kept by default, so reseeding from a raw-JSON edit doesn't
     * snap a row the user switched to JSON back to its picker;
     * `resetControlModes` drops them, for when the whole style is replaced.
     */
    setLayer(layer, { resetControlModes = false } = {}) {
        this._layerType = layer?.type || null;
        this._style = { ...(layer?.style || {}) };
        this._drafts.clear();
        if (resetControlModes) this._modes.clear();
        this.render();
    }

    /** The edited style, as it should be written back to the layer config. */
    getStyle() {
        return { ...this._style };
    }

    render() {
        this.element.textContent = '';

        const colors = this._collectUniqueColors();
        if (colors.length) {
            this.element.appendChild(this._buildColorsSection(colors));
        }

        const keys = [...Object.keys(this._style), ...this._drafts];
        const sections = { paint: [], layout: [], other: [] };
        keys.forEach(key => sections[sectionFor(key)].push(key));

        if (!keys.length) {
            this.element.appendChild(el('div', 'spe-empty', {
                textContent: 'No style properties set. Add one below to start styling this layer.'
            }));
        }

        Object.entries(sections).forEach(([kind, sectionKeys]) => {
            if (!sectionKeys.length) return;
            this.element.appendChild(el('div', 'spe-section', { textContent: SECTION_LABELS[kind] }));
            sectionKeys.forEach(key => this.element.appendChild(this._buildRow(key)));
        });

        this.element.appendChild(this._buildAddControl());
        return this.element;
    }

    /**
     * Every distinct colour used anywhere in the style, including inside
     * expressions (a `match`/`case` branch, an `interpolate` stop). Grouped by
     * resolved hex + alpha, so "#ff0000" and "red" collapse into one swatch but
     * a colour with a different alpha gets its own.
     */
    _collectUniqueColors() {
        const groups = new Map();
        Object.entries(this._style).forEach(([key, value]) => {
            collectColorLeaves(value).forEach(raw => {
                const hex = cssColorToHex(raw);
                if (!hex) return;
                const alpha = colorAlpha(raw);
                const groupKey = `${hex}@${alpha === undefined ? '' : alpha}`;
                if (!groups.has(groupKey)) {
                    groups.set(groupKey, { hex, alpha, raw, properties: new Set() });
                }
                groups.get(groupKey).properties.add(propertyName(key));
            });
        });
        return [...groups.values()];
    }

    /**
     * A mini swatch gallery above the property rows: one swatch per unique
     * colour in the style. Editing a swatch rewrites every occurrence of that
     * exact colour, across every property and expression branch that uses it.
     */
    _buildColorsSection(colors) {
        const wrap = el('div', 'spe-colors-section');
        wrap.appendChild(el('div', 'spe-section', { textContent: 'Colors' }));

        const gallery = el('div', 'spe-color-gallery');
        colors.forEach(({ hex, alpha, raw, properties }) => {
            const propList = [...properties].join(', ');
            const swatch = el('input', 'spe-color-swatch', {
                type: 'color',
                value: hex,
                title: `${raw} — used in ${propList}`
            });
            swatch.addEventListener('input', () => {
                this._replaceColor(hex, alpha, swatch.value);
            });
            gallery.appendChild(swatch);
        });

        wrap.appendChild(gallery);
        return wrap;
    }

    /** Rewrite every occurrence of one colour (hex + alpha) across the style. */
    _replaceColor(hex, alpha, newHex) {
        const changedKeys = [];
        Object.keys(this._style).forEach(key => {
            const next = replaceColorLeaves(this._style[key], hex, alpha, newHex);
            if (next !== this._style[key]) {
                this._style[key] = next;
                changedKeys.push(key);
            }
        });
        if (!changedKeys.length) return;

        this.render();
        this._onChange(this.getStyle(), { property: changedKeys[0], colorReplaced: true });
    }

    _buildRow(key) {
        const property = propertyName(key);
        const value = this._style[key];
        const controlKind = uiControlKind(property, value);
        const mode = this._resolveMode(key, controlKind, value);

        const row = el('div', 'spe-row');
        const head = el('div', 'spe-head');
        // The section header already says paint or layout, so the row only
        // carries the property key itself.
        head.appendChild(el('code', 'spe-name', { textContent: key, title: formatLabel(property) }));
        head.appendChild(el('span', 'spe-spacer'));

        if (controlKind) {
            const toggle = el('button', 'spe-btn', {
                type: 'button',
                textContent: mode === 'json' ? controlKind : '{ }',
                title: mode === 'json' ? `Edit as ${controlKind}` : 'Edit as JSON'
            });
            toggle.addEventListener('click', () => {
                this._modes.set(key, mode === 'json' ? 'ui' : 'json');
                this.render();
            });
            head.appendChild(toggle);
        }

        const remove = el('button', 'spe-btn spe-remove', { type: 'button', textContent: '✕', title: 'Remove property' });
        remove.addEventListener('click', () => this._removeProperty(key));
        head.appendChild(remove);

        row.appendChild(head);

        const error = el('div', 'spe-error');
        row.appendChild(mode === 'json'
            ? this._buildJsonControl(key, value, error)
            : this._buildTypedControl(key, property, controlKind, value, error));
        row.appendChild(error);
        return row;
    }

    _resolveMode(key, controlKind, value) {
        if (!controlKind) return 'json';
        if (this._modes.has(key)) return this._modes.get(key);
        // An expression opens as JSON so it stays visible and intact; a plain
        // literal opens in its typed control.
        const isLiteral = typeof value === 'string' || typeof value === 'number';
        return isLiteral ? 'ui' : 'json';
    }

    _buildJsonControl(key, value, error) {
        const wrap = el('div', 'spe-control');
        const textarea = el('textarea', 'spe-input spe-json', {
            spellcheck: false,
            value: this._drafts.has(key) && value === undefined ? '' : formatJson(value),
            placeholder: 'JSON value or Mapbox expression'
        });

        textarea.addEventListener('input', () => {
            const text = textarea.value.trim();
            if (!text) {
                this._setError(error, textarea, 'Enter a JSON value, e.g. "#ff0000", 2 or ["get","name"]');
                return;
            }
            try {
                const parsed = JSON.parse(text);
                this._clearError(error, textarea);
                this._setValue(key, parsed, { rerender: false });
            } catch (e) {
                this._setError(error, textarea, `Invalid JSON: ${e.message}`);
            }
        });

        wrap.appendChild(textarea);
        return wrap;
    }

    _buildTypedControl(key, property, controlKind, value, error) {
        const wrap = el('div', 'spe-control spe-control-inline');
        const literal = typeof value === 'string' || typeof value === 'number' ? value : literalOf(value);
        const fromExpression = Array.isArray(value) || (value && typeof value === 'object');

        if (controlKind === 'color') {
            const hex = cssColorToHex(literal) || '#3b82f6';
            const alpha = colorAlpha(typeof literal === 'string' ? literal : '');
            const swatch = el('input', 'spe-swatch', { type: 'color', value: hex });
            const text = el('input', 'spe-input spe-text', {
                type: 'text',
                value: typeof literal === 'string' ? literal : hex,
                placeholder: '#rrggbb, rgba(...) or a CSS colour name'
            });

            swatch.addEventListener('input', () => {
                // A colour that carried its own alpha keeps it, so picking a new
                // hue doesn't silently make a half-transparent fill opaque.
                const next = alpha !== undefined && alpha < 1 ? rgbaFromHex(swatch.value, alpha) : swatch.value;
                text.value = next;
                this._clearError(error, text);
                this._setValue(key, next, { rerender: false });
            });

            text.addEventListener('input', () => {
                const parsed = cssColorToHex(text.value);
                if (!parsed) {
                    this._setError(error, text, 'Not a colour Mapbox understands');
                    return;
                }
                swatch.value = parsed;
                this._clearError(error, text);
                this._setValue(key, text.value.trim(), { rerender: false });
            });

            wrap.appendChild(swatch);
            wrap.appendChild(text);
        } else {
            const { min, max, step } = numericRange(property);
            const input = el('input', 'spe-input spe-number', {
                type: 'number',
                value: Number.isFinite(literal) ? literal : '',
                step: String(step ?? 'any')
            });
            if (min !== undefined) input.min = String(min);
            if (max !== undefined) input.max = String(max);

            input.addEventListener('input', () => {
                const parsed = parseFloat(input.value);
                if (!Number.isFinite(parsed)) {
                    this._setError(error, input, 'Enter a number');
                    return;
                }
                if ((min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
                    this._setError(error, input, `Enter a number between ${min} and ${max}`);
                    return;
                }
                this._clearError(error, input);
                this._setValue(key, parsed, { rerender: false });
            });

            wrap.appendChild(input);
        }

        if (fromExpression) {
            wrap.appendChild(el('span', 'spe-note', {
                textContent: 'seeded from the expression — editing replaces it'
            }));
        }
        return wrap;
    }

    _buildAddControl() {
        const wrap = el('div', 'spe-add');
        const select = el('select', 'spe-input spe-select');
        select.appendChild(el('option', null, { value: '', textContent: '+ Add style property…' }));

        const used = new Set([...Object.keys(this._style), ...this._drafts].map(propertyName));
        getSpecProperties(this._layerType)
            .filter(({ property }) => !used.has(property))
            .forEach(({ property, kind }) => {
                select.appendChild(el('option', null, { value: property, textContent: `${property} (${kind})` }));
            });

        select.addEventListener('change', () => {
            const property = select.value;
            if (!property) return;
            select.value = '';

            const controlKind = uiControlKind(property, undefined);
            if (controlKind) {
                this._setValue(property, NEW_PROPERTY_DEFAULTS[controlKind]);
            } else {
                // Nothing sensible to default to - show an empty JSON row and
                // leave the style alone until it parses.
                this._drafts.add(property);
                this._modes.set(property, 'json');
                this.render();
            }
        });

        wrap.appendChild(select);
        return wrap;
    }

    _setValue(key, value, { rerender = true } = {}) {
        this._style[key] = value;
        this._drafts.delete(key);
        if (rerender) this.render();
        this._onChange(this.getStyle(), { property: key });
    }

    _removeProperty(key) {
        delete this._style[key];
        this._drafts.delete(key);
        this._modes.delete(key);
        this.render();
        this._onChange(this.getStyle(), { removed: [key] });
    }

    _setError(error, input, message) {
        error.textContent = message;
        error.style.display = 'block';
        input.classList.add('spe-invalid');
    }

    _clearError(error, input) {
        error.textContent = '';
        error.style.display = 'none';
        input.classList.remove('spe-invalid');
    }
}

function rgbaFromHex(hex, alpha) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

const ZOOM_STOP_OPS = new Set(['interpolate', 'interpolate-hcl', 'interpolate-lab']);

/**
 * Visit every position in a style value that can hold a literal output colour
 * - not a `match` label or a `case`/interpolation/step condition or stop
 * input, which can coincidentally read like a colour name ("red" as a
 * category value) without being one. Indices mirror the same expression
 * shapes layer-style-utils.js's resolveValue()/extractBranches() already
 * assume for `match`, `case`, `interpolate` and `step`.
 */
function eachColorPosition(value, visitIndex) {
    if (!Array.isArray(value) || value.length === 0) return;
    const op = value[0];

    if (op === 'match') {
        // ['match', input, label1, output1, label2, output2, ..., fallback]
        for (let i = 2; i < value.length - 1; i += 2) visitIndex(value, i + 1);
        visitIndex(value, value.length - 1);
    } else if (op === 'case') {
        // ['case', cond1, output1, cond2, output2, ..., fallback]
        for (let i = 2; i < value.length - 1; i += 2) visitIndex(value, i);
        visitIndex(value, value.length - 1);
    } else if (ZOOM_STOP_OPS.has(op)) {
        // ['interpolate', type, input, stop1, output1, stop2, output2, ...]
        for (let i = 3; i < value.length - 1; i += 2) visitIndex(value, i + 1);
    } else if (op === 'step') {
        // ['step', input, output0, stop1, output1, stop2, output2, ...]
        if (value.length > 2) visitIndex(value, 2);
        for (let i = 3; i < value.length - 1; i += 2) visitIndex(value, i + 1);
    } else if (op === 'coalesce' || op === 'to-color') {
        for (let i = 1; i < value.length; i++) visitIndex(value, i);
    } else if (op === 'literal') {
        if (typeof value[1] === 'string') visitIndex(value, 1);
    }
    // Any other operator (get, boolean expressions, arithmetic, concat, …)
    // carries no literal colour among its arguments worth surfacing here.
}

/** Every colour-position leaf in a style value, including nested expressions. */
function collectColorLeaves(value, out = []) {
    if (typeof value === 'string') {
        out.push(value);
        return out;
    }
    if (Array.isArray(value)) {
        eachColorPosition(value, (arr, i) => collectColorLeaves(arr[i], out));
    }
    return out;
}

function sameAlpha(a, b) {
    if (a === undefined && b === undefined) return true;
    if (a === undefined || b === undefined) return false;
    return Math.abs(a - b) < 0.001;
}

/** Replace every colour-position leaf matching (hex, alpha), preserving structure. */
function replaceColorLeaves(value, hex, alpha, newHex) {
    if (typeof value === 'string') {
        if (cssColorToHex(value) === hex && sameAlpha(colorAlpha(value), alpha)) {
            return alpha !== undefined ? rgbaFromHex(newHex, alpha) : newHex;
        }
        return value;
    }
    if (!Array.isArray(value) || value.length === 0) return value;

    const next = value.slice();
    let changed = false;
    eachColorPosition(value, (arr, i) => {
        const replaced = replaceColorLeaves(arr[i], hex, alpha, newHex);
        if (replaced !== arr[i]) {
            next[i] = replaced;
            changed = true;
        }
    });
    return changed ? next : value;
}

const STYLESHEET_ID = 'style-property-editor-css';

function injectStyles() {
    if (document.getElementById(STYLESHEET_ID)) return;
    const style = el('style', null, { id: STYLESHEET_ID, textContent: `
        .spe-section { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
            color: #9ca3af; margin: 10px 0 4px; }
        .spe-colors-section .spe-section { margin-top: 0; }
        .spe-color-gallery { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .spe-color-swatch { width: 28px; height: 28px; padding: 0; border: 1px solid #374151; border-radius: 6px;
            background: #0b1220; cursor: pointer; }
        .spe-color-swatch:hover { border-color: #6b7280; }
        .spe-row { background: #111827; border: 1px solid #374151; border-radius: 8px; padding: 6px 8px; margin-bottom: 6px; }
        .spe-head { display: flex; align-items: center; gap: 6px; }
        .spe-name { font-family: 'Courier New', monospace; font-size: 11px; color: #e5e7eb; }
        .spe-spacer { flex: 1; }
        .spe-btn { font-size: 10px; font-family: 'Courier New', monospace; color: #9ca3af; background: transparent;
            border: 1px solid #374151; border-radius: 4px; padding: 1px 5px; cursor: pointer; }
        .spe-btn:hover { color: #fff; border-color: #6b7280; }
        .spe-remove:hover { color: #fff; background: #dc2626; border-color: #dc2626; }
        .spe-control { margin-top: 5px; }
        .spe-control-inline { display: flex; align-items: center; gap: 6px; }
        .spe-input { background: #0b1220; border: 1px solid #374151; color: #f3f4f6; border-radius: 6px;
            padding: 4px 6px; font-size: 12px; width: 100%; }
        .spe-input:focus { outline: none; border-color: #3b82f6; }
        .spe-invalid { border-color: #ef4444; }
        .spe-json { min-height: 48px; font-family: 'Courier New', monospace; resize: vertical; }
        .spe-swatch { width: 34px; height: 26px; padding: 0; border: 1px solid #374151; border-radius: 6px;
            background: #0b1220; flex-shrink: 0; cursor: pointer; }
        .spe-number { max-width: 120px; }
        .spe-note { font-size: 10px; color: #9ca3af; font-style: italic; }
        .spe-error { display: none; font-size: 10px; color: #f87171; margin-top: 3px; }
        .spe-empty { font-size: 12px; color: #9ca3af; font-style: italic; }
        .spe-add { margin-top: 8px; }
    ` });
    document.head.appendChild(style);
}

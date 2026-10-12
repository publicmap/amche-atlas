/**
 * SymbologyEditor - one style property (a colour or a number) styled as a
 * single value, by category, or by graduated numeric class, with optional
 * hover / selected overrides and a fallback for features that match nothing.
 *
 * Reusable and DOM-only: the host (js/style-property-editor.js, used by
 * map-information.html and map-creator.html) supplies the field names and a
 * way to sample feature properties, and receives the finished style value
 * through `onChange(value)`. The Mapbox expressions themselves are built and
 * parsed in js/style-expressions.js.
 */

import {
    parseSymbology, serializeSymbology, uniqueValues, numericValues, classBreaks,
    COLOR_RAMPS, CATEGORICAL_PALETTES, sampleRamp, sampleNumbers, paletteColor
} from './style-expressions.js';
import { toHexColor, colorAlpha } from './layer-style-utils.js';

const MODES = [['single', 'Single'], ['categorized', 'Categorized'], ['graduated', 'Graduated']];
const MAX_CATEGORIES = 40;
const SAMPLE_TTL_MS = 1500;
const FALLBACK_COLOR = '#9ca3af';
const STATE_DEFAULT_COLOR = '#ffff00';

function el(tag, className, props = {}) {
    const node = Object.assign(document.createElement(tag), props);
    if (className) node.className = className;
    return node;
}

function withAlpha(hex, original) {
    const alpha = colorAlpha(typeof original === 'string' ? original : '');
    if (alpha === undefined || alpha >= 1) return hex;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function option(value, text, selected) {
    return el('option', null, { value, textContent: text, selected: !!selected });
}

export class SymbologyEditor {
    /**
     * @param {Object} options
     * @param {string} options.property - Style property, e.g. 'fill-color'
     * @param {'color'|'number'} options.valueKind
     * @param {{min?:number,max?:number,step?:number|string}} [options.range] - Number bounds
     * @param {() => string[]} [options.getFields]
     * @param {() => Object[]} [options.getSamples] - Feature property objects
     * @param {boolean} [options.states] - Offer hover / selected overrides
     * @param {(value: *) => void} options.onChange
     */
    constructor({ property, valueKind, range = {}, getFields, getSamples, states = true, onChange }) {
        this.property = property;
        this.valueKind = valueKind;
        this.range = range;
        this._getFields = getFields || (() => []);
        this._getSamples = getSamples || (() => []);
        this._states = states;
        this._onChange = onChange || (() => {});
        this.model = { mode: 'single', single: valueKind === 'color' ? '#3b82f6' : 1 };
        this.ui = { palette: 'Tableau 10', ramp: 'Viridis', classes: 5, method: 'equal', from: 1, to: 10 };

        injectStyles();
        this.element = el('div', 'sym-root');
    }

    setValue(value) {
        const parsed = parseSymbology(value);
        this.model = parsed.mode === 'custom' ? this.model : parsed;
        if (this.model.mode === 'graduated' && this.model.fallback === undefined) {
            this.model.fallback = this.valueKind === 'color' ? FALLBACK_COLOR : 1;
        }
        if (parsed.mode === 'custom' && (typeof value === 'string' || typeof value === 'number')) {
            this.model = { mode: 'single', single: value };
        }
        this.render();
    }

    // -- data access -------------------------------------------------------

    // Sampling can mean querying every loaded map tile, and one render asks
    // several times - so reuse the result for a moment.
    _samples() {
        const now = Date.now();
        if (this._sampleCache && now - this._sampleCache.at < SAMPLE_TTL_MS) return this._sampleCache.data;
        let data = [];
        try { data = this._getSamples() || []; } catch (e) { data = []; }
        this._sampleCache = { at: now, data };
        return data;
    }

    _values(field) {
        return this._samples().map(properties => (properties ? properties[field] : undefined));
    }

    _isNumericField(field) {
        const values = this._values(field).filter(v => v !== null && v !== undefined && v !== '');
        return values.length > 0 && numericValues(values).length / values.length >= 0.8;
    }

    _fields() {
        const names = new Set(this._getFields());
        this._samples().slice(0, 50).forEach(p => Object.keys(p || {}).forEach(k => names.add(k)));
        return [...names];
    }

    // -- model transitions -------------------------------------------------

    _emit() {
        this._onChange(serializeSymbology(this.model), this.model);
    }

    _default() {
        return this.valueKind === 'color' ? FALLBACK_COLOR : (this.model.single ?? 1);
    }

    _setMode(mode) {
        const previous = this.model;
        const anchor = previous.single ?? previous.fallback ?? previous.outputs?.[0] ?? previous.categories?.[0]?.output;
        const keep = { hover: previous.hover, selected: previous.selected };
        const fields = this._fields();

        if (mode === 'single') {
            this.model = { mode, single: anchor ?? this._default(), ...keep };
        } else if (mode === 'categorized') {
            const field = previous.field || fields[0] || '';
            this.model = { mode, field, raw: false, categories: [], fallback: this._fallbackFrom(previous), ...keep };
            this._detectCategories();
        } else {
            const numeric = fields.find(f => this._isNumericField(f));
            const field = (previous.mode === 'graduated' && previous.field) || numeric || fields[0] || '';
            this.model = { mode, field, kind: 'step', breaks: [], outputs: [], fallback: this._fallbackFrom(previous), ...keep };
            this._classify();
        }
        this.render();
        this._emit();
    }

    _fallbackFrom(previous) {
        if (previous.fallback !== undefined) return previous.fallback;
        return this.valueKind === 'color' ? FALLBACK_COLOR : (previous.single ?? 1);
    }

    _detectCategories() {
        const { field } = this.model;
        const found = uniqueValues(this._values(field), MAX_CATEGORIES);
        const palette = CATEGORICAL_PALETTES[this.ui.palette];
        const numbers = sampleNumbers(this.ui.from, this.ui.to, Math.max(found.length, 1));
        this.model.categories = found.map((entry, i) => ({
            value: entry.value,
            count: entry.count,
            output: this.valueKind === 'color' ? paletteColor(palette, i) : numbers[i]
        }));
    }

    _classify() {
        const { field } = this.model;
        const kind = this.model.kind;
        const numbers = numericValues(this._values(field));
        const breaks = classBreaks(numbers, { classes: this.ui.classes, method: this.ui.method, kind });
        const count = kind === 'step' ? breaks.length + 1 : breaks.length;
        this.model.breaks = breaks;
        this.model.outputs = this.valueKind === 'color'
            ? sampleRamp(COLOR_RAMPS[this.ui.ramp], Math.max(count, 1))
            : sampleNumbers(this.ui.from, this.ui.to, Math.max(count, 1));
    }

    // -- controls ----------------------------------------------------------

    _valueControl(value, onInput) {
        if (this.valueKind === 'color') {
            const input = el('input', 'sym-swatch', { type: 'color', value: toHexColor(value) || FALLBACK_COLOR });
            input.addEventListener('input', () => onInput(withAlpha(input.value, value)));
            return input;
        }
        const { min, max, step } = this.range;
        const input = el('input', 'sym-input sym-number', { type: 'number', value: Number.isFinite(value) ? value : '', step: String(step ?? 'any') });
        if (min !== undefined) input.min = String(min);
        if (max !== undefined) input.max = String(max);
        input.addEventListener('input', () => {
            const parsed = parseFloat(input.value);
            if (Number.isFinite(parsed)) onInput(parsed);
        });
        return input;
    }

    _labelled(label, control, className = 'sym-field') {
        const wrap = el('label', className);
        wrap.appendChild(el('span', 'sym-label', { textContent: label }));
        wrap.appendChild(control);
        return wrap;
    }

    _select(choices, current, onSelect) {
        const select = el('select', 'sym-input');
        choices.forEach(([value, text]) => select.appendChild(option(value, text, value === current)));
        select.addEventListener('change', () => onSelect(select.value));
        return select;
    }

    _button(text, onClick, title = '') {
        const button = el('button', 'sym-btn', { type: 'button', textContent: text, title });
        button.addEventListener('click', onClick);
        return button;
    }

    _fieldSelect(numericOnly) {
        const fields = this._fields();
        const sampled = this._samples().length > 0;
        const usable = numericOnly && sampled ? fields.filter(f => this._isNumericField(f)) : fields;
        const names = usable.includes(this.model.field) || !this.model.field ? usable : [this.model.field, ...usable];
        if (!names.length) {
            const input = el('input', 'sym-input', { type: 'text', value: this.model.field || '', placeholder: 'field name' });
            input.addEventListener('change', () => { this.model.field = input.value.trim(); this._emit(); });
            return this._labelled('Field', input);
        }
        const choices = [['', 'Select a field…'], ...names.map(n => [n, n])];
        return this._labelled('Field', this._select(choices, this.model.field || '', (field) => {
            this.model.field = field;
            if (this.model.mode === 'categorized') this._detectCategories(); else this._classify();
            this.render();
            this._emit();
        }));
    }

    // -- rendering ---------------------------------------------------------

    render() {
        this.element.textContent = '';
        this.element.appendChild(this._buildModeTabs());

        const { mode } = this.model;
        if (mode === 'single') this.element.appendChild(this._buildSingle());
        if (mode === 'categorized') this.element.appendChild(this._buildCategorized());
        if (mode === 'graduated') this.element.appendChild(this._buildGraduated());
        if (this._states) this.element.appendChild(this._buildStates());
    }

    _buildModeTabs() {
        const tabs = el('div', 'sym-tabs');
        MODES.forEach(([mode, text]) => {
            const tab = el('button', `sym-tab${this.model.mode === mode ? ' sym-tab-active' : ''}`, { type: 'button', textContent: text });
            tab.addEventListener('click', () => { if (this.model.mode !== mode) this._setMode(mode); });
            tabs.appendChild(tab);
        });
        return tabs;
    }

    _buildSingle() {
        const wrap = el('div', 'sym-body');
        wrap.appendChild(this._labelled('Value', this._valueControl(this.model.single, (value) => {
            this.model.single = value;
            this._emit();
        })));
        return wrap;
    }

    _buildFallback(label) {
        const wrap = el('div', 'sym-fallback');
        wrap.appendChild(this._labelled(label, this._valueControl(this.model.fallback, (value) => {
            this.model.fallback = value;
            this._emit();
        })));
        return wrap;
    }

    _buildCategorized() {
        const wrap = el('div', 'sym-body');
        wrap.appendChild(this._fieldSelect(false));

        const bar = el('div', 'sym-bar');
        if (this.valueKind === 'color') {
            bar.appendChild(this._labelled('Palette', this._select(
                Object.keys(CATEGORICAL_PALETTES).map(n => [n, n]), this.ui.palette, (name) => { this.ui.palette = name; }
            )));
        } else {
            bar.appendChild(this._labelled('From', this._rangeInput('from')));
            bar.appendChild(this._labelled('To', this._rangeInput('to')));
        }
        bar.appendChild(this._button('Detect values', () => {
            this._detectCategories();
            this.render();
            this._emit();
        }, 'Fill the table with the distinct values found in the data'));
        wrap.appendChild(bar);

        const samples = this._samples().length;
        if (!samples) {
            wrap.appendChild(el('div', 'sym-hint', { textContent: 'No feature data is loaded yet, so values can’t be detected. Add categories by hand, or load the layer on the map first.' }));
        }

        const list = el('div', 'sym-list');
        this.model.categories.forEach((category, index) => list.appendChild(this._buildCategoryRow(category, index)));
        wrap.appendChild(list);

        wrap.appendChild(this._button('+ Add category', () => {
            const palette = CATEGORICAL_PALETTES[this.ui.palette];
            this.model.categories.push({ value: '', output: this.valueKind === 'color' ? paletteColor(palette, this.model.categories.length) : this._default() });
            this.render();
        }));
        wrap.appendChild(this._buildFallback('Other values'));
        return wrap;
    }

    _rangeInput(key) {
        const input = el('input', 'sym-input sym-number', { type: 'number', value: this.ui[key], step: 'any' });
        input.addEventListener('input', () => {
            const parsed = parseFloat(input.value);
            if (Number.isFinite(parsed)) this.ui[key] = parsed;
        });
        return input;
    }

    _buildCategoryRow(category, index) {
        const row = el('div', 'sym-row');
        row.appendChild(this._valueControl(category.output, (value) => { category.output = value; this._emit(); }));

        const isGroup = Array.isArray(category.value);
        const input = el('input', 'sym-input sym-grow', {
            type: 'text', value: isGroup ? category.value.join(', ') : category.value, placeholder: 'value', disabled: isGroup
        });
        input.addEventListener('input', () => { category.value = input.value; this._emit(); });
        row.appendChild(input);

        if (category.count) row.appendChild(el('span', 'sym-count', { textContent: category.count.toLocaleString(), title: 'Features with this value' }));
        row.appendChild(this._button('✕', () => {
            this.model.categories.splice(index, 1);
            this.render();
            this._emit();
        }, 'Remove category'));
        return row;
    }

    _buildGraduated() {
        const wrap = el('div', 'sym-body');
        wrap.appendChild(this._fieldSelect(true));

        const samples = this._samples().length;
        if (samples && this.model.field && !this._isNumericField(this.model.field)) {
            wrap.appendChild(el('div', 'sym-hint sym-warn', { textContent: `“${this.model.field}” doesn’t look numeric — graduated styling needs number values.` }));
        } else if (!samples) {
            wrap.appendChild(el('div', 'sym-hint', { textContent: 'No feature data is loaded yet, so classes can’t be calculated. Enter breaks by hand, or load the layer on the map first.' }));
        }

        const bar = el('div', 'sym-bar');
        bar.appendChild(this._labelled('Type', this._select(
            [['step', 'Classes'], ['interpolate', 'Continuous']], this.model.kind, (kind) => {
                this.model.kind = kind;
                this._classify();
                this.render();
                this._emit();
            }
        )));
        const classes = el('input', 'sym-input sym-number', { type: 'number', min: '1', max: '12', value: this.ui.classes });
        classes.addEventListener('input', () => {
            const parsed = parseInt(classes.value, 10);
            if (parsed >= 1 && parsed <= 12) this.ui.classes = parsed;
        });
        bar.appendChild(this._labelled(this.model.kind === 'step' ? 'Classes' : 'Stops', classes));
        bar.appendChild(this._labelled('Method', this._select(
            [['equal', 'Equal interval'], ['quantile', 'Quantile']], this.ui.method, (method) => { this.ui.method = method; }
        )));
        if (this.valueKind === 'color') {
            bar.appendChild(this._labelled('Ramp', this._select(
                Object.keys(COLOR_RAMPS).map(n => [n, n]), this.ui.ramp, (name) => { this.ui.ramp = name; }
            )));
        } else {
            bar.appendChild(this._labelled('From', this._rangeInput('from')));
            bar.appendChild(this._labelled('To', this._rangeInput('to')));
        }
        bar.appendChild(this._button('Classify', () => {
            this._classify();
            this.render();
            this._emit();
        }, 'Calculate breaks from the data'));
        wrap.appendChild(bar);

        const list = el('div', 'sym-list');
        this.model.outputs.forEach((output, index) => list.appendChild(this._buildClassRow(output, index)));
        wrap.appendChild(list);

        wrap.appendChild(this._button('+ Add class', () => this._addClass()));
        wrap.appendChild(this._buildFallback('No value / non-numeric'));
        return wrap;
    }

    _buildClassRow(output, index) {
        const { kind, breaks } = this.model;
        const row = el('div', 'sym-row');
        row.appendChild(this._valueControl(output, (value) => { this.model.outputs[index] = value; this._emit(); }));

        const breakIndex = kind === 'step' ? index - 1 : index;
        if (breakIndex < 0) {
            row.appendChild(el('span', 'sym-range sym-grow', { textContent: breaks.length ? `below ${breaks[0]}` : 'all values' }));
        } else {
            const input = el('input', 'sym-input sym-number sym-grow', { type: 'number', step: 'any', value: breaks[breakIndex] });
            input.addEventListener('input', () => {
                const parsed = parseFloat(input.value);
                if (Number.isFinite(parsed)) { this.model.breaks[breakIndex] = parsed; this._emit(); }
            });
            row.appendChild(el('span', 'sym-range', { textContent: kind === 'step' ? 'from' : 'at' }));
            row.appendChild(input);
        }

        row.appendChild(this._button('✕', () => {
            const removeBreak = Math.max(0, breakIndex);
            if (this.model.outputs.length <= 1) return;
            this.model.outputs.splice(index, 1);
            this.model.breaks.splice(removeBreak, 1);
            this.render();
            this._emit();
        }, 'Remove class'));
        return row;
    }

    _addClass() {
        const { breaks, outputs } = this.model;
        const last = breaks.length ? breaks[breaks.length - 1] : 0;
        const previous = breaks.length > 1 ? last - breaks[breaks.length - 2] : 1;
        breaks.push(Math.round((last + previous) * 1000) / 1000);
        outputs.push(outputs[outputs.length - 1] ?? this._default());
        this.render();
        this._emit();
    }

    _buildStates() {
        const wrap = el('div', 'sym-states');
        wrap.appendChild(el('div', 'sym-label', { textContent: 'Interaction states' }));
        [['hover', 'Hover'], ['selected', 'Selected']].forEach(([name, label]) => {
            const row = el('div', 'sym-row');
            const enabled = this.model[name] !== undefined;
            const toggle = el('input', null, { type: 'checkbox', checked: enabled });
            toggle.addEventListener('change', () => {
                this.model[name] = toggle.checked ? this._stateDefault(name) : undefined;
                this.render();
                this._emit();
            });
            row.appendChild(el('label', 'sym-check')).append(toggle, ` ${label}`);
            if (enabled) {
                row.appendChild(this._valueControl(this.model[name], (value) => { this.model[name] = value; this._emit(); }));
            } else {
                row.appendChild(el('span', 'sym-hint', { textContent: 'layer default' }));
            }
            wrap.appendChild(row);
        });
        return wrap;
    }

    _stateDefault(name) {
        if (this.valueKind === 'color') return STATE_DEFAULT_COLOR;
        const base = this.model.single ?? this.model.outputs?.[0] ?? this.model.categories?.[0]?.output ?? 1;
        return Math.round(base * (name === 'hover' ? 1.5 : 2) * 100) / 100;
    }
}

const STYLESHEET_ID = 'symbology-editor-css';

function injectStyles() {
    if (document.getElementById(STYLESHEET_ID)) return;
    document.head.appendChild(el('style', null, { id: STYLESHEET_ID, textContent: `
        .sym-root { margin-top: 6px; }
        .sym-tabs { display: flex; gap: 2px; background: #0b1220; border: 1px solid #374151; border-radius: 6px; padding: 2px; }
        .sym-tab { flex: 1; font-size: 11px; color: #9ca3af; background: transparent; border: 0; border-radius: 4px; padding: 3px 6px; cursor: pointer; }
        .sym-tab:hover { color: #fff; }
        .sym-tab-active { background: #2563eb; color: #fff; }
        .sym-body { margin-top: 8px; }
        .sym-bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 6px; margin: 6px 0; }
        .sym-field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .sym-label { font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #9ca3af; }
        .sym-input { background: #0b1220; border: 1px solid #374151; color: #f3f4f6; border-radius: 6px; padding: 3px 6px; font-size: 12px; min-width: 0; }
        .sym-input:focus { outline: none; border-color: #3b82f6; }
        .sym-input:disabled { color: #9ca3af; }
        .sym-number { width: 72px; }
        .sym-grow { flex: 1; width: auto; }
        .sym-swatch { width: 30px; height: 24px; padding: 0; border: 1px solid #374151; border-radius: 5px; background: #0b1220; cursor: pointer; flex-shrink: 0; }
        .sym-btn { font-size: 11px; color: #d1d5db; background: #1f2937; border: 1px solid #374151; border-radius: 5px; padding: 3px 8px; cursor: pointer; }
        .sym-btn:hover { color: #fff; border-color: #6b7280; }
        .sym-list { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; max-height: 260px; overflow-y: auto; }
        .sym-row { display: flex; align-items: center; gap: 6px; }
        .sym-count { font-size: 10px; color: #9ca3af; min-width: 28px; text-align: right; }
        .sym-range { font-size: 11px; color: #9ca3af; white-space: nowrap; }
        .sym-hint { font-size: 11px; color: #9ca3af; font-style: italic; margin: 4px 0; }
        .sym-warn { color: #fbbf24; font-style: normal; }
        .sym-fallback { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #374151; }
        .sym-states { margin-top: 10px; padding-top: 8px; border-top: 1px solid #374151; display: flex; flex-direction: column; gap: 4px; }
        .sym-check { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #e5e7eb; min-width: 84px; cursor: pointer; }
    ` }));
}

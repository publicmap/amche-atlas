/**
 * The style editor's Rules tab: the branches of every data-driven property,
 * consolidated into one table of rules (see js/style-rules.js).
 *
 * Each row shows the rule's conditions and a symbol drawn from every property
 * that applies to it. Opening a row lists those properties - each editable in
 * place, each a link to that property's own controls - and the conditions,
 * nested in the order they were nested in the expressions.
 */

import {
    analyzeRules, describeCondition, describeExpression, displayValue, setAtPath, collectFilters, LAYER_FILTER_KEY
} from './style-rules.js';
import { baseProperty, categoryOf, CATEGORY_LABELS } from './style-categories.js';
import { resolveStyleReferences, isStyleReference } from './style-references.js';
import { createValueControl } from './symbology-editor.js';
import { hatchPreview } from './hatch-editor.js';

const SYMBOL_SIZE = 34;

function el(tag, className, props = {}) {
    const node = Object.assign(document.createElement(tag), props);
    if (className) node.className = className;
    return node;
}

function valueKindOf(key) {
    const property = baseProperty(key);
    if (/-pattern$/.test(property)) return 'pattern';
    if (/-color$/.test(property)) return 'color';
    if (/-(radius|width|size|opacity|blur)$/.test(property)) return 'number';
    return null;
}

function rangeOf(key) {
    const property = baseProperty(key);
    if (/-opacity$/.test(property)) return { min: 0, max: 1, step: 0.05 };
    return { min: 0, max: 100, step: 0.5 };
}

const pick = (resolved, base) => {
    const key = Object.keys(resolved).find(k => baseProperty(k) === base);
    return key === undefined ? undefined : displayValue(resolved[key].value);
};

/**
 * The symbol a rule draws: the fill (and hatch) of an area with its outline, or
 * a line, or a circle, with a label mark - whichever of those the properties
 * applying to the rule describe.
 */
export function renderRuleSymbol(row, size = SYMBOL_SIZE) {
    const resolved = row.resolved;
    const fillColor = pick(resolved, 'fill-color');
    const pattern = pick(resolved, 'fill-pattern');
    const fillOpacity = pick(resolved, 'fill-opacity');
    const lineColor = pick(resolved, 'line-color');
    const lineWidth = pick(resolved, 'line-width');
    const lineOpacity = pick(resolved, 'line-opacity');
    const circleColor = pick(resolved, 'circle-color');
    const circleRadius = pick(resolved, 'circle-radius');
    const textColor = pick(resolved, 'text-color');
    const textField = pick(resolved, 'text-field') !== undefined || textColor !== undefined;

    const hasArea = fillColor !== undefined || pattern !== undefined;
    const hasLine = lineColor !== undefined || lineWidth !== undefined;
    const hasCircle = circleColor !== undefined || circleRadius !== undefined;

    const box = el('span', 'rv-symbol');
    box.style.width = `${size}px`;
    box.style.height = `${size}px`;

    if (hasArea) {
        const area = el('span', 'rv-area');
        if (typeof fillColor === 'string') area.style.background = fillColor;
        if (typeof fillOpacity === 'number') area.style.opacity = String(fillOpacity);
        box.appendChild(area);
        if (typeof pattern === 'string') {
            const hatch = hatchPreview(pattern, { size: size - 4, bare: true });
            hatch.classList.add('rv-hatch');
            box.appendChild(hatch);
        }
        if (hasLine && typeof lineWidth === 'number' && lineWidth > 0) {
            box.style.border = `${Math.min(3, Math.max(1, lineWidth))}px solid ${typeof lineColor === 'string' ? lineColor : '#000'}`;
        }
    } else if (hasLine) {
        const stroke = el('span', 'rv-stroke');
        stroke.style.background = typeof lineColor === 'string' ? lineColor : '#9ca3af';
        stroke.style.height = `${Math.min(8, Math.max(1, typeof lineWidth === 'number' ? lineWidth : 2))}px`;
        box.appendChild(stroke);
    } else if (hasCircle) {
        const dot = el('span', 'rv-dot');
        const diameter = Math.min(size - 6, Math.max(6, (typeof circleRadius === 'number' ? circleRadius : 4) * 2));
        dot.style.width = `${diameter}px`;
        dot.style.height = `${diameter}px`;
        if (typeof circleColor === 'string') dot.style.background = circleColor;
        const strokeColor = pick(resolved, 'circle-stroke-color');
        const strokeWidth = pick(resolved, 'circle-stroke-width');
        if (typeof strokeColor === 'string' && strokeWidth !== 0) dot.style.border = `1px solid ${strokeColor}`;
        box.appendChild(dot);
    }

    if (textField) {
        const mark = el('span', hasArea || hasLine || hasCircle ? 'rv-text rv-text-corner' : 'rv-text', { textContent: 'Aa' });
        if (typeof textColor === 'string') mark.style.color = textColor;
        box.appendChild(mark);
    }

    box.title = Object.keys(resolved).length ? 'What this rule draws' : 'Nothing is drawn for this rule';
    return box;
}

function isLiteral(value) {
    return typeof value === 'string' || typeof value === 'number';
}

export class RulesView {
    /**
     * @param {Object} options
     * @param {(key: string, value: *) => void} options.onEdit - A property's value was changed
     * @param {(key: string) => void} options.onNavigate - Open a property in its own tab
     * @param {(key: string, value: *) => void} options.onFilterEdit - A data filter was edited
     *        (`value` undefined removes it); `key` is LAYER_FILTER_KEY for the layer's own filter
     */
    constructor({ onEdit, onNavigate, onFilterEdit } = {}) {
        this._onEdit = onEdit || (() => {});
        this._onFilterEdit = onFilterEdit || (() => {});
        this._layerFilter = undefined;
        this._filterOpen = null;
        this._onNavigate = onNavigate || (() => {});
        this._style = {};
        this._open = null;
        this._analysis = null;
        injectStyles();
        this.element = el('div', 'rv-root');
    }

    /**
     * @param {Object} style
     * @param {{layerFilter?: *}} [context] - The layer config's own `filter`, when it has one
     */
    setStyle(style, context = {}) {
        this._style = style || {};
        if ('layerFilter' in context) this._layerFilter = context.layerFilter;
        this.render();
    }

    /** Open a rule's row, so the next render shows it expanded. */
    openRule(id) {
        this._open = id;
    }

    /** The number of data-driven rules (rows other than the fallback). */
    get ruleCount() {
        return analyzeRules(resolveStyleReferences(this._style)).ruleCount;
    }

    render() {
        this.element.textContent = '';
        const analysis = this._analysis = analyzeRules(resolveStyleReferences(this._style));

        this.element.appendChild(this._buildFilters(analysis));
        this.element.appendChild(el('div', 'rv-heading rv-heading-first', { textContent: 'Rules' }));
        this.element.appendChild(this._buildSummary(analysis));
        analysis.rows.forEach(row => this.element.appendChild(this._buildRow(row, analysis)));
        return this.element;
    }

    // -- data filters ---------------------------------------------------------

    _buildFilters(analysis) {
        const section = el('div', 'rv-filters');
        section.appendChild(el('div', 'rv-heading rv-heading-first', { textContent: 'Data filters' }));

        const filters = collectFilters(this._style, this._layerFilter);
        if (!filters.length) section.appendChild(el('div', 'rv-note', { textContent: 'No data filters: every feature is drawn.' }));
        filters.forEach(filter => section.appendChild(this._buildFilter(filter)));

        if (!filters.some(f => f.key === LAYER_FILTER_KEY)) {
            const add = el('button', 'rv-add', { type: 'button', textContent: '+ Add layer filter', title: 'Draw only the features that match a filter' });
            add.addEventListener('click', () => {
                const field = analysis.rows.flatMap(r => r.conditions.map(c => c.field).filter(Boolean))[0] || 'field';
                this._applyFilter(LAYER_FILTER_KEY, ['has', field]);
                this._filterOpen = LAYER_FILTER_KEY;
                this.render();
            });
            section.appendChild(add);
        }
        return section;
    }

    _applyFilter(key, value) {
        if (key === LAYER_FILTER_KEY) {
            this._layerFilter = value;
        } else if (value === undefined) {
            const { [key]: removed, ...rest } = this._style;
            this._style = rest;
        } else {
            this._style = { ...this._style, [key]: value };
        }
        this._onFilterEdit(key, value);
    }

    _buildFilter(filter) {
        const open = this._filterOpen === filter.key;
        const wrap = el('div', `rv-filter${open ? ' rv-open' : ''}`);
        wrap.dataset.filter = filter.key;

        const head = el('div', 'rv-filter-head');
        head.appendChild(el('span', 'rv-scope', { textContent: filter.scope }));
        const { text, complex } = describeExpression(filter.value);
        const summary = el(complex ? 'code' : 'span', complex ? 'rv-complex rv-filter-text' : 'rv-cond rv-filter-text', { textContent: text, title: complex ? 'Not a recognised pattern, shown as JSON' : text });
        head.appendChild(summary);

        const edit = el('button', 'rv-icon-btn', { type: 'button', textContent: open ? '▾' : '✎', title: open ? 'Close' : 'Edit this filter' });
        edit.addEventListener('click', () => { this._filterOpen = open ? null : filter.key; this.render(); });
        const remove = el('button', 'rv-icon-btn rv-remove', { type: 'button', textContent: '✕', title: 'Remove this filter' });
        remove.addEventListener('click', () => {
            this._applyFilter(filter.key, undefined);
            if (this._filterOpen === filter.key) this._filterOpen = null;
            this.render();
        });
        head.append(edit, remove);
        wrap.appendChild(head);

        if (open) wrap.appendChild(this._buildFilterEditor(filter, summary));
        return wrap;
    }

    _buildFilterEditor(filter, summary) {
        const body = el('div', 'rv-filter-body');
        body.appendChild(el('div', 'rv-note', {
            textContent: filter.kind === 'layer'
                ? 'Features that fail this filter are not drawn at all.'
                : 'The properties below apply only to features that match this filter.'
        }));
        if (filter.governs.length) {
            const chips = el('div', 'rv-chips');
            filter.governs.forEach(key => chips.appendChild(this._propertyLink(key, false)));
            body.appendChild(chips);
        }

        const area = el('textarea', 'rv-json', { spellcheck: false, rows: 4, value: JSON.stringify(filter.value, null, 1) });
        const error = el('div', 'rv-error');
        area.addEventListener('input', () => {
            try {
                const parsed = JSON.parse(area.value);
                if (!Array.isArray(parsed)) throw new Error('A filter is an array, e.g. ["==", ["get", "kind"], "park"]');
                error.textContent = '';
                area.classList.remove('rv-invalid');
                this._applyFilter(filter.key, parsed);
                const described = describeExpression(parsed);
                summary.textContent = described.text;
            } catch (e) {
                error.textContent = e.message;
                area.classList.add('rv-invalid');
            }
        });
        body.append(area, error);
        return body;
    }

    _buildSummary(analysis) {
        const fields = [...new Set(analysis.rows.flatMap(r => r.conditions.map(c => c.field).filter(Boolean)))];
        const text = analysis.ruleCount
            ? `${analysis.ruleCount} rule${analysis.ruleCount === 1 ? '' : 's'} from ${analysis.branchingKeys.length} data-driven propert${analysis.branchingKeys.length === 1 ? 'y' : 'ies'}${fields.length ? ` · by ${fields.join(', ')}` : ''}`
            : 'No data-driven rules. Every property uses a single value; switch one to “by data” to create rules.';
        return el('div', 'rv-summary', { textContent: text });
    }

    _ruleLabel(row, analysis) {
        const label = el('span', 'rv-label');
        if (row.isDefault) {
            label.textContent = analysis.ruleCount ? 'Everything else (fallback)' : 'All features';
            label.classList.add('rv-label-default');
            return label;
        }
        row.conditions.forEach((condition, index) => {
            if (index) label.appendChild(el('span', 'rv-sep', { textContent: '›' }));
            const { text, complex } = describeCondition(condition);
            label.appendChild(el(complex ? 'code' : 'span', complex ? 'rv-complex' : 'rv-cond', { textContent: text, title: complex ? 'Not a recognised pattern, shown as JSON' : '' }));
        });
        return label;
    }

    _buildRow(row, analysis) {
        const open = this._open === row.id;
        const wrap = el('div', `rv-row${open ? ' rv-open' : ''}`);
        wrap.dataset.rule = row.id;

        const head = el('button', 'rv-head', { type: 'button' });
        head.appendChild(renderRuleSymbol(row));
        head.appendChild(this._ruleLabel(row, analysis));
        head.appendChild(el('span', 'rv-count', {
            textContent: String(row.contributors.length),
            title: `${row.contributors.length} propert${row.contributors.length === 1 ? 'y' : 'ies'} define this rule`
        }));
        head.appendChild(el('span', 'rv-caret', { textContent: open ? '▾' : '▸' }));
        head.addEventListener('click', () => {
            this._open = open ? null : row.id;
            this.render();
        });
        wrap.appendChild(head);

        if (open) wrap.appendChild(this._buildDetail(row, analysis));
        return wrap;
    }

    _buildDetail(row, analysis) {
        const detail = el('div', 'rv-detail');

        if (!row.isDefault) {
            detail.appendChild(el('div', 'rv-heading', { textContent: row.conditions.length > 1 ? 'Nested conditions' : 'Condition' }));
            row.conditions.forEach((condition, index) => {
                const line = el('div', 'rv-condline');
                line.style.paddingLeft = `${index * 14}px`;
                const { text, complex } = describeCondition(condition);
                line.appendChild(el('span', 'rv-when', { textContent: index ? 'and when' : 'when' }));
                line.appendChild(el(complex ? 'code' : 'span', complex ? 'rv-complex' : 'rv-cond', { textContent: text }));
                detail.appendChild(line);
            });
        } else {
            detail.appendChild(el('div', 'rv-note', { textContent: 'The value each data-driven property uses for features that match none of the rules.' }));
        }

        detail.appendChild(el('div', 'rv-heading', { textContent: row.isDefault ? 'Fallback values' : 'Properties in this rule' }));
        if (!row.contributors.length) detail.appendChild(el('div', 'rv-note', { textContent: 'No property has a branch for this rule.' }));
        row.contributors.forEach(key => detail.appendChild(this._buildProperty(row, key)));

        if (row.shared.length) {
            detail.appendChild(el('div', 'rv-heading', { textContent: 'Applies to every rule' }));
            const chips = el('div', 'rv-chips');
            row.shared.forEach(key => chips.appendChild(this._propertyLink(key, true)));
            detail.appendChild(chips);
        }

        if (row.gated.length) {
            detail.appendChild(el('div', 'rv-heading', { textContent: 'Not applied to this rule' }));
            const chips = el('div', 'rv-chips rv-muted');
            row.gated.forEach(key => chips.appendChild(this._propertyLink(key, false)));
            detail.appendChild(chips);
        }
        return detail;
    }

    // A button naming a property; clicking it opens that property for editing.
    _propertyLink(key, withValue) {
        const link = el('button', 'rv-link', { type: 'button', title: `Edit ${key}` });
        link.appendChild(el('span', 'rv-link-name', { textContent: key }));
        if (withValue) {
            const value = displayValue(this._style[key]);
            if (typeof value === 'string' && valueKindOf(key) === 'color') {
                link.appendChild(el('span', 'rv-chip', { style: `background:${value}` }));
            } else if (value !== undefined && value !== null) {
                link.appendChild(el('span', 'rv-link-value', { textContent: String(value).slice(0, 24) }));
            }
        }
        link.addEventListener('click', () => this._onNavigate(key));
        return link;
    }

    _buildProperty(row, key) {
        const line = el('div', 'rv-prop');
        const category = categoryOf(key);
        const name = this._propertyLink(key, false);
        if (category) name.appendChild(el('span', 'rv-tag', { textContent: CATEGORY_LABELS[category] }));
        line.appendChild(name);

        const resolved = row.resolved[key];
        const raw = this._style[key];
        const kind = valueKindOf(key);
        const editable = kind && isLiteral(resolved.value) && !(typeof raw === 'string' && isStyleReference(raw));

        if (editable) {
            line.appendChild(createValueControl(kind, rangeOf(key), resolved.value, (next) => {
                const updated = setAtPath(raw, resolved.path, next);
                this._style = { ...this._style, [key]: updated };
                this._onEdit(key, updated);
                this._refreshSymbols();
            }));
        } else {
            const note = typeof raw === 'string' && isStyleReference(raw) ? `inherits ${raw}` : JSON.stringify(resolved.value);
            line.appendChild(el('code', 'rv-readonly', { textContent: String(note).slice(0, 60), title: String(note) }));
        }
        return line;
    }

    // After an inline edit: redraw every symbol (an edited fallback changes many
    // rows) without rebuilding the open row, which would close a colour picker.
    _refreshSymbols() {
        const analysis = this._analysis = analyzeRules(resolveStyleReferences(this._style));
        const wraps = [...this.element.querySelectorAll('.rv-row')];
        analysis.rows.forEach(row => {
            const wrap = wraps.find(w => w.dataset.rule === row.id);
            const current = wrap && wrap.querySelector('.rv-head .rv-symbol');
            if (current) current.replaceWith(renderRuleSymbol(row));
        });
    }
}

const STYLESHEET_ID = 'rules-view-css';

export function injectRuleViewStyles() {
    injectStyles();
}

function injectStyles() {
    if (document.getElementById(STYLESHEET_ID)) return;
    document.head.appendChild(el('style', null, { id: STYLESHEET_ID, textContent: `
        .rv-summary { font-size: 11px; color: #9ca3af; margin: 2px 0 8px; }
        .rv-heading-first { margin-top: 0; }
        .rv-filters { margin-bottom: 18px; }
        .rv-filter { background: #1f2937; border-radius: 4px; margin: 4px 0; }
        .rv-filter-head { display: flex; align-items: center; gap: 8px; padding: 5px 6px 5px 8px; }
        .rv-scope { font: 600 10px sans-serif; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; background: #1f2937;
            border: 0; border-radius: 3px; padding: 1px 6px; white-space: nowrap; }
        .rv-filter-text { flex: 1; min-width: 0; font-size: 12px; overflow-wrap: anywhere; }
        .rv-icon-btn { font-size: 11px; color: #9ca3af; background: transparent; border: 1px solid #374151; border-radius: 4px; padding: 1px 6px; cursor: pointer; }
        .rv-icon-btn:hover { color: #fff; border-color: #6b7280; }
        .rv-remove:hover { background: #dc2626; border-color: #dc2626; }
        .rv-filter-body { padding: 2px 8px 8px; }
        .rv-json { width: 100%; box-sizing: border-box; margin-top: 6px; background: #0b1220; border: 1px solid transparent; color: #f3f4f6;
            border-radius: 4px; padding: 4px 6px; font: 11px 'Courier New', monospace; resize: vertical; }
        .rv-json:focus { outline: none; border-color: #3b82f6; }
        .rv-invalid { border-color: #ef4444; }
        .rv-error { font-size: 10px; color: #f87171; min-height: 0; }
        .rv-add { font-size: 11px; color: #9ca3af; background: transparent; border: 1px dashed #4b5563; border-radius: 6px; padding: 3px 10px; cursor: pointer; margin-top: 4px; }
        .rv-add:hover { color: #fff; border-color: #6b7280; }
        .rv-row { border-radius: 4px; margin-bottom: 2px; }
        .rv-open { background: #1a2332; }
        .rv-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 8px 4px 4px; background: none; border: 0;
            color: #e5e7eb; cursor: pointer; text-align: left; }
        .rv-head:hover { background: #1f2937; border-radius: 4px; }
        .rv-symbol { position: relative; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
            box-sizing: border-box; overflow: hidden; border-radius: 3px; border: 0;
            background: #1f2937; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .1); }
        .rv-area { position: absolute; inset: 0; }
        .rv-hatch { position: absolute; inset: 0; margin: auto; }
        .rv-stroke { width: 80%; border-radius: 2px; }
        .rv-dot { border-radius: 50%; box-sizing: border-box; background: #3b82f6; }
        .rv-text { font: 700 11px sans-serif; color: #111827; }
        .rv-text-corner { position: absolute; right: 2px; bottom: 0; font-size: 9px; text-shadow: 0 0 2px #fff; }
        .rv-label { flex: 1; min-width: 0; font-size: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
        .rv-label-default { color: #9ca3af; font-style: italic; }
        .rv-sep { color: #6b7280; }
        .rv-cond { color: #f3f4f6; }
        .rv-complex { font-family: 'Courier New', monospace; font-size: 11px; color: #fbbf24; background: #0b1220; padding: 1px 4px; border-radius: 4px; word-break: break-all; }
        .rv-count { font-size: 10px; color: #9ca3af; background: #1f2937; border: 0; border-radius: 9px; padding: 0 6px; min-width: 18px; text-align: center; }
        .rv-caret { color: #6b7280; font-size: 11px; width: 10px; }
        .rv-detail { padding: 4px 10px 10px; }
        .rv-heading { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #9ca3af; margin: 8px 0 4px; }
        .rv-note { font-size: 11px; color: #9ca3af; font-style: italic; }
        .rv-condline { font-size: 12px; margin: 2px 0; display: flex; gap: 6px; align-items: baseline; }
        .rv-when { color: #6b7280; font-size: 11px; }
        .rv-prop { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
        .rv-prop .rv-link { flex: 1; min-width: 0; }
        .rv-chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .rv-muted { opacity: .55; }
        .rv-link { display: inline-flex; align-items: center; gap: 6px; padding: 2px 7px; font: 11px 'Courier New', monospace; color: #93c5fd;
            background: #0b1220; border: 1px solid #374151; border-radius: 5px; cursor: pointer; text-align: left; }
        .rv-link:hover { border-color: #60a5fa; color: #bfdbfe; }
        .rv-link-value { color: #9ca3af; }
        .rv-chip { width: 12px; height: 12px; border-radius: 3px; border: 1px solid #4b5563; }
        .rv-tag { font: 600 9px sans-serif; text-transform: uppercase; letter-spacing: .04em; color: #9ca3af; margin-left: auto; }
        .rv-readonly { font-size: 11px; color: #9ca3af; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    ` }));
}

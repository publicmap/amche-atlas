/**
 * A vector layer's legend, read from the same rules the style editor's Rules
 * tab shows (js/style-rules.js): one item per rule, drawn with every property
 * that applies to it - fill, hatch, outline, line, circle - so a data-driven
 * style reads the way it is drawn.
 *
 * Each item is titled by the value of the layer's `inspect.label` field when
 * the rule is about that field ("G1"), and carries the rule's data expression
 * beneath it ("use_zones = G1").
 *
 * Pointing at (or focusing) an item reports its rule to `onPreview`, so the map
 * can show just the features that rule draws until the pointer or focus leaves.
 */

import { analyzeRules, describeCondition } from './style-rules.js';
import { resolveStyleReferences } from './style-references.js';
import { renderRuleSymbol, injectRuleViewStyles } from './rules-view.js';

const MAX_ITEMS = 60;

function conditionFilter(condition) {
    if (condition.kind === 'match') {
        return ['==', ['to-string', JSON.parse(condition.inputSig)], condition.label];
    }
    if (condition.kind === 'range') {
        const input = ['to-number', JSON.parse(condition.inputSig)];
        const bounds = [];
        if (condition.from !== -Infinity) bounds.push(['>=', input, condition.from]);
        if (condition.to !== Infinity) bounds.push(['<', input, condition.to]);
        if (!bounds.length) return null;
        return bounds.length === 1 ? bounds[0] : ['all', ...bounds];
    }
    // A test on feature state can't be used to filter features.
    if (JSON.stringify(condition.expr).includes('feature-state')) return null;
    return condition.expr;
}

function rowFilter(row) {
    const parts = row.conditions.map(conditionFilter);
    if (!parts.length || parts.some(part => part === null)) return null;
    return parts.length === 1 ? parts[0] : ['all', ...parts];
}

/**
 * The map filter that keeps only the features a rule draws, or null when the
 * rule can't be expressed as one. The fallback rule is everything no other rule matches.
 */
export function ruleFilter(layer, ruleId) {
    const { rows } = analyzeRules(resolveStyleReferences(layer.style || {}));
    const row = rows.find(candidate => candidate.id === ruleId);
    if (!row) return null;
    if (!row.isDefault) return rowFilter(row);

    const others = rows.filter(candidate => !candidate.isDefault).map(rowFilter);
    if (!others.length || others.some(filter => filter === null)) return null;
    return ['!', ['any', ...others]];
}

function titleOf(conditions, labelField) {
    const onLabel = conditions.find(c => labelField && c.field === labelField);
    if (!onLabel) return null;
    return onLabel.kind === 'match' ? onLabel.label : describeCondition(onLabel).text.replace(`${labelField} `, '');
}

/**
 * @param {Object} layer - Layer config with a `style` (and optionally `inspect.label`)
 * @returns {Array<{id: string, title: string, subtitle: string, row: Object}>} empty when the style has no rules
 */
export function ruleLegendItems(layer) {
    const analysis = analyzeRules(resolveStyleReferences(layer.style || {}));
    if (!analysis.ruleCount) return [];

    const labelField = layer.inspect && layer.inspect.label;
    return analysis.rows.map(row => {
        if (row.isDefault) return { id: row.id, title: 'Other', subtitle: 'all other features', row };
        const expression = row.conditions.map(c => describeCondition(c).text).join(' and ');
        const title = titleOf(row.conditions, labelField);
        return { id: row.id, title: title || expression, subtitle: title ? expression : '', row };
    });
}

function text(tag, className, content) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = content;
    return node;
}

/**
 * @param {Object} layer
 * @returns {HTMLElement|null} null when the style has no rules
 */
export function generateRuleLegend(layer, { onPreview } = {}) {
    const items = ruleLegendItems(layer);
    if (!items.length) return null;
    injectRuleViewStyles();

    const container = document.createElement('div');
    container.className = 'legend-vector legend-rules';
    container.style.cssText = 'max-height:360px;overflow-y:auto;';

    items.slice(0, MAX_ITEMS).forEach(item => {
        const row = document.createElement('div');
        row.dataset.rule = item.id;
        if (onPreview) {
            row.tabIndex = 0;
            const show = () => onPreview(item.id);
            const hide = () => onPreview(null);
            row.addEventListener('mouseenter', show);
            row.addEventListener('focus', show);
            row.addEventListener('mouseleave', hide);
            row.addEventListener('blur', hide);
        }
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:5px 4px;border-radius:4px;';

        const symbol = renderRuleSymbol(item.row, 30);
        const body = document.createElement('div');
        body.style.cssText = 'min-width:0;line-height:1.25;';
        const title = text('div', 'legend-rule-title', item.title);
        title.style.cssText = 'font-size:13px;font-weight:500;color:#e5e7eb;overflow-wrap:anywhere;';
        body.appendChild(title);
        if (item.subtitle) {
            const subtitle = text('div', 'legend-rule-subtitle', item.subtitle);
            subtitle.style.cssText = 'font-size:11px;color:#6b7280;font-family:ui-monospace,monospace;overflow-wrap:anywhere;';
            body.appendChild(subtitle);
        }
        row.append(symbol, body);
        container.appendChild(row);
    });

    if (items.length > MAX_ITEMS) {
        container.appendChild(text('div', 'legend-rule-more', `… ${items.length - MAX_ITEMS} more rules`)).style.cssText = 'font-size:11px;color:#6b7280;padding:6px 4px 0;';
    }
    return container;
}

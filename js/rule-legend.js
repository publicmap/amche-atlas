/**
 * A vector layer's legend, read from the same rules the style editor's Rules
 * tab shows (js/style-rules.js): one item per rule, drawn with every property
 * that applies to it - fill, hatch, outline, line, circle - so a data-driven
 * style reads the way it is drawn.
 *
 * Each item is titled by the value of the layer's `inspect.label` field when
 * the rule is about that field ("G1"), and carries the rule's data expression
 * beneath it ("use_zones = G1").
 */

import { analyzeRules, describeCondition } from './style-rules.js';
import { resolveStyleReferences } from './style-references.js';
import { renderRuleSymbol, injectRuleViewStyles } from './rules-view.js';

const MAX_ITEMS = 60;

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
export function generateRuleLegend(layer) {
    const items = ruleLegendItems(layer);
    if (!items.length) return null;
    injectRuleViewStyles();

    const container = document.createElement('div');
    container.className = 'legend-vector legend-rules';
    container.style.cssText = 'background:white;border:1px solid #d1d5db;border-radius:4px;padding:6px 10px;max-height:360px;overflow-y:auto;';

    items.slice(0, MAX_ITEMS).forEach(item => {
        const row = document.createElement('div');
        row.dataset.rule = item.id;
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;';

        const symbol = renderRuleSymbol(item.row, 28);
        const body = document.createElement('div');
        body.style.cssText = 'min-width:0;line-height:1.25;';
        const title = text('div', 'legend-rule-title', item.title);
        title.style.cssText = 'font-size:12px;font-weight:600;color:#111827;overflow-wrap:anywhere;';
        body.appendChild(title);
        if (item.subtitle) {
            const subtitle = text('div', 'legend-rule-subtitle', item.subtitle);
            subtitle.style.cssText = 'font-size:10px;color:#6b7280;font-family:ui-monospace,monospace;overflow-wrap:anywhere;';
            body.appendChild(subtitle);
        }
        row.append(symbol, body);
        container.appendChild(row);
    });

    if (items.length > MAX_ITEMS) {
        container.appendChild(text('div', 'legend-rule-more', `… ${items.length - MAX_ITEMS} more rules`)).style.cssText = 'font-size:11px;color:#6b7280;padding-top:4px;';
    }
    return container;
}

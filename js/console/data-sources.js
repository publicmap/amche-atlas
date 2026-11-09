/**
 * Data Sources (js/console/atlas-overview.js): an atlas's maps as a tree of
 * where their data comes from. Each map's attribution is read as ordered
 * parts (js/attribution.js) - the original source, then what it came through
 * - so a map sits under its source, then under each intermediary in turn:
 * many maps from one source, georeferenced on MapWarper, nest as
 * Source › MapWarper › maps. Branches are built only when opened, so even
 * hundreds of maps stay quick to browse.
 */
import { el, icon } from './find-rows.js';
import { parseAttribution, sourceKey, hostLabel } from '../attribution.js';

const byCount = (a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
const byTitle = (a, b) => (a.title || a.id).localeCompare(b.title || b.id, undefined, { numeric: true, sensitivity: 'base' });

function branchNode(label, href) {
    return { label, href, count: 0, children: new Map(), maps: [] };
}

/** Maps nested under the parts of their attribution, in order. */
export function sourceTree(layers) {
    const root = branchNode('Data Sources', null);
    layers.forEach(layer => {
        let path = parseAttribution(layer.attribution).parts.map(part => ({ key: sourceKey(part), href: part.href }));
        if (!path.length) path = [{ key: layer.url ? hostLabel(String(layer.url).replace(/\{[^}]*\}/g, '0')) : 'No source given', href: null }];
        let node = root;
        root.count++;
        path.forEach(({ key, href }) => {
            const id = key.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
            if (!node.children.has(id)) node.children.set(id, branchNode(key, href));
            node = node.children.get(id);
            node.count++;
        });
        node.maps.push(layer);
    });
    return root;
}

function summaryOf(node, { root = false } = {}) {
    const summary = el('summary', 'console-tree-summary');
    if (root) summary.appendChild(icon('database'));
    summary.append(el('span', 'console-tree-name', node.label));
    if (!root && node.href) {
        const link = el('a', 'console-tree-link');
        link.href = node.href;
        link.target = '_blank';
        link.rel = 'noopener';
        link.title = `Open ${node.label}`;
        link.appendChild(icon('box-arrow-up-right'));
        link.addEventListener('click', (e) => e.stopPropagation());
        summary.appendChild(link);
    }
    const sources = node.children.size;
    summary.appendChild(el('span', 'console-tree-count', root
        ? `${node.count} map${node.count === 1 ? '' : 's'} · ${sources} source${sources === 1 ? '' : 's'}`
        : String(node.count)));
    summary.title = node.label;
    return summary;
}

/**
 * The tree as nested <details>, collapsed. `item(layer)` draws a map's row.
 * @returns {HTMLDetailsElement}
 */
export function dataSourcesTree(layers, item) {
    const build = (node, root = false) => {
        const details = el('details', root ? 'console-tree' : 'console-tree console-tree-branch');
        details.appendChild(summaryOf(node, { root }));
        details.addEventListener('toggle', () => {
            if (!details.open || details.childElementCount > 1) return;
            [...node.children.values()].sort(byCount).forEach(child => details.appendChild(build(child)));
            if (node.maps.length) {
                const list = el('div', 'console-tree-items');
                [...node.maps].sort(byTitle).forEach(layer => list.appendChild(item(layer)));
                details.appendChild(list);
            }
        });
        return details;
    };
    return build(sourceTree(layers), true);
}

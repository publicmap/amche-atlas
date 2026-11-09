/**
 * Data Sources (js/console/atlas-overview.js): an atlas's maps as a tree of
 * where their data comes from. Each map's attribution is read as ordered
 * parts (js/attribution.js) - the original source, then what it came through
 * - so a map sits under its source, then under each intermediary in turn:
 * many maps from one source, georeferenced on MapWarper, nest as
 * Source › MapWarper › maps.
 *
 * Starred maps (js/starred-layers.js) carry a star; the groups they sit in
 * are tinted, and come first, each in alphabetical order, then the rest.
 * Every group starts collapsed.
 */
import { el, icon } from './find-rows.js';
import { parseAttribution, sourceKey, hostLabel } from '../attribution.js';

const alphabetical = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const byGroup = (a, b) => (b.starred - a.starred) || alphabetical(a.label, b.label);

function branchNode(label, href) {
    return { label, href, count: 0, starred: false, children: new Map(), maps: [] };
}

/** Maps nested under the parts of their attribution, in order; a group holding a starred map is starred. */
export function sourceTree(layers, isStarred = () => false) {
    const root = branchNode('Data Sources', null);
    layers.forEach(layer => {
        let path = parseAttribution(layer.attribution).parts.map(part => ({ key: sourceKey(part), href: part.href }));
        if (!path.length) path = [{ key: layer.url ? hostLabel(String(layer.url).replace(/\{[^}]*\}/g, '0')) : 'No source given', href: null }];
        const starred = isStarred(layer);
        let node = root;
        root.count++;
        root.starred ||= starred;
        path.forEach(({ key, href }) => {
            const id = key.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
            if (!node.children.has(id)) node.children.set(id, branchNode(key, href));
            node = node.children.get(id);
            node.count++;
            node.starred ||= starred;
        });
        node.maps.push({ layer, starred });
    });
    return root;
}

function summaryOf(node) {
    const summary = el('summary', 'console-tree-summary');
    summary.append(el('span', 'console-tree-name', node.label), el('span', 'console-tree-count', `(${node.count})`));
    if (node.href) {
        const link = el('a', 'console-tree-link');
        link.href = node.href;
        link.target = '_blank';
        link.rel = 'noopener';
        link.title = `Open ${node.label}`;
        link.appendChild(icon('box-arrow-up-right'));
        link.addEventListener('click', (e) => e.stopPropagation());
        summary.appendChild(link);
    }
    summary.title = node.label;
    return summary;
}

/**
 * The tree: a Data Sources heading over its groups, each collapsed - opening
 * one opens everything in it. `item(layer, starred)` draws a map's row.
 * @returns {HTMLElement}
 */
export function dataSourcesTree(layers, item, isStarred) {
    const build = (node) => {
        const details = el('details', 'console-tree console-tree-branch' + (node.starred ? ' is-starred' : ''));
        details.appendChild(summaryOf(node));
        // Built in full, closed: a map's row can be revealed without opening it first
        const fill = () => {
            [...node.children.values()].sort(byGroup).forEach(child => details.appendChild(build(child)));
            if (node.maps.length) {
                const list = el('div', 'console-tree-items');
                [...node.maps]
                    .sort((a, b) => (b.starred - a.starred) || alphabetical(a.layer.title || a.layer.id, b.layer.title || b.layer.id))
                    .forEach(({ layer, starred }) => list.appendChild(item(layer, starred)));
                details.appendChild(list);
            }
        };
        fill();
        // Opening a group opens all of it
        details.addEventListener('toggle', () => {
            if (details.open) details.querySelectorAll(':scope > details').forEach(child => { child.open = true; });
        });
        return details;
    };
    const root = sourceTree(layers, isStarred);
    const tree = el('div', 'console-sources');
    const sources = root.children.size;
    const heading = el('div', 'console-sources-heading');
    heading.append(icon('database'), el('span', 'console-sources-title', 'Data Sources'),
        el('span', 'console-tree-count', `${root.count} map${root.count === 1 ? '' : 's'} · ${sources} source${sources === 1 ? '' : 's'}`));
    tree.appendChild(heading);
    [...root.children.values()].sort(byGroup).forEach(child => tree.appendChild(build(child)));
    return tree;
}

/**
 * Lists only the maps in `keys` (null for all): other rows and groups left
 * empty are hidden, groups holding a match opened. Returns how many show.
 */
export function filterTree(tree, keys) {
    let shown = 0;
    tree.querySelectorAll('.console-tree-item[data-layer-key]').forEach(row => {
        const match = !keys || keys.has(row.dataset.layerKey);
        row.hidden = !match;
        if (match) shown++;
    });
    // Innermost groups first, so a parent sees its children's state
    [...tree.querySelectorAll('details.console-tree-branch')].reverse().forEach(group => {
        const any = !!group.querySelector('.console-tree-item[data-layer-key]:not([hidden])');
        group.hidden = !any;
        if (keys) group.open = any;
    });
    tree.classList.toggle('is-filtered', !!keys);
    return shown;
}

/**
 * Find's atlas mode (js/console/find-panel.js): Atlas Data Sources - every
 * atlas as a tree, headed like the Data Sources tree, whose tag icon opens
 * the atlases' own `tags` (an atlas config's top-level `tags`, e.g.
 * "opendata") as one row of chips. The index atlas holds them all, in three
 * groups: Current Map View, Outside Current Map View (nearest first) and
 * Global Basemaps; each atlas with its icon, the selected one with its eye.
 * Beside the tree, a globe of them (js/console/atlas-map.js): clicking an
 * atlas in either turns the globe to it and offers Select Atlas. All is open
 * but Outside Current Map View.
 */
import { el, hint, imageThumb, icon } from './find-rows.js';
import { atlasesForSelector } from './find-browse.js';
import { isIncludingOutside } from './find-scope.js';
import { AtlasMap } from './atlas-map.js';
import { shapeOf } from './atlas-map-geo.js';

const tagsOf = (entry) => (Array.isArray(entry.meta?.tags) ? entry.meta.tags.map(String).filter(Boolean) : []);

function chip(label, count, selected, onClick) {
    const node = el('button', 'console-tag-chip' + (selected ? ' selected' : ''));
    node.type = 'button';
    node.setAttribute('aria-pressed', String(selected));
    node.append(el('span', '', label), el('span', 'console-tag-count', `(${count})`));
    node.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return node;
}

/** The atlases' tags as one row of chips; picking the chosen one again clears it. */
function tagBar(entries, chosen, onTag) {
    const counts = new Map();
    entries.forEach(entry => tagsOf(entry).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    if (!counts.size) return null;
    const bar = el('div', 'console-tagbar');
    const rowEl = el('div', 'console-tag-row');
    rowEl.setAttribute('role', 'group');
    rowEl.setAttribute('aria-label', 'Filter atlases by tag');
    [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
        .forEach(([tag, count]) => rowEl.appendChild(chip(tag, count, tag === chosen, () => onTag(tag === chosen ? null : tag))));
    bar.appendChild(rowEl);
    return bar;
}

/** Atlas Data Sources, as the Data Sources tree is headed, with the tag icon that opens the tag chips. */
function pickerHead(count, tagsOpen, onToggleTags) {
    const head = el('div', 'console-sources-heading atlas-picker-head');
    const toggle = el('button', 'console-filter' + (tagsOpen ? ' on' : ''));
    toggle.type = 'button';
    toggle.title = tagsOpen ? 'Hide the tags' : 'Browse the atlases by tag';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-pressed', String(tagsOpen));
    toggle.appendChild(icon(tagsOpen ? 'diagram-3-fill' : 'diagram-3'));
    toggle.addEventListener('click', () => onToggleTags?.());
    head.append(icon('collection'), el('span', 'console-sources-title', 'Atlas Data Sources'),
        el('span', 'console-tree-count', `${count} atlas${count === 1 ? '' : 'es'}`), toggle);
    return head;
}

function summary(label, count, thumb = null) {
    const node = el('summary', 'console-tree-summary');
    if (thumb) node.appendChild(thumb);
    node.append(el('span', 'console-tree-name', label), el('span', 'console-tree-count', `(${count})`));
    return node;
}

/** An atlas: its icon and name, the selected one with its eye. */
function atlasItem({ id, meta, current }, map) {
    const item = el('div', 'console-tree-item atlas-tree-item' + (current ? ' current' : ''));
    item.dataset.atlasId = id;
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.title = current ? `${meta?.name || id} - the atlas on the map` : `${meta?.name || id} - show on the globe`;
    const thumb = imageThumb(meta?.icon, 'map');
    thumb.classList.add('console-tree-thumb');
    item.append(thumb, el('span', 'console-tree-title', meta?.name || id));
    if (current) {
        const eye = el('span', 'console-eye on console-tree-eye');
        eye.title = 'The atlas on the map';
        eye.appendChild(icon('eye'));
        item.appendChild(eye);
    }
    item.addEventListener('click', () => map.focus(id));
    item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') map.focus(id);
    });
    item.addEventListener('mouseenter', () => map.hover(id, true));
    item.addEventListener('mouseleave', () => map.hover(id, false));
    return item;
}

function group(label, entries, map, { open = true, className = '' } = {}) {
    const details = el('details', `console-tree console-tree-branch ${className}`.trim());
    details.open = open && entries.length > 0;
    details.appendChild(summary(label, entries.length));
    const list = el('div', 'console-tree-items');
    entries.forEach(entry => list.appendChild(atlasItem(entry, map)));
    details.appendChild(list);
    return details;
}

/** The index atlas holding the rest, in their three groups. */
function atlasTree(shown, map) {
    const index = shown.find(entry => entry.id === 'index');
    const others = shown.filter(entry => entry.id !== 'index');
    const global = others.filter(entry => shapeOf(entry.meta).global);
    const regional = others.filter(entry => !global.includes(entry));
    const root = el('details', 'console-tree console-tree-branch atlas-tree-root');
    root.open = true;
    const thumb = imageThumb(index?.meta?.icon || 'assets/img/icon-192x192.png', 'map');
    thumb.classList.add('console-tree-thumb');
    const head = summary(index?.meta?.name || 'Amche Atlas', others.length, thumb);
    // The index atlas is an atlas too: its name offers it on the globe
    head.querySelector('.console-tree-name').addEventListener('click', (e) => {
        if (!index) return;
        e.preventDefault();
        map.focus('index');
    });
    if (index?.current) {
        const eye = el('span', 'console-eye on console-tree-eye');
        eye.appendChild(icon('eye'));
        head.appendChild(eye);
    }
    root.append(head,
        group('Current Map View', regional.filter(entry => !entry.outside), map),
        group('Outside Current Map View', regional.filter(entry => entry.outside), map, { open: false, className: 'is-outside' }),
        group('Global Basemaps', global, map));
    const tree = el('div', 'console-sources');
    tree.appendChild(root);
    return tree;
}

/** Lists only the atlases in `ids` (null for all), every group opened; groups left empty are hidden. */
function filterAtlasTree(tree, ids) {
    tree.querySelectorAll('.atlas-tree-item[data-atlas-id]').forEach(row => {
        row.hidden = !!ids && !ids.has(row.dataset.atlasId);
    });
    tree.querySelectorAll('.atlas-tree-root > details.console-tree-branch').forEach(group => {
        const any = !!group.querySelector('.atlas-tree-item:not([hidden])');
        group.hidden = !!ids && !any;
        if (ids) group.open = any;
        else group.open = !group.matches('.is-outside') && group.querySelector('.atlas-tree-item') !== null;
    });
    tree.classList.toggle('is-filtered', !!ids);
}

/**
 * Lists the atlases into `container`, the tag chips (browsing by tag) into
 * `tagSlot`. Returns how many the in-view filter leaves out and the tag in
 * force - dropped when no atlas carries it any more.
 */
export function renderAtlases(container, { query = '', all = false, tagsOpen = false, tag = null, onTag, onToggleTags, onPick }) {
    const { entries, hidden } = atlasesForSelector(query, { all: all || isIncludingOutside() });
    const chosen = tagsOpen && entries.some(entry => tagsOf(entry).includes(tag)) ? tag : null;
    let shown = entries;
    container.appendChild(pickerHead(entries.length, tagsOpen, onToggleTags));
    if (tagsOpen) {
        const bar = tagBar(entries, chosen, onTag);
        if (bar) container.appendChild(bar);
        if (chosen) shown = entries.filter(entry => tagsOf(entry).includes(chosen));
    }
    if (!shown.length) {
        container.appendChild(hint(query ? `No atlas matches “${query}”.` : 'No atlas carries this tag.'));
        return { hidden: 0, tag: chosen, map: null };
    }
    let tree = null;
    const map = new AtlasMap({ entries: shown, onPick, onFilter: (ids) => tree && filterAtlasTree(tree, ids) });
    tree = atlasTree(shown, map);
    const columns = el('div', 'atlas-browser');
    columns.append(tree, map.el);
    container.appendChild(columns);
    // A point picked on the Data Sources map filters this list too
    map.applyPoint();
    return { hidden: all || query ? 0 : hidden, tag: chosen, map };
}

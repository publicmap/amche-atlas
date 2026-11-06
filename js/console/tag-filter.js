/**
 * Tag filters over Find's map results (js/console/find-panel.js). A map's
 * `tags` are its theme path, top level first, so the filter is a path too:
 * the first row offers the top-level tags with how many maps carry each;
 * picking one narrows the maps to it and opens a row with the next level
 * within it, and so on. Picking a chosen tag again steps back to its level.
 * The chips sit under the atlas picker; what is on the map is the search
 * field's eye filter (js/console/find-filters.js), not a chip.
 */
import { el } from './find-rows.js';

function tagsOf(layer) {
    return Array.isArray(layer?.tags) ? layer.tags.map(tag => String(tag).trim()).filter(Boolean) : [];
}

function matchesPath(layer, path) {
    const tags = tagsOf(layer);
    return path.every((tag, level) => tags[level] === tag);
}

export function filterByTags(layers, path, layerOf = layer => layer) {
    return path.length ? layers.filter(item => matchesPath(layerOf(item), path)) : layers;
}

/** The tags at `level` among `layers`, with their counts, in alphabetical order. */
function tagCounts(layers, level) {
    const counts = new Map();
    layers.forEach(layer => {
        const tag = tagsOf(layer)[level];
        if (tag) counts.set(tag, (counts.get(tag) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));
}

function chip(label, count, selected, onClick, className = '') {
    const node = el('button', `console-tag-chip ${className}`.trim() + (selected ? ' selected' : ''));
    node.type = 'button';
    node.setAttribute('aria-pressed', String(selected));
    node.append(el('span', '', label), el('span', 'console-tag-count', `(${count})`));
    node.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return node;
}

/**
 * The filter rows for `layers` under `path`, or null when there is nothing to
 * pick. `onChange(nextPath)` is called with the path a click asks for.
 *
 * `modes` ([{id, label, count}]) lead the first row - Active and All - and
 * `mode` is the one chosen; a mode chip shows as chosen only while no tag is,
 * since picking a tag narrows All. `onMode(id)` is called when one is clicked.
 */
export function tagFilterBar(layers, path, onChange, { modes = [], mode = null, onMode = null } = {}) {
    const bar = el('div', 'console-tagbar');
    for (let level = 0; level <= path.length; level++) {
        const within = filterByTags(layers, path.slice(0, level));
        const tags = tagCounts(within, level);
        const lead = level === 0 ? modes : [];
        if (!tags.length && !lead.length) break;
        const rowEl = el('div', 'console-tag-row');
        rowEl.setAttribute('role', 'group');
        rowEl.setAttribute('aria-label', level ? `Within ${path.slice(0, level).join(' › ')}` : 'Filter maps');
        // The modes stay pinned at the start while the tags scroll under them
        if (lead.length) {
            const pinned = el('span', 'console-tag-modes');
            lead.forEach(({ id, label, count }) => {
                pinned.appendChild(chip(label, count, !path.length && mode === id, () => onMode?.(id), 'console-mode-chip'));
            });
            if (tags.length) pinned.appendChild(el('span', 'console-tag-divider'));
            rowEl.appendChild(pinned);
        }
        tags.forEach(([tag, count]) => {
            const selected = path[level] === tag;
            rowEl.appendChild(chip(tag, count, selected, () => onChange(selected ? path.slice(0, level) : [...path.slice(0, level), tag])));
        });
        bar.appendChild(rowEl);
    }
    requestAnimationFrame(() => scrollToSelected(bar));
    return bar.childElementCount ? bar : null;
}

/** Each row scrolls so its chosen tag comes first. */
function scrollToSelected(bar) {
    bar.querySelectorAll('.console-tag-row').forEach(rowEl => {
        const chip = rowEl.querySelector('.console-tag-chip.selected:not(.console-mode-chip)');
        if (!chip) return;
        const first = rowEl.querySelector('.console-tag-chip:not(.console-mode-chip)');
        const offset = chip.getBoundingClientRect().left - first.getBoundingClientRect().left;
        rowEl.scrollLeft = offset;
    });
}

/**
 * Tag filters over Find's map results (js/console/find-panel.js). A map's
 * `tags` are its theme path, top level first, so the filter is a path too:
 * the first row offers the top-level tags with how many maps carry each;
 * picking one narrows the maps to it and opens a row with the next level
 * within it, and so on. Picking a chosen tag again steps back to its level.
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

/**
 * The filter rows for `layers` under `path`, or null when the maps carry no
 * tags. `onChange(nextPath)` is called with the path a click asks for.
 */
export function tagFilterBar(layers, path, onChange) {
    const bar = el('div', 'console-tagbar');
    for (let level = 0; level <= path.length; level++) {
        const within = filterByTags(layers, path.slice(0, level));
        const tags = tagCounts(within, level);
        if (!tags.length) break;
        const rowEl = el('div', 'console-tag-row');
        rowEl.setAttribute('role', 'group');
        rowEl.setAttribute('aria-label', level ? `Within ${path.slice(0, level).join(' › ')}` : 'Filter maps by tag');
        tags.forEach(([tag, count]) => {
            const selected = path[level] === tag;
            const chip = el('button', 'console-tag-chip' + (selected ? ' selected' : ''));
            chip.type = 'button';
            chip.setAttribute('aria-pressed', String(selected));
            chip.append(el('span', '', tag), el('span', 'console-tag-count', `(${count})`));
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                onChange(selected ? path.slice(0, level) : [...path.slice(0, level), tag]);
            });
            rowEl.appendChild(chip);
        });
        bar.appendChild(rowEl);
    }
    requestAnimationFrame(() => scrollToSelected(bar));
    return bar.childElementCount ? bar : null;
}

/** Each row scrolls so its chosen tag comes first. */
function scrollToSelected(bar) {
    bar.querySelectorAll('.console-tag-row').forEach(rowEl => {
        const chip = rowEl.querySelector('.console-tag-chip.selected');
        if (!chip) return;
        const first = rowEl.querySelector('.console-tag-chip');
        const offset = chip.getBoundingClientRect().left - first.getBoundingClientRect().left;
        rowEl.scrollLeft = offset;
    });
}

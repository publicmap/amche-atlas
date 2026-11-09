/**
 * Find's atlas mode (js/console/find-panel.js): the list under the search
 * field is every atlas, as cards (js/console/atlas-cards.js), matching the
 * query. The search field's filters act on atlases here: the in-view filter
 * keeps to the atlases covering the map view, and browsing by tag offers the
 * atlases' own `tags` (an atlas config's top-level `tags`, e.g. "opendata")
 * as one row of chips.
 */
import { el, sectionLabel, hint } from './find-rows.js';
import { atlasesForSelector } from './find-browse.js';
import { isIncludingOutside } from './find-scope.js';
import { atlasCards } from './atlas-cards.js';

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

/**
 * Lists the atlases into `container`, the tag chips (browsing by tag) into
 * `tagSlot`. Returns how many the in-view filter leaves out and the tag in
 * force - dropped when no atlas carries it any more.
 */
export function renderAtlases(container, tagSlot, { query = '', browsingTags = false, tag = null, onTag, onPick }) {
    const { entries, hidden } = atlasesForSelector(query, { all: browsingTags || isIncludingOutside() });
    const chosen = browsingTags && entries.some(entry => tagsOf(entry).includes(tag)) ? tag : null;
    let shown = entries;
    if (browsingTags) {
        const bar = tagBar(entries, chosen, onTag);
        if (bar) tagSlot.appendChild(bar);
        if (chosen) shown = entries.filter(entry => tagsOf(entry).includes(chosen));
    }
    const section = el('section', 'console-section');
    section.appendChild(sectionLabel(chosen ? `Atlases › ${chosen}` : 'Atlases', el('span', '', String(shown.length))));
    section.appendChild(shown.length ? atlasCards(shown, onPick)
        : hint(query ? `No atlas matches “${query}”.` : 'No atlas covers this view. Turn off the in-view filter to list them all.'));
    container.appendChild(section);
    return { hidden: browsingTags || query ? 0 : hidden, tag: chosen };
}

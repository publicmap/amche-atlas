/**
 * A map row's own results in Find (js/console/find-panel.js): its features -
 * or a routes layer's routes, or the locations layer's saved locations.
 *
 * The map's title carries how many there are, and a name badge shows under
 * it only for one that is hovered or selected (on the map or here: `mark`
 * keeps a badge's state live). The full list is the map's details page,
 * which a click on the row opens.
 */
import { el, icon } from './find-rows.js';

/**
 * @param {HTMLElement} row - the map's row (layerRow in js/console/find-browse.js)
 * @param {{items: Array, pick: Function, hover?: Function, mark?: Function,
 *   nameOf?: Function, iconOf?: Function}} options
 * @returns {HTMLElement[]} the row
 */
export function nestResults(row, { items, pick, hover = null, mark = null, nameOf = defaultName, iconOf = null }) {
    if (!items.length) return [row];
    addCount(row, items.length);
    row.querySelector('.console-row-text')?.appendChild(badges(items, { pick, hover, mark, nameOf, iconOf }));
    return [row];
}

const defaultName = item => item.properties?.name || '';

function addCount(row, count) {
    const title = row.querySelector('.console-row-title');
    if (!title) return;
    title.querySelector('.console-row-count')?.remove();
    const node = el('span', 'console-row-count', `(${count})`);
    title.insertBefore(node, title.querySelector('.console-row-note'));
}

// Every result's badge, each shown only while it is hovered or selected
function badges(items, { pick, hover, mark, nameOf, iconOf }) {
    const box = el('div', 'console-result-badges');
    items.forEach(item => {
        const name = nameOf(item);
        const badge = el('button', 'console-result-badge');
        badge.type = 'button';
        if (iconOf) badge.appendChild(icon(iconOf(item)));
        badge.appendChild(el('span', '', name));
        badge.title = name;
        if (item.saved) badge.classList.add('saved');
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            pick(item);
        });
        if (hover) {
            badge.addEventListener('mouseenter', () => hover(item, true));
            badge.addEventListener('mouseleave', () => hover(item, false));
        }
        mark?.(badge, item);
        box.appendChild(badge);
    });
    return box;
}

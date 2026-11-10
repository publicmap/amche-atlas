/**
 * A map row's own results in Find (js/console/find-panel.js): its features -
 * or a routes layer's routes, or the locations layer's saved locations -
 * nested under the map.
 *
 * Collapsed (the default), they are one line of name badges under the map's
 * name, the rest behind a "…" badge that shows them all. Clicking the map's
 * row lists them one per row beneath it instead, with the row's own footer
 * links (the map's details, sharing locations) after them.
 */
import { el, icon, moreRow } from './find-rows.js';

const ROWS_PER_MAP = 10;

/**
 * @param {HTMLElement} row - the map's row (layerRow in js/console/find-browse.js)
 * @param {{key: string, items: Array, ctx: Object, rowOf: Function, pick: Function,
 *   hover?: Function, nameOf?: Function, iconOf?: Function, wrap?: string,
 *   footer?: Array<{text: string, onClick: Function}>}} options - rowOf builds
 *   a nested row (tracking it itself when `wrap` holds them in a container of
 *   that class, as route cards are)
 * @returns {HTMLElement[]} the row, then the nested rows when it is open
 */
export function nestResults(row, { key, items, ctx, rowOf, pick, hover = null, nameOf = defaultName, iconOf = null, wrap = null, footer = [] }) {
    row.toggleFeatures = null;
    row.classList.remove('console-parent', 'open');
    if (!items.length) return [row];
    const openKey = `features:${key}`;
    const open = ctx.expanded.has(openKey);
    row.toggleFeatures = () => ctx.toggle(openKey);
    row.classList.add('console-parent');
    row.classList.toggle('open', open);
    if (!open) {
        row.querySelector('.console-row-text')?.appendChild(badges(items, { key, ctx, pick, hover, nameOf, iconOf }));
        return [row];
    }
    const allKey = `features-all:${key}`;
    const shown = ctx.expanded.has(allKey) ? items : items.slice(0, ROWS_PER_MAP);
    const nested = [];
    if (wrap) {
        const box = el('div', wrap);
        box.append(...shown.map(rowOf));
        nested.push(box);
    } else nested.push(...shown.map(item => ctx.track(rowOf(item), item)));
    if (items.length > shown.length) nested.push(moreRow(`${items.length - shown.length} more`, () => ctx.toggle(allKey)));
    footer.forEach(({ text, onClick }) => nested.push(moreRow(text, onClick)));
    nested.forEach(node => node.classList.add('console-nested'));
    return [row, ...nested];
}

const defaultName = item => item.properties?.name || '';

function badges(items, { key, ctx, pick, hover, nameOf, iconOf }) {
    const box = el('div', 'console-result-badges');
    const moreKey = `badges:${key}`;
    const all = ctx.expanded.has(moreKey);
    box.classList.toggle('open', all);
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
        box.appendChild(badge);
    });
    if (!all) requestAnimationFrame(() => clip(box, () => ctx.toggle(moreKey)));
    return box;
}

// Keeps the badges to their first line, ending it with a "…" badge for the rest
function clip(box, onMore) {
    const list = [...box.children];
    if (!box.isConnected || !list.length) return;
    const top = list[0].offsetTop;
    let cut = list.findIndex(badge => badge.offsetTop > top);
    if (cut < 0) return;
    const more = el('button', 'console-result-badge console-result-badge-more', '…');
    more.type = 'button';
    more.addEventListener('click', (e) => {
        e.stopPropagation();
        onMore();
    });
    list.slice(cut).forEach(badge => { badge.hidden = true; });
    box.insertBefore(more, list[cut]);
    while (cut > 1 && more.offsetTop > top) list[--cut].hidden = true;
    more.title = `Show ${list.length - cut} more`;
}

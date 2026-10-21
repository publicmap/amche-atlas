/**
 * The Share panel's "Open With" section (js/share-view-panel.js): the view
 * opened in other map services (js/external-map-links.js). Its header has
 * the popular ones as icons; the rest of the header expands the full list,
 * one row per service in alphabetical order (starred when it is also a
 * header icon), filtered by group with a count for each. Links are
 * built for the map centre, or for a pinned point (the shortcut menu's
 * "Open With > More"), and rebuilt as the map moves. Collapsed by default;
 * whether it is open is remembered per browser.
 */
import { externalMapLinks, LINK_GROUPS } from './external-map-links.js';

const OPEN_KEY = 'amche_share_links_open';
// The popular services, as icons in the section's header
const QUICK = ['osm', 'google-maps', 'google-earth', 'apple-maps', 'forest-watch'];

function isOpen() {
    try { return localStorage.getItem(OPEN_KEY) === '1'; } catch (error) { return false; }
}

function rememberOpen(open) {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (error) { /* storage unavailable */ }
}

function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
}

// A link's icon: an image URL, an HTML snippet from its definition, or its initials
function linkIcon(link) {
    if (link.icon?.trim().startsWith('<')) {
        const wrap = node('span', 'share-link-icon share-link-icon-text');
        wrap.innerHTML = link.icon;
        return wrap;
    }
    const initials = node('span', 'share-link-icon share-link-icon-text', link.name.slice(0, 2).toUpperCase());
    if (!link.icon) return initials;
    const img = node('img', 'share-link-icon' + (link.lightIcon ? ' is-light-logo' : ''));
    img.src = link.icon;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(initials), { once: true });
    return img;
}

function linkAnchor(link, className) {
    const a = node('a', className);
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = link.description ? `${link.name}: ${link.description}` : link.name;
    return a;
}

function row(link) {
    const a = linkAnchor(link, 'share-link-row');
    const text = node('span', 'share-link-text');
    const name = node('span', 'share-link-name', link.name);
    if (QUICK.includes(link.id)) {
        const star = node('sl-icon', 'share-link-star');
        star.setAttribute('name', 'star-fill');
        star.setAttribute('label', 'Shortcut in the header');
        name.prepend(star);
    }
    text.append(name, node('span', 'share-link-tags', (link.tags || []).join(' · ')));
    const open = node('sl-icon', 'share-link-open');
    open.setAttribute('name', 'box-arrow-up-right');
    a.append(linkIcon(link), text, open);
    return a;
}

function quickIcon(link) {
    const a = linkAnchor(link, 'share-link-quick');
    a.title = `Open in ${link.name}`;
    a.setAttribute('aria-label', a.title);
    a.appendChild(linkIcon(link));
    return a;
}

/**
 * @param {HTMLElement} section - the panel section to fill; gets `is-collapsed`
 * @returns {{render: Function, setPoint: Function, expand: Function}}
 */
export function buildExternalLinksSection(section, map) {
    let point = null;
    let group = null;

    // The header holds the popular services' links, so it is a div acting as the toggle
    const toggle = node('div', 'place-label place-label-toggle share-links-head');
    toggle.setAttribute('role', 'button');
    toggle.tabIndex = 0;
    const quick = node('span', 'share-links-quick');
    const chevron = node('sl-icon', 'place-label-chevron');
    chevron.setAttribute('name', 'chevron-down');
    toggle.append(node('span', '', 'Open With'), quick, chevron);

    const body = node('div', 'share-links');
    const pinned = node('div', 'share-links-where');
    const tags = node('div', 'share-links-tags');
    const list = node('div', 'share-links-list');
    body.append(pinned, tags, list);
    section.append(toggle, body);

    const setOpen = (open) => {
        section.classList.toggle('is-collapsed', !open);
        toggle.setAttribute('aria-expanded', String(open));
        body.hidden = !open;
    };
    const flip = () => {
        const open = section.classList.contains('is-collapsed');
        rememberOpen(open);
        setOpen(open);
    };
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!e.target.closest('a')) flip();
    });
    toggle.addEventListener('keydown', (e) => {
        if (e.target !== toggle || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        flip();
    });
    setOpen(isOpen());

    // Only while the links are for a pinned point, a way back to the map centre
    function renderPinned() {
        pinned.hidden = !point;
        pinned.replaceChildren();
        if (!point) return;
        const centre = node('button', 'share-links-mini', 'Use map centre');
        centre.type = 'button';
        centre.addEventListener('click', () => { point = null; render(); });
        pinned.append(node('span', 'share-links-coords', 'For the point you picked'), centre);
    }

    function renderGroups(links) {
        const chips = [[null, 'All', links.length],
            ...LINK_GROUPS.map(([id, label]) => [id, label, links.filter(link => link.groups?.includes(id)).length])];
        tags.replaceChildren(...chips.filter(([, , count]) => count).map(([id, label, count]) => {
            const chip = node('button', 'share-links-tag' + (group === id ? ' active' : ''), label);
            chip.type = 'button';
            chip.setAttribute('aria-pressed', String(group === id));
            chip.appendChild(node('span', 'share-links-count', String(count)));
            chip.addEventListener('click', () => { group = id; render(); });
            return chip;
        }));
    }

    function render() {
        if (!map) return;
        const centre = map.getCenter();
        const links = externalMapLinks(point?.lat ?? centre.lat, point?.lng ?? centre.lng, Math.round(map.getZoom()));
        quick.replaceChildren(...QUICK.map(id => links.find(link => link.id === id)).filter(Boolean).map(quickIcon));
        renderPinned();
        renderGroups(links);
        const shown = links
            .filter(link => !group || link.groups?.includes(group))
            .sort((a, b) => a.name.localeCompare(b.name));
        list.replaceChildren(...shown.map(row));
    }

    render();
    return {
        render,
        // A point to build the links for instead of the map centre (null to follow the map)
        setPoint(next) {
            point = next;
            render();
        },
        get pinned() {
            return !!point;
        },
        expand() {
            setOpen(true);
        }
    };
}

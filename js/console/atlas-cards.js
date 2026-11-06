/**
 * The atlas cards (js/console/find-panel.js), one per atlas: a header row
 * over a wash of the atlas's header image - its icon and name, then a badge
 * that zooms to it, then its eye. Only one atlas is on at a time, so only the
 * current atlas's card is expanded: its eye on, then the maps it opens with
 * (its first `initiallyChecked` maps, and how many more it has) and its whole
 * description, links and all. The others are just the header, their badge
 * and eye (off) showing while hovered. Picking a card, or its eye, switches
 * to that atlas.
 *
 * The badge names the atlas's `areaOfInterest` ("Goa, India") on the current
 * card and a hovered one; otherwise, for an atlas outside the map view, how
 * far away it is, with an arrow toward it. A global atlas - one with no
 * extent, or the whole world as its extent - says "Global" and has nothing to
 * zoom to. An atlas outside the view has no eye and cannot be picked from
 * here: clicking it zooms there first. updateAtlasCards() keeps all of that
 * current as the map moves.
 */
import { el, imageThumb, eyeButton } from './find-rows.js';
import { zoomTo, bboxInView, bboxDistance, formatAway, parseBbox } from './find-scope.js';
import { atlasMapCount, switchAtlas, previewAtlas, clearPreview } from './find-browse.js';

const DEFAULTS_NAMED = 2;

const SAFE_URL = /^(https?:|mailto:|\/|#|\.)/i;

/** An atlas description's text, keeping its links (and only those) clickable. */
function descriptionNode(html) {
    const holder = document.createElement('template');
    holder.innerHTML = String(html);
    const out = el('span', 'console-atlas-card-desc');
    const copy = (from, to) => from.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) to.append(node.textContent);
        else if (node.nodeType !== Node.ELEMENT_NODE) return;
        else if (node.tagName === 'A' && SAFE_URL.test(node.getAttribute('href') || '')) {
            const link = el('a', '', node.textContent);
            link.href = node.getAttribute('href');
            link.target = '_blank';
            link.rel = 'noopener';
            to.appendChild(link);
        } else {
            if (node.tagName === 'BR' || node.tagName === 'P') to.append(' ');
            copy(node, to);
        }
    });
    copy(holder.content, out);
    out.normalize();
    return out.textContent.trim() ? out : null;
}

/** "Map A, Map B and 12 more maps": the maps the atlas opens with, then the rest. */
function subtitle(atlasId) {
    const total = atlasMapCount(atlasId);
    const ids = window.browserControl?._getAtlasInitiallyCheckedIds?.(atlasId) || [];
    const names = ids
        .map(id => window.layerRegistry?.getLayer?.(id, atlasId, true))
        .map(layer => layer?.title || layer?.name)
        .filter(Boolean)
        .slice(0, DEFAULTS_NAMED);
    const more = Math.max(0, total - names.length);
    if (!names.length) return `${total} map${total === 1 ? '' : 's'}`;
    return more ? `${names.join(', ')} and ${more} more map${more === 1 ? '' : 's'}` : names.join(', ');
}

function isGlobal(meta) {
    const box = parseBbox(meta?.bbox);
    return !box || (box[2] - box[0] >= 359 && box[3] - box[1] >= 170);
}

/** Marks a card in or out of the view: its distance and arrow, and its badge's title. */
function placeCard(card) {
    const bbox = card._bbox;
    if (!bbox) return;
    const outside = !bboxInView(bbox);
    card.classList.toggle('outside', outside);
    const badge = card.querySelector('.console-atlas-card-badge');
    badge.title = outside ? `${card._name} is outside this view - zoom to it` : `Zoom to ${card._name}`;
    badge.setAttribute('aria-label', badge.title);
    const away = card.querySelector('.console-atlas-card-away');
    const where = outside ? bboxDistance(bbox) : null;
    away.hidden = !where;
    if (where) {
        away.lastChild.textContent = formatAway(where.km);
        const turn = where.bearing - (window.map?.getBearing?.() || 0);
        away.firstChild.style.transform = `rotate(${turn}deg)`;
    }
    if (!card.classList.contains('current')) card.title = outside ? `${card._name} is outside this view - click to zoom to it` : `Switch to ${card._name}`;
}

/** "Goa, India" and a zoom, or "Global"; for an atlas outside the view also its distance. */
function badge(meta, global) {
    if (global) return el('span', 'console-atlas-card-badge is-global', 'Global');
    const node = el('button', 'console-atlas-card-badge');
    node.type = 'button';
    const away = el('span', 'console-atlas-card-away');
    away.hidden = true;
    away.append(document.createElement('sl-icon'), el('span'));
    away.firstChild.name = 'arrow-up';
    const zoom = document.createElement('sl-icon');
    zoom.name = 'zoom-in';
    node.append(away, el('span', 'console-atlas-card-area', meta?.areaOfInterest || 'Zoom'), zoom);
    node.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomTo({ bbox: meta.bbox });
    });
    return node;
}

/** Brings every card's distance, arrow and eye up to date with the map view. */
export function updateAtlasCards(list) {
    list?.querySelectorAll('.console-atlas-card').forEach(placeCard);
}

function onEye(title) {
    const eye = el('span', 'console-eye on console-atlas-card-eye');
    eye.title = title;
    eye.appendChild(document.createElement('sl-icon')).name = 'eye';
    return eye;
}

export function atlasCards(entries, onPick = switchAtlas) {
    const list = el('div', 'console-atlas-cards');
    entries.forEach(({ id, meta, current, outside }) => {
        const name = meta?.name || id;
        const card = el('div', ['console-atlas-card', current && 'current'].filter(Boolean).join(' '));
        const global = isGlobal(meta);
        card._bbox = global ? null : meta.bbox;
        card._name = name;
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.title = current ? `${name} - the atlas on the map` : `Switch to ${name}`;
        if (meta?.headerImage) card.style.setProperty('--card-image', `url("${String(meta.headerImage).replace(/"/g, '%22')}")`);

        const actions = el('span', 'console-row-actions');
        actions.appendChild(badge(meta, global));
        actions.appendChild(current ? onEye(`${name} is the atlas on the map`) : eyeButton('off', () => pick({ target: card }), `Switch to ${name}`));
        const head = el('div', 'console-atlas-card-head');
        head.append(imageThumb(meta?.icon, 'map'), el('span', 'console-atlas-card-name', name), actions);
        card.appendChild(head);

        if (current) {
            const body = el('div', 'console-atlas-card-body');
            body.appendChild(el('span', 'console-atlas-card-meta', subtitle(id)));
            const desc = meta?.description ? descriptionNode(meta.description) : null;
            if (desc) body.appendChild(desc);
            card.appendChild(body);
        }

        const pick = (e) => {
            if (e.target.closest('a, button') || current) return;
            if (card.classList.contains('outside')) {
                zoomTo({ bbox: card._bbox });
                return;
            }
            list.querySelectorAll('.console-atlas-card.pending').forEach(other => other.classList.remove('pending'));
            card.classList.add('pending');
            onPick(id);
        };
        card.addEventListener('click', pick);
        card.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            pick(e);
        });
        card.addEventListener('mouseenter', () => previewAtlas(id));
        card.addEventListener('mouseleave', clearPreview);
        placeCard(card);
        list.appendChild(card);
    });
    return list;
}

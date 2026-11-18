/**
 * Shared building blocks for every list in the map console (js/map-control-bar.js):
 * one row shape (a square thumbnail; title, then a subtitle, then badges of its
 * features; trailing actions), one section header, one eye toggle. Find's
 * results, its browse sections and the on-map list all use these, so the
 * console reads as a single component.
 *
 * A section header is "Label (count)"; hovering the section reveals square
 * buttons acting on all its items and, last, a small eye over all the rows'
 * eyes - on, off, or part when only some are on (js/map-export.html's panel
 * follows the same pattern).
 */
import { LayerThumbnail } from '../layer-thumbnail.js';

export function el(tag, className = '', text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null && text !== undefined) node.textContent = text;
    return node;
}

export function icon(name) {
    const node = document.createElement('sl-icon');
    node.name = name;
    return node;
}

export function sectionLabel(text, ...extras) {
    return sectionHeader({ label: text, extras });
}

/**
 * A section's header row.
 * @param {Object} options
 * @param {string} options.label
 * @param {number|null} [options.count] - shown as "(count)"
 * @param {HTMLElement[]} [options.actions] - square buttons acting on every item (sectionAction)
 * @param {HTMLElement|null} [options.eye] - the eye over every row's eye (groupEye)
 * @param {HTMLElement[]} [options.extras] - always shown, after the label
 */
export function sectionHeader({ label, count = null, actions = [], eye = null, extras = [] }) {
    const head = el('div', 'console-label console-section-head');
    const text = el('span', 'console-section-title', label);
    head.appendChild(text);
    const countEl = el('span', 'console-section-count');
    head.appendChild(countEl);
    setSectionCount(head, count);
    if (extras.length) {
        const side = el('span', 'console-label-side');
        side.append(...extras.filter(Boolean));
        head.appendChild(side);
    }
    const tools = el('span', 'console-section-tools');
    tools.append(...actions.filter(Boolean));
    if (eye) tools.appendChild(eye);
    head.appendChild(tools);
    return head;
}

export function setSectionCount(head, count) {
    const countEl = head?.querySelector(':scope > .console-section-count');
    if (!countEl) return;
    countEl.textContent = count === null || count === undefined ? '' : `(${count})`;
}

/** A square button in a section header, acting on all the section's items; `on` marks a toggle that is on. */
export function sectionAction(iconName, title, onClick, { on = false } = {}) {
    const button = el('button', 'console-section-action');
    button.type = 'button';
    button.appendChild(icon(iconName));
    setActionTitle(button, title);
    button.classList.toggle('on', on);
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(e);
    });
    return button;
}

export function setActionTitle(button, title) {
    button.title = title;
    button.setAttribute('aria-label', title);
}

/** Whether a set of eyes is all on, all off, or part. */
export function eyesState(states) {
    const on = states.filter(Boolean).length;
    if (!states.length || on === 0) return 'off';
    return on === states.length ? 'on' : 'part';
}

/** What a group eye does next: part and off turn everything on, on turns everything off. */
export function nextEyeState(state) {
    return state === 'on' ? 'off' : 'on';
}

/**
 * The section's eye over all its rows' eyes, smaller and aligned with them.
 * `onClick(next)` gets the state to set every row to.
 */
export function groupEye(onClick, { state = 'off', noun = 'all' } = {}) {
    const button = eyeButton(state, () => onClick(nextEyeState(button.dataset.state)), '');
    button.classList.add('console-eye-group');
    setGroupEye(button, state, noun);
    return button;
}

export function setGroupEye(button, state, noun = button.dataset.noun || 'all') {
    if (!button) return;
    button.dataset.state = state;
    button.dataset.noun = noun;
    const title = state === 'on' ? `Hide ${noun}` : state === 'part' ? `Some are hidden - show ${noun}` : `Show ${noun}`;
    setEyeState(button, state, title);
}

export function linkButton(text, onClick, title = '') {
    const button = el('button', 'console-link', text);
    button.type = 'button';
    if (title) button.title = title;
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return button;
}

/** An on/off switch; 'part' (some of a group on) shows as off, and turns all on. */
export function eyeButton(state, onClick, title) {
    const button = el('button', 'console-eye');
    button.type = 'button';
    setEyeState(button, state, title);
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return button;
}

export function setEyeState(button, state, title) {
    button.classList.remove('on', 'part', 'off');
    button.classList.add(state);
    button.title = title;
    button.setAttribute('aria-label', title);
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(state === 'on'));
}

/**
 * A row's delete button, acting on its own. Its row goes at once: Find holds
 * a redraw while the pointer is over it, which would leave the row standing.
 */
export function deleteButton(title, onClick) {
    const button = el('button', 'console-zoom console-delete');
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.appendChild(icon('trash'));
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        button.closest('.console-row')?.remove();
        onClick();
    });
    return button;
}

export function layerThumb(layer, size = 32) {
    const thumb = LayerThumbnail.generate(layer, size, {
        interactive: false,
        layerDefaults: window.layerControl?._defaultStyles || {}
    });
    thumb.classList.add('console-thumb');
    return thumb;
}

const GEOMETRY_ICONS = { Point: 'record-circle', LineString: 'bezier2', Polygon: 'pentagon' };

/** A feature's icon by its geometry: point, line or area. */
export function geometryIcon(geometry) {
    const type = geometry?.type === 'GeometryCollection' ? geometry.geometries?.[0]?.type : geometry?.type;
    return GEOMETRY_ICONS[String(type || '').replace(/^Multi/, '')] || 'bounding-box-circles';
}

export function iconThumb(name) {
    const thumb = el('span', 'console-thumb console-thumb-icon');
    thumb.appendChild(icon(name));
    return thumb;
}

export function imageThumb(src, fallbackIcon = 'map') {
    if (!src) return iconThumb(fallbackIcon);
    const thumb = el('span', 'console-thumb console-thumb-image');
    const img = el('img');
    img.src = src;
    img.alt = '';
    thumb.appendChild(img);
    return thumb;
}

/**
 * A list row. `onClick` is the row's primary action (open details, select);
 * `trailing` is an optional control on the right that acts on its own.
 */
export function row({ thumb = null, title, star = null, note = '', meta = '', trailing = null, onClick = null, onEnter = null, onLeave = null, className = '' }) {
    const node = el('div', `console-row ${className}`.trim());
    if (onClick) {
        node.setAttribute('role', 'button');
        node.tabIndex = 0;
        node.addEventListener('click', onClick);
        node.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target === node) onClick(e);
        });
    }
    if (onEnter) node.addEventListener('mouseenter', onEnter);
    if (onLeave) node.addEventListener('mouseleave', onLeave);

    if (thumb) node.appendChild(thumb);
    const text = el('div', 'console-row-text');
    const titleEl = text.appendChild(el('div', 'console-row-title', title));
    if (star) titleEl.prepend(star);
    if (note) titleEl.append(' ', el('span', 'console-row-note', note));
    if (meta) text.appendChild(el('div', 'console-row-meta', meta));
    node.appendChild(text);
    if (trailing) node.appendChild(trailing);
    return node;
}

export function chevron() {
    const node = icon('chevron-right');
    node.classList.add('console-row-go');
    return node;
}

export function moreRow(text, onClick) {
    const node = el('button', 'console-more', text);
    node.type = 'button';
    node.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return node;
}

export function hint(text) {
    return el('div', 'console-hint', text);
}

const SAFE_URL = /^(https?:|mailto:|\/|#|\.)/i;

/**
 * Config HTML (a description, an attribution) as text, keeping its links -
 * and only those - clickable; null when it has no text.
 */
export function richText(html, className = '') {
    const holder = document.createElement('template');
    holder.innerHTML = String(html || '');
    const out = el('span', className);
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

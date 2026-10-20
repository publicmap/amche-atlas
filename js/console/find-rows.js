/**
 * Shared building blocks for every list in the map console (js/map-control-bar.js):
 * one row shape (thumbnail, title over meta, trailing action), one section label,
 * one eye toggle. Find's results, its browse sections and the on-map list all use
 * these, so the console reads as a single component.
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
    const label = el('div', 'console-label');
    label.appendChild(el('span', '', text));
    if (extras.length) {
        const side = el('span', 'console-label-side');
        side.append(...extras.filter(Boolean));
        label.appendChild(side);
    }
    return label;
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

/** state: 'on' | 'part' | 'off' */
export function eyeButton(state, onClick, title) {
    const button = el('button', `console-eye ${state}`);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.setAttribute('aria-pressed', String(state === 'on'));
    button.appendChild(icon(state === 'off' ? 'eye-slash' : 'eye'));
    button.addEventListener('click', (e) => {
        e.stopPropagation();
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
export function row({ thumb = null, title, meta = '', trailing = null, onClick = null, onEnter = null, onLeave = null, className = '' }) {
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
    text.appendChild(el('div', 'console-row-title', title));
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

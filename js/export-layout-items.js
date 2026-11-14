/**
 * Placement and styling of one element of the export page (js/export-layout.js).
 * A position is { ax, ay, x, y }: the anchor on each axis (left|center|right,
 * top|center|bottom) and the distance from that edge as a fraction of the page;
 * a centred axis has no distance.
 */
export const LABELS = { title: 'Title', description: 'Description', scale: 'Scale & north', qr: 'QR code', info: 'Date & link' };
export const DEFAULT_MARGIN = { x: 0.02, y: 0.03 };
export const DEFAULT_STYLE = { background: '#ffffff', backgroundOpacity: 1, color: null };

const pct = (fraction) => `${(fraction * 100).toFixed(3)}%`;

/** @param {number|null} top - a fraction from the top that overrides the vertical anchor */
export function applyPosition(item, position, top = null) {
    Object.assign(item.style, { left: '', right: '', top: '', bottom: '', transform: '' });
    const shift = { x: '0', y: '0' };

    if (position.ax === 'center') {
        item.style.left = '50%';
        shift.x = '-50%';
    } else {
        item.style[position.ax] = pct(position.x);
    }

    if (top !== null) {
        item.style.top = pct(top);
    } else if (position.ay === 'center') {
        item.style.top = '50%';
        shift.y = '-50%';
    } else {
        item.style[position.ay] = pct(position.y);
    }

    if (shift.x !== '0' || shift.y !== '0') item.style.transform = `translate(${shift.x}, ${shift.y})`;
}

/** The corner-anchored position of a box at left/top (px) on a page of W x H (px). */
export function positionFromBox(left, top, width, height, W, H) {
    const ax = left + width / 2 < W / 2 ? 'left' : 'right';
    const ay = top + height / 2 < H / 2 ? 'top' : 'bottom';
    return {
        ax,
        ay,
        x: ax === 'left' ? left / W : (W - left - width) / W,
        y: ay === 'top' ? top / H : (H - top - height) / H
    };
}

/** A position snapped to one of nine places on the page, e.g. 'top-left', 'center-center'. */
export function positionFromAnchor(anchor) {
    const [ay, ax] = anchor.split('-');
    return {
        ax,
        ay,
        x: ax === 'center' ? 0 : DEFAULT_MARGIN.x,
        y: ay === 'center' ? 0 : DEFAULT_MARGIN.y
    };
}

export function hexToRgba(hex, alpha) {
    const value = /^#?([0-9a-f]{6})$/i.exec(hex || '')?.[1] || 'ffffff';
    const n = parseInt(value, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function rgbToHex(rgb) {
    const parts = String(rgb).match(/\d+(\.\d+)?/g);
    if (!parts || parts.length < 3) return '#000000';
    return `#${parts.slice(0, 3).map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')}`;
}

export function applyStyle(item, style) {
    item.style.backgroundColor = hexToRgba(style.background, style.backgroundOpacity);
    item.style.color = style.color || '';
}

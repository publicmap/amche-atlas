/**
 * The unsaved-changes badge on a layer thumbnail (js/layer-thumbnail.js): a
 * dot in its top-right corner when the map differs from its configured value
 * (js/layer-customizations.js). Hovering, focusing or clicking it shows a
 * tooltip listing each change - configured value → the value the link applies
 * - under an "N Unsaved Changes" summary; the summary opens the layer editor
 * (map-creator.html) in edit mode, the one place changes can be saved.
 */
import { layerCustomizations, formatValue } from './layer-customizations.js';

const STYLE_ID = 'layer-change-badge-style';
const HIDE_DELAY = 250;
let openTip = null;

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideTip();
    });
    window.addEventListener('scroll', hideTip, true);
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .layer-change-badge { position: absolute; top: 2px; right: 2px; border-radius: 50%; background: #f59e0b;
            border: 1.5px solid #fff; box-shadow: 0 0 2px rgba(0,0,0,.6); cursor: pointer; padding: 0; z-index: 2; }
        .layer-change-badge:focus-visible { outline: 2px solid #fbbf24; outline-offset: 1px; }
        .layer-change-tip { position: fixed; z-index: 10000; max-width: 280px; padding: 8px 10px; border-radius: 6px;
            background: #111827; color: #e5e7eb; border: 1px solid #374151; box-shadow: 0 6px 20px rgba(0,0,0,.45);
            font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .layer-change-tip button.layer-change-summary { display: flex; align-items: center; gap: 6px; width: 100%; padding: 0 0 6px;
            margin: 0 0 6px; border: 0; border-bottom: 1px solid #374151; background: none; color: #fbbf24; font: inherit;
            font-weight: 600; cursor: pointer; text-align: left; }
        .layer-change-tip button.layer-change-summary:hover { color: #fde68a; }
        .layer-change-tip ul { margin: 0; padding: 0; list-style: none; }
        .layer-change-tip li { margin: 2px 0; overflow-wrap: anywhere; }
        .layer-change-tip .field { color: #9ca3af; }
        .layer-change-tip .was { color: #9ca3af; text-decoration: line-through; }
        .layer-change-tip .note { margin-top: 6px; color: #9ca3af; font-size: 11px; }`;
    document.head.appendChild(style);
}

function openEditor(layer) {
    window.parent.postMessage({ type: 'open-layer-info', layer: JSON.parse(JSON.stringify(layer)), edit: true }, '*');
}

function hideTip() {
    if (!openTip) return;
    clearTimeout(openTip.timer);
    openTip.el.remove();
    openTip = null;
}

function showTip(badge, layer, changes) {
    if (openTip?.badge === badge) {
        clearTimeout(openTip.timer);
        return;
    }
    hideTip();
    const tip = document.createElement('div');
    tip.className = 'layer-change-tip';
    tip.setAttribute('role', 'tooltip');
    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'layer-change-summary';
    summary.textContent = `${changes.length} Unsaved Change${changes.length === 1 ? '' : 's'} ›`;
    summary.title = 'Open the layer editor to save';
    summary.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTip();
        openEditor(layer);
    });
    const list = document.createElement('ul');
    changes.forEach(({ field, value, configured }) => {
        const item = document.createElement('li');
        const name = Object.assign(document.createElement('span'), { className: 'field', textContent: `${field}: ` });
        const was = Object.assign(document.createElement('span'), { className: 'was', textContent: formatValue(configured, 24) });
        item.append(name, was, ` → ${formatValue(value)}`);
        list.appendChild(item);
    });
    const note = Object.assign(document.createElement('div'), { className: 'note', textContent: 'Applied for now through the link (?layers=). Open the editor to save.' });
    tip.append(summary, list, note);
    document.body.appendChild(tip);

    const box = badge.getBoundingClientRect();
    const left = Math.min(Math.max(8, box.left), window.innerWidth - tip.offsetWidth - 8);
    const below = box.bottom + 6 + tip.offsetHeight < window.innerHeight;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? box.bottom + 6 : Math.max(8, box.top - tip.offsetHeight - 6)}px`;

    openTip = { badge, el: tip, timer: null };
    const keep = () => clearTimeout(openTip?.timer);
    const leave = () => {
        if (!openTip) return;
        clearTimeout(openTip.timer);
        openTip.timer = setTimeout(hideTip, HIDE_DELAY);
    };
    tip.addEventListener('mouseenter', keep);
    tip.addEventListener('mouseleave', leave);
    badge._leave = leave;
}

/** The badge for a thumbnail `size` pixels square, or null when the layer has no changes. */
export function changeBadge(layer, size) {
    if (size < 20) return null;
    const changes = layerCustomizations(layer);
    if (!changes.length) return null;
    ensureStyles();
    const dot = Math.max(8, Math.round(size * 0.26));
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'layer-change-badge';
    badge.style.width = badge.style.height = `${dot}px`;
    const label = `${changes.length} unsaved change${changes.length === 1 ? '' : 's'}`;
    badge.setAttribute('aria-label', label);
    badge.addEventListener('mouseenter', () => showTip(badge, layer, changes));
    badge.addEventListener('mouseleave', () => badge._leave?.());
    badge.addEventListener('focus', () => showTip(badge, layer, changes));
    badge.addEventListener('blur', () => badge._leave?.());
    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openTip?.badge === badge) clearTimeout(openTip.timer);
        else showTip(badge, layer, changes);
    });
    return badge;
}

/**
 * The map console's Share panel for pins (Explore mode, js/map-control-bar.js),
 * opened from the Share link on Find's Pins list.
 *
 * Share offers the two homes docs/API.md describes ("Atlas-level markers and
 * routes"): the share link, which already carries every pin in `?markers=` and
 * every route in `?layers=`, or the atlas config, as the `markers` / `routes`
 * JSON to paste into the atlas file. Both are read from the current URL, so
 * they hold exactly what a shared link would.
 */
import { el, icon } from './find-rows.js';
import { parseMarkersParam } from '../marker-registry.js';
import { URLUtils } from '../map-utils.js';
import { atlasPinsJson } from '../atlas-pins.js';

const ROUTE_CALL_RE = /^([A-Za-z0-9-]*)\((.*)\)$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function decode(value) {
    try { return decodeURIComponent(value); } catch (error) { return value; }
}

function parseRoute({ rid, id }) {
    const call = ROUTE_CALL_RE.exec(id || '');
    if (!rid || !call) return null;
    const args = call[2].split(',').map(decode).filter(Boolean);
    const color = HEX_COLOR_RE.test(args[args.length - 1] || '') ? args.pop() : null;
    const [engine, ...profile] = call[1] ? call[1].split('-') : [];
    return { rid, markerIds: args, engine: engine || null, profile: profile.join('-') || null, color };
}

/** The pins and routes the current link carries. */
export function currentPins() {
    const params = new URLSearchParams(window.location.search);
    const markers = parseMarkersParam(params.get('markers') || window.amche?.atlasMarkersParam || '');
    const routes = URLUtils.parseLayersFromUrl(params.get('layers') || '')
        .filter(layer => layer.type === 'route')
        .map(parseRoute)
        .filter(Boolean);
    return { markers, routes };
}

/** The `markers` / `routes` keys, one pin or route per line, ready to paste. */
function configSnippet({ markers, routes }) {
    const list = (items) => items.length
        ? `[\n${items.map(item => `  {${Object.entries(item).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(', ')}}`).join(',\n')}\n]`
        : '[]';
    return `"markers": ${list(markers)},\n"routes": ${list(routes)}`;
}

function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

async function copy(text, button, done = 'Copied') {
    const label = button.querySelector('span');
    const before = label.textContent;
    try {
        await navigator.clipboard.writeText(text);
        label.textContent = done;
    } catch (error) {
        label.textContent = 'Select and copy';
    }
    setTimeout(() => { label.textContent = before; }, 1600);
}

function copyButton(text, getText) {
    const button = el('button', 'console-copy');
    button.type = 'button';
    button.append(icon('clipboard'), el('span', '', text));
    button.addEventListener('click', () => copy(getText(), button));
    return button;
}

export class SharePanel {
    constructor({ onClose } = {}) {
        this._onClose = onClose;
        this._keep = 'link';
        this.el = el('div', 'console-share');
        this.el.hidden = true;
    }

    get isOpen() {
        return !this.el.hidden;
    }

    open() {
        this.el.hidden = false;
        this.render();
    }

    close() {
        this.el.hidden = true;
        this.el.replaceChildren();
    }

    render() {
        if (this.el.hidden) return;
        const { markers, routes } = currentPins();
        const registry = window.layerRegistry;
        const atlasId = registry?.getCurrentAtlas?.() || 'index';
        const meta = registry?.getAtlasMetadata?.(atlasId) || {};
        const atlasName = meta.name || atlasId;
        this.el.replaceChildren();

        const head = el('div', 'console-share-head');
        head.append(el('div', 'console-share-title', 'Share these pins'));
        const close = el('button', 'console-btn console-btn-sm');
        close.type = 'button';
        close.title = 'Close';
        close.setAttribute('aria-label', 'Close');
        close.appendChild(icon('x-lg'));
        close.addEventListener('click', () => this._onClose?.());
        head.appendChild(close);
        this.el.appendChild(head);
        this.el.appendChild(el('div', 'console-share-sub', [plural(markers.length, 'pin'), plural(routes.length, 'route')].join(' · ')));

        const choice = el('div', 'console-share-choice');
        [['link', 'link-45deg', 'Share link', 'Only people you send it to see them'],
            ['config', 'code-slash', 'Atlas config', `Everyone who opens ${atlasName} sees them`]].forEach(([id, iconName, label, sub]) => {
            const option = el('button', 'console-share-option' + (this._keep === id ? ' selected' : ''));
            option.type = 'button';
            option.setAttribute('aria-pressed', String(this._keep === id));
            const title = el('span', 'console-share-option-title');
            title.append(icon(iconName), el('span', '', label));
            option.append(title, el('span', 'console-share-option-sub', sub));
            option.addEventListener('click', () => { this._keep = id; this.render(); });
            choice.appendChild(option);
        });
        this.el.appendChild(choice);

        const out = el('div', 'console-share-out');
        if (this._keep === 'link') {
            out.appendChild(el('div', 'console-share-url', window.location.href));
            const bar = el('div', 'console-share-bar');
            bar.append(el('span', '', 'The link already holds these pins and routes.'), copyButton('Copy link', () => window.location.href));
            out.appendChild(bar);
        } else {
            const body = configSnippet(atlasPinsJson(markers, routes));
            out.appendChild(el('pre', 'console-share-json', body));
            const file = meta.isImported ? 'the atlas JSON you loaded' : `config/${atlasId}.atlas.json`;
            const bar = el('div', 'console-share-bar');
            bar.append(el('span', '', `Paste at the top level of ${file}, in place of any markers and routes already there, then open a pull request.`),
                copyButton('Copy JSON', () => body));
            out.appendChild(bar);
        }
        this.el.appendChild(out);
    }
}

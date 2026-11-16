/**
 * The page's elements - title, description, scale & north arrow, QR code,
 * export info, and a legend group per map (js/export-layout-legend.js) - laid
 * over the export frame (js/export-frame.js) at the page's real size in mm and
 * scaled down to the frame, so what is on the map is what is exported.
 * Clicking one selects it and opens its editor in the Export panel (text,
 * background, opacity, position, a map's legend); it is dragged into place,
 * and a selected title or description is edited in place with a second click.
 * Positions and styles live in js/export-layout-items.js; the markup and
 * styles come from map-export-layout.html.
 */
import { LABELS, DEFAULT_STYLE, applyPosition, positionFromBox, positionFromAnchor, applyStyle, rgbToHex } from './export-layout-items.js';
import { bindInlineEditing, startInlineEditing } from './export-layout-editing.js';
import { LegendGroups, isLegendGroup, legendGroupId } from './export-layout-legend.js';

export const LAYOUT_ITEMS = ['title', 'description', 'scale', 'qr', 'info'];
export const PX_PER_MM = 96 / 25.4;

const EDITABLE = ['title', 'description'];
const TEXT_ITEMS = ['title', 'description', 'info'];
const DRAG_THRESHOLD = 3;
const FOLLOW_GAP_MM = 2;
const PLACEHOLDERS = { title: 'Add a title', description: 'Add a description' };

const DEFAULT_POSITIONS = {
    title: { ax: 'left', ay: 'top', x: 0.02, y: 0.03 },
    description: { follow: 'title' },
    info: { ax: 'left', ay: 'bottom', x: 0.02, y: 0.03 },
    qr: { ax: 'right', ay: 'top', x: 0.02, y: 0.03 },
    scale: { ax: 'right', ay: 'bottom', x: 0.02, y: 0.03 }
};

let templatePromise = null;

export function loadLayoutTemplate() {
    if (!templatePromise) {
        templatePromise = fetch('map-export-layout.html')
            .then(response => {
                if (!response.ok) throw new Error(`Export layout template: ${response.status}`);
                return response.text();
            })
            .then(html => {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const page = doc.getElementById('export-layout-template');
                const style = doc.getElementById('export-layout-style');
                if (!page || !style) throw new Error('Export layout template not found');
                return { page, css: style.textContent };
            })
            .catch(error => {
                templatePromise = null;
                throw error;
            });
    }
    return templatePromise;
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function addOnce(id, create) {
    if (!document.getElementById(id)) document.head.appendChild(Object.assign(create(), { id }));
}

export class ExportLayout {
    constructor({ onInteractionStart, onInteractionEnd, onTextChange, onSelectionChange, onLegendChange } = {}) {
        this.el = null;
        this.page = { widthMm: 297, heightMm: 210 };
        this._callbacks = { onInteractionStart, onInteractionEnd, onTextChange, onSelectionChange, onLegendChange };
        this._positions = structuredClone(DEFAULT_POSITIONS);
        this._styles = Object.fromEntries(LAYOUT_ITEMS.map(name => [name, { ...DEFAULT_STYLE }]));
        this._visible = Object.fromEntries(LAYOUT_ITEMS.map(name => [name, true]));
        this._labels = { ...LABELS };
        this._customized = { title: false, description: false };
        this._text = { title: '', description: '' };
        this._items = {};
        this._selected = null;
        this._mounting = null;
        this.legend = new LegendGroups(this);
    }

    mount(parent) {
        if (!this._mounting) this._mounting = this._build(parent).catch(error => {
            this._mounting = null;
            throw error;
        });
        return this._mounting;
    }

    async _build(parent) {
        const { page, css } = await loadLayoutTemplate();
        addOnce('export-layout-style', () => Object.assign(document.createElement('style'), { textContent: css }));
        addOnce('export-layout-font', () => Object.assign(document.createElement('link'), {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap'
        }));

        const el = document.importNode(page, true);
        el.removeAttribute('id');
        el.className = 'export-layout';
        el.querySelectorAll('[data-export-item^="layer:"]').forEach(example => example.remove());
        LAYOUT_ITEMS.forEach(name => {
            const item = el.querySelector(`[data-export-item="${name}"]`);
            if (!item) return;
            item.removeAttribute('style');
            if (EDITABLE.includes(name)) {
                item.dataset.placeholder = PLACEHOLDERS[name];
                item.textContent = this._text[name];
                bindInlineEditing(item, {
                    multiline: name !== 'title',
                    onInput: () => this._place('description'),
                    onDone: (text) => this._setText(name, text)
                });
            }
            this.registerItem(name, item);
        });
        const qr = el.querySelector('[data-export-qr]');
        if (qr) qr.replaceChildren(document.createElement('sl-qr-code'));

        parent.appendChild(el);
        this.el = el;
        this.setPage(this.page.widthMm, this.page.heightMm);
        return el;
    }

    /** Make an element of the page selectable, draggable and styled. */
    registerItem(name, item) {
        this._items[name] = item;
        this._styles[name] ??= { ...DEFAULT_STYLE };
        this._visible[name] ??= true;
        item.hidden = !this._visible[name];
        item.title = `${this._labels[name] || name}: click to edit, drag to move`;
        item.addEventListener('pointerdown', (e) => this._onPointerDown(e, name));
        applyStyle(item, this._styles[name]);
    }

    removeItem(name) {
        if (this._selected === name) this.select(null);
        this._items[name]?.remove();
        delete this._items[name];
    }

    setPage(widthMm, heightMm) {
        this.page = { widthMm, heightMm };
        if (!this.el) return;
        this.el.style.width = `${widthMm}mm`;
        this.el.style.height = `${heightMm}mm`;
        this.placeAll();
    }

    /** Scale the page to the frame's on-screen width. */
    fit(frameWidthPx) {
        if (!this.el || !frameWidthPx) return;
        const scale = frameWidthPx / (this.page.widthMm * PX_PER_MM);
        this.el.style.transform = `scale(${scale})`;
        this.el.style.setProperty('--export-scale', String(scale));
    }

    setVisible(visibility = {}) {
        Object.entries(visibility).forEach(([name, visible]) => {
            this._visible[name] = !!visible;
            if (this._items[name]) this._items[name].hidden = !visible;
        });
        this.placeAll();
        this._notify();
        if (Object.keys(visibility).some(isLegendGroup)) this._callbacks.onLegendChange?.(this.legend.entries());
    }

    isVisible(name) {
        return this._visible[name] !== false;
    }

    /** Set a text unless the user has edited it, or always with force. */
    setText(name, text, { force = false } = {}) {
        if (!EDITABLE.includes(name) || (this._customized[name] && !force)) return;
        this._text[name] = text || '';
        if (force) this._customized[name] = false;
        const item = this._items[name];
        if (item && document.activeElement !== item) item.textContent = this._text[name];
        this.placeAll();
        if (this._selected === name) this._notify();
    }

    getText(name) {
        return this._text[name] || '';
    }

    isCustomized(name) {
        return !!this._customized[name];
    }

    // -- selection and the panel's editor ------------------------------------------

    select(name) {
        const next = name && this._items[name] ? name : null;
        if (next === this._selected) return;
        if (this._selected) this._items[this._selected]?.classList.remove('is-selected');
        this._selected = next;
        if (next) this._items[next].classList.add('is-selected');
        this._notify(true);
    }

    getState(name) {
        const item = this._items[name];
        if (!item) return null;
        const stored = this._positions[name] || { auto: true };
        const position = stored.follow || stored.auto ? this._measure(name) : stored;
        const style = this._styles[name];
        return {
            item: name,
            label: this._labels[name] || name,
            visible: this.isVisible(name),
            editable: EDITABLE.includes(name),
            text: EDITABLE.includes(name) ? this._text[name] : null,
            textColor: TEXT_ITEMS.includes(name) ? (style.color || rgbToHex(getComputedStyle(item).color)) : null,
            background: style.background,
            backgroundOpacity: style.backgroundOpacity,
            position: {
                ax: position.ax,
                ay: position.ay,
                x: Math.round(position.x * 1000) / 10,
                y: Math.round(position.y * 1000) / 10,
                follows: stored.follow ? this._labels[stored.follow] : null,
                arranged: !!stored.auto
            },
            legend: isLegendGroup(name) ? this.legend.entry(legendGroupId(name)) : null
        };
    }

    /** Changes from the panel's editor. */
    update(name, changes = {}) {
        if (!this._items[name]) return;
        if (typeof changes.text === 'string' && EDITABLE.includes(name)) {
            this._items[name].textContent = changes.text;
            this._setText(name, changes.text, false);
        }
        if (typeof changes.visible === 'boolean') this.setVisible({ [name]: changes.visible });
        const style = this._styles[name];
        if (changes.background) style.background = changes.background;
        if (typeof changes.backgroundOpacity === 'number') style.backgroundOpacity = clamp(changes.backgroundOpacity, 0, 1);
        if (changes.textColor) style.color = changes.textColor;
        applyStyle(this._items[name], style);

        if (changes.anchor) this._positions[name] = positionFromAnchor(changes.anchor);
        if (changes.arrange) this._positions[name] = { auto: true };
        if (typeof changes.x === 'number' || typeof changes.y === 'number') {
            const stored = this._positions[name] || { auto: true };
            const position = stored.follow || stored.auto ? this._measure(name) : { ...stored };
            if (typeof changes.x === 'number' && position.ax !== 'center') position.x = clamp(changes.x / 100, 0, 0.95);
            if (typeof changes.y === 'number' && position.ay !== 'center') position.y = clamp(changes.y / 100, 0, 0.95);
            this._positions[name] = position;
        }
        if (typeof changes.detail === 'boolean' && isLegendGroup(name)) {
            this.legend.setDetail(legendGroupId(name), changes.detail);
        }
        this.placeAll();
        this._notify();
    }

    /** Each element's value in a line, for its row in the Export panel. */
    summaries() {
        const text = (value, empty) => (value || '').replace(/\s+/g, ' ').trim() || empty;
        const scale = this.el?.querySelector('[data-export-scale-label]')?.textContent;
        const qrBox = this.el?.querySelector('[data-export-qr]');
        return {
            title: text(this._text.title, 'No title yet'),
            description: text(this._text.description, 'No description yet - click to add one'),
            scale: scale ? `30 mm bar is ${scale}, north arrow` : 'Scale bar and north arrow',
            qr: qrBox?.style.width ? `${parseFloat(qrBox.style.width).toFixed(0)} mm, links to this view` : 'Links to this view',
            info: text(this._items.info?.textContent, 'Export date and the map’s link')
        };
    }

    /** Every element back in its default place, the legend groups back in their column. */
    resetPositions() {
        this._positions = { ...this._positions, ...structuredClone(DEFAULT_POSITIONS) };
        Object.keys(this._items).filter(isLegendGroup).forEach(name => { this._positions[name] = { auto: true }; });
        this.placeAll();
        this._notify();
    }

    /** One change to every legend group: { arrange } or { detail }. */
    updateLegendGroups(changes = {}) {
        const names = Object.keys(this._items).filter(isLegendGroup);
        if (changes.arrange) names.forEach(name => { this._positions[name] = { auto: true }; });
        if (typeof changes.detail === 'boolean') this.legend.setDetailAll(names.map(legendGroupId), changes.detail);
        this.placeAll();
        this._notify();
    }

    notifyIfSelected(name) {
        if (this._selected === name) this._notify();
    }

    _notify(always = false) {
        if (!this._selected && !always) return;
        this._callbacks.onSelectionChange?.(this._selected, this._selected ? this.getState(this._selected) : null);
    }

    // -- live values ---------------------------------------------------------------

    /** Live values on the preview: scale, north arrow, info line, QR code and the legend groups. */
    refresh({ map, scaleText, bearing = 0, infoText, shareUrl, qrMm }) {
        if (!this.el) return;
        const scale = this.el.querySelector('[data-export-scale-label]');
        if (scale && scaleText) scale.textContent = scaleText;
        const north = this.el.querySelector('.north-arrow-container');
        if (north) north.style.transform = bearing ? `rotate(${-bearing}deg)` : '';
        if (this._items.info && infoText) this._items.info.textContent = infoText;

        const qrBox = this.el.querySelector('[data-export-qr]');
        const qr = qrBox?.querySelector('sl-qr-code');
        if (qr && shareUrl) {
            qrBox.style.width = qrBox.style.height = `${qrMm}mm`;
            qr.size = Math.round(qrMm * PX_PER_MM);
            qr.value = shareUrl;
        }
        this.legend.refresh(map);
        this.placeAll();
    }

    /**
     * The page as it will be exported, imported into doc: hidden and empty
     * elements left out, editing state stripped, the QR box emptied for the
     * export's own high-resolution code.
     */
    exportClone(doc) {
        if (!this.el) return null;
        const page = doc.importNode(this.el, true);
        page.style.transform = '';
        page.style.removeProperty('--export-scale');
        page.querySelectorAll('[data-export-item]').forEach(item => {
            const name = item.dataset.exportItem;
            const empty = TEXT_ITEMS.includes(name) && !item.textContent.trim();
            if (item.hidden || empty) {
                item.remove();
                return;
            }
            item.removeAttribute('contenteditable');
            item.removeAttribute('title');
            item.classList.remove('is-editing', 'is-dragging', 'is-selected');
        });
        page.querySelector('[data-export-qr]')?.replaceChildren();
        return page;
    }

    // -- placement ---------------------------------------------------------------

    placeAll() {
        if (!this.el) return;
        LAYOUT_ITEMS.forEach(name => this._place(name));
        this.legend.placeAll((name) => this._positions[name] && !this._positions[name].auto);
    }

    /** Whether an element is shown at its default place - the legend column keeps clear of it. */
    atDefault(name) {
        const position = this._positions[name];
        const fallback = DEFAULT_POSITIONS[name];
        return !!this._items[name] && !this._items[name].hidden && !!fallback
            && position.ax === fallback.ax && position.ay === fallback.ay;
    }

    _place(name) {
        const item = this._items[name];
        const position = this._positions[name];
        if (!item || !position || position.auto) return;
        if (!position.follow) {
            applyPosition(item, position);
            return;
        }
        const lead = this._items[position.follow];
        const leadPosition = this._positions[position.follow];
        const H = this.el.offsetHeight;
        let top = null;
        if (lead && !lead.hidden && H) {
            const gap = FOLLOW_GAP_MM * PX_PER_MM;
            const leadTop = lead.offsetTop - (leadPosition.ay === 'center' ? lead.offsetHeight / 2 : 0);
            top = leadTop + lead.offsetHeight + gap;
            if (top + item.offsetHeight > H) top = Math.max(0, leadTop - gap - item.offsetHeight);
            top /= H;
        }
        applyPosition(item, leadPosition, top);
    }

    // Where an element is now, as a corner-anchored position
    _measure(name) {
        const pageRect = this.el.getBoundingClientRect();
        const rect = this._items[name].getBoundingClientRect();
        if (!pageRect.width || !pageRect.height) return { ...DEFAULT_POSITIONS.title };
        return positionFromBox(rect.left - pageRect.left, rect.top - pageRect.top, rect.width, rect.height, pageRect.width, pageRect.height);
    }

    _onPointerDown(e, name) {
        const item = this._items[name];
        if (e.button !== 0 || !this.el) return;
        if (item.isContentEditable && document.activeElement === item) return;
        e.preventDefault();
        e.stopPropagation();

        const wasSelected = this._selected === name;
        const pageRect = this.el.getBoundingClientRect();
        const rect = item.getBoundingClientRect();
        const start = { x: e.clientX, y: e.clientY, left: rect.left - pageRect.left, top: rect.top - pageRect.top };
        let dragged = null;

        const move = (ev) => {
            const dx = ev.clientX - start.x;
            const dy = ev.clientY - start.y;
            if (!dragged) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                item.classList.add('is-dragging');
                this.select(name);
                this._callbacks.onInteractionStart?.();
            }
            dragged = {
                left: clamp(start.left + dx, 0, pageRect.width - rect.width),
                top: clamp(start.top + dy, 0, pageRect.height - rect.height)
            };
            Object.assign(item.style, {
                right: '', bottom: '', transform: '',
                left: `${(dragged.left / pageRect.width) * 100}%`,
                top: `${(dragged.top / pageRect.height) * 100}%`
            });
            if (name === 'title') this._place('description');
        };
        const up = (ev) => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            document.removeEventListener('pointercancel', up);
            if (dragged) {
                item.classList.remove('is-dragging');
                this._positions[name] = positionFromBox(dragged.left, dragged.top, rect.width, rect.height, pageRect.width, pageRect.height);
                this.placeAll();
                this._notify();
                this._callbacks.onInteractionEnd?.();
            } else if (ev.type === 'pointerup') {
                if (wasSelected && EDITABLE.includes(name)) startInlineEditing(item, ev);
                else this.select(name);
            }
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
    }

    _setText(name, text, fromMap = true) {
        if (text === this._text[name]) return;
        this._text[name] = text;
        this._customized[name] = true;
        this._callbacks.onTextChange?.(name, text);
        this.placeAll();
        if (fromMap) this._notify();
    }
}

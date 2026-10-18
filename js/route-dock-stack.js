import { DIRECTIONS_PROFILES } from './search/directions-profile.js';

const BUTTON_HEIGHT = 28;
const BUTTON_GAP = 6;
const DRAG_THRESHOLD = 4;

export const ROUTE_BUTTON_HEIGHT = BUTTON_HEIGHT;
export const ROUTE_BUTTON_GAP = BUTTON_GAP;

const STOP_EVENTS = ['mousedown', 'touchstart', 'dblclick', 'contextmenu'];
const ACTION_STYLE = 'display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;background:transparent;border:none;border-radius:50%;cursor:pointer;color:#9ca3af;font-size:14px;';

/**
 * One button per route in a column above the marker stack. Clicking toggles
 * the route as a filter on the marker list; dragging reorders the buttons. A
 * selected button also offers rename, another travel mode, and delete.
 * Buttons are kept between renders (keyed by route id) so a drag or an edit in
 * progress is not torn down by the layout that follows every map move.
 */
export class RouteDockStack {
    constructor(handlers) {
        this._handlers = handlers;
        this._els = new Map();
        this._ids = [];
        this._rows = new Map();
        this.draggingId = null;
        this._editingId = null;
        this._suppressClick = false;
        this._menu = null;
        document.addEventListener('pointerdown', (e) => {
            if (this._menu && !this._menu.contains(e.target)) this._closeMenu();
        }, true);
    }

    render(container, entries, rows, left) {
        let layer = container.querySelector(':scope > .marker-dock-routes');
        if (!entries.length) {
            layer?.remove();
            this._els.clear();
            this._menu = null;
            return;
        }
        if (!layer) {
            layer = document.createElement('div');
            layer.className = 'marker-dock-routes';
            layer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;overflow:visible;';
            container.appendChild(layer);
            this._els.clear();
        }
        const box = container.getBoundingClientRect();
        this._ids = entries.map(e => e.id);
        this._rows = rows;
        this._layer = layer;
        this._box = box;

        [...this._els].forEach(([id, el]) => {
            if (entries.some(e => e.id === id)) return;
            el.remove();
            this._els.delete(id);
        });

        entries.forEach(entry => {
            let el = this._els.get(entry.id);
            if (!el) {
                el = this._build(entry.id);
                this._els.set(entry.id, el);
                layer.appendChild(el);
            }
            this._style(el, entry);
            if (this.draggingId !== entry.id) {
                el.style.left = `${entry.left - box.left}px`;
                el.style.top = `${rows.get(entry.id).top - box.top}px`;
            }
        });
    }

    _style(el, { id, rid, name, meta, color, selected, hovered, profile }) {
        el.dataset.rid = rid;
        el.dataset.profile = profile || '';
        const dot = el.querySelector('.route-dock-dot');
        if (dot.value !== color) dot.value = color;
        dot.style.background = color;
        if (this._editingId !== id) {
            const label = el.querySelector('.route-dock-label');
            if (label.textContent !== name) label.textContent = name;
        }
        const metaEl = el.querySelector('.route-dock-meta');
        if (metaEl.textContent !== meta) metaEl.textContent = meta;
        el.querySelector('.route-dock-actions').style.display = selected ? 'flex' : 'none';
        el.style.borderColor = selected || hovered ? color : 'rgba(255,255,255,0.18)';
        el.style.background = selected ? 'rgba(17,24,39,0.96)' : 'rgba(31,41,55,0.8)';
        el.title = selected ? 'Show all markers' : `Show only the markers on ${name}`;
        el.setAttribute('aria-pressed', String(!!selected));
        if (!selected && this._editingId === id) this._endEdit(el, id);
    }

    _build(id) {
        const el = document.createElement('div');
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.className = 'route-dock-button';
        el.style.cssText = `position:absolute;height:${BUTTON_HEIGHT}px;display:flex;align-items:center;gap:6px;padding:0 4px 0 1px;box-sizing:border-box;border:1px solid;border-radius:14px;color:#f3f4f6;font:500 12px/1 inherit;font-family:inherit;white-space:nowrap;cursor:pointer;pointer-events:auto;touch-action:none;box-shadow:0 2px 8px rgba(0,0,0,0.35);`;
        el.innerHTML = `
            <input type="color" class="route-dock-dot" title="Route colour" style="width:14px;height:14px;padding:0;border:1.5px solid #fff;border-radius:50%;flex:none;cursor:pointer;background:none;-webkit-appearance:none;appearance:none;overflow:hidden;">
            <span class="route-dock-label"></span>
            <span class="route-dock-meta" style="color:#9ca3af;"></span>
            <span class="route-dock-actions" style="display:none;align-items:center;gap:0;margin-left:2px;">
                <button type="button" class="route-dock-edit" title="Rename route" style="${ACTION_STYLE}"><sl-icon name="pencil" style="pointer-events:none;"></sl-icon></button>
                <button type="button" class="route-dock-profile" title="Switch the routing profile" style="${ACTION_STYLE}"><sl-icon name="signpost-split" style="pointer-events:none;"></sl-icon></button>
                <button type="button" class="route-dock-reverse" title="Reverse the order of the stops" style="${ACTION_STYLE}"><sl-icon name="arrow-down-up" style="pointer-events:none;"></sl-icon></button>
                <button type="button" class="route-dock-mode" title="Add a route in another mode" style="${ACTION_STYLE}"><sl-icon name="plus-circle" style="pointer-events:none;"></sl-icon></button>
                <button type="button" class="route-dock-remove" title="Delete this route" style="${ACTION_STYLE}"><sl-icon name="trash" style="pointer-events:none;"></sl-icon></button>
            </span>
        `;
        STOP_EVENTS.forEach(type => el.addEventListener(type, e => e.stopPropagation()));
        el.querySelector('.route-dock-dot').addEventListener('input', e => this._handlers.onColor(id, e.target.value));
        el.addEventListener('click', e => {
            e.stopPropagation();
            if (this._suppressClick || e.target.closest('input')) return;
            const action = e.target.closest('button');
            if (action?.classList.contains('route-dock-edit')) return this._startEdit(el, id);
            if (action?.classList.contains('route-dock-reverse')) return this._handlers.onReverse(id);
            if (action?.classList.contains('route-dock-profile')) return this._openMenu(el, id, 'switch');
            if (action?.classList.contains('route-dock-mode')) return this._openMenu(el, id, 'add');
            if (action?.classList.contains('route-dock-remove')) return this._handlers.onRemove(id);
            this._handlers.onToggle(id);
        });
        el.addEventListener('mouseenter', () => { if (!this.draggingId) this._handlers.onHover(id); });
        el.addEventListener('mouseleave', () => this._handlers.onHover(null));
        el.addEventListener('pointerdown', down => {
            if (down.target.closest('button, input')) return;
            this._startDrag(id, el, down);
        });
        return el;
    }

    _startEdit(el, id) {
        if (this._editingId) return;
        this._editingId = id;
        const label = el.querySelector('.route-dock-label');
        const input = document.createElement('input');
        input.className = 'route-dock-input';
        input.value = el.dataset.rid || '';
        input.style.cssText = 'width:110px;height:20px;padding:0 6px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.3);border-radius:4px;color:#fff;font:inherit;outline:none;';
        label.textContent = '';
        label.appendChild(input);
        ['click', 'mousedown', 'pointerdown', 'keyup'].forEach(type => input.addEventListener(type, e => e.stopPropagation()));
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                if (this._handlers.onRename(id, input.value)) this._endEdit(el, id);
                else input.style.borderColor = '#ef4444';
            } else if (e.key === 'Escape') {
                this._endEdit(el, id);
            }
        });
        input.addEventListener('blur', () => this._endEdit(el, id));
        input.focus();
        input.select();
    }

    _endEdit(el, id) {
        if (this._editingId !== id) return;
        this._editingId = null;
        const label = el.querySelector('.route-dock-label');
        label.textContent = `route-${el.dataset.rid}`;
        this._handlers.onSettle();
    }

    _openMenu(el, id, kind = 'add') {
        this._closeMenu();
        const menu = document.createElement('div');
        menu.className = 'route-dock-menu';
        menu.style.cssText = `position:absolute;left:${el.offsetLeft}px;top:${el.offsetTop + BUTTON_HEIGHT + 4}px;z-index:2;display:flex;flex-direction:column;min-width:170px;padding:4px;background:#111827;border:1px solid rgba(255,255,255,0.3);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.45);pointer-events:auto;`;
        const title = document.createElement('div');
        title.textContent = kind === 'switch' ? 'Routing profile' : 'Add route as';
        title.style.cssText = 'padding:4px 8px;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;';
        menu.appendChild(title);
        DIRECTIONS_PROFILES.forEach(profile => {
            const item = document.createElement('button');
            item.type = 'button';
            item.textContent = kind === 'switch' && profile.id === el.dataset.profile ? `✓ ${profile.label}` : profile.label;
            item.style.cssText = 'text-align:left;padding:6px 8px;background:transparent;border:none;border-radius:4px;color:#f3f4f6;font:inherit;font-size:12px;cursor:pointer;';
            item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.12)'; });
            item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this._closeMenu();
                if (kind === 'switch') this._handlers.onSetProfile(id, profile.id);
                else this._handlers.onAddMode(id, profile.id);
            });
            menu.appendChild(item);
        });
        STOP_EVENTS.concat('click').forEach(type => menu.addEventListener(type, e => e.stopPropagation()));
        this._layer.appendChild(menu);
        this._menu = menu;
    }

    _closeMenu() {
        this._menu?.remove();
        this._menu = null;
    }

    _startDrag(id, el, down) {
        if (down.button > 0 || this._editingId) return;
        down.stopPropagation();
        const baseTop = parseFloat(el.style.top) || 0;
        let dragging = false;

        const move = (e) => {
            const dy = e.clientY - down.clientY;
            if (!dragging && Math.hypot(e.clientX - down.clientX, dy) < DRAG_THRESHOLD) return;
            if (!dragging) {
                dragging = true;
                this.draggingId = id;
                this._closeMenu();
                el.style.zIndex = '1';
                el.style.cursor = 'grabbing';
            }
            el.style.top = `${baseTop + dy}px`;
            const rect = el.getBoundingClientRect();
            const centre = rect.top + rect.height / 2;
            const others = this._ids.filter(other => other !== id);
            const index = others.filter(other => {
                const row = this._rows.get(other);
                return row && row.top + row.height / 2 < centre;
            }).length;
            others.splice(index, 0, id);
            if (others.some((other, i) => other !== this._ids[i])) this._handlers.onReorder(others);
            e.preventDefault();
        };
        const end = () => {
            window.removeEventListener('pointermove', move, true);
            window.removeEventListener('pointerup', end, true);
            window.removeEventListener('pointercancel', end, true);
            if (!dragging) return;
            this.draggingId = null;
            el.style.zIndex = '';
            el.style.cursor = 'pointer';
            this._suppressClick = true;
            setTimeout(() => { this._suppressClick = false; }, 0);
            this._handlers.onSettle();
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', end, true);
        window.addEventListener('pointercancel', end, true);
    }
}

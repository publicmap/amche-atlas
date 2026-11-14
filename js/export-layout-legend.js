/**
 * The export page's legend groups (js/export-layout.js): one element per map on
 * the map, built by js/export-legend.js, kept in step with the maps as they
 * change. Each is selected, moved, styled and shown or hidden like any other
 * element of the page; a group that hasn't been moved is arranged in a column
 * down the right of the page, between the QR code and the scale bar, and
 * wraps into another column to the left when it runs out of room.
 */
import { renderLegendGroups } from './export-legend.js';
import { applyPosition, DEFAULT_MARGIN } from './export-layout-items.js';

const PREFIX = 'layer:';
const PX_PER_MM = 96 / 25.4;
const GAP_MM = 2;

export const isLegendGroup = (name) => typeof name === 'string' && name.startsWith(PREFIX);
export const legendGroupId = (name) => name.slice(PREFIX.length);
export const legendGroupName = (id) => `${PREFIX}${id}`;

export class LegendGroups {
    constructor(layout) {
        this._layout = layout;
        this._entries = [];
        this._order = [];
        this._overrides = {};
        this._map = null;
        this._token = 0;
    }

    /** Every map's group, shown or not: { id, title, detail, hasDetail, visible }. */
    entries() {
        return this._entries.map(entry => ({ ...entry, visible: this._layout.isVisible(legendGroupName(entry.id)) }));
    }

    entry(id) {
        return this.entries().find(entry => entry.id === id) || null;
    }

    /** Per map, whether its detailed legend is shown, where the user has chosen. */
    overrides() {
        return structuredClone(this._overrides);
    }

    setDetail(id, detail) {
        this._overrides[id] = { ...this._overrides[id], detail };
        this.refresh();
    }

    refresh(map = this._map) {
        this._map = map;
        if (!this._layout.el || !map) return;
        const token = ++this._token;
        renderLegendGroups(document, { map, overrides: this._overrides })
            .then(groups => {
                if (token === this._token) this._sync(groups);
            })
            .catch(error => console.warn('[Export] Legend preview failed', error));
    }

    _sync(groups) {
        const layout = this._layout;
        const keep = new Set();
        groups.forEach(({ entry, content }) => {
            const name = legendGroupName(entry.id);
            keep.add(name);
            layout._labels[name] = entry.title;
            let item = layout._items[name];
            if (!item) {
                item = document.createElement('div');
                item.className = 'export-item legend-group';
                item.dataset.exportItem = name;
                layout.el.appendChild(item);
                layout._positions[name] ??= { auto: true };
                layout.registerItem(name, item);
            }
            item.replaceChildren(content);
        });
        Object.keys(layout._items)
            .filter(name => isLegendGroup(name) && !keep.has(name))
            .forEach(name => layout.removeItem(name));

        this._order = groups.map(group => legendGroupName(group.entry.id));
        this._entries = groups.map(group => group.entry);
        layout.placeAll();
        layout._callbacks.onLegendChange?.(this.entries());
        if (isLegendGroup(layout._selected)) layout.notifyIfSelected(layout._selected);
    }

    /** @param {(name: string) => boolean} isPlaced - the group has a position of its own */
    placeAll(isPlaced) {
        const layout = this._layout;
        const W = layout.el?.offsetWidth;
        const H = layout.el?.offsetHeight;
        if (!W || !H) return;

        const column = [];
        this._order.forEach(name => {
            const item = layout._items[name];
            if (!item) return;
            if (isPlaced(name)) applyPosition(item, layout._positions[name]);
            else if (!item.hidden) column.push(item);
        });

        const gap = GAP_MM * PX_PER_MM;
        let top = DEFAULT_MARGIN.y * H;
        let bottom = H - DEFAULT_MARGIN.y * H;
        if (layout.atDefault('qr')) top = layout._items.qr.offsetTop + layout._items.qr.offsetHeight + gap;
        if (layout.atDefault('scale')) bottom = layout._items.scale.offsetTop - gap;

        let x = DEFAULT_MARGIN.x * W;
        let y = top;
        let columnWidth = 0;
        column.forEach(item => {
            const height = item.offsetHeight;
            if (y > top && y + height > bottom) {
                x += columnWidth + gap;
                y = top;
                columnWidth = 0;
            }
            applyPosition(item, { ax: 'right', ay: 'top', x: x / W, y: y / H });
            y += height + gap;
            columnWidth = Math.max(columnWidth, item.offsetWidth);
        });
    }
}

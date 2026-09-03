/**
 * LayerStackStrip - the vertical control column at the top-left of the map:
 * the map-browser toggle (MapBrowserControl's own button, moved in here),
 * followed by one thumbnail per layer currently visible on the map.
 *
 * The toggle is fixed and built once at mount; only the layer thumbnails are
 * rebuilt by render(), so the button keeps its identity and open/closed state
 * across refreshes.
 *
 * Order matches the map's visual stack as defined by LayerOrderManager:
 * MapLayerControl._state.groups is already held in config/visual/URL order
 * (first = on top), so only the overlay/basemap split is applied - overlays
 * first, then basemaps - and the strip is painted top-to-bottom in that order.
 *
 * The column ends with an always-visible options button, that opens the
 * map/selection shortcuts shared with the right-click menu (see
 * LayerStackOptionsMenu), followed by an import and an export button that
 * are only revealed while the pointer is over the strip.
 *
 * Each thumbnail is a LayerThumbnail, so clicking one opens that layer's info
 * panel (or zooms to it when it's out of view) exactly like the thumbnails in
 * map-browser.html. Hovering a thumbnail reveals a flyout with the layer name,
 * its atlas and shortcut actions; hovering the name itself isolates that layer
 * through MapLayerControl's shared LayerIsolationManager.
 */
import { LayerThumbnail } from './layer-thumbnail.js';
import { LayerOrderManager } from './layer-order-manager.js';
import { LayerStackOptionsMenu } from './layer-stack-options-menu.js';

const THUMB_SIZE = 36;

export class LayerStackStrip {
    constructor() {
        this._el = null;
        this._signature = null;
        this._pendingRender = false;
        this._refreshTimer = null;
        this._clearIsolationTimer = null;
        this._reorderTimer = null;
        this._draggedItem = null;
        this._importItem = null;
        this._exportItem = null;
        this._optionsItem = null;
        this._optionsMenu = null;
        // Debounced: window.urlManager's active-layers state updates on its own
        // 300ms debounce (see CLAUDE.md), so reading it synchronously on
        // 'layer-toggled' would render from stale state.
        this._onChange = () => {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => this.render(), 400);
        };
    }

    /**
     * @param {HTMLElement} hostEl - the map control container to render into
     * @param {HTMLElement} [browserButton] - MapBrowserControl's toggle button,
     *   adopted as the first item in the stack rather than sitting in the search row
     * @param {Object} [map] - the map the options menu's actions act on
     */
    mount(hostEl, { browserButton = null, map = null } = {}) {
        if (!hostEl || this._el) return;

        this._el = document.createElement('div');
        this._el.className = 'layer-stack-strip';
        // A refresh that arrived while the pointer was inside was deferred rather
        // than yanking a row out from under it; run it once the pointer leaves.
        // Nothing else fires here - the map may never go idle again on its own.
        this._el.addEventListener('mouseleave', () => {
            if (this._pendingRender) this.render();
        });
        // Dragging out of the column drops the indicator. Checked by coordinates
        // because a drag event's relatedTarget is always null.
        this._el.addEventListener('dragleave', (e) => {
            const rect = this._el.getBoundingClientRect();
            const outside = e.clientX < rect.left || e.clientX > rect.right ||
                e.clientY < rect.top || e.clientY > rect.bottom;
            if (outside) this._clearDropIndicators();
        });
        hostEl.appendChild(this._el);

        this._mountBrowserItem(browserButton);
        this._mountOptionsItem(map);
        this._mountImportItem();
        this._mountExportItem();

        // 'layersInitialized' is the signal that MapLayerControl has finished
        // building the groups this strip reads (it fires well after the control
        // is added to the map); the other two keep it in sync afterwards.
        window.addEventListener('layersInitialized', this._onChange);
        window.addEventListener('layer-toggled', this._onChange);
        window.addEventListener('urlUpdated', this._onChange);

        // The event may already have fired by the time this mounts.
        if (window.layersInitialized) this._onChange();
    }

    setVisible(visible) {
        if (!this._el) return;
        // Hiding the strip pulls it out from under the cursor, so no mouseleave
        // ever fires — drop any isolation it left applied.
        if (!visible) {
            this._clearIsolation({ immediate: true });
            this._optionsMenu?.close();
        }
        this._el.style.display = visible ? '' : 'none';
    }

    /**
     * Isolation is applied straight away, but clearing it is deferred by a frame
     * or two: moving the cursor from one layer name to the next fires mouseleave
     * before mouseenter, and letting that clear land would tear the whole stack
     * back on and immediately re-isolate - the visible lag between neighbours.
     * A pending clear is cancelled by the next isolate, so a name-to-name move
     * is a single re-isolation.
     */
    _isolate(layerId, isBasemap) {
        if (this._draggedItem) return;
        clearTimeout(this._clearIsolationTimer);
        window.layerControl?.isolation?.hoverIsolate(layerId, isBasemap);
    }

    _clearIsolation({ immediate = false } = {}) {
        clearTimeout(this._clearIsolationTimer);
        const clear = () => window.layerControl?.isolation?.clearHover();
        if (immediate) clear();
        else this._clearIsolationTimer = setTimeout(clear, 60);
    }

    destroy() {
        window.removeEventListener('layersInitialized', this._onChange);
        window.removeEventListener('layer-toggled', this._onChange);
        window.removeEventListener('urlUpdated', this._onChange);
        clearTimeout(this._refreshTimer);
        clearTimeout(this._reorderTimer);
        this._clearIsolation({ immediate: true });
        this._optionsMenu?.unmount();
        this._optionsMenu = null;
        this._optionsItem = null;
        this._exportItem = null;
        this._importItem = null;
        if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
        this._el = null;
    }

    /**
     * Rebuilds the strip, but only when the visible set or its order actually
     * changed - it is also called on every map 'idle' as a self-heal, so the
     * no-change case has to stay cheap.
     */
    render({ force = false } = {}) {
        if (!this._el) return;

        // Rebuilding mid-hover would drop the row (and its open flyout) out from
        // under the cursor - and with the isolation the hover applied still on the
        // map. Defer to the strip's mouseleave instead. A reorder forces the
        // rebuild, since the whole point of it is that the row moves.
        if (!force && this._el.querySelector('.layer-stack-item:hover')) {
            this._pendingRender = true;
            return;
        }
        this._pendingRender = false;

        const layers = this._getVisibleLayers();
        const comparedId = this._getComparedLayerId();
        const signature = layers.map(l => l.id).join(',') + `|compare:${comparedId}`;
        if (!force && signature === this._signature) return;
        this._signature = signature;

        // Layer items sit alongside the fixed toggle, so replace only the ones
        // this method owns.
        this._el.querySelectorAll('[data-layer-item]').forEach(el => el.remove());

        // Reordering happens within a section, so each row needs its position in
        // its own list to know whether it can still move up or down.
        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(layers);

        [overlays, basemaps].forEach((list, section) => {
            list.forEach((layer, index) => {
                const item = this._createItem(layer, { index, total: list.length, comparedId });
                // The two groups meet at the first basemap, which carries the rule
                if (section === 1 && index === 0 && overlays.length) {
                    item.classList.add('layer-stack-basemap-start');
                }
                this._el.appendChild(item);
            });
        });

        // The options, import and export controls belong at the foot of the
        // column, and the layer rows were just appended after them. Options
        // is always visible; import/export only reveal on hover (see the CSS).
        if (this._optionsItem) this._el.appendChild(this._optionsItem);
        if (this._importItem) this._el.appendChild(this._importItem);
        if (this._exportItem) this._el.appendChild(this._exportItem);
    }

    /**
     * Move a layer one place up or down its own section of the stack, using the
     * same `reorder-layers` message (and so the same code path) as this strip's
     * own drag-to-reorder below. Sections are independent lists in that protocol:
     * an overlay cannot be dragged into the basemaps there either.
     *
     * @param {number} delta -1 to move up (towards the top of the map stack), +1 down
     */
    _moveLayer(layer, delta) {
        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(this._getVisibleLayers());
        const isBasemap = LayerOrderManager.isBasemap(layer);
        const ids = (isBasemap ? basemaps : overlays).map(l => l.id);

        const from = ids.indexOf(layer.id);
        const to = from + delta;
        if (from === -1 || to < 0 || to >= ids.length) return;

        ids.splice(to, 0, ids.splice(from, 1)[0]);

        this._post({
            type: 'reorder-layers',
            overlayOrder: isBasemap ? overlays.map(l => l.id) : ids,
            basemapOrder: isBasemap ? ids : basemaps.map(l => l.id)
        });

        this._scheduleReorderRepaint();
    }

    /**
     * postMessage is async and the handler rewrites layerControl._state.groups,
     * which is what _getVisibleLayers reads - repaint just after it lands so the
     * rounding, the basemap rule and the arrows' disabled states all follow the
     * new order. The isolation is dropped first because the rebuild replaces the
     * row under the cursor; the fresh row's own mouseenter re-applies it.
     */
    _scheduleReorderRepaint() {
        clearTimeout(this._reorderTimer);
        this._reorderTimer = setTimeout(() => {
            this._clearIsolation({ immediate: true });
            this.render({ force: true });
        }, 80);
    }

    /**
     * The fixed item at the head of the stack. The browser button is moved in
     * rather than recreated, so MapBrowserControl keeps driving its icon and
     * active state exactly as before.
     */
    _mountBrowserItem(browserButton) {
        if (!browserButton) return;

        const item = document.createElement('div');
        item.className = 'layer-stack-item layer-stack-control layer-stack-browser';

        browserButton.classList.add('layer-stack-cell');
        item.appendChild(browserButton);

        const label = document.createElement('div');
        label.className = 'layer-stack-label';
        const titleEl = document.createElement('div');
        titleEl.className = 'layer-stack-label-title';
        titleEl.textContent = 'Browse all maps';
        label.appendChild(titleEl);
        item.appendChild(label);

        this._el.appendChild(item);
    }

    /**
     * The import trigger, mounted right after the options control and before
     * export - both hover-revealed (see the CSS), unlike the always-visible
     * options button. Opens map-creator.html the same way the right-click
     * shortcut menu's "Import Map" entry does (see shortcut-menu-base.js):
     * the browser overlay has to be open for its iframe to be visible at all,
     * so this opens it first if needed before switching that iframe to the
     * creator.
     */
    _mountImportItem() {
        const item = document.createElement('div');
        item.className = 'layer-stack-item layer-stack-control layer-stack-import';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'layer-stack-cell layer-stack-import-btn';
        button.title = 'Import map';
        button.setAttribute('aria-label', 'Import map');
        const icon = document.createElement('sl-icon');
        icon.name = 'plus-circle';
        button.appendChild(icon);
        button.addEventListener('mouseenter', () => icon.setAttribute('name', 'plus-circle-fill'));
        button.addEventListener('mouseleave', () => icon.setAttribute('name', 'plus-circle'));
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!window.browserControl?._isOpen) window.browserControl?.openBrowser();
            window.browserControl?._switchToCreator();
        });

        item.appendChild(button);
        item.appendChild(this._createFooterLabel('Import Map'));
        this._el.appendChild(item);
        this._importItem = item;
    }

    /**
     * The export trigger, mounted last, after import - both hover-revealed
     * (see the CSS). MapExportControl isn't mounted as a map control (see
     * map-init.js) - its own message listener already handles 'toggle-export',
     * so this button just posts that rather than reaching into the control
     * directly.
     */
    _mountExportItem() {
        const item = document.createElement('div');
        item.className = 'layer-stack-item layer-stack-control layer-stack-export';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'layer-stack-cell layer-stack-export-btn';
        button.title = 'Export map';
        button.setAttribute('aria-label', 'Export map');
        button.innerHTML = '<sl-icon name="download"></sl-icon>';
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._post({ type: 'toggle-export' });
        });

        item.appendChild(button);
        item.appendChild(this._createFooterLabel('Export Map'));
        this._el.appendChild(item);
        this._exportItem = item;
    }

    /** Plain hover flyout (no atlas/shortcut-action row) for a footer control. */
    _createFooterLabel(text) {
        const label = document.createElement('div');
        label.className = 'layer-stack-label';
        const titleEl = document.createElement('div');
        titleEl.className = 'layer-stack-label-title';
        titleEl.textContent = text;
        label.appendChild(titleEl);
        return label;
    }

    /**
     * The first fixed control at the foot of the stack, always visible
     * (unlike the import/export buttons below it), opening the shared
     * shortcut actions. No flyout label - the menu opens into that same
     * space beside the column.
     */
    _mountOptionsItem(map) {
        const item = document.createElement('div');
        item.className = 'layer-stack-item layer-stack-control layer-stack-options';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'layer-stack-cell layer-stack-options-btn';
        button.title = 'Map and selection options';
        button.setAttribute('aria-label', 'Map and selection options');
        button.innerHTML = '<sl-icon name="three-dots"></sl-icon>';
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._optionsMenu?.toggle();
        });

        item.appendChild(button);
        this._el.appendChild(item);
        this._optionsItem = item;

        this._optionsMenu = new LayerStackOptionsMenu({
            onVisibilityChange: (open) => this._el?.classList.toggle('options-open', open)
        });
        this._optionsMenu.mount(map || window.map, button);
    }

    /**
     * Visible layers in URL/visual order (first = top of the map stack).
     * The group entries carry the live state (opacity, sublayers); the registry
     * entry carries the full resolved config the thumbnail draws from, so they
     * are merged with the group winning.
     */
    _getVisibleLayers() {
        const groups = window.layerControl?._state?.groups || [];
        const urlManager = window.urlManager;
        if (!urlManager) return [];

        const visible = [];
        groups.forEach((group, index) => {
            // Internal scratch layer for inspected features, not a browsable map
            if (group.id === 'selection') return;
            if (!urlManager.isGroupActive(index)) return;

            const registryLayer = window.layerRegistry?.getLayer?.(group.id);
            visible.push(registryLayer ? { ...registryLayer, ...group } : group);
        });

        return LayerOrderManager.mapOrderToUrlOrder(visible);
    }

    _createItem(layer, position = { index: 0, total: 1, comparedId: null }) {
        const item = document.createElement('div');
        item.className = 'layer-stack-item';
        item.dataset.layerItem = 'true';
        item.dataset.layerId = layer.id;
        item.dataset.basemap = String(LayerOrderManager.isBasemap(layer));

        const title = layer.title || layer.id;
        const atlasName = this._getAtlasName(layer);

        const thumbnail = LayerThumbnail.generate(layer, THUMB_SIZE, {
            layerDefaults: window.layerControl?._defaultStyles || {}
        });
        thumbnail.classList.add('layer-stack-cell');
        thumbnail.setAttribute('role', 'button');
        thumbnail.setAttribute('tabindex', '0');
        thumbnail.setAttribute('aria-label', atlasName ? `${title} (${atlasName})` : title);
        // The compared layer steps out of the column: a compare cell takes its slot
        // and the thumbnail is displaced to the right (see the CSS), so the layer
        // being swiped is obvious at a glance and can be switched off from here.
        if (position.comparedId && position.comparedId === layer.id) {
            item.classList.add('layer-stack-comparing');
            item.appendChild(this._createCompareCell(layer, title));
        }

        item.appendChild(thumbnail);

        // Flyout: the layer name (opens map-information.html), then the atlas name
        // followed by shortcut actions for the layer.
        const label = document.createElement('div');
        label.className = 'layer-stack-label';

        const titleBtn = document.createElement('button');
        titleBtn.type = 'button';
        titleBtn.className = 'layer-stack-label-title';
        titleBtn.textContent = title;
        titleBtn.title = `Open details for ${title}`;
        titleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._post({ type: 'open-layer-info', layer: this._serializable(layer) });
        });
        label.appendChild(titleBtn);

        const meta = document.createElement('div');
        meta.className = 'layer-stack-label-meta';

        if (atlasName) {
            const atlasEl = document.createElement('span');
            atlasEl.className = 'layer-stack-label-atlas';
            atlasEl.textContent = atlasName;
            meta.appendChild(atlasEl);
        }

        // Reorder within this layer's own section: up = towards the top of the
        // map stack (first in the URL), matching the strip's paint order.
        meta.appendChild(this._createLabelAction('arrow-up', '', `Move ${title} up`, () => {
            this._moveLayer(layer, -1);
        }, '', position.index === 0));
        meta.appendChild(this._createLabelAction('arrow-down', '', `Move ${title} down`, () => {
            this._moveLayer(layer, 1);
        }, '', position.index === position.total - 1));
        meta.appendChild(this._createLabelSeparator());

        meta.appendChild(this._createLabelAction('zoom-in', 'Zoom', `Zoom to ${title}`, () => {
            this._post({ type: 'zoom-to-layer', layerId: layer.id });
        }));
        meta.appendChild(this._createLabelSeparator());
        meta.appendChild(this._createLabelAction('trash', 'Remove', `Remove ${title} from the map`, () => {
            this._post({ type: 'remove-layer', layerId: layer.id });
        }, 'layer-stack-label-action-danger'));

        label.appendChild(meta);
        item.appendChild(label);

        // Isolation is bound to the name alone, not the whole row: hovering the
        // thumbnail only opens the flyout, and the map is left as it is until the
        // pointer reaches the name. Same effect the feature control's marker
        // badges apply - only this layer and the other section (overlay vs
        // basemap) stay visible.
        const isBasemap = LayerOrderManager.isBasemap(layer);
        const isolate = () => this._isolate(layer.id, isBasemap);
        const clearIsolation = () => this._clearIsolation();

        titleBtn.addEventListener('mouseenter', isolate);
        titleBtn.addEventListener('mouseleave', clearIsolation);
        titleBtn.addEventListener('focus', isolate);
        titleBtn.addEventListener('blur', clearIsolation);

        this._setupItemDrag(item);

        return item;
    }

    /**
     * The layer currently swiped via mapbox-gl-compare, owned by
     * MapFeatureControl (and mirrored in the ?compare= URL param).
     */
    _getComparedLayerId() {
        return window.featureControl?._compareLayerId || null;
    }

    /**
     * Stand-in cell shown in the compared layer's slot: clicking it turns the
     * comparison off, using the same `toggle-compare` message map-information.html
     * sends.
     */
    _createCompareCell(layer, title) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'layer-stack-compare-cell layer-stack-cell';
        button.title = `Stop comparing ${title}`;
        button.setAttribute('aria-label', `Stop comparing ${title}`);
        button.innerHTML = '<sl-icon name="caret-left"></sl-icon><sl-icon name="caret-right-fill"></sl-icon>';
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._post({ type: 'toggle-compare', layerId: layer.id, enabled: false });
            // Disabling rewrites the ?compare= param, but repaint on our own
            // schedule rather than waiting on that debounce.
            this._scheduleReorderRepaint();
        });
        return button;
    }

    /**
     * Drag a thumbnail to reorder: the drop indicator follows the midpoint of
     * the row under the pointer, the DOM is reordered on drop, and dragend
     * posts the resulting order as `reorder-layers`.
     *
     * Rows only accept a drop from their own section - overlays and basemaps
     * are separate orders in that message.
     */
    _setupItemDrag(item) {
        item.draggable = true;

        const sameSection = () => this._draggedItem &&
            this._draggedItem !== item &&
            this._draggedItem.dataset.basemap === item.dataset.basemap;

        // Which half of the row the pointer is in decides whether the dragged row
        // lands above or below it.
        const dropsAbove = (e) => {
            const rect = item.getBoundingClientRect();
            return e.clientY < rect.top + rect.height / 2;
        };

        item.addEventListener('dragstart', (e) => {
            this._draggedItem = item;
            item.classList.add('dragging');
            this._el.classList.add('dragging');
            // A hover isolation from the row we are picking up would otherwise
            // stay applied for the whole drag.
            this._clearIsolation({ immediate: true });
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.dataset.layerId || '');
        });

        // The row under the pointer owns the indicator and clears every other
        // one. There is deliberately no per-row dragleave: during an HTML5 drag
        // its relatedTarget is null, so a row cannot tell "pointer moved onto my
        // own thumbnail" from "pointer left me", and clearing on it made the
        // indicator flicker off the moment it appeared. Leaving the strip
        // entirely is handled once, on the strip itself (see _setupStripDrag).
        item.addEventListener('dragover', (e) => {
            if (!sameSection()) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this._clearDropIndicators(item);
            item.classList.toggle('drag-over-top', dropsAbove(e));
            item.classList.toggle('drag-over-bottom', !dropsAbove(e));
        });

        item.addEventListener('drop', (e) => {
            if (!sameSection()) return;
            e.preventDefault();
            item.parentNode.insertBefore(
                this._draggedItem,
                dropsAbove(e) ? item : item.nextSibling
            );
            this._clearDropIndicators();
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            this._el.classList.remove('dragging');
            this._clearDropIndicators();
            this._draggedItem = null;
            this._commitDragOrder();
        });
    }

    /** Drop indicator on every row except `keep`. */
    _clearDropIndicators(keep = null) {
        this._el.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
            if (el !== keep) el.classList.remove('drag-over-top', 'drag-over-bottom');
        });
    }

    /**
     * Read the order back out of the DOM after a drop and hand it to the same
     * `reorder-layers` handler the arrows above use.
     */
    _commitDragOrder() {
        const overlayOrder = [];
        const basemapOrder = [];
        this._el.querySelectorAll('[data-layer-item]').forEach(el => {
            (el.dataset.basemap === 'true' ? basemapOrder : overlayOrder).push(el.dataset.layerId);
        });

        this._post({ type: 'reorder-layers', overlayOrder, basemapOrder });
        this._scheduleReorderRepaint();
    }

    _createLabelAction(icon, text, title, onClick, variant = '', disabled = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'layer-stack-label-action' + (variant ? ` ${variant}` : '');
        button.title = title;
        button.innerHTML = `<sl-icon name="${icon}"></sl-icon>` + (text ? `<span>${text}</span>` : '');
        // Kept in place rather than dropped when unavailable, so the row of
        // actions doesn't shift as layers move to the ends of the stack.
        if (disabled) {
            button.disabled = true;
        } else {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                onClick();
            });
        }
        return button;
    }

    _createLabelSeparator() {
        const separator = document.createElement('span');
        separator.className = 'layer-stack-label-sep';
        separator.setAttribute('aria-hidden', 'true');
        separator.textContent = '|';
        return separator;
    }

    /**
     * These messages cross to handlers in the same window (MapBrowserControl for
     * open-layer-info / zoom-to-layer, MapFeatureControl for remove-layer), but
     * postMessage still structured-clones the payload, and a resolved layer config
     * can carry values that will not clone.
     */
    _post(message) {
        try {
            window.postMessage(message, '*');
        } catch (e) {
            console.warn('[LayerStackStrip] Message not cloneable, sending id only:', e);
            window.postMessage({ ...message, layer: undefined }, '*');
        }
    }

    _serializable(layer) {
        try {
            return JSON.parse(JSON.stringify(layer));
        } catch (e) {
            return { id: layer.id, title: layer.title, type: layer.type, _sourceAtlas: layer._sourceAtlas };
        }
    }

    _getAtlasName(layer) {
        const atlasId = layer._sourceAtlas;
        if (!atlasId) return null;
        const metadata = window.layerRegistry?.getAtlasMetadata?.(atlasId);
        return metadata?.name || atlasId;
    }
}

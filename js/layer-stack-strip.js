/**
 * LayerStackStrip - the "On the map" list in the map console's Find mode
 * (js/map-control-bar.js, js/console/find-panel.js): one row per layer
 * currently visible on the map. It also mounts the console itself, and is
 * shown whenever Find is open.
 *
 * Order matches the map's visual stack as defined by LayerOrderManager:
 * MapLayerControl._state.groups is already held in config/visual/URL order
 * (first = on top), so only the overlay/basemap split is applied - overlays
 * first, then basemaps - and the strip is painted top-to-bottom in that order.
 *
 * Its footer (LayerStackFooter: hover tooltips, comments, zoom, export and
 * the options menu shared with the long-press menu) is built here but sits at
 * the foot of Find, under whichever view is showing.
 *
 * It is Find's atlas view under its Active filter, so each row is the same
 * map row as the rest of Find (layerRow in js/console/find-browse.js: zoom
 * and show/hide), with the thumbnail showing whether the layer has features
 * in view. Its meta names the map's tags, or its atlas when that is not the
 * current one.
 *
 * A map turned off stays in the list, in its place, to be turned back on
 * (js/active-map-history.js keeps every map the atlas has had on): its zoom
 * becomes a delete button that drops it from the list. The maps on the map
 * fill the other places in stack order. Clicking a row opens its details page in Find
 * (js/console/layer-details.js) - or, for a map with features or locations
 * nested under it (js/console/layer-features.js), lists them; hovering isolates the layer through
 * MapLayerControl's shared LayerIsolationManager; rows drag to reorder.
 */
import { LayerThumbnail } from './layer-thumbnail.js';
import { layerPath } from './console/layer-path.js';
import { showOffLayer, hideOffLayer } from './console/off-layer-preview.js';
import { pendingState } from './console/layer-loading.js';
import { LayerOrderManager } from './layer-order-manager.js';
import { LayerStackFooter } from './layer-stack-footer.js';
import { MapControlBar } from './map-control-bar.js';
import { LayerCompareBadge } from './layer-compare-badge.js';
import { attachSwipeDelete } from './layer-swipe-delete.js';
import { layerRow } from './console/find-browse.js';
import { activeMapHistory, keepPlaces } from './active-map-history.js';
import { isIncludingOutside } from './console/find-scope.js';

const THUMB_SIZE = 32;

export class LayerStackStrip {
    constructor() {
        this._el = null;
        this._signature = null;
        this._pendingRender = false;
        this._refreshTimer = null;
        this._clearIsolationTimer = null;
        this._reorderTimer = null;
        this._draggedItem = null;
        this._footer = null;
        this._open = false;
        // Maps with no features in view are listed only while Find includes outside the view
        this._showHidden = isIncludingOutside();
        this._map = null;
        this._controlBar = null;
        this._onDataLoading = () => this._controlBar?.setLoading(true);
        this._noFeatureIds = new Set();
        this._compareBadge = new LayerCompareBadge({
            getLayer: (id) => this._getVisibleLayers().find(l => l.id === id),
            onStop: (id) => {
                this._post({ type: 'toggle-compare', layerId: id, enabled: false });
                this._scheduleReorderRepaint();
            }
        });
        this._onMapIdle = () => {
            this._controlBar?.setLoading(!!window.layerControl?._loadingLayerIds?.size);
            if (this._updateFeatureVisibility()) this.render();
        };
        // Debounced: window.urlManager's active-layers state updates on its own
        // 300ms debounce (see CLAUDE.md), so reading it synchronously on
        // 'layer-toggled' would render from stale state.
        // A map kept in the list stays in its place when turned off; one that isn't goes
        this._onToggled = (e) => {
            const id = e.detail?.layerId;
            if (e.detail?.visible === false && !activeMapHistory.has(this._atlasId(), id)) this._animateOut(id);
        };
        // Changes redraw even under the pointer: the rows keep their places
        this._onChange = (e) => {
            clearTimeout(this._refreshTimer);
            const shown = e?.type === 'layer-toggled' && e.detail?.visible === true;
            this._refreshTimer = setTimeout(() => this.render({ evenIfHovered: true }), shown ? 0 : 400);
        };
        this._lastOrder = null;
    }

    /**
     * @param {HTMLElement} hostEl - the map control container the console goes into
     * @param {HTMLElement} [browserButton] - MapBrowserControl's toggle button,
     *   kept as a hidden proxy for keyboard and test hooks
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

        this._footer = new LayerStackFooter({
            post: (message) => this._post(message),
            getLayers: () => this._getVisibleLayers(),
            onOptionsToggle: (open) => this._el?.classList.toggle('options-open', open)
        });
        this._controlBar = new MapControlBar();
        this._controlBar.mount(hostEl, {
            map,
            searchToggle: window.searchBoxControl?.searchToggle || null,
            stripEl: this._el,
            footerEl: this._footer.el,
            onModeChange: (mode) => this._setOpen(mode === 'find'),
            onToggleHidden: (show) => {
                this._showHidden = show;
                this.render({ force: true });
            }
        });
        map?.on?.('dataloading', this._onDataLoading);
        map?.on?.('idle', this._onMapIdle);
        this._controlBar.setLoading(true);
        this._controlBar.update(window.layersInitialized ? this._getVisibleLayers({ withLocations: true }) : null);

        this._map = map;
        this._mountBrowserProxy(browserButton, hostEl);
        this._footer.mount(map || window.map);

        // 'layersInitialized' is the signal that MapLayerControl has finished
        // building the groups this strip reads (it fires well after the control
        // is added to the map); the other two keep it in sync afterwards.
        window.addEventListener('layersInitialized', this._onChange);
        window.addEventListener('layer-toggled', this._onToggled);
        window.addEventListener('layer-toggled', this._onChange);
        window.addEventListener('urlUpdated', this._onChange);
        window.addEventListener('mask-changed', this._onChange);
        window.addEventListener('compare-changed', this._onChange);
        window.addEventListener('layer-pending', () => this.render({ force: true }));
        this._offHistory = activeMapHistory.onRemove(() => this.render({ force: true }));

        // The event may already have fired by the time this mounts.
        if (window.layersInitialized) this._onChange();
    }

    setVisible(visible) {
        if (!this._el) return;
        // Hiding the strip pulls it out from under the cursor, so no mouseleave
        // ever fires — drop any isolation it left applied.
        if (!visible) {
            this._clearIsolation({ immediate: true });
            this._footer?.closeMenu();
        }
        this._el.style.display = visible ? '' : 'none';
        this._controlBar?.setVisible(visible);
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

    async _previewOff(layer) {
        if (this._draggedItem) return;
        clearTimeout(this._clearIsolationTimer);
        const id = await showOffLayer(layer);
        if (id) this._isolate(id, LayerOrderManager.isBasemap(layer));
    }

    _clearIsolation({ immediate = false } = {}) {
        clearTimeout(this._clearIsolationTimer);
        const clear = () => window.layerControl?.isolation?.clearHover();
        if (immediate) clear();
        else this._clearIsolationTimer = setTimeout(clear, 60);
    }

    destroy() {
        window.removeEventListener('layersInitialized', this._onChange);
        window.removeEventListener('layer-toggled', this._onToggled);
        window.removeEventListener('layer-toggled', this._onChange);
        window.removeEventListener('urlUpdated', this._onChange);
        window.removeEventListener('mask-changed', this._onChange);
        window.removeEventListener('compare-changed', this._onChange);
        this._offHistory?.();
        clearTimeout(this._refreshTimer);
        clearTimeout(this._reorderTimer);
        this._map?.off?.('dataloading', this._onDataLoading);
        this._map?.off?.('idle', this._onMapIdle);
        this._clearIsolation({ immediate: true });
        this._footer?.unmount();
        this._footer = null;
        this._controlBar?.destroy();
        this._controlBar = null;
        if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
        this._el = null;
    }

    /**
     * Rebuilds the strip, but only when the visible set or its order actually
     * changed - it is also called on every map 'idle' as a self-heal, so the
     * no-change case has to stay cheap.
     */
    render({ force = false, evenIfHovered = false } = {}) {
        if (!this._el) return;

        // Rebuilding mid-hover would drop the row (and its open flyout) out from
        // under the cursor - and with the isolation the hover applied still on the
        // map. Defer to the strip's mouseleave instead. A reorder forces the
        // rebuild, since the whole point of it is that the row moves.
        if (!force && !evenIfHovered && this._el.querySelector('.layer-stack-item:hover')) {
            this._pendingRender = true;
            return;
        }
        this._pendingRender = false;

        const compareId = this._getComparedLayerId();
        this._compareBadge.sync(compareId);

        // A map swiped away stays out of the list until the map has taken it off
        const swiped = this._swipedAway ||= new Set();
        const visible = this._getVisibleLayers({ withLocations: true });
        swiped.forEach(id => { if (!visible.some(layer => layer.id === id)) swiped.delete(id); });
        const allLayers = visible.filter(layer => !swiped.has(layer.id));
        this._controlBar?.update(allLayers);
        const layers = allLayers.filter(l => l.id !== compareId && (this._showHidden || !this._noFeatureIds.has(l.id)));
        const hiddenCount = allLayers.filter(l => l.id !== compareId).length - layers.length;
        this._controlBar?.setHidden(allLayers.filter(l => this._noFeatureIds.has(l.id)).length, this._showHidden);
        const atlasId = this._atlasId();
        this._remember(atlasId, allLayers);
        const inactive = this._inactiveLayers(atlasId, allLayers);
        const maskedId = this._getMaskedLayerId();
        const loadingIds = window.layerControl?._loadingLayerIds;
        // A map switched on or off shows its new state at once, before the map catches up
        const offIds = new Set([
            ...inactive.filter(layer => pendingState(layer) !== true),
            ...layers.filter(layer => pendingState(layer) === false)
        ].map(layer => layer.id));
        const signature = layers.map(l => `${l.id}:${loadingIds?.has(l.id) ? 1 : 0}`).join(',') + `|off:${[...offIds].join(',')}|compare:${compareId}|mask:${maskedId}|open:${this._open}|atlas:${atlasId}|hidden:${hiddenCount}:${this._showHidden}|empty:${[...this._noFeatureIds].join(',')}`;
        if (!force && signature === this._signature) return;
        this._signature = signature;

        // The hovered row is about to be replaced, so its mouseleave will never
        // fire (a row switched off comes back as an off row, which does not
        // isolate): drop its isolation now; a fresh on row re-applies it on
        // the pointer's next move.
        if (this._el.querySelector('.layer-stack-item:hover')) {
            this._clearIsolation({ immediate: true });
            hideOffLayer();
        }

        // Layer items sit alongside the fixed toggle, so replace only the ones
        // this method owns.
        this._el.querySelectorAll('[data-layer-item]').forEach(el => el.remove());

        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(layers);
        if (this._lastOrder?.atlasId !== atlasId) this._lastOrder = { atlasId, ids: activeMapHistory.list(atlasId) };
        const byId = new Map([...layers, ...inactive].map(layer => [layer.id, layer]));
        // A map turned back on takes its place in the list again, and the map's stack follows
        const stacks = [overlays, basemaps].map(list => this._keepRevived(list.map(layer => layer.id), this._lastOrder.ids));
        const moved = stacks.some((ids, section) => ids.some((id, i) => id !== [overlays, basemaps][section][i].id));
        const sections = stacks.map((ids, section) => keepPlaces(
            ids,
            inactive.filter(layer => LayerOrderManager.isBasemap(layer) === (section === 1)).map(layer => layer.id),
            this._lastOrder.ids
        ));
        this._offIds = offIds;
        if (moved) this._postOrder(stacks[0], stacks[1]);

        const rows = [];
        sections.forEach((ids, section) => {
            ids.forEach((id, index) => {
                const layer = byId.get(id);
                const off = offIds.has(id);
                const item = off ? this._createOffItem(layer, atlasId) : this._createItem(layer, { maskedId });
                // The two groups meet at the first basemap, which carries the rule
                if (section === 1 && index === 0 && sections[0].length) {
                    item.classList.add('layer-stack-basemap-start');
                }
                this._el.appendChild(item);
                if (id !== 'locations') rows.push({ layer, on: !off });
            });
        });
        const shownOrder = sections.flat();
        this._lastOrder.ids = [...shownOrder, ...this._lastOrder.ids.filter(id => !shownOrder.includes(id))];
        activeMapHistory.setOrder(atlasId, shownOrder.filter(id => id !== 'locations'));

        this._controlBar?.find?.setOnMapRows(rows);
        this._controlBar?.find?.decorateOnMap();
        this._footer?.sync();
    }

    /** Stack ids with the maps that were off before back in their places in `lastOrder`. */
    _keepRevived(stackIds, lastOrder) {
        const wasOff = this._offIds || new Set();
        const revived = stackIds.filter(id => wasOff.has(id) && lastOrder.includes(id));
        if (!revived.length) return stackIds;
        const ids = stackIds.filter(id => !revived.includes(id));
        revived
            .sort((a, b) => lastOrder.indexOf(a) - lastOrder.indexOf(b))
            .forEach(id => {
                const at = lastOrder.indexOf(id);
                const before = ids.findIndex(other => lastOrder.indexOf(other) > at);
                ids.splice(before < 0 ? ids.length : before, 0, id);
            });
        return ids;
    }

    _atlasId() {
        return window.layerRegistry?.getCurrentAtlas?.() || 'index';
    }

    /** Every map on the map joins the list; one the registry doesn't know keeps its config. */
    _remember(atlasId, layers) {
        const kept = layers.filter(layer => layer.id !== 'locations');
        activeMapHistory.add(atlasId, kept.map(layer => layer.id));
        kept.forEach(layer => {
            if (!window.layerRegistry?.getLayer?.(layer.id, null, true)) activeMapHistory.keepConfig(atlasId, layer);
        });
    }

    /**
     * The maps this atlas has had on and are off now: from the registry, the
     * layer control (a layer given inline stays there once off), or the
     * config the list kept for it.
     */
    _inactiveLayers(atlasId, activeLayers) {
        const on = new Set(activeLayers.flatMap(layer => [layer.id, layer._prefixedId]).filter(Boolean));
        const groups = window.layerControl?._state?.groups || [];
        return activeMapHistory.list(atlasId)
            .filter(id => id !== 'locations' && !on.has(id))
            .map(id => {
                const layer = window.layerRegistry?.getLayer?.(id, null, true)
                    || groups.find(group => group.id === id)
                    || activeMapHistory.config(id, atlasId);
                return layer && !on.has(layer._prefixedId) && !on.has(layer.id) ? { ...layer, id, _prefixedId: layer._prefixedId || id } : null;
            })
            .filter(Boolean);
    }

    /** A map kept in the list while off: turn it back on, or delete it from the list. */
    _createOffItem(layer, atlasId) {
        const thumbnail = LayerThumbnail.generate(layer, THUMB_SIZE, {
            interactive: false,
            layerDefaults: window.layerControl?._defaultStyles || {}
        });
        thumbnail.classList.add('console-thumb', 'layer-stack-cell');
        const { path, attribution } = layerPath(layer, atlasId);
        const forget = () => activeMapHistory.remove(atlasId, layer.id);
        const item = layerRow(layer, {
            on: false,
            note: path,
            meta: attribution,
            thumb: thumbnail,
            className: 'layer-stack-item layer-stack-off',
            onRemove: forget,
            // Hovered, the map comes on for the moment, isolated
            onEnter: () => this._previewOff(layer),
            onLeave: () => {
                hideOffLayer();
                this._clearIsolation();
            }
        });
        item.dataset.layerItem = 'true';
        item.dataset.layerId = layer.id;
        item.dataset.off = 'true';
        item.dataset.basemap = String(LayerOrderManager.isBasemap(layer));
        attachSwipeDelete(item, forget);
        return item;
    }

    /**
     * postMessage is async and the handler rewrites layerControl._state.groups,
     * which is what _getVisibleLayers reads - repaint just after it lands so the
     * rounding and the basemap rule follow the new order. The isolation is
     * dropped first because the rebuild replaces the row under the cursor;
     * the fresh row's own mouseenter re-applies it.
     */
    _scheduleReorderRepaint() {
        clearTimeout(this._reorderTimer);
        this._reorderTimer = setTimeout(() => {
            this._clearIsolation({ immediate: true });
            this.render({ force: true });
        }, 80);
    }

    _mountBrowserProxy(browserButton, hostEl) {
        if (!browserButton) return;
        browserButton.classList.add('layer-stack-browser-proxy');
        hostEl.appendChild(browserButton);
    }

    _animateOut(layerId) {
        if (!this._el || !layerId) return;
        this._el.querySelectorAll('[data-layer-item]').forEach(item => {
            if (item.dataset.layerId !== layerId || item.classList.contains('layer-stack-leaving')) return;
            item.style.setProperty('--leave-height', `${item.offsetHeight}px`);
            item.classList.add('layer-stack-leaving');
            item.addEventListener('animationend', () => item.remove(), { once: true });
        });
    }

    /** Find opened or closed: the list only does work while it can be seen. */
    _setOpen(open) {
        if (open === this._open) return;
        this._open = open;
        this._clearIsolation({ immediate: true });
        if (open) this._updateFeatureVisibility();
        else this._footer?.closeMenu();
        this.render({ force: true });
    }

    /**
     * Visible layers in URL/visual order (first = top of the map stack).
     * The group entries carry the live state (opacity, sublayers); the registry
     * entry carries the full resolved config the thumbnail draws from, so they
     * are merged with the group winning.
     */
    _getVisibleLayers({ withLocations = false } = {}) {
        const groups = window.layerControl?._state?.groups || [];
        const urlManager = window.urlManager;
        if (!urlManager) return [];

        const visible = [];
        groups.forEach((group, index) => {
            // The markers layer is listed as a row, its locations nested under it, but is not a map the footer acts on
            if (group.id === 'locations' && !withLocations) return;
            if (!urlManager.isGroupActive(index)) return;

            const registryLayer = window.layerRegistry?.getLayer?.(group.id, null, true);
            visible.push(registryLayer ? { ...registryLayer, ...group } : group);
        });

        return LayerOrderManager.mapOrderToUrlOrder(visible);
    }

    _updateFeatureVisibility() {
        const stateManager = window.stateManager;
        if (!stateManager?.hasRenderedFeatures || !window.layersInitialized) return false;
        if (!this._open) return false;
        const comparedId = this._getComparedLayerId();
        const next = new Set(
            this._getVisibleLayers({ withLocations: true })
                .filter(layer => layer.id !== comparedId && !stateManager.hasRenderedFeatures(layer))
                .map(layer => layer.id)
        );
        const changed = next.size !== this._noFeatureIds.size || [...next].some(id => !this._noFeatureIds.has(id));
        this._noFeatureIds = next;
        return changed;
    }

    _createItem(layer, { maskedId = null } = {}) {
        const title = layer.title || layer.id;
        const { path, attribution } = layerPath(layer);

        const thumbnail = LayerThumbnail.generate(layer, THUMB_SIZE, {
            hasFeatures: !this._noFeatureIds.has(layer.id),
            layerDefaults: window.layerControl?._defaultStyles || {}
        });
        thumbnail.classList.add('console-thumb', 'layer-stack-cell');

        // Hovering the row isolates the layer - same effect the feature
        // control's marker badges apply: an overlay stays over the basemaps,
        // faded to half; a basemap is shown alone.
        const isBasemap = LayerOrderManager.isBasemap(layer);
        const item = layerRow(layer, {
            on: true,
            note: path,
            meta: attribution,
            thumb: thumbnail,
            className: 'layer-stack-item',
            onEnter: () => this._isolate(layer.id, isBasemap),
            onLeave: () => this._clearIsolation()
        });
        item.dataset.layerItem = 'true';
        item.dataset.layerId = layer.id;
        item.dataset.basemap = String(isBasemap);
        if (this._noFeatureIds.has(layer.id)) item.classList.add('layer-stack-empty');

        // The masked layer steps out of the column: a mask cell takes its slot
        // and the thumbnail is displaced to the right (see the CSS).
        if (maskedId && maskedId === layer.id) {
            item.classList.add('layer-stack-comparing', 'layer-stack-masking');
            item.prepend(this._createMaskCell(layer, title));
        }


        const grip = document.createElement('sl-icon');
        grip.name = 'grip-vertical';
        grip.className = 'layer-stack-grip';
        grip.title = 'Drag to reorder';
        item.prepend(grip);

        this._setupItemDrag(item);
        // Swiping a row away removes the map, and drops it from the list too
        attachSwipeDelete(item, () => {
            (this._swipedAway ||= new Set()).add(layer.id);
            activeMapHistory.remove(this._atlasId(), layer.id);
            this._post({ type: 'remove-layer', layerId: layer.id });
        });

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
     * The layer currently cutting the `mask` layer, owned by MapMaskManager
     * (and mirrored in the ?mask= URL param).
     */
    _getMaskedLayerId() {
        return window.maskManager?.getMaskSourceLayerId?.() || null;
    }

    /**
     * Stand-in cell shown in the masked layer's slot: clicking it stops
     * masking, which also takes the `mask` layer back off the map (see
     * MapMaskManager.clearMask).
     */
    _createMaskCell(layer, title) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'layer-stack-mask-cell layer-stack-cell';
        button.title = `Stop masking the map to ${title}`;
        button.setAttribute('aria-label', `Stop masking the map to ${title}`);
        button.innerHTML = '<sl-icon name="mask"></sl-icon>';
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._post({ type: 'toggle-mask', layerId: layer.id, enabled: false });
            // Clearing rewrites the ?mask= param and toggles the mask layer
            // off, but repaint on our own schedule rather than waiting on that.
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
        const shownOverlays = [];
        const shownBasemaps = [];
        this._el.querySelectorAll('[data-layer-item]').forEach(el => {
            if (el.dataset.off === 'true') return;
            (el.dataset.basemap === 'true' ? shownBasemaps : shownOverlays).push(el.dataset.layerId);
        });
        this._postOrder(shownOverlays, shownBasemaps);
    }

    /**
     * Sends the order of the rows shown as `reorder-layers`. Layers filtered
     * out of the strip keep their slots: only the rows on screen are
     * reordered among themselves.
     */
    _postOrder(shownOverlays, shownBasemaps) {
        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(this._getVisibleLayers({ withLocations: true }));
        const merge = (full, shown) => {
            const onScreen = new Set(shown);
            let next = 0;
            return full.map(layer => (onScreen.has(layer.id) ? shown[next++] : layer.id));
        };

        this._post({
            type: 'reorder-layers',
            overlayOrder: merge(overlays, shownOverlays),
            basemapOrder: merge(basemaps, shownBasemaps)
        });
        this._scheduleReorderRepaint();
    }

    /**
     * These messages cross to handlers in the same window (MapFeatureControl
     * for remove-layer and the compare / mask toggles), but
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
}

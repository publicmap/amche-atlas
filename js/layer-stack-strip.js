/**
 * LayerStackStrip - the vertical control column at the top-left of the map:
 * the map control bar that toggles the map browser, whose "Loaded N Maps"
 * summary reveals and edits this strip - one thumbnail per layer currently
 * visible on the map.
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
 * The column ends with three always-visible action rows: "More Options", which
 * opens the map/selection shortcuts shared with the long-press menu (see
 * LayerStackOptionsMenu), then "Import Map" and "Export Map".
 *
 * Each thumbnail is a LayerThumbnail, so clicking one opens that layer's info
 * panel (or zooms to it when it's out of view) exactly like the thumbnails in
 * map-browser.html. Hovering a row isolates that layer through
 * MapLayerControl's shared LayerIsolationManager and reveals the layer's details
 * (name, atlas, shortcut actions, opacity) in a panel that opens over the rest
 * of its own row, inside the strip.
 */
import { LayerThumbnail } from './layer-thumbnail.js';
import { LayerOrderManager } from './layer-order-manager.js';
import { LayerStackOptionsMenu } from './layer-stack-options-menu.js';
import { MapControlBar } from './map-control-bar.js';

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
        this._reordering = false;
        this._hideTimer = null;
        this._expandTimer = null;
        this._expandedByHover = false;
        this._showHidden = false;
        this._zoomState = null;
        this._map = null;
        this._controlBar = null;
        this._onDataLoading = () => this._controlBar?.setLoading(true);
        this._noFeatureIds = new Set();
        this._onMapIdle = () => {
            this._controlBar?.setLoading(!!window.layerControl?._loadingLayerIds?.size);
            if (this._updateFeatureVisibility()) this.render();
        };
        this._onSearchStart = () => this._collapse();
        this._onMapClick = () => this._setReordering(false);
        // Only a user-driven move collapses the strip: a programmatic one (the
        // strip's own Zoom action, say) has no originalEvent.
        this._onMapMoveStart = (e) => {
            if (!e?.originalEvent) return;
            // Moving the map after a layer zoom makes "Reset" meaningless: the
            // next click zooms again instead.
            this._zoomState = null;
            this._collapse();
        };
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
        this._el.addEventListener('mouseenter', () => clearTimeout(this._hideTimer));
        this._el.addEventListener('mouseleave', () => this._scheduleHide());
        hostEl.appendChild(this._el);

        window.addEventListener('mapSearchStart', this._onSearchStart);
        this._controlBar = new MapControlBar();
        this._controlBar.mount(hostEl, {
            triggerButton: browserButton,
            onSummaryClick: () => {
                clearTimeout(this._expandTimer);
                // A click right after the hover expanded the strip confirms it
                // rather than toggling it straight back off.
                if (this._expandedByHover) {
                    this._expandedByHover = false;
                    this._controlBar?.setSummaryActive(true, true);
                    return;
                }
                this._setReordering(!this._reordering);
            },
            onSummaryEnter: () => {
                this._reveal();
                if (this._updateFeatureVisibility()) this.render();
                if (!this._reordering) {
                    this._expandedByHover = true;
                    this._setReordering(true);
                }
            },
            onSummaryLeave: () => {
                this._scheduleHide();
            }
        });
        map?.on?.('dataloading', this._onDataLoading);
        map?.on?.('idle', this._onMapIdle);
        map?.on?.('movestart', this._onMapMoveStart);
        this._controlBar.setLoading(true);
        this._controlBar.update(window.layersInitialized ? this._getVisibleLayers() : null);

        this._map = map;
        this._mountBrowserProxy(browserButton);
        this._mountOptionsItem(map);
        this._mountImportItem();
        this._mountExportItem();

        // 'layersInitialized' is the signal that MapLayerControl has finished
        // building the groups this strip reads (it fires well after the control
        // is added to the map); the other two keep it in sync afterwards.
        window.addEventListener('layersInitialized', this._onChange);
        window.addEventListener('layer-toggled', this._onChange);
        window.addEventListener('urlUpdated', this._onChange);
        window.addEventListener('mask-changed', this._onChange);

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
        window.removeEventListener('mask-changed', this._onChange);
        clearTimeout(this._refreshTimer);
        clearTimeout(this._reorderTimer);
        clearTimeout(this._expandTimer);
        (this._map || window.map)?.off?.('click', this._onMapClick);
        this._map?.off?.('dataloading', this._onDataLoading);
        this._map?.off?.('idle', this._onMapIdle);
        this._map?.off?.('movestart', this._onMapMoveStart);
        this._reordering = false;
        clearTimeout(this._hideTimer);
        this._clearIsolation({ immediate: true });
        this._optionsMenu?.unmount();
        this._optionsMenu = null;
        this._optionsItem = null;
        this._exportItem = null;
        this._importItem = null;
        window.removeEventListener('mapSearchStart', this._onSearchStart);
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

        const allLayers = this._getVisibleLayers();
        this._controlBar?.update(allLayers);
        const layers = this._showHidden ? allLayers : allLayers.filter(l => !this._noFeatureIds.has(l.id));
        const hiddenCount = allLayers.length - layers.length;
        const comparedId = this._getComparedLayerId();
        const maskedId = this._getMaskedLayerId();
        const loadingIds = window.layerControl?._loadingLayerIds;
        const signature = layers.map(l => `${l.id}:${loadingIds?.has(l.id) ? 1 : 0}`).join(',') + `|compare:${comparedId}|mask:${maskedId}|reorder:${this._reordering}|zoom:${this._zoomState?.layerId}|hidden:${hiddenCount}|empty:${[...this._noFeatureIds].join(',')}`;
        if (!force && signature === this._signature) return;
        this._signature = signature;

        // Layer items sit alongside the fixed toggle, so replace only the ones
        // this method owns.
        this._el.querySelectorAll('[data-layer-item], .layer-stack-show-hidden').forEach(el => el.remove());

        // Reordering happens within a section, so each row needs its position in
        // its own list to know whether it can still move up or down.
        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(layers);

        [overlays, basemaps].forEach((list, section) => {
            if (section === 0 && !this._reordering) return;
            list.forEach((layer, index) => {
                const item = this._createItem(layer, { index, total: list.length, comparedId, maskedId });
                // The two groups meet at the first basemap, which carries the rule
                if (section === 1 && index === 0 && overlays.length) {
                    item.classList.add('layer-stack-basemap-start');
                }
                this._el.appendChild(item);
            });
        });

        if (hiddenCount) this._el.appendChild(this._createShowHiddenItem(hiddenCount));

        // The options, import and export controls belong at the foot of the
        // column, and the layer rows were just appended after them.
        if (this._optionsItem) this._el.appendChild(this._optionsItem);
        if (this._importItem) this._el.appendChild(this._importItem);
        if (this._exportItem) this._el.appendChild(this._exportItem);

        this._syncBarWidth();
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

    _mountBrowserProxy(browserButton) {
        if (!browserButton) return;
        browserButton.classList.add('layer-stack-browser-proxy');
        this._el.parentNode.appendChild(browserButton);
    }

    _reveal() {
        clearTimeout(this._hideTimer);
        this._el?.classList.add('revealed');
        this._syncBarWidth();
    }

    /**
     * The strip grows to fit its longest layer name, so the bar above it is
     * widened to match while it is open and the two stay one flush block.
     */
    _syncBarWidth() {
        if (!this._el || !this._controlBar) return;
        this._controlBar.setMinWidth(0);
        if (this._el.classList.contains('revealed')) {
            this._controlBar.setMinWidth(this._el.offsetWidth);
        }
    }

    _scheduleHide() {
        clearTimeout(this._hideTimer);
        this._hideTimer = setTimeout(() => {
            if (!this._el || this._draggedItem) return;
            if (this._el.matches(':hover') || this._controlBar?.summaryEl?.matches(':hover, :focus-visible')) return;
            if (this._el.classList.contains('options-open')) return;
            if (this._expandedByHover) {
                this._setReordering(false);
                return;
            }
            if (this._reordering) return;
            this._el.classList.remove('revealed');
            this._controlBar?.setMinWidth(0);
            this._resetShowHidden();
        }, 200);
    }

    _collapse() {
        if (!this._el) return;
        clearTimeout(this._expandTimer);
        clearTimeout(this._hideTimer);
        this._setReordering(false);
        this._clearIsolation({ immediate: true });
        this._el.classList.remove('revealed');
        this._controlBar?.setMinWidth(0);
        this._resetShowHidden();
    }

    /**
     * Zoom doubles as its own undo: the first click remembers the current view
     * and zooms to the layer, a second click with no map movement since flies
     * back. Any user-driven move in between drops the remembered view (see
     * _onMapMoveStart), so the next click is a fresh zoom.
     */
    _toggleLayerZoom(layer) {
        const map = this._map || window.map;
        if (!map) return;

        const state = this._zoomState;
        if (state && state.layerId === layer.id) {
            this._zoomState = null;
            map.flyTo(state.view);
        } else {
            this._zoomState = {
                layerId: layer.id,
                view: {
                    center: map.getCenter().toArray(),
                    zoom: map.getZoom(),
                    bearing: map.getBearing(),
                    pitch: map.getPitch()
                }
            };
            this._post({ type: 'zoom-to-layer', layerId: layer.id });
        }
        this._scheduleReorderRepaint();
    }

    _resetShowHidden() {
        if (!this._showHidden) return;
        this._showHidden = false;
        this.render();
    }

    _setReordering(on) {
        if (on === this._reordering) return;
        this._reordering = on;
        if (!on) this._expandedByHover = false;
        this._controlBar?.setSummaryActive(on, on && !this._expandedByHover);
        const map = this._map || window.map;
        map?.[on ? 'on' : 'off']?.('click', this._onMapClick);
        this._clearIsolation({ immediate: true });
        if (on) this._reveal();
        else this._scheduleHide();
        this.render({ force: true });
    }

    /**
     * A full-width action row at the foot of the column: an icon cell and a
     * label, acting as one button. The whole row is the click (and hover)
     * target, not just the icon.
     */
    _createActionItem({ className, buttonClass, icon, iconHover = null, label, title, onClick }) {
        const item = document.createElement('div');
        item.className = `layer-stack-item layer-stack-control ${className}`;
        item.title = title;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `layer-stack-cell ${buttonClass}`;
        button.setAttribute('aria-label', title);
        button.tabIndex = -1;
        const iconEl = document.createElement('sl-icon');
        iconEl.name = icon;
        button.appendChild(iconEl);
        item.appendChild(button);

        const text = document.createElement('div');
        text.className = 'layer-stack-row-text';
        const name = document.createElement('div');
        name.className = 'layer-stack-row-name';
        name.textContent = label;
        text.appendChild(name);
        item.appendChild(text);

        if (iconHover) {
            item.addEventListener('mouseenter', () => iconEl.setAttribute('name', iconHover));
            item.addEventListener('mouseleave', () => iconEl.setAttribute('name', icon));
        }
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return item;
    }

    /**
     * The import row, after the options row and before export. Opens
     * map-creator.html the same way the long-press shortcut menu's "Import Map"
     * entry does (see shortcut-menu-base.js): the browser overlay has to be open
     * for its iframe to be visible at all, so this opens it first if needed
     * before switching that iframe to the creator.
     */
    _mountImportItem() {
        const item = this._createActionItem({
            className: 'layer-stack-import',
            buttonClass: 'layer-stack-import-btn',
            icon: 'plus-circle',
            iconHover: 'plus-circle-fill',
            label: 'Import Map',
            title: 'Import map',
            onClick: () => {
                if (!window.browserControl?._isOpen) window.browserControl?.openBrowser();
                window.browserControl?._switchToCreator();
            }
        });
        this._el.appendChild(item);
        this._importItem = item;
    }

    /**
     * The export row, mounted last. MapExportControl isn't mounted as a map
     * control (see map-init.js) - its own message listener already handles
     * 'toggle-export', so this row just posts that rather than reaching into
     * the control directly.
     */
    _mountExportItem() {
        const item = this._createActionItem({
            className: 'layer-stack-export',
            buttonClass: 'layer-stack-export-btn',
            icon: 'download',
            label: 'Export Map',
            title: 'Export map',
            onClick: () => this._post({ type: 'toggle-export' })
        });
        this._el.appendChild(item);
        this._exportItem = item;
    }

    /**
     * The first fixed row at the foot of the stack, opening the shared shortcut
     * actions. The menu opens into the space beside the column, anchored to the
     * whole row.
     */
    _mountOptionsItem(map) {
        const item = this._createActionItem({
            className: 'layer-stack-options',
            buttonClass: 'layer-stack-options-btn',
            icon: 'three-dots',
            label: 'More Options',
            title: 'Map and selection options',
            onClick: () => this._optionsMenu?.toggle()
        });
        this._el.appendChild(item);
        this._optionsItem = item;

        this._optionsMenu = new LayerStackOptionsMenu({
            onVisibilityChange: (open) => this._el?.classList.toggle('options-open', open)
        });
        this._optionsMenu.mount(map || window.map, item);
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

    _updateFeatureVisibility() {
        const stateManager = window.stateManager;
        if (!stateManager?.hasRenderedFeatures || !window.layersInitialized) return false;
        if (!this._reordering && !this._el?.classList.contains('revealed')) return false;
        const next = new Set(
            this._getVisibleLayers()
                .filter(layer => !stateManager.hasRenderedFeatures(layer))
                .map(layer => layer.id)
        );
        const changed = next.size !== this._noFeatureIds.size || [...next].some(id => !this._noFeatureIds.has(id));
        this._noFeatureIds = next;
        return changed;
    }

    _createItem(layer, position = { index: 0, total: 1, comparedId: null, maskedId: null }) {
        const item = document.createElement('div');
        item.className = 'layer-stack-item';
        item.dataset.layerItem = 'true';
        item.dataset.layerId = layer.id;
        item.dataset.basemap = String(LayerOrderManager.isBasemap(layer));
        const noFeatures = this._noFeatureIds.has(layer.id);
        if (noFeatures) item.classList.add('layer-stack-empty');

        const title = layer.title || layer.id;
        const atlasName = this._getAtlasName(layer);

        const thumbnail = LayerThumbnail.generate(layer, THUMB_SIZE, {
            hasFeatures: !this._noFeatureIds.has(layer.id),
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
        } else if (position.maskedId && position.maskedId === layer.id) {
            // The masked layer is displaced the same way (they share the CSS),
            // with a mask cell in its slot instead. A layer can't be both, and
            // compare wins if something has managed to set both.
            item.classList.add('layer-stack-comparing', 'layer-stack-masking');
            item.appendChild(this._createMaskCell(layer, title));
        }

        item.appendChild(thumbnail);

        // Shown while the layer is still being added to the map on initial
        // load (see MapLayerControl._loadingLayerIds) - the thumbnail itself
        // renders from the layer's config, so it's already correct underneath.
        if (window.layerControl?._loadingLayerIds?.has(layer.id)) {
            const spinner = document.createElement('sl-spinner');
            spinner.className = 'layer-stack-thumb-spinner';
            item.appendChild(spinner);
        }

        item.appendChild(this._createRowText(layer, title, atlasName));

        // Hover panel: the layer name (opens map-information.html), then the atlas
        // name followed by shortcut actions for the layer. It opens over the row text.
        const label = document.createElement('div');
        label.className = 'layer-stack-label';

        const titleBtn = document.createElement('button');
        titleBtn.type = 'button';
        titleBtn.className = 'layer-stack-label-title';
        titleBtn.textContent = title;
        titleBtn.title = `Open details for ${title}`;
        const head = document.createElement('div');
        head.className = 'layer-stack-label-head';
        head.appendChild(titleBtn);
        head.appendChild(this._createInfoIcon());
        head.title = `Open details for ${title}`;
        head.addEventListener('mouseenter', () => head.querySelector('sl-icon').setAttribute('name', 'info-circle-fill'));
        head.addEventListener('mouseleave', () => head.querySelector('sl-icon').setAttribute('name', 'info-circle'));
        head.addEventListener('click', (e) => {
            e.stopPropagation();
            this._post({ type: 'open-layer-info', layer: this._serializable(layer) });
        });
        label.appendChild(head);

        const meta = document.createElement('div');
        meta.className = 'layer-stack-label-meta';

        meta.appendChild(this._createLabelAction('pencil', 'Edit', `Edit ${title}`, () => {
            this._post({ type: 'open-layer-info', layer: this._serializable(layer), edit: true });
        }));
        meta.appendChild(this._createLabelSeparator());

        const zoomed = this._zoomState?.layerId === layer.id;
        meta.appendChild(zoomed
            ? this._createLabelAction('arrow-counterclockwise', 'Reset', `Return to the view before zooming to ${title}`, () => this._toggleLayerZoom(layer))
            : this._createLabelAction('zoom-in', 'Zoom', `Zoom to ${title}`, () => this._toggleLayerZoom(layer)));
        meta.appendChild(this._createLabelSeparator());
        meta.appendChild(this._createLabelAction('trash', 'Remove', `Remove ${title} from the map`, () => {
            this._post({ type: 'remove-layer', layerId: layer.id });
        }, 'layer-stack-label-action-danger'));

        label.appendChild(meta);
        label.appendChild(noFeatures
            ? this._createNoDataNote()
            : this._createOpacitySlider(layer, title, item));
        item.appendChild(label);

        // Hovering anywhere on the row (thumbnail, text or hover panel) isolates the layer - same effect
        // the feature control's marker badges apply: only this layer and the
        // other section (overlay vs basemap) stay visible.
        const isBasemap = LayerOrderManager.isBasemap(layer);
        const isolate = () => this._isolate(layer.id, isBasemap);
        const clearIsolation = () => this._clearIsolation();

        item.addEventListener('mouseenter', isolate);
        item.addEventListener('mouseleave', clearIsolation);
        titleBtn.addEventListener('focus', isolate);
        titleBtn.addEventListener('blur', clearIsolation);

        this._setupItemDrag(item);

        return item;
    }

    /**
     * Last row of the list while maps with no data in view are filtered out:
     * a red-diagonal cell that brings every active layer back, as listed
     * without the filter. It lasts until the strip closes.
     */
    _createShowHiddenItem(count) {
        const item = document.createElement('div');
        item.className = 'layer-stack-item layer-stack-show-hidden layer-stack-empty';

        const cell = document.createElement('div');
        cell.className = 'layer-stack-cell layer-stack-show-hidden-cell';
        cell.setAttribute('role', 'button');
        cell.setAttribute('tabindex', '0');
        cell.setAttribute('aria-label', `Show ${count} hidden ${count === 1 ? 'map' : 'maps'}`);
        cell.appendChild(LayerThumbnail._generateNoFeaturesLine(THUMB_SIZE));
        item.appendChild(cell);

        const text = document.createElement('div');
        text.className = 'layer-stack-row-text';
        const name = document.createElement('div');
        name.className = 'layer-stack-row-name';
        name.textContent = `Show ${count} hidden ${count === 1 ? 'map' : 'maps'}`;
        const meta = document.createElement('div');
        meta.className = 'layer-stack-row-meta';
        meta.textContent = 'with no features in current view';
        text.append(name, meta);
        item.appendChild(text);

        const show = (e) => {
            e.stopPropagation();
            this._showHidden = true;
            this.render({ force: true });
        };
        item.addEventListener('click', show);
        cell.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                show(e);
            }
        });
        return item;
    }

    /**
     * The always-visible half of a row: the layer name over its atlas and tags.
     * Clicking it opens the layer's info panel, like the name in the hover panel.
     */
    _createRowText(layer, title, atlasName) {
        const text = document.createElement('div');
        text.className = 'layer-stack-row-text';

        const name = document.createElement('div');
        name.className = 'layer-stack-row-name';
        name.textContent = title;
        text.appendChild(name);

        const details = [atlasName, ...(Array.isArray(layer.tags) ? layer.tags : [])]
            .filter(Boolean)
            .slice(0, 4);
        if (details.length) {
            const meta = document.createElement('div');
            meta.className = 'layer-stack-row-meta';
            meta.textContent = details.join(' / ');
            text.appendChild(meta);
        }

        text.addEventListener('click', (e) => {
            e.stopPropagation();
            this._post({ type: 'open-layer-info', layer: this._serializable(layer) });
        });
        return text;
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
            (el.dataset.basemap === 'true' ? shownBasemaps : shownOverlays).push(el.dataset.layerId);
        });

        // Layers filtered out of the strip keep their slots: only the rows on
        // screen are reordered among themselves.
        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(this._getVisibleLayers());
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

    _createInfoIcon() {
        const wrap = document.createElement('span');
        wrap.className = 'layer-stack-label-info';
        const icon = document.createElement('sl-icon');
        icon.name = 'info-circle';
        wrap.appendChild(icon);
        return wrap;
    }

    _createNoDataNote() {
        const note = document.createElement('div');
        note.className = 'layer-stack-label-nodata';
        note.textContent = 'No map data at this location';
        return note;
    }

    _createOpacitySlider(layer, title, item) {
        const row = document.createElement('label');
        row.className = 'layer-stack-label-opacity';
        row.title = `Opacity of ${title}`;

        const icon = document.createElement('sl-icon');
        icon.name = 'droplet-half';
        row.appendChild(icon);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.05';
        slider.value = String(layer.opacity ?? 1);
        slider.setAttribute('aria-label', `Opacity of ${title}`);
        slider.addEventListener('input', () => {
            this._post({ type: 'update-layer-opacity', layerId: layer.id, opacity: parseFloat(slider.value) });
        });
        // The row is draggable for reordering, which would otherwise swallow the slider's own drag
        slider.addEventListener('pointerdown', () => { item.draggable = false; });
        ['pointerup', 'pointercancel'].forEach(type => {
            slider.addEventListener(type, () => { item.draggable = true; });
        });
        row.appendChild(slider);
        return row;
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

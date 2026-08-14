/**
 * ShortcutMenu - Right-click / long-press context menu for quick access to
 * frequently used app actions.
 *
 * Desktop: right-click on the map.
 * Touch: long-press on the map. Mobile browsers are inconsistent about firing
 * a native `contextmenu` DOM event on long-press over a canvas (Mapbox's
 * touch handlers can swallow the touch sequence before it gets there), so
 * long-press is also detected explicitly with a touch timer below.
 */
import { GeoLibreAPI } from './geolibre-api.js';
import { LayerOrderManager } from './layer-order-manager.js';

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD = 10;

export class ShortcutMenu {
    constructor() {
        this._map = null;
        this._menu = null;
        this._lngLat = null;

        this._touchTimer = null;
        this._touchStart = null;
        this._longPressFired = false;

        // Stack of flyout panels, one per nesting depth (0 = first flyout opened
        // from the top-level menu, 1 = a flyout opened from within that, etc).
        // `_openSubmenuIds[depth]` tracks which item's flyout currently occupies
        // that depth, so hover/click can tell "already open" from "switch to this
        // sibling" and close everything deeper than wherever focus moved to.
        this._submenuLevels = [];
        this._openSubmenuIds = [];

        this._handleContextMenu = this._handleContextMenu.bind(this);
        this._handleOutsideEvent = this._handleOutsideEvent.bind(this);
        this._handleKeydown = this._handleKeydown.bind(this);
        this._handleTouchStart = this._handleTouchStart.bind(this);
        this._handleTouchMove = this._handleTouchMove.bind(this);
        this._handleTouchEnd = this._handleTouchEnd.bind(this);
        this._suppressNextClick = this._suppressNextClick.bind(this);
        this._hide = this._hide.bind(this);
    }

    onAdd(map) {
        this._map = map;
        this._createMenu();

        map.on('contextmenu', this._handleContextMenu);
        map.on('movestart', this._hide);
        map.on('zoomstart', this._hide);

        const canvasContainer = map.getCanvasContainer();
        canvasContainer.addEventListener('touchstart', this._handleTouchStart, { passive: true });
        canvasContainer.addEventListener('touchmove', this._handleTouchMove, { passive: true });
        canvasContainer.addEventListener('touchend', this._handleTouchEnd, { passive: true });
        canvasContainer.addEventListener('touchcancel', this._handleTouchEnd, { passive: true });
        this._canvasContainer = canvasContainer;

        document.addEventListener('mousedown', this._handleOutsideEvent, true);
        document.addEventListener('touchstart', this._handleOutsideEvent, true);
        document.addEventListener('keydown', this._handleKeydown);
        window.addEventListener('resize', this._hide);

        // Not a corner control - no button to render in the map chrome.
        return null;
    }

    onRemove() {
        if (this._map) {
            this._map.off('contextmenu', this._handleContextMenu);
            this._map.off('movestart', this._hide);
            this._map.off('zoomstart', this._hide);
        }
        if (this._canvasContainer) {
            this._canvasContainer.removeEventListener('touchstart', this._handleTouchStart);
            this._canvasContainer.removeEventListener('touchmove', this._handleTouchMove);
            this._canvasContainer.removeEventListener('touchend', this._handleTouchEnd);
            this._canvasContainer.removeEventListener('touchcancel', this._handleTouchEnd);
            this._canvasContainer = null;
        }
        document.removeEventListener('mousedown', this._handleOutsideEvent, true);
        document.removeEventListener('touchstart', this._handleOutsideEvent, true);
        document.removeEventListener('keydown', this._handleKeydown);
        window.removeEventListener('resize', this._hide);

        if (this._touchTimer) {
            clearTimeout(this._touchTimer);
            this._touchTimer = null;
        }

        this._menu?.parentNode?.removeChild(this._menu);
        this._menu = null;
        this._submenuLevels.forEach(level => level?.element.parentNode?.removeChild(level.element));
        this._submenuLevels = [];
        this._openSubmenuIds = [];
        this._map = null;
    }

    /**
     * Start the long-press timer on single-finger touch. Multi-finger touches
     * (pinch-zoom) are left alone.
     */
    _handleTouchStart(e) {
        if (e.touches.length !== 1) {
            this._clearTouchTimer();
            return;
        }

        // Clear any stale pending timer before recording the new touch — order
        // matters here, since _clearTouchTimer also resets _touchStart and must
        // not run after it's set below.
        this._clearTouchTimer();

        const touch = e.touches[0];
        this._touchStart = { x: touch.clientX, y: touch.clientY };
        this._longPressFired = false;

        this._touchTimer = setTimeout(() => {
            this._touchTimer = null;
            this._longPressFired = true;

            const rect = this._map.getContainer().getBoundingClientRect();
            this._lngLat = this._map.unproject([
                this._touchStart.x - rect.left,
                this._touchStart.y - rect.top
            ]);
            this._show(this._touchStart.x, this._touchStart.y);

            // The finger is usually still down when the menu opens; the tap/click
            // that follows on lift-off would otherwise fall through to the map's
            // own selection handling. Swallow exactly one.
            document.addEventListener('click', this._suppressNextClick, true);
        }, LONG_PRESS_MS);
    }

    /**
     * Cancel the pending long-press if the finger moves enough to look like a
     * pan/drag rather than a stationary press.
     */
    _handleTouchMove(e) {
        if (!this._touchTimer || !this._touchStart || e.touches.length !== 1) return;

        const touch = e.touches[0];
        const dx = touch.clientX - this._touchStart.x;
        const dy = touch.clientY - this._touchStart.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_THRESHOLD) {
            this._clearTouchTimer();
        }
    }

    _handleTouchEnd() {
        this._clearTouchTimer();
    }

    _clearTouchTimer() {
        if (this._touchTimer) {
            clearTimeout(this._touchTimer);
            this._touchTimer = null;
        }
        this._touchStart = null;
    }

    _suppressNextClick(e) {
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener('click', this._suppressNextClick, true);
    }

    _createMenu() {
        this._menu = document.createElement('div');
        this._menu.className = 'shortcut-menu';
        this._menu.style.display = 'none';

        const items = [
            {
                id: 'selection-menu',
                icon: 'cursor',
                label: 'Selection',
                children: [
                    {
                        id: 'select-features',
                        icon: 'crosshair',
                        label: 'Select features',
                        action: () => this._selectFeaturesAtPoint()
                    },
                    {
                        id: 'zoom-to-selected',
                        icon: 'bounding-box',
                        label: 'Zoom To Selected',
                        action: () => window.featureControl?.zoomToSelected(this._lngLat)
                    },
                    {
                        id: 'toggle-multi-select',
                        icon: 'plus-circle-dotted',
                        iconChecked: 'plus-circle-fill',
                        label: 'Multi Select',
                        checkable: true,
                        checked: () => window.featureControl?.isAddSelectionModeEnabled?.() || false,
                        action: () => {
                            const enabled = !window.featureControl?.isAddSelectionModeEnabled();
                            window.featureControl?.setAddSelectionMode(enabled);
                        }
                    },
                    {
                        id: 'toggle-auto-select',
                        icon: 'lightning-charge',
                        iconChecked: 'lightning-charge-fill',
                        label: 'Auto Select',
                        checkable: true,
                        checked: () => window.featureControl?.isAutoSelectEnabled?.() ?? true,
                        action: () => {
                            const enabled = !(window.featureControl?.isAutoSelectEnabled?.() ?? true);
                            window.featureControl?.setAutoSelectEnabled(enabled);
                        }
                    },
                    {
                        id: 'clear-selection',
                        icon: 'x-circle',
                        label: 'Clear Selection',
                        action: () => window.featureControl?.clearSelection()
                    }
                ]
            },
            {
                id: 'open-with-menu',
                icon: 'box-arrow-up-right',
                label: 'Open With',
                children: [
                    {
                        id: 'open-with-osm',
                        icon: 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Openstreetmap_logo.svg',
                        label: 'OpenStreetMap',
                        action: () => this._openExternalLink('osm')
                    },
                    {
                        id: 'open-with-google-maps',
                        icon: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Google_Maps_icon_%282020%29.svg',
                        label: 'Google Maps',
                        action: () => this._openExternalLink('google-maps')
                    },
                    {
                        id: 'open-with-google-earth',
                        icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Google_Earth_icon.svg/100px-Google_Earth_icon.svg.png',
                        label: 'Google Earth',
                        action: () => this._openExternalLink('google-earth')
                    },
                    {
                        id: 'open-with-geolibre',
                        icon: 'globe',
                        label: 'GeoLibre',
                        action: () => this._openWithGeoLibre()
                    },
                    {
                        id: 'open-with-more',
                        icon: 'three-dots',
                        label: 'More',
                        action: () => this._openMoreExternalLinks()
                    }
                ]
            },
            {
                icon: 'badge-3d',
                label: '3D View',
                action: () => window.terrain3DControl?.showPanel()
            },
            {
                id: 'maps-menu',
                icon: 'map',
                label: 'Maps',
                // Resolved on each open (rather than a static array) so the basemap
                // toggle list reflects whichever layers are currently loaded for the
                // active atlas.
                children: () => {
                    const items = [
                        {
                            id: 'import-data',
                            icon: 'plus-circle',
                            label: 'Import Data',
                            action: () => {
                                if (!window.browserControl?._isOpen) window.browserControl?.openBrowser();
                                window.browserControl?._switchToCreator();
                            }
                        },
                        {
                            id: 'browse-maps',
                            icon: 'map',
                            label: 'Browse Maps',
                            action: () => window.browserControl?.openBrowser()
                        },
                        { divider: true }
                    ];

                    if (this._getBasemapLayers().length > 0) {
                        items.push({
                            id: 'toggle-basemaps-menu',
                            icon: 'map',
                            label: 'Toggle Basemaps',
                            // Resolved on each open of this nested flyout, same reasoning
                            // as the parent Maps menu.
                            children: () => this._buildBasemapToggleItems()
                        });
                        items.push({ divider: true });
                    }

                    items.push(
                        {
                            id: 'adjust-maps',
                            icon: 'layers',
                            label: 'Adjust Maps',
                            action: () => window.featureControl?._showPanel()
                        },
                        {
                            id: 'clear-all-maps',
                            icon: 'trash',
                            label: 'Clear All Maps',
                            action: () => window.browserControl?.hideAllLayers()
                        }
                    );

                    return items;
                }
            },
            {
                id: 'toggle-comments',
                icon: 'chat-left-text',
                label: 'Comments',
                checkable: true,
                checked: () => this._isLayerVisible('index-notes'),
                action: () => this._toggleComments()
            }
        ];

        this._menuButtons = [];
        this._buildMenuItems(this._menu, items, this._menuButtons, 0);
        this._items = items;
        document.body.appendChild(this._menu);

        this._submenuLevels = [];
        this._openSubmenuIds = [];
    }

    /**
     * Renders a flat list of menu items (the top-level menu or a flyout) into
     * `container`. Items with `children` open a further nested flyout on hover
     * or click instead of running an action; checkable leaf items get a
     * checkbox indicator kept in sync by _updateCheckedStates via each item's
     * own `checked()` accessor.
     *
     * `depth` is the flyout slot (see `_submenuLevels`) that a `children` item
     * in this list opens into — 0 for the top-level menu, 1 for a flyout opened
     * from the top-level menu, 2 for one opened from within that, etc. Leaf
     * items close any flyout at `depth` or deeper when hovered, so moving
     * across sibling items dismisses whatever flyout they'd otherwise conflict
     * with (touch has no hover, so click-to-toggle below still covers that case).
     */
    _buildMenuItems(container, items, trackInto, depth) {
        items.forEach(item => {
            if (item.divider) {
                const divider = document.createElement('div');
                divider.className = 'shortcut-menu-divider';
                container.appendChild(divider);
                return;
            }

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'shortcut-menu-item';
            if (item.id) button.dataset.itemId = item.id;

            if (/^https?:\/\//.test(item.icon)) {
                const icon = document.createElement('img');
                icon.className = 'shortcut-menu-icon-img';
                icon.src = item.icon;
                icon.alt = '';
                button.appendChild(icon);
            } else {
                const icon = document.createElement('sl-icon');
                icon.setAttribute('name', item.icon);
                button.appendChild(icon);
            }

            const label = document.createElement('span');
            label.textContent = item.label;
            button.appendChild(label);

            if (item.checkable) {
                const state = document.createElement('span');
                state.className = 'shortcut-menu-state';
                button.appendChild(state);
            }

            if (item.children) {
                const chevron = document.createElement('sl-icon');
                chevron.className = 'shortcut-menu-chevron';
                chevron.setAttribute('name', 'chevron-right');
                button.appendChild(chevron);

                button.addEventListener('mouseenter', () => {
                    if (this._openSubmenuIds[depth] !== item.id) this._showSubmenuFor(item, button, depth);
                });
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this._openSubmenuIds[depth] === item.id) {
                        this._closeSubmenu(depth);
                    } else {
                        this._showSubmenuFor(item, button, depth);
                    }
                });
            } else {
                button.addEventListener('mouseenter', () => this._closeSubmenu(depth));
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    item.action();
                    this._hide();
                });
            }

            trackInto.push({ button, item });
            container.appendChild(button);
        });
    }

    /**
     * Opens `item`'s flyout at slot `depth` next to `button` (flipping to the
     * left when it wouldn't fit on the right). Flyout panels are created lazily
     * and reused across opens; `_closeSubmenu(depth)` first clears out whatever
     * (if anything) previously occupied this slot or anything deeper, since a
     * deeper flyout may have been anchored to a button inside it.
     */
    _showSubmenuFor(item, button, depth) {
        this._closeSubmenu(depth);

        let level = this._submenuLevels[depth];
        if (!level) {
            const element = document.createElement('div');
            element.className = 'shortcut-menu shortcut-submenu';
            element.style.display = 'none';
            document.body.appendChild(element);
            level = { element, buttons: [] };
            this._submenuLevels[depth] = level;
        }

        level.element.innerHTML = '';
        level.buttons = [];
        const children = typeof item.children === 'function' ? item.children() : item.children;
        this._buildMenuItems(level.element, children, level.buttons, depth + 1);
        this._updateCheckedStates();

        level.element.style.display = 'block';
        this._openSubmenuIds[depth] = item.id;

        const buttonRect = button.getBoundingClientRect();
        const submenuRect = level.element.getBoundingClientRect();

        let left = buttonRect.right + 4;
        if (left + submenuRect.width > window.innerWidth - 8) {
            left = buttonRect.left - submenuRect.width - 4;
        }
        const maxTop = window.innerHeight - submenuRect.height - 8;

        level.element.style.left = `${Math.max(8, left)}px`;
        level.element.style.top = `${Math.max(8, Math.min(buttonRect.top, maxTop))}px`;
    }

    /**
     * Closes the flyout at `fromDepth` and every deeper one (they can only have
     * been opened from inside it, so they'd otherwise be left dangling/mis-anchored).
     */
    _closeSubmenu(fromDepth = 0) {
        for (let d = fromDepth; d < this._submenuLevels.length; d++) {
            const level = this._submenuLevels[d];
            if (level) {
                level.element.style.display = 'none';
                level.element.innerHTML = '';
                level.buttons = [];
            }
            this._openSubmenuIds[d] = null;
        }
    }

    /**
     * Runs the manual selection trigger for "Select features" — the only way
     * to select/place a marker at a point while Toggle Auto Select is off.
     */
    _selectFeaturesAtPoint() {
        if (!this._lngLat) return;
        window.featureControl?.triggerSelectionAt(this._lngLat);
    }

    /**
     * Point to use for "Open With" links: where the menu was opened, falling
     * back to the map center if it was triggered some other way.
     */
    _getExternalLinkPoint() {
        return this._lngLat || this._map?.getCenter() || null;
    }

    /**
     * Opens one of ButtonExternalMapLinks' generated URLs directly, reusing
     * its link definitions (see button-external-map-links.js) so the URL
     * formats stay in one place.
     */
    _openExternalLink(linkId) {
        const point = this._getExternalLinkPoint();
        if (!point || !window.externalMapLinksControl) return;

        const zoom = Math.round(this._map.getZoom());
        const links = window.externalMapLinksControl._generateNavigationLinks(point.lat, point.lng, zoom);
        const link = links.find(l => l.id === linkId);
        if (link) window.open(link.url, '_blank', 'noopener');
    }

    /**
     * "More" opens the full ButtonExternalMapLinks modal pinned to the point
     * the shortcut menu was opened at.
     */
    _openMoreExternalLinks() {
        const point = this._getExternalLinkPoint();
        if (!point) return;
        window.externalMapLinksControl?.showAtCoordinates(point.lat, point.lng);
    }

    /**
     * Builds a .geolibre.json project from every active layer, publishes it
     * to the shared textb.org pad GeoLibre reads projects from, then opens
     * the map in GeoLibre. See geolibre-api.js / textb-sync.js for how the
     * publish step actually gets the JSON there.
     */
    async _openWithGeoLibre() {
        if (!window.map) return;

        const { project, skipped } = GeoLibreAPI.buildProjectFromActiveLayers(window.map);
        if (project.layers.length === 0) {
            window.layerControl?._showToast('No active layers can be opened in GeoLibre yet', 'error');
            return;
        }

        window.layerControl?._showToast('Opening in GeoLibre...', 'info');
        try {
            await GeoLibreAPI.publishProject(project);
            window.open(GeoLibreAPI.PROJECT_VIEWER_URL, '_blank', 'noopener');
            if (skipped.length) {
                console.warn('[ShortcutMenu] Layers with no GeoLibre translation were left out:', skipped);
            }
        } catch (error) {
            console.error('[ShortcutMenu] Failed to publish GeoLibre project:', error);
            window.layerControl?._showToast('Could not open GeoLibre — publishing failed', 'error');
        }
    }

    /**
     * Finds a layer's group entry in map-layer-controls' _state.groups. Layers
     * shared across atlases (defined once in index.atlas.json, e.g. 'notes')
     * keep their bare `id` there but carry a `_prefixedId` like 'index-notes' —
     * match on either, plus `_originalId`, so callers can use whichever form
     * they have on hand.
     */
    _getGroupElement(layerId) {
        const layerControl = window.layerControl;
        if (!layerControl) return null;

        const groupIndex = layerControl._state.groups.findIndex(g =>
            g.id === layerId || g._prefixedId === layerId || g._originalId === layerId
        );
        if (groupIndex === -1) return null;

        return layerControl._sourceControls[groupIndex] || null;
    }

    /**
     * Basemap-tagged layers currently loaded for the active atlas (i.e. present
     * in map-layer-controls' _state.groups), used to build the "Toggle Basemaps"
     * flyout under Maps.
     */
    _getBasemapLayers() {
        const groups = window.layerControl?._state?.groups || [];
        return groups.filter(g => LayerOrderManager.isBasemap(g));
    }

    _buildBasemapToggleItems() {
        return this._getBasemapLayers().map(layer => ({
            id: `basemap-${layer.id}`,
            icon: 'map',
            label: layer.title || layer.name || layer.id,
            checkable: true,
            checked: () => this._isLayerVisible(layer.id),
            action: () => this._toggleLayerVisibility(layer.id)
        }));
    }

    _isLayerVisible(layerId) {
        const checkbox = this._getGroupElement(layerId)?.querySelector('.toggle-switch input[type="checkbox"]');
        return !!checkbox?.checked;
    }

    /**
     * Routed through MapBrowserControl._handleLayerToggle — the same handler
     * map-browser.html's own layer toggles call via postMessage — rather than
     * driving the <sl-details> show()/hide() directly. That handler is what
     * actually adds/removes the Mapbox layer, fires the URL sync, and (via its
     * layer-registry fallback) adds the group to _state.groups on the fly if
     * it isn't there yet — e.g. 'index-notes' on any atlas other than index,
     * which isn't merged in by default.
     */
    _toggleLayerVisibility(layerId) {
        window.browserControl?._handleLayerToggle(layerId, !this._isLayerVisible(layerId));
    }

    /**
     * Toggles the shared 'notes' layer (registered as 'index-notes' — it's
     * defined once in index.atlas.json and not merged into other atlases by
     * default, so on a non-index atlas it usually isn't in _state.groups yet;
     * _handleLayerToggle's registry fallback adds it on demand). When turning
     * it on, also focuses the comment box that leads every marker's balloon
     * (map-marker-manager.js) for the location the shortcut menu was opened
     * at — reusing a marker already there (e.g. one right-clicked directly)
     * rather than creating a duplicate.
     */
    _toggleComments() {
        const wasVisible = this._isLayerVisible('index-notes');
        this._toggleLayerVisibility('index-notes');

        if (wasVisible || !this._lngLat) return;
        const markerManager = window.featureControl?._markerManager;
        if (!markerManager) return;

        const markerId = markerManager.findMarkerNear(this._lngLat)
            || markerManager.addMarker(this._lngLat, []);

        markerManager.focusCommentInput(markerId);
    }

    _handleContextMenu(e) {
        e.preventDefault();
        this._lngLat = e.lngLat;

        const point = e.originalEvent.touches?.[0] || e.originalEvent;
        this._show(point.clientX, point.clientY);
    }

    _updateCheckedStates() {
        const allButtons = [
            ...this._menuButtons,
            ...this._submenuLevels.flatMap(level => level ? level.buttons : [])
        ];
        allButtons.forEach(({ button, item }) => {
            if (!item.checkable) return;
            const isChecked = !!item.checked?.();
            button.classList.toggle('is-checked', isChecked);
            if (item.iconChecked) {
                button.querySelector('sl-icon:not(.shortcut-menu-chevron)').setAttribute('name', isChecked ? item.iconChecked : item.icon);
            }
            const stateLabel = button.querySelector('.shortcut-menu-state');
            if (stateLabel) stateLabel.textContent = isChecked ? 'ON' : 'OFF';
        });
    }

    _show(clientX, clientY) {
        this._updateCheckedStates();

        this._menu.style.display = 'block';
        // Measure after making it visible so offsetWidth/Height are accurate.
        const menuRect = this._menu.getBoundingClientRect();
        const maxX = window.innerWidth - menuRect.width - 8;
        const maxY = window.innerHeight - menuRect.height - 8;

        this._menu.style.left = `${Math.max(8, Math.min(clientX, maxX))}px`;
        this._menu.style.top = `${Math.max(8, Math.min(clientY, maxY))}px`;
    }

    _hide() {
        if (this._menu) this._menu.style.display = 'none';
        this._closeSubmenu(0);
    }

    _isOpen() {
        return !!this._menu && this._menu.style.display !== 'none';
    }

    _handleOutsideEvent(e) {
        if (!this._isOpen()) return;
        if (this._menu.contains(e.target)) return;
        if (this._submenuLevels.some(level => level?.element.contains(e.target))) return;
        this._hide();
    }

    _handleKeydown(e) {
        if (e.key === 'Escape') this._hide();
    }
}

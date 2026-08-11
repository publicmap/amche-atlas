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
        this._submenu?.parentNode?.removeChild(this._submenu);
        this._submenu = null;
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
                icon: 'badge-3d',
                label: '3D View',
                action: () => window.terrain3DControl?.showPanel()
            },
            {
                icon: 'map',
                label: 'Open Map Browser',
                action: () => window.browserControl?.openBrowser()
            },
            {
                icon: 'plus-circle',
                label: 'Import Map',
                action: () => {
                    if (!window.browserControl?._isOpen) window.browserControl?.openBrowser();
                    window.browserControl?._switchToCreator();
                }
            },
            {
                icon: 'layers',
                label: 'Edit Map Layers',
                action: () => window.featureControl?._showPanel()
            },
            {
                id: 'toggle-comments',
                icon: 'chat-left-text',
                label: 'Show Comments',
                action: () => this._toggleComments()
            },
            {
                icon: 'trash',
                label: 'Remove all layers',
                action: () => window.browserControl?.hideAllLayers()
            },
            {
                icon: 'globe',
                label: 'Open with GeoLibre',
                action: () => this._openWithGeoLibre()
            }
        ];

        this._menuButtons = [];
        this._buildMenuItems(this._menu, items, this._menuButtons, true);
        this._items = items;
        document.body.appendChild(this._menu);

        this._submenu = document.createElement('div');
        this._submenu.className = 'shortcut-menu shortcut-submenu';
        this._submenu.style.display = 'none';
        document.body.appendChild(this._submenu);
        this._submenuButtons = [];
        this._openSubmenuId = null;
    }

    /**
     * Renders a flat list of menu items (top-level or a submenu) into `container`.
     * Items with `children` open a nested submenu on hover or click instead of
     * running an action; checkable leaf items get a checkbox indicator kept in
     * sync by _updateCheckedStates via each item's own `checked()` accessor.
     * `isTopLevel` items close any open submenu when hovered, so moving across
     * unrelated top-level items dismisses a sibling's flyout (touch has no
     * hover, so click-to-toggle below still covers that case).
     */
    _buildMenuItems(container, items, trackInto, isTopLevel) {
        items.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'shortcut-menu-item';
            if (item.id) button.dataset.itemId = item.id;

            const icon = document.createElement('sl-icon');
            icon.setAttribute('name', item.icon);
            button.appendChild(icon);

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
                    if (this._openSubmenuId !== item.id) this._showSubmenuFor(item, button);
                });
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this._openSubmenuId === item.id) {
                        this._closeSubmenu();
                    } else {
                        this._showSubmenuFor(item, button);
                    }
                });
            } else {
                if (isTopLevel) {
                    button.addEventListener('mouseenter', () => this._closeSubmenu());
                }
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
     * Opens `item`'s submenu flyout next to `button` (flipping to the left
     * when it wouldn't fit on the right).
     */
    _showSubmenuFor(item, button) {
        this._submenu.innerHTML = '';
        this._submenuButtons = [];
        this._buildMenuItems(this._submenu, item.children, this._submenuButtons, false);
        this._updateCheckedStates();

        this._submenu.style.display = 'block';
        this._openSubmenuId = item.id;

        const buttonRect = button.getBoundingClientRect();
        const submenuRect = this._submenu.getBoundingClientRect();

        let left = buttonRect.right + 4;
        if (left + submenuRect.width > window.innerWidth - 8) {
            left = buttonRect.left - submenuRect.width - 4;
        }
        const maxTop = window.innerHeight - submenuRect.height - 8;

        this._submenu.style.left = `${Math.max(8, left)}px`;
        this._submenu.style.top = `${Math.max(8, Math.min(buttonRect.top, maxTop))}px`;
    }

    _closeSubmenu() {
        if (this._submenu) {
            this._submenu.style.display = 'none';
            this._submenu.innerHTML = '';
        }
        this._submenuButtons = [];
        this._openSubmenuId = null;
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
     * The notes layer's group header IS its own visibility toggle in this app
     * (see map-layer-controls.js _handleGroupShow/_handleGroupHide, wired to the
     * <sl-details>'s sl-show/sl-hide events) — expanding it turns the layer on
     * and syncs the checkbox/URL, collapsing it turns the layer off. Driving
     * that through .show()/.hide() (rather than flipping the checkbox and
     * calling _toggleLayerGroup directly) is what makes both directions and
     * the URL sync actually work.
     */
    _getNotesGroupElement() {
        const layerControl = window.layerControl;
        if (!layerControl) return null;

        const groupIndex = layerControl._state.groups.findIndex(g => g.id === 'notes');
        if (groupIndex === -1) return null;

        return layerControl._sourceControls[groupIndex] || null;
    }

    _isNotesLayerVisible() {
        return !!this._getNotesGroupElement()?.open;
    }

    /**
     * Toggles the notes layer on/off. When turning it on, also focuses the
     * comment box that leads every marker's balloon (map-marker-manager.js)
     * for the location the shortcut menu was opened at — reusing a marker
     * already there (e.g. one right-clicked directly) rather than creating
     * a duplicate.
     */
    _toggleComments() {
        const groupElement = this._getNotesGroupElement();
        if (!groupElement) return;

        if (groupElement.open) {
            groupElement.hide();
            return;
        }

        groupElement.show();

        if (!this._lngLat) return;
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
        [...this._menuButtons, ...this._submenuButtons].forEach(({ button, item }) => {
            if (!item.checkable) return;
            const isChecked = !!item.checked?.();
            button.classList.toggle('is-checked', isChecked);
            if (item.iconChecked) {
                button.querySelector('sl-icon:not(.shortcut-menu-chevron)').setAttribute('name', isChecked ? item.iconChecked : item.icon);
            }
            const stateLabel = button.querySelector('.shortcut-menu-state');
            if (stateLabel) stateLabel.textContent = isChecked ? 'ON' : 'OFF';
        });

        const commentsButton = this._menu.querySelector('[data-item-id="toggle-comments"]');
        const commentsLabel = commentsButton?.querySelector('span');
        if (commentsLabel) {
            commentsLabel.textContent = this._isNotesLayerVisible() ? 'Hide Comments' : 'Show Comments';
        }
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
        this._closeSubmenu();
    }

    _isOpen() {
        return !!this._menu && this._menu.style.display !== 'none';
    }

    _handleOutsideEvent(e) {
        if (!this._isOpen()) return;
        if (this._menu.contains(e.target)) return;
        if (this._submenu?.contains(e.target)) return;
        this._hide();
    }

    _handleKeydown(e) {
        if (e.key === 'Escape') this._hide();
    }
}

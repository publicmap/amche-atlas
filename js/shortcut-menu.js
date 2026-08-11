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
                icon: 'chat-left-text',
                label: 'Comments',
                action: () => this._addCommentAtLocation()
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
            },
            {
                id: 'select-multiple-features',
                icon: 'plus-circle-dotted',
                iconChecked: 'plus-circle-fill',
                label: 'Select multiple features',
                checkable: true,
                action: () => {
                    const enabled = !window.featureControl?.isAddSelectionModeEnabled();
                    window.featureControl?.setAddSelectionMode(enabled);
                }
            }
        ];

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
                const check = document.createElement('sl-icon');
                check.className = 'shortcut-menu-check';
                check.setAttribute('name', 'check-lg');
                button.appendChild(check);
            }

            button.addEventListener('click', (e) => {
                e.stopPropagation();
                item.action();
                this._hide();
            });

            this._menu.appendChild(button);
        });

        this._items = items;
        document.body.appendChild(this._menu);
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
     * Turns on the notes layer and opens the same "Add Note" popup form used
     * when clicking an empty spot on the map (map-marker-manager.js), pre-filled
     * for the location the shortcut menu was opened at.
     */
    _addCommentAtLocation() {
        if (!this._lngLat) return;

        this._enableLayer('notes');

        const markerManager = window.featureControl?._markerManager;
        if (!markerManager) return;

        const markerId = markerManager.addMarker(this._lngLat, [], { showPopup: true });

        // _showMarkerPopup wires up the popup's own button listeners (including
        // the add-note form) on its own setTimeout(0); queue after that so the
        // button exists by the time we click it.
        setTimeout(() => {
            const popupElement = markerManager._markers.get(markerId)?.popup?.getElement();
            popupElement?.querySelector('.add-note-btn')?.click();

            const select = popupElement?.querySelector('.note-layer-select');
            if (select?.querySelector('option[value="notes"]')) {
                select.value = 'notes';
            }
        }, 0);
    }

    _enableLayer(layerId) {
        const layerControl = window.layerControl;
        if (!layerControl) return;

        const groupIndex = layerControl._state.groups.findIndex(g => g.id === layerId);
        if (groupIndex === -1) return;

        const groupElement = layerControl._sourceControls[groupIndex];
        const checkbox = groupElement?.querySelector('.toggle-switch input[type="checkbox"]');
        if (checkbox?.checked) return;

        if (checkbox) checkbox.checked = true;
        groupElement?.show?.();
        layerControl._toggleLayerGroup(groupIndex, true);
    }

    _handleContextMenu(e) {
        e.preventDefault();
        this._lngLat = e.lngLat;

        const point = e.originalEvent.touches?.[0] || e.originalEvent;
        this._show(point.clientX, point.clientY);
    }

    _updateCheckedStates() {
        const enabled = window.featureControl?.isAddSelectionModeEnabled?.() || false;
        this._menu.querySelectorAll('.shortcut-menu-item').forEach(button => {
            const item = this._items.find(i => i.id === button.dataset.itemId);
            if (!item || !item.checkable) return;
            button.classList.toggle('is-checked', enabled);
            button.querySelector('sl-icon:not(.shortcut-menu-check)').setAttribute('name', enabled ? item.iconChecked : item.icon);
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
    }

    _isOpen() {
        return !!this._menu && this._menu.style.display !== 'none';
    }

    _handleOutsideEvent(e) {
        if (!this._isOpen()) return;
        if (this._menu.contains(e.target)) return;
        this._hide();
    }

    _handleKeydown(e) {
        if (e.key === 'Escape') this._hide();
    }
}

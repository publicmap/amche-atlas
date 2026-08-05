/**
 * ShortcutMenu - Right-click / long-press context menu for quick access to
 * frequently used app actions.
 *
 * Desktop: right-click on the map.
 * Touch: long-press on the map. Mobile browsers fire the native `contextmenu`
 * DOM event on long-press, and Mapbox GL forwards that as its own
 * `contextmenu` map event, so a single listener covers both input types
 * without any custom touch-timer code here.
 */
export class ShortcutMenu {
    constructor() {
        this._map = null;
        this._menu = null;
        this._lngLat = null;

        this._handleContextMenu = this._handleContextMenu.bind(this);
        this._handleOutsideEvent = this._handleOutsideEvent.bind(this);
        this._handleKeydown = this._handleKeydown.bind(this);
        this._hide = this._hide.bind(this);
    }

    onAdd(map) {
        this._map = map;
        this._createMenu();

        map.on('contextmenu', this._handleContextMenu);
        map.on('movestart', this._hide);
        map.on('zoomstart', this._hide);

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
        document.removeEventListener('mousedown', this._handleOutsideEvent, true);
        document.removeEventListener('touchstart', this._handleOutsideEvent, true);
        document.removeEventListener('keydown', this._handleKeydown);
        window.removeEventListener('resize', this._hide);

        this._menu?.parentNode?.removeChild(this._menu);
        this._menu = null;
        this._map = null;
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

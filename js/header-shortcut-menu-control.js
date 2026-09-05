/**
 * HeaderShortcutMenuControl - header-nav button (top-left, next to the atlas
 * + layers menu) that opens the same shortcut menu as
 * long-pressing the map (see shortcut-menu.js). Both share their item tree,
 * flyout rendering, and action handlers via ShortcutMenuBase
 * (shortcut-menu-base.js), so any change there shows up in both places.
 *
 * The context this menu acts on is always the current map center - the
 * equivalent of pressing the middle of the map - captured fresh each
 * time the menu is opened.
 *
 * Not a mapboxgl control - this lives in the header-nav DOM, not on the map.
 */
import { ShortcutMenuBase } from './shortcut-menu-base.js';

export class HeaderShortcutMenuControl extends ShortcutMenuBase {
    constructor() {
        super();
        this._container = null;
        this._button = null;
    }

    mount(hostEl, map) {
        if (!hostEl) return;
        this._attachMap(map);

        this._container = document.createElement('div');
        this._container.className = 'header-shortcut-menu';

        this._button = document.createElement('button');
        this._button.type = 'button';
        this._button.className = 'header-shortcut-menu-btn';
        this._button.setAttribute('aria-label', 'Shortcuts');
        this._button.innerHTML = '<sl-icon name="hand-index-thumb"></sl-icon>';
        this._button.addEventListener('click', () => this.toggle());

        this._container.appendChild(this._button);
        hostEl.appendChild(this._container);

        this._excludeFromOutsideClose = [this._container];
    }

    unmount() {
        this._container?.parentNode?.removeChild(this._container);
        this._container = null;
        this._button = null;
        this._detachMap();
    }

    toggle() {
        if (this._isOpen()) this._hide();
        else this.open();
    }

    open() {
        if (!this._map || !this._button) return;
        this._lngLat = this._map.getCenter();

        const rect = this._button.getBoundingClientRect();
        this._show(rect.left, rect.bottom + 4);
        this._setButtonOpen(true);
    }

    _hide() {
        super._hide();
        this._setButtonOpen(false);
    }

    _setButtonOpen(open) {
        this._button?.classList.toggle('active', open);
        this._button?.querySelector('sl-icon')?.setAttribute('name', open ? 'hand-index-thumb-fill' : 'hand-index-thumb');
    }
}

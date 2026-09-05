/**
 * LayerStackOptionsMenu - the flyout behind the "..." button at the foot of the
 * layer stack (see js/layer-stack-strip.js).
 *
 * It shows a hand-picked subset of the shortcut menu's items rather than its own
 * copies of them: the labels, icons, checked states and handlers all come from
 * ShortcutMenuBase's tree (js/shortcut-menu-base.js) by id, so these actions
 * stay defined in exactly one place alongside the long-press menu and the
 * header shortcut button.
 *
 * Like HeaderShortcutMenuControl this is not a mapboxgl control - it is opened
 * by a button the strip owns, and acts on the current map center.
 */
import { ShortcutMenuBase } from './shortcut-menu-base.js';

// Closing on hover-out is deferred: there is a gap between the button and the
// panel, and the pointer crosses it on the way in.
const HOVER_CLOSE_MS = 180;

const ITEM_IDS = [
    'clear-all-maps',
    'zoom-to-selected',
    'toggle-auto-select',
    'clear-selection',
    'toggle-multi-select'
];

export class LayerStackOptionsMenu extends ShortcutMenuBase {
    /**
     * @param {Function} [onVisibilityChange] - called with the new open state.
     *   The strip reveals its button on hover, so it needs to know to hold it
     *   visible for as long as this menu is open (it can be dismissed by an
     *   outside click or Escape, not just by the button).
     */
    constructor({ onVisibilityChange = null } = {}) {
        super();
        this._onVisibilityChange = onVisibilityChange;
        this._closeTimer = null;
    }

    /**
     * @param {Object} map - the Mapbox GL map the actions act on
     * @param {HTMLElement} button - the strip's "..." button this menu hangs off
     */
    mount(map, button) {
        this._button = button;
        this._attachMap(map);
        // Raises this menu over the search box's suggestions panel; see the CSS
        this._menu.classList.add('layer-stack-options-menu');
        this._excludeFromOutsideClose = [button];
        this._bindHover();
    }

    unmount() {
        clearTimeout(this._closeTimer);
        this._detachMap();
        this._button = null;
    }

    /**
     * Hover opens the menu, the way the strip's own layer flyouts and the
     * shortcut menu's nested flyouts do. It closes once the pointer has left
     * both the button and the panel - whichever of the two it lands on cancels
     * the pending close, so crossing the gap between them keeps it open.
     */
    _bindHover() {
        const enter = () => {
            clearTimeout(this._closeTimer);
            if (!this._isOpen()) this.open();
        };
        const leave = () => {
            clearTimeout(this._closeTimer);
            this._closeTimer = setTimeout(() => this._hide(), HOVER_CLOSE_MS);
        };

        [this._button, this._menu].forEach(el => {
            el.addEventListener('mouseenter', enter);
            el.addEventListener('mouseleave', leave);
        });
    }

    _getMenuItems() {
        return this._pickMenuItems(ITEM_IDS);
    }

    close() {
        this._hide();
    }

    toggle() {
        if (this._isOpen()) this._hide();
        else this.open();
    }

    /**
     * Opened to the right of the button rather than below it - the strip is a
     * column against the left edge, so the space beside it is where the layer
     * flyouts already open.
     */
    open() {
        if (!this._button) return;
        this._lngLat = this._map?.getCenter() || null;

        const rect = this._button.getBoundingClientRect();
        this._show(rect.right + 4, rect.top);
        this._button.classList.add('active');
        this._onVisibilityChange?.(true);
    }

    _hide() {
        clearTimeout(this._closeTimer);
        super._hide();
        this._button?.classList.remove('active');
        this._onVisibilityChange?.(false);
    }
}

/**
 * ConsolePanel - a panel hung under the map console (css/map-console.css),
 * toggled by its own trigger on the console's place line: the Address panel
 * (js/map-location-menu-control.js) from the place name, Map view
 * (js/map-view-panel.js) from the 3D icon, Locate (js/locate-panel.js) from
 * the location icon. The Share panel (js/share-view-panel.js) takes part in
 * the same one-at-a-time rule through claimConsolePanel().
 *
 * A panel stays open while the map is panned or zoomed under it - it closes
 * from its trigger, its close button, Esc, a click on other UI, or a click on
 * the map itself, which drops a marker whose popup the panel would cover.
 *
 * Subclasses fill the panel in `_build(body, header)`, may keep it current in
 * `_refresh()` (every LIVE_REFRESH_MS while open) and tidy up in `_teardown()`.
 */
import { addCloseButton } from './location-tabs.js';

const LIVE_REFRESH_MS = 500;
const panels = new Set();

export function registerConsolePanel(panel) {
    panels.add(panel);
}

export function releaseConsolePanel(panel) {
    panels.delete(panel);
}

/** Closes every other registered panel; call as a panel opens. */
export function claimConsolePanel(panel) {
    panels.forEach(other => { if (other !== panel) other.close(); });
}

export class ConsolePanel {
    /**
     * @param {{title: string, icon: string, className?: string}} options - the
     *   header's title and icon, and an extra class for the panel
     */
    constructor({ title, icon, className = '' }) {
        this._title = title;
        this._icon = icon;
        this._className = className;
        this._map = null;
        this._button = null;
        this._panel = null;
        this._isOpen = false;
        this._timer = null;

        this._handleOutsideEvent = this._handleOutsideEvent.bind(this);
        this._handleKeydown = this._handleKeydown.bind(this);
        this.close = this.close.bind(this);
    }

    /** @param {{button?: HTMLElement}} [options] - the trigger on the console */
    mount(map, { button = null } = {}) {
        if (!map) return;
        this._map = map;
        this._button = button;
        this._button?.addEventListener('click', () => this.toggle());

        this._panel = document.createElement('div');
        this._panel.className = `map-location-menu ${this._className}`.trim();
        this._panel.setAttribute('role', 'dialog');
        this._panel.setAttribute('aria-label', this._title);
        this._panel.style.display = 'none';
        document.body.appendChild(this._panel);

        document.addEventListener('mousedown', this._handleOutsideEvent, true);
        document.addEventListener('keydown', this._handleKeydown);
        window.addEventListener('resize', this.close);
        map.on('click', this.close);
        registerConsolePanel(this);
    }

    unmount() {
        this.close();
        document.removeEventListener('mousedown', this._handleOutsideEvent, true);
        document.removeEventListener('keydown', this._handleKeydown);
        window.removeEventListener('resize', this.close);
        this._map?.off('click', this.close);
        releaseConsolePanel(this);
        this._panel?.remove();
        this._panel = null;
        this._button = null;
        this._map = null;
    }

    get isOpen() {
        return this._isOpen;
    }

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    }

    open() {
        if (!this._map || !this._panel || this._isOpen) return;
        claimConsolePanel(this);
        this._isOpen = true;
        this._button?.classList.add('active');
        this._render();
        this._place();
        this._timer = setInterval(() => this._refresh(), LIVE_REFRESH_MS);
    }

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;
        if (this._panel) this._panel.style.display = 'none';
        this._button?.classList.remove('active');
        clearInterval(this._timer);
        this._timer = null;
        this._teardown();
    }

    _build() {}
    _refresh() {}
    _teardown() {}

    _render() {
        this._teardown();
        this._panel.replaceChildren();
        const section = document.createElement('section');
        section.className = 'place-section';
        const header = document.createElement('div');
        header.className = 'place-label place-panel-head';
        const title = document.createElement('span');
        title.className = 'place-panel-title';
        const icon = document.createElement('sl-icon');
        icon.className = 'place-tab-icon';
        icon.setAttribute('name', this._icon);
        title.append(icon, document.createTextNode(this._title));
        header.appendChild(title);
        this._headerIcon = icon;
        section.appendChild(header);
        this._panel.appendChild(section);
        this._build(section, header);
        addCloseButton(header, this.close);
    }

    // Under the console card it is opened from, at the same width.
    _place() {
        const anchor = this._button?.closest('.map-console') || this._button;
        this._panel.style.display = 'block';
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        this._panel.style.width = anchor === this._button ? '' : `${rect.width}px`;
        const maxLeft = window.innerWidth - this._panel.getBoundingClientRect().width - 8;
        this._panel.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
        this._panel.style.top = `${rect.bottom + 8}px`;
    }

    // Subclasses add the places outside the panel that should not close it.
    _keepsOpen() {
        return false;
    }

    _handleOutsideEvent(e) {
        if (!this._isOpen) return;
        if (this._button?.contains(e.target) || this._panel?.contains(e.target)) return;
        // Stays open while the map is panned or zoomed under it.
        if (this._map?.getCanvasContainer().contains(e.target)) return;
        if (this._keepsOpen(e.target)) return;
        this.close();
    }

    _handleKeydown(e) {
        if (e.key === 'Escape' && this._isOpen) this.close();
    }
}

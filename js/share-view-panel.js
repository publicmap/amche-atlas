/**
 * ShareViewPanel - the Share panel, opened from the link icon at the start of
 * the map console's place line (js/map-control-bar.js). Everything about the
 * view's URL in one place:
 *
 * - "Share this map view": QR thumbnail + link (js/share-url-panel.js, which
 *   also owns the fullscreen QR modal and its "Customize URL" parameter
 *   editor). Its label's other tab, "History", has undo / redo and the map's
 *   recent steps (js/map-history.js, drawn by js/location-history.js).
 * - "Open With": the popular map services as icons, expanding to the full
 *   list of other map services the view can be opened in
 *   (js/share-external-links.js, links in js/external-map-links.js).
 *
 * It hangs under the console like the console's other panels
 * (js/console-panel.js) and shares their look (css/map-console.css); opening
 * one closes the others. It
 * stays open while the map is panned or zoomed under it - it closes from the
 * link icon, Esc, a click on other UI, or a click on the map itself. `window.shareViewPanel` is this instance.
 */
import { ShareUrlPanel } from './share-url-panel.js';
import { buildHistoryControls } from './location-history.js';
import { addCloseButton, buildTabs } from './location-tabs.js';
import { buildExternalLinksSection } from './share-external-links.js';
import { claimConsolePanel, registerConsolePanel, releaseConsolePanel } from './console-panel.js';

const LIVE_REFRESH_MS = 500;

export class ShareViewPanel {
    constructor() {
        this._map = null;
        this._button = null;
        this._panel = null;
        this._isOpen = false;
        this._timer = null;
        this._tab = 'share';
        this._sharePanel = new ShareUrlPanel();

        this._handleOutsideEvent = this._handleOutsideEvent.bind(this);
        this._handleKeydown = this._handleKeydown.bind(this);
        this.close = this.close.bind(this);
        this._handleMoveEnd = () => {
            if (this._isOpen && !this._links?.pinned) this._links?.render();
        };
    }

    /** @param {{button?: HTMLElement}} [options] - the trigger (the console's link icon) */
    mount(map, { button = null } = {}) {
        if (!map) return;
        this._map = map;
        this._button = button;
        this._button?.addEventListener('click', () => this.toggle());

        this._panel = document.createElement('div');
        this._panel.className = 'map-location-menu share-view-panel';
        this._panel.setAttribute('role', 'dialog');
        this._panel.setAttribute('aria-label', 'Share this view');
        this._panel.style.display = 'none';
        document.body.appendChild(this._panel);

        document.addEventListener('mousedown', this._handleOutsideEvent, true);
        document.addEventListener('keydown', this._handleKeydown);
        window.addEventListener('resize', this.close);
        map.on('moveend', this._handleMoveEnd);
        map.on('click', this.close);
        registerConsolePanel(this);
        window.shareViewPanel = this;
    }

    unmount() {
        this.close();
        this._map?.off('moveend', this._handleMoveEnd);
        this._map?.off('click', this.close);
        document.removeEventListener('mousedown', this._handleOutsideEvent, true);
        document.removeEventListener('keydown', this._handleKeydown);
        window.removeEventListener('resize', this.close);
        this._sharePanel.destroy();
        releaseConsolePanel(this);
        this._panel?.remove();
        this._panel = null;
        this._map = null;
        if (window.shareViewPanel === this) window.shareViewPanel = null;
    }

    get isOpen() {
        return this._isOpen;
    }

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    }

    /**
     * @param {{point?: {lat: number, lng: number}}} [options] - build the
     *   other-maps links for this point instead of the map centre, and open
     *   that section
     */
    open({ point = null } = {}) {
        if (!this._map || !this._panel) return;
        claimConsolePanel(this);
        if (!this._isOpen) {
            this._isOpen = true;
            this._button?.classList.add('active');
            this._render();
            this._place();
            this._timer = setInterval(() => this._sharePanel.refresh(), LIVE_REFRESH_MS);
        }
        if (point) {
            this._links.setPoint(point);
            this._links.expand();
        }
    }

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;
        if (this._panel) this._panel.style.display = 'none';
        this._button?.classList.remove('active');
        clearInterval(this._timer);
        this._timer = null;
        this._history?.destroy();
        this._history = null;
        this._links = null;
    }

    // Under the console card it is opened from, at the same width.
    _place() {
        const anchor = this._button?.closest('.map-console');
        this._panel.style.display = 'block';
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        this._panel.style.width = `${rect.width}px`;
        const maxLeft = window.innerWidth - this._panel.getBoundingClientRect().width - 8;
        this._panel.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
        this._panel.style.top = `${rect.bottom + 8}px`;
    }

    _section(label) {
        const section = document.createElement('section');
        section.className = 'place-section';
        if (label) {
            const heading = document.createElement('div');
            heading.className = 'place-label';
            heading.textContent = label;
            section.appendChild(heading);
        }
        this._panel.appendChild(section);
        return section;
    }

    _render() {
        this._panel.replaceChildren();
        this._history?.destroy();

        // "Share this map view" and "History" are tabs of one section
        const share = this._section(' ');
        const label = share.querySelector('.place-label');
        label.textContent = '';
        label.classList.add('share-view-label');
        const tabs = [{ id: 'share', label: 'Share this map view', icon: 'link-45deg' }];
        if (window.mapHistory) tabs.push({ id: 'history', label: 'History' });
        const panels = buildTabs(share, tabs, this._tab, (id) => { this._tab = id; }, label);
        label.querySelector('#place-tab-history')?.classList.add('share-view-history-tab');
        addCloseButton(label, this.close);
        panels.share.appendChild(this._sharePanel.buildInlineSection({ onOpenModal: this.close }));
        if (window.mapHistory) this._history = buildHistoryControls(window.mapHistory, panels.history);

        this._links = buildExternalLinksSection(this._section(), this._map);
    }

    _handleOutsideEvent(e) {
        if (!this._isOpen) return;
        if (this._button?.contains(e.target) || this._panel?.contains(e.target)) return;
        // Stays open while the map is panned or zoomed under it.
        if (this._map?.getCanvasContainer().contains(e.target)) return;
        this.close();
    }

    _handleKeydown(e) {
        if (e.key === 'Escape' && this._isOpen) this.close();
    }
}

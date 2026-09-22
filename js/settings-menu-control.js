/**
 * SettingsMenuControl - header-nav gear button (top-left, before the atlas +
 * layers menu). Built as a manual toggle button + panel, the same pattern
 * every other header-nav menu here uses (see atlas-layer-menu-control.js,
 * map-location-menu-control.js) rather than a Shoelace <sl-dropdown>, so it
 * looks and behaves identically to its neighbors.
 *
 * Two sections:
 * - "Map Rendering Engine": switches between Mapbox GL JS and MapLibre GL JS
 *   (see js/gl-compat.js and the `?renderer=` URL param in docs/API.md) -
 *   the version shown next to each comes from window.amche.RENDERER_ASSETS
 *   (set in index.html), and the one matching window.amche.DEFAULT_RENDERER
 *   is labelled "(Default)". Switching reloads the page with `?renderer=`
 *   set (or removed, if switching back to the default) - the choice can't
 *   take effect without a reload since it decides which GL library's
 *   <script> tag index.html injects before any other app code runs.
 * - "Locale": country/primary/fallback-language fields (see js/locale-ui.js
 *   and js/locale-manager.js), mirrored to the `?country=`/`?lang=`/
 *   `?fallbackLang=` URL params - takes effect immediately, no reload.
 *
 * Not a mapboxgl control - this lives in the header-nav DOM, not on the map.
 */
import { mountLocaleSection } from './locale-ui.js';

export class SettingsMenuControl {
    constructor() {
        this._container = null;
        this._button = null;
        this._panel = null;
        this._isOpen = false;
        // mousedown+capture, not click+bubble: AutocompleteBadgeInput (see
        // js/locale-ui.js) replaces its badge <button> with an <input> as
        // the very first thing its own click handler does - by the time a
        // bubble-phase document 'click' listener runs afterward, that badge
        // is already detached from the DOM, so `container.contains(e.target)`
        // reads false and this closed the whole panel out from under the
        // edit it was trying to open. Capture-phase mousedown runs before
        // any of that, while the target is still where the user clicked.
        this._onDocClick = (e) => {
            if (!this._isOpen || this._container.contains(e.target)) return;
            // AutocompleteBadgeInput portals its dropdown to <body> so a
            // scrolling ancestor (this panel) can't clip it - it's no longer
            // a descendant of _container while open, so it needs its own
            // exemption here or every click inside it reads as "outside".
            if (e.target.closest?.('.ac-badge-input-list')) return;
            this.close();
        };
    }

    mount(hostEl) {
        if (!hostEl) return;

        this._container = document.createElement('div');
        this._container.className = 'atlas-layer-menu settings-menu';

        this._button = document.createElement('button');
        this._button.type = 'button';
        this._button.className = 'header-shortcut-menu-btn settings-menu-btn';
        this._button.setAttribute('aria-label', 'Settings');
        this._button.innerHTML = '<sl-icon name="gear"></sl-icon>';
        this._button.addEventListener('click', () => this.toggle());

        this._panel = document.createElement('div');
        this._panel.className = 'atlas-layer-menu-panel settings-menu-panel';
        this._panel.style.display = 'none';
        this._panel.appendChild(this._buildRendererSection());

        const localeHeader = document.createElement('div');
        localeHeader.className = 'atlas-layer-menu-atlas-header';
        localeHeader.innerHTML = '<span class="atlas-layer-menu-atlas-name">Locale</span>';
        this._panel.appendChild(localeHeader);

        this._localeBody = document.createElement('div');
        this._localeBody.className = 'settings-locale-body';
        this._panel.appendChild(this._localeBody);

        this._container.appendChild(this._button);
        this._container.appendChild(this._panel);
        hostEl.appendChild(this._container);

        document.addEventListener('mousedown', this._onDocClick, true);
    }

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    }

    open() {
        this._isOpen = true;
        this._panel.style.display = 'block';
        this._button.classList.add('active');
        this._button.querySelector('sl-icon')?.setAttribute('name', 'gear-fill');
        // Rebuilt fresh on every open, not just once at mount - the country
        // default (js/locale-manager.js) tracks the map's live Nominatim
        // reverse-geocode, which resolves well after this control mounts.
        mountLocaleSection(this._localeBody);
    }

    close() {
        this._isOpen = false;
        this._panel.style.display = 'none';
        this._button.classList.remove('active');
        this._button.querySelector('sl-icon')?.setAttribute('name', 'gear');
    }

    _buildRendererSection() {
        const currentRenderer = window.amche?.RENDERER || 'mapbox';
        const defaultRenderer = window.amche?.DEFAULT_RENDERER || 'mapbox';
        const assets = window.amche?.RENDERER_ASSETS || {};

        const header = document.createElement('div');
        header.className = 'atlas-layer-menu-atlas-header';
        header.innerHTML = '<span class="atlas-layer-menu-atlas-name">Map Rendering Engine</span>';

        const rows = document.createElement('div');
        rows.className = 'atlas-layer-menu-layers';
        rows.style.display = 'block';

        [['mapbox', 'Mapbox'], ['maplibre', 'Maplibre']].forEach(([id, name]) => {
            rows.appendChild(this._buildRendererRow(id, name, assets[id], id === currentRenderer, id === defaultRenderer, currentRenderer));
        });

        const wrapper = document.createDocumentFragment();
        wrapper.appendChild(header);
        wrapper.appendChild(rows);
        const container = document.createElement('div');
        container.appendChild(wrapper);
        return container;
    }

    _buildRendererRow(id, name, asset, isActive, isDefault, currentRenderer) {
        const row = document.createElement('div');
        row.className = 'atlas-layer-menu-layer-row';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'atlas-layer-menu-toggle';
        toggle.classList.toggle('on', isActive);
        toggle.innerHTML = `<sl-icon name="${isActive ? 'check-circle-fill' : 'circle'}"></sl-icon>`;
        toggle.setAttribute('aria-label', `Use ${name}`);

        const label = document.createElement('span');
        label.className = 'atlas-layer-menu-layer-title';
        label.textContent = `${name} `;
        if (asset?.version) {
            const kbd = document.createElement('kbd');
            if (asset.homepage) {
                const link = document.createElement('a');
                link.href = asset.homepage;
                link.target = '_blank';
                link.rel = 'noopener';
                link.className = 'settings-menu-version-link';
                link.textContent = `v${asset.version}`;
                link.addEventListener('click', (e) => e.stopPropagation());
                kbd.appendChild(link);
            } else {
                kbd.textContent = `v${asset.version}`;
            }
            label.appendChild(kbd);
        }
        if (isDefault) label.appendChild(document.createTextNode(' (Default)'));

        row.appendChild(toggle);
        row.appendChild(label);

        row.addEventListener('click', () => {
            if (id !== currentRenderer) this._switchRenderer(id);
        });

        return row;
    }

    _switchRenderer(nextRenderer) {
        const url = new URL(window.location.href);
        if (nextRenderer === (window.amche?.DEFAULT_RENDERER || 'mapbox')) {
            url.searchParams.delete('renderer');
        } else {
            url.searchParams.set('renderer', nextRenderer);
        }
        window.location.href = url.toString();
    }
}

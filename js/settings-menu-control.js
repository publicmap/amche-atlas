/**
 * SettingsMenuControl - header-nav locale button (a translate-style icon: overlapping boxes, the primary language code in the filled front one, a fixed "हि" in the outline one behind) (top-left, before the atlas +
 * layers menu). Built as a manual toggle button + panel, the same pattern
 * every other header-nav menu here uses (see the atlas-layer-menu-* styles in css/styles.css,
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
 *   and js/locale-manager.js), mirrored to the `?country=`/`?lang=` URL
 *   params (`lang` is comma-separated, primary language first) - takes
 *   effect immediately, no reload.
 *
 * Not a mapboxgl control - this lives in the header-nav DOM, not on the map.
 */
import { mountLocaleSection } from './locale-ui.js';
import { localeManager } from './locale-manager.js';

const ICON_HTML = '<span class="locale-icon"><span class="locale-icon-box locale-icon-fallback">हि</span><span class="locale-icon-box locale-icon-primary"></span></span>';

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
        this._button.setAttribute('aria-label', 'Locale settings');
        this._button.innerHTML = ICON_HTML;
        this._unsubscribeLocale = localeManager.onChange(() => this._renderIcon());
        localeManager.ensureDefaultsLoaded().then(() => this._renderIcon());
        this._button.addEventListener('click', () => this.toggle());

        this._panel = document.createElement('div');
        this._panel.className = 'atlas-layer-menu-panel settings-menu-panel';
        this._panel.style.display = 'none';
        this._panel.appendChild(this._buildLocaleSection());
        this._panel.appendChild(this._buildRendererSection());

        this._container.appendChild(this._button);
        this._container.appendChild(this._panel);
        hostEl.appendChild(this._container);
        this._renderIcon();

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
        // Rebuilt fresh on every open, not just once at mount - the country
        // default (js/locale-manager.js) tracks the map's live Nominatim
        // reverse-geocode, which resolves well after this control mounts.
        mountLocaleSection(this._localeBody);
    }

    close() {
        this._isOpen = false;
        this._panel.style.display = 'none';
        this._button.classList.remove('active');
    }

    _renderIcon() {
        const short = (lang) => (lang?.code || '').split('-')[0].slice(0, 2).toUpperCase();
        const code = short(localeManager.getPrimaryLanguage()) || 'EN';
        this._container.querySelectorAll('.locale-icon-primary').forEach(el => { el.textContent = code; });
    }

    _buildLocaleSection() {
        const section = document.createElement('section');
        section.className = 'settings-section settings-locale-section';

        const watermark = document.createElement('div');
        watermark.className = 'settings-locale-watermark';
        watermark.setAttribute('aria-hidden', 'true');
        watermark.innerHTML = ICON_HTML;

        section.appendChild(this._buildSectionHeader('Locale', 'Language and region for map labels'));
        this._localeBody = document.createElement('div');
        this._localeBody.className = 'settings-locale-body';
        section.append(watermark, this._localeBody);
        return section;
    }

    _buildSectionHeader(title, caption) {
        const header = document.createElement('div');
        header.className = 'settings-section-header';
        const name = document.createElement('div');
        name.className = 'settings-section-title';
        name.textContent = title;
        const sub = document.createElement('div');
        sub.className = 'settings-section-caption';
        sub.textContent = caption;
        header.append(name, sub);
        return header;
    }

    _buildRendererSection() {
        const currentRenderer = window.amche?.RENDERER || 'mapbox';
        const defaultRenderer = window.amche?.DEFAULT_RENDERER || 'mapbox';
        const assets = window.amche?.RENDERER_ASSETS || {};

        const section = document.createElement('section');
        section.className = 'settings-section';
        section.appendChild(this._buildSectionHeader('Map Rendering Engine', 'Switching reloads the map'));

        const options = document.createElement('div');
        options.className = 'settings-renderer-options';
        [['mapbox', 'Mapbox'], ['maplibre', 'Maplibre']].forEach(([id, name]) => {
            options.appendChild(this._buildRendererRow(id, name, assets[id], id === currentRenderer, id === defaultRenderer, currentRenderer));
        });
        section.appendChild(options);
        return section;
    }

    _buildRendererRow(id, name, asset, isActive, isDefault, currentRenderer) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'settings-renderer-option';
        row.classList.toggle('on', isActive);
        row.setAttribute('aria-pressed', String(isActive));

        const check = document.createElement('sl-icon');
        check.name = isActive ? 'check-circle-fill' : 'circle';

        const label = document.createElement('span');
        label.className = 'settings-renderer-name';
        label.textContent = name;

        const meta = document.createElement('span');
        meta.className = 'settings-renderer-meta';
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
            meta.appendChild(kbd);
        }
        if (isDefault) meta.appendChild(document.createTextNode('Default'));

        row.append(check, label, meta);
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

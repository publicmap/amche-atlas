/**
 * MapControlBar - the map console at the top-left of the map: one card for
 * everything that used to be the header strip, the atlas button, the search
 * box, the layer stack and the map browser panel.
 *
 * It has two modes:
 * The amche.in menu sits just above the card, as a small logo and name (an
 * atlas's own `site.brand` instead, see js/site-brand.js), so the bar row
 * starts with the search field at the card's left edge.
 *
 * - explore: one bar row (the atlas field with its Find icon, On map, Pins and -
 *   once there is a route - Routes, with their counts) over a line naming the place at the map center -
 *   starting with the Share panel's link icon (js/share-view-panel.js), ending
 *   in the 3D terrain and location status icons - then, when opened, Share
 *   for the pins (js/console/share-pins.js). Marker panels dock in a column
 *   beneath the console (map-marker-manager.js).
 * - find: the same row with the atlas name turned into the search field (its
 *   search icon moved to the left, the search settings at the right end) over
 *   Find's results (js/console/find-panel.js). The Maps, Pins and Routes
 *   buttons stay and pick Find's view; the search icon goes back to the atlas
 *   view. With a query their badges count the view's results instead of what
 *   is on the map.
 *
 * Esc, the close button at the end of the row, the active view's button again,
 * a map click or picking a place result return to explore. The close button
 * and a map click keep the query and view, so clicking the collapsed console
 * reopens Find where it was. `window.mapConsole` is this instance.
 *
 * The bar row keeps the `.map-control-bar-head` / `.map-control-bar-main`
 * classes: map-marker-manager.js docks marker panels beneath that row.
 */
import { FindPanel, VIEWS, viewFor } from './console/find-panel.js';
import { SharePanel } from './console/share-pins.js';
import { createMarkerProvider } from './search/providers/marker-provider.js';
import { routeStore } from './search/route-store.js';
import { placeLine } from './map-search-toggle.js';
import { trackLog } from './gpx-log.js';
import { MODE } from './map-orientation-modes.js';
import { applyConsoleBrand } from './site-brand.js';

const LOGO_SRC = 'assets/img/icon-192x192.png';
const markers = createMarkerProvider();

function badge(node) {
    const count = document.createElement('span');
    count.className = 'console-badge';
    count.hidden = true;
    node.appendChild(count);
    return count;
}

function button(className, iconName, title) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.title = title;
    node.setAttribute('aria-label', title);
    if (iconName) {
        const glyph = document.createElement('sl-icon');
        glyph.name = iconName;
        node.appendChild(glyph);
    }
    return node;
}

export class MapControlBar {
    constructor() {
        this._el = null;
        this._mode = 'explore';
        this._iconKey = null;
        this._layers = null;
        this._onAtlasChanged = () => this.update(this._layers);
        this._onLocation = (e) => this._setPlace(placeLine(e.detail?.address));
        this._onStatus = () => this.refreshStatus();
        this._onMapClick = () => { if (this._mode === 'find') this.setMode('explore', { keepQuery: true }); };
        this._onKeydown = (e) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            if (document.querySelector('sl-dropdown[open]')) return;
            if (this._mode === 'find') this.escape();
            else if (this.share?.isOpen) this.closeShare();
        };
        this._onUrlUpdated = () => {
            this._updatePins();
            this.share?.render();
        };
        this._onRoutesChanged = () => setTimeout(() => this._updatePins());
    }

    mount(hostEl, { map = null, searchToggle = null, stripEl = null, footerEl = null, onModeChange = null, onToggleHidden = null } = {}) {
        this._map = map || window.map;
        this._searchToggle = searchToggle;
        this._onModeChange = onModeChange;

        this._el = document.createElement('div');
        this._el.className = 'map-control-bar map-console';
        this._el.dataset.mode = 'explore';

        const head = document.createElement('div');
        head.className = 'map-control-bar-head';

        const home = button('console-home', null, 'amche.in menu');
        const logo = document.createElement('img');
        logo.src = LOGO_SRC;
        logo.alt = '';
        home.append(logo, Object.assign(document.createElement('span'), { className: 'console-home-name', textContent: 'amche.in' }));
        this._home = home;
        if (window.amche?.isDevBuild) home.appendChild(Object.assign(document.createElement('span'), { className: 'console-home-dev', title: 'Development build' }));
        home.addEventListener('click', () => window.amche?.openNavMenu?.());
        applyConsoleBrand(home);

        this._main = button('map-control-bar-main', null, 'Find atlases, maps and places ( / )');
        this._nameEl = document.createElement('span');
        this._nameEl.className = 'map-control-bar-name';
        const searchIcon = document.createElement('sl-icon');
        searchIcon.name = 'search';
        searchIcon.className = 'map-control-bar-search';
        this._main.append(searchIcon, this._nameEl);
        this._main.addEventListener('click', () => this.reopen());

        const searchEl = searchToggle?._el || null;
        if (searchEl) searchEl.classList.add('when-find');

        this._layersBtn = button('console-btn console-layers-btn', 'layers', 'Maps on the map');
        this._badge = badge(this._layersBtn);
        this._layersBtn.addEventListener('click', () => this.toggleFind('layers'));

        this._pinsBtn = button('console-btn console-pins-btn', 'pin-map', 'Pins');
        this._pinsBadge = badge(this._pinsBtn);
        this._pinsBtn.addEventListener('click', () => this.toggleFind('pins'));

        // The current atlas's icon is the first view button - Find's default
        // view - and carries the loading spinner
        this._atlasBtn = button('console-btn console-atlas-btn', null, 'Atlas view');
        this._iconEl = document.createElement('span');
        this._iconEl.className = 'map-control-bar-icon';
        const iconWrap = document.createElement('span');
        iconWrap.className = 'map-control-bar-icon-wrap';
        const spinner = document.createElement('sl-spinner');
        spinner.className = 'map-control-bar-spinner';
        iconWrap.append(this._iconEl, spinner);
        this._atlasBtn.appendChild(iconWrap);
        this._atlasBtn.addEventListener('click', () => this.toggleFind('atlas'));

        // Explore's field: the search icon and "Search in <atlas>", with the
        // view buttons inside it as they are inside the search field in Find
        this._field = document.createElement('div');
        this._field.className = 'map-control-bar-field when-explore';
        this._field.appendChild(this._main);
        head.append(this._field);
        if (searchEl) head.appendChild(searchEl);
        const settings = searchToggle?.sourcesEl || null;
        if (settings) {
            settings.classList.add('when-find');
            head.appendChild(settings);
        }
        // On a phone Find covers the map, so there is no map left to click to close it
        const close = button('console-btn console-close-btn when-find', 'x-lg', 'Close ( Esc )');
        close.addEventListener('click', () => this.setMode('explore', { keepQuery: true }));
        head.appendChild(close);
        this._routesBtn = button('console-btn console-routes-btn', 'signpost-split', 'Routes');
        this._routesBadge = badge(this._routesBtn);
        this._routesBtn.addEventListener('click', () => this.toggleFind('routes'));
        this._viewButtons = { atlas: this._atlasBtn, layers: this._layersBtn, pins: this._pinsBtn, routes: this._routesBtn };

        this._field.append(...Object.values(this._viewButtons));

        // Opens the Share panel (js/share-view-panel.js)
        this.shareButton = button('map-console-share-btn', 'link-45deg', 'Share this view, map history and other maps');
        this.placeButton = button('map-console-place when-explore', 'geo-alt', 'Address, map view and location for this view');
        this._placeText = document.createElement('span');
        this._placeText.textContent = 'Locating…';
        this.placeButton.appendChild(this._placeText);
        const placeRow = document.createElement('div');
        placeRow.className = 'map-console-place-row when-explore';
        placeRow.append(this.shareButton, this.placeButton, this._buildStatus());

        const body = document.createElement('div');
        body.className = 'map-console-body when-find';
        // Sub-search options under the search field (the Goa survey number
        // search, js/cadastral-search-ui.js, and any to come): each adds its
        // link to the row with addSubSearch and opens its own fields beneath.
        this._subSearch = document.createElement('div');
        this._subSearch.className = 'console-subsearch';
        body.appendChild(this._subSearch);
        this.find = new FindPanel({
            onSelect: (item) => {
                window.searchControl?._selectSuggestion(item);
                this.setMode('explore', { keepQuery: true });
            },
            onHover: (item, hovering) => window.searchControl?.handleSuggestionHover(item, hovering),
            onSharePins: () => this.openShare(),
            clearQuery: () => this._searchToggle?.clear(),
            onDone: () => this.setMode('explore', { keepQuery: true }),
            onViewChange: () => this._syncHead()
        });
        this.find.mount(body, { stripEl, footerEl, subSearchEl: this._subSearch, onToggleHidden, map: this._map });

        const explore = document.createElement('div');
        explore.className = 'map-console-explore when-explore';
        this.share = new SharePanel({ onClose: () => this.closeShare() });
        explore.appendChild(this.share.el);

        this._el.append(head, placeRow, explore, body);
        hostEl.append(home, this._el);
        hostEl.classList.add('has-map-control-bar');

        // Marker panels dock just below the console, so they follow its height
        if (typeof ResizeObserver === 'function') {
            this._resizeObserver = new ResizeObserver(() => window.dispatchEvent(new CustomEvent('mapConsoleResized')));
            this._resizeObserver.observe(this._el);
        }
        window.addEventListener('urlUpdated', this._onUrlUpdated);
        window.addEventListener('marker-saved', this._onUrlUpdated);
        ['routes-changed', 'layersInitialized'].forEach(type => window.addEventListener(type, this._onRoutesChanged));
        this._updatePins();

        window.addEventListener('atlasChanged', this._onAtlasChanged);
        window.addEventListener('mapLocationChanged', this._onLocation);
        window.addEventListener('geolocationModeChanged', this._onStatus);
        this._offTrackLog = trackLog.onChange(this._onStatus);
        document.addEventListener('keydown', this._onKeydown);
        this._map?.on?.('click', this._onMapClick);
        window.mapConsole = this;
    }

    /** Adds a sub-search option's link to the row under the search field. */
    addSubSearch(linkEl) {
        this._subSearch?.appendChild(linkEl);
    }

    get el() {
        return this._el;
    }

    get mode() {
        return this._mode;
    }

    /**
     * @param {'explore'|'find'} mode
     * @param {{view?: string, filter?: string, focus?: boolean, keepQuery?: boolean}} [options]
     *   view - Find's view to open on (atlas, layers, pins, routes; `filter`
     *   takes Find's old filter names); focus - move focus to the field;
     *   keepQuery - leave a picked result's name in the field when closing
     */
    setMode(mode, { view = null, filter = null, focus = true, keepQuery = false } = {}) {
        if (!this._el) return;
        if (mode === 'find') {
            const next = view || filter;
            if (next) this.find.setView(viewFor(next));
            if (this._mode !== 'find') {
                this._mode = 'find';
                this._apply();
                this.find.setVisible(true);
                // A query kept from the last time is searched again for this view
                if (this._searchToggle?.value) window.searchControl?.handleInput?.({ target: null });
            }
            if (focus) this._searchToggle?.focus();
            return;
        }
        if (this._mode === 'explore') return;
        this._mode = 'explore';
        if (!keepQuery) this._searchToggle?.clear();
        this.find.setQuery('');
        this.find.setVisible(false);
        this._apply();
        if (this._el.contains(document.activeElement)) document.activeElement.blur();
    }

    /** Where to keep the pins on the map: the share link or the atlas config. */
    openShare() {
        if (this._mode !== 'explore') this.setMode('explore', { keepQuery: true });
        this.share.open();
    }

    closeShare() {
        this.share.close();
    }

    /** Esc: from a map's details back to the list, otherwise back to the map. */
    escape() {
        if (this._mode !== 'find') return;
        if (this.find.detailsOpen) this.find.closeDetails();
        else this.setMode('explore');
    }

    /** Open a map's details page in Find. */
    showLayer(layer) {
        if (!layer) return;
        this.setMode('find', { focus: false });
        this.find.showLayer(layer);
    }

    toggleFind(view = 'atlas') {
        const next = viewFor(view);
        if (this._mode === 'find' && this.find.view === next) this.setMode('explore');
        else this.setMode('find', { view: next, focus: next === 'atlas' || !!this.find.query });
    }

    /**
     * Back into Find from the collapsed console: the view it was left on, and
     * the query still in the field searched again for the current view.
     */
    reopen() {
        this.setMode('find');
    }

    /** The default atlas view: no query, the atlas selector and its maps in view. */
    resetFind() {
        this._searchToggle?.clear();
        this.find.setQuery('');
        this.setMode('find', { view: 'atlas' });
    }

    setView(view) {
        if (this._mode === 'find') this.find.setView(view);
        else this.setMode('find', { view });
    }

    /**
     * The row in Find: which view is open, the field's placeholder for it,
     * and - with a query - each view's result count in its badge.
     */
    _syncHead() {
        if (!this._el) return;
        const find = this._mode === 'find';
        const view = this.find?.view;
        Object.entries(this._viewButtons).forEach(([id, btn]) => {
            btn.classList.toggle('view-active', find && view === id);
            btn.setAttribute('aria-pressed', String(find && view === id));
        });
        this._searchToggle?.setPlaceholder(VIEWS[view]?.placeholder || this._searchInLabel());
        // Collapsed, the field shows a kept query in place of its placeholder
        const kept = !find && this._searchToggle?.value;
        this._nameEl.textContent = kept || (this._atlasName ? this._searchInLabel() : 'Loading atlas');
        this._nameEl.classList.toggle('has-query', !!kept);
        this._paintBadges();
    }

    _searchInLabel() {
        return this._atlasName ? `Search in ${this._atlasName}` : 'Search place or map';
    }

    _paintBadges() {
        const counts = this._mode === 'find' ? this.find?.counts : null;
        const own = { layers: this._layerCount || 0, pins: markers.list().length, routes: routeStore.routes.length };
        [['layers', this._badge], ['pins', this._pinsBadge], ['routes', this._routesBadge]].forEach(([id, node]) => {
            const value = counts ? counts[id] : own[id];
            node.classList.toggle('is-result', !!counts);
            node.hidden = !value && !counts;
            node.textContent = String(value || 0);
        });
        this._routesBtn.hidden = !own.routes && !(counts?.routes) && this.find?.view !== 'routes';
    }

    _apply() {
        const find = this._mode === 'find';
        this._el.dataset.mode = this._mode;
        this._placeViewButtons(find);
        document.body.classList.toggle('console-find', find);
        this._searchToggle?.setSearching(find);
        this._syncHead();
        this._onModeChange?.(this._mode);
        window.dispatchEvent(new CustomEvent('mapConsoleModeChanged', { detail: { mode: this._mode } }));
    }

    // The view buttons sit inside the field: in Find the search field, after
    // the query; in Explore the collapsed field.
    _placeViewButtons(find) {
        const searchEl = this._searchToggle?._el;
        const buttons = Object.values(this._viewButtons);
        if (find && searchEl) {
            searchEl.append(...buttons);
        } else {
            this._field.append(...buttons);
        }
    }

    setVisible(visible) {
        if (this._el) this._el.style.display = visible ? '' : 'none';
        if (this._home) this._home.style.display = visible ? '' : 'none';
    }

    update(layers) {
        if (!this._el) return;
        this._layers = layers;
        const registry = window.layerRegistry;
        const atlasId = registry?._currentAtlasSet ? registry.getCurrentAtlas() : null;
        const metadata = atlasId ? registry.getAtlasMetadata(atlasId) : null;
        const name = metadata ? (metadata.name || atlasId) : '';

        this._atlasName = name;
        this._main.title = name ? `Search in ${name}: atlases, maps and places ( / )` : 'Find atlases, maps and places ( / )';
        this._atlasBtn.title = name ? `${name}: atlas view` : 'Atlas view';
        this._atlasBtn.setAttribute('aria-label', this._atlasBtn.title);
        this._setIcon(metadata?.icon || null);

        const count = Array.isArray(layers) ? layers.filter(l => l.id !== 'selection').length : 0;
        this._layerCount = count;
        this._syncHead();
        this._layersBtn.title = count ? `${count} maps on the map ( Ctrl+L )` : 'Maps on the map';
        this.find.onMapActions.update(layers);
        this.find.refresh();
    }

    _updatePins() {
        if (!this._pinsBtn) return;
        const count = markers.list().length;
        this._pinsBtn.title = count ? `${count} pin${count === 1 ? '' : 's'} on the map` : 'Pins';
        this._pinsBtn.setAttribute('aria-label', this._pinsBtn.title);

        const routes = routeStore.routes.length;
        this._paintBadges();
        this._routesBtn.title = `${routes} route${routes === 1 ? '' : 's'} on the map`;
        this._routesBtn.setAttribute('aria-label', this._routesBtn.title);
    }

    setHidden(count, shown) {
        this.find?.onMapActions.setHidden(count, shown);
    }

    setLoading(loading) {
        this._el?.classList.toggle('loading', !!loading);
    }

    // The view's status at the end of the place line: whether 3D terrain is
    // on and whether the device is being tracked (and its track logged), each
    // opening its tab of the place menu (js/map-location-menu-control.js).
    _buildStatus() {
        const status = document.createElement('div');
        status.className = 'map-console-status';
        this._terrainIcon = button('map-console-status-btn', 'badge-3d', '3D terrain');
        this._trackingIcon = button('map-console-status-btn', 'crosshair', 'Location');
        this._terrainIcon.addEventListener('click', () => window.mapLocationMenuControl?.toggleTab('view'));
        this._trackingIcon.addEventListener('click', () => window.mapLocationMenuControl?.toggleTab('locate'));
        status.append(this._terrainIcon, this._trackingIcon);
        this.refreshStatus();
        return status;
    }

    refreshStatus() {
        if (!this._terrainIcon) return;
        const terrain = !!window.terrain3DControl?.getEnabled();
        this._terrainIcon.classList.toggle('is-on', terrain);
        this._terrainIcon.title = terrain ? '3D terrain is on - map view settings' : '3D terrain is off - map view settings';

        const control = window.geolocationControl;
        const tracking = !!control?.isTracking;
        const locating = control?.mode === MODE.LOCATING;
        const logging = trackLog.logging;
        this._trackingIcon.classList.toggle('is-on', tracking && !locating);
        this._trackingIcon.classList.toggle('is-pending', locating);
        this._trackingIcon.classList.toggle('is-recording', logging);
        this._trackingIcon.title = [
            locating ? 'Finding your location' : tracking ? (control.isLockedToLocation ? 'Following your location' : 'Showing your location') : 'Location is off',
            logging ? 'logging a track' : null
        ].filter(Boolean).join(', ') + ' - location details';
        [this._terrainIcon, this._trackingIcon].forEach(icon => icon.setAttribute('aria-label', icon.title));
    }

    _setPlace(text) {
        this._placeText.textContent = text || 'This view';
    }

    _setIcon(src) {
        if (src === this._iconKey) return;
        this._iconKey = src;
        this._iconEl.replaceChildren();
        if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            this._iconEl.appendChild(img);
        } else {
            this._iconEl.appendChild(document.createElement('sl-icon')).name = 'map';
        }
    }


    destroy() {
        window.removeEventListener('atlasChanged', this._onAtlasChanged);
        window.removeEventListener('mapLocationChanged', this._onLocation);
        window.removeEventListener('geolocationModeChanged', this._onStatus);
        this._offTrackLog?.();
        window.removeEventListener('urlUpdated', this._onUrlUpdated);
        window.removeEventListener('marker-saved', this._onUrlUpdated);
        ['routes-changed', 'layersInitialized'].forEach(type => window.removeEventListener(type, this._onRoutesChanged));
        document.removeEventListener('keydown', this._onKeydown);
        this._resizeObserver?.disconnect();
        this._map?.off?.('click', this._onMapClick);
        this.find?.destroy();
        document.body.classList.remove('console-find');
        this._el?.parentNode?.classList.remove('has-map-control-bar');
        this._el?.remove();
        this._home?.remove();
        this._el = null;
        if (window.mapConsole === this) window.mapConsole = null;
    }
}

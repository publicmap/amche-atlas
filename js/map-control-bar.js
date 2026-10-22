/**
 * MapControlBar - the map console at the top-left of the map: one card for
 * everything that used to be the header strip, the atlas button, the search
 * box, the layer stack and the map browser panel.
 *
 * It has two modes:
 * - explore: one bar row (home, atlas with its Find icon, On map, Pins and -
 *   once there is a route - Routes, with their counts) over a line naming the place at the map center -
 *   starting with the Share panel's link icon (js/share-view-panel.js), ending
 *   in the 3D terrain and location status icons - then, when opened, Share
 *   for the pins (js/console/share-pins.js). Marker panels dock in a column
 *   beneath the console (map-marker-manager.js).
 * - find: the bar row becomes the search field and the console grows into
 *   Find (js/console/find-panel.js) - one list of atlases, maps, features and
 *   places, with a filter for what is on the map.
 *
 * Esc, the close button, a map click or picking a place/feature result return
 * to explore. `window.mapConsole` is this instance.
 *
 * The bar row keeps the `.map-control-bar-head` / `.map-control-bar-main`
 * classes: map-marker-manager.js docks marker panels beneath that row.
 */
import { FindPanel } from './console/find-panel.js';
import { SharePanel } from './console/share-pins.js';
import { createMarkerProvider } from './search/providers/marker-provider.js';
import { routeStore } from './search/route-store.js';
import { placeLine } from './map-search-toggle.js';
import { trackLog } from './gpx-log.js';
import { MODE } from './map-orientation-modes.js';

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
        this._onMapClick = () => { if (this._mode === 'find') this.setMode('explore'); };
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

    mount(hostEl, { map = null, searchToggle = null, stripEl = null, getOnMapLayers = null, onModeChange = null, onToggleHidden = null } = {}) {
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
        home.appendChild(logo);
        if (window.amche?.isDevBuild) home.appendChild(Object.assign(document.createElement('span'), { className: 'console-home-dev', title: 'Development build' }));
        home.addEventListener('click', () => window.amche?.openNavMenu?.());

        this._main = button('map-control-bar-main when-explore', null, 'Find atlases, maps and places ( / )');
        this._iconEl = document.createElement('span');
        this._iconEl.className = 'map-control-bar-icon';
        const iconWrap = document.createElement('span');
        iconWrap.className = 'map-control-bar-icon-wrap';
        const spinner = document.createElement('sl-spinner');
        spinner.className = 'map-control-bar-spinner';
        iconWrap.append(this._iconEl, spinner);
        this._nameEl = document.createElement('span');
        this._nameEl.className = 'map-control-bar-name';
        const searchIcon = document.createElement('sl-icon');
        searchIcon.name = 'search';
        searchIcon.className = 'map-control-bar-search';
        this._main.append(iconWrap, this._nameEl, searchIcon);
        this._main.addEventListener('click', () => this.setMode('find', { filter: 'all' }));

        const searchEl = searchToggle?._el || null;
        if (searchEl) searchEl.classList.add('when-find');

        this._layersBtn = button('console-btn console-layers-btn when-explore', 'layers', 'Maps on the map');
        this._badge = badge(this._layersBtn);
        this._layersBtn.addEventListener('click', () => this.setMode('find', { filter: 'onmap' }));

        this._pinsBtn = button('console-btn console-pins-btn when-explore', 'pin-map', 'Pins');
        this._pinsBadge = badge(this._pinsBtn);
        this._pinsBtn.addEventListener('click', () => this.setMode('find', { filter: 'pins', focus: false }));

        const closeBtn = button('console-btn when-find', 'x-lg', 'Back to the map ( Esc )');
        closeBtn.addEventListener('click', () => this.setMode('explore'));

        head.append(home, this._main);
        if (searchEl) head.appendChild(searchEl);
        this._routesBtn = button('console-btn console-routes-btn when-explore', 'signpost-split', 'Routes');
        this._routesBadge = badge(this._routesBtn);
        this._routesBtn.addEventListener('click', () => this.setMode('find', { filter: 'routes', focus: false }));

        head.append(this._layersBtn, this._pinsBtn, this._routesBtn, closeBtn);

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
        this.find = new FindPanel({
            onSelect: (item) => {
                window.searchControl?._selectSuggestion(item);
                this.setMode('explore', { keepQuery: true });
            },
            onHover: (item, hovering) => window.searchControl?.handleSuggestionHover(item, hovering),
            getOnMapLayers,
            onSharePins: () => this.openShare(),
            clearQuery: () => this._searchToggle?.clear(),
            onDone: () => this.setMode('explore', { keepQuery: true })
        });
        this.find.mount(body, { stripEl, onToggleHidden, map: this._map });

        const explore = document.createElement('div');
        explore.className = 'map-console-explore when-explore';
        this.share = new SharePanel({ onClose: () => this.closeShare() });
        explore.appendChild(this.share.el);

        this._el.append(head, placeRow, explore, body);
        hostEl.appendChild(this._el);
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

    get mode() {
        return this._mode;
    }

    /**
     * @param {'explore'|'find'} mode
     * @param {{filter?: string, focus?: boolean, keepQuery?: boolean}} [options]
     *   filter - Find's type filter to open on; focus - move focus to the field;
     *   keepQuery - leave a picked result's name in the field when closing
     */
    setMode(mode, { filter = null, focus = true, keepQuery = false } = {}) {
        if (!this._el) return;
        if (mode === 'find') {
            // Reopening starts from All unless a filter was asked for
            if (filter || this._mode !== 'find') this.find.setFilter(filter || 'all');
            if (this._mode !== 'find') {
                this._mode = 'find';
                this._apply();
                this.find.setVisible(true);
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

    toggleFind(filter = 'all') {
        if (this._mode === 'find' && this.find.filter === filter) this.setMode('explore');
        else this.setMode('find', { filter });
    }

    _apply() {
        const find = this._mode === 'find';
        this._el.dataset.mode = this._mode;
        document.body.classList.toggle('console-find', find);
        this._searchToggle?.setSearching(find);
        this._onModeChange?.(this._mode);
        window.dispatchEvent(new CustomEvent('mapConsoleModeChanged', { detail: { mode: this._mode } }));
    }

    setVisible(visible) {
        if (this._el) this._el.style.display = visible ? '' : 'none';
    }

    update(layers) {
        if (!this._el) return;
        this._layers = layers;
        const registry = window.layerRegistry;
        const atlasId = registry?._currentAtlasSet ? registry.getCurrentAtlas() : null;
        const metadata = atlasId ? registry.getAtlasMetadata(atlasId) : null;
        const name = metadata ? (metadata.name || atlasId) : '';

        this._nameEl.textContent = name || 'Loading atlas';
        this._nameEl.classList.toggle('placeholder', !name);
        this._main.title = name ? `${name}: find atlases, maps and places ( / )` : 'Find atlases, maps and places ( / )';
        this._setIcon(metadata?.icon || null);

        const count = Array.isArray(layers) ? layers.filter(l => l.id !== 'selection').length : 0;
        this._badge.hidden = !count;
        this._badge.textContent = String(count);
        this._layersBtn.title = count ? `${count} maps on the map ( Ctrl+L )` : 'Maps on the map';
        this.find.onMapActions.update(layers);
        this.find.refresh();
    }

    _updatePins() {
        if (!this._pinsBtn) return;
        const count = markers.list().length;
        this._pinsBadge.hidden = !count;
        this._pinsBadge.textContent = String(count);
        this._pinsBtn.title = count ? `${count} pin${count === 1 ? '' : 's'} on the map` : 'Pins';
        this._pinsBtn.setAttribute('aria-label', this._pinsBtn.title);

        const routes = routeStore.routes.length;
        this._routesBtn.hidden = !routes;
        this._routesBadge.hidden = !routes;
        this._routesBadge.textContent = String(routes);
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

    get el() {
        return this._el;
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
        this._el = null;
        if (window.mapConsole === this) window.mapConsole = null;
    }
}

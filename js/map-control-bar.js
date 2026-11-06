/**
 * MapControlBar - the map console at the top-left of the map.
 *
 * Its head (js/console/console-head.js) is the current atlas as a card, and
 * a status line closes the card, changing with the mode.
 *
 * - explore: collapsed to the atlas card and the status line - the Share
 *   panel's link icon (js/share-view-panel.js), the place at the map center
 *   and the 3D terrain and location icons, each toggling a panel of its own
 *   (js/console-panel.js) - then, when opened, Share for the locations
 *   (js/console/share-locations.js). Marker panels dock in a column beneath
 *   the console (map-marker-manager.js). The atlas card opens Find.
 * - find: the head becomes a header bar - menu, atlas picker, close -
 *   then the search field with its filters and Find's
 *   sections (js/console/find-panel.js), with the map actions
 *   (js/layer-stack-footer.js) as its status line. The atlas picker's
 *   chevron swaps all of that for the atlas cards, one under another.
 *
 * Esc, the close button, a map click or picking a place result return to
 * explore. The close button and a map click keep the query, so the atlas
 * card reopens Find where it was. `window.mapConsole` is this instance.
 *
 * The bar row keeps the `.map-control-bar-head` / `.map-control-bar-main`
 * classes: map-marker-manager.js docks marker panels beneath the console.
 */
import { FindPanel, viewFor } from './console/find-panel.js';
import { ConsoleHead } from './console/console-head.js';
import { SharePanel } from './console/share-locations.js';
import { placeLine } from './map-search-toggle.js';
import { trackLog } from './gpx-log.js';
import { MODE } from './map-orientation-modes.js';
import { applyConsoleBrand } from './site-brand.js';


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
        this._layers = null;
        this._onAtlasChanged = () => this.update(this._layers);
        this._onLocation = (e) => this._setPlace(placeLine(e.detail?.address));
        this._onStatus = () => this.refreshStatus();
        // A click on the map closes Find, except while it shows an open route:
        // that click adds a stop to the route (map-marker-manager.js's _addClickedMarker)
        this._onMapClick = () => {
            if (this._mode !== 'find' || this.editingRoute()) return;
            this.setMode('explore', { keepQuery: true });
        };
        this._onKeydown = (e) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            if (document.querySelector('sl-dropdown[open]')) return;
            if (this._mode === 'find') this.escape();
            else if (this.share?.isOpen) this.closeShare();
        };
        this._onUrlUpdated = () => this.share?.render();
    }

    mount(hostEl, { map = null, searchToggle = null, stripEl = null, footerEl = null, onModeChange = null, onToggleHidden = null } = {}) {
        this._map = map || window.map;
        this._searchToggle = searchToggle;
        this._onModeChange = onModeChange;

        this._el = document.createElement('div');
        this._el.className = 'map-control-bar map-console';
        this._el.dataset.mode = 'explore';

        this._head = new ConsoleHead({
            onMenu: () => window.amche?.openNavMenu?.(),
            onAtlas: () => (this._mode === 'find' ? this.find.toggleAtlas() : this.setMode('find', { view: 'atlas', focus: false })),
            onClose: () => this.setMode('explore', { keepQuery: true })
        });
        applyConsoleBrand(this._head.menu);

        const searchEl = searchToggle?._el || null;

        // Opens the Share panel (js/share-view-panel.js)
        this.shareButton = button('map-console-share-btn', 'link-45deg', 'Share this view, map history and other maps');
        this.placeButton = button('map-console-place', 'geo-alt', 'Address of this view');
        this._placeText = document.createElement('span');
        this._placeText.textContent = 'Locating…';
        this.placeButton.appendChild(this._placeText);
        const placeRow = document.createElement('div');
        placeRow.className = 'map-console-place-row when-explore';
        placeRow.append(this.shareButton, this.placeButton, this._buildStatus());

        const body = document.createElement('div');
        body.className = 'map-console-body when-find';
        // The atlas cards and tag chips, filled by Find under the atlas picker
        const atlasEl = document.createElement('div');
        atlasEl.className = 'console-atlas-slot';
        body.appendChild(atlasEl);
        if (searchEl) {
            searchEl.classList.add('when-find');
            body.appendChild(searchEl);
        }
        // The filter toggles or tag chips, opened from the search field
        const optionsEl = document.createElement('div');
        optionsEl.className = 'console-search-options';
        body.appendChild(optionsEl);
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
            onShareLocations: () => this.openShare(),
            clearQuery: () => this._searchToggle?.clear(),
            onDone: () => this.setMode('explore', { keepQuery: true }),
            onAtlasToggle: (open) => {
                this._head.setPickerOpen(open);
                this._el.classList.toggle('picking-atlas', open);
            }
        });
        this.find.mount(body, { atlasEl, searchEl, optionsEl, stripEl, footerEl, onToggleHidden, map: this._map });

        const explore = document.createElement('div');
        explore.className = 'map-console-explore when-explore';
        this.share = new SharePanel({ onClose: () => this.closeShare() });
        explore.appendChild(this.share.el);

        this._el.append(this._head.head, explore, body, placeRow);
        hostEl.append(this._el);
        hostEl.classList.add('has-map-control-bar');

        // Marker panels dock just below the console, so they follow its height
        if (typeof ResizeObserver === 'function') {
            this._resizeObserver = new ResizeObserver(() => window.dispatchEvent(new CustomEvent('mapConsoleResized')));
            this._resizeObserver.observe(this._el);
        }
        window.addEventListener('urlUpdated', this._onUrlUpdated);
        window.addEventListener('marker-saved', this._onUrlUpdated);

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
     *   view - Find's view to open on (atlas, locations, routes; `filter`
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

    /** Where to keep the locations on the map: the share link or the atlas config. */
    openShare() {
        if (this._mode !== 'explore') this.setMode('explore', { keepQuery: true });
        this.share.open();
    }

    closeShare() {
        this.share.close();
    }

    /** Esc: out of survey search, the atlas cards or a map's details back to the list, otherwise back to the map. */
    escape() {
        if (this._mode !== 'find') return;
        if (window.cadastralSearchUI?.exitSurveyMode?.()) return;
        if (this.find.atlasOpen) this.find.toggleAtlas();
        else if (this.find.detailsOpen) this.find.closeDetails();
        else this.setMode('explore');
    }

    /** Whether Find is showing a route's open card, which map clicks add stops to. */
    editingRoute() {
        return this._mode === 'find' && !!window.featureControl?._markerManager?._routeFilter;
    }

    /** A route's card, open, in Find's Routes (a click on its badge on the map). */
    openRoute(route) {
        if (!route) return;
        this.setMode('find', { focus: false });
        this.find.openRoute(route);
    }

    /** Open a map's details page in Find. */
    showLayer(layer) {
        if (!layer) return;
        this.setMode('find', { focus: false });
        this.find.showLayer(layer);
    }

    /** Find scrolled to a section (atlas is the Map section), or closed if it is open already. */
    toggleFind(view = 'atlas') {
        if (this._mode === 'find') this.setMode('explore', { keepQuery: true });
        else this.setMode('find', { view: viewFor(view), focus: false });
    }

    /**
     * Back into Find from the collapsed console, with the query still in the
     * field searched again.
     */
    reopen() {
        this.setMode('find');
    }

    /** The default atlas view: no query, the atlas selector and its maps in view. */
    resetFind() {
        window.cadastralSearchUI?.exitSurveyMode?.();
        this._searchToggle?.clear();
        this.find.setQuery('');
        this.setMode('find', { view: 'atlas' });
    }

    setView(view) {
        if (this._mode === 'find') this.find.setView(view);
        else this.setMode('find', { view });
    }

    /** The search field's placeholder, naming the atlas. */
    _syncHead() {
        if (!this._el) return;
        this._searchToggle?.setPlaceholder(this._atlasName ? `Search ${this._atlasName}` : 'Search places and maps');
    }

    _apply() {
        const find = this._mode === 'find';
        this._el.dataset.mode = this._mode;
        document.body.classList.toggle('console-find', find);
        this._searchToggle?.setSearching(find);
        this._syncHead();
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

        this._atlasName = name;
        this._head.setAtlas({ name, description: metadata?.description || '', iconSrc: metadata?.icon || null, image: metadata?.headerImage || null });
        this._syncHead();
        this.find.setOnMap(layers);
        this.find.onMapActions.update(layers);
        this.find.refresh();
    }

    setHidden(count, shown) {
        this.find?.setOnMapHidden(count, shown);
    }

    setLoading(loading) {
        this._el?.classList.toggle('loading', !!loading);
    }

    // The view's status at the end of the place line: whether 3D terrain is
    // on and whether the device is being tracked (and its track logged). Each
    // icon is the trigger of its own panel (js/map-view-panel.js,
    // js/locate-panel.js), mounted in map-init.js.
    _buildStatus() {
        const status = document.createElement('div');
        status.className = 'map-console-status';
        this._terrainIcon = button('map-console-status-btn', 'badge-3d', '3D terrain');
        this._trackingIcon = button('map-console-status-btn', 'crosshair', 'Location');
        status.append(this._terrainIcon, this._trackingIcon);
        this.refreshStatus();
        return status;
    }

    get terrainButton() {
        return this._terrainIcon;
    }

    get locationButton() {
        return this._trackingIcon;
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

    destroy() {
        window.removeEventListener('atlasChanged', this._onAtlasChanged);
        window.removeEventListener('mapLocationChanged', this._onLocation);
        window.removeEventListener('geolocationModeChanged', this._onStatus);
        this._offTrackLog?.();
        window.removeEventListener('urlUpdated', this._onUrlUpdated);
        window.removeEventListener('marker-saved', this._onUrlUpdated);
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

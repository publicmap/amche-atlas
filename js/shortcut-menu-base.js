/**
 * ShortcutMenuBase - the menu item definitions, nested-flyout rendering, and
 * action handlers shared by every shortcut-menu entry point, so each action
 * stays defined in exactly one place even though not every entry point shows
 * every item.
 *
 * Subclasses own how the menu is *triggered* and *positioned*, and which
 * items (see `_getMenuItems()`) it shows:
 * - ShortcutMenu (shortcut-menu.js): long-press on the map, positioned at the
 *   cursor/touch point, `_lngLat` = that point. Shows the full tree from
 *   `_getAllMenuItems()` below.
 * - LayerStackOptionsMenu (layer-stack-options-menu.js): the "..." button at
 *   the foot of the layer-stack strip, offering only a hand-picked subset of
 *   this tree (see its own ITEM_IDS) - including a few items ("Open With",
 *   "Comments", "Toggle Basemaps") that live only there, not on the
 *   long-press menu.
 */
import { GeoLibreAPI } from './geolibre-api.js';
import { LayerOrderManager } from './layer-order-manager.js';
import { routeStore } from './search/route-store.js';
import { routeBounds } from './search/route-geojson.js';
import { WaypointPicker } from './waypoint-picker.js';
import { reverseGeocodeAddress } from './nominatim-search.js';
import { DIRECTIONS_PROFILES, getDirectionsProfile, getDirectionsProfileInfo, setDirectionsProfile } from './search/directions-profile.js';

// Zoom "Zoom To Location" settles at when the map is further out than this -
// the same detail level CameraUtils.DEFAULT_FIT_OPTIONS caps its fits at.
const LOCATION_ZOOM = 16;

export class ShortcutMenuBase {
    constructor() {
        this._map = null;
        this._menu = null;
        this._lngLat = null;

        // The marker _ensureMarkerAt created (not reused) for wherever the menu
        // was last opened at, while it's still just a placeholder nobody has
        // acted on - excluded from "is there a selection" checks (see
        // _buildSelectionMenuItems) so opening the menu doesn't itself count as
        // one. Cleared the moment something else turns it into a real marker
        // (see _ensureMarkerAt's `pending` doc below).
        this._pendingMarkerId = null;

        // Stack of flyout panels, one per nesting depth (0 = first flyout opened
        // from the top-level menu, 1 = a flyout opened from within that, etc).
        // `_openSubmenuIds[depth]` tracks which item's flyout currently occupies
        // that depth, so hover/click can tell "already open" from "switch to this
        // sibling" and close everything deeper than wherever focus moved to.
        this._submenuLevels = [];
        this._openSubmenuIds = [];

        // Elements a subclass's own trigger control (e.g. a header button)
        // lives in - clicks on these must not be treated as "outside" clicks
        // that close the menu, since the trigger's own click handler toggles it.
        this._excludeFromOutsideClose = [];

        this._handleOutsideEvent = this._handleOutsideEvent.bind(this);
        this._handleKeydown = this._handleKeydown.bind(this);
        this._hide = this._hide.bind(this);
        this._onRouteGeolocate = this._onRouteGeolocate.bind(this);
    }

    /**
     * Wires up the map reference, builds the menu DOM, and attaches the
     * document-level listeners common to every entry point. Called by a
     * subclass's onAdd()/mount().
     */
    _attachMap(map) {
        this._map = map;
        this._createMenu();

        // Default origin for "Route To" when nothing was set via "Route
        // From" - the same picker, with the same GPS-else-map-center
        // preference, that map-nearby-features-control.js gives Route From, so
        // both menus start a route from the same place. Fed passively off
        // whatever GPS state already exists; this never triggers its own
        // permission prompt the way that control's own button does.
        this._routeOrigin = new WaypointPicker(map, { preferMyLocation: true });
        const geo = window.geolocationControl;
        if (geo) {
            if (geo.lastPosition) this._routeOrigin.setUserPosition(geo.lastPosition);
            else if (geo.isTracking) this._routeOrigin.preferGeolocation();
            geo.on('geolocate', this._onRouteGeolocate);
        }

        document.addEventListener('mousedown', this._handleOutsideEvent, true);
        document.addEventListener('touchstart', this._handleOutsideEvent, true);
        document.addEventListener('keydown', this._handleKeydown);
        window.addEventListener('resize', this._hide);
    }

    /**
     * Tears down everything _attachMap set up. Called by a subclass's
     * onRemove()/unmount() alongside its own trigger-specific cleanup.
     */
    _detachMap() {
        document.removeEventListener('mousedown', this._handleOutsideEvent, true);
        document.removeEventListener('touchstart', this._handleOutsideEvent, true);
        document.removeEventListener('keydown', this._handleKeydown);
        window.removeEventListener('resize', this._hide);
        window.geolocationControl?.off('geolocate', this._onRouteGeolocate);
        this._routeOrigin = null;

        this._menu?.parentNode?.removeChild(this._menu);
        this._menu = null;
        this._submenuLevels.forEach(level => level?.element.parentNode?.removeChild(level.element));
        this._submenuLevels = [];
        this._openSubmenuIds = [];
        this._map = null;
    }

    _onRouteGeolocate(e) {
        this._routeOrigin?.setUserPosition({ lat: e.coords.latitude, lng: e.coords.longitude });
    }

    _createMenu() {
        this._menu = document.createElement('div');
        this._menu.className = 'shortcut-menu';
        this._menu.style.display = 'none';

        this._menuButtons = [];
        this._items = [];
        this._renderMenuItems();
        document.body.appendChild(this._menu);

        this._submenuLevels = [];
        this._openSubmenuIds = [];
    }

    /**
     * (Re)builds the top-level rows from _getMenuItems(). Called again on
     * every open (see _show) rather than only at mount, so rows whose
     * presence or label depends on the current state - "Zoom To Selected"
     * dropping out with nothing selected, "Route To" naming the pending
     * origin, "Remove from Route" appearing only on a marker some route
     * claims - are resolved against the point the menu is opening at, the
     * same way `children` functions already resolve per open.
     */
    _renderMenuItems() {
        this._menu.innerHTML = '';
        this._menuButtons = [];
        this._items = this._getMenuItems();
        this._buildMenuItems(this._menu, this._items, this._menuButtons, 0);
    }

    /**
     * The item tree this menu renders. Every subclass overrides this and
     * picks from _getAllMenuItems() by id (see _pickMenuItems) - both
     * ShortcutMenu and LayerStackOptionsMenu show only part of the full
     * catalog, and a different part at that, so each action stays defined
     * exactly once here regardless of which entry point(s) show it.
     */
    _getMenuItems() {
        return this._getAllMenuItems();
    }

    /**
     * Items looked up by id anywhere in the full tree, returned in the order
     * the ids are given (unknown ids are dropped). Function-valued `children`
     * are resolved to search them, the same way opening that flyout would.
     */
    _pickMenuItems(ids) {
        const flat = [];
        const walk = (items) => items.forEach(item => {
            if (item.divider) return;
            flat.push(item);
            const children = typeof item.children === 'function' ? item.children() : item.children;
            if (children) walk(children);
        });
        walk(this._getAllMenuItems());

        return ids.map(id => flat.find(item => item.id === id)).filter(Boolean);
    }

    _getAllMenuItems() {
        return [
            {
                // No menu shows this group as an entry of its own any more -
                // both entry points pick its children by id instead ("Zoom To
                // Selected" sits at the top level of the long-press menu, the
                // rest in the strip's options menu). It stays as the place
                // those two are defined, and as what _pickMenuItems walks
                // through to find them.
                id: 'selection-menu',
                icon: 'hand-index-thumb',
                iconChecked: 'hand-index-thumb-fill',
                label: 'Select',
                // Resolved on each open so "Zoom To Selected" / "Clear All Locations"
                // can drop out once nothing is left to zoom to or clear (see
                // _buildSelectionMenuItems).
                children: () => this._buildSelectionMenuItems()
            },
            {
                id: 'edit-marker-label',
                icon: 'pencil',
                label: 'Edit Label',
                action: () => this._editMarkerLabel()
            },
            {
                id: 'remove-marker',
                icon: 'trash',
                label: 'Remove Marker',
                action: () => this._removeMarkerAtPoint()
            },
            {
                id: 'zoom-to-location',
                icon: 'geo-alt',
                label: 'Zoom To Location',
                action: () => this._zoomToLocation()
            },
            // The three route rows sit at the top level rather than behind a
            // "Route" flyout: starting/extending a route from the pressed
            // point is the common reason to open this menu, so it costs no
            // extra step. Their labels/presence are resolved per open (see
            // _renderMenuItems), and the point is read at click time so the
            // row acts on wherever the menu was opened.
            {
                id: 'route-from-here',
                icon: 'record-circle',
                iconClass: 'shortcut-menu-icon-from',
                label: 'Route From',
                action: () => this._handleRouteEndpoint('from', this._getExternalLinkPoint(), 'this location')
            },
            {
                id: 'route-to-here',
                icon: 'flag',
                iconClass: 'shortcut-menu-icon-to',
                // Naming the pending origin here saves the user remembering
                // what their last "Route From" picked.
                label: routeStore.pendingOrigin?.label ? `Route To from ${routeStore.pendingOrigin.label}` : 'Route To',
                action: () => this._handleRouteEndpoint('to', this._getExternalLinkPoint(), 'this location')
            },
            ...this._buildRemoveFromRouteItems(),
            {
                id: 'routing-options-menu',
                icon: getDirectionsProfileInfo().icon,
                label: 'Routing Options',
                children: () => this._buildRoutingProfileItems()
            },
            {
                id: 'open-with-menu',
                icon: 'box-arrow-up-right',
                label: 'Open With',
                children: [
                    {
                        id: 'open-with-osm',
                        icon: 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Openstreetmap_logo.svg',
                        label: 'OpenStreetMap',
                        action: () => this._openExternalLink('osm')
                    },
                    {
                        id: 'open-with-google-maps',
                        icon: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Google_Maps_icon_%282020%29.svg',
                        label: 'Google Maps',
                        action: () => this._openExternalLink('google-maps')
                    },
                    {
                        id: 'open-with-google-earth',
                        icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Google_Earth_icon.svg/100px-Google_Earth_icon.svg.png',
                        label: 'Google Earth',
                        action: () => this._openExternalLink('google-earth')
                    },
                    {
                        id: 'open-with-geolibre',
                        icon: 'globe',
                        label: 'GeoLibre',
                        action: () => this._openWithGeoLibre()
                    },
                    {
                        id: 'open-with-more',
                        icon: 'three-dots',
                        label: 'More',
                        action: () => this._openMoreExternalLinks()
                    }
                ]
            },
            {
                id: 'toggle-basemaps-menu',
                icon: 'map',
                label: 'Toggle Basemaps',
                // Resolved on each open, so the list reflects whichever basemap
                // layers are currently loaded for the active atlas.
                children: () => this._buildBasemapToggleItems()
            },
            {
                id: 'clear-all-maps',
                icon: 'trash',
                label: 'Clear All Maps',
                action: () => window.browserControl?.hideAllLayers()
            },
            {
                id: 'clear-all-markers',
                icon: 'x-circle',
                label: 'Clear All Markers',
                action: () => this._clearAllMarkersAndRoutes()
            },
            {
                id: 'toggle-hover-tooltips',
                icon: 'cursor',
                iconChecked: 'cursor-fill',
                label: 'Hover Tooltips',
                // Off leaves the map inert under the pointer: no hover feature
                // state, no hover popup (see MapFeatureControl.setHoverEnabled).
                checkable: true,
                checked: () => window.featureControl?.isHoverEnabled?.() ?? true,
                action: () => {
                    const enabled = !(window.featureControl?.isHoverEnabled?.() ?? true);
                    window.featureControl?.setHoverEnabled(enabled);
                }
            },
            {
                id: 'toggle-comments',
                icon: 'chat-left-text',
                label: 'Comments',
                checkable: true,
                checked: () => this._isLayerVisible('index-notes'),
                action: () => this._toggleComments()
            }
        ];
    }

    /**
     * Renders a flat list of menu items (the top-level menu or a flyout) into
     * `container`. Items with `children` open a further nested flyout on hover
     * or click instead of running an action; checkable leaf items get a
     * checkbox indicator kept in sync by _updateCheckedStates via each item's
     * own `checked()` accessor.
     *
     * `depth` is the flyout slot (see `_submenuLevels`) that a `children` item
     * in this list opens into — 0 for the top-level menu, 1 for a flyout opened
     * from the top-level menu, 2 for one opened from within that, etc. Leaf
     * items close any flyout at `depth` or deeper when hovered, so moving
     * across sibling items dismisses whatever flyout they'd otherwise conflict
     * with (touch has no hover, so click-to-toggle below still covers that case).
     */
    _buildMenuItems(container, items, trackInto, depth) {
        items.forEach(item => {
            if (item.divider) {
                const divider = document.createElement('div');
                divider.className = 'shortcut-menu-divider';
                container.appendChild(divider);
                return;
            }

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'shortcut-menu-item';
            if (item.id) button.dataset.itemId = item.id;

            if (/^https?:\/\//.test(item.icon)) {
                const icon = document.createElement('img');
                icon.className = 'shortcut-menu-icon-img';
                icon.src = item.icon;
                icon.alt = '';
                button.appendChild(icon);
            } else {
                const icon = document.createElement('sl-icon');
                icon.setAttribute('name', item.icon);
                if (item.iconClass) icon.classList.add(item.iconClass);
                button.appendChild(icon);
            }

            const label = document.createElement('span');
            label.textContent = item.label;
            button.appendChild(label);

            if (item.checkable) {
                const state = document.createElement('span');
                state.className = 'shortcut-menu-state';
                button.appendChild(state);
            }

            if (item.children) {
                const chevron = document.createElement('sl-icon');
                chevron.className = 'shortcut-menu-chevron';
                chevron.setAttribute('name', 'chevron-right');
                button.appendChild(chevron);

                button.addEventListener('mouseenter', () => {
                    if (this._openSubmenuIds[depth] !== item.id) this._showSubmenuFor(item, button, depth);
                });
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this._openSubmenuIds[depth] === item.id) {
                        this._closeSubmenu(depth);
                    } else {
                        this._showSubmenuFor(item, button, depth);
                    }
                });
            } else {
                button.addEventListener('mouseenter', () => this._closeSubmenu(depth));
                button.addEventListener('click', (e) => {
                    e.stopPropagation();
                    item.action();
                    this._hide();
                });
            }

            trackInto.push({ button, item });
            container.appendChild(button);
        });
    }

    /**
     * Opens `item`'s flyout at slot `depth` next to `button` (flipping to the
     * left when it wouldn't fit on the right). Flyout panels are created lazily
     * and reused across opens; `_closeSubmenu(depth)` first clears out whatever
     * (if anything) previously occupied this slot or anything deeper, since a
     * deeper flyout may have been anchored to a button inside it.
     */
    _showSubmenuFor(item, button, depth) {
        this._closeSubmenu(depth);

        let level = this._submenuLevels[depth];
        if (!level) {
            const element = document.createElement('div');
            element.className = 'shortcut-menu shortcut-submenu';
            element.style.display = 'none';
            document.body.appendChild(element);
            level = { element, buttons: [] };
            this._submenuLevels[depth] = level;
        }

        level.element.innerHTML = '';
        level.buttons = [];
        const children = typeof item.children === 'function' ? item.children() : item.children;
        this._buildMenuItems(level.element, children, level.buttons, depth + 1);
        this._updateCheckedStates();

        level.element.style.display = 'block';
        this._openSubmenuIds[depth] = item.id;

        const buttonRect = button.getBoundingClientRect();
        const submenuRect = level.element.getBoundingClientRect();

        let left = buttonRect.right + 4;
        if (left + submenuRect.width > window.innerWidth - 8) {
            left = buttonRect.left - submenuRect.width - 4;
        }
        const maxTop = window.innerHeight - submenuRect.height - 8;

        level.element.style.left = `${Math.max(8, left)}px`;
        level.element.style.top = `${Math.max(8, Math.min(buttonRect.top, maxTop))}px`;
    }

    /**
     * Closes the flyout at `fromDepth` and every deeper one (they can only have
     * been opened from inside it, so they'd otherwise be left dangling/mis-anchored).
     */
    _closeSubmenu(fromDepth = 0) {
        for (let d = fromDepth; d < this._submenuLevels.length; d++) {
            const level = this._submenuLevels[d];
            if (level) {
                level.element.style.display = 'none';
                level.element.innerHTML = '';
                level.buttons = [];
            }
            this._openSubmenuIds[d] = null;
        }
    }

    /**
     * Whether a marker exists that isn't just the placeholder this menu's own
     * opening dropped (see _ensureMarkerAt/_pendingMarkerId) - i.e. whether
     * there is an actual selection to zoom to or clear.
     */
    _hasSelectionMarkers() {
        const markers = window.featureControl?._markerManager?.getMarkers() || [];
        return markers.some(m => m.id !== this._pendingMarkerId);
    }

    /**
     * The marker at this menu's own point, if any - both "Edit Label" and
     * "Remove Marker" act on it. Opening the menu on a bare point still leaves
     * a marker there (the placeholder _ensureMarkerAt drops, or the one the
     * marker's own options button was clicked on), so this is the same marker
     * either entry point would show a popup for.
     */
    _markerAtPoint() {
        if (!this._lngLat) return null;
        const markerManager = window.featureControl?._markerManager;
        return markerManager?.findMarkerNear(this._lngLat) || null;
    }

    _editMarkerLabel() {
        const markerId = this._markerAtPoint();
        if (markerId) window.featureControl?._markerManager?.startIdEdit(markerId);
    }

    _removeMarkerAtPoint() {
        const markerId = this._markerAtPoint();
        if (markerId) window.featureControl?._markerManager?.removeMarker(markerId);
    }

    /**
     * Centers the map on the point the menu was opened at - the spot itself,
     * whatever is or isn't selected there, unlike "Zoom To Selected" below it
     * (zoomToSelected), which frames the selected feature's geometry or every
     * marker on the map. Already being zoomed in past LOCATION_ZOOM is kept:
     * this is a recenter, so it should never pull the map back out.
     */
    _zoomToLocation() {
        if (!this._map || !this._lngLat) return;
        this._map.flyTo({
            center: this._lngLat,
            zoom: Math.max(this._map.getZoom(), LOCATION_ZOOM),
            duration: 1000,
            essential: true
        });
    }

    /**
     * Discards everything the user has dropped on the map: every route and
     * every marker, saved ones included - unlike "Clear All Locations"
     * (clearSelection), which only fires the marker sweep as a side effect of
     * clearing feature selections and so leaves plain markers behind when
     * nothing was selected.
     *
     * Routes go first: clearAllMarkers runs each marker's own onRemove, and a
     * route waypoint's callback (routeStore.removeWaypoint) would otherwise
     * rebuild and re-route what is about to be thrown away anyway.
     */
    _clearAllMarkersAndRoutes() {
        routeStore.clearAll();
        window.featureControl?._markerManager?.clearAllMarkers();
        window.featureControl?.clearSelection();
        this._pendingMarkerId = null;
    }

    /**
     * The "Select" flyout's items. "Zoom To Selected" and "Clear All Locations"
     * only make sense once something is actually on the map to zoom to or
     * clear - clearSelection() (see map-marker-manager.js's 'selections-cleared'
     * handler) drops every marker, not just feature selections - so both are
     * left out while there are none, rather than showing but doing nothing.
     */
    _buildSelectionMenuItems() {
        if (!this._hasSelectionMarkers()) return [];

        return [
            {
                id: 'zoom-to-selected',
                icon: 'bounding-box',
                label: 'Zoom To Selected',
                action: () => window.featureControl?.zoomToSelected(this._lngLat)
            },
            {
                id: 'clear-selection',
                icon: 'x-circle',
                label: 'Clear All Locations',
                action: () => window.featureControl?.clearSelection()
            }
        ];
    }

    /**
     * Drops a plain, feature-less marker at `lngLat` - or reuses one already
     * there - without running the selection pipeline (no query, no inspector,
     * no highlighting). Used to mark where the menu itself was opened (see
     * shortcut-menu.js's long-press) and by "Comments" below, so that spot
     * has a handle on the map before anything else is chosen.
     * Deliberately skips querying what's under the point even though a route
     * endpoint pick (below) wants that - a long-press opens this
     * marker on every context-menu open, including ones the user only meant
     * to glance at and dismiss, so querying and showing badges here would
     * make an untouched placeholder look like a real selection.
     *
     * A caller that already knows what's there (route endpoints, via
     * `selectFeaturesAtPoint`) can hand it in via `features`, which - only when
     * a *new* marker is created - seeds its badges instead of leaving it
     * empty. Passing `features` for a point that already has a marker
     * upgrades that existing marker (recreating it so its popup picks up the
     * badges, but keeping its id and saved name - see
     * MapMarkerManager.removeMarkerKeepingIdentity) only if it was still
     * feature-less; a marker that already has its own selection/content is
     * left alone.
     *
     * `pending: true` (only shortcut-menu.js's own long-press passes
     * this) additionally records a newly-created marker as `_pendingMarkerId`
     * - never one that was reused, since that one was already real - so
     * _hasSelectionMarkers can tell "the menu just opened here" apart from an
     * actual selection, and so it gets discarded on _hide() if nothing turned
     * it into one (see _hide). A non-pending call (e.g. "Comments") that
     * lands on the still-pending marker promotes it to real by clearing
     * `_pendingMarkerId` - it now has a job other than marking where the menu
     * was opened, so it must survive the menu closing.
     */
    _ensureMarkerAt(lngLat, { pending = false, features = null } = {}) {
        const markerManager = window.featureControl?._markerManager;
        if (!markerManager || !lngLat) return null;

        const existing = markerManager.findMarkerNear(lngLat);
        if (existing) {
            if (!pending && existing === this._pendingMarkerId) this._pendingMarkerId = null;

            if (features?.length > 0 && markerManager.getMarkerFeatures(existing)?.length === 0) {
                // Keeps whatever id/saved-name the marker already had (see
                // removeMarkerKeepingIdentity) - it's being upgraded with
                // features, not replaced by a different marker.
                markerManager.removeMarkerKeepingIdentity(existing);
                const recreated = markerManager.addMarker(lngLat, features);
                if (this._pendingMarkerId === existing) this._pendingMarkerId = recreated;
                return recreated;
            }
            return existing;
        }

        const created = markerManager.addMarker(lngLat, features || []);
        if (pending) this._pendingMarkerId = created;
        return created;
    }

    /**
     * Where the marker _ensureMarkerAt just dropped will show its content -
     * see MapMarkerManager.getContentOffset. ShortcutMenu (shortcut-menu.js)
     * opens the menu there instead of right at the click point, so it lands
     * exactly where that marker's own popup would.
     */
    _pinContentOffset() {
        return window.featureControl?._markerManager?.getContentOffset() || { x: 0, y: 0 };
    }

    /**
     * Point to use for "Open With" links: where the menu was opened, falling
     * back to the map center if it was triggered some other way.
     */
    _getExternalLinkPoint() {
        return this._lngLat || this._map?.getCenter() || null;
    }

    /**
     * Opens one of ButtonExternalMapLinks' generated URLs directly, reusing
     * its link definitions (see button-external-map-links.js) so the URL
     * formats stay in one place.
     */
    _openExternalLink(linkId) {
        const point = this._getExternalLinkPoint();
        if (!point || !window.externalMapLinksControl) return;

        const zoom = Math.round(this._map.getZoom());
        const links = window.externalMapLinksControl._generateNavigationLinks(point.lat, point.lng, zoom);
        const link = links.find(l => l.id === linkId);
        if (link) window.open(link.url, '_blank', 'noopener');
    }

    /**
     * "More" opens the full ButtonExternalMapLinks modal pinned to the point
     * the shortcut menu was opened at.
     */
    _openMoreExternalLinks() {
        const point = this._getExternalLinkPoint();
        if (!point) return;
        window.externalMapLinksControl?.showAtCoordinates(point.lat, point.lng);
    }

    /**
     * Builds a .geolibre.json project from every active layer, publishes it
     * to the shared textb.org pad GeoLibre reads projects from, then opens
     * the map in GeoLibre. See geolibre-api.js / textb-sync.js for how the
     * publish step actually gets the JSON there.
     */
    async _openWithGeoLibre() {
        if (!window.map) return;

        const { project, skipped } = GeoLibreAPI.buildProjectFromActiveLayers(window.map);
        if (project.layers.length === 0) {
            window.layerControl?._showToast('No active layers can be opened in GeoLibre yet', 'error');
            return;
        }

        window.layerControl?._showToast('Opening in GeoLibre...', 'info');
        try {
            await GeoLibreAPI.publishProject(project);
            window.open(GeoLibreAPI.PROJECT_VIEWER_URL, '_blank', 'noopener');
            if (skipped.length) {
                console.warn('[ShortcutMenu] Layers with no GeoLibre translation were left out:', skipped);
            }
        } catch (error) {
            console.error('[ShortcutMenu] Failed to publish GeoLibre project:', error);
            window.layerControl?._showToast('Could not open GeoLibre — publishing failed', 'error');
        }
    }

    /**
     * "Remove from Route", offered only when the point the menu was opened at
     * sits on a marker one or more routes actually claim as a stop - each
     * listed by name. Picking one drops that stop via
     * search/route-store.js's removeMarkerFromRoute, which (unlike closing
     * the marker outright) leaves the marker itself on the map.
     *
     * Returned as an array so _getAllMenuItems can spread it: with nothing to
     * detach there is no row at all.
     */
    _buildRemoveFromRouteItems() {
        const point = this._getExternalLinkPoint();
        const markerId = point ? window.featureControl?._markerManager?.findMarkerNear?.(point, 20) : null;
        const linkedRoutes = markerId ? routeStore.routes.filter(r => r.markerIds.includes(markerId)) : [];
        if (!linkedRoutes.length) return [];

        return [{
            id: 'remove-from-route-menu',
            icon: 'dash-circle',
            label: 'Remove from Route',
            children: linkedRoutes.map(r => ({
                id: `remove-from-route-${r.id}`,
                icon: 'x-circle',
                label: r.name || `Route ${r.number}`,
                action: () => routeStore.removeMarkerFromRoute(r.id, markerId)
            }))
        }];
    }

    /**
     * "Routing Options": the Mapbox routing profile
     * (https://docs.mapbox.com/api/navigation/directions/#routing-profiles)
     * every route drawn from this menu - and every "X to Y" search route - is
     * built with (see search/directions-profile.js). The same picker
     * map-nearby-features-control.js offers, reading and writing the same
     * shared setting, so changing it in either place changes both.
     */
    _buildRoutingProfileItems() {
        return DIRECTIONS_PROFILES.map(profile => ({
            id: `routing-profile-${profile.id}`,
            icon: profile.icon,
            label: profile.label,
            // A radio, not a toggle: the unselected rows say nothing rather
            // than "OFF", which would read as "walking is turned off".
            checkable: true,
            stateOn: 'ON',
            stateOff: '',
            checked: () => getDirectionsProfile() === profile.id,
            action: () => this._chooseRoutingProfile(profile)
        }));
    }

    /**
     * Changing the profile while a route is active re-fetches that route with
     * the new profile rather than only affecting the next route drawn -
     * matching map-nearby-features-control.js's own profile picker.
     */
    _chooseRoutingProfile(profile) {
        setDirectionsProfile(profile.id);

        const route = this._currentRoute();
        if (!route) {
            window.layerControl?._showToast(`Routes will use ${profile.label}`, 'info');
            return;
        }

        window.layerControl?._showToast(`Updating ${route.name} to ${profile.label}...`, 'info');
        routeStore.setRouteProfile(route.id, profile.id)
            .then(updated => {
                if (!updated) return;
                this._fitRoute(updated);
                window.layerControl?._showToast(`Route ${updated.name} now uses ${profile.label}`, 'info');
            })
            .catch(error => {
                console.error('[ShortcutMenu] Failed to update the route profile:', error);
                window.layerControl?._showToast('Could not update the route', 'error');
            });
    }

    /**
     * Whatever route the pending/default origin or this menu's own point
     * would currently extend, if any - same
     * RouteStore.findRouteEndingNear-based default as
     * map-nearby-features-control.js's Route picker, just fed this menu's
     * own notion of origin/destination instead of the two waypoint pickers.
     */
    _currentRoute() {
        const origin = routeStore.pendingOrigin || this._defaultRouteOrigin();
        const point = this._getExternalLinkPoint();
        return routeStore.findRouteEndingNear(origin) || routeStore.findRouteEndingNear(point) || null;
    }

    /**
     * "Route From" starts a new route at `point`: it records it as the pending
     * origin, flagged `startNew` so the "Route To" that consumes it never
     * continues some other route that happens to end there. No request goes
     * out yet - a route needs a destination - but it does drop (or promote
     * the menu's own placeholder into) a real marker there via
     * _ensureMarkerAt, which route-store.js then re-colours and takes over as
     * a route marker, so the origin stays visible - and draggable - on the map
     * while the user goes to pick a destination. Without this, the placeholder
     * marker ShortcutMenu's long-press dropped (see
     * _ensureMarkerAt's `pending` doc) would just get removed the moment this
     * menu closes, since nothing else turned it into something real.
     * "Route To" consumes
     * that pending origin - or, absent one, the default origin (GPS if
     * already available, else the map center; see _attachMap) - and hands
     * both ends to route-store.js's routeTo. It then leaves `point` as the new
     * pending origin, unflagged, so further "Route To" picks keep extending
     * the same route without needing another "Route From" first.
     */
    async _handleRouteEndpoint(direction, point, fallbackLabel) {
        // Additive: marks whatever's under the point selected (highlighted,
        // with a real featureId) without clearing any other selection or
        // marker already on the map - see selectFeaturesAtPoint.
        const features = window.featureControl?.selectFeaturesAtPoint?.(point) || [];
        const label = await this._resolveEndpointLabel(features, point, fallbackLabel);

        if (direction === 'from') {
            // Promotes the menu's own placeholder pin (or drops one), then
            // hands it to the store to re-colour and take over as the route's
            // origin - so it reads as a route marker, not a plain selection.
            this._ensureMarkerAt(point, { features });
            routeStore.setPendingOrigin(point, label, { withMarker: true, startNew: true });
            window.layerControl?._showToast(`New route from ${label} — now pick "Route To" a destination`, 'info');
            return;
        }

        // "Route To" reuses whatever marker is already sitting on the point
        // (the menu's own placeholder, most often) rather than leaving it
        // feature-less until route-store.js's _syncMarkers adopts it.
        this._ensureMarkerAt(point, { features });

        const origin = routeStore.pendingOrigin || this._defaultRouteOrigin();
        if (!origin) {
            window.layerControl?._showToast('No starting point available for a route', 'error');
            return;
        }

        window.layerControl?._showToast('Finding a route...', 'info');
        // An origin picked with "Route From" always starts a fresh route (see
        // setPendingOrigin's `startNew`); anything else - the default GPS/map
        // -centre origin, or the destination left pending by the last "Route
        // To" - falls back to routeTo's own "does this continue a route
        // already ending here" guess.
        routeStore.routeTo(origin, origin.label, point, label, { routeId: origin.startNew ? 'new' : undefined })
            .then(route => {
                if (!route) return;
                routeStore.setPendingOrigin(point, label);
                this._fitRoute(route);
                window.layerControl?._showToast(`Route ${route.name}: ${route.waypoints.length} stops`, 'info');
            })
            .catch(error => {
                console.error('[ShortcutMenu] Failed to build route:', error);
                window.layerControl?._showToast('Could not find a route', 'error');
            });
    }

    /**
     * Names a route endpoint after whatever is actually there: a selected
     * feature's own label (map-marker-manager.js's describeFeatures) when the
     * point sits on one, else the first two parts of its reverse-geocoded
     * address (reverseGeocodeAddress's default `detail`, e.g. "Panaji, Goa")
     * so the route/marker reads as a place instead of the generic
     * `fallbackLabel` ("this location") - kept only for when the geocode
     * itself fails (offline, rate-limited).
     */
    async _resolveEndpointLabel(features, point, fallbackLabel) {
        const featureLabel = window.featureControl?._markerManager?.describeFeatures(features);
        if (featureLabel) return featureLabel;

        try {
            const address = await reverseGeocodeAddress(point.lat, point.lng);
            if (address?.text) return address.text;
        } catch (error) {
            console.warn('[ShortcutMenu] Address lookup failed:', error.message);
        }
        return fallbackLabel;
    }

    _fitRoute(route) {
        const line = route.geojson?.features?.find(f => f.properties?.kind === 'route');
        if (!line || !this._map) return;
        this._map.fitBounds(routeBounds(line.geometry), { padding: 60, duration: 1000 });
    }

    /** GPS if already available, else the map center - see _attachMap. */
    _defaultRouteOrigin() {
        const point = this._routeOrigin?.resolveOrCenter();
        if (!point) return null;
        // An unpicked WaypointPicker names itself "Choose a point", which would
        // read as a place in the route's own name; what it actually resolved to
        // in that case is the map center.
        const label = this._routeOrigin.isSet ? this._routeOrigin.name() : 'Map center';
        return { lng: point.lng, lat: point.lat, label };
    }

    /**
     * Finds a layer's group entry in map-layer-controls' _state.groups. Layers
     * shared across atlases (defined once in index.atlas.json, e.g. 'notes')
     * keep their bare `id` there but carry a `_prefixedId` like 'index-notes' —
     * match on either, plus `_originalId`, so callers can use whichever form
     * they have on hand.
     */
    _getGroupElement(layerId) {
        const layerControl = window.layerControl;
        if (!layerControl) return null;

        const groupIndex = layerControl._state.groups.findIndex(g =>
            g.id === layerId || g._prefixedId === layerId || g._originalId === layerId
        );
        if (groupIndex === -1) return null;

        return layerControl._sourceControls[groupIndex] || null;
    }

    /**
     * Basemap-tagged layers currently loaded for the active atlas (i.e. present
     * in map-layer-controls' _state.groups), used to build the "Toggle Basemaps"
     * flyout under Maps.
     */
    _getBasemapLayers() {
        const groups = window.layerControl?._state?.groups || [];
        return groups.filter(g => LayerOrderManager.isBasemap(g));
    }

    _buildBasemapToggleItems() {
        return this._getBasemapLayers().map(layer => ({
            id: `basemap-${layer.id}`,
            icon: 'map',
            label: layer.title || layer.name || layer.id,
            checkable: true,
            checked: () => this._isLayerVisible(layer.id),
            action: () => this._toggleLayerVisibility(layer.id)
        }));
    }

    _isLayerVisible(layerId) {
        const checkbox = this._getGroupElement(layerId)?.querySelector('.toggle-switch input[type="checkbox"]');
        return !!checkbox?.checked;
    }

    /**
     * Routed through MapBrowserControl._handleLayerToggle — the same handler
     * map-browser.html's own layer toggles call via postMessage — rather than
     * driving the <sl-details> show()/hide() directly. That handler is what
     * actually adds/removes the Mapbox layer, fires the URL sync, and (via its
     * layer-registry fallback) adds the group to _state.groups on the fly if
     * it isn't there yet — e.g. 'index-notes' on any atlas other than index,
     * which isn't merged in by default.
     */
    _toggleLayerVisibility(layerId) {
        window.browserControl?._handleLayerToggle(layerId, !this._isLayerVisible(layerId));
    }

    /**
     * Toggles the shared 'notes' layer (registered as 'index-notes' — it's
     * defined once in index.atlas.json and not merged into other atlases by
     * default, so on a non-index atlas it usually isn't in _state.groups yet;
     * _handleLayerToggle's registry fallback adds it on demand). When turning
     * it on, also focuses the comment box that leads every marker's balloon
     * (map-marker-manager.js) for the location the shortcut menu was opened
     * at — reusing a marker already there (e.g. one pressed directly)
     * rather than creating a duplicate.
     */
    _toggleComments() {
        const wasVisible = this._isLayerVisible('index-notes');
        this._toggleLayerVisibility('index-notes');

        if (wasVisible || !this._lngLat) return;
        const markerId = this._ensureMarkerAt(this._lngLat);
        if (markerId) window.featureControl?._markerManager?.focusCommentInput(markerId);
    }

    _updateCheckedStates() {
        const allButtons = [
            ...this._menuButtons,
            ...this._submenuLevels.flatMap(level => level ? level.buttons : [])
        ];
        allButtons.forEach(({ button, item }) => {
            if (!item.checkable) return;
            const isChecked = !!item.checked?.();
            button.classList.toggle('is-checked', isChecked);
            if (item.iconChecked) {
                button.querySelector('sl-icon:not(.shortcut-menu-chevron)').setAttribute('name', isChecked ? item.iconChecked : item.icon);
            }
            const stateLabel = button.querySelector('.shortcut-menu-state');
            // `stateOn`/`stateOff` let a group of mutually exclusive items
            // (the routing profiles) read as a radio: the chosen one is
            // marked, the rest say nothing rather than "OFF".
            if (stateLabel) stateLabel.textContent = isChecked ? (item.stateOn ?? 'ON') : (item.stateOff ?? 'OFF');
        });
    }

    /**
     * Shows the top-level menu anchored so it fits in the viewport, with its
     * top-left corner as close to (clientX, clientY) as it can get without
     * overflowing. A subclass anchored to a button (rather than a cursor
     * point) just passes that button's own bottom-left corner.
     */
    _show(clientX, clientY) {
        this._renderMenuItems();
        this._updateCheckedStates();

        this._menu.style.display = 'block';
        // Measure after making it visible so offsetWidth/Height are accurate.
        const menuRect = this._menu.getBoundingClientRect();
        const maxX = window.innerWidth - menuRect.width - 8;
        const maxY = window.innerHeight - menuRect.height - 8;

        this._menu.style.left = `${Math.max(8, Math.min(clientX, maxX))}px`;
        this._menu.style.top = `${Math.max(8, Math.min(clientY, maxY))}px`;
    }

    /**
     * Closing the menu - by an action, an outside click, Escape, or the map
     * moving (see shortcut-menu.js) - also drops the placeholder marker it
     * opened with if nothing turned it into something real (see
     * _ensureMarkerAt/_pendingMarkerId): it was only ever a stand-in for
     * wherever the menu was opened, not a selection, so nothing should be
     * left behind once the chance to act on it is gone.
     */
    _hide() {
        if (this._pendingMarkerId) {
            window.featureControl?._markerManager?.removeMarker(this._pendingMarkerId);
            this._pendingMarkerId = null;
        }
        if (this._menu) this._menu.style.display = 'none';
        this._closeSubmenu(0);
    }

    _isOpen() {
        return !!this._menu && this._menu.style.display !== 'none';
    }

    _handleOutsideEvent(e) {
        if (!this._isOpen()) return;
        if (this._menu.contains(e.target)) return;
        if (this._submenuLevels.some(level => level?.element.contains(e.target))) return;
        if (this._excludeFromOutsideClose.some(el => el?.contains(e.target))) return;
        this._hide();
    }

    _handleKeydown(e) {
        if (e.key === 'Escape') this._hide();
    }
}

/**
 * NearbyFeaturesControl - Accessible alternative to tapping/clicking the map
 * canvas, for building a route. So touch screen-reader users (VoiceOver/
 * TalkBack — no keyboard, and canvas hit-testing via drag gestures isn't
 * reliable for them) and keyboard-only users can pick waypoints without
 * needing to hit-test the Mapbox GL canvas at all.
 *
 * The menu reads as a route being built, from a **Route From** and a
 * **Route To** section - visually separated blocks, each its own colored
 * heading, each holding an AutocompleteBadgeInput (see
 * autocomplete-badge-input.js): the endpoint's value shown as a badge,
 * clicking it turns it into a text field with a categorized, type-to-filter
 * suggestion list (see waypoint-picker.js for the value itself). Both fields
 * offer the identical set of categories, only their default order differs
 * (From leads with "My Location"; To leads with "From Map View", since
 * browsing what's around you is the common way to pick a destination):
 *
 * - **My Location** - the device's live GPS position (reuses the app's
 *   shared window.geolocationControl rather than a separate watchPosition).
 * - **Selected Locations** - every marker already on the map, nearest first.
 * - **From Map View** - labeled points from the base map style currently
 *   rendered in view (every symbol layer with a text-field - place names,
 *   POIs, roads...; see _fromMapViewItems), grouped by the vector tile
 *   source-layer each came from.
 * - **Actions > Click on Map** - arms "the next marker placed becomes this
 *   waypoint": the menu closes, and whatever the user clicks on the map next
 *   (handled by the normal click pipeline, see map-marker-manager.js) is
 *   bound to whichever endpoint was armed.
 *
 * Typed text that doesn't match a suggestion is parsed on blur instead:
 * coordinates (see search/coordinate-parser.js) resolve directly, anything
 * else is forward-geocoded via Nominatim (see nominatim-search.js).
 *
 * Distances and bearings throughout are always measured from Route From,
 * whatever it currently resolves to - so a VI user can walk toward a target
 * and watch the distance shrink. Picking a Route From value never draws
 * anything by itself; picking a Route To value does the whole job in one
 * tap - a marker (if the choice doesn't already have one) plus a route drawn
 * from the current Route From (search/route-store.js's routeTo). Route To
 * then follows that new waypoint's own marker, so picking another
 * destination extends the same route rather than starting over.
 *
 * The section ends with **Navigation options**: the **Route** picker - "New
 * Route" or any route already on the map, defaulting to whichever existing
 * route Route From or Route To currently lands on the end of (see
 * RouteStore.findRouteEndingNear) - and the Mapbox routing profile
 * (driving/walking/cycling, see search/directions-profile.js) every route
 * drawn here, or from an "X to Y" search, uses. Picking an existing route
 * both targets it for the next destination (extending it rather than
 * starting over) and opens its turn-by-turn detail - legs, then each leg's
 * steps, read straight off the Directions API response kept on
 * `route.result` (https://docs.mapbox.com/api/navigation/directions/#retrieve-directions)
 * - so creating, extending, and browsing routes are all the same picker.
 *
 * Hovering or focusing any suggestion previews it on the map: a dashed line
 * drawn from Route From labelled with the distance and bearing, and the
 * camera framed on the two ends (see nearby-preview-layer.js). Leaving the
 * row puts both back, including the camera the menu was opened with - unless
 * the row was acted on, in which case the view it moved to is what the user
 * asked for and is kept. A pan or zoom of the user's own while the menu is
 * open re-bases that saved view, so closing the menu never undoes their
 * gesture.
 *
 * Lives in the header-nav (next to the shortcuts menu — see
 * header-shortcut-menu-control.js / shortcut-menu-base.js), sharing its
 * `.header-shortcut-menu` / `.header-shortcut-menu-btn` container styling and
 * rendering rows with the same `.shortcut-menu` classes as other header-nav
 * menus (see map-location-menu-control.js). Not a mapboxgl control.
 */
import { haversineDistanceMeters, initialBearingDeg, formatDistance, bearingToCompassAbbr, bearingToCompassWord } from './geo-distance-utils.js';
import { WaypointPicker, WAYPOINT_MY_LOCATION } from './waypoint-picker.js';
import { routeStore } from './search/route-store.js';
import { ShortcutFlyout } from './shortcut-flyout.js';
import { NearbyPreviewLayer } from './nearby-preview-layer.js';
import { routeBounds } from './search/route-geojson.js';
import { DIRECTIONS_PROFILES, getDirectionsProfile, setDirectionsProfile, getDirectionsProfileInfo } from './search/directions-profile.js';
import { AutocompleteBadgeInput } from './autocomplete-badge-input.js';
import { parseCoordinateInput } from './search/coordinate-parser.js';
import { queryNominatim, isNominatimBackedOff, reportNominatimFailure } from './nominatim-search.js';

const PAGE_SIZE = 5;

// How long a preview survives the pointer leaving a row. Long enough to travel
// between two rows without the camera snapping back and out again in between.
const PREVIEW_END_DELAY_MS = 150;

export class NearbyFeaturesControl {
    constructor(stateManager) {
        this._stateManager = stateManager;
        this._map = null;
        this._container = null;
        this._button = null;
        this._menu = null;
        this._isOpenState = false;
        this._allMarkers = [];
        this._fromRow = null;
        this._toRow = null;
        this._routeRow = null;
        this._profileRow = null;
        this._routeSelection = { explicit: false, routeId: null };
        this._fromRef = null;
        this._toRef = null;
        this._armedSlot = null;
        this._armedPicker = null;
        this._armedListener = null;
        this._previewLayer = null;
        this._previewTimer = null;
        this._isPreviewing = false;
        this._cameraDirty = false;
        this._flyout = new ShortcutFlyout();
        this._onKeydown = this._onKeydown.bind(this);
        this._onGeolocate = this._onGeolocate.bind(this);
        this._onMapMove = this._onMapMove.bind(this);
        this._handleOutsideEvent = this._handleOutsideEvent.bind(this);
        this._hide = this._hide.bind(this);
    }

    mount(hostEl, map) {
        if (!hostEl || !map) return;
        this._map = map;
        this._fromRef = new WaypointPicker(map, { preferMyLocation: true });
        this._toRef = new WaypointPicker(map);
        this._previewLayer = new NearbyPreviewLayer(map);

        this._container = document.createElement('div');
        this._container.className = 'header-shortcut-menu';

        this._button = document.createElement('button');
        this._button.type = 'button';
        this._button.className = 'header-shortcut-menu-btn';
        this._button.setAttribute('aria-label', 'Navigate to features in view');
        this._button.title = 'Navigate to features in view (for screen readers or without a mouse)';
        this._button.innerHTML = '<sl-icon name="sign-turn-right"></sl-icon>';
        this._button.addEventListener('click', () => this.toggle());

        this._container.appendChild(this._button);
        hostEl.appendChild(this._container);

        this._menu = document.createElement('div');
        this._menu.className = 'shortcut-menu';
        this._menu.style.display = 'none';
        this._menu.setAttribute('role', 'dialog');
        this._menu.setAttribute('aria-modal', 'true');
        this._menu.setAttribute('aria-label', 'Navigate to features in view');
        document.body.appendChild(this._menu);

        this._flyout.mount();

        document.addEventListener('mousedown', this._handleOutsideEvent, true);
        document.addEventListener('touchstart', this._handleOutsideEvent, true);
        document.addEventListener('keydown', this._onKeydown, true);
        window.addEventListener('resize', this._hide);
    }

    unmount() {
        document.removeEventListener('mousedown', this._handleOutsideEvent, true);
        document.removeEventListener('touchstart', this._handleOutsideEvent, true);
        document.removeEventListener('keydown', this._onKeydown, true);
        window.removeEventListener('resize', this._hide);
        this._stopLocationTracking();
        this._disarmMapPick();
        this._map?.off('move', this._onMapMove);

        clearTimeout(this._previewTimer);
        this._previewLayer?.remove();
        this._previewLayer = null;

        this._flyout.unmount();
        this._menu?.parentNode?.removeChild(this._menu);
        this._container?.parentNode?.removeChild(this._container);
        this._menu = null;
        this._container = null;
        this._button = null;
        this._map = null;
    }

    _isOpen() {
        return this._isOpenState;
    }

    toggle() {
        if (this._isOpenState) {
            this._hide();
        } else {
            this._open();
        }
    }

    _open() {
        if (!this._map || !this._button || !this._menu) return;
        this._isOpenState = true;
        this._button.classList.add('active');
        this._button.querySelector('sl-icon')?.setAttribute('name', 'sign-turn-right-fill');

        // The view to come back to when a preview ends or the menu closes.
        this._previewLayer.captureCamera();
        routeStore.sync();
        this._startLocationTracking();
        this._map.on('move', this._onMapMove);
        this._populateList();

        this._menu.style.display = 'block';
        const rect = this._button.getBoundingClientRect();
        const menuRect = this._menu.getBoundingClientRect();
        const maxLeft = window.innerWidth - menuRect.width - 8;
        this._menu.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
        this._menu.style.top = `${rect.bottom + 4}px`;

        // Route From already has a sensible default (GPS, or the map center);
        // Route To is almost always what the user opened this menu to change,
        // so it gets the initial focus instead of the first button in the
        // menu.
        (this._toRow?.focusableElement() || this._menu.querySelector('button.shortcut-menu-item'))?.focus();
    }

    _hide() {
        this._isOpenState = false;
        this._flyout.close();
        this._clearPreview();
        this._restoreCamera();
        if (this._menu) this._menu.style.display = 'none';
        this._button?.classList.remove('active');
        this._button?.querySelector('sl-icon')?.setAttribute('name', 'sign-turn-right');
        this._map?.off('move', this._onMapMove);
        this._stopLocationTracking();
    }

    // Reuses the app's shared GPS control (window.geolocationControl) instead of
    // a separate navigator.geolocation.watchPosition, so opening this list
    // doesn't trigger a second permission prompt or duplicate GPS polling.
    // Tracking is only auto-started if it wasn't already on; it's left running
    // on close, same as if the user had pressed the GPS button themselves.
    _startLocationTracking() {
        const geo = window.geolocationControl;
        if (!geo) return;

        // Tracking may already have been running long before this menu opened,
        // in which case waiting for the next 'geolocate' would leave Route From
        // reading "Choose a starting point" for no reason: adopt the watch's
        // last fix (feeding both endpoints, so a "My Location" choice on either
        // stays live), and failing that its tracking state, so an active GPS is
        // Route From's default from the moment the menu opens.
        if (geo.lastPosition) {
            this._fromRef.setUserPosition(geo.lastPosition);
            this._toRef.setUserPosition(geo.lastPosition);
        } else if (geo.isTracking) {
            this._fromRef.preferGeolocation();
        }

        geo.on('geolocate', this._onGeolocate);
        if (!geo.isTracking) geo.trigger();
    }

    _stopLocationTracking() {
        window.geolocationControl?.off('geolocate', this._onGeolocate);
    }

    _onGeolocate(e) {
        const pos = { lat: e.coords.latitude, lng: e.coords.longitude };
        const promotedToGps = this._fromRef.setUserPosition(pos);
        this._toRef.setUserPosition(pos);

        // The first fix promotes an implicit default to GPS, which changes
        // what "nearest" means - worth one re-sort. After that row order
        // stays stable so live updates don't reshuffle the list under a
        // screen-reader/keyboard user mid-navigation.
        if (promotedToGps) {
            this._resortAndRender();
        } else if (this._fromRef.type === WAYPOINT_MY_LOCATION) {
            this._refreshDistances();
        }
    }

    _onMapMove(e) {
        // A gesture on the map re-bases the view previews return to - closing
        // the menu shouldn't undo a pan the user made while it was open. Only
        // user input carries an originalEvent; a preview's own fitBounds and
        // the restore easeTo don't.
        if (e?.originalEvent) {
            this._previewLayer?.captureCamera();
            this._cameraDirty = false;
        }

        // A preview moves the camera itself; with an unset origin (which
        // resolves to the map center), reacting to that would move the very
        // point the preview line is drawn from.
        if (this._isPreviewing) return;
        if (!this._fromRef.isSet) this._refreshDistances();
    }

    /**
     * Previews a destination while its row is hovered or focused: a dashed
     * line from Route From labelled with distance and bearing, and the
     * camera framed on the pair (see nearby-preview-layer.js). Ending the
     * preview puts both back.
     */
    _startPreview(lngLat) {
        clearTimeout(this._previewTimer);
        const from = this._fromRef.resolveOrCenter();
        if (!from || !this._previewLayer) return;

        this._isPreviewing = true;
        this._cameraDirty = true;
        this._previewLayer.show(from, lngLat, this._formatOffset(lngLat));
    }

    _endPreview() {
        clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(() => {
            this._clearPreview();
            this._restoreCamera();
        }, PREVIEW_END_DELAY_MS);
    }

    /** Drops the preview line, leaving the camera alone. */
    _clearPreview() {
        clearTimeout(this._previewTimer);
        if (!this._isPreviewing) return;
        this._isPreviewing = false;
        this._previewLayer?.clear();
        this._stateManager.handleMapMouseLeave(true);
    }

    /**
     * Keeps whatever view the user has been moved to, for rows that commit —
     * selecting a feature, flying to a marker, drawing a route. Without this
     * the close that follows would pull the map straight back to where the
     * menu was opened.
     */
    _commitCamera() {
        this._clearPreview();
        this._cameraDirty = false;
        this._previewLayer?.release();
    }

    /** Only ever undoes a camera a preview moved, never one the user set. */
    _restoreCamera() {
        if (!this._cameraDirty) return;
        this._cameraDirty = false;
        this._previewLayer?.restoreCamera();
    }

    _bindPreview(element, onEnter) {
        element.addEventListener('mouseenter', onEnter);
        element.addEventListener('focus', onEnter);
        element.addEventListener('mouseleave', () => this._endPreview());
        element.addEventListener('blur', () => this._endPreview());
    }

    _sortByDistance() {
        const origin = this._fromRef.resolveOrCenter();
        if (!origin) return;

        this._allMarkers.forEach(m => {
            m._distanceMeters = haversineDistanceMeters(origin, m.lngLat);
        });
        this._allMarkers.sort((a, b) => a._distanceMeters - b._distanceMeters);
    }

    _resortAndRender() {
        const hadFocusInMenu = this._menu.contains(document.activeElement);
        this._flyout.close();
        this._sortByDistance();
        this._renderVisible();
        if (hadFocusInMenu) this._menu.querySelector('button.shortcut-menu-item')?.focus();
    }

    _refreshDistances() {
        this._updateWaypointRow(this._fromRow, this._fromRef, 'from');
        this._updateWaypointRow(this._toRow, this._toRef, 'to');
        this._updateRouteRow();
    }

    _populateList() {
        this._allMarkers = window.featureControl?._markerManager?.getMarkers() || [];
        this._sortByDistance();

        const count = this._allMarkers.length;
        window.keyboardController?.announceToScreenReader(
            `Navigating from ${this._fromRef.name()} by ${getDirectionsProfileInfo().label}. ${count} marker${count === 1 ? '' : 's'} on the map.`
        );

        this._renderVisible();
    }

    _renderVisible() {
        this._menu.innerHTML = '';

        this._menu.appendChild(this._createHeading('record-circle', 'Route From', 'shortcut-menu-section-heading-from'));
        this._fromRow = this._createWaypointRow(this._fromRef, 'from');
        this._menu.appendChild(this._fromRow.element);

        this._menu.appendChild(this._createDivider({ section: true }));

        this._menu.appendChild(this._createHeading('flag', 'Route To', 'shortcut-menu-section-heading-to'));
        this._toRow = this._createWaypointRow(this._toRef, 'to');
        this._menu.appendChild(this._toRow.element);

        this._menu.appendChild(this._createDivider({ section: true }));
        this._menu.appendChild(this._createHeading('sliders', 'Navigation options'));
        if (routeStore.routes.length > 0) {
            this._menu.appendChild(this._createRouteRow());
        } else {
            this._routeRow = null;
        }
        this._menu.appendChild(this._createProfileRow());
    }

    /** A section label, optionally carrying a color-accent modifier class. */
    _createHeading(iconName, text, modifierClass = '') {
        const heading = document.createElement('div');
        heading.className = 'shortcut-menu-item shortcut-menu-item-static';
        if (modifierClass) heading.classList.add(modifierClass);
        const icon = document.createElement('sl-icon');
        icon.setAttribute('name', iconName);
        const label = document.createElement('span');
        label.textContent = text;
        heading.appendChild(icon);
        heading.appendChild(label);
        return heading;
    }

    _createDivider({ section = false } = {}) {
        const divider = document.createElement('div');
        divider.className = 'shortcut-menu-divider';
        if (section) divider.classList.add('shortcut-menu-divider-section');
        return divider;
    }

    /**
     * The "Route From" / "Route To" field: an AutocompleteBadgeInput (see
     * autocomplete-badge-input.js) showing the endpoint's current value as a
     * badge, or - once clicked - a text field with a categorized suggestion
     * list built fresh from getItems() on every open/keystroke.
     */
    _createWaypointRow(picker, slot) {
        const input = new AutocompleteBadgeInput({
            placeholder: slot === 'from' ? 'Choose a starting point' : 'Choose a destination',
            getItems: () => this._buildWaypointItems(picker, slot),
            parseText: (text) => this._parseWaypointText(text),
            onSelect: (item) => this._onWaypointSelected(picker, slot, item)
        });
        input.mount();
        this._updateWaypointRow(input, picker, slot);
        return input;
    }

    _updateWaypointRow(input, picker, slot) {
        if (!input) return;
        const { label, icon, isPending, isUnset } = picker.current();
        const point = picker.resolve();

        input.render({
            icon,
            label,
            subtext: picker.isArmed
                ? 'Waiting for a map click…'
                : isPending
                    ? 'Waiting for GPS · using map center'
                    : isUnset
                        ? ''
                        : (point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'Unavailable'),
            isUnset,
            isPending
        });
    }

    /**
     * A list item's `value` chose "Click on Map" (arm map-pick mode) or an
     * ordinary waypoint choice (my-location / marker / a parsed point) - the
     * same shape _applyWaypointChoice/_chooseWaypoint always took, just
     * arriving from the autocomplete field instead of a flyout row.
     */
    _onWaypointSelected(picker, slot, item) {
        if (item.value.type === 'map-pick') {
            this._armMapPick(picker, slot);
            return;
        }
        this._chooseWaypoint(picker, slot, item.value);
    }

    /**
     * The suggestions offered by both endpoints, flattened into one
     * category-grouped list (autocomplete.js groups by walking this array in
     * order - see AutocompleteBadgeInput._renderGroups). Same categories
     * either way, only their order (and My Location's presence as a default)
     * differs: From leads with "My Location" since that's the common origin;
     * To leads with "Nearby Features" since browsing what's around you is the
     * common way to pick a destination.
     */
    _buildWaypointItems(picker, slot) {
        const sections = slot === 'from'
            ? [this._myLocationItems(picker), this._markerItems(picker), this._fromMapViewItems(), this._mapPickItems()]
            : [this._fromMapViewItems(), this._markerItems(picker), this._myLocationItems(picker), this._mapPickItems()];
        return sections.flat();
    }

    _myLocationItems(picker) {
        if (!window.geolocationControl) return [];
        return [{
            category: 'My Location',
            icon: 'crosshair',
            label: 'My Location',
            subtext: picker.userPosition ? 'Device GPS' : 'Device GPS · waiting for a fix',
            checked: picker.isChosenMyLocation(),
            value: { type: 'my-location' }
        }];
    }

    _markerItems(picker) {
        return this._allMarkers.map(m => ({
            category: 'Selected Locations',
            icon: 'geo-alt-fill',
            label: m.label,
            subtext: this._formatOffset(m.lngLat) || 'Marker',
            checked: picker.isChosenMarker(m.id),
            onHover: (enter) => enter ? this._startPreview(m.lngLat) : this._endPreview(),
            value: { type: 'marker', markerId: m.id, label: m.label }
        }));
    }

    /**
     * "From Map View": labeled points from the base map style's already-
     * loaded tiles - every symbol layer with a text-field (place names, POIs,
     * roads...) - queried live from the map itself via querySourceFeatures
     * (not queryRenderedFeatures: that only returns a label whose glyph is
     * presently painted, after Mapbox's own collision culling hides most
     * candidates, which left this severely under-populated) rather than the
     * app's own configured layers, grouped by the vector tile source-layer
     * each came from (e.g. "Place Label", "Poi Label").
     */
    _fromMapViewItems() {
        if (!this._map) return [];

        // (source, source-layer) pairs to query, not layer ids: several style
        // layers can label the same vector tile layer (e.g. by subtype, or a
        // casing/halo pass), so querying per style layer would both re-query
        // and re-filter the same underlying data repeatedly. Each pair's own
        // layer filter(s) are intentionally not reapplied - querySourceFeatures
        // returns every loaded feature regardless of whether any layer's
        // filter or zoom range would currently draw it, which is what actually
        // fixes the "quite limited" result set: queryRenderedFeatures only
        // returns features whose glyph is presently painted, after Mapbox's
        // own label-collision culling has hidden most candidates.
        let sourceLayerPairs;
        try {
            sourceLayerPairs = new Map();
            (this._map.getStyle()?.layers || [])
                .filter(l => l.type === 'symbol' && l.layout?.['text-field'] && l.source)
                .forEach(l => {
                    const key = `${l.source} ${l['source-layer'] || ''}`;
                    if (!sourceLayerPairs.has(key)) sourceLayerPairs.set(key, { source: l.source, sourceLayer: l['source-layer'] });
                });
        } catch (error) {
            console.error('[nearby-features] reading style layers failed:', error);
            return [];
        }
        if (sourceLayerPairs.size === 0) return [];

        const origin = this._fromRef.resolveOrCenter();
        const seen = new Set();
        const groups = new Map();

        sourceLayerPairs.forEach(({ source, sourceLayer }) => {
            let features;
            try {
                features = this._map.querySourceFeatures(source, sourceLayer ? { sourceLayer } : undefined);
            } catch (error) {
                console.error(`[nearby-features] querySourceFeatures failed for ${source}/${sourceLayer}:`, error);
                return;
            }

            features.forEach(f => {
                const label = this._labelForMapFeature(f);
                const lngLat = this._pointLngLat(f);
                if (!label || !lngLat) return;

                const key = `${label}|${lngLat.lng.toFixed(5)}|${lngLat.lat.toFixed(5)}`;
                if (seen.has(key)) return;
                seen.add(key);

                const groupKey = f.sourceLayer || sourceLayer || source;
                if (!groups.has(groupKey)) groups.set(groupKey, []);
                groups.get(groupKey).push({ label, lngLat, distance: origin ? haversineDistanceMeters(origin, lngLat) : 0 });
            });
        });

        const items = [];
        groups.forEach((entries, groupKey) => {
            entries.sort((a, b) => a.distance - b.distance);
            entries.slice(0, PAGE_SIZE).forEach(e => {
                items.push({
                    category: this._humanizeSourceLayer(groupKey),
                    icon: 'geo-alt',
                    label: e.label,
                    subtext: this._formatOffset(e.lngLat),
                    onHover: (enter) => enter ? this._startPreview(e.lngLat) : this._endPreview(),
                    value: { type: 'point', lngLat: e.lngLat, label: e.label }
                });
            });
        });

        return items;
    }

    /** The label text a vector tile layer carries, first recognized field wins. */
    _labelForMapFeature(f) {
        const props = f.properties || {};
        const label = props.name_en || props.name || props.name_local || props.ref || props.title || props.label || props.Class || props.class;
        return label ? String(label) : null;
    }

    /**
     * A representative point for the waypoint: the feature's own coordinate
     * for a point label (POIs, places), else the midpoint of its line/ring -
     * most labeled layers in a typical style (roads, water bodies, hazard
     * zones...) are Line/Polygon geometry, not Point, so restricting to Point
     * alone would leave most labels unusable as waypoints.
     */
    _pointLngLat(f) {
        const geom = f.geometry;
        if (!geom) return null;
        if (geom.type === 'Point') {
            const [lng, lat] = geom.coordinates;
            return { lng, lat };
        }
        if (geom.type === 'LineString') {
            return this._midpoint(geom.coordinates);
        }
        if (geom.type === 'Polygon' || geom.type === 'MultiLineString') {
            return this._midpoint(geom.coordinates[0]);
        }
        if (geom.type === 'MultiPolygon') {
            return this._midpoint(geom.coordinates[0]?.[0]);
        }
        return null;
    }

    _midpoint(coords) {
        if (!Array.isArray(coords) || coords.length === 0) return null;
        const [lng, lat] = coords[Math.floor(coords.length / 2)];
        return { lng, lat };
    }

    _humanizeSourceLayer(name) {
        return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    _mapPickItems() {
        return [{
            category: 'Actions',
            icon: 'cursor',
            label: 'Click on Map',
            subtext: 'Tap a point on the map',
            value: { type: 'map-pick' }
        }];
    }

    /**
     * Free text that didn't match a suggestion, resolved on blur/Enter:
     * coordinates first (see search/coordinate-parser.js), else a Nominatim
     * forward-geocode of whatever was typed. Returns an item shaped like a
     * list item (AutocompleteBadgeInput commits it the same way), or null to
     * revert to the previous value.
     */
    async _parseWaypointText(text) {
        const coord = parseCoordinateInput(text);
        if (coord) {
            const label = `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`;
            return { icon: 'geo-alt', label, value: { type: 'point', lngLat: { lat: coord.lat, lng: coord.lng }, label } };
        }

        if (isNominatimBackedOff()) return null;
        try {
            const results = await queryNominatim(text, { limit: 1 });
            const feature = results[0];
            if (!feature) return null;
            const [lng, lat] = feature.geometry.coordinates;
            const label = feature.properties.place_name || feature.properties.name;
            return { icon: 'geo-alt', label, value: { type: 'point', lngLat: { lat, lng }, label } };
        } catch (error) {
            reportNominatimFailure();
            console.error('[nearby-features] geocode failed:', error);
            return null;
        }
    }

    /**
     * A row whose chevron opens a list: a value with its icon, a subtext line,
     * and the choices below or beside it. `field` gives it the boxed look of
     * an editable setting - right for the Route From/To and routing-profile
     * pickers.
     */
    _createDropdownRow(buildItems, { chevron: chevronName = 'chevron-down', placement = 'below', field = true } = {}) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shortcut-menu-item';
        if (field) button.classList.add('shortcut-menu-item-origin');

        const icon = document.createElement('sl-icon');
        button.appendChild(icon);

        const text = document.createElement('div');
        text.className = 'shortcut-menu-item-text';
        const label = document.createElement('span');
        label.className = 'shortcut-menu-item-label';
        const subtext = document.createElement('span');
        subtext.className = 'shortcut-menu-item-subtext';
        text.appendChild(label);
        text.appendChild(subtext);
        button.appendChild(text);

        const chevron = document.createElement('sl-icon');
        chevron.className = 'shortcut-menu-chevron';
        chevron.setAttribute('name', chevronName);
        button.appendChild(chevron);

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._flyout.toggle(button, buildItems(), { placement });
        });

        return { button, icon, label, subtext };
    }

    /**
     * Applies a category choice to whichever endpoint (`slot`) picked it,
     * then either just resorts (Route From - nothing else moves on its own)
     * or does the whole "select and route" job in one tap (Route To, same
     * as a destination click always has here).
     */
    _chooseWaypoint(picker, slot, choice) {
        const label = this._applyWaypointChoice(picker, choice);

        if (slot === 'from') {
            if (choice.type === 'my-location') this._startLocationTracking();
            this._flyout.close();
            if (this._isOpenState) {
                this._sortByDistance();
                this._renderVisible();
                this._menu.querySelector('button.shortcut-menu-item')?.focus();
            } else {
                this._open();
            }
            window.keyboardController?.announceToScreenReader(`Navigating from ${label}`);
            return;
        }

        this._flyout.close();
        this._commitCamera();
        this._hide();
        this._actOnToChoice(choice);
        const point = picker.resolve();
        if (point) this._routeTo(point, label, `Selected ${label}`);
    }

    _applyWaypointChoice(picker, choice) {
        if (choice.type === 'my-location') {
            picker.chooseMyLocation();
            return 'My location';
        }
        if (choice.type === 'marker') {
            picker.chooseMarker(choice.markerId, choice.label);
            return choice.label;
        }
        if (choice.type === 'point') {
            picker.choosePoint(choice.lngLat, choice.label);
            return choice.label;
        }
        return '';
    }

    /**
     * The side effect a Route To pick carries beyond setting the picker's
     * value: an existing marker gets focused, matching what selecting one
     * used to do directly, before this became a shared suggestion list.
     */
    _actOnToChoice(choice) {
        if (choice.type === 'marker') {
            window.featureControl?._markerManager?.focusMarker(choice.markerId);
        }
    }

    /**
     * "Choose from Map": closes the menu and arms `picker` so the next marker
     * placed anywhere - through the normal click pipeline, not a special pick
     * mode - is bound to this endpoint (see MapMarkerManager.onMarkerAdded).
     */
    _armMapPick(picker, slot) {
        this._flyout.close();
        this._disarmMapPick();
        picker.arm();
        this._armedSlot = slot;
        this._armedPicker = picker;
        window.keyboardController?.announceToScreenReader(
            `Click the map to set the route ${slot === 'from' ? 'origin' : 'destination'}.`
        );
        this._hide();
        this._armedListener = (markerId, lngLat) => this._onArmedMarkerAdded(markerId, lngLat);
        window.featureControl?._markerManager?.onMarkerAdded(this._armedListener);
    }

    _disarmMapPick() {
        this._fromRef?.disarm();
        this._toRef?.disarm();
        if (this._armedListener) window.featureControl?._markerManager?.offMarkerAdded(this._armedListener);
        this._armedListener = null;
        this._armedSlot = null;
        this._armedPicker = null;
    }

    _onArmedMarkerAdded(markerId) {
        const slot = this._armedSlot;
        const picker = this._armedPicker;
        this._disarmMapPick();
        if (!picker) return;

        const marker = window.featureControl?._markerManager?.getMarkers().find(m => m.id === markerId);
        const label = marker ? String(marker.label) : 'Map point';
        this._chooseWaypoint(picker, slot, { type: 'marker', markerId, label });
    }

    /**
     * "Route": which of the routes already on the map a new destination
     * extends, or "New Route" to always start fresh. Defaults to whichever
     * existing route Route From or Route To currently lands on the end of
     * (see RouteStore.findRouteEndingNear) until the user explicitly picks
     * something, at which point that choice sticks - same explicit-overrides-
     * default pattern as WaypointPicker.
     */
    _createRouteRow() {
        this._routeRow = this._createDropdownRow(() => this._buildRouteItems(), { chevron: 'chevron-right', placement: 'side' });
        this._updateRouteRow();
        return this._routeRow.button;
    }

    _updateRouteRow() {
        if (!this._routeRow) return;
        const { button, icon, label, subtext } = this._routeRow;
        const route = this._currentRoute();

        icon.setAttribute('name', route ? 'signpost-split' : 'plus-circle');
        label.textContent = route ? route.name : 'New Route';
        subtext.textContent = route && route.result
            ? `Extending · ${formatDistance(route.result.distance)}`
            : 'Starts a fresh route';
        button.setAttribute('aria-label', `Route: ${route ? route.name : 'New Route'}. Choose a different route`);
    }

    /** The route id a destination would extend right now, or null for new. */
    _currentRouteSelection() {
        if (this._routeSelection.explicit) return this._routeSelection.routeId;
        const match = routeStore.findRouteEndingNear(this._fromRef.resolve())
            || routeStore.findRouteEndingNear(this._toRef.resolve());
        return match ? match.id : null;
    }

    _currentRoute() {
        const routeId = this._currentRouteSelection();
        return routeId ? routeStore.routes.find(r => r.id === routeId) || null : null;
    }

    _buildRouteItems() {
        const currentId = this._currentRouteSelection();
        const items = [{
            icon: 'plus-circle',
            label: 'New Route',
            subtext: 'Start a fresh route',
            checked: !currentId,
            action: () => this._chooseRoute(null)
        }];

        routeStore.routes.forEach(route => {
            const stopCount = route.waypoints.length;
            items.push({
                icon: 'signpost-split',
                label: route.name,
                subtext: route.result
                    ? `${formatDistance(route.result.distance)} · ${stopCount} stop${stopCount === 1 ? '' : 's'}`
                    : `${stopCount} stop${stopCount === 1 ? '' : 's'}`,
                checked: currentId === route.id,
                expandable: true,
                ariaLabel: `${route.name}. Extend this route, or show its legs and steps`,
                action: (btn) => this._chooseExistingRoute(route, btn)
            });
        });

        return items;
    }

    _chooseRoute(routeId) {
        this._routeSelection = { explicit: true, routeId };
        this._flyout.close();
        this._updateRouteRow();
        window.keyboardController?.announceToScreenReader(routeId ? `Extending ${this._currentRoute()?.name}` : 'Starting a new route');
        this._routeRow?.button.focus();
    }

    /**
     * Picking an existing route both selects it (so the next destination
     * extends it) and opens its turn-by-turn detail - legs, then each leg's
     * steps, straight from the Directions API response
     * (https://docs.mapbox.com/api/navigation/directions/#retrieve-directions)
     * kept on `route.result` - so browsing a past route and choosing to
     * extend it are the same click.
     */
    _chooseExistingRoute(route, btn) {
        this._routeSelection = { explicit: true, routeId: route.id };
        this._updateRouteRow();
        this._flyout.open(btn, this._buildRouteLegItems(route), { level: 1, placement: 'side' });
    }

    _buildRouteLegItems(route) {
        const legs = route.result?.legs || [];
        if (legs.length === 0) {
            return [{ icon: 'info-circle', label: 'No turn-by-turn detail available', action: () => {} }];
        }

        return legs.map((leg, index) => {
            const fromName = route.names[index] || (index === 0 ? 'Start' : `Stop ${index}`);
            const toName = route.names[index + 1] || `Stop ${index + 1}`;
            return {
                icon: 'signpost-2',
                label: `${fromName} → ${toName}`,
                subtext: `${formatDistance(leg.distance)} · ${Math.max(1, Math.round(leg.duration / 60))} min`,
                expandable: true,
                ariaLabel: `Leg from ${fromName} to ${toName}, ${formatDistance(leg.distance)}. Show its steps`,
                action: (legBtn) => this._flyout.open(legBtn, this._buildRouteStepItems(leg), { level: 2, placement: 'side' })
            };
        });
    }

    _buildRouteStepItems(leg) {
        const steps = leg.steps || [];
        if (steps.length === 0) {
            return [{ icon: 'info-circle', label: 'No steps available', action: () => {} }];
        }

        return steps.map(step => ({
            icon: 'arrow-up-right',
            label: step.maneuver?.instruction || step.name || 'Continue',
            subtext: formatDistance(step.distance),
            action: () => this._flyToStep(step)
        }));
    }

    /** Jumps the camera to a step's maneuver point, for browsing a route's turns. */
    _flyToStep(step) {
        const location = step.maneuver?.location;
        if (!location || !this._map) return;
        this._map.easeTo({ center: location, zoom: Math.max(this._map.getZoom(), 15), duration: 600 });
    }

    /**
     * "Navigation options": the Mapbox routing profile
     * (https://docs.mapbox.com/api/navigation/directions/#routing-profiles)
     * every "Navigate" action here and every "X to Y" search route is drawn
     * with (see search/directions-profile.js). It sits at the end because it
     * changes how you reach any destination above rather than being a
     * destination itself.
     */
    _createProfileRow() {
        this._profileRow = this._createDropdownRow(() => this._buildProfileItems(), { chevron: 'chevron-right', placement: 'side' });
        this._updateProfileRow();
        return this._profileRow.button;
    }

    _updateProfileRow() {
        if (!this._profileRow) return;
        const { button, icon, label, subtext } = this._profileRow;
        const profile = getDirectionsProfileInfo();
        icon.setAttribute('name', profile.icon);
        label.textContent = profile.label;
        subtext.textContent = profile.subtext;
        button.setAttribute('aria-label', `Routing profile: ${profile.label}. Choose a different travel mode`);
    }

    _buildProfileItems() {
        const currentId = getDirectionsProfile();
        return DIRECTIONS_PROFILES.map(profile => ({
            icon: profile.icon,
            label: profile.label,
            subtext: profile.subtext,
            checked: profile.id === currentId,
            action: () => this._chooseProfile(profile)
        }));
    }

    /**
     * Changing the profile while an existing route is the active Route
     * selection re-fetches that route with the new profile instead of only
     * affecting the next route drawn from scratch - the "New Route" case,
     * where there's nothing yet to update.
     */
    _chooseProfile(profile) {
        setDirectionsProfile(profile.id);
        this._updateProfileRow();

        const route = this._currentRoute();
        if (!route) {
            window.keyboardController?.announceToScreenReader(`Routes will use ${profile.label}`);
            this._profileRow.button.focus();
            return;
        }

        window.keyboardController?.announceToScreenReader(`Updating ${route.name} to ${profile.label}.`);
        routeStore.setRouteProfile(route.id, profile.id)
            .then(updated => {
                if (!updated) return;
                this._updateRouteRow();
                this._fitRoute(updated);
                window.keyboardController?.announceToScreenReader(
                    `Route ${updated.name} updated: ${formatDistance(updated.result.distance)}, ${profile.label}`
                );
            })
            .catch(error => {
                console.error('[directions]', error);
                window.keyboardController?.announceToScreenReader('Could not update the route');
            });
        this._profileRow.button.focus();
    }

    /**
     * Routes from Route From to `lngLat` (see search/route-store.js's
     * routeTo) - which decides on its own whether that continues a route
     * already ending at the origin or starts a new one. Either way Route
     * From then follows the new waypoint's own marker, so picking another
     * destination extends the same route instead of starting over.
     */
    _routeTo(lngLat, name, announcement) {
        const from = this._fromRef.resolveOrCenter();
        window.keyboardController?.announceToScreenReader(
            from ? `${announcement}. Finding a ${getDirectionsProfileInfo().label} route.` : announcement
        );
        if (!from) return;

        routeStore
            .routeTo(from, this._fromRef.name(), lngLat, name, { routeId: this._currentRouteSelection() || 'new' })
            .then(route => {
                if (!route) return;
                const markerId = route.markerIds[route.markerIds.length - 1];
                if (markerId) this._fromRef.chooseMarker(markerId, name);
                this._updateRouteRow();
                this._fitRoute(route);
                window.keyboardController?.announceToScreenReader(
                    `Route ${route.name}: ${route.waypoints.length} stops, ${formatDistance(route.result.distance)}`
                );
            })
            .catch(error => {
                console.error('[directions]', error);
                window.keyboardController?.announceToScreenReader('Could not find a route');
            });
    }

    _fitRoute(route) {
        const line = route.geojson?.features?.find(f => f.properties?.kind === 'route');
        if (!line || !this._map) return;
        this._map.fitBounds(routeBounds(line.geometry), { padding: 60, duration: 1000 });
    }

    /** "320 m · NE" from Route From, or '' if unresolvable. */
    _formatOffset(lngLat) {
        const origin = this._fromRef.resolveOrCenter();
        if (!origin) return '';
        const bearingDeg = initialBearingDeg(origin, lngLat);
        return `${formatDistance(haversineDistanceMeters(origin, lngLat))} · ${bearingToCompassAbbr(bearingDeg)}`;
    }

    /** Spoken form of the same offset, as an aria-label suffix. */
    _describeOffset(lngLat) {
        const origin = this._fromRef.resolveOrCenter();
        if (!origin) return '';
        const distanceText = formatDistance(haversineDistanceMeters(origin, lngLat));
        const bearingDeg = initialBearingDeg(origin, lngLat);
        return `, ${distanceText} ${bearingToCompassWord(bearingDeg)} of ${this._fromRef.name()}`;
    }

    _handleOutsideEvent(e) {
        if (!this._isOpenState) return;
        if (this._container?.contains(e.target)) return;
        if (this._menu?.contains(e.target)) return;
        if (this._flyout.contains(e.target)) return;
        this._hide();
    }

    /**
     * Escape closes the open flyout first, then the menu; Space/Enter on a
     * focused row must reach the button's own native activation instead of the
     * global keyboard shortcut for "query feature at map center" (both bind
     * Space). Registered with `capture: true` so it runs — and can
     * stopPropagation — before that bubble-phase document listener in
     * keyboard-controller.js ever sees the key.
     */
    _onKeydown(e) {
        if (!this._menu || !this._isOpenState) return;

        // An AutocompleteBadgeInput field handles its own Escape (revert to
        // its badge) via a capture-phase listener on the input itself, which
        // this document-level capture listener would otherwise pre-empt.
        if (e.key === 'Escape' && document.activeElement?.classList.contains('ac-badge-input-field')) return;

        if (e.key === 'Escape') {
            e.stopPropagation();
            if (this._flyout.isOpen) this._flyout.closeDeepest({ restoreFocus: true });
            else this._hide();
            return;
        }

        if (e.key === ' ' && (this._menu.contains(document.activeElement) || this._flyout.contains(document.activeElement))) {
            e.stopPropagation();
            return;
        }

        if (e.key === 'Tab') {
            const focusable = [...this._menu.querySelectorAll('button, input'), ...this._flyout.buttons()];
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }
}

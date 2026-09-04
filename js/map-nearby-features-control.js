/**
 * NearbyFeaturesControl - Accessible alternative to tapping/clicking the map
 * canvas. Lists features currently rendered in the viewport as a header-nav
 * menu, so touch screen-reader users (VoiceOver/TalkBack — no keyboard, and
 * canvas hit-testing via drag gestures isn't reliable for them) and
 * keyboard-only users can select a feature without needing to hit-test the
 * Mapbox GL canvas at all. Selecting a feature routes through the same
 * stateManager.handleFeatureClicks() pipeline a mouse click uses, so marker
 * creation, the inspector panel, and URL state all behave identically.
 *
 * The menu reads as a route being built, from a From and a To:
 *
 * - **Navigate From** — one button showing the current origin with its own
 *   icon (device GPS, the map center, or a marker); clicking it drops a
 *   dropdown of every available option (see nearby-reference-point.js). This
 *   origin is also what every distance and bearing below is measured from, so
 *   a VI user can walk toward a target and watch the distance shrink. GPS
 *   reuses the app's existing window.geolocationControl rather than a separate
 *   watchPosition.
 * - **To** — destinations, each section sorted nearest-first: every marker on
 *   the map (see map-marker-manager.js), then one row per layer with features
 *   in view, each opening a submenu of that layer's closest few features. The
 *   layer rows keep the top level short however dense a layer is, and carry
 *   the layer's feature count plus the distance to its nearest one. The
 *   section closes with **Navigation options** — the Mapbox routing profile
 *   (driving/walking/cycling, see search/directions-profile.js) that every
 *   route drawn from here, or from an "X to Y" search, uses.
 *
 * Hovering or focusing any destination row previews it on the map: the feature
 * highlighted through the same stateManager.handleFeatureHovers() pipeline a
 * mouse-over of the canvas uses, a dashed line drawn from the origin labelled
 * with the distance and bearing, and the camera framed on the two ends (see
 * nearby-preview-layer.js). Leaving the row puts all three back, including the
 * camera the menu was opened with — unless the row was acted on (a feature
 * selected, a marker flown to, a route drawn), in which case the view it moved
 * to is what the user asked for and is kept. A pan or zoom of the user's own
 * while the menu is open re-bases that saved view, so closing the menu never
 * undoes their gesture.
 *
 * Clicking any destination does the whole job in one tap — no secondary menu:
 * a marker is dropped on it through the same selection pipeline a map click
 * runs, and the place is appended to a route as another waypoint
 * (search/route-store.js's routeTo, drawn into the `directions` layer) — that
 * call decides on its own whether the current origin continues an existing
 * route or starts a new one, so there's nothing here to pick manually. The
 * origin then follows the new waypoint's own marker, so picking a second
 * destination extends the same route rather than starting a new one from the
 * user again — three taps build one route through three places.
 *
 * Lives in the header-nav (next to the shortcuts menu — see
 * header-shortcut-menu-control.js / shortcut-menu-base.js), sharing its
 * `.header-shortcut-menu` / `.header-shortcut-menu-btn` container styling and
 * rendering rows with the same `.shortcut-menu` classes as other header-nav
 * menus (see map-location-menu-control.js). Not a mapboxgl control.
 */
import { haversineDistanceMeters, initialBearingDeg, formatDistance, bearingToCompassAbbr, bearingToCompassWord } from './geo-distance-utils.js';
import { NearbyReferencePoint, REFERENCE_GEOLOCATION, REFERENCE_CENTER, REFERENCE_MARKER } from './nearby-reference-point.js';
import { routeStore } from './search/route-store.js';
import { ShortcutFlyout } from './shortcut-flyout.js';
import { LayerThumbnail } from './layer-thumbnail.js';
import { NearbyPreviewLayer } from './nearby-preview-layer.js';
import { routeBounds } from './search/route-geojson.js';
import { DIRECTIONS_PROFILES, getDirectionsProfile, setDirectionsProfile, getDirectionsProfileInfo } from './search/directions-profile.js';

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
        this._allFeatures = [];
        this._rowRefs = [];
        this._allMarkers = [];
        this._markerRowRefs = [];
        this._referenceRow = null;
        this._profileRow = null;
        this._featureGroups = [];
        this._visibleCounts = new Map();
        this._reference = null;
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
        this._reference = new NearbyReferencePoint(map);
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

        this._menu.querySelector('button.shortcut-menu-item')?.focus();
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
        // in which case waiting for the next 'geolocate' would leave the origin
        // reading "Map center" for no reason: adopt the watch's last fix, and
        // failing that its tracking state, so an active GPS is the origin from
        // the moment the menu opens.
        if (geo.lastPosition) this._reference.setUserPosition(geo.lastPosition);
        else if (geo.isTracking) this._reference.preferGeolocation();

        geo.on('geolocate', this._onGeolocate);
        if (!geo.isTracking) geo.trigger();
    }

    _stopLocationTracking() {
        window.geolocationControl?.off('geolocate', this._onGeolocate);
    }

    _onGeolocate(e) {
        const promotedToGps = this._reference.setUserPosition({ lat: e.coords.latitude, lng: e.coords.longitude });

        // The first fix promotes an implicit map-center default to GPS, which
        // changes what "nearest" means — worth one re-sort. After that row
        // order stays stable so live updates don't reshuffle the list under a
        // screen-reader/keyboard user mid-navigation.
        if (promotedToGps) {
            this._resortAndRender();
        } else if (this._reference.type === REFERENCE_GEOLOCATION) {
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

        // A preview moves the camera itself; with a map-center origin, reacting
        // to that would move the very point the preview line is drawn from.
        if (this._isPreviewing) return;
        if (this._reference.type === REFERENCE_CENTER) this._refreshDistances();
    }

    /**
     * Previews a destination while its row is hovered or focused: the feature
     * highlighted through the same hover pipeline a mouse-over of the canvas
     * uses, a dashed line from the origin labelled with distance and bearing,
     * and the camera framed on the pair (see nearby-preview-layer.js). Ending
     * the preview puts all three back.
     */
    _startPreview(lngLat, { feature = null, layerId = null } = {}) {
        clearTimeout(this._previewTimer);
        const from = this._reference.resolve();
        if (!from || !this._previewLayer) return;

        if (feature && layerId) {
            // allowDuringMove: the preview's own fitBounds leaves the map
            // moving, which would otherwise make the state manager drop this.
            this._stateManager.handleFeatureHovers([{ feature, layerId, lngLat }], lngLat, true);
        }

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

    /** Drops the line and the hover highlight, leaving the camera alone. */
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
        const origin = this._reference.resolve();
        if (!origin) return;

        [this._allFeatures, this._allMarkers].forEach(list => {
            list.forEach(item => {
                item._distanceMeters = haversineDistanceMeters(origin, item.lngLat);
            });
            list.sort((a, b) => a._distanceMeters - b._distanceMeters);
        });

        this._buildFeatureGroups();
    }

    _resortAndRender() {
        const hadFocusInMenu = this._menu.contains(document.activeElement);
        this._flyout.close();
        this._sortByDistance();
        this._renderVisible();
        if (hadFocusInMenu) this._menu.querySelector('button.shortcut-menu-item')?.focus();
    }

    _refreshDistances() {
        this._updateReferenceRow();
        this._rowRefs.forEach(row => this._updateGroupRow(row));
        this._markerRowRefs.forEach(row => this._updateMarkerRowDistance(row));
    }

    _populateList() {
        this._allFeatures = this._stateManager.getFeaturesInView();
        this._allMarkers = window.featureControl?._markerManager?.getMarkers() || [];
        this._visibleCounts.clear();
        this._sortByDistance();

        const featureCount = this._allFeatures.length;
        const layerCount = this._featureGroups.length;
        const markerText = `${this._allMarkers.length} marker${this._allMarkers.length === 1 ? '' : 's'}`;
        window.keyboardController?.announceToScreenReader(
            `Navigating from ${this._reference.name()} by ${getDirectionsProfileInfo().label}. ` + (featureCount > 0
                ? `${markerText} and ${featureCount} features in view across ${layerCount} layer${layerCount === 1 ? '' : 's'}, nearest ${PAGE_SIZE} shown per layer.`
                : `${markerText}. No features in the current view.`)
        );

        this._renderVisible();
    }

    /**
     * Buckets the in-view features by their layer: nearest-first inside each
     * bucket, and the layer holding the single closest feature first. Reads as
     * "which layers are around me, and what's closest in each" rather than one
     * interleaved run where a dense layer crowds out every other.
     * `_allFeatures` is already sorted by distance, so insertion order gives
     * both orderings for free.
     */
    _buildFeatureGroups() {
        const groups = new Map();
        this._allFeatures.forEach(f => {
            let group = groups.get(f.layerId);
            if (!group) {
                group = { layerId: f.layerId, title: this._describeFeature(f).layerTitle, features: [] };
                groups.set(f.layerId, group);
            }
            group.features.push(f);
        });
        this._featureGroups = [...groups.values()];
    }

    _renderVisible() {
        this._menu.innerHTML = '';
        this._rowRefs = [];
        this._markerRowRefs = [];

        this._menu.appendChild(this._createHeading('record-circle', 'Navigate From'));
        this._menu.appendChild(this._createReferenceRow());
        this._menu.appendChild(this._createDivider({ section: true }));
        this._menu.appendChild(this._createHeading('flag', 'To'));

        if (this._allMarkers.length > 0) {
            this._menu.appendChild(this._createHeading('geo-alt-fill', `Markers (${this._allMarkers.length})`, { sub: true }));

            this._allMarkers.forEach((m) => {
                const row = this._createMarkerRow(m);
                this._menu.appendChild(row.button);
                this._markerRowRefs.push(row);
            });

            this._menu.appendChild(this._createDivider());
        }

        if (this._featureGroups.length === 0) {
            this._menu.appendChild(this._createHeading('pin-map', 'Visible Features (0)', { sub: true }));
            const empty = document.createElement('div');
            empty.className = 'shortcut-menu-item shortcut-menu-item-static';
            const emptyLabel = document.createElement('span');
            emptyLabel.textContent = 'No features in the current view.';
            empty.appendChild(emptyLabel);
            this._menu.appendChild(empty);
        } else {
            this._menu.appendChild(this._createHeading('pin-map', `Visible Features (${this._allFeatures.length})`, { sub: true }));
            this._featureGroups.forEach(group => {
                const row = this._createGroupRow(group);
                this._menu.appendChild(row.button);
                this._rowRefs.push(row);
            });
        }

        this._menu.appendChild(this._createDivider({ section: true }));
        this._menu.appendChild(this._createHeading('sliders', 'Navigation options'));
        this._menu.appendChild(this._createProfileRow());
    }

    /**
     * One row per layer in view, opening a submenu of that layer's features.
     * The row itself carries the layer's feature count and the distance to its
     * closest one, so the top level stays a short "what's around me" list
     * however many features a dense layer has.
     */
    _createGroupRow(group) {
        const row = this._createDropdownRow(() => this._buildGroupItems(group), { chevron: 'chevron-right', placement: 'side', field: false });
        row.group = group;

        // The same preview the layer controls and marker popups use (see
        // layer-thumbnail.js), so a layer is recognisable here by its
        // symbology and not by title alone. Non-interactive: the click belongs
        // to the row, which opens the layer's features.
        const config = this._stateManager.getLayerConfig(group.layerId);
        if (config) {
            const thumbnail = LayerThumbnail.generate(config, 18, { interactive: false });
            thumbnail.classList.add('shortcut-menu-thumbnail');
            row.icon.replaceWith(thumbnail);
        } else {
            row.icon.setAttribute('name', 'layers');
        }

        // Hovering a layer previews the nearest thing in it - the same
        // feature its subtext is quoting the distance to.
        this._bindPreview(row.button, () => {
            const nearest = group.features[0];
            this._startPreview(nearest.lngLat, { feature: nearest.feature, layerId: nearest.layerId });
        });

        this._updateGroupRow(row);
        return row;
    }

    _updateGroupRow(row) {
        const { group, button, label, subtext } = row;
        label.textContent = group.title;

        const countText = `${group.features.length} feature${group.features.length === 1 ? '' : 's'}`;
        const offset = this._formatOffset(group.features[0].lngLat);
        subtext.textContent = offset ? `${countText} · nearest ${offset}` : countText;
        button.setAttribute('aria-label', `${group.title}, ${countText}, nearest${this._describeOffset(group.features[0].lngLat)}. Show its features`);
    }

    /**
     * A layer's submenu: its closest features, each marking and routing to
     * itself on click. No layer name on the rows - the row they hang off
     * already names it; the subtext is the distance and bearing from the
     * current origin.
     */
    _buildGroupItems(group) {
        const visibleCount = this._visibleCounts.get(group.layerId) ?? PAGE_SIZE;

        const items = group.features.slice(0, visibleCount).map(f => {
            const { label } = this._describeFeature(f);
            return {
                icon: 'geo-alt',
                label,
                subtext: this._formatOffset(f.lngLat),
                ariaLabel: `${label}${this._describeOffset(f.lngLat)}`,
                onHover: (enter) => enter
                    ? this._startPreview(f.lngLat, { feature: f.feature, layerId: f.layerId })
                    : this._endPreview(),
                action: () => this._selectFeature(f)
            };
        });

        const remaining = group.features.length - items.length;
        if (remaining > 0) {
            items.push({
                icon: 'three-dots',
                label: `Show ${Math.min(PAGE_SIZE, remaining)} more`,
                subtext: `${remaining} further away`,
                action: () => this._showMore(group)
            });
        }

        return items;
    }

    /**
     * A section label. `sub` marks the two destination sections nested under
     * the "To" heading, so they read as a level down rather than as peers of
     * "Navigate From" / "To".
     */
    _createHeading(iconName, text, { sub = false } = {}) {
        const heading = document.createElement('div');
        heading.className = 'shortcut-menu-item shortcut-menu-item-static';
        if (sub) heading.classList.add('shortcut-menu-item-subheading');
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

    // Reopens the layer's submenu with the next page revealed, focused on the
    // first newly shown feature rather than jumping back to the top.
    _showMore(group) {
        const shown = this._visibleCounts.get(group.layerId) ?? PAGE_SIZE;
        this._visibleCounts.set(group.layerId, Math.min(shown + PAGE_SIZE, group.features.length));
        const row = this._rowRefs.find(r => r.group.layerId === group.layerId);
        if (row) this._flyout.open(row.button, this._buildGroupItems(group), { focusIndex: shown });
    }

    /**
     * The "Navigate From" button: the current origin, shown with its own icon,
     * dropping a list of every available origin — GPS, the map center, and
     * every marker by name (see nearby-reference-point.js). Picking one
     * re-sorts the destinations below around it.
     */
    _createReferenceRow() {
        this._referenceRow = this._createDropdownRow(() => this._buildReferenceItems());
        this._updateReferenceRow();
        return this._referenceRow.button;
    }

    /**
     * A row whose chevron opens a list: a value with its icon, a subtext line,
     * and the choices below or beside it. `field` gives it the boxed look of
     * an editable setting - right for the origin and routing-profile pickers,
     * wrong for the layer rows, which are just destinations one level down.
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

    _updateReferenceRow() {
        if (!this._referenceRow) return;
        const { button, icon, label, subtext } = this._referenceRow;
        const { label: name, icon: iconName, isPending } = this._reference.current();
        const point = this._reference.resolve();

        icon.setAttribute('name', iconName);
        label.textContent = name;
        subtext.textContent = isPending
            ? 'Waiting for GPS · using map center'
            : (point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'Unavailable');
        button.setAttribute('aria-label', `Navigate from ${name}. Choose a different starting point`);
    }

    _buildReferenceItems() {
        return this._reference.listOptions().map(option => ({
            icon: option.icon,
            label: option.label,
            subtext: option.subtext,
            checked: this._reference.isChosen(option),
            action: () => this._chooseReference(option)
        }));
    }

    _chooseReference(option) {
        this._reference.choose(option);
        if (option.type === REFERENCE_GEOLOCATION) this._startLocationTracking();
        this._resortAndRender();
        window.keyboardController?.announceToScreenReader(`Navigating from ${this._reference.name()}`);
        this._menu.querySelector('button.shortcut-menu-item')?.focus();
    }

    /**
     * "Navigation options": the Mapbox routing profile
     * (https://docs.mapbox.com/api/navigation/directions/#routing-profiles)
     * every "Navigate" action here and every "X to Y" search route is drawn
     * with (see search/directions-profile.js). It sits at the end of the To
     * section because it changes how you reach any destination above rather
     * than being a destination itself.
     */
    _createProfileRow() {
        this._profileRow = this._createDropdownRow(() => this._buildProfileItems());
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

    _chooseProfile(profile) {
        setDirectionsProfile(profile.id);
        this._updateProfileRow();
        window.keyboardController?.announceToScreenReader(`Routes will use ${profile.label}`);
        this._profileRow.button.focus();
    }

    /**
     * A marker row. One button, no secondary menu: clicking a destination
     * already does the whole job (see _selectFeature).
     */
    _createMarkerRow(m) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shortcut-menu-item';

        const iconEl = document.createElement('sl-icon');
        iconEl.setAttribute('name', 'geo-alt-fill');
        button.appendChild(iconEl);

        const text = document.createElement('div');
        text.className = 'shortcut-menu-item-text';
        const label = document.createElement('span');
        label.className = 'shortcut-menu-item-label';
        const subtext = document.createElement('span');
        subtext.className = 'shortcut-menu-item-subtext';
        text.appendChild(label);
        text.appendChild(subtext);
        button.appendChild(text);

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._focusMarker(m);
        });
        this._bindPreview(button, () => this._startPreview(m.lngLat));

        const row = { button, label, subtext, m };
        this._updateMarkerRowDistance(row);
        return row;
    }

    /**
     * Routes from the current origin to `lngLat` (see search/route-store.js's
     * routeTo) - which decides on its own whether that continues a route
     * already ending at the origin or starts a new one. Either way the origin
     * then follows the new waypoint's own marker, so picking another
     * destination extends the same route instead of starting over.
     */
    _routeTo(lngLat, name, announcement) {
        const from = this._reference.resolve();
        window.keyboardController?.announceToScreenReader(
            from ? `${announcement}. Finding a ${getDirectionsProfileInfo().label} route.` : announcement
        );
        if (!from) return;

        routeStore
            .routeTo(from, this._reference.name(), lngLat, name)
            .then(route => {
                if (!route) return;
                const markerId = route.markerIds[route.markerIds.length - 1];
                if (markerId) this._reference.choose({ type: REFERENCE_MARKER, markerId });
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

    _updateMarkerRowDistance(row) {
        const { m, label, subtext, button } = row;
        label.textContent = m.label;
        subtext.textContent = this._formatOffset(m.lngLat) || 'Marker';
        button.setAttribute('aria-label', `Navigate to ${m.label}${this._describeOffset(m.lngLat)}`);
    }

    _focusMarker(m) {
        this._commitCamera();
        this._hide();
        window.featureControl?._markerManager?.focusMarker(m.id);
        this._routeTo(m.lngLat, m.label, `Selected marker ${m.label}`);
    }

    _describeFeature(f) {
        const layerConfig = this._stateManager.getLayerConfig(f.layerId);
        const inspectConfig = layerConfig?.inspect || {};
        const labelField = inspectConfig.label || inspectConfig.id || 'id';
        const value = f.feature?.properties?.[labelField] ?? f.feature?.id ?? 'Feature';
        return {
            label: String(value),
            layerTitle: layerConfig?.title || f.layerId
        };
    }

    /** "320 m · NE" from the current reference point, or '' if unresolvable. */
    _formatOffset(lngLat) {
        const origin = this._reference.resolve();
        if (!origin) return '';
        const bearingDeg = initialBearingDeg(origin, lngLat);
        return `${formatDistance(haversineDistanceMeters(origin, lngLat))} · ${bearingToCompassAbbr(bearingDeg)}`;
    }

    /** Spoken form of the same offset, as an aria-label suffix. */
    _describeOffset(lngLat) {
        const origin = this._reference.resolve();
        if (!origin) return '';
        const distanceText = formatDistance(haversineDistanceMeters(origin, lngLat));
        const bearingDeg = initialBearingDeg(origin, lngLat);
        return `, ${distanceText} ${bearingToCompassWord(bearingDeg)} of ${this._reference.name()}`;
    }

    /**
     * A destination's click does the whole job in one tap: drop a marker on it
     * through the same selection pipeline a map click runs, then route to it
     * from the current origin. That is why no destination row carries a
     * secondary-actions menu.
     */
    _selectFeature(f) {
        const { label } = this._describeFeature(f);
        this._commitCamera();
        this._hide();
        this._stateManager.handleFeatureClicks([f]);
        window.featureControl?._markerManager?._openInspectorPanel();
        this._routeTo(f.lngLat, label, `Selected ${label}`);
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
            const focusable = [...this._menu.querySelectorAll('button'), ...this._flyout.buttons()];
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

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
 * The menu reads as a from/to pair:
 *
 * - **Navigate From** — one button showing the current origin with its own
 *   icon (device GPS, the map center, or a marker); clicking it drops a
 *   dropdown of every available option (see nearby-reference-point.js). This
 *   origin is also what every distance and bearing below is measured from, so
 *   a VI user can walk toward a target and watch the distance shrink. GPS
 *   reuses the app's existing window.geolocationControl rather than a separate
 *   watchPosition.
 * - **To** — two sections of destinations, each sorted nearest-first: every
 *   marker on the map (see map-marker-manager.js), then the closest few
 *   features in view. Selecting a marker flies to it via
 *   MapMarkerManager.focusMarker(); selecting a feature selects it.
 *
 * Every destination row carries a chevron button opening a flyout of secondary
 * actions (see shortcut-flyout.js): "Navigate", which draws a route from the
 * origin via search/directions-router.js, and — for features only — "Add
 * marker", which runs the normal selection pipeline at that point. The row's
 * own click stays the primary action, so the common case is still one tap.
 *
 * Lives in the header-nav (next to the shortcuts menu — see
 * header-shortcut-menu-control.js / shortcut-menu-base.js), sharing its
 * `.header-shortcut-menu` / `.header-shortcut-menu-btn` container styling and
 * rendering rows with the same `.shortcut-menu` classes as other header-nav
 * menus (see map-location-menu-control.js). Not a mapboxgl control.
 */
import { haversineDistanceMeters, initialBearingDeg, formatDistance, bearingToCompassAbbr, bearingToCompassWord } from './geo-distance-utils.js';
import { NearbyReferencePoint, REFERENCE_GEOLOCATION, REFERENCE_CENTER } from './nearby-reference-point.js';
import { ShortcutFlyout } from './shortcut-flyout.js';

const PAGE_SIZE = 5;

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
        this._visibleCount = PAGE_SIZE;
        this._reference = null;
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

        this._visibleCount = PAGE_SIZE;
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

    _onMapMove() {
        if (this._reference.type === REFERENCE_CENTER) this._refreshDistances();
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
        this._rowRefs.forEach(row => this._updateRowDistance(row));
        this._markerRowRefs.forEach(row => this._updateMarkerRowDistance(row));
    }

    _populateList() {
        this._allFeatures = this._stateManager.getFeaturesInView();
        this._allMarkers = window.featureControl?._markerManager?.getMarkers() || [];
        this._sortByDistance();

        const featureCount = this._allFeatures.length;
        window.keyboardController?.announceToScreenReader(
            `Navigating from ${this._reference.name()}. ` + (featureCount > 0
                ? `${this._allMarkers.length} marker${this._allMarkers.length === 1 ? '' : 's'} and the nearest ${Math.min(PAGE_SIZE, featureCount)} of ${featureCount} features in view.`
                : `${this._allMarkers.length} marker${this._allMarkers.length === 1 ? '' : 's'}. No features in the current view.`)
        );

        this._renderVisible();
    }

    _renderVisible({ focusFirstNew = false } = {}) {
        const previousCount = this._rowRefs.length;
        this._menu.innerHTML = '';
        this._rowRefs = [];
        this._markerRowRefs = [];

        this._menu.appendChild(this._createHeading('record-circle', 'Navigate From'));
        this._menu.appendChild(this._createReferenceRow());
        this._menu.appendChild(this._createDivider());
        this._menu.appendChild(this._createHeading('flag', 'To'));

        if (this._allMarkers.length > 0) {
            this._menu.appendChild(this._createHeading('geo-alt-fill', `Markers (${this._allMarkers.length})`, { sub: true }));

            this._allMarkers.forEach((m) => {
                const row = this._createMarkerRow(m);
                this._menu.appendChild(row.wrapper);
                this._markerRowRefs.push(row);
            });

            this._menu.appendChild(this._createDivider());
        }

        this._menu.appendChild(this._createHeading('filter-circle', `Nearby features (${this._allFeatures.length})`, { sub: true }));

        if (this._allFeatures.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'shortcut-menu-item shortcut-menu-item-static';
            const emptyLabel = document.createElement('span');
            emptyLabel.textContent = 'No features in the current view.';
            empty.appendChild(emptyLabel);
            this._menu.appendChild(empty);
            return;
        }

        const visible = this._allFeatures.slice(0, this._visibleCount);
        visible.forEach((f) => {
            const row = this._createRow(f);
            this._menu.appendChild(row.wrapper);
            this._rowRefs.push(row);
        });

        const remaining = this._allFeatures.length - visible.length;
        if (remaining > 0) {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'shortcut-menu-item';

            const icon = document.createElement('sl-icon');
            icon.setAttribute('name', 'three-dots');
            more.appendChild(icon);

            const label = document.createElement('span');
            label.textContent = `Show ${Math.min(PAGE_SIZE, remaining)} more (${remaining} remaining)`;
            more.appendChild(label);

            more.addEventListener('click', (e) => {
                e.stopPropagation();
                this._showMore();
            });
            this._menu.appendChild(more);
        }

        if (focusFirstNew && this._rowRefs[previousCount]) {
            this._rowRefs[previousCount].button.focus();
        }
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

    _createDivider() {
        const divider = document.createElement('div');
        divider.className = 'shortcut-menu-divider';
        return divider;
    }

    _showMore() {
        this._visibleCount = Math.min(this._visibleCount + PAGE_SIZE, this._allFeatures.length);
        this._renderVisible({ focusFirstNew: true });
    }

    /**
     * The "Navigate From" button: the current origin, shown with its own icon,
     * dropping a list of every available origin — GPS, the map center, and
     * every marker by name (see nearby-reference-point.js). Picking one
     * re-sorts the destinations below around it.
     */
    _createReferenceRow() {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shortcut-menu-item shortcut-menu-item-origin';

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
        chevron.setAttribute('name', 'chevron-down');
        button.appendChild(chevron);

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._flyout.toggle(button, this._buildReferenceItems(), { placement: 'below' });
        });

        this._referenceRow = { button, icon, label, subtext };
        this._updateReferenceRow();
        return button;
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
     * A list row: the primary action button plus a chevron button opening its
     * secondary-actions flyout. Two sibling buttons rather than one nested
     * inside the other, so both are reachable by tab/swipe on their own.
     */
    _createActionRow({ icon, onSelect, buildActions }) {
        const wrapper = document.createElement('div');
        wrapper.className = 'shortcut-menu-row';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shortcut-menu-item';

        const iconEl = document.createElement('sl-icon');
        iconEl.setAttribute('name', icon);
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
            onSelect();
        });
        wrapper.appendChild(button);

        const actions = document.createElement('button');
        actions.type = 'button';
        actions.className = 'shortcut-menu-item shortcut-menu-row-actions';
        const chevron = document.createElement('sl-icon');
        chevron.className = 'shortcut-menu-chevron';
        chevron.setAttribute('name', 'chevron-right');
        actions.appendChild(chevron);
        actions.addEventListener('click', (e) => {
            e.stopPropagation();
            this._flyout.toggle(actions, buildActions());
        });
        wrapper.appendChild(actions);

        return { wrapper, button, actions, label, subtext };
    }

    _createRow(f) {
        const row = this._createActionRow({
            icon: 'geo-alt',
            onSelect: () => this._selectFeature(f),
            buildActions: () => this._buildFeatureActions(f)
        });
        row.f = f;
        this._updateRowDistance(row);
        return row;
    }

    _createMarkerRow(m) {
        const row = this._createActionRow({
            icon: 'geo-alt-fill',
            onSelect: () => this._focusMarker(m),
            buildActions: () => this._buildMarkerActions(m)
        });
        row.m = m;
        this._updateMarkerRowDistance(row);
        return row;
    }

    _buildFeatureActions(f) {
        const { label } = this._describeFeature(f);
        return [
            {
                icon: 'signpost-split',
                label: 'Navigate',
                subtext: `Route from ${this._reference.name()}`,
                action: () => this._navigateTo(f.lngLat, label)
            },
            {
                icon: 'geo-alt-fill',
                label: 'Add marker',
                subtext: 'Place a marker here',
                action: () => this._addMarkerAt(f.lngLat, label)
            }
        ];
    }

    // Markers get no "Add marker" — one is already there.
    _buildMarkerActions(m) {
        return [
            {
                icon: 'signpost-split',
                label: 'Navigate',
                subtext: `Route from ${this._reference.name()}`,
                action: () => this._navigateTo(m.lngLat, m.label)
            }
        ];
    }

    /**
     * Draws a route from the current reference point to `lngLat`, reusing the
     * search control's own directions handler (search/directions-router.js
     * plus its route layer and fitBounds) so a route started here looks
     * identical to one started from an "X to Y" search.
     */
    _navigateTo(lngLat, label) {
        const from = this._reference.resolve();
        if (!from) return;
        this._hide();
        window.keyboardController?.announceToScreenReader(`Finding a route to ${label}`);
        window.searchControl?._selectDirectionsSuggestion({
            from: { coordinates: [from.lng, from.lat] },
            to: { coordinates: [lngLat.lng, lngLat.lat] }
        });
    }

    /**
     * Places a selection marker at `lngLat` via the same manual trigger the
     * right-click shortcut menu's "Select features" uses, so the marker picks
     * up whatever features sit under that point.
     */
    _addMarkerAt(lngLat, label) {
        this._hide();
        window.featureControl?.triggerSelectionAt(lngLat);
        window.keyboardController?.announceToScreenReader(`Marker added at ${label}`);
    }

    _updateMarkerRowDistance(row) {
        const { m, label, subtext, button, actions } = row;
        label.textContent = m.label;
        subtext.textContent = this._formatOffset(m.lngLat) || 'Marker';
        button.setAttribute('aria-label', `${m.label}${this._describeOffset(m.lngLat)}`);
        actions.setAttribute('aria-label', `Actions for ${m.label}`);
    }

    _focusMarker(m) {
        this._hide();
        window.featureControl?._markerManager?.focusMarker(m.id);
        window.keyboardController?.announceToScreenReader(`Selected marker ${m.label}`);
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

    _updateRowDistance(row) {
        const { f, label, subtext, button, actions } = row;
        const { label: featureLabel, layerTitle } = this._describeFeature(f);
        label.textContent = featureLabel;

        const offset = this._formatOffset(f.lngLat);
        subtext.textContent = offset ? `${layerTitle} · ${offset}` : layerTitle;
        button.setAttribute('aria-label', `${featureLabel} — ${layerTitle}${this._describeOffset(f.lngLat)}`);
        actions.setAttribute('aria-label', `Actions for ${featureLabel}`);
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

    _selectFeature(f) {
        const { label } = this._describeFeature(f);
        this._hide();
        this._stateManager.handleFeatureClicks([f]);
        window.featureControl?._markerManager?._openInspectorPanel();
        window.keyboardController?.announceToScreenReader(`Selected ${label}`);
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
            if (this._flyout.isOpen) this._flyout.close({ restoreFocus: true });
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

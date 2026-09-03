/**
 * NearbyFeaturesControl - Accessible alternative to tapping/clicking the map
 * canvas. Lists features currently rendered in the viewport as a header-nav
 * menu, so touch screen-reader users (VoiceOver/TalkBack — no keyboard, and
 * canvas hit-testing via drag gestures isn't reliable for them) and
 * keyboard-only users can select a feature without needing to hit-test the
 * Mapbox GL canvas at all. Each row also live-updates its distance and
 * compass bearing from the device's current position (reusing the app's
 * existing window.geolocationControl rather than a separate watchPosition),
 * so a VI user can walk toward a target and watch the distance shrink.
 * Selecting a feature routes through the same stateManager.handleFeatureClicks()
 * pipeline a mouse click uses, so marker creation, the inspector panel, and
 * URL state all behave identically.
 *
 * A "Markers" section is pinned at the top of the list (before the paginated
 * feature rows) listing every marker already placed on the map (see
 * map-marker-manager.js), sorted by proximity the same way feature rows are.
 * Selecting one flies the map to it via MapMarkerManager.focusMarker() rather
 * than re-running feature selection.
 *
 * Lives in the header-nav (next to the shortcuts menu — see
 * header-shortcut-menu-control.js / shortcut-menu-base.js), sharing its
 * `.header-shortcut-menu` / `.header-shortcut-menu-btn` container styling and
 * rendering rows with the same `.shortcut-menu` classes as other header-nav
 * menus (see map-location-menu-control.js). Not a mapboxgl control.
 */
import { haversineDistanceMeters, initialBearingDeg, formatDistance, bearingToCompassAbbr, bearingToCompassWord } from './geo-distance-utils.js';

const PAGE_SIZE = 10;

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
        this._visibleCount = PAGE_SIZE;
        this._userPosition = null;
        this._hasSortedByDistance = false;
        this._onKeydown = this._onKeydown.bind(this);
        this._onGeolocate = this._onGeolocate.bind(this);
        this._handleOutsideEvent = this._handleOutsideEvent.bind(this);
        this._hide = this._hide.bind(this);
    }

    mount(hostEl, map) {
        if (!hostEl || !map) return;
        this._map = map;

        this._container = document.createElement('div');
        this._container.className = 'header-shortcut-menu';

        this._button = document.createElement('button');
        this._button.type = 'button';
        this._button.className = 'header-shortcut-menu-btn';
        this._button.setAttribute('aria-label', 'List features in view');
        this._button.title = 'List features in view (for screen readers or without a mouse)';
        this._button.innerHTML = '<sl-icon name="geo-alt"></sl-icon>';
        this._button.addEventListener('click', () => this.toggle());

        this._container.appendChild(this._button);
        hostEl.appendChild(this._container);

        this._menu = document.createElement('div');
        this._menu.className = 'shortcut-menu';
        this._menu.style.display = 'none';
        this._menu.setAttribute('role', 'dialog');
        this._menu.setAttribute('aria-modal', 'true');
        this._menu.setAttribute('aria-label', 'Features in view');
        document.body.appendChild(this._menu);

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
        this._button.querySelector('sl-icon')?.setAttribute('name', 'geo-alt-fill');

        this._visibleCount = PAGE_SIZE;
        this._startLocationTracking();
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
        if (this._menu) this._menu.style.display = 'none';
        this._button?.classList.remove('active');
        this._button?.querySelector('sl-icon')?.setAttribute('name', 'geo-alt');
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
        this._userPosition = { lat: e.coords.latitude, lng: e.coords.longitude };

        if (!this._hasSortedByDistance) {
            // First fix since this list was populated: sort nearest-first once,
            // then leave row order stable so live updates below don't reshuffle
            // the list under a screen-reader/keyboard user mid-navigation.
            this._hasSortedByDistance = true;
            const hadFocusInMenu = this._menu.contains(document.activeElement);
            this._sortByDistance();
            this._renderVisible();
            if (hadFocusInMenu) this._menu.querySelector('button.shortcut-menu-item')?.focus();
            return;
        }

        this._rowRefs.forEach(row => this._updateRowDistance(row));
        this._markerRowRefs.forEach(row => this._updateMarkerRowDistance(row));
    }

    _sortByDistance() {
        if (!this._userPosition) return;
        this._allFeatures.forEach(f => {
            f._distanceMeters = haversineDistanceMeters(this._userPosition, f.lngLat);
        });
        this._allFeatures.sort((a, b) => a._distanceMeters - b._distanceMeters);

        this._allMarkers.forEach(m => {
            m._distanceMeters = haversineDistanceMeters(this._userPosition, m.lngLat);
        });
        this._allMarkers.sort((a, b) => a._distanceMeters - b._distanceMeters);
    }

    _populateList() {
        this._allFeatures = this._stateManager.getFeaturesInView();
        this._allMarkers = window.featureControl?._markerManager?.getMarkers() || [];
        this._hasSortedByDistance = !!this._userPosition;
        if (this._hasSortedByDistance) this._sortByDistance();

        window.keyboardController?.announceToScreenReader(
            this._allFeatures.length > 0
                ? `${this._allFeatures.length} feature${this._allFeatures.length === 1 ? '' : 's'} in view. Showing the nearest ${Math.min(PAGE_SIZE, this._allFeatures.length)}.`
                : 'No features in the current view.'
        );

        this._renderVisible();
    }

    _renderVisible({ focusFirstNew = false } = {}) {
        const previousCount = this._rowRefs.length;
        this._menu.innerHTML = '';
        this._rowRefs = [];
        this._markerRowRefs = [];

        if (this._allMarkers.length > 0) {
            const markersHeading = document.createElement('div');
            markersHeading.className = 'shortcut-menu-item shortcut-menu-item-static';
            const markersHeadingIcon = document.createElement('sl-icon');
            markersHeadingIcon.setAttribute('name', 'geo-alt-fill');
            const markersHeadingLabel = document.createElement('span');
            markersHeadingLabel.textContent = `Markers (${this._allMarkers.length})`;
            markersHeading.appendChild(markersHeadingIcon);
            markersHeading.appendChild(markersHeadingLabel);
            this._menu.appendChild(markersHeading);

            this._allMarkers.forEach((m) => {
                const row = this._createMarkerRow(m);
                this._menu.appendChild(row.button);
                this._markerRowRefs.push(row);
            });

            const markersDivider = document.createElement('div');
            markersDivider.className = 'shortcut-menu-divider';
            this._menu.appendChild(markersDivider);
        }

        const heading = document.createElement('div');
        heading.className = 'shortcut-menu-item shortcut-menu-item-static';
        const headingIcon = document.createElement('sl-icon');
        headingIcon.setAttribute('name', 'filter-circle');
        const headingLabel = document.createElement('span');
        headingLabel.textContent = `Features in view (${this._allFeatures.length})`;
        heading.appendChild(headingIcon);
        heading.appendChild(headingLabel);
        this._menu.appendChild(heading);

        const divider = document.createElement('div');
        divider.className = 'shortcut-menu-divider';
        this._menu.appendChild(divider);

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
            this._menu.appendChild(row.button);
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

    _showMore() {
        this._visibleCount = Math.min(this._visibleCount + PAGE_SIZE, this._allFeatures.length);
        this._renderVisible({ focusFirstNew: true });
    }

    _createRow(f) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shortcut-menu-item';

        const icon = document.createElement('sl-icon');
        icon.setAttribute('name', 'geo-alt');
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

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._selectFeature(f);
        });

        const row = { button, label, subtext, f };
        this._updateRowDistance(row);
        return row;
    }

    _createMarkerRow(m) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shortcut-menu-item';

        const icon = document.createElement('sl-icon');
        icon.setAttribute('name', 'geo-alt-fill');
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

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._focusMarker(m);
        });

        const row = { button, label, subtext, m };
        this._updateMarkerRowDistance(row);
        return row;
    }

    _updateMarkerRowDistance(row) {
        const { m, label, subtext, button } = row;
        label.textContent = m.label;

        if (!this._userPosition) {
            subtext.textContent = 'Marker';
            button.setAttribute('aria-label', m.label);
            return;
        }

        const distanceMeters = haversineDistanceMeters(this._userPosition, m.lngLat);
        const bearingDeg = initialBearingDeg(this._userPosition, m.lngLat);
        const distanceText = formatDistance(distanceMeters);
        subtext.textContent = `${distanceText} · ${bearingToCompassAbbr(bearingDeg)}`;
        button.setAttribute('aria-label', `${m.label}, ${distanceText} away, ${bearingToCompassWord(bearingDeg)}`);
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
        const { f, label, subtext, button } = row;
        const { label: featureLabel, layerTitle } = this._describeFeature(f);
        label.textContent = featureLabel;

        if (!this._userPosition) {
            subtext.textContent = layerTitle;
            button.setAttribute('aria-label', `${featureLabel} — ${layerTitle}`);
            return;
        }

        const distanceMeters = haversineDistanceMeters(this._userPosition, f.lngLat);
        const bearingDeg = initialBearingDeg(this._userPosition, f.lngLat);
        const distanceText = formatDistance(distanceMeters);
        subtext.textContent = `${layerTitle} · ${distanceText} · ${bearingToCompassAbbr(bearingDeg)}`;
        button.setAttribute('aria-label', `${featureLabel} — ${layerTitle}, ${distanceText} away, ${bearingToCompassWord(bearingDeg)}`);
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
        this._hide();
    }

    /**
     * Escape closes the menu; Space/Enter on a focused row must reach the
     * button's own native activation instead of the global keyboard shortcut
     * for "query feature at map center" (both bind Space). Registered with
     * `capture: true` so it runs — and can stopPropagation — before that
     * bubble-phase document listener in keyboard-controller.js ever sees the key.
     */
    _onKeydown(e) {
        if (!this._menu || !this._isOpenState) return;

        if (e.key === 'Escape') {
            e.stopPropagation();
            this._hide();
            return;
        }

        if (e.key === ' ' && this._menu.contains(document.activeElement)) {
            e.stopPropagation();
            return;
        }

        if (e.key === 'Tab') {
            const focusable = this._menu.querySelectorAll('button');
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

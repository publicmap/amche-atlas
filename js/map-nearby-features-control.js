/**
 * NearbyFeaturesControl - Accessible alternative to tapping/clicking the map
 * canvas. Lists features currently rendered in the viewport as a plain
 * button list, so touch screen-reader users (VoiceOver/TalkBack — no
 * keyboard, and canvas hit-testing via drag gestures isn't reliable for them)
 * and keyboard-only users can select a feature without needing to hit-test
 * the Mapbox GL canvas at all. Each row also live-updates its distance and
 * compass bearing from the device's current position (reusing the app's
 * existing window.geolocationControl rather than a separate watchPosition),
 * so a VI user can walk toward a target and watch the distance shrink.
 * Selecting an item routes through the same stateManager.handleFeatureClicks()
 * pipeline a mouse click uses, so marker creation, the inspector panel, and
 * URL state all behave identically.
 */
import { haversineDistanceMeters, initialBearingDeg, formatDistance, bearingToCompassAbbr, bearingToCompassWord } from './geo-distance-utils.js';

const PAGE_SIZE = 10;

export class NearbyFeaturesControl {
    constructor(stateManager) {
        this._stateManager = stateManager;
        this._map = null;
        this._container = null;
        this._button = null;
        this._panel = null;
        this._heading = null;
        this._list = null;
        this._lastFocused = null;
        this._allFeatures = [];
        this._rowRefs = [];
        this._visibleCount = PAGE_SIZE;
        this._userPosition = null;
        this._hasSortedByDistance = false;
        this._onKeydown = this._onKeydown.bind(this);
        this._onGeolocate = this._onGeolocate.bind(this);
    }

    onAdd(map) {
        this._map = map;

        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';

        this._button = document.createElement('button');
        this._button.className = 'mapboxgl-ctrl-icon';
        this._button.type = 'button';
        this._button.setAttribute('aria-label', 'List features in view');
        this._button.title = 'List features in view (for screen readers or without a mouse)';
        this._button.style.cssText = 'width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;';
        this._button.innerHTML = '<sl-icon name="list-ul" style="font-size: 14px;"></sl-icon>';
        this._button.addEventListener('click', () => this._togglePanel());
        this._container.appendChild(this._button);

        this._buildPanel();
        document.addEventListener('keydown', this._onKeydown, true);

        return this._container;
    }

    onRemove() {
        document.removeEventListener('keydown', this._onKeydown, true);
        this._stopLocationTracking();
        this._panel?.parentNode?.removeChild(this._panel);
        this._container?.parentNode?.removeChild(this._container);
        this._map = null;
    }

    _buildPanel() {
        this._panel = document.createElement('div');
        this._panel.id = 'nearby-features-panel';
        this._panel.setAttribute('role', 'dialog');
        this._panel.setAttribute('aria-modal', 'true');
        this._panel.setAttribute('aria-label', 'Features in view');
        this._panel.style.cssText = 'display:none;position:absolute;top:40px;right:8px;width:280px;max-height:70vh;overflow-y:auto;background:#111827;color:#f3f4f6;border:1px solid #374151;border-radius:8px;padding:8px;z-index:20;box-shadow:0 4px 16px rgba(0,0,0,0.4);font-size:12px;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;';

        this._heading = document.createElement('span');
        this._heading.textContent = 'Features in view';
        this._heading.style.cssText = 'font-weight:700;font-size:13px;';

        this._closeBtn = document.createElement('button');
        this._closeBtn.type = 'button';
        this._closeBtn.setAttribute('aria-label', 'Close features list');
        this._closeBtn.textContent = '✕';
        this._closeBtn.style.cssText = 'background:transparent;border:none;color:#9ca3af;font-size:14px;line-height:1;cursor:pointer;padding:2px 6px;flex-shrink:0;';
        this._closeBtn.addEventListener('click', () => this._closePanel());

        header.appendChild(this._heading);
        header.appendChild(this._closeBtn);

        this._list = document.createElement('ul');
        this._list.style.cssText = 'list-style:none;margin:0;padding:0;';

        this._panel.appendChild(header);
        this._panel.appendChild(this._list);
        this._map.getContainer().appendChild(this._panel);
    }

    _isOpen() {
        return this._panel.style.display !== 'none';
    }

    _togglePanel() {
        if (this._isOpen()) {
            this._closePanel();
        } else {
            this._openPanel();
        }
    }

    _openPanel() {
        this._lastFocused = document.activeElement;
        this._visibleCount = PAGE_SIZE;
        this._startLocationTracking();
        this._populateList();
        this._panel.style.display = 'block';

        const firstItem = this._list.querySelector('button');
        (firstItem || this._closeBtn).focus();
    }

    _closePanel() {
        this._panel.style.display = 'none';
        this._stopLocationTracking();
        if (this._lastFocused && document.body.contains(this._lastFocused)) {
            this._lastFocused.focus();
        } else {
            this._button.focus();
        }
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
            const hadFocusInPanel = this._panel.contains(document.activeElement);
            this._sortByDistance();
            this._renderVisible();
            if (hadFocusInPanel) this._list.querySelector('button')?.focus();
            return;
        }

        this._rowRefs.forEach(row => this._updateRowDistance(row));
    }

    _sortByDistance() {
        if (!this._userPosition) return;
        this._allFeatures.forEach(f => {
            f._distanceMeters = haversineDistanceMeters(this._userPosition, f.lngLat);
        });
        this._allFeatures.sort((a, b) => a._distanceMeters - b._distanceMeters);
    }

    _populateList() {
        this._allFeatures = this._stateManager.getFeaturesInView();
        this._hasSortedByDistance = !!this._userPosition;
        if (this._hasSortedByDistance) this._sortByDistance();

        this._heading.textContent = `Features in view (${this._allFeatures.length})`;
        window.keyboardController?.announceToScreenReader(
            this._allFeatures.length > 0
                ? `${this._allFeatures.length} feature${this._allFeatures.length === 1 ? '' : 's'} in view. Showing the nearest ${Math.min(PAGE_SIZE, this._allFeatures.length)}.`
                : 'No features in the current view.'
        );

        this._renderVisible();
    }

    _renderVisible({ focusFirstNew = false } = {}) {
        const previousCount = this._rowRefs.length;
        this._list.innerHTML = '';
        this._rowRefs = [];

        if (this._allFeatures.length === 0) {
            const empty = document.createElement('li');
            empty.textContent = 'No features in the current view.';
            empty.style.cssText = 'color:#9ca3af;padding:6px 4px;';
            this._list.appendChild(empty);
            return;
        }

        const visible = this._allFeatures.slice(0, this._visibleCount);
        visible.forEach((f) => {
            const row = this._createRow(f);
            this._list.appendChild(row.item);
            this._rowRefs.push(row);
        });

        const remaining = this._allFeatures.length - visible.length;
        if (remaining > 0) {
            const item = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = `Show ${Math.min(PAGE_SIZE, remaining)} more (${remaining} remaining)`;
            btn.style.cssText = 'display:block;width:100%;text-align:center;background:transparent;border:none;color:#93c5fd;padding:8px 4px;cursor:pointer;font-size:12px;font-weight:600;';
            btn.addEventListener('click', () => this._showMore());
            item.appendChild(btn);
            this._list.appendChild(item);
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
        const item = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'display:block;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid #1f2937;color:#f3f4f6;padding:6px 4px;cursor:pointer;font-size:12px;';

        const titleLine = document.createElement('div');
        const distanceLine = document.createElement('div');
        distanceLine.style.cssText = 'color:#9ca3af;font-size:10px;margin-top:1px;';

        btn.appendChild(titleLine);
        btn.appendChild(distanceLine);
        btn.addEventListener('mouseenter', () => { btn.style.background = '#1f2937'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
        btn.addEventListener('click', () => this._selectFeature(f));

        item.appendChild(btn);

        const row = { item, button: btn, titleLine, distanceLine, f };
        this._updateRowDistance(row);
        return row;
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
        const { f, titleLine, distanceLine, button } = row;
        const { label, layerTitle } = this._describeFeature(f);
        titleLine.textContent = `${label} — ${layerTitle}`;

        if (!this._userPosition) {
            distanceLine.textContent = 'Location unavailable';
            button.setAttribute('aria-label', `${label} — ${layerTitle}`);
            return;
        }

        const distanceMeters = haversineDistanceMeters(this._userPosition, f.lngLat);
        const bearingDeg = initialBearingDeg(this._userPosition, f.lngLat);
        const distanceText = formatDistance(distanceMeters);
        distanceLine.textContent = `${distanceText} · ${bearingToCompassAbbr(bearingDeg)}`;
        button.setAttribute('aria-label', `${label} — ${layerTitle}, ${distanceText} away, ${bearingToCompassWord(bearingDeg)}`);
    }

    _selectFeature(f) {
        const { label } = this._describeFeature(f);
        this._closePanel();
        this._stateManager.handleFeatureClicks([f]);
        window.featureControl?._markerManager?._openInspectorPanel();
        window.keyboardController?.announceToScreenReader(`Selected ${label}`);
    }

    /**
     * Escape closes the panel; Space/Enter on a focused list button must reach
     * the button's own native activation instead of the global keyboard
     * shortcut for "query feature at map center" (both bind Space). Registered
     * with `capture: true` so it runs — and can stopPropagation — before that
     * bubble-phase document listener in keyboard-controller.js ever sees the key.
     */
    _onKeydown(e) {
        if (!this._panel || !this._isOpen()) return;

        if (e.key === 'Escape') {
            e.stopPropagation();
            this._closePanel();
            return;
        }

        if (e.key === ' ' && this._panel.contains(document.activeElement)) {
            e.stopPropagation();
            return;
        }

        if (e.key === 'Tab') {
            const focusable = this._panel.querySelectorAll('button');
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

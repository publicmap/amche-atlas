/**
 * LocationNavigatorControl - header-nav button (top-left, replacing the old
 * shortcuts menu - see shortcut-menu-base.js) offering one-click navigation
 * to every saved marker on the map, plus a way to drop a new one at the
 * current map center.
 *
 * The menu opens with a heading and helper text, an "Add Location Marker"
 * action, and a "Saved Markers" list (window.featureControl._markerManager's
 * getMarkers()) - each row is labeled by the marker's own `markers=`/badge id
 * (`urlId`, formatted the same way its badge shows it) rather than by
 * feature content, plus its distance and compass bearing from the current
 * map center, computed the same way map-nearby-features-control.js measures
 * its own list (see geo-distance-utils.js). Clicking a row re-centers/fits
 * the map on that marker via MapMarkerManager.focusMarker - the same "jump
 * to a saved marker" action that control's own "Selected Locations" rows use. A sibling options
 * button on each row opens window.shortcutMenu (the same long-press menu the
 * map itself offers - see shortcut-menu.js) for that marker's point.
 *
 * The list (and every row's distance/bearing) is a snapshot taken when the
 * menu opens, not live-updated while it stays open - same as every other
 * flyout built on shortcut-menu-base.js resolving its children fresh "on
 * each open" rather than tracking the map continuously.
 *
 * Not a mapboxgl control - this lives in the header-nav DOM, not on the map.
 */
import { haversineDistanceMeters, initialBearingDeg, formatDistance, bearingToCompassAbbr } from './geo-distance-utils.js';

export class LocationNavigatorControl {
    constructor() {
        this._map = null;
        this._container = null;
        this._button = null;
        this._menu = null;
        this._isOpenState = false;

        this._handleOutsideEvent = this._handleOutsideEvent.bind(this);
        this._handleKeydown = this._handleKeydown.bind(this);
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
        this._button.setAttribute('aria-label', 'Map locations');
        this._button.title = 'Add or navigate to saved map locations';
        this._button.innerHTML = '<sl-icon name="geo"></sl-icon>';
        this._button.addEventListener('click', () => this.toggle());

        this._container.appendChild(this._button);
        hostEl.appendChild(this._container);

        this._menu = document.createElement('div');
        this._menu.className = 'shortcut-menu';
        this._menu.style.display = 'none';
        this._menu.setAttribute('role', 'dialog');
        this._menu.setAttribute('aria-label', 'Map locations');
        document.body.appendChild(this._menu);

        document.addEventListener('mousedown', this._handleOutsideEvent, true);
        document.addEventListener('touchstart', this._handleOutsideEvent, true);
        document.addEventListener('keydown', this._handleKeydown);
        window.addEventListener('resize', this._hide);
        map.on('movestart', this._hide);
        map.on('zoomstart', this._hide);
    }

    unmount() {
        if (this._map) {
            this._map.off('movestart', this._hide);
            this._map.off('zoomstart', this._hide);
        }
        document.removeEventListener('mousedown', this._handleOutsideEvent, true);
        document.removeEventListener('touchstart', this._handleOutsideEvent, true);
        document.removeEventListener('keydown', this._handleKeydown);
        window.removeEventListener('resize', this._hide);

        this._container?.parentNode?.removeChild(this._container);
        this._menu?.parentNode?.removeChild(this._menu);
        this._container = null;
        this._button = null;
        this._menu = null;
        this._map = null;
    }

    toggle() {
        if (this._isOpenState) this._hide();
        else this._open();
    }

    _open() {
        if (!this._map || !this._button || !this._menu) return;
        this._isOpenState = true;
        this._button.classList.add('active');
        this._button.querySelector('sl-icon')?.setAttribute('name', 'geo-fill');

        this._render();

        this._menu.style.display = 'block';
        const rect = this._button.getBoundingClientRect();
        const menuRect = this._menu.getBoundingClientRect();
        const maxLeft = window.innerWidth - menuRect.width - 8;
        this._menu.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
        this._menu.style.top = `${rect.bottom + 4}px`;
    }

    _hide() {
        this._isOpenState = false;
        if (this._menu) this._menu.style.display = 'none';
        this._button?.classList.remove('active');
        this._button?.querySelector('sl-icon')?.setAttribute('name', 'geo');
    }

    _handleOutsideEvent(e) {
        if (!this._isOpenState) return;
        if (this._container?.contains(e.target)) return;
        if (this._menu?.contains(e.target)) return;
        this._hide();
    }

    _handleKeydown(e) {
        if (e.key === 'Escape') this._hide();
    }

    _render() {
        this._menu.innerHTML = '';

        this._menu.appendChild(this._createHeading('geo', 'Map Locations',
            'You can add a new location marker or browse the list of saved ones'));

        this._menu.appendChild(this._createDivider());

        this._menu.appendChild(this._createActionRow('plus-circle', 'Add Location Marker', () => this._addLocationMarker()));

        this._menu.appendChild(this._createDivider());
        this._menu.appendChild(this._createSectionHeading('Saved Markers'));

        const markers = this._getSortedMarkers();
        if (markers.length === 0) {
            this._menu.appendChild(this._createStaticRow('info-circle', 'No saved markers yet'));
        } else {
            markers.forEach(marker => this._menu.appendChild(this._createMarkerRow(marker)));
        }
    }

    /** A two-line heading: an icon-led title plus a helper-text subtext, non-clickable. */
    _createHeading(icon, title, helperText) {
        const row = document.createElement('div');
        row.className = 'shortcut-menu-item shortcut-menu-item-static';

        const iconEl = document.createElement('sl-icon');
        iconEl.setAttribute('name', icon);
        row.appendChild(iconEl);

        const text = document.createElement('div');
        text.className = 'shortcut-menu-item-text';
        const label = document.createElement('span');
        label.className = 'shortcut-menu-item-label';
        label.textContent = title;
        const subtext = document.createElement('span');
        subtext.className = 'shortcut-menu-item-subtext';
        subtext.textContent = helperText;
        text.appendChild(label);
        text.appendChild(subtext);
        row.appendChild(text);

        return row;
    }

    /** A plain section label, e.g. "Saved Markers" above the marker list. */
    _createSectionHeading(text) {
        const row = document.createElement('div');
        row.className = 'shortcut-menu-item shortcut-menu-item-static';
        const span = document.createElement('span');
        span.textContent = text;
        row.appendChild(span);
        return row;
    }

    /** A non-clickable single-line row, e.g. the empty-list message. */
    _createStaticRow(icon, text) {
        const row = document.createElement('div');
        row.className = 'shortcut-menu-item shortcut-menu-item-static';
        const iconEl = document.createElement('sl-icon');
        iconEl.setAttribute('name', icon);
        row.appendChild(iconEl);
        const span = document.createElement('span');
        span.textContent = text;
        row.appendChild(span);
        return row;
    }

    _createDivider() {
        const divider = document.createElement('div');
        divider.className = 'shortcut-menu-divider';
        return divider;
    }

    _createActionRow(icon, label, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shortcut-menu-item';
        const iconEl = document.createElement('sl-icon');
        iconEl.setAttribute('name', icon);
        button.appendChild(iconEl);
        const span = document.createElement('span');
        span.textContent = label;
        button.appendChild(span);
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return button;
    }

    /**
     * Drops a new, feature-less marker at the current map center - the
     * header-nav equivalent of pressing the middle of the map - then
     * refreshes the list so it shows up immediately without closing the menu.
     */
    _addLocationMarker() {
        const markerManager = window.featureControl?._markerManager;
        if (!markerManager || !this._map) return;
        markerManager.addMarker(this._map.getCenter(), []);
        this._render();
    }

    /** Saved markers with their distance/bearing from the current map center, nearest first. */
    _getSortedMarkers() {
        const markers = window.featureControl?._markerManager?.getMarkers() || [];
        const origin = this._map.getCenter();
        return markers
            .map(m => ({ ...m, _distanceMeters: haversineDistanceMeters(origin, m.lngLat) }))
            .sort((a, b) => a._distanceMeters - b._distanceMeters);
    }

    /**
     * The marker's own `markers=`/badge id (see MapMarkerManager's `urlId`),
     * formatted the same way its badge shows it - underscores as spaces -
     * rather than the feature-based label the map-nearby-features-control.js
     * list uses.
     */
    _idLabel(marker) {
        return String(marker.urlId ?? marker.id ?? '').replace(/_/g, ' ');
    }

    /**
     * A row for one saved marker: a primary button (id, distance + bearing)
     * that jumps to it, plus a sibling options button that opens the same
     * long-press shortcut menu the map itself offers for that point (see
     * shortcut-menu.js) - two separate buttons rather than one nested in the
     * other (see the `.shortcut-menu-row` / `.shortcut-menu-row-actions` CSS),
     * so both stay independently reachable by tab/swipe.
     */
    _createMarkerRow(marker) {
        const row = document.createElement('div');
        row.className = 'shortcut-menu-row';
        row.appendChild(this._createMarkerNavigateButton(marker));
        row.appendChild(this._createMarkerOptionsButton(marker));
        return row;
    }

    _createMarkerNavigateButton(marker) {
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
        label.textContent = this._idLabel(marker);
        const subtext = document.createElement('span');
        subtext.className = 'shortcut-menu-item-subtext';
        const bearingDeg = initialBearingDeg(this._map.getCenter(), marker.lngLat);
        subtext.textContent = `${formatDistance(marker._distanceMeters)} · ${bearingToCompassAbbr(bearingDeg)}`;
        text.appendChild(label);
        text.appendChild(subtext);
        button.appendChild(text);

        button.setAttribute('aria-label', `${label.textContent}, ${subtext.textContent}. Navigate to this marker`);
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            window.featureControl?._markerManager?.focusMarker(marker.id);
            this._hide();
        });

        return button;
    }

    /**
     * Opens window.shortcutMenu (the same instance the map's own long-press
     * opens - see shortcut-menu.js) for this marker's point, anchored to the
     * click - the identical wiring map-marker-manager.js's own per-marker
     * options button uses (see its `openShortcuts` handler), just triggered
     * from this list instead of the marker's balloon.
     */
    _createMarkerOptionsButton(marker) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shortcut-menu-item shortcut-menu-row-actions';
        button.title = 'Options for this point';
        button.setAttribute('aria-label', `Options for ${this._idLabel(marker)}`);
        button.innerHTML = '<sl-icon name="three-dots-vertical"></sl-icon>';

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!window.shortcutMenu) return;
            window.shortcutMenu._lngLat = marker.lngLat;
            window.shortcutMenu._show(e.clientX, e.clientY);
            this._hide();
        });

        return button;
    }
}

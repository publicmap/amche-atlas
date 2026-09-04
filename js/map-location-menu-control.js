/**
 * MapLocationMenuControl - header-nav button (top-left, next to the shortcuts
 * menu) showing live context about the current map center: coordinates, map
 * bearing, device bearing, map pitch, the reverse-geocoded address, and a
 * share section (QR thumbnail + link with a copy button) for the current view.
 *
 * The address is read from window.attributionControl (see
 * map-attribution-control.js `setLocation()` / map-init.js
 * `updateAttributionLocation()`) rather than issued as a fresh Nominatim
 * request here - that reverse geocode already runs on every `moveend`, so
 * this menu just reuses its latest result.
 *
 * Each present address component (road, neighbourhood, city, state,
 * country, ...) is offered as a submenu item, labelled with its category
 * (Street, City, State, ...) as subtext. Hovering one previews its bounding
 * box on the map; clicking forward-geocodes that component (scoped to its
 * parents, e.g. "Panaji, Goa, India") via nominatim-search.js and flies the
 * map there. Both hover and click share one geocode (and its cache), so
 * hovering before clicking doesn't cost a second request.
 *
 * The share section is rendered by share-url-panel.js, which also owns the
 * fullscreen QR modal opened by clicking the thumbnail - the same UI that used
 * to be the "Link" export type in map-export.html.
 *
 * Not a mapboxgl control - this lives in the header-nav DOM, not on the map.
 */
import { queryNominatim } from './nominatim-search.js';
import { ShareUrlPanel } from './share-url-panel.js';

// Ordered broad-to-specific is not needed here - this is specific-to-broad,
// matching how a submenu should read (nearest place first). Each level's
// `zoom` is the fallback camera zoom used when Nominatim returns no bounding
// box for that place; `category` is the subtext shown under its value.
const ADDRESS_LEVELS = [
    { keys: ['road', 'pedestrian', 'cycleway', 'footway'], zoom: 16, category: 'Street' },
    { keys: ['neighbourhood', 'suburb', 'quarter'], zoom: 14, category: 'Neighbourhood' },
    { keys: ['village', 'town', 'city', 'city_district'], zoom: 12, category: 'City' },
    { keys: ['county', 'state_district'], zoom: 9, category: 'District' },
    { keys: ['state', 'region'], zoom: 7, category: 'State' },
    { keys: ['country'], zoom: 5, category: 'Country' }
];
const ADDRESS_KEY_ORDER = ADDRESS_LEVELS.flatMap(level => level.keys);

const LIVE_REFRESH_MS = 500;
const HOVER_PREVIEW_DEBOUNCE_MS = 150;
const HOVER_BBOX_SOURCE = '_map-location-hover-bbox';
const HOVER_BBOX_FILL_LAYER = '_map-location-hover-bbox-fill';
const HOVER_BBOX_LINE_LAYER = '_map-location-hover-bbox-line';

export class MapLocationMenuControl {
    constructor() {
        this._map = null;
        this._container = null;
        this._button = null;
        this._menu = null;
        this._submenu = null;
        this._isOpenState = false;
        this._refreshTimer = null;
        this._liveRows = {};

        // query string -> resolved Nominatim feature (or null), shared by
        // hover preview and click-to-navigate so hovering a part before
        // clicking it doesn't issue a second request.
        this._geocodeCache = new Map();
        this._hoverDebounceTimer = null;
        this._hoverRequestToken = 0;

        this._sharePanel = new ShareUrlPanel();

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
        this._button.setAttribute('aria-label', 'Map location and share');
        this._button.innerHTML = '<sl-icon name="qr-code"></sl-icon>';
        this._button.addEventListener('click', () => this.toggle());

        this._container.appendChild(this._button);
        hostEl.appendChild(this._container);

        this._menu = document.createElement('div');
        this._menu.className = 'shortcut-menu map-location-menu';
        this._menu.style.display = 'none';
        document.body.appendChild(this._menu);

        this._submenu = document.createElement('div');
        this._submenu.className = 'shortcut-menu shortcut-submenu';
        this._submenu.style.display = 'none';
        document.body.appendChild(this._submenu);

        document.addEventListener('mousedown', this._handleOutsideEvent, true);
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
        document.removeEventListener('keydown', this._handleKeydown);
        window.removeEventListener('resize', this._hide);

        this._clearRefreshTimer();
        this._clearHoverPreview();
        this._sharePanel.destroy();
        this._container?.parentNode?.removeChild(this._container);
        this._menu?.parentNode?.removeChild(this._menu);
        this._submenu?.parentNode?.removeChild(this._submenu);
        this._container = null;
        this._button = null;
        this._menu = null;
        this._submenu = null;
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
        this._button.querySelector('sl-icon')?.setAttribute('name', 'qr-code-scan');

        this._render();

        this._menu.style.display = 'block';
        const rect = this._button.getBoundingClientRect();
        const menuRect = this._menu.getBoundingClientRect();
        const maxLeft = window.innerWidth - menuRect.width - 8;
        this._menu.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
        this._menu.style.top = `${rect.bottom + 4}px`;

        this._clearRefreshTimer();
        this._refreshTimer = setInterval(() => this._refreshLiveValues(), LIVE_REFRESH_MS);
    }

    _hide() {
        this._isOpenState = false;
        if (this._menu) this._menu.style.display = 'none';
        if (this._submenu) {
            this._submenu.style.display = 'none';
            this._submenu.innerHTML = '';
        }
        this._button?.classList.remove('active');
        this._button?.querySelector('sl-icon')?.setAttribute('name', 'qr-code');
        this._clearRefreshTimer();
        this._clearHoverPreview();
    }

    _clearRefreshTimer() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    }

    _handleOutsideEvent(e) {
        if (!this._isOpenState) return;
        if (this._container?.contains(e.target)) return;
        if (this._menu?.contains(e.target)) return;
        if (this._submenu?.contains(e.target)) return;
        this._hide();
    }

    _handleKeydown(e) {
        if (e.key === 'Escape') this._hide();
    }

    /**
     * Appends one info/action row. Rows with neither `onClick` nor `children`
     * are plain readouts (coordinates, bearing, pitch) - not clickable, and
     * styled to not look like they are (see `.shortcut-menu-item-static` in
     * css/styles.css).
     */
    _addRow(container, { icon, label, title, rowKey, onClick, children }) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'shortcut-menu-item';
        if (title) row.title = title;

        const iconEl = document.createElement('sl-icon');
        iconEl.setAttribute('name', icon);
        row.appendChild(iconEl);

        const span = document.createElement('span');
        span.textContent = label;
        row.appendChild(span);
        if (rowKey) this._liveRows[rowKey] = span;

        if (children) {
            const chevron = document.createElement('sl-icon');
            chevron.className = 'shortcut-menu-chevron';
            chevron.setAttribute('name', 'chevron-right');
            row.appendChild(chevron);
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                this._showAddressSubmenu(row, children);
            });
        } else if (onClick) {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                onClick();
                this._hide();
            });
        } else {
            row.classList.add('shortcut-menu-item-static');
        }

        container.appendChild(row);
        return row;
    }

    _render() {
        this._liveRows = {};
        this._menu.innerHTML = '';
        this._submenu.style.display = 'none';
        this._submenu.innerHTML = '';

        const center = this._map.getCenter();
        const bearing = this._normalizeBearing(this._map.getBearing());
        const pitch = this._map.getPitch();
        const deviceBearing = window.geolocationControl?.deviceBearing;

        this._renderShare();

        this._addRow(this._menu, { icon: 'geo-alt', label: this._formatCoords(center), rowKey: 'coords' });
        this._addRow(this._menu, { icon: 'compass', label: `Map bearing: ${Math.round(bearing)}°`, rowKey: 'mapBearing' });
        this._addRow(this._menu, { icon: 'phone-landscape', label: this._formatDeviceBearing(deviceBearing), rowKey: 'deviceBearing' });
        this._addRow(this._menu, { icon: 'arrows-angle-contract', label: `Map pitch: ${Math.round(pitch)}°`, rowKey: 'pitch' });

        const divider = document.createElement('div');
        divider.className = 'shortcut-menu-divider';
        this._menu.appendChild(divider);

        this._renderAddress();
    }

    /**
     * QR thumbnail + share URL for the current view. Clicking the thumbnail
     * opens the fullscreen QR modal (share-url-panel.js) and closes this menu.
     */
    _renderShare() {
        this._menu.appendChild(this._sharePanel.buildInlineSection({
            onOpenModal: () => this._hide()
        }));

        const divider = document.createElement('div');
        divider.className = 'shortcut-menu-divider';
        this._menu.appendChild(divider);
    }

    _renderAddress() {
        const locationName = window.attributionControl?._locationName;
        const address = window.attributionControl?._address;
        const fullAddress = locationName || 'Address unavailable';

        if (!address) {
            this._addRow(this._menu, { icon: 'signpost', label: `Address: ${this._truncate(fullAddress)}`, title: fullAddress });
            return;
        }

        const parts = ADDRESS_LEVELS
            .map(level => {
                const key = level.keys.find(k => address[k]);
                return key ? { key, value: address[key], zoom: level.zoom, category: level.category } : null;
            })
            .filter(Boolean)
            // Different admin levels sometimes share the same name (e.g. a
            // city's suburb named after the city itself) - only the first,
            // most-specific one is worth offering as its own submenu item.
            .filter((part, i, arr) => arr.findIndex(p => p.value === part.value) === i);

        this._addRow(this._menu, {
            icon: 'signpost',
            label: `Address: ${this._truncate(locationName || parts.map(p => p.value).join(', ') || 'unavailable')}`,
            title: fullAddress,
            children: parts
        });
    }

    _truncate(str, maxLen = 36) {
        if (!str || str.length <= maxLen) return str;
        return `${str.slice(0, maxLen - 1).trimEnd()}…`;
    }

    _showAddressSubmenu(anchorButton, parts) {
        this._submenu.innerHTML = '';

        parts.forEach(part => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'shortcut-menu-item';

            const iconEl = document.createElement('sl-icon');
            iconEl.setAttribute('name', 'geo');
            row.appendChild(iconEl);

            const text = document.createElement('div');
            text.className = 'shortcut-menu-item-text';

            const label = document.createElement('span');
            label.className = 'shortcut-menu-item-label';
            label.textContent = part.value;
            text.appendChild(label);

            const subtext = document.createElement('span');
            subtext.className = 'shortcut-menu-item-subtext';
            subtext.textContent = part.category;
            text.appendChild(subtext);

            row.appendChild(text);

            row.addEventListener('mouseenter', () => this._previewAddressPartBbox(part));
            row.addEventListener('mouseleave', () => this._clearHoverPreview());
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                this._navigateToAddressPart(part);
                this._hide();
            });

            this._submenu.appendChild(row);
        });

        const divider = document.createElement('div');
        divider.className = 'shortcut-menu-divider';
        this._submenu.appendChild(divider);
        this._submenu.appendChild(this._buildOsmEditRow());

        this._submenu.style.display = 'block';
        const anchorRect = anchorButton.getBoundingClientRect();
        const submenuRect = this._submenu.getBoundingClientRect();

        let left = anchorRect.right + 4;
        if (left + submenuRect.width > window.innerWidth - 8) {
            left = anchorRect.left - submenuRect.width - 4;
        }
        const maxTop = window.innerHeight - submenuRect.height - 8;
        this._submenu.style.left = `${Math.max(8, left)}px`;
        this._submenu.style.top = `${Math.max(8, Math.min(anchorRect.top, maxTop))}px`;
    }

    /**
     * Same OSM logo + link as the attribution control's location link (see
     * `_ensureLocationLinkEl`/`_updateLocationLinkEl` in
     * map-attribution-control.js) - an actual <a> (not a button) so it opens
     * like a normal link, built fresh from the current map center/zoom.
     */
    _buildOsmEditRow() {
        const link = document.createElement('a');
        link.className = 'shortcut-menu-item';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = 'Edit on the OpenStreetMap Project';

        const center = this._map.getCenter();
        const zoom = this._map.getZoom();
        const lat = center.lat.toFixed(6);
        const lng = center.lng.toFixed(6);
        const zoomRounded = Math.round(zoom);
        link.href = `https://www.openstreetmap.org/search?lat=${lat}&lon=${lng}&zoom=${zoomRounded}`;

        const img = document.createElement('img');
        img.className = 'shortcut-menu-icon-img';
        img.src = 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Openstreetmap_logo.svg';
        img.alt = 'OSM';
        link.appendChild(img);

        const span = document.createElement('span');
        span.textContent = 'Edit location on OpenStreetMap';
        link.appendChild(span);

        link.addEventListener('click', () => this._hide());
        return link;
    }

    /**
     * Forward-geocodes `part` scoped to its own parent components (e.g.
     * "Panaji, Goa, India" rather than bare "Panaji") so the result resolves
     * to the right place rather than the nearest same-named one elsewhere.
     * Cached by query so hover-preview and click share one request.
     */
    async _geocodeAddressPart(part) {
        const address = window.attributionControl?._address;
        if (!address) return null;

        const startIndex = ADDRESS_KEY_ORDER.indexOf(part.key);
        const query = ADDRESS_KEY_ORDER
            .slice(startIndex)
            .map(k => address[k])
            .filter(Boolean)
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .join(', ');
        if (!query) return null;

        if (this._geocodeCache.has(query)) return this._geocodeCache.get(query);

        try {
            const results = await queryNominatim(query, { countrycodes: address.country_code || 'in', limit: 1 });
            const feature = results[0] || null;
            this._geocodeCache.set(query, feature);
            return feature;
        } catch (error) {
            console.debug('[MapLocationMenuControl] Failed to geocode address part:', error);
            return null;
        }
    }

    /**
     * Flies the map to `part` - fitting its bounding box when Nominatim
     * returns one, otherwise centering at that level's fallback zoom.
     */
    async _navigateToAddressPart(part) {
        if (!this._map) return;
        const feature = await this._geocodeAddressPart(part);
        if (!feature) return;

        const bbox = feature.properties._boundingbox;
        if (bbox) {
            // Nominatim boundingbox = [minLat, maxLat, minLon, maxLon]
            this._map.fitBounds(
                [[bbox[2], bbox[0]], [bbox[3], bbox[1]]],
                { padding: 40, duration: 800 }
            );
        } else {
            this._map.flyTo({ center: feature.geometry.coordinates, zoom: part.zoom, duration: 800 });
        }
    }

    /**
     * Debounced hover preview: geocodes `part` (reusing the cache) and, if it
     * has a bounding box, draws it on the map. `_hoverRequestToken` guards
     * against a slow fetch for a part the pointer has already left resolving
     * after a newer hover (or hover-out) has taken over.
     */
    _previewAddressPartBbox(part) {
        clearTimeout(this._hoverDebounceTimer);
        const token = ++this._hoverRequestToken;

        this._hoverDebounceTimer = setTimeout(async () => {
            const feature = await this._geocodeAddressPart(part);
            if (token !== this._hoverRequestToken) return;
            this._drawHoverBbox(feature?.properties?._boundingbox);
        }, HOVER_PREVIEW_DEBOUNCE_MS);
    }

    _clearHoverPreview() {
        clearTimeout(this._hoverDebounceTimer);
        this._hoverDebounceTimer = null;
        this._hoverRequestToken++;
        this._drawHoverBbox(null);
    }

    _drawHoverBbox(bbox) {
        if (!this._map) return;

        if (!bbox) {
            if (this._map.getLayer(HOVER_BBOX_FILL_LAYER)) this._map.removeLayer(HOVER_BBOX_FILL_LAYER);
            if (this._map.getLayer(HOVER_BBOX_LINE_LAYER)) this._map.removeLayer(HOVER_BBOX_LINE_LAYER);
            if (this._map.getSource(HOVER_BBOX_SOURCE)) this._map.removeSource(HOVER_BBOX_SOURCE);
            return;
        }

        const [minLat, maxLat, minLon, maxLon] = bbox;
        const polygon = {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [minLon, minLat],
                    [maxLon, minLat],
                    [maxLon, maxLat],
                    [minLon, maxLat],
                    [minLon, minLat]
                ]]
            }
        };

        if (this._map.getSource(HOVER_BBOX_SOURCE)) {
            this._map.getSource(HOVER_BBOX_SOURCE).setData(polygon);
        } else {
            this._map.addSource(HOVER_BBOX_SOURCE, { type: 'geojson', data: polygon });
            this._map.addLayer({
                id: HOVER_BBOX_FILL_LAYER,
                type: 'fill',
                source: HOVER_BBOX_SOURCE,
                paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.15 }
            });
            this._map.addLayer({
                id: HOVER_BBOX_LINE_LAYER,
                type: 'line',
                source: HOVER_BBOX_SOURCE,
                paint: { 'line-color': '#3b82f6', 'line-width': 2 }
            });
        }
    }

    _refreshLiveValues() {
        if (!this._isOpenState || !this._map) return;

        const center = this._map.getCenter();
        const bearing = this._normalizeBearing(this._map.getBearing());
        const pitch = this._map.getPitch();
        const deviceBearing = window.geolocationControl?.deviceBearing;

        if (this._liveRows.coords) this._liveRows.coords.textContent = this._formatCoords(center);
        if (this._liveRows.mapBearing) this._liveRows.mapBearing.textContent = `Map bearing: ${Math.round(bearing)}°`;
        if (this._liveRows.deviceBearing) this._liveRows.deviceBearing.textContent = this._formatDeviceBearing(deviceBearing);
        if (this._liveRows.pitch) this._liveRows.pitch.textContent = `Map pitch: ${Math.round(pitch)}°`;

        this._sharePanel.refresh();
    }

    _formatCoords(center) {
        return `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
    }

    _formatDeviceBearing(deviceBearing) {
        return `Device bearing: ${deviceBearing != null ? Math.round(deviceBearing) + '°' : '—'}`;
    }

    _normalizeBearing(bearing) {
        return ((bearing % 360) + 360) % 360;
    }
}

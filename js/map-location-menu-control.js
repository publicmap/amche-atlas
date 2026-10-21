/**
 * MapLocationMenuControl - the place menu, opened from the map console's
 * place line and styled as part of the console (css/map-console.css):
 *
 * - "Current location", in three tabs (js/location-tabs.js):
 *   - "Address": the reverse-geocoded address (js/location-address.js)
 *     as a breadcrumb of admin areas, then the rest of the address and the
 *     postcode. Every part is a button: hovering previews its extent on the
 *     map, clicking flies there. The menu stays open while the map moves - it
 *     closes from the place line, Esc, or a click on other UI - and the
 *     address follows the map. Under it, beside the OSM
 *     credit, the languages it is in (js/location-language.js).
 *   - "Map view": the camera and the 3D terrain, each value dragged to
 *     change it (js/location-view.js); the tools rail's 3D button opens it.
 *   - "Locate Me": a tab that is also the trigger - selecting it centres the
 *     map on the device - with the device's GPS fix and its track log
 *     (js/location-device.js, js/gpx-log.js).
 * - Under the address, its OpenStreetMap credit (js/location-osm.js). Each
 *   address part shows its OSM icon on hover and while it is the current
 *   level; it opens the OSM data explorer on that part's object.
 *
 * The address is read from window.attributionControl (see
 * map-attribution-control.js `setLocation()` / map-init.js
 * `updateAttributionLocation()`) rather than issued as a fresh reverse geocode
 * here - that already runs on every `moveend`. Opening the menu makes one
 * Nominatim details request for the OSM objects behind the address parts, so
 * a part with one is located by that object, and any other part by a forward
 * geocode of its name scoped to its parents ("Panaji, Goa, India"). Hover and
 * click share one lookup (and its cache).
 *
 * Sharing the view, its history and links to other maps are in the Share
 * panel (js/share-view-panel.js); opening one closes the other.
 *
 * Not a mapboxgl control of its own - it lives in the map console's bar.
 */
import { queryNominatim, lookupNominatimPlaces, fetchNominatimAddressParts } from './nominatim-search.js';
import { activePart, buildAddressBlock, linkOsmObjects, nearestOnLine } from './location-address.js';
import { directionTo, drawHoverPreview } from './location-hover.js';
import { buildOsmFooter, showOsmDialog } from './location-osm.js';
import { buildTabs } from './location-tabs.js';
import { buildLanguageControl } from './location-language.js';
import { buildDevicePanel } from './location-device.js';
import { buildViewPanel } from './location-view.js';

const LIVE_REFRESH_MS = 500;
// A movestart this soon after a pick is the pick's own camera move.
const OWN_MOVE_MS = 300;
const HOVER_PREVIEW_DEBOUNCE_MS = 150;

function extent(osmType, bbox) {
    return ['way', 'relation', 'W', 'R'].includes(osmType) ? bbox : null;
}

export class MapLocationMenuControl {
    constructor() {
        this._map = null;
        this._container = null;
        this._button = null;
        this._menu = null;
        this._isOpenState = false;
        this._refreshTimer = null;

        // part query -> {center, bbox} (or null), shared by hover preview and
        // click-to-navigate so hovering a part before clicking it doesn't
        // issue a second request.
        this._placeCache = new Map();
        this._hoverDebounceTimer = null;
        this._hoverRequestToken = 0;
        this._renderToken = 0;
        this._locationTab = 'address';

        this._handleOutsideEvent = this._handleOutsideEvent.bind(this);
        this._handleKeydown = this._handleKeydown.bind(this);
        this._hide = this._hide.bind(this);
        this._handleLocationChanged = () => {
            if (this._isOpenState) this._renderAddress();
        };
        // A pick's own camera move keeps its trail; any other move ends it.
        this._handleMoveStart = () => {
            if (performance.now() - (this._ownMoveAt || 0) < OWN_MOVE_MS) return;
            if (!this._trail) return;
            this._trail = null;
            if (this._isOpenState) this._renderAddress();
        };
    }

    /**
     * @param {HTMLElement|null} hostEl - where to put this control's own button
     * @param {Object} map
     * @param {{button?: HTMLElement}} [options] - an existing trigger to use
     *   instead (the map console's place line), in which case hostEl is unused
     */
    mount(hostEl, map, { button = null } = {}) {
        if ((!hostEl && !button) || !map) return;
        this._map = map;

        if (button) {
            this._button = button;
            this._ownButton = false;
        } else {
            this._container = document.createElement('div');
            this._container.className = 'header-shortcut-menu';
            this._button = document.createElement('button');
            this._button.type = 'button';
            this._button.className = 'header-shortcut-menu-btn';
            this._button.setAttribute('aria-label', 'Map location and share');
            this._button.innerHTML = '<sl-icon name="qr-code"></sl-icon>';
            this._ownButton = true;
            this._container.appendChild(this._button);
            hostEl.appendChild(this._container);
        }
        this._button.addEventListener('click', () => this.toggle());

        this._menu = document.createElement('div');
        this._menu.className = 'map-location-menu';
        this._menu.setAttribute('role', 'dialog');
        this._menu.setAttribute('aria-label', 'Current location');
        this._menu.style.display = 'none';
        document.body.appendChild(this._menu);

        document.addEventListener('mousedown', this._handleOutsideEvent, true);
        document.addEventListener('keydown', this._handleKeydown);
        window.addEventListener('resize', this._hide);
        window.addEventListener('mapLocationChanged', this._handleLocationChanged);
        map.on('movestart', this._handleMoveStart);
    }

    unmount() {
        window.removeEventListener('mapLocationChanged', this._handleLocationChanged);
        this._map?.off('movestart', this._handleMoveStart);
        document.removeEventListener('mousedown', this._handleOutsideEvent, true);
        document.removeEventListener('keydown', this._handleKeydown);
        window.removeEventListener('resize', this._hide);

        this._clearRefreshTimer();
        this._clearHoverPreview();
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

    /** Opens the menu on one of the Current location tabs ('address', 'view', 'locate'). */
    openTab(id) {
        this._locationTab = id;
        if (this._isOpenState) this._render();
        else this._open();
    }

    /** The console's status icons: open the menu on a tab, or close it when it is already showing. */
    toggleTab(id) {
        if (this._isOpenState && this._locationTab === id) this._hide();
        else this.openTab(id);
    }

    close() {
        if (this._isOpenState) this._hide();
    }

    _open() {
        if (!this._map || !this._button || !this._menu) return;
        window.shareViewPanel?.close();
        this._isOpenState = true;
        this._button.classList.add('active');
        if (this._ownButton) this._button.querySelector('sl-icon')?.setAttribute('name', 'qr-code-scan');

        this._render();

        // Hangs under the console card it is opened from, at the same width.
        const anchor = this._button.closest('.map-console') || this._button;
        const rect = anchor.getBoundingClientRect();
        this._menu.style.display = 'block';
        this._menu.style.width = anchor === this._button ? '' : `${rect.width}px`;
        const maxLeft = window.innerWidth - this._menu.getBoundingClientRect().width - 8;
        this._menu.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
        this._menu.style.top = `${rect.bottom + 8}px`;

        this._clearRefreshTimer();
        this._refreshTimer = setInterval(() => this._refreshLiveValues(), LIVE_REFRESH_MS);
    }

    _hide() {
        this._isOpenState = false;
        if (this._menu) this._menu.style.display = 'none';
        this._button?.classList.remove('active');
        if (this._ownButton) this._button?.querySelector('sl-icon')?.setAttribute('name', 'qr-code');
        this._clearRefreshTimer();
        this._clearHoverPreview();
        this._language?.destroy();
        this._language = null;
        this._device?.destroy();
        this._device = null;
        this._view?.destroy();
        this._view = null;
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
        if (this._button?.contains(e.target)) return;
        if (e.target.closest?.('.map-console-status')) return;
        if (this._menu?.contains(e.target)) return;
        // The language fields' suggestions open in <body>, outside the menu.
        if (e.target.closest?.('.ac-badge-input-list')) return;
        // Stays open while the map is panned or zoomed under it.
        if (this._map?.getCanvasContainer().contains(e.target)) return;
        this._hide();
    }

    _handleKeydown(e) {
        // Escape in a language field leaves the field, not the menu.
        if (e.key === 'Escape' && !e.target.closest?.('.ac-badge-input')) this._hide();
    }

    _section(label) {
        const section = document.createElement('section');
        section.className = 'place-section';
        if (label) {
            const heading = document.createElement('div');
            heading.className = 'place-label';
            heading.textContent = label;
            section.appendChild(heading);
        }
        this._menu.appendChild(section);
        return section;
    }

    _render() {
        this._menu.innerHTML = '';
        this._language?.destroy();
        this._device?.destroy();
        this._view?.destroy();

        const location = this._section(' ');
        const label = location.querySelector('.place-label');
        label.textContent = '';
        label.setAttribute('aria-label', 'Current location');
        const panels = buildTabs(location, [
            { id: 'address', label: 'Address', icon: 'geo-alt' },
            { id: 'view', label: 'Map view', icon: 'badge-3d' },
            { id: 'locate', label: 'Locate Me', icon: 'crosshair' }
        ], this._locationTab, (id) => {
            this._locationTab = id;
            this._clearHoverPreview();
        }, label);
        this._bindLocateTab(label.querySelector('#place-tab-locate'));
        this._device = buildDevicePanel(panels.locate, this._map);
        this._addressSection = panels.address;
        this._osmFooter = this._addressSection.appendChild(buildOsmFooter());
        this._language = buildLanguageControl();
        this._osmFooter.appendChild(this._language.toggle);
        this._addressSection.appendChild(this._language.panel);
        this._renderAddress();

        this._view = buildViewPanel(panels.view, this._map);
    }

    // Clicking the Locate Me tab also locks the camera onto the device's
    // position (starting GPS if needed); while it is locked the tab says so.
    _bindLocateTab(button) {
        button.classList.add('place-locate');
        button.addEventListener('click', () => {
            window.geolocationControl?.locate();
            this._updateLocateButton();
        });
        this._locate = { button, label: button.querySelector('.place-tab-text') };
        this._updateLocateButton();
    }

    _updateLocateButton() {
        if (!this._locate) return;
        const locked = !!window.geolocationControl?.isLockedToLocation;
        this._locate.button.classList.toggle('active', locked);
        this._locate.label.textContent = locked ? 'Tracking' : 'Locate Me';
        this._locate.button.title = locked ? 'The map is following your location' : 'Centre the map on where you are';
    }

    // The address block, redrawn in place as the map moves under the open menu.
    //
    // After a part is picked the address it was picked from stays up, with the
    // parts inside it muted but still there to step back into, until the map
    // is moved by anything other than a pick (see _handleMoveStart).
    _renderAddress() {
        const section = this._addressSection;
        if (!section) return;
        const token = ++this._renderToken;
        const attribution = window.attributionControl;
        const trail = this._trail;
        const address = trail ? trail.address : attribution?._address || null;
        const place = trail ? trail.place : attribution?._place || null;
        const { el, parts } = buildAddressBlock(address, attribution?._locationName, {
            onPreview: (part) => this._previewPart(part),
            onClearPreview: () => this._clearHoverPreview(),
            onPick: (part) => {
                this._clearHoverPreview();
                this._trail = { address, place, rank: part.rank, origin: this._origin() };
                this._renderAddress();
                this._navigateToPart(part);
            }
        }, place);
        if (trail) parts.forEach(part => part.el?.classList.toggle('is-muted', part.rank > trail.rank));
        const active = trail ? parts.find(part => part.rank === trail.rank) : activePart(parts, this._map?.getZoom() ?? 0);
        if (active?.el) {
            active.el.classList.add('is-active');
            active.el.querySelector('.place-part-btn')?.setAttribute('aria-current', 'location');
        }
        section.querySelector('.place-address')?.remove();
        section.insertBefore(el, this._osmFooter);
        if (place && parts.length) {
            fetchNominatimAddressParts(place.osmType, place.osmId)
                .then(osmParts => { if (token === this._renderToken) linkOsmObjects(parts, osmParts, (part) => this._openOsm(part)); })
                .catch(error => console.debug('[MapLocationMenuControl] No OSM objects for the address:', error));
        }
    }

    // The OSM data explorer for a part's object; it replaces the menu.
    _openOsm(part) {
        const center = this._map.getCenter();
        const context = {
            view: { lat: center.lat, lng: center.lng, zoom: this._map.getZoom() },
            country: window.attributionControl?._address?.country || null
        };
        this._hide();
        showOsmDialog(context, { ...part.osm, name: part.value });
    }

    _refreshLiveValues() {
        if (!this._isOpenState || !this._map) return;
        this._updateLocateButton();
        this._device?.refresh();
        this._view?.refresh();
    }

    /**
     * Where a part is: by its OSM object when the details request named one,
     * otherwise by forward-geocoding its scoped name. Returns
     * {center: [lng, lat], bbox: [minLat, maxLat, minLon, maxLon]|null} or null.
     * Only ways and relations keep their box: for a point (a place node) or a
     * postcode Nominatim makes one up from the place type. The object the view
     * matched (a road, a house) is pointed at where the reverse geocode met it,
     * the nearest point to the view, rather than at its centroid; a road above
     * it (the street a house is on) at the point of its line nearest to that.
     */
    async _locatePart(part) {
        const located = await this._lookupPart(part);
        const place = this._trail ? this._trail.place : window.attributionControl?._place;
        if (!located || !part.osm || !place || !Number.isFinite(place.lat)) return located;
        const matched = String(part.osm.osmType) === String(place.osmType) && String(part.osm.osmId) === String(place.osmId);
        const center = matched ? [place.lon, place.lat] : nearestOnLine(located.geometry, [place.lon, place.lat]);
        return center ? { ...located, center } : located;
    }

    async _lookupPart(part) {
        const key = part.osm ? `${part.osm.osmType}/${part.osm.osmId}` : part.query;
        if (!key) return null;
        if (this._placeCache.has(key)) return this._placeCache.get(key);
        let located = null;
        try {
            if (part.osm) {
                const places = await lookupNominatimPlaces([part.osm], { geometry: part.key === 'road' });
                const found = places.values().next().value;
                if (found) located = { center: [found.lon, found.lat], bbox: extent(found.osmType, found.boundingbox), geometry: found.geojson };
            }
            if (!located) {
                const address = window.attributionControl?._address;
                const [feature] = await queryNominatim(part.query, { countrycodes: address?.country_code || 'in', limit: 1 });
                if (feature) located = { center: feature.geometry.coordinates, bbox: extent(feature.properties._osmType, feature.properties._boundingbox) };
            }
        } catch (error) {
            console.debug('[MapLocationMenuControl] Failed to locate address part:', error);
        }
        this._placeCache.set(key, located);
        return located;
    }

    async _navigateToPart(part) {
        if (!this._map) return;
        const located = await this._locatePart(part);
        if (!located) return;
        this._ownMoveAt = performance.now();
        const bbox = located.bbox;
        if (bbox) {
            // Nominatim boundingbox = [minLat, maxLat, minLon, maxLon]
            this._map.fitBounds([[bbox[2], bbox[0]], [bbox[3], bbox[1]]], { padding: 40, duration: 800, maxZoom: 18 });
            // A street then centres on its point nearest the view, at the zoom
            // that showed all of it - unless the map was moved meanwhile.
            if (located.geometry) {
                const trail = this._trail;
                this._map.once('moveend', () => {
                    if (this._trail !== trail) return;
                    this._ownMoveAt = performance.now();
                    this._map.easeTo({ center: located.center, duration: 600 });
                });
            }
        } else {
            this._map.flyTo({ center: located.center, zoom: part.zoom, duration: 800 });
        }
    }

    /**
     * Debounced hover preview of a part's extent. `_hoverRequestToken` guards
     * against a slow lookup for a part the pointer has already left resolving
     * after a newer hover (or hover-out) has taken over.
     */
    _previewPart(part) {
        clearTimeout(this._hoverDebounceTimer);
        const token = ++this._hoverRequestToken;
        this._hoverDebounceTimer = setTimeout(async () => {
            const located = await this._locatePart(part);
            if (token !== this._hoverRequestToken) return;
            const origin = this._origin();
            drawHoverPreview(this._map, located, origin, part.value);
            const button = part.el?.querySelector('.place-part-btn');
            if (button && origin && located?.center) button.title = `${part.title} (${directionTo(origin, located.center).text})`;
        }, HOVER_PREVIEW_DEBOUNCE_MS);
    }

    // Where the address was read: the map centre, or while a pick's trail is
    // up, the centre the trail started from.
    _origin() {
        if (this._trail?.origin) return this._trail.origin;
        return this._map ? this._map.getCenter().toArray() : null;
    }

    _clearHoverPreview() {
        clearTimeout(this._hoverDebounceTimer);
        this._hoverDebounceTimer = null;
        this._hoverRequestToken++;
        drawHoverPreview(this._map, null);
    }
}

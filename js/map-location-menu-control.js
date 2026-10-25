/**
 * MapLocationMenuControl - the Address panel, opened from the place name on
 * the map console's place line (one of the console's panels,
 * js/console-panel.js):
 *
 * - The reverse-geocoded address (js/location-address.js) as a breadcrumb of
 *   admin areas, then the rest of the address and the postcode. Every part is
 *   a button: hovering previews its extent on the map, clicking flies there.
 *   The panel stays open while the map moves and the address follows the map.
 * - Under it, its OpenStreetMap credit (js/location-osm.js) and the languages
 *   it is in (js/location-language.js). Each address part shows its OSM icon
 *   on hover and while it is the current level; it opens the OSM data
 *   explorer on that part's object.
 *
 * The map view and the device's location are panels of their own
 * (js/map-view-panel.js, js/locate-panel.js), as is Share
 * (js/share-view-panel.js).
 *
 * The address is read from window.attributionControl (see
 * map-attribution-control.js `setLocation()` / map-init.js
 * `updateAttributionLocation()`) rather than issued as a fresh reverse geocode
 * here - that already runs on every `moveend`. Opening the panel makes one
 * Nominatim details request for the OSM objects behind the address parts, so
 * a part with one is located by that object, and any other part by a forward
 * geocode of its name scoped to its parents ("Panaji, Goa, India"). Hover and
 * click share one lookup (and its cache).
 */
import { queryNominatim, lookupNominatimPlaces, fetchNominatimAddressParts } from './nominatim-search.js';
import { activePart, buildAddressBlock, linkOsmObjects, nearestOnLine } from './location-address.js';
import { directionTo, drawHoverPreview } from './location-hover.js';
import { buildOsmFooter, showOsmDialog } from './location-osm.js';
import { buildLanguageControl } from './location-language.js';
import { ConsolePanel } from './console-panel.js';

// A movestart this soon after a pick is the pick's own camera move.
const OWN_MOVE_MS = 300;
const HOVER_PREVIEW_DEBOUNCE_MS = 150;

function extent(osmType, bbox) {
    return ['way', 'relation', 'W', 'R'].includes(osmType) ? bbox : null;
}

export class MapLocationMenuControl extends ConsolePanel {
    constructor() {
        super({ title: 'Address', icon: 'geo-alt', className: 'address-panel' });

        // part query -> {center, bbox} (or null), shared by hover preview and
        // click-to-navigate so hovering a part before clicking it doesn't
        // issue a second request.
        this._placeCache = new Map();
        this._hoverDebounceTimer = null;
        this._hoverRequestToken = 0;
        this._renderToken = 0;

        this._handleLocationChanged = () => {
            if (this._isOpen) this._renderAddress();
        };
        // A pick's own camera move keeps its trail; any other move ends it.
        this._handleMoveStart = () => {
            if (performance.now() - (this._ownMoveAt || 0) < OWN_MOVE_MS) return;
            if (!this._trail) return;
            this._trail = null;
            if (this._isOpen) this._renderAddress();
        };
    }

    mount(map, options) {
        super.mount(map, options);
        window.addEventListener('mapLocationChanged', this._handleLocationChanged);
        map?.on('movestart', this._handleMoveStart);
        window.mapLocationMenuControl = this;
    }

    unmount() {
        window.removeEventListener('mapLocationChanged', this._handleLocationChanged);
        this._map?.off('movestart', this._handleMoveStart);
        super.unmount();
        if (window.mapLocationMenuControl === this) window.mapLocationMenuControl = null;
    }

    _build(section) {
        this._addressSection = section;
        this._osmFooter = section.appendChild(buildOsmFooter());
        this._language = buildLanguageControl();
        this._osmFooter.appendChild(this._language.toggle);
        section.appendChild(this._language.panel);
        this._renderAddress();
    }

    _teardown() {
        this._clearHoverPreview();
        this._language?.destroy();
        this._language = null;
    }

    // The language fields' suggestions open in <body>, outside the panel.
    _keepsOpen(target) {
        return !!target.closest?.('.ac-badge-input-list');
    }

    // Escape in a language field leaves the field, not the panel.
    _handleKeydown(e) {
        if (e.target.closest?.('.ac-badge-input')) return;
        super._handleKeydown(e);
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

    // The OSM data explorer for a part's object; it replaces the panel.
    _openOsm(part) {
        const center = this._map.getCenter();
        const context = {
            view: { lat: center.lat, lng: center.lng, zoom: this._map.getZoom() },
            country: window.attributionControl?._address?.country || null
        };
        this.close();
        showOsmDialog(context, { ...part.osm, name: part.value });
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

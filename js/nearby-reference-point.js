/**
 * NearbyReferencePoint - the point every distance and bearing in
 * map-nearby-features-control.js is measured from.
 *
 * Three kinds of reference are offered, in preference order: the device's
 * live GPS position (fed in by the control from window.geolocationControl),
 * the current map center, or any marker already placed on the map (see
 * map-marker-manager.js) - including a route's own waypoint markers, so
 * picking the marker at a route's far end as the origin is how a destination
 * continues that route (see search/route-store.js's routeTo).
 *
 * The default is GPS whenever the device watch is on — including before its
 * first fix, when `resolve()` still hands back the map center and the button
 * reads as pending — and the map center otherwise. A first fix arriving later
 * upgrades the reference to GPS the same way. Neither happens once the user
 * has explicitly picked something else.
 *
 * `resolve()` reads the underlying position fresh on every call rather than
 * caching it, so a reference that moves on its own (a GPS fix, a panning map,
 * a dragged marker) stays live for the control's row refreshes.
 */

export const REFERENCE_GEOLOCATION = 'geolocation';
export const REFERENCE_CENTER = 'center';
export const REFERENCE_MARKER = 'marker';

export class NearbyReferencePoint {
    constructor(map) {
        this._map = map;
        this._userPosition = null;
        this._choice = { type: REFERENCE_CENTER };
        this._isExplicit = false;
    }

    get type() {
        return this._choice.type;
    }

    get userPosition() {
        return this._userPosition;
    }

    /**
     * Records a new GPS fix. Returns true when this changed which point the
     * reference resolves to in a way that warrants re-sorting the list — i.e.
     * the first fix promoting an implicit map-center default to GPS.
     */
    setUserPosition(lngLat) {
        const isFirstFix = !this._userPosition;
        this._userPosition = lngLat;
        if (isFirstFix && !this._isExplicit) {
            this._choice = { type: REFERENCE_GEOLOCATION };
            return true;
        }
        return false;
    }

    /**
     * Makes GPS the default because the device watch is running, even though
     * no fix has arrived yet. Returns true when this changed the reference.
     */
    preferGeolocation() {
        if (this._isExplicit || this._choice.type === REFERENCE_GEOLOCATION) return false;
        this._choice = { type: REFERENCE_GEOLOCATION };
        return true;
    }

    choose(option) {
        this._isExplicit = true;
        this._choice = option.type === REFERENCE_MARKER
            ? { type: REFERENCE_MARKER, markerId: option.markerId }
            : { type: option.type };
    }

    isChosen(option) {
        if (option.type !== this._choice.type) return false;
        return option.type !== REFERENCE_MARKER || option.markerId === this._choice.markerId;
    }

    /**
     * Live `{lng, lat}` of the current reference. Falls back to the map center
     * when the chosen reference can't be resolved right now (no GPS fix yet, or
     * the chosen marker has since been deleted).
     */
    resolve() {
        if (this._choice.type === REFERENCE_GEOLOCATION) {
            return this._userPosition || this._mapCenter();
        }
        if (this._choice.type === REFERENCE_MARKER) {
            return this._findMarker(this._choice.markerId)?.lngLat || this._mapCenter();
        }
        return this._mapCenter();
    }

    name() {
        return this.current().label;
    }

    /**
     * What the "Navigate From" button shows: the chosen reference's label and
     * icon, plus `isPending` when that choice can't be resolved yet (GPS
     * picked before the first fix) and `resolve()` is therefore still handing
     * back the map center. A marker that has since been deleted isn't pending —
     * it's gone, so the reference reads as the map center it fell back to.
     */
    current() {
        if (this._choice.type === REFERENCE_GEOLOCATION) {
            return { label: 'My location', icon: 'geo-fill', isPending: !this._userPosition };
        }
        if (this._choice.type === REFERENCE_MARKER) {
            const marker = this._findMarker(this._choice.markerId);
            if (marker) return { label: String(marker.label), icon: 'geo-alt-fill', isPending: false };
        }
        return { label: 'Map center', icon: 'crosshair', isPending: false };
    }

    /**
     * Every reference the user can pick, in menu order: GPS (only when the
     * app's shared geolocation control exists at all), the map center, then
     * each marker sorted by name.
     */
    listOptions() {
        const options = [];

        if (window.geolocationControl) {
            options.push({
                type: REFERENCE_GEOLOCATION,
                icon: 'geo-fill',
                label: 'My location',
                subtext: this._userPosition ? 'Device GPS' : 'Device GPS · waiting for a fix'
            });
        }

        options.push({
            type: REFERENCE_CENTER,
            icon: 'crosshair',
            label: 'Map center',
            subtext: 'Center of the current view'
        });

        this._markers()
            .slice()
            .sort((a, b) => String(a.label).localeCompare(String(b.label)))
            .forEach(m => options.push({
                type: REFERENCE_MARKER,
                markerId: m.id,
                icon: 'geo-alt-fill',
                label: m.label,
                subtext: 'Marker'
            }));

        return options;
    }

    _mapCenter() {
        const center = this._map?.getCenter();
        return center ? { lng: center.lng, lat: center.lat } : null;
    }

    _markers() {
        return window.featureControl?._markerManager?.getMarkers() || [];
    }

    _findMarker(id) {
        return this._markers().find(m => m.id === id) || null;
    }
}

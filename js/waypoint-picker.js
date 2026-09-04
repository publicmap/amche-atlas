/**
 * WaypointPicker - the value behind one endpoint (origin or destination) of
 * the route built in map-nearby-features-control.js. Two instances exist,
 * one per endpoint, sharing this same set of choices:
 *
 * - **My Location** - the device's live GPS position.
 * - **Selected Locations** - any marker already on the map (including a
 *   route's own waypoint markers).
 * - **From Map View** - a labeled point from the base map style currently
 *   rendered in view (see NearbyFeaturesControl._fromMapViewItems), or any
 *   point typed as coordinates or geocoded free text.
 * - **Click on Map** - arm()ed while waiting for the next marker the user
 *   places by clicking the map (see MapMarkerManager.onMarkerAdded); the
 *   control binds that marker to this picker once it appears.
 *
 * Unlike the plain three-way NearbyReferencePoint (map center / GPS /
 * marker) used elsewhere for a single "route from here" shortcut, a picker
 * here can also be left unset - the "To" endpoint starts with nothing chosen
 * until the user picks a destination.
 */

export const WAYPOINT_MY_LOCATION = 'my-location';
export const WAYPOINT_MARKER = 'marker';
export const WAYPOINT_POINT = 'point';

export class WaypointPicker {
    /**
     * @param {boolean} preferMyLocation - whether an incoming GPS fix should
     *   silently become the default choice when nothing has been picked yet
     *   (used for the "From" endpoint; "To" leaves itself unset instead).
     */
    constructor(map, { preferMyLocation = false } = {}) {
        this._map = map;
        this._preferMyLocation = preferMyLocation;
        this._userPosition = null;
        this._choice = null;
        this._isExplicit = false;
        this._armed = false;
    }

    get userPosition() {
        return this._userPosition;
    }

    get type() {
        return this._choice?.type ?? null;
    }

    get isArmed() {
        return this._armed;
    }

    get isSet() {
        return this._choice !== null;
    }

    /** See NearbyReferencePoint.setUserPosition - same first-fix promotion. */
    setUserPosition(lngLat) {
        const isFirstFix = !this._userPosition;
        this._userPosition = lngLat;
        if (isFirstFix && this._preferMyLocation && !this._isExplicit) {
            this._choice = { type: WAYPOINT_MY_LOCATION };
            return true;
        }
        return false;
    }

    preferGeolocation() {
        if (this._isExplicit || this._choice?.type === WAYPOINT_MY_LOCATION) return false;
        this._choice = { type: WAYPOINT_MY_LOCATION };
        return true;
    }

    arm() {
        this._armed = true;
    }

    disarm() {
        this._armed = false;
    }

    chooseMyLocation() {
        this._isExplicit = true;
        this._armed = false;
        this._choice = { type: WAYPOINT_MY_LOCATION };
    }

    chooseMarker(markerId, label) {
        this._isExplicit = true;
        this._armed = false;
        this._choice = { type: WAYPOINT_MARKER, markerId, label };
    }

    /** A point typed as coordinates, geocoded free text, or picked from the base map style - see AutocompleteBadgeInput's parseText. */
    choosePoint(lngLat, label) {
        this._isExplicit = true;
        this._armed = false;
        this._choice = { type: WAYPOINT_POINT, lngLat, label };
    }

    isChosenMarker(markerId) {
        return this._choice?.type === WAYPOINT_MARKER && this._choice.markerId === markerId;
    }

    isChosenMyLocation() {
        return this._choice?.type === WAYPOINT_MY_LOCATION;
    }

    /**
     * Live `{lng, lat}` of the current choice, or null when nothing is set
     * (the initial "To" state) or the chosen marker has since been deleted.
     */
    resolve() {
        if (!this._choice) return null;
        if (this._choice.type === WAYPOINT_MY_LOCATION) return this._userPosition || this._mapCenter();
        if (this._choice.type === WAYPOINT_MARKER) return this._findMarker(this._choice.markerId)?.lngLat || null;
        if (this._choice.type === WAYPOINT_POINT) return this._choice.lngLat;
        return null;
    }

    /**
     * Like resolve(), but a picker with nothing chosen (or an explicit choice
     * that's since become unresolvable) silently falls back to the map
     * center rather than returning null - what "Route From" needs, since
     * every distance/bearing in the menu is measured from it and must always
     * resolve to something even before the user has picked anything.
     */
    resolveOrCenter() {
        return this.resolve() || this._mapCenter();
    }

    name() {
        return this.current().label;
    }

    /**
     * What the endpoint's dropdown button shows: label + icon, `isPending`
     * when GPS is chosen but no fix has arrived yet, and `isUnset` when
     * nothing has been picked (or the picked marker is gone).
     */
    current() {
        if (this._choice?.type === WAYPOINT_MY_LOCATION) {
            return { label: 'My location', icon: 'crosshair', isPending: !this._userPosition, isUnset: false };
        }
        if (this._choice?.type === WAYPOINT_MARKER) {
            const marker = this._findMarker(this._choice.markerId);
            if (marker) return { label: String(marker.label), icon: 'geo-alt-fill', isPending: false, isUnset: false };
        }
        if (this._choice?.type === WAYPOINT_POINT) {
            return { label: this._choice.label, icon: 'geo-alt', isPending: false, isUnset: false };
        }
        return { label: 'Choose a point', icon: 'crosshair', isPending: false, isUnset: true };
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

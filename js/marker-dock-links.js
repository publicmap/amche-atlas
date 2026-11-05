import { haversineDistanceMeters } from './geo-distance-utils.js';

const MATCH_METERS = 25;

/**
 * The docked marker standing at each of a route's waypoints. The route's own
 * marker ids are tried first, but they go stale whenever a marker is rebuilt
 * (a restored link redraws them, a drag replaces one), so a waypoint with no
 * live marker under its id falls back to whichever docked marker sits on it.
 */
export function stopMarkers(route, docked) {
    return route.waypoints.map((waypoint, index) => {
        const byId = docked.find(m => m.id === route.markerIds[index]);
        if (byId) return byId;
        const at = { lng: waypoint[0], lat: waypoint[1] };
        return docked.find(m => haversineDistanceMeters(at, m.marker.getLngLat()) < MATCH_METERS) || null;
    });
}

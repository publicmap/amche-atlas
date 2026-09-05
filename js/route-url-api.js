/**
 * Route URL API — expands the `route-<rid>:` dynamic layer shorthand (see
 * dynamic-layer-shorthand.js) into a navigation layer.
 *
 *   route-1:mapbox-driving-traffic(1,2)
 *   route-1:mapbox-walking(1,2,3)
 *   route-1:osrm-driving(1,2)
 *   route-1:(1,2)          — default service and profile
 *
 * The call names which routing service and profile produced the route, the way
 * the other shorthands name their service (`allmaps:`, `mapwarper:`): the token
 * is `<engine>-<profile>` from search/directions-router.js's ROUTING_ENGINES,
 * so adding a service there is all it takes for `<service>-<profile>(…)` to
 * work here. Every service's routes land in the same route layer.
 *
 * The call's arguments are marker ids (see marker-registry.js), not raw
 * coordinates — at least two, comma-separated like every other shorthand
 * arg list (js/shorthand-id-utils.js's splitArgs; no pair-separator needed
 * since each argument is a single id, not a lng/lat pair). Each referenced
 * id must already have a coordinate in the marker registry — populated from
 * `?markers=` before any `route-<rid>:` entry is resolved (see map-init.js) —
 * or the whole route is dropped, same failure path as an unresolvable
 * allmaps:/mapwarper: id.
 *
 * `<rid>` is this route's own user-facing id, riding along in the shorthand
 * type token itself (`route-<rid>:...`) rather than inside the call, so it
 * stays stable across edits the way a `marker-<id>` does.
 *
 * The resulting layer is the same shape as the `directions` layer in
 * config/index.atlas.json — the route line with every property the API
 * returned, plus a Point per waypoint (see search/route-geojson.js). It also
 * carries `_waypointMarkerIds` (the referenced marker ids, in order) so
 * MapMarkerManager.applyRouteWaypointStyling() can recolor the matching real
 * markers as route waypoints once they exist (markers restore later, after
 * this layer is already resolved — see map-init.js's ordering note).
 */

import { fetchRouteForWaypoints, parseRoutingEngineProfile, routingEngineAttribution } from './search/directions-router.js';
import { buildRouteFeatureCollection, ROUTE_STYLE, ROUTE_INSPECT } from './search/route-geojson.js';
import { formatDistance } from './geo-distance-utils.js';
import { splitArgs } from './shorthand-id-utils.js';
import { get as getRegisteredMarker } from './marker-registry.js';

// "engine-profile(markerIds)" - the canonical form.
const CALL_RE = /^([A-Za-z0-9-]*)\(([^)]*)\)$/;

export class RouteApi {
    /**
     * @returns {{token: string|null, engine: string, profile: string|null, markerIds: string[], waypoints: Array<Array<number>>} | null}
     *   null when the id isn't at least two valid, resolvable marker ids.
     */
    static parseId(id) {
        if (typeof id !== 'string') return null;

        let token = null;
        let argsText = id.trim();

        const call = argsText.match(CALL_RE);
        if (call) {
            token = call[1] || null;
            argsText = call[2];
        } else {
            // Tolerated: "engine-profile:markerIds" and bare "markerIds".
            const colon = argsText.indexOf(':');
            if (colon > 0) {
                token = argsText.slice(0, colon);
                argsText = argsText.slice(colon + 1);
            }
        }

        const markerIds = splitArgs(argsText).filter(Boolean);
        if (markerIds.length < 2) return null;

        const waypoints = markerIds.map(markerId => {
            const marker = getRegisteredMarker(markerId);
            return marker ? [marker.lng, marker.lat] : null;
        });
        if (waypoints.some(w => w === null)) return null;

        const { engine, profile } = parseRoutingEngineProfile(token);
        return { token, engine, profile, markerIds, waypoints };
    }

    static async createConfigFromId(id, rid) {
        const parsed = RouteApi.parseId(id);
        if (!parsed) {
            throw new Error(`Expected at least two resolvable marker ids, got "${id}"`);
        }

        const { engine, profile, markerIds, waypoints } = parsed;
        const route = await fetchRouteForWaypoints(waypoints, { engine, profile });
        const geojson = buildRouteFeatureCollection(route, waypoints, {
            profile: route.profile,
            source: route.source
        });

        const distance = formatDistance(route.distance);
        const minutes = Math.round(route.duration / 60);
        const stops = waypoints.length > 2 ? `, ${waypoints.length - 2} stop${waypoints.length === 3 ? '' : 's'}` : '';
        const slug = rid || markerIds.join('_');

        return {
            title: `Route · ${distance}`,
            type: 'geojson',
            id: `route-${slug}`,
            geojson,
            description: `${route.profile} route, ${distance}, about ${minutes} minute${minutes === 1 ? '' : 's'}${stops}.`,
            attribution: routingEngineAttribution(route.source),
            style: { ...ROUTE_STYLE },
            inspect: { ...ROUTE_INSPECT },
            _waypointMarkerIds: markerIds
        };
    }
}

/**
 * Route URL API — expands the `route:` dynamic layer shorthand (see
 * dynamic-layer-shorthand.js) into a navigation layer.
 *
 *   route:mapbox-driving-traffic(73.81/15.49|73.83/15.51)
 *   route:mapbox-walking(73.81/15.49|73.82/15.50|73.83/15.51)
 *   route:osrm-driving(73.81/15.49|73.83/15.51)
 *   route:(73.81/15.49|73.83/15.51)          — default service and profile
 *
 * The call names which routing service and profile produced the route, the way
 * the other shorthands name their service (`allmaps:`, `mapwarper:`): the token
 * is `<engine>-<profile>` from search/directions-router.js's ROUTING_ENGINES,
 * so adding a service there is all it takes for `<service>-<profile>(…)` to
 * work here. Every service's routes land in the same route layer.
 *
 * Coordinates are `lng/lat` in the order the Directions API takes them, at
 * least two per route, separated by `|` — the same way `?markers=` separates
 * its points. Each `route:` entry in `?layers=` is one route and becomes one
 * layer, so several routes on a map is just several entries.
 *
 * Where this parts company with `?markers=` is inside the pair: `/`, not the
 * API's own comma, because `?layers=` is itself comma-separated and a comma in
 * a bare shorthand string splits the entry into pieces (see
 * MapUtils.parseLayersFromUrl). `/` matches the map hash's `zoom/lat/lng`
 * convention. Commas, `;` and a `:` before the waypoints are all still
 * accepted on read — a comma survives the split inside the quoted
 * {"type":"route","id":"…"} object form.
 *
 * The resulting layer is the same shape as the `directions` layer in
 * config/index.atlas.json — the route line with every property the API
 * returned, plus a Point per waypoint (see search/route-geojson.js).
 */

import { fetchRouteForWaypoints, parseRoutingEngineProfile, routingEngineAttribution } from './search/directions-router.js';
import { buildRouteFeatureCollection, ROUTE_STYLE, ROUTE_INSPECT } from './search/route-geojson.js';
import { formatDistance } from './geo-distance-utils.js';

// "engine-profile(waypoints)" - the canonical form.
const CALL_RE = /^([A-Za-z0-9-]*)\(([^)]*)\)$/;

export class RouteApi {
    /**
     * @returns {{token: string|null, engine: string, profile: string|null, waypoints: Array<Array<number>>} | null}
     *   null when the id isn't at least two valid `lng/lat` pairs.
     */
    static parseId(id) {
        if (typeof id !== 'string') return null;

        let token = null;
        let coordsText = id.trim();

        const call = coordsText.match(CALL_RE);
        if (call) {
            token = call[1] || null;
            coordsText = call[2];
        } else {
            // Tolerated: "engine-profile:waypoints" and bare "waypoints".
            const colon = coordsText.indexOf(':');
            if (colon > 0) {
                token = coordsText.slice(0, colon);
                coordsText = coordsText.slice(colon + 1);
            }
        }

        const waypoints = coordsText.split(/[|;]/)
            .map(pair => pair.trim())
            .filter(Boolean)
            .map(pair => {
                const [lng, lat] = pair.split(/[/,]/).map(Number);
                if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
                if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
                return [lng, lat];
            });

        if (waypoints.length < 2 || waypoints.some(w => w === null)) return null;

        const { engine, profile } = parseRoutingEngineProfile(token);
        return { token, engine, profile, waypoints };
    }

    static async createConfigFromId(id) {
        const parsed = RouteApi.parseId(id);
        if (!parsed) {
            throw new Error(`Expected at least two "lng/lat" waypoints, got "${id}"`);
        }

        const { engine, profile, waypoints } = parsed;
        const route = await fetchRouteForWaypoints(waypoints, { engine, profile });
        const geojson = buildRouteFeatureCollection(route, waypoints, {
            profile: route.profile,
            source: route.source
        });

        const distance = formatDistance(route.distance);
        const minutes = Math.round(route.duration / 60);
        const stops = waypoints.length > 2 ? `, ${waypoints.length - 2} stop${waypoints.length === 3 ? '' : 's'}` : '';
        const slug = `${route.source}-${route.profile}-${waypoints.map(w => w.join('_')).join('-')}`;

        return {
            title: `Route · ${distance}`,
            type: 'geojson',
            id: `route-${slug}`,
            geojson,
            description: `${route.profile} route, ${distance}, about ${minutes} minute${minutes === 1 ? '' : 's'}${stops}.`,
            attribution: routingEngineAttribution(route.source),
            style: { ...ROUTE_STYLE },
            inspect: { ...ROUTE_INSPECT }
        };
    }
}

/**
 * RouteStore - the routes on the map and which one a new destination extends.
 *
 * A session can hold several routes. `routeTo(from, ..., to, ...)` is the one
 * place that decides which: if `from` lands on an existing route's last
 * waypoint, that route is extended; otherwise a new route starts at `from`.
 * Both the shortcut menu's Route From/Route To (see ../shortcut-menu-base.js)
 * and the Visible Features menu (see ../map-nearby-features-control.js) go
 * through this, so tapping three destinations from the same running point in
 * a row builds one route through all three rather than three separate
 * two-point routes, without either caller tracking "which route" itself.
 *
 * Every route this store creates lives in the single `directions` layer
 * (config/index.atlas.json), concatenated into one FeatureCollection and told
 * apart by a `routeId` on each feature. A route adopted from a `route:` URL
 * layer keeps its own layer instead, and extending it rewrites that layer -
 * so a shared link and its layer stay the thing the user sees.
 *
 * This is the only writer of the `directions` layer: search's "X to Y" match
 * comes through adopt() (see directions-layer.js), so a searched route and a
 * clicked one are the same kind of thing and neither wipes the other.
 *
 * Every waypoint also gets a marker (see ../map-marker-manager.js) in the
 * route's own blue, which puts it in the `markers=` URL param alongside every
 * other selection. Those markers are the handles on the route: dragging one
 * moves its waypoint and re-routes live under the cursor, and closing one
 * drops that stop and re-routes what is left.
 */

import { fetchRouteForWaypoints } from './directions-router.js';
import { buildRouteFeatureCollection, routeShorthand, DIRECTIONS_LAYER_ID } from './route-geojson.js';
import { getDirectionsProfile } from './directions-profile.js';
import { haversineDistanceMeters } from '../geo-distance-utils.js';

const EMPTY_DATA = { type: 'FeatureCollection', features: [] };

// Matches the route line (see route-geojson.js), so a waypoint's pin reads as
// part of its route rather than as another map selection. Exported so
// map-marker-manager.js's applyRouteWaypointStyling() (recoloring a marker
// restored from a `route-<rid>:` URL shorthand, before RouteStore itself is
// ever involved) uses the same color rather than a second copy of it.
export const WAYPOINT_PIN_COLOR = '#1da1f2';

// How close a "from" point has to land to a route's last waypoint to count as
// "continuing that route" rather than starting a new one - generous enough to
// absorb float drift when the point is that waypoint's own marker.
const CONTINUE_ROUTE_THRESHOLD_METERS = 5;

// A drag fires every animation frame; re-routing that often would hammer the
// Directions API for frames nobody sees. Trailing edge only, then once more on
// release, so the line keeps up without a request per pixel.
const LIVE_REROUTE_MS = 220;

let nextRouteNumber = 1;

export class RouteStore {
    constructor() {
        this._routes = [];
        this._pendingOrigin = null;
    }

    get routes() {
        return this._routes;
    }

    /**
     * The point a "Route From" pick (shortcut-menu.js / header-shortcut-menu-
     * control.js) last recorded, waiting for a "Route To" to consume it as the
     * start of a route. Cleared implicitly the moment `routeTo` uses it and
     * replaced with the new destination, so picking further destinations
     * without another "Route From" keeps extending the same route.
     */
    get pendingOrigin() {
        return this._pendingOrigin;
    }

    /**
     * `withMarker` also puts a route-coloured pin on that point - what the
     * shortcut menu's "Start from here" needs, so the origin looks like part
     * of the route it is about to start rather than an ordinary selection, and
     * is draggable before any route exists. Once a destination is picked the
     * same marker is adopted as the route's first waypoint (see _syncMarkers),
     * so the pin the user placed is the pin the route keeps.
     */
    setPendingOrigin(point, label, { withMarker = false } = {}) {
        this._pendingOrigin = point ? { lng: point.lng, lat: point.lat, label: label || '' } : null;
        if (!withMarker || !this._pendingOrigin) return this._pendingOrigin;

        const markers = window.featureControl?._markerManager;
        if (!markers) return this._pendingOrigin;

        const lngLat = { lng: point.lng, lat: point.lat };
        const follow = (moved) => {
            if (!this._pendingOrigin) return;
            this._pendingOrigin.lng = moved.lng;
            this._pendingOrigin.lat = moved.lat;
        };
        const handlers = {
            pinColor: WAYPOINT_PIN_COLOR,
            onDrag: follow,
            onDragEnd: follow,
            onRemove: () => { this._pendingOrigin = null; }
        };

        const existing = markers.findMarkerNear?.(lngLat, 20);
        if (existing) {
            markers.adoptAsWaypoint(existing, handlers);
            this._pendingOrigin.markerId = existing;
        } else {
            this._pendingOrigin.markerId = markers.addMarker(lngLat, [], { role: 'route-waypoint', ...handlers });
        }
        return this._pendingOrigin;
    }

    /**
     * Picks up routes already drawn on the map - restored from a shared link,
     * or left by an earlier moment in this session - so distances/continuation
     * can be measured against them rather than starting blank. Routes this
     * store already tracks keep their identity; only groups it has not seen
     * are adopted.
     */
    sync() {
        const groups = window.layerControl?._state?.groups || [];
        const known = new Set(this._routes.map(r => r.id));

        groups.forEach(group => {
            const features = group.geojson?.features || [];
            if (!features.some(f => f.properties?.kind === 'route')) return;

            byRouteId(features).forEach((routeFeatures, routeId) => {
                const id = routeId || `${group.id}:0`;
                if (known.has(id)) return;

                const adopted = routeFromFeatures(id, group.id, routeFeatures);
                if (adopted) this._routes.push(adopted);
            });
        });
    }

    /**
     * Builds or extends a route from `from` to `to`. Which route:
     * - `routeId` naming a route this store already tracks - that route,
     *   forced (see map-nearby-features-control.js's Route picker, letting a
     *   user explicitly pick an existing route to extend or browse rather
     *   than relying on the guess below).
     * - `routeId: 'new'` - always start a fresh route, even if `from` would
     *   otherwise match one already on the map.
     * - omitted - the default guess: if `from` lands on the last waypoint of
     *   a route already on the map, that route is extended; otherwise a new
     *   route starts at `from`. Used identically by the shortcut menu's
     *   Route To and by map-nearby-features-control.js - so neither has to
     *   track an explicit "selected route" for the user to manage.
     *
     * Returns the route, or null if there was nowhere to start from.
     */
    async routeTo(from, fromLabel, to, toLabel, { routeId } = {}) {
        if (!from || !to) return null;

        let route = null;
        if (routeId && routeId !== 'new') route = this._routes.find(r => r.id === routeId) || null;
        if (!route && routeId !== 'new') route = this._routes.find(r => this._endsNear(r, from));
        if (!route) route = this._create([[from.lng, from.lat]], [fromLabel || '']);

        route.waypoints.push([to.lng, to.lat]);
        route.names.push(toLabel || '');

        await this._resolve(route);
        return route;
    }

    /** Whether `point` sits on `route`'s last waypoint - "continuing" it. */
    _endsNear(route, point) {
        if (!route.waypoints.length) return false;
        const [lng, lat] = route.waypoints[route.waypoints.length - 1];
        return haversineDistanceMeters({ lng, lat }, point) <= CONTINUE_ROUTE_THRESHOLD_METERS;
    }

    /**
     * The route already on the map whose last waypoint `point` sits on, if
     * any - what a "Route From"/"Route To" pick that lands on an existing
     * route's end should default to continuing (see
     * map-nearby-features-control.js's Route picker default).
     */
    findRouteEndingNear(point) {
        if (!point) return null;
        return this._routes.find(r => this._endsNear(r, point)) || null;
    }

    /**
     * A waypoint's marker was dragged. `live` re-routes on a trailing timer
     * while the drag is still running; the release re-routes immediately, so
     * the line follows the pin without a request per frame.
     */
    moveWaypoint(routeId, index, lngLat, { live = false } = {}) {
        const route = this._routes.find(r => r.id === routeId);
        if (index < 0 || !route || !route.waypoints[index]) return;

        route.waypoints[index] = [lngLat.lng, lngLat.lat];

        clearTimeout(route._rerouteTimer);
        if (!live) {
            this._resolve(route).catch(error => console.warn('[directions] re-route failed:', error));
            return;
        }
        route._rerouteTimer = setTimeout(() => {
            this._resolve(route).catch(error => console.warn('[directions] re-route failed:', error));
        }, LIVE_REROUTE_MS);
    }

    /** A waypoint's marker was closed: drop it and re-route what's left. */
    removeWaypoint(routeId, index) {
        const route = this._routes.find(r => r.id === routeId);
        if (index < 0 || !route || !route.waypoints[index]) return;

        route.waypoints.splice(index, 1);
        route.names.splice(index, 1);
        route.markerIds.splice(index, 1);

        if (route.waypoints.length < 2) {
            this.remove(routeId);
            return;
        }
        this._resolve(route).catch(error => console.warn('[directions] re-route failed:', error));
    }

    /**
     * Re-fetches `routeId` with a new routing profile (see
     * search/directions-profile.js) - what changing the profile while a route
     * is the active Route selection should do (see
     * map-nearby-features-control.js), rather than only affecting the next
     * route drawn from scratch. Returns the updated route, or null if
     * `routeId` isn't one this store tracks.
     */
    async setRouteProfile(routeId, profile) {
        const route = this._routes.find(r => r.id === routeId);
        if (!route) return null;

        route.profile = profile;
        await this._resolve(route);
        return route;
    }

    /** Takes a route someone else already fetched (search's "X to Y"). */
    adopt(result, waypoints, names = []) {
        const route = this._create(waypoints.map(w => [...w]), [...names]);
        route.engine = result.source;
        route.profile = result.profile;
        this._apply(route, result);
        // Waypoint markers first, same reasoning as _resolve() - the
        // `route-<rid>:` shorthand _write() derives references each
        // waypoint's live marker id.
        this._syncMarkers(route);
        this._write(route.groupId);
        return route;
    }

    /** Drops one route, leaving every other route on the map alone. */
    remove(id) {
        const route = this._routes.find(r => r.id === id);
        if (!route) return;

        this._routes = this._routes.filter(r => r.id !== id);
        this._write(route.groupId);
    }

    clearAll() {
        const groupIds = new Set(this._routes.map(r => r.groupId));
        this._routes = [];
        this._pendingOrigin = null;
        groupIds.add(DIRECTIONS_LAYER_ID);
        groupIds.forEach(groupId => this._write(groupId));
    }

    _create(waypoints, names) {
        const number = nextRouteNumber++;
        const route = {
            id: `route-${number}`,
            // The route's own user-facing id in its `route-<rid>:` URL
            // shorthand (route-geojson.js's routeShorthand) - defaults to its
            // creation-order number, same as a marker's urlId defaults to a
            // serial number (see map-marker-manager.js). No rename UI for
            // routes yet, unlike markers.
            rid: String(number),
            number,
            code: routeLetterCode(number),
            groupId: DIRECTIONS_LAYER_ID,
            waypoints,
            names,
            engine: null,
            profile: getDirectionsProfile(),
            geojson: EMPTY_DATA,
            markerIds: [],
            name: ''
        };
        route.name = routeName(route);
        this._routes.push(route);
        return route;
    }

    async _resolve(route) {
        const result = await fetchRouteForWaypoints(route.waypoints, {
            engine: route.engine,
            profile: route.profile
        });
        route.engine = result.source;
        route.profile = result.profile;
        this._apply(route, result);
        // Waypoint markers first: _write()'s `route-<rid>:` shorthand now
        // references each waypoint's live marker id (see below), which
        // _syncMarkers is what assigns into route.markerIds.
        this._syncMarkers(route);
        this._write(route.groupId);
    }

    /**
     * Every waypoint also gets a marker, so a route's stops are draggable and
     * ride along in the `markers=` URL param like any other selection (see
     * ../map-marker-manager.js, url-manager.js's serializeMarkersForURL).
     * Dragging one moves the waypoint and re-routes; closing one drops it.
     * Each also gets its `ref` ("A1", "A2", ...) rendered on its pin (see
     * MapMarkerManager.setMarkerRefLabel) - reapplied on every call, since
     * adding, removing, or reordering a waypoint shifts every ref after it.
     */
    _syncMarkers(route) {
        const markers = window.featureControl?._markerManager;
        if (!markers) return;

        route.waypoints.forEach((coordinates, index) => {
            const lngLat = { lng: coordinates[0], lat: coordinates[1] };
            const refLabel = `${route.code}${index + 1}`;
            const existingId = route.markerIds[index];

            if (existingId && markers._markers?.has(existingId)) {
                markers.moveMarker(existingId, lngLat);
                markers.setMarkerRefLabel(existingId, refLabel);
                return;
            }

            // A marker the user already dropped here (the click that added this
            // destination made one) is adopted rather than doubled up on.
            const nearby = markers.findMarkerNear?.(lngLat, 20);
            if (nearby) {
                route.markerIds[index] = nearby;
                markers.adoptAsWaypoint(nearby, this._waypointHandlers(route, { id: nearby }));
                markers.setMarkerRefLabel(nearby, refLabel);
                return;
            }

            // The handlers look their waypoint up by marker id when they fire
            // rather than closing over the index they were created at, which
            // goes stale the moment an earlier waypoint is removed.
            const ref = { id: null };
            ref.id = markers.addMarker(lngLat, [], {
                role: 'route-waypoint',
                pinColor: WAYPOINT_PIN_COLOR,
                ...this._waypointHandlers(route, ref)
            });
            route.markerIds[index] = ref.id;
            markers.setMarkerRefLabel(ref.id, refLabel);
        });
    }

    _waypointHandlers(route, ref) {
        const indexOf = () => route.markerIds.indexOf(ref.id);
        return {
            pinColor: WAYPOINT_PIN_COLOR,
            onDrag: (moved) => this.moveWaypoint(route.id, indexOf(), moved, { live: true }),
            onDragEnd: (moved) => this.moveWaypoint(route.id, indexOf(), moved),
            onRemove: () => this.removeWaypoint(route.id, indexOf())
        };
    }

    _apply(route, result) {
        route.result = result;
        route.geojson = buildRouteFeatureCollection(result, route.waypoints, {
            profile: result.profile,
            source: result.source,
            names: route.names,
            routeCode: route.code
        });
        route.name = routeName(route);
    }

    /**
     * Rewrites one layer with every route that lives in it. Feature ids are
     * namespaced by route so several routes can share the `directions` layer
     * without colliding, and each feature carries its route's id and name for
     * styling and inspection.
     *
     * The id is derived from what the feature is rather than from the id it
     * already has, so re-writing a route adopted back off the map (see sync)
     * doesn't stack another prefix on each pass.
     */
    _write(groupId) {
        const routes = this._routes.filter(r => r.groupId === groupId);
        const features = routes.flatMap(route =>
            (route.geojson?.features || []).map(feature => ({
                ...feature,
                properties: {
                    ...feature.properties,
                    id: `${route.id}-${featureKey(feature)}`,
                    routeId: route.id,
                    routeName: route.name
                }
            }))
        );

        const geojson = { type: 'FeatureCollection', features };
        api()?.updateGeoJSONLayerData(groupId, geojson);

        const group = window.layerControl?._state?.groups?.find(g => g.id === groupId);
        if (!group) return;

        group.geojson = geojson;

        // Several routes in one layer serialize as several `route-<rid>:`
        // entries. url-manager.js joins layer entries with commas (now
        // paren-aware - see parseLayersFromUrl), so a comma-joined
        // _originalJson lands in `?layers=` as exactly those separate entries
        // and parses back as one layer each.
        const markers = window.featureControl?._markerManager;
        const shorthand = routes
            .filter(r => r.waypoints.length >= 2)
            .map(r => {
                const markerIds = r.markerIds.map(id => markers?.getMarkerUrlId(id)).filter(Boolean);
                if (markerIds.length !== r.waypoints.length) return null;
                return routeShorthand(r.rid, markerIds, r.engine, r.profile);
            })
            .filter(Boolean)
            .join(',');

        if (shorthand) group._originalJson = shorthand;
        else delete group._originalJson;

        window.urlManager?.updateURL({ updateLayers: true });
    }
}

/**
 * "A", "B", ..., "Z", "AA", "AB", ... - the letter code a route's ref labels
 * (see route-geojson.js's buildRouteFeatureCollection) are prefixed with,
 * derived from its 1-based creation order rather than tracked separately.
 */
function routeLetterCode(number) {
    let n = number;
    let code = '';
    while (n > 0) {
        n -= 1;
        code = String.fromCharCode(65 + (n % 26)) + code;
        n = Math.floor(n / 26);
    }
    return code;
}

function featureKey(feature) {
    const { kind, index } = feature.properties || {};
    return kind === 'waypoint' ? `waypoint-${index ?? 0}` : 'route';
}

function api() {
    return window.featureControl?._stateManager?._mapboxAPI || window.mapboxAPI;
}

/** Groups a layer's features by their `routeId`, or one bucket when unset. */
function byRouteId(features) {
    const buckets = new Map();
    features.forEach(feature => {
        const key = feature.properties?.routeId || '';
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(feature);
    });
    return buckets;
}

/**
 * Rebuilds a route from the features on the map: the waypoint Points carry
 * their order and names, which is everything needed to re-route when the user
 * extends it. Returns null if there aren't two waypoints to work with.
 */
function routeFromFeatures(id, groupId, features) {
    const line = features.find(f => f.properties?.kind === 'route');
    const points = features
        .filter(f => f.properties?.kind === 'waypoint')
        .sort((a, b) => (a.properties.index ?? 0) - (b.properties.index ?? 0));

    if (points.length < 2) return null;

    const number = nextRouteNumber++;
    // Restoring a route already carrying `ref`s (see route-geojson.js) keeps
    // its letter code rather than reassigning one off the new session's
    // count, so a shared link's waypoint refs don't shift on reload; older
    // data with no `ref` yet just gets a fresh one.
    const existingRef = points[0]?.properties?.ref;
    const code = existingRef ? existingRef.replace(/\d+$/, '') : routeLetterCode(number);

    const route = {
        id,
        rid: String(number),
        number,
        code,
        groupId,
        waypoints: points.map(p => [...p.geometry.coordinates]),
        names: points.map(p => p.properties.name || ''),
        engine: line?.properties?.source || null,
        profile: line?.properties?.profile || getDirectionsProfile(),
        geojson: { type: 'FeatureCollection', features },
        result: line?.properties || null,
        markerIds: [],
        name: ''
    };
    route.name = line?.properties?.title || routeName(route);
    return route;
}

function routeName(route) {
    const from = route.names[0];
    const to = route.names[route.names.length - 1];
    if (from && to) return `${from} - ${to}`;
    if (to) return `To ${to}`;
    return `Route ${route.number}`;
}

/** One store per page - both the search control and the menu write to it. */
export const routeStore = new RouteStore();

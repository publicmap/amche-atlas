/**
 * RouteStore - the routes on the map and which one is being built.
 *
 * A session can hold several routes. The Visible Features menu (see
 * ../map-nearby-features-control.js) picks one as "selected", and every
 * destination clicked while it is selected is appended to it as another
 * waypoint - so tapping three features in a row builds one route through all
 * three rather than three separate two-point routes. "New Route" deselects,
 * and the next destination starts a fresh route from the default origin.
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
 */

import { fetchRouteForWaypoints } from './directions-router.js';
import { buildRouteFeatureCollection, routeShorthand, DIRECTIONS_LAYER_ID } from './route-geojson.js';
import { getDirectionsProfile } from './directions-profile.js';

const EMPTY_DATA = { type: 'FeatureCollection', features: [] };

let nextRouteNumber = 1;

export class RouteStore {
    constructor() {
        this._routes = [];
        this._selectedId = null;
    }

    get routes() {
        return this._routes;
    }

    get selected() {
        return this._routes.find(r => r.id === this._selectedId) || null;
    }

    isSelected(route) {
        return !!route && route.id === this._selectedId;
    }

    select(id) {
        this._selectedId = id;
    }

    /** "New Route": the next destination starts a route from the default origin. */
    startNew() {
        this._selectedId = null;
    }

    /** The point a selected route should be continued from, or null. */
    endOfSelected() {
        const route = this.selected;
        if (!route?.waypoints.length) return null;
        const [lng, lat] = route.waypoints[route.waypoints.length - 1];
        return { lng, lat, label: route.names[route.names.length - 1] || 'End of route' };
    }

    /**
     * Picks up routes already drawn on the map - restored from a shared link,
     * or left by an earlier moment in this session - so the menu lists them
     * rather than starting blank. Routes this store already tracks keep their
     * identity; only groups it has not seen are adopted.
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

        if (!this.selected) this._selectedId = this._routes[this._routes.length - 1]?.id || null;
    }

    /**
     * Appends a destination to the selected route, or starts one at `from`
     * when nothing is selected. Returns the route, or null if there was
     * nowhere to start from.
     */
    async addDestination(lngLat, label, { from, fromLabel } = {}) {
        let route = this.selected;

        if (!route) {
            if (!from) return null;
            route = this._create([[from.lng, from.lat]], [fromLabel || '']);
        }

        route.waypoints.push([lngLat.lng, lngLat.lat]);
        route.names.push(label || '');

        await this._resolve(route);
        return route;
    }

    /** Takes a route someone else already fetched (search's "X to Y"). */
    adopt(result, waypoints, names = []) {
        const route = this._create(waypoints.map(w => [...w]), [...names]);
        route.engine = result.source;
        route.profile = result.profile;
        this._apply(route, result);
        this._write(route.groupId);
        return route;
    }

    /** Drops one route, leaving every other route on the map alone. */
    remove(id) {
        const route = this._routes.find(r => r.id === id);
        if (!route) return;

        this._routes = this._routes.filter(r => r.id !== id);
        if (this._selectedId === id) {
            this._selectedId = this._routes[this._routes.length - 1]?.id || null;
        }
        this._write(route.groupId);
    }

    clearAll() {
        const groupIds = new Set(this._routes.map(r => r.groupId));
        this._routes = [];
        this._selectedId = null;
        groupIds.add(DIRECTIONS_LAYER_ID);
        groupIds.forEach(groupId => this._write(groupId));
    }

    _create(waypoints, names) {
        const route = {
            id: `route-${nextRouteNumber}`,
            number: nextRouteNumber++,
            groupId: DIRECTIONS_LAYER_ID,
            waypoints,
            names,
            engine: null,
            profile: getDirectionsProfile(),
            geojson: EMPTY_DATA,
            name: ''
        };
        route.name = routeName(route);
        this._routes.push(route);
        this._selectedId = route.id;
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
        this._write(route.groupId);
    }

    _apply(route, result) {
        route.result = result;
        route.geojson = buildRouteFeatureCollection(result, route.waypoints, {
            profile: result.profile,
            source: result.source,
            names: route.names
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

        // Several routes in one layer serialize as several `route:` entries.
        // url-manager.js joins layer entries with commas, so a comma-joined
        // _originalJson lands in `?layers=` as exactly those separate entries
        // and parses back as one layer each.
        const shorthand = routes
            .filter(r => r.waypoints.length >= 2)
            .map(r => routeShorthand(r.waypoints, r.engine, r.profile))
            .join(',');

        if (shorthand) group._originalJson = shorthand;
        else delete group._originalJson;

        window.urlManager?.updateURL({ updateLayers: true });
    }
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

    const route = {
        id,
        number: nextRouteNumber++,
        groupId,
        waypoints: points.map(p => [...p.geometry.coordinates]),
        names: points.map(p => p.properties.name || ''),
        engine: line?.properties?.source || null,
        profile: line?.properties?.profile || getDirectionsProfile(),
        geojson: { type: 'FeatureCollection', features },
        result: line?.properties || null,
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

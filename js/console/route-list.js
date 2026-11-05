/**
 * Find's routes (js/console/find-panel.js): the routes in the route store
 * (js/search/route-store.js) that match a query, by name or `route-<rid>` id.
 * Each is drawn as a route card (js/console/route-card.js).
 */
import { routeStore } from '../search/route-store.js';
import { routeTitle } from '../search/route-meta.js';

export function matchingRoutes(term = '') {
    const needle = term.toLowerCase();
    const routes = routeStore.routes;
    return routes.filter(route => !needle
        || [routeTitle(route, routes), route.name, `route-${route.rid}`].some(text => String(text || '').toLowerCase().includes(needle)));
}

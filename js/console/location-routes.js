/**
 * The routes a location is a stop on: a location in Find's Locations list
 * (js/console/find-results.js) is a waypoint when one or more routes run
 * through it, and carries a badge per route. A badge opens that route's card
 * in the Routes list with this stop highlighted in its diagram and on the map.
 */
import { el } from './find-rows.js';
import { routeSymbol } from './route-card.js';
import { liveRoutes } from './route-actions.js';
import { routeTitle } from '../search/route-meta.js';

/** Every route through the location, with the stop's place in it: [{ route, index }]. */
export function routesThrough(markerId, routes = liveRoutes()) {
    if (!markerId) return [];
    return routes
        .map(route => ({ route, index: route.markerIds?.indexOf(markerId) ?? -1 }))
        .filter(({ index }) => index >= 0);
}

/** A badge per route through the location, or null for a location on no route. */
export function routeBadges(markerId, onOpen) {
    const routes = liveRoutes();
    const stops = routesThrough(markerId, routes);
    if (!stops.length) return null;
    const wrap = el('span', 'location-route-badges');
    stops.forEach(({ route, index }) => {
        const badge = el('button', 'location-route-badge');
        badge.type = 'button';
        badge.title = `Stop ${index + 1} of ${routeTitle(route, routes)} - open the route`;
        badge.setAttribute('aria-label', badge.title);
        badge.appendChild(routeSymbol(route, { small: true }));
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            onOpen(route, index);
        });
        wrap.appendChild(badge);
    });
    return wrap;
}

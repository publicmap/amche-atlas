/**
 * Dropping a location's pin (js/location-pins.js) onto the open route: onto a
 * stop in its card's diagram (js/console/route-stops.js) it joins the route
 * there, before or after that stop; onto the diagram elsewhere it becomes the
 * last stop; onto the route's line on the map it joins where it adds least.
 * The location itself stays where it was - the drag was a gesture, not a move.
 * Only a location the open route doesn't already stop at can join it.
 */
import { routeStore } from './search/route-store.js';

const LINE_REACH = 8;

function openRoute(manager, markerId) {
    const route = manager._routeFilter ? routeStore.routes.find(r => r.id === manager._routeFilter) : null;
    return route && !route.markerIds.includes(markerId) ? route : null;
}

/** Where a pin let go at client point (x, y) would join the open route: `{route, at}`, `{route, nearest}` or null. */
export function dropTargetAt(manager, markerId, x, y) {
    const route = openRoute(manager, markerId);
    if (!route) return null;
    const card = [...document.querySelectorAll('.route-card.open')].find(node => node.dataset.routeId === route.id);
    const under = document.elementsFromPoint(x, y);
    const stop = under.map(node => node.closest?.('.route-stop')).find(node => node && card?.contains(node));
    if (stop) {
        const box = stop.getBoundingClientRect();
        const index = [...stop.parentElement.children].indexOf(stop);
        return { route, at: index + (y > box.top + box.height / 2 ? 1 : 0), stop };
    }
    if (card && under.some(node => node.closest?.('.route-card-body') && card.contains(node))) {
        return { route, at: route.waypoints.length };
    }
    const canvas = manager._map.getCanvas().getBoundingClientRect();
    const px = x - canvas.left;
    const py = y - canvas.top;
    if (px < 0 || py < 0 || px > canvas.width || py > canvas.height) return null;
    const onLine = manager._map.queryRenderedFeatures([[px - LINE_REACH, py - LINE_REACH], [px + LINE_REACH, py + LINE_REACH]])
        .some(f => f.properties?.kind === 'route' && f.properties.routeId === route.id);
    return onLine ? { route, nearest: true } : null;
}

/** Shows what letting go here would do: a line in the diagram, or "Add to <route>" by the pointer. */
export function showDropTarget(manager, target, x, y) {
    document.querySelectorAll('.route-stop.drop-before, .route-stop.drop-after')
        .forEach(node => node.classList.remove('drop-before', 'drop-after'));
    if (target?.stop) {
        const after = target.at > [...target.stop.parentElement.children].indexOf(target.stop);
        target.stop.classList.add(after ? 'drop-after' : 'drop-before');
    }
    if (target?.nearest) manager._showDropIndicator({ mode: 'map-route', route: target.route, x, y });
    else manager._hideDropIndicator();
}

/** Puts the location on the route, as `target` says. */
export function joinRoute(manager, markerId, target, lngLat) {
    const m = manager._markers.get(markerId);
    if (!m || !target) return;
    m.saved = true;
    manager._showSavedLabel(m);
    const { route } = target;
    const complete = route.markerIds.length === route.waypoints.length && route.markerIds.every(Boolean);
    if (target.nearest) routeStore.insertMarkerNearest(route.id, markerId, lngLat);
    else if (complete) routeStore.insertMarkerAt(route.id, route.markerIds, markerId, lngLat, target.at);
    else routeStore.addMarkerToRoute(route.id, markerId);
}

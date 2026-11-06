/**
 * What a route card (js/console/route-card.js) can do to its route. The card
 * may be drawn inside the layer editor's iframe (map-creator.html's legend),
 * so everything is reached through the window that owns the route store.
 */
import { routeTitle, routeSummary, routeColorOf } from '../search/route-meta.js';
import { pinColorOf } from '../location-pins.js';
import { showStopRings, clearStopRings } from '../route-stop-rings.js';

export function routeHost() {
    try {
        if (window.parent !== window && window.parent.routeStore) return window.parent;
    } catch (error) { /* cross-origin parent */ }
    return window.routeStore ? window : null;
}

const store = () => routeHost()?.routeStore;
const markers = () => routeHost()?.featureControl?._markerManager;

export function liveRoutes() {
    return store()?.routes || [];
}

export function findRoute(id) {
    return liveRoutes().find(r => r.id === id) || null;
}

/** The route's features as its layer draws them: what Download exports. */
export function routeFeatures(route) {
    return (route.geojson?.features || []).map(feature => ({
        ...feature,
        properties: {
            ...feature.properties,
            routeId: route.rid,
            rid: route.rid,
            routeName: routeTitle(route, liveRoutes()),
            color: routeColorOf(route),
            ...(feature.properties?.kind === 'waypoint' ? { markerId: markerUrlId(route.markerIds?.[feature.properties.index]) || feature.properties.markerId || null } : {})
        }
    }));
}

function markerUrlId(markerId) {
    return (markerId && markers()?.getMarkerUrlId?.(markerId)) || null;
}

// The stop picked out on an open route card, with distance rings round it on the map
let stopFocus = null;
// When a card last changed its route, so Find redraws to show it under the pointer
const EDIT_SETTLE_MS = 5000;
let editedAt = 0;
const edited = () => { editedAt = Date.now(); };

function ringAt(route, index) {
    const host = routeHost();
    const id = route.markerIds?.[index];
    const lngLat = id && host?.featureControl?._markerManager?._markers?.get(id)?.lngLat;
    showStopRings(host?.map, lngLat ? [lngLat.lng, lngLat.lat] : route.waypoints[index]);
}

export const routeActions = {
    select(id) { markers()?.selectRoute(id); },
    deselect(id) {
        if (stopFocus?.routeId === id) this.clearStopHighlight();
        markers()?.clearRouteSelection?.(id);
    },
    /** Picks out one stop of a route: in its card's diagram (route-stops.js) and with a ring on the map. */
    highlightStop(route, index) {
        stopFocus = { routeId: route.id, index };
        ringAt(route, index);
    },
    highlightedStop() { return stopFocus; },
    recentlyEdited() { return Date.now() - editedAt < EDIT_SETTLE_MS; },
    clearStopHighlight() {
        stopFocus = null;
        clearStopRings(routeHost()?.map);
    },
    hover(id) { markers()?.hoverRoute(id); },
    toggleHidden(route) { store()?.setRouteHidden(route.id, !route.hidden); },
    reverse(route) {
        edited();
        store()?.reverseRoute(route.id);
    },
    navigate(route) { routeHost()?.routeNavigation?.start(route); },
    share(route) { routeHost()?.shareViewPanel?.open({ route }); },
    download(route) {
        const host = routeHost();
        const title = routeTitle(route, liveRoutes());
        host?.exportControl?.openWithContext?.({
            layerId: route.groupId,
            title,
            subtitle: `${routeSummary(route)} · ${route.waypoints.length} stops`,
            color: routeColorOf(route),
            icon: 'signpost-split',
            kind: 'route',
            features: routeFeatures(route),
            useFor: 'gis'
        });
    },
    duplicate(route) {
        store()?.duplicateRoute(route.id, route.profile)
            .catch(error => console.warn('[route-card] Could not duplicate route:', error));
    },
    setProfile(route, profile) {
        store()?.setRouteProfile(route.id, profile)
            .catch(error => console.warn('[route-card] Could not switch profile:', error));
    },
    setColor(route, color) { store()?.setRouteColor(route.id, color); },
    remove(route) { markers()?.deleteRoute(route.id); },
    focusStop(route, index) {
        this.highlightStop(route, index);
        const id = route.markerIds?.[index];
        const point = route.waypoints[index];
        const map = routeHost()?.map;
        if (id && markers()?.hasMarker?.(id)) markers().focusMarker(id);
        else if (point) map?.flyTo({ center: point, zoom: Math.max(map.getZoom(), 15), duration: 600 });
    },
    moveStop(route, from, to) {
        if (from === to || route.markerIds.length !== route.waypoints.length) return;
        edited();
        store()?.moveStop(route.id, route.markerIds, from, to);
    },
    removeStop(route, index) {
        edited();
        const id = route.markerIds?.[index];
        if (id) store()?.removeMarkerFromRoute(route.id, id);
        else store()?.removeWaypoint(route.id, index, { keepMarkers: true });
    },
    savedLabel(markerId) { return markers()?.savedLabel(markerId) || null; },
    /** The saved locations the route doesn't stop at: [{id, label, color}]. */
    otherLocations(route) {
        const manager = markers();
        return [...(manager?._markers?.entries() || [])]
            .filter(([id, m]) => m.saved && !route.markerIds?.includes(id))
            .map(([id, m]) => ({ id, label: manager.savedLabel(id) || manager.getMarkerUrlId(id) || id, color: pinColorOf(m) }));
    },
    /** A location becomes the route's last stop. */
    addStop(route, markerId) {
        edited();
        store()?.addMarkerToRoute(route.id, markerId);
    },
    /** A location joins the route as the stop at position `at`. */
    insertStop(route, markerId, at) {
        const lngLat = markers()?._markers?.get(markerId)?.lngLat;
        const complete = route.markerIds?.length === route.waypoints.length && route.markerIds.every(Boolean);
        if (!lngLat || route.markerIds?.includes(markerId)) return;
        edited();
        if (complete) store()?.insertMarkerAt(route.id, route.markerIds, markerId, lngLat, at);
        else store()?.addMarkerToRoute(route.id, markerId);
    },
    /** Outlines the pin of a stop while it is pointed at in the diagram. */
    highlightPin(markerId, on) { if (markerId) markers()?._locationPins?.highlight(markerId, on); }
};

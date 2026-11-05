/**
 * What a route card says about a route (js/console/route-card.js): its
 * default name ("Cycling Route 2" - the travel mode, then the route's place
 * among that mode's routes), travel time and length, its ends, its stops, and
 * the other routes it shares a stop with.
 */
import { formatDistance, haversineDistanceMeters } from '../geo-distance-utils.js';
import { getDirectionsProfileInfo } from './directions-profile.js';
import { defaultRouteColor } from './route-geojson.js';

const SHARED_STOP_METERS = 25;

export function routeColorOf(route) {
    return route.color || defaultRouteColor(route);
}

export function routeLine(route) {
    return route.geojson?.features?.find(f => f.properties?.kind === 'route') || null;
}

export function profileLabel(profile) {
    return getDirectionsProfileInfo(profile)?.label || 'Route';
}

/** The route's place among the routes of its own travel mode, from 1. */
export function profileSerial(route, routes) {
    const same = routes.filter(r => r.profile === route.profile).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    return Math.max(1, same.indexOf(route) + 1);
}

export function routeTitle(route, routes = [route]) {
    if (route.title) return route.title;
    return `${profileLabel(route.profile)} Route ${profileSerial(route, routes)}`;
}

export function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return '';
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function routeTotals(route) {
    const props = routeLine(route)?.properties || {};
    const distance = route.result?.distance ?? props.distance;
    const duration = route.result?.duration ?? props.duration;
    return { distance, duration };
}

export function routeSummary(route) {
    const { distance, duration } = routeTotals(route);
    return [formatDuration(duration), Number.isFinite(distance) ? formatDistance(distance) : ''].filter(Boolean).join(' · ');
}

/** One leg's time and length, from stop `index` to the next. */
export function legSummary(route, index) {
    const leg = route.result?.legs?.[index];
    let meters = leg?.distance;
    if (meters == null) {
        const [a, b] = [route.waypoints[index], route.waypoints[index + 1]];
        if (!a || !b) return '';
        meters = haversineDistanceMeters({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] });
    }
    return [leg?.duration != null ? formatDuration(leg.duration) : '', formatDistance(meters)].filter(Boolean).join(' · ');
}

/** Each stop's label: its pin's saved name, else the name it was routed with, else the road it sits on. */
export function stopLabels(route, savedLabel = () => null) {
    const points = (route.geojson?.features || []).filter(f => f.properties?.kind === 'waypoint');
    return route.waypoints.map((_, index) => {
        const markerId = route.markerIds?.[index];
        const props = points.find(f => f.properties?.index === index)?.properties || {};
        return (markerId && savedLabel(markerId)) || route.names?.[index] || props.name || props.street
            || (index === 0 ? 'Start' : index === route.waypoints.length - 1 ? 'Destination' : `Stop ${index + 1}`);
    });
}

function sharesStop(a, b) {
    return a.waypoints.some((point, i) => b.waypoints.some((other, j) => {
        const [mine, theirs] = [a.markerIds?.[i], b.markerIds?.[j]];
        if (mine && theirs && mine === theirs) return true;
        return haversineDistanceMeters({ lng: point[0], lat: point[1] }, { lng: other[0], lat: other[1] }) < SHARED_STOP_METERS;
    }));
}

/** The other routes that pass through any of this route's stops. */
export function connectedRoutes(route, routes) {
    return routes.filter(other => other !== route && sharesStop(route, other));
}

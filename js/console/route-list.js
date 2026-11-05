/**
 * Find's Routes list (js/console/find-panel.js), opened from the console's
 * route button (js/map-control-bar.js). One row per route in the route store
 * (js/search/route-store.js) - its colour and travel mode, name, `route-<rid>`
 * id, mode and length. Picking a row does what its dock button does
 * (MapMarkerManager.selectRoute): shows only its stops and fits the map to it.
 * Each row also zooms to its route, opens it in Google Maps, or deletes it.
 */
import { el, row, icon, chevron } from './find-rows.js';
import { routeStore } from '../search/route-store.js';
import { routeButtonLabel, routeColor } from '../marker-dock-links.js';
import { DIRECTIONS_PROFILES } from '../search/directions-profile.js';
import { googleMapsDirectionsUrl } from '../external-map-links.js';

function routeThumb(route) {
    const thumb = el('span', 'console-thumb console-thumb-icon console-thumb-route');
    thumb.style.setProperty('--route-color', routeColor(route));
    const profile = DIRECTIONS_PROFILES.find(p => p.id === route.profile);
    thumb.appendChild(icon(profile?.icon || 'signpost-split'));
    return thumb;
}

export function matchingRoutes(term = '') {
    const needle = term.toLowerCase();
    return routeStore.routes.filter(route => !needle
        || [route.name, `route-${route.rid}`].some(text => String(text || '').toLowerCase().includes(needle)));
}

/** Opens the route as directions in Google Maps, as its dock button's action does. */
export function googleMapsButton(route, name = 'this route') {
    const url = googleMapsDirectionsUrl(route.waypoints, route.profile);
    const link = el('a', 'console-zoom console-external');
    link.title = `Open ${name} in Google Maps`;
    link.setAttribute('aria-label', link.title);
    link.appendChild(icon('google'));
    if (url) {
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
    } else link.setAttribute('aria-disabled', 'true');
    link.addEventListener('click', (e) => e.stopPropagation());
    return link;
}

export function routeRow(route, { onDone } = {}) {
    const markers = () => window.featureControl?._markerManager;
    const { name, meta } = routeButtonLabel(route);
    return row({
        thumb: routeThumb(route),
        title: route.name || name,
        meta: [name, meta].filter(Boolean).join(' · '),
        trailing: chevron(),
        onClick: () => {
            markers()?.selectRoute(route.id);
            onDone?.();
        },
        onEnter: () => markers()?.hoverRoute(route.id),
        onLeave: () => markers()?.hoverRoute(null)
    });
}

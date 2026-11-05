/**
 * A route opened in other map services, as close to the amche view as each
 * allows: the same stops in the same order, the same travel mode, and where a
 * service takes them the zoom and basemap. "Start with my location" begins the
 * directions wherever the visitor is, for services that can. Shown by the
 * Share panel (js/share-view-panel.js) when it is opened from a route card.
 */
import { externalMapLinks } from './external-map-links.js';

const GOOGLE_MODES = { driving: 'driving', walking: 'walking', cycling: 'bicycling' };
const GOOGLE_MAX_WAYPOINTS = 9;
const HERE_MODES = { driving: 'd', walking: 'w', cycling: 'b' };
const OSM_ENGINES = { driving: 'fossgis_osrm_car', walking: 'fossgis_osrm_foot', cycling: 'fossgis_osrm_bike' };
const APPLE_MODES = { driving: 'd', walking: 'w', cycling: 'c' };

const latLng = ([lng, lat]) => `${lat},${lng}`;

function googleUrl(stops, profile, fromMyLocation) {
    const params = new URLSearchParams({ api: '1', travelmode: GOOGLE_MODES[profile] || 'driving' });
    const destination = stops[stops.length - 1];
    const via = fromMyLocation ? stops.slice(0, -1) : stops.slice(1, -1);
    if (!fromMyLocation) params.set('origin', latLng(stops[0]));
    params.set('destination', latLng(destination));
    if (via.length) params.set('waypoints', via.slice(0, GOOGLE_MAX_WAYPOINTS).map(latLng).join('|'));
    return `https://www.google.com/maps/dir/?${params}`;
}

function hereUrl(stops, labels, profile, fromMyLocation, view) {
    const point = (stop, i) => `${latLng(stop)},${encodeURIComponent(labels[i] || `Stop ${i + 1}`)}`;
    const path = stops.map(point);
    if (fromMyLocation) path.unshift('mylocation');
    const params = new URLSearchParams({ a: '', m: HERE_MODES[profile] || 'd', z: String(view.zoom), t: view.satellite ? 'satellite' : 'normal' });
    return `https://share.here.com/r/${path.join('/')}?${params}`;
}

function osmUrl(stops, profile, view) {
    const route = `${latLng(stops[0])};${latLng(stops[stops.length - 1])}`;
    const params = new URLSearchParams({ engine: OSM_ENGINES[profile] || OSM_ENGINES.driving, route });
    return `https://www.openstreetmap.org/directions?${params}#map=${Math.round(view.zoom)}/${view.lat}/${view.lng}`;
}

function appleUrl(stops, profile, fromMyLocation, view) {
    const params = new URLSearchParams({ daddr: latLng(stops[stops.length - 1]), dirflg: APPLE_MODES[profile] || 'd', t: view.satellite ? 'k' : 'm' });
    if (!fromMyLocation) params.set('saddr', latLng(stops[0]));
    return `https://maps.apple.com/?${params}`;
}

/**
 * @param {Object} route - waypoints [[lng, lat], ...] and profile
 * @param {{labels?: string[], fromMyLocation?: boolean, view: {lat, lng, zoom, satellite}}} options
 * @returns {Array<{id, name, icon, url, note}>}
 */
export function routeMapLinks(route, { labels = [], fromMyLocation = true, view }) {
    const stops = route.waypoints || [];
    if (stops.length < 2) return [];
    const icons = Object.fromEntries(externalMapLinks(view.lat, view.lng, view.zoom).map(link => [link.id, link]));
    const many = stops.length > 2;
    const googleNote = stops.length - 2 > GOOGLE_MAX_WAYPOINTS ? `The first ${GOOGLE_MAX_WAYPOINTS + 2} stops` : 'Every stop';
    return [
        { id: 'google-maps', name: 'Google Maps', url: googleUrl(stops, route.profile, fromMyLocation), note: googleNote },
        { id: 'here-maps', name: 'HERE WeGo', url: hereUrl(stops, labels, route.profile, fromMyLocation, view), note: 'Every stop, zoom and basemap' },
        { id: 'osm', name: 'OpenStreetMap', url: osmUrl(stops, route.profile, view), note: many ? 'Start and destination only, from the start' : 'From the start' },
        { id: 'apple-maps', name: 'Apple Maps', url: appleUrl(stops, route.profile, fromMyLocation, view), note: many ? 'Destination only' : 'Start and destination' }
    ].map(link => ({ ...link, icon: icons[link.id]?.icon || null, lightIcon: icons[link.id]?.lightIcon }));
}

/** Whether a satellite basemap is on, so services that have one open on it too. */
export function satelliteShowing() {
    const active = window.browserControl?._getActiveLayers?.() || new Set();
    return [...active].some(id => /satellite/i.test(id));
}

/**
 * The shape of the route data every navigation result is written as, shared by
 * the live route the search/nearby "Navigate" actions draw (directions-layer.js)
 * and the routes authored straight into the URL as `route:` shorthand
 * (../route-url-api.js).
 *
 * One FeatureCollection holds both halves of a result:
 *  - a LineString carrying every property the Directions API returned for the
 *    route (distance, duration, weight, legs, …) plus the profile and provider
 *    it came from, so the geometry and its metadata travel together, and the
 *    pre-composed strings its two line labels are drawn from (`title`,
 *    `summary`, `travelText` — see routeLabels);
 *  - a Point per waypoint, tagged `role` start / waypoint / end, so the ends of
 *    a route are addressable and styleable on their own.
 *
 * ROUTE_STYLE and ROUTE_INSPECT mirror the `directions` layer in
 * config/index.atlas.json — shorthand-expanded routes are separate layers and
 * carry their own copy. Keep the two in step.
 */

import { formatDistance } from '../geo-distance-utils.js';
import { routingEngineProfileToken } from './directions-router.js';
import { encodeId } from '../shorthand-id-utils.js';

/** The atlas layer (config/index.atlas.json) the live route is drawn into. */
export const DIRECTIONS_LAYER_ID = 'directions';

const LOCATION_BLUE = '#1da1f2';

// Declaration order matters: js/mapbox-api.js stacks a style's prefixed
// variants above its unprefixed base, so the white casing (base) sits under the
// blue route line, which sits under the waypoint dots and their labels.
export const ROUTE_STYLE = {
    // Two labels riding the line itself, one above and one below. Zoomed out
    // there is no room for either in full, so only the travel time survives.
    // Every branch of a text-field `step` must be a definite string - a bare
    // ['get'] is `value`-typed and makes GL reject the whole property, which
    // silently drops the label. Hence to-string, as elsewhere in the configs.
    'title/symbol-placement': 'line-center',
    'title/text-field': ['step', ['zoom'], '', 12, ['to-string', ['get', 'title']]],
    'title/text-size': 12,
    'title/text-offset': [0, -1.1],
    'title/text-max-width': 30,
    'title/text-allow-overlap': true,
    'title/text-color': '#0b4f7a',
    'title/text-halo-color': '#ffffff',
    'title/text-halo-width': 2,
    'summary/symbol-placement': 'line-center',
    'summary/text-field': ['step', ['zoom'], ['to-string', ['get', 'travelText']], 12, ['to-string', ['get', 'summary']]],
    'summary/text-size': 12,
    'summary/text-offset': [0, 1.1],
    'summary/text-max-width': 30,
    'summary/text-allow-overlap': true,
    'summary/text-color': '#0b4f7a',
    'summary/text-halo-color': '#ffffff',
    'summary/text-halo-width': 2,
    // Points only: a circle layer otherwise draws at every vertex of the route
    // line, and a symbol layer labels each of them.
    'waypoints/filter': ['==', ['geometry-type'], 'Point'],
    // Terminals are the location-blue disc; intermediate stops are a small
    // white dot, so they read as beads on the route rather than endpoints.
    'waypoints/circle-radius': ['match', ['get', 'role'], 'waypoint', 3, 6],
    'waypoints/circle-color': ['match', ['get', 'role'], 'waypoint', '#ffffff', LOCATION_BLUE],
    'waypoints/circle-stroke-width': ['match', ['get', 'role'], 'waypoint', 1.5, 2],
    'waypoints/circle-stroke-color': ['match', ['get', 'role'], 'waypoint', LOCATION_BLUE, '#ffffff'],
    // Only the terminals are labelled; the stops in between are bare dots.
    'waypoints/text-field': ['case',
        ['==', ['get', 'role'], 'waypoint'], '',
        ['to-string', ['coalesce', ['get', 'label'], '']]
    ],
    'waypoints/text-size': 12,
    'waypoints/text-offset': [0, 1.4],
    'waypoints/text-halo-color': '#ffffff',
    'waypoints/text-halo-width': 1.5,
    // Direction of travel, repeated along the line. A ">" rather than an arrow
    // glyph because it is plain ASCII and certain to exist in any style's
    // glyphs; keep-upright off is what lets it turn to follow the line instead
    // of flipping to stay readable, which is the whole point of it.
    'arrows/symbol-placement': 'line',
    'arrows/symbol-spacing': 70,
    'arrows/text-field': '>',
    'arrows/text-size': 14,
    'arrows/text-rotation-alignment': 'map',
    'arrows/text-keep-upright': false,
    'arrows/text-allow-overlap': true,
    'arrows/text-ignore-placement': true,
    'arrows/text-color': '#ffffff',
    'arrows/text-halo-color': LOCATION_BLUE,
    'arrows/text-halo-width': 1,
    'route/line-color': LOCATION_BLUE,
    'route/line-width': 5,
    'route/line-opacity': 1,
    'route/line-cap': 'round',
    'route/line-join': 'round',
    'line-color': '#ffffff',
    'line-width': 9,
    'line-opacity': 0.9,
    'line-cap': 'round',
    'line-join': 'round',
    'text-field': ''
};

/**
 * Inspecting a route reads its derived display fields rather than the raw API
 * numbers - `distanceText`/`travelText`/`eta` are already formatted, and the
 * waypoint rows fall back to `role`.
 */
export const ROUTE_INSPECT = {
    id: 'id',
    title: 'Route',
    label: 'label',
    fields: ['distanceText', 'travelText', 'eta', 'mode', 'role', 'ref', 'street', 'source'],
    fieldTitles: ['Distance', 'Travel time', 'ETA', 'Mode', 'Waypoint', 'Ref', 'On road', 'Routed by']
};

/**
 * @param {Object} route - a Directions API route object (geometry + properties)
 * @param {Array<Array<number>>} waypoints - [lng, lat] per waypoint, in order
 * @param {Object} meta - { profile, source, names }
 */
export function buildRouteFeatureCollection(route, waypoints, { profile, source, names = [] } = {}) {
    // The API's own waypoint array is pulled out rather than spread onto the
    // line - it becomes the waypoint features below, and repeating it in the
    // line's properties would only duplicate it.
    const { geometry, waypoints: apiWaypoints = [], legs = [], ...routeProperties } = route;
    const labels = routeLabels(route, profile, names);
    const mode = MODE_WORDS[profile] || 'travel';

    // Cumulative distance from the route's start to each waypoint, walked off
    // the Directions API's own per-leg distances (leg[i] runs from waypoint i
    // to waypoint i+1) rather than re-measuring the geometry - so it matches
    // whatever the route actually traveled, not a straight line between stops.
    const cumulativeDistance = [0];
    legs.forEach(leg => cumulativeDistance.push(cumulativeDistance[cumulativeDistance.length - 1] + (leg.distance || 0)));

    const features = [{
        type: 'Feature',
        geometry,
        properties: {
            ...routeProperties,
            id: 'route',
            kind: 'route',
            profile,
            source,
            ...labels
        }
    }];

    waypoints.forEach((requested, index) => {
        const isStart = index === 0;
        const isEnd = index === waypoints.length - 1;
        const role = isStart ? 'start' : (isEnd ? 'end' : 'waypoint');

        // Sit on the route, not beside it: a request is snapped to the road
        // network, so the API's returned location is where the line actually
        // begins, ends or turns. `street` is the road it snapped to, which
        // stands in as a label when the caller supplied no name of its own.
        const snapped = apiWaypoints[index]?.location;
        const street = apiWaypoints[index]?.name || '';
        const name = names[index] || street;

        // `{mode}-{distanceText}` - the default, renameable half of this
        // stop's ref (see shorthand-id-utils.js's sanitizeRouteRefPrefix and
        // MapMarkerManager.setMarkerRefLabel). `distanceText` is how far into
        // the route this stop sits, not the route's total length, so two
        // stops on the same route never default to the same ref.
        const refPrefix = `${mode}-${formatDistance(cumulativeDistance[index] ?? 0)}`.replace(/\s+/g, '');

        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: snapped || requested },
            properties: {
                id: `waypoint-${index}`,
                kind: 'waypoint',
                role,
                index,
                // `{mode}-{distanceText}:{stop_no}`, e.g. "walking-1.2km:3" -
                // this stop's 1-based position on the route, prefixed with
                // this default label (search/route-store.js's _syncMarkers
                // substitutes a user-renamed prefix here instead, once one
                // exists), so every waypoint across every route on the map
                // has a short, unique, human-nameable reference (see
                // MapMarkerManager.setMarkerRefLabel, which renders it on the
                // waypoint's own pin).
                refPrefix,
                ref: `${refPrefix}:${index + 1}`,
                name,
                street,
                snapped: !!snapped,
                label: name || (isStart ? 'Start' : (isEnd ? 'Destination' : `Stop ${index}`)),
                // The destination carries the arrival, so the end of the line
                // can be labelled with it directly.
                ...(isEnd ? { eta: labels.eta, travelText: labels.travelText, distanceText: labels.distanceText } : {})
            }
        });
    });

    return { type: 'FeatureCollection', features };
}

const MODE_WORDS = {
    'driving-traffic': 'driving',
    driving: 'driving',
    walking: 'walking',
    cycling: 'cycling'
};

/**
 * The text the line labels are drawn from. Composed here rather than in a
 * style expression because neither clock arithmetic nor duration formatting is
 * expressible in one - the ETA is a snapshot taken when the route was fetched,
 * not a live countdown.
 */
function routeLabels(route, profile, names) {
    const from = names[0] || '';
    const to = names[names.length - 1] || '';
    const minutes = Math.max(1, Math.round(route.duration / 60));
    const mode = MODE_WORDS[profile] || 'travel';

    const distanceText = formatDistance(route.distance);
    const travelText = `${minutes} min ${mode}`;
    const eta = formatClockTime(new Date(Date.now() + route.duration * 1000));

    const title = from && to ? `${from} - ${to}` : '';
    const summary = `${distanceText} · ETA: ${eta} (${travelText})`;

    return { title, distanceText, travelText, eta, mode, summary, label: title || summary };
}

/** "5:19pm" - the compact form the line label needs. */
function formatClockTime(date) {
    return date
        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        .replace(/\s+/g, '')
        .toLowerCase();
}

/**
 * The compact `route-<rid>:` URL form for a route's waypoints, e.g.
 * "route-1:mapbox-walking(1,2)" (see ../route-url-api.js). The service and
 * profile that produced the route are named in the call, so the link
 * reproduces the same route rather than re-routing with whatever happens to
 * be the default. Waypoints are marker ids (../marker-registry.js), not raw
 * coordinates - referencing whatever marker each waypoint's pin currently is,
 * comma-separated like every other shorthand arg list (no pair-separator
 * needed, since each argument is a single id).
 */
export function routeShorthand(rid, markerIds, engine, profile) {
    // Percent-encoded for the same reason a `markers=` call token is (see
    // shorthand-id-utils.js's encodeId): an id may hold anything but the
    // grammar's own characters, and `layers=`'s reader decodes it back before
    // route-url-api.js splits this list apart.
    const waypoints = markerIds.map(encodeId).join(',');
    return `route-${rid}:${routingEngineProfileToken(engine, profile)}(${waypoints})`;
}

/** Bounds covering a route's line and waypoints, for fitBounds(). */
export function routeBounds(geometry) {
    const bounds = new mapboxgl.LngLatBounds();
    geometry.coordinates.forEach(coord => bounds.extend(coord));
    return bounds;
}

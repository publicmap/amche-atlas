import { getDirectionsProfile, getDirectionsProfileInfo } from './directions-profile.js'

/**
 * The routing services a route can be fetched from, keyed by the name used in
 * the `route:` URL shorthand's `<engine>-<profile>` token (see
 * ../route-url-api.js) - "mapbox-driving-traffic", "osrm-driving".
 *
 * Adding a service means one entry here: its profiles, its attribution, and a
 * `fetch` returning the API's own route object. Every engine's result lands in
 * the same route layer (see route-geojson.js), so nothing downstream needs to
 * know which one served it beyond the `source` stamped on the route.
 *
 * Engine names must not contain "-", since the token splits on the first one.
 */
export const ROUTING_ENGINES = {
    mapbox: {
        label: 'Mapbox Directions',
        attribution: "<a href='https://docs.mapbox.com/api/navigation/directions/' target='_blank'>Mapbox Directions</a>",
        // https://docs.mapbox.com/api/navigation/directions/#routing-profiles
        profiles: ['driving-traffic', 'driving', 'walking', 'cycling'],
        defaultProfile: 'driving',
        fetch: fetchFromMapbox
    },
    osrm: {
        label: 'OSRM',
        attribution: "<a href='https://project-osrm.org/' target='_blank'>OSRM</a>",
        // The public demo server only serves a car profile.
        profiles: ['driving'],
        defaultProfile: 'driving',
        fetch: fetchFromOSRM
    }
}

const DEFAULT_ENGINE = 'mapbox'

// Tried when the default engine fails or is rate-limited: no live traffic and
// driving only, but free and keyless.
const FALLBACK_ENGINE = 'osrm'

const MAPBOX_DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox'
const OSRM_DIRECTIONS_URL = 'https://router.project-osrm.org/route/v1'

/** Both APIs take waypoints as `lng,lat;lng,lat;…` in the path. */
function coordPath(waypoints) {
    return waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';')
}

/**
 * The whole route object is kept, not just the three fields the map draws:
 * everything the API returned (weight, legs, …) rides along into the route
 * layer's feature properties. `waypoints` is the API's own waypoint array -
 * each carrying the location it snapped the request to and the name of the
 * road it landed on - which is what the route layer's terminal points are
 * built from. See route-geojson.js.
 */
function toResult(route, source, profile, waypoints = []) {
    return { ...route, source, profile, waypoints }
}

async function fetchFromMapbox(waypoints, profile, signal) {
    const url = `${MAPBOX_DIRECTIONS_URL}/${profile}/${coordPath(waypoints)}` +
        `?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`Mapbox Directions failed: ${response.status}`)
    const data = await response.json()
    const route = data.routes?.[0]
    if (!route) throw new Error('Mapbox Directions returned no route')
    return toResult(route, 'mapbox', profile, data.waypoints)
}

async function fetchFromOSRM(waypoints, profile, signal) {
    const url = `${OSRM_DIRECTIONS_URL}/${profile}/${coordPath(waypoints)}?geometries=geojson&overview=full`
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`OSRM failed: ${response.status}`)
    const data = await response.json()
    const route = data.routes?.[0]
    if (!route) throw new Error('OSRM returned no route')
    return toResult(route, 'osrm', profile, data.waypoints)
}

/**
 * Splits a `<engine>-<profile>` token into its parts, e.g.
 * "mapbox-driving-traffic" → `{engine: 'mapbox', profile: 'driving-traffic'}`.
 * A token naming no known engine ("walking") is read as a profile on the
 * default engine, and a profile the engine doesn't serve falls back to that
 * engine's default rather than failing the whole route.
 */
export function parseRoutingEngineProfile(token) {
    if (!token) return { engine: DEFAULT_ENGINE, profile: null }

    const dash = token.indexOf('-')
    const head = dash > 0 ? token.slice(0, dash) : token
    const engineName = ROUTING_ENGINES[head] ? head : (ROUTING_ENGINES[token] ? token : null)

    const engine = engineName || DEFAULT_ENGINE
    let profile = engineName
        ? (engineName === token ? null : token.slice(engineName.length + 1))
        : token

    if (profile && !ROUTING_ENGINES[engine].profiles.includes(profile)) {
        console.warn(`[directions] ${ROUTING_ENGINES[engine].label} has no "${profile}" profile, using ${ROUTING_ENGINES[engine].defaultProfile}`)
        profile = ROUTING_ENGINES[engine].defaultProfile
    }

    return { engine, profile: profile || null }
}

/** The inverse: "mapbox" + "driving-traffic" → "mapbox-driving-traffic". */
export function routingEngineProfileToken(engine, profile) {
    return `${engine || DEFAULT_ENGINE}-${profile || ROUTING_ENGINES[engine || DEFAULT_ENGINE].defaultProfile}`
}

export function routingEngineAttribution(engine) {
    return (ROUTING_ENGINES[engine] || ROUTING_ENGINES[DEFAULT_ENGINE]).attribution
}

/**
 * Fetch a route through `waypoints` (2 or more `[lng, lat]` pairs, the ones in
 * between being intermediate stops).
 *
 * `engine` names a service in ROUTING_ENGINES; `profile` one of its routing
 * profiles, defaulting to whatever the user last picked in the Visible
 * Features menu (see directions-profile.js). Asking for an engine explicitly
 * is taken at its word - only the default engine falls back to another.
 *
 * @returns {Promise<Object>} the API's route object, plus `source` and `profile`
 */
export async function fetchRouteForWaypoints(waypoints, { signal, engine, profile } = {}) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
        throw new Error('A route needs at least two waypoints')
    }

    const engineName = ROUTING_ENGINES[engine] ? engine : DEFAULT_ENGINE
    const service = ROUTING_ENGINES[engineName]
    const resolvedProfile = profile && service.profiles.includes(profile)
        ? profile
        : (service.profiles.includes(getDirectionsProfile()) ? getDirectionsProfile() : service.defaultProfile)

    try {
        return await service.fetch(waypoints, resolvedProfile, signal)
    } catch (error) {
        if (error.name === 'AbortError') throw error
        if (engine || engineName === FALLBACK_ENGINE) throw error

        const fallback = ROUTING_ENGINES[FALLBACK_ENGINE]
        console.warn(`[directions] ${service.label} (${getDirectionsProfileInfo(resolvedProfile).label}) failed, falling back to ${fallback.label}:`, error.message)
        return fallback.fetch(waypoints, fallback.defaultProfile, signal)
    }
}

/**
 * Two-endpoint form, each endpoint `{ coordinates: [lng, lat] }` - what the
 * search control's "X to Y" matches resolve to.
 */
export async function fetchRoute(from, to, options = {}) {
    return fetchRouteForWaypoints([from.coordinates, to.coordinates], options)
}

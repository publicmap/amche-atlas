import { getDirectionsProfile, getDirectionsProfileInfo } from './directions-profile.js'

const MAPBOX_DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox'
const OSRM_DIRECTIONS_URL = 'https://router.project-osrm.org/route/v1'

// The public OSRM demo server only serves a car profile, so every Mapbox
// profile falls back to driving directions there.
const OSRM_PROFILE = 'driving'

function coordString(point) {
    return `${point.coordinates[0]},${point.coordinates[1]}`
}

async function fetchFromMapbox(from, to, profile, signal) {
    const url = `${MAPBOX_DIRECTIONS_URL}/${profile}/${coordString(from)};${coordString(to)}` +
        `?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`Mapbox Directions failed: ${response.status}`)
    const data = await response.json()
    const route = data.routes?.[0]
    if (!route) throw new Error('Mapbox Directions returned no route')
    return { geometry: route.geometry, distance: route.distance, duration: route.duration, source: 'mapbox', profile }
}

async function fetchFromOSRM(from, to, signal) {
    // Public demo server, no traffic data - used only as a fallback when
    // Mapbox Directions fails or is rate-limited.
    const url = `${OSRM_DIRECTIONS_URL}/${OSRM_PROFILE}/${coordString(from)};${coordString(to)}?geometries=geojson&overview=full`
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`OSRM failed: ${response.status}`)
    const data = await response.json()
    const route = data.routes?.[0]
    if (!route) throw new Error('OSRM returned no route')
    return { geometry: route.geometry, distance: route.distance, duration: route.duration, source: 'osrm', profile: OSRM_PROFILE }
}

/**
 * Fetch a route between two resolved endpoints (each
 * `{ coordinates: [lng, lat] }`), trying Mapbox Directions first and falling
 * back to OSRM (no live traffic, driving only, but free/keyless) if that fails.
 *
 * `profile` is a Mapbox routing profile
 * (https://docs.mapbox.com/api/navigation/directions/#routing-profiles);
 * it defaults to whatever the user last picked in the nearby-features menu
 * (see search/directions-profile.js).
 * @returns {Promise<{ geometry: object, distance: number, duration: number, source: string, profile: string }>}
 */
export async function fetchRoute(from, to, { signal, profile = getDirectionsProfile() } = {}) {
    try {
        return await fetchFromMapbox(from, to, profile, signal)
    } catch (mapboxError) {
        if (mapboxError.name === 'AbortError') throw mapboxError
        console.warn(`[directions] Mapbox Directions (${getDirectionsProfileInfo(profile).label}) failed, falling back to OSRM:`, mapboxError.message)
        return fetchFromOSRM(from, to, signal)
    }
}

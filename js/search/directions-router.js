const MAPBOX_DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving'
const OSRM_DIRECTIONS_URL = 'https://router.project-osrm.org/route/v1/driving'

function coordString(point) {
    return `${point.coordinates[0]},${point.coordinates[1]}`
}

async function fetchFromMapbox(from, to, signal) {
    const url = `${MAPBOX_DIRECTIONS_URL}/${coordString(from)};${coordString(to)}` +
        `?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`Mapbox Directions failed: ${response.status}`)
    const data = await response.json()
    const route = data.routes?.[0]
    if (!route) throw new Error('Mapbox Directions returned no route')
    return { geometry: route.geometry, distance: route.distance, duration: route.duration, source: 'mapbox' }
}

async function fetchFromOSRM(from, to, signal) {
    // Public demo server, no traffic data - used only as a fallback when
    // Mapbox Directions fails or is rate-limited.
    const url = `${OSRM_DIRECTIONS_URL}/${coordString(from)};${coordString(to)}?geometries=geojson&overview=full`
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`OSRM failed: ${response.status}`)
    const data = await response.json()
    const route = data.routes?.[0]
    if (!route) throw new Error('OSRM returned no route')
    return { geometry: route.geometry, distance: route.distance, duration: route.duration, source: 'osrm' }
}

/**
 * Fetch a driving route between two resolved endpoints (each
 * `{ coordinates: [lng, lat] }`), trying Mapbox Directions first and falling
 * back to OSRM (no live traffic, but free/keyless) if that fails.
 * @returns {Promise<{ geometry: object, distance: number, duration: number, source: string }>}
 */
export async function fetchRoute(from, to, { signal } = {}) {
    try {
        return await fetchFromMapbox(from, to, signal)
    } catch (mapboxError) {
        if (mapboxError.name === 'AbortError') throw mapboxError
        console.warn('[directions] Mapbox Directions failed, falling back to OSRM:', mapboxError.message)
        return fetchFromOSRM(from, to, signal)
    }
}

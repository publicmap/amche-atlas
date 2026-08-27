const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse'
const MAX_CACHE_ENTRIES = 200
const BACKOFF_MS = 60000

// Nominatim's usage policy requires caching results and flags repeated
// identical queries as faulty use, so identical lookups are served from here
// instead of re-fetching.
const resultCache = new Map()

// A 429 or a blocked/failed fetch means this origin is already over Nominatim's
// rate limit; retrying immediately only makes that worse, so back off instead
// of hitting the network again until this cools down. Shared across every
// caller (forward search here, plus the reverse-geocode call sites in
// map-init.js, map-export-control.js and map-attribution-control.js) since
// they all draw on the same nominatim.openstreetmap.org quota for this origin.
let blockedUntil = 0

export function isNominatimBackedOff() {
    return Date.now() < blockedUntil
}

export function reportNominatimFailure() {
    blockedUntil = Date.now() + BACKOFF_MS
}

function shortLabel(displayName) {
    return (displayName || '').split(',')[0].trim() || displayName || ''
}

export function nominatimResultToFeature(result) {
    const lat = parseFloat(result.lat)
    const lon = parseFloat(result.lon)
    const label = result.display_name || ''

    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
            name: shortLabel(label),
            place_name: label,
            place_type: [result.type || result.class || 'place'],
            text: shortLabel(label),
            _isLocalSuggestion: true,
            _isNominatim: true,
            _locationString: label,
            _boundingbox: Array.isArray(result.boundingbox) ? result.boundingbox.map(Number) : null,
        },
    }
}

export function nominatimViewboxFromBounds(bounds) {
    if (!bounds) return null
    const sw = bounds.getSouthWest()
    const ne = bounds.getNorthEast()
    return `${sw.lng},${ne.lat},${ne.lng},${sw.lat}`
}

export async function queryNominatim(query, { limit = 5, countrycodes = 'in', viewbox = null, signal } = {}) {
    const trimmed = (query || '').trim()
    if (!trimmed) return []

    const params = new URLSearchParams({
        q: trimmed,
        format: 'jsonv2',
        addressdetails: '0',
        limit: String(limit),
    })
    if (countrycodes) params.set('countrycodes', countrycodes)
    if (viewbox) params.set('viewbox', viewbox)

    const cacheKey = params.toString()
    if (resultCache.has(cacheKey)) {
        return resultCache.get(cacheKey)
    }

    if (isNominatimBackedOff()) return []

    let response
    try {
        response = await fetch(`${NOMINATIM_SEARCH_URL}?${cacheKey}`, {
            headers: { 'Accept-Language': 'en' },
            signal,
        })
    } catch (err) {
        if (err.name !== 'AbortError') reportNominatimFailure()
        throw err
    }

    if (!response.ok) {
        reportNominatimFailure()
        throw new Error(`Nominatim search failed: ${response.status}`)
    }

    const results = await response.json()
    const features = Array.isArray(results) ? results.map(nominatimResultToFeature) : []

    if (resultCache.size >= MAX_CACHE_ENTRIES) {
        resultCache.delete(resultCache.keys().next().value)
    }
    resultCache.set(cacheKey, features)

    return features
}

export async function reverseGeocodeNominatim(lat, lon, zoom = 16, { signal } = {}) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return null

    const latRounded = Math.round(lat * 100000) / 100000
    const lonRounded = Math.round(lon * 100000) / 100000
    const nominatimZoom = Math.max(0, Math.min(18, Math.round(zoom)))

    const params = new URLSearchParams({
        format: 'jsonv2',
        lat: String(latRounded),
        lon: String(lonRounded),
        zoom: String(nominatimZoom),
    })

    const cacheKey = `reverse:${params.toString()}`
    if (resultCache.has(cacheKey)) {
        return resultCache.get(cacheKey)
    }

    if (isNominatimBackedOff()) return null

    let response
    try {
        response = await fetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`, {
            headers: { 'Accept-Language': 'en' },
            signal,
        })
    } catch (err) {
        if (err.name !== 'AbortError') reportNominatimFailure()
        throw err
    }

    if (!response.ok) {
        reportNominatimFailure()
        throw new Error(`Nominatim reverse geocode failed: ${response.status}`)
    }

    const result = await response.json()
    const feature = result && result.display_name ? nominatimResultToFeature(result) : null

    if (resultCache.size >= MAX_CACHE_ENTRIES) {
        resultCache.delete(resultCache.keys().next().value)
    }
    resultCache.set(cacheKey, feature)

    return feature
}

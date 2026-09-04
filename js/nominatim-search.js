const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse'
const NOMINATIM_DETAILS_URL = 'https://nominatim.openstreetmap.org/details'
const OSM_OBJECT_URL = 'https://www.openstreetmap.org'

// Nominatim writes osm_type as a full word in reverse/search results and as a
// single letter in /details, and takes the letter form as a parameter.
const OSM_TYPE_LETTERS = { node: 'N', way: 'W', relation: 'R' }
const OSM_TYPE_WORDS = { N: 'node', W: 'way', R: 'relation' }
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

/**
 * Reverse geocode a point *with* its address components.
 *
 * Kept separate from reverseGeocodeNominatim, which existing callers use only
 * for a display name: this one asks for addressdetails and hands back
 * Nominatim's `address` object as an ordered list. Nominatim orders it
 * most-specific first (POI, house number, road, suburb, … country), so "the
 * detailed part of the address" is just the head of the list.
 *
 * `zoom` is Nominatim's own detail level, NOT the map's zoom - passing the map
 * zoom is what makes a point resolve to "Panaji" instead of the shop standing
 * on it. 18 is its finest setting (building/POI level) and is what every
 * caller should want; anything lower deliberately answers with a coarser
 * place.
 *
 * @returns {Promise<{text: string, parts: Array<{key: string, value: string}>,
 *   osmType: string|null, osmId: string|null, displayName: string} | null>}
 */
export async function reverseGeocodeAddress(lat, lon, { zoom = 18, detail = 2, signal } = {}) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return null

    const params = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        lat: String(Math.round(lat * 100000) / 100000),
        lon: String(Math.round(lon * 100000) / 100000),
        zoom: String(Math.max(0, Math.min(18, Math.round(zoom)))),
    })

    const cacheKey = `address:${params.toString()}`
    if (resultCache.has(cacheKey)) return resultCache.get(cacheKey)
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
    const address = result?.address || null

    let value = null
    if (address) {
        // ISO codes and postcodes aren't places anyone reads as an address part.
        const skip = new Set(['ISO3166-2-lvl4', 'country_code', 'postcode'])
        const parts = Object.entries(address)
            .filter(([key, v]) => v && !skip.has(key))
            .map(([key, v]) => ({ key, value: String(v) }))

        // A matched POI usually appears in `address` under its own category
        // key ("tourism", "shop", …). When it doesn't, the object's name is
        // still the most specific thing known about the point, so lead with it
        // rather than starting at the road it stands on.
        if (result.name && !parts.some(part => part.value === result.name)) {
            parts.unshift({ key: result.type || result.category || 'place', value: result.name })
        }

        value = {
            text: formatNominatimAddress(parts, detail),
            parts,
            osmType: result.osm_type || null,
            osmId: result.osm_id != null ? String(result.osm_id) : null,
            displayName: result.display_name || '',
        }
    }

    if (resultCache.size >= MAX_CACHE_ENTRIES) {
        resultCache.delete(resultCache.keys().next().value)
    }
    resultCache.set(cacheKey, value)

    return value
}

/** The leading (most specific) `count` parts, joined for a one-line label. */
export function formatNominatimAddress(parts, count = 2) {
    return (parts || []).slice(0, count).map(part => part.value).join(', ')
}

/** openstreetmap.org URL for an OSM object, from either osm_type spelling. */
export function osmObjectUrl(osmType, osmId) {
    if (!osmType || osmId == null) return null
    const word = OSM_TYPE_WORDS[osmType] || String(osmType).toLowerCase()
    if (!OSM_TYPE_LETTERS[word]) return null
    return `${OSM_OBJECT_URL}/${word}/${osmId}`
}

/**
 * The full address hierarchy behind a reverse-geocoded place, each level
 * carrying its own OSM object so it can be linked back to openstreetmap.org -
 * which the flat `address` object from reverse geocoding can't do, since it is
 * only names. A second request, so callers should make it lazily (when the
 * user actually opens the address) rather than for every point.
 *
 * @returns {Promise<Array<{name: string, url: string|null, category: string,
 *   adminLevel: number|null}>>}
 */
export async function fetchNominatimAddressParts(osmType, osmId, { signal } = {}) {
    const letter = OSM_TYPE_LETTERS[String(osmType || '').toLowerCase()]
    if (!letter || osmId == null) return []

    const params = new URLSearchParams({
        osmtype: letter,
        osmid: String(osmId),
        addressdetails: '1',
        format: 'json',
    })

    const cacheKey = `details:${params.toString()}`
    if (resultCache.has(cacheKey)) return resultCache.get(cacheKey)
    if (isNominatimBackedOff()) return []

    let response
    try {
        response = await fetch(`${NOMINATIM_DETAILS_URL}?${params.toString()}`, {
            headers: { 'Accept-Language': 'en' },
            signal,
        })
    } catch (err) {
        if (err.name !== 'AbortError') reportNominatimFailure()
        throw err
    }

    if (!response.ok) {
        reportNominatimFailure()
        throw new Error(`Nominatim details failed: ${response.status}`)
    }

    const result = await response.json()
    // Already most-specific-first, matching the order reverse geocoding gives.
    // Entries with no OSM object of their own (postcode, country) come back
    // with a null url rather than being dropped - they are part of the address.
    const parts = (result?.address || [])
        .filter(entry => entry?.localname && entry.isaddress !== false)
        .map(entry => ({
            name: entry.localname,
            url: osmObjectUrl(entry.osm_type, entry.osm_id),
            category: entry.type || entry.class || '',
            adminLevel: entry.admin_level ?? null,
        }))

    if (resultCache.size >= MAX_CACHE_ENTRIES) {
        resultCache.delete(resultCache.keys().next().value)
    }
    resultCache.set(cacheKey, parts)

    return parts
}

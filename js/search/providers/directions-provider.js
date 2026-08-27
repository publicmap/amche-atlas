import { queryNominatim } from '../../nominatim-search.js'
import { parseCoordinateInput } from '../coordinate-parser.js'
import { parseDirectionsQuery } from '../directions-query.js'

const DEBOUNCE_MS = 1000
const CURRENT_LOCATION_PATTERN = /^(current location|here|my location)$/i

/**
 * Resolve one side of a "X to Y" query to a point: current-view center,
 * a raw coordinate, or (falling back to Nominatim) a named place. Reuses
 * the same parsing/lookup building blocks as the rest of the search box
 * rather than a separate geocoding path.
 */
async function resolveEndpoint(text, map, signal) {
    if (!text || CURRENT_LOCATION_PATTERN.test(text.trim())) {
        const center = map.getCenter()
        return { coordinates: [center.lng, center.lat], label: 'current location' }
    }

    const coordinateResult = parseCoordinateInput(text)
    if (coordinateResult) {
        return { coordinates: [coordinateResult.lng, coordinateResult.lat], label: text }
    }

    let features = await queryNominatim(text, { limit: 1, signal })
    if (!features.length) {
        // Same India-scoped-then-global widening as nominatim-provider.js.
        features = await queryNominatim(text, { limit: 1, countrycodes: null, signal })
    }
    if (!features.length) return null
    return { coordinates: features[0].geometry.coordinates, label: features[0].properties.name }
}

/**
 * Detects a "directions" intent in the typed query and, once both endpoints
 * resolve, offers a single "Directions: A -> B" suggestion alongside
 * whatever else is showing (see directions-query.js for why this never
 * forces itself over normal place results). Debounced like the Nominatim
 * provider since resolving endpoints can hit the same API.
 */
export function createDirectionsProvider() {
    let pendingQuery = null
    let debounceTimeout = null
    let abortController = null

    function cancel() {
        pendingQuery = null
        clearTimeout(debounceTimeout)
        if (abortController) {
            abortController.abort()
            abortController = null
        }
    }

    /**
     * @param {string} query
     * @param {Object} options
     * @param {mapboxgl.Map} options.map
     * @param {(items: object[]) => void} options.onResult
     */
    function search(query, { map, onResult }) {
        const parsed = parseDirectionsQuery(query)
        cancel()
        if (!parsed) return

        pendingQuery = query
        debounceTimeout = setTimeout(async () => {
            if (pendingQuery !== query) return

            const controller = new AbortController()
            abortController = controller

            try {
                const [from, to] = await Promise.all([
                    resolveEndpoint(parsed.fromText, map, controller.signal),
                    resolveEndpoint(parsed.toText, map, controller.signal)
                ])
                if (pendingQuery !== query) return
                if (!from || !to) return

                onResult([{
                    _searchResultType: 'directions',
                    icon: '🧭',
                    from,
                    to,
                    properties: {
                        name: `Directions: ${from.label} → ${to.label}`,
                        place_name: 'Route'
                    }
                }])
            } catch (err) {
                if (err.name !== 'AbortError') console.error('[directions]', err)
            }
        }, DEBOUNCE_MS)
    }

    return { type: 'directions', search, cancel }
}

import { queryNominatim, nominatimViewboxFromBounds } from '../../nominatim-search.js'

const NOMINATIM_DEBOUNCE_MS = 1000
const MIN_NOMINATIM_QUERY_LENGTH = 3

/**
 * Debounced, abortable Nominatim place-search provider. Owns its own request
 * policy (debounce + single in-flight request) so search-controller.js only
 * has to call search()/cancel() without knowing about Nominatim's usage
 * policy constraints (see nominatim-search.js for why those exist).
 */
export function createNominatimProvider() {
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
     * @param {mapboxgl.LngLatBounds} options.bounds - used to bias results toward the current view
     * @param {(features: object[]) => void} options.onResult - called only if this query is still current
     */
    function search(query, { bounds, onResult }) {
        pendingQuery = query
        clearTimeout(debounceTimeout)
        if (abortController) abortController.abort()

        if (query.trim().length < MIN_NOMINATIM_QUERY_LENGTH) return

        debounceTimeout = setTimeout(() => {
            if (pendingQuery !== query) return

            const controller = new AbortController()
            abortController = controller
            const viewbox = nominatimViewboxFromBounds(bounds)

            queryNominatim(query, { viewbox, signal: controller.signal })
                .then(async features => {
                    if (pendingQuery !== query) return

                    // Default scope is "around the current view", narrowed to
                    // India (queryNominatim's own default) - auto-widen to an
                    // unscoped global search only when that finds nothing, so
                    // a genuinely worldwide query still works without adding
                    // any scope UI to the search box itself.
                    if (features.length === 0) {
                        features = await queryNominatim(query, {
                            viewbox,
                            countrycodes: null,
                            signal: controller.signal
                        })
                        if (pendingQuery !== query) return
                    }

                    onResult(features)
                })
                .catch(err => {
                    if (err.name !== 'AbortError') console.error('[nominatim]', err)
                })
        }, NOMINATIM_DEBOUNCE_MS)
    }

    return { type: 'place', search, cancel }
}

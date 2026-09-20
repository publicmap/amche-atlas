const SUGGEST_URL = 'https://api.mapbox.com/search/searchbox/v1/suggest'
const RETRIEVE_URL = 'https://api.mapbox.com/search/searchbox/v1/retrieve'
const SUGGEST_DEBOUNCE_MS = 150
const MIN_QUERY_LENGTH = 3

function createSessionToken() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

function toSuggestionItem(raw) {
    return {
        properties: {
            name: raw.name,
            place_name: raw.place_formatted || raw.full_address || ''
        },
        icon: '📍',
        _searchResultType: 'mapbox-place',
        _raw: raw
    }
}

/**
 * Mapbox Search Box `suggest`/`retrieve` calls made directly against the
 * public REST API, mirroring nominatim-provider.js's own-fetch pattern,
 * instead of going through <mapbox-search-box>'s internal session (its own
 * suggest results are discarded - see map-search-control.js's
 * shouldBypassSearchSuggest - because its native dropdown, which normally
 * shows them, is hidden in favor of the shared suggestions panel).
 *
 * Owns a single session token across a suggest/retrieve pair, matching
 * Mapbox's session-based billing model, and rotates it after each retrieve.
 */
export function createMapboxPlaceProvider({ accessToken, language = 'en' } = {}) {
    // window.amche.rawFetch (set up in index.html, before the search-js CDN
    // script loads) bypasses the fetch() patch that intercepts this exact
    // endpoint for the <mapbox-search-box> widget's own internal suggest call
    // - without it, our own suggest/retrieve calls would be swallowed too.
    const doFetch = (...args) => (window.amche?.rawFetch || fetch)(...args)

    let sessionToken = createSessionToken()
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
     * @param {string} [options.proximity] - "lng,lat"
     * @param {string} [options.types]
     * @param {(items: object[]) => void} options.onResult - called only if this query is still current
     */
    function search(query, { proximity, types, onResult }) {
        pendingQuery = query
        clearTimeout(debounceTimeout)
        if (abortController) abortController.abort()

        if (!query || query.trim().length < MIN_QUERY_LENGTH) return

        debounceTimeout = setTimeout(() => {
            if (pendingQuery !== query) return

            const controller = new AbortController()
            abortController = controller

            const params = new URLSearchParams({
                q: query,
                access_token: accessToken,
                session_token: sessionToken,
                language
            })
            if (proximity) params.set('proximity', proximity)
            if (types) params.set('types', types)

            doFetch(`${SUGGEST_URL}?${params.toString()}`, { signal: controller.signal })
                .then(res => res.json())
                .then(data => {
                    if (pendingQuery !== query) return
                    onResult((data.suggestions || []).map(toSuggestionItem))
                })
                .catch(err => {
                    if (err.name !== 'AbortError') console.error('[mapbox-place]', err)
                })
        }, SUGGEST_DEBOUNCE_MS)
    }

    /**
     * Resolves a suggestion returned by search() into a full GeoJSON feature.
     * @param {object} item - an item produced by search()
     * @returns {Promise<object|null>}
     */
    async function retrieve(item) {
        const raw = item?._raw
        if (!raw?.mapbox_id) return null

        const params = new URLSearchParams({
            access_token: accessToken,
            session_token: sessionToken,
            language
        })

        const res = await doFetch(`${RETRIEVE_URL}/${encodeURIComponent(raw.mapbox_id)}?${params.toString()}`)
        const data = await res.json()

        // A retrieve ends the session per Mapbox's billing model - the next
        // suggest call starts a fresh one.
        sessionToken = createSessionToken()

        return data?.features?.[0] || null
    }

    return { type: 'mapbox-place', search, retrieve, cancel }
}

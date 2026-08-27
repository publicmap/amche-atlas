import { queryCadastralPlots, parseCadastralQuery, isCadastralSearchEnabled } from '../../cadastral-search.js'

/**
 * Goa cadastral (village + survey no.) plot-search provider, backed by the
 * statewide parquet file. No debounce needed - lookups are local/fast once
 * the parquet is warm (see cadastral-search.js's lazyInit/prewarmCadastral).
 */
export function createCadastralProvider() {
    let pendingQuery = null

    function cancel() {
        pendingQuery = null
    }

    /**
     * @param {string} query - raw input, used only to guard against stale results
     * @param {{ village: string, surveyRaw: string }} parsed - from parseCadastralQuery()
     * @param {(features: object[]) => void} onResult - called only if this query is still current
     */
    function search(query, parsed, onResult) {
        pendingQuery = query

        queryCadastralPlots(parsed.village, parsed.surveyRaw)
            .then(features => {
                if (pendingQuery !== query) return
                onResult(features)
            })
            .catch(err => console.error('[cadastral]', err))
    }

    return { type: 'parcel', isEnabled: isCadastralSearchEnabled, parseQuery: parseCadastralQuery, search, cancel }
}

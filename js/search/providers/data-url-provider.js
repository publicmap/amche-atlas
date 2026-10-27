import { detectLayerSourceType, SOURCE_TYPE_LABELS } from '../../layer-source-resolver.js'

const URL_PATTERN = /^(https?|mapbox):\/\/\S+$/i

/**
 * A pasted data link (GeoJSON, CSV, tiles, WMS, a Google Sheet, an atlas
 * JSON, ...): offered as a single "Open in layer editor" result, which hands
 * the link to map-creator.html (MapBrowserControl.openCreatorWithUrl) where
 * it loads through the same path as the editor's own URL box. Detection is
 * layer-source-resolver.js's, so the label matches the editor's; a link it
 * doesn't recognize is still offered, since the editor sniffs its content type.
 */
export function createDataUrlProvider() {
    function parse(query) {
        const url = (query || '').trim()
        if (!URL_PATTERN.test(url)) return null

        const label = SOURCE_TYPE_LABELS[detectLayerSourceType(url)] || 'data link'
        return {
            _searchResultType: 'data-url',
            url,
            properties: { name: `Open ${label} in layer editor`, place_name: url }
        }
    }

    return { type: 'data-url', parse }
}

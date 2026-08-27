const MAX_RESULTS = 8

/**
 * A marker's display label: its note text if it has one (the same field the
 * marker's own comment box reads, feature.properties.notes - see
 * map-marker-manager.js's _findNoteEntry/_buildCommentSectionHTML), else the
 * label of the first feature it was created from, else its coordinates -
 * mirroring exactly how map-marker-manager.js's _updateSelectionLayer()
 * names each marker in the persisted GeoJSON mirror.
 */
function markerLabel(stateManager, markerData) {
    const noteEntry = markerData.features?.find(f => {
        const layerConfig = stateManager?.getLayerConfig(f.layerId)
        return layerConfig?.type === 'csv' && (layerConfig.saveUrl || window.GOOGLE_SHEETS_SAVE_URL)
    })
    const note = noteEntry?.feature?.properties?.notes
    if (note) return note

    const first = markerData.features?.[0]
    if (first && stateManager) {
        const layerConfig = stateManager.getLayerConfig(first.layerId)
        const inspectConfig = layerConfig?.inspect || {}
        const labelField = inspectConfig.label || inspectConfig.id || 'id'
        const value = first.feature?.properties?.[labelField] ?? first.feature?.id
        if (value) return String(value)
    }

    return `${markerData.lngLat.lat.toFixed(4)}, ${markerData.lngLat.lng.toFixed(4)}`
}

/**
 * Search over markers/notes the user has already placed on the map
 * (js/map-marker-manager.js's MapMarkerManager). There's no public
 * enumeration API on that class, so this reads its private `_markers` Map
 * directly - the same "reach into window.featureControl/_markerManager"
 * convention already used throughout this codebase (url-manager.js,
 * map-nearby-features-control.js, etc. all do this for related state).
 */
export function createMarkerProvider() {
    function search(query) {
        const term = (query || '').trim().toLowerCase()
        const markerManager = window.featureControl?._markerManager
        if (!term || !markerManager?._markers) return []

        const stateManager = window.featureControl?._stateManager
        const results = []

        for (const [markerId, markerData] of markerManager._markers) {
            const label = markerLabel(stateManager, markerData)
            if (!label.toLowerCase().includes(term)) continue

            results.push({
                _searchResultType: 'marker',
                icon: '📍',
                markerId,
                markerLngLat: markerData.lngLat,
                properties: { name: label, place_name: 'Your marker' }
            })
            if (results.length >= MAX_RESULTS) break
        }

        return results
    }

    return { type: 'marker', search }
}

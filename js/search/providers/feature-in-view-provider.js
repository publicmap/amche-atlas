const MAX_RESULTS = 8

/**
 * Resolve a rendered feature's display label the same way
 * map-nearby-features-control.js and map-marker-manager.js already do:
 * the layer's configured `inspect.label` (or `inspect.id`, or 'id') property.
 */
function describeFeature(stateManager, f) {
    const layerConfig = stateManager.getLayerConfig(f.layerId)
    const inspectConfig = layerConfig?.inspect || {}
    const labelField = inspectConfig.label || inspectConfig.id || 'id'
    const value = f.feature?.properties?.[labelField] ?? f.feature?.id ?? 'Feature'
    return { label: String(value), layerTitle: layerConfig?.title || f.layerId }
}

/**
 * Search over features from currently-active layers rendered in the current
 * viewport - i.e. things already on screen. Reuses
 * MapFeatureStateManager.getFeaturesInView() (js/map-feature-state-manager.js),
 * the same data source js/map-nearby-features-control.js's "nearby features"
 * panel is built on, so results and their labels are consistent with it.
 */
export function createFeatureInViewProvider() {
    function search(query) {
        const term = (query || '').trim().toLowerCase()
        const stateManager = window.featureControl?._stateManager
        if (!term || !stateManager) return []

        return stateManager.getFeaturesInView()
            .map(f => ({ f, ...describeFeature(stateManager, f) }))
            .filter(({ label }) => label.toLowerCase().includes(term))
            .slice(0, MAX_RESULTS)
            .map(({ f, label, layerTitle }) => ({
                _searchResultType: 'map-feature',
                icon: '📌',
                mapFeature: f,
                properties: {
                    name: label,
                    place_name: `On map · ${layerTitle}`
                }
            }))
    }

    return { type: 'map-feature', search }
}

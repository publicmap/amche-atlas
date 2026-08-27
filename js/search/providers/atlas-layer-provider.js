const MAX_ATLAS_RESULTS = 4
const MAX_LAYER_RESULTS = 6

function atlasResultItem(atlasId, meta) {
    return {
        _searchResultType: 'atlas',
        icon: '🗺️',
        atlasId,
        properties: {
            name: meta?.name || atlasId,
            place_name: 'Atlas'
        }
    }
}

function layerResultItem(layer, { placeName, action = 'add' } = {}) {
    const atlasName = layer._sourceAtlas
        ? (window.layerRegistry?.getAtlasMetadata(layer._sourceAtlas)?.name || layer._sourceAtlas)
        : null

    return {
        _searchResultType: 'layer',
        icon: '🧩',
        layer,
        action, // 'add' or 'remove' - fixed per section, not re-detected at select time (see below)
        properties: {
            name: layer.title || layer.name || layer.id,
            place_name: placeName || (atlasName ? `Layer · ${atlasName}` : 'Layer')
        }
    }
}

/**
 * In-memory search over the atlas/layer registry (js/layer-registry.js) and
 * the currently-active layers (js/map-layer-controls.js's window.layerControl).
 * Everything here is synchronous - no network, no debounce.
 */
export function createAtlasLayerProvider() {
    /**
     * Ids of layers already present in the map's active state, exactly as
     * map-layer-controls.js's own _showCrossAtlasSearchResults() computes
     * "currentLayerIds" to avoid offering a duplicate add.
     */
    function currentLayerIds() {
        const groups = window.layerControl?._state?.groups || []
        return new Set(groups.map(g => g._prefixedId || g.id))
    }

    function search(query) {
        const term = (query || '').trim().toLowerCase()
        const registry = window.layerRegistry
        if (!term || !registry) return []

        const atlasMatches = registry.getAllAtlasMetadata()
            .filter(([id, meta]) => (meta?.name || id).toLowerCase().includes(term))
            .slice(0, MAX_ATLAS_RESULTS)
            .map(([id, meta]) => atlasResultItem(id, meta))

        // Layers already active are excluded here (not offered as "add" results)
        // rather than detected as "already active" at select time - see
        // getActiveLayers() below for why: once a layer is added via the
        // cross-atlas path, its index in _state.groups no longer lines up with
        // window.layerControl._sourceControls, so re-checking DOM checkbox
        // state by index at click time is unreliable.
        const existingIds = currentLayerIds()
        const layerMatches = registry.searchLayers(term)
            .filter(layer => !existingIds.has(layer._prefixedId || layer.id))
            .slice(0, MAX_LAYER_RESULTS)
            .map(layer => layerResultItem(layer, { action: 'add' }))

        return [...atlasMatches, ...layerMatches]
    }

    /**
     * Layers currently visible on the map, for a focus-triggered "what's on
     * the map right now" suggestion section (parallel to the current-location
     * default suggestion in map-search-control.js). Selecting one of these
     * always removes it - see the note in search() above for why this is a
     * fixed per-section action rather than something re-detected per item.
     */
    function getActiveLayers() {
        const groups = window.layerControl?._state?.groups || []
        const controls = window.layerControl?._sourceControls || []

        return groups
            .filter((g, index) => {
                const toggle = controls[index]?.querySelector?.('.toggle-switch input[type="checkbox"]')
                return !!toggle?.checked
            })
            .map(g => layerResultItem(g, { placeName: 'Active on this map', action: 'remove' }))
    }

    return { type: 'atlas-layer', search, getActiveLayers }
}

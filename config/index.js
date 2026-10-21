/**
 * ============================================================================
 * Amche Atlas (index) - Reserved System Layers
 * ============================================================================
 *
 * Layers the app itself writes to, present in every atlas whatever is loaded
 * (see js/map-init.js). They are declared in index.atlas.json with only their
 * title, style and inspect settings: the type and the data come from here, and
 * their ids are reserved (docs/API.md "Reserved layer ids").
 *
 * - selection:  markers placed on the map (js/map-marker-manager.js)
 * - directions: routes drawn by navigation (js/search/route-store.js)
 * - mask:       the cutout for `?mask=` (js/map-mask-manager.js)
 * - gpx:        the device's logged tracks (js/gpx-log.js), kept on the
 *               device only and never written into a shared URL
 * ============================================================================
 */

export const systemLayers = {
    selection: { initiallyChecked: true },
    directions: { initiallyChecked: false },
    mask: { initiallyChecked: false },
    gpx: { initiallyChecked: false, localData: true }
};

export function isSystemLayer(id) {
    return Object.prototype.hasOwnProperty.call(systemLayers, id);
}

/** True for a layer whose data stays on the device rather than going into the URL. */
export function isLocalDataLayer(id) {
    return !!(isSystemLayer(id) && systemLayers[id].localData);
}

/** A reserved layer's config with its fixed type filled in; any other layer as given. */
export function withSystemLayerDefaults(layer) {
    if (!layer || !isSystemLayer(layer.id)) return layer;
    return { geojson: null, ...layer, type: 'geojson' };
}

function layerApi() {
    return window.featureControl?._stateManager?._mapboxAPI || window.mapboxAPI;
}

/**
 * Writes a system layer's data: into its config, which the layer is created
 * from when it is switched on, and into its source when it is already on the map.
 */
export function writeSystemLayer(id, geojson) {
    const group = window.layerControl?._state?.groups?.find(g => g.id === id);
    if (group) group.geojson = geojson;
    if (layerApi()?._map?.getSource(`geojson-${id}`)) layerApi().updateGeoJSONLayerData(id, geojson);
}

/** Switches a system layer on or off through the layer control, as its checkbox would. */
export function showSystemLayer(id, visible) {
    const control = window.layerControl;
    const index = control?._state?.groups?.findIndex(g => g.id === id) ?? -1;
    if (index === -1) return;
    const checkbox = control._sourceControls?.[index]?.querySelector('.toggle-switch input[type="checkbox"]');
    if (!checkbox || checkbox.checked === visible) return;
    checkbox.checked = visible;
    Promise.resolve(control._toggleLayerGroup(index, visible)).then(() => {
        if (visible) window.dispatchEvent(new CustomEvent('layer-toggled', { detail: { layerId: id, visible } }));
    });
}

/**
 * Keeps MapLibre's terrain drapes to a single texture per terrain tile
 *
 * With 3D terrain on, MapLibre renders every unbroken run of the layer types
 * below into its own texture per terrain tile (js/terrain-3d-control.js sets
 * the DEM; MapLibre's RenderToTexture does the rest), and any other layer type
 * between two of them starts a new run. Each map adds its labels right above
 * its own fills and lines, so the OSM India embed's dozen maps made a dozen
 * runs: ~540 MB of drapes looking straight down and ~2 GB pitched to 60, which
 * iOS ends by killing the tab. Keeping every non-draped layer (labels, 3D
 * buildings, circles) above every draped one leaves one run whatever is on.
 *
 * Draped layers keep their order among themselves, as do the others, so the
 * maps still stack as the URL says; only a lower map's labels now show above
 * a higher map's fills, as labels generally should.
 */

const DRAPED = new Set(['background', 'fill', 'line', 'raster', 'hillshade', 'color-relief']);

/**
 * The beforeId that keeps the draped layers below the rest, for a layer of
 * `type` its caller asked to insert before `beforeId` (or on top).
 *
 * @param {Array<{id, type, metadata?}>} layers - the style's layers, bottom to top, without the one being placed
 * @param {string} type - the type of the layer being placed
 * @param {string} [beforeId] - where the caller asked for it
 * @returns {string|undefined}
 */
export function drapeSafeBeforeId(layers, type, beforeId) {
    let lastDraped = -1;
    layers.forEach((layer, i) => { if (DRAPED.has(layer.type)) lastDraped = i; });
    const bandStart = layers[lastDraped + 1]?.id;
    const target = beforeId === undefined ? -1 : layers.findIndex(l => l.id === beforeId);
    const inBand = target === -1 || target > lastDraped;

    if (!DRAPED.has(type)) return inBand ? beforeId : bandStart;
    if (!inBand) return beforeId;
    // Asked to go under a label: under the lowest draped layer of that
    // label's map, so it stays below that map the way it was asked to.
    const groupId = layers[target]?.metadata?.groupId;
    const sameGroup = groupId && layers.find(l => DRAPED.has(l.type) && l.metadata?.groupId === groupId);
    return sameGroup ? sameGroup.id : bandStart;
}

export function keepDrapedLayersBelow(map) {
    const addLayer = map.addLayer.bind(map);
    const moveLayer = map.moveLayer.bind(map);
    const layers = (exceptId) => (map.getStyle()?.layers || []).filter(l => l.id !== exceptId);

    map.addLayer = (layer, beforeId) => {
        if (!layer || typeof layer !== 'object' || !map.getStyle()) return addLayer(layer, beforeId);
        return addLayer(layer, drapeSafeBeforeId(layers(), layer.type, beforeId));
    };
    map.moveLayer = (id, beforeId) => {
        const type = map.getLayer(id)?.type;
        return moveLayer(id, type ? drapeSafeBeforeId(layers(id), type, beforeId) : beforeId);
    };
}

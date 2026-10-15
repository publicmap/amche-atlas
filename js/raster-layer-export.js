/**
 * Exports the map's current view as it shows one raster layer on its own - the
 * other toggled-on layers, basemaps included, are dimmed for the capture and
 * brought back afterwards, whether or not the export succeeds.
 *
 * Uses the same GeoTIFF/JPEG writers as the Export Map panel; the frame they
 * normally read their bounds from is swapped for the whole viewport.
 */
const CSS_DPI = 96;
const MM_PER_INCH = 25.4;

function dimOthers(layerId) {
    const control = window.layerControl;
    const isolation = control?.isolation;
    const api = control?._mapboxAPI;
    if (!isolation || !api) return () => {};

    const alreadyDimmed = isolation._dimmed || new Set();
    const dimmed = [];
    isolation._getToggledOnLayers().forEach((config, id) => {
        if (id === layerId || alreadyDimmed.has(id)) return;
        isolation._setDimmed(api, id, config, true);
        dimmed.push([id, config]);
    });

    return () => dimmed.forEach(([id, config]) => isolation._setDimmed(api, id, config, false));
}

function whenIdle(map) {
    return new Promise(resolve => {
        map.once('idle', resolve);
        map.triggerRepaint?.();
    });
}

/**
 * @param {'geotiff'|'jpeg'} format
 */
export async function exportRasterLayerView({ format, layerId, exportControl, map }) {
    const frame = exportControl?._frame;
    if (!exportControl || !frame || !map || !layerId) return;

    const container = map.getContainer();
    const config = {
        format,
        width: (container.clientWidth * MM_PER_INCH) / CSS_DPI,
        height: (container.clientHeight * MM_PER_INCH) / CSS_DPI,
        dpi: CSS_DPI,
        title: '',
        description: '',
        includeQRCode: false,
        includeLegend: false,
        includeMarkers: false
    };
    if (format === 'jpeg') config.jpegQuality = 1;

    const restoreLayers = dimOthers(layerId);
    frame.getBounds = () => map.getBounds();
    try {
        await whenIdle(map);
        await exportControl._handleExport(config);
    } finally {
        delete frame.getBounds;
        restoreLayers();
    }
}

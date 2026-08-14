/**
 * GeoLibre URL API
 *
 * Builds links that open this app's layers directly in GeoLibre
 * (https://web.geolibre.app), the open-source cloud-native GIS viewer
 * (https://github.com/opengeos/GeoLibre).
 *
 * Two ways in:
 * - A single layer: GeoLibre's `?data=` parameter loads one GeoJSON,
 *   GeoParquet, PMTiles, or COG file from a public URL — see
 *   https://geolibre.app/user-guide/embedding/. No equivalent exists for our
 *   vector-tile, WMS/WMTS, or inline-data layer types, so those aren't
 *   supported for `buildViewerUrl`.
 * - The whole map: `buildProjectFromActiveLayers` serializes every active
 *   layer this app knows how to translate into a `.geolibre.json` project
 *   (https://geolibre.app/user-guide/projects/), which `publishProject`
 *   pushes to a textb.org pad (see `textb-sync.js`) so GeoLibre's `?url=`
 *   project loader can read it back.
 *
 * Usage:
 * ```javascript
 * import { GeoLibreAPI } from './geolibre-api.js';
 *
 * if (GeoLibreAPI.isSupported(layerConfig)) {
 *   window.open(GeoLibreAPI.buildViewerUrl(layerConfig), '_blank');
 * }
 *
 * const { project, skipped } = GeoLibreAPI.buildProjectFromActiveLayers(map);
 * await GeoLibreAPI.publishProject(project);
 * window.open(GeoLibreAPI.PROJECT_VIEWER_URL, '_blank');
 * ```
 */
import { TextbSync } from './textb-sync.js';

const VIEWER_BASE_URL = 'https://web.geolibre.app/';

// Matches the remote-file formats GeoLibre's `data=` param can load directly.
// KML and bare XYZ/tile templates (used by our `geojson`/`vector` types too)
// aren't in this list because GeoLibre doesn't accept them via `data=`.
const SUPPORTED_EXTENSIONS = /\.(geojson|json|geoparquet|parquet|pmtiles|tif|tiff)$/i;

// Fixed textb.org pad used as the transport for whole-map GeoLibre projects.
// Publishing overwrites it — see textb-sync.js for why that's safe to do.
const TEXTB_PAD_ID = 'amche-atlas.json';

// A public MapLibre-compatible basemap. Our own basemap is a Mapbox GL style
// that needs a Mapbox access token GeoLibre (MapLibre-based, no token) can't
// supply, so projects use this instead rather than shipping a style that
// won't render.
const FALLBACK_BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

// Every field GeoLibre's UI reads off a layer's style — mirrors the shape of
// a real exported project so the app doesn't choke on missing fields.
const DEFAULT_LAYER_STYLE = {
    minZoom: 0,
    maxZoom: 24,
    fillColor: '#3b82f6',
    strokeColor: '#1e40af',
    strokeWidth: 2,
    fillOpacity: 0.6,
    circleRadius: 6,
    extrusionEnabled: false,
    extrusionColor: '#3b82f6',
    extrusionOpacity: 0.8,
    extrusionHeightProperty: 'height',
    extrusionHeightScale: 1,
    extrusionBase: 0,
    extrusionAdvancedStyleEnabled: false,
    extrusionColorExpression: '',
    extrusionHeightExpression: '',
    vectorStyleMode: 'single',
    vectorStyleProperty: '',
    vectorStyleClassCount: 5,
    vectorStyleColorRamp: 'viridis',
    vectorStyleClassificationScheme: 'equal-interval',
    vectorStyleStops: [
        { value: 0, color: '#dbeafe' },
        { value: 1, color: '#2563eb' }
    ],
    vectorStyleExpression: '',
    rasterBrightnessMin: 0,
    rasterBrightnessMax: 1,
    rasterSaturation: 0,
    rasterContrast: 0,
    rasterHueRotate: 0
};

// Our atlas configs carry raw Mapbox GL style-spec paint properties, often
// as data-driven expressions (arrays/objects) — those can't be flattened
// into GeoLibre's non-expression, scalar-only style model, so only plain
// string/number values are picked up here. Everything else falls back to
// DEFAULT_LAYER_STYLE's value for that field.
function extractLayerStyle(layerConfig) {
    const style = layerConfig?.style;
    const merged = { ...DEFAULT_LAYER_STYLE, minZoom: layerConfig?.minzoom ?? 0, maxZoom: layerConfig?.maxzoom ?? 24 };
    if (!style || typeof style !== 'object') return merged;

    const scalar = (...keys) => {
        for (const key of keys) {
            const value = style[key];
            if (typeof value === 'string' || typeof value === 'number') return value;
        }
        return undefined;
    };

    const fillColor = scalar('fill-color', 'circle-color', 'fill-extrusion-color');
    const strokeColor = scalar('line-color', 'circle-stroke-color');
    const strokeWidth = scalar('line-width', 'circle-stroke-width');
    const fillOpacity = scalar('fill-opacity', 'circle-opacity', 'fill-extrusion-opacity');
    const circleRadius = scalar('circle-radius');
    const rasterBrightnessMin = scalar('raster-brightness-min');
    const rasterBrightnessMax = scalar('raster-brightness-max');
    const rasterSaturation = scalar('raster-saturation');
    const rasterContrast = scalar('raster-contrast');
    const rasterHueRotate = scalar('raster-hue-rotate');

    if (fillColor !== undefined) merged.fillColor = fillColor;
    if (strokeColor !== undefined) merged.strokeColor = strokeColor;
    if (typeof strokeWidth === 'number') merged.strokeWidth = strokeWidth;
    if (typeof fillOpacity === 'number') merged.fillOpacity = fillOpacity;
    if (typeof circleRadius === 'number') merged.circleRadius = circleRadius;
    if (typeof rasterBrightnessMin === 'number') merged.rasterBrightnessMin = rasterBrightnessMin;
    if (typeof rasterBrightnessMax === 'number') merged.rasterBrightnessMax = rasterBrightnessMax;
    if (typeof rasterSaturation === 'number') merged.rasterSaturation = rasterSaturation;
    if (typeof rasterContrast === 'number') merged.rasterContrast = rasterContrast;
    if (typeof rasterHueRotate === 'number') merged.rasterHueRotate = rasterHueRotate;

    return merged;
}

// Converts one active layer config into a GeoLibre project layer, or returns
// null if this layer's type/shape has no known GeoLibre translation.
function toProjectLayer(layerConfig) {
    if (!layerConfig || !layerConfig.id) return null;

    // `raster-opacity` is this app's equivalent of the layer's overall
    // opacity slider — GeoLibre's style object has no matching field, so it
    // belongs on the layer's top-level `opacity`, not in `style`.
    const rasterOpacity = layerConfig.style?.['raster-opacity'];
    const opacity = typeof layerConfig.opacity === 'number'
        ? layerConfig.opacity
        : (typeof rasterOpacity === 'number' ? rasterOpacity : 1);

    const base = {
        id: layerConfig.id,
        name: layerConfig.title || layerConfig.id,
        visible: true,
        opacity,
        style: extractLayerStyle(layerConfig),
        metadata: {}
    };

    if (layerConfig.type === 'cog' && typeof layerConfig.url === 'string' && layerConfig.url) {
        return {
            ...base,
            type: 'cog',
            source: { type: 'cog', url: layerConfig.url },
            sourcePath: layerConfig.url
        };
    }

    if (layerConfig.type === 'geojson' && typeof layerConfig.url === 'string' && SUPPORTED_EXTENSIONS.test(layerConfig.url)) {
        return {
            ...base,
            type: 'geojson',
            source: { type: 'geojson' },
            sourcePath: layerConfig.url
        };
    }

    // `tms` layers are already plain {z}/{x}/{y} XYZ templates, the same
    // shape GeoLibre's own WMTS/raster layers use — `mapbox://` tilesets
    // aren't URLs GeoLibre (MapLibre, no Mapbox token) can fetch, so skip those.
    if (layerConfig.type === 'tms' && typeof layerConfig.url === 'string' && !layerConfig.url.startsWith('mapbox://')) {
        return {
            ...base,
            type: 'wmts',
            source: {
                type: 'raster',
                tiles: [layerConfig.url],
                tileSize: layerConfig.tileSize || 256,
                url: layerConfig.url
            },
            metadata: { service: 'wmts' },
            sourcePath: layerConfig.url
        };
    }

    // `vector` (.pbf/.mvt XYZ tiles) — same `mapbox://` caveat as `tms`, and
    // MapLibre's vector source needs the tile's sourceLayer name to draw
    // anything, so skip layers missing one. Verified against a real
    // GeoLibre project: this shape gets recognized as a VECTOR layer and
    // MapLibre correctly requests tiles from `source.tiles[0]`.
    if (layerConfig.type === 'vector' && typeof layerConfig.url === 'string' && !layerConfig.url.startsWith('mapbox://') && layerConfig.sourceLayer) {
        return {
            ...base,
            type: 'vector-tiles',
            source: {
                type: 'vector',
                tiles: [layerConfig.url],
                sourceLayer: layerConfig.sourceLayer,
                minzoom: layerConfig.minzoom,
                maxzoom: layerConfig.maxzoom
            },
            sourceLayer: layerConfig.sourceLayer,
            sourcePath: layerConfig.url
        };
    }

    return null;
}

export class GeoLibreAPI {
    static get PROJECT_RAW_URL() {
        return TextbSync.rawUrl(TEXTB_PAD_ID);
    }

    static get PROJECT_VIEWER_URL() {
        return `${VIEWER_BASE_URL}?url=${encodeURIComponent(this.PROJECT_RAW_URL)}`;
    }

    /**
     * Returns the remote data URL to hand to GeoLibre, or null if this
     * layer has nothing GeoLibre can load directly.
     */
    static getDataUrl(layerConfig) {
        if (!layerConfig || typeof layerConfig.url !== 'string' || !layerConfig.url) return null;

        if (layerConfig.type === 'cog') return layerConfig.url;
        if (layerConfig.type === 'geojson' && SUPPORTED_EXTENSIONS.test(layerConfig.url)) {
            return layerConfig.url;
        }

        return null;
    }

    static isSupported(layerConfig) {
        return this.getDataUrl(layerConfig) !== null;
    }

    static buildViewerUrl(layerConfig) {
        const dataUrl = this.getDataUrl(layerConfig);
        if (!dataUrl) return null;
        return `${VIEWER_BASE_URL}?data=${encodeURIComponent(dataUrl)}`;
    }

    /**
     * Builds a `.geolibre.json` project from every currently active (checked)
     * layer on `map`'s layer control. Returns both the project and the list
     * of active layers that had no known GeoLibre translation, so callers can
     * tell the user what got left out.
     */
    static buildProjectFromActiveLayers(map, layerControl = window.layerControl, urlManager = window.urlManager) {
        const groups = layerControl?._state?.groups || [];
        const layers = [];
        const styles = {};
        const skipped = [];

        groups.forEach((group, index) => {
            if (!group || group.id === 'selection') return;
            const isActive = typeof urlManager?.isGroupActive === 'function' && urlManager.isGroupActive(index);
            if (!isActive) return;

            const projectLayer = toProjectLayer(group);
            if (projectLayer) {
                layers.push(projectLayer);
                styles[projectLayer.id] = projectLayer.style;
            } else {
                skipped.push({ id: group.id, title: group.title, type: group.type });
            }
        });

        const center = map.getCenter();
        const bounds = map.getBounds();

        // `_state.groups` is stored first-on-top (see CLAUDE.md's layer
        // ordering section); GeoLibre's project layers array is the other
        // way — verified against the live app: the LAST layer in the array
        // is the one drawn on top and listed at the top of its panel.
        const orderedLayers = [...layers].reverse();

        const project = {
            version: '0.1.0',
            name: 'amche-atlas Export',
            mapView: {
                center: [center.lng, center.lat],
                zoom: map.getZoom(),
                bearing: map.getBearing(),
                pitch: map.getPitch(),
                bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
            },
            basemapStyleUrl: FALLBACK_BASEMAP_STYLE_URL,
            basemapVisible: true,
            basemapOpacity: 1,
            layers: orderedLayers,
            styles,
            preferences: {
                map: {
                    restrictBounds: false,
                    bounds: [-180, -85, 180, 85],
                    minZoom: 0,
                    maxZoom: 24,
                    maxPitch: 85,
                    renderWorldCopies: true
                },
                environmentVariables: []
            },
            plugins: {
                manifestUrls: [],
                activePluginIds: ['maplibre-layer-control'],
                mapControlPositions: {},
                settings: {}
            },
            metadata: {}
        };

        return { project, skipped };
    }

    /**
     * Publishes `project` to the shared textb.org pad GeoLibre's `?url=`
     * loader reads from. Resolves once the pad has been overwritten.
     */
    static async publishProject(project) {
        await TextbSync.publish(TEXTB_PAD_ID, JSON.stringify(project, null, 2));
    }
}

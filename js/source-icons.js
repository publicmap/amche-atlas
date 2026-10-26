/**
 * What kind of data a layer's source is, as shown on the layer editor's Data
 * card: an icon, a tooltip that describes the kind, and a subtitle naming the
 * layer type. Kinds are told apart by icon, not colour.
 *
 * The kind comes from the source URL when there is one (the same detection the
 * creator uses to load it), else from the layer's `type`.
 */

import { SOURCE_TYPES, SOURCE_TYPE_LABELS, detectLayerSourceType } from './layer-source-resolver.js';

/** Shoelace (Bootstrap Icons) icon names. */
export const SOURCE_CATEGORIES = {
    vector: {
        icon: 'bounding-box-circles',
        name: 'Vector tiles',
        tooltip: 'Vector tiles: map data in tiles of geometry and attributes. Fast for large datasets, and every feature can be styled and inspected.'
    },
    raster: {
        icon: 'image',
        name: 'Raster',
        tooltip: 'Raster: map imagery drawn from image tiles or a GeoTIFF, such as satellite imagery or a scanned map.'
    },
    service: {
        icon: 'globe',
        name: 'Web service',
        tooltip: 'Web service or API: the data is fetched live from a third-party service, such as WMS, WFS, ArcGIS REST, Overpass, Allmaps or MapWarper.'
    },
    csv: {
        icon: 'filetype-csv',
        name: 'CSV',
        tooltip: 'CSV or Google Sheet: a table of rows with latitude and longitude columns.'
    },
    json: {
        icon: 'filetype-json',
        name: 'JSON',
        tooltip: 'GeoJSON or JSON: vector features, or a layer or atlas configuration.'
    },
    xml: {
        icon: 'filetype-xml',
        name: 'KML',
        tooltip: 'KML: points, lines and polygons from Google Earth.'
    },
    file: {
        icon: 'file-earmark-zip',
        name: 'File',
        tooltip: 'GeoPackage or zipped Shapefile: a spatial data file, read in your browser.'
    },
    unknown: {
        icon: 'link-45deg',
        name: 'Data source',
        tooltip: 'Paste a link or upload a file. The data format is detected from the link.'
    }
};

const CATEGORY_BY_SOURCE_TYPE = {
    [SOURCE_TYPES.OVERPASS_SHARE]: 'service',
    [SOURCE_TYPES.BHARATLAS]: 'service',
    [SOURCE_TYPES.GIST]: 'json',
    [SOURCE_TYPES.WMS]: 'service',
    [SOURCE_TYPES.WFS]: 'service',
    [SOURCE_TYPES.ARCGIS]: 'service',
    [SOURCE_TYPES.CSV]: 'csv',
    [SOURCE_TYPES.ALLMAPS]: 'service',
    [SOURCE_TYPES.OSM]: 'service',
    [SOURCE_TYPES.MAPWARPER]: 'service',
    [SOURCE_TYPES.STAC_VIEWER]: 'service',
    [SOURCE_TYPES.PLANETARY_COMPUTER]: 'service',
    [SOURCE_TYPES.HOTOSM_OAM]: 'service',
    [SOURCE_TYPES.COG]: 'raster',
    [SOURCE_TYPES.PMTILES]: 'vector',
    [SOURCE_TYPES.JSON_FILE]: 'json',
    [SOURCE_TYPES.GEOJSON_FILE]: 'json',
    [SOURCE_TYPES.GEOJSONL]: 'json',
    [SOURCE_TYPES.KML]: 'xml',
    [SOURCE_TYPES.PARIVESH_KML]: 'xml',
    [SOURCE_TYPES.GPKG]: 'file',
    [SOURCE_TYPES.SHAPEFILE]: 'file',
    [SOURCE_TYPES.INDIANOPENMAPS]: 'vector',
    [SOURCE_TYPES.MAPBOX_TILESET]: 'vector',
    [SOURCE_TYPES.VECTOR_TILE]: 'vector',
    [SOURCE_TYPES.RASTER_TILE]: 'raster'
};

const CATEGORY_BY_LAYER_TYPE = {
    vector: 'vector', style: 'vector', 'layer-group': 'vector',
    tms: 'raster', cog: 'raster', wmts: 'raster', img: 'raster', 'raster-style-layer': 'raster',
    wms: 'service', arcgis: 'service', overpass: 'service', osm: 'service',
    csv: 'csv', sheet: 'csv',
    geojson: 'json', atlas: 'json', js: 'json'
};

export const LAYER_TYPE_LABELS = {
    geojson: 'GeoJSON',
    csv: 'CSV',
    sheet: 'Google Sheet',
    vector: 'Vector tiles',
    tms: 'Raster tiles',
    wmts: 'WMTS raster tiles',
    wms: 'WMS',
    cog: 'Cloud Optimized GeoTIFF',
    arcgis: 'ArcGIS layer',
    overpass: 'Overpass query',
    osm: 'OpenStreetMap element',
    img: 'Image overlay',
    style: 'Base map style',
    'layer-group': 'Layer group',
    'raster-style-layer': 'Base map raster layer',
    atlas: 'Atlas',
    js: 'Scripted layer'
};

/**
 * @param {{url?: string, layerType?: string}} source
 * @returns {{category: string, icon: string, tooltip: string, subtitle: string}}
 */
export function describeSource({ url, layerType } = {}) {
    const detected = url ? detectLayerSourceType(url) : null;
    const category = (detected && CATEGORY_BY_SOURCE_TYPE[detected])
        || (layerType && CATEGORY_BY_LAYER_TYPE[layerType])
        || 'unknown';
    const { icon, tooltip, name } = SOURCE_CATEGORIES[category];

    // The layer type is the subtitle; when the link comes from a service the
    // layer type doesn't name (a GeoJSON query against ArcGIS), say so.
    const typeLabel = layerType ? (LAYER_TYPE_LABELS[layerType] || layerType) : null;
    const provider = detected && category === 'service' ? SOURCE_TYPE_LABELS[detected] : null;
    let subtitle;
    if (typeLabel && provider && provider !== typeLabel && !typeLabel.includes(provider)) subtitle = `${typeLabel} · ${provider}`;
    else subtitle = typeLabel || (detected ? SOURCE_TYPE_LABELS[detected] : null) || name;

    return { category, icon, tooltip, subtitle };
}

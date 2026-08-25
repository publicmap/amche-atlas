/**
 * Layer Source Resolver.
 *
 * Single place that (a) detects what kind of source a pasted URL is, and
 * (b) turns that URL into a layer config / GeoJSON payload. Used by
 * map-creator.js's "Add Layer" URL box and by dynamic-layer-shorthand.js's
 * `type:id` shortcut dispatcher, so both share one detection table and one
 * set of per-service resolvers instead of re-implementing the same checks.
 *
 * A few formats need a user pick before they can finish resolving (a
 * multi-layer atlas JSON, a Google Sheet with several tabs) — those return
 * `{status:'needs-input', kind, ...}` instead of a config, and the caller's
 * own picker UI re-calls with the pick supplied via `urlOptions`.
 */

import { MapUtils } from './map-utils.js';
import { MapWarperAPI } from './mapwarper-url-api.js';
import { AllmapsAPI } from './allmaps-url-api.js';
import { OSMApi } from './osm-url-api.js';
import { KMLConverter } from './kml-converter.js';
import * as GoogleSheetsAPI from './google-sheets-api.js';

export const SOURCE_TYPES = {
    OVERPASS_SHARE: 'overpass-share',
    BHARATLAS: 'bharatlas',
    GIST: 'gist',
    WMS: 'wms',
    CSV: 'csv',
    ALLMAPS: 'allmaps',
    OSM: 'osm',
    MAPWARPER: 'mapwarper',
    JSON_FILE: 'json',
    GEOJSON_FILE: 'geojson',
    KML: 'kml',
    GEOJSONL: 'geojsonl',
    GPKG: 'gpkg',
    SHAPEFILE: 'shapefile',
    INDIANOPENMAPS: 'indianopenmaps',
    MAPBOX_TILESET: 'mapbox-tileset',
    VECTOR_TILE: 'vector-tile',
    RASTER_TILE: 'raster-tile'
};

export const SOURCE_TYPE_LABELS = {
    [SOURCE_TYPES.OVERPASS_SHARE]: 'Overpass',
    [SOURCE_TYPES.BHARATLAS]: 'Bharatlas',
    [SOURCE_TYPES.GIST]: 'GeoJSON',
    [SOURCE_TYPES.WMS]: 'WMS',
    [SOURCE_TYPES.CSV]: 'CSV',
    [SOURCE_TYPES.ALLMAPS]: 'Allmaps',
    [SOURCE_TYPES.OSM]: 'OSM',
    [SOURCE_TYPES.MAPWARPER]: 'MapWarper',
    [SOURCE_TYPES.JSON_FILE]: 'Amche Atlas JSON',
    [SOURCE_TYPES.GEOJSON_FILE]: 'GeoJSON',
    [SOURCE_TYPES.KML]: 'KML',
    [SOURCE_TYPES.GEOJSONL]: 'GeoJSONL',
    [SOURCE_TYPES.GPKG]: 'GeoPackage',
    [SOURCE_TYPES.SHAPEFILE]: 'Shapefile',
    [SOURCE_TYPES.INDIANOPENMAPS]: 'Vector Tiles',
    [SOURCE_TYPES.MAPBOX_TILESET]: 'Vector Tiles',
    [SOURCE_TYPES.VECTOR_TILE]: 'Vector Tiles',
    [SOURCE_TYPES.RASTER_TILE]: 'Raster Tiles'
};

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function isOverpassShareUrl(url) {
    if (!url) return false;
    return /^https?:\/\/overpass-turbo\.eu\/s\/[A-Za-z0-9_-]+\/?$/i.test(url.trim());
}

export function isBharatlasUrl(url) {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    if (!urlLower.includes('bharatlas.com')) return false;
    if (/bharatlas\.com\/c\/[a-z0-9]+/i.test(url)) return true;
    if (/bharatlas\.com\/api\/r2\/community\/[a-z0-9]+\//i.test(url)) return true;
    return false;
}

export function isGistUrl(url) {
    if (!url) return false;
    return /^https?:\/\/gist\.github\.com\/(?:[^/]+\/)?[0-9a-f]{16,}/i.test(url);
}

export function isWMSUrl(url) {
    const urlLower = url.toLowerCase();
    if (urlLower.includes('service=wms')) return true;
    if (urlLower.includes('/wms') && (urlLower.includes('request=getmap') || urlLower.includes('getmap'))) return true;
    return false;
}

export function isCSVUrl(url) {
    const urlLower = url.toLowerCase();
    if (urlLower.endsWith('.csv')) return true;
    if (urlLower.includes('output=csv')) return true;
    if (urlLower.includes('docs.google.com/spreadsheets')) return true;
    return false;
}

// Mapbox tileset IDs are in format: username.tilesetid (alphanumeric with dots).
// They should not contain slashes, protocols, or common URL patterns.
export function isMapboxTilesetId(input) {
    if (!input || input.includes('/') || input.includes('://') || input.includes('{z}')) {
        return false;
    }
    return /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(input);
}

// e.g. https://indianopenmaps.com/viewer#source=/not-so-open/.../&map=...
export function isIndianOpenMapsViewerUrl(url) {
    return /^https?:\/\/(www\.)?indianopenmaps\.com\/viewer#/i.test(url);
}

export function isIndianOpenMapsFlyDevViewUrl(url) {
    return url.includes('indianopenmaps.fly.dev') && url.includes('/view');
}

// Extracts the base tile source URL for the first source in an
// indianopenmaps.com viewer link (multiple sources are comma/%2C-separated —
// only the first is used, matching the single-layer "Add Layer" flow).
export function parseIndianOpenMapsViewerUrl(url) {
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) return null;

    const params = new URLSearchParams(url.slice(hashIndex + 1));
    const sourceParam = params.get('source');
    if (!sourceParam) return null;

    const firstSource = sourceParam.split(',')[0].replace(/\/+$/, '');
    if (!firstSource) return null;

    return `https://indianopenmaps.com${firstSource}`;
}

export function isIndianOpenMapsTileUrl(url) {
    if (!url) return false;
    return /^https?:\/\/(www\.)?indianopenmaps\.(com|fly\.dev)\//i.test(url);
}

// Reverses parseIndianOpenMapsViewerUrl(): turns a resolved indianopenmaps
// tile URL (…/{z}/{x}/{y}.pbf) back into a viewer link pointing at the same
// source, for use in attribution. The map= location is left empty for
// MapAttributionControl to fill in with the current view on every moveend
// (see _replaceLocationHash in map-attribution-control.js).
export function buildIndianOpenMapsViewerUrl(tileUrl) {
    if (!isIndianOpenMapsTileUrl(tileUrl)) return null;
    // Matched on the raw string (not URL.pathname) since the latter
    // percent-encodes the literal "{z}/{x}/{y}" template braces.
    const match = tileUrl.match(/^https?:\/\/(?:www\.)?indianopenmaps\.(?:com|fly\.dev)(\/.*?)\/\{z\}\/\{x\}\/\{y\}\.\w+/i);
    if (!match) return null;
    return `https://indianopenmaps.com/viewer#source=${match[1]}/&map=`;
}

// IndianOpenMaps' tiles.json already returns an attribution linking the
// source and Datameet Community (e.g. "Source: <a href='...'>TNGIS</a> -
// Collected by <a href='...'>Datameet Community</a>"). Drop the redundant
// "Source: " label and append a live-updating "via IndianOpenMaps" link
// back to the viewer.
export function formatIndianOpenMapsAttribution(attribution, tileUrl) {
    if (!attribution || typeof attribution !== 'string') return attribution;
    const viewerUrl = buildIndianOpenMapsViewerUrl(tileUrl);
    if (!viewerUrl) return attribution;
    const attr = attribution.replace(/^Source:\s*/i, '');
    return `${attr} via <a href='${viewerUrl}' target='_blank' rel='noopener noreferrer'>IndianOpenMaps</a>`;
}

// Match pattern like /12/2875/1827.pbf or /12/2875/1827.mvt
export function isPbfTileUrl(url) {
    return /\/\d+\/\d+\/\d+\.(pbf|mvt)($|\?)/i.test(url);
}

// Match pattern like /15/23112/14953 or /12/2875/1827.png
export function isTileUrl(url) {
    return /\/\d+\/\d+\/\d+(\.(pbf|mvt|png|jpg|jpeg|webp))?($|\?)/i.test(url);
}

export function convertPbfTileUrlToTemplate(url) {
    return url.replace(/\/\d+\/\d+\/\d+\.(pbf|mvt)($|\?)/i, '/{z}/{x}/{y}.$1$2');
}

export function convertTileUrlToTemplate(url, defaultExtension = null) {
    return url.replace(/\/\d+\/\d+\/\d+(\.(pbf|mvt|png|jpg|jpeg|webp))?($|\?)/i, (match, ext, extName, end) => {
        if (!ext && defaultExtension) {
            return `/{z}/{x}/{y}.${defaultExtension}${end}`;
        }
        return `/{z}/{x}/{y}${ext || ''}${end}`;
    });
}

/**
 * Guesses the tile/vector/raster layer type from a URL — used both as the
 * final fallback in detectLayerSourceType() and internally by
 * resolveTileSource()/makeLayerConfig() once tile-template conversion has run.
 */
export function guessLayerType(url) {
    if (isMapboxTilesetId(url)) return 'mapbox-tileset';
    if (url.startsWith('mapbox://')) return 'mapbox-tileset';
    if (url.includes('earthengine.googleapis.com') && url.includes('/tiles/')) return 'raster';
    if (/\.geojson($|\?)/i.test(url)) return 'geojson';
    if (isPbfTileUrl(url)) return 'vector';
    if (url.includes('{z}') && (url.includes('.pbf') || url.includes('.mvt') || url.includes('vector.openstreetmap.org') || url.includes('/vector/'))) return 'vector';
    if (url.includes('{z}') && (url.includes('.png') || url.includes('.jpg') || url.includes('.webp'))) return 'raster';
    if (url.includes('{x}') && url.includes('{y}') && url.includes('{z}')) return 'raster';
    if (isTileUrl(url)) {
        const hasVectorExt = /\.(pbf|mvt)($|\?)/i.test(url);
        return hasVectorExt ? 'vector' : 'raster';
    }
    if (/\.json($|\?)/i.test(url)) return 'atlas';
    return 'unknown';
}

/**
 * Single ordered detector — the union of what used to be three duplicated
 * chains (map-creator.js's detectUrlFormat/isValidDataUrl + layer-creator-ui.js's
 * guessLayerType). Order matters: more specific formats (Overpass share,
 * Bharatlas, known extensions, named services) are checked before the loose
 * tile-coordinate-pattern fallbacks.
 *
 * Unlike the old isValidDataUrl, this does NOT require an http(s)/mapbox://
 * prefix before checking isMapboxTilesetId — that gating made the bare
 * "username.tilesetid" case unreachable, since a bare tileset ID has no
 * protocol prefix by definition.
 */
export function detectLayerSourceType(url) {
    if (!url || typeof url !== 'string') return null;

    if (isMapboxTilesetId(url)) return SOURCE_TYPES.MAPBOX_TILESET;

    const urlLower = url.toLowerCase();

    if (isOverpassShareUrl(url)) return SOURCE_TYPES.OVERPASS_SHARE;
    if (isBharatlasUrl(url)) return SOURCE_TYPES.BHARATLAS;
    if (isGistUrl(url)) return SOURCE_TYPES.GIST;
    if (isWMSUrl(url)) return SOURCE_TYPES.WMS;
    if (isCSVUrl(url)) return SOURCE_TYPES.CSV;
    if (AllmapsAPI.isAllmapsUrl(url)) return SOURCE_TYPES.ALLMAPS;
    if (OSMApi.isOsmUrl(url)) return SOURCE_TYPES.OSM;
    if (urlLower.includes('jsonkeeper.com/b/')) return SOURCE_TYPES.JSON_FILE;
    if (/\.geojson($|\?)/i.test(url)) return SOURCE_TYPES.GEOJSON_FILE;
    if (urlLower.endsWith('.json')) return SOURCE_TYPES.JSON_FILE;
    if (urlLower.endsWith('.kml')) return SOURCE_TYPES.KML;
    if (urlLower.endsWith('.geojsonl') || urlLower.endsWith('.ndjson') || urlLower.endsWith('.jsonl')) return SOURCE_TYPES.GEOJSONL;
    if (urlLower.endsWith('.gpkg')) return SOURCE_TYPES.GPKG;
    if (urlLower.endsWith('.zip')) return SOURCE_TYPES.SHAPEFILE;
    if (isIndianOpenMapsViewerUrl(url) || isIndianOpenMapsFlyDevViewUrl(url)) return SOURCE_TYPES.INDIANOPENMAPS;
    if (urlLower.includes('{z}') && (urlLower.includes('.pbf') || urlLower.includes('.mvt'))) return SOURCE_TYPES.VECTOR_TILE;
    if (urlLower.includes('{z}') && (urlLower.includes('.png') || urlLower.includes('.jpg'))) return SOURCE_TYPES.RASTER_TILE;
    if (urlLower.includes('{x}') && urlLower.includes('{y}') && urlLower.includes('{z}')) return SOURCE_TYPES.RASTER_TILE;
    if (isPbfTileUrl(url)) return SOURCE_TYPES.VECTOR_TILE;
    if (isTileUrl(url)) {
        const hasVectorExt = /\.(pbf|mvt)($|\?)/i.test(url);
        return hasVectorExt ? SOURCE_TYPES.VECTOR_TILE : SOURCE_TYPES.RASTER_TILE;
    }
    if (MapWarperAPI.isMapWarperUrl(url)) return SOURCE_TYPES.MAPWARPER;
    if (urlLower.includes('vector.openstreetmap.org')) return SOURCE_TYPES.VECTOR_TILE;
    if (urlLower.includes('earthengine.googleapis.com') && urlLower.includes('/tiles/')) return SOURCE_TYPES.RASTER_TILE;
    if (url.startsWith('mapbox://')) return SOURCE_TYPES.MAPBOX_TILESET;

    return null;
}

// ---------------------------------------------------------------------------
// Small shared utility
// ---------------------------------------------------------------------------

export function generateLayerId(title) {
    if (!title) return '';
    const words = title.toLowerCase()
        .replace(/[^a-z0-9\s]+/g, '')
        .split(/\s+/)
        .filter(w => w.length > 0)
        .slice(0, 3);
    const base = words.join('-');
    const random = String(Math.floor(Math.random() * 90) + 10);
    return base ? `${base}-${random}` : `layer-${random}`;
}

// ---------------------------------------------------------------------------
// Tile / vector / raster / mapbox-tileset / indianopenmaps
// ---------------------------------------------------------------------------

/**
 * Creates a layer configuration object for a resolved tile source.
 * @param {string} url - Data URL
 * @param {Object} tilejson - TileJSON object
 * @param {Object} metadata - Optional metadata
 * @returns {Object} Layer configuration
 */
export function makeLayerConfig(url, tilejson, metadata = null) {
    const type = guessLayerType(url);
    let config = {};
    if (type === 'vector') {
        let attribution = tilejson?.attribution || '© OpenStreetMap contributors';
        let mapId = null;
        if (url.includes('api-main')) {
            const urlObj = new URL(url);
            mapId = urlObj.searchParams.get('map_id');
            if (mapId) {
                attribution = `© Original Creator - via <a href='https://www.maphub.co/map/${mapId}'>Maphub</a>`;
            }
        }

        if (attribution && typeof attribution === 'string') {
            attribution = attribution.replace(/"/g, "'");
        }

        if (isIndianOpenMapsTileUrl(url)) {
            attribution = formatIndianOpenMapsAttribution(attribution, url);
        }

        config = {
            title: tilejson?.name || 'Vector Tile Layer',
            description: tilejson?.description || 'Vector tile layer from custom source',
            type: 'vector',
            id: (tilejson?.name || 'vector-layer').toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 8),
            url: (tilejson?.tiles && tilejson.tiles[0]) || url,
            sourceLayer: tilejson?.vector_layers?.[0]?.id || 'default',
            minzoom: tilejson?.minzoom || 0,
            maxzoom: tilejson?.maxzoom || 14,
            attribution: attribution,
            initiallyChecked: false,
            inspect: {
                id: tilejson?.vector_layers?.[0]?.fields?.gid ? "gid" : (tilejson?.vector_layers?.[0]?.fields?.id ? "id" : "gid"),
                title: tilejson?.vector_layers?.[0]?.fields?.mon_name ? "Monument Name" : "Name",
                label: tilejson?.vector_layers?.[0]?.fields?.mon_name ? "mon_name" : (tilejson?.vector_layers?.[0]?.fields?.name ? "name" : "mon_name"),
                fields: tilejson?.vector_layers?.[0]?.fields ?
                    Object.keys(tilejson.vector_layers[0].fields).slice(0, 6) :
                    ["id", "description", "class", "type"],
                fieldTitles: tilejson?.vector_layers?.[0]?.fields ?
                    Object.keys(tilejson.vector_layers[0].fields).slice(0, 6).map(field =>
                        field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                    ) :
                    ["ID", "Description", "Class", "Type"]
            }
        };
        if (url.includes('api-main')) {
            config.sourceLayer = 'vector';
            if (mapId) {
                config.headerImage = `https://api-main-432878571563.europe-west4.run.app/maps/${mapId}/thumbnail`;
            }
        }
    } else if (type === 'raster') {
        const cleanTitle = (title) => {
            if (!title) return 'Raster Layer';
            let cleaned = title;
            if (cleaned.startsWith('File:')) cleaned = cleaned.substring(5);
            cleaned = cleaned.replace(/\.(jpg|jpeg|png|gif|tiff|tif|pdf)$/i, '');
            return cleaned.trim();
        };

        const formatWikiLink = (url, text) => {
            if (url && url.includes('commons.wikimedia.org/wiki/File:')) {
                const fileName = url.split('/').pop();
                const displayText = text || fileName;
                return `<a href='${url}' target='_blank'>${displayText}</a>`;
            }
            return text || url;
        };

        const formatDescription = (description) => {
            if (!description) return undefined;
            const fromMatch = description.match(/From:\s*(https?:\/\/[^\s]+)/);
            if (fromMatch) {
                const url = fromMatch[1];
                if (url.includes('commons.wikimedia.org/wiki/File:')) {
                    const fileName = url.split('/').pop();
                    return `From: ${formatWikiLink(url, fileName)}`;
                }
            }
            return description;
        };

        const formatAttribution = (metadata) => {
            if (!metadata) return undefined;
            const source = metadata.source;
            const originalUrl = metadata.originalUrl;
            let attribution = '';

            if (source) {
                if (source.includes('commons.wikimedia.org/wiki/File:')) {
                    const fileName = source.split('/').pop();
                    attribution += formatWikiLink(source, fileName);
                } else if (source.startsWith('http://') || source.startsWith('https://')) {
                    attribution += `<a href='${source}' target='_blank'>${source}</a>`;
                } else {
                    attribution += source;
                }
            }

            if (originalUrl) {
                attribution += attribution ? ' via ' : '';
                attribution += `<a href='${originalUrl}' target='_blank'>MapWarper</a>`;
            }
            return attribution || undefined;
        };

        const isEarthEngine = url.includes('earthengine.googleapis.com');
        const isAutoDetected = metadata?.autoDetected;

        config = {
            title: metadata ? cleanTitle(metadata.title) : (isEarthEngine ? 'Google Earth Engine Image' : 'Raster Layer'),
            description: metadata ? formatDescription(metadata.description) : (isEarthEngine ? "XYZ tiles generated from <a href='https://developers.google.com/earth-engine/datasets/'>Google Earth Engine</a>" : (isAutoDetected ? "Auto-detected as raster tiles. If tiles don't load, try changing type to 'vector' and add a sourceLayer." : undefined)),
            date: metadata ? metadata.date : undefined,
            type: 'tms',
            id: metadata ? `mapwarper-${metadata.mapId}` : (isEarthEngine ? 'earthengine-' + Math.random().toString(36).slice(2, 8) : 'raster-' + Math.random().toString(36).slice(2, 8)),
            url,
            style: {
                'raster-opacity': [
                    'interpolate', ['linear'], ['zoom'], 6, 0.95, 18, 0.8, 19, 0.3
                ]
            },
            attribution: metadata ? formatAttribution(metadata) : (isEarthEngine ? '© Google Earth Engine' : undefined),
            headerImage: metadata ? metadata.thumbnail : undefined,
            bbox: metadata && metadata.bbox ? metadata.bbox : undefined,
            initiallyChecked: false
        };

        Object.keys(config).forEach(key => {
            if (config[key] === undefined) delete config[key];
        });
    } else if (type === 'geojson') {
        config = {
            title: metadata?.title || 'GeoJSON Layer',
            type: 'geojson',
            id: 'geojson-' + Math.random().toString(36).slice(2, 8),
            url,
            initiallyChecked: false,
            inspect: {
                id: "id",
                title: "Name",
                label: "name",
                fields: ["id", "description", "class", "type"],
                fieldTitles: ["ID", "Description", "Class", "Type"]
            }
        };
        if (metadata?.geojson) {
            config.geojson = metadata.geojson;
            delete config.url;
        }
    } else if (type === 'atlas') {
        config = {
            type: 'atlas',
            url,
            inspect: {
                id: "id",
                title: "Name",
                label: "name",
                fields: ["id", "description", "class", "type"],
                fieldTitles: ["ID", "Description", "Class", "Type"]
            }
        };
    } else if (type === 'mapbox-tileset') {
        const tilesetId = url.startsWith('mapbox://') ? url.replace('mapbox://', '') : url;
        const mapboxUrl = `mapbox://${tilesetId}`;

        config = {
            title: tilejson?.name || `Mapbox Tileset: ${tilesetId}`,
            description: tilejson?.description || 'Mapbox vector tileset',
            type: 'vector',
            id: tilesetId.replace(/\./g, '-') + '-' + Math.random().toString(36).slice(2, 8),
            url: mapboxUrl,
            sourceLayer: tilejson?.vector_layers?.[0]?.id || tilesetId.split('.')[1] || 'default',
            minzoom: tilejson?.minzoom || 0,
            maxzoom: tilejson?.maxzoom || 22,
            attribution: tilejson?.attribution || '© Mapbox',
            initiallyChecked: false,
            inspect: {
                id: tilejson?.vector_layers?.[0]?.fields?.id ? "id" : "gid",
                title: "Name",
                label: tilejson?.vector_layers?.[0]?.fields?.name ? "name" : "id",
                fields: tilejson?.vector_layers?.[0]?.fields ?
                    Object.keys(tilejson.vector_layers[0].fields).slice(0, 6) :
                    ["id", "name", "type", "class"],
                fieldTitles: tilejson?.vector_layers?.[0]?.fields ?
                    Object.keys(tilejson.vector_layers[0].fields).slice(0, 6).map(field =>
                        field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                    ) :
                    ["ID", "Name", "Type", "Class"]
            }
        };
    } else {
        config = { url };
    }
    return config;
}

/**
 * Resolves a tile/vector/raster/mapbox-tileset/indianopenmaps URL (or a bare
 * Mapbox tileset ID) into `{layerType, config}`.
 */
export async function resolveTileSource(url) {
    let actualUrl = url;
    let tilejson = null;
    let metadata = null;
    let wasConverted = false;

    if (isPbfTileUrl(url)) {
        actualUrl = convertPbfTileUrlToTemplate(url);
        wasConverted = true;
    } else if (isTileUrl(url)) {
        actualUrl = convertTileUrlToTemplate(url);
        wasConverted = true;
    }

    if (isMapboxTilesetId(url)) {
        const tilesetId = url;
        if (window.MAPBOX_ACCESS_TOKEN || window.mapboxgl?.accessToken) {
            const accessToken = window.MAPBOX_ACCESS_TOKEN || window.mapboxgl.accessToken;
            try {
                const tilejsonUrl = `https://api.mapbox.com/v4/${tilesetId}.json?access_token=${accessToken}`;
                const response = await fetch(tilejsonUrl);
                if (response.ok) {
                    tilejson = await response.json();
                }
            } catch (error) {
                console.warn('Failed to fetch Mapbox TileJSON:', error);
            }
        }
        const config = makeLayerConfig(url, tilejson, null);
        return { layerType: guessLayerType(url), config };
    }

    if (MapWarperAPI.isMapWarperUrl(url)) {
        try {
            const config = await MapWarperAPI.createConfigFromUrl(url);
            return { layerType: 'raster', config };
        } catch (error) {
            console.warn('Failed to process MapWarper URL:', error);
        }
    }

    if (isIndianOpenMapsFlyDevViewUrl(url)) {
        try {
            const baseUrl = url.split('/view')[0];
            actualUrl = `${baseUrl}/{z}/{x}/{y}.pbf`;
            const tilejsonUrl = `${baseUrl}/tiles.json`;
            tilejson = await MapUtils.fetchTileJSON(tilejsonUrl);
        } catch (error) {
            console.warn('Failed to fetch TileJSON from indianopenmaps.fly.dev view URL:', error);
        }
    }

    if (isIndianOpenMapsViewerUrl(url)) {
        try {
            const baseUrl = parseIndianOpenMapsViewerUrl(url);
            if (baseUrl) {
                actualUrl = `${baseUrl}/{z}/{x}/{y}.pbf`;
                const tilejsonUrl = `${baseUrl}/tiles.json`;
                tilejson = await MapUtils.fetchTileJSON(tilejsonUrl);
            }
        } catch (error) {
            console.warn('Failed to fetch TileJSON from indianopenmaps.com viewer URL:', error);
        }
    }

    const type = guessLayerType(actualUrl);
    if (type === 'vector') {
        if (!tilejson && actualUrl.includes('indianopenmaps.fly.dev') && actualUrl.includes('{z}')) {
            try {
                const tilejsonUrl = actualUrl.replace(/\{z\}\/\{x\}\/\{y\}\.pbf$/, 'tiles.json');
                tilejson = await MapUtils.fetchTileJSON(tilejsonUrl);
            } catch (error) {
                console.warn('Failed to fetch TileJSON from indianopenmaps.fly.dev:', error);
            }
        }
        if (!tilejson) {
            tilejson = await MapUtils.fetchTileJSON(actualUrl);
        }
    }

    if (wasConverted && type === 'raster') {
        metadata = { autoDetected: true };
    }

    const config = makeLayerConfig(actualUrl, tilejson, metadata);
    return { layerType: type, config };
}

// ---------------------------------------------------------------------------
// Overpass share URL
// ---------------------------------------------------------------------------

function parseOverpassShareId(url) {
    const m = url.trim().match(/overpass-turbo\.eu\/s\/([A-Za-z0-9_-]+)/i);
    return m ? m[1] : null;
}

/**
 * Resolves an overpass-turbo.eu share URL to its underlying Overpass QL query
 * string via the Railway-hosted proxy (browsers can't read cross-origin
 * redirect Location headers directly).
 */
export async function resolveOverpassShareQuery(url) {
    const id = parseOverpassShareId(url);
    if (!id) throw new Error('Invalid Overpass Turbo share URL');

    const response = await fetch(`https://amche-atlas-production.up.railway.app/overpass-share?id=${encodeURIComponent(id)}`);

    if (!response.ok) {
        let errMsg = `HTTP ${response.status}`;
        try {
            const errBody = await response.json();
            if (errBody.error) errMsg = errBody.error;
        } catch (_) { /* ignore */ }
        throw new Error(`Could not resolve share URL: ${errMsg}. Open the URL in overpass-turbo.eu and paste the query text here instead.`);
    }

    const data = await response.json();
    if (!data.query) {
        throw new Error(data.error || 'Empty response from resolver');
    }
    return data.query;
}

function extractOverpassWizardSearch(query) {
    const m = query.match(/original search was:\s*\n\s*[“"']([^”"'\n]+)[”"']/i);
    return m ? m[1].trim() : null;
}

/** Builds the `overpass` layer type's config from a resolved query string. */
export function buildOverpassLayerConfig(query, sourceUrl) {
    const id = `overpass-${Math.floor(Math.random() * 90) + 10}`;
    const title = 'OSM Overpass API Query';

    const wizardSearch = extractOverpassWizardSearch(query);
    let description = 'Live OpenStreetMap features fetched from the Overpass API; refreshes as the viewport changes.';
    if (wizardSearch) {
        description = `Live OSM features matching <code>${wizardSearch}</code>, fetched from the Overpass API as the viewport changes.`;
    }
    if (sourceUrl) {
        description += ` Source query: <a href='${sourceUrl}' target='_blank'>${sourceUrl}</a>.`;
    }

    const viaLink = sourceUrl
        ? `<a href='${sourceUrl}'>Overpass Turbo</a>`
        : `<a href='https://overpass-api.de/'>Overpass API</a>`;
    const attribution = `© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap contributors</a> via ${viaLink}`;

    return {
        id,
        title,
        type: 'overpass',
        description,
        query,
        minzoom: 13,
        attribution,
        style: {
            'circle-color': '#10b981',
            'circle-radius': 5,
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 1,
            'line-color': '#10b981',
            'line-width': 2,
            'fill-color': 'rgba(16,185,129,0.25)'
        },
        inspect: {
            id: 'id',
            title: wizardSearch || 'OSM Feature',
            label: 'name'
        },
        _sourceUrl: sourceUrl || undefined
    };
}

// ---------------------------------------------------------------------------
// Bharatlas
// ---------------------------------------------------------------------------

function parseBharatlasUrl(url) {
    const communityMatch = url.match(/bharatlas\.com\/c\/([A-Za-z0-9]+)/i);
    if (communityMatch) {
        return { communityId: communityMatch[1], pageUrl: `https://bharatlas.com/c/${communityMatch[1]}`, geojsonUrl: null };
    }
    const apiMatch = url.match(/bharatlas\.com\/api\/r2\/community\/([A-Za-z0-9]+)\/([^?#]+)/i);
    if (apiMatch) {
        return {
            communityId: apiMatch[1],
            pageUrl: `https://bharatlas.com/c/${apiMatch[1]}`,
            geojsonUrl: url
        };
    }
    return null;
}

function parseBharatlasPage(html, fallbackPageUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const titleEl = doc.querySelector('h2');
    const descEl = doc.querySelector('p.desc');
    const title = titleEl ? titleEl.textContent.trim() : '';
    const description = descEl ? descEl.textContent.trim() : '';

    let geojsonUrl = null;
    const downloadLink = doc.querySelector('.actions a[download], .actions a.btn[href*="/api/"]');
    if (downloadLink) {
        const href = downloadLink.getAttribute('href');
        geojsonUrl = href.startsWith('http') ? href : `https://bharatlas.com${href}`;
    }

    let sourceText = '';
    let sourceUrl = '';
    let attributionText = '';
    const dts = doc.querySelectorAll('dl.kv dt');
    dts.forEach(dt => {
        const label = (dt.textContent || '').trim().toLowerCase();
        const dd = dt.nextElementSibling;
        if (!dd) return;
        if (label === 'source') {
            const a = dd.querySelector('a');
            if (a) {
                sourceUrl = a.getAttribute('href') || '';
                sourceText = (a.textContent || '').trim();
            } else {
                sourceText = (dd.textContent || '').trim();
            }
        } else if (label === 'attribution') {
            attributionText = (dd.textContent || '').trim();
        }
    });

    return { title, description, geojsonUrl, sourceText, sourceUrl, attributionText, pageUrl: fallbackPageUrl };
}

function buildBharatlasAttribution(meta) {
    const label = meta.attributionText || meta.sourceText || 'Source';
    const labelPart = meta.sourceUrl
        ? `<a href='${meta.sourceUrl}'>${label}</a>`
        : label;
    const viaPart = meta.pageUrl
        ? ` via <a href='${meta.pageUrl}'>bharatlas community</a>`
        : '';
    return `${labelPart}${viaPart}`;
}

/** Scrapes a bharatlas.com community page and fetches its linked GeoJSON. */
export async function resolveBharatlas(url) {
    const parsed = parseBharatlasUrl(url);
    if (!parsed) {
        throw new Error('Unrecognized bharatlas URL');
    }

    const pageResp = await fetch(parsed.pageUrl);
    if (!pageResp.ok) {
        throw new Error(`Could not fetch bharatlas page (${pageResp.status})`);
    }
    const html = await pageResp.text();
    const pageMeta = parseBharatlasPage(html, parsed.pageUrl);

    const geojsonUrl = parsed.geojsonUrl || pageMeta.geojsonUrl;
    if (!geojsonUrl) {
        throw new Error('Could not find GeoJSON download URL on bharatlas page');
    }

    const geojsonResp = await fetch(geojsonUrl);
    if (!geojsonResp.ok) {
        throw new Error(`Could not fetch bharatlas GeoJSON (${geojsonResp.status})`);
    }
    const geojson = await geojsonResp.json();

    const meta = {
        title: pageMeta.title,
        description: pageMeta.description,
        attribution: buildBharatlasAttribution(pageMeta),
        geojsonUrl
    };

    return { geojson, meta };
}

// ---------------------------------------------------------------------------
// Gist
// ---------------------------------------------------------------------------

/** Resolves a gist.github.com URL to the raw URL of its most relevant file. */
export async function resolveGistRawUrl(url) {
    const match = url.match(/^https?:\/\/gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]{16,})/i);
    if (!match) return url;

    const response = await fetch(`https://api.github.com/gists/${match[1]}`);
    if (!response.ok) {
        throw new Error(`Could not resolve Gist (${response.status})`);
    }
    const data = await response.json();
    const files = Object.values(data.files || {});
    if (files.length === 0) {
        throw new Error('Gist has no files');
    }

    const geoFile = files.find(f => /\.(geojson|json|csv|kml|geojsonl|ndjson|jsonl)$/i.test(f.filename));
    return (geoFile || files[0]).raw_url;
}

// ---------------------------------------------------------------------------
// WMS
// ---------------------------------------------------------------------------

export function createWMSConfig(url) {
    const urlParts = url.split('?');
    const baseUrl = urlParts[0];
    const params = new URLSearchParams(urlParts[1] || '');

    const paramsObj = {};
    for (const [key, value] of params.entries()) {
        paramsObj[key.toLowerCase()] = value;
    }

    const layers = paramsObj.layers || paramsObj.layer || '';
    const srs = paramsObj.srs || paramsObj.crs || 'EPSG:3857';

    const title = layers.split(':').pop() || 'WMS Layer';
    const id = generateLayerId(title);

    return {
        id: id,
        title: title,
        type: 'wms',
        url: url,
        tileSize: parseInt(paramsObj.width || paramsObj.height || '256'),
        maxzoom: 18,
        srs: srs,
        attribution: baseUrl
    };
}

// ---------------------------------------------------------------------------
// GeoPackage / Shapefile / GeoJSONL (also used by map-creator.js's direct
// file-upload flow, not just URL fetches)
// ---------------------------------------------------------------------------

export function parseGeoJSONL(content) {
    const features = content.split('\n')
        .filter(line => line.trim())
        .map(line => {
            try {
                const obj = JSON.parse(line);
                if (obj.type === 'Feature') return obj;
                if (obj.coordinates) return { type: 'Feature', geometry: obj, properties: {} };
                return null;
            } catch {
                return null;
            }
        })
        .filter(Boolean);
    return { type: 'FeatureCollection', features };
}

async function loadSqlJs() {
    if (window._sqlJs) return window._sqlJs;
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load sql.js'));
        document.head.appendChild(script);
    });
    window._sqlJs = await window.initSqlJs({
        locateFile: f => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${f}`
    });
    return window._sqlJs;
}

function parseGPKGHeader(data) {
    if (data[0] !== 0x47 || data[1] !== 0x50) {
        return { isEmpty: false, wkbOffset: 0 };
    }
    const flags = data[3];
    const envBytes = [0, 32, 48, 48, 64];
    return {
        isEmpty: (flags & 0x20) !== 0,
        wkbOffset: 8 + (envBytes[(flags >> 1) & 0x07] || 0)
    };
}

function wkbRead(data, state) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const le = data[state.pos++] === 1;
    const rawType = view.getUint32(state.pos, le);
    state.pos += 4;

    const isoBase = rawType & 0xFFFF;
    const baseType = isoBase > 3000 ? isoBase - 3000 :
                     isoBase > 2000 ? isoBase - 2000 :
                     isoBase > 1000 ? isoBase - 1000 : isoBase;
    const hasZ = (rawType & 0x80000000) !== 0 || (isoBase > 1000 && isoBase <= 1007) || isoBase > 3000;
    const hasM = (rawType & 0x40000000) !== 0 || (isoBase > 2000 && isoBase <= 2007) || isoBase > 3000;

    const readF64 = () => { const v = view.getFloat64(state.pos, le); state.pos += 8; return v; };
    const readU32 = () => { const v = view.getUint32(state.pos, le); state.pos += 4; return v; };
    const readPt = () => { const x = readF64(), y = readF64(); if (hasZ) readF64(); if (hasM) readF64(); return [x, y]; };
    const readRing = () => { const n = readU32(); return Array.from({ length: n }, readPt); };

    switch (baseType) {
        case 1: return { type: 'Point', coordinates: readPt() };
        case 2: return { type: 'LineString', coordinates: readRing() };
        case 3: { const n = readU32(); return { type: 'Polygon', coordinates: Array.from({ length: n }, readRing) }; }
        case 4: case 5: case 6: {
            const types = ['MultiPoint', 'MultiLineString', 'MultiPolygon'];
            const n = readU32();
            const coords = [];
            for (let i = 0; i < n; i++) { const g = wkbRead(data, state); if (g) coords.push(g.coordinates); }
            return { type: types[baseType - 4], coordinates: coords };
        }
        default: return null;
    }
}

export async function parseGPKG(arrayBuffer) {
    const SQL = await loadSqlJs();
    const db = new SQL.Database(new Uint8Array(arrayBuffer));

    const tableResult = db.exec('SELECT table_name, column_name FROM gpkg_geometry_columns');
    if (!tableResult.length || !tableResult[0].values.length) {
        db.close();
        throw new Error('No geometry tables found in this GeoPackage');
    }

    const tables = tableResult[0].values.map(r => ({
        tableName: String(r[0]).trim(),
        geomColumn: String(r[1]).trim()
    }));

    const allRows = [];
    for (const { tableName, geomColumn } of tables) {
        const result = db.exec(`SELECT * FROM "${tableName}"`);
        if (!result.length) continue;

        const { columns, values } = result[0];
        const geomIdx = columns.findIndex(c => c.toLowerCase() === geomColumn.toLowerCase());
        if (geomIdx === -1) continue;

        for (const row of values) {
            const geom = row[geomIdx];
            allRows.push({
                geom: geom instanceof Uint8Array ? new Uint8Array(geom) : geom,
                props: row,
                columns,
                geomIdx,
                layer: tables.length > 1 ? tableName : null
            });
        }
    }

    db.close();

    const features = allRows.map(({ geom: geomData, props: row, columns, geomIdx, layer }) => {
        if (!geomData) return null;
        try {
            const { isEmpty, wkbOffset } = parseGPKGHeader(geomData);
            if (isEmpty) return null;
            const geometry = wkbRead(geomData, { pos: wkbOffset });
            if (!geometry) return null;
            const properties = {};
            columns.forEach((col, j) => { if (j !== geomIdx) properties[col] = row[j]; });
            if (layer) properties._layer = layer;
            return { type: 'Feature', geometry, properties };
        } catch (err) {
            return null;
        }
    }).filter(Boolean);

    return { type: 'FeatureCollection', features };
}

async function loadShpJs() {
    if (window.shp) return window.shp;
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/shpjs@4.0.4/dist/shp.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load shpjs'));
        document.head.appendChild(script);
    });
    if (!window.shp) throw new Error('shpjs did not initialise');
    return window.shp;
}

export async function parseShapefile(arrayBuffer) {
    const shpFn = await loadShpJs();
    const result = await shpFn(arrayBuffer);
    if (Array.isArray(result)) {
        const features = result.flatMap(fc => fc.features || []);
        return { type: 'FeatureCollection', features };
    }
    return result;
}

// ---------------------------------------------------------------------------
// CSV / Google Sheets
// ---------------------------------------------------------------------------

/**
 * Resolves a CSV/Google Sheet URL into raw rows. `urlOptions.sheetTabs` +
 * `sheetSpreadsheetId` (already-discovered tabs, from the caller's own tab
 * cache) and `googleSheetGid` ('all', a specific gid, or omitted for a
 * single-tab URL) disambiguate multi-tab sheets — mirrors the exact
 * selection logic map-creator.js's URL-paste flow always used.
 */
export async function resolveCsvSource(url, urlOptions = {}) {
    const { sheetSpreadsheetId, sheetTabs, googleSheetGid } = urlOptions;

    let spreadsheetId = null;
    if (GoogleSheetsAPI.isGoogleSheetUrl(url)) {
        spreadsheetId = GoogleSheetsAPI.extractSpreadsheetId(url);
    }

    const isMultiTabSheet = !!spreadsheetId && spreadsheetId === sheetSpreadsheetId &&
        sheetTabs && sheetTabs.length > 1;
    const selectedGid = isMultiTabSheet ? googleSheetGid : null;

    if (selectedGid === 'all') {
        const rows = await GoogleSheetsAPI.fetchAllSheetRows(spreadsheetId, sheetTabs);
        return { status: 'ok', layerType: 'csv', rows, combined: true, resolvedUrl: GoogleSheetsAPI.buildEditUrl(spreadsheetId) };
    }

    let targetUrl = url;
    if (selectedGid) {
        targetUrl = GoogleSheetsAPI.buildCsvUrl(spreadsheetId, selectedGid);
    }
    const rows = await GoogleSheetsAPI.fetchCsvRows(targetUrl);
    return { status: 'ok', layerType: 'csv', rows, combined: false, resolvedUrl: targetUrl };
}

// ---------------------------------------------------------------------------
// Dynamic layer shorthand federation (allmaps:/mapwarper:/osm:)
// ---------------------------------------------------------------------------

// The three `type:id` shortcut providers dynamic-layer-shorthand.js dispatches
// to — same modules resolveLayerSource() uses for their full-URL forms, so
// there is exactly one place that knows about each service module.
export const DYNAMIC_SHORTHAND_PROVIDERS = {
    allmaps: { resolveFromId: (id) => AllmapsAPI.createConfigFromId(id) },
    mapwarper: { resolveFromId: (id) => MapWarperAPI.createConfigFromId(id) },
    osm: { resolveFromId: (id) => OSMApi.createConfigFromRef(id) }
};

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

/**
 * Resolves a single pasted source URL into a layer config (or, for a few
 * formats that need a user pick first, a `needs-input` descriptor).
 *
 * @param {string} url
 * @param {Object} [urlOptions] - Disambiguating options for formats that
 *   sometimes need a user pick: `googleSheetGid`/`sheetSpreadsheetId`/`sheetTabs`
 *   for multi-tab Google Sheets.
 * @returns {Promise<Object>} One of:
 *   `{status:'ok', layerType, config, resolvedUrl}` — vector/raster/tms/wms/
 *     overpass/mapbox-tileset/csv sources, ready to use.
 *   `{status:'ok', layerType:'geojson', geojson, meta?, resolvedUrl}` — file-like
 *     sources (.geojson/.kml/.geojsonl/.gpkg/.zip/Bharatlas/plain FeatureCollection)
 *     that the caller runs through its own field-detection UI.
 *   `{status:'needs-input', kind:'atlas-layers', atlasData, resolvedUrl}` — a
 *     multi-layer atlas JSON; caller shows its own layer picker.
 *   `{status:'unknown', resolvedUrl}` — unrecognized URL.
 */
export async function resolveLayerSource(url, urlOptions = {}) {
    let resolvedUrl = url;
    if (isGistUrl(resolvedUrl)) {
        resolvedUrl = await resolveGistRawUrl(resolvedUrl);
    }

    const type = detectLayerSourceType(resolvedUrl);

    switch (type) {
        case SOURCE_TYPES.OVERPASS_SHARE: {
            const query = await resolveOverpassShareQuery(resolvedUrl);
            const config = buildOverpassLayerConfig(query, resolvedUrl);
            return { status: 'ok', layerType: 'overpass', config, query, resolvedUrl };
        }
        case SOURCE_TYPES.BHARATLAS: {
            const { geojson, meta } = await resolveBharatlas(resolvedUrl);
            return { status: 'ok', layerType: 'geojson', geojson, meta, resolvedUrl };
        }
        case SOURCE_TYPES.WMS:
            return { status: 'ok', layerType: 'wms', config: createWMSConfig(resolvedUrl), resolvedUrl };
        case SOURCE_TYPES.CSV:
            return { ...(await resolveCsvSource(resolvedUrl, urlOptions)), resolvedUrl };
        case SOURCE_TYPES.ALLMAPS: {
            const config = await AllmapsAPI.createConfigFromUrl(resolvedUrl);
            return { status: 'ok', layerType: 'tms', config, resolvedUrl };
        }
        case SOURCE_TYPES.OSM: {
            const config = await OSMApi.createConfigFromRef(resolvedUrl);
            const ref = OSMApi.extractRef(resolvedUrl);
            return { status: 'ok', layerType: 'osm', config, osmRef: ref ? `${ref.type}/${ref.id}` : null, resolvedUrl };
        }
        case SOURCE_TYPES.MAPWARPER: {
            const config = await MapWarperAPI.createConfigFromUrl(resolvedUrl);
            return { status: 'ok', layerType: 'raster', config, resolvedUrl };
        }
        case SOURCE_TYPES.GPKG: {
            const response = await fetch(resolvedUrl);
            const buffer = await response.arrayBuffer();
            const geojson = await parseGPKG(buffer);
            return { status: 'ok', layerType: 'geojson', geojson, resolvedUrl };
        }
        case SOURCE_TYPES.SHAPEFILE: {
            const response = await fetch(resolvedUrl);
            const buffer = await response.arrayBuffer();
            const geojson = await parseShapefile(buffer);
            return { status: 'ok', layerType: 'geojson', geojson, resolvedUrl };
        }
        case SOURCE_TYPES.GEOJSONL: {
            const response = await fetch(resolvedUrl);
            const text = await response.text();
            const geojson = parseGeoJSONL(text);
            return { status: 'ok', layerType: 'geojson', geojson, resolvedUrl };
        }
        case SOURCE_TYPES.KML: {
            const response = await fetch(resolvedUrl);
            const text = await response.text();
            const geojson = await KMLConverter.kmlToGeoJson(text);
            return { status: 'ok', layerType: 'geojson', geojson, resolvedUrl };
        }
        case SOURCE_TYPES.GEOJSON_FILE: {
            const response = await fetch(resolvedUrl);
            const geojson = await response.json();
            return { status: 'ok', layerType: 'geojson', geojson, resolvedUrl };
        }
        case SOURCE_TYPES.JSON_FILE: {
            const response = await fetch(resolvedUrl);
            const data = await response.json();
            if (data.type === 'FeatureCollection' || data.type === 'Feature') {
                return { status: 'ok', layerType: 'geojson', geojson: data, resolvedUrl };
            }
            if (data.layers && Array.isArray(data.layers)) {
                return { status: 'needs-input', kind: 'atlas-layers', atlasData: data, resolvedUrl };
            }
            if (data.type && data.id) {
                return { status: 'ok', layerType: data.type, config: data, resolvedUrl };
            }
            throw new Error('Invalid layer configuration from JSON URL');
        }
        case SOURCE_TYPES.VECTOR_TILE:
        case SOURCE_TYPES.RASTER_TILE:
        case SOURCE_TYPES.MAPBOX_TILESET:
        case SOURCE_TYPES.INDIANOPENMAPS: {
            const { layerType, config } = await resolveTileSource(resolvedUrl);
            return { status: 'ok', layerType, config, resolvedUrl };
        }
        default:
            return { status: 'unknown', resolvedUrl };
    }
}

/**
 * MapWarper URL API Middleware
 *
 * Provides a unified interface for working with MapWarper URLs.
 * Supports both individual maps and mosaics from mapwarper.net and warper.wmflabs.org.
 *
 * Usage:
 * ```javascript
 * import { MapWarperAPI } from './mapwarper-url-api.js';
 *
 * const config = await MapWarperAPI.createConfigFromUrl(url);
 * ```
 */

export class MapWarperAPI {
    static isMosaicUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return /\/layers\/\d+/i.test(url);
    }

    static isMapUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return /\/maps\/\d+/i.test(url);
    }

    static isMapWarperUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return (url.includes('mapwarper.net') || url.includes('warper.wmflabs.org')) &&
               (this.isMapUrl(url) || this.isMosaicUrl(url));
    }

    static extractBaseUrl(url) {
        try {
            const urlObj = new URL(url);
            return `${urlObj.protocol}//${urlObj.host}`;
        } catch (error) {
            if (url.includes('warper.wmflabs.org')) {
                return 'https://warper.wmflabs.org';
            }
            return 'https://mapwarper.net';
        }
    }

    static extractMosaicId(url) {
        const match = url.match(/\/layers\/(\d+)/i);
        return match ? match[1] : null;
    }

    static extractMapId(url) {
        const match = url.match(/\/maps\/(\d+)/i);
        return match ? match[1] : null;
    }

    static async fetchMosaicMetadata(mosaicId, baseUrl = 'https://mapwarper.net') {
        try {
            const apiUrl = `${baseUrl}/api/v1/layers/${mosaicId}`;
            console.log(`[MapWarper] Fetching mosaic metadata from: ${apiUrl}`);

            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch mosaic metadata: ${response.status} ${response.statusText}`);
            }

            const apiResponse = await response.json();
            const data = apiResponse.data?.attributes || {};
            const links = apiResponse.data?.links || {};

            return {
                id: mosaicId,
                name: data.name,
                description: data.description,
                bbox: data.bbox,
                maps_count: data.maps_count,
                created_at: data.created_at,
                updated_at: data.updated_at,
                source_uri: data.source_uri,
                tiles_url: links.tiles,
                kml_url: links.kml,
                wms_url: links.wms
            };
        } catch (error) {
            console.error(`[MapWarper] Error fetching mosaic ${mosaicId}:`, error);
            throw error;
        }
    }

    static async fetchMosaicMaps(mosaicId, baseUrl = 'https://mapwarper.net') {
        try {
            const apiUrl = `${baseUrl}/api/v1/layers/${mosaicId}/maps`;
            console.log(`[MapWarper] Fetching mosaic maps from: ${apiUrl}`);

            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch mosaic maps: ${response.status} ${response.statusText}`);
            }

            const apiResponse = await response.json();
            const maps = apiResponse.data || [];

            console.log(`[MapWarper] Found ${maps.length} maps in mosaic ${mosaicId}`);
            return maps;
        } catch (error) {
            console.error(`[MapWarper] Error fetching mosaic maps ${mosaicId}:`, error);
            throw error;
        }
    }

    static bboxToPolygon(bbox) {
        if (!bbox) return null;

        let coords;
        if (typeof bbox === 'string') {
            coords = bbox.split(',').map(parseFloat);
        } else if (Array.isArray(bbox)) {
            coords = bbox;
        } else {
            return null;
        }

        if (coords.length !== 4 || coords.some(isNaN)) {
            return null;
        }

        const [west, south, east, north] = coords;

        return {
            type: 'Polygon',
            coordinates: [[
                [west, north],
                [east, north],
                [east, south],
                [west, south],
                [west, north]
            ]]
        };
    }

    static async buildMosaicGeoJSON(mosaicId, baseUrl = 'https://mapwarper.net') {
        try {
            const maps = await this.fetchMosaicMaps(mosaicId, baseUrl);

            const features = maps
                .map(mapData => {
                    const attrs = mapData.attributes || {};
                    const bbox = attrs.bbox;

                    if (!bbox) {
                        console.warn(`[MapWarper] Map ${mapData.id} has no bbox, skipping`);
                        return null;
                    }

                    const geometry = this.bboxToPolygon(bbox);
                    if (!geometry) {
                        console.warn(`[MapWarper] Invalid bbox for map ${mapData.id}, skipping`);
                        return null;
                    }

                    return {
                        type: 'Feature',
                        id: mapData.id,
                        geometry: geometry,
                        properties: {
                            id: mapData.id,
                            title: attrs.title || `Map ${mapData.id}`,
                            description: attrs.description || '',
                            status: attrs.status || 'unknown',
                            width: attrs.width,
                            height: attrs.height,
                            map_type: attrs.map_type,
                            created_at: attrs.created_at,
                            updated_at: attrs.updated_at,
                            url: `${baseUrl}/maps/${mapData.id}`,
                            'stroke': '#ff6b6b',
                            'stroke-width': 2,
                            'stroke-opacity': 0.8,
                            'fill': '#ff6b6b',
                            'fill-opacity': 0.1
                        }
                    };
                })
                .filter(feature => feature !== null);

            const geojson = {
                type: 'FeatureCollection',
                features: features
            };

            console.log(`[MapWarper] Built GeoJSON with ${features.length} features for mosaic ${mosaicId}`);
            return geojson;
        } catch (error) {
            console.error(`[MapWarper] Error building GeoJSON for mosaic ${mosaicId}:`, error);
            return null;
        }
    }

    static async fetchMapMetadata(mapId, baseUrl = 'https://mapwarper.net') {
        try {
            const apiUrl = `${baseUrl}/api/v1/maps/${mapId}`;
            console.log(`[MapWarper] Fetching map metadata from: ${apiUrl}`);

            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch map metadata: ${response.status} ${response.statusText}`);
            }

            const apiResponse = await response.json();
            const data = apiResponse.data?.attributes || {};
            const links = apiResponse.data?.links || {};

            return {
                mapId: mapId,
                title: data.title || `MapWarper Map ${mapId}`,
                description: data.description || '',
                source: data.source_uri || '',
                attribution: data.attribution || '',
                date: data.date_depicted || '',
                thumbnail: links.thumb ? `${baseUrl}${links.thumb}` : null,
                bbox: data.bbox || null
            };
        } catch (error) {
            console.error(`[MapWarper] Error fetching map ${mapId}:`, error);
            throw error;
        }
    }

    static createMosaicConfig(mosaicData, baseUrl = 'https://mapwarper.net', geojson = null) {
        const mosaicId = mosaicData.id;
        const tilesUrl = mosaicData.tiles_url || `${baseUrl}/layers/tile/${mosaicId}/{z}/{x}/{y}.png`;

        const config = {
            id: `mapwarper-mosaic-${mosaicId}`,
            type: 'tms',
            title: mosaicData.name || `Mapwarper Mosaic ${mosaicId}`,
            url: tilesUrl,
            opacity: 0.85,
            initiallyChecked: true
        };

        if (mosaicData.description && mosaicData.description.trim()) {
            config.description = mosaicData.description;
        }

        if (mosaicData.bbox) {
            if (typeof mosaicData.bbox === 'string') {
                const parts = mosaicData.bbox.split(',').map(s => s.trim());
                if (parts.length === 4) {
                    const [west, south, east, north] = parts.map(parseFloat);
                    if (!isNaN(west) && !isNaN(south) && !isNaN(east) && !isNaN(north)) {
                        config.bbox = mosaicData.bbox;
                    }
                }
            } else if (Array.isArray(mosaicData.bbox) && mosaicData.bbox.length === 4) {
                const [west, south, east, north] = mosaicData.bbox;
                if (!isNaN(west) && !isNaN(south) && !isNaN(east) && !isNaN(north)) {
                    config.bbox = `${west},${south},${east},${north}`;
                }
            }
        }

        const mosaicName = mosaicData.name || `Mosaic ${mosaicId}`;
        let attributionText = mosaicName;
        if (mosaicData.source_uri && mosaicData.source_uri.trim()) {
            attributionText = `${mosaicName} - <a href="${mosaicData.source_uri}" target="_blank">Source</a>`;
        }
        config.attribution = `<a href="${baseUrl}/layers/${mosaicId}" target="_blank">${attributionText}</a>`;

        if (mosaicData.maps_count !== undefined && mosaicData.maps_count > 0) {
            const mapsInfo = `<em>Contains ${mosaicData.maps_count} georeferenced map${mosaicData.maps_count !== 1 ? 's' : ''}</em>`;
            config.description = config.description
                ? `${config.description}<br><br>${mapsInfo}`
                : mapsInfo;
        }

        if (mosaicData.created_at) {
            const createdDate = new Date(mosaicData.created_at).toLocaleDateString();
            config.description = config.description
                ? `${config.description}<br><small>Created: ${createdDate}</small>`
                : `<small>Created: ${createdDate}</small>`;
        }

        if (geojson && geojson.features && geojson.features.length > 0) {
            config.geojson = geojson;
        }

        return config;
    }

    static createMapConfig(mapMetadata, baseUrl = 'https://mapwarper.net') {
        const mapId = mapMetadata.mapId;

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

            attribution += attribution ? ' via ' : '';
            attribution += `<a href='${baseUrl}/maps/${mapId}' target='_blank'>MapWarper</a>`;

            return attribution || undefined;
        };

        const config = {
            title: cleanTitle(mapMetadata.title),
            description: formatDescription(mapMetadata.description),
            date: mapMetadata.date || undefined,
            type: 'tms',
            id: `mapwarper-${mapId}`,
            url: `${baseUrl}/maps/tile/${mapId}/{z}/{x}/{y}.png`,
            style: {
                'raster-opacity': [
                    'interpolate', ['linear'], ['zoom'], 6, 0.95, 18, 0.8, 19, 0.3
                ]
            },
            attribution: formatAttribution(mapMetadata),
            headerImage: mapMetadata.thumbnail || undefined,
            bbox: mapMetadata.bbox || undefined,
            initiallyChecked: false
        };

        Object.keys(config).forEach(key => {
            if (config[key] === undefined) delete config[key];
        });

        return config;
    }

    static async createConfigFromUrl(url) {
        if (!this.isMapWarperUrl(url)) {
            throw new Error('Not a valid MapWarper URL');
        }

        const cleanUrl = url.split('#')[0];
        const baseUrl = this.extractBaseUrl(cleanUrl);

        if (this.isMosaicUrl(cleanUrl)) {
            const mosaicId = this.extractMosaicId(cleanUrl);
            if (!mosaicId) {
                throw new Error('Could not extract mosaic ID from URL');
            }

            console.log(`[MapWarper] Processing mosaic ${mosaicId} from ${baseUrl}`);
            const mosaicData = await this.fetchMosaicMetadata(mosaicId, baseUrl);

            let geojson = null;
            try {
                geojson = await this.buildMosaicGeoJSON(mosaicId, baseUrl);
            } catch (error) {
                console.warn(`[MapWarper] Failed to build GeoJSON for mosaic ${mosaicId}, continuing without it:`, error);
            }

            return this.createMosaicConfig(mosaicData, baseUrl, geojson);
        }

        if (this.isMapUrl(cleanUrl)) {
            const mapId = this.extractMapId(cleanUrl);
            if (!mapId) {
                throw new Error('Could not extract map ID from URL');
            }

            console.log(`[MapWarper] Processing map ${mapId} from ${baseUrl}`);
            const mapData = await this.fetchMapMetadata(mapId, baseUrl);
            return this.createMapConfig(mapData, baseUrl);
        }

        throw new Error('URL is not a recognized MapWarper map or mosaic URL');
    }
}

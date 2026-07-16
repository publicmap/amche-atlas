/**
 * OpenStreetMap Element URL API Middleware
 *
 * Resolves a single OSM element (node/way/relation) by ID into a ready-to-use
 * `geojson` layer config. Unlike the `overpass` layer type (which re-queries a
 * viewport bbox on every pan — see js/mapbox-api.js `_createOverpassLayer`), a
 * specific element referenced by ID is a fixed feature, so this fetches its
 * geometry once via the Overpass API and inlines the result rather than
 * polling on every map move.
 *
 * Usage:
 * ```javascript
 * import { OSMApi } from './osm-url-api.js';
 *
 * const config = await OSMApi.createConfigFromRef('relation/21057460');
 * ```
 */

const OSMTOGEOJSON_CDN = 'https://cdn.jsdelivr.net/npm/osmtogeojson@3.0.0-beta.5/+esm';
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

export class OSMApi {
    // feature.id from osmtogeojson (and this shorthand's `id` field) both use
    // the canonical "node/123" / "way/456" / "relation/789" form — see
    // docs/API.md's `overpass` layer type section.
    static extractRef(input) {
        if (!input) return null;
        const match = String(input).match(/(node|way|relation)\/(\d+)/i);
        if (!match) return null;
        return { type: match[1].toLowerCase(), id: match[2] };
    }

    static isElementRef(ref) {
        return !!this.extractRef(ref);
    }

    static isOsmUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return /openstreetmap\.org\/(node|way|relation)\/\d+/i.test(url);
    }

    static buildQuery(type, id) {
        // "out geom" returns full geometry in one shot — for relations this
        // includes member geometry too, no separate recursion step needed.
        const verb = type === 'node' ? 'out;' : 'out geom;';
        return `[out:json][timeout:25];${type}(${id});${verb}`;
    }

    static async fetchElementGeoJSON(type, id) {
        const query = this.buildQuery(type, id);
        const response = await fetch(OVERPASS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query)
        });
        if (!response.ok) {
            throw new Error(`Overpass HTTP ${response.status}`);
        }
        const osmJson = await response.json();

        const { default: osmtogeojson } = await import(/* @vite-ignore */ OSMTOGEOJSON_CDN);
        const geojson = osmtogeojson(osmJson);
        if (!geojson.features || geojson.features.length === 0) {
            throw new Error(`OSM ${type} ${id} not found or has no geometry`);
        }
        return geojson;
    }

    static bboxFromGeoJSON(geojson) {
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

        const visit = (coords, depth) => {
            if (depth === 0) {
                const [lng, lat] = coords;
                if (typeof lng !== 'number' || typeof lat !== 'number') return;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            } else {
                coords.forEach(c => visit(c, depth - 1));
            }
        };

        const depthByGeomType = {
            Point: 0, MultiPoint: 1, LineString: 1,
            MultiLineString: 2, Polygon: 2, MultiPolygon: 3
        };

        (geojson.features || []).forEach(feature => {
            const geom = feature.geometry;
            if (!geom || !geom.coordinates) return;
            const depth = depthByGeomType[geom.type];
            if (depth === undefined) return;
            visit(geom.coordinates, depth);
        });

        if (!isFinite(minLng) || !isFinite(minLat) || !isFinite(maxLng) || !isFinite(maxLat)) {
            return undefined;
        }
        return `${minLng},${minLat},${maxLng},${maxLat}`;
    }

    static createConfig(type, id, geojson) {
        const primary = geojson.features.find(f => f.id === `${type}/${id}`) || geojson.features[0];
        const name = primary?.properties?.name;
        const title = name || `OSM ${type} ${id}`;

        const osmUrl = `https://www.openstreetmap.org/${type}/${id}`;
        const attribution = `<a href='${osmUrl}' target='_blank'>${title}</a> — © <a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap contributors</a>`;

        const config = {
            title,
            type: 'geojson',
            id: `osm-${type}-${id}`,
            geojson,
            attribution,
            bbox: this.bboxFromGeoJSON(geojson),
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
                title: 'name',
                label: 'name'
            },
            initiallyChecked: false
        };

        Object.keys(config).forEach(key => {
            if (config[key] === undefined) delete config[key];
        });

        return config;
    }

    static async createConfigFromRef(ref) {
        const parsed = typeof ref === 'string' ? this.extractRef(ref) : ref;
        if (!parsed || !parsed.type || !parsed.id) {
            throw new Error('Could not parse an OSM element reference (expected e.g. "relation/12345", "way/12345", or "node/12345")');
        }
        const geojson = await this.fetchElementGeoJSON(parsed.type, parsed.id);
        return this.createConfig(parsed.type, parsed.id, geojson);
    }
}

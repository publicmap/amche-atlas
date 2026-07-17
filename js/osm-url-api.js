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

import { WikidataAPI } from './wikidata-url-api.js';

const OSMTOGEOJSON_CDN = 'https://cdn.jsdelivr.net/npm/osmtogeojson@3.0.0-beta.5/+esm';
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const OVERPASS_TURBO_URL = 'https://overpass-turbo.eu/';

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

    static osmUrlToObject(type, id) {
        return `https://www.openstreetmap.org/${type}/${id}`;
    }

    static buildQuery(type, id) {
        // "meta" adds version/timestamp/changeset/user to each element (used
        // for the layer description below); "geom" returns full geometry in
        // one shot — for relations this includes member geometry too, no
        // separate recursion step needed.
        const verb = type === 'node' ? 'out meta;' : 'out meta geom;';
        return `[out:json][timeout:60];${type}(${id});${verb}`;
    }

    static overpassTurboUrl(type, id) {
        const query = this.buildQuery(type, id);
        return `${OVERPASS_TURBO_URL}?Q=${encodeURIComponent(query)}&R`;
    }

    static formatRelativeTime(isoTimestamp) {
        if (!isoTimestamp) return undefined;
        const diffMs = Date.now() - new Date(isoTimestamp).getTime();
        const minutes = Math.floor(diffMs / 60000);
        if (minutes < 60) return minutes <= 1 ? '1 minute ago' : `${minutes} minutes ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return days === 1 ? '1 day ago' : `${days} days ago`;
        const months = Math.floor(days / 30);
        if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
        const years = Math.floor(months / 12);
        return years === 1 ? '1 year ago' : `${years} years ago`;
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

        // Each feature's own type/id (not just the requested element's) gets
        // a `url` property, so e.g. relation members link to their own OSM page.
        geojson.features.forEach(feature => {
            const ref = this.extractRef(feature.id);
            if (!ref) return;
            feature.properties = feature.properties || {};
            feature.properties.url = this.osmUrlToObject(ref.type, ref.id);
        });

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

    static async createConfig(type, id, geojson) {
        const primary = geojson.features.find(f => f.id === `${type}/${id}`) || geojson.features[0];
        const props = primary?.properties || {};
        const name = props.name;
        const title = name || `OSM ${type} ${id}`;

        const osmUrl = this.osmUrlToObject(type, id);
        const attribution = `<a href='${osmUrl}' target='_blank'>${title}</a> — © <a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap contributors</a>`;

        let description = `Feature exported from <a href='${osmUrl}/history' target='_blank'>OpenStreetMap</a> via <a href='${this.overpassTurboUrl(type, id)}' target='_blank'>Overpass API</a>.`;
        if (props.version !== undefined) description += ` Feature version <strong>v${props.version}</strong>`;
        const editedAgo = this.formatRelativeTime(props.timestamp);
        if (editedAgo) description += ` Last edited ${editedAgo}.`;

        let headerImage;
        if (WikidataAPI.isQid(props.wikidata)) {
            try {
                const summary = await WikidataAPI.getSummary(props.wikidata);
                if (summary.description) {
                    const wikipediaLink = summary.wikipediaUrl ? ` (<a href='${summary.wikipediaUrl}' target='_blank'>Wikipedia</a>)` : '';
                    const wikidataLink = ` (<a href='https://www.wikidata.org/wiki/${props.wikidata}' target='_blank'>Wikidata</a>)`;
                    description = `${summary.title} is ${summary.description}${wikipediaLink}${wikidataLink}. ${description}`;
                }
                headerImage = summary.headerImage;
            } catch (error) {
                console.warn(`[OSM] Failed to resolve wikidata ${props.wikidata}:`, error);
            }
        }

        const config = {
            title,
            type: 'geojson',
            id: `osm-${type}-${id}`,
            geojson,
            description,
            attribution,
            headerImage,
            bbox: this.bboxFromGeoJSON(geojson),
            style: {
                'circle-color': '#10b981',
                'circle-stroke-color': '#fff',
                'line-color': '#10b981',
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

/**
 * OpenStreetMap Element URL API Middleware
 *
 * Resolves a single OSM element (node/way/relation) by ID into a ready-to-use
 * `geojson` layer config. Unlike the `overpass` layer type (which re-queries a
 * viewport bbox on every pan — see js/mapbox-api.js `_createOverpassLayer`), a
 * specific element referenced by ID is a fixed feature, so this fetches its
 * geometry once and inlines the result rather than polling on every map move.
 *
 * Single-element lookups go straight to the OSM API v0.6 (api.openstreetmap.org)
 * rather than Overpass: it's the canonical source, needs no query language,
 * responds with the same `elements` JSON shape osmtogeojson already consumes,
 * and doesn't depend on the (rate-limited, occasionally overloaded) public
 * Overpass instance. Multi-ref batching (see fetchElementsGeoJSON /
 * createConfigsFromRefs) stays on Overpass since the OSM API has no equivalent
 * single-call batch endpoint that also resolves geometry.
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
const OSM_API_BASE = 'https://api.openstreetmap.org/api/0.6';
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

    // Nodes need no geometry expansion; ways/relations need "/full" to pull
    // in their member nodes (and, for relations, member ways) so osmtogeojson
    // has enough elements to assemble a LineString/Polygon.
    static elementApiUrl(type, id) {
        const path = type === 'node' ? `node/${id}` : `${type}/${id}/full`;
        return `${OSM_API_BASE}/${path}.json`;
    }

    static osmToGeoJSON(osmJson) {
        return import(/* @vite-ignore */ OSMTOGEOJSON_CDN).then(({ default: osmtogeojson }) => osmtogeojson(osmJson));
    }

    static annotateFeatureUrls(geojson) {
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

    static async fetchElementGeoJSON(type, id) {
        const response = await fetch(this.elementApiUrl(type, id));
        if (response.status === 404 || response.status === 410) {
            throw new Error(`OSM ${type} ${id} not found (may have been deleted)`);
        }
        if (!response.ok) {
            throw new Error(`OSM API HTTP ${response.status}`);
        }
        const osmJson = await response.json();

        const geojson = await this.osmToGeoJSON(osmJson);
        if (!geojson.features || geojson.features.length === 0) {
            throw new Error(`OSM ${type} ${id} not found or has no geometry`);
        }

        return this.annotateFeatureUrls(geojson);
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

    // A relation's members can mix points/lines/polygons (e.g. a route
    // relation's ways stay LineStrings, only multipolygon/boundary relations
    // get assembled into Polygons by osmtogeojson) — so the default style
    // only includes the paint properties for geometry types actually present,
    // rather than always defining circle/line/fill regardless of geometry.
    static styleForGeometryTypes(geojson) {
        const types = new Set();
        (geojson.features || []).forEach(feature => {
            if (feature.geometry && feature.geometry.type) types.add(feature.geometry.type);
        });

        const hasPoint = types.has('Point') || types.has('MultiPoint');
        const hasLine = types.has('LineString') || types.has('MultiLineString');
        const hasPolygon = types.has('Polygon') || types.has('MultiPolygon');

        const style = {};
        if (hasPoint) {
            style['circle-radius'] = 1;
            style['circle-color'] = '#fff';
            style['circle-stroke-color'] = 'rgba(1, 106, 71, 1)';
        }
        // Line paint also strokes polygon outlines, so lines and polygons share it.
        if (hasLine || hasPolygon) {
            style['line-color'] = 'rgba(1, 106, 71, 1)';
        }
        if (hasPolygon) {
            style['fill-color'] = 'rgba(16,185,129,0.25)';
        }
        return style;
    }

    static async createConfig(type, id, geojson, source = 'osm-api') {
        const primary = geojson.features.find(f => f.id === `${type}/${id}`) || geojson.features[0];
        const props = primary?.properties || {};
        const name = props.name;
        const title = name || `OSM ${type} ${id}`;

        const osmUrl = this.osmUrlToObject(type, id);
        const attribution = `<a href='${osmUrl}' target='_blank'>${title}</a> — © <a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap contributors</a>`;

        const sourceLink = source === 'overpass'
            ? `via <a href='${this.overpassTurboUrl(type, id)}' target='_blank'>Overpass API</a>`
            : `via the <a href='${this.elementApiUrl(type, id)}' target='_blank'>OSM API</a>`;
        let description = `Feature exported from <a href='${osmUrl}/history' target='_blank'>OpenStreetMap</a> ${sourceLink}.`;
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
            style: this.styleForGeometryTypes(geojson),
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

    // Single `out meta geom;` covers every ref regardless of type — the
    // "geom" modifier only affects ways/relations (adds inline member
    // geometry), it's a harmless no-op for nodes, which already carry lat/lon.
    static buildBatchQuery(refs) {
        const statements = refs.map(({ type, id }) => `${type}(${id});`).join('\n  ');
        return `[out:json][timeout:180];\n(\n  ${statements}\n);\nout meta geom;`;
    }

    /**
     * Fetches multiple OSM elements in a single Overpass request and groups
     * the resulting features back by their own "type/id" ref. Each requested
     * ref queries a single top-level element (no recursion), so every
     * returned feature's own id maps unambiguously back to one ref.
     *
     * Returns a Map<"type/id", Feature[]> — a ref with no entry (or an empty
     * array) means it wasn't found / had no geometry.
     */
    static async fetchElementsGeoJSON(refs) {
        const query = this.buildBatchQuery(refs);
        const response = await fetch(OVERPASS_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query)
        });
        if (!response.ok) {
            throw new Error(`Overpass HTTP ${response.status}`);
        }
        const osmJson = await response.json();

        const geojson = await this.osmToGeoJSON(osmJson);

        const byRef = new Map();
        geojson.features.forEach(feature => {
            const ref = this.extractRef(feature.id);
            if (!ref) return;
            feature.properties = feature.properties || {};
            feature.properties.url = this.osmUrlToObject(ref.type, ref.id);

            const key = `${ref.type}/${ref.id}`;
            if (!byRef.has(key)) byRef.set(key, []);
            byRef.get(key).push(feature);
        });

        return byRef;
    }

    /**
     * Batched equivalent of createConfigFromRef() for multiple refs — see
     * dynamic-layer-shorthand.js's resolveDynamicLayerShorthands(), which
     * uses this to fold several "osm:" URL shorthand layers into one
     * Overpass request instead of one request per layer.
     *
     * Returns a Map<"type/id", config|Error> — one entry per input ref, in
     * the same order, with a per-ref Error for any that failed so a single
     * unresolvable ref doesn't drop the whole batch.
     */
    static async createConfigsFromRefs(refs) {
        const byRef = await this.fetchElementsGeoJSON(refs);
        const results = new Map();

        for (const { type, id } of refs) {
            const key = `${type}/${id}`;
            const features = byRef.get(key);
            if (!features || features.length === 0) {
                results.set(key, new Error(`OSM ${type} ${id} not found or has no geometry`));
                continue;
            }
            try {
                results.set(key, await this.createConfig(type, id, { type: 'FeatureCollection', features }, 'overpass'));
            } catch (error) {
                results.set(key, error);
            }
        }

        return results;
    }
}

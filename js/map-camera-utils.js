/**
 * CameraUtils - Shared viewport/camera helpers (bbox math + fitBounds) so
 * every "auto zoom to this data" feature (initial URL-layer auto-fit in
 * map-init.js, layer-creator live preview in map-creator.js, future camera
 * features) uses one bbox algorithm and one set of fit defaults instead of
 * each reimplementing them.
 */

import { MapUtils } from './map-utils.js';

const GEOMETRY_COORDINATE_DEPTH = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3
};

export class CameraUtils {
    // Matches the padding/maxZoom/duration already used for "fit to newly
    // added layer" elsewhere (url-manager.js zoomTo handler, map-browser-control.js).
    static DEFAULT_FIT_OPTIONS = {
        padding: 50,
        maxZoom: 16,
        duration: 1000,
        essential: true
    };

    /**
     * Compute a [west, south, east, north] bbox from a GeoJSON Feature,
     * FeatureCollection, or Geometry (no turf dependency, since turf isn't
     * guaranteed to be loaded on every page that needs this). Returns null
     * for empty/invalid input.
     */
    static computeGeojsonBbox(geojson) {
        if (!geojson) return null;

        let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;

        const visitCoordinate = (coord) => {
            const [lon, lat] = coord;
            if (typeof lon !== 'number' || typeof lat !== 'number') return;
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        };

        const visitCoordinates = (coords, depth) => {
            if (depth === 0) {
                visitCoordinate(coords);
            } else {
                coords.forEach(c => visitCoordinates(c, depth - 1));
            }
        };

        const visitGeometry = (geometry) => {
            if (!geometry) return;
            if (geometry.type === 'GeometryCollection') {
                geometry.geometries?.forEach(visitGeometry);
                return;
            }
            const depth = GEOMETRY_COORDINATE_DEPTH[geometry.type];
            if (depth === undefined || !geometry.coordinates) return;
            visitCoordinates(geometry.coordinates, depth);
        };

        if (geojson.type === 'FeatureCollection') {
            geojson.features?.forEach(f => visitGeometry(f.geometry));
        } else if (geojson.type === 'Feature') {
            visitGeometry(geojson.geometry);
        } else {
            visitGeometry(geojson);
        }

        if (minLon === Infinity || minLat === Infinity || maxLon === -Infinity || maxLat === -Infinity) {
            return null;
        }

        return [minLon, minLat, maxLon, maxLat];
    }

    /**
     * Merge a bbox into a running bounds accumulator. Either argument may be
     * null (an empty accumulator, or nothing to add); returns a new array.
     */
    static extendBbox(bounds, bbox) {
        if (!bbox) return bounds;
        if (!bounds) return [...bbox];
        return [
            Math.min(bounds[0], bbox[0]),
            Math.min(bounds[1], bbox[1]),
            Math.max(bounds[2], bbox[2]),
            Math.max(bounds[3], bbox[3])
        ];
    }

    /**
     * Try to determine a layer's bbox synchronously from its config, without
     * touching the map or fetching remote data. Checks (in order): an
     * explicit `bbox` field (array or "w,s,e,n" string, via MapUtils.parseBbox),
     * `map.bounds` ([[w,s],[e,n]], used by hash-layer links), and inline
     * `geojson` data. Returns null if none apply (e.g. a geojson/csv layer
     * that only has a remote `url` — see isGeojsonBackedType for that case).
     */
    static getSyncLayerBbox(layer) {
        if (!layer) return null;

        const fromBboxField = MapUtils.parseBbox(layer.bbox);
        if (fromBboxField) return fromBboxField;

        const bounds = layer.map?.bounds;
        if (Array.isArray(bounds) && bounds.length === 2) {
            const [sw, ne] = bounds;
            if (Array.isArray(sw) && Array.isArray(ne) && sw.length === 2 && ne.length === 2) {
                return [sw[0], sw[1], ne[0], ne[1]];
            }
        }

        if (layer.geojson) {
            try {
                const data = typeof layer.geojson === 'string' ? JSON.parse(layer.geojson) : layer.geojson;
                return this.computeGeojsonBbox(data);
            } catch {
                return null;
            }
        }

        return null;
    }

    /**
     * True for layer types whose map source ends up holding GeoJSON that a
     * bbox can be computed from once loaded (geojson/csv). Overpass layers
     * are deliberately excluded — their query commonly depends on the current
     * viewport via a `{{bbox}}` placeholder, so fitting the camera to their
     * result would be circular.
     */
    static isGeojsonBackedType(layer) {
        return !!layer && (layer.type === 'geojson' || layer.type === 'csv');
    }

    /** The Mapbox source id MapboxAPI creates for a geojson/csv-backed layer. */
    static sourceIdForLayer(layer) {
        return layer.type === 'csv' ? `csv-${layer.id}` : `geojson-${layer.id}`;
    }

    static fitBounds(map, bbox, options = {}) {
        if (!map || !bbox) return;
        const [west, south, east, north] = bbox;
        map.fitBounds([[west, south], [east, north]], { ...this.DEFAULT_FIT_OPTIONS, ...options });
    }

    /**
     * Progressively fit the camera to a set of layers as their data becomes
     * available, keeping every fitted layer within one shared viewport.
     * Layers with a synchronously known bbox are folded in immediately;
     * geojson/csv layers backed by a remote source are watched via the map's
     * `sourcedata` event and folded in (with a re-fit) as each one finishes
     * loading — "one by one" rather than waiting for every layer to settle.
     *
     * @param {mapboxgl.Map} map
     * @param {Array} layers - resolved layer configs to consider
     * @param {Object} [options] - passed to map.fitBounds (merged over
     *   DEFAULT_FIT_OPTIONS), plus:
     *   - onFit(bbox): called after each fit (first call = first data shown)
     *   - giveUpAfter: ms to keep watching pending remote sources (default 15000)
     * @returns {boolean} true if at least one layer was eligible to auto-fit
     *   (regardless of whether a fit has happened yet) — callers use this to
     *   decide whether to skip their own default camera placement.
     */
    static autoFitLayers(map, layers, options = {}) {
        const { onFit, giveUpAfter = 15000, ...fitOptions } = options;
        const mergedFitOptions = { ...this.DEFAULT_FIT_OPTIONS, ...fitOptions };

        const eligible = (layers || []).filter(l => l && (this.getSyncLayerBbox(l) || this.isGeojsonBackedType(l)));
        if (eligible.length === 0) return false;

        let bounds = null;
        let fitTimer = null;
        const pendingSourceIds = new Set();

        // Debounce so several layers finishing close together produce one
        // combined fit instead of a fit-per-layer camera jitter.
        const scheduleFit = () => {
            if (!bounds) return;
            clearTimeout(fitTimer);
            fitTimer = setTimeout(() => {
                this.fitBounds(map, bounds, mergedFitOptions);
                onFit?.(bounds);
            }, 200);
        };

        eligible.forEach(layer => {
            const syncBbox = this.getSyncLayerBbox(layer);
            if (syncBbox) {
                bounds = this.extendBbox(bounds, syncBbox);
            } else {
                pendingSourceIds.add(this.sourceIdForLayer(layer));
            }
        });

        if (bounds) scheduleFit();

        if (pendingSourceIds.size === 0) return true;

        // GeoJSONSource has no public data getter in Mapbox GL JS; `_data` is
        // the same private field url-manager.js's waitForSourceData relies on.
        const tryResolveSource = (sourceId) => {
            const source = map.getSource(sourceId);
            if (!source || !map.isSourceLoaded(sourceId)) return false;
            const bbox = source._data ? this.computeGeojsonBbox(source._data) : null;
            if (bbox) {
                bounds = this.extendBbox(bounds, bbox);
                scheduleFit();
            }
            return true;
        };

        // Sweep once up front for sources that already finished loading
        // before we started listening (the layer-add flow may run ahead of us).
        Array.from(pendingSourceIds).forEach(sourceId => {
            if (tryResolveSource(sourceId)) pendingSourceIds.delete(sourceId);
        });

        if (pendingSourceIds.size === 0) return true;

        const stopWatching = () => {
            map.off('sourcedata', onSourceData);
            clearTimeout(giveUpTimer);
        };

        const onSourceData = (e) => {
            if (!pendingSourceIds.has(e.sourceId)) return;
            if (tryResolveSource(e.sourceId)) {
                pendingSourceIds.delete(e.sourceId);
                if (pendingSourceIds.size === 0) stopWatching();
            }
        };

        map.on('sourcedata', onSourceData);
        // Don't watch forever for sources that fail to load or never appear.
        const giveUpTimer = setTimeout(stopWatching, giveUpAfter);

        return true;
    }
}

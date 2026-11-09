/**
 * Keeps one bad elevation sample from stopping a feature query.
 *
 * Mapbox GL (3.33.0-rc) samples the DEM while testing features against a
 * point - for layers placed with elevation, even with 3D terrain off - and
 * throws "out of range source coordinates for DEM data" where a point falls
 * on the edge of a DEM tile. That throw ends the whole query, so a map click
 * opens no popup and hover finds nothing. Guarded, a query that throws it is
 * asked again one layer at a time, top-most first, leaving out only the
 * layers that still throw.
 */

let warned = false;

function isOptions(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && !('x' in value && 'y' in value);
}

export function guardFeatureQueries(map) {
    if (!map || map._featureQueriesGuarded) return;
    map._featureQueriesGuarded = true;
    const query = map.queryRenderedFeatures.bind(map);
    map.queryRenderedFeatures = (geometry, options) => {
        try {
            return query(geometry, options);
        } catch (error) {
            if (!(error instanceof RangeError)) throw error;
            if (!warned) {
                warned = true;
                console.warn('[safe-feature-query] A feature query hit a DEM tile edge; querying layer by layer:', error.message);
            }
            // queryRenderedFeatures(options) as well as (geometry, options)
            const point = isOptions(geometry) ? undefined : geometry;
            const opts = (isOptions(geometry) ? geometry : options) || {};
            if (opts.target) return [];
            let ids;
            try {
                ids = opts.layers || (map.getStyle()?.layers || []).map(layer => layer.id);
            } catch {
                return [];
            }
            return [...ids].reverse().flatMap(id => {
                try {
                    return point === undefined ? query({ ...opts, layers: [id] }) : query(point, { ...opts, layers: [id] });
                } catch {
                    return [];
                }
            });
        }
    };
}

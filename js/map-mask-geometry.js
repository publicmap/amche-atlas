/**
 * Pure geometry helpers behind the `?mask=` cutout (see js/map-mask-manager.js).
 *
 * Nothing here touches the map, the layer control or the DOM - it takes GeoJSON
 * polygons in and returns a GeoJSON polygon out - so the manager stays about
 * lifecycle and querying, and this part is straightforward to reason about and
 * test on its own.
 *
 * Every turf call is written for turf 7's FeatureCollection signatures with a
 * fall back to turf 6's positional ones, and boolean geometry always has a
 * non-boolean fallback: unioning tile-clipped rings fails often enough that
 * losing the mask over it isn't acceptable.
 */

// Web Mercator's full extent. Anything beyond ±85.051129° cannot be rendered,
// so a ring at the poles is as much "world" as a fill can cover.
export const WORLD_RING = [
    [-180, -85.051129],
    [180, -85.051129],
    [180, 85.051129],
    [-180, 85.051129],
    [-180, -85.051129]
];

/** A plain GeoJSON Feature if this is an area geometry, else null. */
export function toPolygonFeature(feature) {
    if (!feature) return null;
    // querySourceFeatures returns Mapbox Feature objects whose `geometry` is a
    // getter; toJSON() is the documented way to a plain object turf can take.
    const plain = typeof feature.toJSON === 'function' ? feature.toJSON() : feature;
    const type = plain?.geometry?.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') return null;
    return { type: 'Feature', properties: {}, geometry: plain.geometry };
}

/** Rounded bounds as a string, for deduping and fingerprinting. */
export function bboxKey(polygon) {
    try {
        return turf.bbox(polygon).map(n => n.toFixed(6)).join(',');
    } catch (e) {
        return '';
    }
}

/**
 * Cheap fingerprint of a cutout's inputs, so an `idle` that changed nothing
 * (most of them - including the one the mask's own setData triggers) costs a
 * source query and no boolean geometry.
 */
export function signatureOf(polygons) {
    if (polygons.length === 0) return 'empty';
    return polygons.length + '|' + polygons.map(bboxKey).sort().join(';');
}

/**
 * World polygon minus the union of `polygons` - the mask itself.
 * @returns {object|null} a GeoJSON Feature, or null if there was nothing to cut
 */
export function buildMaskFeature(polygons) {
    const cutout = unionAll(polygons);
    if (!cutout) return null;

    const world = turf.polygon([WORLD_RING]);

    try {
        const difference = turf.difference(turf.featureCollection([world, cutout]));
        if (difference) return difference;
    } catch (e) {
        try {
            // turf < 7 took two positional arguments.
            const difference = turf.difference(world, cutout);
            if (difference) return difference;
        } catch (e2) {
            console.warn('[MaskGeometry] turf.difference failed, falling back to ring holes:', e2);
        }
    }

    return worldWithHoles(cutout);
}

/** One polygon covering everything `polygons` covers between them. */
export function unionAll(polygons) {
    if (!polygons || polygons.length === 0) return null;
    if (polygons.length === 1) return polygons[0];

    try {
        const union = turf.union(turf.featureCollection(polygons));
        if (union) return union;
    } catch (e) {
        // turf < 7, or a ring the n-ary union choked on - fold pairwise below.
    }

    let accumulated = polygons[0];
    for (let i = 1; i < polygons.length; i++) {
        accumulated = union2(accumulated, polygons[i]) || accumulated;
    }
    return accumulated;
}

function union2(a, b) {
    try {
        return turf.union(turf.featureCollection([a, b]));
    } catch (e) {
        try {
            return turf.union(a, b);
        } catch (e2) {
            return null;
        }
    }
}

/**
 * Last resort when boolean difference fails: a single polygon whose outer ring
 * is the world and whose holes are the cutout's outer rings. Mapbox tessellates
 * holes explicitly, so this renders the same as the difference for disjoint
 * cutouts; only holes *inside* a cutout (a donut-shaped feature) are lost,
 * which the difference would have re-filled.
 */
export function worldWithHoles(cutout) {
    const geometry = cutout.geometry || cutout;
    const outerRings = geometry.type === 'MultiPolygon'
        ? geometry.coordinates.map(rings => rings[0])
        : [geometry.coordinates[0]];

    return {
        type: 'Feature',
        properties: {},
        geometry: {
            type: 'Polygon',
            coordinates: [WORLD_RING, ...outerRings.filter(Boolean)]
        }
    };
}

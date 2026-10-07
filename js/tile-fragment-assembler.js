export function tileFragmentKey(feature) {
    if (feature?.id !== undefined && feature?.id !== null) return `id:${feature.id}`;
    const properties = feature?.properties || {};
    for (const name of ['id', 'fid', 'giscode']) {
        const value = properties[name];
        if (value !== undefined && value !== null && value !== '') return `${name}:${value}`;
    }
    return null;
}

export function isMergeableGeometry(type) {
    return type === 'Polygon' || type === 'MultiPolygon'
        || type === 'LineString' || type === 'MultiLineString';
}

export function mergeFragmentGeometries(geometries) {
    const isPolygon = geometries[0].type === 'Polygon' || geometries[0].type === 'MultiPolygon';

    const parts = [];
    geometries.forEach(({ type, coordinates }) => {
        if (type === 'Polygon' || type === 'LineString') parts.push(coordinates);
        else if (type === 'MultiPolygon' || type === 'MultiLineString') parts.push(...coordinates);
    });
    const concatenated = {
        type: isPolygon ? 'MultiPolygon' : 'MultiLineString',
        coordinates: parts
    };

    if (!isPolygon || typeof turf === 'undefined') return concatenated;

    try {
        const dissolved = turf.union(turf.featureCollection(
            geometries.map(geometry => ({ type: 'Feature', properties: {}, geometry }))
        ));
        if (dissolved?.geometry?.coordinates?.length) return dissolved.geometry;
    } catch (err) {
        console.warn('[TileFragmentAssembler] Could not dissolve tile fragments, exporting them unmerged:', err);
    }

    return concatenated;
}

export function mergeFeatureFragments(fragments) {
    const base = fragments[0];
    const geometries = [];
    const seen = new Set();

    fragments.forEach(f => {
        const geometry = f?.geometry;
        if (!geometry?.coordinates) return;
        const signature = JSON.stringify(geometry.coordinates);
        if (seen.has(signature)) return;
        seen.add(signature);
        geometries.push(geometry);
    });

    if (geometries.length <= 1) return base;
    return { ...base, geometry: mergeFragmentGeometries(geometries) };
}

export function reassembleTiledFeatures(sourceFeatures) {
    const groups = new Map();
    const loose = [];

    sourceFeatures.forEach(f => {
        const plain = typeof f.toJSON === 'function' ? f.toJSON() : f;
        const key = tileFragmentKey(plain);
        if (!key || !isMergeableGeometry(plain?.geometry?.type)) {
            loose.push(plain);
            return;
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(plain);
    });

    return [
        ...[...groups.values()].map(mergeFeatureFragments),
        ...loose
    ];
}

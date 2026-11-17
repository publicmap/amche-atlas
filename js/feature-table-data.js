/**
 * The data behind the layer editor's Features section (js/creator-features.js):
 * a FeatureCollection's columns, a drawn feature's default properties, the
 * edits the feature table makes (in place) and how much of a link the data
 * would take when it rides in `?layers=` (docs/API.md "Shareable layers").
 */

const KIND = {
    Point: 'Point', MultiPoint: 'Point',
    LineString: 'Line', MultiLineString: 'Line',
    Polygon: 'Area', MultiPolygon: 'Area'
};

export const DEFAULT_KEYS = ['fid', '$rowid', 'name'];
export const COORDINATE_DIGITS = 6;

export function emptyCollection() {
    return { type: 'FeatureCollection', features: [] };
}

/** "Point", "Line" or "Area" for a GeoJSON geometry type. */
export function geometryKind(type) {
    return KIND[type] || 'Feature';
}

/** Every property key of the collection, in the order first seen. */
export function tableColumns(collection) {
    const columns = [];
    const seen = new Set();
    (collection?.features || []).forEach(feature => {
        Object.keys(feature.properties || {}).forEach(key => {
            if (seen.has(key)) return;
            seen.add(key);
            columns.push(key);
        });
    });
    return columns;
}

/**
 * The properties a newly drawn feature starts with: `fid` (one past the
 * highest), `$rowid` (its row) and `name` ("Line 2"). A default whose column
 * was removed from every feature stays removed.
 */
export function defaultProperties(collection, geometryType) {
    const features = collection?.features || [];
    const columns = features.length ? new Set(tableColumns(collection)) : null;
    const keep = (key) => !columns || columns.has(key);
    const kind = geometryKind(geometryType);
    const fids = features.map(f => Number(f.properties?.fid)).filter(Number.isFinite);
    const sameKind = features.filter(f => geometryKind(f.geometry?.type) === kind).length;

    const properties = {};
    if (keep('fid')) properties.fid = (fids.length ? Math.max(...fids) : 0) + 1;
    if (keep('$rowid')) properties.$rowid = features.length + 1;
    if (keep('name')) properties.name = `${kind} ${sameKind + 1}`;
    return properties;
}

function renumberRows(collection) {
    collection.features.forEach((feature, index) => {
        if (feature.properties && '$rowid' in feature.properties) feature.properties.$rowid = index + 1;
    });
}

export function addFeature(collection, geometry, properties = {}) {
    collection.features.push({ type: 'Feature', properties: { ...properties }, geometry });
    return collection.features.length - 1;
}

export function removeFeature(collection, index) {
    collection.features.splice(index, 1);
    renumberRows(collection);
}

export function removeColumn(collection, key) {
    collection.features.forEach(feature => {
        if (feature.properties) delete feature.properties[key];
    });
}

export function addColumn(collection, key) {
    if (!key) return;
    collection.features.forEach(feature => {
        feature.properties = feature.properties || {};
        if (!(key in feature.properties)) feature.properties[key] = '';
    });
}

export function setProperty(collection, index, key, value) {
    const feature = collection.features[index];
    if (!feature) return;
    feature.properties = { ...(feature.properties || {}), [key]: value };
}

/** Replace a feature's properties, keeping the order they were given in. */
export function setProperties(collection, index, properties) {
    const feature = collection.features[index];
    if (feature) feature.properties = { ...properties };
}

/** A typed cell's value, keeping a number or boolean column's type. */
export function parseCellValue(text, previous) {
    const value = String(text ?? '');
    if (typeof previous === 'number' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
    if (typeof previous === 'boolean' && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === 'true';
    if (previous !== null && typeof previous === 'object') {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
    return value;
}

export function displayValue(value) {
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

const round = (n, factor) => Math.round(n * factor) / factor;

function roundCoords(coords, factor) {
    if (typeof coords[0] === 'number') return coords.map(n => round(n, factor));
    return coords.map(c => roundCoords(c, factor));
}

export function roundGeometry(geometry, digits = COORDINATE_DIGITS) {
    if (!geometry) return geometry;
    const factor = 10 ** digits;
    if (geometry.type === 'GeometryCollection') {
        return { type: geometry.type, geometries: geometry.geometries.map(g => roundGeometry(g, digits)) };
    }
    return { type: geometry.type, coordinates: roundCoords(geometry.coordinates, factor) };
}

/** The collection as it is written into a layer's `data`: coordinates to 6 decimals (~10 cm). */
export function compactCollection(collection) {
    return {
        type: 'FeatureCollection',
        features: (collection?.features || []).map(feature => ({
            type: 'Feature',
            ...(feature.id !== undefined ? { id: feature.id } : {}),
            properties: feature.properties || {},
            geometry: roundGeometry(feature.geometry)
        }))
    };
}

/** Characters a value takes in `?layers=` (single-quoted JSON, URL-encoded). */
export function inlineSize(value) {
    return encodeURIComponent(JSON.stringify(value).replace(/'/g, "\\'").replace(/"/g, "'")).length;
}

/** A geometry's [west, south, east, north]. */
export function geometryBbox(geometry) {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const visit = (coords) => {
        if (typeof coords[0] === 'number') {
            box[0] = Math.min(box[0], coords[0]);
            box[1] = Math.min(box[1], coords[1]);
            box[2] = Math.max(box[2], coords[0]);
            box[3] = Math.max(box[3], coords[1]);
            return;
        }
        coords.forEach(visit);
    };
    if (geometry?.type === 'GeometryCollection') geometry.geometries.forEach(g => visit(g.coordinates));
    else if (geometry?.coordinates) visit(geometry.coordinates);
    return Number.isFinite(box[0]) ? box : null;
}

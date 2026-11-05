/**
 * Reads a route layer's GeoJSON (or the CSV the export panel writes from it,
 * one row per feature) back into the `{routes, markers}` shape of
 * route-sheet-format.js, so an exported route network can be loaded into a
 * sheet or a link and draw the same routes again.
 *
 * Features are the ones search/route-geojson.js builds and
 * search/route-store.js stamps: a `kind: route` line carrying `profile`,
 * `source` (the routing service) and `color`, and a `kind: waypoint` Point per
 * stop with its `index` and `name`, all tagged with their `routeId`. A
 * waypoint's marker id is its `markerId` property when the export carries
 * one; otherwise it is made from the stop's name. Stops at the same point are
 * one marker, shared by every route through it.
 */
import { ROUTING_ENGINES } from './search/directions-router.js';
import { isRouteColor, defaultRouteColor } from './search/route-geojson.js';
import { isValidId, labelToId, uniqueId } from './shorthand-id-utils.js';

const RID_RE = /^[A-Za-z0-9_]+$/;
const DROP_COLUMNS = new Set(['X', 'Y', 'WKT', 'layer_url', 'layer_id', '$row']);
const round6 = (n) => parseFloat(Number(n).toFixed(6));

/** CSV export rows (one per feature, `X`/`Y` the point) -> a FeatureCollection. */
export function featureRowsToGeojson(rows) {
    const features = (rows || []).map(row => {
        const lng = Number(row.X ?? row.lng ?? row.longitude);
        const lat = Number(row.Y ?? row.lat ?? row.latitude);
        const properties = {};
        Object.entries(row).forEach(([key, value]) => {
            if (!DROP_COLUMNS.has(key) && value !== '') properties[key] = value;
        });
        if (properties.index !== undefined) properties.index = Number(properties.index);
        const geometry = Number.isFinite(lng) && Number.isFinite(lat) ? { type: 'Point', coordinates: [lng, lat] } : null;
        return { type: 'Feature', geometry, properties };
    });
    return { type: 'FeatureCollection', features };
}

function ridFor(routeId, used) {
    const raw = String(routeId ?? '').replace(/^route-/, '');
    const rid = RID_RE.test(raw) ? raw : (labelToId(raw) || String(used.size + 1));
    return used.has(rid) ? uniqueId(rid, used) : rid;
}

export function routesFromGeojson(featureCollection) {
    const features = Array.isArray(featureCollection) ? featureCollection : (featureCollection?.features || []);
    const groups = new Map();
    const group = (key) => {
        if (!groups.has(key)) groups.set(key, { line: null, stops: [], props: {} });
        return groups.get(key);
    };

    features.forEach(feature => {
        const props = feature?.properties || {};
        const key = String(props.routeId ?? 'route-1');
        if (props.kind === 'route') group(key).line = props;
        else if (props.kind === 'waypoint' && feature.geometry?.type === 'Point') group(key).stops.push({ props, coordinates: feature.geometry.coordinates });
        else return;
        Object.assign(group(key).props, props.color ? { color: props.color, colorCustom: props.colorCustom } : {}, props.routeName ? { routeName: props.routeName } : {});
    });

    const markers = [];
    const byPoint = new Map();
    const markerIds = new Set();
    const markerFor = (stop, rid) => {
        const [lng, lat] = stop.coordinates.map(round6);
        const key = `${lng},${lat}`;
        if (byPoint.has(key)) return byPoint.get(key);
        const named = String(stop.props.markerId ?? '');
        const base = isValidId(named) ? named : (labelToId(stop.props.name || '') || `${rid}_${(stop.props.index ?? 0) + 1}`);
        const id = uniqueId(base, markerIds);
        markerIds.add(id);
        markers.push({ id, lng, lat, name: String(stop.props.name || ''), description: '' });
        byPoint.set(key, id);
        return id;
    };

    const rids = new Set();
    const routes = [];
    groups.forEach((g, key) => {
        if (g.stops.length < 2) return;
        const rid = ridFor(key, rids);
        rids.add(rid);
        const line = g.line || {};
        const service = ROUTING_ENGINES[line.source] ? line.source : 'mapbox';
        const profile = line.profile === 'driving-traffic' ? 'driving' : (line.profile || ROUTING_ENGINES[service].defaultProfile);
        const color = isRouteColor(g.props.color) ? g.props.color.toLowerCase() : '';
        const isDefault = color && !isTrue(g.props.colorCustom) && color === defaultRouteColor({ rid });
        const waypoints = g.stops
            .slice()
            .sort((a, b) => Number(a.props.index) - Number(b.props.index))
            .map(stop => markerFor(stop, rid));
        routes.push({
            id: rid,
            name: String(g.props.routeName || ''),
            service,
            profile,
            ...(color && !isDefault ? { color } : {}),
            waypoints
        });
    });

    return { routes, markers };
}

function isTrue(value) {
    return value === true || value === 'true';
}

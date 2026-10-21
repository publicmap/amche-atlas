/**
 * An atlas config's own pins and routes (`markers` / `routes`, see docs/API.md
 * "Atlas-level markers and routes"), turned into the same shorthand the URL
 * carries - a `markers=` value and `route-<rid>:` layer entries - so they load
 * through exactly the path a shared link does. The reverse, atlasPinsJson(),
 * is what the console's save page offers to paste back into a config.
 */
import { buildMarkersParam } from './marker-registry.js';
import { isValidId } from './shorthand-id-utils.js';

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function validMarker(entry) {
    const [lng, lat] = Array.isArray(entry?.coordinates) ? entry.coordinates.map(Number) : [];
    return entry && isValidId(String(entry.id ?? '')) && Number.isFinite(lng) && Number.isFinite(lat);
}

/** Config `markers` -> registry entries, dropping (and logging) any that can't be used. */
export function atlasMarkerEntries(markers) {
    if (!Array.isArray(markers)) return [];
    return markers.filter(entry => {
        const ok = validMarker(entry);
        if (!ok) console.warn('[Atlas pins] Skipping marker without a valid id and [lng, lat]:', entry);
        return ok;
    }).map(entry => ({
        id: String(entry.id),
        lng: Number(entry.coordinates[0]),
        lat: Number(entry.coordinates[1]),
        name: entry.name || '',
        description: entry.description || '',
        ...(Array.isArray(entry.offset) ? { offset: { x: Number(entry.offset[0]) || 0, y: Number(entry.offset[1]) || 0 } } : {}),
        ...(entry.pinned ? { pinned: true } : {})
    }));
}

/** Config `markers` -> a `markers=` value, or '' when there are none. */
export function atlasMarkersParam(markers) {
    return buildMarkersParam(atlasMarkerEntries(markers));
}

/**
 * Config `routes` -> `route-<rid>:<service>-<profile>(<ids>[,<color>])` strings.
 * A route whose waypoints aren't all among `markerIds` is dropped with a
 * warning, as an unresolvable route in the URL is.
 */
export function atlasRouteShorthands(routes, markerIds) {
    if (!Array.isArray(routes)) return [];
    const known = new Set(markerIds || []);
    return routes.map(route => {
        const rid = String(route?.id ?? '');
        const waypoints = Array.isArray(route?.waypoints) ? route.waypoints.map(String) : [];
        if (!/^[A-Za-z0-9_]+$/.test(rid) || waypoints.length < 2) {
            console.warn('[Atlas pins] Skipping route without an id and two or more waypoints:', route);
            return null;
        }
        const missing = waypoints.filter(id => !known.has(id));
        if (missing.length) {
            console.warn(`[Atlas pins] Skipping route "${rid}": no marker for ${missing.join(', ')}`);
            return null;
        }
        const token = route.service ? (route.profile ? `${route.service}-${route.profile}` : route.service) : '';
        const args = [...waypoints, ...(HEX_COLOR_RE.test(route.color || '') ? [route.color.toLowerCase()] : [])];
        return `route-${rid}:${token}(${args.join(',')})`;
    }).filter(Boolean);
}

/**
 * The link that opens `href` with an atlas's pins and routes, or null when it
 * needs none: the atlas has no pins, or the link already carries pins or
 * routes of its own (which take precedence, as on load).
 */
export function atlasPinsUrl(href, markers, routes) {
    const url = new URL(href);
    const layers = url.searchParams.get('layers') || '';
    if (url.searchParams.get('markers') || /(^|,)route-/.test(layers)) return null;
    const markersParam = atlasMarkersParam(markers);
    if (!markersParam) return null;
    const ids = atlasMarkerEntries(markers).map(m => m.id);
    const shorthands = atlasRouteShorthands(routes, ids);
    url.searchParams.set('markers', markersParam);
    if (shorthands.length) url.searchParams.set('layers', [...shorthands, layers].filter(Boolean).join(','));
    return url.toString();
}

/**
 * Live pins and routes -> the `markers` / `routes` JSON an atlas config takes.
 * @param {Array<{id, lng, lat, name?, description?, offset?, pinned?}>} markers
 * @param {Array<{rid, markerIds, engine?, profile?, color?}>} routes
 */
export function atlasPinsJson(markers, routes) {
    const round = (n) => parseFloat(Number(n).toFixed(6));
    return {
        markers: (markers || []).map(m => ({
            id: m.id,
            coordinates: [round(m.lng), round(m.lat)],
            ...(m.name ? { name: m.name } : {}),
            ...(m.description ? { description: m.description } : {}),
            ...(m.offset && (m.offset.x || m.offset.y) ? { offset: [Math.round(m.offset.x), Math.round(m.offset.y)] } : {}),
            ...(m.pinned ? { pinned: true } : {})
        })),
        routes: (routes || []).map(r => ({
            id: String(r.rid),
            waypoints: r.markerIds,
            ...(r.engine ? { service: r.engine } : {}),
            ...(r.profile ? { profile: r.profile } : {}),
            ...(r.color ? { color: r.color } : {})
        }))
    };
}

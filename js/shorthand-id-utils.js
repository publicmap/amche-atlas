/**
 * shorthand-id-utils - validating, sanitizing, and generating the short
 * user-facing ids used by the `markers=` and `route-<rid>:` URL shorthand
 * (see js/marker-registry.js, js/route-url-api.js, js/search/route-store.js)
 * plus the balanced-paren `token(args)` call parsing both of those share.
 *
 * ID rules: letters, digits, or underscore only; any whitespace in a
 * user-typed id is converted to `_` rather than rejected outright (typing a
 * space is the common slip, not an attempt at a special character), and
 * every other disallowed character is dropped.
 *
 * A route waypoint's `ref` badge (map-marker-manager.js's setMarkerRefLabel,
 * assigned by search/route-store.js's _syncMarkers) is the one place `:` is
 * allowed - it separates the route-facing prefix (default
 * `{mode}-{distanceText}`, freely renameable) from the stop's 1-based
 * position on the route (`stop_no`, never user-edited - see
 * isValidRouteRefId/sanitizeRouteRefPrefix below).
 */

const VALID_ID_RE = /^[A-Za-z0-9_]+$/;

// `-` and `.` on top of the ordinary id charset: a ref prefix's default form
// is `{mode}-{distanceText}` (e.g. "walking-1.2km"), so a renamed prefix needs
// to keep both.
const VALID_ROUTE_REF_PREFIX_RE = /^[A-Za-z0-9_.-]+$/;
const VALID_ROUTE_REF_RE = /^[A-Za-z0-9_.-]+:[0-9]+$/;

/** Converts arbitrary user input into a valid id: spaces -> `_`, everything else not [A-Za-z0-9_] stripped. */
export function sanitizeId(raw) {
    return String(raw ?? '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^A-Za-z0-9_]/g, '');
}

export function isValidId(id) {
    return typeof id === 'string' && VALID_ID_RE.test(id);
}

/**
 * Whether `id` is a valid route waypoint ref: `{prefix}:{stop_no}` - a
 * renameable prefix (see sanitizeRouteRefPrefix), a single `:`, then a plain
 * non-negative integer stop number. The stop number is never user-typed - it
 * tracks the waypoint's position in its route (search/route-store.js's
 * _syncMarkers reassigns it on every reorder) - so this only validates the
 * shape, it doesn't check the number against anything.
 */
export function isValidRouteRefId(id) {
    return typeof id === 'string' && VALID_ROUTE_REF_RE.test(id);
}

/**
 * Sanitizes just the renameable part of a route ref - everything before the
 * `:stop_no` suffix. Same spaces-become-separator/drop-the-rest approach as
 * sanitizeId, except `-` and `.` survive (the default prefix form is
 * `{mode}-{distanceText}`, e.g. "walking-1.2km") and a space becomes `-`
 * rather than `_`, matching that default's own word separator.
 */
export function sanitizeRouteRefPrefix(raw) {
    return String(raw ?? '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^A-Za-z0-9_.-]/g, '');
}

export function isValidRouteRefPrefix(prefix) {
    return typeof prefix === 'string' && VALID_ROUTE_REF_PREFIX_RE.test(prefix);
}

/**
 * Turns an arbitrary human label - a search result's name, say - into a valid
 * id: every run of characters outside [A-Za-z0-9_] collapses to a single `_`,
 * with no leading or trailing separator, truncated to `maxLength`.
 *
 * Unlike sanitizeId, which drops disallowed characters outright (the right fix
 * for an id someone typed by hand), this keeps them as separators - so
 * `Survey 17/1` and `Survey 171` stay distinct ids instead of colliding.
 */
export function labelToId(raw, maxLength = 64) {
    const id = String(raw ?? '')
        .replace(/[^A-Za-z0-9_]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

    return id.length > maxLength
        ? id.slice(0, maxLength).replace(/_+$/, '')
        : id;
}

/**
 * `base`, or `base_2`/`base_3`/... when it is already taken - so choosing the
 * same search result twice yields two markers with distinct ids rather than
 * the second one silently losing its name.
 */
export function uniqueId(base, existingIds) {
    const used = new Set(existingIds || []);
    if (!used.has(base)) return base;

    let n = 2;
    while (used.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
}

/**
 * The smallest positive integer (as a string) not already in `existingIds` -
 * how a new marker/route is numbered on creation, whether or not earlier
 * ones were renamed to something non-numeric.
 */
export function nextSerialId(existingIds) {
    const used = new Set(existingIds || []);
    let n = 1;
    while (used.has(String(n))) n++;
    return String(n);
}

/**
 * Extracts every `<token>(<args>)` call from `str` via a balanced-paren scan
 * (no nesting expected - a call's args are always a flat list). Unlike a
 * regex split on the surrounding separator, this works regardless of what
 * character (if any) sits between calls, so `markers=` and `?layers=`'s
 * `route-<rid>:...(...)` entries can both use a plain `,` between multiple
 * calls without the calls' own internal commas causing ambiguity.
 *
 * @returns {Array<{token: string, argsStr: string}>}
 */
export function parseCalls(str) {
    const calls = [];
    if (typeof str !== 'string') return calls;

    const CALL_START_RE = /([A-Za-z0-9_-]+)\(/g;
    let match;
    while ((match = CALL_START_RE.exec(str))) {
        const token = match[1];
        const argsStart = CALL_START_RE.lastIndex;
        const closeIndex = str.indexOf(')', argsStart);
        if (closeIndex === -1) break;

        calls.push({ token, argsStr: str.slice(argsStart, closeIndex) });
        CALL_START_RE.lastIndex = closeIndex + 1;
    }

    return calls;
}

/** Flat `,`-split + trim - every arg list (coordinates, referenced ids, name/description) is comma-joined with no pair-separator. */
export function splitArgs(argsStr) {
    if (!argsStr) return [];
    return argsStr.split(',').map(part => part.trim());
}

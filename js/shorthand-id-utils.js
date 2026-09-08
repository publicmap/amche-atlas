/**
 * shorthand-id-utils - validating, sanitizing, and generating the short
 * user-facing ids used by the `markers=` and `route-<rid>:` URL shorthand
 * (see js/marker-registry.js, js/route-url-api.js, js/search/route-store.js)
 * plus the balanced-paren `token(args)` call parsing both of those share.
 *
 * ID rules: any character except whitespace and the four the shorthand grammar
 * itself needs - `(`, `)`, `,` and `:`. Everything else is allowed, non-ASCII
 * included: an id is percent-encoded on its way into the URL (encodeId below)
 * and the `?param=` reader percent-decodes it back, so `Survey_17/1`, `R&D`,
 * `50%` and `café` all survive the round trip. The four exceptions can't -
 * that same reader turns `%28`/`%2C` back into `(`/`,` before parseCalls ever
 * sees the value, so an id holding one would split its own call apart - and
 * neither can whitespace, which is converted to `_` instead of encoded: `%20`
 * is noise in a shared link, and the underscore is the readable stand-in that
 * reads back as a space wherever the id is shown (map-marker-manager.js's
 * idToLabel).
 *
 * A route waypoint's `ref` badge (map-marker-manager.js's setMarkerRefLabel,
 * assigned by search/route-store.js's _syncMarkers) is the one place `:` is
 * allowed - it separates the route-facing prefix (default
 * `{mode}-{distanceText}`, freely renameable) from the stop's 1-based
 * position on the route (`stop_no`, never user-edited - see
 * isValidRouteRefId/sanitizeRouteRefPrefix below).
 */

// Everything but whitespace, the grammar's own `(),:`, and control characters
// (never typed on purpose, and unprintable in a URL either way).
const ID_FORBIDDEN_RE = /[\s(),:\x00-\x1f\x7f]/g;
const VALID_ID_RE = /^[^\s(),:\x00-\x1f\x7f]+$/;

// Deliberately narrower than an id: a ref prefix is a badge label the route
// owns, and its default form is `{mode}-{distanceText}` (e.g. "walking-1.2km"),
// so letters/digits/`_` plus the `-` and `.` that form needs is the whole of it.
// The `:` before `stop_no` is the separator, hence excluded here.
const VALID_ROUTE_REF_PREFIX_RE = /^[A-Za-z0-9_.-]+$/;
const VALID_ROUTE_REF_RE = /^[A-Za-z0-9_.-]+:[0-9]+$/;

/** Converts arbitrary user input into a valid id: whitespace -> `_`, the grammar's `(),:` and control characters stripped. */
export function sanitizeId(raw) {
    return String(raw ?? '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(ID_FORBIDDEN_RE, '');
}

/**
 * Percent-encodes an id for the URL - every write site of a `markers=` call
 * token (marker-registry.js) or a `route-<rid>:` waypoint argument
 * (search/route-geojson.js) goes through this.
 *
 * There is no matching decodeId: the param reader (`URLSearchParams.get`) has
 * already percent-decoded the whole value by the time it reaches parseCalls,
 * and decoding a second time would corrupt an id that legitimately contains a
 * `%` (`100%25` -> `100%` -> `100 `). Since ids can hold none of the
 * characters the grammar splits on, the decoded token *is* the id.
 */
export function encodeId(id) {
    return encodeURIComponent(String(id ?? ''));
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
 * This stays stricter than sanitizeId on purpose. A hand-typed id is the
 * user's own business, so sanitizeId keeps whatever they typed; a generated one
 * is read off a shared link by someone who never chose it, and
 * `Assagao_Survey_17_1_BARDEZ` reads better there than the punctuation of
 * `Assagao_—_Survey_17/1_—_BARDEZ`. Collapsing to a separator rather than
 * dropping outright still keeps `Survey 17/1` and `Survey 171` distinct.
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

    // Anything an id may hold (see VALID_ID_RE), plus the `-`/`:` a
    // `route-<rid>:engine-profile` token carries - a leading `route-<rid>:` is
    // left out of the token so that form still reports its engine-profile.
    const CALL_START_RE = /([^\s(),:]+)\(/g;
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

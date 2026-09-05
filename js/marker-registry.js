/**
 * marker-registry - the single source of truth for marker id -> coordinate/
 * metadata, shared by:
 * - js/map-init.js, which hydrates it from `?markers=` before `?layers=`'s
 *   `route-<rid>:` shorthand is resolved (js/route-url-api.js), since a
 *   route now references its waypoints by marker id and needs their
 *   coordinates synchronously, well before any real map marker exists.
 * - js/map-marker-manager.js, which keeps it current as markers are added
 *   or renamed during the session, so js/url-manager.js's serialization and
 *   any later route write-back stay consistent with what's on the map.
 *
 * `markers=` shorthand: `marker-<id>(<lng>,<lat>[,<name>[,<description>]][,@<dx>x<dy>])`,
 * one call per marker (see shorthand-id-utils.js's parseCalls), joined with
 * `,` - name/description are percent-encoded so an embedded comma can't be
 * mistaken for another argument.
 *
 * `@<dx>x<dy>` is the pixel offset of a marker's panel from the point it
 * describes, present only when it has been dragged off its default position
 * (see MapMarkerManager._attachBalloonDragHandler). It carries an `@` sigil and
 * joins its two numbers with `x` rather than a comma, so it stays one argument
 * and can be told apart from a name wherever it lands - name and description
 * keep their own positions whether or not an offset follows them.
 */

const OFFSET_ARG_RE = /^@(-?\d+)x(-?\d+)$/;

import { parseCalls, splitArgs } from './shorthand-id-utils.js';

const registry = new Map();

export function setAll(entries) {
    registry.clear();
    (entries || []).forEach(entry => registry.set(entry.id, entry));
}

export function set(id, entry) {
    registry.set(id, entry);
}

export function get(id) {
    return registry.get(id) || null;
}

export function has(id) {
    return registry.has(id);
}

export function remove(id) {
    registry.delete(id);
}

export function allIds() {
    return Array.from(registry.keys());
}

export function allEntries() {
    return Array.from(registry.values());
}

/** Parses a `markers=` value into `[{id, lng, lat, name, description[, offset]}]`. Malformed calls (bad token prefix, non-numeric coordinates) are dropped. */
export function parseMarkersParam(markersParam) {
    if (!markersParam) return [];

    return parseCalls(markersParam)
        .filter(({ token }) => token.startsWith('marker-'))
        .map(({ token, argsStr }) => {
            const id = token.slice('marker-'.length);
            const args = splitArgs(argsStr);
            const lng = parseFloat(args[0]);
            const lat = parseFloat(args[1]);
            if (!id || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;

            // Pulled out first, so whatever is left keeps its name/description
            // positions regardless of where the offset was written.
            let offset = null;
            const rest = args.slice(2).filter(arg => {
                const match = OFFSET_ARG_RE.exec(arg);
                if (!match) return true;
                offset = { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
                return false;
            });

            return {
                id,
                lng,
                lat,
                name: rest[0] ? decodeURIComponent(rest[0]) : '',
                description: rest[1] ? decodeURIComponent(rest[1]) : '',
                ...(offset ? { offset } : {})
            };
        })
        .filter(Boolean);
}

/** Inverse of parseMarkersParam - builds the `markers=` value from live entries. */
export function buildMarkersParam(entries) {
    const round = (n) => parseFloat(Number(n).toFixed(6));

    return (entries || []).map(({ id, lng, lat, name, description, offset }) => {
        const parts = [round(lng), round(lat)];
        if (description) parts.push(encodeURIComponent(name || ''), encodeURIComponent(description));
        else if (name) parts.push(encodeURIComponent(name));

        // Only written once the panel has actually been moved - an undragged
        // marker sits at its default offset and says nothing about it.
        const dx = Math.round(offset?.x || 0);
        const dy = Math.round(offset?.y || 0);
        if (dx || dy) parts.push(`@${dx}x${dy}`);

        return `marker-${id}(${parts.join(',')})`;
    }).join(',');
}

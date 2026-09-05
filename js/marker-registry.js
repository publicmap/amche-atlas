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
 * `markers=` shorthand: `marker-<id>(<lng>,<lat>[,<name>[,<description>]])`,
 * one call per marker (see shorthand-id-utils.js's parseCalls), joined with
 * `,` - name/description are percent-encoded so an embedded comma can't be
 * mistaken for another argument.
 */

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

/** Parses a `markers=` value into `[{id, lng, lat, name, description}]`. Malformed calls (bad token prefix, non-numeric coordinates) are dropped. */
export function parseMarkersParam(markersParam) {
    if (!markersParam) return [];

    return parseCalls(markersParam)
        .filter(({ token }) => token.startsWith('marker-'))
        .map(({ token, argsStr }) => {
            const id = token.slice('marker-'.length);
            const [lngStr, latStr, nameStr, descStr] = splitArgs(argsStr);
            const lng = parseFloat(lngStr);
            const lat = parseFloat(latStr);
            if (!id || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;

            return {
                id,
                lng,
                lat,
                name: nameStr ? decodeURIComponent(nameStr) : '',
                description: descStr ? decodeURIComponent(descStr) : ''
            };
        })
        .filter(Boolean);
}

/** Inverse of parseMarkersParam - builds the `markers=` value from live entries. */
export function buildMarkersParam(entries) {
    const round = (n) => parseFloat(Number(n).toFixed(6));

    return (entries || []).map(({ id, lng, lat, name, description }) => {
        const parts = [round(lng), round(lat)];
        if (description) parts.push(encodeURIComponent(name || ''), encodeURIComponent(description));
        else if (name) parts.push(encodeURIComponent(name));
        return `marker-${id}(${parts.join(',')})`;
    }).join(',');
}

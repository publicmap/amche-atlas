/**
 * The tabular form of a route network: a `locations` table (every location,
 * a stop of a route or not) and a `routes` table (each route an ordered list
 * of location ids, so one location can be a stop on many routes), the layout a
 * sheet-backed route layer reads and writes (see docs/route-sheets.md and
 * route-sheet-sync.js). Rows convert to the same `?markers=` / `route-<rid>:`
 * shorthand a shared link carries, so a sheet, a CSV and a link all draw the
 * same routes.
 */
import { buildMarkersParam } from './marker-registry.js';
import { routeShorthand, isRouteColor } from './search/route-geojson.js';
import { ROUTING_ENGINES } from './search/directions-router.js';
import { isValidId, sanitizeId, labelToId, uniqueId } from './shorthand-id-utils.js';
import { DataUtils } from './map-utils.js';
import { featureRowsToGeojson, routesFromGeojson } from './route-sheet-geojson.js';

export { routesFromGeojson };

export const LOCATION_COLUMNS = ['id', 'name', 'lng', 'lat', 'description', 'pinned', 'version', 'updated_at'];
export const ROUTE_COLUMNS = ['id', 'name', 'profile', 'service', 'color', 'locations', 'version', 'updated_at'];
export const DEFAULT_SERVICE = 'mapbox';

const RID_RE = /^[A-Za-z0-9_]+$/;
const PROFILE_ALIASES = { 'driving-traffic': 'driving' };
const ALIASES = {
    id: ['id'],
    name: ['name', 'title', 'label'],
    lng: ['lng', 'lon', 'long', 'longitude', 'x'],
    lat: ['lat', 'latitude', 'y'],
    description: ['description', 'desc', 'notes'],
    pinned: ['pinned'],
    profile: ['profile', 'mode'],
    service: ['service', 'engine'],
    color: ['color', 'colour'],
    locations: ['locations'],
    version: ['version'],
    updated_at: ['updated_at', 'updatedat', 'updated']
};

const round6 = (n) => parseFloat(Number(n).toFixed(6));
const text = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** A row with its column names mapped onto the canonical ones, case-insensitively. */
export function normalizeRow(row) {
    const out = {};
    const lower = {};
    Object.keys(row || {}).forEach(key => { lower[key.trim().toLowerCase()] = row[key]; });
    Object.entries(ALIASES).forEach(([field, names]) => {
        const key = names.find(name => lower[name] !== undefined && text(lower[name]) !== '');
        if (key) out[field] = lower[key];
    });
    return out;
}

/** Splits a route's locations cell: comma- or space-separated location ids, start first. */
export function splitLocationIds(value) {
    if (Array.isArray(value)) return value.map(text).filter(Boolean);
    return text(value).split(/[\s,;]+/).filter(Boolean);
}

const isTrue = (value) => value === true || /^(true|yes|y|1|on|x|✓)$/i.test(text(value));

/** A location (`{id, lng, lat}` or atlas `{id, coordinates}`) as a locations row. */
export function locationToRow(marker) {
    const [lng, lat] = Array.isArray(marker.coordinates) ? marker.coordinates : [marker.lng, marker.lat];
    return {
        id: String(marker.id),
        name: marker.name || '',
        lng: round6(lng),
        lat: round6(lat),
        description: marker.description || '',
        ...(marker.pinned ? { pinned: true } : {}),
        ...versionFields(marker)
    };
}

/** A route (`{id, waypoints}` atlas form or `{rid, markerIds, engine}` route-store form) as a routes row. */
export function routeToRow(route) {
    const ids = route.waypoints || route.markerIds || [];
    return {
        id: String(route.id ?? route.rid).replace(/^route-/, ''),
        name: route.name || '',
        profile: route.profile || '',
        service: route.service || route.engine || DEFAULT_SERVICE,
        color: isRouteColor(route.color) ? route.color.toLowerCase() : '',
        locations: ids.map(String).join(','),
        ...versionFields(route)
    };
}

function versionFields(item) {
    const updated = item.updated_at ?? item.updatedAt;
    return {
        ...(item.version !== undefined && item.version !== '' ? { version: item.version } : {}),
        ...(updated ? { updated_at: updated } : {})
    };
}

export function routesToRows(routes, markers) {
    return {
        locations: (markers || []).map(locationToRow),
        routes: (routes || []).map(routeToRow)
    };
}

/** The id a row is keyed by: a location id as markers= takes it, a route id without any `route-` prefix ('' when invalid). */
export function sanitizeRowId(table, id) {
    if (table === 'routes') {
        const rid = text(id).replace(/^route-/, '');
        return RID_RE.test(rid) ? rid : '';
    }
    const marker = sanitizeId(text(id));
    return isValidId(marker) ? marker : '';
}

function rowLine(row, index) {
    return row && row.$row !== undefined ? row.$row : index + 2;
}

/**
 * Sheet rows -> `{routes, markers, errors}`. A row that can't be used is left
 * out and reported in `errors` as `{table, row, id, message}`, `row` being its
 * line in the sheet.
 */
export function rowsToRoutes(locationRows, routeRows) {
    const errors = [];
    const markers = [];
    const byId = new Map();
    const fail = (table, row, id, message) => errors.push({ table, row, id, message });

    (locationRows || []).forEach((raw, i) => {
        const row = normalizeRow(raw);
        const line = rowLine(raw, i);
        const id = sanitizeId(row.id);
        const lng = Number(text(row.lng));
        const lat = Number(text(row.lat));
        if (!isValidId(id)) return fail('locations', line, text(row.id), 'Missing or invalid id');
        if (byId.has(id)) return fail('locations', line, id, `Duplicate location id "${id}"`);
        if (!text(row.lng) || !text(row.lat) || !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
            return fail('locations', line, id, 'lng/lat must be numbers within range');
        }
        const marker = { id, lng: round6(lng), lat: round6(lat), name: text(row.name), description: text(row.description), ...(isTrue(row.pinned) ? { pinned: true } : {}) };
        byId.set(id, marker);
        markers.push(marker);
    });

    const routes = [];
    const rids = new Set();
    (routeRows || []).forEach((raw, i) => {
        const row = normalizeRow(raw);
        const line = rowLine(raw, i);
        const rid = text(row.id).replace(/^route-/, '');
        if (!RID_RE.test(rid)) return fail('routes', line, rid, 'Route id must be letters, digits or _');
        if (rids.has(rid)) return fail('routes', line, rid, `Duplicate route id "${rid}"`);

        const service = text(row.service).toLowerCase() || DEFAULT_SERVICE;
        const engine = ROUTING_ENGINES[service];
        if (!engine) return fail('routes', line, rid, `Unknown service "${service}"`);
        const asked = text(row.profile).toLowerCase();
        const profile = PROFILE_ALIASES[asked] || asked;
        if (profile && !engine.profiles.includes(profile)) {
            return fail('routes', line, rid, `${service} has no "${profile}" profile (${engine.profiles.join(', ')})`);
        }

        const waypoints = splitLocationIds(row.locations).map(sanitizeId);
        if (waypoints.length < 2) return fail('routes', line, rid, 'A route needs two or more locations');
        const missing = waypoints.filter(id => !byId.has(id));
        if (missing.length) return fail('routes', line, rid, `No locations row for ${missing.join(', ')}`);

        let color = text(row.color).toLowerCase();
        if (color && !color.startsWith('#')) color = `#${color}`;
        if (color && !isRouteColor(color)) {
            fail('routes', line, rid, `Color "${text(row.color)}" is not #rrggbb; ignored`);
            color = '';
        }

        rids.add(rid);
        routes.push({
            id: rid,
            name: text(row.name),
            service,
            profile: profile || engine.defaultProfile,
            ...(color ? { color } : {}),
            waypoints
        });
    });

    return { routes, markers, errors };
}

// The `markers=` reader percent-decodes the whole value before splitting it,
// then decodes each name again, so the characters the grammar splits on are
// escaped one extra time here and survive in a name or description.
const GUARDED = { '%': '%25', ',': '%2C', '(': '%28', ')': '%29' };
const guard = (value) => String(value || '').replace(/[%,()]/g, ch => GUARDED[ch]);

/** The `markers=` value for these markers, as written into a link. */
export function markersUrlValue(markers) {
    return buildMarkersParam((markers || []).map(m => ({
        id: m.id,
        lng: m.lng ?? m.coordinates?.[0],
        lat: m.lat ?? m.coordinates?.[1],
        name: guard(m.name),
        description: guard(m.description)
    })));
}

/** The `route-<rid>:<service>-<profile>(ids[,#color])` entry for a route. */
export function routeUrlValue(route) {
    return routeShorthand(route.id, route.waypoints, route.service || DEFAULT_SERVICE, route.profile || null, route.color || null);
}

/**
 * The amche link that draws `routes` (all, or just `routeIds`) and the markers
 * they pass through - the same `?markers=` / `route-<rid>:` form the app writes.
 */
export function toAmcheUrl({ routes = [], markers = [] }, { base = 'https://amche.in/', atlas = '', routeIds = null, layers = [] } = {}) {
    const wanted = routeIds ? routes.filter(r => routeIds.map(String).includes(String(r.id))) : routes;
    const used = new Set(wanted.flatMap(r => r.waypoints));
    const pins = routeIds ? markers.filter(m => used.has(m.id)) : markers;
    const params = [];
    if (atlas) params.push(`atlas=${encodeURIComponent(atlas)}`);
    const markersValue = markersUrlValue(pins);
    if (markersValue) params.push(`markers=${markersValue}`);
    const layerValue = [...wanted.map(routeUrlValue), ...layers].join(',');
    if (layerValue) params.push(`layers=${layerValue}`);
    if (!params.length) return base;
    return `${base}${base.includes('?') ? '&' : '?'}${params.join('&')}`;
}

function csvCell(value) {
    const s = value === undefined || value === null ? '' : String(value);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows -> CSV text, with `columns` (default: every key, in first-seen order) as the header. */
export function toCsv(rows, columns = null) {
    const headers = columns || [...new Set((rows || []).flatMap(row => Object.keys(row)))].filter(k => !k.startsWith('$'));
    const lines = [headers.map(csvCell).join(',')];
    (rows || []).forEach(row => lines.push(headers.map(h => csvCell(row[h])).join(',')));
    return lines.join('\n') + '\n';
}

/** CSV text -> rows keyed by the header row; blank lines are skipped and `$row` is the line number. */
export function fromCsv(csvText) {
    const records = DataUtils.parseCSVRecords(String(csvText || '').replace(/^﻿/, ''));
    if (!records.length) return [];
    const headers = records[0].map(h => h.trim());
    return records.slice(1).map((record, i) => {
        if (record.every(cell => cell.trim() === '')) return null;
        const row = {};
        headers.forEach((h, j) => { if (h) row[h] = record[j] ?? ''; });
        row.$row = i + 2;
        return row;
    }).filter(Boolean);
}

/**
 * Any CSV amche reads or writes for routes -> `{routes, markers, errors}`:
 * a locations table plus a routes table (pass both), or one table exported
 * from a route layer (one row per feature, with `kind`, `routeId`, `X`/`Y`).
 */
export function routesFromCsv(csvText, routesCsvText = null) {
    const rows = fromCsv(csvText);
    if (routesCsvText !== null) return rowsToRoutes(rows, fromCsv(routesCsvText));
    if (rows.some(row => row.kind !== undefined)) return { ...routesFromGeojson(featureRowsToGeojson(rows)), errors: [] };
    return rowsToRoutes(rows, []);
}

/** A fresh id for a copy of `id`, not among `existingIds` (a route id keeps to letters, digits and _). */
export function freshId(id, existingIds, { route = false } = {}) {
    const raw = String(id ?? '');
    const ok = route ? RID_RE.test(raw) : isValidId(raw);
    return uniqueId(ok ? raw : (labelToId(raw) || 'new'), existingIds);
}

/**
 * RouteSheetSync - reads and writes a route network kept in a Google Sheet
 * (a `waypoints` tab and a `routes` tab, see route-sheet-format.js and
 * docs/route-sheets.md) for a `"type": "routes"` layer.
 *
 * Writes go through the owner's Apps Script web app (`saveUrl`), as the notes
 * layer's do (google-sheets-writer.js): no OAuth, the script runs as the sheet
 * owner. Every save or delete re-reads the sheet first and compares each row
 * it touches with the version the user started editing from (the base
 * snapshot, taken by refresh()). A row that changed or vanished upstream is a
 * conflict: nothing is written, and the conflicts are returned and held in
 * `conflicts` (a ConflictState) until each is settled. The script repeats the
 * same check under a lock, so a write racing another one is refused too.
 */
import { extractSpreadsheetId, buildCsvUrl, fetchCsvRows, fetchSheetTabs } from './google-sheets-api.js';
import { rowsToRoutes, normalizeRow, markerToRow, routeToRow, sanitizeRowId } from './route-sheet-format.js';
import { ConflictState, TABLES, rowFingerprint, networkFingerprint } from './route-sheet-conflicts.js';

export { ConflictState };

const TAB_NAMES = { waypoints: /^(waypoints?|stops|markers|pins)$/i, routes: /^routes?$/i };

function toRow(table, item) {
    if (table === 'waypoints' && (item.coordinates || (item.lng !== undefined && item.lat !== undefined))) return markerToRow(item);
    if (table === 'routes' && (Array.isArray(item.waypoints) || Array.isArray(item.markerIds))) return routeToRow(item);
    return normalizeRow(item);
}

function changeList(changes, mapItem) {
    if (Array.isArray(changes)) return changes;
    const out = [];
    const tables = { waypoints: changes?.waypoints || changes?.markers, routes: changes?.routes };
    TABLES.forEach(table => (tables[table] || []).forEach(item => out.push(mapItem(table, item))));
    return out;
}

function stripVersion(row) {
    const { version, updated_at, ...rest } = row;
    return rest;
}

export class RouteSheetSync {
    /**
     * @param {{url: string, saveUrl?: string, waypointsGid?: string, routesGid?: string}} config - the layer config
     * @param {{fetch?: Function}} [options] - a fetch to use instead of the global one
     */
    constructor(config, { fetch: fetchImpl } = {}) {
        this.config = config || {};
        this._fetch = fetchImpl || ((...args) => fetch(...args));
        this._base = null;
        this.conflicts = new ConflictState(this);
    }

    /** The sheet as it is now: `{waypoints, routes}` Maps of id -> row, plus the rows in sheet order. Leaves the base alone. */
    async load() {
        const rows = this.config.saveUrl ? await this._loadFromScript() : await this._loadFromCsv();
        const result = { rows };
        TABLES.forEach(table => {
            result[table] = new Map();
            rows[table].forEach(row => {
                const id = sanitizeRowId(table, normalizeRow(row).id);
                if (id && !result[table].has(id)) result[table].set(id, row);
            });
        });
        return result;
    }

    async _loadFromScript() {
        const url = new URL(this.config.saveUrl);
        url.searchParams.set('action', 'list');
        if (this.config.waypointsGid) url.searchParams.set('waypointsGid', this.config.waypointsGid);
        if (this.config.routesGid) url.searchParams.set('routesGid', this.config.routesGid);
        const result = await this._json(this._fetch(url.toString(), { redirect: 'follow' }));
        return { waypoints: result.waypoints || [], routes: result.routes || [] };
    }

    async _loadFromCsv() {
        const spreadsheetId = extractSpreadsheetId(this.config.url);
        if (!spreadsheetId) throw new Error('A routes layer needs a Google Sheet `url`');
        const gids = { waypoints: this.config.waypointsGid, routes: this.config.routesGid };
        if (!gids.waypoints || !gids.routes) {
            const tabs = await fetchSheetTabs(spreadsheetId);
            TABLES.forEach(table => {
                if (!gids[table]) gids[table] = tabs.find(tab => TAB_NAMES[table].test(tab.name.trim()))?.gid;
                if (!gids[table]) throw new Error(`No "${table}" tab found; set ${table}Gid on the layer`);
            });
        }
        const [waypoints, routes] = await Promise.all(TABLES.map(table => fetchCsvRows(buildCsvUrl(spreadsheetId, gids[table]))));
        return { waypoints, routes };
    }

    /**
     * Fetch both tabs and return `{routes, markers, errors, fingerprint, rows}`.
     * With `rebase` (the default) this becomes the base snapshot that later
     * saves are checked against - call it when starting to edit, not while
     * holding unsaved edits.
     */
    async refresh({ rebase = true } = {}) {
        const remote = await this.load();
        if (rebase || !this._base) this._base = { waypoints: new Map(remote.waypoints), routes: new Map(remote.routes) };
        return {
            ...rowsToRoutes(remote.rows.waypoints, remote.rows.routes),
            fingerprint: networkFingerprint(remote),
            rows: remote.rows
        };
    }

    /** Record `row` (null: gone) as the base version of one row. */
    rebase(table, id, row) {
        if (!this._base) return;
        if (row) this._base[table].set(String(id), row);
        else this._base[table].delete(String(id));
    }

    /**
     * Insert or update rows: `{waypoints|markers: [...], routes: [...]}`, each
     * a sheet row or a marker / route object. Resolves to `{conflict: false,
     * rows}`, `{conflict: true, conflicts: [{table, id, local, remote}]}` when
     * a touched row changed upstream, or `{refused: true, conflicts}` when one
     * is still in conflict from before.
     */
    async save(changes) {
        const targets = changeList(changes, (table, item) => {
            const row = stripVersion(toRow(table, item));
            return { table, id: sanitizeRowId(table, row.id), row };
        });
        targets.forEach(t => { t.row.id = t.id; });
        return this._write(targets);
    }

    /** Delete rows by id: `{waypoints: [ids], routes: [ids]}`. Same results as save(). */
    async delete(ids) {
        const targets = changeList(ids, (table, id) => ({ table, id: sanitizeRowId(table, id), row: null }));
        return this._write(targets);
    }

    async _write(targets) {
        const bad = targets.find(t => !t.id);
        if (bad) throw new Error(`Every ${bad.table} row needs a valid id`);
        const pending = this.conflicts.blocking(targets);
        if (pending.length) return { conflict: true, refused: true, conflicts: pending };
        if (!this.config.saveUrl) throw new Error('Missing saveUrl. Deploy the Apps Script in docs/route-sheets.md and add its /exec URL to the layer.');

        const remote = await this.load();
        if (!this._base) this._base = { waypoints: new Map(remote.waypoints), routes: new Map(remote.routes) };
        const conflicts = [];
        const ops = [];
        targets.forEach(({ table, id, row }) => {
            const base = this._base[table].get(id);
            const now = remote[table].get(id) || null;
            const conflict = (reason) => conflicts.push({ table, id, local: row, remote: now, reason });
            if (!base) {
                if (row && now) conflict('exists');
                else if (row) ops.push({ op: 'insert', table, id, row });
            } else if (!now) {
                if (row) conflict('deleted');
            } else if (rowFingerprint(table, base) !== rowFingerprint(table, now)) {
                conflict('changed');
            } else {
                ops.push({ op: row ? 'update' : 'delete', table, id, row, base: now });
            }
        });
        if (conflicts.length) return this._conflict(conflicts);
        if (!ops.length) return { conflict: false, rows: { waypoints: [], routes: [] }, deleted: { waypoints: [], routes: [] } };

        const result = await this._post({ action: 'apply', waypointsGid: this.config.waypointsGid || '', routesGid: this.config.routesGid || '', ops });
        if (result.status === 'conflict') {
            return this._conflict((result.conflicts || []).map(c => ({
                table: c.table, id: String(c.id), remote: c.remote || null, reason: c.reason || 'changed',
                local: ops.find(op => op.table === c.table && op.id === String(c.id))?.row || null
            })));
        }
        const rows = { waypoints: result.rows?.waypoints || [], routes: result.rows?.routes || [] };
        const deleted = { waypoints: result.deleted?.waypoints || [], routes: result.deleted?.routes || [] };
        TABLES.forEach(table => {
            rows[table].forEach(row => this.rebase(table, sanitizeRowId(table, normalizeRow(row).id), row));
            deleted[table].forEach(id => this.rebase(table, id, null));
        });
        return { conflict: false, rows, deleted };
    }

    _conflict(conflicts) {
        this.conflicts.add(conflicts);
        return { conflict: true, conflicts };
    }

    async _post(payload) {
        let response;
        try {
            response = this._fetch(this.config.saveUrl, {
                method: 'POST',
                // text/plain keeps this a simple request: Apps Script answers no CORS preflight.
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload),
                redirect: 'follow'
            });
        } catch (e) {
            response = Promise.reject(e);
        }
        return this._json(response, true);
    }

    async _json(pending, allowConflict = false) {
        let response;
        try {
            response = await pending;
        } catch (e) {
            throw new Error('Route sheet endpoint blocked (CORS/401). Redeploy the Apps Script with "Who has access: Anyone" (see docs/route-sheets.md).');
        }
        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            throw new Error(`Unexpected response from the route sheet script: ${text.slice(0, 200)}`);
        }
        if (allowConflict && result.status === 'conflict') return result;
        if (!response.ok || result.status !== 'ok') throw new Error(result.message || `Route sheet request failed (${response.status}).`);
        return result;
    }
}

/** A sync client for a `"type": "routes"` layer config. */
export function routeSheetSyncFor(layerConfig, options) {
    return new RouteSheetSync(layerConfig, options);
}

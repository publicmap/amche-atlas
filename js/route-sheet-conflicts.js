/**
 * Row fingerprints and the conflict state of a sheet-backed route layer (see
 * route-sheet-sync.js).
 *
 * A row's fingerprint covers its content and its `version` / `updated_at`, so
 * an edit made by the Apps Script (which bumps `version`) and a hand edit in
 * the sheet (which changes the content) both read as "changed upstream".
 */
import { normalizeRow, splitWaypointIds, freshId } from './route-sheet-format.js';

export const TABLES = ['waypoints', 'routes'];
const FIELDS = {
    waypoints: ['id', 'name', 'lng', 'lat', 'description'],
    routes: ['id', 'name', 'profile', 'service', 'color', 'waypoints']
};

function canonical(table, row, withVersion) {
    const r = normalizeRow(row);
    const values = FIELDS[table].map(field => {
        const v = r[field] === undefined || r[field] === null ? '' : String(r[field]).trim();
        if ((field === 'lng' || field === 'lat') && v !== '' && Number.isFinite(Number(v))) return String(parseFloat(Number(v).toFixed(6)));
        if (field === 'waypoints') return splitWaypointIds(v).join(',');
        if (field === 'color' || field === 'profile' || field === 'service') return v.toLowerCase();
        return v;
    });
    if (withVersion) values.push(String(r.version ?? ''), String(r.updated_at ?? ''));
    return JSON.stringify(values);
}

/** FNV-1a, as 8 hex digits. */
export function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

export function rowFingerprint(table, row) {
    return hashString(canonical(table, row, true));
}

/** Whether two rows hold the same content, ignoring version columns. */
export function sameContent(table, a, b) {
    return canonical(table, a, false) === canonical(table, b, false);
}

/** One fingerprint for the whole network, changing whenever any row does. */
export function networkFingerprint(tables) {
    const lines = TABLES.flatMap(table => [...(tables[table]?.entries() || [])].map(([id, row]) => `${table}:${id}:${rowFingerprint(table, row)}`));
    return hashString(lines.sort().join('\n'));
}

const key = (table, id) => `${table}:${id}`;

/**
 * The rows a save or delete was refused for because they changed upstream.
 * While any remain, updates and deletes to those rows are refused: each one is
 * settled by `insertAsNew` (keep the local version as a new row) or `discard`
 * (drop it and take the sheet's), and conflict mode ends with the last one.
 */
export class ConflictState {
    constructor(sync = null) {
        this.sync = sync;
        this._conflicts = new Map();
    }

    get active() {
        return this._conflicts.size > 0;
    }

    list() {
        return [...this._conflicts.values()];
    }

    has(table, id) {
        return this._conflicts.has(key(table, id));
    }

    add(conflicts) {
        (conflicts || []).forEach(c => this._conflicts.set(key(c.table, c.id), c));
    }

    /** The pending conflicts among `[{table, id}]`, which a write must not touch. */
    blocking(targets) {
        return (targets || []).filter(t => this.has(t.table, t.id)).map(t => this._conflicts.get(key(t.table, t.id)));
    }

    _find(idOrRow, table) {
        const id = typeof idOrRow === 'object' && idOrRow !== null ? normalizeRow(idOrRow).id : idOrRow;
        const matches = this.list().filter(c => String(c.id) === String(id) && (!table || c.table === table));
        if (matches.length !== 1) {
            throw new Error(matches.length ? `"${id}" is in conflict in both tables; name the table` : `No conflict for "${id}"`);
        }
        return matches[0];
    }

    /** Drop the local version of a conflicted row; the sheet's stands. */
    discard(id, table = null) {
        const conflict = this._find(id, table);
        this._conflicts.delete(key(conflict.table, conflict.id));
        this.sync?.rebase?.(conflict.table, conflict.id, conflict.remote);
        return conflict;
    }

    /**
     * Write the local version of a conflicted row as a new row with a fresh id,
     * leaving the sheet's row as it is. Resolves to `{id, row, result}`.
     */
    async insertAsNew(localRow, table = null) {
        if (localRow?.table && 'local' in localRow) [localRow, table] = [localRow.local, localRow.table];
        const conflict = this._find(localRow, table);
        if (!this.sync) throw new Error('ConflictState has no sync client to write with');
        if (!localRow && !conflict.local) throw new Error(`"${conflict.id}" was a delete; there is no local row to insert`);
        const remote = await this.sync.load();
        const taken = [...remote[conflict.table].keys(), ...this.list().filter(c => c.table === conflict.table).map(c => String(c.id))];
        const id = freshId(conflict.id, taken, { route: conflict.table === 'routes' });
        const row = { ...normalizeRow(localRow && typeof localRow === 'object' ? localRow : conflict.local), id };
        delete row.version;
        delete row.updated_at;
        const result = await this.sync.save({ [conflict.table]: [row] });
        if (result.conflict || result.refused) return { id, row, result };
        this._conflicts.delete(key(conflict.table, conflict.id));
        this.sync.rebase?.(conflict.table, conflict.id, conflict.remote);
        return { id, row, result };
    }
}

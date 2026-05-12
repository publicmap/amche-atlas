// Streaming SQLite/GeoPackage reader using File.slice() — no full-file load into memory

export class StreamingGPKGReader {
    constructor(file) {
        this.file = file;
        this.pageSize = 4096;
        this.pageCount = 0;
        this._cache = new Map();
    }

    async open() {
        const hdr = await this._slice(0, 100);
        const magic = new TextDecoder('ascii').decode(hdr.slice(0, 16));
        if (magic !== 'SQLite format 3\x00') throw new Error('Not a valid SQLite database');
        const dv = new DataView(hdr.buffer);
        const raw = dv.getUint16(16, false); // big-endian page size
        this.pageSize = raw === 1 ? 65536 : raw;
        this.pageCount = dv.getUint32(28, false);
    }

    async _slice(offset, length) {
        return new Uint8Array(await this.file.slice(offset, offset + length).arrayBuffer());
    }

    async _page(n) {
        if (this._cache.has(n)) return this._cache.get(n);
        const data = await this._slice((n - 1) * this.pageSize, this.pageSize);
        if (this._cache.size >= 128) this._cache.delete(this._cache.keys().next().value);
        this._cache.set(n, data);
        return data;
    }

    // SQLite varint: big-endian, 1-9 bytes; high bit = "more bytes follow"
    _varint(data, pos) {
        let v = 0, n = 0;
        for (let i = 0; i < 9; i++) {
            const b = data[pos + i]; n++;
            if (i === 8) { v = v * 256 + b; break; }
            v = v * 128 + (b & 0x7F);
            if (!(b & 0x80)) break;
        }
        return [v, n];
    }

    // Read cells from a leaf table B-tree page; handles overflow pages
    async _leafCells(pageNum) {
        const page = await this._page(pageNum);
        const h = pageNum === 1 ? 100 : 0; // page 1 has a 100-byte db file header before btree header
        if (page[h] !== 0x0D) return [];
        const dv = new DataView(page.buffer);
        const count = dv.getUint16(h + 3, false);
        const U = this.pageSize;
        const X = U - 35;
        const M = Math.floor(((U - 12) * 32 / 255) - 23);
        const cells = [];

        for (let i = 0; i < count; i++) {
            const cellOff = dv.getUint16(h + 8 + i * 2, false);
            let pos = cellOff;
            const [payLen, ps] = this._varint(page, pos); pos += ps;
            const [rowid, rs] = this._varint(page, pos); pos += rs;

            let localLen, ovPage = 0;
            if (payLen <= X) {
                localLen = payLen;
            } else {
                localLen = M + ((payLen - M) % (U - 4));
                if (localLen > X) localLen = M;
                ovPage = dv.getUint32(pos + localLen, false);
            }

            let payload = page.slice(pos, pos + localLen);

            if (ovPage) {
                const chunks = [payload];
                let remaining = payLen - localLen, next = ovPage;
                while (next && remaining > 0) {
                    const ov = await this._page(next);
                    next = new DataView(ov.buffer).getUint32(0, false);
                    const n = Math.min(remaining, U - 4);
                    chunks.push(ov.slice(4, 4 + n));
                    remaining -= n;
                }
                const total = chunks.reduce((s, c) => s + c.length, 0);
                payload = new Uint8Array(total);
                let off = 0;
                for (const c of chunks) { payload.set(c, off); off += c.length; }
            }

            cells.push({ rowid, payload });
        }
        return cells;
    }

    // Walk a table B-tree: recurse into interior pages, yield cells from leaf pages
    async* _walk(pageNum) {
        const page = await this._page(pageNum);
        const h = pageNum === 1 ? 100 : 0;
        const dv = new DataView(page.buffer);
        const type = page[h];
        if (type === 0x0D) {
            for (const cell of await this._leafCells(pageNum)) yield cell;
        } else if (type === 0x05) {
            const count = dv.getUint16(h + 3, false);
            const rightmost = dv.getUint32(h + 8, false);
            for (let i = 0; i < count; i++) {
                const cellOff = dv.getUint16(h + 12 + i * 2, false);
                yield* this._walk(dv.getUint32(cellOff, false));
            }
            yield* this._walk(rightmost);
        }
    }

    // Decode a SQLite record payload into a plain object
    _decode(payload, cols, pkCol, rowid) {
        const dv = new DataView(payload.buffer, payload.byteOffset);
        let pos = 0;
        const [hLen, hs] = this._varint(payload, pos); pos += hs;
        const types = [];
        let hp = hs;
        while (hp < hLen) { const [t, ts] = this._varint(payload, hp); types.push(t); hp += ts; }
        pos = hLen;

        // GDAL/OGR stores INTEGER PRIMARY KEY as serial-type 0 (NULL) in the record,
        // making types.length === cols.length. Pure SQLite omits it entirely,
        // making types.length === cols.length - 1. Detect which case we have.
        const eff = (pkCol && types.length === cols.length - 1)
            ? cols.filter(c => c !== pkCol)
            : cols;
        const row = pkCol ? { [pkCol]: rowid } : {};

        for (let i = 0; i < types.length && i < eff.length; i++) {
            const t = types[i], col = eff[i];
            let v = null;
            if      (t === 0) { v = null; }
            else if (t === 1) { v = dv.getInt8(pos); pos += 1; }
            else if (t === 2) { v = dv.getInt16(pos, false); pos += 2; }
            else if (t === 3) {
                const n = (payload[pos] << 16) | (payload[pos + 1] << 8) | payload[pos + 2];
                v = n & 0x800000 ? n - 0x1000000 : n; pos += 3;
            }
            else if (t === 4) { v = dv.getInt32(pos, false); pos += 4; }
            else if (t === 5) { v = dv.getInt16(pos, false) * 4294967296 + dv.getUint32(pos + 2, false); pos += 6; }
            else if (t === 6) { v = dv.getInt32(pos, false) * 4294967296 + dv.getUint32(pos + 4, false); pos += 8; }
            else if (t === 7) { v = dv.getFloat64(pos, false); pos += 8; }
            else if (t === 8) { v = 0; }
            else if (t === 9) { v = 1; }
            else if (t >= 12 && t % 2 === 0) { const n = (t - 12) / 2; v = payload.slice(pos, pos + n); pos += n; }
            else if (t >= 13 && t % 2 === 1) { const n = (t - 13) / 2; v = new TextDecoder().decode(payload.slice(pos, pos + n)); pos += n; }
            row[col] = v;
        }
        // If pkCol was stored as NULL (GDAL pattern), replace with actual rowid
        if (pkCol && row[pkCol] === null) row[pkCol] = rowid;
        return row;
    }

    // Read sqlite_master to get all table definitions
    async _schema() {
        const cols = ['type', 'name', 'tbl_name', 'rootpage', 'sql'];
        const tables = {};
        for await (const { rowid, payload } of this._walk(1)) {
            const row = this._decode(payload, cols, null, rowid);
            if (row.type === 'table' && typeof row.name === 'string' && row.rootpage > 0) {
                tables[row.name] = { rootPage: row.rootpage, sql: row.sql || '' };
            }
        }
        return tables;
    }

    // Parse CREATE TABLE SQL into { columns, pkCol }
    _parseSql(sql) {
        if (!sql) return { columns: [], pkCol: null };
        const i = sql.indexOf('('), j = sql.lastIndexOf(')');
        if (i === -1) return { columns: [], pkCol: null };
        let pkCol = null;
        const columns = sql.slice(i + 1, j).split(',').reduce((acc, def) => {
            def = def.trim();
            if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)/i.test(def)) return acc;
            const name = def.split(/[\s(]/)[0].replace(/["`[\]]/g, '');
            if (!name) return acc;
            if (/INTEGER\s+PRIMARY\s+KEY/i.test(def)) pkCol = name;
            acc.push(name);
            return acc;
        }, []);
        return { columns, pkCol };
    }

    // Get GPKG geometry table list from gpkg_geometry_columns
    async getGeometryTables() {
        const schema = await this._schema();
        if (!schema['gpkg_geometry_columns']) {
            throw new Error('Not a GeoPackage: gpkg_geometry_columns not found');
        }
        const { rootPage, sql } = schema['gpkg_geometry_columns'];
        const { columns, pkCol } = this._parseSql(sql);
        const tables = [];
        for await (const { rowid, payload } of this._walk(rootPage)) {
            const row = this._decode(payload, columns, pkCol, rowid);
            if (row.table_name && row.column_name) {
                const name = String(row.table_name);
                tables.push({
                    tableName: name,
                    geomColumn: String(row.column_name),
                    tableInfo: schema[name]
                });
            }
        }
        return tables;
    }

    // Parse GPKG geometry blob header
    static _gpkgHeader(data) {
        if (data[0] !== 0x47 || data[1] !== 0x50) return { isEmpty: false, wkbOffset: 0 };
        const flags = data[3];
        const envBytes = [0, 32, 48, 48, 64];
        return {
            isEmpty: (flags & 0x20) !== 0,
            wkbOffset: 8 + (envBytes[(flags >> 1) & 0x07] || 0)
        };
    }

    // Parse WKB geometry
    static _wkb(data, state) {
        const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const le = data[state.pos++] === 1;
        const raw = dv.getUint32(state.pos, le); state.pos += 4;
        const iso = raw & 0xFFFF;
        const base = iso > 3000 ? iso - 3000 : iso > 2000 ? iso - 2000 : iso > 1000 ? iso - 1000 : iso;
        const hasZ = (raw & 0x80000000) !== 0 || (iso > 1000 && iso <= 1007) || iso > 3000;
        const hasM = (raw & 0x40000000) !== 0 || (iso > 2000 && iso <= 2007) || iso > 3000;
        const rf64 = () => { const v = dv.getFloat64(state.pos, le); state.pos += 8; return v; };
        const ru32 = () => { const v = dv.getUint32(state.pos, le); state.pos += 4; return v; };
        const pt = () => { const x = rf64(), y = rf64(); if (hasZ) rf64(); if (hasM) rf64(); return [x, y]; };
        const ring = () => { const n = ru32(); return Array.from({ length: n }, pt); };
        switch (base) {
            case 1: return { type: 'Point', coordinates: pt() };
            case 2: return { type: 'LineString', coordinates: ring() };
            case 3: { const n = ru32(); return { type: 'Polygon', coordinates: Array.from({ length: n }, ring) }; }
            case 4: case 5: case 6: {
                const types = ['MultiPoint', 'MultiLineString', 'MultiPolygon'];
                const n = ru32(), coords = [];
                for (let i = 0; i < n; i++) { const g = StreamingGPKGReader._wkb(data, state); if (g) coords.push(g.coordinates); }
                return { type: types[base - 4], coordinates: coords };
            }
            default: return null;
        }
    }

    // Stream GeoJSON features from a geometry table
    async* streamFeatures(tableName, geomColumn, tableInfo) {
        if (!tableInfo) throw new Error(`Table not found: ${tableName}`);
        const { columns, pkCol } = this._parseSql(tableInfo.sql);
        for await (const { rowid, payload } of this._walk(tableInfo.rootPage)) {
            const row = this._decode(payload, columns, pkCol, rowid);
            const blob = row[geomColumn];
            if (!(blob instanceof Uint8Array)) continue;
            const { isEmpty, wkbOffset } = StreamingGPKGReader._gpkgHeader(blob);
            if (isEmpty) continue;
            try {
                const geom = StreamingGPKGReader._wkb(blob, { pos: wkbOffset });
                if (!geom) continue;
                const props = {};
                for (const [k, v] of Object.entries(row)) {
                    if (k !== geomColumn) props[k] = v instanceof Uint8Array ? null : v;
                }
                yield { type: 'Feature', geometry: geom, properties: props };
            } catch { /* skip malformed */ }
        }
    }
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouteSheetSync, ConflictState } from '../route-sheet-sync.js';
import { rowFingerprint, sameContent } from '../route-sheet-conflicts.js';

const SAVE_URL = 'https://script.google.com/macros/s/abc/exec';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/sheet123/edit';

/** An in-memory stand-in for the Apps Script web app in docs/route-sheets.md. */
function fakeScript(initial) {
    const tables = JSON.parse(JSON.stringify(initial));
    const posts = [];
    const find = (table, id) => tables[table].findIndex(r => String(r.id) === String(id));
    const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    const fetch = vi.fn(async (url, init = {}) => {
        if (!init.method || init.method === 'GET') {
            expect(new URL(url).searchParams.get('action')).toBe('list');
            return json({ status: 'ok', ...JSON.parse(JSON.stringify(tables)) });
        }
        const body = JSON.parse(init.body);
        posts.push(body);
        const conflicts = body.ops.filter(op => {
            const i = find(op.table, op.id);
            if (op.op === 'insert') return i !== -1;
            return i === -1 || String(tables[op.table][i].version ?? '') !== String(op.base.version ?? '') || !sameContent(op.table, tables[op.table][i], op.base);
        }).map(op => ({ table: op.table, id: op.id, remote: tables[op.table][find(op.table, op.id)] || null }));
        if (conflicts.length) return json({ status: 'conflict', conflicts });
        const rows = { locations: [], routes: [] };
        const deleted = { locations: [], routes: [] };
        body.ops.forEach(op => {
            const i = find(op.table, op.id);
            if (op.op === 'delete') { tables[op.table].splice(i, 1); deleted[op.table].push(op.id); return; }
            const row = { ...op.row, version: (Number(tables[op.table][i]?.version) || 0) + 1, updated_at: `t${posts.length}` };
            if (i === -1) tables[op.table].push(row); else tables[op.table][i] = row;
            rows[op.table].push(row);
        });
        return json({ status: 'ok', rows, deleted });
    });
    return { tables, posts, fetch };
}

const sheet = () => ({
    locations: [
        { id: 'panjim', name: 'Panjim Market', lng: 73.8278, lat: 15.4989, description: '', version: 1, updated_at: 't0' },
        { id: 'old_goa', name: 'Old Goa', lng: 73.9116, lat: 15.5009, description: '', version: 1, updated_at: 't0' },
        { id: 'miramar', name: 'Miramar', lng: 73.8079, lat: 15.4826, description: '', version: 1, updated_at: 't0' }
    ],
    routes: [
        { id: 'heritage', name: 'Heritage ride', profile: 'cycling', service: 'mapbox', color: '#e32017', locations: 'panjim old_goa', version: 1, updated_at: 't0' },
        { id: 'beach', name: 'Beach', profile: 'walking', service: 'mapbox', color: '', locations: 'panjim,miramar', version: 1, updated_at: 't0' }
    ]
});

describe('RouteSheetSync', () => {
    let server;
    let sync;
    beforeEach(async () => {
        server = fakeScript(sheet());
        sync = new RouteSheetSync({ url: SHEET_URL, saveUrl: SAVE_URL }, { fetch: server.fetch });
    });

    it('refreshes the network from the script, with a fingerprint that follows any change', async () => {
        const first = await sync.refresh();
        expect(first.errors).toEqual([]);
        expect(first.routes.map(r => r.id)).toEqual(['heritage', 'beach']);
        expect(first.routes[0].waypoints).toEqual(['panjim', 'old_goa']);
        expect(first.markers).toHaveLength(3);
        expect((await sync.refresh()).fingerprint).toBe(first.fingerprint);
        server.tables.locations[2].name = 'Miramar beach';
        expect((await sync.refresh()).fingerprint).not.toBe(first.fingerprint);
    });

    it('saves rows that did not change upstream, and rebases them', async () => {
        await sync.refresh();
        const result = await sync.save({ markers: [{ id: 'panjim', lng: 73.83, lat: 15.5, name: 'Panjim' }] });
        expect(result.conflict).toBe(false);
        expect(server.posts[0].ops[0]).toMatchObject({ op: 'update', table: 'locations', id: 'panjim', base: { version: 1 } });
        expect(server.posts[0].ops[0].row).not.toHaveProperty('version');
        expect(server.tables.locations[0]).toMatchObject({ name: 'Panjim', version: 2 });
        const again = await sync.save({ locations: [{ id: 'panjim', lng: 73.83, lat: 15.5, name: 'Panjim, again' }] });
        expect(again.conflict).toBe(false);
        expect(server.tables.locations[0].version).toBe(3);
    });

    it('inserts new rows, including routes in their atlas shape', async () => {
        await sync.refresh();
        const result = await sync.save({ routes: [{ id: 'ferry', waypoints: ['panjim', 'old_goa'], profile: 'driving' }] });
        expect(result.conflict).toBe(false);
        expect(server.posts[0].ops[0]).toMatchObject({ op: 'insert', id: 'ferry', row: { locations: 'panjim,old_goa', service: 'mapbox' } });
    });

    it('returns a conflict, writing nothing, when a touched row changed upstream', async () => {
        await sync.refresh();
        server.tables.routes[0].name = 'Edited by hand';
        const result = await sync.save({ routes: [{ id: 'heritage', waypoints: ['panjim', 'miramar'], profile: 'cycling' }] });
        expect(result).toMatchObject({ conflict: true, conflicts: [{ table: 'routes', id: 'heritage', reason: 'changed', remote: { name: 'Edited by hand' } }] });
        expect(result.conflicts[0].local.locations).toBe('panjim,miramar');
        expect(server.posts).toHaveLength(0);
        expect(sync.conflicts.active).toBe(true);
    });

    it('refuses updates and deletes to a conflicted row without touching the sheet', async () => {
        await sync.refresh();
        server.tables.locations[1].lat = 15.6;
        await sync.save({ markers: [{ id: 'old_goa', lng: 73.9, lat: 15.5 }] });
        const calls = server.fetch.mock.calls.length;
        expect(await sync.save({ markers: [{ id: 'old_goa', lng: 1, lat: 1 }] })).toMatchObject({ refused: true });
        expect(await sync.delete({ locations: ['old_goa'] })).toMatchObject({ refused: true });
        expect(server.fetch.mock.calls.length).toBe(calls);
        expect((await sync.save({ markers: [{ id: 'miramar', lng: 73.8, lat: 15.48 }] })).conflict).toBe(false);
    });

    it('treats a row deleted upstream, or an id taken upstream, as a conflict', async () => {
        await sync.refresh();
        server.tables.routes.splice(1, 1);
        server.tables.routes.push({ id: 'new_one', locations: 'panjim,miramar' });
        const result = await sync.save({ routes: [
            { id: 'beach', waypoints: ['panjim', 'miramar'] },
            { id: 'new_one', waypoints: ['panjim', 'old_goa'] }
        ] });
        expect(result.conflicts.map(c => [c.id, c.reason])).toEqual([['beach', 'deleted'], ['new_one', 'exists']]);
    });

    it('deletes unchanged rows, skips ones already gone, and conflicts on changed ones', async () => {
        await sync.refresh();
        expect((await sync.delete({ routes: ['beach'] })).deleted.routes).toEqual(['beach']);
        expect((await sync.delete({ routes: ['beach'] })).conflict).toBe(false);
        expect(server.posts).toHaveLength(1);
        server.tables.routes[0].color = '#000000';
        const result = await sync.delete({ routes: ['heritage'] });
        expect(result.conflicts[0]).toMatchObject({ id: 'heritage', local: null, reason: 'changed' });
    });

    it('surfaces a conflict the script itself detects (a write racing ours)', async () => {
        await sync.refresh();
        const realFetch = server.fetch.getMockImplementation();
        server.fetch.mockImplementation(async (url, init) => {
            if (init?.method === 'POST') server.tables.locations[0].version = 9;
            return realFetch(url, init);
        });
        const result = await sync.save({ markers: [{ id: 'panjim', lng: 73.8, lat: 15.5 }] });
        expect(result).toMatchObject({ conflict: true, conflicts: [{ table: 'locations', id: 'panjim', local: { id: 'panjim' } }] });
        expect(sync.conflicts.has('locations', 'panjim')).toBe(true);
    });

    it('settles a conflict by inserting the local row as a new one', async () => {
        await sync.refresh();
        server.tables.routes[0].name = 'Upstream';
        const { conflicts } = await sync.save({ routes: [{ id: 'heritage', name: 'Mine', waypoints: ['panjim', 'miramar'] }] });
        const { id, result } = await sync.conflicts.insertAsNew(conflicts[0].local);
        expect(id).toBe('heritage_2');
        expect(result.conflict).toBe(false);
        expect(server.tables.routes.map(r => r.id)).toEqual(['heritage', 'beach', 'heritage_2']);
        expect(server.tables.routes[0].name).toBe('Upstream');
        expect(server.tables.routes[2]).toMatchObject({ name: 'Mine', locations: 'panjim,miramar', version: 1 });
        expect(sync.conflicts.active).toBe(false);
    });

    it('settles a conflict by discarding the local row, after which the row is writable again', async () => {
        await sync.refresh();
        server.tables.locations[0].name = 'Upstream';
        server.tables.locations[1].name = 'Upstream too';
        await sync.save({ markers: [{ id: 'panjim', lng: 1, lat: 1 }, { id: 'old_goa', lng: 2, lat: 2 }] });
        sync.conflicts.discard('panjim');
        expect(sync.conflicts.active).toBe(true);
        expect((await sync.save({ markers: [{ id: 'panjim', lng: 73.8, lat: 15.5, name: 'Mine now' }] })).conflict).toBe(false);
        await sync.conflicts.insertAsNew(sync.conflicts.list()[0]);
        expect(sync.conflicts.active).toBe(false);
        expect(server.tables.locations.map(w => w.id)).toContain('old_goa_2');
    });

    it('needs a saveUrl to write', async () => {
        const readOnly = new RouteSheetSync({ url: SHEET_URL }, { fetch: server.fetch });
        await expect(readOnly.save({ routes: [{ id: 'x', waypoints: ['a', 'b'] }] })).rejects.toThrow(/saveUrl/);
    });
});

describe('RouteSheetSync over the CSV export', () => {
    it('finds the locations and routes tabs by name and reads both', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const csv = {
            '11': 'id,name,lng,lat\na,A,73.8,15.5\nb,B,73.9,15.6\n',
            '22': 'id,profile,locations,color\nr1,walking,"a,b",#00a651\n'
        };
        const fetch = vi.fn(async (url) => {
            if (url.endsWith('/htmlview')) {
                return { ok: true, text: async () => 'items.push({name: "Locations", pageUrl: "x", gid: "11"});items.push({name: "Routes", pageUrl: "y", gid: "22"});' };
            }
            if (url.includes('format=xlsx')) throw new Error('no xlsx in tests');
            return { ok: true, text: async () => csv[new URL(url).searchParams.get('gid')] };
        });
        vi.stubGlobal('fetch', fetch);
        const result = await new RouteSheetSync({ url: SHEET_URL }).refresh();
        expect(result.routes).toEqual([{ id: 'r1', name: '', service: 'mapbox', profile: 'walking', color: '#00a651', waypoints: ['a', 'b'] }]);
        expect(result.markers.map(m => m.id)).toEqual(['a', 'b']);
        vi.unstubAllGlobals();
        warn.mockRestore();
    });
});

describe('ConflictState', () => {
    it('asks for the table when an id is in conflict in both', () => {
        const state = new ConflictState();
        state.add([{ table: 'routes', id: 'a', local: {}, remote: {} }, { table: 'locations', id: 'a', local: {}, remote: {} }]);
        expect(() => state.discard('a')).toThrow(/name the table/);
        state.discard('a', 'routes');
        expect(state.blocking([{ table: 'locations', id: 'a' }, { table: 'routes', id: 'a' }])).toHaveLength(1);
        state.discard('a');
        expect(state.active).toBe(false);
    });

    it('fingerprints rows by content and version, not formatting', () => {
        const a = { id: 'r', locations: 'a, b', color: '#E32017', version: 2 };
        expect(rowFingerprint('routes', a)).toBe(rowFingerprint('routes', { ID: 'r', Locations: 'a b', color: '#e32017', version: '2' }));
        expect(rowFingerprint('routes', a)).not.toBe(rowFingerprint('routes', { ...a, version: 3 }));
        expect(rowFingerprint('locations', { id: 'x', lng: '73.80', lat: 15.5 })).toBe(rowFingerprint('locations', { id: 'x', lng: 73.8, lat: '15.500' }));
    });
});

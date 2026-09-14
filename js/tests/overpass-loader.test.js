import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('https://cdn.jsdelivr.net/npm/osmtogeojson@3.0.0-beta.5/+esm', () => ({
    default: (osm) => ({ type: 'FeatureCollection', features: osm.features || [] })
}));

const { OverpassLoader } = await import('../overpass-loader.js');

const DEFAULT = 'https://overpass-api.de/api/interpreter';
const MIRROR_1 = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';

function makeLoader(config = {}) {
    const map = {
        on: () => {},
        off: () => {},
        getZoom: () => 14,
        getCenter: () => ({ lat: 15.5, lng: 73.8 }),
        getBounds: () => ({ getWest: () => 73.8, getSouth: () => 15.4, getEast: () => 73.9, getNorth: () => 15.5 })
    };
    return new OverpassLoader({ map, groupId: 'test', config, onData: () => {}, onError: () => {} });
}

function response(status, body = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: String(status),
        headers: { get: () => null },
        json: async () => body
    };
}

describe('OverpassLoader endpoint failover', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('appends fallback mirrors after the default endpoint', () => {
        expect(makeLoader()._endpoints).toEqual([DEFAULT, MIRROR_1]);
    });

    it('keeps a custom endpoint first without duplicating it', () => {
        const custom = 'https://overpass.kumi.systems/api/interpreter';
        expect(makeLoader({ endpoint: custom })._endpoints).toEqual([custom, MIRROR_1]);
        expect(makeLoader({ endpoint: MIRROR_1 })._endpoints).toEqual([MIRROR_1]);
    });

    it('uses an explicit endpoints list verbatim', () => {
        expect(makeLoader({ endpoints: ['https://self.hosted/api/interpreter'] })._endpoints)
            .toEqual(['https://self.hosted/api/interpreter']);
    });

    it('falls through to the next mirror on 504 and sticks to it', async () => {
        const loader = makeLoader();
        const fetchMock = vi.fn(async (url) => url === DEFAULT ? response(504) : response(200, { ok: true }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(loader._fetch('q')).resolves.toEqual({ ok: true });
        expect(fetchMock.mock.calls.map(c => c[0])).toEqual([DEFAULT, MIRROR_1]);

        fetchMock.mockClear();
        await loader._fetch('q');
        expect(fetchMock.mock.calls.map(c => c[0])).toEqual([MIRROR_1]);
    });

    it('fails over on network errors too', async () => {
        const loader = makeLoader();
        const fetchMock = vi.fn(async (url) => {
            if (url === DEFAULT) throw new TypeError('Failed to fetch');
            return response(200, { ok: true });
        });
        vi.stubGlobal('fetch', fetchMock);
        await expect(loader._fetch('q')).resolves.toEqual({ ok: true });
    });

    it('propagates AbortError without trying other endpoints', async () => {
        const loader = makeLoader();
        const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
        const fetchMock = vi.fn(async () => { throw abort; });
        vi.stubGlobal('fetch', fetchMock);
        await expect(loader._fetch('q')).rejects.toBe(abort);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not fail over on a non-transient status', async () => {
        const loader = makeLoader();
        const fetchMock = vi.fn(async () => response(400));
        vi.stubGlobal('fetch', fetchMock);
        await expect(loader._fetch('q')).rejects.toThrow('Overpass HTTP 400');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('surfaces a rate-limit error once every endpoint fails', async () => {
        const loader = makeLoader();
        vi.stubGlobal('fetch', vi.fn(async () => response(504)));
        await expect(loader._fetch('q')).rejects.toMatchObject({ isRateLimit: true, status: 504, retryAfterMs: 10000 });
    });
});

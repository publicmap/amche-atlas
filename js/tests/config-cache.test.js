import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchConfigJson, fetchConfigResult, clearConfigCache } from '../config-cache.js';

function jsonResponse(body, { ok = true, status = 200, contentType = 'application/json' } = {}) {
    return {
        ok,
        status,
        headers: { get: (name) => (name === 'content-type' ? contentType : null) },
        json: () => Promise.resolve(body)
    };
}

beforeEach(() => {
    clearConfigCache();
});

describe('fetchConfigJson', () => {
    it('fetches a URL once however many callers ask for it', async () => {
        global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ name: 'Index' })));

        const [a, b, c] = await Promise.all([
            fetchConfigJson('config/index.atlas.json'),
            fetchConfigJson('config/index.atlas.json'),
            fetchConfigJson('config/index.atlas.json')
        ]);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(a.name).toBe('Index');
        expect(b.name).toBe('Index');
        expect(c.name).toBe('Index');
    });

    it('serves a later caller from the cache too', async () => {
        global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ name: 'Index' })));

        await fetchConfigJson('config/index.atlas.json');
        await fetchConfigJson('config/index.atlas.json');

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('gives every caller its own copy, since callers mutate the config', async () => {
        global.fetch = vi.fn(() => Promise.resolve(jsonResponse({
            map: { center: [0, 0] },
            layers: [{ id: 'a', initiallyChecked: true }]
        })));

        const first = await fetchConfigJson('config/index.atlas.json');
        first.map.style = 'mapbox://styles/mine';
        first.layers[0].initiallyChecked = false;

        const second = await fetchConfigJson('config/index.atlas.json');
        expect(second.map.style).toBeUndefined();
        expect(second.layers[0].initiallyChecked).toBe(true);
    });

    it('caches a miss so a file that is not there is probed once', async () => {
        global.fetch = vi.fn(() => Promise.resolve(jsonResponse(null, { ok: false, status: 404 })));

        expect(await fetchConfigJson('config/nope.atlas.json')).toBeNull();
        expect(await fetchConfigJson('config/nope.atlas.json')).toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('reports a static host SPA fallback (200 + HTML) as a failure', async () => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'text/html' },
            json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON'))
        }));

        const result = await fetchConfigResult('config/missing.atlas.json');
        expect(result.ok).toBe(false);
        expect(result.json).toBeNull();
        expect(result.contentType).toBe('text/html');
    });

    it('reports a thrown fetch (offline, CORS) as a failure rather than throwing', async () => {
        global.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

        const result = await fetchConfigResult('https://elsewhere.example/atlas.json');
        expect(result.ok).toBe(false);
        expect(result.status).toBe(0);
        expect(result.error).toContain('Failed to fetch');
    });
});

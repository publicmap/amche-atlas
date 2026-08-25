import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LayerRegistry } from '../layer-registry.js';

const EXTERNAL_URL = 'https://raw.githubusercontent.com/example/ext/main/config/ext.atlas.json';

function baseConfigs() {
    return {
        'config/index.atlas.json': {
            name: 'Index',
            atlases: ['goa', EXTERNAL_URL],
            layers: [{ id: 'selection', type: 'geojson', title: 'Selected' }]
        },
        'config/goa.atlas.json': {
            name: 'Goa',
            layers: [{ id: 'villages', type: 'vector', title: 'Villages', url: 'https://example.com/{z}/{x}/{y}.pbf', sourceLayer: 'villages' }]
        },
        [EXTERNAL_URL]: {
            name: 'External',
            layers: [{ id: 'poi', type: 'geojson', title: 'Ext POI' }]
        }
    };
}

function mockFetchJson(map) {
    return vi.fn((url) => {
        const body = map[url];
        if (!body) {
            return Promise.resolve({ ok: false, status: 404, headers: { get: () => 'text/html' } });
        }
        return Promise.resolve({
            ok: true,
            headers: { get: () => 'application/json' },
            json: () => Promise.resolve(body)
        });
    });
}

describe('LayerRegistry deferred external atlas loading', () => {
    beforeEach(() => {
        global.window = {
            amche: { DEFAULT_ATLAS: 'config/index.atlas.json' },
            location: { search: '' }
        };
    });

    it('loads local atlases eagerly but defers an untargeted external atlas', async () => {
        const configs = baseConfigs();
        global.fetch = mockFetchJson(configs);

        const registry = new LayerRegistry();
        await registry.initialize();

        // Local atlas fully resolved.
        expect(registry.getAtlasMetadata('goa')).toBeTruthy();
        expect(registry.getLayer('goa-villages')).toBeTruthy();

        // External atlas known about (for later on-demand loading) but not fetched.
        expect(global.fetch).not.toHaveBeenCalledWith(EXTERNAL_URL);
        expect(registry._pendingAtlases.has('ext')).toBe(true);
        expect(registry.getAtlasMetadata('ext')).toBeNull();
        expect(registry.getLayer('ext-poi')).toBeNull();
    });

    it('fetches the external atlas on demand via ensureAtlasLoaded', async () => {
        const configs = baseConfigs();
        global.fetch = mockFetchJson(configs);

        const registry = new LayerRegistry();
        await registry.initialize();
        await registry.ensureAtlasLoaded('ext');

        expect(global.fetch).toHaveBeenCalledWith(EXTERNAL_URL);
        expect(registry._pendingAtlases.has('ext')).toBe(false);
        expect(registry.getAtlasMetadata('ext')).toBeTruthy();
        expect(registry.getLayer('ext-poi')).toBeTruthy();
    });

    it('eagerly loads an external atlas explicitly targeted via ?atlas=', async () => {
        global.window.location.search = '?atlas=ext';
        const configs = baseConfigs();
        global.fetch = mockFetchJson(configs);

        const registry = new LayerRegistry();
        await registry.initialize();

        expect(global.fetch).toHaveBeenCalledWith(EXTERNAL_URL);
        expect(registry._pendingAtlases.has('ext')).toBe(false);
        expect(registry.getLayer('ext-poi')).toBeTruthy();
    });

    it('eagerly loads an external atlas referenced via ?layers=', async () => {
        global.window.location.search = '?layers=ext-poi';
        const configs = baseConfigs();
        global.fetch = mockFetchJson(configs);

        const registry = new LayerRegistry();
        await registry.initialize();

        expect(registry._pendingAtlases.has('ext')).toBe(false);
        expect(registry.getLayer('ext-poi')).toBeTruthy();
    });

    it('ensureAllAtlasesLoaded loads every remaining deferred atlas', async () => {
        const configs = baseConfigs();
        global.fetch = mockFetchJson(configs);

        const registry = new LayerRegistry();
        await registry.initialize();
        await registry.ensureAllAtlasesLoaded();

        expect(registry._pendingAtlases.size).toBe(0);
        expect(registry.getLayer('ext-poi')).toBeTruthy();
    });
});

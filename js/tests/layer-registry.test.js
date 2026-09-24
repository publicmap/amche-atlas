import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LayerRegistry } from '../layer-registry.js';
import { clearConfigCache } from '../config-cache.js';

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
        // The config cache lives for the lifetime of the module, which across
        // tests means one test's fetch satisfies the next one's and the fetch
        // spy never sees it.
        clearConfigCache();
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

    it('lets an imported config curate the collection with its own atlases list', async () => {
        const IMPORTED_URL = 'https://openstreetmap.in/config/index.atlas.json';
        global.window.location.search = `?atlas=${IMPORTED_URL}`;
        const configs = baseConfigs();
        configs['config/world.atlas.json'] = {
            name: 'World',
            layers: [{ id: 'imagery', type: 'tms', title: 'Imagery', url: 'https://example.com/{z}/{x}/{y}.png' }]
        };
        configs[IMPORTED_URL] = {
            name: 'OpenStreetMap India',
            atlases: ['world'],
            layers: [{ id: 'world-imagery', initiallyChecked: true }]
        };
        global.fetch = mockFetchJson(configs);

        const registry = new LayerRegistry();
        await registry.initialize();

        // The imported list replaces the local index's, rather than adding to it.
        expect(registry.getAtlasMetadata('world')).toBeTruthy();
        expect(registry.getLayer('world-imagery')).toBeTruthy();
        expect(registry.getAtlasMetadata('goa')).toBeNull();
        expect(registry._pendingAtlases.has('ext')).toBe(false);

        // The local index still loads - it defines the app's own working layers.
        expect(registry.getLayer('selection')).toBeTruthy();

        // ...but it isn't offered as somewhere to browse, so the switcher shows
        // the imported collection rather than the host instance's own.
        expect(registry.getAllAtlasMetadata().map(([id]) => id)).not.toContain('index');
        expect(registry.getAllAtlasMetadata().map(([id]) => id)).toContain('world');
    });

    it('prefers an atlas hosted beside the collection, falling back to this instance', async () => {
        const IMPORTED_URL = 'https://openstreetmap.in/config/index.atlas.json';
        global.window.location.search = `?atlas=${IMPORTED_URL}`;
        const configs = baseConfigs();
        configs[IMPORTED_URL] = { name: 'Collection', atlases: ['goa', 'osm'] };
        // The collection ships its own goa.atlas.json but no osm.atlas.json.
        configs['https://openstreetmap.in/config/goa.atlas.json'] = {
            name: 'Their Goa',
            layers: [{ id: 'theirs', type: 'geojson', title: 'Theirs' }]
        };
        configs['config/osm.atlas.json'] = {
            name: 'OpenStreetMap',
            layers: [{ id: 'places', type: 'vector', title: 'Places', url: 'https://example.com/{z}/{x}/{y}.pbf', sourceLayer: 'places' }]
        };
        global.fetch = mockFetchJson(configs);

        const registry = new LayerRegistry();
        await registry.initialize();

        // Theirs wins where they published one...
        expect(registry.getAtlasMetadata('goa').name).toBe('Their Goa');
        expect(registry.getLayer('goa-theirs')).toBeTruthy();
        expect(registry.getLayer('goa-villages')).toBeNull();

        // ...and the embedded instance's own copy fills the gap where they didn't.
        expect(registry.getAtlasMetadata('osm').name).toBe('OpenStreetMap');
        expect(registry.getLayer('osm-places')).toBeTruthy();
    });

    it('falls back to the local index when an imported config names no collection', async () => {
        const IMPORTED_URL = 'https://example.org/just-one.atlas.json';
        global.window.location.search = `?atlas=${IMPORTED_URL}`;
        const configs = baseConfigs();
        configs[IMPORTED_URL] = { name: 'Just one', layers: [{ id: 'thing', type: 'geojson', title: 'Thing' }] };
        global.fetch = mockFetchJson(configs);

        const registry = new LayerRegistry();
        await registry.initialize();

        expect(registry.getAtlasMetadata('goa')).toBeTruthy();
        expect(registry.getAllAtlasMetadata().map(([id]) => id)).toContain('index');
    });

    it('resolves past an imported atlas stub to the real cross-atlas definition', async () => {
        // An imported atlas registers its own layers verbatim, so a bare
        // `{id: "goa-villages"}` reference in it lands in the registry as
        // "imported-goa-villages" with no type. Returning that stub sent
        // map-init off to tryLoadCrossConfigLayer, refetching goa.atlas.json
        // once per referencing layer.
        const IMPORTED_URL = 'https://example.org/mine.atlas.json';
        global.window.location.search = `?atlas=${IMPORTED_URL}`;
        const configs = baseConfigs();
        configs[IMPORTED_URL] = {
            name: 'Mine',
            layers: [{ id: 'goa-villages', initiallyChecked: true }]
        };
        global.fetch = mockFetchJson(configs);

        const registry = new LayerRegistry();
        await registry.initialize();
        registry.markImportedAtlas('imported', { name: 'Mine' }, configs[IMPORTED_URL]);

        const resolved = registry.getLayer('goa-villages', 'imported');
        expect(resolved.type).toBe('vector');
        expect(resolved.url).toBe('https://example.com/{z}/{x}/{y}.pbf');
    });

    it('still returns a stub when no complete definition exists anywhere', async () => {
        // The caller needs something to hand to its network fallback.
        const IMPORTED_URL = 'https://example.org/mine.atlas.json';
        global.window.location.search = `?atlas=${IMPORTED_URL}`;
        const configs = baseConfigs();
        configs[IMPORTED_URL] = {
            name: 'Mine',
            layers: [{ id: 'nowhere-layer', initiallyChecked: true }]
        };
        global.fetch = mockFetchJson(configs);

        const registry = new LayerRegistry();
        await registry.initialize();
        registry.markImportedAtlas('imported', { name: 'Mine' }, configs[IMPORTED_URL]);

        expect(registry.getLayer('nowhere-layer', 'imported', true).id).toBe('nowhere-layer');
    });

    it('treats a vector entry with no tile source as a stub, not an answer', async () => {
        const IMPORTED_URL = 'https://example.org/mine.atlas.json';
        global.window.location.search = `?atlas=${IMPORTED_URL}`;
        const configs = baseConfigs();
        // Carries metadata but no url - the shape an atlas produces when it
        // restyles another atlas's layer without redefining its source.
        configs[IMPORTED_URL] = {
            name: 'Mine',
            layers: [{ id: 'goa-villages', type: 'vector', title: 'Renamed', style: { 'line-color': 'red' } }]
        };
        global.fetch = mockFetchJson(configs);

        const registry = new LayerRegistry();
        await registry.initialize();
        registry.markImportedAtlas('imported', { name: 'Mine' }, configs[IMPORTED_URL]);

        expect(registry.getLayer('goa-villages', 'imported').url).toBe('https://example.com/{z}/{x}/{y}.pbf');
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

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jQuery from 'jquery';

// map-layer-controls.js uses the global `$` the app loads from a CDN.
global.$ = global.jQuery = jQuery;
window.$ = window.jQuery = jQuery;

// The constructor fetches the shared style defaults; serve empty ones so the
// tests exercise layer bookkeeping rather than styling.
window.amche = { LAYER_DEFAULTS: '/config/_defaults.json', DEFAULT_ATLAS: '/config/index.atlas.json' };
global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ layer: { style: {} } }) });

const { MapLayerControl } = await import('../map-layer-controls.js');

/**
 * A control primed the way it looks after startup: `_state.groups` and
 * `_sourceControls` index-parallel, with the rows mounted in a container.
 */
function createControl(layerIds) {
    const control = new MapLayerControl(layerIds.map(id => ({ id, title: id, type: 'geojson' })));

    control._container = document.createElement('div');
    control._map = { getCenter: () => ({ lng: 0, lat: 0 }) };
    control._mapboxAPI = {
        createLayerGroup: vi.fn().mockResolvedValue(true),
        updateLayerOpacity: vi.fn(),
        removeLayerGroup: vi.fn()
    };

    control._state.groups.forEach((group, index) => {
        $(control._container).append(control._createGroupHeader(group, index));
    });

    return control;
}

function uploadedLayer(id) {
    return { id, title: id, type: 'geojson', dataSource: 'localStorage', initiallyChecked: false };
}

/**
 * `_originalJson` is stored in the URL-safe single-quote form url-manager.js
 * reads back, so decode it the same way before comparing against the config.
 */
function decodeOriginalJson(value) {
    return JSON.parse(
        value
            .replace(/\\'/g, '\u0001')
            .replace(/'/g, '"')
            .replace(/\u0001/g, "'")
    );
}

/** Every row must describe the group sitting at the same index. */
function arraysAreParallel(control) {
    return control._state.groups.every(
        (group, index) => control._sourceControls[index]?.getAttribute('data-layer-id') === group.id
    );
}

describe('MapLayerControl._addLayerDirectly', () => {
    let control;

    beforeEach(() => {
        window.layerRegistry = undefined;
        window.urlManager = undefined;
        window.attributionControl = undefined;
        control = createControl(['roads', 'plots', 'satellite']);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('starts with groups and source controls index-parallel', () => {
        expect(control._state.groups).toHaveLength(3);
        expect(control._sourceControls).toHaveLength(3);
        expect(arraysAreParallel(control)).toBe(true);
    });

    it('keeps the arrays parallel and grows both when adding layers', async () => {
        await control._addLayerDirectly(uploadedLayer('schools'));

        expect(control._state.groups).toHaveLength(4);
        expect(control._sourceControls).toHaveLength(4);
        expect(arraysAreParallel(control)).toBe(true);

        await control._addLayerDirectly(uploadedLayer('hospitals'));

        expect(control._state.groups).toHaveLength(5);
        expect(control._sourceControls).toHaveLength(5);
        expect(arraysAreParallel(control)).toBe(true);
    });

    it('keeps every previously added layer when a new one is added', async () => {
        await control._addLayerDirectly(uploadedLayer('schools'));
        await control._addLayerDirectly(uploadedLayer('hospitals'));
        await control._addLayerDirectly(uploadedLayer('parks'));

        const ids = control._state.groups.map(group => group.id);
        expect(ids).toEqual(['parks', 'hospitals', 'schools', 'roads', 'plots', 'satellite']);

        // One create per layer, and nothing removed to make room for it.
        expect(control._mapboxAPI.createLayerGroup).toHaveBeenCalledTimes(3);
        expect(control._mapboxAPI.removeLayerGroup).not.toHaveBeenCalled();
    });

    it('renders each added layer as a checked row in the panel', async () => {
        await control._addLayerDirectly(uploadedLayer('schools'));
        await control._addLayerDirectly(uploadedLayer('hospitals'));

        ['schools', 'hospitals'].forEach(id => {
            const row = control._container.querySelector(`[data-layer-id="${id}"]`);
            expect(row, `expected a panel row for ${id}`).not.toBeNull();
            expect(row.querySelector('.toggle-switch input[type="checkbox"]').checked).toBe(true);
        });

        // DOM order mirrors the array order, so the newest layer sits on top.
        const rendered = Array.from(control._container.children).map(el => el.getAttribute('data-layer-id'));
        expect(rendered).toEqual(control._state.groups.map(group => group.id));
    });

    it('preserves the full config of unregistered layers for the URL', async () => {
        const config = uploadedLayer('schools');
        await control._addLayerDirectly(config);

        const added = control._state.groups.find(group => group.id === 'schools');
        expect(added.initiallyChecked).toBe(true);
        expect(decodeOriginalJson(added._originalJson)).toEqual(config);
    });
});

describe('MapLayerControl._getGroupIndex', () => {
    it('reports the position a layer currently occupies, not a stale one', async () => {
        const control = createControl(['roads', 'plots']);
        const roads = control._state.groups.find(group => group.id === 'roads');

        expect(control._getGroupIndex(roads)).toBe(0);

        await control._addLayerDirectly(uploadedLayer('schools'));

        // 'roads' has been pushed down, and the lookup must follow it — reusing
        // the index captured when its row was built would resolve to 'schools'.
        expect(control._getGroupIndex(roads)).toBe(1);
        expect(control._state.groups[1].id).toBe('roads');
    });

    it('returns -1 for a layer that is not in the control', () => {
        const control = createControl(['roads']);
        expect(control._getGroupIndex({ id: 'missing' })).toBe(-1);
        expect(control._getGroupIndex(undefined)).toBe(-1);
    });
});

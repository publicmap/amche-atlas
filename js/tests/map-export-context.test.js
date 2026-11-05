// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { MapExportControl } = await import('../map-export-control.js');

/**
 * openWithContext scopes the Export panel to one layer: these drive it on an
 * instance with a fake iframe, frame and isolation manager - no map needed.
 */
function makeControl() {
    const control = new MapExportControl();
    const posted = [];
    control._iframe = document.createElement('iframe');
    control._iframeSrcLoaded = true;
    Object.defineProperty(control._iframe, 'contentWindow', { value: { postMessage: (msg) => posted.push(msg) } });
    control._frame = { hide: vi.fn(), show: vi.fn() };
    control._map = { getSource: () => null };
    control._updateTitleFromLocation = vi.fn();
    return { control, posted };
}

function makeIsolation(persistent = null) {
    const isolation = {
        _persistent: persistent,
        isolate: vi.fn((layerId, isBasemap) => { isolation._persistent = { layerId, isBasemap }; }),
        clear: vi.fn(() => { isolation._persistent = null; })
    };
    return isolation;
}

const FEATURES = [
    { type: 'Feature', properties: { name: 'A', keep: true }, geometry: { type: 'Point', coordinates: [0, 0] } },
    { type: 'Feature', properties: { name: 'B', keep: false }, geometry: { type: 'Point', coordinates: [1, 1] } }
];

describe('MapExportControl.openWithContext', () => {
    beforeEach(() => {
        window.stateManager = {
            getLayerConfig: () => ({ id: 'cycling', title: 'Cycling Route 1', tags: [] }),
            getLayerSourceRefs: () => []
        };
        window.urlManager = undefined;
    });

    it('isolates the context layer and restores the earlier isolation on close', () => {
        const isolation = makeIsolation({ layerId: 'editor-layer', isBasemap: false });
        window.layerControl = { isolation };
        const { control } = makeControl();

        control.openWithContext({ layerId: 'cycling', title: 'Cycling Route 1', features: FEATURES });
        expect(isolation.isolate).toHaveBeenLastCalledWith('cycling', false);
        expect(control._context.useFor).toBe('gis');

        control._hide();
        expect(control._context).toBeNull();
        expect(isolation.isolate).toHaveBeenLastCalledWith('editor-layer', false);
        expect(isolation.clear).not.toHaveBeenCalled();
    });

    it('clears isolation when none was applied before, and the plain open has no context', () => {
        const isolation = makeIsolation();
        window.layerControl = { isolation };
        const { control } = makeControl();

        control.openWithContext({ layerId: 'cycling', title: 'Cycling Route 1' });
        control._clearContext();
        expect(isolation.clear).toHaveBeenCalledTimes(1);

        control._show();
        expect(control._context).toBeNull();
    });

    it('sends the panel only the serializable part of the context', async () => {
        window.layerControl = { isolation: makeIsolation() };
        const { control, posted } = makeControl();

        control.openWithContext({ layerId: 'cycling', title: 'Cycling Route 1', features: FEATURES, featureFilter: () => true });
        await new Promise(resolve => setTimeout(resolve, 80));

        const opened = posted.find(msg => msg.type === 'export-opened');
        expect(opened.context).toMatchObject({ layerId: 'cycling', title: 'Cycling Route 1', featureCount: 2, useFor: 'gis' });
        expect(opened.context.featureFilter).toBeUndefined();
    });

    it('exports only the given features, or the filtered layer, named after the context', async () => {
        window.layerControl = { isolation: makeIsolation() };
        const { control } = makeControl();

        control.openWithContext({ layerId: 'cycling', title: 'Cycling Route 1', features: [FEATURES[1]] });
        const config = {};
        await control._loadContextFeatures(config);
        expect(config.customSelectedFeatures.map(item => item.feature)).toEqual([FEATURES[1]]);
        expect(control._generateFilenameFromFeatures(config.customSelectedFeatures, 'kml')).toBe('Cycling_Route_1.kml');
        expect(control._generateFilename('png')).toBe('Cycling_Route_1.png');

        window.stateManager.getLayerSourceRefs = () => [{ source: 'cycling-src' }];
        const source = { type: 'geojson', serialize: () => ({ data: { type: 'FeatureCollection', features: FEATURES } }) };
        control._map = { getSource: (id) => (id === 'cycling-src' ? source : null) };
        const items = await control._collectContextItems({
            layerId: 'cycling',
            featureFilter: (feature) => feature.properties.keep
        });
        expect(items.map(item => item.feature.properties.name)).toEqual(['A']);
    });
});

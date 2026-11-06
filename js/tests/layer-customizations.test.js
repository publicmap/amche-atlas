// @vitest-environment jsdom
import { layerCustomizations, splitLayersParam, urlUsage, formatValue, URL_MAX_LENGTH } from '../layer-customizations.js';

const presets = {
    roads: { id: 'roads', title: 'Roads', style: { 'line-color': '#000' } },
    parks: { id: 'parks', title: 'Parks', opacity: 0.8, filter: ['==', 'a', 1] }
};

describe('layer customizations', () => {
    beforeEach(() => {
        window.layerRegistry = { getLayer: (id) => presets[id] || null };
        window.layerControl = { _state: { groups: [] } };
    });
    afterEach(() => {
        delete window.layerRegistry;
        delete window.layerControl;
    });

    it('lists edited fields, opacity and filter that differ from the preset', () => {
        const layer = { id: 'roads', _editedFields: ['id', 'style', 'title'], title: 'Roads', style: { 'line-color': '#f00' }, opacity: 0.5, filter: ['has', 'name'] };
        expect(layerCustomizations(layer)).toEqual([
            { field: 'style', value: { 'line-color': '#f00' }, configured: { 'line-color': '#000' } },
            { field: 'opacity', value: 0.5, configured: 1 },
            { field: 'filter', value: ['has', 'name'], configured: undefined }
        ]);
    });

    it('ignores values equal to the preset', () => {
        expect(layerCustomizations({ id: 'parks', opacity: 0.8, filter: ['==', 'a', 1] })).toEqual([]);
        expect(layerCustomizations({ id: 'roads', opacity: 1 })).toEqual([]);
    });

    it('splits ?layers= on top-level commas only', () => {
        expect(splitLayersParam('a,{"id":"b","filter":["==","x",1]},route-r1:mapbox-cycling(p,q),c'))
            .toEqual(['a', '{"id":"b","filter":["==","x",1]}', 'route-r1:mapbox-cycling(p,q)', 'c']);
    });

    it('reports changes on a map that is off, and on entries past the limit', () => {
        const big = { id: 'roads', _editedFields: ['style'], style: { 'line-color': '#f00', pad: 'x'.repeat(URL_MAX_LENGTH) } };
        const off = { id: 'parks', opacity: 0.3 };
        window.layerControl._state.groups = [big, off];
        const href = `https://amche.in/?layers=${encodeURIComponent(JSON.stringify(big))}`;
        const usage = urlUsage(href);
        expect(usage.length).toBe(href.length);
        expect(usage.unsaved.map(u => [u.layer.id, u.reason.startsWith('The map is off')])).toEqual([['roads', false], ['parks', true]]);
    });

    it('shortens long values', () => {
        expect(formatValue(undefined)).toBe('not set');
        expect(formatValue('x'.repeat(100), 10)).toHaveLength(10);
    });
});

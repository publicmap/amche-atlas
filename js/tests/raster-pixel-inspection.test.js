// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';

const { MapMarkerManager } = await import('../map-marker-manager.js');

/**
 * _inspectRasterPixel (see js/map-marker-manager.js) is the glue between
 * RasterPixelInspector's pixel sampling and a layer's legendMap. These cover
 * its three outcomes — legendMap match, hex fallback, nothing rendered
 * there — on a bare prototype instance with a stubbed WebGL readback, no
 * real map needed.
 */
function makeManager({ layers, pixel }) {
    const manager = Object.create(MapMarkerManager.prototype);
    manager._getAllActiveLayersInInspectorOrder = () => layers;

    const gl = {
        readPixels: (x, y, w, h, format, type, out) => {
            out[0] = pixel[0];
            out[1] = pixel[1];
            out[2] = pixel[2];
            out[3] = pixel[3];
        }
    };
    manager._map = {
        project: () => ({ x: 5, y: 5 }),
        getCanvas: () => ({
            width: 10,
            height: 10,
            getContext: (type) => (type === 'webgl' ? gl : null)
        })
    };
    return manager;
}

const WORLDCOVER = {
    id: 'esa-worldcover',
    type: 'tms',
    legendMap: [
        { value: 10, color: '#006400', label: 'Tree cover' },
        { value: 80, color: '#0064c8', label: 'Permanent water bodies' }
    ]
};

const TRUE_COLOR = { id: 'landsat-true-color', type: 'tms' };

describe('MapMarkerManager._inspectRasterPixel', () => {
    it('labels the pixel with its legendMap class when the color matches', () => {
        const manager = makeManager({ layers: [WORLDCOVER], pixel: [0, 100, 0, 255] });
        const result = manager._inspectRasterPixel({ lng: 0, lat: 0 });
        expect(result).toMatchObject({ layerId: 'esa-worldcover', featureId: 'Tree cover', isRasterInspection: true });
    });

    it('falls back to the raw hex color when the layer has no legendMap', () => {
        const manager = makeManager({ layers: [TRUE_COLOR], pixel: [18, 52, 86, 255] });
        const result = manager._inspectRasterPixel({ lng: 0, lat: 0 });
        expect(result).toMatchObject({ layerId: 'landsat-true-color', featureId: '#123456', isRasterInspection: true });
    });

    it('falls back to the raw hex color when the legendMap has no close-enough match', () => {
        const manager = makeManager({ layers: [WORLDCOVER], pixel: [10, 10, 200, 255] });
        const result = manager._inspectRasterPixel({ lng: 0, lat: 0 });
        expect(result).toMatchObject({ layerId: 'esa-worldcover', featureId: '#0a0ac8' });
    });

    it('returns null when no raster layer is active', () => {
        const manager = makeManager({ layers: [{ id: 'plots', type: 'vector' }], pixel: [0, 0, 0, 255] });
        expect(manager._inspectRasterPixel({ lng: 0, lat: 0 })).toBeNull();
    });

    it('returns null for a fully transparent pixel (nothing rendered there)', () => {
        const manager = makeManager({ layers: [WORLDCOVER], pixel: [0, 0, 0, 0] });
        expect(manager._inspectRasterPixel({ lng: 0, lat: 0 })).toBeNull();
    });

    it('falls through a topmost legend-less layer to a legendMap layer stacked beneath it', () => {
        // Reported case: goa.atlas.json's semi-transparent "2021-regional-plan"
        // (no legendMap) sitting above "esa-worldcover" (has one) made
        // esa-worldcover permanently uninspectable while both were active -
        // the topmost layer alone shouldn't decide this.
        const regionalPlan = { id: '2021-regional-plan', type: 'tms' };
        const manager = makeManager({ layers: [regionalPlan, WORLDCOVER], pixel: [0, 100, 0, 255] });
        const result = manager._inspectRasterPixel({ lng: 0, lat: 0 });
        expect(result).toMatchObject({ layerId: 'esa-worldcover', featureId: 'Tree cover' });
    });

    it('attributes the hex fallback to the topmost layer when no active legendMap matches', () => {
        const manager = makeManager({ layers: [TRUE_COLOR, WORLDCOVER], pixel: [10, 10, 200, 255] });
        const result = manager._inspectRasterPixel({ lng: 0, lat: 0 });
        expect(result).toMatchObject({ layerId: 'landsat-true-color', featureId: '#0a0ac8' });
    });

    it('still reports a hex fallback for a legend-less overlay even with a basemap active beneath it', () => {
        // world-modis-ndvi (no legendMap) stacked above the mapbox-satellite
        // basemap: a wrong color here (satellite leaking through an NDVI gap)
        // is possible - see docs/API.md's caveat - but silently returning
        // nothing whenever any basemap happens to be active would suppress
        // the feature for the overwhelmingly common case (a basemap active)
        // instead of the narrow one (this specific pixel actually being a
        // transparent gap in the overlay), so this is a deliberate trade-off.
        const ndvi = { id: 'world-modis-ndvi', type: 'tms' };
        const satelliteBasemap = { id: 'mapbox-satellite', type: 'tms', tags: ['basemap', 'satellite'] };
        const manager = makeManager({ layers: [ndvi, satelliteBasemap], pixel: [80, 140, 60, 255] });
        const result = manager._inspectRasterPixel({ lng: 0, lat: 0 });
        expect(result).toMatchObject({ layerId: 'world-modis-ndvi', featureId: '#508c3c' });
    });
});

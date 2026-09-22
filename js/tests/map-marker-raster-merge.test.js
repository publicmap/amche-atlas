// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';

const { MapMarkerManager } = await import('../map-marker-manager.js');

/**
 * A raster layer (e.g. a regional plan overlay) is very often stacked with a
 * vector layer whose fill covers the whole click area (cadastral plots,
 * panchayat boundaries) - so a click there is never "empty" and
 * _handleEmptyMapClick's raster inspection never runs. _handleSelection (the
 * real vector-feature-click path) must merge raster inspection in too - see
 * config/goa.atlas.json's "2021-regional-plan" layer, which sits under
 * always-on "local-body"/"plots" vector fills.
 */
function makeManager({ rasterLayer, pixel }) {
    const manager = Object.create(MapMarkerManager.prototype);
    manager._getAllActiveLayersInInspectorOrder = () => (rasterLayer ? [rasterLayer] : []);

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

    manager._clearHoverMarker = () => {};
    manager._clearAllMarkerHoverStates = () => {};
    manager._clearUnsavedMarkers = () => {};
    manager.addMarker = vi.fn();

    return manager;
}

const PLOTS_FEATURE = {
    layerId: 'plots',
    featureId: '12345',
    feature: { properties: { plot: '12345' } },
    lngLat: { lng: 73.8, lat: 15.5 }
};

describe('MapMarkerManager._handleSelection raster merge', () => {
    it('appends a raster inspection feature alongside a vector feature under the same click', () => {
        const regionalPlan = { id: '2021-regional-plan', type: 'tms' };
        const manager = makeManager({ rasterLayer: regionalPlan, pixel: [200, 120, 40, 255] });

        manager._handleSelection({ selectedFeatures: [PLOTS_FEATURE] });

        expect(manager.addMarker).toHaveBeenCalledTimes(1);
        const [lngLat, features] = manager.addMarker.mock.calls[0];
        expect(lngLat).toBe(PLOTS_FEATURE.lngLat);
        expect(features).toHaveLength(2);
        expect(features[0]).toBe(PLOTS_FEATURE);
        expect(features[1]).toMatchObject({ layerId: '2021-regional-plan', featureId: '#c87828', isRasterInspection: true });
    });

    it('passes the vector feature through unchanged when no raster layer is active', () => {
        const manager = makeManager({ rasterLayer: null, pixel: [0, 0, 0, 0] });

        manager._handleSelection({ selectedFeatures: [PLOTS_FEATURE] });

        const [, features] = manager.addMarker.mock.calls[0];
        expect(features).toEqual([PLOTS_FEATURE]);
    });
});

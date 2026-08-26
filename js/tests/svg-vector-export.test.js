import { describe, it, expect, vi } from 'vitest';
import {
    evaluateExpression,
    getVectorLayers,
    captureVectorLayers,
    hideVectorLayersForRaster,
    buildVectorSVGGroup
} from '../svg-vector-export.js';

describe('evaluateExpression', () => {
    it('returns non-array literals as-is', () => {
        expect(evaluateExpression('black', {})).toBe('black');
        expect(evaluateExpression(5, {})).toBe(5);
    });

    it('treats plain data arrays (not a known operator) as literals', () => {
        expect(evaluateExpression([0, -0.4], {})).toEqual([0, -0.4]);
        expect(evaluateExpression(['Open Sans Bold'], {})).toEqual(['Open Sans Bold']);
    });

    it('evaluates ["get", key] against feature.properties', () => {
        const ctx = { feature: { properties: { name: 'Panjim' } } };
        expect(evaluateExpression(['get', 'name'], ctx)).toBe('Panjim');
    });

    it('evaluates ["feature-state", key]', () => {
        const ctx = { featureState: { selected: true } };
        expect(evaluateExpression(['feature-state', 'selected'], ctx)).toBe(true);
    });

    it('evaluates ["boolean", ...] falling back through non-boolean values', () => {
        const ctx = { featureState: {} };
        const expr = ['boolean', ['feature-state', 'selected'], false];
        expect(evaluateExpression(expr, ctx)).toBe(false);
    });

    it('evaluates ["case", cond, out, ..., fallback]', () => {
        const expr = ['case', ['boolean', ['feature-state', 'selected'], false], 'yellow', 'white'];
        expect(evaluateExpression(expr, { featureState: { selected: true } })).toBe('yellow');
        expect(evaluateExpression(expr, { featureState: {} })).toBe('white');
    });

    it('evaluates ["step", input, base, stop1, out1, ...]', () => {
        const expr = ['step', ['zoom'], '', 7, ['to-string', ['get', 'name']]];
        expect(evaluateExpression(expr, { zoom: 5, feature: { properties: { name: 'X' } } })).toBe('');
        expect(evaluateExpression(expr, { zoom: 10, feature: { properties: { name: 'X' } } })).toBe('X');
    });

    it('linearly interpolates numeric stops by zoom', () => {
        const expr = ['interpolate', ['linear'], ['zoom'], 12, 0.3, 17, 0.5];
        expect(evaluateExpression(expr, { zoom: 12 })).toBeCloseTo(0.3);
        expect(evaluateExpression(expr, { zoom: 17 })).toBeCloseTo(0.5);
        expect(evaluateExpression(expr, { zoom: 14.5 })).toBeCloseTo(0.4);
    });
});

function makeFakeMap({ styleLayers, featureStates = {} } = {}) {
    const paintOverrides = new Map();
    const layoutOverrides = new Map();

    return {
        _paintOverrides: paintOverrides,
        _layoutOverrides: layoutOverrides,
        getStyle: () => ({ layers: styleLayers }),
        getPaintProperty: vi.fn((layerId, prop) => {
            const key = `${layerId}.${prop}`;
            if (paintOverrides.has(key)) return paintOverrides.get(key);
            const layer = styleLayers.find(l => l.id === layerId);
            return layer && layer.paint ? layer.paint[prop] : undefined;
        }),
        setPaintProperty: vi.fn((layerId, prop, value) => {
            paintOverrides.set(`${layerId}.${prop}`, value);
        }),
        getLayoutProperty: vi.fn((layerId, prop) => {
            const key = `${layerId}.${prop}`;
            if (layoutOverrides.has(key)) return layoutOverrides.get(key);
            const layer = styleLayers.find(l => l.id === layerId);
            return layer && layer.layout ? layer.layout[prop] : undefined;
        }),
        setLayoutProperty: vi.fn((layerId, prop, value) => {
            layoutOverrides.set(`${layerId}.${prop}`, value);
        }),
        getZoom: () => 15,
        getFeatureState: vi.fn(({ id }) => featureStates[id] || {}),
        queryRenderedFeatures: vi.fn(({ layers }) => {
            const layer = styleLayers.find(l => l.id === layers[0]);
            return (layer && layer.__features) || [];
        }),
        project: ([lng, lat]) => ({ x: lng * 10, y: lat * 10 })
    };
}

describe('getVectorLayers', () => {
    it('keeps only fill/line/circle/symbol layers among the active ids', () => {
        const map = makeFakeMap({
            styleLayers: [
                { id: 'basemap', type: 'raster' },
                { id: 'parcels', type: 'fill' },
                { id: 'roads', type: 'line' },
                { id: 'not-active', type: 'circle' }
            ]
        });
        const result = getVectorLayers(map, new Set(['parcels', 'roads', 'basemap']));
        expect(result.map(l => l.id)).toEqual(['parcels', 'roads']);
    });
});

describe('captureVectorLayers / hideVectorLayersForRaster', () => {
    it('drops layers with no rendered features and truncates oversized ones', () => {
        const layers = [
            { id: 'empty', type: 'fill', __features: [] },
            { id: 'small', type: 'fill', __features: [{ type: 'Feature', geometry: null }] }
        ];
        const map = makeFakeMap({ styleLayers: layers });
        const captured = captureVectorLayers(map, layers);
        expect(captured.map(c => c.layer.id)).toEqual(['small']);
    });

    it('hides fill/line/circle layers and only mutes text for symbol layers, then restores', () => {
        const layers = [
            { id: 'parcels', type: 'fill', __features: [{ geometry: null }] },
            { id: 'labels', type: 'symbol', __features: [{ geometry: null }] }
        ];
        const map = makeFakeMap({ styleLayers: layers });
        const captured = captureVectorLayers(map, layers);

        const restore = hideVectorLayersForRaster(map, captured);
        expect(map.setLayoutProperty).toHaveBeenCalledWith('parcels', 'visibility', 'none');
        expect(map.setPaintProperty).toHaveBeenCalledWith('labels', 'text-opacity', 0);

        restore();
        expect(map.setLayoutProperty).toHaveBeenCalledWith('parcels', 'visibility', undefined);
        expect(map.setPaintProperty).toHaveBeenCalledWith('labels', 'text-opacity', undefined);
    });
});

describe('buildVectorSVGGroup', () => {
    it('renders a fill polygon as a real <path> using the evaluated paint color', () => {
        const layer = {
            id: 'parcels',
            type: 'fill',
            source: 'parcels-src',
            paint: { 'fill-color': '#ff0000', 'fill-opacity': 0.5 },
            __features: [{
                type: 'Feature',
                id: 1,
                properties: {},
                geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
            }]
        };
        const map = makeFakeMap({ styleLayers: [layer] });
        const captured = captureVectorLayers(map, [layer]);
        const svg = buildVectorSVGGroup(map, captured, 1);

        expect(svg).toContain('<path');
        expect(svg).toContain('fill="#ff0000"');
        expect(svg).toContain('fill-opacity="0.5"');
        expect(svg).toContain('data-layer-id="parcels"');
    });

    it('renders a symbol layer text-field as a real <text> element', () => {
        const layer = {
            id: 'labels',
            type: 'symbol',
            source: 'points-src',
            layout: { 'text-field': ['get', 'name'], 'text-size': 12 },
            paint: { 'text-color': '#000000' },
            __features: [{
                type: 'Feature',
                id: 2,
                properties: { name: 'Panjim' },
                geometry: { type: 'Point', coordinates: [5, 5] }
            }]
        };
        const map = makeFakeMap({ styleLayers: [layer] });
        const captured = captureVectorLayers(map, [layer]);
        const svg = buildVectorSVGGroup(map, captured, 1);

        expect(svg).toContain('<text');
        expect(svg).toContain('Panjim');
    });

    it('renders a line layer applied to Polygon geometry as an unfilled outline path', () => {
        // Mapbox 'line' layers are routinely used to stroke a polygon's ring
        // boundaries (e.g. an administrative-boundary outline drawn over the
        // same source as its fill) — the feature geometry is Polygon, not
        // LineString. This must not be silently dropped.
        const layer = {
            id: 'ward-outline',
            type: 'line',
            source: 'wards-src',
            paint: { 'line-color': '#ae1e8f', 'line-width': 2 },
            __features: [{
                type: 'Feature',
                id: 10,
                properties: {},
                geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }
            }]
        };
        const map = makeFakeMap({ styleLayers: [layer] });
        const captured = captureVectorLayers(map, [layer]);
        const svg = buildVectorSVGGroup(map, captured, 1);

        expect(svg).toContain('<path');
        expect(svg).toContain('fill="none"');
        expect(svg).toContain('stroke="#ae1e8f"');
        expect(svg).toContain('data-layer-id="ward-outline"');
    });

    it('labels a Polygon-geometry symbol layer at the polygon centroid', () => {
        // A symbol layer applied to Polygon/LineString data (e.g. a
        // ward-boundary label) places one label at a representative point,
        // not one per vertex — there is no Point feature to project.
        const layer = {
            id: 'ward-label',
            type: 'symbol',
            source: 'wards-src',
            layout: { 'text-field': ['get', 'name'], 'text-size': 12 },
            __features: [{
                type: 'Feature',
                id: 11,
                properties: { name: 'Ward 12' },
                geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }
            }]
        };
        const map = makeFakeMap({ styleLayers: [layer] });
        const captured = captureVectorLayers(map, [layer]);
        const svg = buildVectorSVGGroup(map, captured, 1);

        expect(svg).toContain('<text');
        expect(svg).toContain('Ward 12');
        // Centroid of the square is (1,1); the fake projection is lng*10,lat*10.
        expect(svg).toContain('x="10"');
    });

    it('skips symbol features whose text-field evaluates to an empty string', () => {
        const layer = {
            id: 'labels',
            type: 'symbol',
            source: 'points-src',
            layout: { 'text-field': ['step', ['zoom'], '', 20, ['get', 'name']] },
            __features: [{
                type: 'Feature',
                id: 3,
                properties: { name: 'Hidden at this zoom' },
                geometry: { type: 'Point', coordinates: [5, 5] }
            }]
        };
        const map = makeFakeMap({ styleLayers: [layer] });
        const captured = captureVectorLayers(map, [layer]);
        const svg = buildVectorSVGGroup(map, captured, 1);

        expect(svg).not.toContain('<text');
    });
});

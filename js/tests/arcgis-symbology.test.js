import { describe, it, expect } from 'vitest';
import { drawingInfoToStyle, esriColor, scaleToZoom } from '../arcgis-symbology.js';
import { parseSymbology } from '../style-expressions.js';
import { ArcgisAPI } from '../arcgis-url-api.js';
import { vi } from 'vitest';

const fillSymbol = (color, outline = { color: [0, 0, 0, 255], width: 0.75, style: 'esriSLSSolid' }, style = 'esriSFSSolid') =>
    ({ type: 'esriSFS', style, color, outline });

describe('esriColor', () => {
    it('writes opaque colours as hex and partial alpha as rgba', () => {
        expect(esriColor([255, 0, 128, 255])).toBe('#ff0080');
        expect(esriColor([255, 255, 255, 0])).toBe('rgba(255, 255, 255, 0)');
        expect(esriColor([0, 0, 0, 128])).toBe('rgba(0, 0, 0, 0.5)');
        expect(esriColor(null)).toBeNull();
    });
});

describe('simple renderer', () => {
    it('converts a polygon symbol, keeping the dashed outline and layer transparency', () => {
        const result = drawingInfoToStyle({
            transparency: 25,
            renderer: { type: 'simple', symbol: fillSymbol([0, 0, 0, 0], { color: [0, 38, 115, 255], width: 1.5, style: 'esriSLSDashDot' }) }
        }, 'esriGeometryPolygon');

        expect(result.style).toMatchObject({
            'fill-color': 'rgba(0, 0, 0, 0)', 'line-color': '#002673', 'line-width': 2,
            'line-dasharray': [4, 2, 1, 2], 'fill-opacity': 0.75
        });
        expect(result.summary).toBe('Single symbol');
        expect(result.warnings).toEqual([]);
    });

    it('converts line and point symbols to their own properties', () => {
        const line = drawingInfoToStyle({ renderer: { type: 'simple', symbol: { type: 'esriSLS', style: 'esriSLSDash', color: [255, 0, 0, 255], width: 3 } } }, 'esriGeometryPolyline');
        expect(line.style).toMatchObject({ 'line-color': '#ff0000', 'line-width': 4, 'line-dasharray': [4, 3] });
        expect(line.style['fill-color']).toBeUndefined();

        const point = drawingInfoToStyle({ renderer: { type: 'simple', symbol: { type: 'esriSMS', style: 'esriSMSCircle', color: [0, 128, 0, 255], size: 9, outline: { color: [255, 255, 255, 255], width: 1 } } } }, 'esriGeometryPoint');
        expect(point.style).toMatchObject({ 'circle-color': '#008000', 'circle-radius': 6, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 });
    });
});

describe('uniqueValue renderer', () => {
    const drawingInfo = {
        renderer: {
            type: 'uniqueValue', field1: 'use_zones',
            uniqueValueInfos: [
                { value: 'R', symbol: fillSymbol([245, 158, 11, 255]) },
                { value: 'C', symbol: fillSymbol([59, 130, 246, 255]) },
                { value: 'H', symbol: { ...fillSymbol([0, 0, 0, 255]), type: 'esriPFS' } }
            ],
            defaultSymbol: fillSymbol([200, 200, 200, 255])
        }
    };

    it('builds a match per property, with the default symbol as the fallback', () => {
        const { style, summary, warnings } = drawingInfoToStyle(drawingInfo, 'esriGeometryPolygon');
        expect(style['fill-color']).toEqual(['match', ['to-string', ['get', 'use_zones']], 'R', '#f59e0b', 'C', '#3b82f6', 'H', '#000000', '#c8c8c8']);
        // identical outlines across classes stay a plain literal
        expect(style['line-color']).toBe('#000000');
        expect(summary).toBe('Unique values on use_zones (3 categories)');
        expect(warnings).toEqual(['picture fills are drawn as a flat colour']);
    });

    it('opens in the style editor\'s categorized mode', () => {
        const { style } = drawingInfoToStyle(drawingInfo, 'esriGeometryPolygon');
        expect(parseSymbology(style['fill-color'])).toMatchObject({ mode: 'categorized', field: 'use_zones', fallback: '#c8c8c8' });
    });

    it('draws nothing for unmatched features when there is no default symbol', () => {
        const noDefault = { renderer: { ...drawingInfo.renderer, defaultSymbol: null } };
        const { style } = drawingInfoToStyle(noDefault, 'esriGeometryPolygon');
        expect(style['fill-color'].at(-1)).toBe('rgba(0, 0, 0, 0)');
    });

    it('matches on the joined text when the renderer uses several fields', () => {
        const multi = { renderer: { type: 'uniqueValue', field1: 'a', field2: 'b', fieldDelimiter: '|', uniqueValueInfos: [{ value: 'x|y', symbol: fillSymbol([1, 2, 3, 255]) }, { value: 'p|q', symbol: fillSymbol([9, 8, 7, 255]) }] } };
        const { style } = drawingInfoToStyle(multi, 'esriGeometryPolygon');
        expect(style['fill-color'][1]).toEqual(['concat', ['to-string', ['get', 'a']], '|', ['to-string', ['get', 'b']]]);
    });
});

describe('classBreaks renderer', () => {
    it('builds stepped classes on the field', () => {
        const { style, summary } = drawingInfoToStyle({
            renderer: {
                type: 'classBreaks', field: 'area',
                classBreakInfos: [
                    { classMaxValue: 10, symbol: fillSymbol([255, 255, 178, 255]) },
                    { classMaxValue: 50, symbol: fillSymbol([253, 141, 60, 255]) },
                    { classMaxValue: 100, symbol: fillSymbol([189, 0, 38, 255]) }
                ]
            }
        }, 'esriGeometryPolygon');

        expect(style['fill-color'][2]).toEqual(['step', ['get', 'area'], '#ffffb2', 10, '#fd8d3c', 50, '#bd0026']);
        expect(parseSymbology(style['fill-color'])).toMatchObject({ mode: 'graduated', kind: 'step', field: 'area' });
        expect(summary).toBe('Graduated on area (3 classes)');
    });
});

describe('everything else', () => {
    it('reports unsupported renderers instead of guessing', () => {
        const result = drawingInfoToStyle({ renderer: { type: 'heatmap' } }, 'esriGeometryPoint');
        expect(result.style).toBeNull();
        expect(result.warnings[0]).toContain('heatmap');
        expect(drawingInfoToStyle(undefined, 'esriGeometryPoint')).toBeNull();
    });

    it('carries over a simple label field and the scale range as zoom levels', () => {
        const result = drawingInfoToStyle({
            renderer: { type: 'simple', symbol: fillSymbol([0, 0, 0, 255]) },
            labelingInfo: [{ labelExpression: '[zone]', symbol: { color: [0, 0, 0, 255], font: { size: 9 } } }]
        }, 'esriGeometryPolygon', { minScale: 591657550.5 / 2 ** 10, maxScale: 591657550.5 / 2 ** 16 });

        expect(result.style['text-field']).toEqual(['to-string', ['get', 'zone']]);
        expect(result.style['text-size']).toBe(12);
        expect(result.minzoom).toBe(10);
        expect(result.maxzoom).toBe(16);
        expect(scaleToZoom(591657550.5)).toBe(0);
    });
});

describe('ArcgisAPI.describeLayer', () => {
    const LAYER = 'https://gis.example.org/server/rest/services/Hosted/PLAN/FeatureServer/9';
    function mock() {
        global.fetch = vi.fn(async (input) => {
            const url = String(input);
            const body = url.includes('returnCountOnly') ? { count: 12 }
                : url.includes('returnExtentOnly') ? {}
                    : {
                        name: 'LANDUSE', type: 'Feature Layer', geometryType: 'esriGeometryPolygon', maxRecordCount: 2000,
                        objectIdField: 'fid', fields: [{ name: 'fid' }, { name: 'use_zones' }],
                        drawingInfo: { renderer: { type: 'uniqueValue', field1: 'use_zones', uniqueValueInfos: [{ value: 'R', symbol: fillSymbol([245, 158, 11, 255]) }, { value: 'C', symbol: fillSymbol([59, 130, 246, 255]) }] } }
                    };
            return { ok: true, json: async () => body };
        });
    }

    it('puts the service style on the config, and leaves it off when asked', async () => {
        mock();
        const inherited = await ArcgisAPI.describeLayer(LAYER);
        expect(inherited.config.style['fill-color'][0]).toBe('match');
        expect(inherited.styleInfo.summary).toContain('Unique values');

        const plain = await ArcgisAPI.describeLayer(LAYER, { inheritStyle: false });
        expect(plain.config.style).toBeUndefined();
        expect(plain.styleInfo.style).toBeTruthy();
    });

    it('does not inherit style for raster output, which the server already draws', async () => {
        mock();
        const raster = await ArcgisAPI.describeLayer('https://gis.example.org/server/rest/services/M/MapServer/3', { output: 'raster' });
        expect(raster.config.style).toBeUndefined();
        expect(raster.styleInfo).toBeNull();
    });
});

describe('hatch fills', () => {
    const hatch = (style) => ({ type: 'esriSFS', style, color: [0, 0, 0, 255], outline: { color: [0, 0, 0, 255], width: 1, style: 'esriSLSSolid' } });
    const solid = (color) => ({ type: 'esriSFS', style: 'esriSFSSolid', color, outline: { color: [0, 0, 0, 255], width: 1, style: 'esriSLSSolid' } });
    const drawingInfo = {
        renderer: {
            type: 'uniqueValue', field1: 'use_zones',
            uniqueValueInfos: [
                { value: 'R', symbol: solid([245, 158, 11, 255]) },
                { value: 'G1', symbol: hatch('esriSFSForwardDiagonal') },
                { value: 'G2', symbol: hatch('esriSFSDiagonalCross') }
            ]
        }
    };

    it('leaves hatched classes transparent in the plain fill and draws them in a filtered overlay', () => {
        const { style, warnings } = drawingInfoToStyle(drawingInfo, 'esriGeometryPolygon');
        const input = ['to-string', ['get', 'use_zones']];

        expect(style['fill-color']).toEqual(['match', input, 'R', '#f59e0b', 'G1', 'rgba(0, 0, 0, 0)', 'G2', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
        expect(style['hatch/filter']).toEqual(['in', input, ['literal', ['G1', 'G2']]]);
        expect(style['hatch/fill-pattern']).toEqual(['match', input,
            'G1', 'hatch|forward-diagonal|#000000|8|1', 'G2', 'hatch|diagonal-cross|#000000|8|1', 'hatch|forward-diagonal|#000000|8|1']);
        expect(style['hatch/fill-opacity']).toBe(1);
        expect(warnings).toEqual([]);
    });

    it('puts the overlay keys first so the renderer stacks the hatch above the fill', () => {
        const { style } = drawingInfoToStyle(drawingInfo, 'esriGeometryPolygon');
        const keys = Object.keys(style);
        expect(keys.indexOf('hatch/filter')).toBeLessThan(keys.indexOf('fill-color'));
    });

    it('uses fill-pattern directly for a simple hatched symbol', () => {
        const { style } = drawingInfoToStyle({ renderer: { type: 'simple', symbol: hatch('esriSFSCross') } }, 'esriGeometryPolygon');
        expect(style['fill-pattern']).toBe('hatch|cross|#000000|8|1');
        expect(style['fill-color']).toBe('rgba(0, 0, 0, 0)');
        expect(style['hatch/filter']).toBeUndefined();
    });

    it('filters and patterns graduated classes by step', () => {
        const info = { renderer: { type: 'classBreaks', field: 'area', classBreakInfos: [
            { classMaxValue: 10, symbol: solid([255, 255, 255, 255]) },
            { classMaxValue: 20, symbol: hatch('esriSFSHorizontal') },
            { classMaxValue: 30, symbol: solid([0, 0, 0, 255]) }
        ] } };
        const { style } = drawingInfoToStyle(info, 'esriGeometryPolygon');
        const pattern = 'hatch|horizontal|#000000|8|1';
        expect(style['hatch/filter'][2]).toEqual(['==', ['step', ['get', 'area'], 0, 10, 1, 20, 0], 1]);
        expect(style['hatch/fill-pattern']).toEqual(['step', ['get', 'area'], pattern, 10, pattern, 20, pattern]);
    });

    it('adds no overlay when nothing is hatched', () => {
        const { style } = drawingInfoToStyle({ renderer: { type: 'simple', symbol: solid([1, 2, 3, 255]) } }, 'esriGeometryPolygon');
        expect(Object.keys(style).some(k => k.startsWith('hatch/'))).toBe(false);
    });
});

import { describe, it, expect } from 'vitest';
import {
    emptyCollection, tableColumns, defaultProperties, addFeature, removeFeature, removeColumn, addColumn,
    setProperty, parseCellValue, roundGeometry, compactCollection, inlineSize, geometryBbox, geometryKind
} from '../feature-table-data.js';
import { drawStep, sketchGeometry } from '../feature-draw.js';
import { linkLengthWith } from '../creator-feature-share.js';
import { copyConfig } from '../creator-feature-copy.js';

const point = (x, y) => ({ type: 'Point', coordinates: [x, y] });
const line = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };

describe('defaultProperties', () => {
    it('numbers the first feature of each kind', () => {
        const collection = emptyCollection();
        expect(defaultProperties(collection, 'Point')).toEqual({ fid: 1, $rowid: 1, name: 'Point 1' });
        addFeature(collection, point(0, 0), defaultProperties(collection, 'Point'));
        expect(defaultProperties(collection, 'LineString')).toEqual({ fid: 2, $rowid: 2, name: 'Line 1' });
        addFeature(collection, line, defaultProperties(collection, 'LineString'));
        expect(defaultProperties(collection, 'Point')).toEqual({ fid: 3, $rowid: 3, name: 'Point 2' });
        expect(defaultProperties(collection, 'Polygon').name).toBe('Area 1');
    });

    it('keeps a removed default column removed', () => {
        const collection = emptyCollection();
        addFeature(collection, point(0, 0), defaultProperties(collection, 'Point'));
        removeColumn(collection, '$rowid');
        expect(defaultProperties(collection, 'Point')).toEqual({ fid: 2, name: 'Point 2' });
    });

    it('continues past the highest fid', () => {
        const collection = emptyCollection();
        addFeature(collection, point(0, 0), { fid: 7 });
        expect(defaultProperties(collection, 'Point').fid).toBe(8);
    });
});

describe('table edits', () => {
    it('lists columns in the order first seen', () => {
        const collection = emptyCollection();
        addFeature(collection, point(0, 0), { a: 1, b: 2 });
        addFeature(collection, point(1, 1), { c: 3, a: 4 });
        expect(tableColumns(collection)).toEqual(['a', 'b', 'c']);
    });

    it('renumbers $rowid when a row is deleted', () => {
        const collection = emptyCollection();
        [0, 1, 2].forEach(i => addFeature(collection, point(i, i), { $rowid: i + 1, name: `p${i}` }));
        removeFeature(collection, 0);
        expect(collection.features.map(f => [f.properties.$rowid, f.properties.name])).toEqual([[1, 'p1'], [2, 'p2']]);
    });

    it('adds and removes a column on every feature', () => {
        const collection = emptyCollection();
        addFeature(collection, point(0, 0), { name: 'a' });
        addFeature(collection, point(1, 1), { name: 'b', note: 'x' });
        addColumn(collection, 'note');
        expect(collection.features.map(f => f.properties.note)).toEqual(['', 'x']);
        removeColumn(collection, 'name');
        expect(tableColumns(collection)).toEqual(['note']);
    });

    it('sets one value', () => {
        const collection = emptyCollection();
        addFeature(collection, point(0, 0), { name: 'a' });
        setProperty(collection, 0, 'name', 'b');
        expect(collection.features[0].properties.name).toBe('b');
    });

    it('keeps a number or boolean column typed', () => {
        expect(parseCellValue('12', 3)).toBe(12);
        expect(parseCellValue('twelve', 3)).toBe('twelve');
        expect(parseCellValue('', 3)).toBe('');
        expect(parseCellValue('False', true)).toBe(false);
        expect(parseCellValue('12', 'x')).toBe('12');
        expect(parseCellValue('[1,2]', [0])).toEqual([1, 2]);
    });
});

describe('geometry', () => {
    it('rounds coordinates to 6 decimals', () => {
        expect(roundGeometry({ type: 'Polygon', coordinates: [[[73.123456789, 15.1], [1, 2], [3, 4.0000004]]] }).coordinates)
            .toEqual([[[73.123457, 15.1], [1, 2], [3, 4]]]);
    });

    it('compacts a collection for the link', () => {
        const compact = compactCollection({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { a: 1 }, geometry: point(1.23456789, 2) }] });
        expect(compact.features[0]).toEqual({ type: 'Feature', properties: { a: 1 }, geometry: point(1.234568, 2) });
    });

    it('measures a bbox', () => {
        expect(geometryBbox(line)).toEqual([0, 0, 1, 1]);
        expect(geometryBbox(point(5, 6))).toEqual([5, 6, 5, 6]);
        expect(geometryBbox(null)).toBeNull();
    });

    it('names geometry kinds', () => {
        expect(geometryKind('MultiPolygon')).toBe('Area');
        expect(geometryKind('Unknown')).toBe('Feature');
    });
});

describe('drawing clicks', () => {
    it('makes a point by clicking the only vertex again', () => {
        expect(drawStep(0, -1)).toBe('add');
        expect(drawStep(1, 0)).toBe('point');
    });

    it('ends a line on its last vertex and closes an area on its first', () => {
        expect(drawStep(2, 1)).toBe('line');
        expect(drawStep(2, 0)).toBe('ignore');
        expect(drawStep(3, 0)).toBe('area');
        expect(drawStep(3, 2)).toBe('line');
        expect(drawStep(4, 1)).toBe('ignore');
    });

    it('builds each geometry', () => {
        const v = [[0, 0], [1, 0], [1, 1]];
        expect(sketchGeometry('point', [[2, 3]])).toEqual(point(2, 3));
        expect(sketchGeometry('line', v)).toEqual({ type: 'LineString', coordinates: v });
        expect(sketchGeometry('area', v)).toEqual({ type: 'Polygon', coordinates: [[...v, [0, 0]]] });
    });
});

describe('shareable', () => {
    it('counts the link without the layer\'s own entry, then with its data', () => {
        const collection = emptyCollection();
        addFeature(collection, point(1, 2), { name: 'a' });
        const config = { id: 'drawn', type: 'geojson' };
        const usage = { length: 1000, entries: [{ id: 'drawn', size: 100 }] };
        expect(linkLengthWith(config, collection, usage)).toBe(900 + inlineSize({ ...config, data: compactCollection(collection) }) + 1);
    });

    it('gives up on data far too large for a link', () => {
        const collection = emptyCollection();
        for (let i = 0; i < 5000; i++) addFeature(collection, point(i, i), { name: `feature ${i}` });
        expect(linkLengthWith({ id: 'x' }, collection, { length: 0, entries: [] })).toBe(Infinity);
    });
});

describe('editable copy', () => {
    it('keeps settings and style, drops the source', () => {
        const copy = copyConfig({ id: 'roads', title: 'Roads', type: 'vector', url: 'https://x/{z}/{x}/{y}.pbf', sourceLayer: 'r', style: { 'line-color': 'red' }, _sourceAtlas: 'goa' }, 'roads-copy');
        expect(copy).toEqual({ id: 'roads-copy', title: 'Roads (copy)', type: 'geojson', style: { 'line-color': 'red' } });
    });
});

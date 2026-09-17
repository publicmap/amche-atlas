// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { URLManager } from '../url-manager.js';

// layerToURL is the only thing under test here; URLManager's constructor wires
// up history/jQuery listeners a plain serialization test has no use for.
const layerToURL = (layer) => URLManager.prototype.layerToURL.call({}, layer);

describe('URLManager.layerToURL', () => {
    it('serializes a plain registry layer as its id', () => {
        expect(layerToURL({ id: 'forests', _normalizedId: 'forests' })).toBe('forests');
    });

    it('leaves preset-owned definition fields out of the URL', () => {
        expect(layerToURL({
            id: 'forests',
            _normalizedId: 'forests',
            title: 'Forests',
            type: 'vector',
            style: { 'fill-color': '#00ff00' },
            opacity: 0.5
        })).toBe(JSON.stringify({ id: 'forests', opacity: 0.5 }));
    });

    it('carries the fields an edit marked as diverging from the preset', () => {
        const serialized = layerToURL({
            id: 'forests',
            _normalizedId: 'forests',
            _editedFields: ['style', 'title'],
            title: 'My Forests',
            type: 'vector',
            style: { 'fill-color': '#00ff00' }
        });

        expect(JSON.parse(serialized)).toEqual({
            id: 'forests',
            title: 'My Forests',
            style: { 'fill-color': '#00ff00' }
        });
    });

    it('never leaks internal bookkeeping fields', () => {
        const serialized = layerToURL({
            id: 'forests',
            _normalizedId: 'forests',
            _sourceAtlas: 'goa',
            _editedFields: ['style'],
            _prefixedId: 'goa-forests',
            style: { 'line-width': 2 }
        });

        expect(serialized).not.toContain('_');
    });

    it('returns a custom layer\'s original JSON untouched when nothing diverges', () => {
        const original = "{'id':'custom','type':'geojson','url':'a.geojson'}";
        expect(layerToURL({ id: 'custom', _originalJson: original })).toBe(original);
    });

    it('merges edited fields into a custom layer\'s original JSON', () => {
        const serialized = layerToURL({
            id: 'custom',
            _originalJson: "{'id':'custom','type':'geojson','url':'a.geojson','title':'Old'}",
            _editedFields: ['title', 'style'],
            title: 'New',
            style: { 'circle-radius': 6 },
            opacity: 1
        });

        expect(JSON.parse(serialized.replace(/'/g, '"'))).toEqual({
            id: 'custom',
            type: 'geojson',
            url: 'a.geojson',
            title: 'New',
            style: { 'circle-radius': 6 }
        });
    });

    it('keeps a dynamic-layer shorthand as an object form when something diverges', () => {
        const serialized = layerToURL({
            id: 'relation/123',
            _originalJson: 'osm:relation/123',
            _editedFields: ['style'],
            style: { 'line-color': '#ff0000' },
            opacity: 1
        });

        expect(JSON.parse(serialized).style).toEqual({ 'line-color': '#ff0000' });
    });
});

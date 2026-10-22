import { describe, it, expect, vi } from 'vitest';
import { drapeSafeBeforeId, keepDrapedLayersBelow } from '../maplibre-drape-order.js';

const layer = (id, type, groupId) => ({ id, type, metadata: groupId ? { groupId } : undefined });

const STACK = [
    layer('roads-fill', 'fill', 'roads'),
    layer('roads-line', 'line', 'roads'),
    layer('pois-fill', 'fill', 'pois'),
    layer('roads-label', 'symbol', 'roads'),
    layer('buildings', 'fill-extrusion', 'buildings'),
    layer('pois-label', 'symbol', 'pois')
];

describe('drapeSafeBeforeId', () => {
    it('puts a draped layer added on top just under the labels', () => {
        expect(drapeSafeBeforeId(STACK, 'line', undefined)).toBe('roads-label');
    });

    it('appends a label added on top', () => {
        expect(drapeSafeBeforeId(STACK, 'symbol', undefined)).toBeUndefined();
    });

    it('keeps a draped layer placed among the draped layers where asked', () => {
        expect(drapeSafeBeforeId(STACK, 'fill', 'roads-line')).toBe('roads-line');
    });

    it('puts a draped layer asked to go under a label under that label\'s map', () => {
        expect(drapeSafeBeforeId(STACK, 'fill', 'pois-label')).toBe('pois-fill');
    });

    it('falls back to the top of the draped layers when that map has none', () => {
        expect(drapeSafeBeforeId(STACK, 'fill', 'buildings')).toBe('roads-label');
    });

    it('lifts a label asked to go among the draped layers to the bottom of the labels', () => {
        expect(drapeSafeBeforeId(STACK, 'symbol', 'roads-line')).toBe('roads-label');
    });

    it('keeps a label placed among the labels where asked', () => {
        expect(drapeSafeBeforeId(STACK, 'circle', 'pois-label')).toBe('pois-label');
    });

    it('appends anything to a stack with no labels yet', () => {
        expect(drapeSafeBeforeId(STACK.slice(0, 3), 'fill', undefined)).toBeUndefined();
    });
});

describe('keepDrapedLayersBelow', () => {
    it('routes addLayer and moveLayer through the drape-safe position', () => {
        const added = [], moved = [];
        const map = {
            getStyle: () => ({ layers: STACK }),
            getLayer: (id) => STACK.find(l => l.id === id),
            addLayer: vi.fn((l, before) => added.push([l.id, before])),
            moveLayer: vi.fn((id, before) => moved.push([id, before]))
        };
        keepDrapedLayersBelow(map);
        map.addLayer(layer('water', 'fill', 'water'));
        map.moveLayer('roads-line');
        expect(added).toEqual([['water', 'roads-label']]);
        expect(moved).toEqual([['roads-line', 'roads-label']]);
    });
});

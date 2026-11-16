// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { activeMapHistory, keepPlaces } from '../active-map-history.js';

describe('keepPlaces', () => {
    it('keeps a map turned off in its place', () => {
        expect(keepPlaces(['a', 'c'], ['b'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('fills the other places in stack order', () => {
        expect(keepPlaces(['c', 'a'], ['b'], ['a', 'b', 'c'])).toEqual(['c', 'b', 'a']);
    });

    it('puts a map off that was never placed last', () => {
        expect(keepPlaces(['a', 'b'], ['z'], ['a', 'b'])).toEqual(['a', 'b', 'z']);
    });

    it('keeps places when a new map comes on', () => {
        expect(keepPlaces(['n', 'a', 'c'], ['b'], ['a', 'b', 'c'])).toEqual(['n', 'b', 'a', 'c']);
    });

    it('clamps a place past the end of a shorter list', () => {
        expect(keepPlaces([], ['x', 'y'], ['a', 'b', 'c', 'x', 'y'])).toEqual(['x', 'y']);
    });
});

describe('activeMapHistory', () => {
    beforeEach(() => {
        localStorage.clear();
        activeMapHistory.reload();
    });

    it('adds maps once, after the rest, per atlas', () => {
        activeMapHistory.add('goa', ['a', 'b']);
        activeMapHistory.add('goa', ['b', 'c']);
        activeMapHistory.add('index', ['z']);
        expect(activeMapHistory.list('goa')).toEqual(['a', 'b', 'c']);
        expect(activeMapHistory.list('index')).toEqual(['z']);
    });

    it('keeps the order shown, and the maps not shown after it', () => {
        activeMapHistory.add('goa', ['a', 'b', 'c']);
        activeMapHistory.setOrder('goa', ['c', 'a']);
        expect(activeMapHistory.list('goa')).toEqual(['c', 'a', 'b']);
    });

    it('survives a reload from storage', () => {
        activeMapHistory.add('goa', ['a']);
        activeMapHistory.reload();
        expect(activeMapHistory.list('goa')).toEqual(['a']);
    });

    it('removes a map and tells its listeners', () => {
        const removed = [];
        const off = activeMapHistory.onRemove((atlasId, id) => removed.push([atlasId, id]));
        activeMapHistory.add('goa', ['a', 'b']);
        activeMapHistory.remove('goa', 'a');
        off();
        expect(activeMapHistory.list('goa')).toEqual(['b']);
        expect(removed).toEqual([['goa', 'a']]);
    });

    it('reads a broken store as empty', () => {
        localStorage.setItem('amche-active-map-history', '{oops');
        activeMapHistory.reload();
        expect(activeMapHistory.list('goa')).toEqual([]);
    });
});

describe('activeMapHistory configs', () => {
    beforeEach(() => {
        localStorage.clear();
        activeMapHistory.reload();
    });

    it('keeps a layer config as plain data, and drops it with the map', () => {
        activeMapHistory.add('goa', ['mapwarper-1']);
        activeMapHistory.keepConfig('goa', { id: 'mapwarper-1', type: 'tms', url: 'x/{z}', _originalJson: '{}', onLoad: () => {} });
        activeMapHistory.reload();
        expect(activeMapHistory.config('mapwarper-1', 'goa')).toEqual({ id: 'mapwarper-1', type: 'tms', url: 'x/{z}' });
        expect(activeMapHistory.config('mapwarper-1')).not.toBeNull();
        activeMapHistory.remove('goa', 'mapwarper-1');
        expect(activeMapHistory.config('mapwarper-1')).toBeNull();
    });

    it('skips a config too big to keep', () => {
        activeMapHistory.keepConfig('goa', { id: 'big', data: 'x'.repeat(300000) });
        expect(activeMapHistory.config('big')).toBeNull();
    });
});

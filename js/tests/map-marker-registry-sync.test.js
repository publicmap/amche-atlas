// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { MapMarkerManager } = await import('../map-marker-manager.js');
const markerRegistry = await import('../marker-registry.js');

/**
 * `?markers=` is serialized from the marker registry, not from the live markers
 * (see url-manager.js's buildMarkersParam call) - so any teardown that drops a
 * marker without freeing its registry entry silently grows the shared URL.
 * These cover the three paths that tear a marker down.
 */
function makeManager() {
    const manager = Object.create(MapMarkerManager.prototype);
    manager._markers = new Map();
    manager._currentMarkerIndex = 0;
    manager._selectedMarkerId = null;
    manager._pointerOverMarker = false;
    // Screen space == degrees * 1000, so "same point" really is the same point.
    manager._map = { project: ({ lng, lat }) => ({ x: lng * 1000, y: lat * 1000 }) };
    manager._deselectMarkerBadges = () => {};
    manager._updateSelectionLayer = () => {};
    manager._sortFeaturesByInspectorOrder = (f) => f;
    manager._adoptedIdentity = null;
    manager._stateManager = { _suppressClickUntil: 0 };
    return manager;
}

function addFakeMarker(manager, id, urlId, lngLat) {
    const el = document.createElement('div');
    el.innerHTML = '<button class="marker-id-badge"><span class="marker-id-text"></span></button><input class="marker-id-input">';
    manager._markers.set(id, {
        id, urlId, lngLat, features: [],
        marker: { remove: vi.fn(), getElement: () => el }
    });
    markerRegistry.set(urlId, { id: urlId, lng: lngLat.lng, lat: lngLat.lat, name: '', description: '' });
    return el;
}

const POINT = { lng: 73.802027, lat: 15.613229 };

describe('marker registry stays in step with the live markers', () => {
    beforeEach(() => markerRegistry.setAll([]));

    describe('clearAllMarkers', () => {
        it('frees every id it tears down', () => {
            const manager = makeManager();
            addFakeMarker(manager, 'a', '1', POINT);
            addFakeMarker(manager, 'b', '2', POINT);
            expect(markerRegistry.allIds()).toEqual(['1', '2']);

            manager.clearAllMarkers();

            // Left behind, these would reappear as phantom `?markers=` entries.
            expect(markerRegistry.allIds()).toEqual([]);
            expect(manager._markers.size).toBe(0);
        });
    });

    describe('_upsertStreamingMarkerVisual', () => {
        it('keeps the marker id across a rebuild instead of taking a new one', () => {
            const manager = makeManager();
            const el = addFakeMarker(manager, 'a', '3', POINT);
            const state = { markerId: 'a', lngLat: POINT, foundFeatures: [], pendingLayerIds: new Set() };

            manager.addMarker = vi.fn((lngLat, features, options) => {
                // Stand in for the real addMarker's registry write.
                const resolved = manager._resolveNewUrlId(options.urlId);
                markerRegistry.set(resolved, { id: resolved, lng: lngLat.lng, lat: lngLat.lat });
                manager._markers.set('a2', {
                    id: 'a2', urlId: resolved, lngLat,
                    marker: { remove: vi.fn(), getElement: () => el }
                });
                return 'a2';
            });

            manager._upsertStreamingMarkerVisual(state);

            expect(manager.addMarker).toHaveBeenCalledWith(POINT, [], expect.objectContaining({ urlId: '3' }));
            // Reclaimed, not incremented past - and nothing stale left over.
            expect(markerRegistry.allIds()).toEqual(['3']);
        });

        it('does not drift upward over repeated rebuilds', () => {
            const manager = makeManager();
            addFakeMarker(manager, 'a', '3', POINT);
            const state = { markerId: 'a', lngLat: POINT, foundFeatures: [], pendingLayerIds: new Set() };

            let n = 0;
            manager.addMarker = vi.fn((lngLat, features, options) => {
                const resolved = manager._resolveNewUrlId(options.urlId);
                markerRegistry.set(resolved, { id: resolved, lng: lngLat.lng, lat: lngLat.lat });
                const id = `m${++n}`;
                manager._markers.set(id, {
                    id, urlId: resolved, lngLat,
                    marker: { remove: vi.fn(), getElement: () => document.createElement('div') }
                });
                return id;
            });

            // One rebuild per layer that resolves.
            for (let i = 0; i < 5; i++) manager._upsertStreamingMarkerVisual(state);

            expect(markerRegistry.allIds()).toEqual(['3']);
            expect([...manager._markers.values()].map(m => m.urlId)).toEqual(['3']);
        });
    });

    describe('reconcileMarkerUrlIds with markers on the same point', () => {
        it('gives each URL entry its own marker', () => {
            const manager = makeManager();
            addFakeMarker(manager, 'a', '7', POINT);
            addFakeMarker(manager, 'b', '8', POINT);
            addFakeMarker(manager, 'c', '9', POINT);

            manager.reconcileMarkerUrlIds([
                { id: '1', lng: POINT.lng, lat: POINT.lat },
                { id: '2', lng: POINT.lng, lat: POINT.lat },
                { id: '3', lng: POINT.lng, lat: POINT.lat }
            ]);

            // Previously every entry matched the first marker in turn, leaving it
            // named "3" and the other two on their auto-numbered ids.
            expect([...manager._markers.values()].map(m => m.urlId)).toEqual(['1', '2', '3']);
            expect(markerRegistry.allIds().sort()).toEqual(['1', '2', '3']);
        });

        it('writes the id onto the badge, not just the hidden input', () => {
            const manager = makeManager();
            const el = addFakeMarker(manager, 'a', '7', POINT);

            manager.reconcileMarkerUrlIds([{ id: 'home', lng: POINT.lng, lat: POINT.lat }]);

            expect(el.querySelector('.marker-id-text').textContent).toBe('home');
            expect(el.querySelector('.marker-id-input').value).toBe('home');
        });
    });

    describe('an id named by the shared link is used from the first draw', () => {
        it('claims a registry id that no live marker holds', () => {
            const manager = makeManager();
            // The placeholder map-init hydrates from `?markers=marker-23ab(...)`.
            markerRegistry.set('23ab', { id: '23ab', lng: POINT.lng, lat: POINT.lat, name: '', description: '' });

            // Without the live-marker basis this returned "23ab_2" - the marker
            // pushed off its own name by its own placeholder.
            expect(manager._resolveNewUrlId('23ab')).toBe('23ab');
        });

        it('still suffixes when a live marker already holds the id', () => {
            const manager = makeManager();
            addFakeMarker(manager, 'a', 'Assagao_17', POINT);
            expect(manager._resolveNewUrlId('Assagao_17')).toBe('Assagao_17_2');
        });

        it('auto-numbers past reserved placeholder ids', () => {
            const manager = makeManager();
            markerRegistry.set('1', { id: '1', lng: POINT.lng, lat: POINT.lat });
            markerRegistry.set('2', { id: '2', lng: POINT.lng, lat: POINT.lat });
            expect(manager._resolveNewUrlId(null)).toBe('3');
        });

        it('marks a restored marker as saved, so new markers do not drop it', () => {
            const manager = makeManager();
            const state = { markerId: null, urlId: '23ab', lngLat: POINT, foundFeatures: [], pendingLayerIds: new Set() };
            manager.addMarker = vi.fn(() => 'm1');

            manager._upsertStreamingMarkerVisual(state);

            // A marker written into a link was named on purpose.
            expect(manager.addMarker.mock.calls[0][2].saved).toBe(true);
        });

        it('does not take focus for a restored marker', () => {
            const manager = makeManager();
            const state = { markerId: null, urlId: '23ab', lngLat: POINT, foundFeatures: [], pendingLayerIds: new Set() };
            manager.addMarker = vi.fn(() => 'm1');

            manager._upsertStreamingMarkerVisual(state);

            // Restoring a link should leave every marker as a plain label; only
            // clicking one (or dropping a new one) makes it the active marker.
            expect(manager.addMarker.mock.calls[0][2].select).toBe(false);
        });

        it('keeps focus through a rebuild of the marker that had it', () => {
            const manager = makeManager();
            addFakeMarker(manager, 'a', '3', POINT);
            manager._selectedMarkerId = 'a';
            const state = { markerId: 'a', urlId: '3', lngLat: POINT, foundFeatures: [], pendingLayerIds: new Set() };
            manager.addMarker = vi.fn(() => 'a2');

            manager._upsertStreamingMarkerVisual(state);

            expect(manager.addMarker.mock.calls[0][2].select).toBe(true);
        });

        it('carries the link id out of the selection feature into the first addMarker', () => {
            const manager = makeManager();
            markerRegistry.set('23ab', { id: '23ab', lng: POINT.lng, lat: POINT.lat });
            const state = {
                markerId: null, urlId: '23ab', lngLat: POINT,
                foundFeatures: [], pendingLayerIds: new Set()
            };

            manager.addMarker = vi.fn(() => 'm1');
            manager._upsertStreamingMarkerVisual(state);

            expect(manager.addMarker).toHaveBeenCalledWith(POINT, [], expect.objectContaining({ urlId: '23ab' }));
        });
    });

    describe('dragging a marker keeps its identity', () => {
        it('hands the id to the marker that replaces it', () => {
            const manager = makeManager();
            addFakeMarker(manager, 'a', '23ab', POINT);
            const marker = { getLngLat: () => ({ lng: 73.9, lat: 15.7 }) };

            manager._isTouch = false;
            manager._stateManager.getFeaturesAtPoint = () => [];
            manager._stateManager.isLayerInteractive = () => true;
            manager._map.project = () => ({ x: 0, y: 0 });
            manager._resolveMarkerAddress = () => {};

            let adoptedAtClickTime = 'not called';
            manager._stateManager.handleFeatureClicks = () => {
                adoptedAtClickTime = manager._adoptedIdentity;
            };

            manager._handleMarkerDragEnd(marker, 'a');

            // The rebuild goes through the generic pipeline, so the id has to be
            // waiting for it here rather than passed as an argument.
            expect(adoptedAtClickTime).toMatchObject({ urlId: '23ab' });
            // One-shot: cleared once the rebuild is done.
            expect(manager._adoptedIdentity).toBe(null);
        });
    });

    describe('findMarkerNear', () => {
        it('skips ids the caller has already claimed', () => {
            const manager = makeManager();
            addFakeMarker(manager, 'a', '1', POINT);
            addFakeMarker(manager, 'b', '2', POINT);

            expect(manager.findMarkerNear(POINT, 5)).toBe('a');
            expect(manager.findMarkerNear(POINT, 5, new Set(['a']))).toBe('b');
            expect(manager.findMarkerNear(POINT, 5, new Set(['a', 'b']))).toBe(null);
        });
    });

    describe('saved markers survive a new one', () => {
        function makeClearable() {
            const manager = makeManager();
            manager._clearHoverMarker = () => {};
            manager._clearAllMarkerHoverStates = () => {};
            manager._deselectMarkerBadges = () => {};
            manager._stateManager._deselectFeature = () => {};
            manager.addMarker = vi.fn(() => 'new');
            return manager;
        }

        it('drops an unsaved marker when another is dropped', () => {
            const manager = makeClearable();
            addFakeMarker(manager, 'a', '1', POINT);

            manager._handleEmptyMapClick({ lngLat: POINT });

            expect(manager._markers.has('a')).toBe(false);
            expect(manager.addMarker).toHaveBeenCalled();
        });

        it('keeps one whose id was saved', () => {
            const manager = makeClearable();
            addFakeMarker(manager, 'a', 'home', POINT);
            manager._markers.get('a').saved = true;

            manager._handleEmptyMapClick({ lngLat: POINT });

            // Naming it is what made it worth keeping - no mode needed.
            expect(manager._markers.has('a')).toBe(true);
        });

        it('keeps saved ones and drops the rest together', () => {
            const manager = makeClearable();
            addFakeMarker(manager, 'a', 'home', POINT);
            addFakeMarker(manager, 'b', '2', POINT);
            addFakeMarker(manager, 'c', 'shop', POINT);
            manager._markers.get('a').saved = true;
            manager._markers.get('c').saved = true;

            manager._handleEmptyMapClick({ lngLat: POINT });

            expect([...manager._markers.keys()]).toEqual(['a', 'c']);
        });

        it('leaves every marker alone while a rebuild re-queries its point', () => {
            const manager = makeClearable();
            addFakeMarker(manager, 'a', '1', POINT);

            // A drag re-queries its drop point through this same path.
            manager._suppressReplaceClear = true;
            manager._handleEmptyMapClick({ lngLat: POINT });

            expect(manager._markers.has('a')).toBe(true);
        });

        it('opens the editor synchronously, so the keyboard can come up', () => {
            const manager = makeClearable();
            const el = document.createElement('div');
            const startIdEdit = vi.fn();
            el._startIdEdit = startIdEdit;
            // Stand in for the real addMarker: build the element, then run the
            // tail of addMarker that decides whether to open the editor.
            manager.addMarker = vi.fn((lngLat, features, options) => {
                if (options.startEditing) el._startIdEdit({ initial: true });
                return 'new';
            });

            manager._handleEmptyMapClick({ lngLat: POINT });

            // Mobile browsers only raise the on-screen keyboard for a focus()
            // made inside the gesture - a deferred one leaves the field looking
            // focused with no keyboard behind it.
            expect(startIdEdit).toHaveBeenCalledWith({ initial: true });
        });

        it('opens a freshly dropped marker straight into its id editor', () => {
            const manager = makeClearable();
            manager._handleEmptyMapClick({ lngLat: POINT });
            expect(manager.addMarker.mock.calls[0][2]).toMatchObject({ startEditing: true });
        });
    });
});

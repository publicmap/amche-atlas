/**
 * MapMaskManager - builds a "cutout" polygon that covers the whole world
 * except the polygons of one target layer, and feeds it to the `mask` layer.
 *
 * Linked from `?mask=<layer-id>` (see docs/API.md), from the "Toggle Mask"
 * button in map-information.html, and from the mask cell in the layer-stack
 * strip. Only one layer can be masked at a time, matching swipe-compare.
 *
 * The cutout is derived from what is actually loaded on the map, not from the
 * layer's source data:
 *
 *   - `querySourceFeatures` is run per style sublayer of the target group, so
 *     only geometry present in the currently loaded tiles is considered, and
 *     each sublayer's live Mapbox filter (including the quick property filter
 *     MapMarkerManager._applyFeatureFilter writes) is passed through.
 *   - If any feature of that layer is selected, only the selection is cut out,
 *     so masking follows the marker selection the same way the inspector does.
 *
 * That makes the result zoom- and viewport-dependent for vector tile layers:
 * panning or zooming loads different tiles, so the mask has to be rebuilt.
 * The rebuild is driven by the map's `idle` event (which also covers filter
 * edits, style changes and late-arriving tiles) and guarded by a signature of
 * the collected geometry, so the setData() this manager performs - which makes
 * the map go idle again - does not loop.
 *
 * Alongside the fill, a `clip` style layer is kept on top of the style over the
 * same geometry, so symbols and 3D models in the masked area are erased instead
 * of drawing over the mask - see _ensureClipLayer.
 */

import { toPolygonFeature, bboxKey, signatureOf, buildMaskFeature } from './map-mask-geometry.js';

const MASK_LAYER_ID = 'mask';
const MASK_SOURCE_ID = 'geojson-mask';

// A `clip` style layer sharing the mask's source, so the masked area is a real
// cutout rather than a translucent wash: it erases symbols (basemap labels,
// POIs) and instanced models (trees, landmarks) that would otherwise keep
// drawing on top of the mask fill.
// https://docs.mapbox.com/mapbox-gl-js/example/clip-layer/
const CLIP_LAYER_ID = 'mask-clip';
const DEFAULT_CLIP_LAYER_TYPES = ['symbol', 'model'];

// Unioning is O(n log n) at best and runs on every camera change. Past this
// many rings the mask stops being worth the frame budget.
const MAX_SOURCE_POLYGONS = 3000;

const REFRESH_DEBOUNCE_MS = 200;

export class MapMaskManager {
    constructor(map) {
        this._map = map;
        // Layer whose polygons cut the hole, not the `mask` layer itself.
        this._sourceLayerId = null;
        this._signature = null;
        this._timer = null;
        this._listening = false;

        this._onIdle = () => this._scheduleRefresh();
        // A selection or a layer toggle can change the cutout without the
        // camera moving, and neither guarantees an `idle` afterwards.
        this._onSelectionChange = () => this._scheduleRefresh();
        this._onLayerToggled = (e) => {
            if (e.detail?.layerId === this._sourceLayerId && e.detail?.visible === false) {
                this.clearMask();
            } else {
                this._scheduleRefresh();
            }
        };
    }

    /** The layer currently used as the mask cutout, or null. */
    getMaskSourceLayerId() {
        return this._sourceLayerId;
    }

    isMasking(layerId) {
        return !!layerId && this._sourceLayerId === layerId;
    }

    async toggleMask(layerId, enabled) {
        if (enabled) return this.setMask(layerId);
        if (this.isMasking(layerId)) return this.clearMask();
    }

    /**
     * Use `layerId`'s polygons as the mask cutout. Replaces any layer already
     * being used, turns the `mask` layer on, and builds the first cutout.
     */
    async setMask(layerId) {
        if (!layerId || layerId === MASK_LAYER_ID) return;
        if (typeof turf === 'undefined') {
            console.warn('[MapMaskManager] turf.js is not loaded; cannot generate a mask');
            return;
        }

        this._sourceLayerId = layerId;
        this._signature = null;
        this._startListening();

        await this._setMaskLayerVisible(true);
        this.refresh();

        window.urlManager?.updateMaskParam?.(layerId);
        this._notifyChanged();
    }

    /** Stop masking: empty the mask layer's data and switch it off. */
    async clearMask() {
        if (!this._sourceLayerId) return;

        this._sourceLayerId = null;
        this._signature = null;
        clearTimeout(this._timer);
        this._stopListening();

        this._writeMaskData({ type: 'FeatureCollection', features: [] });
        this._removeClipLayer();
        await this._setMaskLayerVisible(false);

        window.urlManager?.updateMaskParam?.(null);
        this._notifyChanged();
    }

    destroy() {
        clearTimeout(this._timer);
        this._stopListening();
        this._removeClipLayer();
        this._sourceLayerId = null;
    }

    _startListening() {
        if (this._listening) return;
        this._listening = true;
        this._map.on('idle', this._onIdle);
        window.addEventListener('layer-toggled', this._onLayerToggled);
        window.stateManager?.addEventListener?.('state-change', this._onSelectionChange);
    }

    _stopListening() {
        if (!this._listening) return;
        this._listening = false;
        this._map.off('idle', this._onIdle);
        window.removeEventListener('layer-toggled', this._onLayerToggled);
        window.stateManager?.removeEventListener?.('state-change', this._onSelectionChange);
    }

    _scheduleRefresh() {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
    }

    /**
     * Rebuild the cutout from what is loaded right now. Cheap to call: the
     * geometry signature short-circuits everything past the source query when
     * nothing the mask depends on has changed.
     */
    refresh() {
        if (!this._sourceLayerId || typeof turf === 'undefined') return;

        const polygons = this._collectPolygons();
        const signature = signatureOf(polygons);
        if (signature === this._signature) return;
        this._signature = signature;

        if (polygons.length === 0) {
            // Nothing loaded for this layer here - masking the whole world
            // would just blank the map, so mask nothing instead.
            this._writeMaskData({ type: 'FeatureCollection', features: [] });
            return;
        }

        const mask = buildMaskFeature(polygons);
        this._writeMaskData(mask
            ? { type: 'FeatureCollection', features: [mask] }
            : { type: 'FeatureCollection', features: [] });
        this._ensureClipLayer();
    }

    /**
     * Keep a `clip` layer over the mask geometry at the very top of the style.
     *
     * A clip layer only erases content from layers *below* it, so it has to sit
     * above everything for basemap labels and 3D models to actually disappear
     * from the masked area - without it they keep drawing over the mask fill
     * and the cutout doesn't read. It shares the mask's own GeoJSON source, so
     * it tracks every regeneration for free.
     *
     * The mask layer's config can narrow this with `clipLayerTypes` (an array
     * of "symbol"/"model"), or switch it off with `clipLayerTypes: false`.
     */
    _ensureClipLayer() {
        const types = this._clipLayerTypes();
        if (!types) {
            this._removeClipLayer();
            return;
        }
        if (!this._map.getSource(MASK_SOURCE_ID)) return;

        try {
            if (!this._map.getLayer(CLIP_LAYER_ID)) {
                this._map.addLayer({
                    id: CLIP_LAYER_ID,
                    type: 'clip',
                    source: MASK_SOURCE_ID,
                    layout: { 'clip-layer-types': types }
                });
                return;
            }

            // Layers added since (a new overlay, a basemap switch) land on top
            // of the clip layer and would escape it. Only move when it isn't
            // already last: a no-op moveLayer still counts as a style change,
            // which would make the map go idle and call straight back in here.
            const layers = this._map.getStyle()?.layers || [];
            if (layers[layers.length - 1]?.id !== CLIP_LAYER_ID) {
                this._map.moveLayer(CLIP_LAYER_ID);
            }
        } catch (e) {
            console.warn('[MapMaskManager] Could not add the clip layer:', e);
        }
    }

    _removeClipLayer() {
        try {
            if (this._map.getLayer(CLIP_LAYER_ID)) this._map.removeLayer(CLIP_LAYER_ID);
        } catch (e) {
            // Style may have been torn down already.
        }
    }

    /** `clip-layer-types` for the clip layer, or null to not clip at all. */
    _clipLayerTypes() {
        const group = window.layerControl?._state?.groups?.find(g => g.id === MASK_LAYER_ID);
        const configured = group?.clipLayerTypes;
        if (configured === false || configured === null) return null;
        if (Array.isArray(configured)) return configured.length ? configured : null;
        return DEFAULT_CLIP_LAYER_TYPES;
    }

    /**
     * Every polygon of the target layer currently loaded on the map.
     *
     * One query per distinct source/source-layer/filter triple across the
     * group's style sublayers - a group usually paints fill, line and symbol
     * sublayers off the same source, and they carry the same filter, so
     * querying each would just return the same features three times.
     *
     * Tile-clipped copies of the same feature from different tiles are kept
     * (they are the pieces that union back into the whole); only exact
     * duplicates - the same feature id with the same bounds, which is what
     * overlapping zoom levels in the tile cache produce - are dropped.
     */
    _collectPolygons() {
        const selected = this._getSelectedPolygons();
        if (selected.length > 0) return selected;

        const styleLayers = this._map.getStyle()?.layers || [];
        const subLayers = styleLayers.filter(l => l.metadata?.groupId === this._sourceLayerId);

        const queried = new Set();
        const seen = new Set();
        const polygons = [];

        for (const sub of subLayers) {
            if (!sub.source) continue;

            const sourceLayer = sub['source-layer'];
            let filter = null;
            try {
                filter = this._map.getFilter(sub.id) ?? null;
            } catch (e) {
                // Layer may not support filters (raster, background, ...).
            }

            const key = `${sub.source}|${sourceLayer || ''}|${JSON.stringify(filter)}`;
            if (queried.has(key)) continue;
            queried.add(key);

            for (const feature of this._querySource(sub.source, sourceLayer, filter)) {
                const polygon = toPolygonFeature(feature);
                if (!polygon) continue;

                const id = feature.id ?? feature.properties?.id ?? '';
                const dedupeKey = `${id}|${bboxKey(polygon)}`;
                if (seen.has(dedupeKey)) continue;
                seen.add(dedupeKey);

                polygons.push(polygon);
                if (polygons.length >= MAX_SOURCE_POLYGONS) {
                    console.warn(`[MapMaskManager] "${this._sourceLayerId}" has more than ${MAX_SOURCE_POLYGONS} polygons loaded; masking the first ${MAX_SOURCE_POLYGONS}`);
                    return polygons;
                }
            }
        }

        return polygons;
    }

    _querySource(source, sourceLayer, filter) {
        const params = {};
        if (sourceLayer) params.sourceLayer = sourceLayer;
        if (filter) params.filter = filter;

        try {
            return this._map.querySourceFeatures(source, params) || [];
        } catch (e) {
            // A filter that reads feature-state can't be evaluated by
            // querySourceFeatures - fall back to the unfiltered set rather
            // than dropping the layer out of the mask entirely.
            if (!filter) {
                console.warn(`[MapMaskManager] querySourceFeatures failed for ${source}:`, e);
                return [];
            }
            try {
                return this._map.querySourceFeatures(source, sourceLayer ? { sourceLayer } : {}) || [];
            } catch (e2) {
                console.warn(`[MapMaskManager] querySourceFeatures failed for ${source}:`, e2);
                return [];
            }
        }
    }

    /**
     * Selected features of the target layer, if any - so masking follows the
     * marker selection instead of everything in view. Selections are held as
     * full GeoJSON by MapFeatureStateManager, so no source query is needed.
     */
    _getSelectedPolygons() {
        const stateManager = window.stateManager;
        if (!stateManager?.getLayerFeatures) return [];

        const polygons = [];
        try {
            stateManager.getLayerFeatures(this._sourceLayerId).forEach(state => {
                if (!state.isSelected) return;
                const polygon = toPolygonFeature(state.feature);
                if (polygon) polygons.push(polygon);
            });
        } catch (e) {
            console.warn('[MapMaskManager] Could not read selected features:', e);
        }
        return polygons;
    }

    /**
     * Push the generated geometry into the `mask` layer - both the live source
     * and the layer control's config entry, the same pair MapMarkerManager
     * keeps in sync for the `selection` layer. The config copy is deliberately
     * NOT written: the mask is regenerated from `?mask=` on load, and the
     * cutout can be megabytes of coordinates that url-manager would otherwise
     * try to serialize into `?layers=`.
     */
    _writeMaskData(geojson) {
        const mapboxAPI = window.layerControl?._mapboxAPI || window.mapboxAPI;
        if (!mapboxAPI?.updateGeoJSONLayerData) {
            console.warn('[MapMaskManager] Mapbox API not available; cannot update the mask layer');
            return;
        }
        mapboxAPI.updateGeoJSONLayerData(MASK_LAYER_ID, geojson);
    }

    /**
     * Turn the `mask` layer itself on or off, through the same path the map
     * browser uses so its checkbox, ordering and toasts all stay consistent.
     */
    async _setMaskLayerVisible(visible) {
        const control = window.layerControl;
        if (!control?._state?.groups) return;

        const index = control._state.groups.findIndex(g => g.id === MASK_LAYER_ID);
        if (index === -1) {
            console.warn('[MapMaskManager] No "mask" layer in this atlas; add one to use masking');
            return;
        }

        if (window.browserControl?._handleLayerToggle) {
            await window.browserControl._handleLayerToggle(MASK_LAYER_ID, visible);
            return;
        }

        await control._toggleLayerGroup(index, visible);
    }

    /** Repaint the layer-stack strip's mask cell without waiting on the URL debounce. */
    _notifyChanged() {
        window.dispatchEvent(new CustomEvent('mask-changed', {
            detail: { layerId: this._sourceLayerId }
        }));
    }
}

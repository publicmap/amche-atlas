/**
 * URL API - Handles URL parameter synchronization for map layers
 * Supports deep linking with ?atlas=X and ?layers=X parameters
 */

import { LayerOrderManager } from './layer-order-manager.js';
import { URL_API_PARAMS } from './url-api-params.js';
import { parseDynamicLayerShorthandString } from './dynamic-layer-shorthand.js';
import { allEntries as allRegisteredMarkers, buildMarkersParam, parseMarkersParam } from './marker-registry.js';

export class URLManager {
    constructor(mapLayerControl, map) {
        this.mapLayerControl = mapLayerControl;
        this.map = map;
        this.isUpdatingFromURL = false; // Prevent circular updates
        this.pendingURLUpdate = null; // Debounce URL updates
        this.stateManager = null; // Reference to feature state manager

        // Set up browser history handling
        this.setupHistoryHandling();

        // Set up layer control event listeners for URL updates
        this.setupLayerControlEventListeners();

        $(document).on('update_url', this.updateGeolocateParam );

        // Mapbox GL's own `hash: true` option writes the #map=zoom/lat/lng/bearing
        // hash directly via history.replaceState on map move, bypassing
        // _performURLUpdate() entirely. Notify the parent here too, deferred two
        // animation frames so it runs after Mapbox's (internally throttled) hash
        // write has actually landed.
        if (this.map) {
            this.map.on('moveend', () => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => this._notifyParentOfURL());
                });
            });

            // moveend never fires if the map doesn't pan/zoom on startup, so an
            // embedding parent would otherwise never learn the initial URL. Post
            // it once after the map finishes loading, whether or not it ever moves.
            const notifyInitialURL = () => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => this._notifyParentOfURL());
                });
            };
            if (this.map.loaded()) {
                notifyInitialURL();
            } else {
                this.map.once('load', notifyInitialURL);
            }
        }
    }

    /**
     * Notify any embedding parent (e.g. an iframe host) of the current URL.
     */
    _notifyParentOfURL() {
        if (window.parent !== window) {
            window.parent.postMessage(
                { type: "url", href: window.location.href },
                "*" // tighten to a specific origin in production
            );
        }
    }

    setStateManager(stateManager) {
        this.stateManager = stateManager;

        if (stateManager) {
            stateManager.addEventListener('state-change', (event) => {
                const { eventType, data } = event.detail;
                if (eventType === 'feature-click' ||
                    eventType === 'feature-click-multiple' ||
                    eventType === 'selections-cleared' ||
                    eventType === 'selection-cleared' ||
                    eventType === 'feature-deselected') {
                    if (!this.isUpdatingFromURL && !data?.fromURL) {
                        // Always update layers when clearing selections (to remove selection GeoJSON from URL)
                        // or when selection layer has features (to add/update it in URL)
                        const isClearing = eventType === 'selections-cleared' || eventType === 'selection-cleared';
                        let updateLayers = isClearing;
                        if (!updateLayers && this.mapLayerControl) {
                            const selectionLayer = this.mapLayerControl._state.groups.find(g => g.id === 'selection');
                            if (selectionLayer?.geojson?.features?.length > 0) {
                                updateLayers = true;
                            }
                        }
                        this.updateURL({ updateSelections: true, updateLayers });
                    }
                }
            });
        }
    }

    /**
     * Convert a layer config to a URL-friendly representation
     * Uses normalized IDs (without atlas prefix for current atlas layers)
     */
    layerToURL(layer) {
        // If the layer has an _originalJson property, preserve it — merging in any
        // opacity override so custom URL layers don't lose their type/url/style/etc.
        if (layer._originalJson && !layer.geojson) {
            if (layer.opacity === undefined) {
                return layer._originalJson;
            }
            // A dynamic layer shorthand string (e.g. "osm:relation/123") has nowhere
            // to carry opacity inline, so fall back to the equivalent {type,id,opacity}
            // object form, which dynamic-layer-shorthand.js accepts identically.
            const shorthand = parseDynamicLayerShorthandString(layer._originalJson);
            if (shorthand) {
                if (layer.opacity !== 1) {
                    return JSON.stringify({ ...shorthand, opacity: layer.opacity });
                }
                return layer._originalJson;
            }
            // Parse the single-quote JSON (_originalJson uses ' instead of "),
            // update opacity, then re-serialize in the same format.
            try {
                const asDoubleQuote = layer._originalJson
                    .replace(/\\'/g, '')
                    .replace(/'/g, '"')
                    .replace(//g, "'");
                const parsed = JSON.parse(asDoubleQuote);
                if (layer.opacity !== 1) {
                    parsed.opacity = layer.opacity;
                } else {
                    delete parsed.opacity;
                }
                return JSON.stringify(parsed).replace(/'/g, "\\'").replace(/"/g, "'");
            } catch (e) {
                // Fallthrough to generic serialization if parse fails
            }
        }

        // Use normalized ID if available (removes current atlas prefix)
        let layerId = layer._normalizedId || layer.id;

        // If we don't have a normalized ID, try to get it from the registry
        if (!layer._normalizedId && window.layerRegistry) {
            layerId = window.layerRegistry.normalizeLayerId(layer.id);
        }

        // If it's a simple layer with just an ID (no opacity, geojson, or other properties), return the normalized ID
        const simpleLayerKeys = Object.keys(layer).filter(k =>
            !k.startsWith('_') &&
            k !== 'tags' &&
            k !== 'initiallyChecked' &&
            k !== 'geojson'
        );

        if (layer.id && simpleLayerKeys.length === 1 && !layer.geojson) {
            return layerId;
        }

        // If it's a layer with opacity, geojson, or other properties, create a clean object
        const cleanLayer = { id: layerId };
        Object.keys(layer).forEach(key => {
            if (key !== '_originalJson' && key !== '_normalizedId' &&
                key !== '_sourceAtlas' && key !== '_prefixedId' &&
                key !== 'id' && key !== 'initiallyChecked' && key !== 'tags' &&
                key !== 'type' && key !== 'title' && key !== 'description' &&
                key !== 'headerImage' && key !== 'attribution' && key !== 'style') {
                cleanLayer[key] = layer[key];
            }
        });

        // If it's just an ID (no additional properties), return it as string
        if (Object.keys(cleanLayer).length === 1) {
            return layerId;
        }

        // If it's a complex layer with geojson or other properties, return minified JSON
        return JSON.stringify(cleanLayer);
    }

    /**
     * Parse layers from URL parameter (reusing existing logic from map-init.js)
     */
    parseLayersFromUrl(layersParam) {
        if (!layersParam) return [];

        const layers = [];
        let currentItem = '';
        let braceCount = 0;
        let parenCount = 0;
        let inQuotes = false;
        let escapeNext = false;

        // Parse the comma-separated string, being careful about JSON objects
        // and - since a `route-<rid>:engine-profile(id1,id2,...)` entry's
        // marker-id list is itself comma-separated (see route-url-api.js) -
        // parenthesized shorthand calls.
        for (let i = 0; i < layersParam.length; i++) {
            const char = layersParam[i];

            if (escapeNext) {
                currentItem += char;
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                currentItem += char;
                escapeNext = true;
                continue;
            }

            if (char === '"' && !escapeNext) {
                inQuotes = !inQuotes;
            }

            if (!inQuotes) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                } else if (char === '(') {
                    parenCount++;
                } else if (char === ')') {
                    parenCount--;
                }
            }

            if (char === ',' && braceCount === 0 && parenCount === 0 && !inQuotes) {
                // Found a separator, process current item
                const trimmedItem = currentItem.trim();
                if (trimmedItem) {
                    if (trimmedItem.startsWith('{') && trimmedItem.endsWith('}')) {
                        try {
                            const parsedLayer = JSON.parse(trimmedItem);
                            layers.push(parsedLayer);
                        } catch (error) {
                            console.warn('Failed to parse layer JSON:', trimmedItem, error);
                            layers.push({ id: trimmedItem });
                        }
                    } else {
                        const shorthand = parseDynamicLayerShorthandString(trimmedItem);
                        layers.push(shorthand ? { ...shorthand, _originalJson: trimmedItem } : { id: trimmedItem });
                    }
                }
                currentItem = '';
            } else {
                currentItem += char;
            }
        }

        // Process the last item
        const trimmedItem = currentItem.trim();
        if (trimmedItem) {
            if (trimmedItem.startsWith('{') && trimmedItem.endsWith('}')) {
                try {
                    const parsedLayer = JSON.parse(trimmedItem);
                    layers.push(parsedLayer);
                } catch (error) {
                    console.warn('Failed to parse layer JSON:', trimmedItem, error);
                    layers.push({ id: trimmedItem });
                }
            } else {
                const shorthand = parseDynamicLayerShorthandString(trimmedItem);
                layers.push(shorthand ? { ...shorthand, _originalJson: trimmedItem } : { id: trimmedItem });
            }
        }

        return layers;
    }

    /**
     * Get currently active layers from the map layer control
     * Returns layers with normalized IDs for URL serialization
     */
    getCurrentActiveLayers() {
        if (!this.mapLayerControl || !this.mapLayerControl._state) {
            return [];
        }

        const activeLayers = [];

        // Iterate through all groups in the layer control
        this.mapLayerControl._state.groups.forEach((group, groupIndex) => {
            // Special case: skip the system layers ('selection' markers,
            // 'directions' routes) while they hold nothing - they are always
            // present, so listing them empty would only pad every URL.
            const isEmptySystemLayer = (group.id === 'selection' || group.id === 'directions') &&
                (!group.geojson || !group.geojson.features || group.geojson.features.length === 0);
            if (isEmptySystemLayer) {
                return;
            }

            // Special case: always include selection layer if it has features
            const isSelectionWithFeatures = group.id === 'selection' &&
                group.geojson &&
                group.geojson.features &&
                group.geojson.features.length > 0;

            if (this.isGroupActive(groupIndex) || isSelectionWithFeatures) {
                // Use the original layer configuration if it exists
                if (group._originalJson) {
                    // If this is a custom layer from URL, preserve the original JSON string
                    const layerObj = {
                        _originalJson: group._originalJson,
                        id: group.id,
                        _normalizedId: group._normalizedId
                    };
                    // Include opacity if it exists and is different from default (1)
                    if (group.opacity !== undefined && group.opacity !== 1) {
                        layerObj.opacity = group.opacity;
                    }
                    activeLayers.push(layerObj);
                } else if (group.id) {
                    // Get the proper normalized ID from the layer registry
                    let normalizedId = group._normalizedId;
                    if (!normalizedId && window.layerRegistry) {
                        normalizedId = window.layerRegistry.normalizeLayerId(group.id);
                    }

                    // Simple layer with just an ID
                    const layerObj = {
                        id: group.id,
                        _normalizedId: normalizedId
                    };
                    // Include opacity if it exists and is different from default (1)
                    if (group.opacity !== undefined && group.opacity !== 1) {
                        layerObj.opacity = group.opacity;
                    }
                    // Include geojson if it exists and has features. The selection layer is
                    // excluded here — its markers are carried in the compact `markers=` param
                    // instead of inlining a full FeatureCollection (see serializeMarkersForURL).
                    if (group.id !== 'selection' && group.geojson && group.geojson.features && group.geojson.features.length > 0) {
                        layerObj.geojson = group.geojson;
                    }
                    activeLayers.push(layerObj);
                } else if (group.layers && group.layers.length > 0) {
                    // For style groups with sublayers, check which sublayers are active
                    const activeSubLayers = this.getActiveSubLayers(groupIndex);
                    if (activeSubLayers.length > 0) {
                        // Get the proper normalized ID from the layer registry
                        let normalizedId = group._normalizedId;
                        if (!normalizedId && window.layerRegistry) {
                            normalizedId = window.layerRegistry.normalizeLayerId(group.id);
                        }

                        // Create a representation for this group's active sublayers
                        const layerObj = {
                            id: group.title || `group-${groupIndex}`,
                            sublayers: activeSubLayers,
                            _normalizedId: normalizedId
                        };
                        // Include opacity if it exists and is different from default (1)
                        if (group.opacity !== undefined && group.opacity !== 1) {
                            layerObj.opacity = group.opacity;
                        }
                        activeLayers.push(layerObj);
                    }
                } else {
                    // Get the proper normalized ID from the layer registry
                    let normalizedId = group._normalizedId;
                    if (!normalizedId && window.layerRegistry) {
                        normalizedId = window.layerRegistry.normalizeLayerId(group.id);
                    }

                    // Generic group
                    const layerObj = {
                        id: group.title || `group-${groupIndex}`,
                        type: group.type || 'source',
                        _normalizedId: normalizedId
                    };
                    // Include opacity if it exists and is different from default (1)
                    if (group.opacity !== undefined && group.opacity !== 1) {
                        layerObj.opacity = group.opacity;
                    }
                    activeLayers.push(layerObj);
                }
            }
        });

        // Also check for cross-atlas layers that might be active
        const crossAtlasLayers = this.getActiveCrossAtlasLayers();
        activeLayers.push(...crossAtlasLayers);

        // Enrich layers with full config to check basemap tags
        const enrichedLayers = activeLayers.map(layer => {
            const layerConfig = this.mapLayerControl._state.groups.find(g =>
                g.id === layer.id || g._prefixedId === layer.id
            );
            return {
                ...layer,
                tags: layerConfig?.tags || layer.tags
            };
        });

        // Use centralized ordering logic: map order → URL order
        // This handles: reversal + basemap grouping (overlays first, basemaps at end)
        return LayerOrderManager.mapOrderToUrlOrder(enrichedLayers);
    }

    /**
     * Check if a group is currently active/visible
     */
    isGroupActive(groupIndex) {
        if (!this.mapLayerControl._sourceControls || !this.mapLayerControl._sourceControls[groupIndex]) {
            return false;
        }

        const $groupControl = $(this.mapLayerControl._sourceControls[groupIndex]);
        const $toggle = $groupControl.find('.toggle-switch input[type="checkbox"]');
        const isChecked = $toggle.length > 0 && $toggle.prop('checked');

        return isChecked;
    }

    /**
     * Get active sublayers for a style group
     */
    getActiveSubLayers(groupIndex) {
        if (!this.mapLayerControl._sourceControls || !this.mapLayerControl._sourceControls[groupIndex]) {
            return [];
        }

        const $groupControl = $(this.mapLayerControl._sourceControls[groupIndex]);
        const $sublayerToggles = $groupControl.find('.layer-controls .toggle-switch input[type="checkbox"]');
        const activeSubLayers = [];

        $sublayerToggles.each((index, toggle) => {
            if ($(toggle).prop('checked')) {
                const layerId = $(toggle).attr('id');
                if (layerId) {
                    activeSubLayers.push(layerId);
                }
            }
        });

        return activeSubLayers;
    }

    /**
     * Get active cross-atlas layers
     */
    getActiveCrossAtlasLayers() {
        const activeLayers = [];

        // Find all cross-atlas layer elements that are currently active
        const $crossAtlasLayers = $('.cross-atlas-layer');

        $crossAtlasLayers.each((index, element) => {
            const $element = $(element);
            const $toggleInput = $element.find('.toggle-switch input[type="checkbox"]');

            if ($toggleInput.length > 0 && $toggleInput.prop('checked')) {
                const layerId = $element.attr('data-layer-id');
                if (layerId) {
                    // Find the layer in the state
                    const layer = this.mapLayerControl._state.groups.find(g => g.id === layerId || g._prefixedId === layerId);
                    if (layer) {
                        // Get the proper normalized ID from the layer registry
                        let normalizedId = layer._normalizedId;
                        if (!normalizedId && window.layerRegistry) {
                            normalizedId = window.layerRegistry.normalizeLayerId(layerId);
                        }

                        const layerObj = {
                            id: layerId,
                            _normalizedId: normalizedId
                        };

                        // Include opacity if it exists and is different from default (1)
                        if (layer.opacity !== undefined && layer.opacity !== 1) {
                            layerObj.opacity = layer.opacity;
                        }

                        activeLayers.push(layerObj);
                    }
                }
            }
        });

        return activeLayers;
    }

    // applyURLParameters() holds isUpdatingFromURL across its awaits, which can
    // be seconds, so a real state change landing inside that window (GPS
    // dropping its camera lock, say) must be held rather than dropped - the
    // flag is there to stop the URL being echoed back at itself while it's
    // being read, not to discard everything that happens meanwhile.
    get isUpdatingFromURL() { return this._isUpdatingFromURL === true; }

    set isUpdatingFromURL(value) {
        this._isUpdatingFromURL = value;
        if (value || !this._deferredURLOptions) return;
        const deferred = this._deferredURLOptions;
        this._deferredURLOptions = null;
        this.updateURL(deferred);
    }

    /**
     * Update URL with current layer state
     */
    updateURL(options = {}) {
        if (this.isUpdatingFromURL) {
            this._deferredURLOptions = { ...this._deferredURLOptions, ...options };
            return;
        }

        // Merge with any pending options so explicit nulls (e.g. export: null) aren't
        // lost when an unrelated update (e.g. updateLayers: true) arrives before the timer fires
        this._pendingURLOptions = { ...this._pendingURLOptions, ...options };

        if (this.pendingURLUpdate) {
            clearTimeout(this.pendingURLUpdate);
        }

        const mergedOptions = this._pendingURLOptions;
        this.pendingURLUpdate = setTimeout(() => {
            this._pendingURLOptions = {};
            this._performURLUpdate(mergedOptions);
        }, 300);
    }

    _performURLUpdate(options = {}) {
        const urlParams = new URLSearchParams(window.location.search);
        let hasChanges = false;
        let layersParam = null;
        let atlasParam = null;
        let geolocateParam = null;
        let searchParam = null;
        let terrainParam = null;
        let animateParam = null;
        let fogParam = null;
        let wireframeParam = null;
        let terrainSourceParam = null;
        let fovParam = null;
        let bearingParam = null;
        let pitchParam = null;
        let soundParam = null;
        let exportParam = null;
        let selectedParam = null;
        let markersParam = null;
        let compareParam = null;

        // Handle layers parameter
        if (options.updateLayers === true) {
            const activeLayers = this.getCurrentActiveLayers();
            const newLayersParam = this.serializeLayersForURL(activeLayers);
            const currentLayersParam = urlParams.get('layers');

            // Only update if the layers actually changed, not just formatting
            // This prevents reverting pretty URLs back to encoded versions
            if (newLayersParam !== currentLayersParam) {
                // Check if this is just a formatting difference (encoded vs unencoded)
                const normalizedNew = decodeURIComponent(newLayersParam || '');
                const normalizedCurrent = decodeURIComponent(currentLayersParam || '');

                if (normalizedNew !== normalizedCurrent) {
                    layersParam = newLayersParam;
                    hasChanges = true;
                }
            }
        }

        // Handle atlas parameter (preserve existing atlas config)
        if (options.atlas !== undefined) {
            if (options.atlas) {
                atlasParam = typeof options.atlas === 'string' ? options.atlas : JSON.stringify(options.atlas);
                if (urlParams.get('atlas') !== atlasParam) {
                    hasChanges = true;
                }
            } else {
                if (urlParams.has('atlas')) {
                    hasChanges = true;
                }
            }
        }

        // Handle geolocate parameter
        if (options.geolocate !== undefined) {
            const currentGeolocateParam = urlParams.get('geolocate');
            if (options.geolocate) {
                geolocateParam = 'true';
                if (currentGeolocateParam !== 'true') {
                    hasChanges = true;
                }
            } else {
                if (currentGeolocateParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle search query parameter
        if (options.search !== undefined) {
            const currentSearchParam = urlParams.get('q');
            if (options.search) {
                searchParam = options.search;
                if (currentSearchParam !== searchParam) {
                    hasChanges = true;
                }
            } else {
                if (currentSearchParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle terrain parameter
        if (options.terrain !== undefined) {
            const currentTerrainParam = urlParams.get('terrain');
            if (options.terrain !== null && options.terrain !== 0) {
                terrainParam = options.terrain.toString();
                if (currentTerrainParam !== terrainParam) {
                    hasChanges = true;
                }
            } else {
                // Remove parameter when disabled
                if (currentTerrainParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle animate parameter
        if (options.animate !== undefined) {
            const currentAnimateParam = urlParams.get('animate');
            if (options.animate) {
                animateParam = 'true';
                if (currentAnimateParam !== 'true') {
                    hasChanges = true;
                }
            } else {
                if (currentAnimateParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle fog parameter
        if (options.fog !== undefined) {
            const currentFogParam = urlParams.get('fog');
            if (options.fog === false) {
                // Only set fog parameter when it's explicitly disabled (default is true)
                fogParam = 'false';
                if (currentFogParam !== 'false') {
                    hasChanges = true;
                }
            } else {
                // Remove fog parameter when enabled (default behavior)
                if (currentFogParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle wireframe parameter
        if (options.wireframe !== undefined) {
            const currentWireframeParam = urlParams.get('wireframe');
            if (options.wireframe) {
                wireframeParam = 'true';
                if (currentWireframeParam !== 'true') {
                    hasChanges = true;
                }
            } else {
                if (currentWireframeParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle terrain source parameter
        if (options.terrainSource !== undefined) {
            const currentTerrainSourceParam = urlParams.get('terrainSource');
            if (options.terrainSource && options.terrainSource !== 'mapbox') {
                // Only set if not default (mapbox is default)
                terrainSourceParam = options.terrainSource;
                if (currentTerrainSourceParam !== terrainSourceParam) {
                    hasChanges = true;
                }
            } else {
                // Remove parameter when using default mapbox terrain
                if (currentTerrainSourceParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle fov parameter
        if (options.fov !== undefined) {
            const currentFovParam = urlParams.get('fov');
            // Only set if not default (0.643 is default)
            if (options.fov !== null && Math.abs(options.fov - 0.643) > 0.001) {
                fovParam = options.fov.toFixed(3);
                if (currentFovParam !== fovParam) {
                    hasChanges = true;
                }
            } else {
                // Remove parameter when using default FOV
                if (currentFovParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle bearing parameter
        if (options.bearing !== undefined) {
            const currentBearingParam = urlParams.get('bearing');
            // Only set if not default (0 is default)
            if (options.bearing !== null && Math.abs(options.bearing) > 0.1) {
                bearingParam = options.bearing.toFixed(0);
                if (currentBearingParam !== bearingParam) {
                    hasChanges = true;
                }
            } else {
                // Remove parameter when using default bearing
                if (currentBearingParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle pitch parameter
        if (options.pitch !== undefined) {
            const currentPitchParam = urlParams.get('pitch');
            // Only set if not default (0 is default)
            if (options.pitch !== null && Math.abs(options.pitch) > 0.1) {
                pitchParam = options.pitch.toFixed(0);
                if (currentPitchParam !== pitchParam) {
                    hasChanges = true;
                }
            } else {
                // Remove parameter when using default pitch
                if (currentPitchParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle sound parameter
        if (options.sound !== undefined) {
            const currentSoundParam = urlParams.get('sound');
            if (options.sound) {
                soundParam = 'true';
                if (currentSoundParam !== 'true') {
                    hasChanges = true;
                }
            } else {
                if (currentSoundParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle export parameter
        if (options.export !== undefined) {
            const currentExportParam = urlParams.get('export');
            if (options.export && typeof options.export === 'object') {
                exportParam = JSON.stringify(options.export);
                if (currentExportParam !== exportParam) {
                    hasChanges = true;
                }
            } else if (options.export === null) {
                if (currentExportParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // Handle compare parameter (layer currently swiped via mapbox-gl-compare)
        if (options.compare !== undefined) {
            const currentCompareParam = urlParams.get('compare');
            if (options.compare) {
                compareParam = options.compare;
                if (currentCompareParam !== compareParam) {
                    hasChanges = true;
                }
            } else {
                if (currentCompareParam !== null) {
                    hasChanges = true;
                }
            }
        }

        // The `selected=<layerId>:<featureId>` parameter is never written anymore —
        // every selection has a corresponding marker (see MapMarkerManager._handleSelection),
        // and a marker's location is enough to recover the same features by re-querying
        // that point once layers are loaded (see serializeMarkersForURL / restoreMarkersFromSelectionLayer),
        // so `selected=` would only duplicate what `markers=` already implies. Still
        // clear it if a stale one is present from an older URL.
        if (options.updateSelections && this.stateManager) {
            const currentSelectedParam = urlParams.get('selected');
            if (currentSelectedParam) {
                selectedParam = '';
                hasChanges = true;
            }
        }

        // Handle selection markers parameter (compact form of the selection layer geojson).
        // Marker changes arrive via updateLayers (marker manager) or updateSelections.
        if (options.updateLayers === true || options.updateSelections === true) {
            const newMarkersParam = this.serializeMarkersForURL();
            const currentMarkersParam = urlParams.get('markers') || '';

            if (newMarkersParam !== currentMarkersParam) {
                markersParam = newMarkersParam;
                hasChanges = true;
            }
        }

        // Update URL if there are changes
        if (hasChanges) {
            // Create a pretty, readable URL without URL encoding
            const baseUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
            const params = [];

            // Get other parameters (excluding the ones we manage)
            const otherParams = new URLSearchParams(window.location.search);
            otherParams.delete('layers');
            otherParams.delete('atlas');
            otherParams.delete('geolocate');
            otherParams.delete('q');
            otherParams.delete('terrain');
            otherParams.delete('animate');
            otherParams.delete('fog');
            otherParams.delete('wireframe');
            otherParams.delete('terrainSource');
            otherParams.delete('fov');
            otherParams.delete('bearing');
            otherParams.delete('pitch');
            otherParams.delete('sound');
            otherParams.delete('export');
            otherParams.delete('selected');
            otherParams.delete('markers');
            otherParams.delete('compare');

            // Add other parameters first (these will be URL-encoded by URLSearchParams)
            const otherParamsString = otherParams.toString();
            if (otherParamsString) {
                params.push(otherParamsString);
            }

            // Add atlas parameter if it exists (either new or preserved from current URL)
            const currentAtlas = atlasParam || (options.atlas === undefined ? urlParams.get('atlas') : null);
            if (currentAtlas) {
                // For atlas, we may need to preserve JSON, so add it manually
                params.push('atlas=' + encodeURIComponent(currentAtlas));
            }

            // Add layers parameter if present - this is the key fix for pretty URLs.
            // Encode only chars that would break the query string: `#` (fragment delimiter,
            // would truncate the URL — common in hex colors) and `&` (param separator).
            // Everything else is left readable.
            if (layersParam) {
                params.push('layers=' + layersParam.replace(/#/g, '%23').replace(/&/g, '%26'));
            } else if (options.updateLayers !== true) {
                // If we're not explicitly updating layers, preserve the current layers parameter as-is
                const currentLayersParam = urlParams.get('layers');
                if (currentLayersParam) {
                    params.push('layers=' + currentLayersParam.replace(/#/g, '%23').replace(/&/g, '%26'));
                }
            }

            // Add geolocate parameter if active (either new or preserved from current URL)
            const currentGeolocate = geolocateParam || (options.geolocate === undefined ? urlParams.get('geolocate') : null);
            if (currentGeolocate === 'true') {
                params.push('geolocate=true');
            }

            // Add search query parameter (either new or preserved from current URL)
            const currentSearch = searchParam !== null ? searchParam : (options.search === undefined ? urlParams.get('q') : null);
            if (currentSearch) {
                params.push('q=' + encodeURIComponent(currentSearch));
            }

            // Add terrain parameter (either new or preserved from current URL)
            const currentTerrain = terrainParam || (options.terrain === undefined ? urlParams.get('terrain') : null);
            if (currentTerrain && currentTerrain !== '0') {
                params.push('terrain=' + currentTerrain);
            }

            // Add animate parameter (either new or preserved from current URL)
            const currentAnimate = animateParam || (options.animate === undefined ? urlParams.get('animate') : null);
            if (currentAnimate === 'true') {
                params.push('animate=true');
            }

            // Add fog parameter (either new or preserved from current URL)
            const currentFog = fogParam || (options.fog === undefined ? urlParams.get('fog') : null);
            if (currentFog === 'false') {
                params.push('fog=false');
            }

            // Add wireframe parameter (either new or preserved from current URL)
            const currentWireframe = wireframeParam || (options.wireframe === undefined ? urlParams.get('wireframe') : null);
            if (currentWireframe === 'true') {
                params.push('wireframe=true');
            }

            // Add terrain source parameter (either new or preserved from current URL)
            const currentTerrainSource = terrainSourceParam || (options.terrainSource === undefined ? urlParams.get('terrainSource') : null);
            if (currentTerrainSource && currentTerrainSource !== 'mapbox') {
                params.push('terrainSource=' + currentTerrainSource);
            }

            // Add fov parameter (either new or preserved from current URL)
            const currentFov = fovParam || (options.fov === undefined ? urlParams.get('fov') : null);
            if (currentFov && Math.abs(parseFloat(currentFov) - 0.643) > 0.001) {
                params.push('fov=' + currentFov);
            }

            // Add bearing parameter (either new or preserved from current URL)
            const currentBearing = bearingParam || (options.bearing === undefined ? urlParams.get('bearing') : null);
            if (currentBearing && Math.abs(parseFloat(currentBearing)) > 0.1) {
                params.push('bearing=' + currentBearing);
            }

            // Add pitch parameter (either new or preserved from current URL)
            const currentPitch = pitchParam || (options.pitch === undefined ? urlParams.get('pitch') : null);
            if (currentPitch && Math.abs(parseFloat(currentPitch)) > 0.1) {
                params.push('pitch=' + currentPitch);
            }

            // Add sound parameter (either new or preserved from current URL)
            const currentSound = soundParam || (options.sound === undefined ? urlParams.get('sound') : null);
            if (currentSound === 'true') {
                params.push('sound=true');
            }

            // Add export parameter (either new or preserved from current URL)
            const currentExport = exportParam || (options.export === undefined ? urlParams.get('export') : null);
            if (currentExport && currentExport !== 'null') {
                params.push('export=' + encodeURIComponent(currentExport));
            }

            // Add selected features parameter
            if (selectedParam !== null && selectedParam !== '') {
                params.push('selected=' + selectedParam);
            } else if (options.updateSelections !== true) {
                // If we're not explicitly updating selections, preserve existing parameter
                const currentSelectedParam = urlParams.get('selected');
                if (currentSelectedParam) {
                    params.push('selected=' + currentSelectedParam);
                }
            }

            // Add selection markers parameter (compact selection layer geojson).
            // markersParam === '' means cleared (omit); null means unchanged (preserve existing).
            if (markersParam !== null && markersParam !== '') {
                params.push('markers=' + markersParam);
            } else if (markersParam === null) {
                const currentMarkersParam = urlParams.get('markers');
                if (currentMarkersParam) {
                    params.push('markers=' + currentMarkersParam);
                }
            }

            // Add compare parameter (either new or preserved from current URL)
            const currentCompare = compareParam || (options.compare === undefined ? urlParams.get('compare') : null);
            if (currentCompare) {
                params.push('compare=' + encodeURIComponent(currentCompare));
            }

            // Build the final pretty URL
            let newUrl = baseUrl;
            if (params.length > 0) {
                newUrl += '?' + params.join('&');
            }

            // Add hash if it exists
            if (window.location.hash) {
                newUrl += window.location.hash;
            }

            window.history.replaceState(null, '', newUrl);

            // Trigger custom event for other components (like ShareLink)
            window.dispatchEvent(new CustomEvent('urlUpdated', {
                detail: { url: newUrl, activeLayers: this.getCurrentActiveLayers() }
            }));

            this._notifyParentOfURL();
        }
    }

    /**
     * Serialize active layers for URL parameter
     */
    serializeLayersForURL(layers) {
        if (!layers || layers.length === 0) {
            return '';
        }

        return layers.map(layer => this.layerToURL(layer)).join(',');
    }

    parseSelectionsFromURL(selectedParam) {
        if (!selectedParam) {
            return new Map();
        }

        const selectionsByLayer = new Map();

        const layerSegments = selectedParam.split(';');
        layerSegments.forEach(segment => {
            const colonIndex = segment.indexOf(':');
            if (colonIndex === -1) {
                console.warn(`Invalid selection segment: ${segment}`);
                return;
            }

            const layerId = segment.substring(0, colonIndex);
            const featureIdsStr = segment.substring(colonIndex + 1);
            const featureIds = featureIdsStr.split(',').map(id => id.trim()).filter(id => id);

            if (layerId && featureIds.length > 0) {
                selectionsByLayer.set(layerId, featureIds);
            }
        });

        return selectionsByLayer;
    }

    /**
     * Serialize every live marker into a compact `markers=` param of
     * `marker-<id>(lng,lat[,name][,description])` calls (see
     * marker-registry.js's buildMarkersParam) - one per marker currently
     * registered there, which map-marker-manager.js keeps current as markers
     * are added, moved, or renamed. This includes route waypoint markers too
     * (not just plain selections): a route's `route-<rid>:` shorthand now
     * references these same ids (search/route-store.js), so they must be
     * present here for a shared link to resolve them.
     *
     * The features present at each marker are recovered on load by
     * re-querying that point once its layers are ready (see
     * MapMarkerManager.restoreMarkersFromSelectionLayer), exactly as if the
     * user clicked there, so there's nothing else to duplicate here.
     */
    serializeMarkersForURL() {
        return buildMarkersParam(allRegisteredMarkers());
    }

    /**
     * Parse a `markers=` param (marker-<id>(lng,lat[,name][,description])
     * calls - see marker-registry.js's parseMarkersParam) back into a
     * selection-layer FeatureCollection. Inverse of serializeMarkersForURL.
     */
    parseMarkersFromURL(markersParam) {
        const geojson = { type: 'FeatureCollection', features: [] };
        if (!markersParam) {
            return geojson;
        }

        parseMarkersParam(markersParam).forEach(entry => {
            geojson.features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [entry.lng, entry.lat] },
                properties: { id: `marker-url-${entry.id}`, urlId: entry.id, name: entry.name, description: entry.description }
            });
        });

        return geojson;
    }

    /**
     * Update URL when layers change
     */
    onLayersChanged() {
        if (this.mapLayerControl?._initializingLayers) return;
        this.updateURL({ updateLayers: true });
    }

    /**
     * Apply URL parameters to layer control (called on page load)
     */
    async applyURLParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const layersParam = urlParams.get('layers');
        const geolocateParam = urlParams.get('geolocate');
        const searchParam = urlParams.get('q');
        const terrainParam = urlParams.get('terrain');
        const animateParam = urlParams.get('animate');
        const fogParam = urlParams.get('fog');
        const wireframeParam = urlParams.get('wireframe');
        const terrainSourceParam = urlParams.get('terrainSource');
        const fovParam = urlParams.get('fov');
        const bearingParam = urlParams.get('bearing');
        const pitchParam = urlParams.get('pitch');
        const selectedParam = urlParams.get('selected');
        const markersParam = urlParams.get('markers');
        const compareParam = urlParams.get('compare');
        const hasLocationClick = urlParams.has('selected') && selectedParam === '';
        const zoomToParam = urlParams.get('zoomTo');

        // Debug: surface every supported URL API parameter present in the URL on
        // load, so it's easy to confirm the URL API parsed as expected. URL_API_PARAMS
        // is the single source of truth, kept in sync with the "## Parameters" section
        // of docs/API.md by js/tests/url-api-docs.test.js.
        const presentParams = {};
        for (const key of URL_API_PARAMS) {
            const value = urlParams.get(key);
            if (value !== null) presentParams[key] = value;
        }
        if (Object.keys(presentParams).length > 0) {
            console.log('[URL API] Parameters parsed on load:', presentParams);
        }

        // Surface query params that aren't part of the URL API so typos or
        // unsupported params are visible rather than silently ignored. Note this
        // reads the current URL, which startup (atlas/location auto-selection in
        // splash-screen-manager.js) may already have rewritten — check that log too
        // if a param you passed is missing here.
        const unsupportedParams = {};
        for (const [key, value] of urlParams.entries()) {
            if (!URL_API_PARAMS.includes(key)) unsupportedParams[key] = value;
        }
        if (Object.keys(unsupportedParams).length > 0) {
            console.warn('[URL API] Unsupported parameters ignored:', unsupportedParams);
        }

        if (!layersParam && !geolocateParam && !searchParam && !terrainParam && !animateParam && !fogParam && !wireframeParam && !terrainSourceParam && !fovParam && !bearingParam && !pitchParam && !selectedParam && !markersParam && !compareParam && !hasLocationClick && !zoomToParam) {
            return false;
        }

        this.isUpdatingFromURL = true;
        let applied = false;

        try {

            // Wait for map and layer control to be ready
            await this.waitForMapReady();

            // Parse layers from URL
            if (layersParam) {
                // Check if layers were already processed during initialization
                // If the layer control already has layers loaded, skip re-processing
                if (this.mapLayerControl && this.mapLayerControl._state && this.mapLayerControl._state.groups.length > 0) {
                    applied = true;
                } else {
                    const urlLayers = this.parseLayersFromUrl(layersParam);
                    // Apply the layer state
                    applied = await this.applyLayerState(urlLayers);
                }
            }

            // Handle geolocate parameter
            if (geolocateParam === 'true') {
                applied = true;
                this.triggerGeolocation();
            }

            // Handle search query parameter
            if (searchParam && window.searchControl) {
                applied = true;
                window.searchControl.setQueryFromURL(searchParam);
            }

            // Handle terrain parameter
            if (terrainParam && window.terrain3DControl) {
                applied = true;
                const exaggeration = parseFloat(terrainParam);
                if (!isNaN(exaggeration)) {
                    if (exaggeration === 0) {
                        window.terrain3DControl.setEnabled(false);
                    } else {
                        window.terrain3DControl.setExaggeration(exaggeration);
                        window.terrain3DControl.setEnabled(true);
                    }
                }
            }

            // Handle animate parameter
            if (animateParam && window.terrain3DControl) {
                applied = true;
                if (animateParam === 'true') {
                    window.terrain3DControl.setAnimate(true);
                } else {
                    window.terrain3DControl.setAnimate(false);
                }
            }

            // Handle fog parameter
            if (fogParam && window.terrain3DControl) {
                applied = true;
                if (fogParam === 'false') {
                    window.terrain3DControl.setFog(false);
                } else {
                    window.terrain3DControl.setFog(true);
                }
            }

            // Handle wireframe parameter
            if (wireframeParam && window.terrain3DControl) {
                applied = true;
                if (wireframeParam === 'true') {
                    window.terrain3DControl.setWireframe(true);
                } else {
                    window.terrain3DControl.setWireframe(false);
                }
            }

            // Handle terrain source parameter
            if (terrainSourceParam && window.terrain3DControl) {
                applied = true;
                window.terrain3DControl.setTerrainSource(terrainSourceParam);
            }

            // Handle fov parameter
            if (fovParam && window.terrain3DControl) {
                applied = true;
                const fov = parseFloat(fovParam);
                if (!isNaN(fov) && fov >= 0.1 && fov <= 1.5) {
                    window.terrain3DControl.setFov(fov);
                }
            }

            // Handle bearing parameter
            if (bearingParam && window.terrain3DControl) {
                applied = true;
                const bearing = parseFloat(bearingParam);
                if (!isNaN(bearing)) {
                    window.terrain3DControl.setBearing(bearing);
                }
            }

            // Handle pitch parameter
            if (pitchParam && window.terrain3DControl) {
                applied = true;
                const pitch = parseFloat(pitchParam);
                if (!isNaN(pitch) && pitch >= 0 && pitch <= 85) {
                    window.terrain3DControl.setPitch(pitch);
                }
            }

            // Handle selected features parameter
            // markers= is the more specific/authoritative param — a bare `selected`
            // flag is redundant noise when markers= is present and must not hijack
            // this branch into firing a single synthetic click instead of restoring
            // every marker.
            if (hasLocationClick && window.location.hash && !markersParam) {
                applied = true;
                await this.applyLocationClickFromURL();
            } else if ((markersParam || selectedParam) && this.stateManager) {
                applied = true;

                let markersRestored = false;
                const markerManager = window.featureControl?._markerManager;

                if (markerManager) {
                    try {
                        if (markersParam) {
                            // Preferred path: rebuild the selection layer geojson from the
                            // compact `markers=` param, then restore markers + selections from it.
                            const selectionGeojson = this.parseMarkersFromURL(markersParam);
                            const selectionGroup = window.layerControl?._state?.groups?.find(g => g.id === 'selection');
                            if (selectionGroup) {
                                selectionGroup.geojson = selectionGeojson;
                            }
                            markersRestored = await markerManager.restoreMarkersFromSelectionLayer();
                            if (markersRestored) {
                                // restoreMarkersFromSelectionLayer creates each marker through the
                                // normal click pipeline, which has no way to thread the id `markers=`
                                // actually asked for through to it - reconcile them back, then recolor
                                // whichever of those markers a `route-<rid>:` layer references as a
                                // waypoint (see route-url-api.js's `_waypointMarkerIds`, resolved
                                // earlier in map-init.js, long before these markers existed).
                                markerManager.reconcileMarkerUrlIds(parseMarkersParam(markersParam));
                                markerManager.applyRouteWaypointStyling();
                            }
                        } else {
                            // Backward compatibility: older shared URLs inlined the selection
                            // geojson in the layers= param, which is already on the layer group.
                            markersRestored = await markerManager.restoreMarkersFromSelectionLayer();
                            if (markersRestored) {
                                console.log('[URL API] Successfully restored markers from inline selection layer geojson');
                            }
                        }
                    } catch (error) {
                        console.warn('[URL API] Error restoring markers:', error);
                    }
                }

                // If markers were not restored, fall back to the selected= parameter
                if (!markersRestored && selectedParam) {
                    console.log('[URL API] Restoring selections from selected parameter');
                    await this.applySelectionsFromURL(selectedParam);
                }
            }

            // Handle compare parameter - swipe-compare the given layer
            if (compareParam) {
                applied = true;
                this.applyCompareFromURL(compareParam);
            }

            // Handle zoomTo parameter - zoom to newly added layer
            const zoomToParam = urlParams.get('zoomTo');
            if (zoomToParam && this.mapLayerControl) {
                applied = true;
                const layerId = zoomToParam;

                // Find the layer in the layer control
                const layer = this.mapLayerControl._state.groups.find(g => g.id === layerId);

                if (layer && layer.bbox && Array.isArray(layer.bbox) && layer.bbox.length === 4) {
                    console.log('[URL API] Zooming to newly added layer:', layerId, 'bbox:', layer.bbox);

                    // Wait a bit for the layer to be fully loaded on the map
                    setTimeout(() => {
                        try {
                            const [minLng, minLat, maxLng, maxLat] = layer.bbox;
                            this.map.fitBounds(
                                [[minLng, minLat], [maxLng, maxLat]],
                                {
                                    padding: 50,
                                    maxZoom: 16,
                                    duration: 1000
                                }
                            );

                            // Remove zoomTo parameter from URL after zooming
                            const url = new URL(window.location);
                            url.searchParams.delete('zoomTo');
                            window.history.replaceState({}, '', url);
                        } catch (error) {
                            console.error('[URL API] Error zooming to layer bbox:', error);
                        }
                    }, 500);
                } else {
                    console.warn('[URL API] Layer not found or has no bbox:', layerId);
                }
            }

        } catch (error) {
            console.error('🔗 Error applying URL parameters:', error);
        } finally {
            this.isUpdatingFromURL = false;
        }

        return applied;
    }

    /**
     * Toggle swipe-comparison for a layer named in the URL (?compare=<layer-id>).
     * Waits until the feature control exists and the layer's sublayers are on the
     * map before enabling, since the compare clone reads the live map style.
     */
    applyCompareFromURL(layerId, attempt = 0) {
        const maxAttempts = 20; // ~6s at 300ms intervals

        const layerOnMap = () => {
            const style = this.map && this.map.getStyle && this.map.getStyle();
            return !!(style && style.layers && style.layers.some(l => l.metadata && l.metadata.groupId === layerId));
        };

        if (window.featureControl && layerOnMap()) {
            window.featureControl._toggleCompare(layerId, true);
            return;
        }

        if (attempt >= maxAttempts) {
            console.warn('[URL API] compare layer not available, giving up:', layerId);
            return;
        }

        setTimeout(() => this.applyCompareFromURL(layerId, attempt + 1), 300);
    }

    async applySelectionsFromURL(selectedParam) {
        if (!this.stateManager) {
            console.warn('[URL API] State manager not available for applying selections');
            return;
        }

        const selectionsByLayer = this.parseSelectionsFromURL(selectedParam);
        if (selectionsByLayer.size === 0) {
            return;
        }

        const layersReady = await this.waitForLayersReady(Array.from(selectionsByLayer.keys()));

        if (!layersReady) {
            console.warn('[URL API] Not all layers ready, attempting selection anyway');
        }

        await this.waitForMapIdle();

        const sources = [];
        selectionsByLayer.forEach((featureIds, layerId) => {
            const layerConfig = this.stateManager.getLayerConfig(layerId);
            if (layerConfig) {
                const sourceId = layerConfig.source || `${layerConfig.type}-${layerId}`;
                if (!sources.includes(sourceId)) {
                    sources.push(sourceId);
                }
            }
        });

        await this.waitForSourceData(sources);

        const allSelectedFeatures = [];

        for (const [layerId, featureIds] of selectionsByLayer.entries()) {
            if (!this.stateManager.isLayerRegistered(layerId)) {
                console.warn(`[URL API] Layer ${layerId} not registered, skipping selections`);
                continue;
            }

            const layerConfig = this.stateManager.getLayerConfig(layerId);
            if (!layerConfig) {
                console.warn(`[URL API] Layer config not found for ${layerId}`);
                continue;
            }

            for (const rawFeatureId of featureIds) {
                const selectedFeature = await this.selectFeatureFromURL(layerId, rawFeatureId, layerConfig);
                if (selectedFeature) {
                    allSelectedFeatures.push(selectedFeature);
                }
            }
        }

        if (allSelectedFeatures.length > 0) {
            this.stateManager._updateLineSortKeys();

            // Execute inspection handlers and emit events for each selected feature
            for (const selectedFeature of allSelectedFeatures) {
                const { feature, featureId, layerId, lngLat } = selectedFeature;

                // Execute inspection handler if configured
                await this.stateManager._executeInspectionHandler(feature, layerId, lngLat);

                // Emit individual feature-click event for each feature
                // This ensures the iframe receives the feature data
                this.stateManager._emitStateChange('feature-click', {
                    feature,
                    featureId,
                    layerId,
                    lngLat,
                    fromURL: true
                });
            }

            this.stateManager._emitStateChange('feature-click-multiple', {
                selectedFeatures: allSelectedFeatures,
                clearedFeatures: [],
                fromURL: true
            });
        }
    }

    async applyLocationClickFromURL() {
        const hash = window.location.hash;
        if (!hash) return;

        const parts = hash.replace('#', '').split('/');
        if (parts.length < 3) return;

        const lat = parseFloat(parts[1]);
        const lng = parseFloat(parts[2]);
        if (isNaN(lat) || isNaN(lng)) return;

        await this.waitForMapIdle(8000);

        const point = this.map.project([lng, lat]);
        this.map.fire('click', { lngLat: { lng, lat }, point });
    }

    async waitForMapIdle(timeout = 3000) {
        return new Promise((resolve) => {
            if (this.map.loaded() && this.map.areTilesLoaded()) {
                resolve();
                return;
            }

            const timeoutId = setTimeout(() => {
                resolve();
            }, timeout);

            const onIdle = () => {
                clearTimeout(timeoutId);
                this.map.off('idle', onIdle);
                resolve();
            };

            this.map.once('idle', onIdle);
        });
    }

    async waitForSourceData(sourceIds, timeout = 5000) {
        return new Promise((resolve) => {
            const loadedSources = new Set();
            const startTime = Date.now();

            const checkSources = () => {
                for (const sourceId of sourceIds) {
                    if (loadedSources.has(sourceId)) continue;

                    const source = this.map.getSource(sourceId);
                    if (!source) continue;

                    if (source.type === 'geojson' && source._data) {
                        loadedSources.add(sourceId);
                    } else if (source.type === 'vector' && this.map.isSourceLoaded(sourceId)) {
                        loadedSources.add(sourceId);
                    } else if (source.type === 'raster' && this.map.isSourceLoaded(sourceId)) {
                        loadedSources.add(sourceId);
                    }
                }

                if (loadedSources.size === sourceIds.length) {
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    const notLoaded = sourceIds.filter(id => !loadedSources.has(id));
                    console.warn(`[URL API] Timeout waiting for sources: ${notLoaded.join(', ')}`);
                    resolve();
                } else {
                    requestAnimationFrame(checkSources);
                }
            };

            checkSources();
        });
    }

    async waitForLayersReady(layerIds, timeout = 10000) {
        const startTime = Date.now();
        const checkInterval = 200;

        return new Promise((resolve) => {
            const checkLayers = () => {
                if (!this.stateManager) {
                    console.warn('[URL API] State manager not available');
                    resolve(false);
                    return;
                }

                const readyLayers = layerIds.filter(layerId =>
                    this.stateManager.isLayerRegistered(layerId)
                );

                const allReady = readyLayers.length === layerIds.length;

                if (allReady) {
                    resolve(true);
                } else if (Date.now() - startTime > timeout) {
                    const notReady = layerIds.filter(id => !readyLayers.includes(id));
                    console.warn(`[URL API] Timeout waiting for layers: ${notReady.join(', ')}`);
                    resolve(false);
                } else {
                    setTimeout(checkLayers, checkInterval);
                }
            };

            checkLayers();
        });
    }

    async selectFeatureFromURL(layerId, rawFeatureId, layerConfig, retries = 3, retryDelay = 500) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const features = this.map.querySourceFeatures(
                    layerConfig.source || `${layerConfig.type}-${layerId}`,
                    {
                        sourceLayer: layerConfig.sourceLayer
                    }
                );

                const matchingFeature = features.find(f => {
                    if (f.id !== undefined && f.id !== null && f.id.toString() === rawFeatureId.toString()) {
                        return true;
                    }
                    if (f.properties?.id !== undefined && f.properties?.id !== null && f.properties.id.toString() === rawFeatureId.toString()) {
                        return true;
                    }
                    if (f.properties?.fid !== undefined && f.properties?.fid !== null && f.properties.fid.toString() === rawFeatureId.toString()) {
                        return true;
                    }
                    return false;
                });

                if (matchingFeature) {
                    const featureId = this.stateManager._getFeatureId(matchingFeature);
                    const compositeKey = this.stateManager._getCompositeKey(layerId, featureId);

                    this.stateManager._updateFeatureState(compositeKey, {
                        feature: matchingFeature,
                        layerId,
                        isSelected: true,
                        timestamp: Date.now()
                    });

                    this.stateManager._selectedFeatures.add(compositeKey);
                    this.stateManager._setMapboxFeatureState(featureId, layerId, { selected: true });

                    const lngLat = this._lngLatFromGeometry(matchingFeature.geometry);

                    return {
                        featureId,
                        layerId,
                        feature: matchingFeature,
                        lngLat
                    };
                }

                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            } catch (error) {
                console.warn(`[URL API] Error selecting feature ${rawFeatureId} from layer ${layerId} (attempt ${attempt + 1}/${retries + 1}):`, error);
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            }
        }

        console.warn(`[URL API] Feature ${rawFeatureId} not found in layer ${layerId} after ${retries + 1} attempts`);
        return null;
    }

    _lngLatFromGeometry(geometry) {
        if (!geometry) return null;
        const { type, coordinates } = geometry;
        if (type === 'Point') {
            return { lng: coordinates[0], lat: coordinates[1] };
        }
        if (type === 'LineString' && coordinates.length > 0) {
            const mid = coordinates[Math.floor(coordinates.length / 2)];
            return { lng: mid[0], lat: mid[1] };
        }
        if ((type === 'Polygon' || type === 'MultiPolygon') && coordinates.length > 0) {
            const ring = type === 'Polygon' ? coordinates[0] : coordinates[0][0];
            if (!ring || ring.length === 0) return null;
            const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
            const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
            return { lng, lat };
        }
        return null;
    }

    /**
     * Wait for map and layer control to be ready.
     *
     * Deliberately checks `isStyleLoaded()`, NOT `map.loaded()` — the latter (per
     * Mapbox GL JS) only returns true once every source in the style has finished
     * loading, which stays false for as long as ANY layer (a slow satellite basemap,
     * a multi-tab Google Sheet, ...) is still being added by
     * MapLayerControl._initializeAllLayers()'s serial add loop. Since URLManager is
     * constructed from inside map-init.js's own map.on('load') handler, the style
     * itself is already parsed by the time this runs; waiting on `map.loaded()` here
     * used to block applyURLParameters() — and therefore
     * MapMarkerManager.restoreMarkersFromSelectionLayer()'s marker restoration — for
     * as long as the slowest layer in the whole URL took to finish, defeating the
     * point of that per-layer streaming restore.
     */
    async waitForMapReady() {
        return new Promise((resolve) => {
            const checkReady = () => {
                if (this.map && this.map.isStyleLoaded() && this.mapLayerControl && this.mapLayerControl._state) {
                    resolve();
                } else {
                    setTimeout(checkReady, 100);
                }
            };
            checkReady();
        });
    }

    /**
     * Apply layer state from URL parameters
     */
    async applyLayerState(urlLayers) {
        // This would need to be implemented based on the specific layer control logic
        // For now, return true to indicate success
        return true;
    }

    /**
     * Set up browser history handling (back/forward buttons)
     */
    setupHistoryHandling() {
        window.addEventListener('popstate', (event) => {
            this.applyURLParameters();
        });
    }

    /**
     * Get current URL with all parameters
     */
    getCurrentURL() {
        return window.location.href;
    }

    /**
     * Get shareable URL for current state
     */
    getShareableURL() {
        // Return current URL which should already have the latest layer state
        return this.getCurrentURL();
    }

    /**
     * Initialize event listeners on the layer control
     */
    initializeLayerControlListeners() {
        if (!this.mapLayerControl) {
            console.warn('🔗 MapLayerControl not available for URL sync');
            return;
        }

        // Listen for layer toggle events
        // We'll need to patch into the layer control's toggle methods
        this.patchLayerControlMethods();
    }

    /**
     * Patch layer control methods to trigger URL updates
     */
    patchLayerControlMethods() {
        if (!this.mapLayerControl) return;

        // Store original method
        const originalToggleSourceControl = this.mapLayerControl._toggleSourceControl;

        // Patch the toggle method
        this.mapLayerControl._toggleSourceControl = (groupIndex, visible) => {
            // Call original method
            const result = originalToggleSourceControl.call(this.mapLayerControl, groupIndex, visible);

            // Update URL after layer change
            if (!this.isUpdatingFromURL) {
                this.onLayersChanged();
            }

            return result;
        };

    }

    /**
     * Listen for layer control events using DOM event delegation
     */
    setupLayerControlEventListeners() {
        // Prevent duplicate listener registration
        if (this._listenersRegistered) {
            return;
        }
        this._listenersRegistered = true;

        // Listen for checkbox changes in layer controls
        $(document).on('change', '.toggle-switch input[type="checkbox"]', () => {
            if (!this.isUpdatingFromURL) {
                this.onLayersChanged();
            }
        });

        // Listen for sl-show/sl-hide events on layer groups
        $(document).on('sl-show sl-hide', 'sl-details', () => {
            if (!this.isUpdatingFromURL) {
                this.onLayersChanged();
            }
        });

        // Listen for cross-atlas layer events
        $(document).on('sl-show sl-hide', '.cross-atlas-layer', () => {
            if (!this.isUpdatingFromURL) {
                this.onLayersChanged();
            }
        });

        // Listen for state manager events to catch layer registration/unregistration
        if (window.stateManager) {
            this._stateManagerListener = (event) => {
                const { eventType } = event.detail;
                if (eventType === 'layer-registered' || eventType === 'layer-unregistered') {
                    if (!this.isUpdatingFromURL) {
                        // Use a small delay to ensure the layer control state is updated
                        setTimeout(() => {
                            this.onLayersChanged();
                        }, 50);
                    }
                }
            };
            window.stateManager.addEventListener('state-change', this._stateManagerListener);
        } else {
            // Set up a delayed check for state manager
            setTimeout(() => {
                if (window.stateManager && !this._stateManagerListener) {
                    this._listenersRegistered = false; // Allow re-registration
                    this.setupLayerControlEventListeners();
                }
            }, 1000);
        }

        // Listen for custom layer toggle events
        this._layerToggledListener = (event) => {
            if (!this.isUpdatingFromURL) {
                this.onLayersChanged();
            }
        };
        window.addEventListener('layer-toggled', this._layerToggledListener);

    }

    /**
     * Manual sync method for external use
     */
    syncURL() {
        this.updateURL({ updateLayers: true });
    }

    /**
     * Trigger geolocation from URL parameter
     */
    triggerGeolocation() {
        $(document).trigger('url_updated', {geolocate: true});
    }

    /**
     * Update geolocate parameter in URL
     */
    updateGeolocateParam = (event, param) => {
        this.updateURL({geolocate: param.geolocate});
    }

    /**
     * Update terrain parameter in URL
     */
    updateTerrainParam(exaggeration) {
        this.updateURL({ terrain: exaggeration, updateLayers: false });
    }

    /**
     * Update animate parameter in URL
     */
    updateAnimateParam(animate) {
        this.updateURL({ animate: animate, updateLayers: false });
    }

    /**
     * Update fog parameter in URL
     */
    updateFogParam(enableFog) {
        this.updateURL({ fog: enableFog, updateLayers: false });
    }

    /**
     * Update wireframe parameter in URL
     */
    updateWireframeParam(showWireframe) {
        this.updateURL({ wireframe: showWireframe, updateLayers: false });
    }

    /**
     * Update terrain source parameter in URL
     */
    updateTerrainSourceParam(terrainSource) {
        this.updateURL({ terrainSource: terrainSource, updateLayers: false });
    }

    /**
     * Update search query parameter in URL
     */
    updateSearchParam(query) {
        this.updateURL({ search: query || '', updateLayers: false });
    }

    /**
     * Update fov parameter in URL
     */
    updateFovParam(fov) {
        this.updateURL({ fov: fov, updateLayers: false });
    }

    /**
     * Update bearing parameter in URL
     */
    updateBearingParam(bearing) {
        this.updateURL({ bearing: bearing, updateLayers: false });
    }

    /**
     * Update pitch parameter in URL
     */
    updatePitchParam(pitch) {
        this.updateURL({ pitch: pitch, updateLayers: false });
    }

    /**
     * Update sound parameter in URL
     */
    updateSoundParam(visualizeSound) {
        this.updateURL({ sound: visualizeSound, updateLayers: false });
    }

    /**
     * Update export parameter in URL
     */
    updateExportParam(exportSettings) {
        this.updateURL({ export: exportSettings, updateLayers: false });
    }

    /**
     * Update compare parameter in URL (pass null/'' to remove)
     */
    updateCompareParam(layerId) {
        this.updateURL({ compare: layerId || null, updateLayers: false });
    }
}
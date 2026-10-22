/**
 * MapBrowserControl - hosts the map console (via LayerStackStrip, which mounts
 * js/map-control-bar.js) and the side panel that holds the layer editor and
 * creator (map-creator.html). Browsing maps and atlases happens in the
 * console's Find mode; this control keeps the layer/atlas actions Find calls
 * (_handleLayerToggle, switchAtlasLive, previews) and the panel.
 */
import { MapContextMessagesControl } from './map-context-messages-control.js';
import { ZoomToParam } from './zoom-to-param.js';
import { LayerStackStrip } from './layer-stack-strip.js';
import { LayerOrderManager } from './layer-order-manager.js';
import { atlasPinsUrl } from './atlas-pins.js';

export class MapBrowserControl {
    constructor() {
        this._container = null;
        this._button = null;
        this._map = null;
        this._overlay = null;
        this._browserContainer = null;
        this._iframe = null;
        this._isOpen = false;
        this._pendingFileData = null;
        // Id of the layer live-added to the real map/registry while the
        // creator's preview is showing it (see _handleCreatorLivePreview) —
        // null once it's finalized via "Add Map Layer" or removed via Cancel.
        this._creatorDraftLayerId = null;
        this._creatorLivePreviewPromise = null;
        this._overpassPreviewQuery = null;
        // Editing an existing layer in the creator: the layer is swapped for a
        // live draft while it is edited, so what it was (config and place in
        // the stack) is kept to put back on Cancel. See _beginEditSession.
        this._pendingEditLayer = null;
        this._editSession = null;
        this._layerStack = new LayerStackStrip();
        this._setupMessageListener();
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'map-browser-control';

        this._button = document.createElement('button');
        this._button.className = 'map-browser-btn flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white rounded transition-colors border border-gray-700 text-sm font-medium';
        this._button.type = 'button';
        this._button.setAttribute('aria-label', 'Browse all maps');
        this._button.title = 'Browse all maps';

        this._updateButtonState(false);

        this._button.addEventListener('click', () => {
            this.toggleBrowser();
        });

        // The console (bar, Find and the on-map list) is mounted by the layer
        // stack, which repaints on every 'idle' as well as on layer/URL
        // changes: the layer control builds its groups well after this control
        // is added, and 'idle' is the one signal guaranteed to fire after it.
        this._layerStack.mount(this._container, { browserButton: this._button, map });
        map.on('idle', () => this._layerStack.render());

        this._createOverlay();

        return this._container;
    }

    _createOverlay() {
        const header = document.querySelector('.header-nav');
        const headerHeight = header ? header.offsetHeight : 0;

        this._overlay = document.createElement('div');
        this._overlay.style.cssText = `
            position: fixed;
            top: ${headerHeight}px;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 999;
            display: none;
            pointer-events: none;
        `;

        this._browserContainer = document.createElement('div');
        this._browserContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #1f2937;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            border-left: 1px solid #374151;
            border-right: 1px solid #374151;
            border-bottom: 1px solid #374151;
            border-top: none;
            pointer-events: auto;
        `;

        if (window.matchMedia('(min-width: 768px)').matches) {
            this._browserContainer.style.width = '40%';
        } else {
            this._browserContainer.style.width = '75%';
        }

        const updateLayout = () => {
            const header = document.querySelector('.header-nav');
            const headerHeight = header ? header.offsetHeight : 0;
            this._overlay.style.top = `${headerHeight}px`;

            if (window.matchMedia('(min-width: 768px)').matches) {
                this._browserContainer.style.width = '40%';
            } else {
                this._browserContainer.style.width = '75%';
            }
        };

        window.addEventListener('resize', updateLayout);

        // Create loading overlay in parent
        this._loadingOverlay = document.createElement('div');
        this._loadingOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: #111827;
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 10;
            flex-direction: column;
            gap: 16px;
        `;

        const spinner = document.createElement('div');
        spinner.style.cssText = `
            width: 40px;
            height: 40px;
            border: 4px solid #374151;
            border-top-color: #3b82f6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        `;

        const loadingText = document.createElement('div');
        loadingText.style.cssText = 'color: #9ca3af; font-size: 14px;';
        loadingText.textContent = 'Loading map collection...';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = 'Cancel';
        cancelButton.style.cssText = 'color: #d1d5db; background: #374151; border: none; border-radius: 4px; padding: 6px 14px; font-size: 13px; cursor: pointer;';
        cancelButton.addEventListener('click', () => this.closeBrowser());

        this._loadingOverlay.appendChild(spinner);
        this._loadingOverlay.appendChild(loadingText);
        this._loadingOverlay.appendChild(cancelButton);
        this._browserContainer.appendChild(this._loadingOverlay);

        // Add spin animation
        const style = document.createElement('style');
        style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
        document.head.appendChild(style);

        this._overlay.appendChild(this._browserContainer);
        document.body.appendChild(this._overlay);

        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) {
                this.closeBrowser();
            }
        });
    }

    _updateButtonState(isOpen) {
        if (isOpen) {
            this._button.classList.add('active');
        } else {
            this._button.classList.remove('active');
        }
        // Geometry belongs to the stack's CSS; only the badge-anchoring context
        // is set here, since this runs again on every open/close.
        this._button.style.cssText = 'position: relative;';
        // Icon only: the button is a 36px cell in the layer stack, and the hover
        // label carries the name.
        this._button.innerHTML = '<sl-icon name="stack"></sl-icon>';
    }

    _showLoadingOverlay() {
        if (!this._loadingOverlay) return;
        this._loadingOverlay.style.display = 'flex';
        clearTimeout(this._loadingTimeout);
        this._loadingTimeout = setTimeout(() => this._hideLoadingOverlay(), 8000);
    }

    _hideLoadingOverlay() {
        clearTimeout(this._loadingTimeout);
        if (this._loadingOverlay) this._loadingOverlay.style.display = 'none';
    }

    _ensureIframe() {
        if (this._iframe) return;

        this._iframe = document.createElement('iframe');
        this._iframe.src = 'about:blank';
        this._iframe.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
        `;

        this._browserContainer.appendChild(this._iframe);
    }

    _setupMessageListener() {
        window.addEventListener('message', (event) => {
            if (event.data.type === 'request-layer-data') {
                if (window.layerRegistry?.ensureAllAtlasesLoaded) {
                    window.layerRegistry.ensureAllAtlasesLoaded().then(() => this._sendLayerData());
                } else {
                    this._sendLayerData();
                }
            }

            if (event.data.type === 'layer-toggle') {
                this._handleLayerToggle(event.data.layerId, event.data.active);
            }

            if (event.data.type === 'close-browser') {
                this.closeBrowser();
            }

            if (event.data.type === 'open-creator') {
                this._switchToCreator();
            }

            if (event.data.type === 'creator-use-layer') {
                this._useRegistryLayer(event.data.layerId, !!event.data.customize);
            }

            if (event.data.type === 'open-splash') {
                this.closeBrowser();
                if (window.splashManager) {
                    const overlay = document.getElementById('loading-overlay');
                    if (overlay) {
                        overlay.style.display = 'flex';
                        overlay.style.opacity = '1';
                    }
                }
            }

            if (event.data.type === 'creator-ready') {
                if (this._pendingEditLayer && this._iframe && this._iframe.contentWindow) {
                    this._iframe.contentWindow.postMessage({ type: 'edit-layer', ...this._pendingEditLayer }, '*');
                    this._pendingEditLayer = null;
                }
                if (this._pendingFileData?.length && this._iframe && this._iframe.contentWindow) {
                    const msg = { type: 'load-file-data', files: this._pendingFileData };
                    const transfer = this._pendingFileData
                        .map(file => file.arrayBuffer)
                        .filter(Boolean);
                    this._iframe.contentWindow.postMessage(msg, '*', transfer);
                    this._pendingFileData = null;
                }
                // Send the parent's current bounds so previews that depend on
                // a viewport bbox (e.g. Overpass {{bbox}}) can fire without
                // requiring the user to pan first.
                if (this._map && this._iframe && this._iframe.contentWindow) {
                    this._onMapMove();
                }
            }

            if (event.data.type === 'return-to-browser') {
                this._switchToBrowser();
            }

            if (event.data.type === 'add-custom-layer') {
                console.log('[MapBrowserControl] Received add-custom-layer message');
                this._handleAddCustomLayer(event.data.config, { keepOpen: !!event.data.keepOpen });
            }

            if (event.data.type === 'legend-filter-preview') {
                this._previewLegendFilter(event.data.layerId, event.data.filter);
            }

            if (event.data.type === 'legend-filter-clear') {
                this._clearLegendFilter();
            }

            if (event.data.type === 'remove-other-maps') {
                this.hideAllLayers();
            }

            if (event.data.type === 'open-layer-info') {
                this._openLayerInfo(event.data.layer, { edit: event.data.edit, feature: event.data.feature });
            }



            if (event.data.type === 'load-atlas') {
                console.log('[MapBrowserControl] Received load-atlas message');
                this._handleLoadAtlas(event.data.atlasUrl, { preserveHash: event.data.preserveHash !== false });
            }

            if (event.data.type === 'zoom-to-bounds') {
                this._handleZoomToBounds(event.data.bounds, event.data.toggle, event.data.zoomToLayerId);
            }

            if (event.data.type === 'reset-view') {
                this._handleResetView(event.data.map, event.data.bounds);
            }

            if (event.data.type === 'zoom-to-layer') {
                console.log('[MapBrowserControl] Received zoom-to-layer message for:', event.data.layerId);
                this._handleZoomToLayer(event.data.layerId);
            }

            if (event.data.type === 'update-atlas-param') {
                this._handleUpdateAtlasParam(event.data.atlasId);
            }

            if (event.data.type === 'creator-preview') {
                this._handleCreatorPreview(event.data);
            }

            if (event.data.type === 'creator-live-preview') {
                const previous = this._creatorLivePreviewPromise || Promise.resolve();
                this._creatorLivePreviewPromise = previous.catch(() => {})
                    .then(() => this._handleCreatorLivePreview(event.data.config, {
                        bbox: event.data.bbox,
                        fitBounds: event.data.fitBounds,
                        editOriginalId: event.data.editOriginalId
                    }));
            }

            if (event.data.type === 'creator-clear-preview') {
                this._clearCreatorPreview();
                this._removeCreatorDraftLayer();
            }

            if (event.data.type === 'finalize-creator-layer') {
                this._finalizeCreatorLayer({ keepOpen: !!event.data.keepOpen });
            }

            if (event.data.type === 'atlas-preview') {
                this._handleAtlasPreview(event.data.atlasId);
            }

            if (event.data.type === 'layer-preview') {
                this._handleLayerPreview(event.data.layerId);
            }

            if (event.data.type === 'atlas-clear-preview' || event.data.type === 'layer-clear-preview') {
                this._clearPreview();
            }
        });

        window.addEventListener('layer-toggled', () => {
            if (this._isOpen) {
                setTimeout(() => {
                    this._updateIframeActiveLayers();
                }, 100);
            }
        });
    }

    /**
     * The browser lists layers under their atlas-prefixed registry ids
     * (goa-local-body), while the map and layer control address the same layer
     * by its group id (local-body). Hand the info panel the live layer, merged
     * the way LayerStackStrip does, so isolation, export and the other
     * actions that address the map by layer id find it.
     */
    _resolveLiveLayer(layer) {
        const groups = window.layerControl?._state?.groups;
        if (!layer?.id || !groups) return layer;

        const atlasPrefix = layer._sourceAtlas ? `${layer._sourceAtlas}-` : null;
        const strippedId = atlasPrefix && layer.id.startsWith(atlasPrefix) ? layer.id.slice(atlasPrefix.length) : null;
        const group = groups.find(g => g.id === layer.id) || (strippedId && groups.find(g => g.id === strippedId));
        if (!group) return layer;

        const registryLayer = window.layerRegistry?.getLayer?.(group.id, null, true);
        return { ...layer, ...(registryLayer || {}), ...group };
    }

    /**
     * Open the layer editor on an existing layer: map-creator.html showing the
     * layer's header and live actions, with an Overview tab (what the layer is)
     * and an Edit tab (the form used to add a layer, filled in from this one -
     * see js/creator-edit-mode.js). Every "layer info" and "edit layer" entry
     * point comes here.
     * @param {Object} layer
     * @param {{tab?: 'overview'|'edit', feature?: Object|null}} [options]
     */
    openLayerEditor(layer, { tab = 'view', feature = null } = {}) {
        if (!layer) return;
        const live = this._resolveLiveLayer(layer);
        let serializable;
        try {
            serializable = JSON.parse(JSON.stringify(live));
        } catch (error) {
            console.warn('[MapBrowserControl] Layer config not serializable, editing a minimal copy:', error);
            serializable = { id: live.id, title: live.title, type: live.type, url: live.url };
        }
        this._pendingEditLayer = { layer: serializable, tab, feature };

        this.openBrowser();
        this._switchToCreator('?mode=layer');
    }

    // "Layer info" is the map console's details page (js/console/layer-details.js);
    // "edit" opens the editor on its Edit tab.
    _openLayerInfo(layer, options = {}) {
        if (!options.edit && window.mapConsole) {
            window.mapConsole.showLayer(layer);
            return;
        }
        this.openLayerEditor(layer, { tab: options.edit ? 'edit' : 'view', feature: options.feature || null });
    }

    /**
     * The layer's place in the stack as two id lists in visual order, so it can
     * be put back after the layer is removed and re-added (a re-added layer
     * lands on top).
     */
    _captureLayerOrder() {
        const control = window.layerControl;
        const manager = window.urlManager;
        if (!control?._state?.groups || !manager) return null;

        const visible = [];
        control._state.groups.forEach((group, index) => {
            if (group.id === 'selection' || !manager.isGroupActive(index)) return;
            const registryLayer = window.layerRegistry?.getLayer?.(group.id, null, true);
            visible.push(registryLayer ? { ...registryLayer, ...group } : group);
        });
        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(LayerOrderManager.mapOrderToUrlOrder(visible));
        return { overlays: overlays.map(l => l.id), basemaps: basemaps.map(l => l.id) };
    }

    _applyLayerOrder(order, oldId, newId) {
        if (!order || !window.featureControl?._reorderLayers) return;
        const swap = (ids) => ids.map(id => (id === oldId ? newId : id));
        window.featureControl._reorderLayers(swap(order.overlays), swap(order.basemaps));
    }

    // The first live preview of an edit takes the real layer off the map; the
    // draft that follows stands in for it.
    _beginEditSession(layerId) {
        const group = window.layerControl?._state?.groups?.find(g => g.id === layerId);
        if (!group) return;
        this._editSession = {
            id: layerId,
            group: JSON.parse(JSON.stringify(group)),
            order: this._captureLayerOrder()
        };
        window.layerControl.removeLayerCompletely(layerId);
    }

    // Cancel: drop the draft and put the original layer back where it was.
    async _restoreEditSession() {
        const session = this._editSession;
        if (!session) return;
        this._editSession = null;

        if (this._creatorLivePreviewPromise) {
            await this._creatorLivePreviewPromise.catch(() => {});
        }
        if (this._creatorDraftLayerId) {
            window.layerControl?.removeLayerCompletely(this._creatorDraftLayerId);
            this._creatorDraftLayerId = null;
        }
        try {
            await window.layerControl._addLayerDirectly(session.group);
            this._applyLayerOrder(session.order, session.id, session.id);
        } catch (error) {
            console.warn('[MapBrowserControl] Could not restore the layer after cancelling the edit:', error);
        }
    }

    // The reload path for an edit that can't be applied to the live layer (a new
    // url, type or id): rewrite the layer's ?layers= segment and reload. Called
    // by MapFeatureControl._updateLayer, which handles everything it can in
    // place instead.
    //
    // originalId is the layer's id *before* this edit — needed to find its
    // existing URL segment when the edit itself renames the id (updatedLayer.id
    // would otherwise never match anything already in the URL).
    _handleLayerUpdate(updatedLayer, originalId = updatedLayer.id) {
        console.log('[MapBrowserControl] Updating layer:', updatedLayer);

        const urlParams = new URLSearchParams(window.location.search);
        const existingLayers = urlParams.get('layers');

        if (!existingLayers) {
            console.warn('[MapBrowserControl] No layers parameter in URL');
            return;
        }

        const layers = existingLayers.split(',').map(l => l.trim());
        let foundAndReplaced = false;

        const updatedLayers = layers.map(layerStr => {
            try {
                if (layerStr.startsWith('{') || layerStr.startsWith("{'")) {
                    const parsed = JSON.parse(layerStr.replace(/'/g, '"'));
                    if (parsed.id === originalId) {
                        foundAndReplaced = true;
                        let jsonString = JSON.stringify(updatedLayer);
                        jsonString = jsonString.replace(/"((?:[^"\\]|\\.)*)"/g, (match, content) => {
                            const escaped = content.replace(/'/g, "\\'");
                            return `"${escaped}"`;
                        });
                        return jsonString.replace(/"/g, "'");
                    }
                    return layerStr;
                } else {
                    if (layerStr === originalId) {
                        foundAndReplaced = true;
                        let jsonString = JSON.stringify(updatedLayer);
                        jsonString = jsonString.replace(/"((?:[^"\\]|\\.)*)"/g, (match, content) => {
                            const escaped = content.replace(/'/g, "\\'");
                            return `"${escaped}"`;
                        });
                        return jsonString.replace(/"/g, "'");
                    }
                    return layerStr;
                }
            } catch (e) {
                console.error('[MapBrowserControl] Error parsing layer:', e);
                if (layerStr === originalId) {
                    foundAndReplaced = true;
                    let jsonString = JSON.stringify(updatedLayer);
                    jsonString = jsonString.replace(/"((?:[^"\\]|\\.)*)"/g, (match, content) => {
                        const escaped = content.replace(/'/g, "\\'");
                        return `"${escaped}"`;
                    });
                    return jsonString.replace(/"/g, "'");
                }
                return layerStr;
            }
        });

        if (!foundAndReplaced) {
            console.warn('[MapBrowserControl] Layer not found in URL, adding it');
            let jsonString = JSON.stringify(updatedLayer);
            jsonString = jsonString.replace(/"((?:[^"\\]|\\.)*)"/g, (match, content) => {
                const escaped = content.replace(/'/g, "\\'");
                return `"${escaped}"`;
            });
            updatedLayers.unshift(jsonString.replace(/"/g, "'"));
        }

        urlParams.set('layers', updatedLayers.join(','));

        const newUrl = window.location.pathname + '?' + urlParams.toString() + window.location.hash;
        console.log('[MapBrowserControl] Reloading with updated layer:', newUrl);
        window.location.href = newUrl;
    }

    _sendLayerData() {
        if (!window.layerRegistry || !this._iframe) return;

        const layers = [];
        const activeLayers = this._getActiveLayers();

        // Send the layer's full resolved config, not a whitelist of fields, so
        // the layer editor's raw-config panel shows everything (url,
        // sourceLayer, zoom range, opacity, ...) and edits round-trip intact.
        window.layerRegistry._registry.forEach((layer, layerId) => {
            const layerData = {
                ...layer,
                id: layerId,
                title: layer.title || layer.id,
                tags: layer.tags || [],
                bbox: this._getLayerBbox(layer)
            };
            // postMessage's structured clone rejects functions/circular refs, and
            // one bad layer would drop the whole payload — round-trip through JSON
            // so only the offending layer degrades.
            try {
                layers.push(JSON.parse(JSON.stringify(layerData)));
            } catch (e) {
                console.warn('[MapBrowserControl] Layer config not serializable, sending minimal config:', layerId, e);
                layers.push({
                    id: layerId,
                    title: layerData.title,
                    type: layer.type,
                    description: layer.description,
                    attribution: layer.attribution,
                    tags: layerData.tags,
                    _sourceAtlas: layer._sourceAtlas,
                    bbox: layerData.bbox
                });
            }
        });

        const atlasMetadata = {};
        window.layerRegistry._atlasMetadata.forEach((metadata, atlasId) => {
            atlasMetadata[atlasId] = metadata;
        });

        const knownAtlases = new Set(window.layerRegistry._atlasMetadata.keys());
        const atlasLayerReferences = {};
        const atlasInitiallyChecked = {};
        window.layerRegistry._atlasLayers.forEach((atlasLayerConfigs, atlasId) => {
            const resolveId = (l) => {
                const layerId = l.id;
                if (layerId && layerId.includes('-') && knownAtlases.has(layerId.split('-')[0])) {
                    return layerId;
                }
                return `${atlasId}-${layerId}`;
            };
            atlasLayerReferences[atlasId] = atlasLayerConfigs.map(resolveId);
            atlasInitiallyChecked[atlasId] = atlasLayerConfigs
                .filter(l => l.initiallyChecked === true)
                .map(resolveId);
        });

        const bounds = this._map ? [
            this._map.getBounds().getWest(),
            this._map.getBounds().getSouth(),
            this._map.getBounds().getEast(),
            this._map.getBounds().getNorth()
        ] : null;

        const urlParams = new URLSearchParams(window.location.search);
        const atlasParam = urlParams.get('atlas');

        this._iframe.contentWindow.postMessage({
            type: 'layer-data',
            layers: layers,
            activeLayers: Array.from(activeLayers),
            atlasMetadata: atlasMetadata,
            atlasLayerReferences: atlasLayerReferences,
            atlasInitiallyChecked: atlasInitiallyChecked,
            bounds: bounds,
            mapboxToken: window.amche?.MAPBOXGL_ACCESS_TOKEN || mapboxgl.accessToken,
            selectedAtlasId: atlasParam,
            layerDefaults: window.layerControl?._defaultStyles || {},
            // The iframe is preloaded hidden, and its bbox preview map costs a
            // whole second GL library. Tell it whether anyone can actually see
            // it, so it holds that off until the panel is opened.
            panelVisible: this._isOpen
        }, '*');
    }

    _getLayerBbox(layer) {
        if (layer.bbox) return layer.bbox;
        if (layer.bounds) return layer.bounds;

        const atlasId = layer._sourceAtlas;
        if (atlasId && window.layerRegistry) {
            const metadata = window.layerRegistry.getAtlasMetadata(atlasId);
            if (metadata && metadata.bbox) {
                return metadata.bbox;
            }
        }

        return null;
    }

    _getActiveLayers() {
        const active = new Set();

        if (window.urlManager) {
            const activeLayers = window.urlManager.getCurrentActiveLayers();
            activeLayers.forEach(layer => {
                // Add both the original ID and any prefixed version from the registry
                active.add(layer.id);

                // Check if this layer exists in the registry with a prefixed ID
                if (window.layerRegistry) {
                    const registryLayer = window.layerRegistry.getLayer(layer.id);
                    if (registryLayer && registryLayer._prefixedId) {
                        active.add(registryLayer._prefixedId);
                    }
                }
            });
        }

        return active;
    }

    _notifyLayerLoaded(layerId) {
        if (!this._iframe || !this._iframe.contentWindow) return;
        this._iframe.contentWindow.postMessage({
            type: 'layer-loaded',
            layerId: layerId
        }, '*');
    }

    async _handleLayerToggle(layerId, active) {
        const mapLayerControl = window.layerControl;
        if (!mapLayerControl) {
            console.warn('[MapBrowser] Layer control not available');
            return;
        }

        console.log('[MapBrowser] Looking for layer in state.groups:', layerId);
        console.log('[MapBrowser] Total groups:', mapLayerControl._state.groups.length);

        // Try to find the layer by checking multiple ID variations
        // Layers from imported atlases may have prefixed IDs like "imported-ambulances"
        // but be registered in layer control as "ambulances"
        let groupIndex = mapLayerControl._state.groups.findIndex(g =>
            g.id === layerId || g._prefixedId === layerId || g._originalId === layerId
        );

        // If not found and layerId has a prefix (e.g., "imported-ambulances"),
        // try without the prefix (e.g., "ambulances")
        let actualLayerId = layerId;
        if (groupIndex === -1 && layerId.includes('-')) {
            const parts = layerId.split('-');
            const potentialPrefix = parts[0];
            const unprefixedId = parts.slice(1).join('-');

            groupIndex = mapLayerControl._state.groups.findIndex(g =>
                g.id === unprefixedId || g._prefixedId === layerId || g._originalId === unprefixedId
            );

            if (groupIndex !== -1) {
                actualLayerId = unprefixedId;
                console.log('[MapBrowser] Found layer with unprefixed ID:', actualLayerId);
            }
        }

        if (groupIndex === -1) {
            console.warn(`[MapBrowser] Layer ${layerId} not found in map layer control state`);
            console.log('[MapBrowser] Available layer IDs:', mapLayerControl._state.groups.map(g => g.id));

            // Check if layer exists in layer registry (imported layers)
            if (window.layerRegistry && window.layerRegistry._registry.has(layerId)) {
                console.log('[MapBrowser] Layer found in registry, dynamically adding it');
                const layerConfig = window.layerRegistry._registry.get(layerId);

                if (active) {
                    // Add layer to the map dynamically
                    await mapLayerControl._addLayerDirectly(layerConfig).then(() => {
                        console.log('[MapBrowser] Layer added successfully:', layerId);
                        this._updateIframeActiveLayers();
                        this._notifyLayerLoaded(layerId);
                    }).catch(err => {
                        console.error('[MapBrowser] Failed to add layer:', err);
                    });
                }
                return;
            }

            return;
        }

        console.log('[MapBrowser] Found layer at group index:', groupIndex, 'with ID:', actualLayerId);

        const groupElement = mapLayerControl._sourceControls[groupIndex];
        if (!groupElement) {
            console.warn(`[MapBrowser] UI element for layer ${actualLayerId} not found at index ${groupIndex}`);
            console.log('[MapBrowser] Total source controls:', mapLayerControl._sourceControls.length);
            return;
        }

        const checkbox = groupElement.querySelector('.toggle-switch input[type="checkbox"]');
        if (!checkbox) {
            console.warn(`[MapBrowser] Checkbox for layer ${actualLayerId} not found`);
            return;
        }

        console.log('[MapBrowser] Toggling layer:', actualLayerId, 'to', active);

        if (active) {
            if (!checkbox.checked) {
                checkbox.checked = true;
                groupElement.show();
                await mapLayerControl._toggleLayerGroup(groupIndex, true);
            }
            this._notifyLayerLoaded(layerId);
        } else {
            if (checkbox.checked) {
                checkbox.checked = false;
                groupElement.hide();
                mapLayerControl._toggleLayerGroup(groupIndex, false);

                // Mirror the "Added map" confirmation shown when layers are loaded
                // (map-layer-controls.js _initializeAllLayers / _handleAddCustomLayer
                // above) so removals are just as visible.
                const group = mapLayerControl._state.groups[groupIndex];
                const layerTitle = mapLayerControl._escapeHtml?.(group?.title || actualLayerId) || (group?.title || actualLayerId);
                const labelHtml = mapLayerControl._buildLayerLabelHTML?.(group, layerTitle) || `<strong>${layerTitle}</strong>`;
                MapContextMessagesControl.show(`Removed map ${labelHtml}`, { duration: 3000 });
            }
        }

        window.urlManager?.updateURL({ updateLayers: true });
        this._updateIframeActiveLayers();
    }

    _updateIframeActiveLayers() {
        if (!this._iframe) return;

        const activeLayers = this._getActiveLayers();

        this._iframe.contentWindow.postMessage({
            type: 'active-layers-update',
            activeLayers: Array.from(activeLayers)
        }, '*');
    }

    // Base id of a possibly atlas-prefixed layer id (goa-local-body -> local-body),
    // so prefixed/unprefixed forms of the same layer compare equal.
    _baseLayerId(id) {
        const prefix = id.split('-')[0];
        return window.layerRegistry?._atlasMetadata?.has(prefix) ? id.slice(prefix.length + 1) : id;
    }

    // Resolved (atlas-prefixed) ids an atlas references, mirroring the
    // atlasLayerReferences map built in _sendLayerData().
    _getAtlasLayerReferenceIds(atlasId) {
        const knownAtlases = window.layerRegistry?._atlasMetadata ? new Set(window.layerRegistry._atlasMetadata.keys()) : new Set();
        const atlasLayerConfigs = window.layerRegistry?._atlasLayers?.get(atlasId) || [];
        return atlasLayerConfigs.map(l => {
            const layerId = l.id;
            if (layerId && layerId.includes('-') && knownAtlases.has(layerId.split('-')[0])) {
                return layerId;
            }
            return `${atlasId}-${layerId}`;
        });
    }

    // Resolved ids of an atlas's own `initiallyChecked: true` layers, mirroring
    // the atlasInitiallyChecked map built in _sendLayerData().
    _getAtlasInitiallyCheckedIds(atlasId) {
        const knownAtlases = window.layerRegistry?._atlasMetadata ? new Set(window.layerRegistry._atlasMetadata.keys()) : new Set();
        const atlasLayerConfigs = window.layerRegistry?._atlasLayers?.get(atlasId) || [];
        return atlasLayerConfigs
            .filter(l => l.initiallyChecked === true)
            .map(l => {
                const layerId = l.id;
                if (layerId && layerId.includes('-') && knownAtlases.has(layerId.split('-')[0])) {
                    return layerId;
                }
                return `${atlasId}-${layerId}`;
            });
    }

    // Default visible layers for an atlas: its own initiallyChecked layers,
    // followed by the index atlas's initiallyChecked layers (shared base layers
    // like selection / admin lines / satellite), de-duplicated and atlas-first.
    _getAtlasDefaultLayerIds(atlasId) {
        const atlasLayers = this._getAtlasInitiallyCheckedIds(atlasId);
        if (atlasId === 'index') return atlasLayers;
        const indexLayers = this._getAtlasInitiallyCheckedIds('index');
        return [...atlasLayers, ...indexLayers.filter(id => !atlasLayers.includes(id))];
    }

    // Whether a layer's extent no longer overlaps the current viewport, using
    // the same bounds resolution/intersection logic as MapLayerControl's "maps
    // in view" filter. A layer whose extent can't be determined (global base
    // layers like selection/admin-lines/satellite have no bbox) is never
    // considered out of view - there's nothing geographic to compare.
    _isLayerOutOfView(layerId) {
        if (!window.layerControl || !window.layerRegistry) return false;
        const layer = window.layerRegistry.getLayer(layerId);
        if (!layer) return false;
        const bounds = window.layerControl._getLayerBounds(layer);
        if (!bounds) return false;
        return !window.layerControl._boundsIntersectViewport(bounds);
    }

    // Switches the active atlas live (layer visibility only, no page reload) -
    // used by Find's atlas picks (js/console/find-browse.js) and the "you've
    // panned outside this atlas" suggestion in map-init.js. Hides the previous
    // atlas's own layers that aren't part of the new atlas's defaults, or that
    // are out of view even if they are (e.g. a shared base layer scoped to the
    // old atlas's extent), shows the new atlas's defaults, then hands off to
    // _handleUpdateAtlasParam() for the URL/registry/notification bookkeeping.
    //
    // A switch picked while the first atlas is still loading waits for it:
    // until then the registry may still name the index atlas and the loading
    // atlas's layers aren't active yet, so they'd be missed here and come on
    // anyway on top of the new atlas once the load finishes.
    //
    // `viewBbox` is the view the atlas opens onto: a default map whose own
    // bbox lies outside it is left off (and remembered in _skippedDefaults,
    // which Find turns on when its scope is widened to include outside the view).
    switchAtlasLive(newAtlasId, { viewBbox = null } = {}) {
        if (!window.layersInitialized) {
            const waiting = this._pendingAtlasSwitch !== undefined;
            this._pendingAtlasSwitch = { atlasId: newAtlasId, viewBbox };
            if (!waiting) {
                window.addEventListener('layersInitialized', () => {
                    const pending = this._pendingAtlasSwitch;
                    delete this._pendingAtlasSwitch;
                    this.switchAtlasLive(pending.atlasId, { viewBbox: pending.viewBbox });
                }, { once: true });
            }
            return;
        }
        const previousAtlasId = window.layerRegistry?.getCurrentAtlas() || 'index';
        const newDefaults = new Set(this._getAtlasDefaultLayerIds(newAtlasId));
        const activeLayers = this._getActiveLayers();
        const previousReferencedIds = new Set(this._getAtlasLayerReferenceIds(previousAtlasId));

        activeLayers.forEach(id => {
            const belongsToPreviousAtlas = previousReferencedIds.has(id)
                || window.layerRegistry?.getLayer(id)?._sourceAtlas === previousAtlasId;
            if (!belongsToPreviousAtlas) return;

            if (!newDefaults.has(id) || this._isLayerOutOfView(id)) {
                this._handleLayerToggle(id, false);
            }
        });

        this._skippedDefaults = [];
        newDefaults.forEach(id => {
            if (activeLayers.has(id)) return;
            if (viewBbox && !this._layerOwnBboxInView(id, viewBbox)) {
                this._skippedDefaults.push(id);
                return;
            }
            this._handleLayerToggle(id, true);
        });

        this._handleUpdateAtlasParam(newAtlasId);
        if (newAtlasId !== previousAtlasId) this._loadAtlasPins(newAtlasId);
    }

    _layerOwnBboxInView(layerId, view) {
        const layer = window.layerRegistry?.getLayer(layerId);
        const raw = layer?.bbox || layer?.bounds;
        const bbox = typeof raw === 'string' ? raw.split(',').map(parseFloat) : raw;
        if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return true;
        return bbox[0] <= view[2] && bbox[2] >= view[0] && bbox[1] <= view[3] && bbox[3] >= view[1];
    }

    /** The default maps the last atlas switch left off for lying outside the view. */
    showSkippedDefaults() {
        const skipped = this._skippedDefaults || [];
        this._skippedDefaults = [];
        const active = this._getActiveLayers();
        skipped.forEach(id => {
            if (!active.has(id)) this._handleLayerToggle(id, true);
        });
    }

    // An atlas's own pins and routes can't be added live - routes are layers
    // resolved at load (see map-init.js) - so once the switch has settled
    // (layers written to the URL, camera landed), the page reopens on it with
    // them, as `?atlas=<id>` would.
    _loadAtlasPins(atlasId) {
        const meta = window.layerRegistry?.getAtlasMetadata(atlasId);
        if (!meta?.markers?.length) return;
        let timer = null;
        const settle = () => {
            clearTimeout(timer);
            timer = setTimeout(go, 600);
        };
        const stop = () => {
            clearTimeout(timer);
            window.removeEventListener('urlUpdated', settle);
            this._map?.off('moveend', settle);
        };
        const go = () => {
            if (this._map?.isMoving()) return;
            stop();
            if (window.layerRegistry?.getCurrentAtlas() !== atlasId) return;
            const next = atlasPinsUrl(window.location.href, meta.markers, meta.routes);
            if (next) window.location.assign(next);
        };
        window.addEventListener('urlUpdated', settle);
        this._map?.on('moveend', settle);
        settle();
    }

    // Turns off every active layer except the index atlas's own base layers
    // (selection / admin lines / satellite etc.), which Clear all in the
    // console's On the map list (js/console/on-map-actions.js) leaves for a
    // second press. It isn't scoped to a single atlas — there's no selected-atlas
    // context here (e.g. the shortcut menu) — it just protects the shared base
    // layers and clears everything else.
    hideAllLayers({ basemapsWhenEmpty = false } = {}) {
        const indexBase = new Set(this._getAtlasLayerReferenceIds('index').map(id => this._baseLayerId(id)));
        const handledOff = new Set();
        const removed = [];
        // The layer being previewed from the creator is the one the user is
        // working on: it is not one of "the other maps".
        const draftBase = this._creatorDraftLayerId ? this._baseLayerId(this._creatorDraftLayerId) : null;
        const sweep = (keepBase) => {
            this._getActiveLayers().forEach(layerId => {
                const base = this._baseLayerId(layerId);
                if ((keepBase && indexBase.has(base)) || handledOff.has(base) || base === draftBase || base === 'selection') return;
                handledOff.add(base);
                removed.push(layerId);
                this._handleLayerToggle(layerId, false);
            });
        };
        sweep(true);
        // Only the base layers are left, so a further clear takes them too.
        if (basemapsWhenEmpty && !handledOff.size) sweep(false);
        const exhausted = Array.from(this._getActiveLayers()).every(layerId => {
            const base = this._baseLayerId(layerId);
            return handledOff.has(base) || base === draftBase || base === 'selection';
        });
        return { removed, exhausted };
    }

    // Browsing is the console's Find mode; the side panel only opens for the
    // layer editor and the creator.
    toggleBrowser() {
        if (this._isOpen) this.closeBrowser();
        window.mapConsole?.toggleFind('all');
    }

    restoreDefaultLayers() {
        const atlasId = window.layerRegistry?.getCurrentAtlas?.() || 'index';
        const ids = new Set([...this._getAtlasInitiallyCheckedIds(atlasId), ...this._getAtlasInitiallyCheckedIds('index')]);
        const active = new Set(Array.from(this._getActiveLayers()).map(id => this._baseLayerId(id)));
        ids.forEach(id => {
            if (!active.has(this._baseLayerId(id))) this._handleLayerToggle(id, true);
        });
    }

    openCreator() {
        if (!this._isOpen) this.openBrowser();
        this._switchToCreator();
    }

    openBrowser() {
        this._showLoadingOverlay();

        this._ensureIframe();
        window.mapConsole?.setMode('explore', { keepQuery: true });
        this._overlay.style.display = 'block';
        this._isOpen = true;
        this._updateButtonState(true);
        // The browser panel lists the same layers - don't double up on them.
        this._layerStack.setVisible(false);

        setTimeout(async () => {
            // Deferred external (cross-repo) atlases aren't fetched at startup — the
            // browser overlay lists everything, so load whatever's still pending
            // before sending the full layer/atlas data across.
            if (window.layerRegistry?.ensureAllAtlasesLoaded) {
                await window.layerRegistry.ensureAllAtlasesLoaded();
            }

            this._sendLayerData();

        }, 100);

        if (this._map) {
            this._map.on('moveend', this._onMapMove);
        }
    }

    // A legend item in the layer editor being pointed at: only the features of its rule
    // are drawn, on top of whatever filter each of the layer's map layers already has.
    // _clearLegendFilter puts every one back.
    _previewLegendFilter(layerId, filter) {
        this._clearLegendFilter();
        const map = this._map;
        if (!map || !layerId || !filter) return;
        const saved = new Map();
        (map.getStyle()?.layers || []).filter(layer => layer.metadata?.groupId === layerId).forEach(layer => {
            try {
                const original = map.getFilter(layer.id) ?? null;
                map.setFilter(layer.id, original ? ['all', original, filter] : filter);
                saved.set(layer.id, original);
            } catch (error) {
                // A layer that can't take this filter is left as it was.
            }
        });
        this._legendFilterSaved = saved;
    }

    _clearLegendFilter() {
        const saved = this._legendFilterSaved;
        this._legendFilterSaved = null;
        if (!saved || !this._map) return;
        saved.forEach((original, layerId) => {
            try {
                this._map.setFilter(layerId, original);
            } catch (error) {
                // The layer was replaced since (a live-preview draft); nothing to put back.
            }
        });
    }

    closeBrowser() {
        this._clearLegendFilter();
        // Closing mid-edit without applying puts the layer back.
        if (this._editSession) this._restoreEditSession();
        window.layerControl?.isolation?.clear();

        this._hideLoadingOverlay();
        this._overlay.style.display = 'none';
        this._isOpen = false;
        this._updateButtonState(false);
        this._layerStack.setVisible(true);
        this._layerStack.render();

        if (this._map) {
            this._map.off('moveend', this._onMapMove);
        }

        // Back to the console, where the panel was opened from
        window.mapConsole?.el?.querySelector('.map-control-bar-main')?.focus({ preventScroll: true });
    }

    _onMapMove = () => {
        if (!this._isOpen || !this._iframe || !this._map) return;

        const bounds = [
            this._map.getBounds().getWest(),
            this._map.getBounds().getSouth(),
            this._map.getBounds().getEast(),
            this._map.getBounds().getNorth()
        ];

        this._iframe.contentWindow.postMessage({
            type: 'bounds-update',
            bounds: bounds
        }, '*');
    }

    onRemove() {
        this._layerStack.destroy();
        if (this._overlay && this._overlay.parentNode) {
            this._overlay.parentNode.removeChild(this._overlay);
        }
        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._map = null;
    }

    getDefaultPosition() {
        return 'top-left';
    }

    updateAtlasName(atlasName) {
        // No longer updating atlas name - button always shows "Maps"
    }

    /**
     * A layer picked in the creator's "Choose from Atlas" list: turn it on, then
     * open the layer panel on it - its Overview, or its Edit tab when customizing.
     */
    async _useRegistryLayer(layerId, customize) {
        const layer = window.layerRegistry?._registry.get(layerId);
        if (!layer) return;
        await this._handleLayerToggle(layerId, true);
        this.openLayerEditor({ ...layer, id: layerId }, { tab: customize ? 'edit' : 'view' });
    }

    _switchToCreator(query = '') {
        this._ensureIframe();
        this._iframe.src = `map-creator.html${query}`;
        this._hideLoadingOverlay();
    }

    // The creator's "back" returns to browsing, which is now Find
    _switchToBrowser() {
        this.closeBrowser();
        window.mapConsole?.setMode('find', { filter: 'all' });
    }

    /**
     * Read dropped files and hand them to the creator, which walks them one at a
     * time so each becomes its own layer.
     */
    async openCreatorWithFiles(files) {
        const readFile = (file) => new Promise((resolve, reject) => {
            const ext = file.name.split('.').pop().toLowerCase();
            const isBinary = ext === 'gpkg' || ext === 'zip';
            const reader = new FileReader();
            reader.onload = (e) => resolve({
                fileName: file.name,
                content: isBinary ? null : e.target.result,
                arrayBuffer: isBinary ? e.target.result : null
            });
            reader.onerror = () => reject(reader.error);
            if (isBinary) {
                reader.readAsArrayBuffer(file);
            } else {
                reader.readAsText(file);
            }
        });

        try {
            this._pendingFileData = await Promise.all(files.map(readFile));
        } catch (error) {
            console.error('[MapBrowserControl] Failed to read dropped files:', error);
            return;
        }

        if (!this._isOpen) {
            this.openBrowser();
        }
        this._switchToCreator();
    }

    _handleZoomToBounds(bounds, toggle = false, zoomToLayerId = null) {
        if (!this._map || !bounds) return;

        // Parse bbox if it's a string "minLng,minLat,maxLng,maxLat"
        let bbox;
        if (typeof bounds === 'string') {
            const parts = bounds.split(',').map(parseFloat);
            if (parts.length === 4) {
                bbox = [[parts[0], parts[1]], [parts[2], parts[3]]];
            }
        } else if (Array.isArray(bounds)) {
            if (bounds.length === 4) {
                bbox = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
            }
        }

        if (!bbox) return;

        // Toggle mode: a second click on the same target restores the map view
        // that was active before the first zoom.
        if (toggle) {
            const targetKey = JSON.stringify(bbox);
            const prev = this._zoomToggle;
            if (prev && prev.targetKey === targetKey) {
                // Restore the previous camera and clear the stored state
                this._map.fitBounds(prev.prevBounds, {
                    padding: { top: 50, bottom: 50, left: 50, right: 50 },
                    duration: 1000
                });
                this._zoomToggle = null;
                return;
            }
            // Remember where we were so the next click can return here
            const b = this._map.getBounds();
            this._zoomToggle = {
                targetKey,
                prevBounds: [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]]
            };
        }

        if (zoomToLayerId) ZoomToParam.setParam(this._map, zoomToLayerId);

        // Zoom to bounds
        this._map.fitBounds(bbox, {
            padding: { top: 50, bottom: 50, left: 50, right: 50 },
            maxZoom: 16,
            duration: 1000
        });
    }

    // Reset the map camera to an atlas's initial view. Prefers the atlas's
    // configured map center/zoom; falls back to fitting its bbox.
    _handleResetView(mapConfig, bounds) {
        if (!this._map) return;

        // A reset invalidates any pending zoom-toggle "return to" state.
        this._zoomToggle = null;

        if (mapConfig && Array.isArray(mapConfig.center)) {
            this._map.flyTo({
                center: mapConfig.center,
                zoom: mapConfig.zoom != null ? mapConfig.zoom : this._map.getZoom(),
                bearing: mapConfig.bearing || 0,
                pitch: mapConfig.pitch || 0,
                duration: 1000
            });
            return;
        }

        if (bounds) {
            this._handleZoomToBounds(bounds, false);
        }
    }

    _handleZoomToLayer(layerId) {
        if (!this._map || !layerId) return;

        console.log('[MapBrowserControl] Zooming to layer:', layerId);

        // Get layer from registry
        const layer = window.layerRegistry?.getLayer(layerId);
        if (!layer) {
            console.warn('[MapBrowserControl] Layer not found in registry:', layerId);
            return;
        }

        let bbox = layer.bbox;

        // Try atlas bbox if layer doesn't have one
        if (!bbox && layer._sourceAtlas) {
            const atlasMetadata = window.layerRegistry.getAtlasMetadata(layer._sourceAtlas);
            if (atlasMetadata && atlasMetadata.bbox) {
                bbox = atlasMetadata.bbox;
            }
        }

        if (!bbox) {
            console.warn('[MapBrowserControl] No bbox found for layer:', layerId);
            return;
        }

        console.log('[MapBrowserControl] Zooming to bbox:', bbox, 'minzoom:', layer.minzoom);

        // Parse bbox if it's a string "minLng,minLat,maxLng,maxLat"
        let parsedBbox;
        if (typeof bbox === 'string') {
            const parts = bbox.split(',').map(parseFloat);
            if (parts.length === 4) {
                parsedBbox = [[parts[0], parts[1]], [parts[2], parts[3]]];
            }
        } else if (Array.isArray(bbox)) {
            if (bbox.length === 4) {
                parsedBbox = [[bbox[0], bbox[1]], [bbox[2], bbox[3]]];
            }
        }

        if (!parsedBbox) {
            console.warn('[MapBrowserControl] Invalid bbox format:', bbox);
            return;
        }

        ZoomToParam.setParam(this._map, layerId);

        // First fit bounds to show the full extent
        this._map.fitBounds(parsedBbox, {
            padding: { top: 50, bottom: 50, left: 50, right: 50 },
            duration: 1000
        });

        // If minzoom is defined, set zoom to minzoom + 1 after fitBounds completes
        if (layer.minzoom !== undefined) {
            setTimeout(() => {
                const targetZoom = layer.minzoom + 1;
                const currentZoom = this._map.getZoom();
                console.log('[MapBrowserControl] Current zoom after fitBounds:', currentZoom, 'target zoom (minzoom+1):', targetZoom);
                // Only zoom in if current zoom is less than target
                if (currentZoom < targetZoom) {
                    this._map.zoomTo(targetZoom, { duration: 500 });
                }
            }, 1100); // Wait for fitBounds animation to complete (1000ms + buffer)
        }
    }

    async _handleAddCustomLayer(config, { keepOpen = false } = {}) {
        console.log('[MapBrowserControl] Adding custom layer:', config);

        const mapLayerControl = window.layerControl;
        if (!mapLayerControl) {
            console.warn('[MapBrowserControl] Layer control not available, cannot add layer live');
            return;
        }

        try {
            await mapLayerControl._addLayerDirectly(config);
        } catch (error) {
            console.error('[MapBrowserControl] Failed to add custom layer:', error);
            return;
        }

        // Close the browser/creator overlay so the new layer is visible on the
        // live map, then show the same "Added map" confirmation (with a zoom
        // shortcut when a bbox is known) used for regular layer toggles. The
        // creator keeps the overlay open while it still has queued files to
        // walk the user through.
        if (!keepOpen) {
            this.closeBrowser();
        }

        const layerTitle = mapLayerControl._escapeHtml?.(config.title || config.id) || (config.title || config.id);
        const labelHtml = mapLayerControl._buildLayerLabelHTML?.(config, layerTitle) || `<strong>${layerTitle}</strong>`;
        const zoomLink = mapLayerControl._buildZoomToLayerLink?.(config) || '';
        MapContextMessagesControl.show(
            `${labelHtml}${zoomLink ? ' &middot; ' + zoomLink : ''}`,
            { duration: 3000 }
        );
    }

    // Live preview for geojson/csv/vector/tms/wms/cog/overpass layers being
    // configured in the creator: adds the config as a REAL layer (same
    // _addLayerDirectly path "Add Map Layer" uses) rather than a separate
    // throwaway rendering, so it's inspectable via MapMarkerManager and
    // reflected in the URL just like it was already added. Each tick fully
    // replaces the previous draft — MapboxAPI has no generic "restyle" path,
    // so a style edit needs a full removeLayerGroup + createLayerGroup
    // anyway — and this also naturally handles the user switching data
    // sources mid-edit.
    async _handleCreatorLivePreview(config, { bbox, fitBounds, editOriginalId } = {}) {
        const mapLayerControl = window.layerControl;
        if (!mapLayerControl || !config || !config.id) return;

        if (editOriginalId && !this._editSession) this._beginEditSession(editOriginalId);

        if (this._creatorDraftLayerId) {
            mapLayerControl.removeLayerCompletely(this._creatorDraftLayerId);
            this._creatorDraftLayerId = null;
        }

        try {
            await mapLayerControl._addLayerDirectly(config);
            this._creatorDraftLayerId = config.id;
        } catch (error) {
            console.warn('[MapBrowserControl] Creator live preview failed:', error);
            return;
        }

        // Overpass geometry is unknown up front (a query can return a mix of
        // nodes/ways/relations) — detect it from the live layer's actual
        // fetched data (see _detectSourceInfo below) so the creator can
        // auto-check the right Point/Line/Area boxes. Only re-arm on a
        // genuinely new query, not on every style tweak (each of which still
        // re-adds this layer — see the comment above). Needs retrying rather
        // than a single check: unlike a vector tile (browser-cached, ready
        // almost immediately), an Overpass API fetch can take several
        // seconds.
        if (config.type === 'overpass' && this._overpassPreviewQuery !== config.query) {
            this._overpassPreviewQuery = config.query;
            this._detectSourceInfo(`geojson-${config.id}`, { maxAttempts: 20, retryMs: 1000 });
        }

        // Previewing is an explicit "show me this query" action, so fetch right
        // away instead of leaving the layer empty behind its minzoom gate — a
        // query is authored at whatever zoom the map happens to sit at, and a
        // silently blank preview reads as a broken query. Runs on every preview
        // tick (not just a new query) because each tick re-adds the layer from
        // scratch, so a style tweak below minzoom would otherwise blank it —
        // `ignoreCache: false` makes those style ticks reuse the features the
        // torn-down loader already had instead of re-querying Overpass.
        if (config.type === 'overpass') {
            window.layerControl?._mapboxAPI?.refreshOverpassLayer(config.id, { ignoreCache: false });
        }

        if (fitBounds && Array.isArray(bbox) && bbox.length === 4) {
            const [west, south, east, north] = bbox;
            try {
                this._map.fitBounds([[west, south], [east, north]], { padding: 50, maxZoom: 16, duration: 500 });
            } catch (e) {
                console.warn('[MapBrowserControl] Creator live preview fitBounds failed:', e);
            }
        }
    }

    // Discards the draft layer _handleCreatorLivePreview added — used when
    // the creator cancels/closes/switches data source, so the layer added
    // purely for previewing doesn't linger on the map or in the URL. Waits
    // for any in-flight _handleCreatorLivePreview first (e.g. a slow remote
    // fetch) so a fast Cancel can't race ahead of the add it's meant to undo,
    // leaving the "cancelled" layer added anyway once that add resolves.
    async _removeCreatorDraftLayer() {
        if (this._creatorLivePreviewPromise) {
            await this._creatorLivePreviewPromise.catch(() => {});
        }
        this._overpassPreviewQuery = null;
        if (this._editSession) {
            await this._restoreEditSession();
            return;
        }
        if (!this._creatorDraftLayerId) return;
        window.layerControl?.removeLayerCompletely(this._creatorDraftLayerId);
        this._creatorDraftLayerId = null;
    }

    // "Add Map Layer" for a layer type that's already live via
    // _handleCreatorLivePreview: the layer is already added, so this just
    // stops treating it as a discardable draft and shows the usual "Added
    // map" confirmation, closing the creator unless more queued files remain.
    // Also waits for any in-flight live-preview add first, for the same
    // race reason as _removeCreatorDraftLayer above.
    async _finalizeCreatorLayer({ keepOpen = false } = {}) {
        if (this._creatorLivePreviewPromise) {
            await this._creatorLivePreviewPromise.catch(() => {});
        }

        const mapLayerControl = window.layerControl;
        const layerId = this._creatorDraftLayerId;
        const session = this._editSession;
        this._creatorDraftLayerId = null;
        this._editSession = null;
        this._overpassPreviewQuery = null;

        if (!keepOpen) {
            this.closeBrowser();
        }

        const group = layerId && mapLayerControl?._state?.groups?.find(g => g.id === layerId);
        if (!group || !mapLayerControl) return;

        if (session) this._commitEditedLayer(group, session);

        const layerTitle = mapLayerControl._escapeHtml?.(group.title || group.id) || (group.title || group.id);
        const labelHtml = mapLayerControl._buildLayerLabelHTML?.(group, layerTitle) || `<strong>${layerTitle}</strong>`;
        const zoomLink = mapLayerControl._buildZoomToLayerLink?.(group) || '';
        MapContextMessagesControl.show(
            `${labelHtml}${zoomLink ? ' &middot; ' + zoomLink : ''}`,
            { duration: 3000 }
        );
    }

    // An edited layer replaces the original in the stack and in the URL. A layer
    // the registry knows would otherwise be written back to ?layers= as a bare
    // id, silently dropping the edit, so the full config is kept with it.
    _commitEditedLayer(group, session) {
        const definition = {};
        Object.keys(group).forEach(key => {
            if (!key.startsWith('_') && key !== 'initiallyChecked') definition[key] = group[key];
        });
        group._originalJson = JSON.stringify(definition).replace(/'/g, "\\'").replace(/"/g, "'");

        this._applyLayerOrder(session.order, session.id, group.id);
        if (window.urlManager) setTimeout(() => window.urlManager.updateURL({ updateLayers: true }), 80);
    }

    _handleLoadAtlas(atlasUrl, { preserveHash = true } = {}) {
        console.log('[MapBrowserControl] Loading atlas:', atlasUrl);

        // Build new URL with atlas parameter
        const url = new URL(window.location.origin + window.location.pathname);

        // Parse existing parameters
        const params = new URLSearchParams(window.location.search);

        // Build new params array
        const newParams = [];

        // Add atlas parameter first
        newParams.push(`atlas=${encodeURIComponent(atlasUrl)}`);

        // Don't include the old layers parameter - let the atlas load with its default layers
        // This prevents malformed JSON from previous attempts from being carried over

        // Add other parameters (except atlas and layers which we're resetting)
        for (const [key, value] of params.entries()) {
            if (key !== 'atlas' && key !== 'layers') {
                newParams.push(`${key}=${value}`);
            }
        }

        // Build final URL
        let finalUrl = url.origin + url.pathname;
        if (newParams.length > 0) {
            finalUrl += '?' + newParams.join('&');
        }

        // Add hash if it exists - unless the caller wants a clean load (no
        // stale #zoom/lat/lng carried over) so map-init.js's "no hash" path
        // can auto-fit the camera to the new atlas instead of keeping
        // whatever position the user was previously looking at.
        if (preserveHash && window.location.hash) {
            finalUrl += window.location.hash;
        }

        console.log('[MapBrowserControl] Reloading with atlas URL:', finalUrl);
        window.location.href = finalUrl;
    }

    _handleCreatorPreview({ geojson, style, geometryType, bbox, fitBounds }) {
        if (!this._map || !geojson) return;

        const sourceId = '__creator_preview__';
        const layerIds = {
            fill: '__creator_preview_fill__',
            line: '__creator_preview_line__',
            circle: '__creator_preview_circle__'
        };

        const src = this._map.getSource(sourceId);
        if (src) {
            src.setData(geojson);
        } else {
            this._map.addSource(sourceId, { type: 'geojson', data: geojson });
        }

        const ensureLayer = (id, layerDef) => {
            if (this._map.getLayer(id)) {
                this._map.removeLayer(id);
            }
            this._map.addLayer(layerDef);
        };

        const paintFor = (kind) => {
            const paint = {};
            if (!style) return paint;
            Object.keys(style).forEach(key => {
                if (kind === 'fill' && (key === 'fill-color' || key === 'fill-opacity')) paint[key] = style[key];
                if (kind === 'line' && (key === 'line-color' || key === 'line-width' || key === 'line-opacity')) paint[key] = style[key];
                if (kind === 'circle' && (key === 'circle-color' || key === 'circle-radius' || key === 'circle-stroke-color' || key === 'circle-stroke-width' || key === 'circle-opacity')) paint[key] = style[key];
            });
            return paint;
        };

        Object.values(layerIds).forEach(id => {
            if (this._map.getLayer(id)) this._map.removeLayer(id);
        });

        if (geometryType === 'Polygon') {
            ensureLayer(layerIds.fill, {
                id: layerIds.fill,
                type: 'fill',
                source: sourceId,
                filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
                paint: paintFor('fill')
            });
            ensureLayer(layerIds.line, {
                id: layerIds.line,
                type: 'line',
                source: sourceId,
                filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon'], ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
                paint: paintFor('line')
            });
        } else if (geometryType === 'LineString') {
            ensureLayer(layerIds.line, {
                id: layerIds.line,
                type: 'line',
                source: sourceId,
                paint: paintFor('line')
            });
        } else {
            ensureLayer(layerIds.circle, {
                id: layerIds.circle,
                type: 'circle',
                source: sourceId,
                paint: paintFor('circle')
            });
        }

        if (fitBounds && bbox && bbox.length === 4) {
            try {
                this._map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
                    padding: 60,
                    duration: 800,
                    maxZoom: 16
                });
            } catch (e) {
                console.warn('Preview fitBounds failed:', e);
            }
        }
    }

    _clearCreatorPreview() {
        if (!this._map) return;
        const sourceId = '__creator_preview__';
        ['__creator_preview_fill__', '__creator_preview_line__', '__creator_preview_circle__'].forEach(id => {
            if (this._map.getLayer(id)) this._map.removeLayer(id);
        });
        if (this._map.getSource(sourceId)) this._map.removeSource(sourceId);
    }

    // Best-effort: once a preview source has had a chance to load, sample
    // rendered features to report back which geometry types and properties
    // actually exist — the creator uses this to auto-check the right
    // Point/Line/Area boxes and populate the label field dropdown. Returns
    // nothing useful if the current viewport doesn't overlap the source's
    // data (the user can still check boxes manually).
    //
    // `sourceLayer` is vector-tile-only (omit for a geojson source, e.g. a
    // live overpass layer). `maxAttempts` > 1 switches from a single
    // idle-or-800ms check to fixed-interval polling — needed for a source
    // that populates asynchronously well after the map goes idle, like an
    // Overpass fetch that can take several seconds.
    _detectSourceInfo(sourceId, { sourceLayer, retryMs = 1000, maxAttempts = 1 } = {}) {
        if (!this._map) return;
        const token = (this._tileInfoToken = (this._tileInfoToken || 0) + 1);

        const tryQuery = (attempt) => {
            if (this._tileInfoToken !== token || !this._iframe?.contentWindow) return;
            let features = [];
            try {
                features = this._map.querySourceFeatures(sourceId, sourceLayer ? { sourceLayer } : undefined);
            } catch (e) {
                return;
            }

            if (!features || features.length === 0) {
                if (attempt < maxAttempts) setTimeout(() => tryQuery(attempt + 1), retryMs);
                return;
            }

            const geometryTypes = new Set();
            const fields = new Set();
            features.slice(0, 200).forEach(feature => {
                if (feature.geometry?.type) geometryTypes.add(feature.geometry.type);
                if (feature.properties) Object.keys(feature.properties).forEach(key => fields.add(key));
            });

            this._iframe.contentWindow.postMessage({
                type: 'creator-tile-info',
                geometryTypes: Array.from(geometryTypes),
                fields: Array.from(fields)
            }, '*');
        };

        if (maxAttempts > 1) {
            tryQuery(1);
            return;
        }

        const onIdle = () => {
            tryQuery(1);
            this._map.off('idle', onIdle);
        };
        this._map.on('idle', onIdle);
        setTimeout(() => tryQuery(1), 800);
    }

    // Build a bbox rectangle Feature from [west, south, east, north], or null.
    _bboxFeature(bbox) {
        if (!Array.isArray(bbox) || bbox.length !== 4) return null;
        const [west, south, east, north] = bbox;
        return {
            type: 'Feature',
            properties: { __bbox: true },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [west, north], [east, north], [east, south], [west, south], [west, north]
                ]]
            }
        };
    }

    // Normalize any GeoJSON value into an array of Features.
    _geojsonToFeatures(geojson) {
        if (!geojson) return [];
        if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
            return geojson.features;
        }
        if (geojson.type === 'Feature') return [geojson];
        if (geojson.type) return [{ type: 'Feature', properties: {}, geometry: geojson }];
        return [];
    }

    // Shared ephemeral hover-preview renderer. Draws shape features (fill + outline)
    // and, separately, a dashed bbox rectangle. Used by both atlas and layer hover.
    _renderPreview(features, bbox, color) {
        if (!this._map) return;
        color = color || '#2563eb';

        const bboxFeature = this._bboxFeature(bbox);
        const shapeFeatures = (features && features.length) ? features : (bboxFeature ? [bboxFeature] : []);
        if (shapeFeatures.length === 0) return;

        const sourceId = '__hover_preview__';
        const bboxSourceId = '__hover_preview_bbox__';
        const fillId = '__hover_preview_fill__';
        const lineId = '__hover_preview_line__';
        const bboxLineId = '__hover_preview_bbox_line__';

        const setSource = (id, data) => {
            const src = this._map.getSource(id);
            if (src) {
                src.setData(data);
            } else {
                this._map.addSource(id, { type: 'geojson', data });
            }
        };

        setSource(sourceId, { type: 'FeatureCollection', features: shapeFeatures });
        setSource(bboxSourceId, { type: 'FeatureCollection', features: bboxFeature ? [bboxFeature] : [] });

        if (!this._map.getLayer(fillId)) {
            this._map.addLayer({
                id: fillId,
                type: 'fill',
                source: sourceId,
                filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
                paint: { 'fill-color': color, 'fill-opacity': 0.15 }
            });
        } else {
            this._map.setPaintProperty(fillId, 'fill-color', color);
        }

        if (!this._map.getLayer(lineId)) {
            this._map.addLayer({
                id: lineId,
                type: 'line',
                source: sourceId,
                paint: { 'line-color': color, 'line-width': 2.5, 'line-opacity': 0.9 }
            });
        } else {
            this._map.setPaintProperty(lineId, 'line-color', color);
        }

        // Circle layer so point geojson layers (markers) are visible too.
        const circleId = '__hover_preview_circle__';
        if (!this._map.getLayer(circleId)) {
            this._map.addLayer({
                id: circleId,
                type: 'circle',
                source: sourceId,
                filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
                paint: { 'circle-color': color, 'circle-radius': 4, 'circle-opacity': 0.7, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 }
            });
        } else {
            this._map.setPaintProperty(circleId, 'circle-color', color);
        }

        if (!this._map.getLayer(bboxLineId)) {
            this._map.addLayer({
                id: bboxLineId,
                type: 'line',
                source: bboxSourceId,
                paint: { 'line-color': color, 'line-width': 1, 'line-opacity': 0.6, 'line-dasharray': [2, 2] }
            });
        } else {
            this._map.setPaintProperty(bboxLineId, 'line-color', color);
        }
    }

    _handleAtlasPreview(atlasId) {
        if (!this._map || !atlasId || !window.layerRegistry) return;
        this._previewToken = (this._previewToken || 0) + 1;

        const metadata = window.layerRegistry.getAtlasMetadata(atlasId);
        if (!metadata) return;

        const features = this._geojsonToFeatures(metadata.geojson);
        this._renderPreview(features, metadata.bbox, metadata.color || '#2563eb');
    }

    _handleLayerPreview(layerId) {
        if (!this._map || !layerId || !window.layerRegistry) return;

        // Bump the token so a slow geojson fetch that resolves after the user has
        // moved on to another row (or left) is ignored.
        const token = (this._previewToken || 0) + 1;
        this._previewToken = token;

        const layer = window.layerRegistry.getLayer(layerId);
        if (!layer) return;

        const atlasMeta = layer._sourceAtlas ? window.layerRegistry.getAtlasMetadata(layer._sourceAtlas) : null;
        const color = layer.color || (atlasMeta && atlasMeta.color) || '#2563eb';
        const ownBbox = (Array.isArray(layer.bbox) && layer.bbox.length === 4) ? layer.bbox
            : (Array.isArray(layer.bounds) && layer.bounds.length === 4) ? layer.bounds : null;

        // Inline geojson data, if the layer carries it.
        const inline = layer.data && typeof layer.data === 'object' ? layer.data : (layer.geojson || null);
        const inlineFeatures = this._geojsonToFeatures(inline);

        if (inlineFeatures.length > 0) {
            this._renderPreview(inlineFeatures, ownBbox, color);
            return;
        }

        // Draw whatever we have immediately (own bbox, else atlas extent), then
        // upgrade to the real shape once the geojson fetch resolves.
        const fallbackBbox = ownBbox || (atlasMeta && atlasMeta.bbox) || null;
        const fallbackFeatures = (!ownBbox && atlasMeta) ? this._geojsonToFeatures(atlasMeta.geojson) : [];
        this._renderPreview(fallbackFeatures, fallbackBbox, color);

        // For geojson layers, fetch (and cache) the data to preview the true shape.
        if (layer.type === 'geojson' && layer.url) {
            this._fetchLayerGeojson(layer.url).then(geojson => {
                if (this._previewToken !== token) return; // stale hover
                const features = this._geojsonToFeatures(geojson);
                if (features.length > 0) this._renderPreview(features, ownBbox, color);
            }).catch(() => { /* leave the bbox fallback in place */ });
        }
    }

    _fetchLayerGeojson(url) {
        if (!this._geojsonCache) this._geojsonCache = new Map();
        if (this._geojsonCache.has(url)) {
            return Promise.resolve(this._geojsonCache.get(url));
        }
        const promise = fetch(url)
            .then(res => {
                const ct = res.headers.get('content-type') || '';
                // Only parse JSON; KML/other formats are skipped (bbox fallback stays).
                if (!res.ok || (!ct.includes('json') && !url.toLowerCase().endsWith('.geojson') && !url.toLowerCase().endsWith('.json'))) {
                    return null;
                }
                return res.json().catch(() => null);
            })
            .then(geojson => {
                this._geojsonCache.set(url, geojson);
                return geojson;
            })
            .catch(() => {
                this._geojsonCache.set(url, null);
                return null;
            });
        this._geojsonCache.set(url, promise);
        return Promise.resolve(promise);
    }

    _clearPreview() {
        if (!this._map) return;
        this._previewToken = (this._previewToken || 0) + 1;
        ['__hover_preview_fill__', '__hover_preview_line__', '__hover_preview_circle__', '__hover_preview_bbox_line__'].forEach(id => {
            if (this._map.getLayer(id)) this._map.removeLayer(id);
        });
        ['__hover_preview__', '__hover_preview_bbox__'].forEach(id => {
            if (this._map.getSource(id)) this._map.removeSource(id);
        });
    }

    _handleUpdateAtlasParam(atlasId) {
        const resolvedAtlasId = atlasId || 'index';
        const previousAtlasId = window.layerRegistry?.getCurrentAtlas();
        const previousFullUrl = window.location.href;
        const atlasActuallyChanged = !!window.layerRegistry && previousAtlasId !== resolvedAtlasId;

        const params = new URLSearchParams(window.location.search);

        if (atlasId) {
            params.set('atlas', atlasId);
        } else {
            params.delete('atlas');
        }

        const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
        window.history.replaceState(null, '', newUrl);

        // Find's atlas switch is live (layer visibility only, no
        // reload) - without this, layerRegistry._currentAtlas stays on the
        // previous atlas, so map-init.js's "you've panned outside this atlas"
        // bounds check keeps comparing against the atlas we just left and
        // spuriously re-suggests switching to the atlas we're already on.
        if (window.layerRegistry) {
            window.layerRegistry.setCurrentAtlas(resolvedAtlasId);
        }
        if (window.layerControl) {
            window.layerControl._updateAtlasButtonText?.();
        }
        // Dismiss immediately rather than waiting on the next moveend + the
        // message's own auto-close - id string is duplicated from map-init.js's
        // ATLAS_BOUNDS_MESSAGE_ID (not exported, and this stays a plain-string
        // cross-module id like every other MapContextMessagesControl id).
        MapContextMessagesControl.close('atlas-bounds-suggestion');

        // Mirror map-init.js's "Switched to X atlas" notification for a real
        // navigation - this live switch never reloads the page, so that copy
        // never fires here on its own. Undo reloads back to the exact previous
        // URL (rather than history.back(), which has nothing to return to
        // since this only ever used history.replaceState): switchAtlasContext's
        // layer-toggle messages already keep layers= in sync with what was
        // actually shown, so the reload lands back on the same view.
        if (atlasActuallyChanged) {
            const atlasDisplayName = window.layerRegistry.getAtlasMetadata(resolvedAtlasId)?.name || resolvedAtlasId;
            const escapedName = window.layerControl?._escapeHtml?.(atlasDisplayName) || atlasDisplayName;
            const jsEscapedUrl = previousFullUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            MapContextMessagesControl.show(
                `Switched to <strong>${escapedName}</strong> atlas &middot; <a href="#" onclick="window.location.href='${jsEscapedUrl}';return false;">Undo</a>`
            );
        }

        try {
            sessionStorage.setItem('amche_last_atlas', resolvedAtlasId);
        } catch (error) { /* sessionStorage unavailable (e.g. private browsing) */ }
    }
}

/**
 * MapBrowserControl - Mapbox GL JS control for opening the map browser
 *
 * A compact control button that shows the current atlas name and opens
 * a full-screen map browser overlay when clicked.
 */
import { MapContextMessagesControl } from './map-context-messages-control.js';

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
        this._setupMessageListener();
        this._setupViewHistory();
    }

    // Track recent map-view URLs so the browser's "Previous View" button can step
    // back through them. The app rewrites the URL with history.replaceState (no
    // browser-history entry), so we keep our own stack in sessionStorage — it
    // survives the full-page reload used to restore a previous view. Holds the
    // current view plus up to 10 prior ones (most recent last).
    static get VIEW_HISTORY_KEY() { return 'amche_view_history'; }
    static get VIEW_HISTORY_MAX() { return 11; }

    _loadViewHistory() {
        try {
            const raw = sessionStorage.getItem(MapBrowserControl.VIEW_HISTORY_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    _saveViewHistory(history) {
        try {
            sessionStorage.setItem(MapBrowserControl.VIEW_HISTORY_KEY, JSON.stringify(history));
        } catch (e) { /* sessionStorage unavailable — Previous View just won't persist */ }
    }

    _setupViewHistory() {
        // Seed with the URL the page loaded at.
        this._recordView();
        // Every URLManager rewrite dispatches `urlUpdated`; record the new URL.
        window.addEventListener('urlUpdated', () => this._recordView());
    }

    _recordView() {
        const href = window.location.href;
        const history = this._loadViewHistory();
        if (history[history.length - 1] === href) return; // no change
        history.push(href);
        while (history.length > MapBrowserControl.VIEW_HISTORY_MAX) history.shift();
        this._saveViewHistory(history);
        this._notifyViewHistory();
    }

    _notifyViewHistory() {
        if (!this._iframe || !this._iframe.contentWindow) return;
        this._iframe.contentWindow.postMessage({
            type: 'view-history-update',
            canGoBack: this._canGoBackView()
        }, '*');
    }

    // Whether there's a restorable prior view. The very first (initial page-load)
    // entry is treated as a non-restorable baseline, so we need a distinct entry
    // beyond it once the current view is set aside.
    _canGoBackView() {
        const current = window.location.href;
        const history = this._loadViewHistory();
        while (history.length && history[history.length - 1] === current) history.pop();
        return history.length > 1;
    }

    // Step the map back to the most recent distinct prior view. Drops the current
    // URL (and any duplicates of it) off the stack, then reloads at the previous
    // one — a reload cleanly re-applies every URL param (layers, camera, terrain…).
    // The first stored entry is never restored: it's the bare initial-load URL and
    // navigating to it reboots the whole site.
    _handlePreviousView() {
        const current = window.location.href;
        const history = this._loadViewHistory();
        while (history.length && history[history.length - 1] === current) history.pop();
        if (history.length <= 1) return; // only the ignored baseline view remains
        const target = history.pop();
        this._saveViewHistory(history);
        window.location.href = target;
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'map-browser-control';

        this._button = document.createElement('button');
        this._button.className = 'map-browser-btn flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white rounded transition-colors border border-gray-700 text-sm font-medium';
        this._button.type = 'button';
        this._button.setAttribute('aria-label', 'Browse Maps');
        this._button.style.cssText = 'height: 36px; padding: 0 0.75rem; border-radius: 0.375rem; position: relative;';

        this._updateButtonState(false);

        this._button.addEventListener('click', () => {
            this.toggleBrowser();
        });

        this._container.appendChild(this._button);
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

        this._loadingOverlay.appendChild(spinner);
        this._loadingOverlay.appendChild(loadingText);
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
        this._button.style.cssText = 'height: 36px; padding: 0 0.75rem; border-radius: 0.375rem; position: relative;';
        this._button.innerHTML = `
            <sl-icon name="map" style="font-size: 14px;"></sl-icon>
            <span class="map-browser-text">Maps</span>
        `;
    }

    _ensureIframe() {
        if (this._iframe) return;

        this._iframe = document.createElement('iframe');
        this._iframe.src = 'map-browser.html';
        this._iframe.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
        `;

        this._browserContainer.appendChild(this._iframe);
    }

    _preloadBrowser() {
        this._ensureIframe();
    }

    preload() {
        this._ensureIframe();
    }

    _setupMessageListener() {
        window.addEventListener('message', (event) => {
            if (event.data.type === 'request-layer-data') {
                this._sendLayerData();
            }

            if (event.data.type === 'browser-ready') {
                // Hide loading overlay when iframe has finished rendering
                if (this._loadingOverlay) {
                    this._loadingOverlay.style.display = 'none';
                }
            }

            if (event.data.type === 'inspector-ready') {
                // Preload browser iframe when inspector is ready
                this._preloadBrowser();
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
                if (this._pendingFileData && this._iframe && this._iframe.contentWindow) {
                    const msg = {
                        type: 'load-file-data',
                        fileName: this._pendingFileData.fileName,
                        content: this._pendingFileData.content,
                        arrayBuffer: this._pendingFileData.arrayBuffer
                    };
                    const transfer = this._pendingFileData.arrayBuffer ? [this._pendingFileData.arrayBuffer] : [];
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
                this._handleAddCustomLayer(event.data.config);
            }

            if (event.data.type === 'open-layer-info') {
                this._openLayerInfo(event.data.layer);
            }

            if (event.data.type === 'load-atlas') {
                console.log('[MapBrowserControl] Received load-atlas message');
                this._handleLoadAtlas(event.data.atlasUrl);
            }

            if (event.data.type === 'zoom-to-bounds') {
                this._handleZoomToBounds(event.data.bounds, event.data.toggle);
            }

            if (event.data.type === 'previous-view') {
                this._handlePreviousView();
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

            if (event.data.type === 'creator-tile-preview') {
                this._handleCreatorTilePreview(event.data.config);
            }

            if (event.data.type === 'creator-clear-preview') {
                this._clearCreatorPreview();
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

    _openLayerInfo(layer) {
        const modal = document.getElementById('layer-info-modal');
        const iframe = document.getElementById('layer-info-iframe');

        if (!modal || !iframe) {
            console.warn('Layer info modal not found in page');
            return;
        }

        const layerJson = encodeURIComponent(JSON.stringify(layer));
        iframe.src = `map-information.html?layer=${layerJson}`;
        modal.style.display = 'block';

        const closeHandler = (e) => {
            if (e.data.type === 'close-layer-info') {
                modal.style.display = 'none';
                iframe.src = '';
                window.removeEventListener('message', closeHandler);
                window.removeEventListener('message', updateHandler);
            }
        };

        const updateHandler = (e) => {
            if (e.data.type === 'update-layer') {
                this._handleLayerUpdate(e.data.layer);
                modal.style.display = 'none';
                iframe.src = '';
                window.removeEventListener('message', closeHandler);
                window.removeEventListener('message', updateHandler);
            }
        };

        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                modal.style.display = 'none';
                iframe.src = '';
                document.removeEventListener('keydown', keyHandler);
                window.removeEventListener('message', closeHandler);
                window.removeEventListener('message', updateHandler);
            }
        };

        window.addEventListener('message', closeHandler);
        window.addEventListener('message', updateHandler);
        document.addEventListener('keydown', keyHandler);
    }

    _handleLayerUpdate(updatedLayer) {
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
                    if (parsed.id === updatedLayer.id) {
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
                    if (layerStr === updatedLayer.id) {
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
                if (layerStr === updatedLayer.id) {
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

        window.layerRegistry._registry.forEach((layer, layerId) => {
            const layerData = {
                id: layerId,
                title: layer.title || layer.id,
                type: layer.type,
                description: layer.description,
                attribution: layer.attribution,
                headerImage: layer.headerImage,
                legendImage: layer.legendImage,
                tags: layer.tags || [],
                _sourceAtlas: layer._sourceAtlas,
                bbox: this._getLayerBbox(layer)
            };

            // Include style information for thumbnails
            if (layer.style) {
                layerData.style = layer.style;
            }

            // Include top-level style properties
            const styleProps = ['icon-image', 'icon-size', 'circle-radius', 'circle-color',
                'circle-stroke-color', 'circle-stroke-width', 'circle-opacity',
                'line-color', 'line-width', 'line-opacity', 'line-dasharray',
                'fill-color', 'fill-opacity', 'fill-outline-color'];

            styleProps.forEach(prop => {
                if (layer[prop] !== undefined) {
                    layerData[prop] = layer[prop];
                }
            });

            layers.push(layerData);
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
            viewCanGoBack: this._canGoBackView()
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
                    mapLayerControl._addLayerDirectly(layerConfig).then(() => {
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
            }
        }

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

    toggleBrowser() {
        if (this._isOpen) {
            this.closeBrowser();
        } else {
            this.openBrowser();
        }
    }

    openBrowser() {
        // Show loading overlay immediately
        if (this._loadingOverlay) {
            this._loadingOverlay.style.display = 'flex';
        }

        this._ensureIframe();
        this._overlay.style.display = 'block';
        this._isOpen = true;
        this._updateButtonState(true);

        setTimeout(() => {
            this._sendLayerData();

            // Focus search input in browser
            if (this._iframe && this._iframe.contentWindow) {
                this._iframe.contentWindow.postMessage({ type: 'focus-search' }, '*');
            }
        }, 100);

        if (this._map) {
            this._map.on('moveend', this._onMapMove);
        }
    }

    closeBrowser() {
        this._overlay.style.display = 'none';
        this._isOpen = false;
        this._updateButtonState(false);

        if (this._map) {
            this._map.off('moveend', this._onMapMove);
        }

        // Return focus to main search box
        if (window.keyboardController) {
            window.keyboardController.focusSearch();
        }
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

    _switchToCreator() {
        this._ensureIframe();
        this._iframe.src = 'map-creator.html';
        if (this._loadingOverlay) {
            this._loadingOverlay.style.display = 'none';
        }
    }

    _switchToBrowser() {
        this._ensureIframe();
        this._iframe.src = 'map-browser.html';
        setTimeout(() => {
            this._sendLayerData();
        }, 100);
    }

    openCreatorWithFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        const isBinary = ext === 'gpkg' || ext === 'zip';
        const reader = new FileReader();
        reader.onload = (e) => {
            this._pendingFileData = {
                fileName: file.name,
                content: isBinary ? null : e.target.result,
                arrayBuffer: isBinary ? e.target.result : null
            };
            if (!this._isOpen) {
                this.openBrowser();
            }
            this._switchToCreator();
        };
        if (isBinary) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }
    }

    _handleZoomToBounds(bounds, toggle = false) {
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

    async _handleAddCustomLayer(config) {
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
        // shortcut when a bbox is known) used for regular layer toggles.
        this.closeBrowser();

        const layerTitle = mapLayerControl._escapeHtml?.(config.title || config.id) || (config.title || config.id);
        const zoomLink = mapLayerControl._buildZoomToLayerLink?.(config) || '';
        const messageId = MapContextMessagesControl.show(
            `Added map &quot;${layerTitle}&quot;${zoomLink ? ' &middot; ' + zoomLink : ''}`
        );
        setTimeout(() => MapContextMessagesControl.close(messageId), 3000);
    }

    _handleLoadAtlas(atlasUrl) {
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

        // Add hash if it exists
        if (window.location.hash) {
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

        this._clearCreatorTilePreview();
    }

    // Live preview for tile-based layer configs (vector/tms/wms) being edited
    // in the creator's Configuration JSON box.
    //
    // Vector previews render through the real MapboxAPI.createLayerGroup() /
    // removeLayerGroup() — the exact code path used for every real layer —
    // so the preview always matches fill/line/circle/symbol (labels),
    // layout properties, and default styling exactly, with no separate
    // paint-only reimplementation to keep in sync (see _renderVectorTilePreview).
    //
    // Raster (tms/wms) previews stay a simple opacity-only render here since
    // that's all MapboxAPI does for raster tiles anyway.
    _handleCreatorTilePreview(config) {
        if (!this._map || !config || !config.url) return;

        if (config.type === 'vector') {
            if (!config.sourceLayer) return;
            this._renderVectorTilePreview(config);
            return;
        }

        if (config.type !== 'tms' && config.type !== 'wms') return;

        const sourceId = '__creator_tile_preview__';
        const layerId = '__creator_tile_preview_raster__';
        const sourceKey = JSON.stringify([config.type, config.url, config.minzoom || 0, config.maxzoom || 22, config.tileSize || 256, config.srs || '']);
        const isSameSource = this._tilePreviewSourceKey === sourceKey && this._map.getSource(sourceId);

        try {
            const opacity = config.style?.['raster-opacity'] ?? config.opacity ?? 1;

            if (isSameSource) {
                this._setLayerPaint(layerId, { 'raster-opacity': opacity });
                return;
            }

            this._clearCreatorRasterPreview();
            const tileUrl = config.type === 'wms'
                ? this._buildWmsPreviewTileUrl(config.url, config.tileSize, config.srs)
                : config.url;
            this._map.addSource(sourceId, {
                type: 'raster',
                tileSize: config.tileSize || 256,
                minzoom: config.minzoom || 0,
                maxzoom: config.maxzoom || 22,
                tiles: [tileUrl]
            });
            this._map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: { 'raster-opacity': opacity }
            });

            this._tilePreviewSourceKey = sourceKey;
        } catch (e) {
            console.warn('[MapBrowserControl] Tile preview failed:', e);
        }
    }

    // Renders the vector tile preview by adding/replacing a real layer group
    // through the shared MapboxAPI instance (the same one that renders every
    // layer already on the map — see js/map-layer-controls.js). This is the
    // only way to get fill/line/circle/symbol, layout properties, and default
    // styling to always match the final layer exactly.
    //
    // MapboxAPI has no generic "restyle" method, so every style edit does a
    // full removeLayerGroup + createLayerGroup. That's fine here: schedulePreview()
    // in map-creator.js already debounces edits, and the vector tiles stay
    // browser-cached across the remove/re-add.
    //
    // Identity (url/sourceLayer/zoom) is tracked separately from style so that
    // _detectVectorTileInfo — which posts a message back to the creator that
    // can trigger another config render — only re-arms on a genuine source
    // change, not on every style tweak (that would risk a feedback loop).
    async _renderVectorTilePreview(config) {
        const mapboxAPI = window.layerControl?._mapboxAPI;
        if (!mapboxAPI) return;

        const groupId = '__creator_vector_preview__';
        const identityKey = JSON.stringify([config.url, config.sourceLayer, config.minzoom || 0, config.maxzoom || 22]);
        const isNewIdentity = this._vectorPreviewIdentityKey !== identityKey;
        const generation = (this._vectorPreviewGeneration = (this._vectorPreviewGeneration || 0) + 1);

        try {
            if (this._vectorPreviewActive) {
                mapboxAPI.removeLayerGroup(groupId, this._vectorPreviewConfig);
            }
            this._vectorPreviewActive = true;
            this._vectorPreviewConfig = config;

            await mapboxAPI.createLayerGroup(groupId, config, { visible: true });

            // A newer preview started while this one was loading (e.g. async
            // icon prep for a symbol layer) — bail so we don't clobber it.
            if (generation !== this._vectorPreviewGeneration) return;

            if (isNewIdentity) {
                this._vectorPreviewIdentityKey = identityKey;
                this._detectVectorTileInfo(`vector-${groupId}`, config.sourceLayer);
            }
        } catch (e) {
            console.warn('[MapBrowserControl] Vector tile preview failed:', e);
        }
    }

    _clearVectorTilePreview() {
        if (!this._vectorPreviewActive) return;
        const mapboxAPI = window.layerControl?._mapboxAPI;
        if (mapboxAPI && this._vectorPreviewConfig) {
            mapboxAPI.removeLayerGroup('__creator_vector_preview__', this._vectorPreviewConfig);
        }
        this._vectorPreviewActive = false;
        this._vectorPreviewConfig = null;
        this._vectorPreviewIdentityKey = null;
        this._vectorPreviewGeneration = (this._vectorPreviewGeneration || 0) + 1;
    }

    _clearCreatorRasterPreview() {
        if (!this._map) return;
        this._tilePreviewSourceKey = null;
        const sourceId = '__creator_tile_preview__';
        if (this._map.getLayer('__creator_tile_preview_raster__')) this._map.removeLayer('__creator_tile_preview_raster__');
        if (this._map.getSource(sourceId)) this._map.removeSource(sourceId);
    }

    _setLayerPaint(layerId, paint) {
        if (!this._map.getLayer(layerId)) return;
        Object.entries(paint).forEach(([prop, value]) => {
            this._map.setPaintProperty(layerId, prop, value);
        });
    }

    _buildWmsPreviewTileUrl(wmsUrl, tileSize = 256, srs = 'EPSG:3857') {
        const [baseUrl, query = ''] = wmsUrl.split('?');
        const params = new URLSearchParams(query);
        const lower = {};
        for (const [key, value] of params.entries()) lower[key.toLowerCase()] = value;

        const version = lower.version || '1.1.1';
        const merged = new URLSearchParams();
        merged.set('service', 'WMS');
        merged.set('version', version);
        merged.set('request', 'GetMap');
        merged.set('layers', lower.layers || lower.layer || '');
        merged.set('styles', lower.styles || '');
        merged.set('format', lower.format || 'image/png');
        merged.set('transparent', lower.transparent || 'true');
        merged.set('width', String(tileSize));
        merged.set('height', String(tileSize));
        merged.set(version.startsWith('1.3') ? 'crs' : 'srs', srs);
        merged.set('bbox', '{bbox-epsg-3857}');

        return `${baseUrl}?${merged.toString()}`;
    }

    // Best-effort: once the preview vector tiles have had a chance to load,
    // sample rendered features to report back which geometry types and
    // properties actually exist — the creator uses this to auto-check the
    // right Point/Line/Area boxes and populate the label field dropdown.
    // Returns nothing useful if the current viewport doesn't overlap the
    // source's data (the user can still check boxes manually).
    _detectVectorTileInfo(sourceId, sourceLayer) {
        if (!this._map) return;
        const token = (this._tileInfoToken = (this._tileInfoToken || 0) + 1);

        const query = () => {
            if (this._tileInfoToken !== token || !this._iframe?.contentWindow) return;
            let features = [];
            try {
                features = this._map.querySourceFeatures(sourceId, { sourceLayer });
            } catch (e) {
                return;
            }
            if (!features || features.length === 0) return;

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

        const onIdle = () => {
            query();
            this._map.off('idle', onIdle);
        };
        this._map.on('idle', onIdle);
        setTimeout(query, 800);
    }

    _clearCreatorTilePreview() {
        if (!this._map) return;
        this._tileInfoToken = (this._tileInfoToken || 0) + 1;
        this._clearVectorTilePreview();
        this._clearCreatorRasterPreview();
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
        const params = new URLSearchParams(window.location.search);

        if (atlasId) {
            params.set('atlas', atlasId);
        } else {
            params.delete('atlas');
        }

        const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
        window.history.replaceState(null, '', newUrl);
    }
}

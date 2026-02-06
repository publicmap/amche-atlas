/**
 * MapBrowserControl - Mapbox GL JS control for opening the map browser
 *
 * A compact control button that shows the current atlas name and opens
 * a full-screen map browser overlay when clicked.
 */

export class MapBrowserControl {
    constructor() {
        this._container = null;
        this._button = null;
        this._map = null;
        this._overlay = null;
        this._browserContainer = null;
        this._iframe = null;
        this._isOpen = false;
        this._setupMessageListener();
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
            this._button.style.cssText = 'height: 38px; padding: 0 0.75rem; border-radius: 0.375rem 0.375rem 0 0; border-bottom: none; position: relative; z-index: 1000;';
            this._button.innerHTML = `
                <sl-icon name="grid" style="font-size: 14px;"></sl-icon>
                <span class="map-browser-text">Map Browser</span>
            `;
        } else {
            this._button.classList.remove('active');
            this._button.style.cssText = 'height: 36px; padding: 0 0.75rem; border-radius: 0.375rem; position: relative;';
            this._button.innerHTML = `
                <sl-icon name="grid" style="font-size: 14px;"></sl-icon>
                <span class="map-browser-text">Map Browser</span>
            `;
        }
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
        // Preload the browser iframe in the background
        // Wait a bit to ensure inspector is fully settled
        setTimeout(() => {
            this._ensureIframe();
            // Send initial data once iframe is ready to receive it
            setTimeout(() => {
                if (this._iframe) {
                    this._sendLayerData();
                }
            }, 500);
        }, 1000);
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
                this._handleZoomToBounds(event.data.bounds);
            }

            if (event.data.type === 'zoom-to-layer') {
                console.log('[MapBrowserControl] Received zoom-to-layer message for:', event.data.layerId);
                this._handleZoomToLayer(event.data.layerId);
            }

            if (event.data.type === 'update-atlas-param') {
                this._handleUpdateAtlasParam(event.data.atlasId);
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
            }
        };

        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                modal.style.display = 'none';
                iframe.src = '';
                document.removeEventListener('keydown', keyHandler);
                window.removeEventListener('message', closeHandler);
            }
        };

        window.addEventListener('message', closeHandler);
        document.addEventListener('keydown', keyHandler);
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
            bounds: bounds,
            mapboxToken: window.amche?.MAPBOXGL_ACCESS_TOKEN || mapboxgl.accessToken,
            selectedAtlasId: atlasParam
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

    _handleLayerToggle(layerId, active) {
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
                mapLayerControl._toggleLayerGroup(groupIndex, true);
            }
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
    }

    _switchToBrowser() {
        this._ensureIframe();
        this._iframe.src = 'map-browser.html';
        setTimeout(() => {
            this._sendLayerData();
        }, 100);
    }

    _handleZoomToBounds(bounds) {
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

        // Zoom to bounds
        this._map.fitBounds(bbox, {
            padding: { top: 50, bottom: 50, left: 50, right: 50 },
            maxZoom: 16,
            duration: 1000
        });
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

    _handleAddCustomLayer(config) {
        console.log('[MapBrowserControl] Adding custom layer:', config);

        const url = new URL(window.location.origin + window.location.pathname);
        const hash = window.location.hash;

        // Parse URL parameters manually, keeping layers encoded until we've extracted it
        const searchParams = window.location.search;
        console.log('[MapBrowserControl] Current search params:', searchParams);

        let existingLayersEncoded = '';
        let otherParamsMap = new Map();

        if (searchParams.startsWith('?')) {
            const paramsString = searchParams.substring(1);

            // Find the layers parameter by looking for "layers="
            const layersIndex = paramsString.indexOf('layers=');

            if (layersIndex !== -1) {
                // Extract everything before layers parameter
                if (layersIndex > 0) {
                    const beforeLayers = paramsString.substring(0, layersIndex - 1); // -1 to skip the &
                    beforeLayers.split('&').forEach(param => {
                        const eqIndex = param.indexOf('=');
                        if (eqIndex !== -1) {
                            otherParamsMap.set(param.substring(0, eqIndex), param.substring(eqIndex + 1));
                        }
                    });
                }

                // Extract the layers parameter value (URL-encoded, keep it encoded!)
                // We need to find where it ends - layers should be the last parameter
                // If there are parameters after it, they would start with &
                // BUT we can't just look for & because the encoded value might contain %26
                // Solution: layers parameter goes until the end of the search string OR until we hit a real & that starts a new parameter
                // A real & would be followed by paramName=, not by encoded characters

                let layersValueEncoded = paramsString.substring(layersIndex + 7); // 7 = "layers=".length

                // Check if there's another parameter after layers by looking for &paramName=
                // We need to find an & that's followed by characters and an =
                let nextParamStart = -1;
                for (let i = 0; i < layersValueEncoded.length; i++) {
                    if (layersValueEncoded[i] === '&') {
                        // Check if this looks like a parameter start (has = within next 20 chars)
                        const remainingChunk = layersValueEncoded.substring(i + 1, Math.min(i + 21, layersValueEncoded.length));
                        if (remainingChunk.includes('=')) {
                            // This is likely a real parameter, not part of the encoded value
                            nextParamStart = i;
                            break;
                        }
                    }
                }

                if (nextParamStart !== -1) {
                    const afterLayers = layersValueEncoded.substring(nextParamStart + 1);
                    layersValueEncoded = layersValueEncoded.substring(0, nextParamStart);

                    // Parse params after layers
                    afterLayers.split('&').forEach(param => {
                        const eqIndex = param.indexOf('=');
                        if (eqIndex !== -1) {
                            otherParamsMap.set(param.substring(0, eqIndex), param.substring(eqIndex + 1));
                        }
                    });
                }

                existingLayersEncoded = layersValueEncoded;
                console.log('[MapBrowserControl] Existing layers (encoded):', existingLayersEncoded);
                console.log('[MapBrowserControl] Existing layers (decoded):', decodeURIComponent(existingLayersEncoded));
            } else {
                // No layers parameter, just parse all params
                paramsString.split('&').forEach(param => {
                    const eqIndex = param.indexOf('=');
                    if (eqIndex !== -1) {
                        otherParamsMap.set(param.substring(0, eqIndex), param.substring(eqIndex + 1));
                    }
                });
            }
        }

        let jsonString = JSON.stringify(config);
        // Escape single quotes within string values before converting double quotes to single quotes
        // This regex finds content within double quotes and escapes any single quotes inside
        jsonString = jsonString.replace(/"((?:[^"\\]|\\.)*)"/g, (match, content) => {
            // Escape single quotes in the content
            const escaped = content.replace(/'/g, "\\'");
            return `"${escaped}"`;
        });
        jsonString = jsonString.replace(/"/g, "'");
        console.log('[MapBrowserControl] New layer JSON:', jsonString);

        // Decode existing layers, combine with new while maintaining basemap grouping
        const existingLayersDecoded = existingLayersEncoded ? decodeURIComponent(existingLayersEncoded) : '';

        // Parse existing layers to separate overlays and basemaps
        let overlayLayers = [];
        let basemapLayers = [];

        if (existingLayersDecoded) {
            const layers = existingLayersDecoded.split(',');
            layers.forEach(layerStr => {
                const layerStr_trimmed = layerStr.trim();
                // Try to parse as JSON to check for basemap tag
                try {
                    if (layerStr_trimmed.startsWith('{') || layerStr_trimmed.startsWith("{'")) {
                        const parsed = JSON.parse(layerStr_trimmed.replace(/'/g, '"'));
                        const isBasemap = parsed.tags && Array.isArray(parsed.tags) && parsed.tags.includes('basemap');
                        if (isBasemap) {
                            basemapLayers.push(layerStr_trimmed);
                        } else {
                            overlayLayers.push(layerStr_trimmed);
                        }
                    } else {
                        // Simple layer ID - check if it's a basemap in the registry
                        const layerId = layerStr_trimmed;
                        const layer = window.layerRegistry?.getLayer(layerId);
                        const isBasemap = layer && layer.tags && Array.isArray(layer.tags) && layer.tags.includes('basemap');
                        if (isBasemap) {
                            basemapLayers.push(layerStr_trimmed);
                        } else {
                            overlayLayers.push(layerStr_trimmed);
                        }
                    }
                } catch (e) {
                    // If parsing fails, assume it's an overlay ID
                    const layerId = layerStr_trimmed;
                    const layer = window.layerRegistry?.getLayer(layerId);
                    const isBasemap = layer && layer.tags && Array.isArray(layer.tags) && layer.tags.includes('basemap');
                    if (isBasemap) {
                        basemapLayers.push(layerStr_trimmed);
                    } else {
                        overlayLayers.push(layerStr_trimmed);
                    }
                }
            });
        }

        // Determine if new layer is a basemap
        const isNewLayerBasemap = config.tags && Array.isArray(config.tags) && config.tags.includes('basemap');

        // Add new layer at the beginning of appropriate group
        if (isNewLayerBasemap) {
            basemapLayers.unshift(jsonString);
        } else {
            overlayLayers.unshift(jsonString);
        }

        // Combine: overlays first, then basemaps (maintaining order within each group)
        const allLayers = [...overlayLayers, ...basemapLayers];
        const newLayersDecoded = allLayers.join(',');
        console.log('[MapBrowserControl] Combined layers (decoded):', newLayersDecoded);

        // Build URL manually
        let finalUrl = url.toString();

        // Build query string with other params first, then layers (encoded)
        const queryParts = [];
        otherParamsMap.forEach((value, key) => {
            queryParts.push(`${key}=${value}`);
        });
        queryParts.push('layers=' + encodeURIComponent(newLayersDecoded));

        finalUrl += '?' + queryParts.join('&');
        finalUrl += hash;

        console.log('[MapBrowserControl] Final URL:', finalUrl);
        console.log('[MapBrowserControl] Final URL length:', finalUrl.length);
        window.location.href = finalUrl;
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

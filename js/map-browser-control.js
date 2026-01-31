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
        this._button.style.cssText = 'height: 36px; padding: 0 0.75rem; border-radius: 0.375rem;';

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
            background: white;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            border-bottom: 2px solid black;
            pointer-events: auto;
        `;

        if (window.matchMedia('(min-width: 768px)').matches) {
            this._browserContainer.style.width = '66.67%';
        }

        const updateLayout = () => {
            const header = document.querySelector('.header-nav');
            const headerHeight = header ? header.offsetHeight : 0;
            this._overlay.style.top = `${headerHeight}px`;

            if (window.matchMedia('(min-width: 768px)').matches) {
                this._browserContainer.style.width = '66.67%';
            } else {
                this._browserContainer.style.width = '100%';
            }
        };

        window.addEventListener('resize', updateLayout);

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
            this._button.style.backgroundColor = '#3b82f6';
            this._button.style.borderColor = '#3b82f6';
            this._button.style.color = 'white';
            this._button.innerHTML = `
                <sl-icon name="layers" style="font-size: 14px; color: white;"></sl-icon>
                <span class="map-browser-text" style="color: white;">Maps</span>
                <sl-icon name="x-lg" style="font-size: 12px; margin-left: -4px; color: white;"></sl-icon>
            `;
        } else {
            this._button.classList.remove('active');
            this._button.style.backgroundColor = '';
            this._button.style.borderColor = '';
            this._button.style.color = '';
            this._button.innerHTML = `
                <sl-icon name="layers" style="font-size: 14px;"></sl-icon>
                <span class="map-browser-text">Maps</span>
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

    _setupMessageListener() {
        window.addEventListener('message', (event) => {
            if (event.data.type === 'request-layer-data') {
                this._sendLayerData();
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

            if (event.data.type === 'load-atlas') {
                console.log('[MapBrowserControl] Received load-atlas message');
                this._handleLoadAtlas(event.data.atlasUrl);
            }

            if (event.data.type === 'zoom-to-bounds') {
                this._handleZoomToBounds(event.data.bounds);
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

        this._iframe.contentWindow.postMessage({
            type: 'layer-data',
            layers: layers,
            activeLayers: Array.from(activeLayers),
            atlasMetadata: atlasMetadata,
            bounds: bounds,
            mapboxToken: window.amche?.MAPBOXGL_ACCESS_TOKEN || mapboxgl.accessToken
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
                active.add(layer.id);
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

        const groupIndex = mapLayerControl._state.groups.findIndex(g =>
            g.id === layerId || g._prefixedId === layerId || g._originalId === layerId
        );

        if (groupIndex === -1) {
            console.warn(`[MapBrowser] Layer ${layerId} not found in map layer control state`);
            console.log('[MapBrowser] Available layer IDs:', mapLayerControl._state.groups.map(g => g.id));
            return;
        }

        console.log('[MapBrowser] Found layer at group index:', groupIndex);

        const groupElement = mapLayerControl._sourceControls[groupIndex];
        if (!groupElement) {
            console.warn(`[MapBrowser] UI element for layer ${layerId} not found at index ${groupIndex}`);
            console.log('[MapBrowser] Total source controls:', mapLayerControl._sourceControls.length);
            return;
        }

        const checkbox = groupElement.querySelector('.toggle-switch input[type="checkbox"]');
        if (!checkbox) {
            console.warn(`[MapBrowser] Checkbox for layer ${layerId} not found`);
            return;
        }

        console.log('[MapBrowser] Toggling layer:', layerId, 'to', active);

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
        jsonString = jsonString.replace(/"/g, "'");
        console.log('[MapBrowserControl] New layer JSON:', jsonString);

        // Decode existing layers, combine with new, then re-encode
        const existingLayersDecoded = existingLayersEncoded ? decodeURIComponent(existingLayersEncoded) : '';
        const newLayersDecoded = existingLayersDecoded ? jsonString + ',' + existingLayersDecoded : jsonString;
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
}

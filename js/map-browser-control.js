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
        this._iframe = null;
        this._isOpen = false;
        this._setupMessageListener();
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'map-browser-control';

        this._button = document.createElement('button');
        this._button.className = 'map-browser-btn flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors border border-gray-700 text-sm font-medium';
        this._button.type = 'button';
        this._button.setAttribute('aria-label', 'Browse Maps');

        this._button.innerHTML = `
            <sl-icon name="layers" style="font-size: 16px;"></sl-icon>
            <span class="map-browser-text">Maps</span>
        `;

        this._button.addEventListener('click', () => {
            this.toggleBrowser();
        });

        this._container.appendChild(this._button);
        this._createOverlay();

        return this._container;
    }

    _createOverlay() {
        this._overlay = document.createElement('div');
        this._overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            display: none;
        `;

        const browserContainer = document.createElement('div');
        browserContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: white;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        `;

        // Apply responsive width via media query
        if (window.matchMedia('(min-width: 768px)').matches) {
            browserContainer.style.width = '66.67%';
        }

        // Update on resize
        window.addEventListener('resize', () => {
            if (window.matchMedia('(min-width: 768px)').matches) {
                browserContainer.style.width = '66.67%';
            } else {
                browserContainer.style.width = '100%';
            }
        });

        this._iframe = document.createElement('iframe');
        this._iframe.src = 'map-browser.html';
        this._iframe.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
        `;

        browserContainer.appendChild(this._iframe);
        this._overlay.appendChild(browserContainer);
        document.body.appendChild(this._overlay);

        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) {
                this.closeBrowser();
            }
        });
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
            layers.push({
                id: layerId,
                title: layer.title || layer.id,
                description: layer.description,
                headerImage: layer.headerImage,
                tags: layer.tags || [],
                _sourceAtlas: layer._sourceAtlas,
                bbox: this._getLayerBbox(layer)
            });
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

        const groupIndex = mapLayerControl._state.groups.findIndex(g =>
            g.id === layerId || g._prefixedId === layerId || g._originalId === layerId
        );

        if (groupIndex === -1) {
            console.warn(`[MapBrowser] Layer ${layerId} not found in map layer control`);
            return;
        }

        const groupElement = mapLayerControl._sourceControls[groupIndex];
        if (!groupElement) {
            console.warn(`[MapBrowser] UI element for layer ${layerId} not found`);
            return;
        }

        const checkbox = groupElement.querySelector('.toggle-switch input[type="checkbox"]');
        if (!checkbox) {
            console.warn(`[MapBrowser] Checkbox for layer ${layerId} not found`);
            return;
        }

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
        this._overlay.style.display = 'block';
        this._isOpen = true;

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
}

/**
 * StreetviewControl - top-left Mapbox GL control that opens a resizable panel
 * embedding streetview.html (a standalone MapillaryJS viewer, see
 * js/streetview-viewer.js). Communicates with that iframe purely via
 * postMessage, mirroring the convention used by MapFeatureControl /
 * map-inspector.html.
 *
 * Owns everything the iframe itself has no access to: turning the Mapillary
 * coverage layers on/off, finding the photo nearest the map center for the
 * toolbar-button entry point, and reflecting the viewer's live position/
 * heading/tilt onto the main map (heading marker + optional follow/
 * perspective camera sync).
 */

import { resolveNearestImageId } from './mapillary-utils.js';

const STREETVIEW_LAYER_IDS = ['mapillary-coverage', 'mapillary-coverage-photos'];
const BASE_PITCH = 65;

// Maps MapillaryJS's camera tilt (-90 straight down, 0 level, +90 straight up)
// onto Mapbox's pitch (0 top-down, 85 near horizon), so looking down within
// the photo brings the map toward a top-down view and looking up tilts it
// further toward the horizon - matching the photo's own perspective.
function tiltToPitch(tiltDeg) {
    const tilt = Number(tiltDeg) || 0;
    if (tilt >= 0) return BASE_PITCH + (tilt / 90) * (85 - BASE_PITCH);
    return BASE_PITCH + (tilt / 90) * BASE_PITCH;
}

function polarToXY(cx, cy, r, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

function createPositionMarkerEl() {
    const el = document.createElement('div');
    el.style.cssText = 'width:100px;height:100px;pointer-events:none;';
    el.innerHTML = '<svg width="100" height="100" viewBox="0 0 100 100" style="overflow:visible;">'
        + '<path class="sv-cone-path" fill="rgba(5,203,99,0.35)" stroke="rgba(5,203,99,0.7)" stroke-width="1"></path>'
        + '<circle cx="50" cy="50" r="6" fill="#05CB63" stroke="#ffffff" stroke-width="2"></circle>'
        + '</svg>';
    return el;
}

// Draws the heading indicator as a pie slice pointing straight up (bearing 0)
// in the marker's own local frame; fov controls how wide it opens. The
// marker's actual compass orientation is handled separately via
// mapboxgl.Marker's own rotationAlignment:'map' + setRotation(), so it stays
// correctly oriented relative to geography (not the screen) as the main map
// is rotated.
function updateConeWidth(el, fovDeg) {
    const path = el && el.querySelector('.sv-cone-path');
    if (!path) return;
    const r = 42;
    const half = Math.min(Math.max(Number(fovDeg) || 60, 20), 150) / 2;
    const [x1, y1] = polarToXY(50, 50, r, -half);
    const [x2, y2] = polarToXY(50, 50, r, half);
    const largeArc = half * 2 > 180 ? 1 : 0;
    path.setAttribute('d', `M50,50 L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`);
}

export class StreetviewControl {
    constructor() {
        this._map = null;
        this._container = null;
        this._panel = null;
        this._iframe = null;
        this._iframeSrcLoaded = false;
        this._isIframeReady = false;
        this._messageQueue = [];
        this._marker = null;
        this._addedLayerIds = [];
        this._toggledOnLayerIds = [];
        this._lastPerspective = undefined;
    }

    onAdd(map) {
        this._map = map;
        this._createContainer();
        this._setupMessageListener();
        return this._container;
    }

    onRemove() {
        window.removeEventListener('message', this._messageListener);
        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        if (this._panel && this._panel.parentNode) {
            this._panel.parentNode.removeChild(this._panel);
        }
        this._map = null;
    }

    getDefaultPosition() {
        return 'top-left';
    }

    _createContainer() {
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';

        const button = document.createElement('button');
        button.className = 'mapboxgl-ctrl-icon';
        button.type = 'button';
        button.setAttribute('aria-label', 'Street View');
        button.style.cssText = 'width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-size: 16px;';
        button.innerHTML = '<sl-icon name="camera" style="font-size: 14px;"></sl-icon>';
        button.addEventListener('click', () => this._togglePanel());

        this._container.appendChild(button);
        this._createPanel();
    }

    _createPanel() {
        this._panel = document.createElement('div');
        this._panel.style.cssText = `
            display: none;
            position: absolute;
            top: 40px;
            left: 8px;
            width: 480px;
            height: 360px;
            min-width: 280px;
            min-height: 200px;
            max-width: calc(100vw - 20px);
            max-height: calc(100vh - 60px);
            background: #111827;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            overflow: hidden;
            resize: both;
            flex-direction: column;
        `;

        const header = document.createElement('div');
        header.style.cssText = 'flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; background: #0b1220; border-bottom: 1px solid #374151;';
        header.innerHTML = '<span style="font-size: 11px; font-weight: 600; color: #9ca3af; letter-spacing: 0.06em;">STREET VIEW</span>';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close Street View');
        closeButton.innerHTML = '×';
        closeButton.style.cssText = 'background: none; border: none; color: #9ca3af; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px;';
        closeButton.addEventListener('click', () => this.close());
        header.appendChild(closeButton);

        this._iframe = document.createElement('iframe');
        this._iframe.style.cssText = 'flex: 1; width: 100%; border: none; min-height: 0;';

        this._panel.appendChild(header);
        this._panel.appendChild(this._iframe);
        this._map.getContainer().appendChild(this._panel);
    }

    _togglePanel() {
        if (this._panel.style.display === 'none') {
            this.open();
        } else {
            this.close();
        }
    }

    _showPanel() {
        if (!this._iframeSrcLoaded) {
            this._iframe.src = 'streetview.html';
            this._iframeSrcLoaded = true;
        }
        this._panel.style.display = 'flex';
    }

    _hidePanel() {
        this._panel.style.display = 'none';
    }

    /**
     * Opens the panel and shows a given image, or - when called with no
     * imageId (the toolbar button path) - the photo nearest the current map
     * center. Also called from config/mapillary.js's onClick handler for
     * mapillary-coverage / mapillary-coverage-photos features.
     */
    async open({ imageId } = {}) {
        this._showPanel();
        await this._ensureLayersActive();

        let resolvedImageId = imageId;
        if (!resolvedImageId) {
            const center = this._map.getCenter();
            try {
                resolvedImageId = await resolveNearestImageId({ lng: center.lng, lat: center.lat });
            } catch (error) {
                console.error('[Streetview] Nearest-image lookup failed:', error);
            }
        }

        this._sendMessageToIframe({ type: 'streetview-open', imageId: resolvedImageId });
    }

    close() {
        this._hidePanel();
        if (this._iframeSrcLoaded) {
            this._iframe.src = 'about:blank';
            this._iframeSrcLoaded = false;
            this._isIframeReady = false;
            this._messageQueue = [];
        }
        if (this._marker) {
            this._marker.remove();
            this._marker = null;
        }
        this._lastPerspective = undefined;
        this._disableAddedLayers();
    }

    async _ensureLayersActive() {
        if (!window.layerControl) return;
        for (const layerId of STREETVIEW_LAYER_IDS) {
            await this._activateLayer(layerId);
        }
    }

    // Mirrors js/map-browser-control.js's _handleLayerToggle(layerId, true): if the
    // layer is already part of the current atlas (present in _state.groups, just
    // switched off), flip its existing checkbox on via _toggleLayerGroup(); only if
    // it isn't part of the current atlas at all does it get dynamically injected
    // via _addLayerDirectly() from the layer registry.
    async _activateLayer(layerId) {
        const layerControl = window.layerControl;
        const groupIndex = layerControl._state.groups.findIndex(g =>
            g.id === layerId || g._prefixedId === layerId || g._originalId === layerId
        );

        if (groupIndex !== -1) {
            const groupElement = layerControl._sourceControls?.[groupIndex];
            const checkbox = groupElement?.querySelector?.('.toggle-switch input[type="checkbox"]');
            if (checkbox && !checkbox.checked) {
                checkbox.checked = true;
                groupElement.show?.();
                await layerControl._toggleLayerGroup(groupIndex, true);
                this._toggledOnLayerIds.push(layerId);
            }
            return;
        }

        if (window.layerRegistry && window.layerRegistry._registry.has(layerId)) {
            const layerConfig = window.layerRegistry._registry.get(layerId);
            await layerControl._addLayerDirectly(layerConfig);
            this._addedLayerIds.push(layerId);
        } else {
            console.warn(`[Streetview] Layer ${layerId} not found in layer registry`);
        }
    }

    _disableAddedLayers() {
        const layerControl = window.layerControl;
        if (!layerControl) return;

        for (const layerId of this._addedLayerIds) {
            layerControl._removeCrossAtlasLayer(layerId);
        }
        this._addedLayerIds = [];

        for (const layerId of this._toggledOnLayerIds) {
            const groupIndex = layerControl._state.groups.findIndex(g =>
                g.id === layerId || g._prefixedId === layerId || g._originalId === layerId
            );
            if (groupIndex === -1) continue;
            const groupElement = layerControl._sourceControls?.[groupIndex];
            const checkbox = groupElement?.querySelector?.('.toggle-switch input[type="checkbox"]');
            if (checkbox && checkbox.checked) {
                checkbox.checked = false;
                groupElement.hide?.();
                layerControl._toggleLayerGroup(groupIndex, false);
            }
        }
        this._toggledOnLayerIds = [];
    }

    _setupMessageListener() {
        this._messageListener = (event) => {
            if (!this._iframe || event.source !== this._iframe.contentWindow) return;
            const data = event.data || {};
            if (data.type === 'streetview-ready') {
                this._isIframeReady = true;
                this._flushMessageQueue();
            } else if (data.type === 'streetview-state') {
                this._handleState(data);
            }
        };
        window.addEventListener('message', this._messageListener);
    }

    _sendMessageToIframe(message) {
        if (this._isIframeReady && this._iframe && this._iframe.contentWindow) {
            this._iframe.contentWindow.postMessage(message, '*');
        } else {
            this._messageQueue.push(message);
        }
    }

    _flushMessageQueue() {
        while (this._messageQueue.length > 0) {
            const message = this._messageQueue.shift();
            if (this._iframe && this._iframe.contentWindow) {
                this._iframe.contentWindow.postMessage(message, '*');
            }
        }
    }

    _handleState(data) {
        const { lng, lat, bearing, tilt, fov, follow, perspective } = data;
        if (typeof lng !== 'number' || typeof lat !== 'number') return;

        if (!this._marker) {
            const el = createPositionMarkerEl();
            this._marker = new mapboxgl.Marker({
                element: el,
                anchor: 'center',
                rotationAlignment: 'map',
                pitchAlignment: 'map'
            })
                .setLngLat([lng, lat])
                .addTo(this._map);
            this._marker._svEl = el;
        } else {
            this._marker.setLngLat([lng, lat]);
        }
        this._marker.setRotation(bearing);
        updateConeWidth(this._marker._svEl, fov);

        // Perspective mode continuously rotates/tilts the main map to match the
        // photo; the instant it's turned off, ease back to a normal north-up,
        // flat view instead of just leaving the map frozen at whatever
        // bearing/pitch it last had.
        const perspectiveJustDisabled = this._lastPerspective === true && perspective === false;
        this._lastPerspective = perspective;

        if (follow || perspectiveJustDisabled) {
            const flyTo = { duration: 500 };
            if (follow) flyTo.center = [lng, lat];
            if (perspective) {
                flyTo.bearing = bearing;
                flyTo.pitch = tiltToPitch(tilt);
            } else if (perspectiveJustDisabled) {
                flyTo.bearing = 0;
                flyTo.pitch = 0;
            }
            this._map.easeTo(flyTo);
        }
    }
}

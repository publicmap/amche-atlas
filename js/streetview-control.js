/**
 * StreetviewControl - top-right Mapbox GL control that opens a resizable panel
 * embedding streetview.html (a standalone MapillaryJS viewer, see
 * js/streetview-viewer.js). Communicates with that iframe purely via
 * postMessage, the same convention other iframe-embedding controls use.
 *
 * Owns everything the iframe itself has no access to: turning the Mapillary
 * coverage layers on/off, finding the photo nearest the existing selection
 * marker (or the map center if there isn't one) for the toolbar-button entry
 * point, reflecting the viewer's live position/heading/tilt onto the main map
 * (heading marker + optional follow/perspective camera sync), and - while the
 * panel's "Pin Location" checkbox is on - keeping a separate MapMarkerManager
 * pin (see _syncPinMarker) glued to whatever photo is currently open, tied
 * one-to-one with the panel: clearing that pin closes the panel, and closing
 * the panel removes the pin.
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
        this._collapsedForNoImage = false;
        this._savedPanelSize = null;
        this._pinMarkerId = null;
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
        return 'top-right';
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
     * imageId (the toolbar button path) - the photo nearest the current
     * selection marker, falling back to the map center if there isn't one.
     * Also called from config/mapillary.js's onClick handler for
     * mapillary-coverage / mapillary-coverage-photos features.
     */
    async open({ imageId } = {}) {
        this._showPanel();
        await this._ensureLayersActive();

        let resolvedImageId = imageId;
        if (!resolvedImageId) {
            const { lng, lat } = window.featureControl?._markerManager?.getCurrentMarkerLngLat?.() || this._map.getCenter();
            try {
                resolvedImageId = await resolveNearestImageId({ lng, lat });
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
        this._collapsedForNoImage = false;
        this._savedPanelSize = null;
        // Silent: this is the panel closing, not the pin being cleared by the
        // user - no need to hear the "pin removed" echo and try to close again.
        this._removePinMarker({ silent: true });
        this._disableAddedLayers();
    }

    /**
     * Adds or moves this control's own tracking pin (the "Pin Location"
     * checkbox in streetview.html) to the given location, or removes it if
     * pinning is disabled. Reused across both a fresh pin and moving an
     * existing one so the marker glues to whatever photo is currently open.
     */
    _syncPinMarker(enabled, lngLat) {
        const markerManager = window.featureControl?._markerManager;
        if (!markerManager) return;

        if (!enabled) {
            this._removePinMarker({ silent: true });
            return;
        }

        if (this._pinMarkerId && markerManager.hasMarker(this._pinMarkerId)) {
            markerManager.updateMarkerLocation(this._pinMarkerId, lngLat);
        } else {
            this._pinMarkerId = markerManager.addMarker(lngLat, [], {
                onRemove: () => this._handlePinMarkerRemoved()
            });
        }
    }

    _removePinMarker({ silent = false } = {}) {
        if (!this._pinMarkerId) return;
        const markerManager = window.featureControl?._markerManager;
        const id = this._pinMarkerId;
        this._pinMarkerId = null;
        markerManager?.removeMarker(id, { silent });
    }

    /**
     * Called when the tracking pin is removed some other way than this
     * control's own teardown - e.g. the user hits the trash action beside the
     * marker's id label, or clears every selection at once.
     * Per the "clearing this pin closes the panel, and vice versa" contract,
     * that closes the Street View panel in turn.
     */
    _handlePinMarkerRemoved() {
        this._pinMarkerId = null;
        this.close();
    }

    /**
     * Shrinks the panel to fit the short "no imagery here" message (see
     * streetview-viewer.js's showNoImageMessage) instead of leaving it sized
     * for a full photo. Remembers whatever size the panel had (default or
     * user-resized via the `resize: both` handle) so _restorePanelSize can
     * put it back once a real image opens.
     */
    _collapsePanelForNoImage() {
        if (this._collapsedForNoImage) return;
        this._collapsedForNoImage = true;
        this._savedPanelSize = { width: this._panel.style.width, height: this._panel.style.height };
        this._panel.style.width = '300px';
        this._panel.style.height = '150px';
    }

    _restorePanelSize() {
        if (!this._collapsedForNoImage) return;
        this._collapsedForNoImage = false;
        if (this._savedPanelSize) {
            this._panel.style.width = this._savedPanelSize.width || '480px';
            this._panel.style.height = this._savedPanelSize.height || '360px';
        }
        this._savedPanelSize = null;
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

        // mapillary-* layers live in a local atlas (always eagerly loaded), but
        // guard with ensureAtlasLoaded in case that atlas is ever made external/deferred.
        if (window.layerRegistry?.ensureAtlasLoaded) {
            await window.layerRegistry.ensureAtlasLoaded(layerId.split('-')[0]);
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
                this._restorePanelSize();
                this._handleState(data);
            } else if (data.type === 'streetview-no-image') {
                this._collapsePanelForNoImage();
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
        const { reason, lng, lat, bearing, tilt, fov, follow, perspective, pinLocation } = data;
        if (typeof lng !== 'number' || typeof lat !== 'number') return;

        // Only sync the pin on an actual photo change or an explicit checkbox
        // toggle - 'pov'/'fov' fire continuously while looking around/zooming
        // within the same photo (same location, just a different camera angle),
        // and would otherwise spam marker updates + URL writes on every tick.
        if (reason === 'image' || reason === 'options') {
            this._syncPinMarker(pinLocation, { lng, lat });
        }

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

        if (!follow && !perspectiveJustDisabled) return;

        const cameraUpdate = {};
        if (follow) cameraUpdate.center = [lng, lat];
        if (follow && perspective) {
            cameraUpdate.bearing = bearing;
            cameraUpdate.pitch = tiltToPitch(tilt);
        } else if (perspectiveJustDisabled) {
            cameraUpdate.bearing = 0;
            cameraUpdate.pitch = 0;
        }

        // 'pov'/'fov' fire continuously while the user looks around/zooms
        // within the same image - jumpTo (no animation) so the map doesn't lag
        // behind a live drag. 'image'/'options' (a discrete photo change, or a
        // deliberate Follow/Perspective toggle) get an eased transition instead.
        if (reason === 'pov' || reason === 'fov') {
            this._map.jumpTo(cameraUpdate);
        } else {
            this._map.easeTo({ ...cameraUpdate, duration: 500 });
        }
    }
}

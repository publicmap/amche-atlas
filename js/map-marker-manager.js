/**
 * MapMarkerManager - Manages selection markers on the map
 * Creates markers at selection locations with popups showing selected features
 */
import { LayerThumbnail } from './layer-thumbnail.js';
import { FeatureDisplayRenderer } from './feature-display-renderer.js';
import { LayerOrderManager } from './layer-order-manager.js';

export class MapMarkerManager {
    constructor(map, stateManager, mapboxAPI = null) {
        this._map = map;
        this._stateManager = stateManager;
        this._mapboxAPI = mapboxAPI;
        this._markers = new Map();
        this._hoverMarker = null;
        this._currentMarkerIndex = 0;
        this._selectionMode = 'replace';
        this._expandedFeatures = new Map(); // markerId -> featureId
        this._cameraPositions = new Map(); // markerId-featureId -> camera state
        this._isMapMoving = false;
        this._isProgrammaticZoom = false; // Track programmatic zooms
        this._selectionLayerId = 'selection'; // Layer ID for selection markers
        this._starredMarkers = new Set(); // Marker IDs that are starred (persist on new selection)
        this._selectedBadges = new Set(); // Expanded (selected) feature badges
        this._badgeViewSaved = null; // Camera state to restore when no badge is selected
        this._isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

        this._setupEventListeners();
        this._setupMapMovementTracking();
    }

    /**
     * Set the MapboxAPI reference (can be called after construction)
     */
    setMapboxAPI(mapboxAPI) {
        this._mapboxAPI = mapboxAPI;
    }

    _setupEventListeners() {
        this._stateManager.addEventListener('state-change', (event) => {
            const { eventType, data } = event.detail;

            if (eventType === 'feature-click' || eventType === 'feature-click-multiple' || eventType === 'empty-map-click') {
                console.log('[TapDebug] markerManager received', { eventType, isTouch: this._isTouch });
            }

            if (eventType === 'feature-click' || eventType === 'feature-click-multiple') {
                this._handleSelection(data);
            }

            if (eventType === 'empty-map-click') {
                this._handleEmptyMapClick(data);
            }

            if (eventType === 'features-batch-hover') {
                this._handleBatchHover(data);
            }

            if (eventType === 'map-mouse-leave') {
                this._clearHoverMarker();
                this._clearAllMarkerHoverStates();
            }

            if (eventType === 'selections-cleared') {
                this.clearAllMarkers();
            }

            if (eventType === 'selection-cleared') {
                const clearedLayerId = data.layerId;
                this._markers.forEach((markerData, id) => {
                    if (this._starredMarkers.has(id)) return;
                    markerData.features = markerData.features.filter(f => f.layerId !== clearedLayerId);
                });
                this._updateSelectionLayer();
            }
        });

        this._map.on('movestart', () => {
            if (!this._isProgrammaticZoom) {
                this._markers.forEach(markerData => {
                    this._fadePopup(markerData.id, true);
                });
            }
        });
    }

    _setupMapMovementTracking() {
        this._map.on('movestart', () => {
            this._isMapMoving = true;
        });

        this._map.on('moveend', () => {
            this._isMapMoving = false;
            if (!this._isProgrammaticZoom) {
                this._markers.forEach(markerData => {
                    this._fadePopup(markerData.id, false);
                });
            }
        });
    }

    /**
     * Get active layers that are in current view
     */
    _getActiveLayersInView() {
        if (!window.layerControl?._state?.groups) {
            return [];
        }

        const currentBounds = this._map.getBounds();
        const bounds = [
            currentBounds.getWest(),
            currentBounds.getSouth(),
            currentBounds.getEast(),
            currentBounds.getNorth()
        ];

        // Get active layers
        const activeLayers = [];
        window.layerControl._state.groups.forEach((group, index) => {
            const isActive = this._isLayerActive(index);
            if (isActive && group.id) {
                activeLayers.push(group);
            }
        });

        // Filter by view using MapUtils if available
        if (window.MapUtils) {
            return activeLayers.filter(layer => {
                // Check if layer has bbox
                if (!layer.bbox && layer._sourceAtlas && window.layerRegistry) {
                    const atlasMetadata = window.layerRegistry._atlasMetadata?.get(layer._sourceAtlas);
                    if (atlasMetadata?.bbox) {
                        const layerWithAtlasBbox = { ...layer, bbox: atlasMetadata.bbox };
                        return window.MapUtils.isLayerInView(layerWithAtlasBbox, bounds);
                    }
                }
                return window.MapUtils.isLayerInView(layer, bounds);
            });
        }

        return activeLayers;
    }

    /**
     * Check if a layer is currently active
     */
    _isLayerActive(groupIndex) {
        if (!window.layerControl?._sourceControls?.[groupIndex]) {
            return false;
        }

        const $groupControl = $(window.layerControl._sourceControls[groupIndex]);
        const $toggle = $groupControl.find('.toggle-switch input[type="checkbox"]');
        return $toggle.length > 0 && $toggle.prop('checked');
    }

    /**
     * Get all active layers in the same order as inspector display
     */
    _getAllActiveLayersInInspectorOrder() {
        if (!window.layerControl?._state?.groups) {
            return [];
        }

        const activeLayers = [];
        window.layerControl._state.groups.forEach((group, index) => {
            const isActive = this._isLayerActive(index);
            if (isActive && group.id) {
                activeLayers.push(group);
            }
        });

        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(activeLayers);
        return [...overlays, ...basemaps];
    }

    _handleSelection(data) {
        // Selections restored from a shared URL already had their markers created by
        // restoreMarkersFromSelectionLayer; this event only notifies the inspector, so
        // don't re-create the markers here.
        if (data.fromMarkerRestore) return;

        const features = data.selectedFeatures || [data];
        const lngLat = features[0]?.lngLat;

        if (!lngLat) {
            console.log('[TapDebug] _handleSelection bail: no lngLat', { features });
            return;
        }
        console.log('[TapDebug] _handleSelection -> addMarker', { lngLat, featureCount: features.length });

        // Clear hover marker and marker hover states on selection
        this._clearHoverMarker();
        this._clearAllMarkerHoverStates();

        // Check if we're in add mode (either via toggle button OR keyboard Cmd/Ctrl)
        const isAddMode = this._selectionMode === 'add' || this._stateManager._isCmdCtrlPressed;

        if (!isAddMode) {
            // Replace mode - clear existing markers
            this.clearAllMarkers();
        }

        // Don't auto-open the popup; let the user click the marker for details.
        this.addMarker(lngLat, features, { showPopup: false });
    }

    _handleEmptyMapClick(data) {
        const { lngLat } = data;
        if (!lngLat) {
            console.log('[TapDebug] _handleEmptyMapClick bail: no lngLat');
            return;
        }
        console.log('[TapDebug] _handleEmptyMapClick -> addMarker', { lngLat });

        // Clear hover marker and marker hover states on selection
        this._clearHoverMarker();
        this._clearAllMarkerHoverStates();

        // Check if we're in add mode (either via toggle button OR keyboard Cmd/Ctrl)
        const isAddMode = this._selectionMode === 'add' || this._stateManager._isCmdCtrlPressed;

        if (!isAddMode) {
            // Replace mode - clear existing markers
            this.clearAllMarkers();
        }

        // Create marker with empty features array (will show layer info only).
        // Don't auto-open the popup; let the user click the marker for details.
        this.addMarker(lngLat, [], { showPopup: false });
    }

    _handleBatchHover(data) {
        // Don't update hover markers during map movement (pan/zoom) on desktop.
        // On touch, center-hover live-queries during the pan so the hover popup
        // tracks the moving center — allow it through.
        if (this._isMapMoving && !this._isTouch) {
            return;
        }

        // Pointer is over an existing inspect marker (buttons or badges) — those
        // capture the interaction, so don't show a redundant hover popup.
        if (this._pointerOverMarker) {
            this._clearHoverMarker();
            return;
        }

        const hoveredFeatures = data.hoveredFeatures || [];

        if (!hoveredFeatures || hoveredFeatures.length === 0) {
            this._clearHoverMarker();
            this._clearAllMarkerHoverStates();
            return;
        }

        const lngLat = data.lngLat || hoveredFeatures[0]?.lngLat;

        if (!lngLat) {
            this._clearHoverMarker();
            this._clearAllMarkerHoverStates();
            return;
        }

        // Drop hovered features that already have an inspect marker — re-showing them
        // in a hover popup is redundant.
        const markedKeys = new Set();
        this._markers.forEach(markerData => {
            markerData.features.forEach(f => markedKeys.add(`${f.layerId}:${f.featureId}`));
        });
        const freshFeatures = hoveredFeatures.filter(f => !markedKeys.has(`${f.layerId}:${f.featureId}`));

        if (freshFeatures.length === 0) {
            // Everything under the cursor is already marked — highlight the marker
            // instead of showing a redundant hover popup.
            this._clearHoverMarker();
            const matchingMarker = this._findMarkerByFeatures(hoveredFeatures);
            if (matchingMarker) {
                this._setMarkerHoverState(matchingMarker.id, true);
            }
            return;
        }

        // Show hover popup only for the not-yet-marked features.
        this._clearAllMarkerHoverStates();

        const labels = freshFeatures.map(f => {
            const layerConfig = this._stateManager.getLayerConfig(f.layerId);
            const inspectConfig = layerConfig?.inspect || {};
            const labelField = inspectConfig.label || inspectConfig.id || 'id';
            return f.feature.properties?.[labelField] || f.featureId;
        });
        const labelText = labels.join(', ');

        this._showHoverMarker(lngLat, labelText, freshFeatures);
    }

    _truncateName(value, max = 10) {
        const s = String(value ?? '');
        return s.length > max ? `${s.slice(0, max)}...` : s;
    }

    _escapeAttr(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _getBadgeLabelInfo(f) {
        const layerConfig = this._stateManager.getLayerConfig(f.layerId);
        const inspectConfig = layerConfig?.inspect || {};
        const labelField = inspectConfig.label || inspectConfig.id || 'id';
        const value = f.feature?.properties?.[labelField] ?? f.featureId;
        return { fieldName: inspectConfig.title || inspectConfig.label || labelField, value };
    }

    _createFeatureBadgeHTML(fieldName, value, index, f) {
        const display = this._truncateName(value, 10);
        const detailsHTML = f ? this._buildBadgeAttributeTable(f) : '';
        return `
            <div class="feature-badge" data-badge-index="${index}" title="${this._escapeAttr(value)}" style="
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                background: rgba(255, 255, 0, 0.9);
                border: 1px solid rgba(255, 255, 0, 1);
                border-radius: 8px;
                padding: 2px 7px;
                cursor: pointer;
                box-shadow: 0 1px 4px rgba(0,0,0,0.35);
                transition: border-color 0.15s, background 0.15s, opacity 0.15s;
                max-width: 240px;
            ">
                <div class="feature-badge-header" style="display: flex; flex-direction: row; align-items: center; gap: 4px; width: 100%;">
                    <sl-icon class="badge-eye" name="eye" style="display: none; font-size: 12px; color: #6b7280; flex-shrink: 0; pointer-events: none;"></sl-icon>
                    <div style="display: flex; flex-direction: column; align-items: flex-start; min-width: 0;">
                        <span style="font-size: 8px; line-height: 1.1; font-weight: 600; color: #c2410c; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap;">${this._escapeAttr(fieldName)}</span>
                        <span class="badge-value" data-full="${this._escapeAttr(value)}" data-short="${this._escapeAttr(display)}" style="font-size: 11px; line-height: 1.2; font-weight: 700; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this._escapeAttr(display)}</span>
                    </div>
                </div>
                ${detailsHTML}
            </div>
        `;
    }

    /**
     * Build the collapsible attribute table shown when a badge is selected.
     * Mirrors the inspector's field-selection logic (inspect.fields / fieldTitles,
     * falling back to all non-empty properties) but styled to match the yellow badge.
     */
    _buildBadgeAttributeTable(f) {
        if (!f || !f.feature) return '';
        const layerConfig = this._stateManager.getLayerConfig(f.layerId);
        const inspectConfig = layerConfig?.inspect || {};
        const properties = f.feature.properties || {};
        const fields = inspectConfig.fields || [];
        const fieldTitles = inspectConfig.fieldTitles || [];

        const buildRow = (label, value) =>
            `<div style="display:flex;gap:6px;font-size:9px;line-height:1.25;padding:1px 0;border-bottom:1px solid rgba(0,0,0,0.1);">` +
            `<div style="color:#78350f;min-width:54px;max-width:88px;font-weight:600;flex-shrink:0;word-break:break-word;">${this._escapeAttr(label)}</div>` +
            `<div style="color:#1a1a1a;flex:1;word-break:break-word;white-space:pre-line;">${this._escapeAttr(value)}</div>` +
            `</div>`;

        const validEntries = Object.entries(properties).filter(([, v]) => v !== null && v !== undefined && v !== '');

        let rows = [];
        if (fields.length > 0) {
            rows = fields.map((fieldName, i) => {
                const value = properties[fieldName];
                if (value !== null && value !== undefined && value !== '') {
                    return buildRow(fieldTitles[i] || fieldName, value);
                }
                return '';
            }).filter(Boolean);
        } else {
            rows = validEntries.map(([k, v]) => buildRow(k, v));
        }

        if (rows.length === 0) {
            rows = [`<div style="font-size:9px;color:#78350f;padding:2px 0;">No attributes</div>`];
        }

        const footer = this._buildBadgeLayerFooter(f);

        return `<div class="feature-badge-details" style="display:none;width:100%;margin-top:3px;border-top:1px solid rgba(0,0,0,0.2);padding-top:3px;max-height:180px;overflow-y:auto;">${rows.join('')}${footer}</div>`;
    }

    /**
     * Footer for the expanded badge: layer thumbnail, atlas badge and layer name
     * (mirrors the inspector's expanded-layer-header, restyled for the yellow badge).
     */
    _buildBadgeLayerFooter(f) {
        const layerConfig = this._stateManager.getLayerConfig(f.layerId);
        if (!layerConfig) return '';

        const thumbnail = LayerThumbnail.generate(layerConfig, 18, { useHeaderImage: false, interactive: false });
        let thumbnailHTML = '';
        if (thumbnail) {
            thumbnail.style.borderRadius = '3px';
            thumbnail.style.margin = '0';
            thumbnailHTML = thumbnail.outerHTML;
        }

        let atlasBadge = '';
        const atlasName = layerConfig._sourceAtlas;
        const atlasMetadata = atlasName && window.layerRegistry?._atlasMetadata?.get(atlasName);
        if (atlasMetadata) {
            atlasBadge = `<span style="font-size:8px;padding:1px 5px;border-radius:3px;font-weight:600;color:white;background-color:${atlasMetadata.color || '#2563eb'};flex-shrink:0;">${this._escapeAttr(atlasMetadata.name)}</span>`;
        }

        const layerName = this._escapeAttr(layerConfig.title || f.layerId);

        return `<div class="feature-badge-footer" style="display:flex;align-items:center;gap:4px;margin-top:4px;padding-top:3px;border-top:1px solid rgba(0,0,0,0.2);">` +
            `${thumbnailHTML}${atlasBadge}` +
            `<span style="font-size:9px;color:#1a1a1a;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${layerName}</span>` +
            `</div>`;
    }

    _buildMarkerBadgesHTML(features, lngLat) {
        if (features && features.length > 0) {
            return features.map((f, i) => {
                const { fieldName, value } = this._getBadgeLabelInfo(f);
                return this._createFeatureBadgeHTML(fieldName, value, i, f);
            }).join('');
        }
        // No features (empty map click) — show a single coordinates badge
        const coords = `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`;
        return `
            <div class="feature-badge" data-badge-index="-1" style="
                display: flex;
                align-items: center;
                gap: 4px;
                background: rgba(255, 255, 0, 0.9);
                border: 1px solid rgba(255, 255, 0, 1);
                border-radius: 8px;
                padding: 3px 7px;
                cursor: pointer;
                box-shadow: 0 1px 4px rgba(0,0,0,0.35);
            ">
                <sl-icon name="geo-alt" style="font-size: 11px; color: #000;"></sl-icon>
                <span style="font-size: 11px; font-weight: 700; color: #000; white-space: nowrap;">${coords}</span>
            </div>
        `;
    }

    _openInspectorPanel() {
        if (window.featureControl) {
            const isVisible = window.featureControl._panel?.style.display !== 'none';
            if (!isVisible) {
                window.featureControl._showPanel();
            }
        }
    }

    _attachBadgeHandlers(el, features, lngLat, isHover) {
        el.querySelectorAll('.feature-badge').forEach(badge => {
            const idx = parseInt(badge.dataset.badgeIndex, 10);
            const f = (idx >= 0 && features) ? features[idx] : null;
            const valueSpan = badge.querySelector('.badge-value');
            const details = badge.querySelector('.feature-badge-details');

            // The badge lives inside a Mapbox marker element, so wheel events would
            // bubble to the map's scroll-zoom handler. Capture them on the scrollable
            // attribute table so it scrolls natively instead of zooming the map.
            if (details) {
                details.addEventListener('wheel', (e) => e.stopPropagation());
                // On touch, stop touchmove from reaching the map's drag-pan handler.
                details.addEventListener('touchmove', (e) => e.stopPropagation());
                details.addEventListener('touchstart', (e) => e.stopPropagation());
            }

            const layerIsBasemap = () => {
                const lc = f ? this._stateManager.getLayerConfig(f.layerId) : null;
                return Array.isArray(lc?.tags) && lc.tags.includes('basemap');
            };

            if (!this._isTouch) {
                badge.addEventListener('mouseenter', () => {
                    badge.style.borderColor = '#000';
                    badge.style.background = 'rgba(255, 255, 0, 1)';
                    this._expandBadgeValue(valueSpan);
                    // Dim the sibling badges to signal this layer is isolated.
                    this._setSiblingBadgesDimmed(badge, true);
                    if (f) {
                        this._stateManager.setFeatureHoverState(f.layerId, f.featureId, true);
                        // Mirror the inspector's hover isolation so hovering a badge dims sibling layers.
                        window.postMessage({ type: 'hover-isolate-layer', layerId: f.layerId, isBasemap: layerIsBasemap() }, '*');
                    }
                });
                badge.addEventListener('mouseleave', () => {
                    if (!badge.classList.contains('badge-selected')) {
                        badge.style.borderColor = 'rgba(255, 255, 0, 1)';
                        badge.style.background = 'rgba(255, 255, 0, 0.9)';
                        this._collapseBadgeValue(valueSpan);
                    }
                    // Restore sibling badges — isolation is cleared on mouseout.
                    this._setSiblingBadgesDimmed(badge, false);
                    if (f) {
                        this._stateManager.setFeatureHoverState(f.layerId, f.featureId, false);
                        window.postMessage({ type: 'clear-hover-layer-isolation' }, '*');
                    }
                });
            }

            const handler = (e) => {
                e.stopPropagation();
                if (e.type === 'touchend') e.preventDefault();
                // Hover markers aren't selected yet — clicking promotes them to a selection
                // marker (which rebuilds the badges), so just select and open the inspector.
                if (isHover && f) {
                    this._stateManager.handleFeatureClicks([{ ...f, lngLat }]);
                    this._openInspectorPanel();
                    return;
                }
                // Selection-marker badge: toggle the selected (expanded) state inline.
                this._toggleBadgeSelected(badge, f);
            };
            badge.addEventListener('click', handler);
            if (this._isTouch) badge.addEventListener('touchend', handler);
        });
    }

    _expandBadgeValue(valueSpan) {
        if (!valueSpan || !valueSpan.dataset.full) return;
        valueSpan.textContent = valueSpan.dataset.full;
        valueSpan.style.whiteSpace = 'normal';
        valueSpan.style.overflow = 'visible';
        valueSpan.style.textOverflow = 'clip';
    }

    _collapseBadgeValue(valueSpan) {
        if (!valueSpan || !valueSpan.dataset.short) return;
        valueSpan.textContent = valueSpan.dataset.short;
        valueSpan.style.whiteSpace = 'nowrap';
        valueSpan.style.overflow = 'hidden';
        valueSpan.style.textOverflow = 'ellipsis';
    }

    /**
     * Dim every badge in the marker except the hovered one, signalling that the
     * hovered feature's layer is isolated. Restored on mouseout.
     */
    _setSiblingBadgesDimmed(badge, dimmed) {
        const container = badge.parentElement;
        if (!container) return;
        container.querySelectorAll('.feature-badge').forEach(b => {
            // Active badge always full opacity; siblings dim to 0.5 while isolating.
            b.style.opacity = (b === badge || !dimmed) ? '1' : '0.5';
        });
    }

    _setBadgeCollapsed(badge) {
        badge.classList.remove('badge-selected');
        const eye = badge.querySelector('.badge-eye');
        const details = badge.querySelector('.feature-badge-details');
        if (details) details.style.display = 'none';
        if (eye) { eye.style.display = 'none'; eye.style.color = '#6b7280'; }
        badge.style.borderColor = 'rgba(255, 255, 0, 1)';
        badge.style.background = 'rgba(255, 255, 0, 0.9)';
        this._collapseBadgeValue(badge.querySelector('.badge-value'));
    }

    _setBadgeSelected(badge) {
        badge.classList.add('badge-selected');
        const eye = badge.querySelector('.badge-eye');
        const details = badge.querySelector('.feature-badge-details');
        if (details) details.style.display = 'block';
        if (eye) { eye.style.display = 'inline-flex'; eye.style.color = '#f97316'; }
        badge.style.borderColor = '#000';
        badge.style.background = 'rgba(255, 255, 0, 1)';
        this._expandBadgeValue(badge.querySelector('.badge-value'));
    }

    /**
     * Toggle a selection-marker badge between collapsed and selected (expanded) state.
     * Selecting expands the attribute table, turns the eye orange, isolates the layer
     * and zooms to fit the feature; deselecting collapses it, clears isolation and
     * restores the view once no badge remains selected.
     */
    _toggleBadgeSelected(badge, f) {
        const wasSelected = badge.classList.contains('badge-selected');

        // Only one badge per marker stays expanded at a time (matches the popup).
        // Collapse siblings without restoring the view — we're about to either
        // select this badge or toggle it off, which handles the view itself.
        const container = badge.parentElement;
        if (container) {
            container.querySelectorAll('.feature-badge.badge-selected').forEach(b => {
                if (b !== badge) {
                    this._setBadgeCollapsed(b);
                    this._selectedBadges.delete(b);
                }
            });
        }

        if (wasSelected) {
            this._deselectBadge(badge);
        } else {
            this._selectBadge(badge, f);
        }
    }

    _selectBadge(badge, f) {
        this._setBadgeSelected(badge);

        const firstSelection = this._selectedBadges.size === 0;
        this._selectedBadges.add(badge);

        if (!f) return;

        // On desktop, isolation is a hover-only effect (see the badge mouseenter/
        // mouseleave handlers). Touch devices have no hover, so apply isolation on
        // select instead; it persists until the badge is deselected / popup closed.
        if (this._isTouch) {
            const lc = this._stateManager.getLayerConfig(f.layerId);
            const isBasemap = Array.isArray(lc?.tags) && lc.tags.includes('basemap');
            window.postMessage({ type: 'clear-layer-isolation' }, '*');
            window.postMessage({ type: 'isolate-layer', layerId: f.layerId, isBasemap }, '*');
            this._setSiblingBadgesDimmed(badge, true);
        }

        // Save the current view the first time a badge is zoomed so we can restore
        // it later, then zoom to fit the feature (same as the inspector's zoom button).
        if (firstSelection) this._saveBadgeView();
        if (f.feature) {
            this._isProgrammaticZoom = true;
            this._zoomToFeature(f.feature);
            setTimeout(() => { this._isProgrammaticZoom = false; }, 1500);
        }
    }

    _deselectBadge(badge) {
        this._setBadgeCollapsed(badge);
        this._selectedBadges.delete(badge);

        // On touch, isolation/dimming were applied on select, so clear them here.
        if (this._isTouch) {
            window.postMessage({ type: 'clear-layer-isolation' }, '*');
            this._setSiblingBadgesDimmed(badge, false);
        }

        // Restore the saved view once nothing is selected anymore.
        if (this._selectedBadges.size === 0) this._restoreBadgeView();
    }

    _saveBadgeView() {
        if (this._badgeViewSaved) return;
        this._badgeViewSaved = {
            center: this._map.getCenter(),
            zoom: this._map.getZoom(),
            bearing: this._map.getBearing(),
            pitch: this._map.getPitch()
        };
    }

    _restoreBadgeView() {
        if (!this._badgeViewSaved) return;
        const camera = this._badgeViewSaved;
        this._badgeViewSaved = null;
        this._isProgrammaticZoom = true;
        this._map.flyTo({ ...camera, duration: 1000 });
        setTimeout(() => { this._isProgrammaticZoom = false; }, 1500);
    }

    _blockMapHoverEvents(el) {
        // Stop pointer-move events from bubbling to the map's canvas container, where
        // Mapbox's mousemove handler runs queryRenderedFeatures and sets hover state
        // on whatever feature sits beneath this marker. The marker (and its badges)
        // should fully capture the pointer instead. mouseenter/leave still fire, so the
        // marker's own intentional feature highlighting is unaffected.
        ['mousemove', 'mouseover'].forEach(type => {
            el.addEventListener(type, (e) => e.stopPropagation());
        });
    }

    _showHoverMarker(lngLat, labelText, features) {
        // Remove existing hover marker
        this._clearHoverMarker();

        const el = document.createElement('div');
        el.className = 'hover-marker';
        // Same layout as the selection marker: an action row on top and the feature
        // badges below. The action row is kept as empty reserved space so the badges
        // line up — the buttons only appear once the location is clicked (selected).
        el.style.cssText = 'display: flex; flex-direction: column; align-items: flex-start; gap: 4px; pointer-events: auto; cursor: pointer; transform: none !important; transition: none !important;';

        const infoSize = this._isTouch ? 24 : 20;
        el.innerHTML = `
            <div class="marker-action-row" style="display: flex; flex-direction: row; align-items: center; gap: 4px; height: ${infoSize}px; flex-shrink: 0;"></div>
            <div class="marker-content" style="display: flex; flex-direction: column; align-items: flex-start; gap: 3px; max-width: 240px;">
                ${this._buildMarkerBadgesHTML(features, lngLat)}
            </div>
        `;

        const marker = new mapboxgl.Marker({
            element: el,
            anchor: 'top-left',
            offset: [-(infoSize / 2), -(infoSize / 2)]
        })
            .setLngLat([lngLat.lng, lngLat.lat])
            .addTo(this._map);

        this._attachBadgeHandlers(el, features, lngLat, true);
        this._blockMapHoverEvents(el);

        this._hoverMarker = marker;
    }

    _clearHoverMarker() {
        if (this._hoverMarker) {
            this._hoverMarker.remove();
            this._hoverMarker = null;
        }
    }

    _findMarkerByFeatures(hoveredFeatures) {
        if (!hoveredFeatures || hoveredFeatures.length === 0) return null;

        // Create a set of hovered feature composite keys
        const hoveredKeys = new Set(
            hoveredFeatures.map(f => `${f.layerId}:${f.featureId}`)
        );

        // Find a marker that contains exactly the same features (or is a superset)
        for (const markerData of this._markers.values()) {
            const markerKeys = new Set(
                markerData.features.map(f => `${f.layerId}:${f.featureId}`)
            );

            // Check if all hovered features are in this marker
            let allHoveredFeaturesInMarker = true;
            for (const key of hoveredKeys) {
                if (!markerKeys.has(key)) {
                    allHoveredFeaturesInMarker = false;
                    break;
                }
            }

            // If all hovered features are in this marker, it's a match
            if (allHoveredFeaturesInMarker) {
                return markerData;
            }
        }

        return null;
    }

    _setMarkerHoverState(markerId, isHovered) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;

        const markerEl = markerData.marker.getElement();
        if (!markerEl) return;

        const contentEl = markerEl.querySelector('.marker-content');
        if (!contentEl) return;

        const badges = markerEl.querySelectorAll('.feature-badge');
        badges.forEach(b => {
            // Don't override the persistent styling of a selected (expanded) badge.
            if (b.classList.contains('badge-selected')) return;
            b.style.borderColor = isHovered ? '#000' : 'rgba(255, 255, 0, 1)';
            b.style.background = isHovered ? 'rgba(255, 255, 0, 1)' : 'rgba(255, 255, 0, 0.9)';
        });
    }

    _clearAllMarkerHoverStates() {
        this._markers.forEach((markerData, markerId) => {
            this._setMarkerHoverState(markerId, false);
        });
    }

    addMarker(lngLat, features, options = {}) {
        const { showPopup = true } = options;
        const markerId = `marker-${Date.now()}-${this._markers.size}`;
        const markerNumber = this._markers.size + 1;

        const el = document.createElement('div');
        el.className = 'selection-marker';
        // Action row (info + zoom buttons) sits on top at the click point; feature
        // badges stack below it, left-aligned to the buttons.
        el.style.cssText = 'display: flex; flex-direction: column; align-items: flex-start; gap: 4px;';

        el.innerHTML = `
            <div class="marker-action-row" style="display: flex; flex-direction: row; align-items: center; gap: 4px; flex-shrink: 0;"></div>
            <div class="marker-content" style="display: flex; flex-direction: column; align-items: flex-start; gap: 3px; max-width: 240px;">
                ${this._buildMarkerBadgesHTML(features, lngLat)}
            </div>
        `;

        // Anchor so the info button is centered on the clicked location — clicking the
        // same spot again hits the button and clears the marker (seamless toggle).
        const infoSize = this._isTouch ? 24 : 20;
        const marker = new mapboxgl.Marker({
            element: el,
            anchor: 'top-left',
            offset: [-(infoSize / 2), -(infoSize / 2)]
        })
            .setLngLat([lngLat.lng, lngLat.lat])
            .addTo(this._map);

        // Clicking a badge opens the inspector; selection markers are already selected.
        this._attachBadgeHandlers(el, features, lngLat, false);
        this._blockMapHoverEvents(el);

        const markerData = {
            id: markerId,
            marker,
            lngLat,
            features,
            popup: null
        };

        this._markers.set(markerId, markerData);
        this._currentMarkerIndex = this._markers.size - 1;

        // Click to toggle popup
        const handleMarkerToggle = (e) => {
            e.stopPropagation();
            // On touch, prevent the synthesized click that follows touchend so we
            // don't toggle twice (open then immediately close).
            if (e.type === 'touchend') e.preventDefault();
            this._toggleMarkerPopup(markerId);
        };
        el.addEventListener('click', handleMarkerToggle);
        // On touch, mapbox suppresses the native click within its container, so
        // bind touchend too — same pattern as the close button below.
        if (this._isTouch) {
            el.addEventListener('touchend', handleMarkerToggle);
        }

        // Info button at the click point — clicking it (i.e. clicking the same spot
        // again) clears this marker, toggling the selection off.
        const actionRow = el.querySelector('.marker-action-row');
        if (actionRow) {
            const closeBtn = document.createElement('span');
            closeBtn.className = 'marker-close-btn';
            closeBtn.innerHTML = `<sl-icon name="info-circle" style="font-size:${Math.round(infoSize * 0.7)}px;color:#fff;pointer-events:none;"></sl-icon>`;
            closeBtn.title = 'Clear this marker';
            closeBtn.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: center;
                width: ${infoSize}px;
                height: ${infoSize}px;
                border-radius: 50%;
                background: #f97316;
                box-shadow: 0 1px 4px rgba(0,0,0,0.35);
                cursor: pointer;
                flex-shrink: 0;
                transition: background 0.2s;
            `;
            if (!this._isTouch) {
                closeBtn.addEventListener('mouseenter', () => {
                    closeBtn.style.background = '#ea580c';
                });
                closeBtn.addEventListener('mouseleave', () => {
                    closeBtn.style.background = '#f97316';
                });
            }
            const handleCloseClick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                this._starredMarkers.delete(markerId);
                this.removeMarker(markerId);
            };
            closeBtn.addEventListener('click', handleCloseClick);
            // On touch, also bind touchend so the close fires on first tap rather
            // than waiting for the synthesized (and sometimes swallowed) click.
            if (this._isTouch) {
                closeBtn.addEventListener('touchend', handleCloseClick);
            }
            actionRow.appendChild(closeBtn);

            // Zoom button to the right of the info button — fits all selected features
            // in view (same action as the inspector's zoom button).
            const zoomBtn = document.createElement('span');
            zoomBtn.className = 'marker-zoom-btn';
            zoomBtn.innerHTML = `<sl-icon name="eye" style="font-size:${Math.round(infoSize * 0.7)}px;color:#fff;pointer-events:none;"></sl-icon>`;
            zoomBtn.title = 'Fit all features in view';
            zoomBtn.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: center;
                width: ${infoSize}px;
                height: ${infoSize}px;
                border-radius: 50%;
                background: #6b7280;
                box-shadow: 0 1px 4px rgba(0,0,0,0.35);
                cursor: pointer;
                flex-shrink: 0;
                transition: background 0.2s;
            `;
            if (!this._isTouch) {
                zoomBtn.addEventListener('mouseenter', () => {
                    zoomBtn.style.background = '#4b5563';
                });
                zoomBtn.addEventListener('mouseleave', () => {
                    zoomBtn.style.background = '#6b7280';
                });
            }
            const handleZoomClick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                window.postMessage({ type: 'zoom-to-selection' }, '*');
            };
            zoomBtn.addEventListener('click', handleZoomClick);
            if (this._isTouch) {
                zoomBtn.addEventListener('touchend', handleZoomClick);
            }
            actionRow.appendChild(zoomBtn);
        }

        // Hover to highlight features on map (desktop only — avoids synthetic
        // touch hover events flickering feature state on mobile).
        if (!this._isTouch) {
            el.addEventListener('mouseenter', () => {
                // The marker (buttons + badges) sits over its own features; suppress
                // the redundant hover popup while the pointer is anywhere over it,
                // even where rounded corners/gaps would leak through to the map.
                this._pointerOverMarker = true;
                this._clearHoverMarker();
                this._setMarkerFeaturesHoverState(markerId, true);
            });

            el.addEventListener('mouseleave', () => {
                this._pointerOverMarker = false;
                this._setMarkerFeaturesHoverState(markerId, false);
            });
        }

        if (showPopup) {
            this._showMarkerPopup(markerId);
        }

        // Update selection layer
        this._updateSelectionLayer();

        return markerId;
    }

    _setMarkerFeaturesHoverState(markerId, hoverState) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;

        // Set hover state for all features in this marker
        markerData.features.forEach(({ feature, layerId, featureId }) => {
            this._stateManager.setFeatureHoverState(layerId, featureId, hoverState);
        });
    }

    _toggleMarkerPopup(markerId) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;

        // If popup exists and is visible, close it
        if (markerData.popup) {
            this._closePopup(markerId);
        } else {
            // Otherwise, show it
            this._showMarkerPopup(markerId);
        }
    }

    _showMarkerPopup(markerId) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;

        const markerArray = Array.from(this._markers.values());
        const currentIndex = markerArray.findIndex(m => m.id === markerId);
        const markerNumber = currentIndex + 1;
        const totalMarkers = this._markers.size;

        const popupContent = this._createPopupContent(markerData, markerNumber, totalMarkers);

        if (markerData.popup) {
            markerData.popup.remove();
        }

        const popup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            maxWidth: '400px',
            className: 'selection-popup',
            anchor: 'bottom'
        })
            .setLngLat([markerData.lngLat.lng, markerData.lngLat.lat])
            .setHTML(popupContent)
            .addTo(this._map);

        markerData.popup = popup;

        // Add hover listeners to popup (desktop only — touch devices synthesize
        // mouseenter/mouseleave on tap, which would close the popup unexpectedly).
        const popupElement = popup.getElement();
        if (popupElement && !this._isTouch) {
            popupElement.addEventListener('mouseenter', () => {
                this._setMarkerFeaturesHoverState(markerId, true);
            });

            popupElement.addEventListener('mouseleave', () => {
                this._setMarkerFeaturesHoverState(markerId, false);
                // Keep the popup open while the note form is in use so typed text isn't lost.
                const noteForm = popupElement.querySelector('.add-note-form');
                if (noteForm && noteForm.style.display !== 'none') return;
                this._closePopup(markerId);
            });
        }

        setTimeout(() => this._attachPopupEventListeners(markerId), 0);
    }

    _createPopupContent(markerData, markerNumber, totalMarkers) {
        const { lngLat, features } = markerData;

        const groupedFeatures = new Map();
        features.forEach(f => {
            const layerId = f.layerId;
            if (!groupedFeatures.has(layerId)) {
                groupedFeatures.set(layerId, []);
            }
            groupedFeatures.get(layerId).push(f);
        });

        // Get all active layers in inspector display order
        const allActiveLayers = this._getAllActiveLayersInInspectorOrder();

        // If no features, show active layers at this location instead
        const hasFeatures = features.length > 0;

        // Get atlas metadata for badges
        const getAtlasBadge = (layerConfig) => {
            const atlasName = layerConfig?._sourceAtlas;
            if (!atlasName) return '';

            // Try to get atlas metadata from layer registry
            const layerRegistry = window.layerRegistry;
            if (!layerRegistry) return '';

            const atlasMetadata = layerRegistry._atlasMetadata?.get(atlasName);
            if (!atlasMetadata) return '';

            return `<span style="font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600;color:white;background-color:${atlasMetadata.color || '#2563eb'};flex-shrink:0;">${atlasMetadata.name}</span>`;
        };

        let featuresList = '';

        if (hasFeatures) {
            // Show features grouped by layer
            featuresList = Array.from(groupedFeatures.entries()).map(([layerId, layerFeatures]) => {
                const layerConfig = this._stateManager.getLayerConfig(layerId);
                const atlasMetadata = window.layerRegistry?._atlasMetadata?.get(layerConfig?._sourceAtlas);
                const headerImage = layerConfig?.headerImage || atlasMetadata?.headerImage || null;
                // headerImage is shown as the faint card backdrop below, so the thumbnail
                // stays symbology-only (consistent with the inspector cards).
                const thumbnail = LayerThumbnail.generate(layerConfig, 32, { useHeaderImage: false });
                if (thumbnail) {
                    thumbnail.style.borderRadius = '3px';
                    thumbnail.style.margin = '0';
                }
                const thumbnailHTML = thumbnail ? thumbnail.outerHTML : '';
                const atlasBadge = getAtlasBadge(layerConfig);

                const inspectConfig = layerConfig?.inspect || {};
                const labelField = inspectConfig.label || inspectConfig.id || 'id';

                return layerFeatures.map(f => {
                const featureId = f.featureId;
                const featureLabel = f.feature.properties?.[labelField] || featureId;

                // Build properties table
                const properties = f.feature.properties || {};
                const fields = inspectConfig.fields || [];
                const fieldTitles = inspectConfig.fieldTitles || [];

                const buildRow = (label, value) =>
                    `<div style="display:flex;font-size:10px;padding:3px 6px;border-bottom:1px solid #1a1a1a;">` +
                    `<div style="color:#6b7280;min-width:90px;font-weight:500;flex-shrink:0;">${label}</div>` +
                    `<div style="color:#e5e7eb;flex:1;word-break:break-word;white-space:pre-line;">${value}</div>` +
                    `</div>`;

                let propertiesHTML = '';
                let allPropertiesHTML = '';
                let showMoreButton = '';

                const validEntries = Object.entries(properties).filter(([, v]) => v !== null && v !== undefined && v !== '');

                const btnStyle = `padding:4px 6px;background:#0a0a0a;color:#6b7280;border:none;border-top:1px solid #1a1a1a;font-size:10px;font-weight:500;cursor:pointer;width:100%;text-align:left;`;

                if (fields.length > 0) {
                    const shownRows = fields.map((fieldName, index) => {
                        const value = properties[fieldName];
                        if (value !== null && value !== undefined && value !== '') {
                            return buildRow(fieldTitles[index] || fieldName, value);
                        }
                        return '';
                    }).filter(Boolean);

                    if (shownRows.length > 0) {
                        propertiesHTML = `<div class="properties-table">${shownRows.join('')}</div>`;
                    }

                    // Show button only if there are valid properties beyond what's already shown
                    if (validEntries.length > shownRows.length) {
                        const allRows = validEntries.map(([key, value]) => buildRow(key, value));
                        allPropertiesHTML = `<div class="all-properties-container" style="display:none;">${allRows.join('')}</div>`;
                        showMoreButton = `<button class="show-all-props-btn" data-total="${validEntries.length}" style="${btnStyle}">Show all ${validEntries.length} properties</button>`;
                    }
                } else {
                    // No configured fields — show first 4, rest behind Show all
                    const shownEntries = validEntries.slice(0, 4);
                    const hiddenEntries = validEntries.slice(4);

                    if (shownEntries.length > 0) {
                        propertiesHTML = `<div class="properties-table">${shownEntries.map(([k, v]) => buildRow(k, v)).join('')}</div>`;
                    }
                    if (hiddenEntries.length > 0) {
                        const allRows = validEntries.map(([k, v]) => buildRow(k, v));
                        allPropertiesHTML = `<div class="all-properties-container" style="display:none;">${allRows.join('')}</div>`;
                        showMoreButton = `<button class="show-all-props-btn" data-total="${validEntries.length}" style="${btnStyle}">Show all ${validEntries.length} properties</button>`;
                    }
                }

                return `
                    <div class="feature-item-container" data-layer-id="${layerId}" data-feature-id="${featureId}" style="
                        background: #000;
                        border-radius: 3px;
                        margin-bottom: 2px;
                        overflow: hidden;
                        position: relative;
                        transition: opacity 0.2s, border-color 0.15s;
                        border: 1px solid #000;
                    ">
                        ${headerImage ? `<div style="position:absolute;top:0;left:0;right:0;bottom:0;opacity:0.15;background-image:url('${headerImage}');background-size:cover;background-position:center;pointer-events:none;"></div>` : ''}
                        <div class="feature-item-header" style="
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            padding: 4px;
                            min-height: 36px;
                            position: relative;
                            z-index: 1;
                            background: #000;
                            transition: background 0.2s;
                            cursor: pointer;
                        ">
                            <div class="feature-header-thumbnail" data-layer-id="${layerId}" style="
                                flex-shrink: 0;
                                cursor: pointer;
                                border-radius: 3px;
                                overflow: hidden;
                            ">
                                ${thumbnailHTML}
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                ${inspectConfig.title ? `<span style="font-size: 9px; color: #6b7280; display: block; line-height: 1.2;">${inspectConfig.title}</span>` : ''}
                                <span style="font-size: 11px; font-weight: 500; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;" title="${featureLabel}">${featureLabel}</span>
                            </div>
                            <button class="expand-icon" style="background:#111;border:1px solid #333;color:#94a3b8;font-size:10px;flex-shrink:0;cursor:pointer;padding:1px 5px;border-radius:3px;line-height:1;">...</button>
                        </div>
                        <div class="feature-item-details" style="
                            display: none;
                            background: #111;
                            border-top: 1px solid #000;
                            position: relative;
                            z-index: 1;
                        " data-needs-handler="${layerConfig?._sourceAtlas && inspectConfig.onClick ? 'true' : 'false'}" data-atlas="${layerConfig?._sourceAtlas || ''}" data-handler="${inspectConfig.onClick || ''}" data-feature-data="${encodeURIComponent(JSON.stringify(f.feature))}">
                            <div class="expanded-layer-header" style="display:flex;align-items:center;gap:4px;padding:4px 6px;border-bottom:1px solid #1a1a1a;">
                                ${atlasBadge}
                                <span style="font-size:10px;color:#94a3b8;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${layerConfig?.title || layerId}</span>
                                <button class="layer-info-toggle" data-layer-id="${layerId}" style="background:#1a1a1a;border:1px solid #222;color:#6b7280;font-size:10px;padding:1px 5px;border-radius:3px;cursor:pointer;line-height:1;flex-shrink:0;">...</button>
                            </div>
                            <div class="layer-info-panel" style="display:none;padding:6px;background:#0a0a0a;border-bottom:1px solid #1a1a1a;">
                                ${layerConfig?.description ? `<div style="font-size:10px;color:#6b7280;padding-bottom:6px;line-height:1.4;">${layerConfig.description}</div>` : ''}
                                <div style="display:flex;align-items:center;gap:6px;">
                                    <input type="range" class="layer-opacity-slider" data-layer-id="${layerId}" min="0" max="100" value="100" style="flex:1;height:3px;accent-color:#3b82f6;cursor:pointer;">
                                    <span class="layer-opacity-value" style="font-size:10px;color:#6b7280;min-width:28px;text-align:right;">100%</span>
                                    <button class="zoom-feature-btn" style="background:#1e3a5f;border:none;color:#93c5fd;padding:2px 6px;border-radius:3px;font-size:10px;cursor:pointer;flex-shrink:0;">Zoom</button>
                                    <button class="remove-layer-btn" data-layer-id="${layerId}" style="background:#7f1d1d;border:none;color:#fca5a5;padding:2px 6px;border-radius:3px;font-size:10px;cursor:pointer;flex-shrink:0;">Remove</button>
                                </div>
                            </div>
                            <div class="custom-html-container"></div>
                            ${propertiesHTML}
                            ${allPropertiesHTML}
                            ${showMoreButton}
                        </div>
                    </div>
                `;
            }).join('');
        }).join('');
        } else {
            // Show active layers at this location (no features found)
            featuresList = allActiveLayers.map(layer => {
                const thumbnail = LayerThumbnail.generate(layer, 24);
                const thumbnailHTML = thumbnail ? thumbnail.outerHTML : '';
                const atlasBadge = getAtlasBadge(layer);

                return `
                    <div class="feature-item-container" data-layer-id="${layer.id}" style="
                        background: #334155;
                        border-radius: 3px;
                        margin-bottom: 2px;
                        overflow: hidden;
                    ">
                        <div class="feature-item-header" style="
                            display: flex;
                            align-items: center;
                            gap: 5px;
                            padding: 3px 5px;
                            cursor: pointer;
                            transition: background 0.2s;
                        " onmouseenter="this.style.background='#475569'" onmouseleave="this.style.background='#334155'">
                            ${thumbnailHTML}
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 9px; color: #94a3b8; font-weight: 500; display: flex; align-items: center; gap: 3px;">
                                    ${atlasBadge}
                                    <span>${layer.title || layer.id}</span>
                                </div>
                                <div style="font-size: 11px; color: #9ca3af; font-style: italic;">No features at this location</div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            if (featuresList === '') {
                featuresList = `
                    <div style="padding: 8px; text-align: center; color: #9ca3af;">
                        <div style="font-size: 12px; margin-bottom: 3px;">No active layers</div>
                        <div style="font-size: 10px;">Enable layers to see information here</div>
                    </div>
                `;
            }
        }

        // Count extra layers not shown in features list
        const extraLayers = allActiveLayers.filter(layer => !(hasFeatures && groupedFeatures.has(layer.id)));
        const extraLayerCount = extraLayers.length;

        const isStarred = this._starredMarkers.has(markerData.id);
        const featureCount = hasFeatures ? features.length : allActiveLayers.length;

        return `
            <div style="
                background: #1e293b;
                color: #e2e8f0;
                border-radius: 6px;
                min-width: 280px;
                max-width: 90vw;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">
                <div style="
                    padding: 5px 6px;
                    border-bottom: 1px solid #334155;
                    background: #111827;
                ">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <button class="star-toggle" title="${isStarred ? 'Unstar' : 'Star'} this point" style="
                            background: transparent;
                            border: none;
                            color: ${isStarred ? '#fbbf24' : '#94a3b8'};
                            cursor: pointer;
                            padding: 0;
                            display: flex;
                            align-items: center;
                            flex-shrink: 0;
                        "><sl-icon name="${isStarred ? 'star-fill' : 'star'}" style="font-size: 14px;"></sl-icon></button>
                        <span style="font-size: 11px; color: #e2e8f0; font-weight: 600; flex: 1;">
                            ${totalMarkers > 1 ? `Selected Point ${markerNumber} of ${totalMarkers}` : 'Selected Point'}
                        </span>
                        ${totalMarkers > 1 ? `
                        <button class="nav-prev" style="
                            background: #334155;
                            border: none;
                            color: #e2e8f0;
                            padding: 1px 6px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 12px;
                            flex-shrink: 0;
                            ${markerNumber <= 1 ? 'opacity: 0.4; pointer-events: none;' : ''}
                        ">&lt;</button>
                        <button class="nav-next" style="
                            background: #334155;
                            border: none;
                            color: #e2e8f0;
                            padding: 1px 6px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 12px;
                            flex-shrink: 0;
                            ${markerNumber >= totalMarkers ? 'opacity: 0.4; pointer-events: none;' : ''}
                        ">&gt;</button>
                        ` : ''}
                        <button class="close-popup" style="
                            background: transparent;
                            border: none;
                            color: #94a3b8;
                            cursor: pointer;
                            font-size: 20px;
                            line-height: 1;
                            padding: 0;
                            width: 24px;
                            height: 24px;
                            flex-shrink: 0;
                        ">&times;</button>
                    </div>
                    <div style="display: flex; align-items: center; gap: 5px; margin-top: 3px;">
                        <span style="font-size: 10px; color: #94a3b8;">
                            ${featureCount} feature${featureCount !== 1 ? 's' : ''} at
                        </span>
                        <button class="coords-btn" style="
                            background: transparent;
                            border: none;
                            color: #60a5fa;
                            cursor: pointer;
                            padding: 0;
                            font-size: 10px;
                            display: flex;
                            align-items: center;
                            gap: 3px;
                        "><sl-icon name="joystick" style="font-size: 12px;"></sl-icon>${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}</button>
                    </div>
                </div>

                <div style="padding: 5px;">
                    <div class="features-list-container" style="max-height: 240px; overflow-y: auto;">
                        ${featuresList}
                    </div>
                </div>

                <div style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 4px 5px;
                    border-top: 1px solid #334155;
                ">
                    <div style="display: flex; align-items: center; gap: 6px; flex: 1; overflow-x: auto;">
                        <button class="open-browser" style="
                            background: #ffbf00;
                            border: none;
                            color: #000;
                            padding: 4px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 14px;
                            width: 24px;
                            height: 24px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-shrink: 0;
                            transition: all 0.2s;
                        " title="Browse Map Collections"><sl-icon name="map" style="font-size: 12px;"></sl-icon></button>
                        ${extraLayerCount > 0 ? `
                        <button class="show-more-layers" style="
                            background: #1e293b;
                            border: 1px solid #334155;
                            color: #94a3b8;
                            padding: 2px 6px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 10px;
                            flex-shrink: 0;
                        ">Show ${extraLayerCount} more layer${extraLayerCount !== 1 ? 's' : ''}</button>
                        ` : ''}
                        <div class="extra-layers-container" style="display:none;flex-wrap:wrap;gap:4px;"></div>
                        <button class="open-inspector" style="
                            background: #000;
                            border: none;
                            color: #ffbf00;
                            padding: 4px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 14px;
                            width: 24px;
                            height: 24px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-shrink: 0;
                            transition: all 0.2s;
                        " title="Open Layer Inspector"><sl-icon name="layers" style="font-size: 12px;"></sl-icon></button>
                    </div>
                    <button class="add-note-btn" style="
                        background: #16a34a;
                        border: none;
                        color: #fff;
                        padding: 4px 8px;
                        border-radius: 3px;
                        cursor: pointer;
                        font-size: 10px;
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        flex-shrink: 0;
                        transition: all 0.2s;
                    " title="Add a note at this location"><sl-icon name="plus-lg" style="font-size: 12px;"></sl-icon>Add Note</button>
                </div>

                <div class="add-note-form" style="display:none;padding:6px;border-top:1px solid #334155;background:#111827;">
                    <textarea class="note-text" placeholder="Write a note for this location..." rows="2" style="
                        width:100%;
                        box-sizing:border-box;
                        background:#0a0a0a;
                        color:#e2e8f0;
                        border:1px solid #334155;
                        border-radius:3px;
                        padding:5px 6px;
                        font-size:11px;
                        font-family:inherit;
                        resize:vertical;
                    "></textarea>
                    <select class="note-layer-select" style="
                        width:100%;
                        margin-top:5px;
                        background:#0a0a0a;
                        color:#e2e8f0;
                        border:1px solid #334155;
                        border-radius:3px;
                        padding:4px 6px;
                        font-size:11px;
                    "></select>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
                        <button class="note-save-btn" style="
                            background:#16a34a;
                            border:none;
                            color:#fff;
                            padding:4px 12px;
                            border-radius:3px;
                            cursor:pointer;
                            font-size:11px;
                            font-weight:600;
                        ">Save</button>
                        <button class="note-cancel-btn" style="
                            background:#334155;
                            border:none;
                            color:#cbd5e1;
                            padding:4px 10px;
                            border-radius:3px;
                            cursor:pointer;
                            font-size:11px;
                        ">Cancel</button>
                        <span class="note-status" style="font-size:10px;color:#94a3b8;flex:1;"></span>
                    </div>
                </div>
            </div>
        `;
    }

    _attachPopupEventListeners(markerId) {
        const markerData = this._markers.get(markerId);
        if (!markerData?.popup) return;

        const popup = markerData.popup.getElement();
        if (!popup) return;

        popup.querySelector('.close-popup')?.addEventListener('click', () => {
            this._closePopup(markerId);
        });

        popup.querySelector('.star-toggle')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const isStarred = this._starredMarkers.has(markerId);
            if (isStarred) {
                this._starredMarkers.delete(markerId);
                btn.style.color = '#94a3b8';
                btn.querySelector('sl-icon').setAttribute('name', 'star');
                btn.title = 'Star this point';
            } else {
                this._starredMarkers.add(markerId);
                btn.style.color = '#fbbf24';
                btn.querySelector('sl-icon').setAttribute('name', 'star-fill');
                btn.title = 'Unstar this point';
            }
        });

        popup.querySelector('.coords-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openExternalMapLinks(markerData.lngLat);
        });

        popup.querySelector('.nav-prev')?.addEventListener('click', () => {
            this._navigateMarker(-1);
        });

        popup.querySelector('.nav-next')?.addEventListener('click', () => {
            this._navigateMarker(1);
        });

        popup.querySelector('.open-browser')?.addEventListener('click', (e) => {
            e.stopPropagation();

            if (window.browserControl) {
                const isOpen = window.browserControl._isOpen;
                if (!isOpen) {
                    window.browserControl.openBrowser();
                }
            }

            setTimeout(() => {
                this._closePopup(markerId);
            }, 100);
        });

        popup.querySelector('.open-inspector')?.addEventListener('click', (e) => {
            e.stopPropagation();

            if (window.featureControl) {
                const isVisible = window.featureControl._panel?.style.display !== 'none';
                if (!isVisible) {
                    window.featureControl._showPanel();
                }
            }

            setTimeout(() => {
                this._closePopup(markerId);
            }, 100);
        });

        popup.querySelector('.show-more-layers')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            const container = popup.querySelector('.extra-layers-container');
            if (!container) return;

            if (container.style.display === 'none') {
                container.style.display = 'flex';
                btn.style.display = 'none';

                const currentBounds = this._map.getBounds();
                const bounds = [
                    currentBounds.getWest(), currentBounds.getSouth(),
                    currentBounds.getEast(), currentBounds.getNorth()
                ];

                const allActiveLayers = this._getAllActiveLayersInInspectorOrder();
                const markerFeatureLayerIds = new Set(markerData.features.map(f => f.layerId));
                const extraLayers = allActiveLayers.filter(layer => !markerFeatureLayerIds.has(layer.id));

                extraLayers.forEach(layer => {
                    let isInView = true;
                    if (window.MapUtils && layer.bbox) {
                        isInView = window.MapUtils.isLayerInView(layer, bounds);
                    }
                    const thumbnail = LayerThumbnail.generate(layer, 24, { isInView });
                    if (thumbnail) {
                        thumbnail.style.borderRadius = '3px';
                        thumbnail.style.cursor = 'pointer';
                        thumbnail.style.margin = '0';
                        thumbnail.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            if (!isInView && window.layerControl) {
                                window.layerControl._zoomToLayer(layer.id);
                            } else {
                                window.postMessage({ type: 'open-layer-info', layer }, '*');
                            }
                        });
                        container.appendChild(thumbnail);
                    }
                });
            }
        });

        // Layer info toggle [...] in expanded header
        popup.querySelectorAll('.layer-info-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const panel = btn.closest('.feature-item-details').querySelector('.layer-info-panel');
                if (!panel) return;
                const isOpen = panel.style.display !== 'none';
                panel.style.display = isOpen ? 'none' : 'block';
                btn.style.background = isOpen ? '#1a1a1a' : '#334155';
                btn.style.color = isOpen ? '#94a3b8' : '#e2e8f0';
            });
        });

        // Opacity slider
        popup.querySelectorAll('.layer-opacity-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                e.stopPropagation();
                const layerId = slider.dataset.layerId;
                const value = parseInt(slider.value);
                const valueDisplay = slider.parentElement.querySelector('.layer-opacity-value');
                if (valueDisplay) valueDisplay.textContent = `${value}%`;
                window.postMessage({ type: 'update-layer-opacity', layerId, opacity: value / 100 }, '*');
            });
        });

        // Zoom to feature button
        popup.querySelectorAll('.zoom-feature-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const details = btn.closest('.feature-item-details');
                if (!details) return;
                try {
                    const feature = JSON.parse(decodeURIComponent(details.dataset.featureData));
                    this._isProgrammaticZoom = true;
                    this._zoomToFeature(feature);
                    setTimeout(() => { this._isProgrammaticZoom = false; }, 1500);
                } catch (err) {
                    console.error('[MapMarkerManager] Error parsing feature data for zoom:', err);
                }
            });
        });

        // Remove layer button
        popup.querySelectorAll('.remove-layer-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = btn.dataset.layerId;
                if (confirm(`Remove layer "${layerId}"?`)) {
                    window.postMessage({ type: 'remove-layer', layerId }, '*');
                    const container = btn.closest('.feature-item-container');
                    if (container) container.remove();
                }
            });
        });

        // Thumbnail click in feature header - open layer info, don't expand
        popup.querySelectorAll('.feature-header-thumbnail').forEach(thumbnailEl => {
            thumbnailEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = thumbnailEl.dataset.layerId;
                const layerConfig = this._stateManager.getLayerConfig(layerId);
                if (layerConfig) {
                    window.postMessage({ type: 'open-layer-info', layer: layerConfig }, '*');
                }
            });
        });

        // Feature header hover — respects expanded state
        popup.querySelectorAll('.feature-item-header').forEach(header => {
            header.addEventListener('mouseenter', () => {
                const container = header.closest('.feature-item-container');
                const details = container.querySelector('.feature-item-details');
                const isExpanded = details && details.style.display !== 'none';
                if (!isExpanded) header.style.background = '#111';
                container.style.borderColor = '#fff';
            });
            header.addEventListener('mouseleave', () => {
                const container = header.closest('.feature-item-container');
                const details = container.querySelector('.feature-item-details');
                const isExpanded = details && details.style.display !== 'none';
                if (!isExpanded) {
                    header.style.background = '#000';
                    container.style.borderColor = '#000';
                }
            });
        });

        // Feature header click to expand/collapse
        popup.querySelectorAll('.feature-item-header').forEach(header => {
            header.addEventListener('click', async (e) => {
                const container = header.closest('.feature-item-container');
                const details = container.querySelector('.feature-item-details');
                const icon = header.querySelector('.expand-icon');
                const layerId = container.dataset.layerId;
                const featureId = container.dataset.featureId;
                const cameraKey = `${markerId}-${featureId}`;

                const isExpanding = details.style.display === 'none';

                if (isExpanding) {
                    // Reset all containers first so the clicked one is fully visible
                    popup.querySelectorAll('.feature-item-container').forEach(c => {
                        c.style.opacity = '1';
                        c.style.borderColor = '#000';
                    });

                    // Collapse any open features and dim non-target containers
                    popup.querySelectorAll('.feature-item-container').forEach(otherContainer => {
                        if (otherContainer !== container) {
                            const otherDetails = otherContainer.querySelector('.feature-item-details');
                            const otherIcon = otherContainer.querySelector('.expand-icon');
                            if (otherDetails && otherDetails.style.display !== 'none') {
                                otherDetails.style.display = 'none';
                                otherIcon.style.background = '#111';
                                otherIcon.style.color = '#94a3b8';
                                const otherHeader = otherContainer.querySelector('.feature-item-header');
                                if (otherHeader) otherHeader.style.background = '#000';
                            }
                            otherContainer.style.opacity = '0.4';
                        }
                    });

                    // Store current camera position
                    this._cameraPositions.set(cameraKey, {
                        center: this._map.getCenter(),
                        zoom: this._map.getZoom(),
                        bearing: this._map.getBearing(),
                        pitch: this._map.getPitch()
                    });

                    // Track expanded feature
                    this._expandedFeatures.set(markerId, featureId);

                    details.style.display = 'block';
                    icon.style.background = '#222';
                    icon.style.color = '#cbd5e1';
                    header.style.background = '#111';
                    container.style.borderColor = '#fff';

                    // Reset any prior isolation, then isolate this layer
                    window.postMessage({ type: 'clear-layer-isolation' }, '*');
                    const layerConfig = this._stateManager.getLayerConfig(layerId);
                    const isBasemap = Array.isArray(layerConfig?.tags) && layerConfig.tags.includes('basemap');
                    window.postMessage({ type: 'isolate-layer', layerId, isBasemap }, '*');

                    // Load inspection handler if needed
                    const needsHandler = details.dataset.needsHandler === 'true';
                    const customContainer = details.querySelector('.custom-html-container');

                    if (needsHandler && customContainer && !customContainer.dataset.loaded) {
                        const atlasName = details.dataset.atlas;
                        const handlerName = details.dataset.handler;
                        const layerConfig = this._stateManager.getLayerConfig(layerId);
                        let feature;
                        try {
                            const parsedFeature = JSON.parse(decodeURIComponent(details.dataset.featureData));
                            feature = { feature: parsedFeature };
                        } catch (e) {}

                        if (feature && atlasName && handlerName) {
                            customContainer.innerHTML = '<div style="color: #94a3b8; font-size: 10px; padding: 4px;">Loading...</div>';

                            try {
                                const { handlerLoader } = await import('./inspection-handler-loader.js');

                                // Execute handler - the HTML contains inline scripts that will run
                                const customHTML = await handlerLoader.executeHandler(atlasName, handlerName, {
                                    feature: feature.feature,
                                    featureId: featureId,
                                    layerConfig: layerConfig,
                                    properties: feature.feature.properties
                                });

                                if (customHTML) {
                                    // Insert HTML and manually execute scripts
                                    customContainer.innerHTML = customHTML;

                                    // Extract and execute script tags
                                    const scripts = customContainer.querySelectorAll('script');
                                    scripts.forEach(oldScript => {
                                        const newScript = document.createElement('script');
                                        Array.from(oldScript.attributes).forEach(attr => {
                                            newScript.setAttribute(attr.name, attr.value);
                                        });
                                        newScript.textContent = oldScript.textContent;
                                        oldScript.parentNode.replaceChild(newScript, oldScript);
                                    });
                                } else {
                                    customContainer.innerHTML = '';
                                }
                                customContainer.dataset.loaded = 'true';
                            } catch (error) {
                                console.error('[MapMarkerManager] Error loading handler:', error);
                                customContainer.innerHTML = `<div style="color: #f87171; font-size: 10px; padding: 4px;">Error loading details</div>`;
                            }
                        }
                    }
                } else {
                    // Collapsing - restore camera position
                    const savedCamera = this._cameraPositions.get(cameraKey);
                    if (savedCamera) {
                        this._isProgrammaticZoom = true;
                        this._map.flyTo({
                            center: savedCamera.center,
                            zoom: savedCamera.zoom,
                            bearing: savedCamera.bearing,
                            pitch: savedCamera.pitch,
                            duration: 1000
                        });
                        this._cameraPositions.delete(cameraKey);
                        // Reset flag after zoom completes
                        setTimeout(() => {
                            this._isProgrammaticZoom = false;
                        }, 1500);
                    }

                    this._expandedFeatures.delete(markerId);
                    details.style.display = 'none';
                    icon.style.background = '#111';
                    icon.style.color = '#94a3b8';
                    header.style.background = '#000';
                    container.style.borderColor = '#000';

                    // Clear layer isolation
                    window.postMessage({ type: 'clear-layer-isolation' }, '*');

                    // Restore all containers
                    popup.querySelectorAll('.feature-item-container').forEach(c => {
                        c.style.opacity = '1';
                        c.style.borderColor = '#000';
                    });
                }
            });
        });

        // Show more properties toggle
        popup.querySelectorAll('.show-all-props-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const details = button.closest('.feature-item-details');
                const regularProps = details.querySelector('.properties-table');
                const allProps = details.querySelector('.all-properties-container');
                const total = button.dataset.total;

                if (allProps.style.display === 'none') {
                    allProps.style.display = 'block';
                    if (regularProps) regularProps.style.display = 'none';
                    button.textContent = 'Show less';
                } else {
                    allProps.style.display = 'none';
                    if (regularProps) regularProps.style.display = 'block';
                    button.textContent = `Show all ${total} properties`;
                }
            });
        });

        this._attachAddNoteListeners(popup, markerData);
    }

    _attachAddNoteListeners(popup, markerData) {
        const addBtn = popup.querySelector('.add-note-btn');
        const form = popup.querySelector('.add-note-form');
        if (!addBtn || !form) return;

        const select = form.querySelector('.note-layer-select');
        const textarea = form.querySelector('.note-text');
        const saveBtn = form.querySelector('.note-save-btn');
        const cancelBtn = form.querySelector('.note-cancel-btn');
        const status = form.querySelector('.note-status');

        // Only layers configured for write-back (a saveUrl, or a global default) can receive notes.
        const csvLayers = (window.layerControl?._state?.groups || [])
            .filter(g => g.type === 'csv' && (g.saveUrl || window.GOOGLE_SHEETS_SAVE_URL));

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = form.style.display === 'none';
            if (isHidden && csvLayers.length === 0) {
                status.textContent = 'No sheets are set up to save notes.';
                form.style.display = 'block';
                select.innerHTML = '<option disabled selected>No writable layers available</option>';
                saveBtn.disabled = true;
                return;
            }
            if (isHidden && select.options.length === 0) {
                csvLayers.forEach(layer => {
                    const option = document.createElement('option');
                    option.value = layer.id;
                    option.textContent = layer.title || layer.id;
                    select.appendChild(option);
                });
            }
            form.style.display = isHidden ? 'block' : 'none';
            if (isHidden) textarea.focus();
        });

        cancelBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            form.style.display = 'none';
            status.textContent = '';
        });

        // Keep clicks inside the form from bubbling to feature/marker handlers
        form.addEventListener('click', (e) => e.stopPropagation());

        saveBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const notes = (textarea.value || '').trim();
            const layerId = select.value;
            const layerConfig = csvLayers.find(l => l.id === layerId);

            if (!notes) {
                status.textContent = 'Enter a note first.';
                return;
            }
            if (!layerConfig) {
                status.textContent = 'Select a layer to save to.';
                return;
            }

            const saveUrl = layerConfig.saveUrl || window.GOOGLE_SHEETS_SAVE_URL;
            if (!saveUrl) {
                status.textContent = 'This layer is read-only (no saveUrl configured).';
                return;
            }

            saveBtn.disabled = true;
            status.textContent = 'Saving…';

            try {
                const { appendRow, captureMapContext } = await import('./google-sheets-writer.js');
                await appendRow({
                    saveUrl,
                    url: layerConfig.url,
                    values: {
                        latitude: markerData.lngLat.lat,
                        longitude: markerData.lngLat.lng,
                        notes,
                        timestamp: new Date().toISOString(),
                        ...captureMapContext()
                    }
                });

                status.textContent = 'Saved ✓';
                textarea.value = '';
                setTimeout(() => { form.style.display = 'none'; status.textContent = ''; }, 1500);

                // Reflect the new row on the map once Sheets propagates the edit.
                const api = this._mapboxAPI || window.layerControl?._mapboxAPI;
                if (api?.refreshLayerNow) {
                    setTimeout(() => api.refreshLayerNow(layerId, layerConfig), 2000);
                }
            } catch (error) {
                console.error('[MapMarkerManager] Failed to save note:', error);
                status.textContent = error.message || 'Save failed.';
            } finally {
                saveBtn.disabled = false;
            }
        });
    }

    _closePopup(markerId) {
        const markerData = this._markers.get(markerId);
        if (markerData?.popup) {
            if (this._expandedFeatures.has(markerId)) {
                window.postMessage({ type: 'clear-layer-isolation' }, '*');
                this._expandedFeatures.delete(markerId);
            }
            markerData.popup.remove();
            markerData.popup = null;
        }
    }

    _fadePopup(markerId, fade) {
        const markerData = this._markers.get(markerId);
        if (!markerData?.popup) return;

        const popupElement = markerData.popup.getElement();
        if (!popupElement) return;

        if (fade) {
            popupElement.style.opacity = '0.2';
            popupElement.style.pointerEvents = 'none';
        } else {
            popupElement.style.opacity = '1';
            popupElement.style.pointerEvents = 'auto';
        }
    }

    _navigateMarker(direction) {
        const markerArray = Array.from(this._markers.values());
        if (markerArray.length <= 1) return;

        this._currentMarkerIndex = (this._currentMarkerIndex + direction + markerArray.length) % markerArray.length;
        const targetMarker = markerArray[this._currentMarkerIndex];

        markerArray.forEach(m => this._closePopup(m.id));

        this._showMarkerPopup(targetMarker.id);
        this._isProgrammaticZoom = true;
        this._map.flyTo({
            center: [targetMarker.lngLat.lng, targetMarker.lngLat.lat],
            duration: 500
        });
        // Reset flag after zoom completes
        setTimeout(() => {
            this._isProgrammaticZoom = false;
        }, 700);
    }

    _openExternalMapLinks(lngLat) {
        if (window.externalMapLinksControl) {
            if (lngLat && window.externalMapLinksControl.showAtCoordinates) {
                window.externalMapLinksControl.showAtCoordinates(lngLat.lat, lngLat.lng);
            } else {
                window.externalMapLinksControl._showModal();
            }
        }
    }

    _zoomToFeature(feature) {
        if (!this._map || !feature) return;

        try {
            if (typeof turf === 'undefined') {
                console.error('[MapMarkerManager] Turf.js not loaded');
                return;
            }

            if (!feature.geometry || !feature.geometry.coordinates) {
                console.warn('[MapMarkerManager] Feature has no valid geometry');
                return;
            }

            const bbox = turf.bbox(feature);

            this._map.fitBounds([
                [bbox[0], bbox[1]],
                [bbox[2], bbox[3]]
            ], {
                padding: 50,
                duration: 1000
            });
        } catch (error) {
            console.error('[MapMarkerManager] Error zooming to feature:', error);
        }
    }

    _openInspector(layerId, featureId) {
        window.postMessage({
            type: 'open-inspector-feature',
            layerId,
            featureId
        }, '*');
    }

    removeMarker(markerId) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;

        // Deselect any expanded badges in this marker so the saved view is restored.
        this._deselectMarkerBadges(markerData);

        // Drop the feature selections anchored at this marker so closing it also
        // clears the highlight and the inspector entry (not just the marker dot).
        // Other markers keep their own selections.
        markerData.features.forEach(({ featureId, layerId }) => {
            if (featureId && layerId) {
                this._stateManager._deselectFeature(featureId, layerId);
            }
        });

        if (markerData.popup) {
            markerData.popup.remove();
        }
        markerData.marker.remove();
        this._markers.delete(markerId);

        if (this._markers.size > 0) {
            this._currentMarkerIndex = Math.min(this._currentMarkerIndex, this._markers.size - 1);
        }

        // Update selection layer
        this._updateSelectionLayer();
    }

    clearAllMarkers() {
        this._markers.forEach((markerData, id) => {
            if (this._starredMarkers.has(id)) return;
            this._deselectMarkerBadges(markerData);
            if (markerData.popup) {
                markerData.popup.remove();
            }
            markerData.marker.remove();
            this._markers.delete(id);
        });
        this._currentMarkerIndex = 0;

        // Update selection layer
        this._updateSelectionLayer();
    }

    /**
     * Deselect any expanded badges belonging to a marker (used on teardown) so
     * isolation is cleared and the pre-zoom view is restored once nothing remains.
     */
    _deselectMarkerBadges(markerData) {
        const markerEl = markerData.marker?.getElement?.();
        if (!markerEl) return;
        markerEl.querySelectorAll('.feature-badge.badge-selected').forEach(b => this._deselectBadge(b));
    }

    /**
     * Update the selection GeoJSON layer with current marker positions
     */
    _updateSelectionLayer() {
        // Get mapboxAPI from global layerControl if not set
        if (!this._mapboxAPI && window.layerControl?._mapboxAPI) {
            this._mapboxAPI = window.layerControl._mapboxAPI;
        }

        if (!this._mapboxAPI) {
            console.warn('[MarkerManager] MapboxAPI not available, cannot update selection layer');
            return;
        }

        // Create GeoJSON from current markers
        const features = [];
        this._markers.forEach((markerData, markerId) => {
            // Extract feature labels for the name property (or use location if no features)
            const labels = markerData.features.length > 0 ? markerData.features.map(f => {
                const layerConfig = this._stateManager.getLayerConfig(f.layerId);
                const inspectConfig = layerConfig?.inspect || {};
                const labelField = inspectConfig.label || inspectConfig.id || 'id';
                return f.feature.properties?.[labelField] || f.featureId;
            }) : [`${markerData.lngLat.lat.toFixed(4)}, ${markerData.lngLat.lng.toFixed(4)}`];
            const name = labels.join(', ');

            // Store feature references for restoration (use raw feature IDs)
            const featureRefs = markerData.features.map(f => {
                const rawFeatureId = this._stateManager._extractRawFeatureId(f.featureId);
                return {
                    layerId: f.layerId,
                    featureId: rawFeatureId
                };
            });

            // Create a point feature at the marker location
            const feature = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [markerData.lngLat.lng, markerData.lngLat.lat]
                },
                properties: {
                    id: markerId,
                    name: name,
                    featureCount: markerData.features.length,
                    features: featureRefs
                }
            };

            features.push(feature);
        });

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        // Update the selection layer
        this._mapboxAPI.updateGeoJSONLayerData(this._selectionLayerId, geojson);

        // Also update the layer control's state if available
        if (window.layerControl) {
            const layerGroup = window.layerControl._state.groups.find(g => g.id === this._selectionLayerId);
            if (layerGroup) {
                layerGroup.geojson = geojson;

                // Trigger URL update
                if (window.urlManager) {
                    window.urlManager.updateURL({ updateLayers: true });
                }
            }
        }
    }

    async restoreMarkersFromSelectionLayer() {
        if (!window.layerControl) {
            console.warn('[MarkerManager] Layer control not available');
            return false;
        }

        const selectionLayer = window.layerControl._state.groups.find(g => g.id === this._selectionLayerId);
        if (!selectionLayer?.geojson?.features || selectionLayer.geojson.features.length === 0) {
            return false;
        }

        const features = selectionLayer.geojson.features.filter(f =>
            f.properties?.features && Array.isArray(f.properties.features) && f.properties.features.length > 0
        );

        if (features.length === 0) {
            return false;
        }

        const layerIds = new Set();
        features.forEach(feature => {
            feature.properties.features.forEach(ref => layerIds.add(ref.layerId));
        });

        await this._waitForLayersReady(Array.from(layerIds));
        await this._waitForMapIdle();

        const allRestoredFeatures = [];
        for (const feature of features) {
            if (feature.geometry.type !== 'Point') continue;

            const [lng, lat] = feature.geometry.coordinates;
            const lngLat = { lng, lat };
            const featureRefs = feature.properties.features || [];

            const restoredFeatures = [];
            for (const ref of featureRefs) {
                const selectedFeature = await this._restoreFeatureFromRef(ref);
                if (selectedFeature) {
                    restoredFeatures.push({
                        ...selectedFeature,
                        lngLat
                    });
                }
            }

            if (restoredFeatures.length > 0) {
                this.addMarker(lngLat, restoredFeatures, { showPopup: false });
                allRestoredFeatures.push(...restoredFeatures);
            }
        }

        if (this._markers.size > 0) {
            this._stateManager._updateLineSortKeys();
        }

        // Notify the inspector iframe (and other listeners) of the restored selections so
        // the status bar with the Clear / Add / Zoom buttons shows. The markers are already
        // created above, so the fromMarkerRestore flag tells _handleSelection not to re-add
        // them — mirrors the event sequence in UrlManager.applySelectionsFromURL.
        if (allRestoredFeatures.length > 0) {
            for (const { feature, featureId, layerId, lngLat } of allRestoredFeatures) {
                await this._stateManager._executeInspectionHandler(feature, layerId, lngLat);
                this._stateManager._emitStateChange('feature-click', {
                    feature,
                    featureId,
                    layerId,
                    lngLat,
                    fromURL: true,
                    fromMarkerRestore: true
                });
            }

            this._stateManager._emitStateChange('feature-click-multiple', {
                selectedFeatures: allRestoredFeatures,
                clearedFeatures: [],
                fromURL: true,
                fromMarkerRestore: true
            });
        }

        return true;
    }

    async _waitForLayersReady(layerIds, timeout = 10000) {
        const startTime = Date.now();
        const checkInterval = 200;

        return new Promise((resolve) => {
            const checkLayers = () => {
                if (!this._stateManager) {
                    console.warn('[MarkerManager] State manager not available');
                    resolve(false);
                    return;
                }

                const readyLayers = layerIds.filter(layerId =>
                    this._stateManager.isLayerRegistered(layerId)
                );

                const allReady = readyLayers.length === layerIds.length;

                if (allReady) {
                    resolve(true);
                } else if (Date.now() - startTime > timeout) {
                    const notReady = layerIds.filter(id => !readyLayers.includes(id));
                    console.warn(`[MarkerManager] Timeout waiting for layers: ${notReady.join(', ')}`);
                    resolve(false);
                } else {
                    setTimeout(checkLayers, checkInterval);
                }
            };

            checkLayers();
        });
    }

    async _waitForMapIdle(timeout = 3000) {
        return new Promise((resolve) => {
            if (this._map.loaded() && this._map.areTilesLoaded()) {
                resolve();
                return;
            }

            const timeoutId = setTimeout(() => {
                resolve();
            }, timeout);

            const onIdle = () => {
                clearTimeout(timeoutId);
                this._map.off('idle', onIdle);
                resolve();
            };

            this._map.once('idle', onIdle);
        });
    }

    async _restoreFeatureFromRef(ref, retries = 3) {
        const { layerId, featureId } = ref;

        if (!this._stateManager.isLayerRegistered(layerId)) {
            console.warn(`[MarkerManager] Layer ${layerId} not registered`);
            return null;
        }

        const layerConfig = this._stateManager.getLayerConfig(layerId);
        if (!layerConfig) {
            console.warn(`[MarkerManager] Layer config not found for ${layerId}`);
            return null;
        }

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const features = this._map.querySourceFeatures(
                    layerConfig.source || `${layerConfig.type}-${layerId}`,
                    {
                        sourceLayer: layerConfig.sourceLayer
                    }
                );

                const matchingFeature = features.find(f => {
                    const fid = this._stateManager._getFeatureId(f);
                    const rawFid = this._stateManager._extractRawFeatureId(fid);
                    return rawFid === featureId || fid === featureId;
                });

                if (matchingFeature) {
                    const fullFeatureId = this._stateManager._getFeatureId(matchingFeature);
                    const compositeKey = this._stateManager._getCompositeKey(layerId, fullFeatureId);

                    this._stateManager._updateFeatureState(compositeKey, {
                        feature: matchingFeature,
                        layerId,
                        isSelected: true,
                        timestamp: Date.now()
                    });

                    this._stateManager._selectedFeatures.add(compositeKey);
                    this._stateManager._setMapboxFeatureState(fullFeatureId, layerId, { selected: true });

                    return {
                        feature: matchingFeature,
                        featureId: fullFeatureId,
                        layerId
                    };
                }

                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.warn(`[MarkerManager] Error restoring feature ${featureId} from layer ${layerId} (attempt ${attempt + 1}):`, error);
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }

        console.warn(`[MarkerManager] Feature ${featureId} not found in layer ${layerId}`);
        return null;
    }

    getSelectionMode() {
        return this._selectionMode;
    }

    setSelectionMode(mode) {
        this._selectionMode = mode;

        // Sync with state manager's Cmd/Ctrl flag
        if (mode === 'add') {
            this._stateManager._isCmdCtrlPressed = true;
        } else {
            this._stateManager._isCmdCtrlPressed = false;
        }
    }
}

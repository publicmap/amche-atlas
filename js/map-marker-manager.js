/**
 * MapMarkerManager - Manages selection markers on the map
 * Creates markers at selection locations with badges showing selected features
 */
import { LayerThumbnail } from './layer-thumbnail.js';
import { FeatureDisplayRenderer } from './feature-display-renderer.js';
import { LayerOrderManager } from './layer-order-manager.js';
import { CameraUtils } from './map-camera-utils.js';
import { GeoLibreAPI } from './geolibre-api.js';
import { MapContextMessagesControl } from './map-context-messages-control.js';

export class MapMarkerManager {
    constructor(map, stateManager, mapboxAPI = null) {
        this._map = map;
        this._stateManager = stateManager;
        this._mapboxAPI = mapboxAPI;
        this._markers = new Map();
        this._hoverMarker = null;
        this._currentMarkerIndex = 0;
        this._selectionMode = 'replace';
        this._isMapMoving = false;
        this._isProgrammaticZoom = false; // Track programmatic zooms
        this._selectionLayerId = 'selection'; // Layer ID for selection markers
        this._selectedBadges = new Set(); // Expanded (selected) feature badges
        this._isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        this._loadingPlaceholders = new Map(); // placeholderId -> mapboxgl.Marker, shown while a URL-restored marker's query is pending

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
                this._markers.forEach((markerData) => {
                    markerData.features = markerData.features.filter(f => f.layerId !== clearedLayerId);
                });
                this._updateSelectionLayer();
            }
        });

    }

    _setupMapMovementTracking() {
        this._map.on('movestart', () => {
            this._isMapMoving = true;
        });

        this._map.on('moveend', () => {
            this._isMapMoving = false;
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
        const activeLayers = this._getActiveLayerConfigs();
        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(activeLayers);
        return [...overlays, ...basemaps];
    }

    /**
     * Active layer configs, preferring MapFeatureControl's visibility check —
     * the same one map-inspector.html's layer list is built from — over the
     * plain checkbox check below. That check falls back to reading actual map
     * layer visibility for `style`/`raster-style-layer` layers (e.g. basemap
     * imagery), which don't necessarily expose a checkbox at a stable index in
     * `_sourceControls`, so relying on the checkbox alone under-counts active
     * layers here versus what the inspector shows.
     */
    _getActiveLayerConfigs() {
        if (window.featureControl?._getActiveLayersFromConfig) {
            return Array.from(window.featureControl._getActiveLayersFromConfig().values()).map(d => d.config);
        }

        if (!window.layerControl?._state?.groups) return [];
        const activeLayers = [];
        window.layerControl._state.groups.forEach((group, index) => {
            if (this._isLayerActive(index) && group.id) {
                activeLayers.push(group);
            }
        });
        return activeLayers;
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

        this.addMarker(lngLat, features);
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
        this.addMarker(lngLat, []);
    }

    _handleBatchHover(data) {
        // Touch devices have no cursor, so this used to be driven by a center-of-screen
        // query that showed an inspect popup there. The draggable inspect marker now
        // covers that use case directly, so hover popups are desktop-only.
        if (this._isTouch) {
            return;
        }

        // Don't update hover markers during map movement (pan/zoom).
        if (this._isMapMoving) {
            return;
        }

        // Pointer is over an existing inspect marker (buttons or badges) — those
        // capture the interaction, so don't show a redundant hover popup. Skip this
        // suppression while a marker is being dragged: the pointer is pinned to the
        // dragged marker's own element, but the hover preview needs to reflect
        // whatever is newly beneath it, not be blocked by that.
        if (this._pointerOverMarker && !this._draggingMarkerId) {
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

    _truncateName(value, max = 50) {
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
        const display = this._truncateName(value, 50);
        const detailsHTML = f ? this._buildBadgeAttributeTable(f) : '';
        return `
            <div class="feature-badge" data-badge-index="${index}" title="${this._escapeAttr(value)}" style="
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                width: 100%;
                box-sizing: border-box;
                background: transparent;
                border-radius: 5px;
                padding: 4px 8px;
                cursor: pointer;
                transition: background 0.15s, opacity 0.15s;
            ">
                <div class="feature-badge-header" style="display: flex; flex-direction: row; align-items: center; gap: 4px; width: 100%;">
                    <div style="display: flex; flex-direction: column; align-items: flex-start; min-width: 0;">
                        <span style="font-size: 8px; line-height: 1.1; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap;">${this._escapeAttr(fieldName)}</span>
                        <span class="badge-value" data-full="${this._escapeAttr(value)}" data-short="${this._escapeAttr(display)}" style="font-size: 11px; line-height: 1.2; font-weight: 700; color: #f3f4f6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this._escapeAttr(display)}</span>
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
            `<div style="display:flex;gap:6px;font-size:9px;line-height:1.25;padding:1px 0;border-bottom:1px solid #374151;">` +
            `<div style="color:#9ca3af;min-width:54px;max-width:88px;font-weight:600;flex-shrink:0;word-break:break-word;">${this._escapeAttr(label)}</div>` +
            `<div style="color:#f3f4f6;flex:1;word-break:break-word;white-space:pre-line;">${this._escapeAttr(value)}</div>` +
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
            rows = [`<div style="font-size:9px;color:#9ca3af;padding:2px 0;">No attributes</div>`];
        }

        // Configured `fields` only shows a curated subset — offer a toggle to reveal
        // every non-empty property.
        let allPropertiesHTML = '';
        let showAllButton = '';
        if (fields.length > 0 && validEntries.length > rows.length) {
            const allRows = validEntries.map(([k, v]) => buildRow(k, v));
            allPropertiesHTML = `<div class="badge-all-properties" style="display:none;">${allRows.join('')}</div>`;
            const btnStyle = `margin-top:2px;padding:2px 0;background:transparent;color:#9ca3af;border:none;border-top:1px dashed #374151;font-size:9px;font-weight:600;cursor:pointer;width:100%;text-align:left;`;
            showAllButton = `<button class="badge-show-all-props-btn" data-total="${validEntries.length}" style="${btnStyle}">Show all ${validEntries.length} properties</button>`;
        }

        const footer = this._buildBadgeLayerFooter(f);

        // Data attributes _loadInspectionHandlerHTML reads to load a layer's
        // inspect.onClick handler (config/{atlas}.js) here.
        const needsHandler = layerConfig?._sourceAtlas && inspectConfig.onClick;
        const handlerAttrs = `data-needs-handler="${needsHandler ? 'true' : 'false'}" data-atlas="${layerConfig?._sourceAtlas || ''}" data-handler="${inspectConfig.onClick || ''}" data-feature-data="${encodeURIComponent(JSON.stringify(f.feature))}"`;

        return `<div class="feature-badge-details" ${handlerAttrs} style="display:none;width:100%;margin-top:3px;border-top:1px solid #374151;padding-top:3px;max-height:180px;overflow-y:auto;">` +
            `<div class="custom-html-container"></div>` +
            `<div class="badge-shown-properties">${rows.join('')}</div>${allPropertiesHTML}${showAllButton}${footer}</div>`;
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

        return `<div class="feature-badge-footer" style="display:flex;align-items:center;gap:4px;margin-top:4px;padding-top:3px;border-top:1px solid #374151;">` +
            `${thumbnailHTML}${atlasBadge}` +
            `<span style="font-size:9px;color:#9ca3af;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${layerName}</span>` +
            this._buildLayerActionsMenuHTML(f.layerId, f.feature) +
            `</div>`;
    }

    /**
     * Actions menu (three-dot trigger) shown in the badge footer.
     * See _handleZoomToFeatureAction and _handleLayerExportAction.
     */
    _buildLayerActionsMenuHTML(layerId, feature) {
        const featureData = feature ? encodeURIComponent(JSON.stringify(feature)) : '';
        const layerConfig = this._stateManager.getLayerConfig(layerId);
        const geoLibreUrl = GeoLibreAPI.buildViewerUrl(layerConfig);
        return `
            <sl-dropdown class="layer-actions-dropdown" data-layer-id="${layerId}" data-feature-data="${featureData}" hoist style="flex-shrink:0;">
                <sl-icon-button slot="trigger" name="three-dots-vertical" label="Layer actions" style="font-size:12px;color:#6b7280;"></sl-icon-button>
                <sl-menu style="font-size:11px;">
                    ${feature ? `
                    <sl-menu-item value="zoom-to-feature">
                        <sl-icon slot="prefix" name="zoom-in"></sl-icon>
                        Zoom to Feature
                    </sl-menu-item>
                    <sl-divider></sl-divider>
                    ` : ''}
                    <sl-menu-item value="export-selected">
                        <sl-icon slot="prefix" name="download"></sl-icon>
                        Export Selected
                        <sl-menu slot="submenu">
                            <sl-menu-item value="export-selected:geojson">GeoJSON</sl-menu-item>
                            <sl-menu-item value="export-selected:kml">KML</sl-menu-item>
                            <sl-menu-item value="export-selected:csv">GeoCSV</sl-menu-item>
                        </sl-menu>
                    </sl-menu-item>
                    <sl-menu-item value="export-layer">
                        <sl-icon slot="prefix" name="download"></sl-icon>
                        Export Layer
                        <sl-menu slot="submenu">
                            <sl-menu-item value="export-layer:geojson">GeoJSON</sl-menu-item>
                            <sl-menu-item value="export-layer:kml">KML</sl-menu-item>
                            <sl-menu-item value="export-layer:csv">GeoCSV</sl-menu-item>
                        </sl-menu>
                    </sl-menu-item>
                    ${geoLibreUrl ? `
                    <sl-menu-item value="open-geolibre" data-geolibre-url="${this._escapeAttr(geoLibreUrl)}">
                        <sl-icon slot="prefix" name="box-arrow-up-right"></sl-icon>
                        Open Layer in GeoLibre
                    </sl-menu-item>
                    ` : ''}
                    <sl-divider></sl-divider>
                    <sl-menu-item value="remove-layer" style="color:#ef4444;">
                        <sl-icon slot="prefix" name="trash" style="color:#ef4444;"></sl-icon>
                        Remove Layer
                    </sl-menu-item>
                </sl-menu>
            </sl-dropdown>
        `;
    }

    /**
     * Wires up sl-select on a layer actions dropdown (badge footer)
     * to trigger _handleZoomToFeatureAction / _handleLayerExportAction.
     */
    _attachLayerActionsMenuHandlers(root) {
        root.querySelectorAll('.layer-actions-dropdown').forEach(dropdown => {
            if (dropdown._exportMenuWired) return;
            dropdown._exportMenuWired = true;
            dropdown.addEventListener('click', (e) => e.stopPropagation());
            const menu = dropdown.querySelector('sl-menu');
            menu?.addEventListener('sl-select', (e) => {
                e.stopPropagation();
                const value = e.detail.item?.value || '';
                if (value === 'zoom-to-feature') {
                    this._handleZoomToFeatureAction(dropdown);
                    return;
                }
                if (value === 'remove-layer') {
                    this._handleRemoveLayerAction(dropdown.dataset.layerId);
                    return;
                }
                if (value === 'open-geolibre') {
                    const geoLibreUrl = e.detail.item?.dataset.geolibreUrl;
                    if (geoLibreUrl) window.open(geoLibreUrl, '_blank', 'noopener');
                    return;
                }
                const [action, format] = value.split(':');
                if (!format) return;
                this._handleLayerExportAction(action, format, dropdown.dataset.layerId);
            });
        });
    }

    /**
     * User-triggered zoom from the layer actions menu — the app no longer zooms
     * automatically when a badge/feature card is selected.
     */
    _handleZoomToFeatureAction(dropdown) {
        const featureData = dropdown.dataset.featureData;
        if (!featureData) return;
        try {
            const feature = JSON.parse(decodeURIComponent(featureData));
            this._isProgrammaticZoom = true;
            this._zoomToFeature(feature);
            setTimeout(() => { this._isProgrammaticZoom = false; }, 1500);
        } catch (err) {
            console.warn('[MapMarkerManager] Could not zoom to feature:', err);
        }
    }

    _handleRemoveLayerAction(layerId) {
        if (!layerId) return;
        if (!confirm(`Remove layer "${layerId}"?`)) return;
        window.postMessage({ type: 'remove-layer', layerId }, '*');
    }

    /**
     * Every marker balloon leads with an inline comment box, prefilled from a
     * notes-layer feature already selected at this point (if any) so an
     * existing note is editable in place instead of behind a separate form.
     */
    _buildCommentSectionHTML(features) {
        const noteEntry = (features || []).find(f => {
            const layerConfig = this._stateManager.getLayerConfig(f.layerId);
            return layerConfig?.type === 'csv' && (layerConfig.saveUrl || window.GOOGLE_SHEETS_SAVE_URL);
        });
        const existingValue = String(noteEntry?.feature?.properties?.notes || '');

        return `
            <div class="marker-comment-section" style="
                width: 100%;
                box-sizing: border-box;
                padding-bottom: 4px;
                margin-bottom: 4px;
                border-bottom: 1px solid #334155;
            ">
                <textarea class="marker-comment-input" rows="1" placeholder="Add a comment..." style="
                    display: block;
                    width: 100%;
                    max-width: 100%;
                    box-sizing: border-box;
                    background: #0a0a0a;
                    color: #e2e8f0;
                    border: 1px solid #334155;
                    border-radius: 4px;
                    padding: 4px 6px;
                    font-size: 11px;
                    font-family: inherit;
                    resize: none;
                    overflow: hidden;
                    line-height: 1.3;
                    cursor: text;
                ">${this._escapeHtml(existingValue)}</textarea>
                <button type="button" class="marker-comment-save-btn" style="
                    display: none;
                    width: 100%;
                    margin-top: 4px;
                    background: #16a34a;
                    border: none;
                    color: #fff;
                    padding: 4px 0;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                ">Save</button>
            </div>
        `;
    }

    _buildMarkerBadgesHTML(features, lngLat, options = {}) {
        const { includeMoreLayers = false } = options;

        let html;
        if (features && features.length > 0) {
            html = features.map((f, i) => {
                const { fieldName, value } = this._getBadgeLabelInfo(f);
                return this._createFeatureBadgeHTML(fieldName, value, i, f);
            }).join('');
        } else {
            // No features (empty map click) — show a single coordinates badge
            const coords = `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`;
            html = `
                <div class="feature-badge" data-badge-index="-1" style="
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    width: 100%;
                    box-sizing: border-box;
                    background: transparent;
                    border-radius: 5px;
                    padding: 4px 8px;
                    cursor: pointer;
                    transition: background 0.15s;
                ">
                    <sl-icon name="geo-alt" style="font-size: 11px; color: #9ca3af;"></sl-icon>
                    <span style="font-size: 11px; font-weight: 700; color: #f3f4f6; white-space: nowrap;">${coords}</span>
                </div>
            `;
        }

        if (includeMoreLayers) {
            const clickedLayerIds = new Set((features || []).map(f => f.layerId));
            const extraLayers = this._getAllActiveLayersInInspectorOrder().filter(layer => !clickedLayerIds.has(layer.id));
            html += this._createMoreLayersBadgeHTML(extraLayers);
        }

        return html;
    }

    /**
     * Trailing badge summarizing any other active layer at this location that
     * isn't among the clicked features (e.g. a raster basemap). Collapsed like
     * the feature badges above it; expanding lazily lists each layer with its
     * LayerThumbnail, same as the inspector's layer cards.
     *
     * Hidden by default — it's meta/decluttering info, not a selected feature,
     * so it should only reveal while this specific marker is the one being
     * hovered/explored (see the marker's mouseenter/mouseleave in addMarker),
     * not sit permanently visible on every marker on the map.
     */
    _createMoreLayersBadgeHTML(extraLayers) {
        if (!extraLayers || extraLayers.length === 0) return '';
        const count = extraLayers.length;
        return `
            <div class="feature-badge more-layers-badge" style="
                display: none;
                flex-direction: column;
                align-items: flex-start;
                width: 100%;
                box-sizing: border-box;
                background: transparent;
                border-radius: 5px;
                padding: 4px 8px;
                cursor: pointer;
                transition: background 0.15s, opacity 0.15s;
            ">
                <div class="feature-badge-header" style="display: flex; flex-direction: row; align-items: center; gap: 4px; width: 100%;">
                    <sl-icon name="layers" style="font-size: 11px; color: #9ca3af;"></sl-icon>
                    <span style="font-size: 11px; font-weight: 700; color: #f3f4f6; white-space: nowrap; flex: 1;">${count} more layer${count !== 1 ? 's' : ''}</span>
                    <sl-icon-button class="more-layers-shortcut-btn" name="three-dots-vertical" label="Shortcuts" style="font-size:12px;color:#6b7280;flex-shrink:0;"></sl-icon-button>
                </div>
                <div class="more-layers-badge-details" style="display:none;width:100%;margin-top:3px;border-top:1px solid #374151;padding-top:3px;max-height:180px;overflow-y:auto;"></div>
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
            // The "N more layers" summary badge has no backing feature and its own
            // expand/collapse behavior — wired separately in _attachMoreLayersBadgeHandler.
            if (badge.classList.contains('more-layers-badge')) return;

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
                // Without this, any click bubbling up from the table (including the
                // click that ends a text selection drag) hits the badge's own click
                // handler below and toggles the table closed, making selecting or
                // copying text inside it impossible.
                details.addEventListener('mousedown', (e) => e.stopPropagation());
                details.addEventListener('click', (e) => e.stopPropagation());

                const showAllBtn = details.querySelector('.badge-show-all-props-btn');
                if (showAllBtn) {
                    showAllBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const shown = details.querySelector('.badge-shown-properties');
                        const all = details.querySelector('.badge-all-properties');
                        const total = showAllBtn.dataset.total;
                        const isShowingAll = all.style.display !== 'none';
                        all.style.display = isShowingAll ? 'none' : 'block';
                        if (shown) shown.style.display = isShowingAll ? 'block' : 'none';
                        showAllBtn.textContent = isShowingAll ? `Show all ${total} properties` : 'Show less';
                    });
                }
            }

            const layerIsBasemap = () => {
                const lc = f ? this._stateManager.getLayerConfig(f.layerId) : null;
                return Array.isArray(lc?.tags) && lc.tags.includes('basemap');
            };

            if (!this._isTouch) {
                badge.addEventListener('mouseenter', () => {
                    if (!badge.classList.contains('badge-selected')) {
                        badge.style.background = '#374151';
                    }
                    this._expandBadgeValue(valueSpan);
                    // Isolation (sibling dimming + layer isolation) is reserved for
                    // clicked selection markers; hover popups only highlight the badge.
                    if (!isHover) {
                        // Dim the sibling badges to signal this layer is isolated.
                        this._setSiblingBadgesDimmed(badge, true);
                    }
                    if (f) {
                        this._stateManager.setFeatureHoverState(f.layerId, f.featureId, true);
                        if (!isHover) {
                            // Mirror the inspector's hover isolation so hovering a badge dims sibling layers.
                            window.postMessage({ type: 'hover-isolate-layer', layerId: f.layerId, isBasemap: layerIsBasemap() }, '*');
                        }
                    }
                });
                badge.addEventListener('mouseleave', () => {
                    if (!badge.classList.contains('badge-selected')) {
                        badge.style.background = 'transparent';
                        this._collapseBadgeValue(valueSpan);
                    }
                    if (!isHover) {
                        // Restore sibling badges — isolation is cleared on mouseout.
                        this._setSiblingBadgesDimmed(badge, false);
                    }
                    if (f) {
                        this._stateManager.setFeatureHoverState(f.layerId, f.featureId, false);
                        if (!isHover) {
                            window.postMessage({ type: 'clear-hover-layer-isolation' }, '*');
                        }
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

        // Layer actions menu (export shortcuts) in each badge's footer
        this._attachLayerActionsMenuHandlers(el);

        this._attachMoreLayersBadgeHandler(el, features, lngLat);
    }

    /**
     * Wires the comment box that leads every marker balloon: auto-grows with
     * its content, reveals a Save button only once the text actually changes
     * from what was prefilled, and writes through to the notes sheet exactly
     * like the old "Add Note" popup form did.
     */
    _attachCommentSectionHandlers(el, lngLat) {
        const section = el.querySelector('.marker-comment-section');
        const textarea = section?.querySelector('.marker-comment-input');
        const saveBtn = section?.querySelector('.marker-comment-save-btn');
        if (!section || !textarea || !saveBtn) return;

        let originalValue = textarea.value;

        const resize = () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        };
        resize();

        // The marker balloon itself is draggable; typing/clicking in the comment
        // box must not trigger that drag.
        ['mousedown', 'click'].forEach(type => {
            textarea.addEventListener(type, (e) => e.stopPropagation());
            saveBtn.addEventListener(type, (e) => e.stopPropagation());
        });

        textarea.addEventListener('input', () => {
            resize();
            const changed = textarea.value.trim() !== originalValue.trim();
            saveBtn.style.display = changed ? 'block' : 'none';
            if (changed) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save';
            }
        });

        saveBtn.addEventListener('click', async () => {
            const notes = textarea.value.trim();
            if (!notes) return;

            const layerConfig = this._getWritableNotesLayer();
            const saveUrl = layerConfig?.saveUrl || window.GOOGLE_SHEETS_SAVE_URL;
            if (!saveUrl) {
                saveBtn.textContent = 'Click to Retry';
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';

            try {
                const { appendRow, captureMapContext } = await import('./google-sheets-writer.js');
                await appendRow({
                    saveUrl,
                    url: layerConfig.url,
                    values: {
                        latitude: lngLat.lat,
                        longitude: lngLat.lng,
                        notes,
                        timestamp: new Date().toISOString(),
                        ...captureMapContext()
                    }
                });

                originalValue = notes;
                saveBtn.style.display = 'none';
                MapContextMessagesControl.show('Comment saved', { duration: 3000 });

                const api = this._mapboxAPI || window.layerControl?._mapboxAPI;
                if (api?.refreshLayerNow) {
                    setTimeout(() => api.refreshLayerNow(layerConfig.id, layerConfig), 2000);
                }
            } catch (error) {
                console.error('[MapMarkerManager] Failed to save comment:', error);
                saveBtn.disabled = false;
                saveBtn.textContent = 'Click to Retry';
            }
        });
    }

    // Only layers configured for write-back (a saveUrl, or a global default) can receive notes.
    _getWritableNotesLayer() {
        const groups = window.layerControl?._state?.groups || [];
        const csvLayers = groups.filter(g => g.type === 'csv' && (g.saveUrl || window.GOOGLE_SHEETS_SAVE_URL));
        return csvLayers.find(g => g.id === 'notes') || csvLayers[0] || null;
    }

    _escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Finds a marker within pixel tolerance of a lngLat, so callers like the
     * right-click shortcut menu can reuse a marker right-clicked directly on
     * it instead of creating a duplicate at (almost) the same spot.
     */
    findMarkerNear(lngLat, thresholdPx = 40) {
        const point = this._map.project(lngLat);
        for (const [id, data] of this._markers) {
            const markerPoint = this._map.project(data.lngLat);
            if (Math.hypot(markerPoint.x - point.x, markerPoint.y - point.y) <= thresholdPx) {
                return id;
            }
        }
        return null;
    }

    /**
     * Focuses a marker's comment input, e.g. right after the shortcut menu's
     * "Comments" action creates or locates the marker for a given location.
     */
    focusCommentInput(markerId) {
        const textarea = this._markers.get(markerId)?.marker?.getElement()?.querySelector('.marker-comment-input');
        if (!textarea) return;
        textarea.focus();
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
    }

    /**
     * Show/hide the "N more layers" summary badge for a marker. Only the marker
     * currently being hovered/explored should reveal it — every other marker on
     * the map keeps it hidden. Collapses it back on hide so re-hovering starts
     * from the same collapsed state.
     */
    _setMoreLayersBadgeVisible(el, visible) {
        const badge = el.querySelector('.more-layers-badge');
        if (!badge) return;

        badge.style.display = visible ? 'flex' : 'none';
        if (!visible) {
            const details = badge.querySelector('.more-layers-badge-details');
            if (details) details.style.display = 'none';
            badge.style.background = 'transparent';
        }
    }

    /**
     * Expand/collapse the "N more layers" summary badge and lazily populate it
     * with a thumbnail + name row per extra layer.
     */
    _attachMoreLayersBadgeHandler(el, features, lngLat) {
        const badge = el.querySelector('.more-layers-badge');
        if (!badge) return;

        const details = badge.querySelector('.more-layers-badge-details');
        if (!details) return;

        details.addEventListener('wheel', (e) => e.stopPropagation());
        details.addEventListener('touchmove', (e) => e.stopPropagation());
        details.addEventListener('touchstart', (e) => e.stopPropagation());
        details.addEventListener('mousedown', (e) => e.stopPropagation());
        details.addEventListener('click', (e) => e.stopPropagation());

        const shortcutBtn = badge.querySelector('.more-layers-shortcut-btn');
        if (shortcutBtn) {
            const openShortcutMenu = (e) => {
                e.stopPropagation();
                if (e.type === 'touchend') e.preventDefault();
                if (!window.shortcutMenu) return;
                const point = e.touches?.[0] || e.changedTouches?.[0] || e;
                window.shortcutMenu._lngLat = lngLat;
                window.shortcutMenu._show(point.clientX, point.clientY);
            };
            shortcutBtn.addEventListener('click', openShortcutMenu);
            if (this._isTouch) shortcutBtn.addEventListener('touchend', openShortcutMenu);
        }

        const handler = (e) => {
            e.stopPropagation();
            if (e.type === 'touchend') e.preventDefault();

            const isExpanding = details.style.display === 'none';
            details.style.display = isExpanding ? 'block' : 'none';
            badge.style.background = isExpanding ? '#374151' : 'transparent';

            if (isExpanding && !details.dataset.loaded) {
                details.dataset.loaded = 'true';

                const currentBounds = this._map.getBounds();
                const bounds = [
                    currentBounds.getWest(), currentBounds.getSouth(),
                    currentBounds.getEast(), currentBounds.getNorth()
                ];
                const allActiveLayers = this._getAllActiveLayersInInspectorOrder();
                const clickedLayerIds = new Set((features || []).map(f => f.layerId));
                const extraLayers = allActiveLayers.filter(layer => !clickedLayerIds.has(layer.id));

                extraLayers.forEach(layer => {
                    let isInView = true;
                    if (window.MapUtils && layer.bbox) {
                        isInView = window.MapUtils.isLayerInView(layer, bounds);
                    }

                    const thumbnail = LayerThumbnail.generate(layer, 24, { isInView, useHeaderImage: false });
                    thumbnail.style.margin = '0';
                    thumbnail.style.borderRadius = '3px';
                    thumbnail.style.flexShrink = '0';

                    const layerRow = document.createElement('div');
                    layerRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;';
                    layerRow.appendChild(thumbnail);

                    const label = document.createElement('span');
                    label.style.cssText = 'font-size:10px;color:#9ca3af;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                    label.textContent = layer.title || layer.id;
                    layerRow.appendChild(label);

                    layerRow.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        if (!isInView && window.layerControl) {
                            window.layerControl._zoomToLayer(layer.id);
                        } else {
                            window.postMessage({ type: 'open-layer-info', layer }, '*');
                        }
                    });

                    details.appendChild(layerRow);
                });
            }
        };
        badge.addEventListener('click', handler);
        if (this._isTouch) badge.addEventListener('touchend', handler);
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
        const details = badge.querySelector('.feature-badge-details');
        if (details) details.style.display = 'none';
        badge.style.background = 'transparent';
        const valueSpan = badge.querySelector('.badge-value');
        if (valueSpan) valueSpan.style.color = '#f3f4f6';
        this._collapseBadgeValue(valueSpan);
    }

    _setBadgeSelected(badge) {
        badge.classList.add('badge-selected');
        const details = badge.querySelector('.feature-badge-details');
        if (details) details.style.display = 'block';
        badge.style.background = '#1e3a5f';
        const valueSpan = badge.querySelector('.badge-value');
        if (valueSpan) valueSpan.style.color = '#93c5fd';
        this._expandBadgeValue(valueSpan);
    }

    /**
     * Toggle a selection-marker badge between collapsed and selected (expanded) state.
     * Selecting expands the attribute table and isolates the layer; deselecting
     * collapses it and clears isolation. Zooming to the feature is a manual action
     * (see the layer actions menu's "Zoom to Feature" item), not automatic here.
     */
    _toggleBadgeSelected(badge, f) {
        const wasSelected = badge.classList.contains('badge-selected');

        // Only one badge per marker stays expanded at a time. Collapse siblings
        // without restoring the view — we're about to either
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
        this._selectedBadges.add(badge);

        if (!f) return;

        // On desktop, isolation is a hover-only effect (see the badge mouseenter/
        // mouseleave handlers). Touch devices have no hover, so apply isolation on
        // select instead; it persists until the badge is deselected.
        if (this._isTouch) {
            const lc = this._stateManager.getLayerConfig(f.layerId);
            const isBasemap = Array.isArray(lc?.tags) && lc.tags.includes('basemap');
            window.postMessage({ type: 'clear-layer-isolation' }, '*');
            window.postMessage({ type: 'isolate-layer', layerId: f.layerId, isBasemap }, '*');
            this._setSiblingBadgesDimmed(badge, true);
        }

        // Layer's inspect.onClick handler (config/{atlas}.js) adds extra HTML
        // beyond the plain fields table.
        const details = badge.querySelector('.feature-badge-details');
        if (details) {
            this._loadInspectionHandlerHTML(details, f.layerId, f.featureId);
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
        // Same feature(s) as currently shown — just reposition the existing marker
        // instead of tearing down and rebuilding its DOM every mousemove tick. The
        // rebuild is what made the label jump/stutter or lag behind the cursor.
        const key = features.map(f => `${f.layerId}:${f.featureId}`).sort().join('|');
        if (this._hoverMarker && this._hoverMarkerKey === key) {
            this._hoverMarker.setLngLat([lngLat.lng, lngLat.lat]);
            return;
        }

        // Remove existing hover marker
        this._clearHoverMarker();

        const el = document.createElement('div');
        el.className = 'hover-marker';
        // Same layout as the selection marker: an action row on top and the feature
        // badges below. The action row is kept as empty reserved space so the badges
        // line up — the buttons only appear once the location is clicked (selected).
        // The hover popup is purely a visual label: pointer-events are disabled so the
        // mouse passes straight through to the map, letting Mapbox keep updating hover
        // state on features beneath the popup. Clicking the underlying feature still
        // selects it (the map's own click handler queries and selects), which rebuilds
        // this as an interactive selection marker.
        el.style.cssText = 'display: flex; flex-direction: column; align-items: flex-start; gap: 4px; pointer-events: none; cursor: pointer; transform: none !important; transition: none !important;';

        const infoSize = 20;
        el.innerHTML = `
            <div class="marker-action-row" style="display: flex; flex-direction: row; align-items: center; gap: 4px; height: ${infoSize}px; flex-shrink: 0;"></div>
            <div class="marker-content" style="display: flex; flex-direction: column; align-items: stretch; gap: 0; max-width: 240px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 4px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);">
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

        // No badge handlers or hover-blocking for the hover popup — it is pointer-events:
        // none, so all interaction passes through to the map beneath it.

        this._hoverMarker = marker;
        this._hoverMarkerKey = key;
    }

    _clearHoverMarker() {
        if (this._hoverMarker) {
            this._hoverMarker.remove();
            this._hoverMarker = null;
        }
        this._hoverMarkerKey = null;
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
            b.style.background = isHovered ? '#374151' : 'transparent';
        });
    }

    _clearAllMarkerHoverStates() {
        this._markers.forEach((markerData, markerId) => {
            this._setMarkerHoverState(markerId, false);
        });
    }

    /**
     * Drop duplicate features that share the same layer + feature id. queryRenderedFeatures
     * returns a feature once per tile it intersects, so a feature straddling a tile boundary
     * comes back multiple times and would otherwise render duplicate badges.
     */
    _dedupeFeatures(features) {
        if (!Array.isArray(features)) return features;
        const seen = new Set();
        return features.filter(f => {
            const key = `${f.layerId}:${f.featureId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    addMarker(lngLat, features) {
        features = this._dedupeFeatures(features);
        const markerId = `marker-${Date.now()}-${this._markers.size}`;
        const markerNumber = this._markers.size + 1;

        const el = document.createElement('div');
        el.className = 'selection-marker';
        // Action row (map pin) sits on top at the click point; feature badges
        // stack below it, left-aligned to the pin.
        el.style.cssText = 'display: flex; flex-direction: column; align-items: flex-start; gap: 4px;';

        el.innerHTML = `
            <div class="marker-action-row" style="display: flex; flex-direction: row; align-items: center; gap: 4px; flex-shrink: 0;"></div>
            <div class="marker-content" style="display: flex; flex-direction: column; align-items: stretch; gap: 0; max-width: 240px; background: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 4px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35); cursor: move;">
                ${this._buildCommentSectionHTML(features)}
                ${this._buildMarkerBadgesHTML(features, lngLat, { includeMoreLayers: true })}
            </div>
        `;

        // Anchor so the pin's tip touches the clicked location — clicking the
        // same spot again hits the pin and clears the marker (seamless toggle).
        const pinSize = this._isTouch ? 34 : 28;
        const marker = new mapboxgl.Marker({
            element: el,
            anchor: 'top-left',
            offset: [-(pinSize / 2), -pinSize],
            draggable: true
        })
            .setLngLat([lngLat.lng, lngLat.lat])
            .addTo(this._map);

        // While dragging, the marker behaves like the mouse pointer hovering the map
        // (live preview of whatever is beneath it) rather than selecting anything.
        // Only on release does it re-query and act like a click at the drop point.
        // Mapbox fires 'drag' on every pointermove tick, which can outpace the
        // display's refresh rate; running the feature query + hover pipeline
        // synchronously on each one backs up the main thread and makes the marker's
        // own position updates (driven by the same thread) stutter or lag behind the
        // cursor. Coalesce to at most one query per animation frame.
        let dragRAF = null;
        marker.on('dragstart', () => this._handleMarkerDragStart(markerId));
        marker.on('drag', () => {
            if (dragRAF) return;
            dragRAF = requestAnimationFrame(() => {
                dragRAF = null;
                this._handleMarkerDrag(marker);
            });
        });
        marker.on('dragend', () => {
            if (dragRAF) {
                cancelAnimationFrame(dragRAF);
                dragRAF = null;
            }
            this._handleMarkerDragEnd(marker, markerId);
        });

        // Clicking a badge opens the inspector; selection markers are already selected.
        this._attachBadgeHandlers(el, features, lngLat, false);
        this._attachCommentSectionHandlers(el, lngLat);
        this._blockMapHoverEvents(el);

        // Only the pin (marker-action-row) should drag the actual location. The
        // balloon group has its own independent drag that just repositions it
        // on screen for decluttering, without touching lngLat or re-querying.
        const contentEl = el.querySelector('.marker-content');
        if (contentEl) {
            this._attachBalloonDragHandler(contentEl);
        }

        const markerData = {
            id: markerId,
            marker,
            lngLat,
            features
        };

        this._markers.set(markerId, markerData);
        this._currentMarkerIndex = this._markers.size - 1;

        // Map pin at the click point — same icon as the layer inspector's trigger
        // button (geo-alt-fill), so a real marker (not an abstract button) marks the
        // spot. Clicking it (i.e. clicking the same spot again) clears this marker,
        // toggling the selection off.
        const actionRow = el.querySelector('.marker-action-row');
        if (actionRow) {
            const pinBtn = document.createElement('span');
            pinBtn.className = 'marker-pin-btn';
            pinBtn.innerHTML = `<sl-icon name="geo-alt-fill" style="font-size:${pinSize}px;color:#f97316;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));pointer-events:none;"></sl-icon>`;
            pinBtn.title = 'Clear this marker';
            pinBtn.style.cssText = `
                display: flex;
                align-items: flex-end;
                justify-content: center;
                width: ${pinSize}px;
                height: ${pinSize}px;
                cursor: pointer;
                flex-shrink: 0;
                transition: filter 0.2s;
            `;
            if (!this._isTouch) {
                pinBtn.addEventListener('mouseenter', () => {
                    pinBtn.style.filter = 'brightness(1.2) drop-shadow(0 1px 2px rgba(0,0,0,0.5))';
                });
                pinBtn.addEventListener('mouseleave', () => {
                    pinBtn.style.filter = '';
                });
            }
            const handleCloseClick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.removeMarker(markerId);
            };
            pinBtn.addEventListener('click', handleCloseClick);
            // On touch, also bind touchend so the close fires on first tap rather
            // than waiting for the synthesized (and sometimes swallowed) click.
            if (this._isTouch) {
                pinBtn.addEventListener('touchend', handleCloseClick);
            }
            actionRow.appendChild(pinBtn);
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
                // The pointer is no longer over the map canvas, so the mousemove-driven
                // hover query won't fire to clear whatever was hovered right before
                // entering the box — clear it explicitly so only this marker's own
                // features end up highlighted.
                this._stateManager.handleMapMouseLeave();
                this._setMarkerFeaturesHoverState(markerId, true);
                this._setMoreLayersBadgeVisible(el, true);
            });

            el.addEventListener('mouseleave', () => {
                this._pointerOverMarker = false;
                this._setMarkerFeaturesHoverState(markerId, false);
                this._setMoreLayersBadgeVisible(el, false);
            });
        }

        // Update selection layer
        this._updateSelectionLayer();

        return markerId;
    }

    _handleMarkerDragStart(markerId) {
        this._draggingMarkerId = markerId;
    }

    /**
     * While the marker is being dragged, treat its current position exactly like a
     * mouse hover — query what's beneath it and run it through the same hover
     * pipeline normal map mousemove uses, so the same hover popup/highlight preview
     * follows the marker instead of nothing happening until it's dropped.
     */
    _handleMarkerDrag(marker) {
        const lngLat = marker.getLngLat();
        const point = this._map.project(lngLat);

        const interactiveFeatures = this._stateManager.getFeaturesAtPoint(point, lngLat)
            .filter(({ layerId }) => this._stateManager.isLayerInteractive(layerId));

        this._stateManager.handleFeatureHovers(interactiveFeatures, lngLat);
    }

    /**
     * Re-query features at a dragged marker's new position and dispatch them
     * through the same selection pipeline as a map click, so the marker (and its
     * badges) rebuild as if the user had clicked at the drop point.
     *
     * This only touches the dragged marker itself: its own old feature selections
     * are dropped (removeMarker, same scoped cleanup as closing it) and the new
     * ones are added without the usual "replace" clearing a fresh click would do
     * — otherwise moving one marker in a multi-marker selection would wipe out
     * every other marker and feature selected alongside it.
     */
    _handleMarkerDragEnd(marker, markerId) {
        this._draggingMarkerId = null;

        const lngLat = marker.getLngLat();
        const point = this._map.project(lngLat);

        const interactiveFeatures = this._stateManager.getFeaturesAtPoint(point, lngLat)
            .filter(({ layerId }) => this._stateManager.isLayerInteractive(layerId));

        this.removeMarker(markerId);

        const wasCmdCtrlPressed = this._stateManager._isCmdCtrlPressed;
        this._stateManager._isCmdCtrlPressed = true;
        try {
            if (interactiveFeatures.length > 0) {
                this._stateManager.handleFeatureClicks(interactiveFeatures);
            } else {
                this._stateManager.handleFeatureClicks([], lngLat);
            }
        } finally {
            this._stateManager._isCmdCtrlPressed = wasCmdCtrlPressed;
        }
    }

    /**
     * The balloon group (marker-content) sits inside the same DOM element as the
     * location pin, so a mousedown there would otherwise bubble to the map's
     * canvas container and trigger Mapbox's own marker-drag (moving the pin and
     * re-querying the location). Stop that bubbling and instead run a purely
     * visual drag — a CSS transform on this element — that repositions the
     * balloons for readability without ever touching the marker's lngLat.
     */
    _attachBalloonDragHandler(contentEl) {
        const DRAG_THRESHOLD = 4;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let offsetY = 0;
        let lastDx = 0;
        let lastDy = 0;
        let moved = false;

        const getPoint = (e) => (e.touches && e.touches.length ? e.touches[0] : e);

        const onMove = (e) => {
            const point = getPoint(e);
            const dx = point.clientX - startX;
            const dy = point.clientY - startY;
            if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true;
            if (moved) {
                lastDx = dx;
                lastDy = dy;
                contentEl.style.transform = `translate3d(${offsetX + dx}px, ${offsetY + dy}px, 0)`;
                e.preventDefault();
            }
        };

        const onUp = () => {
            if (moved) {
                offsetX += lastDx;
                offsetY += lastDy;
            }
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
        };

        const onDown = (e) => {
            e.stopPropagation();
            const point = getPoint(e);
            startX = point.clientX;
            startY = point.clientY;
            moved = false;
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onUp);
        };

        contentEl.addEventListener('mousedown', onDown);
        contentEl.addEventListener('touchstart', onDown);

        // A real drag shouldn't also trigger whatever badge sits under the
        // pointer on release — swallow that one click in the capture phase,
        // before it reaches the badge's own bubble-phase click handler.
        contentEl.addEventListener('click', (e) => {
            if (moved) {
                e.stopPropagation();
                e.preventDefault();
                moved = false;
            }
        }, true);
    }

    _setMarkerFeaturesHoverState(markerId, hoverState) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;

        // Set hover state for all features in this marker
        markerData.features.forEach(({ feature, layerId, featureId }) => {
            this._stateManager.setFeatureHoverState(layerId, featureId, hoverState);
        });
    }

    /**
     * Load and render a layer's custom inspect.onClick handler (config/{atlas}.js)
     * into a `.custom-html-container` inside `details`, for the marker badge's
     * expanded attribute table. Mark the container with data-needs-handler/
     * data-atlas/data-handler/data-feature-data before calling this.
     */
    async _loadInspectionHandlerHTML(details, layerId, featureId) {
        const needsHandler = details.dataset.needsHandler === 'true';
        const customContainer = details.querySelector('.custom-html-container');
        if (!needsHandler || !customContainer || customContainer.dataset.loaded) return;

        const atlasName = details.dataset.atlas;
        const handlerName = details.dataset.handler;
        const layerConfig = this._stateManager.getLayerConfig(layerId);
        let feature;
        try {
            feature = JSON.parse(decodeURIComponent(details.dataset.featureData));
        } catch (e) {}

        if (!feature || !atlasName || !handlerName) return;

        customContainer.innerHTML = '<div style="color: #94a3b8; font-size: 10px; padding: 4px;">Loading...</div>';

        try {
            const { handlerLoader } = await import('./inspection-handler-loader.js');

            // Execute handler - the HTML contains inline scripts that will run
            const customHTML = await handlerLoader.executeHandler(atlasName, handlerName, {
                feature,
                featureId,
                layerConfig,
                properties: feature.properties
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

    /**
     * Shortcut export triggered from the layer actions menu in a marker badge.
     * "export-selected" reuses the app's current selection (same as the "selected
     * only" export in map-export.html); "export-layer" pulls every feature currently
     * loaded for that layer's source, regardless of selection.
     */
    async _handleLayerExportAction(action, format, layerId) {
        const exportControl = window.exportControl;
        if (!exportControl || !layerId || !format) return;

        const config = { format, exportSelectedOnly: true };

        if (action === 'export-layer') {
            const layerConfig = this._stateManager.getLayerConfig(layerId);
            const sourceId = layerConfig?.source || `${layerConfig?.type}-${layerId}`;
            let features = [];
            try {
                features = this._map.querySourceFeatures(sourceId, { sourceLayer: layerConfig?.sourceLayer }) || [];
            } catch (err) {
                console.warn(`[MapMarkerManager] Could not query features for layer "${layerId}":`, err);
            }
            if (features.length === 0) return;
            config.customSelectedFeatures = features.map(feature => ({ feature, layerId, layerConfig }));
        }

        await exportControl._handleExport(config);
    }

    _navigateMarker(direction) {
        const markerArray = Array.from(this._markers.values());
        if (markerArray.length <= 1) return;

        this._currentMarkerIndex = (this._currentMarkerIndex + direction + markerArray.length) % markerArray.length;
        const targetMarker = markerArray[this._currentMarkerIndex];

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

    _zoomToFeature(feature) {
        if (!this._map || !feature) return;

        if (!feature.geometry || !feature.geometry.coordinates) {
            console.warn('[MapMarkerManager] Feature has no valid geometry');
            return;
        }

        const bbox = CameraUtils.computeGeojsonBbox(feature);
        if (!bbox) {
            console.warn('[MapMarkerManager] Could not compute bbox for feature');
            return;
        }

        CameraUtils.fitBounds(this._map, bbox, { duration: 1000 });
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
            this._deselectMarkerBadges(markerData);
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
        const markerPoints = (selectionLayer?.geojson?.features || []).filter(f => f.geometry?.type === 'Point');
        if (markerPoints.length === 0) {
            return false;
        }

        // Older shared URLs carry explicit layerId/featureId refs per marker (see
        // UrlManager.parseMarkersFromURL); newer URLs carry only the click location, and
        // the features present there are recovered below by re-querying that point once
        // its layers are ready — exactly as if the user clicked there fresh.
        const withRefs = markerPoints.filter(f => Array.isArray(f.properties?.features) && f.properties.features.length > 0);
        const locationsOnly = markerPoints.filter(f => !Array.isArray(f.properties?.features) || f.properties.features.length === 0);

        // Show a pin with a spinner at each location-only marker immediately, rather
        // than leaving nothing on screen until every layer below has finished loading —
        // raster/basemap sources (satellite imagery, admin-line style layers, ...) can
        // take much longer than the vector data the query itself depends on.
        const placeholderIds = locationsOnly.map(feature => {
            const [lng, lat] = feature.geometry.coordinates;
            return this._addLoadingPlaceholder({ lng, lat });
        });

        const refLayerIds = new Set();
        withRefs.forEach(feature => {
            feature.properties.features.forEach(ref => refLayerIds.add(ref.layerId));
        });

        const allRestoredFeatures = [];

        if (withRefs.length > 0) {
            await this._waitForLayersReady(Array.from(refLayerIds));
            await this._waitForMapIdle();

            for (const feature of withRefs) {
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
                    this.addMarker(lngLat, restoredFeatures);
                    allRestoredFeatures.push(...restoredFeatures);
                }
            }
        }

        if (locationsOnly.length > 0) {
            // No refs to target specific layers, so wait for the URL's queryable
            // (non-raster) layers instead. Raster/style layers never register with the
            // state manager and can't be queried anyway, so waiting on them would just
            // stall every marker behind the slowest basemap tile — see the loading
            // placeholder above and _isQueryableLayerType below.
            const layerIds = new Set();
            window.layerControl._state.groups.forEach(group => {
                if (group.initiallyChecked && this._isQueryableLayerType(group)) {
                    layerIds.add(group.id);
                }
            });

            await this._waitForLayersReady(Array.from(layerIds));
            await this._waitForSourcesReady(Array.from(layerIds));

            // Force "add" mode so each location-only marker layers onto the others
            // (and onto any ref-based markers restored above) instead of clearing them,
            // same as MapMarkerManager._handleMarkerDragEnd re-selecting after a drag.
            const wasCmdCtrlPressed = this._stateManager._isCmdCtrlPressed;
            this._stateManager._isCmdCtrlPressed = true;
            try {
                locationsOnly.forEach((feature, i) => {
                    this._removeLoadingPlaceholder(placeholderIds[i]);

                    const [lng, lat] = feature.geometry.coordinates;
                    const lngLat = { lng, lat };
                    const point = this._map.project([lng, lat]);
                    const interactiveFeatures = this._stateManager.getFeaturesAtPoint(point, lngLat)
                        .filter(({ layerId }) => this._stateManager.isLayerInteractive(layerId));

                    if (interactiveFeatures.length > 0) {
                        this._stateManager.handleFeatureClicks(interactiveFeatures);
                    } else {
                        this._stateManager.handleFeatureClicks([], lngLat);
                    }
                });
            } finally {
                this._stateManager._isCmdCtrlPressed = wasCmdCtrlPressed;
            }
        }

        if (this._markers.size > 0) {
            this._stateManager._updateLineSortKeys();
        }

        // Notify the inspector iframe (and other listeners) of the ref-based restorations
        // so the status bar with the Clear / Add / Zoom buttons shows. Those markers were
        // created manually above (bypassing the normal click pipeline), so the
        // fromMarkerRestore flag tells _handleSelection not to re-add them — mirrors the
        // event sequence in UrlManager.applySelectionsFromURL. Location-only markers went
        // through handleFeatureClicks() above, which already emits these events itself
        // (and creates their markers via the normal _handleSelection listener).
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

    /**
     * A pin + spinner shown at a location-only marker's position while its layers
     * load and its point query is pending — see restoreMarkersFromSelectionLayer.
     * Returns an id to pass to _removeLoadingPlaceholder once the real marker is ready.
     */
    _addLoadingPlaceholder(lngLat) {
        const pinSize = this._isTouch ? 34 : 28;
        const el = document.createElement('div');
        el.className = 'marker-loading-placeholder';
        el.style.cssText = 'display: flex; flex-direction: column; align-items: flex-start; gap: 4px; pointer-events: none;';
        el.innerHTML = `
            <div class="marker-action-row" style="display: flex; align-items: flex-end; justify-content: center; width: ${pinSize}px; height: ${pinSize}px; flex-shrink: 0;">
                <sl-icon name="geo-alt-fill" style="font-size:${pinSize}px;color:#f97316;opacity:0.55;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));"></sl-icon>
            </div>
            <div class="marker-content" style="display:flex;align-items:center;gap:6px;background:#1f2937;border:1px solid #374151;border-radius:8px;padding:4px 8px;box-shadow:0 4px 16px rgba(0,0,0,0.35);">
                <sl-spinner style="font-size:12px;--indicator-color:#f97316;"></sl-spinner>
                <span style="font-size:11px;font-weight:600;color:#9ca3af;white-space:nowrap;">Loading...</span>
            </div>
        `;

        const marker = new mapboxgl.Marker({
            element: el,
            anchor: 'top-left',
            offset: [-(pinSize / 2), -pinSize]
        })
            .setLngLat([lngLat.lng, lngLat.lat])
            .addTo(this._map);

        const id = `placeholder-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this._loadingPlaceholders.set(id, marker);
        return id;
    }

    _removeLoadingPlaceholder(id) {
        const marker = this._loadingPlaceholders.get(id);
        if (marker) {
            marker.remove();
            this._loadingPlaceholders.delete(id);
        }
    }

    /**
     * Whether a layer group's type is one that (a) actually registers with the state
     * manager and (b) is queryable via queryRenderedFeatures — i.e. worth waiting on
     * before re-querying a restored marker's location. Mirrors the skip conditions in
     * MapLayerControls._registerLayerWithStateManager and MapFeatureStateManager._isRasterLayer.
     */
    _isQueryableLayerType(group) {
        if (!group.type || group.type === 'style') return false;
        const nonQueryableTypes = ['tms', 'wmts', 'img', 'raster-style-layer', 'cog', 'wms'];
        if (nonQueryableTypes.includes(group.type)) return false;
        const isVectorLike = group.type === 'geojson' || group.type === 'vector' || group.type === 'csv' || group.type === 'sheet' || group.type === 'js';
        if (isVectorLike && (group.inspect === false || group.inspect === null)) return false;
        return true;
    }

    /**
     * Wait for the given layers' sources to finish loading, without waiting on the
     * map's global 'idle' event — which only fires once every source (including slow
     * raster/satellite basemap tiles) has settled. A restored marker's point query only
     * needs its own vector sources ready, not the whole style.
     */
    async _waitForSourcesReady(layerIds, timeout = 5000) {
        const sourceIds = new Set();
        layerIds.forEach(layerId => {
            const layerConfig = this._stateManager.getLayerConfig(layerId);
            if (layerConfig) {
                sourceIds.add(layerConfig.source || `${layerConfig.type}-${layerId}`);
            }
        });

        if (sourceIds.size === 0) {
            return;
        }

        const startTime = Date.now();
        return new Promise((resolve) => {
            const check = () => {
                const allLoaded = Array.from(sourceIds).every(id => {
                    return this._map.getSource(id) && this._map.isSourceLoaded(id);
                });

                if (allLoaded || Date.now() - startTime > timeout) {
                    resolve();
                } else {
                    requestAnimationFrame(check);
                }
            };
            check();
        });
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

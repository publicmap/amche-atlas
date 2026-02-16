/**
 * MapMarkerManager - Manages selection markers on the map
 * Creates markers at selection locations with popups showing selected features
 */
import { LayerThumbnail } from './layer-thumbnail.js';
import { FeatureDisplayRenderer } from './feature-display-renderer.js';

export class MapMarkerManager {
    constructor(map, stateManager) {
        this._map = map;
        this._stateManager = stateManager;
        this._markers = new Map();
        this._hoverMarker = null;
        this._currentMarkerIndex = 0;
        this._selectionMode = 'replace';
        this._expandedFeatures = new Map(); // markerId -> featureId
        this._cameraPositions = new Map(); // markerId-featureId -> camera state

        this._setupEventListeners();
    }

    _setupEventListeners() {
        this._stateManager.addEventListener('state-change', (event) => {
            const { eventType, data } = event.detail;

            if (eventType === 'feature-click' || eventType === 'feature-click-multiple') {
                this._handleSelection(data);
            }

            if (eventType === 'features-batch-hover') {
                this._handleBatchHover(data);
            }

            if (eventType === 'map-mouse-leave') {
                this._clearHoverMarker();
            }

            if (eventType === 'selections-cleared') {
                this.clearAllMarkers();
            }
        });

        this._map.on('movestart', () => {
            this._markers.forEach(markerData => {
                this._closePopup(markerData.id);
            });
        });
    }

    _handleSelection(data) {
        const features = data.selectedFeatures || [data];
        const lngLat = features[0]?.lngLat;

        if (!lngLat) return;

        // Clear hover marker on selection
        this._clearHoverMarker();

        // Ensure state manager knows we're in add mode
        if (this._selectionMode === 'add') {
            this._stateManager._isCmdCtrlPressed = true;
        }

        if (this._selectionMode === 'replace') {
            this.clearAllMarkers();
        } else if (this._selectionMode === 'add') {
            // Close all other marker popups when adding new one
            this._markers.forEach(markerData => {
                this._closePopup(markerData.id);
            });
        }

        this.addMarker(lngLat, features);

        // Reset if in replace mode
        if (this._selectionMode === 'replace') {
            // Use setTimeout to allow the click event to complete
            setTimeout(() => {
                this._stateManager._isCmdCtrlPressed = false;
            }, 0);
        }
    }

    _handleBatchHover(data) {
        const hoveredFeatures = data.hoveredFeatures || [];

        if (!hoveredFeatures || hoveredFeatures.length === 0) {
            this._clearHoverMarker();
            return;
        }

        const lngLat = data.lngLat || hoveredFeatures[0]?.lngLat;

        if (!lngLat) {
            this._clearHoverMarker();
            return;
        }

        // Extract labels from all hovered features
        const labels = hoveredFeatures.map(f => {
            const layerConfig = this._stateManager.getLayerConfig(f.layerId);
            const inspectConfig = layerConfig?.inspect || {};
            const labelField = inspectConfig.label || inspectConfig.id || 'id';
            return f.feature.properties?.[labelField] || f.featureId;
        });
        const labelText = labels.join(', ');

        this._showHoverMarker(lngLat, labelText, hoveredFeatures);
    }

    _showHoverMarker(lngLat, labelText, features) {
        // Remove existing hover marker
        this._clearHoverMarker();

        const hasLabels = labelText.trim().length > 0;

        const el = document.createElement('div');
        el.className = 'hover-marker';
        el.style.cssText = 'display: flex; flex-direction: column; align-items: center; pointer-events: auto; cursor: pointer; transform: none !important; transition: none !important;';

        // Show label text if available, otherwise show geo-alt icon
        if (hasLabels) {
            el.innerHTML = `
                <div class="marker-content" style="
                    display: flex;
                    align-items: center;
                    background: #fbbf24;
                    padding: 3px 6px;
                    border-radius: 10px;
                    border: 2px solid white;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                    cursor: pointer;
                    transition: background 0.2s;
                ">
                    <span style="
                        font-size: 10px;
                        font-weight: 700;
                        color: #000;
                        line-height: 1;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        max-width: 120px;
                    ">${labelText}</span>
                </div>
                <div style="
                    width: 0;
                    height: 0;
                    border-left: 5px solid transparent;
                    border-right: 5px solid transparent;
                    border-top: 6px solid white;
                    position: relative;
                ">
                    <div style="
                        position: absolute;
                        top: -8px;
                        left: 50%;
                        transform: translateX(-50%);
                        width: 0;
                        height: 0;
                        border-left: 3px solid transparent;
                        border-right: 3px solid transparent;
                        border-top: 4px solid #fbbf24;
                    "></div>
                </div>
            `;
        } else {
            el.innerHTML = `
                <div class="marker-content" style="
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #fbbf24;
                    padding: 4px;
                    border-radius: 10px;
                    border: 2px solid white;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                    cursor: pointer;
                    transition: background 0.2s;
                ">
                    <sl-icon name="geo-alt" style="
                        font-size: 12px;
                        color: #000;
                    "></sl-icon>
                </div>
                <div style="
                    width: 0;
                    height: 0;
                    border-left: 5px solid transparent;
                    border-right: 5px solid transparent;
                    border-top: 6px solid white;
                    position: relative;
                ">
                    <div style="
                        position: absolute;
                        top: -8px;
                        left: 50%;
                        transform: translateX(-50%);
                        width: 0;
                        height: 0;
                        border-left: 3px solid transparent;
                        border-right: 3px solid transparent;
                        border-top: 4px solid #fbbf24;
                    "></div>
                </div>
            `;
        }

        const marker = new mapboxgl.Marker({
            element: el,
            anchor: 'bottom'
        })
            .setLngLat([lngLat.lng, lngLat.lat])
            .addTo(this._map);

        // Click to select
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            // Trigger selection on these features
            this._stateManager.handleFeatureClicks(features.map(f => ({
                ...f,
                lngLat
            })));
        });

        this._hoverMarker = marker;
    }

    _clearHoverMarker() {
        if (this._hoverMarker) {
            this._hoverMarker.remove();
            this._hoverMarker = null;
        }
    }

    addMarker(lngLat, features) {
        const markerId = `marker-${Date.now()}-${this._markers.size}`;
        const markerNumber = this._markers.size + 1;

        // Extract labels from all features
        const labels = features.map(f => {
            const layerConfig = this._stateManager.getLayerConfig(f.layerId);
            const inspectConfig = layerConfig?.inspect || {};
            const labelField = inspectConfig.label || inspectConfig.id || 'id';
            return f.feature.properties?.[labelField] || f.featureId;
        });
        const labelText = labels.join(', ');
        const hasLabels = labelText.trim().length > 0;

        const el = document.createElement('div');
        el.className = 'selection-marker';
        el.style.cssText = 'display: flex; flex-direction: column; align-items: center; transition: none !important;';

        // Show label text if available, otherwise show geo-alt icon
        if (hasLabels) {
            el.innerHTML = `
                <div class="marker-content" style="
                    display: flex;
                    align-items: center;
                    background: #3b82f6;
                    padding: 4px 8px;
                    border-radius: 12px;
                    border: 2px solid white;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                    cursor: pointer;
                    transition: background 0.2s;
                ">
                    <span style="
                        font-size: 11px;
                        font-weight: 700;
                        color: white;
                        line-height: 1;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        max-width: 150px;
                    ">${labelText}</span>
                </div>
                <div style="
                    width: 0;
                    height: 0;
                    border-left: 6px solid transparent;
                    border-right: 6px solid transparent;
                    border-top: 8px solid white;
                    position: relative;
                ">
                    <div style="
                        position: absolute;
                        top: -10px;
                        left: 50%;
                        transform: translateX(-50%);
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-top: 6px solid #3b82f6;
                    "></div>
                </div>
            `;
        } else {
            el.innerHTML = `
                <div class="marker-content" style="
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #3b82f6;
                    padding: 6px;
                    border-radius: 12px;
                    border: 2px solid white;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                    cursor: pointer;
                    transition: background 0.2s;
                ">
                    <sl-icon name="geo-alt" style="
                        font-size: 14px;
                        color: white;
                    "></sl-icon>
                </div>
                <div style="
                    width: 0;
                    height: 0;
                    border-left: 6px solid transparent;
                    border-right: 6px solid transparent;
                    border-top: 8px solid white;
                    position: relative;
                ">
                    <div style="
                        position: absolute;
                        top: -10px;
                        left: 50%;
                        transform: translateX(-50%);
                        width: 0;
                        height: 0;
                        border-left: 4px solid transparent;
                        border-right: 4px solid transparent;
                        border-top: 6px solid #3b82f6;
                    "></div>
                </div>
            `;
        }

        const marker = new mapboxgl.Marker({
            element: el,
            anchor: 'bottom'
        })
            .setLngLat([lngLat.lng, lngLat.lat])
            .addTo(this._map);

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
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleMarkerPopup(markerId);
        });

        // Hover to highlight features on map
        el.addEventListener('mouseenter', () => {
            this._setMarkerFeaturesHoverState(markerId, true);
        });

        el.addEventListener('mouseleave', () => {
            this._setMarkerFeaturesHoverState(markerId, false);
        });

        this._showMarkerPopup(markerId);

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
            className: 'selection-popup'
        })
            .setLngLat([markerData.lngLat.lng, markerData.lngLat.lat])
            .setHTML(popupContent)
            .addTo(this._map);

        markerData.popup = popup;

        // Add hover listeners to popup
        const popupElement = popup.getElement();
        if (popupElement) {
            popupElement.addEventListener('mouseenter', () => {
                this._setMarkerFeaturesHoverState(markerId, true);
            });

            popupElement.addEventListener('mouseleave', () => {
                this._setMarkerFeaturesHoverState(markerId, false);
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

        // Get atlas metadata for badges
        const getAtlasBadge = (layerConfig) => {
            const atlasName = layerConfig?._sourceAtlas;
            if (!atlasName) return '';

            // Try to get atlas metadata from layer registry
            const layerRegistry = window.layerRegistry;
            if (!layerRegistry) return '';

            const atlasMetadata = layerRegistry._atlasMetadata?.get(atlasName);
            if (!atlasMetadata) return '';

            return `
                <span class="atlas-badge" style="
                    font-size: 8px;
                    padding: 1px 4px;
                    border-radius: 2px;
                    font-weight: 600;
                    color: white;
                    background-color: ${atlasMetadata.color || '#2563eb'};
                    margin-right: 4px;
                ">${atlasMetadata.name}</span>
            `;
        };

        const featuresList = Array.from(groupedFeatures.entries()).map(([layerId, layerFeatures]) => {
            const layerConfig = this._stateManager.getLayerConfig(layerId);
            const thumbnail = LayerThumbnail.generate(layerConfig, 24);
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

                let propertiesHTML = '';
                if (fields.length > 0) {
                    propertiesHTML = '<div class="properties-table" style="margin-top: 6px; font-size: 10px;">';
                    fields.forEach((fieldName, index) => {
                        const value = properties[fieldName];
                        if (value !== null && value !== undefined && value !== '') {
                            const fieldTitle = fieldTitles[index] || fieldName;
                            propertiesHTML += `
                                <div style="display: flex; padding: 2px 0; border-bottom: 1px solid #0f172a;">
                                    <div style="color: #9ca3af; min-width: 70px; font-weight: 500;">${fieldTitle}</div>
                                    <div style="color: #e5e7eb; flex: 1; word-break: break-word;">${value}</div>
                                </div>
                            `;
                        }
                    });
                    propertiesHTML += '</div>';
                }

                // Count all properties
                const totalPropsCount = Object.keys(properties).length;
                const shownPropsCount = fields.length;

                // Build all properties table (hidden by default)
                let allPropertiesHTML = '';
                if (totalPropsCount > shownPropsCount) {
                    allPropertiesHTML = '<div class="all-properties-container" style="display: none; margin-top: 6px; font-size: 10px;">';
                    Object.entries(properties).forEach(([key, value]) => {
                        if (value !== null && value !== undefined && value !== '') {
                            allPropertiesHTML += `
                                <div style="display: flex; padding: 2px 0; border-bottom: 1px solid #0f172a;">
                                    <div style="color: #9ca3af; min-width: 70px; font-weight: 500;">${key}</div>
                                    <div style="color: #e5e7eb; flex: 1; word-break: break-word;">${value}</div>
                                </div>
                            `;
                        }
                    });
                    allPropertiesHTML += '</div>';
                }

                const showMoreButton = totalPropsCount > shownPropsCount ? `
                    <button class="show-all-props-btn" style="
                        margin-top: 6px;
                        padding: 4px 10px;
                        background: #374151;
                        color: #d1d5db;
                        border: 1px solid #4b5563;
                        border-radius: 3px;
                        font-size: 10px;
                        font-weight: 600;
                        cursor: pointer;
                        width: 100%;
                        transition: all 0.2s;
                    ">Show all ${totalPropsCount} properties</button>
                ` : '';

                return `
                    <div class="feature-item-container" data-layer-id="${layerId}" data-feature-id="${featureId}" style="
                        background: #334155;
                        border-radius: 3px;
                        margin-bottom: 3px;
                        overflow: hidden;
                    ">
                        <div class="feature-item-header" style="
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            padding: 4px 6px;
                            cursor: pointer;
                            transition: background 0.2s;
                        " onmouseenter="this.style.background='#475569'" onmouseleave="this.style.background='#334155'">
                            ${thumbnailHTML}
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 9px; color: #94a3b8; font-weight: 500; display: flex; align-items: center; gap: 3px;">
                                    ${atlasBadge}
                                    <span>${layerConfig?.title || layerId}</span>
                                </div>
                                <div style="font-size: 12px; color: #e2e8f0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${featureLabel}</div>
                            </div>
                            <div class="expand-icon" style="color: #94a3b8; font-size: 9px;">▼</div>
                        </div>
                        <div class="feature-item-details" style="
                            display: none;
                            padding: 6px;
                            background: #1e293b;
                            border-top: 1px solid #0f172a;
                        " data-needs-handler="${layerConfig?._sourceAtlas && inspectConfig.onClick ? 'true' : 'false'}" data-atlas="${layerConfig?._sourceAtlas || ''}" data-handler="${inspectConfig.onClick || ''}" data-feature-data="${encodeURIComponent(JSON.stringify(f.feature))}">
                            <div class="custom-html-container"></div>
                            ${propertiesHTML}
                            ${allPropertiesHTML}
                            ${showMoreButton}
                        </div>
                    </div>
                `;
            }).join('');
        }).join('');

        // Conditional navigation buttons
        const showPrevButton = totalMarkers > 1 && markerNumber > 1;
        const showNextButton = totalMarkers > 1 && markerNumber < totalMarkers;

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
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px;
                    border-bottom: 1px solid #334155;
                ">
                    <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                        ${showPrevButton ? `
                            <button class="nav-prev" style="
                                background: #334155;
                                border: none;
                                color: #e2e8f0;
                                padding: 3px 7px;
                                border-radius: 3px;
                                cursor: pointer;
                                font-size: 12px;
                            ">&lt;</button>
                        ` : ''}
                        <button class="toggle-marker-icon" style="
                            background: #3b82f6;
                            border: none;
                            color: white;
                            padding: 3px 6px;
                            border-radius: 50%;
                            cursor: pointer;
                            font-size: 14px;
                            width: 24px;
                            height: 24px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        "><sl-icon name="geo-alt" style="font-size: 12px;"></sl-icon></button>
                        <h4 style="margin: 0; font-size: 13px; font-weight: 600;">
                            ${features.length} feature${features.length !== 1 ? 's' : ''} selected
                        </h4>
                        ${showNextButton ? `
                            <button class="nav-next" style="
                                background: #334155;
                                border: none;
                                color: #e2e8f0;
                                padding: 3px 7px;
                                border-radius: 3px;
                                cursor: pointer;
                                font-size: 12px;
                            ">&gt;</button>
                        ` : ''}
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <button class="remove-selection" style="
                            background: #dc2626;
                            border: none;
                            color: white;
                            padding: 4px 10px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 11px;
                            font-weight: 600;
                        ">Remove Selection</button>
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
                        ">&times;</button>
                    </div>
                </div>

                <div style="padding: 8px;">
                    <div class="location-details" style="
                        display: none;
                        align-items: center;
                        gap: 6px;
                        margin-bottom: 8px;
                        padding: 6px;
                        background: #334155;
                        border-radius: 3px;
                        font-size: 11px;
                        color: #94a3b8;
                    ">
                        <span>${lngLat.lat.toFixed(6)}, ${lngLat.lng.toFixed(6)}</span>
                        <button class="copy-coords" style="
                            background: #1e293b;
                            border: none;
                            color: #e2e8f0;
                            padding: 2px 6px;
                            border-radius: 2px;
                            cursor: pointer;
                            font-size: 10px;
                        ">Copy</button>
                        <button class="open-with" style="
                            background: #1e293b;
                            border: none;
                            color: #e2e8f0;
                            padding: 2px 6px;
                            border-radius: 2px;
                            cursor: pointer;
                            font-size: 10px;
                        ">Open with...</button>
                    </div>

                    <div class="features-list-container" style="max-height: 250px; overflow-y: auto;">
                        ${featuresList}
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

        popup.querySelector('.remove-selection')?.addEventListener('click', () => {
            // Clear selections for all features in this marker
            markerData.features.forEach(({ layerId }) => {
                this._stateManager.clearLayerSelections(layerId);
            });
            // Remove the marker
            this.removeMarker(markerId);
        });

        popup.querySelector('.nav-prev')?.addEventListener('click', () => {
            this._navigateMarker(-1);
        });

        popup.querySelector('.nav-next')?.addEventListener('click', () => {
            this._navigateMarker(1);
        });

        popup.querySelector('.toggle-marker-icon')?.addEventListener('click', () => {
            const locationDetails = popup.querySelector('.location-details');
            if (locationDetails) {
                const isVisible = locationDetails.style.display !== 'none';
                locationDetails.style.display = isVisible ? 'none' : 'flex';
            }
        });

        popup.querySelector('.copy-coords')?.addEventListener('click', () => {
            const coords = `${markerData.lngLat.lat.toFixed(6)}, ${markerData.lngLat.lng.toFixed(6)}`;
            navigator.clipboard.writeText(coords);
            const btn = popup.querySelector('.copy-coords');
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = originalText, 1000);
        });

        popup.querySelector('.open-with')?.addEventListener('click', () => {
            this._openExternalMapLinks(markerData.lngLat);
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
                    // Collapse all other features in this popup
                    popup.querySelectorAll('.feature-item-container').forEach(otherContainer => {
                        if (otherContainer !== container) {
                            const otherDetails = otherContainer.querySelector('.feature-item-details');
                            const otherIcon = otherContainer.querySelector('.expand-icon');
                            if (otherDetails.style.display !== 'none') {
                                otherDetails.style.display = 'none';
                                otherIcon.textContent = '▼';
                            }
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
                    icon.textContent = '▲';

                    // Scroll to this feature header
                    const listContainer = popup.querySelector('.features-list-container');
                    if (listContainer) {
                        setTimeout(() => {
                            const headerTop = container.offsetTop;
                            listContainer.scrollTo({
                                top: headerTop - 10,
                                behavior: 'smooth'
                            });
                        }, 50);
                    }

                    // Zoom to feature
                    const feature = markerData.features.find(f => f.layerId === layerId && f.featureId === featureId);
                    if (feature) {
                        this._zoomToFeature(feature.feature);
                    }

                    // Load inspection handler if needed
                    const needsHandler = details.dataset.needsHandler === 'true';
                    const customContainer = details.querySelector('.custom-html-container');

                    if (needsHandler && customContainer && !customContainer.dataset.loaded) {
                        const atlasName = details.dataset.atlas;
                        const handlerName = details.dataset.handler;
                        const layerConfig = this._stateManager.getLayerConfig(layerId);

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
                        this._map.flyTo({
                            center: savedCamera.center,
                            zoom: savedCamera.zoom,
                            bearing: savedCamera.bearing,
                            pitch: savedCamera.pitch,
                            duration: 1000
                        });
                        this._cameraPositions.delete(cameraKey);
                    }

                    this._expandedFeatures.delete(markerId);
                    details.style.display = 'none';
                    icon.textContent = '▼';
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

                if (allProps.style.display === 'none') {
                    allProps.style.display = 'block';
                    if (regularProps) regularProps.style.display = 'none';
                    button.textContent = 'Show less';
                } else {
                    allProps.style.display = 'none';
                    if (regularProps) regularProps.style.display = 'block';
                    const totalCount = allProps.querySelectorAll('[style*="display: flex"]').length;
                    button.textContent = `Show all ${totalCount} properties`;
                }
            });
        });

    }

    _closePopup(markerId) {
        const markerData = this._markers.get(markerId);
        if (markerData?.popup) {
            markerData.popup.remove();
            markerData.popup = null;
        }
    }

    _navigateMarker(direction) {
        const markerArray = Array.from(this._markers.values());
        if (markerArray.length <= 1) return;

        this._currentMarkerIndex = (this._currentMarkerIndex + direction + markerArray.length) % markerArray.length;
        const targetMarker = markerArray[this._currentMarkerIndex];

        markerArray.forEach(m => this._closePopup(m.id));

        this._showMarkerPopup(targetMarker.id);
        this._map.flyTo({
            center: [targetMarker.lngLat.lng, targetMarker.lngLat.lat],
            duration: 500
        });
    }

    _openExternalMapLinks(lngLat) {
        if (window.ButtonExternalMapLinks) {
            const control = new window.ButtonExternalMapLinks();
            control._map = this._map;
            control._showModal();
        } else {
            window.postMessage({
                type: 'open-external-map-links',
                lngLat
            }, '*');
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

        if (markerData.popup) {
            markerData.popup.remove();
        }
        markerData.marker.remove();
        this._markers.delete(markerId);

        if (this._markers.size > 0) {
            this._currentMarkerIndex = Math.min(this._currentMarkerIndex, this._markers.size - 1);
        }
    }

    clearAllMarkers() {
        this._markers.forEach(markerData => {
            if (markerData.popup) {
                markerData.popup.remove();
            }
            markerData.marker.remove();
        });
        this._markers.clear();
        this._currentMarkerIndex = 0;
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

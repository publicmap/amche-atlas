/**
 * MapMarkerManager - Manages selection markers on the map
 * Creates markers at selection locations with popups showing selected features
 */
import { LayerThumbnail } from './layer-thumbnail.js';

export class MapMarkerManager {
    constructor(map, stateManager) {
        this._map = map;
        this._stateManager = stateManager;
        this._markers = new Map();
        this._currentMarkerIndex = 0;
        this._selectionMode = 'replace';

        this._setupEventListeners();
    }

    _setupEventListeners() {
        this._stateManager.addEventListener('state-change', (event) => {
            const { eventType, data } = event.detail;

            if (eventType === 'feature-click' || eventType === 'feature-click-multiple') {
                this._handleSelection(data);
            }

            if (eventType === 'selections-cleared') {
                this.clearAllMarkers();
            }
        });
    }

    _handleSelection(data) {
        const features = data.selectedFeatures || [data];
        const lngLat = features[0]?.lngLat;

        if (!lngLat) return;

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
        el.style.cssText = 'display: flex; flex-direction: column; align-items: center;';

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
                    transition: transform 0.2s, background 0.2s;
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
                    transition: transform 0.2s, background 0.2s;
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
                    propertiesHTML = '<div style="margin-top: 8px; font-size: 10px;">';
                    fields.forEach((fieldName, index) => {
                        const value = properties[fieldName];
                        if (value !== null && value !== undefined && value !== '') {
                            const fieldTitle = fieldTitles[index] || fieldName;
                            propertiesHTML += `
                                <div style="display: flex; padding: 2px 0; border-bottom: 1px solid #1e293b;">
                                    <div style="color: #9ca3af; min-width: 80px; font-weight: 500;">${fieldTitle}</div>
                                    <div style="color: #e5e7eb; flex: 1; word-break: break-word;">${value}</div>
                                </div>
                            `;
                        }
                    });
                    propertiesHTML += '</div>';
                }

                return `
                    <div class="feature-item-container" data-layer-id="${layerId}" data-feature-id="${featureId}" style="
                        background: #334155;
                        border-radius: 4px;
                        margin-bottom: 4px;
                        overflow: hidden;
                    ">
                        <div class="feature-item-header" style="
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            padding: 6px 8px;
                            cursor: pointer;
                            transition: background 0.2s;
                        " onmouseenter="this.style.background='#475569'" onmouseleave="this.style.background='#334155'">
                            ${thumbnailHTML}
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 10px; color: #94a3b8; font-weight: 500; display: flex; align-items: center; gap: 4px;">
                                    ${atlasBadge}
                                    <span>${layerConfig?.title || layerId}</span>
                                </div>
                                <div style="font-size: 13px; color: #e2e8f0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${featureLabel}</div>
                            </div>
                            <div class="expand-icon" style="color: #94a3b8; font-size: 10px;">▼</div>
                        </div>
                        <div class="feature-item-details" style="
                            display: none;
                            padding: 8px;
                            background: #1e293b;
                            border-top: 1px solid #0f172a;
                        ">
                            ${propertiesHTML}
                            <div style="margin-top: 8px;">
                                <button class="open-in-inspector" style="
                                    width: 100%;
                                    padding: 6px;
                                    background: #3b82f6;
                                    border: none;
                                    border-radius: 3px;
                                    color: white;
                                    font-size: 11px;
                                    font-weight: 600;
                                    cursor: pointer;
                                ">Open in Inspector</button>
                            </div>
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
                border-radius: 8px;
                min-width: 300px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">
                <div style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px;
                    border-bottom: 1px solid #334155;
                ">
                    <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                        ${showPrevButton ? `
                            <button class="nav-prev" style="
                                background: #334155;
                                border: none;
                                color: #e2e8f0;
                                padding: 4px 8px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 14px;
                            ">&lt;</button>
                        ` : ''}
                        <button class="toggle-marker-icon" style="
                            background: #3b82f6;
                            border: none;
                            color: white;
                            padding: 4px 8px;
                            border-radius: 50%;
                            cursor: pointer;
                            font-size: 16px;
                            width: 28px;
                            height: 28px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        ">📍</button>
                        <h4 style="margin: 0; font-size: 14px; font-weight: 600;">Selection ${markerNumber}</h4>
                        ${showNextButton ? `
                            <button class="nav-next" style="
                                background: #334155;
                                border: none;
                                color: #e2e8f0;
                                padding: 4px 8px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 14px;
                            ">&gt;</button>
                        ` : ''}
                    </div>
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

                <div style="padding: 12px;">
                    <div class="location-details" style="
                        display: none;
                        align-items: center;
                        gap: 8px;
                        margin-bottom: 12px;
                        padding: 8px;
                        background: #334155;
                        border-radius: 4px;
                        font-size: 12px;
                        color: #94a3b8;
                    ">
                        <span>${lngLat.lat.toFixed(6)}, ${lngLat.lng.toFixed(6)}</span>
                        <button class="copy-coords" style="
                            background: #1e293b;
                            border: none;
                            color: #e2e8f0;
                            padding: 3px 8px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 11px;
                        ">Copy</button>
                        <button class="open-with" style="
                            background: #1e293b;
                            border: none;
                            color: #e2e8f0;
                            padding: 3px 8px;
                            border-radius: 3px;
                            cursor: pointer;
                            font-size: 11px;
                        ">Open with...</button>
                    </div>

                    <div style="margin-bottom: 12px;">
                        <div style="font-size: 12px; color: #94a3b8; margin-bottom: 6px;">
                            Features selected: ${features.length}
                        </div>
                        <div style="max-height: 200px; overflow-y: auto;">
                            ${featuresList}
                        </div>
                    </div>

                    <div style="
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        margin-bottom: 12px;
                        padding: 8px;
                        background: #334155;
                        border-radius: 4px;
                        font-size: 12px;
                    ">
                        <span style="color: #94a3b8;">Selection mode:</span>
                        <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                            <input type="radio" name="selection-mode" value="replace" ${this._selectionMode === 'replace' ? 'checked' : ''}>
                            <span>Replace</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                            <input type="radio" name="selection-mode" value="add" ${this._selectionMode === 'add' ? 'checked' : ''}>
                            <span>Add <code style="background: #1e293b; padding: 2px 4px; border-radius: 2px; font-size: 10px;">Ctrl</code></span>
                        </label>
                    </div>

                    <div style="display: flex; gap: 8px;">
                        <button class="clear-this" style="
                            flex: 1;
                            background: #dc2626;
                            border: none;
                            color: white;
                            padding: 8px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 12px;
                            font-weight: 600;
                        ">Clear This</button>
                        <button class="clear-all" style="
                            flex: 1;
                            background: #b91c1c;
                            border: none;
                            color: white;
                            padding: 8px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 12px;
                            font-weight: 600;
                        ">Clear All</button>
                    </div>
                </div>

                <div style="
                    padding: 8px 12px;
                    border-top: 1px solid #334155;
                    display: flex;
                    justify-content: center;
                ">
                    <button class="close-bottom" style="
                        background: #3b82f6;
                        border: none;
                        color: white;
                        padding: 6px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        font-weight: 600;
                    ">Close</button>
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

        popup.querySelector('.close-bottom')?.addEventListener('click', () => {
            this._closePopup(markerId);
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

        popup.querySelectorAll('input[name="selection-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this._selectionMode = e.target.value;

                // Sync with state manager's Cmd/Ctrl flag
                // When in add mode, act as if Cmd/Ctrl is always pressed
                if (this._selectionMode === 'add') {
                    this._stateManager._isCmdCtrlPressed = true;
                } else {
                    this._stateManager._isCmdCtrlPressed = false;
                }
            });
        });

        // Feature header click to expand/collapse
        popup.querySelectorAll('.feature-item-header').forEach(header => {
            header.addEventListener('click', (e) => {
                const container = header.closest('.feature-item-container');
                const details = container.querySelector('.feature-item-details');
                const icon = header.querySelector('.expand-icon');

                if (details.style.display === 'none') {
                    details.style.display = 'block';
                    icon.textContent = '▲';
                } else {
                    details.style.display = 'none';
                    icon.textContent = '▼';
                }
            });
        });

        // Open in inspector button
        popup.querySelectorAll('.open-in-inspector').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const container = button.closest('.feature-item-container');
                const layerId = container.dataset.layerId;
                const featureId = container.dataset.featureId;
                this._openInspector(layerId, featureId);
            });
        });

        popup.querySelector('.clear-this')?.addEventListener('click', () => {
            // Clear selections for all features in this marker
            markerData.features.forEach(({ layerId, featureId }) => {
                // Clear from state manager
                this._stateManager.clearLayerSelections(layerId);
            });

            // Remove the marker
            this.removeMarker(markerId);
        });

        popup.querySelector('.clear-all')?.addEventListener('click', () => {
            // Clear all selections from state manager
            this._stateManager.clearAllSelections();

            // Clear all markers
            this.clearAllMarkers();
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

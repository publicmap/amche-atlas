export class MapExportControl {
    constructor() {
        this._map = null;
        this._container = null;
        this._exportPanel = null;
        this._selectedSize = 'A4';
        this._orientation = 'landscape';
        this._format = 'kml';
        this._rasterQuality = 'medium'; // 'medium' (JPEG) or 'high' (TIFF)
        this._dpi = 96;
        this._frame = null;
        this._isExporting = false;
        this._title = '';
        this._description = '';
        this._titleCustomized = false; // Track if user has manually edited the title
        this._descriptionCustomized = false; // Track if user has manually edited the description
        this._movendHandler = null; // Store handler for cleanup
        this._resizeHandler = null; // Store resize handler for cleanup
        this._includeLegend = false; // Track legend inclusion checkbox
        this._margin = '1cm'; // CSS-style margin (supports 1, 2, 3, or 4 values)
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';

        const exportBtn = document.createElement('button');
        exportBtn.className = 'mapboxgl-ctrl-icon';
        exportBtn.type = 'button';
        exportBtn.ariaLabel = 'Export Map';
        exportBtn.innerHTML = '<span class="mapboxgl-ctrl-icon" aria-hidden="true" style="background-image: url(\'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22black%22><path d=%22M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z%22/></svg>\'); background-size: 20px 20px; background-repeat: no-repeat; background-position: center;"></span>';
        exportBtn.onclick = () => this._togglePanel();

        this._container.appendChild(exportBtn);

        this._frame = new ExportFrame(map, this);
        this._createExportPanel();

        // Listen to map move events to update title if not customized
        this._movendHandler = () => {
            this._updateTitleOnMove();
        };
        map.on('moveend', this._movendHandler);

        // Listen to window resize to update panel max-height
        this._resizeHandler = () => {
            if (!this._exportPanel.classList.contains('hidden')) {
                this._updatePanelMaxHeight();
            }
        };
        window.addEventListener('resize', this._resizeHandler);

        // Listen to feature selection changes
        this._featureStateChangeHandler = (event) => {
            const isVectorFormat = this._format === 'geojson' || this._format === 'kml';
            const isPanelVisible = !this._exportPanel.classList.contains('hidden');

            if (isVectorFormat && isPanelVisible) {
                this._updateSelectedFeaturesCheckbox();
            }
        };

        this._attachStateManagerListener();

        return this._container;
    }

    _attachStateManagerListener() {
        const tryAttach = () => {
            if (window.stateManager) {
                window.stateManager.addEventListener('state-change', this._featureStateChangeHandler);
                return true;
            }
            return false;
        };

        if (!tryAttach()) {
            let attempts = 0;
            const maxAttempts = 10;
            const retryInterval = setInterval(() => {
                if (tryAttach() || attempts++ >= maxAttempts) {
                    clearInterval(retryInterval);
                }
            }, 500);
        }
    }

    onRemove() {
        // Remove event listeners
        if (this._map && this._movendHandler) {
            this._map.off('moveend', this._movendHandler);
            this._movendHandler = null;
        }
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }
        if (this._featureStateChangeHandler && window.stateManager) {
            window.stateManager.removeEventListener('state-change', this._featureStateChangeHandler);
            this._featureStateChangeHandler = null;
        }
        this._container.parentNode.removeChild(this._container);
        this._map = null;
        if (this._frame) {
            this._frame.remove();
        }
    }

    _createExportPanel() {
        this._exportPanel = document.createElement('div');
        this._exportPanel.className = 'mapboxgl-ctrl-group export-panel hidden';
        this._exportPanel.style.width = '300px';
        this._exportPanel.style.minWidth = '300px';
        this._exportPanel.style.maxWidth = '300px';
        this._exportPanel.style.maxHeight = 'calc(100vh - 150px)';
        this._exportPanel.style.overflowY = 'auto';
        this._exportPanel.style.overflowX = 'hidden';
        this._exportPanel.style.overscrollBehavior = 'contain';

        // Panel Header
        const header = document.createElement('div');
        header.className = 'flex items-center gap-2 mb-3 pb-2 border-b border-gray-300';
        const headerIcon = document.createElement('sl-icon');
        headerIcon.name = 'download';
        headerIcon.style.fontSize = '18px';
        headerIcon.style.color = '#333';
        const headerText = document.createElement('span');
        headerText.className = 'font-bold text-base text-gray-800';
        headerText.textContent = 'Export Map';
        header.appendChild(headerIcon);
        header.appendChild(headerText);
        this._exportPanel.appendChild(header);

        // Format Selection
        this._exportPanel.appendChild(this._createLabel('Format'));
        const formatContainer = document.createElement('div');
        formatContainer.className = 'flex gap-4 mb-2';
        formatContainer.innerHTML = `
            <label class="flex items-center gap-1 cursor-pointer"><input type="radio" name="export-format" value="kml" checked> KML</label>
            <label class="flex items-center gap-1 cursor-pointer"><input type="radio" name="export-format" value="geojson"> GeoJSON</label>
            <label class="flex items-center gap-1 cursor-pointer"><input type="radio" name="export-format" value="pdf"> PDF</label>
        `;
        formatContainer.onchange = (e) => {
            this._format = e.target.value;
            this._updateFormatDescription();
            this._updatePanelVisibility();
        };
        this._exportPanel.appendChild(formatContainer);

        const formatDescription = document.createElement('div');
        formatDescription.className = 'text-xs text-gray-600 mb-3 italic';
        formatDescription.textContent = 'Popular format for Google Earth';
        this._formatDescription = formatDescription;
        this._exportPanel.appendChild(formatDescription);

        // Export Selected Features Checkbox
        this._selectedFeaturesContainer = document.createElement('div');
        this._selectedFeaturesContainer.className = 'mb-3';
        this._selectedFeaturesContainer.style.display = 'none';
        const selectedLabel = document.createElement('label');
        selectedLabel.className = 'flex items-center gap-2 cursor-pointer';
        const selectedCheckbox = document.createElement('input');
        selectedCheckbox.type = 'checkbox';
        selectedCheckbox.checked = true;
        selectedCheckbox.onchange = (e) => {
            this._exportSelectedOnly = e.target.checked;
        };
        const selectedText = document.createElement('span');
        selectedText.textContent = 'Export only selected features';
        selectedLabel.appendChild(selectedCheckbox);
        selectedLabel.appendChild(selectedText);
        this._selectedFeaturesContainer.appendChild(selectedLabel);
        this._selectedFeaturesCheckbox = selectedCheckbox;
        this._selectedFeaturesText = selectedText;
        this._exportPanel.appendChild(this._selectedFeaturesContainer);
        this._exportSelectedOnly = true;

        // Page Settings Collapsible Section
        const pageSettingsDetails = document.createElement('sl-details');
        pageSettingsDetails.className = 'mb-3';
        pageSettingsDetails.summary = 'Show page settings';

        const pageSettingsContent = document.createElement('div');
        pageSettingsContent.className = 'pt-2';
        pageSettingsDetails.appendChild(pageSettingsContent);

        // Size Selector
        this._sizeContainer = document.createElement('div');
        this._sizeContainer.className = 'mb-3';
        this._sizeContainer.appendChild(this._createLabel('Size & DPI'));

        const controlsRow = document.createElement('div');
        controlsRow.className = 'flex gap-1';

        // Size Dropdown
        const sizeSelect = document.createElement('select');
        sizeSelect.className = 'flex-[2] bg-white border border-gray-300 rounded px-1 py-1';
        ['A4', 'A3', 'A2', 'A1', 'A0', 'Custom'].forEach(size => {
            const option = document.createElement('option');
            option.value = size;
            option.text = size;
            sizeSelect.appendChild(option);
        });
        sizeSelect.value = this._selectedSize;
        sizeSelect.onchange = (e) => this._onSizeChange(e.target.value);
        this._sizeSelect = sizeSelect; // Store ref
        controlsRow.appendChild(sizeSelect);

        // DPI Dropdown
        const dpiSelect = document.createElement('select');
        dpiSelect.className = 'flex-1 bg-white border border-gray-300 rounded px-1 py-1';
        [72, 96, 150, 300].forEach(dpi => {
            const option = document.createElement('option');
            option.value = dpi;
            option.text = dpi + ' dpi';
            if (dpi === 96) option.selected = true;
            dpiSelect.appendChild(option);
        });
        dpiSelect.onchange = (e) => { this._dpi = parseInt(e.target.value); };
        controlsRow.appendChild(dpiSelect);

        this._sizeContainer.appendChild(controlsRow);
        pageSettingsContent.appendChild(this._sizeContainer);

        // Dimensions Inputs
        this._dimContainer = document.createElement('div');
        this._dimContainer.className = 'mb-3';
        this._widthInput = this._createInput('Width (mm)');
        this._heightInput = this._createInput('Height (mm)');

        // Add event listeners for direct input change
        this._widthInput.input.onchange = () => this._onDimensionsChange();
        this._heightInput.input.onchange = () => this._onDimensionsChange();

        this._dimContainer.appendChild(this._widthInput.container);
        this._dimContainer.appendChild(this._heightInput.container);
        pageSettingsContent.appendChild(this._dimContainer);

        // Orientation
        this._orientationContainer = document.createElement('div');
        this._orientationContainer.className = 'mb-3';
        this._orientationContainer.innerHTML = `
            <label class="flex items-center gap-1 cursor-pointer mr-4"><input type="radio" name="orientation" value="landscape" checked> Landscape</label>
            <label class="flex items-center gap-1 cursor-pointer"><input type="radio" name="orientation" value="portrait"> Portrait</label>
        `;
        this._orientationContainer.onchange = (e) => this._onOrientationChange(e.target.value);
        pageSettingsContent.appendChild(this._orientationContainer);

        // Raster Quality Selection
        this._qualityContainer = document.createElement('div');
        this._qualityContainer.className = 'mb-3';
        this._qualityContainer.appendChild(this._createLabel('Raster Quality'));
        const qualityOptions = document.createElement('div');
        qualityOptions.className = 'flex gap-4';
        qualityOptions.innerHTML = `
            <label class="flex items-center gap-1 cursor-pointer"><input type="radio" name="raster-quality" value="medium" checked> Medium</label>
            <label class="flex items-center gap-1 cursor-pointer"><input type="radio" name="raster-quality" value="high"> High</label>
        `;
        qualityOptions.onchange = (e) => {
            this._rasterQuality = e.target.value;
        };
        this._qualityContainer.appendChild(qualityOptions);
        pageSettingsContent.appendChild(this._qualityContainer);

        // Margin Input
        this._marginContainer = document.createElement('div');
        this._marginContainer.className = 'mb-3';
        this._marginContainer.appendChild(this._createLabel('Margin'));
        const marginInput = document.createElement('input');
        marginInput.type = 'text';
        marginInput.className = 'w-full bg-white border border-gray-300 rounded px-2 py-1';
        marginInput.placeholder = '1cm or 10mm 20mm or 1in 2cm 3cm 4cm';
        marginInput.value = this._margin;
        marginInput.onchange = (e) => { this._margin = e.target.value; };
        marginInput.oninput = (e) => { this._margin = e.target.value; };
        const marginHint = document.createElement('div');
        marginHint.className = 'text-xs text-gray-500 mt-1';
        marginHint.textContent = 'CSS format: top, right, bottom, left (e.g., "1in" or "10mm 20mm")';
        this._marginContainer.appendChild(marginInput);
        this._marginContainer.appendChild(marginHint);
        pageSettingsContent.appendChild(this._marginContainer);

        // Store reference to page settings details for visibility control
        this._pageSettingsDetails = pageSettingsDetails;
        this._exportPanel.appendChild(pageSettingsDetails);

        // Title Input
        this._titleContainer = document.createElement('div');
        this._titleContainer.className = 'mb-3';
        this._titleContainer.appendChild(this._createLabel('Title'));
        const titleInput = document.createElement('textarea');
        titleInput.rows = 2;
        titleInput.className = 'w-full bg-white border border-gray-300 rounded px-1 py-1 mt-1 box-border resize-y';
        titleInput.placeholder = 'Loading...';
        titleInput.onchange = (e) => {
            this._title = e.target.value;
            // Reset customization flag if user clears the title
            this._titleCustomized = e.target.value.trim().length > 0;
        };
        titleInput.oninput = (e) => {
            this._title = e.target.value;
            // Reset customization flag if user clears the title
            this._titleCustomized = e.target.value.trim().length > 0;
        };
        this._titleInput = titleInput;
        this._titleContainer.appendChild(titleInput);
        this._exportPanel.appendChild(this._titleContainer);

        // Description Textarea
        this._descriptionContainer = document.createElement('div');
        this._descriptionContainer.className = 'mb-3';
        this._descriptionContainer.appendChild(this._createLabel('Description'));
        const descriptionTextarea = document.createElement('textarea');
        descriptionTextarea.className = 'w-full bg-white border border-gray-300 rounded px-1 py-1 mt-1 box-border min-h-[60px] resize-y';
        descriptionTextarea.placeholder = 'Exported at...';
        descriptionTextarea.onchange = (e) => {
            this._description = e.target.value;
            this._descriptionCustomized = e.target.value.trim().length > 0;
        };
        descriptionTextarea.oninput = (e) => {
            this._description = e.target.value;
            this._descriptionCustomized = e.target.value.trim().length > 0;
        };
        this._descriptionInput = descriptionTextarea;
        this._descriptionContainer.appendChild(descriptionTextarea);
        this._exportPanel.appendChild(this._descriptionContainer);

        // Add Legend Checkbox
        this._legendContainer = document.createElement('div');
        this._legendContainer.className = 'mb-3';
        const legendLabel = document.createElement('label');
        legendLabel.className = 'flex items-center gap-2 cursor-pointer';
        const legendCheckbox = document.createElement('input');
        legendCheckbox.type = 'checkbox';
        legendCheckbox.checked = this._includeLegend;
        legendCheckbox.onchange = (e) => {
            this._includeLegend = e.target.checked;
        };
        const legendText = document.createElement('span');
        legendText.textContent = 'Add legend';
        legendLabel.appendChild(legendCheckbox);
        legendLabel.appendChild(legendText);
        this._legendContainer.appendChild(legendLabel);
        this._exportPanel.appendChild(this._legendContainer);

        // Export Button
        const doExportBtn = document.createElement('button');
        doExportBtn.className = 'export-button';
        doExportBtn.style.cssText = 'width: 100%; margin-top: 10px; padding: 10px 16px; background: #000000; color: white; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 14px; font-weight: 500; transition: background-color 0.2s ease;';
        doExportBtn.onmouseenter = () => { doExportBtn.style.background = '#1a1a1a'; };
        doExportBtn.onmouseleave = () => { doExportBtn.style.background = '#000000'; };
        const exportIcon = document.createElement('sl-icon');
        exportIcon.name = 'download';
        exportIcon.style.fontSize = '16px';
        exportIcon.style.color = 'white';
        const exportText = document.createElement('span');
        exportText.textContent = 'Download';
        exportText.style.color = 'white';
        doExportBtn.appendChild(exportIcon);
        doExportBtn.appendChild(exportText);
        doExportBtn.onclick = () => this._doExport();
        this._exportPanel.appendChild(doExportBtn);
        this._exportButton = doExportBtn; // Store reference
        this._exportButtonText = exportText; // Store text reference

        // Explore with geojson.io Button (only for GeoJSON)
        this._geojsonIOContainer = document.createElement('div');
        this._geojsonIOContainer.className = 'mt-2';
        this._geojsonIOContainer.style.display = 'none';

        const geojsonIOBtn = document.createElement('button');
        geojsonIOBtn.className = 'geojson-io-button';
        geojsonIOBtn.style.cssText = 'width: 100%; padding: 8px 16px; background: #ffffff; color: #333333; border: 1px solid #cccccc; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; font-weight: 400; transition: all 0.2s ease;';
        geojsonIOBtn.onmouseenter = () => {
            geojsonIOBtn.style.background = '#f5f5f5';
            geojsonIOBtn.style.borderColor = '#999999';
        };
        geojsonIOBtn.onmouseleave = () => {
            geojsonIOBtn.style.background = '#ffffff';
            geojsonIOBtn.style.borderColor = '#cccccc';
        };

        const geojsonIOIcon = document.createElement('sl-icon');
        geojsonIOIcon.name = 'box-arrow-up-right';
        geojsonIOIcon.style.fontSize = '14px';
        geojsonIOIcon.style.color = '#333333';

        const geojsonIOText = document.createElement('span');
        geojsonIOText.innerHTML = 'Explore with <strong>geojson.io</strong>';
        geojsonIOText.style.color = '#333333';

        geojsonIOBtn.appendChild(geojsonIOIcon);
        geojsonIOBtn.appendChild(geojsonIOText);
        geojsonIOBtn.onclick = () => this._openInGeojsonIO();

        this._geojsonIOContainer.appendChild(geojsonIOBtn);
        this._exportPanel.appendChild(this._geojsonIOContainer);

        this._container.appendChild(this._exportPanel);

        // Initial values
        this._onSizeChange('A4');
        this._updatePanelVisibility();
    }

    _createLabel(text) {
        const label = document.createElement('div');
        label.className = 'font-bold mt-1 mb-1 text-sm text-gray-700';
        label.textContent = text;
        return label;
    }

    _createInput(placeholder) {
        const div = document.createElement('div');
        div.className = 'flex justify-between mb-1';
        const label = document.createElement('span');
        label.className = 'text-xs text-gray-600';
        label.textContent = placeholder;
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'w-[70px] bg-white border border-gray-300 rounded px-1 py-1';
        div.appendChild(label);
        div.appendChild(input);
        return { container: div, input: input };
    }

    _togglePanel() {
        this._exportPanel.classList.toggle('hidden');
        if (!this._exportPanel.classList.contains('hidden')) {
            this._updatePanelMaxHeight();

            const isVectorFormat = this._format === 'geojson' || this._format === 'kml';
            if (isVectorFormat) {
                this._updateSelectedFeaturesCheckbox();
            } else {
                this._frame.show();
                this._updateFrameFromInputs();
                this._loadDefaultTitleAndDescription();
            }
        } else {
            this._frame.hide();
        }
    }

    _updatePanelMaxHeight() {
        if (!this._map || !this._exportPanel) return;

        // Get map container dimensions
        const mapContainer = this._map.getContainer();
        const mapRect = mapContainer.getBoundingClientRect();

        // Get panel position relative to viewport
        const panelRect = this._exportPanel.getBoundingClientRect();

        // Calculate available space from panel top to map bottom
        // Add some padding (20px) to ensure panel doesn't touch bottom
        const availableHeight = mapRect.bottom - panelRect.top - 20;

        // Also ensure it doesn't exceed viewport height minus top padding
        const maxViewportHeight = window.innerHeight - panelRect.top - 20;

        // Use the smaller of the two to prevent overflow
        const maxHeight = Math.min(availableHeight, maxViewportHeight, window.innerHeight - 150);

        // Set minimum height to ensure usability
        const minHeight = 200;

        // Apply max-height (ensure it's at least minHeight)
        this._exportPanel.style.maxHeight = `${Math.max(maxHeight, minHeight)}px`;
    }

    async _loadDefaultTitleAndDescription() {
        // Set default description placeholder if not customized
        if (!this._descriptionCustomized) {
            const date = new Date();
            const timestamp = date.toLocaleString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            this._descriptionInput.placeholder = `Exported at ${timestamp}`;
            this._descriptionInput.value = '';
            this._description = '';
        }

        // Reset title customization flag when loading defaults
        this._titleCustomized = false;

        // Update title from current location
        await this._updateTitleFromLocation();
    }

    /**
     * Update title from current map/frame location
     * Called on map move and when loading defaults
     */
    async _updateTitleFromLocation() {
        try {
            let center;

            // Check if frame is visible and has dimensions - use frame center if available
            if (this._frame && this._frame._el && this._frame._el.classList.contains('active')) {
                const frameRect = this._frame._el.getBoundingClientRect();
                if (frameRect.width > 0 && frameRect.height > 0) {
                    const mapRect = this._map.getContainer().getBoundingClientRect();
                    // Calculate frame center point (not right edge) relative to map container
                    const frameCenterX = (frameRect.left + frameRect.width / 2) - mapRect.left;
                    const frameCenterY = (frameRect.top + frameRect.height / 2) - mapRect.top;
                    // Ensure we're using the center, not an edge
                    center = this._map.unproject([frameCenterX, frameCenterY]);
                }
            }

            // Fallback to map center if frame is not available
            if (!center) {
                center = this._map.getCenter();
            }

            const mapZoom = this._map.getZoom();
            const address = await this._reverseGeocode(center.lat, center.lng, mapZoom);
            if (address) {
                this._title = `Map of ${address}`;
                // Update input if it exists (panel might be closed)
                if (this._titleInput) {
                    this._titleInput.value = this._title;
                    this._titleInput.placeholder = ''; // Clear placeholder
                }
            } else {
                this._title = 'Map';
                // Update input if it exists (panel might be closed)
                if (this._titleInput) {
                    this._titleInput.value = this._title;
                    this._titleInput.placeholder = ''; // Clear placeholder
                }
            }
        } catch (e) {
            console.warn('Failed to update title from reverse geocode', e);
            if (!this._title || this._title.trim() === '') {
                this._title = 'Map';
                if (this._titleInput) {
                    this._titleInput.value = this._title;
                    this._titleInput.placeholder = ''; // Clear placeholder
                }
            }
        }
    }

    /**
     * Update title on map move if title is blank or not customized
     */
    async _updateTitleOnMove() {
        // Don't update title during export process
        if (this._isExporting) {
            return;
        }

        // Only update if title hasn't been customized by the user
        // Update regardless of current title value (blank, "Map", or "Map of ...")
        if (!this._titleCustomized) {
            // Clear placeholder and show loading state
            if (this._titleInput) {
                this._titleInput.placeholder = 'Loading...';
            }
            await this._updateTitleFromLocation();
        }
    }

    async _reverseGeocode(lat, lng, zoom) {
        try {
            // Truncate coordinates to 5 decimal places (~1.1 meter precision)
            const latRounded = Math.round(lat * 100000) / 100000;
            const lngRounded = Math.round(lng * 100000) / 100000;

            // Clamp zoom to valid Nominatim range (0-18) and use it for address detail level
            const nominatimZoom = Math.max(0, Math.min(18, Math.round(zoom || 15)));
            const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latRounded}&lon=${lngRounded}&zoom=${nominatimZoom}&addressdetails=1`;

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'AMChe-Goa-Map-Export/1.0'
                }
            });

            if (!response.ok) {
                throw new Error(`Nominatim API error: ${response.status}`);
            }

            const data = await response.json();

            if (!data.display_name) {
                return null;
            }

            // Update attribution control with raw display_name
            if (window.attributionControl && data.display_name) {
                window.attributionControl.setLocation(data.display_name);
            }

            // Use display_name from Nominatim response
            // Split by comma and trim each part
            const parts = data.display_name.split(',').map(part => part.trim()).filter(part => part.length > 0);

            // Format: last four parts on second line after <br>
            if (parts.length <= 4) {
                return parts.join(', ');
            }

            // Split into first line and last four parts
            const firstLineParts = parts.slice(0, parts.length - 4);
            const lastFourParts = parts.slice(parts.length - 4);

            return firstLineParts.join(', ') + '<br>' + lastFourParts.join(', ');
        } catch (e) {
            console.error('Reverse geocoding failed', e);
            return null;
        }
    }

    _updateFormatDescription() {
        if (!this._formatDescription) return;

        const descriptions = {
            'kml': 'For Google Earth and mapping apps',
            'geojson': 'For web development and GIS software',
            'pdf': 'For printing and sharing as documents'
        };

        this._formatDescription.textContent = descriptions[this._format] || '';
    }

    _updatePanelVisibility() {
        const isVectorFormat = this._format === 'geojson' || this._format === 'kml';

        this._exportPanel.style.maxHeight = 'none';

        if (isVectorFormat) {
            if (this._pageSettingsDetails) {
                this._pageSettingsDetails.style.display = 'none';
            }
            this._titleContainer.style.display = 'none';
            this._descriptionContainer.style.display = 'none';
            this._legendContainer.style.display = 'none';
            this._frame.hide();

            this._updateSelectedFeaturesCheckbox();
        } else {
            if (this._pageSettingsDetails) {
                this._pageSettingsDetails.style.display = 'block';
            }
            this._titleContainer.style.display = 'block';
            this._descriptionContainer.style.display = 'block';
            this._legendContainer.style.display = 'block';
            this._frame.show();
            this._updateFrameFromInputs();

            if (this._selectedFeaturesContainer) {
                this._selectedFeaturesContainer.style.display = 'none';
            }

            if (!this._exportPanel.classList.contains('hidden')) {
                this._loadDefaultTitleAndDescription();
            }
        }

        if (this._geojsonIOContainer) {
            this._geojsonIOContainer.style.display = this._format === 'geojson' ? 'block' : 'none';
        }

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this._updatePanelMaxHeight();
            });
        });
    }

    _updateSelectedFeaturesCheckbox() {
        if (!this._selectedFeaturesContainer) {
            return;
        }

        const selectedFeatures = this._getSelectedFeatures();
        const hasSelectedFeatures = selectedFeatures.length > 0;
        const wasHidden = this._selectedFeaturesContainer.style.display === 'none';

        if (hasSelectedFeatures) {
            this._selectedFeaturesContainer.style.display = 'block';

            if (wasHidden && this._selectedFeaturesCheckbox) {
                this._selectedFeaturesCheckbox.checked = true;
                this._exportSelectedOnly = true;
            }

            if (this._selectedFeaturesText) {
                const count = selectedFeatures.length;
                const plural = count !== 1 ? 's' : '';
                this._selectedFeaturesText.innerHTML = `Export only <b>${count} selected</b> feature${plural}`;
            }
        } else {
            this._selectedFeaturesContainer.style.display = 'none';
            if (this._selectedFeaturesCheckbox) {
                this._selectedFeaturesCheckbox.checked = false;
                this._exportSelectedOnly = false;
            }
        }
    }

    _hasSelectedFeatures() {
        if (!window.stateManager) {
            return false;
        }

        const selectedFeatures = this._getSelectedFeatures();
        return selectedFeatures.length > 0;
    }

    _getSelectedFeatures() {
        if (!window.stateManager) return [];

        const allLayers = window.stateManager.getActiveLayers();
        const selectedFeatures = [];

        allLayers.forEach((layerData, layerId) => {
            const { features } = layerData;
            if (features) {
                features.forEach((featureState, featureId) => {
                    if (featureState.isSelected) {
                        selectedFeatures.push({
                            feature: featureState.feature,
                            layerId: layerId,
                            layerConfig: layerData.config
                        });
                    }
                });
            }
        });

        return selectedFeatures;
    }

    _onSizeChange(size) {
        this._selectedSize = size;
        this._updateDimensions(); // Set W/H inputs based on Standard Size

        // Update Frame to match new dimensions
        this._updateFrameFromInputs();
    }

    _onOrientationChange(orientation) {
        this._orientation = orientation;
        this._updateDimensions();
        this._updateFrameFromInputs();
    }

    _onDimensionsChange() {
        // User manually typed dimensions
        this._sizeSelect.value = 'Custom';
        this._selectedSize = 'Custom';
        this._updateFrameFromInputs();
    }

    _updateDimensions() {
        if (this._selectedSize === 'Custom') return;

        const sizes = {
            'A0': [841, 1189],
            'A1': [594, 841],
            'A2': [420, 594],
            'A3': [297, 420],
            'A4': [210, 297]
        };

        let [width, height] = sizes[this._selectedSize];
        if (this._orientation === 'landscape') {
            [width, height] = [height, width];
        }

        this._widthInput.input.value = width;
        this._heightInput.input.value = height;
    }

    _updateFrameFromInputs() {
        const width = parseFloat(this._widthInput.input.value);
        const height = parseFloat(this._heightInput.input.value);
        if (width && height) {
            this._frame.setAspectRatio(width / height);
        }
    }

    // Called when frame is resized by user
    _onFrameChange(newAspectRatio) {
        // When frame changes, we act as if we are in "Custom" mode, 
        // OR we update the dimensions to match the new shape while trying to preserve scale?
        // User request: "moving the corners... will dynamically change dimensions"
        // Interpretation: We keep the Aspect Ratio of the inputs tied to the Frame.

        this._sizeSelect.value = 'Custom';
        this._selectedSize = 'Custom';

        // Current Input Dimensions
        let w = parseFloat(this._widthInput.input.value);
        let h = parseFloat(this._heightInput.input.value);

        // We need to decide which dimension to keep.
        // Let's keep the largest dimension fixed and scale the other to match ratio?
        // Or just update Height based on Width?
        if (w > h) {
            h = w / newAspectRatio;
        } else {
            w = h * newAspectRatio;
        }

        // Update inputs
        this._widthInput.input.value = Math.round(w);
        this._heightInput.input.value = Math.round(h);
    }

    /**
     * Update export button progress
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} message - Optional status message
     */
    _updateExportProgress(percent, message = null) {
        if (this._exportButtonText) {
            const percentText = `${Math.round(percent)}%`;
            if (message) {
                this._exportButtonText.textContent = `${message} (${percentText})`;
            } else {
                this._exportButtonText.textContent = `Processing ${percentText}`;
            }
        }
    }

    async _doExport() {
        if (this._isExporting) return;
        this._isExporting = true;
        const oldText = this._exportButtonText.textContent;
        this._updateExportProgress(0, 'Starting export');
        this._exportButton.disabled = true;

        try {
            if (this._format === 'geojson') {
                this._exportGeoJSON();
            } else if (this._format === 'kml') {
                this._exportKML();
            } else {
                await this._exportPDF();
            }
        } catch (e) {
            console.error('Export failed', e);
            alert('Export failed: ' + e.message);
        } finally {
            this._isExporting = false;
            this._exportButtonText.textContent = oldText;
            this._exportButton.disabled = false;
        }
    }

    _exportGeoJSON() {
        let features;
        let filename;

        if (this._exportSelectedOnly && this._hasSelectedFeatures()) {
            const selectedFeatures = this._getSelectedFeatures();
            features = selectedFeatures.map(item => item.feature);

            filename = this._generateFilenameFromFeatures(selectedFeatures, 'geojson');
        } else {
            features = this._map.queryRenderedFeatures();
            filename = 'map-export.geojson';
        }

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

        if (isIOS) {
            window.open(url, '_blank');
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 60000);
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }

    _openInGeojsonIO() {
        let features;

        if (this._exportSelectedOnly && this._hasSelectedFeatures()) {
            const selectedFeatures = this._getSelectedFeatures();
            features = selectedFeatures.map(item => item.feature);
        } else {
            features = this._map.queryRenderedFeatures();
        }

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        const geojsonString = JSON.stringify(geojson);
        const encodedData = encodeURIComponent(geojsonString);
        const geojsonIOUrl = `https://geojson.io/#data=data:application/json,${encodedData}`;

        window.open(geojsonIOUrl, '_blank');
    }

    async _exportKML() {
        let features;
        let filename;
        let documentName = 'Exported Data';
        let documentDescription = '';

        if (this._exportSelectedOnly && this._hasSelectedFeatures()) {
            const selectedFeatures = this._getSelectedFeatures();
            features = selectedFeatures.map(item => item.feature);

            filename = this._generateFilenameFromFeatures(selectedFeatures, 'kml');

            if (selectedFeatures.length === 1) {
                const item = selectedFeatures[0];
                const layerConfig = item.layerConfig;
                documentName = this._getFeatureTitle(item.feature, layerConfig);
                documentDescription = layerConfig.inspect?.title || layerConfig.title || 'Exported from Amche Goa';
            } else {
                documentName = `${selectedFeatures.length} Selected Features`;
                documentDescription = 'Exported from Amche Goa';
            }
        } else {
            features = this._map.queryRenderedFeatures();
            filename = 'map-export.kml';
            documentName = 'All Visible Features';
            documentDescription = 'Exported from Amche Goa';
        }

        const { KMLConverter } = await import('./kml-converter.js');

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        const kmlContent = KMLConverter.geoJsonToKml(geojson, {
            name: documentName,
            description: documentDescription
        });

        const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

        if (isIOS) {
            window.open(url, '_blank');
            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 60000);
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }

    _generateFilenameFromFeatures(selectedFeatures, extension) {
        // Group features by layer
        const layerGroups = new Map();

        for (const item of selectedFeatures) {
            const layerId = item.layerId;
            if (!layerGroups.has(layerId)) {
                layerGroups.set(layerId, {
                    layerConfig: item.layerConfig,
                    features: []
                });
            }
            layerGroups.get(layerId).features.push(item.feature);
        }

        // Build filename in format: layer1_feature1_feature2_layer2_feature3_feature4
        const parts = [];

        for (const [layerId, group] of layerGroups) {
            const layerTitle = group.layerConfig.title || layerId;
            const sanitizedLayer = layerTitle
                .replace(/[<>:"/\\|?*]/g, '')
                .replace(/\s+/g, '_');

            parts.push(sanitizedLayer);

            // Add feature titles
            for (const feature of group.features) {
                const featureTitle = this._getFeatureTitle(feature, group.layerConfig);
                const sanitizedFeature = featureTitle
                    .replace(/[<>:"/\\|?*]/g, '')
                    .replace(/\s+/g, '_');
                parts.push(sanitizedFeature);
            }
        }

        const filename = parts.join('_').substring(0, 200);
        return `${filename}.${extension}`;
    }

    _getFeatureTitle(feature, layerConfig) {
        const labelField = layerConfig.inspect?.label;
        if (labelField && feature.properties[labelField]) {
            return String(feature.properties[labelField]);
        }

        if (feature.properties.name) {
            return String(feature.properties.name);
        }

        const firstPriorityField = layerConfig.inspect?.fields?.[0];
        if (firstPriorityField && feature.properties[firstPriorityField]) {
            return String(feature.properties[firstPriorityField]);
        }

        return 'Exported Feature';
    }

    _parseMargin(marginStr) {
        const parts = marginStr.trim().split(/\s+/);
        const values = parts.map(part => {
            const match = part.match(/^([\d.]+)(in|mm|cm|pt|px)?$/);
            if (!match) return 0;

            const value = parseFloat(match[1]);
            const unit = match[2] || 'mm';

            switch (unit) {
                case 'in': return value * 25.4;
                case 'cm': return value * 10;
                case 'pt': return value * 0.3527778;
                case 'px': return value * 0.2645833;
                case 'mm':
                default: return value;
            }
        });

        if (values.length === 1) {
            return { top: values[0], right: values[0], bottom: values[0], left: values[0] };
        } else if (values.length === 2) {
            return { top: values[0], right: values[1], bottom: values[0], left: values[1] };
        } else if (values.length === 3) {
            return { top: values[0], right: values[1], bottom: values[2], left: values[1] };
        } else if (values.length >= 4) {
            return { top: values[0], right: values[1], bottom: values[2], left: values[3] };
        }

        return { top: 10, right: 10, bottom: 10, left: 10 };
    }

    async _exportPDF() {
        const { jsPDF } = await import('jspdf');

        const widthMm = parseFloat(this._widthInput.input.value);
        const heightMm = parseFloat(this._heightInput.input.value);
        const dpi = this._dpi;

        const margins = this._parseMargin(this._margin);

        // Get Data for Footer (needed for footer height calculation)
        // URL
        let shareUrl = window.location.href;
        if (window.urlManager) {
            shareUrl = window.urlManager.getShareableURL();
        }

        // Attribution
        let attributionText = '';
        const attribCtrl = this._map._controls.find(c => c._container && c._container.classList.contains('mapboxgl-ctrl-attrib'));
        if (attribCtrl) {
            attributionText = attribCtrl._container.textContent;
        }

        // Calculate content area (page size minus margins)
        const contentWidthMm = widthMm - margins.left - margins.right;
        const contentHeightMm = heightMm - margins.top - margins.bottom;
        const targetWidth = Math.round((contentWidthMm * dpi) / 25.4);
        const targetHeight = Math.round((contentHeightMm * dpi) / 25.4);

        // Capture Frame State for manual calculation (before hiding/resizing)
        const frameRect = this._frame._el.getBoundingClientRect();
        const mapRect = this._map.getContainer().getBoundingClientRect();

        // Calculate desired center (geographic) based on frame center point
        // Use the exact center of the frame, not an edge
        const frameCenterX = (frameRect.left + frameRect.width / 2) - mapRect.left;
        const frameCenterY = (frameRect.top + frameRect.height / 2) - mapRect.top;
        const targetCenter = this._map.unproject([frameCenterX, frameCenterY]);

        // Save current map state
        const originalStyle = this._map.getContainer().style.cssText;
        const originalCenter = this._map.getCenter();
        const originalZoom = this._map.getZoom();
        const originalBearing = this._map.getBearing();
        const originalPitch = this._map.getPitch();
        const originalPixelRatio = window.devicePixelRatio;

        // 1. Hide Controls & Frame
        this._frame.hide();

        // 2. Resize Map Container
        const container = this._map.getContainer();

        // Generate QR
        this._updateExportProgress(10, 'Generating QR code');
        let qrDataUrl = null;
        try {
            qrDataUrl = await this._getQRCodeDataUrl(shareUrl);
            this._updateExportProgress(20, 'QR code generated');
        } catch (e) {
            console.warn('Failed to generate QR for PDF', e);
            this._updateExportProgress(20, 'Skipping QR code');
        }

        // Capture Overlay (Feature Control Layers)
        this._updateExportProgress(25, 'Preparing legend');
        let overlayDataUrl = null;
        let overlayWidthMm = 0;
        let overlayHeightMm = 0;

        // Only capture overlay if legend checkbox is checked
        if (this._includeLegend) {
            // Find the feature panel layers container - check both class names
            const featurePanelLayers = document.querySelector('.feature-control-layers.map-feature-panel-layers') ||
                document.querySelector('.map-feature-panel-layers');

            // Check if element exists and has content (children or text)
            const hasContent = featurePanelLayers && (
                featurePanelLayers.children.length > 0 ||
                featurePanelLayers.textContent.trim().length > 0
            );

            if (hasContent) {
                // Check if parent panel is hidden - track state for cleanup
                const parentPanel = featurePanelLayers.closest('.map-feature-panel');
                const wasHidden = parentPanel && parentPanel.style.display === 'none';
                const originalDisplay = wasHidden ? 'none' : null;

                try {
                    // Dynamically import html2canvas
                    const html2canvas = (await import('html2canvas')).default;

                    // Temporarily show the panel if it was hidden, so html2canvas can capture it
                    if (wasHidden && parentPanel) {
                        parentPanel.style.display = 'flex';
                        // Force a reflow to ensure rendering
                        parentPanel.offsetHeight;
                    }

                    // Clone the element to capture it independently
                    // This ensures we capture the content even if the original is in a scrolling container
                    const clone = featurePanelLayers.cloneNode(true);

                    // Expand all collapsed sl-details elements in the clone
                    const allDetails = clone.querySelectorAll('sl-details');
                    allDetails.forEach(detail => {
                        detail.open = true;
                        // Also ensure content containers are visible
                        const contentContainer = detail.querySelector('.layer-content');
                        if (contentContainer) {
                            contentContainer.style.display = 'block';
                        }
                    });

                    // Show all tab panels (not just active) so legends are visible
                    const allTabPanels = clone.querySelectorAll('sl-tab-panel');
                    allTabPanels.forEach(panel => {
                        // Remove hidden attribute and ensure display
                        panel.removeAttribute('hidden');
                        panel.style.display = 'block';
                        panel.style.visibility = 'visible';
                    });

                    // Also ensure tab groups show all content
                    const tabGroups = clone.querySelectorAll('sl-tab-group');
                    tabGroups.forEach(tabGroup => {
                        // Show all panels in the tab group
                        const panels = tabGroup.querySelectorAll('sl-tab-panel');
                        panels.forEach(panel => {
                            panel.removeAttribute('hidden');
                            panel.style.display = 'block';
                            panel.style.visibility = 'visible';
                        });
                    });

                    // Get computed styles for proper rendering
                    const computedStyle = window.getComputedStyle(featurePanelLayers);

                    // Use a reasonable fixed width - match the panel width or use 300px
                    const targetWidth = parentPanel && parentPanel.offsetWidth > 0
                        ? Math.min(parentPanel.offsetWidth, 350)
                        : 300;

                    // Set up clone styling - position off-screen but visible for measurement
                    clone.style.position = 'absolute';
                    clone.style.left = '0px'; // Position at 0,0 for easier measurement
                    clone.style.top = '0px';
                    clone.style.width = `${targetWidth}px`;
                    clone.style.maxWidth = 'none';
                    clone.style.maxHeight = 'none';
                    clone.style.overflow = 'visible';
                    clone.style.backgroundColor = '#ffffff';
                    clone.style.padding = computedStyle.padding;
                    clone.style.margin = '0';
                    clone.style.boxSizing = 'border-box';
                    clone.style.zIndex = '99999'; // Ensure it's on top for measurement

                    // Copy computed styles to ensure proper rendering
                    clone.style.fontFamily = computedStyle.fontFamily;
                    clone.style.fontSize = computedStyle.fontSize;
                    clone.style.color = computedStyle.color;
                    clone.style.lineHeight = computedStyle.lineHeight;

                    document.body.appendChild(clone);

                    // Wait for rendering and layout - give time for images to load
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    await new Promise(resolve => setTimeout(resolve, 200)); // Extra time for images/legends to load

                    // Now measure the actual content height using getBoundingClientRect
                    const cloneRect = clone.getBoundingClientRect();

                    // Find the last element with actual content
                    const allElements = Array.from(clone.querySelectorAll('*'));
                    let maxBottom = 0;

                    for (const el of allElements) {
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden') {
                            continue;
                        }

                        const rect = el.getBoundingClientRect();
                        const relativeBottom = rect.bottom - cloneRect.top;

                        // Check if element has meaningful content
                        const hasText = el.textContent && el.textContent.trim().length > 0;
                        const hasImage = el.querySelector && (el.querySelector('img') || el.querySelector('svg'));
                        const hasVisibleContent = rect.height > 0 && (hasText || hasImage || el.children.length > 0);

                        if (hasVisibleContent && relativeBottom > maxBottom) {
                            maxBottom = relativeBottom;
                        }
                    }

                    // Use scrollHeight as fallback, but prefer measured content height
                    const contentHeight = Math.max(maxBottom, clone.scrollHeight);

                    // Add small padding but trim excessive empty space
                    // If contentHeight is much less than scrollHeight, use contentHeight
                    const finalHeight = contentHeight < clone.scrollHeight * 0.8
                        ? contentHeight + 10
                        : clone.scrollHeight;

                    // Move clone off-screen for capture
                    clone.style.left = '-9999px';

                    const canvas = await html2canvas(clone, {
                        backgroundColor: '#ffffff', // Force white background for visibility on PDF
                        scale: 2, // Better quality
                        logging: false,
                        useCORS: true,
                        width: targetWidth,
                        height: finalHeight,
                        windowWidth: targetWidth,
                        windowHeight: finalHeight
                    });

                    // Clean up clone
                    document.body.removeChild(clone);

                    overlayDataUrl = canvas.toDataURL('image/png');

                    // Calculate dimensions for PDF (maintain aspect ratio)
                    // Pixel width / dpi * 25.4 does not apply directly because html2canvas scale depends on device pixel ratio usually, 
                    // but we forced scale: 2.
                    // Let's map pixels to mm roughly based on typical screen viewing (96dpi).
                    // Screen pixels to mm: pixels * 0.2645833333
                    // We scaled by 2, so real logic pixels = canvas.width / 2

                    const logicWidth = canvas.width / 2;
                    const logicHeight = canvas.height / 2;

                    // Convert logic pixels to mm (assuming ~96dpi assumption for PDF mapping visually)
                    overlayWidthMm = logicWidth * 0.26458;
                    overlayHeightMm = logicHeight * 0.26458;

                    this._updateExportProgress(40, 'Legend captured');

                } catch (e) {
                    console.warn('Failed to capture overlay', e);
                    this._updateExportProgress(40, 'Legend capture failed');
                } finally {
                    // Restore original panel visibility if it was hidden
                    if (wasHidden && parentPanel) {
                        parentPanel.style.display = originalDisplay;
                    }
                }
            } else {
                this._updateExportProgress(40, 'No legend to capture');
            }
        } else {
            this._updateExportProgress(40, 'Skipping legend');
        }

        return new Promise((resolve, reject) => {

            // Function to capture after resize and move
            const capture = async () => {
                try {
                    this._updateExportProgress(50, 'Capturing map');
                    const canvas = this._map.getCanvas();
                    const imgData = canvas.toDataURL('image/png');

                    const doc = new jsPDF({
                        orientation: widthMm > heightMm ? 'l' : 'p',
                        unit: 'mm',
                        format: [widthMm, heightMm]
                    });

                    // Draw Map (with margins)
                    this._updateExportProgress(60, 'Adding map to PDF');
                    if (this._rasterQuality === 'high') {
                        // High Quality = TIFF
                        try {
                            const tiffData = this._canvasToTIFF(canvas);
                            doc.addImage(tiffData, 'TIFF', margins.left, margins.top, contentWidthMm, contentHeightMm);
                        } catch (err) {
                            console.error('TIFF Generation failed, falling back to PNG', err);
                            doc.addImage(imgData, 'PNG', margins.left, margins.top, contentWidthMm, contentHeightMm);
                        }
                    } else {
                        // Medium Quality = JPEG 90
                        const jpegData = canvas.toDataURL('image/jpeg', 0.90);
                        doc.addImage(jpegData, 'JPEG', margins.left, margins.top, contentWidthMm, contentHeightMm);
                    }

                    // Note: Legend overlay removed from page 1 - will be on page 2

                    // Generate footer using HTML template for consistent layout
                    this._updateExportProgress(70, 'Generating footer');
                    const footerResult = await this._generateFooterHTML(
                        contentWidthMm,
                        contentHeightMm,
                        qrDataUrl,
                        shareUrl,
                        attributionText,
                        targetCenter,
                        newZoom,
                        originalBearing,
                        originalPitch,
                        dpi
                    );

                    if (footerResult && footerResult.dataUrl) {
                        // Use the actual footer height from template (in mm)
                        const footerHeightMm = footerResult.heightMm || 30; // Fallback to 30mm if not provided
                        const footerY = heightMm - margins.bottom - footerHeightMm;

                        // Add footer image to PDF (within margins)
                        doc.addImage(footerResult.dataUrl, 'PNG', margins.left, footerY, contentWidthMm, footerHeightMm);
                    } else if (footerResult && typeof footerResult === 'string') {
                        // Backward compatibility: if just a data URL string is returned
                        const footerHeightMm = 30; // Approximate footer height
                        const footerY = heightMm - margins.bottom - footerHeightMm;
                        doc.addImage(footerResult, 'PNG', margins.left, footerY, contentWidthMm, footerHeightMm);
                    } else {
                        // Fallback to old method if HTML generation fails
                        console.warn('HTML footer generation failed, using fallback method');
                        this._drawFooterFallback(doc, contentWidthMm, contentHeightMm, qrDataUrl, shareUrl, attributionText, targetCenter, newZoom, originalBearing, dpi, margins);
                    }

                    // Add Page 2: Legend (if legend checkbox is checked)
                    this._updateExportProgress(85, 'Adding legend pages');
                    if (this._includeLegend && overlayDataUrl) {
                        await this._addLegendPage(doc, widthMm, heightMm, overlayDataUrl, overlayWidthMm, overlayHeightMm, dpi);
                    }

                    // Generate filename from title, sanitizing invalid characters
                    this._updateExportProgress(95, 'Finalizing PDF');
                    let filename = 'map-export.pdf';
                    if (this._title && this._title.trim()) {
                        // Remove HTML tags and convert <br> to ', '
                        const titleText = this._title.replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]*>/g, '');
                        // Sanitize filename: remove invalid characters and limit length
                        // Keep spaces, don't replace with hyphens
                        const sanitized = titleText
                            .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
                            .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
                            .trim() // Remove leading/trailing whitespace
                            .substring(0, 200); // Limit length

                        if (sanitized && sanitized.length > 0) {
                            filename = `${sanitized}.pdf`;
                        }
                    }
                    this._updateExportProgress(100, 'Downloading PDF');
                    doc.save(filename);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };

            // Set new size - MATCHING MAP AREA ONLY
            this._updateExportProgress(45, 'Resizing map');
            Object.assign(container.style, {
                width: targetWidth + 'px',
                height: targetHeight + 'px',
                position: 'fixed',
                top: '0',
                left: '0',
                zIndex: '-9999'
            });

            this._map.resize();

            // Calculate new zoom level to scale frame content to target width
            const scaleFactor = targetWidth / frameRect.width;
            const newZoom = originalZoom + Math.log2(scaleFactor);

            // Apply view explicitly
            this._map.jumpTo({
                center: targetCenter,
                zoom: newZoom,
                bearing: originalBearing,
                pitch: originalPitch,
                animate: false
            });

            this._map.once('idle', () => {
                capture();

                // Restore
                container.style.cssText = originalStyle;
                this._map.resize();
                // Restore View 
                this._map.jumpTo({
                    center: originalCenter,
                    zoom: originalZoom,
                    bearing: originalBearing,
                    pitch: originalPitch
                });

                // Show Frame
                // Show Frame
                this._frame.show();
            });
        });
    }
    async _getQRCodeDataUrl(text) {
        return new Promise(async (resolve, reject) => {
            console.log('Generating QR for:', text);

            try {
                // Ensure component is defined
                await customElements.whenDefined('sl-qr-code');

                const qr = document.createElement('sl-qr-code');
                qr.value = text;
                qr.size = 1024; // High resolution for print
                qr.style.position = 'fixed';
                qr.style.top = '-9999px';
                qr.style.left = '-9999px'; // Ensure it's off-screen
                document.body.appendChild(qr);

                // Wait for the component to render its initial state
                if (qr.updateComplete) {
                    await qr.updateComplete;
                }

                // Additional small polling to ensure internal elements (Shadow DOM) are ready
                let attempts = 0;
                const maxAttempts = 50; // 5 seconds

                const checkRender = () => {
                    const shadow = qr.shadowRoot;
                    if (shadow) {
                        const svg = shadow.querySelector('svg');
                        const canvas = shadow.querySelector('canvas');

                        if (svg || canvas) {
                            // Let it breathe a frame to ensure painting
                            requestAnimationFrame(() => {
                                try {
                                    // ADD PADDING
                                    const padding = 40; // Proportional padding for high res
                                    const qrSize = 1024;
                                    const totalSize = qrSize + (padding * 2);

                                    const outCanvas = document.createElement('canvas');
                                    outCanvas.width = totalSize;
                                    outCanvas.height = totalSize;
                                    const ctx = outCanvas.getContext('2d');

                                    // White background for the whole square (including padding)
                                    ctx.fillStyle = 'white';
                                    ctx.fillRect(0, 0, totalSize, totalSize);

                                    if (svg) {
                                        const svgData = new XMLSerializer().serializeToString(svg);
                                        const img = new Image();
                                        img.onload = () => {
                                            // Draw centered
                                            ctx.drawImage(img, padding, padding, qrSize, qrSize);
                                            const dataUrl = outCanvas.toDataURL('image/png');
                                            document.body.removeChild(qr);
                                            resolve(dataUrl);
                                        };
                                        img.onerror = (e) => {
                                            console.error('QR IDL Load Error', e);
                                            document.body.removeChild(qr);
                                            reject(e);
                                        };
                                        // Use base64 to avoid parsing issues
                                        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                                    } else if (canvas) {
                                        ctx.drawImage(canvas, padding, padding, qrSize, qrSize);
                                        const dataUrl = outCanvas.toDataURL('image/png');
                                        document.body.removeChild(qr);
                                        resolve(dataUrl);
                                    }
                                } catch (err) {
                                    console.error('QR Serialization Error', err);
                                    document.body.removeChild(qr);
                                    reject(err);
                                }
                            });
                            return;
                        }
                    }

                    if (attempts++ < maxAttempts) {
                        setTimeout(checkRender, 100);
                    } else {
                        document.body.removeChild(qr);
                        reject(new Error('QR Code render timed out (no SVG/Canvas found)'));
                    }
                };

                // Trigger polling
                checkRender();

            } catch (e) {
                console.error('QR Setup Error:', e);
                reject(e);
            }
        });
    }

    /**
     * Calculate map scale for a given zoom level and latitude
     * @param {number} zoom - Map zoom level
     * @param {number} lat - Latitude in degrees
     * @param {number} dpi - DPI of the output
     * @returns {Object} Scale information with distance and unit
     */
    _calculateMapScale(zoom, lat, dpi) {
        // Earth's radius in meters
        const earthRadius = 6378137;
        // Standard tile size
        const tileSize = 256;

        // Calculate meters per pixel at this zoom level and latitude
        const metersPerPixel = (2 * Math.PI * earthRadius * Math.cos(lat * Math.PI / 180)) / (tileSize * Math.pow(2, zoom));

        // Convert to meters per mm at the given DPI
        const mmPerInch = 25.4;
        const pixelsPerMm = dpi / mmPerInch;
        const metersPerMm = metersPerPixel * pixelsPerMm;

        // Choose an appropriate scale bar length (aim for ~30-40mm width)
        const scaleBarWidthMm = 30;
        const distanceMeters = metersPerMm * scaleBarWidthMm;

        // Round to a nice number
        let roundedDistance;
        let unit;

        if (distanceMeters >= 1000) {
            // Use kilometers
            const km = distanceMeters / 1000;
            const magnitude = Math.pow(10, Math.floor(Math.log10(km)));
            roundedDistance = Math.round(km / magnitude) * magnitude;
            unit = 'km';
        } else {
            // Use meters
            const magnitude = Math.pow(10, Math.floor(Math.log10(distanceMeters)));
            roundedDistance = Math.round(distanceMeters / magnitude) * magnitude;
            unit = roundedDistance >= 1000 ? 'km' : 'm';
            if (unit === 'km') {
                roundedDistance = roundedDistance / 1000;
            }
        }

        // Recalculate actual width based on rounded distance
        const actualWidthMm = (roundedDistance * (unit === 'km' ? 1000 : 1)) / metersPerMm;

        return {
            distance: roundedDistance,
            unit: unit,
            widthMm: actualWidthMm,
            metersPerMm: metersPerMm
        };
    }

    /**
     * Draw a north arrow on the PDF using canvas for proper rotation
     * @param {jsPDF} doc - jsPDF document instance
     * @param {number} x - X position in mm (center of arrow)
     * @param {number} y - Y position in mm (center of arrow)
     * @param {number} size - Size of arrow in mm
     * @param {number} bearing - Map bearing in degrees (0 = north up)
     */
    _drawNorthArrow(doc, x, y, size, bearing) {
        // Create a canvas to draw the arrow with rotation
        const canvasSize = 100; // Canvas size in pixels (high resolution)
        const canvas = document.createElement('canvas');
        canvas.width = canvasSize;
        canvas.height = canvasSize;
        const ctx = canvas.getContext('2d');

        // Clear canvas with transparent background
        ctx.clearRect(0, 0, canvasSize, canvasSize);

        // Move to center of canvas
        ctx.save();
        ctx.translate(canvasSize / 2, canvasSize / 2);

        // Rotate based on bearing (negative because canvas Y increases downward)
        ctx.rotate(-bearing * Math.PI / 180);

        // Draw arrow stem (vertical line)
        const stemLength = size * 0.6 * (canvasSize / size) * 0.5; // Scale to canvas
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -stemLength / 2);
        ctx.lineTo(0, stemLength / 2);
        ctx.stroke();

        // Draw arrow head (triangle pointing up)
        const arrowHeadSize = size * 0.3 * (canvasSize / size) * 0.5;
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.moveTo(0, -stemLength / 2); // Top point
        ctx.lineTo(-arrowHeadSize / 2, -stemLength / 2 + arrowHeadSize); // Bottom left
        ctx.lineTo(arrowHeadSize / 2, -stemLength / 2 + arrowHeadSize); // Bottom right
        ctx.closePath();
        ctx.fill();

        // Draw "N" label below arrow
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('N', 0, stemLength / 2 + 4);

        ctx.restore();

        // Convert canvas to image and add to PDF
        const arrowDataUrl = canvas.toDataURL('image/png');
        const arrowSizeMm = size;
        // Position arrow so center is at (x, y)
        doc.addImage(arrowDataUrl, 'PNG', x - arrowSizeMm / 2, y - arrowSizeMm / 2, arrowSizeMm, arrowSizeMm);
    }

    /**
     * Add legend page (page 2+) to PDF - supports multiple pages
     * @param {jsPDF} doc - jsPDF document instance
     * @param {number} widthMm - PDF width in mm
     * @param {number} heightMm - PDF height in mm
     * @param {string} overlayDataUrl - Legend overlay data URL
     * @param {number} overlayWidthMm - Overlay width in mm
     * @param {number} overlayHeightMm - Overlay height in mm
     * @param {number} dpi - DPI
     */
    async _addLegendPage(doc, widthMm, heightMm, overlayDataUrl, overlayWidthMm, overlayHeightMm, dpi) {
        try {
            // Generate all legend pages (supports pagination)
            const legendPages = await this._generateLegendPagesHTML(
                widthMm,
                heightMm,
                overlayDataUrl,
                overlayWidthMm,
                overlayHeightMm,
                dpi
            );

            if (legendPages && legendPages.length > 0) {
                // Add each page to the PDF
                for (const page of legendPages) {
                    doc.addPage();
                    if (page.dataUrl) {
                        // Detect image format from data URL (JPEG or PNG)
                        const imageFormat = page.dataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
                        doc.addImage(page.dataUrl, imageFormat, 0, 0, widthMm, heightMm);

                        // Add clickable links if present
                        if (page.links && page.links.length > 0) {
                            // Convert pixel coordinates to mm
                            // Links are in scaled pixels, and the image is added at widthMm x heightMm
                            // We need to know the actual canvas dimensions used for this page
                            const scale = 1.2;
                            const mmToPx = 96 / 25.4; // Screen DPI conversion
                            // For split pages, each page canvas is pageWidthPx x pageHeightPx
                            // For single page, it's the full canvas dimensions
                            const pageWidthPx = widthMm * mmToPx * scale;
                            const pageHeightPx = heightMm * mmToPx * scale;

                            page.links.forEach(link => {
                                try {
                                    // Convert pixel coordinates to mm
                                    // Link positions are already in scaled pixels relative to the page
                                    const linkXmm = link.x / (mmToPx * scale);
                                    const linkYmm = link.y / (mmToPx * scale);
                                    const linkWidthMm = link.width / (mmToPx * scale);
                                    const linkHeightMm = link.height / (mmToPx * scale);

                                    // Add clickable link to PDF
                                    // jsPDF link method: link(x, y, width, height, url)
                                    doc.link(linkXmm, linkYmm, linkWidthMm, linkHeightMm, { url: link.href });
                                } catch (e) {
                                    console.warn('Failed to add link to PDF', e, link);
                                }
                            });
                        }
                    }
                }
            } else {
                // Fallback: draw simple legend page
                doc.addPage();
                this._drawLegendPageFallback(doc, widthMm, heightMm, overlayDataUrl, overlayWidthMm, overlayHeightMm);
            }
        } catch (e) {
            console.error('Failed to add legend page', e);
            // Fallback: draw simple legend page
            doc.addPage();
            this._drawLegendPageFallback(doc, widthMm, heightMm, overlayDataUrl, overlayWidthMm, overlayHeightMm);
        }
    }

    /**
     * Generate multiple legend pages with 2-column layout and pagination
     * @param {number} widthMm - PDF width in mm
     * @param {number} heightMm - PDF height in mm
     * @param {string} overlayDataUrl - Legend overlay data URL
     * @param {number} overlayWidthMm - Overlay width in mm
     * @param {number} overlayHeightMm - Overlay height in mm
     * @param {number} dpi - DPI
     * @returns {Promise<Array>} Array of page objects with dataUrl and dimensions
     */
    async _generateLegendPagesHTML(widthMm, heightMm, overlayDataUrl, overlayWidthMm, overlayHeightMm, dpi) {
        const pages = [];

        try {
            // Get layer information
            const layerInfo = this._getLayerInformation();

            // Calculate available space for content (accounting for padding and header)
            const padding = 10; // mm
            const headerHeight = 40; // mm (header + title + description)
            const availableHeight = heightMm - (padding * 2) - headerHeight;
            const availableWidth = widthMm - (padding * 2);

            // Column dimensions (2 columns with gap)
            const columnGap = 4; // mm
            const columnWidth = (availableWidth - columnGap) / 2;

            // Skip thumbnail generation for now - it causes the export to hang
            // TODO: Make thumbnail generation optional with a separate checkbox
            const thumbnailMap = new Map();

            // Update progress to show we're moving forward
            this._updateExportProgress(87, 'Building legend content');

            // Create a helper function to create a single layer element
            const createLayerElement = (layer, isFirstPage = false, pageIndex = 0) => {
                const layerDiv = document.createElement('div');
                layerDiv.style.marginBottom = '6mm';
                layerDiv.style.paddingBottom = '6mm';
                layerDiv.style.borderBottom = '1px solid #e0e0e0';
                layerDiv.style.pageBreakInside = 'avoid';
                layerDiv.style.breakInside = 'avoid';

                // Layer title
                if (layer.title) {
                    const layerTitle = document.createElement('div');
                    layerTitle.textContent = layer.title;
                    layerTitle.style.fontSize = '12pt';
                    layerTitle.style.fontWeight = 'bold';
                    layerTitle.style.color = '#000000';
                    layerTitle.style.marginBottom = '3mm';
                    layerDiv.appendChild(layerTitle);
                }

                // Layer thumbnail (if available)
                if (layer.layerId && thumbnailMap.has(layer.layerId)) {
                    const thumbnailSection = document.createElement('div');
                    thumbnailSection.style.marginBottom = '3mm';

                    const thumbnailTitle = document.createElement('div');
                    thumbnailTitle.textContent = 'Preview';
                    thumbnailTitle.style.fontSize = '10pt';
                    thumbnailTitle.style.fontWeight = 'bold';
                    thumbnailTitle.style.color = '#000000';
                    thumbnailTitle.style.marginBottom = '1.5mm';
                    thumbnailSection.appendChild(thumbnailTitle);

                    const thumbnailImg = document.createElement('img');
                    thumbnailImg.src = thumbnailMap.get(layer.layerId);
                    thumbnailImg.style.maxWidth = `${columnWidth}mm`;
                    thumbnailImg.style.width = 'auto';
                    thumbnailImg.style.height = 'auto';
                    thumbnailImg.style.display = 'block';
                    thumbnailImg.style.marginBottom = '1.5mm';
                    thumbnailImg.style.objectFit = 'contain';
                    thumbnailImg.style.border = '1px solid #e0e0e0';
                    thumbnailImg.style.borderRadius = '2px';
                    thumbnailImg.loading = 'eager';
                    thumbnailImg.decoding = 'async';
                    thumbnailSection.appendChild(thumbnailImg);

                    layerDiv.appendChild(thumbnailSection);
                }

                // Info section (Description and Attribution)
                if (layer.info && (layer.info.description || layer.info.attribution)) {
                    const infoSection = document.createElement('div');
                    infoSection.style.marginBottom = '3mm';

                    // Description
                    if (layer.info.description) {
                        const descDiv = document.createElement('div');
                        if (typeof layer.info.description === 'object' && layer.info.description.html) {
                            descDiv.innerHTML = layer.info.description.html;
                            // Style links in description
                            const links = descDiv.querySelectorAll('a');
                            links.forEach(link => {
                                link.style.color = '#0066cc';
                                link.style.textDecoration = 'underline';
                                link.style.cursor = 'pointer';
                            });
                        } else {
                            descDiv.textContent = typeof layer.info.description === 'string' ? layer.info.description : '';
                        }
                        descDiv.style.fontSize = '9pt';
                        descDiv.style.color = '#333333';
                        descDiv.style.marginBottom = '1.5mm';
                        descDiv.style.lineHeight = '1.4';
                        descDiv.style.whiteSpace = 'pre-wrap';
                        infoSection.appendChild(descDiv);
                    }

                    // Attribution
                    if (layer.info.attribution) {
                        const attrDiv = document.createElement('div');
                        if (typeof layer.info.attribution === 'object' && layer.info.attribution.html) {
                            attrDiv.innerHTML = `Source: ${layer.info.attribution.html}`;
                            // Style links in attribution
                            const links = attrDiv.querySelectorAll('a');
                            links.forEach(link => {
                                link.style.color = '#0066cc';
                                link.style.textDecoration = 'underline';
                                link.style.cursor = 'pointer';
                            });
                        } else {
                            attrDiv.textContent = `Source: ${typeof layer.info.attribution === 'string' ? layer.info.attribution : ''}`;
                        }
                        attrDiv.style.fontSize = '8pt';
                        attrDiv.style.color = '#666666';
                        attrDiv.style.fontStyle = 'italic';
                        attrDiv.style.marginTop = '1.5mm';
                        infoSection.appendChild(attrDiv);
                    }

                    layerDiv.appendChild(infoSection);
                }

                // Legend section
                if (layer.legend && (layer.legend.legendImage || layer.legend.legend)) {
                    const legendSection = document.createElement('div');
                    legendSection.style.marginBottom = '3mm';

                    const legendTitle = document.createElement('div');
                    legendTitle.textContent = 'Legend';
                    legendTitle.style.fontSize = '10pt';
                    legendTitle.style.fontWeight = 'bold';
                    legendTitle.style.color = '#000000';
                    legendTitle.style.marginBottom = '1.5mm';
                    legendSection.appendChild(legendTitle);

                    // Legend image - scale to fit column width and optimize for PDF
                    if (layer.legend.legendImage) {
                        const legendImg = document.createElement('img');
                        legendImg.src = layer.legend.legendImage;
                        // Explicitly constrain to column width
                        legendImg.style.maxWidth = `${columnWidth}mm`;
                        legendImg.style.width = 'auto';
                        legendImg.style.height = 'auto';
                        legendImg.style.display = 'block';
                        legendImg.style.marginBottom = '1.5mm';
                        legendImg.style.objectFit = 'contain';
                        // Optimize image loading - use loading="eager" and add decoding
                        legendImg.loading = 'eager';
                        legendImg.decoding = 'async';
                        legendSection.appendChild(legendImg);
                    }

                    // Legend text
                    if (layer.legend.legend) {
                        const legendText = document.createElement('div');
                        if (typeof layer.legend.legend === 'object' && layer.legend.legend.html) {
                            legendText.innerHTML = layer.legend.legend.html;
                            // Style links in legend
                            const links = legendText.querySelectorAll('a');
                            links.forEach(link => {
                                link.style.color = '#0066cc';
                                link.style.textDecoration = 'underline';
                                link.style.cursor = 'pointer';
                            });
                        } else {
                            legendText.textContent = typeof layer.legend.legend === 'string' ? layer.legend.legend : '';
                        }
                        legendText.style.fontSize = '8pt';
                        legendText.style.color = '#333333';
                        legendText.style.lineHeight = '1.3';
                        legendText.style.whiteSpace = 'pre-wrap';
                        legendSection.appendChild(legendText);
                    }

                    layerDiv.appendChild(legendSection);
                }

                // Features section (if there are selected features)
                if (layer.features && layer.features.length > 0) {
                    const featuresSection = document.createElement('div');
                    featuresSection.style.marginBottom = '3mm';

                    const featuresTitle = document.createElement('div');
                    featuresTitle.textContent = `Features (${layer.features.length})`;
                    featuresTitle.style.fontSize = '10pt';
                    featuresTitle.style.fontWeight = 'bold';
                    featuresTitle.style.color = '#000000';
                    featuresTitle.style.marginBottom = '2mm';
                    featuresSection.appendChild(featuresTitle);

                    // Limit features per layer to avoid overflow
                    const maxFeatures = 3; // Show max 3 features per layer
                    const featuresToShow = layer.features.slice(0, maxFeatures);

                    featuresToShow.forEach((feature, featureIndex) => {
                        const featureDiv = document.createElement('div');
                        featureDiv.style.marginBottom = '2mm';
                        featureDiv.style.paddingLeft = '2mm';
                        featureDiv.style.borderLeft = '2px solid #cccccc';

                        // Feature title
                        if (feature.title) {
                            const featureTitle = document.createElement('div');
                            featureTitle.textContent = feature.title;
                            featureTitle.style.fontSize = '9pt';
                            featureTitle.style.fontWeight = 'bold';
                            featureTitle.style.color = '#000000';
                            featureTitle.style.marginBottom = '1mm';
                            featureDiv.appendChild(featureTitle);
                        }

                        // Feature properties (limit to 3 per feature)
                        if (feature.properties && feature.properties.length > 0) {
                            const maxProps = 3;
                            feature.properties.slice(0, maxProps).forEach(prop => {
                                const propDiv = document.createElement('div');
                                propDiv.style.fontSize = '8pt';
                                propDiv.style.color = '#333333';
                                propDiv.style.marginBottom = '0.5mm';
                                propDiv.style.lineHeight = '1.2';

                                const propKey = document.createElement('span');
                                propKey.textContent = `${prop.key}: `;
                                propKey.style.fontWeight = '600';
                                propKey.style.color = '#555555';

                                const propValue = document.createElement('span');
                                propValue.textContent = prop.value;
                                propValue.style.color = '#333333';

                                propDiv.appendChild(propKey);
                                propDiv.appendChild(propValue);
                                featureDiv.appendChild(propDiv);
                            });
                        }

                        featuresSection.appendChild(featureDiv);
                    });

                    if (layer.features.length > maxFeatures) {
                        const moreDiv = document.createElement('div');
                        moreDiv.textContent = `... and ${layer.features.length - maxFeatures} more`;
                        moreDiv.style.fontSize = '8pt';
                        moreDiv.style.color = '#666666';
                        moreDiv.style.fontStyle = 'italic';
                        moreDiv.style.marginTop = '1mm';
                        featuresSection.appendChild(moreDiv);
                    }

                    layerDiv.appendChild(featuresSection);
                }

                return layerDiv;
            };

            // Distribute layers across pages in 2-column layout
            let currentPage = 0;
            let currentColumn = 0; // 0 = left, 1 = right
            let currentColumnHeight = 0;
            const maxColumnHeight = availableHeight;

            const pagesData = [];
            let currentPageLayers = [[], []]; // [leftColumn, rightColumn]
            let currentPageHeights = [0, 0]; // Track heights for each column

            // First, render all layers to measure their actual heights
            const measureLayerHeights = async () => {
                const measuredHeights = [];
                const tempContainer = document.createElement('div');
                tempContainer.style.position = 'fixed';
                tempContainer.style.left = '-9999px';
                tempContainer.style.top = '0';
                tempContainer.style.width = `${columnWidth}mm`;
                tempContainer.style.fontFamily = "'Open Sans', sans-serif";
                tempContainer.style.visibility = 'hidden';
                document.body.appendChild(tempContainer);

                for (const layer of layerInfo) {
                    const layerEl = createLayerElement(layer, false, 0);
                    tempContainer.appendChild(layerEl);

                    // Wait for rendering
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    await new Promise(resolve => requestAnimationFrame(resolve));

                    // Wait for images to load
                    const images = layerEl.querySelectorAll('img');
                    if (images.length > 0) {
                        await Promise.all(Array.from(images).map(img => {
                            if (img.complete) return Promise.resolve();
                            return new Promise((resolve) => {
                                img.onload = resolve;
                                img.onerror = resolve;
                                setTimeout(resolve, 3000); // Longer timeout for large images
                            });
                        }));
                    }

                    // Measure actual height
                    const rect = layerEl.getBoundingClientRect();
                    // Convert pixels to mm (assuming 96 DPI for screen)
                    const pixelsToMm = 25.4 / 96;
                    const heightMm = rect.height * pixelsToMm;

                    measuredHeights.push(heightMm);
                    tempContainer.removeChild(layerEl);
                }

                document.body.removeChild(tempContainer);
                return measuredHeights;
            };

            // Measure all layer heights
            const layerHeights = await measureLayerHeights();

            // Distribute layers based on measured heights
            // Use a smarter algorithm that handles very tall layers by making them full-width
            const fullWidthThreshold = maxColumnHeight * 1.5; // Layers taller than 1.5x column height span full width

            layerInfo.forEach((layer, index) => {
                const layerHeight = layerHeights[index] || 100; // Fallback to 100mm if measurement failed

                // Safety margin to prevent cutoff
                const safetyMargin = 20; // Increased safety margin

                // Check if layer is very tall (should span full width)
                if (layerHeight > fullWidthThreshold) {
                    // Very tall layer - make it span full width to avoid wasting vertical space
                    // First, ensure we're starting on a fresh row (both columns should be clear or we start new page)
                    if (currentPageLayers[0].length > 0 || currentPageLayers[1].length > 0) {
                        // Current page has content - save it and start new page for the tall layer
                        pagesData.push({
                            layers: currentPageLayers,
                            pageIndex: currentPage,
                            fullWidthLayers: []
                        });

                        currentPage++;
                        currentPageLayers = [[], []];
                        currentPageHeights = [0, 0];
                        currentColumn = 0;
                    }

                    // Add tall layer as full-width (will be rendered spanning both columns)
                    // Store it in a special structure
                    if (!pagesData[currentPage]) {
                        pagesData.push({
                            layers: [[], []],
                            pageIndex: currentPage,
                            fullWidthLayers: []
                        });
                    }

                    // Find or create the current page data
                    let currentPageData = pagesData.find(p => p.pageIndex === currentPage);
                    if (!currentPageData) {
                        currentPageData = {
                            layers: [[], []],
                            pageIndex: currentPage,
                            fullWidthLayers: []
                        };
                        pagesData.push(currentPageData);
                    } else {
                        // Ensure fullWidthLayers exists
                        if (!currentPageData.fullWidthLayers) {
                            currentPageData.fullWidthLayers = [];
                        }
                    }

                    // Add to full-width layers
                    currentPageData.fullWidthLayers.push({
                        layer: layer,
                        height: layerHeight
                    });

                    // Reset column tracking since we used full width
                    currentPageLayers = [[], []];
                    currentPageHeights = [0, 0];
                    currentColumn = 0;

                } else if (layerHeight > maxColumnHeight * 0.9) {
                    // Tall but not extremely tall - put it in one column, but try to balance
                    // Check if we can fit it in current column
                    if (currentPageHeights[currentColumn] + layerHeight + safetyMargin > maxColumnHeight) {
                        // Move to next column
                        currentColumn++;

                        // If both columns are full, start new page
                        if (currentColumn >= 2) {
                            // Save current page
                            pagesData.push({
                                layers: currentPageLayers,
                                pageIndex: currentPage,
                                fullWidthLayers: []
                            });

                            // Start new page
                            currentPage++;
                            currentPageLayers = [[], []];
                            currentPageHeights = [0, 0];
                            currentColumn = 0;
                        }
                    }

                    // Add the tall layer to current column
                    currentPageLayers[currentColumn].push(layer);
                    currentPageHeights[currentColumn] = layerHeight;

                    // Move to next column for next layer
                    currentColumn++;
                    if (currentColumn >= 2) {
                        pagesData.push({
                            layers: currentPageLayers,
                            pageIndex: currentPage,
                            fullWidthLayers: []
                        });
                        currentPage++;
                        currentPageLayers = [[], []];
                        currentPageHeights = [0, 0];
                        currentColumn = 0;
                    }
                } else {
                    // Normal layer - use 2-column layout
                    // Try to balance columns by checking which column has less content
                    if (currentPageHeights[0] > currentPageHeights[1] + layerHeight + safetyMargin &&
                        currentPageHeights[1] + layerHeight + safetyMargin <= maxColumnHeight) {
                        // Right column has less content and can fit this layer - use it
                        currentColumn = 1;
                    } else if (currentPageHeights[currentColumn] + layerHeight + safetyMargin > maxColumnHeight) {
                        // Current column is full - move to next column
                        currentColumn++;

                        // If both columns are full, start new page
                        if (currentColumn >= 2) {
                            // Save current page
                            pagesData.push({
                                layers: currentPageLayers,
                                pageIndex: currentPage,
                                fullWidthLayers: []
                            });

                            // Start new page
                            currentPage++;
                            currentPageLayers = [[], []];
                            currentPageHeights = [0, 0];
                            currentColumn = 0;
                        }
                    }

                    // Add layer to current column
                    currentPageLayers[currentColumn].push(layer);
                    currentPageHeights[currentColumn] += layerHeight;
                }
            });

            // Add last page if it has content
            if (currentPageLayers[0].length > 0 || currentPageLayers[1].length > 0) {
                // Check if we already have a page data entry for this page index
                let lastPageData = pagesData.find(p => p.pageIndex === currentPage);
                if (lastPageData) {
                    // Update existing page data
                    lastPageData.layers = currentPageLayers;
                } else {
                    // Create new page data
                    pagesData.push({
                        layers: currentPageLayers,
                        pageIndex: currentPage,
                        fullWidthLayers: []
                    });
                }
            }

            // Generate HTML for each page
            for (let pageIdx = 0; pageIdx < pagesData.length; pageIdx++) {
                const pageData = pagesData[pageIdx];
                const isFirstPage = pageIdx === 0;

                // Create container for this page - allow it to grow for measurement
                const legendContainer = document.createElement('div');
                legendContainer.style.position = 'fixed';
                legendContainer.style.left = '-9999px';
                legendContainer.style.top = '0';
                legendContainer.style.width = `${widthMm}mm`;
                legendContainer.style.minHeight = `${heightMm}mm`; // Use minHeight instead of fixed height
                legendContainer.style.backgroundColor = '#ffffff';
                legendContainer.style.overflow = 'visible';
                legendContainer.style.fontFamily = "'Open Sans', sans-serif";
                legendContainer.style.padding = `${padding}mm`;
                legendContainer.style.boxSizing = 'border-box';

                // Header: "Legend" (only on first page)
                if (isFirstPage) {
                    const header = document.createElement('h1');
                    header.textContent = 'Legend';
                    header.style.margin = '0 0 6mm 0';
                    header.style.fontSize = '24pt';
                    header.style.fontWeight = 'bold';
                    header.style.color = '#000000';
                    legendContainer.appendChild(header);

                    // Map Title
                    if (this._title && this._title.trim()) {
                        const titleEl = document.createElement('div');
                        titleEl.innerHTML = this._title.replace(/<br\s*\/?>/gi, '<br>');
                        titleEl.style.margin = '0 0 3mm 0';
                        titleEl.style.fontSize = '14pt';
                        titleEl.style.fontWeight = 'bold';
                        titleEl.style.color = '#000000';
                        legendContainer.appendChild(titleEl);
                    }

                    // Map Description
                    if (this._description && this._description.trim()) {
                        const descEl = document.createElement('div');
                        descEl.textContent = this._description;
                        descEl.style.margin = '0 0 6mm 0';
                        descEl.style.fontSize = '10pt';
                        descEl.style.color = '#333333';
                        descEl.style.lineHeight = '1.5';
                        legendContainer.appendChild(descEl);
                    }
                } else {
                    // Page number for subsequent pages
                    const pageHeader = document.createElement('div');
                    pageHeader.textContent = `Legend (continued)`;
                    pageHeader.style.margin = '0 0 6mm 0';
                    pageHeader.style.fontSize = '18pt';
                    pageHeader.style.fontWeight = 'bold';
                    pageHeader.style.color = '#000000';
                    legendContainer.appendChild(pageHeader);
                }

                // Render full-width layers first (if any)
                const fullWidthLayers = pageData.fullWidthLayers || [];
                fullWidthLayers.forEach(fullWidthItem => {
                    const fullWidthContainer = document.createElement('div');
                    fullWidthContainer.style.width = '100%';
                    fullWidthContainer.style.marginBottom = '6mm';

                    const layerEl = createLayerElement(fullWidthItem.layer, isFirstPage, pageIdx);
                    // Override column width constraint for full-width layers
                    const thumbnailImgs = layerEl.querySelectorAll('img');
                    thumbnailImgs.forEach(img => {
                        if (img.style.maxWidth && img.style.maxWidth.includes('mm')) {
                            // Update to use full available width (accounting for padding)
                            img.style.maxWidth = `${availableWidth}mm`;
                        }
                    });

                    fullWidthContainer.appendChild(layerEl);
                    legendContainer.appendChild(fullWidthContainer);
                });

                // Create 2-column layout container for regular layers (only if there are layers to display)
                if (pageData.layers[0].length > 0 || pageData.layers[1].length > 0) {
                    const columnsContainer = document.createElement('div');
                    columnsContainer.style.display = 'flex';
                    columnsContainer.style.gap = `${columnGap}mm`;
                    columnsContainer.style.marginTop = fullWidthLayers.length > 0 ? '0' : (isFirstPage ? '0' : '0');
                    columnsContainer.style.width = '100%';

                    // Left column
                    const leftColumn = document.createElement('div');
                    leftColumn.style.width = `${columnWidth}mm`;
                    leftColumn.style.flexShrink = '0';
                    leftColumn.style.display = 'flex';
                    leftColumn.style.flexDirection = 'column';

                    // Right column
                    const rightColumn = document.createElement('div');
                    rightColumn.style.width = `${columnWidth}mm`;
                    rightColumn.style.flexShrink = '0';
                    rightColumn.style.display = 'flex';
                    rightColumn.style.flexDirection = 'column';

                    // Add layers to columns
                    pageData.layers[0].forEach(layer => {
                        const layerEl = createLayerElement(layer, isFirstPage, pageIdx);
                        leftColumn.appendChild(layerEl);
                    });

                    pageData.layers[1].forEach(layer => {
                        const layerEl = createLayerElement(layer, isFirstPage, pageIdx);
                        rightColumn.appendChild(layerEl);
                    });

                    columnsContainer.appendChild(leftColumn);
                    columnsContainer.appendChild(rightColumn);
                    legendContainer.appendChild(columnsContainer);
                }

                // Overlay image removed - layer information is now rendered in 2-column layout above

                document.body.appendChild(legendContainer);

                // Wait for rendering and image loading
                await new Promise(resolve => requestAnimationFrame(resolve));
                await new Promise(resolve => requestAnimationFrame(resolve));

                // Wait for images to load
                const images = legendContainer.querySelectorAll('img');
                if (images.length > 0) {
                    await Promise.all(Array.from(images).map(img => {
                        if (img.complete) return Promise.resolve();
                        return new Promise((resolve) => {
                            img.onload = resolve;
                            img.onerror = resolve;
                            setTimeout(resolve, 2000);
                        });
                    }));
                }

                await new Promise(resolve => setTimeout(resolve, 300));

                // Extract links and their positions before rendering
                const extractLinks = (container) => {
                    const links = [];
                    const linkElements = container.querySelectorAll('a[href]');
                    const containerRect = container.getBoundingClientRect();

                    linkElements.forEach(link => {
                        const rect = link.getBoundingClientRect();
                        const href = link.getAttribute('href');
                        if (href) {
                            links.push({
                                href: href,
                                x: rect.left - containerRect.left,
                                y: rect.top - containerRect.top,
                                width: rect.width,
                                height: rect.height
                            });
                        }
                    });

                    return links;
                };

                const pageLinks = extractLinks(legendContainer);

                // Render full content to canvas (may exceed page height)
                // Use lower scale for legend pages (1.2 instead of 2) to significantly reduce file size
                // Legend pages are mostly text and don't need as high resolution as the map
                // Scale 1.2 provides good quality while keeping file size manageable
                const html2canvas = (await import('html2canvas')).default;
                const scale = 1.2; // Reduced from 2 to reduce file size (1.2 = 44% fewer pixels than scale 2)

                const fullCanvas = await html2canvas(legendContainer, {
                    backgroundColor: '#ffffff',
                    scale: scale,
                    logging: false,
                    useCORS: true,
                    width: legendContainer.offsetWidth,
                    height: legendContainer.offsetHeight,
                    windowWidth: legendContainer.offsetWidth,
                    windowHeight: legendContainer.offsetHeight,
                    // Optimize image rendering
                    imageTimeout: 5000,
                    removeContainer: false
                });

                // Clean up container
                document.body.removeChild(legendContainer);

                // Calculate page dimensions in pixels
                const mmToPx = 96 / 25.4; // Convert mm to pixels at 96 DPI
                const pageWidthPx = widthMm * mmToPx * scale;
                const pageHeightPx = heightMm * mmToPx * scale;

                // Helper function to convert canvas to optimized JPEG
                const canvasToOptimizedJPEG = (canvas, quality = 0.80) => {
                    // Use JPEG compression for legend pages (much smaller than PNG)
                    // Quality 0.80 provides good balance between file size and visual quality for legend pages
                    return canvas.toDataURL('image/jpeg', quality);
                };

                // If canvas is taller than one page, split it into multiple pages
                if (fullCanvas.height > pageHeightPx) {
                    const numPages = Math.ceil(fullCanvas.height / pageHeightPx);

                    for (let p = 0; p < numPages; p++) {
                        const sourceY = p * pageHeightPx;
                        const sourceHeight = Math.min(pageHeightPx, fullCanvas.height - sourceY);

                        // Create a new canvas for this page
                        const pageCanvas = document.createElement('canvas');
                        pageCanvas.width = pageWidthPx;
                        pageCanvas.height = pageHeightPx;
                        const ctx = pageCanvas.getContext('2d');

                        // Fill with white background
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, pageWidthPx, pageHeightPx);

                        // Draw the portion of the full canvas for this page
                        ctx.drawImage(
                            fullCanvas,
                            0, sourceY, fullCanvas.width, sourceHeight, // Source
                            0, 0, pageWidthPx, sourceHeight // Destination
                        );

                        // Filter links for this page
                        const pageLinksFiltered = pageLinks.filter(link => {
                            const linkY = link.y * scale;
                            return linkY >= sourceY && linkY < sourceY + pageHeightPx;
                        }).map(link => ({
                            href: link.href,
                            x: link.x * scale,
                            y: (link.y * scale) - sourceY, // Adjust Y relative to page
                            width: link.width * scale,
                            height: link.height * scale
                        }));

                        pages.push({
                            dataUrl: canvasToOptimizedJPEG(pageCanvas, 0.80), // Use JPEG with 80% quality
                            widthMm: widthMm,
                            heightMm: heightMm,
                            links: pageLinksFiltered
                        });
                    }
                } else {
                    // Content fits on one page - use JPEG compression
                    // Scale link positions to match canvas scale
                    const scaledLinks = pageLinks.map(link => ({
                        href: link.href,
                        x: link.x * scale,
                        y: link.y * scale,
                        width: link.width * scale,
                        height: link.height * scale
                    }));

                    pages.push({
                        dataUrl: canvasToOptimizedJPEG(fullCanvas, 0.80), // Use JPEG with 80% quality
                        widthMm: widthMm,
                        heightMm: heightMm,
                        links: scaledLinks
                    });
                }
            }

            return pages;
        } catch (e) {
            console.error('Failed to generate legend pages HTML', e);
            return [];
        }
    }

    /**
     * Generate legend page HTML (legacy method - kept for compatibility)
     * @param {number} widthMm - PDF width in mm
     * @param {number} heightMm - PDF height in mm
     * @param {string} overlayDataUrl - Legend overlay data URL
     * @param {number} overlayWidthMm - Overlay width in mm
     * @param {number} overlayHeightMm - Overlay height in mm
     * @param {number} dpi - DPI
     * @returns {Promise<Object>} Object with dataUrl and dimensions
     */
    async _generateLegendPageHTML(widthMm, heightMm, overlayDataUrl, overlayWidthMm, overlayHeightMm, dpi) {
        try {
            // Create container for legend page
            const legendContainer = document.createElement('div');
            legendContainer.style.position = 'fixed';
            legendContainer.style.left = '-9999px';
            legendContainer.style.top = '0';
            legendContainer.style.width = `${widthMm}mm`;
            legendContainer.style.height = `${heightMm}mm`;
            legendContainer.style.backgroundColor = '#ffffff';
            legendContainer.style.overflow = 'visible';
            legendContainer.style.fontFamily = "'Open Sans', sans-serif";
            legendContainer.style.padding = '10mm';
            legendContainer.style.boxSizing = 'border-box';

            // Header: "Legend"
            const header = document.createElement('h1');
            header.textContent = 'Legend';
            header.style.margin = '0 0 8mm 0';
            header.style.fontSize = '24pt';
            header.style.fontWeight = 'bold';
            header.style.color = '#000000';
            legendContainer.appendChild(header);

            // Map Title
            if (this._title && this._title.trim()) {
                const titleEl = document.createElement('div');
                titleEl.innerHTML = this._title.replace(/<br\s*\/?>/gi, '<br>');
                titleEl.style.margin = '0 0 4mm 0';
                titleEl.style.fontSize = '14pt';
                titleEl.style.fontWeight = 'bold';
                titleEl.style.color = '#000000';
                legendContainer.appendChild(titleEl);
            }

            // Map Description
            if (this._description && this._description.trim()) {
                const descEl = document.createElement('div');
                descEl.textContent = this._description;
                descEl.style.margin = '0 0 8mm 0';
                descEl.style.fontSize = '10pt';
                descEl.style.color = '#333333';
                descEl.style.lineHeight = '1.5';
                legendContainer.appendChild(descEl);
            }

            // Get layer information from feature control
            const layerInfo = this._getLayerInformation();

            // Add layer information section
            if (layerInfo && layerInfo.length > 0) {
                const layersSection = document.createElement('div');
                layersSection.style.marginTop = '8mm';

                layerInfo.forEach((layer, index) => {
                    const layerDiv = document.createElement('div');
                    layerDiv.style.marginBottom = '8mm';
                    layerDiv.style.paddingBottom = '8mm';
                    layerDiv.style.borderBottom = index < layerInfo.length - 1 ? '1px solid #e0e0e0' : 'none';

                    // Layer title
                    if (layer.title) {
                        const layerTitle = document.createElement('div');
                        layerTitle.textContent = layer.title;
                        layerTitle.style.fontSize = '14pt';
                        layerTitle.style.fontWeight = 'bold';
                        layerTitle.style.color = '#000000';
                        layerTitle.style.marginBottom = '4mm';
                        layerDiv.appendChild(layerTitle);
                    }

                    // Info section (Description and Attribution)
                    if (layer.info && (layer.info.description || layer.info.attribution)) {
                        const infoSection = document.createElement('div');
                        infoSection.style.marginBottom = '4mm';

                        // Description
                        if (layer.info.description) {
                            const descDiv = document.createElement('div');
                            if (typeof layer.info.description === 'object' && layer.info.description.html) {
                                descDiv.innerHTML = layer.info.description.html;
                                // Style links in description
                                const links = descDiv.querySelectorAll('a');
                                links.forEach(link => {
                                    link.style.color = '#0066cc';
                                    link.style.textDecoration = 'underline';
                                    link.style.cursor = 'pointer';
                                });
                            } else {
                                descDiv.textContent = typeof layer.info.description === 'string' ? layer.info.description : '';
                            }
                            descDiv.style.fontSize = '10pt';
                            descDiv.style.color = '#333333';
                            descDiv.style.marginBottom = '2mm';
                            descDiv.style.lineHeight = '1.5';
                            descDiv.style.whiteSpace = 'pre-wrap'; // Preserve line breaks
                            infoSection.appendChild(descDiv);
                        }

                        // Attribution
                        if (layer.info.attribution) {
                            const attrDiv = document.createElement('div');
                            if (typeof layer.info.attribution === 'object' && layer.info.attribution.html) {
                                attrDiv.innerHTML = `Source: ${layer.info.attribution.html}`;
                                // Style links in attribution
                                const links = attrDiv.querySelectorAll('a');
                                links.forEach(link => {
                                    link.style.color = '#0066cc';
                                    link.style.textDecoration = 'underline';
                                    link.style.cursor = 'pointer';
                                });
                            } else {
                                attrDiv.textContent = `Source: ${typeof layer.info.attribution === 'string' ? layer.info.attribution : ''}`;
                            }
                            attrDiv.style.fontSize = '9pt';
                            attrDiv.style.color = '#666666';
                            attrDiv.style.fontStyle = 'italic';
                            attrDiv.style.marginTop = '2mm';
                            infoSection.appendChild(attrDiv);
                        }

                        layerDiv.appendChild(infoSection);
                    }

                    // Legend section
                    if (layer.legend && (layer.legend.legendImage || layer.legend.legend)) {
                        const legendSection = document.createElement('div');
                        legendSection.style.marginBottom = '4mm';

                        const legendTitle = document.createElement('div');
                        legendTitle.textContent = 'Legend';
                        legendTitle.style.fontSize = '11pt';
                        legendTitle.style.fontWeight = 'bold';
                        legendTitle.style.color = '#000000';
                        legendTitle.style.marginBottom = '2mm';
                        legendSection.appendChild(legendTitle);

                        // Legend image
                        if (layer.legend.legendImage) {
                            const legendImg = document.createElement('img');
                            legendImg.src = layer.legend.legendImage;
                            legendImg.style.maxWidth = '100%';
                            legendImg.style.height = 'auto';
                            legendImg.style.display = 'block';
                            legendImg.style.marginBottom = '2mm';
                            legendSection.appendChild(legendImg);
                        }

                        // Legend text
                        if (layer.legend.legend) {
                            const legendText = document.createElement('div');
                            if (typeof layer.legend.legend === 'object' && layer.legend.legend.html) {
                                legendText.innerHTML = layer.legend.legend.html;
                                // Style links in legend
                                const links = legendText.querySelectorAll('a');
                                links.forEach(link => {
                                    link.style.color = '#0066cc';
                                    link.style.textDecoration = 'underline';
                                    link.style.cursor = 'pointer';
                                });
                            } else {
                                legendText.textContent = typeof layer.legend.legend === 'string' ? layer.legend.legend : '';
                            }
                            legendText.style.fontSize = '9pt';
                            legendText.style.color = '#333333';
                            legendText.style.lineHeight = '1.4';
                            legendText.style.whiteSpace = 'pre-wrap'; // Preserve line breaks
                            legendSection.appendChild(legendText);
                        }

                        layerDiv.appendChild(legendSection);
                    }

                    // Features section (if there are selected features)
                    if (layer.features && layer.features.length > 0) {
                        const featuresSection = document.createElement('div');
                        featuresSection.style.marginBottom = '4mm';

                        const featuresTitle = document.createElement('div');
                        featuresTitle.textContent = `Selected Features (${layer.features.length})`;
                        featuresTitle.style.fontSize = '11pt';
                        featuresTitle.style.fontWeight = 'bold';
                        featuresTitle.style.color = '#000000';
                        featuresTitle.style.marginBottom = '3mm';
                        featuresSection.appendChild(featuresTitle);

                        layer.features.forEach((feature, featureIndex) => {
                            const featureDiv = document.createElement('div');
                            featureDiv.style.marginBottom = '3mm';
                            featureDiv.style.paddingLeft = '3mm';
                            featureDiv.style.borderLeft = '2px solid #cccccc';

                            // Feature title
                            if (feature.title) {
                                const featureTitle = document.createElement('div');
                                featureTitle.textContent = feature.title;
                                featureTitle.style.fontSize = '10pt';
                                featureTitle.style.fontWeight = 'bold';
                                featureTitle.style.color = '#000000';
                                featureTitle.style.marginBottom = '2mm';
                                featureDiv.appendChild(featureTitle);
                            }

                            // Feature properties
                            if (feature.properties && feature.properties.length > 0) {
                                feature.properties.forEach(prop => {
                                    const propDiv = document.createElement('div');
                                    propDiv.style.fontSize = '9pt';
                                    propDiv.style.color = '#333333';
                                    propDiv.style.marginBottom = '1mm';
                                    propDiv.style.lineHeight = '1.3';

                                    const propKey = document.createElement('span');
                                    propKey.textContent = `${prop.key}: `;
                                    propKey.style.fontWeight = '600';
                                    propKey.style.color = '#555555';

                                    const propValue = document.createElement('span');
                                    propValue.textContent = prop.value;
                                    propValue.style.color = '#333333';

                                    propDiv.appendChild(propKey);
                                    propDiv.appendChild(propValue);
                                    featureDiv.appendChild(propDiv);
                                });
                            }

                            featuresSection.appendChild(featureDiv);
                        });

                        layerDiv.appendChild(featuresSection);
                    }

                    layersSection.appendChild(layerDiv);
                });

                legendContainer.appendChild(layersSection);
            }

            // Add legend overlay image if available
            // Place it at the bottom of the page if there's space, otherwise after layer info
            if (overlayDataUrl) {
                const legendImgContainer = document.createElement('div');
                legendImgContainer.style.marginTop = '8mm';
                legendImgContainer.style.textAlign = 'center';
                legendImgContainer.style.pageBreakInside = 'avoid';

                const legendImg = document.createElement('img');
                legendImg.src = overlayDataUrl;
                // Scale to fit page width (with margins)
                const maxWidth = widthMm - 20; // Account for padding
                const scale = Math.min(1, maxWidth / overlayWidthMm);
                legendImg.style.width = `${overlayWidthMm * scale}mm`;
                legendImg.style.height = 'auto';
                legendImg.style.maxWidth = '100%';
                legendImg.style.display = 'block';
                legendImg.style.margin = '0 auto';
                legendImgContainer.appendChild(legendImg);
                legendContainer.appendChild(legendImgContainer);
            }

            document.body.appendChild(legendContainer);

            // Wait for rendering and image loading
            await new Promise(resolve => requestAnimationFrame(resolve));
            await new Promise(resolve => requestAnimationFrame(resolve));

            // Wait for images to load
            const images = legendContainer.querySelectorAll('img');
            if (images.length > 0) {
                await Promise.all(Array.from(images).map(img => {
                    if (img.complete) return Promise.resolve();
                    return new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = resolve; // Continue even if image fails
                        setTimeout(resolve, 2000); // Timeout after 2s
                    });
                }));
            }

            await new Promise(resolve => setTimeout(resolve, 300));

            // Render to canvas using html2canvas
            const html2canvas = (await import('html2canvas')).default;

            const scale = 2; // Higher quality

            const canvas = await html2canvas(legendContainer, {
                backgroundColor: '#ffffff',
                scale: scale,
                logging: false,
                useCORS: true,
                width: legendContainer.offsetWidth,
                height: legendContainer.offsetHeight,
                windowWidth: legendContainer.offsetWidth,
                windowHeight: legendContainer.offsetHeight
            });

            // Clean up
            document.body.removeChild(legendContainer);

            return {
                dataUrl: canvas.toDataURL('image/png'),
                widthMm: widthMm,
                heightMm: heightMm
            };
        } catch (e) {
            console.error('Failed to generate legend page HTML', e);
            return null;
        }
    }

    /**
     * Get matching layer IDs for a layer config (similar to map-feature-control.js)
     * @param {Object} layerConfig - Layer configuration object
     * @returns {Array} Array of matching style layer IDs
     */
    _getMatchingLayerIds(layerConfig) {
        if (!this._map) return [];

        const style = this._map.getStyle();
        if (!style.layers) return [];

        const layerId = layerConfig.id;
        const matchingIds = [];

        // Strategy 1: Direct ID match (HIGHEST PRIORITY)
        const directMatches = style.layers.filter(l => l.id === layerId).map(l => l.id);
        matchingIds.push(...directMatches);

        // Strategy 2: Prefix matches (for geojson layers and others)
        const prefixMatches = style.layers
            .filter(l => l.id.startsWith(layerId + '-') || l.id.startsWith(layerId + ' '))
            .map(l => l.id);
        matchingIds.push(...prefixMatches);

        // Strategy 3: Generated layer names (vector-layer-{id}, tms-layer-{id}, etc.)
        const generatedMatches = style.layers
            .filter(l =>
                l.id.startsWith(`vector-layer-${layerId}`) ||
                l.id.startsWith(`tms-layer-${layerId}`) ||
                l.id.startsWith(`wmts-layer-${layerId}`) ||
                l.id.startsWith(`wms-layer-${layerId}`) ||
                l.id.startsWith(`geojson-${layerId}`) ||
                l.id.startsWith(`csv-${layerId}`)
            )
            .map(l => l.id);
        matchingIds.push(...generatedMatches);

        // Strategy 4: raster-style-layer styleLayer property
        if (layerConfig.styleLayer) {
            const styleLayerMatches = style.layers
                .filter(l => l.id === layerConfig.styleLayer)
                .map(l => l.id);
            matchingIds.push(...styleLayerMatches);
        }

        // Strategy 5: Source layer matches (only if no direct matches)
        const hasDirectMatches = directMatches.length > 0 || prefixMatches.length > 0 || generatedMatches.length > 0;
        if (!hasDirectMatches && layerConfig.sourceLayer) {
            const sourceLayerMatches = style.layers
                .filter(l => {
                    if (l['source-layer'] !== layerConfig.sourceLayer) return false;
                    return l.id.includes(layerId) || l.id === layerId;
                })
                .map(l => l.id);
            matchingIds.push(...sourceLayerMatches);
        }

        // Strategy 6: Source matches
        if (!hasDirectMatches && layerConfig.source) {
            const sourceMatches = style.layers
                .filter(l => {
                    if (l.source !== layerConfig.source) return false;
                    return l.id.includes(layerId) || l.id === layerId;
                })
                .map(l => l.id);
            matchingIds.push(...sourceMatches);
        }

        // Strategy 7: GeoJSON source matching
        if (layerConfig.type === 'geojson') {
            const sourceId = `geojson-${layerId}`;
            const geojsonMatches = style.layers
                .filter(l => l.source === sourceId ||
                    l.id.startsWith(`${sourceId}-fill`) ||
                    l.id.startsWith(`${sourceId}-line`) ||
                    l.id.startsWith(`${sourceId}-circle`))
                .map(l => l.id);
            matchingIds.push(...geojsonMatches);
        }

        // Strategy 8: Vector layer matching
        if (layerConfig.type === 'vector') {
            const sourceId = `vector-${layerId}`;
            const vectorMatches = style.layers
                .filter(l => l.source === sourceId || l.id.startsWith(`vector-layer-${layerId}`))
                .map(l => l.id);
            matchingIds.push(...vectorMatches);
        }

        // Remove duplicates and return
        return [...new Set(matchingIds)];
    }

    /**
     * Get all basemap layer IDs (layers tagged with 'basemap')
     * @returns {Array} Array of basemap style layer IDs
     */
    _getBasemapLayerIds() {
        const basemapLayerIds = [];

        // Check current config
        let config = null;
        if (window.layerControl && window.layerControl._config) {
            config = window.layerControl._config;
        }

        if (config) {
            const layers = config.layers || config.groups || [];
            layers.forEach(layer => {
                const hasBasemapTag = layer.tags && (
                    (Array.isArray(layer.tags) && layer.tags.includes('basemap')) ||
                    (typeof layer.tags === 'string' && layer.tags === 'basemap')
                );

                if (hasBasemapTag && layer.id) {
                    const matchingIds = this._getMatchingLayerIds(layer);
                    basemapLayerIds.push(...matchingIds);
                }
            });
        }

        // Also check active layers from feature control
        if (window.featureControl && window.featureControl._stateManager) {
            const activeLayers = window.featureControl._stateManager.getActiveLayers();
            activeLayers.forEach((layerData, layerId) => {
                const layerConfig = layerData.config;
                const hasBasemapTag = layerConfig.tags && (
                    (Array.isArray(layerConfig.tags) && layerConfig.tags.includes('basemap')) ||
                    (typeof layerConfig.tags === 'string' && layerConfig.tags === 'basemap')
                );

                if (hasBasemapTag) {
                    const matchingIds = this._getMatchingLayerIds(layerConfig);
                    basemapLayerIds.push(...matchingIds);
                }
            });
        }

        // Remove duplicates
        return [...new Set(basemapLayerIds)];
    }

    /**
     * Isolate a layer by hiding all other non-basemap layers
     * @param {Object} layerConfig - Layer configuration object
     * @returns {Array} Array of layer IDs that were hidden (for restoration)
     */
    _isolateLayer(layerConfig) {
        if (!this._map) return [];

        const matchingLayerIds = this._getMatchingLayerIds(layerConfig);
        const basemapLayerIds = this._getBasemapLayerIds();

        const style = this._map.getStyle();
        if (!style.layers) return [];

        const visibleLayers = style.layers.filter(layer => {
            const visibility = layer.layout?.visibility;
            return visibility === undefined || visibility === 'visible';
        });

        const layersToHide = [];
        visibleLayers.forEach(layer => {
            const styleLayerId = layer.id;

            // Keep the target layer visible
            if (matchingLayerIds.includes(styleLayerId)) {
                return;
            }

            // Keep basemap layers visible
            if (basemapLayerIds.includes(styleLayerId)) {
                return;
            }

            // Hide all other layers
            layersToHide.push(styleLayerId);
        });

        // Hide the layers
        const hiddenLayers = [];
        layersToHide.forEach(layerId => {
            try {
                const layer = this._map.getLayer(layerId);
                if (layer && layer.type !== 'slot') {
                    this._map.setLayoutProperty(layerId, 'visibility', 'none');
                    hiddenLayers.push(layerId);
                }
            } catch (error) {
                console.warn(`Failed to hide layer ${layerId}:`, error);
            }
        });

        return hiddenLayers;
    }

    /**
     * Restore visibility of previously hidden layers
     * @param {Array} hiddenLayerIds - Array of layer IDs to restore
     */
    _restoreLayers(hiddenLayerIds) {
        if (!this._map) return;

        hiddenLayerIds.forEach(layerId => {
            try {
                const layer = this._map.getLayer(layerId);
                if (layer && layer.type !== 'slot') {
                    this._map.setLayoutProperty(layerId, 'visibility', 'visible');
                }
            } catch (error) {
                console.warn(`Failed to restore layer ${layerId}:`, error);
            }
        });
    }

    /**
     * Capture a thumbnail of an isolated layer using the export frame
     * @param {Object} layerConfig - Layer configuration object
     * @param {number} targetWidth - Target width in pixels (default: 300)
     * @returns {Promise<string|null>} Data URL of the thumbnail image, or null if failed
     */
    async _captureLayerThumbnail(layerConfig, targetWidth = 300) {
        if (!this._map || !this._frame) return null;

        // Ensure frame is visible
        const wasFrameVisible = this._frame._el.classList.contains('active');
        if (!wasFrameVisible) {
            this._frame.show();
            // Wait for frame to be positioned
            await new Promise(resolve => requestAnimationFrame(resolve));
        }

        try {
            // Save current map state
            const originalCenter = this._map.getCenter();
            const originalZoom = this._map.getZoom();
            const originalBearing = this._map.getBearing();
            const originalPitch = this._map.getPitch();

            // Try to zoom to layer bounds if available
            const bbox = layerConfig.bbox || layerConfig.metadata?.bbox;
            if (bbox && bbox !== "0.0,0.0,0.0,0.0") {
                try {
                    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(parseFloat);
                    if (!isNaN(minLng) && !isNaN(minLat) && !isNaN(maxLng) && !isNaN(maxLat)) {
                        const bounds = [[minLng, minLat], [maxLng, maxLat]];
                        this._map.fitBounds(bounds, {
                            padding: 50,
                            maxZoom: 16,
                            duration: 0, // Instant
                            animate: false
                        });
                        // Wait for map to update
                        await Promise.race([
                            new Promise(resolve => this._map.once('idle', resolve)),
                            new Promise(resolve => setTimeout(resolve, 500))
                        ]);
                    }
                } catch (e) {
                    console.warn('Failed to zoom to layer bounds for thumbnail', e);
                }
            }

            // Isolate the layer
            const hiddenLayers = this._isolateLayer(layerConfig);

            // Wait for map to render with isolated layer
            await Promise.race([
                new Promise(resolve => this._map.once('idle', resolve)),
                new Promise(resolve => setTimeout(resolve, 1000))
            ]);

            // Get frame dimensions
            const frameRect = this._frame._el.getBoundingClientRect();
            const mapRect = this._map.getContainer().getBoundingClientRect();

            // Ensure frame is within map bounds
            if (frameRect.width === 0 || frameRect.height === 0) {
                throw new Error('Frame has zero dimensions');
            }

            // Calculate frame position relative to map
            const frameX = frameRect.left - mapRect.left;
            const frameY = frameRect.top - mapRect.top;
            const frameWidth = frameRect.width;
            const frameHeight = frameRect.height;

            // Ensure frame is within canvas bounds
            const canvas = this._map.getCanvas();
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;

            // Calculate scaling factor (canvas might be scaled for high DPI)
            const scaleX = canvasWidth / mapRect.width;
            const scaleY = canvasHeight / mapRect.height;

            // Convert frame coordinates to canvas coordinates
            const canvasX = frameX * scaleX;
            const canvasY = frameY * scaleY;
            const canvasFrameWidth = frameWidth * scaleX;
            const canvasFrameHeight = frameHeight * scaleY;

            // Create a temporary canvas for the frame area
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvasFrameWidth;
            tempCanvas.height = canvasFrameHeight;
            const tempCtx = tempCanvas.getContext('2d');

            // Draw the frame area from the map canvas
            tempCtx.drawImage(
                canvas,
                canvasX, canvasY, canvasFrameWidth, canvasFrameHeight, // Source
                0, 0, canvasFrameWidth, canvasFrameHeight // Destination
            );

            // Scale to target width while maintaining aspect ratio
            const aspectRatio = canvasFrameHeight / canvasFrameWidth;
            const targetHeight = Math.round(targetWidth * aspectRatio);

            const scaledCanvas = document.createElement('canvas');
            scaledCanvas.width = targetWidth;
            scaledCanvas.height = targetHeight;
            const scaledCtx = scaledCanvas.getContext('2d');

            // Use high-quality scaling
            scaledCtx.imageSmoothingEnabled = true;
            scaledCtx.imageSmoothingQuality = 'high';
            scaledCtx.drawImage(tempCanvas, 0, 0, targetWidth, targetHeight);

            // Convert to data URL
            const dataUrl = scaledCanvas.toDataURL('image/png');

            // Restore layers
            this._restoreLayers(hiddenLayers);

            // Restore map view
            this._map.jumpTo({
                center: originalCenter,
                zoom: originalZoom,
                bearing: originalBearing,
                pitch: originalPitch,
                animate: false
            });

            // Wait for restoration to complete
            await Promise.race([
                new Promise(resolve => this._map.once('idle', resolve)),
                new Promise(resolve => setTimeout(resolve, 300))
            ]);

            // Restore frame visibility state
            if (!wasFrameVisible) {
                this._frame.hide();
            }

            return dataUrl;
        } catch (error) {
            console.error('Failed to capture layer thumbnail', error);

            // Ensure we restore state even on error
            try {
                // Restore frame visibility state
                if (!wasFrameVisible) {
                    this._frame.hide();
                }
            } catch (e) {
                // Ignore errors during cleanup
            }

            return null;
        }
    }

    /**
     * Get layer information from feature control
     * @returns {Array} Array of layer information objects with Info, Legend, and Features content
     */
    _getLayerInformation() {
        const layers = [];

        try {
            // Helper to convert HTML to formatted text (preserving line breaks and structure)
            // Returns object with html (preserved HTML with links) and links (array of link info)
            const formatHtmlToText = (html) => {
                if (!html) return { html: '', links: [] };
                const tmp = document.createElement('div');
                tmp.innerHTML = html;

                // Extract links before processing
                const links = [];
                const linkElements = tmp.querySelectorAll('a[href]');
                linkElements.forEach((link, index) => {
                    const href = link.getAttribute('href');
                    const text = link.textContent || link.innerText || href;
                    // Store link info with a unique identifier
                    const linkId = `__link_${index}_${Date.now()}`;
                    link.setAttribute('data-link-id', linkId);
                    links.push({
                        id: linkId,
                        href: href,
                        text: text
                    });
                });

                // Replace <br> and <p> tags with line breaks for text fallback
                const brs = tmp.querySelectorAll('br, p');
                brs.forEach(br => {
                    if (br.tagName === 'P') {
                        br.insertAdjacentText('beforebegin', '\n');
                        if (br.nextSibling && br.nextSibling.nodeType !== Node.TEXT_NODE) {
                            br.insertAdjacentText('afterend', '\n');
                        }
                    } else {
                        br.insertAdjacentText('beforebegin', '\n');
                    }
                });

                // Get text content for fallback
                let text = tmp.textContent || tmp.innerText || '';
                text = text.replace(/\n{3,}/g, '\n\n');
                text = text.split('\n').map(line => line.trim()).join('\n');

                return {
                    html: tmp.innerHTML, // Preserve HTML with links
                    text: text.trim(), // Plain text fallback
                    links: links
                };
            };

            // Helper to get feature information for a layer
            const getFeatureInfo = (layerId, layerConfig, stateManager) => {
                if (!stateManager) return null;

                const activeLayers = stateManager.getActiveLayers();
                const layerData = activeLayers.get(layerId);

                if (!layerData || !layerData.features || layerData.features.size === 0) {
                    return null;
                }

                // Get selected features
                const selectedFeatures = [];
                layerData.features.forEach((featureState, featureId) => {
                    if (featureState.isSelected) {
                        selectedFeatures.push(featureState);
                    }
                });

                if (selectedFeatures.length === 0) {
                    return null;
                }

                // Format feature properties
                const featureInfo = [];
                selectedFeatures.forEach((featureState, index) => {
                    const feature = featureState.feature;
                    const properties = feature.properties || {};
                    const inspect = layerConfig.inspect || {};

                    // Get label field
                    const labelField = inspect.label;
                    let featureTitle = 'Feature';
                    if (labelField && properties[labelField]) {
                        featureTitle = String(properties[labelField]);
                    } else if (properties.name) {
                        featureTitle = String(properties.name);
                    } else if (properties.title) {
                        featureTitle = String(properties.title);
                    }

                    // Get priority fields
                    const priorityFields = inspect.fields || [];
                    const fieldTitles = inspect.fieldTitles || [];
                    const fieldTitleMap = {};
                    priorityFields.forEach((field, idx) => {
                        if (fieldTitles[idx]) {
                            fieldTitleMap[field] = fieldTitles[idx];
                        }
                    });

                    const featureData = {
                        title: featureTitle,
                        properties: []
                    };

                    // Add label field
                    if (labelField && properties[labelField] !== undefined && properties[labelField] !== null && properties[labelField] !== '') {
                        featureData.properties.push({
                            key: inspect.title || fieldTitleMap[labelField] || labelField,
                            value: String(properties[labelField])
                        });
                    }

                    // Add priority fields
                    priorityFields.forEach(field => {
                        if (field !== labelField && properties[field] !== undefined && properties[field] !== null && properties[field] !== '') {
                            featureData.properties.push({
                                key: fieldTitleMap[field] || field,
                                value: String(properties[field])
                            });
                        }
                    });

                    // If no configured fields, show first few meaningful properties
                    if (priorityFields.length === 0) {
                        const systemFields = ['id', 'fid', '_id', 'objectid', 'gid', 'osm_id', 'way_id'];
                        Object.entries(properties).forEach(([key, value]) => {
                            if (featureData.properties.length >= 5) return; // Limit to 5 properties
                            if (systemFields.includes(key.toLowerCase())) return;
                            if (value === undefined || value === null || value === '') return;
                            if (key === 'name' || key === 'title') return; // Already shown as title

                            featureData.properties.push({
                                key: key,
                                value: String(value)
                            });
                        });
                    }

                    featureInfo.push(featureData);
                });

                return featureInfo.length > 0 ? featureInfo : null;
            };

            // Try to get layer information from feature control
            if (window.featureControl) {
                let layerOrder = [];

                // Try to get layer order
                if (typeof window.featureControl._getConfigLayerOrder === 'function') {
                    layerOrder = window.featureControl._getConfigLayerOrder();
                } else if (window.featureControl._stateManager) {
                    // Fallback: get from state manager
                    const activeLayers = window.featureControl._stateManager.getActiveLayers();
                    layerOrder = Array.from(activeLayers.keys());
                }

                layerOrder.forEach(layerId => {
                    let layerConfig = null;

                    // Try to get layer config
                    if (typeof window.featureControl._getLayerConfig === 'function') {
                        layerConfig = window.featureControl._getLayerConfig(layerId);
                    } else if (window.featureControl._stateManager) {
                        layerConfig = window.featureControl._stateManager.getLayerConfig(layerId);
                    }

                    if (layerConfig) {
                        // Get Info content (description and attribution)
                        const descFormatted = formatHtmlToText(layerConfig.description || '');
                        const attrFormatted = formatHtmlToText(layerConfig.attribution || layerConfig.source || '');
                        const infoContent = {
                            description: descFormatted,
                            attribution: attrFormatted
                        };

                        // Get Legend content
                        const legendFormatted = formatHtmlToText(layerConfig.legend || '');
                        const legendContent = {
                            legendImage: layerConfig.legendImage || null,
                            legend: legendFormatted
                        };

                        // Get Features content
                        const featuresContent = getFeatureInfo(layerId, layerConfig, window.featureControl._stateManager);

                        layers.push({
                            layerId: layerId,
                            layerConfig: layerConfig,
                            title: layerConfig.title || layerId,
                            info: infoContent,
                            legend: legendContent,
                            features: featuresContent
                        });
                    }
                });
            }

            // Fallback: try to get from layer control
            if (layers.length === 0 && window.layerControl && window.layerControl._config) {
                const config = window.layerControl._config;
                const groups = config.groups || config.layers || [];

                groups.forEach(group => {
                    if (group.title || group.id) {
                        const descFormatted = formatHtmlToText(group.description || '');
                        const attrFormatted = formatHtmlToText(group.attribution || group.source || '');
                        const legendFormatted = formatHtmlToText(group.legend || '');
                        layers.push({
                            layerId: group.id || group.title,
                            layerConfig: group,
                            title: group.title || group.id,
                            info: {
                                description: descFormatted,
                                attribution: attrFormatted
                            },
                            legend: {
                                legendImage: group.legendImage || null,
                                legend: legendFormatted
                            },
                            features: null // Can't get features from layer control alone
                        });
                    }
                });
            }
        } catch (e) {
            console.warn('Failed to get layer information', e);
        }

        return layers;
    }

    /**
     * Fallback legend page drawing method
     * @param {jsPDF} doc - jsPDF document instance
     * @param {number} widthMm - PDF width in mm
     * @param {number} heightMm - PDF height in mm
     * @param {string} overlayDataUrl - Legend overlay data URL
     * @param {number} overlayWidthMm - Overlay width in mm
     * @param {number} overlayHeightMm - Overlay height in mm
     */
    _drawLegendPageFallback(doc, widthMm, heightMm, overlayDataUrl, overlayWidthMm, overlayHeightMm) {
        // Draw header
        doc.setFontSize(24);
        doc.text('Legend', 10, 20);

        // Draw title
        if (this._title && this._title.trim()) {
            const titleText = this._title.replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]*>/g, '');
            doc.setFontSize(14);
            doc.text(titleText, 10, 35);
        }

        // Draw description
        if (this._description && this._description.trim()) {
            doc.setFontSize(10);
            const splitDesc = doc.splitTextToSize(this._description, widthMm - 20);
            doc.text(splitDesc, 10, 45);
        }

        // Draw legend overlay if available
        if (overlayDataUrl) {
            const maxWidth = widthMm - 20;
            const scale = Math.min(1, maxWidth / overlayWidthMm);
            const imgWidth = overlayWidthMm * scale;
            const imgHeight = overlayHeightMm * scale;
            doc.addImage(overlayDataUrl, 'PNG', 10, 60, imgWidth, imgHeight);
        }
    }

    /**
     * Generate footer HTML using pdf-layout.html template
     * @param {number} widthMm - PDF width in mm
     * @param {number} heightMm - PDF height in mm
     * @param {string} qrDataUrl - QR code data URL
     * @param {string} shareUrl - Share URL
     * @param {string} attributionText - Attribution text
     * @param {Object} targetCenter - Center coordinates {lat, lng}
     * @param {number} zoom - Map zoom level
     * @param {number} bearing - Map bearing in degrees (0 = north up)
     * @param {number} pitch - Map pitch in degrees (0 = top-down view)
     * @param {number} dpi - DPI
     * @returns {Promise<string>} Data URL of rendered footer
     */
    async _generateFooterHTML(widthMm, heightMm, qrDataUrl, shareUrl, attributionText, targetCenter, zoom, bearing, pitch, dpi) {
        try {
            // Load the PDF layout template
            const templateResponse = await fetch('pdf-layout.html');
            if (!templateResponse.ok) {
                console.warn('Failed to load pdf-layout.html template, using fallback');
                return null;
            }
            const templateHtml = await templateResponse.text();

            // Parse template and extract footer structure and styles
            const parser = new DOMParser();
            const templateDoc = parser.parseFromString(templateHtml, 'text/html');
            const footerBox = templateDoc.querySelector('.footer-box');

            if (!footerBox) {
                console.warn('Footer box not found in template');
                return null;
            }

            // Extract all styles from the template
            const templateStyles = templateDoc.querySelectorAll('style');
            const styleText = Array.from(templateStyles).map(s => s.textContent).join('\n');

            // Create a temporary container for the footer
            const footerContainer = document.createElement('div');
            footerContainer.style.position = 'fixed';
            footerContainer.style.left = '-9999px';
            footerContainer.style.top = '0';
            footerContainer.style.width = `${widthMm}mm`;
            footerContainer.style.backgroundColor = 'transparent';
            footerContainer.style.overflow = 'visible';
            footerContainer.style.fontFamily = "'Open Sans', sans-serif";

            // Inject styles
            const styleEl = document.createElement('style');
            styleEl.textContent = styleText;
            footerContainer.appendChild(styleEl);

            // Clone the footer structure
            const footerClone = footerBox.cloneNode(true);

            // Remove absolute positioning to allow proper measurement
            footerClone.style.position = 'relative';
            footerClone.style.bottom = 'auto';
            footerClone.style.left = 'auto';
            footerClone.style.right = 'auto';

            // Populate with actual data
            const qrCodeEl = footerClone.querySelector('.qr-code');
            if (qrCodeEl && qrDataUrl) {
                qrCodeEl.innerHTML = '';
                const qrImg = document.createElement('img');
                qrImg.src = qrDataUrl;
                qrImg.style.width = '100%';
                qrImg.style.height = '100%';
                qrImg.style.objectFit = 'contain';
                qrCodeEl.appendChild(qrImg);
            }

            // Date
            const dateEl = footerClone.querySelector('.date-text');
            if (dateEl) {
                const date = new Date();
                dateEl.textContent = date.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                });
            }

            // Title - preserve HTML line breaks
            const titleEl = footerClone.querySelector('.text-title');
            if (titleEl) {
                const titleText = (this._title || 'Map').replace(/<br\s*\/?>/gi, '<br>');
                titleEl.innerHTML = titleText;
            }

            // Description
            const descEl = footerClone.querySelector('.text-description');
            if (descEl) {
                const descriptionText = this._description && this._description.trim() !== ''
                    ? this._description
                    : this._descriptionInput.placeholder;
                descEl.textContent = descriptionText || '';
            }

            // Attribution
            const dataEl = footerClone.querySelector('.text-data');
            if (dataEl && attributionText) {
                dataEl.textContent = `Data Sources: ${attributionText}`;
            }

            // URL
            const urlEl = footerClone.querySelector('.text-url');
            if (urlEl && shareUrl) {
                urlEl.textContent = shareUrl;
                urlEl.style.opacity = '0.3';
            }

            // Scale bar
            const scaleBarVisual = footerClone.querySelector('.scale-bar-visual');
            const scaleBarLabel = footerClone.querySelector('.scale-bar-label');
            if (scaleBarVisual && scaleBarLabel && targetCenter) {
                const scaleInfo = this._calculateMapScale(zoom, targetCenter.lat, dpi);
                const scaleWidthMm = scaleInfo.widthMm;
                scaleBarVisual.style.width = `${scaleWidthMm}mm`;
                if (scaleBarLabel) {
                    scaleBarLabel.textContent = `${scaleInfo.distance} ${scaleInfo.unit}`;
                }
            }

            // North arrow - apply rotation and tilt using CSS transforms
            const northArrowCross = footerClone.querySelector('.north-arrow-cross');

            if (northArrowCross && bearing !== undefined) {
                // Apply rotation based on bearing
                // Mapbox bearing: 0 = north up, positive = clockwise
                // CSS rotation: positive = clockwise, so negate bearing
                let transform = `rotate(${-bearing}deg)`;

                // Apply tilt/perspective based on pitch
                if (pitch !== undefined && pitch > 0) {
                    // Apply 3D rotation around X-axis to show pitch
                    // Use a more subtle transformation that keeps the cross visible
                    transform += ` rotateX(${pitch * 0.7}deg)`;
                }

                northArrowCross.style.transform = transform;
            }

            // Append footer to container
            footerContainer.appendChild(footerClone);
            document.body.appendChild(footerContainer);

            // Wait for rendering and image loading
            await new Promise(resolve => requestAnimationFrame(resolve));
            await new Promise(resolve => requestAnimationFrame(resolve));

            // Wait for images to load
            const images = footerClone.querySelectorAll('img');
            if (images.length > 0) {
                await Promise.all(Array.from(images).map(img => {
                    if (img.complete) return Promise.resolve();
                    return new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = resolve; // Continue even if image fails
                        setTimeout(resolve, 1000); // Timeout after 1s
                    });
                }));
            }

            await new Promise(resolve => setTimeout(resolve, 200));

            // Render to canvas using html2canvas
            const html2canvas = (await import('html2canvas')).default;

            // Get actual footer dimensions
            const footerRect = footerClone.getBoundingClientRect();

            // Convert mm to pixels at the target DPI for scaling
            const mmToPx = dpi / 25.4;
            const targetWidthPx = widthMm * mmToPx;

            // Use actual rendered height, but scale appropriately
            const scale = 2; // Higher quality

            const canvas = await html2canvas(footerClone, {
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                scale: scale,
                logging: false,
                useCORS: true,
                width: footerRect.width,
                height: footerRect.height,
                windowWidth: footerRect.width,
                windowHeight: footerRect.height
            });

            // Calculate footer height in mm from the rendered element
            // The footer-box has height: 80mm in the template, but we need actual rendered height
            const computedStyle = window.getComputedStyle(footerClone);
            let footerHeightMm = 80; // Default from template

            // Try to get height from computed style or bounding rect
            if (footerRect.height > 0) {
                // Convert pixels to mm (assuming 96 DPI for screen rendering)
                const screenDpi = 96;
                const pixelsToMm = 25.4 / screenDpi;
                footerHeightMm = footerRect.height * pixelsToMm;
            }

            // Clean up
            document.body.removeChild(footerContainer);

            // Return object with data URL and height
            return {
                dataUrl: canvas.toDataURL('image/png'),
                heightMm: footerHeightMm
            };
        } catch (e) {
            console.error('Failed to generate footer HTML', e);
            return null;
        }
    }

    /**
     * Fallback footer drawing method (legacy)
     */
    _drawFooterFallback(doc, widthMm, heightMm, qrDataUrl, shareUrl, attributionText, targetCenter, zoom, bearing, dpi) {
        // This is a fallback - for now just log a warning
        // In the future, this could implement a simple footer using jsPDF drawing methods
        console.warn('Using fallback footer method - footer may not match template');

        // Calculate footer height
        const footerHeightMm = 30;
        const footerY = heightMm - footerHeightMm;

        // Draw a simple footer background
        doc.setFillColor(0, 0, 0);
        doc.setGState(doc.GState({ opacity: 0.7 }));
        doc.rect(0, footerY, widthMm, footerHeightMm, 'F');
        doc.setGState(doc.GState({ opacity: 1.0 }));

        // Add QR code if available
        if (qrDataUrl) {
            const qrSizeMm = 12;
            doc.addImage(qrDataUrl, 'PNG', 5, footerY + 5, qrSizeMm, qrSizeMm);
        }

        // Add text
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        const titleText = (this._title || 'Map').replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]*>/g, '');
        doc.text(titleText, 20, footerY + 10);

        if (this._description) {
            doc.setFontSize(8);
            doc.text(this._description, 20, footerY + 15);
        }

        if (shareUrl) {
            doc.setFontSize(7);
            doc.text(shareUrl, 20, footerY + 25);
        }
    }

    _canvasToTIFF(canvas) {
        // Minimal TIFF writer: Little Endian, RGB, Uncompressed
        // Based on TIFF 6.0 Specification

        const width = canvas.width;
        const height = canvas.height;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, width, height);
        const rgba = imageData.data;

        // Calculate file size
        // Header: 8 bytes
        // IFD: 2 + 12 entries * 12 bytes + 4 bytes (next IFD) = 2 + 144 + 4 = 150 bytes
        // Image Data: width * height * 3 (RGB)
        // Values for tags larger than 4 bytes:
        // - BitsPerSample: 3 * 2 bytes = 6 bytes
        // - XResolution: 2 * 4 bytes = 8 bytes
        // - YResolution: 2 * 4 bytes = 8 bytes
        // - StripOffsets: 4 bytes (1 strip)
        // - RowsPerStrip: 4 bytes (1 strip) ... wait, value fits in tag if short/long
        // - StripByteCounts: 4 bytes

        // Total data size = 8 + 150 + (W*H*3) + 6 + 8 + 8 = ... roughly

        // We'll write sequentially to a buffer
        const imageSize = width * height * 3;
        const headerSize = 8;
        const ifdSize = 2 + 12 * 12 + 4; // 12 entries
        const valueSize = 6 + 8 + 8; // BitsPerSample, XRes, YRes (resolution is ratio)

        // Total buffer
        const totalSize = headerSize + ifdSize + valueSize + imageSize;
        const buffer = new ArrayBuffer(totalSize);
        const data = new DataView(buffer);
        let offset = 0;

        // Helper to write
        const write2 = (v) => { data.setUint16(offset, v, true); offset += 2; };
        const write4 = (v) => { data.setUint32(offset, v, true); offset += 4; };

        // 1. Header
        write2(0x4949); // "II" Little Endian
        write2(0x002A); // Magic 42
        write4(0x0008); // Offset to first IFD (immediately after header)

        // 2. IFD
        // Offset is now 8
        const numEntries = 12;
        write2(numEntries);

        // Tags need to be sorted!
        // 256: ImageWidth (Short/Long)
        // 257: ImageLength (Short/Long)
        // 258: BitsPerSample (Short, count 3) -> Offset
        // 259: Compression (Short, 1 = None)
        // 262: PhotometricInterpretation (Short, 2 = RGB)
        // 273: StripOffsets (Long, count 1)
        // 277: SamplesPerPixel (Short, 3)
        // 278: RowsPerStrip (Long)
        // 279: StripByteCounts (Long)
        // 282: XResolution (Rational) -> Offset
        // 283: YResolution (Rational) -> Offset
        // 296: ResolutionUnit (Short, 2 = Inch)

        // Pointers
        const ifdStart = 8;
        const ifdEnd = ifdStart + 2 + (numEntries * 12) + 4;
        let valuesOffset = ifdEnd;

        // Function to write a tag
        const writeTag = (tag, type, count, value) => {
            write2(tag);
            write2(type);
            write4(count);
            if (count * (type === 3 ? 2 : 4) > 4) {
                // Value is offset
                write4(valuesOffset);
                return valuesOffset; // Return where to write user data
            } else {
                // Value fits
                if (type === 3) { data.setUint16(offset, value, true); } // Short
                else if (type === 4) { data.setUint32(offset, value, true); } // Long
                offset += 4;
                return 0; // Handled
            }
        };

        // 256 ImageWidth
        writeTag(256, 3, 1, width); // Short

        // 257 ImageLength
        writeTag(257, 3, 1, height); // Short

        // 258 BitsPerSample
        const bitsOffset = valuesOffset;
        writeTag(258, 3, 3, bitsOffset);
        valuesOffset += 6; // 3 * 2 bytes

        // 259 Compression
        writeTag(259, 3, 1, 1); // 1 = None

        // 262 PhotometricInterpretation
        writeTag(262, 3, 1, 2); // 2 = RGB

        // 273 StripOffsets
        // Image data starts after variable values
        const imageOffset = valuesOffset;
        writeTag(273, 4, 1, imageOffset);

        // 277 SamplesPerPixel
        writeTag(277, 3, 1, 3); // 3

        // 278 RowsPerStrip
        writeTag(278, 4, 1, height); // 1 strip for whole image

        // 279 StripByteCounts
        writeTag(279, 4, 1, imageSize);

        // 282 XResolution
        const xResOffset = valuesOffset + (6); // after bits
        writeTag(282, 5, 1, xResOffset); // Rational (2 longs)
        // Update generic valuesOffset tracker, but we know where it is for sequential writing
        // Actually lets keep valuesOffset simple.
        // We have: Bits (6), XRes (8), YRes (8). Order matters in memory? No, just pointers.
        // Let's increment valuesOffset properly.
        valuesOffset += 8;

        // 283 YResolution
        const yResOffset = valuesOffset; // after XRes
        writeTag(283, 5, 1, yResOffset);
        valuesOffset += 8;

        // 296 ResolutionUnit
        writeTag(296, 3, 1, 2); // Inch

        // Next IFD
        write4(0); // 0 = None

        // 3. Values
        offset = ifdEnd;

        // BitsPerSample (8, 8, 8)
        data.setUint16(offset, 8, true); offset += 2;
        data.setUint16(offset, 8, true); offset += 2;
        data.setUint16(offset, 8, true); offset += 2;

        // XResolution
        data.setUint32(offset, 72, true); offset += 4; // Num
        data.setUint32(offset, 1, true); offset += 4;  // Denom

        // YResolution
        data.setUint32(offset, 72, true); offset += 4;
        data.setUint32(offset, 1, true); offset += 4;

        // 4. Image Data
        // Convert RGBA to RGB
        const pixelParams = width * height;
        for (let i = 0; i < pixelParams; i++) {
            data.setUint8(offset++, rgba[i * 4]);     // R
            data.setUint8(offset++, rgba[i * 4 + 1]); // G
            data.setUint8(offset++, rgba[i * 4 + 2]); // B
        }

        return new Uint8Array(buffer);
    }
}

class ExportFrame {
    constructor(map, control) {
        this._map = map;
        this._control = control;
        this._el = document.createElement('div');
        this._el.className = 'map-export-frame';
        this._el.style.position = 'absolute';
        this._el.style.pointerEvents = 'none'; // Make interior pass through events
        this._el.style.userSelect = 'none';

        // Move Handle (top-left) - draggable
        this._moveHandle = document.createElement('div');
        this._moveHandle.className = 'export-move-handle';
        this._moveHandle.style.pointerEvents = 'auto'; // Enable interaction
        this._moveHandle.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 9l-2 2 2 2M9 5l2-2 2 2M15 19l-2 2-2-2M19 9l2 2-2 2"/>
                <circle cx="12" cy="12" r="1"/>
                <path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
            </svg>
        `;
        this._moveHandle.onmousedown = (e) => {
            e.stopPropagation();
            this._startMove(e);
        };
        this._moveHandle.ontouchstart = (e) => {
            e.stopPropagation();
            this._startMove(e);
        };
        this._el.appendChild(this._moveHandle);

        // Edge borders (top, bottom, left, right) - draggable
        const edgeThickness = 8; // Thickness of draggable edge
        ['top', 'bottom', 'left', 'right'].forEach(pos => {
            const edge = document.createElement('div');
            edge.className = `export-edge export-edge-${pos}`;
            edge.style.position = 'absolute';
            edge.style.pointerEvents = 'auto'; // Enable interaction
            edge.style.cursor = pos === 'top' || pos === 'bottom' ? 'ns-resize' : 'ew-resize';

            if (pos === 'top') {
                edge.style.top = '0';
                edge.style.left = '0';
                edge.style.right = '0';
                edge.style.height = `${edgeThickness}px`;
            } else if (pos === 'bottom') {
                edge.style.bottom = '0';
                edge.style.left = '0';
                edge.style.right = '0';
                edge.style.height = `${edgeThickness}px`;
            } else if (pos === 'left') {
                edge.style.top = '0';
                edge.style.left = '0';
                edge.style.bottom = '0';
                edge.style.width = `${edgeThickness}px`;
            } else if (pos === 'right') {
                edge.style.top = '0';
                edge.style.right = '0';
                edge.style.bottom = '0';
                edge.style.width = `${edgeThickness}px`;
            }

            // Make edges draggable for moving the frame
            edge.onmousedown = (e) => {
                e.stopPropagation();
                this._startMove(e);
            };
            edge.ontouchstart = (e) => {
                e.stopPropagation();
                this._startMove(e);
            };
            this._el.appendChild(edge);
        });

        // Corner Resize Handles
        ['nw', 'ne', 'se', 'sw'].forEach(pos => {
            const handle = document.createElement('div');
            handle.className = `export-handle ${pos}`;
            handle.style.pointerEvents = 'auto'; // Enable interaction
            handle.onmousedown = (e) => {
                e.stopPropagation();
                this._startResize(e, pos);
            };
            handle.ontouchstart = (e) => {
                e.stopPropagation();
                this._startResize(e, pos);
            };
            this._el.appendChild(handle);
        });

        this._map.getContainer().appendChild(this._el);

        this._aspectRatio = 1.414; // A4 Landscape
        this._updatePosition();
    }

    remove() {
        this._el.parentNode.removeChild(this._el);
    }

    show() {
        this._el.classList.add('active');
        this._updatePosition();
    }

    hide() {
        this._el.classList.remove('active');
    }

    setAspectRatio(ratio) {
        this._aspectRatio = ratio;
        this._updatePosition();
        // Ensure frame stays within bounds after ratio change
        this._constrainToViewport();
    }

    getBounds() {
        // Convert screen coordinates of frame to LngLatBounds
        const rect = this._el.getBoundingClientRect();
        const mapCanvas = this._map.getCanvas().getBoundingClientRect();

        // Relative to map container
        const p1 = this._map.unproject([
            rect.left - mapCanvas.left,
            rect.top - mapCanvas.top
        ]);
        const p2 = this._map.unproject([
            rect.right - mapCanvas.left,
            rect.bottom - mapCanvas.top
        ]);

        return new mapboxgl.LngLatBounds(p1, p2);
    }

    _updatePosition() {
        const mapContainer = this._map.getContainer();
        const mapRect = mapContainer.getBoundingClientRect();

        // Default size: 60% of map width, height based on ratio
        if (!this._el.style.width || !this._el.style.left) {
            const mapW = mapRect.width;
            const w = mapW * 0.6;
            const h = w / this._aspectRatio;

            // Center the frame initially
            const left = (mapW - w) / 2;
            const top = (mapRect.height - h) / 2;

            this._el.style.width = w + 'px';
            this._el.style.height = h + 'px';
            this._el.style.left = left + 'px';
            this._el.style.top = top + 'px';
        } else {
            // Maintain ratio if triggered by external ratio change
            const w = parseFloat(this._el.style.width);
            const h = w / this._aspectRatio;
            this._el.style.height = h + 'px';

            // Ensure frame stays within viewport bounds
            this._constrainToViewport();
        }
    }

    _constrainToViewport() {
        const mapContainer = this._map.getContainer();
        const mapRect = mapContainer.getBoundingClientRect();
        const frameRect = this._el.getBoundingClientRect();

        let left = parseFloat(this._el.style.left) || 0;
        let top = parseFloat(this._el.style.top) || 0;
        const width = parseFloat(this._el.style.width) || 0;
        const height = parseFloat(this._el.style.height) || 0;

        // Constrain to map container bounds (with padding for handles)
        const handleSize = 12; // Size of resize handles
        const minLeft = -handleSize;
        const minTop = -handleSize;
        const maxLeft = mapRect.width - width + handleSize;
        const maxTop = mapRect.height - height + handleSize;

        left = Math.max(minLeft, Math.min(maxLeft, left));
        top = Math.max(minTop, Math.min(maxTop, top));

        this._el.style.left = left + 'px';
        this._el.style.top = top + 'px';
    }

    _startMove(e) {
        e.preventDefault();
        e.stopPropagation();

        // Support both mouse and touch events
        const isTouch = e.touches && e.touches.length > 0;
        const startX = isTouch ? e.touches[0].clientX : e.clientX;
        const startY = isTouch ? e.touches[0].clientY : e.clientY;

        // Get current position relative to map container
        const mapContainer = this._map.getContainer();
        const mapRect = mapContainer.getBoundingClientRect();
        const frameRect = this._el.getBoundingClientRect();

        // Calculate initial position relative to map container
        const startLeft = frameRect.left - mapRect.left;
        const startTop = frameRect.top - mapRect.top;

        const performMove = (e) => {
            e.preventDefault();
            const currentX = isTouch ? e.touches[0].clientX : e.clientX;
            const currentY = isTouch ? e.touches[0].clientY : e.clientY;

            // Calculate delta from start position
            const dx = currentX - startX;
            const dy = currentY - startY;

            // Calculate new position relative to map container
            let newLeft = startLeft + dx;
            let newTop = startTop + dy;

            // Constrain to viewport
            const width = parseFloat(this._el.style.width) || 0;
            const height = parseFloat(this._el.style.height) || 0;
            const handleSize = 12;

            newLeft = Math.max(-handleSize, Math.min(mapRect.width - width + handleSize, newLeft));
            newTop = Math.max(-handleSize, Math.min(mapRect.height - height + handleSize, newTop));

            this._el.style.left = newLeft + 'px';
            this._el.style.top = newTop + 'px';
        };

        const onUp = () => {
            if (isTouch) {
                document.removeEventListener('touchmove', performMove);
                document.removeEventListener('touchend', onUp);
            } else {
                document.removeEventListener('mousemove', performMove);
                document.removeEventListener('mouseup', onUp);
            }
        };

        if (isTouch) {
            document.addEventListener('touchmove', performMove, { passive: false });
            document.addEventListener('touchend', onUp);
        } else {
            document.addEventListener('mousemove', performMove);
            document.addEventListener('mouseup', onUp);
        }
    }

    _startResize(e, handle) {
        e.preventDefault();
        e.stopPropagation();

        // Support both mouse and touch events
        const isTouch = e.touches && e.touches.length > 0;

        // Get current position relative to map container
        const mapContainer = this._map.getContainer();
        const mapRect = mapContainer.getBoundingClientRect();
        const frameRect = this._el.getBoundingClientRect();

        const startX = isTouch ? e.touches[0].clientX : e.clientX;
        const startY = isTouch ? e.touches[0].clientY : e.clientY;
        const startW = frameRect.width;
        const startH = frameRect.height;
        const startL = frameRect.left - mapRect.left;
        const startT = frameRect.top - mapRect.top;

        const onMove = (e) => {
            e.preventDefault();
            const currentX = isTouch ? e.touches[0].clientX : e.clientX;
            const currentY = isTouch ? e.touches[0].clientY : e.clientY;
            const dx = currentX - startX;
            const dy = currentY - startY;

            let newW = startW;
            let newH = startH;
            let newL = startL;
            let newT = startT;

            if (handle.includes('e')) newW = startW + dx;
            if (handle.includes('w')) { newW = startW - dx; newL = startL + dx; }
            if (handle.includes('s')) newH = startH + dy;
            if (handle.includes('n')) { newH = startH - dy; newT = startT + dy; }

            // Minimum size constraints
            const minSize = 50;
            if (newW < minSize) {
                if (handle.includes('w')) newL = startL + startW - minSize;
                newW = minSize;
            }
            if (newH < minSize) {
                if (handle.includes('n')) newT = startT + startH - minSize;
                newH = minSize;
            }

            // Constrain to viewport
            const handleSize = 12;
            newL = Math.max(-handleSize, Math.min(mapRect.width - newW + handleSize, newL));
            newT = Math.max(-handleSize, Math.min(mapRect.height - newH + handleSize, newT));

            this._el.style.width = newW + 'px';
            this._el.style.height = newH + 'px';
            this._el.style.left = newL + 'px';
            this._el.style.top = newT + 'px';

            // Update Control
            this._aspectRatio = newW / newH;
            this._control._onFrameChange(this._aspectRatio);
        };

        const onUp = () => {
            if (isTouch) {
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onUp);
            } else {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
        };

        if (isTouch) {
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
        } else {
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }
    }
}

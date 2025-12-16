export class MapExportControl {
    constructor() {
        this._map = null;
        this._container = null;
        this._exportPanel = null;
        this._selectedSize = 'A4';
        this._orientation = 'landscape';
        this._format = 'pdf';
        this._rasterQuality = 'medium'; // 'medium' (JPEG) or 'high' (TIFF)
        this._dpi = 96;
        this._frame = null;
        this._isExporting = false;
        this._title = '';
        this._description = '';
        this._titleCustomized = false; // Track if user has manually edited the title
        this._movendHandler = null; // Store handler for cleanup
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

        return this._container;
    }

    onRemove() {
        // Remove event listener
        if (this._map && this._movendHandler) {
            this._map.off('moveend', this._movendHandler);
            this._movendHandler = null;
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


        // Format Selection
        this._exportPanel.appendChild(this._createLabel('Format'));
        const formatContainer = document.createElement('div');
        formatContainer.innerHTML = `
            <label><input type="radio" name="export-format" value="pdf" checked> PDF</label>
            <label><input type="radio" name="export-format" value="geojson"> GeoJSON</label>
        `;
        formatContainer.onchange = (e) => {
            this._format = e.target.value;
            this._updatePanelVisibility();
        };
        this._exportPanel.appendChild(formatContainer);

        // Size Selector
        this._sizeContainer = document.createElement('div');
        this._sizeContainer.appendChild(this._createLabel('Size & DPI'));

        const controlsRow = document.createElement('div');
        controlsRow.style.display = 'flex';
        controlsRow.style.gap = '5px';

        // Size Dropdown
        const sizeSelect = document.createElement('select');
        sizeSelect.style.flex = '2';
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
        dpiSelect.style.flex = '1';
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
        this._exportPanel.appendChild(this._sizeContainer);

        // Dimensions Inputs
        this._dimContainer = document.createElement('div');
        this._dimContainer.style.marginTop = '10px';
        this._widthInput = this._createInput('Width (mm)');
        this._heightInput = this._createInput('Height (mm)');

        // Add event listeners for direct input change
        this._widthInput.input.onchange = () => this._onDimensionsChange();
        this._heightInput.input.onchange = () => this._onDimensionsChange();

        this._dimContainer.appendChild(this._widthInput.container);
        this._dimContainer.appendChild(this._heightInput.container);
        this._exportPanel.appendChild(this._dimContainer);

        // Orientation
        this._orientationContainer = document.createElement('div');
        this._orientationContainer.style.marginTop = '10px';
        this._orientationContainer.innerHTML = `
            <label><input type="radio" name="orientation" value="landscape" checked> Landscape</label>
            <label><input type="radio" name="orientation" value="portrait"> Portrait</label>
        `;
        this._orientationContainer.onchange = (e) => this._onOrientationChange(e.target.value);
        this._exportPanel.appendChild(this._orientationContainer);

        // Raster Quality Selection
        this._qualityContainer = document.createElement('div');
        this._qualityContainer.style.marginTop = '10px';
        this._qualityContainer.appendChild(this._createLabel('Raster Quality'));
        const qualityOptions = document.createElement('div');
        qualityOptions.innerHTML = `
            <label style="margin-right: 10px;"><input type="radio" name="raster-quality" value="medium" checked> Medium</label>
            <label><input type="radio" name="raster-quality" value="high"> High</label>
        `;
        qualityOptions.onchange = (e) => {
            this._rasterQuality = e.target.value;
        };
        this._qualityContainer.appendChild(qualityOptions);
        this._exportPanel.appendChild(this._qualityContainer);

        // Title Input
        this._titleContainer = document.createElement('div');
        this._titleContainer.style.marginTop = '10px';
        this._titleContainer.appendChild(this._createLabel('Title'));
        const titleInput = document.createElement('textarea');
        titleInput.rows = 2;
        titleInput.style.width = '100%';
        titleInput.style.padding = '5px';
        titleInput.style.marginTop = '5px';
        titleInput.style.boxSizing = 'border-box';
        titleInput.style.resize = 'vertical';
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
        this._descriptionContainer.style.marginTop = '10px';
        this._descriptionContainer.appendChild(this._createLabel('Description'));
        const descriptionTextarea = document.createElement('textarea');
        descriptionTextarea.style.width = '100%';
        descriptionTextarea.style.padding = '5px';
        descriptionTextarea.style.marginTop = '5px';
        descriptionTextarea.style.boxSizing = 'border-box';
        descriptionTextarea.style.minHeight = '60px';
        descriptionTextarea.style.resize = 'vertical';
        descriptionTextarea.placeholder = 'Loading...';
        descriptionTextarea.onchange = (e) => { this._description = e.target.value; };
        descriptionTextarea.oninput = (e) => { this._description = e.target.value; };
        this._descriptionInput = descriptionTextarea;
        this._descriptionContainer.appendChild(descriptionTextarea);
        this._exportPanel.appendChild(this._descriptionContainer);

        // Export Button
        const doExportBtn = document.createElement('button');
        doExportBtn.textContent = 'Export';
        doExportBtn.style.cssText = `
            width: 100%;
            margin-top: 10px;
            padding: 5px;
            background: #333;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        doExportBtn.onclick = () => this._doExport();
        this._exportPanel.appendChild(doExportBtn);

        this._container.appendChild(this._exportPanel);

        // Initial values
        this._onSizeChange('A4');
    }

    _createLabel(text) {
        const label = document.createElement('div');
        label.textContent = text;
        label.style.fontWeight = 'bold';
        label.style.marginTop = '5px';
        return label;
    }

    _createInput(placeholder) {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.marginBottom = '5px';
        const label = document.createElement('span');
        label.textContent = placeholder;
        label.style.fontSize = '12px';
        const input = document.createElement('input');
        input.type = 'number';
        input.style.width = '70px';
        div.appendChild(label);
        div.appendChild(input);
        return { container: div, input: input };
    }

    _togglePanel() {
        this._exportPanel.classList.toggle('hidden');
        if (!this._exportPanel.classList.contains('hidden')) {
            if (this._format !== 'geojson') {
                this._frame.show();
                this._updateFrameFromInputs(); // Ensure frame matches current inputs
                // Load default title and description
                this._loadDefaultTitleAndDescription();
            }
        } else {
            this._frame.hide();
        }
    }

    async _loadDefaultTitleAndDescription() {
        // Set default description
        const date = new Date();
        const timestamp = date.toLocaleString('en-GB', { 
            day: 'numeric', 
            month: 'long', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        this._description = `PDF generated on ${timestamp}`;
        this._descriptionInput.value = this._description;

        // Reset customization flag when loading defaults
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

    _updatePanelVisibility() {
        if (this._format === 'geojson') {
            this._sizeContainer.style.display = 'none';
            this._dimContainer.style.display = 'none';
            this._orientationContainer.style.display = 'none';
            this._qualityContainer.style.display = 'none';
            this._titleContainer.style.display = 'none';
            this._descriptionContainer.style.display = 'none';
            this._frame.hide();
        } else {
            this._sizeContainer.style.display = 'block';
            this._dimContainer.style.display = 'block';
            this._orientationContainer.style.display = 'block';
            this._qualityContainer.style.display = 'block';
            this._titleContainer.style.display = 'block';
            this._descriptionContainer.style.display = 'block';
            this._frame.show();
            this._updateFrameFromInputs();
        }
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

    async _doExport() {
        if (this._isExporting) return;
        this._isExporting = true;
        const btn = this._exportPanel.querySelector('button');
        const oldText = btn.textContent;
        btn.textContent = 'Processing...';

        try {
            if (this._format === 'geojson') {
                this._exportGeoJSON();
            } else {
                await this._exportPDF();
            }
        } catch (e) {
            console.error('Export failed', e);
            alert('Export failed: ' + e.message);
        } finally {
            this._isExporting = false;
            btn.textContent = oldText;
        }
    }

    _exportGeoJSON() {
        const features = this._map.queryRenderedFeatures();
        const geojson = {
            type: 'FeatureCollection',
            features: features
        };
        const blob = new Blob([JSON.stringify(geojson)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'map-export.geojson';
        a.click();
        URL.revokeObjectURL(url);
    }

    async _exportPDF() {
        const { jsPDF } = await import('jspdf');

        const widthMm = parseFloat(this._widthInput.input.value);
        const heightMm = parseFloat(this._heightInput.input.value);
        const dpi = this._dpi;

        // Footer configuration - will be calculated based on content
        const marginMm = 5;

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

        // No full footer bar - overlay boxes will be drawn on top of map
        // Map uses full page height
        const mapHeightMm = heightMm;
        const targetWidth = Math.round((widthMm * dpi) / 25.4);
        const targetHeight = Math.round((mapHeightMm * dpi) / 25.4);

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
        let qrDataUrl = null;
        try {
            qrDataUrl = await this._getQRCodeDataUrl(shareUrl);
        } catch (e) {
            console.warn('Failed to generate QR for PDF', e);
        }

        // Capture Overlay (Feature Control Layers)
        let overlayDataUrl = null;
        let overlayWidthMm = 0;
        let overlayHeightMm = 0;

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

            } catch (e) {
                console.warn('Failed to capture overlay', e);
            } finally {
                // Restore original panel visibility if it was hidden
                if (wasHidden && parentPanel) {
                    parentPanel.style.display = originalDisplay;
                }
            }
        }

        return new Promise((resolve, reject) => {

            // Function to capture after resize and move
            const capture = () => {
                try {
                    const canvas = this._map.getCanvas();
                    const imgData = canvas.toDataURL('image/png');

                    const doc = new jsPDF({
                        orientation: widthMm > heightMm ? 'l' : 'p',
                        unit: 'mm',
                        format: [widthMm, heightMm]
                    });

                    // Draw Map
                    if (this._rasterQuality === 'high') {
                        // High Quality = TIFF
                        try {
                            const tiffData = this._canvasToTIFF(canvas);
                            doc.addImage(tiffData, 'TIFF', 0, 0, widthMm, mapHeightMm);
                        } catch (err) {
                            console.error('TIFF Generation failed, falling back to PNG', err);
                            doc.addImage(imgData, 'PNG', 0, 0, widthMm, mapHeightMm);
                        }
                    } else {
                        // Medium Quality = JPEG 90
                        const jpegData = canvas.toDataURL('image/jpeg', 0.90);
                        doc.addImage(jpegData, 'JPEG', 0, 0, widthMm, mapHeightMm);
                    }

                    // Draw Overlay (Top Left)
                    if (overlayDataUrl && overlayWidthMm > 0 && overlayHeightMm > 0) {
                        const overlayX = marginMm + 2; // Slight indent from margin
                        const overlayY = marginMm + 2;

                        // Check if it fits
                        let drawW = overlayWidthMm;
                        let drawH = overlayHeightMm;

                        // Limit height to map height - margin
                        const maxHeight = mapHeightMm - (marginMm * 2);
                        if (drawH > maxHeight) {
                            const ratio = maxHeight / drawH;
                            drawH = maxHeight;
                            drawW = drawW * ratio;
                        }

                        doc.addImage(overlayDataUrl, 'PNG', overlayX, overlayY, drawW, drawH);
                    }

                    // Draw Footer with new layout
                    const title = this._title || 'Map';
                    const description = this._description || '';
                    
                    // Footer layout constants
                    const qrSize = 12; // QR code size in mm
                    const qrMargin = 2; // Margin around QR
                    const lineHeight = 2; // Reduced line height in mm
                    const titleLineHeight = 3.2; // Larger line height for title to prevent overlapping
                    const elementGap = 1; // Reduced gap between elements in mm
                    const titleFontSize = 10;
                    const descFontSize = 8;
                    const dataFontSize = 7;
                    const urlFontSize = 7;
                    const dateFontSize = 6;
                    const textBoxPadding = 3.5; // 10px ≈ 3.5mm padding inside text box
                    
                    // Calculate text dimensions - measure actual widths
                    let maxTextWidth = 0;
                    let textElements = [];
                    let totalTextHeight = 0;
                    
                    // Helper to measure text width
                    const measureTextWidth = (text, fontSize, bold) => {
                        doc.setFontSize(fontSize);
                        doc.setFont(undefined, bold ? 'bold' : 'normal');
                        return doc.getTextWidth(text);
                    };
                    
                    // Helper to process HTML and split text (handles <br> tags)
                    const processHtmlText = (htmlText, maxWidth, fontSize, bold) => {
                        // Strip HTML tags except <br> and convert <br> to line breaks
                        // Simple HTML processing: split by <br> tags (case insensitive)
                        const parts = htmlText.split(/<br\s*\/?>/i);
                        let allLines = [];
                        
                        doc.setFontSize(fontSize);
                        doc.setFont(undefined, bold ? 'bold' : 'normal');
                        
                        parts.forEach((part, index) => {
                            // Strip any remaining HTML tags
                            const cleanText = part.replace(/<[^>]*>/g, '').trim();
                            if (cleanText) {
                                // Split each part by width if needed
                                const wrappedLines = doc.splitTextToSize(cleanText, maxWidth);
                                allLines = allLines.concat(wrappedLines);
                            }
                            // Add explicit line break after each <br> (except the last one)
                            if (index < parts.length - 1 && cleanText) {
                                // Line break is already handled by separate array elements
                            }
                        });
                        
                        return allLines;
                    };
                    
                    // Calculate available width for text (accounting for QR code on left)
                    const qrCodeWithPadding = qrSize + textBoxPadding;
                    const availableTextWidth = widthMm * 0.7 - qrCodeWithPadding - textBoxPadding;
                    
                    // Title (can wrap and supports HTML)
                    if (title) {
                        const maxTitleWidth = availableTextWidth;
                        const titleLines = processHtmlText(title, maxTitleWidth, titleFontSize, true);
                        const titleWidth = Math.max(...titleLines.map(line => measureTextWidth(line, titleFontSize, true)));
                        textElements.push({ 
                            text: titleLines, 
                            fontSize: titleFontSize, 
                            bold: true,
                            width: titleWidth,
                            isTitle: true // Mark as title for special line height
                        });
                        totalTextHeight += titleLines.length * titleLineHeight;
                    }
                    
                    // Description (can wrap and supports HTML)
                    if (description) {
                        if (textElements.length > 0) totalTextHeight += elementGap;
                        const maxDescWidth = availableTextWidth;
                        const descLines = processHtmlText(description, maxDescWidth, descFontSize, false);
                        const descWidth = Math.max(...descLines.map(line => measureTextWidth(line, descFontSize, false)));
                        textElements.push({ 
                            text: descLines, 
                            fontSize: descFontSize, 
                            bold: false,
                            width: descWidth
                        });
                        totalTextHeight += descLines.length * lineHeight;
                    }
                    
                    // Data Sources (single line - no wrapping)
                    if (attributionText) {
                        if (textElements.length > 0) totalTextHeight += elementGap;
                        const cleanAttrib = attributionText.replace(/\|/g, '\t');
                        const dataSourcesText = `Data Sources: ${cleanAttrib}`;
                        const dataWidth = measureTextWidth(dataSourcesText, dataFontSize, false);
                        textElements.push({ 
                            text: [dataSourcesText], 
                            fontSize: dataFontSize, 
                            bold: false,
                            width: dataWidth
                        });
                        totalTextHeight += lineHeight;
                    }
                    
                    // URL (single line - no wrapping)
                    if (textElements.length > 0) totalTextHeight += elementGap;
                    const urlWidth = measureTextWidth(shareUrl, urlFontSize, false);
                    textElements.push({ 
                        text: [shareUrl], 
                        fontSize: urlFontSize, 
                        bold: false,
                        width: urlWidth
                    });
                    totalTextHeight += lineHeight;
                    
                    // Find maximum width needed for text
                    maxTextWidth = Math.max(...textElements.map(e => e.width));
                    maxTextWidth = Math.min(maxTextWidth, availableTextWidth);
                    
                    // Calculate box dimensions including QR code
                    // QR code will be at bottom left, text will be to the right of it
                    // Box width needs to accommodate both QR code and text side by side
                    // Add 50px (≈13.23mm at 96dpi) extra width for better text fit
                    const extraWidthMm = 50 * 25.4 / 96; // Convert 50px to mm
                    const textBoxWidth = qrCodeWithPadding + maxTextWidth + textBoxPadding + extraWidthMm;
                    
                    // Box height needs to accommodate text height OR QR code height + date, whichever is taller
                    const qrAndDateHeight = qrSize + lineHeight + elementGap; // QR code + date above it
                    const textBoxHeight = Math.max(totalTextHeight, qrAndDateHeight) + (textBoxPadding * 2) - 2;
                    
                    // Position box anchored to bottom left with no margin
                    const textBoxX = 0;
                    const textBoxY = heightMm - textBoxHeight;
                    
                    // Draw semi-transparent black box
                    const gState = doc.GState({ opacity: 0.7 });
                    doc.setGState(gState);
                    doc.setFillColor(0, 0, 0); // Black
                    doc.rect(textBoxX, textBoxY, textBoxWidth, textBoxHeight, 'F');
                    // Reset to full opacity for text
                    const gStateFull = doc.GState({ opacity: 1.0 });
                    doc.setGState(gStateFull);
                    
                    // Draw content inside box (from bottom to top, anchored to bottom left)
                    // In jsPDF, Y=0 is top, Y increases downward
                    // textBoxY is top of box, textBoxY + textBoxHeight is bottom of box (which is heightMm)
                    const bottomOfBox = textBoxY + textBoxHeight; // This equals heightMm
                    doc.setTextColor(255, 255, 255);
                    
                    // Draw QR Code at bottom left inside the box
                    const qrX = textBoxX + textBoxPadding;
                    const qrY = bottomOfBox - textBoxPadding - qrSize;
                    
                    if (qrDataUrl) {
                        doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
                    }
                    
                    // Date above QR code (inside box)
                    const date = new Date();
                    const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
                    doc.setFontSize(dateFontSize);
                    doc.setFont(undefined, 'normal');
                    const dateX = qrX;
                    const dateY = qrY - elementGap;
                    doc.text(dateStr, dateX, dateY, { align: 'left', maxWidth: qrSize });
                    
                    // Position text to the right of QR code, starting from bottom padding
                    // Text X position starts after QR code + gap
                    const textStartX = qrX + qrSize + textBoxPadding;
                    let currentY = bottomOfBox - textBoxPadding;
                    
                    // Draw elements in reverse order (URL first at bottom, then up to Title at top)
                    for (let elemIdx = textElements.length - 1; elemIdx >= 0; elemIdx--) {
                        const elem = textElements[elemIdx];
                        doc.setFontSize(elem.fontSize);
                        doc.setFont(undefined, elem.bold ? 'bold' : 'normal');
                        
                        // Use title-specific line height for title, regular line height for others
                        const elemLineHeight = elem.isTitle ? titleLineHeight : lineHeight;
                        
                        // Draw lines for this element (from bottom to top)
                        for (let lineIdx = elem.text.length - 1; lineIdx >= 0; lineIdx--) {
                            // Position baseline directly at currentY - no offset
                            // Text will naturally extend above baseline, descenders below
                            doc.text(elem.text[lineIdx], textStartX, currentY, { align: 'left' });
                            // Move up for next line (decrease Y) using element-specific line height
                            currentY -= elemLineHeight;
                        }
                        
                        // Add gap between elements (except after last element at top)
                        if (elemIdx > 0) {
                            currentY -= elementGap;
                        }
                    }

                    // Generate filename from title, sanitizing invalid characters
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
                    doc.save(filename);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };

            // Set new size - MATCHING MAP AREA ONLY
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

        // Move Handle (top-left, 50x50px)
        this._moveHandle = document.createElement('div');
        this._moveHandle.className = 'export-move-handle';
        this._moveHandle.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 9l-2 2 2 2M9 5l2-2 2 2M15 19l-2 2-2-2M19 9l2 2-2 2"/>
                <circle cx="12" cy="12" r="1"/>
                <path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
            </svg>
        `;
        this._moveHandle.onmousedown = (e) => this._startMove(e);
        this._moveHandle.ontouchstart = (e) => this._startMove(e);
        this._el.appendChild(this._moveHandle);

        // Corner Resize Handles
        ['nw', 'ne', 'se', 'sw'].forEach(pos => {
            const handle = document.createElement('div');
            handle.className = `export-handle ${pos}`;
            handle.onmousedown = (e) => this._startResize(e, pos);
            handle.ontouchstart = (e) => this._startResize(e, pos);
            this._el.appendChild(handle);
        });

        // Make frame pass through events (except to handles)
        this._el.onmousedown = (e) => {
            // Only prevent default if clicking on the frame border itself
            // Let map controls work normally
            if (e.target === this._el) {
                e.stopPropagation();
            }
        };
        this._el.ontouchstart = (e) => {
            if (e.target === this._el) {
                e.stopPropagation();
            }
        };

        this._map.getContainer().appendChild(this._el);

        this._aspectRatio = 1.414; // A4 Landscape
        this._updatePosition();

        // Update on map move to keep geographic position?
        // Or is the frame "Sticky" to the screen or the map?
        // User: "export from this frame". Usually frame overlays are screen-space or map-space?
        // If map moves, frame usually stays on screen (like a viewport).
        // BUT user said "movable frame selector on top of the map".
        // If I Pan the map, does the frame move with it? 
        // Usually, these tools allow you to Pan the Map *under* the Frame to line up the shot.
        // So the Frame stays checking screen center.
        // BUT the user asked for a "movable frame".
        // Let's implement: Frame is an element on top of the map. It stays in screen coordinates.
        // Moving the map changes what's inside. Moving the frame changes the crop on screen.
        // This is flexible.
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
        // Default size: 60% of map width, height based on ratio
        if (!this._el.style.width) {
            const mapW = this._map.getContainer().clientWidth;
            const w = mapW * 0.6;
            const h = w / this._aspectRatio;
            this._el.style.width = w + 'px';
            this._el.style.height = h + 'px';
        } else {
            // Maintain ratio if triggered by external ratio change, or just center?
            // If resize triggered from input update, we need to respect the new ratio.
            // Keep current width, update height.
            const w = parseFloat(this._el.style.width);
            const h = w / this._aspectRatio;
            this._el.style.height = h + 'px';
        }
    }

    _startMove(e) {
        e.preventDefault();
        e.stopPropagation();

        // Support both mouse and touch events
        const isTouch = e.touches && e.touches.length > 0;
        const startX = isTouch ? e.touches[0].clientX : e.clientX;
        const startY = isTouch ? e.touches[0].clientY : e.clientY;

        // Ensure transform is removed and we're using absolute positioning
        if (getComputedStyle(this._el).transform !== 'none') {
            this._el.style.transform = 'none';
            this._el.style.left = this._el.offsetLeft + 'px';
            this._el.style.top = this._el.offsetTop + 'px';
        }

        const finalStartLeft = this._el.offsetLeft;
        const finalStartTop = this._el.offsetTop;

        const performMove = (e) => {
            const currentX = isTouch ? e.touches[0].clientX : e.clientX;
            const currentY = isTouch ? e.touches[0].clientY : e.clientY;
            const dx = currentX - startX;
            const dy = currentY - startY;
            this._el.style.left = (finalStartLeft + dx) + 'px';
            this._el.style.top = (finalStartTop + dy) + 'px';
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

        // Ensure transform is gone
        if (getComputedStyle(this._el).transform !== 'none') {
            this._el.style.transform = 'none';
            this._el.style.left = this._el.offsetLeft + 'px';
            this._el.style.top = this._el.offsetTop + 'px';
        }

        const startX = isTouch ? e.touches[0].clientX : e.clientX;
        const startY = isTouch ? e.touches[0].clientY : e.clientY;
        const startW = this._el.offsetWidth;
        const startH = this._el.offsetHeight;
        const startL = this._el.offsetLeft;
        const startT = this._el.offsetTop;

        const onMove = (e) => {
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

            if (newW < 50) newW = 50;
            if (newH < 50) newH = 50;

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

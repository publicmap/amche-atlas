export class MapExportControl {
    constructor() {
        this._map = null;
        this._container = null;
        this._exportPanel = null;
        this._selectedSize = 'A4';
        this._orientation = 'landscape';
        this._format = 'pdf';
        this._dpi = 96;
        this._frame = null;
        this._isExporting = false;
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

        return this._container;
    }

    onRemove() {
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
            }
        } else {
            this._frame.hide();
        }
    }

    _updatePanelVisibility() {
        if (this._format === 'geojson') {
            this._sizeContainer.style.display = 'none';
            this._dimContainer.style.display = 'none';
            this._orientationContainer.style.display = 'none';
            this._frame.hide();
        } else {
            this._sizeContainer.style.display = 'block';
            this._dimContainer.style.display = 'block';
            this._orientationContainer.style.display = 'block';
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

        // Footer configuration
        const footerHeightMm = 15;
        const marginMm = 5;

        // Calculate Target Pixels for Map (excluding footer)
        const mapHeightMm = heightMm - footerHeightMm;
        const targetWidth = Math.round((widthMm * dpi) / 25.4);
        const targetHeight = Math.round((mapHeightMm * dpi) / 25.4);

        // Capture Frame State for manual calculation (before hiding/resizing)
        const frameRect = this._frame._el.getBoundingClientRect();
        const mapRect = this._map.getContainer().getBoundingClientRect();

        // Calculate desired center (geographic) based on frame center
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

        // Get Data for Footer
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

        const featurePanelLayers = document.querySelector('.map-feature-panel-layers');
        if (featurePanelLayers && featurePanelLayers.offsetHeight > 0) {
            try {
                // Dynamically import html2canvas
                const html2canvas = (await import('html2canvas')).default;

                // Clone to body to ensure we capture independent of current scroll/display clipping if needed,
                // but html2canvas usually handles that. However, to ensure clean capture with transparent background styling for PDF:
                // We'll capture the actual element as it is "WYSIWYG".
                // Issue: If it's inside a scrolling container, we might only get the visible part.
                // The user usually wants the "content".
                // If the user wants the WHOLE content (scrolled or not), we might need to clone and expand height.
                // Let's assume WYSIWYG for now (what's visible or the element itself).
                // Actually, 'mirrors the content...'. If it's a long list, putting it on PDF might cover the whole map.
                // Let's stick to capturing the element.

                // Create a clone to modify styling for capture if needed (e.g. transparent background if panel has one)
                // The current panel has a white background.
                // We probably want to keep the white background for readability on the map.

                const canvas = await html2canvas(featurePanelLayers, {
                    backgroundColor: '#ffffff', // Force white background for visibility on PDF
                    scale: 2, // Better quality
                    logging: false,
                    useCORS: true
                });

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
                    doc.addImage(imgData, 'PNG', 0, 0, widthMm, mapHeightMm);

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

                    // Draw Footer Background
                    doc.setFillColor(0, 0, 0); // Black
                    doc.rect(0, mapHeightMm, widthMm, footerHeightMm, 'F');

                    // Draw QR Code
                    if (qrDataUrl) {
                        const qrSize = footerHeightMm - 2; // 1mm padding
                        doc.addImage(qrDataUrl, 'PNG', marginMm, mapHeightMm + 1, qrSize, qrSize);

                        // Link URL
                        doc.setTextColor(255, 255, 255);
                        doc.setFontSize(8);
                        doc.text('Generated from:', marginMm + qrSize + 3, mapHeightMm + 5);
                        doc.setFontSize(6);

                        const splitUrl = doc.splitTextToSize(shareUrl, widthMm / 3);
                        doc.text(splitUrl, marginMm + qrSize + 3, mapHeightMm + 8);
                    }

                    // Draw Attribution
                    if (attributionText) {
                        doc.setTextColor(255, 255, 255);
                        doc.setFontSize(6);
                        // Right aligned
                        const attribX = widthMm - marginMm;
                        const attribY = mapHeightMm + (footerHeightMm / 2);

                        // We need to parse HTML from attribution if it contains links (it usually does)
                        // jsPDF doesn't render HTML easily with .text(). 
                        // Stripping tags for now as requested "text".
                        // attribCtrl.innerText usually gives visible text.
                        const cleanAttrib = attributionText.replace(/\|/g, '    '); // Replace pipes with spaces

                        doc.text(cleanAttrib, attribX, attribY, { align: 'right', baseline: 'middle', maxWidth: widthMm / 2 });
                    }

                    doc.save('map-export.pdf');
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
                qr.size = 128;
                qr.style.position = 'fixed';
                qr.style.top = '-9999px';
                qr.style.left = '-9999px'; // Ensure it's off-screen
                document.body.appendChild(qr);

                // Wait for the component to render its initial state
                if (qr.updateComplete) {
                    await qr.updateComplete;
                }

                // Additional small polling to ensure internal elements (Shadow DOM) are ready
                // sometimes updateComplete is for the property update, but internal rendering might tick once more
                let attempts = 0;
                const maxAttempts = 50; // 5 seconds

                const checkRender = () => {
                    const shadow = qr.shadowRoot;
                    if (shadow) {
                        const svg = shadow.querySelector('svg');
                        const canvas = shadow.querySelector('canvas'); // Check for canvas just in case

                        if (svg || canvas) {
                            console.log('QR Element found (SVG/Canvas)');

                            // Let it breathe a frame to ensure painting
                            requestAnimationFrame(() => {
                                try {
                                    const outCanvas = document.createElement('canvas');
                                    outCanvas.width = 128;
                                    outCanvas.height = 128;
                                    const ctx = outCanvas.getContext('2d');
                                    ctx.fillStyle = 'white';
                                    ctx.fillRect(0, 0, 128, 128); // White background

                                    if (svg) {
                                        const svgData = new XMLSerializer().serializeToString(svg);
                                        const img = new Image();
                                        img.onload = () => {
                                            ctx.drawImage(img, 0, 0);
                                            const dataUrl = outCanvas.toDataURL('image/png');
                                            document.body.removeChild(qr);
                                            resolve(dataUrl);
                                        };
                                        img.onerror = (e) => {
                                            console.error('QR IDL Load Error', e);
                                            document.body.removeChild(qr);
                                            reject(e);
                                        };
                                        img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
                                    } else if (canvas) {
                                        ctx.drawImage(canvas, 0, 0);
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
}

class ExportFrame {
    constructor(map, control) {
        this._map = map;
        this._control = control;
        this._el = document.createElement('div');
        this._el.className = 'map-export-frame';

        // Handles
        ['nw', 'ne', 'se', 'sw'].forEach(pos => {
            const handle = document.createElement('div');
            handle.className = `export-handle ${pos}`;
            handle.onmousedown = (e) => this._startResize(e, pos);
            this._el.appendChild(handle);
        });

        // Center Drag
        this._el.onmousedown = (e) => {
            if (e.target === this._el) this._startMove(e);
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

        const startX = e.clientX;
        const startY = e.clientY;
        const rect = this._el.getBoundingClientRect();
        const startLeft = this._el.offsetLeft;
        const startTop = this._el.offsetTop;

        const onMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            this._el.style.left = (startLeft + dx) + 'px'; // Wait, CSS uses transform translate(-50, -50)
            // But left/top are 50%.
            // My CSS: top: 50%; left: 50%; transform: translate(-50%, -50%);
            // This centers it. If I want to move it freely, I should probably switch to top/left absolute with no transform
            // or modify margins.
            // Let's switch to direct positioning on first move.
        };

        // Helper to switch to absolute positioning without transform if needed, 
        // but easier to just use top/left and remove transform?
        // Let's adjust styles inline.

        // Re-implementing move logic simply:
        this._el.style.transform = 'none';
        this._el.style.left = this._el.offsetLeft + 'px';
        this._el.style.top = this._el.offsetTop + 'px';

        // Need to capture initial after removing transform
        const finalStartLeft = this._el.offsetLeft;
        const finalStartTop = this._el.offsetTop;

        const performMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            this._el.style.left = (finalStartLeft + dx) + 'px';
            this._el.style.top = (finalStartTop + dy) + 'px';
        };

        const onUp = () => {
            document.removeEventListener('mousemove', performMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', performMove);
        document.addEventListener('mouseup', onUp);
    }

    _startResize(e, handle) {
        e.preventDefault();
        e.stopPropagation();

        // Ensure transform is gone
        if (getComputedStyle(this._el).transform !== 'none') {
            this._el.style.transform = 'none';
            this._el.style.left = this._el.offsetLeft + 'px';
            this._el.style.top = this._el.offsetTop + 'px';
        }

        const startX = e.clientX;
        const startY = e.clientY;
        const startW = this._el.offsetWidth;
        const startH = this._el.offsetHeight;
        const startL = this._el.offsetLeft;
        const startT = this._el.offsetTop;

        const onMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

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
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }
}

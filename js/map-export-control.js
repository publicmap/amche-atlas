import { ExportFrame } from './export-frame.js';

export class MapExportControl {
    constructor() {
        this._map = null;
        this._container = null;
        this._iframe = null;
        this._frame = null;
        this._isExporting = false;
        this._title = '';
        this._description = '';
        this._titleCustomized = false;
        this._descriptionCustomized = false;
        this._moveendHandler = null;
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';

        const button = document.createElement('button');
        button.className = 'mapboxgl-ctrl-icon mapboxgl-ctrl-export';
        button.type = 'button';
        button.title = 'Export Map';

        const icon = document.createElement('sl-icon');
        icon.name = 'box-arrow-in-down';
        icon.style.fontSize = '18px';
        button.appendChild(icon);

        button.addEventListener('click', () => this._toggle());
        this._container.appendChild(button);

        this._frame = new ExportFrame(map, this);
        this._createIframe();

        this._moveendHandler = () => {
            if (!this._isExporting && !this._titleCustomized) {
                this._updateTitleFromLocation();
            }
        };
        map.on('moveend', this._moveendHandler);

        return this._container;
    }

    onRemove() {
        if (this._map && this._moveendHandler) {
            this._map.off('moveend', this._moveendHandler);
            this._moveendHandler = null;
        }
        if (this._frame) {
            this._frame.remove();
        }
        if (this._iframe && this._iframe.parentNode) {
            this._iframe.parentNode.removeChild(this._iframe);
        }
        this._container.parentNode.removeChild(this._container);
        this._map = null;
    }

    _onFrameChange(aspectRatio) {
        if (this._iframe && this._iframe.contentWindow) {
            this._iframe.contentWindow.postMessage({
                type: 'frame-aspect-changed',
                aspectRatio: aspectRatio
            }, '*');
        }
    }

    _createIframe() {
        this._iframe = document.createElement('iframe');
        this._iframe.src = 'map-export.html';
        this._iframe.className = 'map-export-iframe';

        const isMobile = window.innerWidth <= 768;
        const panelWidth = isMobile ? '100%' : '400px';
        const panelRight = isMobile ? '0' : '8px';
        const panelTop = '52px';
        const panelHeight = isMobile ? '60vh' : '85vh';

        this._iframe.style.cssText = `
            position: fixed;
            top: ${panelTop};
            right: ${panelRight};
            width: ${panelWidth};
            max-width: calc(100vw - 70px);
            height: ${panelHeight};
            max-height: 85vh;
            border: none;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 1000;
            display: none;
            background: #1e293b;
            overflow: hidden;
        `;
        document.body.appendChild(this._iframe);

        window.addEventListener('message', (event) => {
            if (event.source !== this._iframe.contentWindow) return;

            const { type, config } = event.data;

            if (type === 'export-ready') {
                this._updateTitleFromLocation();
            } else if (type === 'export-close') {
                this._hide();
            } else if (type === 'export-start') {
                this._handleExport(config);
            } else if (type === 'title-changed') {
                this._title = config.title;
                this._titleCustomized = config.customized;
            } else if (type === 'description-changed') {
                this._description = config.description;
                this._descriptionCustomized = config.customized;
            } else if (type === 'frame-show') {
                if (this._iframe.style.display !== 'none') {
                    this._frame.show();
                    this._frame.setAspectRatio(config.aspectRatio || 1.414);
                }
            } else if (type === 'frame-hide') {
                this._frame.hide();
            } else if (type === 'frame-aspect') {
                if (this._iframe.style.display !== 'none') {
                    this._frame.setAspectRatio(config.aspectRatio);
                }
            }
        });
    }

    _toggle() {
        if (this._iframe.style.display === 'none') {
            this._show();
        } else {
            this._hide();
        }
    }

    _show() {
        this._iframe.style.display = 'block';
        setTimeout(() => {
            if (this._iframe && this._iframe.contentWindow) {
                this._iframe.contentWindow.postMessage({
                    type: 'export-opened'
                }, '*');
            }
        }, 50);
    }

    _hide() {
        this._iframe.style.display = 'none';
        this._frame.hide();
        if (this._iframe && this._iframe.contentWindow) {
            this._iframe.contentWindow.postMessage({
                type: 'export-closed'
            }, '*');
        }
    }

    async _updateTitleFromLocation() {
        if (this._isExporting) return;

        try {
            let center;

            if (this._frame && this._frame._el && this._frame._el.classList.contains('active')) {
                const frameRect = this._frame._el.getBoundingClientRect();
                if (frameRect.width > 0 && frameRect.height > 0) {
                    const mapRect = this._map.getContainer().getBoundingClientRect();
                    const frameCenterX = (frameRect.left + frameRect.width / 2) - mapRect.left;
                    const frameCenterY = (frameRect.top + frameRect.height / 2) - mapRect.top;
                    center = this._map.unproject([frameCenterX, frameCenterY]);
                }
            }

            if (!center) {
                center = this._map.getCenter();
            }

            const mapZoom = this._map.getZoom();
            const address = await this._reverseGeocode(center.lat, center.lng, mapZoom);

            this._title = address ? `Map of ${address}` : 'Map';

            if (this._iframe && this._iframe.contentWindow) {
                this._iframe.contentWindow.postMessage({
                    type: 'title-update',
                    title: this._title
                }, '*');
            }
        } catch (e) {
            console.warn('Failed to update title from location', e);
            this._title = 'Map';
        }
    }

    async _reverseGeocode(lat, lng, zoom) {
        try {
            const latRounded = Math.round(lat * 100000) / 100000;
            const lngRounded = Math.round(lng * 100000) / 100000;
            const nominatimZoom = Math.max(0, Math.min(18, Math.round(zoom || 15)));
            const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latRounded}&lon=${lngRounded}&zoom=${nominatimZoom}&addressdetails=1`;

            const response = await fetch(url, {
                headers: { 'User-Agent': 'AMChe-Goa-Map-Export/1.0' }
            });

            if (!response.ok) {
                throw new Error(`Nominatim API error: ${response.status}`);
            }

            const data = await response.json();
            if (!data.display_name) return null;

            if (window.attributionControl && data.display_name) {
                window.attributionControl.setLocation(data.display_name);
            }

            const parts = data.display_name.split(',').map(part => part.trim()).filter(part => part.length > 0);

            if (parts.length <= 4) {
                return parts.join(', ');
            }

            const firstLineParts = parts.slice(0, parts.length - 4);
            const lastFourParts = parts.slice(parts.length - 4);
            return firstLineParts.join(', ') + '<br>' + lastFourParts.join(', ');
        } catch (e) {
            console.error('Reverse geocoding failed', e);
            return null;
        }
    }

    async _handleExport(config) {
        this._isExporting = true;
        this._sendProgress(5, 'Starting export');

        try {
            const format = config.format;

            if (format === 'pdf') {
                await this._exportPDF(config);
            } else if (format === 'geotiff') {
                await this._exportGeoTIFF(config);
            } else if (format === 'png') {
                await this._exportPNG(config);
            } else if (format === 'jpeg') {
                await this._exportJPEG(config);
            } else if (format === 'html') {
                await this._exportHTML(config);
            } else if (format === 'geojson') {
                await this._exportGeoJSON(config);
            } else if (format === 'kml') {
                await this._exportKML(config);
            } else if (format === 'style') {
                await this._exportStyleJSON(config);
            } else if (format === 'dxf') {
                await this._exportDXF(config);
            }

            this._sendProgress(100, 'Export complete');
            this._hide();
        } catch (error) {
            console.error('Export failed:', error);
            this._sendProgress(-1, `Export failed: ${error.message}`);
        } finally {
            this._isExporting = false;
        }
    }

    _sendProgress(percent, message) {
        if (this._iframe && this._iframe.contentWindow) {
            this._iframe.contentWindow.postMessage({
                type: 'export-progress',
                percent: percent,
                message: message
            }, '*');
        }
    }

    async _exportPDF(config) {
        const { jsPDF } = await import('jspdf');

        const widthMm = config.width;
        const heightMm = config.height;
        const dpi = config.dpi || 96;
        const includeLegend = config.includeLegend || false;

        const margins = this._parseMargin(config.margin || '10mm');

        let shareUrl = window.location.href;
        if (window.urlManager) {
            shareUrl = window.urlManager.getShareableURL();
        }

        let attributionText = '';
        const attribCtrl = this._map._controls.find(c => c._container && c._container.classList.contains('mapboxgl-ctrl-attrib'));
        if (attribCtrl) {
            attributionText = attribCtrl._container.textContent;
        }

        const contentWidthMm = widthMm - margins.left - margins.right;
        const contentHeightMm = heightMm - margins.top - margins.bottom;
        const targetWidth = Math.round((contentWidthMm * dpi) / 25.4);
        const targetHeight = Math.round((contentHeightMm * dpi) / 25.4);

        const frameBounds = this._frame.getBounds();

        const container = this._map.getContainer();
        const originalWidth = container.style.width;
        const originalHeight = container.style.height;
        const originalCenter = this._map.getCenter();
        const originalZoom = this._map.getZoom();
        const originalBearing = this._map.getBearing();
        const originalPitch = this._map.getPitch();

        this._frame.hide();

        this._sendProgress(10, 'Generating QR code');
        let qrDataUrl = null;
        try {
            qrDataUrl = await this._getQRCodeDataUrl(shareUrl);
            this._sendProgress(20, 'QR code generated');
        } catch (e) {
            console.warn('Failed to generate QR for PDF', e);
            this._sendProgress(20, 'Skipping QR code');
        }

        this._sendProgress(25, 'Preparing legend');
        let overlayDataUrl = null;
        let overlayWidthMm = 0;
        let overlayHeightMm = 0;

        if (includeLegend) {
            const featurePanelLayers = document.querySelector('.feature-control-layers.map-feature-panel-layers') ||
                document.querySelector('.map-feature-panel-layers');

            const hasContent = featurePanelLayers && (
                featurePanelLayers.children.length > 0 ||
                featurePanelLayers.textContent.trim().length > 0
            );

            if (hasContent) {
                try {
                    const html2canvas = (await import('html2canvas')).default;
                    const parentPanel = featurePanelLayers.closest('.map-feature-panel');
                    const wasHidden = parentPanel && parentPanel.style.display === 'none';
                    const originalDisplay = wasHidden ? 'none' : null;

                    if (wasHidden && parentPanel) {
                        parentPanel.style.display = 'flex';
                        parentPanel.offsetHeight;
                    }

                    const clone = featurePanelLayers.cloneNode(true);

                    const allDetails = clone.querySelectorAll('sl-details');
                    allDetails.forEach(detail => {
                        detail.open = true;
                        const contentContainer = detail.querySelector('.layer-content');
                        if (contentContainer) {
                            contentContainer.style.display = 'block';
                        }
                    });

                    const allTabPanels = clone.querySelectorAll('sl-tab-panel');
                    allTabPanels.forEach(panel => {
                        panel.removeAttribute('hidden');
                        panel.style.display = 'block';
                        panel.style.visibility = 'visible';
                    });

                    const computedStyle = window.getComputedStyle(featurePanelLayers);
                    const targetWidth = parentPanel && parentPanel.offsetWidth > 0
                        ? Math.min(parentPanel.offsetWidth, 350)
                        : 300;

                    clone.style.position = 'absolute';
                    clone.style.left = '0px';
                    clone.style.top = '0px';
                    clone.style.width = `${targetWidth}px`;
                    clone.style.maxWidth = 'none';
                    clone.style.maxHeight = 'none';
                    clone.style.overflow = 'visible';
                    clone.style.backgroundColor = '#ffffff';
                    clone.style.padding = computedStyle.padding;
                    clone.style.margin = '0';
                    clone.style.boxSizing = 'border-box';
                    clone.style.zIndex = '99999';
                    clone.style.fontFamily = computedStyle.fontFamily;
                    clone.style.fontSize = computedStyle.fontSize;
                    clone.style.color = computedStyle.color;
                    clone.style.lineHeight = computedStyle.lineHeight;

                    document.body.appendChild(clone);

                    await new Promise(resolve => requestAnimationFrame(resolve));
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    await new Promise(resolve => setTimeout(resolve, 200));

                    const cloneRect = clone.getBoundingClientRect();
                    const allElements = Array.from(clone.querySelectorAll('*'));
                    let maxBottom = 0;

                    for (const el of allElements) {
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden') {
                            continue;
                        }

                        const rect = el.getBoundingClientRect();
                        const relativeBottom = rect.bottom - cloneRect.top;

                        const hasText = el.textContent && el.textContent.trim().length > 0;
                        const hasImage = el.querySelector && (el.querySelector('img') || el.querySelector('svg'));
                        const hasVisibleContent = rect.height > 0 && (hasText || hasImage || el.children.length > 0);

                        if (hasVisibleContent && relativeBottom > maxBottom) {
                            maxBottom = relativeBottom;
                        }
                    }

                    const contentHeight = Math.max(maxBottom, clone.scrollHeight);
                    const finalHeight = contentHeight < clone.scrollHeight * 0.8
                        ? contentHeight + 10
                        : clone.scrollHeight;

                    clone.style.left = '-9999px';

                    const canvas = await html2canvas(clone, {
                        backgroundColor: '#ffffff',
                        scale: 2,
                        logging: false,
                        useCORS: true,
                        width: targetWidth,
                        height: finalHeight,
                        windowWidth: targetWidth,
                        windowHeight: finalHeight
                    });

                    document.body.removeChild(clone);

                    overlayDataUrl = canvas.toDataURL('image/png');

                    const logicWidth = canvas.width / 2;
                    const logicHeight = canvas.height / 2;
                    overlayWidthMm = logicWidth * 0.26458;
                    overlayHeightMm = logicHeight * 0.26458;

                    this._sendProgress(40, 'Legend captured');

                    if (wasHidden && parentPanel) {
                        parentPanel.style.display = originalDisplay;
                    }
                } catch (e) {
                    console.warn('Failed to capture overlay', e);
                    this._sendProgress(40, 'Legend capture failed');
                }
            } else {
                this._sendProgress(40, 'No legend to capture');
            }
        } else {
            this._sendProgress(40, 'Skipping legend');
        }

        return new Promise((resolve, reject) => {
            const capture = async () => {
                try {
                    this._sendProgress(50, 'Capturing map');
                    const canvas = this._map.getCanvas();
                    const imgData = canvas.toDataURL('image/png');

                    const doc = new jsPDF({
                        orientation: widthMm > heightMm ? 'l' : 'p',
                        unit: 'mm',
                        format: [widthMm, heightMm]
                    });

                    doc.addImage(imgData, 'PNG', margins.left, margins.top, contentWidthMm, contentHeightMm);

                    if (overlayDataUrl && overlayWidthMm > 0 && overlayHeightMm > 0) {
                        const overlayX = margins.left + 5;
                        const overlayY = margins.top + 5;
                        doc.addImage(overlayDataUrl, 'PNG', overlayX, overlayY, overlayWidthMm, overlayHeightMm);
                    }

                    this._sendProgress(70, 'Adding footer');

                    const footerHeight = 25;
                    const footerY = heightMm - margins.bottom - footerHeight;

                    doc.setFillColor(0, 0, 0);
                    doc.rect(margins.left, footerY, contentWidthMm, footerHeight, 'F');

                    if (qrDataUrl) {
                        const qrSize = 20;
                        doc.addImage(qrDataUrl, 'PNG', margins.left + 2, footerY + 2.5, qrSize, qrSize);
                    }

                    const textX = margins.left + (qrDataUrl ? 25 : 5);
                    let textY = footerY + 6;

                    doc.setTextColor(255, 255, 255);

                    if (this._title) {
                        doc.setFontSize(12);
                        doc.setFont(undefined, 'bold');
                        const titleLines = doc.splitTextToSize(this._title.replace(/<br\s*\/?>/gi, '\n'), contentWidthMm - 30);
                        doc.text(titleLines, textX, textY);
                        textY += titleLines.length * 5;
                    }

                    doc.setFontSize(8);
                    doc.setFont(undefined, 'normal');

                    const date = new Date();
                    const timestamp = date.toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });

                    doc.text(`Exported at ${timestamp}`, textX, textY);
                    textY += 4;

                    if (attributionText) {
                        doc.setFontSize(6);
                        doc.text(`Data: ${attributionText}`, textX, textY);
                        textY += 3;
                    }

                    doc.setFontSize(6);
                    doc.setTextColor(128, 128, 128);
                    doc.text(shareUrl, textX, textY);

                    this._sendProgress(90, 'Saving PDF');

                    const filename = this._generateFilename('pdf');
                    doc.save(filename);

                    this._sendProgress(95, 'Restoring map');

                    container.style.width = originalWidth;
                    container.style.height = originalHeight;
                    this._map.resize();
                    this._map.jumpTo({
                        center: originalCenter,
                        zoom: originalZoom,
                        bearing: originalBearing,
                        pitch: originalPitch
                    });

                    resolve();
                } catch (error) {
                    container.style.width = originalWidth;
                    container.style.height = originalHeight;
                    this._map.resize();
                    reject(error);
                }
            };

            container.style.width = targetWidth + 'px';
            container.style.height = targetHeight + 'px';
            this._map.resize();

            this._map.once('idle', () => {
                this._map.fitBounds(frameBounds, {
                    padding: 0,
                    bearing: originalBearing,
                    pitch: originalPitch,
                    animate: false
                });

                this._map.once('idle', () => {
                    capture().then(resolve).catch(reject);
                });
            });
        });
    }

    async _getQRCodeDataUrl(text) {
        return new Promise(async (resolve, reject) => {
            try {
                await customElements.whenDefined('sl-qr-code');

                const qr = document.createElement('sl-qr-code');
                qr.value = text;
                qr.size = 1024;
                qr.style.position = 'fixed';
                qr.style.top = '-9999px';
                qr.style.left = '-9999px';
                document.body.appendChild(qr);

                if (qr.updateComplete) {
                    await qr.updateComplete;
                }

                let attempts = 0;
                const maxAttempts = 50;

                const checkRender = () => {
                    const shadow = qr.shadowRoot;
                    if (shadow) {
                        const svg = shadow.querySelector('svg');
                        const canvas = shadow.querySelector('canvas');

                        if (svg || canvas) {
                            requestAnimationFrame(() => {
                                try {
                                    const padding = 40;
                                    const qrSize = 1024;
                                    const totalSize = qrSize + (padding * 2);

                                    const outCanvas = document.createElement('canvas');
                                    outCanvas.width = totalSize;
                                    outCanvas.height = totalSize;
                                    const ctx = outCanvas.getContext('2d');

                                    ctx.fillStyle = 'white';
                                    ctx.fillRect(0, 0, totalSize, totalSize);

                                    if (svg) {
                                        const svgData = new XMLSerializer().serializeToString(svg);
                                        const img = new Image();
                                        img.onload = () => {
                                            ctx.drawImage(img, padding, padding, qrSize, qrSize);
                                            document.body.removeChild(qr);
                                            resolve(outCanvas.toDataURL('image/png'));
                                        };
                                        img.onerror = () => {
                                            document.body.removeChild(qr);
                                            reject(new Error('Failed to load QR SVG'));
                                        };
                                        img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
                                    } else if (canvas) {
                                        ctx.drawImage(canvas, padding, padding, qrSize, qrSize);
                                        document.body.removeChild(qr);
                                        resolve(outCanvas.toDataURL('image/png'));
                                    }
                                } catch (err) {
                                    document.body.removeChild(qr);
                                    reject(err);
                                }
                            });
                            return;
                        }
                    }

                    attempts++;
                    if (attempts >= maxAttempts) {
                        document.body.removeChild(qr);
                        reject(new Error('QR code render timeout'));
                        return;
                    }

                    setTimeout(checkRender, 100);
                };

                checkRender();
            } catch (err) {
                reject(err);
            }
        });
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

    async _exportGeoTIFF(config) {
        this._sendProgress(10, 'Preparing GeoTIFF export');

        const width = config.width || 2048;
        const height = config.height || 2048;

        const bounds = this._frame.getBounds();
        const canvas = this._map.getCanvas();

        const container = this._map.getContainer();
        const originalWidth = container.style.width;
        const originalHeight = container.style.height;
        const originalCenter = this._map.getCenter();
        const originalZoom = this._map.getZoom();

        this._frame.hide();

        this._sendProgress(30, 'Capturing map');

        container.style.width = width + 'px';
        container.style.height = height + 'px';
        this._map.resize();
        this._map.fitBounds(bounds, { padding: 0 });

        await new Promise(resolve => {
            this._map.once('idle', resolve);
        });

        this._sendProgress(60, 'Generating image');

        const imageData = canvas.toDataURL('image/png');
        const imageBlob = await fetch(imageData).then(r => r.blob());

        this._sendProgress(80, 'Creating world file');

        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const pixelSizeX = (ne.lng - sw.lng) / width;
        const pixelSizeY = (ne.lat - sw.lat) / height;

        const worldFileContent = [
            pixelSizeX.toFixed(8),
            '0.0',
            '0.0',
            (-pixelSizeY).toFixed(8),
            sw.lng.toFixed(8),
            ne.lat.toFixed(8)
        ].join('\n');

        const filename = this._generateFilename('png');
        const worldFilename = filename.replace('.png', '.pgw');

        this._downloadFile(imageBlob, filename, 'image/png');
        this._downloadFile(worldFileContent, worldFilename, 'text/plain');

        this._sendProgress(95, 'Restoring map');

        container.style.width = originalWidth;
        container.style.height = originalHeight;
        this._map.resize();
        this._map.jumpTo({
            center: originalCenter,
            zoom: originalZoom
        });

        this._sendProgress(100, 'GeoTIFF exported');
    }

    async _exportPNG(config) {
        this._sendProgress(20, 'Capturing canvas');
        const canvas = this._map.getCanvas();
        const dataUrl = canvas.toDataURL('image/png');
        const blob = await fetch(dataUrl).then(r => r.blob());

        this._sendProgress(80, 'Downloading file');
        const filename = this._generateFilename('png');
        this._downloadFile(blob, filename, 'image/png');
    }

    async _exportJPEG(config) {
        this._sendProgress(20, 'Capturing canvas');
        const canvas = this._map.getCanvas();
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        const blob = await fetch(dataUrl).then(r => r.blob());

        this._sendProgress(80, 'Downloading file');
        const filename = this._generateFilename('jpg');
        this._downloadFile(blob, filename, 'image/jpeg');
    }

    async _exportHTML(config) {
        this._sendProgress(20, 'Generating HTML');

        const center = this._map.getCenter();
        const zoom = this._map.getZoom();
        const bearing = this._map.getBearing();
        const pitch = this._map.getPitch();
        const style = this._map.getStyle();

        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${this._title || 'Map Export'}</title>
    <meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no">
    <link href="https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.css" rel="stylesheet">
    <script src="https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.js"></script>
    <style>
        body { margin: 0; padding: 0; }
        #map { position: absolute; top: 0; bottom: 0; width: 100%; }
    </style>
</head>
<body>
    <div id="map"></div>
    <script>
        mapboxgl.accessToken = '${mapboxgl.accessToken}';
        const map = new mapboxgl.Map({
            container: 'map',
            style: ${JSON.stringify(style)},
            center: [${center.lng}, ${center.lat}],
            zoom: ${zoom},
            bearing: ${bearing},
            pitch: ${pitch}
        });
        map.addControl(new mapboxgl.NavigationControl());
        map.addControl(new mapboxgl.ScaleControl());
    </script>
</body>
</html>`;

        this._sendProgress(80, 'Downloading file');
        const filename = this._generateFilename('html');
        this._downloadFile(html, filename, 'text/html');
    }

    async _exportGeoJSON(config) {
        this._sendProgress(20, 'Collecting features');

        const features = [];
        const layers = this._map.getStyle().layers.filter(l =>
            l.type === 'fill' || l.type === 'line' || l.type === 'circle' || l.type === 'symbol'
        );

        for (const layer of layers) {
            const sourceFeatures = this._map.querySourceFeatures(layer.source, {
                sourceLayer: layer['source-layer']
            });
            features.push(...sourceFeatures);
        }

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        this._sendProgress(80, 'Downloading file');
        const filename = this._generateFilename('geojson');
        this._downloadFile(JSON.stringify(geojson, null, 2), filename, 'application/geo+json');
    }

    async _exportKML(config) {
        this._sendProgress(20, 'Collecting features');

        const features = [];
        const layers = this._map.getStyle().layers.filter(l =>
            l.type === 'fill' || l.type === 'line' || l.type === 'circle' || l.type === 'symbol'
        );

        for (const layer of layers) {
            const sourceFeatures = this._map.querySourceFeatures(layer.source, {
                sourceLayer: layer['source-layer']
            });
            features.push(...sourceFeatures);
        }

        this._sendProgress(50, 'Converting to KML');

        const tokml = (await import('tokml')).default;
        const geojson = {
            type: 'FeatureCollection',
            features: features
        };
        const kml = tokml(geojson);

        this._sendProgress(80, 'Downloading file');
        const filename = this._generateFilename('kml');
        this._downloadFile(kml, filename, 'application/vnd.google-earth.kml+xml');
    }

    async _exportStyleJSON(config) {
        this._sendProgress(50, 'Getting style');
        const style = this._map.getStyle();

        this._sendProgress(80, 'Downloading file');
        const filename = this._generateFilename('json');
        this._downloadFile(JSON.stringify(style, null, 2), filename, 'application/json');
    }

    async _exportDXF(config) {
        this._sendProgress(20, 'Preparing DXF export');
        alert('DXF export coming soon');
    }

    _generateFilename(extension) {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const title = (this._title || 'map').replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        return `${title}_${timestamp}.${extension}`;
    }

    _downloadFile(content, filename, mimeType) {
        const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }
}

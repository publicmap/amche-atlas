import { ExportFrame } from './export-frame.js';
import { InspectionHandlerLoader } from './inspection-handler-loader.js';
import { trackEvent } from './analytics.js';
import { isNominatimBackedOff, reportNominatimFailure } from './nominatim-search.js';

export class MapExportControl {
    constructor() {
        this._map = null;
        this._container = null;
        this._iframe = null;
        this._frame = null;
        this._isExporting = false;
        this._exportCancelled = false;
        this._title = '';
        this._description = '';
        this._titleCustomized = false;
        this._descriptionCustomized = false;
        this._moveendHandler = null;
        this._footerTemplateCache = null;
        this._headerImageDataUrlCache = new Map();
        this._exportSettings = null;
        this._isPanelOpen = false;
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
        icon.name = 'download';
        icon.style.fontSize = '18px';
        button.appendChild(icon);

        button.addEventListener('click', () => this._toggle());
        this._container.appendChild(button);

        this._frame = new ExportFrame(map, this);
        this._createIframe();

        this._moveendHandler = () => {
            if (this._isPanelOpen && !this._isExporting && !this._titleCustomized) {
                this._updateTitleFromLocation();
            }
        };
        map.on('moveend', this._moveendHandler);

        setTimeout(() => {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('export')) {
                this._show();
            }
        }, 500);

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
        if (this._processingOverlay && this._processingOverlay.parentNode) {
            this._processingOverlay.parentNode.removeChild(this._processingOverlay);
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

    _onFrameInteractionStart() {
        if (this._iframe) {
            this._iframe.style.opacity = '0.4';
        }
    }

    _createIframe() {
        // Iframe element only; src is deferred so map-export.html and its
        // bundle don't load on the critical path. preload() loads it once
        // the map is idle; _show() loads it if the user opens the panel first.
        this._iframe = document.createElement('iframe');
        this._iframe.className = 'map-export-iframe';
        this._iframeSrcLoaded = false;

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
            transition: opacity 0.2s ease;
            background: #1e293b;
            overflow: hidden;
        `;
        document.body.appendChild(this._iframe);

        this._iframe.addEventListener('mouseenter', () => {
            this._iframe.style.opacity = '1';
        });

        this._processingOverlay = document.createElement('div');
        this._processingOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(2px);
            z-index: 999;
            display: none;
        `;
        document.body.appendChild(this._processingOverlay);

        window.addEventListener('message', (event) => {
            const { type, config } = event.data;

            if (type === 'toggle-export') {
                this._toggle();
                return;
            }

            if (event.source !== this._iframe.contentWindow) return;

            if (type === 'export-ready') {
                if (this._isPanelOpen) this._updateTitleFromLocation();
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
            } else if (type === 'show-qr-fullscreen') {
                this._showQRFullscreen(event.data.url);
            } else if (type === 'export-cancel') {
                this._exportCancelled = true;
            } else if (type === 'processing-overlay-show') {
                if (this._processingOverlay) {
                    this._processingOverlay.style.display = 'block';
                    this._iframe.style.zIndex = '1001';
                }
            } else if (type === 'processing-overlay-hide') {
                if (this._processingOverlay) {
                    this._processingOverlay.style.display = 'none';
                    this._iframe.style.zIndex = '1000';
                }
            } else if (type === 'request-selected-features') {
                const selectedFeatures = this._getSelectedFeatures();
                const bounds = this._map.getBounds();

                const featuresWithViewFlag = selectedFeatures.map(item => ({
                    ...item,
                    isInView: this._isFeatureCompletelyInView(item.feature, bounds)
                }));

                this._iframe.contentWindow.postMessage({
                    type: 'selected-features',
                    features: featuresWithViewFlag
                }, '*');
            } else if (type === 'export-settings-changed') {
                this._exportSettings = event.data.settings;
                if (this._isPanelOpen && window.urlManager) {
                    window.urlManager.updateExportParam(this._exportSettings);
                }
            }
        });
    }

    _showQRFullscreen(url) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            padding: 20px;
        `;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            position: absolute;
            top: 20px;
            right: 20px;
            width: 48px;
            height: 48px;
            background: rgba(255, 255, 255, 0.1);
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            color: white;
            font-size: 32px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            z-index: 10001;
            line-height: 1;
            padding: 0;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
            z-index: 10001;
            pointer-events: none;
        `;

        const qrCode = document.createElement('sl-qr-code');
        qrCode.value = url;
        qrCode.size = 400;
        qrCode.style.cssText = `
            max-width: 90vw;
            max-height: 70vh;
        `;

        const urlText = document.createElement('div');
        urlText.textContent = url;
        urlText.style.cssText = `
            color: white;
            font-size: 14px;
            text-align: center;
            word-break: break-all;
            padding: 0 20px;
            max-width: 90vw;
            font-family: monospace;
        `;

        const closeOverlay = () => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        };

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeOverlay();
        });

        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
            closeBtn.style.borderColor = 'rgba(255, 255, 255, 0.5)';
        });

        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            closeBtn.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeOverlay();
            }
        });

        content.appendChild(qrCode);
        content.appendChild(urlText);
        overlay.appendChild(closeBtn);
        overlay.appendChild(content);
        document.body.appendChild(overlay);
    }

    _toggle() {
        if (this._iframe.style.display === 'none') {
            this._show();
        } else {
            this._hide();
        }
    }

    preload() {
        if (this._iframeSrcLoaded || !this._iframe) return;
        this._iframe.src = 'map-export.html';
        this._iframeSrcLoaded = true;
    }

    _show() {
        this.preload();
        this._iframe.style.display = 'block';
        this._isPanelOpen = true;

        const urlSettings = this._parseExportURL();
        if (urlSettings) {
            this._exportSettings = urlSettings;
        }

        if (this._exportSettings && window.urlManager) {
            window.urlManager.updateExportParam(this._exportSettings);
        }

        setTimeout(() => {
            if (this._iframe && this._iframe.contentWindow) {
                this._iframe.contentWindow.postMessage({
                    type: 'export-opened',
                    initialSettings: this._exportSettings
                }, '*');
            }
        }, 50);
    }

    _hide() {
        this._iframe.style.display = 'none';
        this._frame.hide();
        this._isPanelOpen = false;

        if (window.urlManager) {
            window.urlManager.updateExportParam(null);
        }

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
        if (isNominatimBackedOff()) return null;

        try {
            const latRounded = Math.round(lat * 100000) / 100000;
            const lngRounded = Math.round(lng * 100000) / 100000;
            const nominatimZoom = Math.max(0, Math.min(18, Math.round(zoom || 15)));
            const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latRounded}&lon=${lngRounded}&zoom=${nominatimZoom}&addressdetails=1`;

            const response = await fetch(url, {
                headers: { 'User-Agent': 'AMChe-Goa-Map-Export/1.0' }
            });

            if (!response.ok) {
                reportNominatimFailure();
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
            reportNominatimFailure();
            console.error('Reverse geocoding failed', e);
            return null;
        }
    }

    async _handleExport(config) {
        this._isExporting = true;
        this._exportCancelled = false;
        this._sendProgress(5, 'Starting export');

        try {
            const format = config.format;

            trackEvent('map_export', { export_type: format });

            if (format === 'pdf') {
                await this._exportPDF(config);
            } else if (format === 'geotiff') {
                await this._exportGeoTIFF(config);
            } else if (format === 'png') {
                await this._exportPNG(config);
            } else if (format === 'jpeg') {
                await this._exportJPEG(config);
            } else if (format === 'svg') {
                await this._exportSVG(config);
            } else if (format === 'html') {
                await this._exportHTML(config);
            } else if (format === 'geojson') {
                await this._exportGeoJSON(config);
            } else if (format === 'kml') {
                await this._exportKML(config);
            } else if (format === 'style') {
                await this._exportStyleJSON(config);
            } else if (format === 'csv') {
                await this._exportCSV(config);
            } else if (format === 'dxf') {
                await this._exportDXF(config);
            }

            if (this._exportCancelled) {
                this._sendProgress(-1, 'Export cancelled');
            } else {
                this._sendProgress(100, 'Export complete');
            }
        } catch (error) {
            if (this._exportCancelled) {
                this._sendProgress(-1, 'Export cancelled');
            } else {
                console.error('Export failed:', error);
                this._sendProgress(-1, `Export failed: ${error.message}`);
            }
        } finally {
            this._isExporting = false;
            this._exportCancelled = false;
            this._restoreFrameVisibility(config);
        }
    }

    _restoreFrameVisibility(config) {
        if (!this._frame) return;

        const shouldShowFrame =
            config.format === 'pdf' ||
            config.format === 'geotiff' ||
            config.format === 'png' ||
            config.format === 'jpeg' ||
            config.format === 'svg' ||
            (config.format === 'dxf' && config.includeRaster);

        if (shouldShowFrame && this._iframe && this._iframe.style.display !== 'none') {
            this._frame.show();
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

    /**
     * Embeds an ISO 32000-2 geospatial Viewport/Measure dictionary into the
     * PDF's page object so GIS tools (Avenza Maps, QGIS, ArcGIS, GDAL) can
     * read it as a GeoPDF. Assumes a north-up capture (same bounding-box
     * assumption used by the GeoTIFF export), mapping the four page corners
     * to the corresponding WGS84 lat/lng corners of bounds.
     *
     * GCS is declared as PROJCS/EPSG:3857 (Web Mercator) rather than a plain
     * GEOGCS/4326: the raster was rendered by Mapbox GL in Web Mercator, so
     * pixel position is linear in Mercator-projected meters, not in raw
     * lat/lng degrees. Declaring GEOGCS/4326 tells readers to interpolate
     * linearly in degrees (i.e. treat the raster as equirectangular), which
     * introduces real curvature distortion that grows with the extent's
     * size and latitude — GDAL/QGIS instead interpolate linearly in the
     * declared CRS's own units, so PROJCS/3857 matches the raster exactly.
     */
    _addGeoreferencing(doc, bounds, widthMm, heightMm) {
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const ptsPerMm = 72 / 25.4;
        const widthPt = (widthMm * ptsPerMm).toFixed(2);
        const heightPt = (heightMm * ptsPerMm).toFixed(2);

        // Corner order: bottom-left, top-left, top-right, bottom-right
        const gpts = [
            sw.lat, sw.lng,
            ne.lat, sw.lng,
            ne.lat, ne.lng,
            sw.lat, ne.lng
        ].map(v => v.toFixed(8)).join(' ');

        doc.internal.events.subscribe('putPage', () => {
            doc.internal.write(
                `/VP [ << /Type /Viewport /BBox [0 0 ${widthPt} ${heightPt}] ` +
                `/Measure << /Type /Measure /Subtype /GEO ` +
                `/Bounds [0 0 0 1 1 1 1 0] /LPTS [0 0 0 1 1 1 1 0] ` +
                `/GPTS [${gpts}] /GCS << /Type /PROJCS /EPSG 3857 >> >> >> ]`
            );
        });
    }

    /**
     * Renders the exact same map+footer raster as _exportPNG/_exportJPEG (via
     * _addFooterToRaster) and drops it into a single full-bleed page image,
     * so the PDF layout (title, legend, QR, scale bar, north arrow) is
     * pixel-identical to the image exports instead of a separately
     * hand-drawn jsPDF footer.
     */
    async _exportPDF(config) {
        const { jsPDF } = await import('jspdf');

        const widthMm = config.width;
        const heightMm = config.height;
        const dpi = config.dpi || 96;

        const targetWidth = Math.round((widthMm * dpi) / 25.4);
        const targetHeight = Math.round((heightMm * dpi) / 25.4);

        const container = this._map.getContainer();
        const originalWidth = container.style.width;
        const originalHeight = container.style.height;
        const originalCenter = this._map.getCenter();
        const originalZoom = this._map.getZoom();
        const originalBearing = this._map.getBearing();
        const originalPitch = this._map.getPitch();

        // Corner-based georeferencing can only represent a north-up,
        // unpitched raster — so georeferencing is only embedded when the
        // view is already (close to) flat. In that case, snap to exactly
        // 0/0 before reading the frame's bounds (not after): the frame is a
        // screen-space rectangle, and unprojecting its corners while the
        // camera is even slightly tilted/rotated gives points that don't
        // form a valid axis-aligned rectangle — which is what was producing
        // an extent that didn't quite match the captured frame (and,
        // separately, didn't match _exportGeoTIFF's identical logic for the
        // same frame). When genuinely rotated/tilted, the visual capture
        // still follows the user's chosen view — georeferencing is simply
        // omitted for that case (see isNorthUp below).
        const isNorthUp = Math.abs(originalBearing) < 0.01 && Math.abs(originalPitch) < 0.01;
        if (isNorthUp) {
            this._map.jumpTo({ bearing: 0, pitch: 0, animate: false });
            await new Promise(resolve => this._map.once('idle', resolve));
        }

        const frameBounds = this._frame.getBounds();
        const frameCenter = frameBounds.getCenter();

        this._frame.hide();

        return new Promise((resolve, reject) => {
            const capture = async () => {
                try {
                    if (this._exportCancelled) {
                        throw new Error('Export cancelled');
                    }

                    this._sendProgress(50, 'Capturing map');
                    const canvas = this._map.getCanvas();
                    let dataUrl = canvas.toDataURL('image/png');

                    const actualPixelWidth = canvas.width;
                    const actualPixelHeight = canvas.height;

                    let markersDataUrl = null;
                    if (config.includeMarkers !== false) {
                        this._sendProgress(55, 'Capturing markers');
                        try {
                            markersDataUrl = await this._captureMarkersOverlay(targetWidth, targetHeight, actualPixelWidth, actualPixelHeight);
                        } catch (e) {
                            console.warn('Failed to capture markers for PDF export', e);
                        }
                    }

                    this._sendProgress(60, 'Adding footer');
                    dataUrl = await this._addFooterToRaster(dataUrl, actualPixelWidth, actualPixelHeight, frameCenter, originalBearing, dpi, config, markersDataUrl);

                    this._sendProgress(85, 'Building PDF');
                    const doc = new jsPDF({
                        orientation: widthMm > heightMm ? 'l' : 'p',
                        unit: 'mm',
                        format: [widthMm, heightMm]
                    });

                    // Reads the corners of what was actually rendered by
                    // directly unprojecting the CSS-pixel corners of the
                    // capture viewport — the same method _exportGeoTIFF uses
                    // for the identical frame, so the two formats agree.
                    if (isNorthUp) {
                        const nwLngLat = this._map.unproject([0, 0]);
                        const seLngLat = this._map.unproject([targetWidth, targetHeight]);
                        const actualBounds = new mapboxgl.LngLatBounds(
                            [Math.min(nwLngLat.lng, seLngLat.lng), Math.min(nwLngLat.lat, seLngLat.lat)],
                            [Math.max(nwLngLat.lng, seLngLat.lng), Math.max(nwLngLat.lat, seLngLat.lat)]
                        );
                        this._addGeoreferencing(doc, actualBounds, widthMm, heightMm);
                    }

                    doc.addImage(dataUrl, 'PNG', 0, 0, widthMm, heightMm);

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
                const fitBearing = isNorthUp ? 0 : originalBearing;
                const fitPitch = isNorthUp ? 0 : originalPitch;
                const camera = this._calculateCameraForBounds(frameBounds, targetWidth, targetHeight, fitBearing, fitPitch);

                this._map.jumpTo({
                    ...camera,
                    bearing: fitBearing,
                    pitch: fitPitch,
                    animate: false
                });

                this._map.once('idle', () => {
                    capture().then(resolve).catch(reject);
                });
            });
        });
    }

    async _getQRCodeDataUrl(text, size = 1024) {
        return new Promise(async (resolve, reject) => {
            try {
                await customElements.whenDefined('sl-qr-code');

                const qr = document.createElement('sl-qr-code');
                qr.value = text;
                qr.size = size;
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
                                    const padding = Math.round(size * 0.04);
                                    const totalSize = size + (padding * 2);

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
                                            ctx.drawImage(img, padding, padding, size, size);
                                            document.body.removeChild(qr);
                                            resolve(outCanvas.toDataURL('image/png'));
                                        };
                                        img.onerror = () => {
                                            document.body.removeChild(qr);
                                            reject(new Error('Failed to load QR SVG'));
                                        };
                                        img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
                                    } else if (canvas) {
                                        ctx.drawImage(canvas, padding, padding, size, size);
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

    /**
     * Converts WGS84 lng/lat (degrees) to Web Mercator (EPSG:3857) meters,
     * matching the projection Mapbox GL actually rendered the map in.
     */
    _lngLatToWebMercator(lng, lat) {
        const R = 6378137;
        const x = (lng * Math.PI / 180) * R;
        const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
        return { x, y };
    }

    async _exportGeoTIFF(config) {
        this._sendProgress(10, 'Preparing GeoTIFF export');

        const widthMm = config.width || 297;
        const heightMm = config.height || 210;
        const dpi = config.dpi || 96;

        const width = Math.round((widthMm * dpi) / 25.4);
        const height = Math.round((heightMm * dpi) / 25.4);

        const canvas = this._map.getCanvas();

        const container = this._map.getContainer();
        const originalWidth = container.style.width;
        const originalHeight = container.style.height;
        const originalCenter = this._map.getCenter();
        const originalZoom = this._map.getZoom();
        const originalBearing = this._map.getBearing();
        const originalPitch = this._map.getPitch();

        // GeoTIFF's ModelTiepoint/ModelPixelScale can only represent an
        // axis-aligned, north-up raster, so the capture always ignores the
        // map's current bearing/pitch (restored afterward) — a rotated or
        // tilted capture georeferenced this way would render skewed/squished
        // in GIS software.
        //
        // Reset bearing/pitch to 0 BEFORE reading the frame's bounds (not
        // after): the frame is a screen-space rectangle, and unprojecting
        // its corners while the camera is still tilted/rotated gives points
        // that don't form a valid axis-aligned rectangle at all — fitting
        // that distorted request into a flat capture is what was producing
        // an extent that didn't match the frame the user actually selected.
        this._map.jumpTo({ bearing: 0, pitch: 0, animate: false });
        await new Promise(resolve => {
            this._map.once('idle', resolve);
        });

        const bounds = this._frame.getBounds();

        this._frame.hide();

        this._sendProgress(30, 'Capturing map');

        container.style.width = width + 'px';
        container.style.height = height + 'px';
        this._map.resize();

        await new Promise(resolve => {
            this._map.once('idle', resolve);
        });

        const camera = this._calculateCameraForBounds(bounds, width, height, 0, 0);

        this._map.jumpTo({
            ...camera,
            bearing: 0,
            pitch: 0,
            animate: false
        });

        await new Promise(resolve => {
            this._map.once('idle', resolve);
        });

        this._sendProgress(50, 'Reading pixel data');

        const pixelWidth = canvas.width;
        const pixelHeight = canvas.height;
        const offscreen = document.createElement('canvas');
        offscreen.width = pixelWidth;
        offscreen.height = pixelHeight;
        const ctx = offscreen.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        const imageData = ctx.getImageData(0, 0, pixelWidth, pixelHeight);

        // Strip alpha: RGBA -> RGB, since the writer infers band count from
        // array length and a georeferenced raster has no use for alpha.
        const pixelCount = pixelWidth * pixelHeight;
        const rgb = new Uint8Array(pixelCount * 3);
        for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
            rgb[j] = imageData.data[i];
            rgb[j + 1] = imageData.data[i + 1];
            rgb[j + 2] = imageData.data[i + 2];
        }

        this._sendProgress(70, 'Encoding GeoTIFF');

        // Georeferenced in Web Mercator (matching how Mapbox GL rendered the
        // raster) rather than plain lat/lng, so pixel position is genuinely
        // linear in the declared CRS's units — see _addGeoreferencing for
        // why a lat/lng-linear (equirectangular) assumption would distort.
        //
        // Reads the corners of what was actually rendered — by directly
        // unprojecting the CSS-pixel corners of the capture viewport itself
        // — rather than the originally requested frame bounds or
        // map.getBounds(): cameraForBounds's fit isn't pixel-exact, so
        // anchoring to the request instead of the true result would declare
        // an extent slightly off from reality. Direct corner unprojection is
        // what map.getBounds() should be equivalent to, but this is the
        // same primitive ExportFrame.getBounds() itself relies on, so it's
        // the most direct, assumption-free way to read what's on screen.
        const nwLngLat = this._map.unproject([0, 0]);
        const seLngLat = this._map.unproject([width, height]);
        const nwMerc = this._lngLatToWebMercator(nwLngLat.lng, nwLngLat.lat);
        const seMerc = this._lngLatToWebMercator(seLngLat.lng, seLngLat.lat);

        const pixelSizeX = (seMerc.x - nwMerc.x) / pixelWidth;
        const pixelSizeY = (nwMerc.y - seMerc.y) / pixelHeight;

        const { writeArrayBuffer } = await import('geotiff');
        const tiffBuffer = await writeArrayBuffer(rgb, {
            width: pixelWidth,
            height: pixelHeight,
            ModelPixelScale: [pixelSizeX, pixelSizeY, 0],
            ModelTiepoint: [0, 0, 0, nwMerc.x, nwMerc.y, 0],
            GTModelTypeGeoKey: 1, // ModelTypeProjected
            GTRasterTypeGeoKey: 1, // RasterPixelIsArea
            ProjectedCSTypeGeoKey: 3857
        });

        this._sendProgress(90, 'Downloading file');

        const filename = this._generateFilename('tif');
        this._downloadFile(tiffBuffer, filename, 'image/tiff');

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

        this._sendProgress(100, 'GeoTIFF exported');
    }

    _calculateCameraForBounds(bounds, containerWidth, containerHeight, bearing = 0, pitch = 0) {
        try {
            const camera = this._map.cameraForBounds(bounds, {
                padding: 0,
                bearing: bearing,
                pitch: pitch
            });

            if (!camera || camera.zoom === undefined || !isFinite(camera.zoom)) {
                console.warn('cameraForBounds returned invalid camera');
                return {
                    center: bounds.getCenter(),
                    zoom: this._map.getZoom(),
                    bearing: bearing,
                    pitch: pitch
                };
            }

            return camera;
        } catch (e) {
            console.error('Failed to calculate camera for bounds:', e);
            return {
                center: bounds.getCenter(),
                zoom: this._map.getZoom(),
                bearing: bearing,
                pitch: pitch
            };
        }
    }

    async _exportPNG(config) {
        this._sendProgress(10, 'Preparing PNG export');

        const widthMm = config.width;
        const heightMm = config.height;
        const dpi = config.dpi || 96;

        const targetWidth = Math.round((widthMm * dpi) / 25.4);
        const targetHeight = Math.round((heightMm * dpi) / 25.4);

        const frameBounds = this._frame.getBounds();
        const frameCenter = frameBounds.getCenter();

        const container = this._map.getContainer();
        const originalWidth = container.style.width;
        const originalHeight = container.style.height;
        const originalCenter = this._map.getCenter();
        const originalZoom = this._map.getZoom();
        const originalBearing = this._map.getBearing();
        const originalPitch = this._map.getPitch();

        this._frame.hide();

        return new Promise((resolve, reject) => {
            const capture = async () => {
                try {
                    if (this._exportCancelled) {
                        throw new Error('Export cancelled');
                    }

                    await new Promise(resolve => setTimeout(resolve, 100));

                    this._sendProgress(50, 'Capturing map');
                    const canvas = this._map.getCanvas();
                    let dataUrl = canvas.toDataURL('image/png');

                    const actualPixelWidth = canvas.width;
                    const actualPixelHeight = canvas.height;

                    let markersDataUrl = null;
                    if (config.includeMarkers !== false) {
                        this._sendProgress(55, 'Capturing markers');
                        try {
                            markersDataUrl = await this._captureMarkersOverlay(targetWidth, targetHeight, actualPixelWidth, actualPixelHeight);
                        } catch (e) {
                            console.warn('Failed to capture markers for PNG export', e);
                        }
                    }

                    this._sendProgress(60, 'Adding footer');
                    dataUrl = await this._addFooterToRaster(dataUrl, actualPixelWidth, actualPixelHeight, frameCenter, originalBearing, dpi, config, markersDataUrl);

                    const blob = await fetch(dataUrl).then(r => r.blob());

                    this._sendProgress(80, 'Downloading file');
                    const filename = this._generateFilename('png');
                    this._downloadFile(blob, filename, 'image/png');

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
                const camera = this._calculateCameraForBounds(frameBounds, targetWidth, targetHeight, originalBearing, originalPitch);

                this._map.jumpTo({
                    ...camera,
                    animate: false
                });

                this._map.once('idle', () => {
                    capture().then(resolve).catch(reject);
                });
            });
        });
    }

    async _exportJPEG(config) {
        this._sendProgress(10, 'Preparing JPEG export');

        const widthMm = config.width;
        const heightMm = config.height;
        const dpi = config.dpi || 96;

        const targetWidth = Math.round((widthMm * dpi) / 25.4);
        const targetHeight = Math.round((heightMm * dpi) / 25.4);

        const frameBounds = this._frame.getBounds();
        const frameCenter = frameBounds.getCenter();

        const container = this._map.getContainer();
        const originalWidth = container.style.width;
        const originalHeight = container.style.height;
        const originalCenter = this._map.getCenter();
        const originalZoom = this._map.getZoom();
        const originalBearing = this._map.getBearing();
        const originalPitch = this._map.getPitch();

        this._frame.hide();

        return new Promise((resolve, reject) => {
            const capture = async () => {
                try {
                    if (this._exportCancelled) {
                        throw new Error('Export cancelled');
                    }

                    await new Promise(resolve => setTimeout(resolve, 100));

                    this._sendProgress(50, 'Capturing map');
                    const canvas = this._map.getCanvas();
                    let dataUrl = canvas.toDataURL('image/png');

                    const actualPixelWidth = canvas.width;
                    const actualPixelHeight = canvas.height;

                    let markersDataUrl = null;
                    if (config.includeMarkers !== false) {
                        this._sendProgress(55, 'Capturing markers');
                        try {
                            markersDataUrl = await this._captureMarkersOverlay(targetWidth, targetHeight, actualPixelWidth, actualPixelHeight);
                        } catch (e) {
                            console.warn('Failed to capture markers for JPEG export', e);
                        }
                    }

                    this._sendProgress(60, 'Adding footer');
                    dataUrl = await this._addFooterToRaster(dataUrl, actualPixelWidth, actualPixelHeight, frameCenter, originalBearing, dpi, config, markersDataUrl);

                    this._sendProgress(70, 'Converting to JPEG');
                    const tempImg = new Image();
                    await new Promise((resolve, reject) => {
                        tempImg.onload = resolve;
                        tempImg.onerror = reject;
                        tempImg.src = dataUrl;
                    });

                    const jpegCanvas = document.createElement('canvas');
                    jpegCanvas.width = actualPixelWidth;
                    jpegCanvas.height = actualPixelHeight;
                    const ctx = jpegCanvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, actualPixelWidth, actualPixelHeight);
                    ctx.drawImage(tempImg, 0, 0);
                    dataUrl = jpegCanvas.toDataURL('image/jpeg', 0.92);

                    const blob = await fetch(dataUrl).then(r => r.blob());

                    this._sendProgress(80, 'Downloading file');
                    const filename = this._generateFilename('jpg');
                    this._downloadFile(blob, filename, 'image/jpeg');

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
                const camera = this._calculateCameraForBounds(frameBounds, targetWidth, targetHeight, originalBearing, originalPitch);

                this._map.jumpTo({
                    ...camera,
                    animate: false
                });

                this._map.once('idle', () => {
                    capture().then(resolve).catch(reject);
                });
            });
        });
    }

    /**
     * Builds an SVG document containing a rasterized basemap/footer (an
     * <image> element, same raster used by _exportPNG/_exportJPEG) with the
     * atlas's own overlay layers (fill/line/circle/symbol-text) redrawn on
     * top as real <path>/<circle>/<text> elements — see js/svg-vector-export.js.
     * Those layers are hidden from the raster snapshot itself so they aren't
     * duplicated. The basemap stays raster since it isn't the atlas's data.
     */
    async _exportSVG(config) {
        this._sendProgress(10, 'Preparing SVG export');

        const { getVectorLayers, captureVectorLayers, hideVectorLayersForRaster, buildVectorSVGGroup } =
            await import('./svg-vector-export.js');

        const widthMm = config.width;
        const heightMm = config.height;
        const dpi = config.dpi || 96;

        const targetWidth = Math.round((widthMm * dpi) / 25.4);
        const targetHeight = Math.round((heightMm * dpi) / 25.4);

        const frameBounds = this._frame.getBounds();
        const frameCenter = frameBounds.getCenter();

        const container = this._map.getContainer();
        const originalWidth = container.style.width;
        const originalHeight = container.style.height;
        const originalCenter = this._map.getCenter();
        const originalZoom = this._map.getZoom();
        const originalBearing = this._map.getBearing();
        const originalPitch = this._map.getPitch();

        this._frame.hide();

        return new Promise((resolve, reject) => {
            let restoreVectorLayers = null;

            const capture = async () => {
                try {
                    if (this._exportCancelled) {
                        throw new Error('Export cancelled');
                    }

                    await new Promise(resolve => setTimeout(resolve, 100));

                    this._sendProgress(45, 'Preparing vector overlay');
                    const activeLayerIds = this._getActiveStyleLayerIds();
                    const vectorLayers = getVectorLayers(this._map, activeLayerIds);
                    const capturedVectorLayers = captureVectorLayers(this._map, vectorLayers);
                    restoreVectorLayers = hideVectorLayersForRaster(this._map, capturedVectorLayers);

                    if (capturedVectorLayers.length) {
                        await new Promise(resolve => this._map.once('idle', resolve));
                    }

                    this._sendProgress(50, 'Capturing map');
                    const canvas = this._map.getCanvas();
                    let dataUrl = canvas.toDataURL('image/png');

                    const actualPixelWidth = canvas.width;
                    const actualPixelHeight = canvas.height;

                    restoreVectorLayers();
                    restoreVectorLayers = null;

                    let markersDataUrl = null;
                    if (config.includeMarkers !== false) {
                        this._sendProgress(55, 'Capturing markers');
                        try {
                            markersDataUrl = await this._captureMarkersOverlay(targetWidth, targetHeight, actualPixelWidth, actualPixelHeight);
                        } catch (e) {
                            console.warn('Failed to capture markers for SVG export', e);
                        }
                    }

                    this._sendProgress(60, 'Adding footer');
                    dataUrl = await this._addFooterToRaster(dataUrl, actualPixelWidth, actualPixelHeight, frameCenter, originalBearing, dpi, config, markersDataUrl);

                    this._sendProgress(75, 'Building vector overlay');
                    const scaleFactor = actualPixelWidth / targetWidth;
                    const vectorGroupMarkup = buildVectorSVGGroup(this._map, capturedVectorLayers, scaleFactor);

                    this._sendProgress(80, 'Building SVG');
                    const svgContent = this._buildSVGDocument(dataUrl, widthMm, heightMm, actualPixelWidth, actualPixelHeight, vectorGroupMarkup);

                    this._sendProgress(85, 'Downloading file');
                    const filename = this._generateFilename('svg');
                    this._downloadFile(svgContent, filename, 'image/svg+xml');

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
                    if (restoreVectorLayers) {
                        restoreVectorLayers();
                        restoreVectorLayers = null;
                    }
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
                const camera = this._calculateCameraForBounds(frameBounds, targetWidth, targetHeight, originalBearing, originalPitch);

                this._map.jumpTo({
                    ...camera,
                    animate: false
                });

                this._map.once('idle', () => {
                    capture().then(resolve).catch(reject);
                });
            });
        });
    }

    _buildSVGDocument(imageDataUrl, widthMm, heightMm, pixelWidth, pixelHeight, vectorGroupMarkup = '') {
        return `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
            `width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${pixelWidth} ${pixelHeight}">\n` +
            `<image width="${pixelWidth}" height="${pixelHeight}" xlink:href="${imageDataUrl}" href="${imageDataUrl}" />\n` +
            `${vectorGroupMarkup}\n` +
            `</svg>`;
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

        let features;
        let filename;

        if (config.exportSelectedOnly && (config.customSelectedFeatures || this._hasSelectedFeatures())) {
            const selectedFeatures = config.customSelectedFeatures || this._getSelectedFeatures();
            features = selectedFeatures.map(item => item.feature);
            filename = this._generateFilenameFromFeatures(selectedFeatures, 'geojson');
        } else {
            features = [];
            const activeLayerIds = this._getActiveStyleLayerIds();
            const layers = this._map.getStyle().layers.filter(l =>
                activeLayerIds.has(l.id) &&
                (l.type === 'fill' || l.type === 'line' || l.type === 'circle' || l.type === 'symbol')
            );

            for (const layer of layers) {
                const sourceFeatures = this._map.querySourceFeatures(layer.source, {
                    sourceLayer: layer['source-layer']
                });
                features.push(...sourceFeatures);
            }
            filename = this._generateFilename('geojson');
        }

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        this._sendProgress(80, 'Downloading file');
        this._downloadFile(JSON.stringify(geojson, null, 2), filename, 'application/geo+json');
    }

    async _exportKML(config) {
        this._sendProgress(20, 'Collecting features');

        let features;
        let filename;

        if (config.exportSelectedOnly && (config.customSelectedFeatures || this._hasSelectedFeatures())) {
            const selectedFeatures = config.customSelectedFeatures || this._getSelectedFeatures();
            features = selectedFeatures.map(item => item.feature);
            filename = this._generateFilenameFromFeatures(selectedFeatures, 'kml');
        } else {
            features = [];
            const activeLayerIds = this._getActiveStyleLayerIds();
            const layers = this._map.getStyle().layers.filter(l =>
                activeLayerIds.has(l.id) &&
                (l.type === 'fill' || l.type === 'line' || l.type === 'circle' || l.type === 'symbol')
            );

            for (const layer of layers) {
                const sourceFeatures = this._map.querySourceFeatures(layer.source, {
                    sourceLayer: layer['source-layer']
                });
                features.push(...sourceFeatures);
            }
            filename = this._generateFilename('kml');
        }

        this._sendProgress(50, 'Converting to KML');

        const tokml = (await import('tokml')).default;
        const geojson = {
            type: 'FeatureCollection',
            features: features
        };
        const kml = tokml(geojson);

        this._sendProgress(80, 'Downloading file');
        this._downloadFile(kml, filename, 'application/vnd.google-earth.kml+xml');
    }

    async _exportStyleJSON(config) {
        this._sendProgress(50, 'Getting style');
        const style = this._map.getStyle();

        this._sendProgress(80, 'Downloading file');
        const filename = this._generateFilename('json');
        this._downloadFile(JSON.stringify(style, null, 2), filename, 'application/json');
    }

    async _exportCSV(config) {
        this._sendProgress(20, 'Collecting features');

        let features;
        let filename;

        const featuresWithMetadata = [];

        if (config.exportSelectedOnly && (config.customSelectedFeatures || this._hasSelectedFeatures())) {
            console.log('CSV Export: Using selected features');
            const selectedFeatures = config.customSelectedFeatures || this._getSelectedFeatures();
            console.log(`CSV Export: Found ${selectedFeatures.length} selected features`);

            for (const item of selectedFeatures) {
                featuresWithMetadata.push({
                    feature: item.feature,
                    layerId: item.layerId,
                    layerTitle: item.layerConfig?.title || item.layerId,
                    layerConfig: item.layerConfig
                });
            }
            filename = this._generateFilenameFromFeatures(selectedFeatures, 'csv');
        } else {
            console.log('CSV Export: Using all rendered features');
            const activeLayerIds = Array.from(this._getActiveStyleLayerIds());
            const allFeatures = activeLayerIds.length
                ? this._map.queryRenderedFeatures({ layers: activeLayerIds })
                : [];
            console.log(`CSV Export: Found ${allFeatures.length} rendered features`);

            const validFeatures = allFeatures.filter(f => f.geometry && f.geometry.type);
            console.log(`CSV Export: After filtering: ${validFeatures.length} features with geometry`);

            for (const feature of validFeatures) {
                const layerConfig = this._getLayerConfigById(feature.layer?.id);
                featuresWithMetadata.push({
                    feature: feature,
                    layerId: feature.layer?.id,
                    layerTitle: feature.layer?.id,
                    layerConfig: layerConfig
                });
            }
            filename = this._generateFilename('csv');
        }

        this._sendProgress(50, 'Processing features');

        console.log(`CSV Export: Found ${featuresWithMetadata.length} features to process`);
        if (featuresWithMetadata.length > 0) {
            console.log('First feature:', featuresWithMetadata[0]);
        }

        const handlerLoader = new InspectionHandlerLoader();
        const rows = [];
        const geometryField = config.geometryField || 'xy';
        const allKeys = new Set(
            geometryField === 'wkt'
                ? ['WKT', 'layer_url']
                : ['X', 'Y', 'layer_url']
        );

        for (const item of featuresWithMetadata) {
            const feature = item.feature;

            if (!feature.geometry || !feature.geometry.type) {
                console.log('Skipping feature without geometry:', feature);
                continue;
            }

            const centroid = this._calculateCentroid(feature.geometry);

            const center = this._map.getCenter();
            const zoom = this._map.getZoom();
            const bearing = this._map.getBearing();
            const pitch = this._map.getPitch();

            const baseUrl = window.location.origin + window.location.pathname;
            const params = new URLSearchParams();

            if (window.urlManager) {
                const currentUrl = new URL(window.urlManager.getShareableURL());
                for (const [key, value] of currentUrl.searchParams.entries()) {
                    if (key !== 'lat' && key !== 'lng' && key !== 'zoom') {
                        params.set(key, value);
                    }
                }
            }

            params.set('lat', centroid.lat.toFixed(6));
            params.set('lng', centroid.lng.toFixed(6));
            params.set('zoom', '14');

            if (bearing !== 0) params.set('bearing', bearing.toFixed(2));
            if (pitch !== 0) params.set('pitch', pitch.toFixed(2));

            const amcheUrl = `${baseUrl}?${params.toString()}`;

            const row = {
                ...feature.properties
            };

            if (geometryField === 'wkt') {
                row.WKT = this._geometryToWKT(feature.geometry);
            } else {
                row.X = centroid.lng.toFixed(6);
                row.Y = centroid.lat.toFixed(6);
            }

            row.layer_url = amcheUrl;

            if (item.layerId) {
                row.layer_id = item.layerId;
                allKeys.add('layer_id');
            }
            if (item.layerTitle) {
                row.layer_title = item.layerTitle;
                allKeys.add('layer_title');
            }

            if (item.layerConfig?.inspect?.onClick) {
                const handlerName = item.layerConfig.inspect.onClick;
                const atlasName = this._getAtlasNameForLayer(item.layerId, item.layerConfig);
                const fieldName = `layer_${handlerName}`;

                allKeys.add(fieldName);

                console.log(`CSV Export: Executing handler "${handlerName}" for layer "${item.layerId}" in atlas "${atlasName}"`);

                try {
                    const handlerOutput = await handlerLoader.executeHandler(
                        atlasName,
                        handlerName,
                        {
                            feature: feature,
                            layerId: item.layerId,
                            layerConfig: item.layerConfig,
                            map: this._map,
                            lngLat: { lng: centroid.lng, lat: centroid.lat }
                        }
                    );

                    console.log(`CSV Export: Handler output length: ${handlerOutput?.length || 0}`);

                    if (handlerOutput) {
                        const extractedData = await this._extractHandlerData(handlerOutput, feature);
                        console.log(`CSV Export: Extracted data: "${extractedData.substring(0, 100)}..."`);
                        row[fieldName] = extractedData;
                    } else {
                        console.log('CSV Export: Handler returned null/empty');
                        row[fieldName] = '';
                    }
                } catch (error) {
                    console.warn(`CSV Export: Failed to execute handler ${handlerName}:`, error);
                    row[fieldName] = '[Handler Error]';
                }
            } else {
                console.log(`CSV Export: No handler configured for layer ${item.layerId}`);
            }

            Object.keys(feature.properties || {}).forEach(key => allKeys.add(key));
            rows.push(row);
        }

        this._sendProgress(70, 'Generating CSV');

        const headers = Array.from(allKeys);
        const csvLines = [];

        csvLines.push(headers.map(h => this._escapeCsvValue(h)).join(','));

        for (const row of rows) {
            const values = headers.map(header => {
                const value = row[header];
                return this._escapeCsvValue(value);
            });
            csvLines.push(values.join(','));
        }

        const csvContent = csvLines.join('\n');

        this._sendProgress(90, 'Downloading file');
        this._downloadFile(csvContent, filename, 'text/csv');
    }

    _calculateCentroid(geometry) {
        if (!geometry || !geometry.type) {
            const center = this._map.getCenter();
            return { lng: center.lng, lat: center.lat };
        }

        if (geometry.type === 'Point') {
            return {
                lng: geometry.coordinates[0],
                lat: geometry.coordinates[1]
            };
        }

        if (geometry.type === 'MultiPoint') {
            const coords = geometry.coordinates;
            const lng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
            const lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
            return { lng, lat };
        }

        if (geometry.type === 'LineString') {
            const coords = geometry.coordinates;
            const midIndex = Math.floor(coords.length / 2);
            return {
                lng: coords[midIndex][0],
                lat: coords[midIndex][1]
            };
        }

        if (geometry.type === 'MultiLineString') {
            const allCoords = geometry.coordinates.flat();
            const lng = allCoords.reduce((sum, c) => sum + c[0], 0) / allCoords.length;
            const lat = allCoords.reduce((sum, c) => sum + c[1], 0) / allCoords.length;
            return { lng, lat };
        }

        if (geometry.type === 'Polygon') {
            const coords = geometry.coordinates[0];
            const lng = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
            const lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
            return { lng, lat };
        }

        if (geometry.type === 'MultiPolygon') {
            const allCoords = geometry.coordinates.flat(2);
            const lng = allCoords.reduce((sum, c) => sum + c[0], 0) / allCoords.length;
            const lat = allCoords.reduce((sum, c) => sum + c[1], 0) / allCoords.length;
            return { lng, lat };
        }

        return { lng: 0, lat: 0 };
    }

    _geometryToWKT(geometry) {
        if (!geometry || !geometry.type) {
            return '';
        }

        const coordsToString = (coords) => coords.join(' ');
        const ringToString = (ring) => '(' + ring.map(coordsToString).join(', ') + ')';

        switch (geometry.type) {
            case 'Point':
                return `POINT(${coordsToString(geometry.coordinates)})`;

            case 'MultiPoint':
                return `MULTIPOINT(${geometry.coordinates.map(coordsToString).join(', ')})`;

            case 'LineString':
                return `LINESTRING(${geometry.coordinates.map(coordsToString).join(', ')})`;

            case 'MultiLineString':
                return `MULTILINESTRING(${geometry.coordinates.map(ring => ringToString(ring)).join(', ')})`;

            case 'Polygon':
                return `POLYGON(${geometry.coordinates.map(ring => ringToString(ring)).join(', ')})`;

            case 'MultiPolygon':
                return `MULTIPOLYGON(${geometry.coordinates.map(polygon =>
                    '(' + polygon.map(ring => ringToString(ring)).join(', ') + ')'
                ).join(', ')})`;

            default:
                return '';
        }
    }

    _escapeCsvValue(value) {
        if (value === null || value === undefined) {
            return '';
        }

        const stringValue = String(value);

        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return '"' + stringValue.replace(/"/g, '""') + '"';
        }

        return stringValue;
    }

    async _exportDXF(config) {
        const { DXFConverter } = await import('./dxf-converter.js');
        const { DXFCoordinateTransformer } = await import('./dxf-coordinate-transformer.js');

        this._sendProgress(10, 'Preparing data');

        if (!config.includeRaster) {
            let features;
            let filename;

            if (config.exportSelectedOnly && (config.customSelectedFeatures || this._hasSelectedFeatures())) {
                const selectedFeatures = config.customSelectedFeatures || this._getSelectedFeatures();
                features = selectedFeatures.map(item => item.feature);
                filename = this._generateFilenameFromFeatures(selectedFeatures, 'dxf');
            } else {
                const activeLayerIds = Array.from(this._getActiveStyleLayerIds());
                features = activeLayerIds.length
                    ? this._map.queryRenderedFeatures({ layers: activeLayerIds })
                    : [];
                filename = this._generateFilename('dxf');
            }

            this._sendProgress(30, 'Converting coordinates');

            const mapCenter = this._map.getCenter();
            const transformer = new DXFCoordinateTransformer({
                coordSystem: config.coordSystem || 'local',
                mapCenter: mapCenter,
                map: this._map
            });

            const transformedFeatures = transformer.transformFeatures(features);

            this._sendProgress(60, 'Generating DXF');

            const geojson = {
                type: 'FeatureCollection',
                features: transformedFeatures
            };

            const dxfContent = DXFConverter.geoJsonToDxf(geojson, {
                title: this._title || 'Exported Features',
                coordSystem: config.coordSystem || 'local',
                units: transformer.getUnits()
            });

            this._sendProgress(90, 'Downloading');

            this._downloadFile(dxfContent, filename, 'application/dxf');
        } else {
            await this._exportDXFHybrid(config);
        }

        this._sendProgress(100, 'Complete');
    }

    async _exportDXFHybrid(config) {
        const { DXFConverter } = await import('./dxf-converter.js');
        const { DXFCoordinateTransformer } = await import('./dxf-coordinate-transformer.js');

        this._sendProgress(10, 'Preparing capture');

        if (this._exportCancelled) {
            throw new Error('Export cancelled');
        }

        if (!this._frame || !this._frame._el) {
            throw new Error('Export frame is not initialized');
        }

        const frameRect = this._frame._el.getBoundingClientRect();

        if (!frameRect.width || !frameRect.height || frameRect.width === 0 || frameRect.height === 0) {
            throw new Error('Export frame dimensions are invalid. Please ensure the frame is visible before exporting.');
        }

        const originalStyle = this._map.getContainer().style.cssText;
        const originalCenter = this._map.getCenter();
        const originalZoom = this._map.getZoom();
        const originalBearing = this._map.getBearing();
        const originalPitch = this._map.getPitch();

        let terrainControl = null;
        let originalTerrainEnabled = false;

        const controls = this._map._controls || [];
        for (const control of controls) {
            if (control.constructor.name === 'Terrain3DControl') {
                terrainControl = control;
                originalTerrainEnabled = control.getEnabled();
                break;
            }
        }

        const mapRect = this._map.getContainer().getBoundingClientRect();

        const frameCenterX = (frameRect.left + frameRect.width / 2) - mapRect.left;
        const frameCenterY = (frameRect.top + frameRect.height / 2) - mapRect.top;
        const frameWidth = frameRect.width;
        const frameHeight = frameRect.height;

        this._sendProgress(15, 'Resetting camera');

        if (terrainControl && originalTerrainEnabled) {
            terrainControl.setEnabled(false);
        }

        const needsReset = originalBearing !== 0 || originalPitch !== 0;

        if (needsReset) {
            this._map.setBearing(0);
            this._map.setPitch(0);

            await Promise.race([
                new Promise(resolve => this._map.once('moveend', resolve)),
                new Promise(resolve => setTimeout(resolve, 1000))
            ]);
        }

        this._sendProgress(20, 'Calculating frame bounds');

        const frameCenter = this._map.unproject([frameCenterX, frameCenterY]);

        this._sendProgress(30, 'Processing raster layers');

        this._frame.hide();

        const widthMm = config.width;
        const heightMm = config.height;
        const dpi = config.dpi || 96;
        const targetWidth = Math.round((widthMm * dpi) / 25.4);
        const targetHeight = Math.round((heightMm * dpi) / 25.4);

        const container = this._map.getContainer();
        Object.assign(container.style, {
            width: targetWidth + 'px',
            height: targetHeight + 'px',
            position: 'fixed',
            top: '0',
            left: '0',
            zIndex: '-9999'
        });

        this._map.resize();

        const scaleFactor = targetWidth / frameWidth;
        const newZoom = originalZoom + Math.log2(scaleFactor);

        this._map.jumpTo({
            center: frameCenter,
            zoom: newZoom,
            bearing: 0,
            pitch: 0,
            animate: false
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        await new Promise(resolve => {
            this._map.once('idle', resolve);
        });

        this._sendProgress(50, 'Rendering raster');

        if (this._exportCancelled) {
            throw new Error('Export cancelled');
        }

        const nw = this._map.unproject([0, 0]);
        const se = this._map.unproject([targetWidth, targetHeight]);

        const canvas = this._map.getCanvas();
        let imageDataUrl = canvas.toDataURL('image/png');

        const actualPixelWidth = canvas.width;
        const actualPixelHeight = canvas.height;

        this._sendProgress(52, 'Adding footer');

        // Markers are excluded here: this raster becomes a georeferenced DXF
        // background image, not a presentation graphic, so it shouldn't carry
        // non-georeferenced marker overlays.
        imageDataUrl = await this._addFooterToRaster(imageDataUrl, actualPixelWidth, actualPixelHeight, frameCenter, originalBearing, dpi, { includeMarkers: false });

        this._sendProgress(55, 'Extracting vector features');

        const activeLayerIds = Array.from(this._getActiveStyleLayerIds());
        const features = activeLayerIds.length
            ? this._map.queryRenderedFeatures({ layers: activeLayerIds })
            : [];
        const filteredFeatures = features.filter(feature => {
            if (feature.geometry.type === 'Point') {
                const [lng, lat] = feature.geometry.coordinates;
                return lng >= nw.lng && lng <= se.lng && lat <= nw.lat && lat >= se.lat;
            }
            return true;
        });

        this._sendProgress(60, 'Calculating dimensions');

        const transformer = new DXFCoordinateTransformer({
            coordSystem: config.coordSystem || 'local',
            mapCenter: frameCenter,
            map: this._map,
            bounds: { nw, se }
        });

        const transformedNW = transformer._transformCoordinate([nw.lng, nw.lat, 0]);
        const transformedSE = transformer._transformCoordinate([se.lng, se.lat, 0]);

        const imageDimensions = {
            width: Math.abs(transformedSE[0] - transformedNW[0]),
            height: Math.abs(transformedNW[1] - transformedSE[1])
        };

        container.style.cssText = originalStyle;
        this._map.resize();
        this._map.jumpTo({
            center: originalCenter,
            zoom: originalZoom,
            bearing: originalBearing,
            pitch: originalPitch
        });

        if (terrainControl && originalTerrainEnabled) {
            terrainControl.setEnabled(true);
        }

        this._frame.show();

        this._sendProgress(70, 'Converting coordinates');

        const transformedFeatures = transformer.transformFeatures(filteredFeatures);

        this._sendProgress(85, 'Generating DXF');

        const geojson = {
            type: 'FeatureCollection',
            features: transformedFeatures
        };

        let baseFilename = this._generateFilename('dxf').replace('.dxf', '');
        const rasterFilename = `${baseFilename}_raster.png`;

        const dxfContent = DXFConverter.geoJsonToDxf(geojson, {
            title: this._title || 'Map Export',
            coordSystem: config.coordSystem || 'local',
            units: transformer.getUnits(),
            rasterImage: {
                dataUrl: imageDataUrl,
                width: imageDimensions.width,
                height: imageDimensions.height,
                position: [0, 0],
                filename: rasterFilename,
                pixelWidth: actualPixelWidth,
                pixelHeight: actualPixelHeight
            }
        });

        this._sendProgress(90, 'Downloading DXF');

        this._downloadFile(dxfContent, `${baseFilename}.dxf`, 'application/dxf');

        this._sendProgress(93, 'Downloading raster');

        const imageBlob = await fetch(imageDataUrl).then(r => r.blob());
        this._downloadFile(imageBlob, rasterFilename, 'image/png');

        this._sendProgress(95, 'Creating world file');

        const worldFileContent = this._generateWorldFile(imageDimensions, transformer, frameCenter, actualPixelWidth, actualPixelHeight);
        this._downloadFile(worldFileContent, `${baseFilename}_raster.pgw`, 'text/plain');
    }

    /**
     * Renders the live MapMarkerManager selection markers (pins + balloons, in
     * whatever expanded/collapsed and manually-offset state they're currently
     * in) into a transparent PNG matching the raster export's pixel
     * dimensions. `map.getCanvas()` only rasterizes the WebGL map itself —
     * markers are DOM elements overlaid on top of it — so this is composited
     * separately on top of that snapshot (see _exportPDF/_exportPNG/_exportJPEG
     * and _addFooterToRaster).
     *
     * Must be called while the map container is still resized to the export
     * frame's target dimensions (i.e. before the calling export function
     * restores the original size/camera) so the markers' on-screen positions
     * match the captured map raster.
     */
    async _captureMarkersOverlay(logicalWidth, logicalHeight, physicalWidth, physicalHeight) {
        const container = this._map.getContainer();
        const markerEls = Array.from(container.querySelectorAll('.selection-marker'));
        if (markerEls.length === 0) return null;

        const html2canvas = (await import('html2canvas')).default;
        const containerRect = container.getBoundingClientRect();
        const scale = physicalWidth / logicalWidth;

        const overlayRoot = document.createElement('div');
        overlayRoot.style.cssText = `position:fixed;left:-9999px;top:0;width:${physicalWidth}px;height:${physicalHeight}px;overflow:hidden;`;

        // Marker positions/sizes live in logical (CSS) pixels, but the composite
        // needs to land at physical canvas pixel resolution — scale the whole
        // layer uniformly rather than recomputing every nested offset (pin anchor,
        // manually-dragged balloon transform, badge padding, etc.) by hand.
        const scaledLayer = document.createElement('div');
        scaledLayer.style.cssText = `position:absolute;left:0;top:0;width:${logicalWidth}px;height:${logicalHeight}px;transform:scale(${scale});transform-origin:top left;`;
        overlayRoot.appendChild(scaledLayer);

        markerEls.forEach(el => {
            const rect = el.getBoundingClientRect();
            const clone = this._prepareMarkerCloneForExport(el);
            // getBoundingClientRect() already resolved Mapbox's own positioning
            // transform on `el` into a final on-screen rect — cloneNode copies
            // that same transform inline style, so it must be cleared here or
            // it gets re-applied on top of the left/top below, doubling the
            // marker's offset and pushing it outside the captured canvas.
            clone.style.transform = 'none';
            clone.style.position = 'absolute';
            clone.style.left = `${rect.left - containerRect.left}px`;
            clone.style.top = `${rect.top - containerRect.top}px`;
            clone.style.margin = '0';
            scaledLayer.appendChild(clone);
        });

        document.body.appendChild(overlayRoot);

        try {
            await new Promise(resolve => requestAnimationFrame(resolve));
            await new Promise(resolve => requestAnimationFrame(resolve));

            const canvas = await html2canvas(overlayRoot, {
                backgroundColor: null,
                scale: 1,
                logging: false,
                useCORS: true,
                width: physicalWidth,
                height: physicalHeight
            });
            return canvas.toDataURL('image/png');
        } catch (e) {
            console.warn('[Export] Failed to capture marker overlay:', e);
            return null;
        } finally {
            document.body.removeChild(overlayRoot);
        }
    }

    /**
     * Clones a marker element for static export: drops interactive-only chrome
     * that means nothing in a flattened image (layer actions menu, "more
     * layers" shortcut trigger, comment save button, "Locating…" placeholders),
     * and inlines every <sl-icon>'s shadow-DOM SVG since html2canvas can't see
     * into shadow roots — without this the pin and badge icons render blank.
     */
    _prepareMarkerCloneForExport(el) {
        // Tag every live icon with a stable id before cloning, so each clone
        // icon can be paired with its exact original after chrome below (the
        // layer actions dropdown, etc. — itself full of <sl-icon>s) is
        // stripped from the clone: a plain index pairing breaks the moment
        // the two trees end up with a different number of <sl-icon>s.
        const liveIcons = Array.from(el.querySelectorAll('sl-icon'));
        liveIcons.forEach((icon, i) => { icon.dataset.exportIconId = String(i); });

        const clone = el.cloneNode(true);

        liveIcons.forEach(icon => { delete icon.dataset.exportIconId; });

        clone.querySelectorAll('.layer-actions-dropdown, .more-layers-shortcut-btn, .marker-comment-save-btn, .pending-layer-badge')
            .forEach(node => node.remove());

        // cloneNode doesn't carry over a live-edited (unsaved) textarea value —
        // only its original text content — so copy the current value across.
        const liveTextareas = el.querySelectorAll('textarea');
        clone.querySelectorAll('textarea').forEach((ta, i) => {
            if (liveTextareas[i]) ta.value = liveTextareas[i].value;
        });

        clone.querySelectorAll('sl-icon').forEach(iconEl => {
            const liveIcon = liveIcons[Number(iconEl.dataset.exportIconId)];
            delete iconEl.dataset.exportIconId;
            const svg = liveIcon?.shadowRoot?.querySelector('svg');
            if (!svg) {
                iconEl.remove();
                return;
            }
            const svgClone = svg.cloneNode(true);
            svgClone.setAttribute('width', '100%');
            svgClone.setAttribute('height', '100%');
            svgClone.style.display = 'block';

            // Mirrors sl-icon's own shadow DOM sizing (a 1em box the SVG fills),
            // so the wrapper takes over the host's font-size/color styling.
            const wrapper = document.createElement('span');
            wrapper.setAttribute('style', `${iconEl.getAttribute('style') || ''}; display:inline-block; width:1em; height:1em; line-height:0;`);
            wrapper.appendChild(svgClone);
            iconEl.replaceWith(wrapper);
        });

        // html2canvas paints text with its own (re-implemented) glyph metrics
        // rather than the browser's, which run taller than the line-height
        // these labels are laid out with live — so the line box they sit in
        // (and the flex-column balloon that auto-sizes around it) ends up a
        // few pixels too short, clipping the bottom of the text. Freeing the
        // vertical overflow and giving the line real breathing room fixes it
        // without disturbing the horizontal ellipsis truncation these same
        // labels rely on.
        clone.querySelectorAll('[style*="text-overflow: ellipsis"], [style*="text-overflow:ellipsis"]').forEach(node => {
            node.style.overflowY = 'visible';
            node.style.lineHeight = '2';
        });

        return clone;
    }

    _loadImageElement(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    /**
     * Flattens the marker overlay (see _captureMarkersOverlay) onto a base map
     * raster — used by _exportPDF, which embeds its map image directly via
     * jsPDF rather than going through _addFooterToRaster's html2canvas
     * composite.
     */
    async _mergeMarkersOntoRaster(baseDataUrl, markersDataUrl, width, height) {
        const [baseImg, overlayImg] = await Promise.all([
            this._loadImageElement(baseDataUrl),
            this._loadImageElement(markersDataUrl)
        ]);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(baseImg, 0, 0, width, height);
        ctx.drawImage(overlayImg, 0, 0, width, height);
        return canvas.toDataURL('image/png');
    }

    async _loadFooterTemplate() {
        if (this._footerTemplateCache) {
            return this._footerTemplateCache;
        }

        try {
            const response = await fetch('map-export-layout.html');
            if (!response.ok) {
                throw new Error('Failed to load template');
            }
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const template = doc.getElementById('export-footer-template');
            if (!template) {
                throw new Error('Footer template not found');
            }

            const styles = doc.querySelector('style');

            this._footerTemplateCache = {
                footer: template,
                styles: styles
            };

            return this._footerTemplateCache;
        } catch (e) {
            console.error('Failed to load footer template:', e);
            return null;
        }
    }

    _formatUrlForDisplay(url) {
        try {
            const urlObj = new URL(url);
            const parts = [];

            parts.push(urlObj.origin + urlObj.pathname);

            const params = new URLSearchParams(urlObj.search);
            const paramParts = [];

            for (const [key, value] of params.entries()) {
                if (key === 'layers') {
                    const decodedLayers = decodeURIComponent(value);
                    const layerItems = [];
                    let current = '';
                    let depth = 0;

                    for (let i = 0; i < decodedLayers.length; i++) {
                        const char = decodedLayers[i];
                        if (char === '{' || char === '[') {
                            depth++;
                            current += char;
                        } else if (char === '}' || char === ']') {
                            depth--;
                            current += char;
                        } else if (char === ',' && depth === 0) {
                            if (current.trim()) {
                                layerItems.push(current.trim());
                            }
                            current = '';
                        } else {
                            current += char;
                        }
                    }
                    if (current.trim()) {
                        layerItems.push(current.trim());
                    }

                    const filteredLayers = layerItems.filter(layer => {
                        return !layer.includes('"id":"selection"') &&
                               !layer.includes("'id':'selection'");
                    });

                    if (filteredLayers.length > 0) {
                        paramParts.push(`layers=${filteredLayers.join(', ')}`);
                    }
                } else {
                    const displayValue = decodeURIComponent(value);
                    paramParts.push(`${key}=${displayValue}`);
                }
            }

            if (paramParts.length > 0) {
                parts.push('?' + paramParts.join(' & '));
            }

            if (urlObj.hash) {
                parts.push(urlObj.hash);
            }

            return parts.join(' ');
        } catch (e) {
            return url;
        }
    }

    async _addFooterToRaster(mapImageDataUrl, width, height, center, bearing, dpi = 96, config = {}, markersDataUrl = null) {
        const __profileStart = performance.now();
        let __lastMark = __profileStart;
        const __step = (label) => {
            const now = performance.now();
            console.log(`[Export][timing] ${label}: +${(now - __lastMark).toFixed(0)}ms (total ${(now - __profileStart).toFixed(0)}ms)`);
            __lastMark = now;
        };
        try {
            const html2canvas = (await import('html2canvas')).default;
            __step('import html2canvas');

            let shareUrl = window.location.href;
            if (window.urlManager) {
                shareUrl = window.urlManager.getShareableURL();
            }

            const urlLength = shareUrl.length;
            let qrComplexity = 1;
            if (urlLength > 200) qrComplexity = 1.5;
            if (urlLength > 400) qrComplexity = 2.0;
            if (urlLength > 600) qrComplexity = 2.5;
            if (urlLength > 800) qrComplexity = 3.0;

            const pageWidthPx = width;
            const qrDisplaySizeRatio = 0.12 + (qrComplexity - 1) * 0.06;
            const qrDisplaySize = Math.round(pageWidthPx * qrDisplaySizeRatio);

            const minDisplaySize = Math.round((25 * dpi) / 25.4);
            const maxDisplaySize = Math.round((80 * dpi) / 25.4);
            const qrSize = Math.max(minDisplaySize, Math.min(qrDisplaySize, maxDisplaySize));

            const qrGenerationSize = Math.max(qrSize * 8, Math.round(2000 * qrComplexity));

            const footerHeightRatio = 0.05;
            const footerHeight = Math.round(height * footerHeightRatio);

            const footerPadding = Math.round(footerHeight * 0.15);
            const textGap = Math.round(footerHeight * 0.08);

            const titleFontSize = Math.round(footerHeight * 0.25);
            const descFontSize = Math.round(footerHeight * 0.18);
            const urlFontSize = Math.round(footerHeight * 0.13);

            const qrDataUrl = config.includeQRCode !== false
                ? await this._getQRCodeDataUrl(shareUrl, qrGenerationSize)
                : null;
            __step(`QR code generation (size ${qrGenerationSize}px, urlLength ${urlLength})`);

            const loadImage = (src) => new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = src;
                if (img.complete) resolve(img);
            });

            const mapImg = await loadImage(mapImageDataUrl);
            __step('map image decode');

            let markersImg = null;
            if (markersDataUrl) {
                markersImg = await loadImage(markersDataUrl);
                __step('markers overlay image decode');
            }

            const template = await this._loadFooterTemplate();
            __step('load footer template');
            if (!template) {
                console.warn('Could not load footer template, using plain map');
                return mapImageDataUrl;
            }

            const footerBox = template.footer.cloneNode(true);
            footerBox.style.cssText = 'position: absolute !important; bottom: 0 !important; left: 0 !important; right: 0 !important;';

            const qrEl = footerBox.querySelector('[data-export-qr]');
            if (qrEl && qrDataUrl) {
                qrEl.style.width = `${qrSize}px`;
                qrEl.style.height = `${qrSize}px`;
                qrEl.style.minWidth = `${qrSize}px`;
                qrEl.style.minHeight = `${qrSize}px`;
                qrEl.innerHTML = '';
                const qrImg = document.createElement('img');
                qrImg.src = qrDataUrl;
                qrImg.style.width = '100%';
                qrImg.style.height = '100%';
                qrImg.style.display = 'block';
                qrEl.appendChild(qrImg);
            }

            if (config.includeQRCode === false && qrEl) {
                qrEl.closest('.qr-box')?.remove();
            }

            const legendBox = footerBox.querySelector('.legend-box');
            if (config.includeLegend === false && legendBox) {
                legendBox.remove();
            }

            if (config.includeQRCode === false && config.includeLegend === false) {
                footerBox.querySelector('.metadata-right')?.remove();
            }

            const titleEl = footerBox.querySelector('[data-export-title]');
            if (titleEl) {
                if (this._title) {
                    titleEl.textContent = this._title.replace(/<br\s*\/?>/gi, ' ');
                } else {
                    titleEl.remove();
                }
            }

            const date = new Date();
            const timestamp = date.toLocaleString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            const descEl = footerBox.querySelector('[data-export-description]');
            if (descEl) {
                if (this._description) {
                    descEl.textContent = this._description;
                } else {
                    descEl.remove();
                }
            }

            const infoEl = footerBox.querySelector('[data-export-info]');
            if (infoEl) {
                const formattedUrl = this._formatUrlForDisplay(shareUrl);
                infoEl.textContent = `Exported ${timestamp} | ${formattedUrl}`;
            }

            const scaleEl = footerBox.querySelector('[data-export-scale-label]');
            if (scaleEl) {
                const center = this._map.getCenter();
                const zoom = this._map.getZoom();
                const metersPerPixel = 40075016.686 * Math.abs(Math.cos(center.lat * Math.PI / 180)) / Math.pow(2, zoom + 8);

                // Scale bar is 30mm wide in the template
                const scaleBarWidthMm = 30;
                const pixelsPerMm = dpi / 25.4;
                const scaleBarWidthPx = scaleBarWidthMm * pixelsPerMm;
                const scaleMeters = Math.round(metersPerPixel * scaleBarWidthPx);

                let scaleText;
                if (scaleMeters >= 1000) {
                    scaleText = `${(scaleMeters / 1000).toFixed(1)} km`;
                } else {
                    scaleText = `${scaleMeters} m`;
                }
                scaleEl.textContent = scaleText;
            }

            const northArrowEl = footerBox.querySelector('[data-export-north-arrow]');
            if (northArrowEl && bearing !== 0) {
                const container = northArrowEl.querySelector('.north-arrow-container');
                if (container) {
                    container.style.transform = `rotate(${-bearing}deg)`;
                }
            }

            const layerThumbnailsEl = footerBox.querySelector('[data-export-layer-thumbnails]');
            if (layerThumbnailsEl && window.stateManager && config.includeLegend !== false) {
                try {
                    console.log('[Export] Generating layer thumbnails...');

                    // Dynamic imports to avoid initialization issues
                    const { LayerThumbnail } = await import('./layer-thumbnail.js');
                    const { MapUtils } = await import('./map-utils.js');

                    const activeLayersMap = window.stateManager.getActiveLayers();
                    const bounds = this._map.getBounds();
                    const boundsArray = [
                        bounds.getWest(),
                        bounds.getSouth(),
                        bounds.getEast(),
                        bounds.getNorth()
                    ];

                    const imageToDataURL = async (url, useProxy = false) => {
                        const __imgStart = performance.now();
                        return new Promise((resolve) => {
                            const img = new Image();
                            img.crossOrigin = 'anonymous';

                            const PROXY_URL = 'https://amche-atlas-production.up.railway.app/proxy';
                            const actualUrl = useProxy ? `${PROXY_URL}?url=${encodeURIComponent(url)}` : url;

                            const timeout = setTimeout(() => {
                                console.warn(`[Export] Image load timeout: ${actualUrl}`);
                                resolve(null);
                            }, 6000);

                            img.onload = () => {
                                clearTimeout(timeout);
                                try {
                                    const canvas = document.createElement('canvas');
                                    canvas.width = img.width;
                                    canvas.height = img.height;
                                    const ctx = canvas.getContext('2d');
                                    ctx.drawImage(img, 0, 0);
                                    const dataURL = canvas.toDataURL('image/png');
                                    console.log(`[Export][timing] headerImage ${useProxy ? '(via proxy) ' : ''}${url.substring(0, 60)}...: ${(performance.now() - __imgStart).toFixed(0)}ms`);
                                    resolve(dataURL);
                                } catch (e) {
                                    console.warn(`[Export] Failed to convert image to canvas: ${actualUrl}`, e);
                                    resolve(null);
                                }
                            };

                            img.onerror = async (e) => {
                                clearTimeout(timeout);
                                if (!useProxy) {
                                    console.log(`[Export] Direct load failed, trying proxy server: ${url}`);
                                    const proxiedResult = await imageToDataURL(url, true);
                                    resolve(proxiedResult);
                                } else {
                                    console.warn(`[Export] Failed to load image even via proxy: ${url}`, e);
                                    resolve(null);
                                }
                            };

                            img.src = actualUrl;
                        });
                    };

                    // Resolve every layer's config (including any remote headerImage
                    // fetch + CORS-proxy fallback) concurrently. This used to be a
                    // sequential for-loop with an await per layer, so a handful of
                    // third-party thumbnails that fail CORS (e.g. mapwarper.net
                    // uploads) would serialize into a near-minute stall.
                    const resolvedLayers = await Promise.all(
                        Array.from(activeLayersMap.entries()).map(async ([layerId, layerData]) => {
                            try {
                                const layerConfig = { ...layerData.config };

                                if (window.layerRegistry) {
                                    const registryLayer = window.layerRegistry.getLayer(layerConfig.id);
                                    if (registryLayer && registryLayer.tags) {
                                        if (!layerConfig.tags) {
                                            layerConfig.tags = registryLayer.tags;
                                        } else if (Array.isArray(layerConfig.tags) && Array.isArray(registryLayer.tags)) {
                                            layerConfig.tags = [...new Set([...layerConfig.tags, ...registryLayer.tags])];
                                        }
                                    }
                                }

                                if (layerConfig.headerImage && (layerConfig.headerImage.startsWith('http://') || layerConfig.headerImage.startsWith('https://'))) {
                                    const cacheKey = layerConfig.headerImage;
                                    let dataURLPromise = this._headerImageDataUrlCache.get(cacheKey);
                                    if (!dataURLPromise) {
                                        dataURLPromise = imageToDataURL(cacheKey);
                                        this._headerImageDataUrlCache.set(cacheKey, dataURLPromise);
                                    } else {
                                        console.log(`[Export] Reusing cached headerImage conversion: ${cacheKey.substring(0, 60)}...`);
                                    }
                                    const dataURL = await dataURLPromise;
                                    if (dataURL) {
                                        layerConfig.headerImage = dataURL;
                                    } else {
                                        console.warn(`[Export] Removing headerImage due to CORS/loading failure: ${layerConfig.headerImage}`);
                                        delete layerConfig.headerImage;
                                    }
                                }

                                return { layerId, config: layerConfig };
                            } catch (thumbError) {
                                console.warn(`[Export] Failed to prepare thumbnail for layer ${layerId}:`, thumbError);
                                return null;
                            }
                        })
                    );
                    __step(`resolve ${resolvedLayers.length} layer configs/headerImages`);

                    let thumbnailCount = 0;
                    for (const resolved of resolvedLayers) {
                        if (!resolved) continue;

                        try {
                            const { layerId, config } = resolved;

                            const row = document.createElement('div');
                            row.className = 'layer-thumbnail-row';

                            const thumbnail = LayerThumbnail.generate(config, 38, {
                                isInView: MapUtils.isLayerInView(config, boundsArray)
                            });
                            thumbnail.className = 'layer-thumbnail-item';
                            thumbnail.style.pointerEvents = 'none';
                            thumbnail.style.cursor = 'default';

                            // Remove any event listeners by cloning
                            const cleanThumbnail = thumbnail.cloneNode(true);
                            row.appendChild(cleanThumbnail);

                            const textContainer = document.createElement('div');
                            textContainer.className = 'layer-thumbnail-text';

                            const title = document.createElement('div');
                            title.className = 'layer-thumbnail-title';
                            title.textContent = config.title || config.id;
                            textContainer.appendChild(title);

                            if (config.attribution) {
                                const attribution = document.createElement('div');
                                attribution.className = 'layer-thumbnail-attribution';
                                attribution.innerHTML = config.attribution;
                                textContainer.appendChild(attribution);
                            }

                            row.appendChild(textContainer);

                            layerThumbnailsEl.appendChild(row);
                            thumbnailCount++;
                        } catch (thumbError) {
                            console.warn(`[Export] Failed to generate thumbnail for layer ${resolved.layerId}:`, thumbError);
                        }
                    }
                    console.log(`[Export] Generated ${thumbnailCount} layer thumbnails`);
                    __step(`build ${thumbnailCount} thumbnail DOM rows`);
                } catch (e) {
                    console.error('[Export] Failed to generate layer thumbnails:', e);
                }
            }

            // Render only the footer into an isolated same-origin iframe so html2canvas
            // clones/style-computes a tiny standalone document instead of the entire
            // live app (Shoelace shadow DOM, Mapbox GL controls, jQuery, Tailwind CDN
            // styles), which is what made the whole-document html2canvas call slow.
            const iframe = document.createElement('iframe');
            iframe.style.cssText = `position:fixed; left:-9999px; top:0; width:${width}px; height:${height}px; border:none;`;
            document.body.appendChild(iframe);

            let compositeCanvas;
            try {
                const idoc = iframe.contentDocument;
                idoc.open();
                idoc.write('<!DOCTYPE html><html><head></head><body style="margin:0;padding:0;"></body></html>');
                idoc.close();

                const fontLinkEl = idoc.createElement('link');
                fontLinkEl.rel = 'stylesheet';
                fontLinkEl.href = 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap';
                idoc.head.appendChild(fontLinkEl);

                const styleEl = idoc.createElement('style');
                styleEl.textContent = template.styles.textContent;
                idoc.head.appendChild(styleEl);

                const wrapper = idoc.createElement('div');
                wrapper.style.cssText = `position:relative; width:${width}px; height:${height}px;`;
                idoc.body.appendChild(wrapper);

                const importedFooter = idoc.importNode(footerBox, true);
                importedFooter.style.cssText = 'position: absolute !important; bottom: 0 !important; left: 0 !important; right: 0 !important;';
                wrapper.appendChild(importedFooter);
                __step('build isolated footer iframe');

                if (idoc.fonts && idoc.fonts.ready) {
                    await Promise.race([
                        idoc.fonts.ready,
                        new Promise(resolve => setTimeout(resolve, 1000))
                    ]);
                }
                await new Promise(resolve => iframe.contentWindow.requestAnimationFrame(resolve));
                await new Promise(resolve => iframe.contentWindow.requestAnimationFrame(resolve));
                __step('footer fonts + rAF settle');

                compositeCanvas = await html2canvas(wrapper, {
                    backgroundColor: null,
                    scale: 1,
                    logging: false,
                    useCORS: true,
                    allowTaint: true,
                    foreignObjectRendering: false,
                    width: width,
                    height: height
                });
                __step(`html2canvas footer composite (${width}x${height}px, isolated document)`);
            } finally {
                document.body.removeChild(iframe);
            }

            const outputCanvas = document.createElement('canvas');
            outputCanvas.width = width;
            outputCanvas.height = height;
            const ctx = outputCanvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(mapImg, 0, 0, width, height);
            if (markersImg) {
                ctx.drawImage(markersImg, 0, 0, width, height);
            }
            ctx.drawImage(compositeCanvas, 0, 0, width, height);
            __step('final canvas composite');

            const result = outputCanvas.toDataURL('image/png');
            __step('outputCanvas.toDataURL');
            console.log(`[Export][timing] TOTAL _addFooterToRaster: ${(performance.now() - __profileStart).toFixed(0)}ms`);

            return result;
        } catch (e) {
            console.warn('Failed to add footer to raster, using plain map', e);
            return mapImageDataUrl;
        }
    }


    _generateWorldFile(imageDimensions, transformer, center, pixelWidth, pixelHeight) {
        const pixelSizeX = imageDimensions.width / pixelWidth;
        const pixelSizeY = imageDimensions.height / pixelHeight;

        let centerX, centerY;

        if (transformer.coordSystem === 'wgs84') {
            centerX = center.lng;
            centerY = center.lat;
        } else if (transformer.coordSystem === 'local') {
            centerX = 0;
            centerY = 0;
        } else if (transformer.coordSystem === 'utm') {
            const transformedCenter = transformer._transformCoordinate([center.lng, center.lat]);
            centerX = transformedCenter[0];
            centerY = transformedCenter[1];
        } else {
            centerX = 0;
            centerY = 0;
        }

        const upperLeftX = centerX - (imageDimensions.width / 2);
        const upperLeftY = centerY + (imageDimensions.height / 2);

        let worldFile = '';
        worldFile += pixelSizeX + '\n';
        worldFile += '0.0\n';
        worldFile += '0.0\n';
        worldFile += (-pixelSizeY) + '\n';
        worldFile += upperLeftX + '\n';
        worldFile += upperLeftY + '\n';

        return worldFile;
    }

    /**
     * Style layer IDs for layers currently active (toggled on) in the layer
     * control, scoped the same way map-feature-control-iframe.js scopes
     * click/hover queries. Prevents "export all" from sweeping in basemap or
     * toggled-off layers via map.getStyle()/queryRenderedFeatures().
     */
    _getActiveStyleLayerIds() {
        return new Set(window.stateManager?.getInteractiveRenderedLayerIds() || []);
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

    _generateFilenameFromFeatures(selectedFeatures, extension) {
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

        const parts = [];

        for (const [layerId, group] of layerGroups) {
            const layerTitle = group.layerConfig.title || layerId;
            const sanitizedLayer = layerTitle
                .replace(/[<>:"/\\|?*]/g, '')
                .replace(/\s+/g, '_');

            parts.push(sanitizedLayer);

            for (const feature of group.features) {
                const featureTitle = this._getFeatureTitle(feature, group.layerConfig);
                const sanitizedFeature = featureTitle
                    .replace(/\//g, '-')
                    .replace(/[<>:"\\|?*]/g, '')
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

    _getCurrentAtlasName() {
        try {
            if (window.layerRegistry && window.layerRegistry.currentAtlas) {
                return window.layerRegistry.currentAtlas.name || 'index';
            }
        } catch (e) {
            console.warn('Could not get atlas from layerRegistry:', e);
        }

        try {
            const params = new URLSearchParams(window.location.search);
            const atlasParam = params.get('atlas');
            if (atlasParam && !atlasParam.startsWith('http') && !atlasParam.startsWith('{')) {
                return atlasParam.replace('.atlas.json', '').replace('.json', '');
            }
        } catch (e) {
            console.warn('Could not parse atlas from URL:', e);
        }

        return 'index';
    }

    _getAtlasNameForLayer(layerId, layerConfig) {
        if (!layerId) return this._getCurrentAtlasName();

        try {
            if (window.layerRegistry && window.layerRegistry._atlases) {
                for (const [atlasName, atlasConfig] of window.layerRegistry._atlases.entries()) {
                    if (atlasConfig.layers && atlasConfig.layers.some(l => l.id === layerId)) {
                        console.log(`CSV Export: Found layer ${layerId} in atlas ${atlasName}`);
                        return atlasName;
                    }
                }
            }
        } catch (e) {
            console.warn('Could not find atlas for layer:', e);
        }

        const layerIdParts = layerId.split('-');
        if (layerIdParts.length > 0) {
            const potentialAtlas = layerIdParts[0];
            console.log(`CSV Export: Guessing atlas "${potentialAtlas}" from layer ID "${layerId}"`);
            return potentialAtlas;
        }

        return this._getCurrentAtlasName();
    }

    _getLayerConfigById(layerId) {
        if (!layerId) return null;

        if (window.stateManager) {
            const layers = window.stateManager.getActiveLayers();
            const layerData = layers.get(layerId);
            if (layerData?.config) {
                return layerData.config;
            }
        }

        return null;
    }

    async _extractHandlerData(htmlOutput, feature) {
        if (!htmlOutput) return '';

        const apiUrlMatch = htmlOutput.match(/const apiUrl = '([^']+)'/);
        if (apiUrlMatch && apiUrlMatch[1]) {
            const apiUrl = apiUrlMatch[1];
            console.log(`CSV Export: Found Bhunaksha API URL, fetching data...`);

            try {
                const response = await fetch(apiUrl);
                const data = await response.json();

                if (data.info && data.has_data === 'Y') {
                    const isHTML = /<[^>]*>/g.test(data.info);
                    let infoText;

                    if (isHTML) {
                        infoText = data.info
                            .replace(/<style>[\s\S]*?<\/style>/gi, '')
                            .replace(/<script[\s\S]*?<\/script>/gi, '')
                            .replace(/<[^>]*>/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                    } else {
                        const rawText = data.info.split('\n').slice(3).join('\n').replace(/-{10,}/g, '');
                        infoText = rawText.replace(/^([^:\n]+:)/gm, '$1 ').replace(/\n/g, ' ');
                    }

                    console.log(`CSV Export: Fetched Bhunaksha data: "${infoText.substring(0, 100)}..."`);
                    return infoText.trim();
                } else {
                    return 'No occupant data available';
                }
            } catch (error) {
                console.warn('CSV Export: Failed to fetch Bhunaksha data:', error);
                return 'Error loading data';
            }
        }

        return this._stripHtmlTags(htmlOutput);
    }

    _stripHtmlTags(html) {
        if (!html) return '';
        return html
            .replace(/<style>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _isFeatureCompletelyInView(feature, bounds) {
        if (!feature || !feature.geometry) return false;

        const geometry = feature.geometry;
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();

        const isPointInBounds = (lng, lat) => {
            return lng >= sw.lng && lng <= ne.lng && lat >= sw.lat && lat <= ne.lat;
        };

        const checkCoordinates = (coords) => {
            if (typeof coords[0] === 'number') {
                return isPointInBounds(coords[0], coords[1]);
            }
            return coords.every(checkCoordinates);
        };

        switch (geometry.type) {
            case 'Point':
                return isPointInBounds(geometry.coordinates[0], geometry.coordinates[1]);

            case 'MultiPoint':
            case 'LineString':
                return geometry.coordinates.every(coord => isPointInBounds(coord[0], coord[1]));

            case 'MultiLineString':
            case 'Polygon':
                return geometry.coordinates.every(ring =>
                    ring.every(coord => isPointInBounds(coord[0], coord[1]))
                );

            case 'MultiPolygon':
                return geometry.coordinates.every(polygon =>
                    polygon.every(ring => ring.every(coord => isPointInBounds(coord[0], coord[1])))
                );

            default:
                return false;
        }
    }

    _parseExportURL() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const exportParam = urlParams.get('export');

            if (!exportParam) {
                return null;
            }

            const settings = JSON.parse(decodeURIComponent(exportParam));
            return settings;
        } catch (e) {
            console.warn('Failed to parse export URL parameter:', e);
            return null;
        }
    }
}

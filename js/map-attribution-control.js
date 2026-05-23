/**
 * MapAttributionControl - A Mapbox GL JS plugin that manages and formats attribution content
 *
 * This plugin extends the default Mapbox attribution control to:
 * - Remove duplicate "Improve this map" links
 * - Format attribution content as layers change
 * - Provide a cleaner, more organized attribution display
 *
 */

export class MapAttributionControl {
    constructor() {
        this._map = null;
        this._container = $("<div class='mapboxgl-ctrl mapboxgl-ctrl-group mapboxgl-ctrl-attrib mapboxgl-ctrl-attrib-inner'></div>").get(0);
        this._layerAttributions = new Map();
        this._locationName = null;

        this._centerMarker = null;
        this._centerPopup = null;
        this._resultMarker = null;
        this._resultPopup = null;
        this._fetchAbort = null;
        this._hoverActive = false;
        this._nominatimCache = new Map();

        // Bind methods to preserve context
        this._updateAttribution = this._updateAttribution.bind(this);
        this._handleSourceChange = this._handleSourceChange.bind(this);
        this._handleLinkOver = this._handleLinkOver.bind(this);
        this._handleLinkOut = this._handleLinkOut.bind(this);
    }

    onAdd(map) {
        this._map = map;
        // Listen for source changes
        this._map.on('sourcedata', this._handleSourceChange);
        this._map.on('styledata', this._handleSourceChange);
        this._map.on('data', this._handleSourceChange);

        // Listen for layer visibility changes
        this._map.on('layer.add', this._updateAttribution);
        this._map.on('layer.remove', this._updateAttribution);

        // Listen for map movement to update dynamic location params in attribution URLs
        this._map.on('moveend', this._updateAttribution);

        // Delegated hover handlers for OSM attribution link → show preview marker
        this._container.addEventListener('mouseover', this._handleLinkOver);
        this._container.addEventListener('mouseout', this._handleLinkOut);

        // Set up initial attribution
        this._updateAttribution();
        return this._container;
    }

    onRemove() {
        this._map.off('sourcedata', this._handleSourceChange);
        this._map.off('styledata', this._handleSourceChange);
        this._map.off('data', this._handleSourceChange);
        this._map.off('layer.add', this._updateAttribution);
        this._map.off('layer.remove', this._updateAttribution);
        this._map.off('moveend', this._updateAttribution);
        this._container.removeEventListener('mouseover', this._handleLinkOver);
        this._container.removeEventListener('mouseout', this._handleLinkOut);
        this._clearHover();
        this._map = null;
        this._container.parentNode.removeChild(this._container);
        this._container = null;
    }

    _handleLinkOver(e) {
        const link = e.target.closest('.osm-attribution-link');
        if (!link || !this._map) return;
        if (this._hoverActive) return;

        const lat = parseFloat(link.dataset.lat);
        const lon = parseFloat(link.dataset.lon);
        const zoom = parseInt(link.dataset.zoom, 10);
        if (isNaN(lat) || isNaN(lon)) return;

        this._hoverActive = true;

        // Red marker for query (map center) point
        this._centerMarker = new mapboxgl.Marker({ color: '#ef4444' })
            .setLngLat([lon, lat])
            .addTo(this._map);
        this._centerPopup = new mapboxgl.Popup({ offset: 30, closeButton: false, closeOnClick: false, className: 'osm-hover-popup', anchor: 'bottom' })
            .setLngLat([lon, lat])
            .setHTML(this._formatCenterHTML())
            .addTo(this._map);

        // Fetch (or read from cache) Nominatim reverse-geocode result
        const cacheKey = `${lat.toFixed(6)},${lon.toFixed(6)},${zoom}`;
        if (this._nominatimCache.has(cacheKey)) {
            this._showResult(this._nominatimCache.get(cacheKey));
            return;
        }

        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=${zoom}`;
        this._fetchAbort = new AbortController();
        fetch(url, { signal: this._fetchAbort.signal, headers: { 'Accept-Language': 'en' } })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return;
                this._nominatimCache.set(cacheKey, data);
                if (this._hoverActive) this._showResult(data);
            })
            .catch(err => {
                if (err.name !== 'AbortError') {
                    console.warn('[MapAttributionControl] Nominatim fetch failed:', err);
                }
            });
    }

    _handleLinkOut(e) {
        const link = e.target.closest('.osm-attribution-link');
        if (!link) return;
        // Ignore moves between the link and its child elements (img/strong)
        if (link.contains(e.relatedTarget)) return;
        this._clearHover();
    }

    _showResult(data) {
        if (!this._hoverActive || !this._map || !data || !data.lat || !data.lon) return;

        const resultLat = parseFloat(data.lat);
        const resultLon = parseFloat(data.lon);
        if (isNaN(resultLat) || isNaN(resultLon)) return;

        // Bbox layer (under markers in z-order)
        if (Array.isArray(data.boundingbox) && data.boundingbox.length === 4) {
            const [minLat, maxLat, minLon, maxLon] = data.boundingbox.map(parseFloat);
            if ([minLat, maxLat, minLon, maxLon].every(n => !isNaN(n))) {
                const polygon = {
                    type: 'Feature',
                    geometry: {
                        type: 'Polygon',
                        coordinates: [[
                            [minLon, minLat],
                            [maxLon, minLat],
                            [maxLon, maxLat],
                            [minLon, maxLat],
                            [minLon, minLat]
                        ]]
                    }
                };
                if (this._map.getSource('_osm-hover-bbox')) {
                    this._map.getSource('_osm-hover-bbox').setData(polygon);
                } else {
                    this._map.addSource('_osm-hover-bbox', { type: 'geojson', data: polygon });
                    this._map.addLayer({
                        id: '_osm-hover-bbox-fill',
                        type: 'fill',
                        source: '_osm-hover-bbox',
                        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.15 }
                    });
                    this._map.addLayer({
                        id: '_osm-hover-bbox-line',
                        type: 'line',
                        source: '_osm-hover-bbox',
                        paint: { 'line-color': '#3b82f6', 'line-width': 2 }
                    });
                }
            }
        }

        // Blue marker + popup for result
        this._resultMarker = new mapboxgl.Marker({ color: '#3b82f6' })
            .setLngLat([resultLon, resultLat])
            .addTo(this._map);
        this._resultPopup = new mapboxgl.Popup({ offset: 30, closeButton: false, closeOnClick: false, className: 'osm-hover-popup', anchor: 'bottom' })
            .setLngLat([resultLon, resultLat])
            .setHTML(this._formatResultHTML(data))
            .addTo(this._map);
    }

    _formatCenterHTML() {
        return `
            <div class="osm-hover-popup-body" style="
                background: #1e293b;
                color: #e2e8f0;
                padding: 8px 12px;
                border-radius: 6px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <div style="width: 8px; height: 8px; background: #ef4444; border-radius: 50%; box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.25); flex-shrink: 0;"></div>
                    <div style="font-size: 10px; font-weight: 700; color: #fca5a5; letter-spacing: 0.5px; text-transform: uppercase;">Map Center</div>
                </div>
            </div>
        `;
    }

    _formatResultHTML(data) {
        const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

        const name = data.name ||
            (data.address && (data.address.road || data.address.pedestrian || data.address.neighbourhood || data.address.suburb || data.address.town || data.address.city)) ||
            '';
        const displayName = data.display_name || '';
        const licenceHTML = data.licence
            ? esc(data.licence).replace(/(https?:\/\/\S+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #60a5fa; text-decoration: none;">$1</a>')
            : '';

        return `
            <div class="osm-hover-popup-body" style="
                background: #1e293b;
                color: #e2e8f0;
                border-radius: 6px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                min-width: 220px;
                max-width: 280px;
                overflow: hidden;
            ">
                <div style="padding: 10px 12px; background: #111827; border-bottom: 1px solid #334155;">
                    <div style="display: flex; align-items: center; gap: 6px; ${name ? 'margin-bottom: 6px;' : ''}">
                        <div style="width: 8px; height: 8px; background: #3b82f6; border-radius: 50%; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25); flex-shrink: 0;"></div>
                        <div style="font-size: 10px; font-weight: 700; color: #93c5fd; letter-spacing: 0.5px; text-transform: uppercase;">Closest Landmark</div>
                    </div>
                    ${name ? `<div style="font-size: 13px; font-weight: 600; color: #f1f5f9; line-height: 1.35;">${esc(name)}</div>` : ''}
                </div>
                ${displayName ? `<div style="padding: 8px 12px;"><div style="font-size: 11px; color: #cbd5e1; line-height: 1.5;">${esc(displayName)}</div></div>` : ''}
                ${licenceHTML ? `<div style="padding: 6px 12px 8px; border-top: 1px solid #334155; font-size: 9px; color: #6b7280; line-height: 1.4;">${licenceHTML}</div>` : ''}
            </div>
        `;
    }

    _clearHover() {
        this._hoverActive = false;

        if (this._fetchAbort) {
            this._fetchAbort.abort();
            this._fetchAbort = null;
        }
        if (this._centerPopup) { this._centerPopup.remove(); this._centerPopup = null; }
        if (this._centerMarker) { this._centerMarker.remove(); this._centerMarker = null; }
        if (this._resultPopup) { this._resultPopup.remove(); this._resultPopup = null; }
        if (this._resultMarker) { this._resultMarker.remove(); this._resultMarker = null; }

        if (this._map) {
            if (this._map.getLayer('_osm-hover-bbox-fill')) this._map.removeLayer('_osm-hover-bbox-fill');
            if (this._map.getLayer('_osm-hover-bbox-line')) this._map.removeLayer('_osm-hover-bbox-line');
            if (this._map.getSource('_osm-hover-bbox')) this._map.removeSource('_osm-hover-bbox');
        }
    }

    /**
     * Handle source data changes
     */
    _handleSourceChange(e) {
        // Only update on source or style load events
        if (e.sourceDataType === 'metadata' || e.type === 'styledata') {
            this._updateAttribution();
        }
    }

    /**
     * Add layer-specific attribution
     */
    addLayerAttribution(layerId, attribution) {
        this._layerAttributions.set(layerId, attribution);
        this._updateAttribution();
    }

    /**
     * Remove layer-specific attribution
     */
    removeLayerAttribution(layerId) {
        this._layerAttributions.delete(layerId);
        this._updateAttribution();
    }

    /**
     * Set the current location name to display in attribution
     */
    setLocation(locationName) {
        this._locationName = locationName;
        this._updateAttribution();
    }

    /**
     * Replace hash location parameters in URLs with current map view
     * Supports formats:
     * - #map=zoom/lat/lng (e.g., #map=16/15.49493/73.82864)
     * - #zoom/lat/lng (e.g., #11.25/15.3962/73.8595)
     */
    _replaceLocationHash(url) {
        if (!url || !this._map) {
            return url;
        }

        try {
            const center = this._map.getCenter();
            const zoom = this._map.getZoom();
            const lat = center.lat.toFixed(5);
            const lng = center.lng.toFixed(5);
            const zoomRounded = zoom.toFixed(2);

            // Try to parse as absolute URL first
            try {
                const urlObj = new URL(url, window.location.href);
                const hash = urlObj.hash;

                if (hash) {
                    // Format 1: #map=zoom/lat/lng
                    const mapFormatMatch = hash.match(/^#map=([\d.]+)\/([\d.-]+)\/([\d.-]+)$/);
                    if (mapFormatMatch) {
                        urlObj.hash = `#map=${zoomRounded}/${lat}/${lng}`;
                        return urlObj.toString();
                    }

                    // Format 2: #zoom/lat/lng
                    const directFormatMatch = hash.match(/^#([\d.]+)\/([\d.-]+)\/([\d.-]+)$/);
                    if (directFormatMatch) {
                        urlObj.hash = `#${zoomRounded}/${lat}/${lng}`;
                        return urlObj.toString();
                    }
                }
            } catch (urlError) {
                // If URL parsing fails, fall through to regex replacement
            }

            // Fallback: regex replacement for relative URLs or malformed URLs
            // Format 1: #map=zoom/lat/lng
            if (url.includes('#map=')) {
                url = url.replace(/#map=([\d.]+)\/([\d.-]+)\/([\d.-]+)/g, `#map=${zoomRounded}/${lat}/${lng}`);
            } else {
                // Format 2: #zoom/lat/lng
                // Match hash pattern: # followed by numbers, slash, numbers, slash, numbers
                // Ensure it's at the end of URL or followed by non-slash character (like ?, &, #, or end)
                url = url.replace(/#([\d.]+)\/([\d.-]+)\/([\d.-]+)(?![\/])/g, `#${zoomRounded}/${lat}/${lng}`);
            }
        } catch (error) {
            // If all parsing fails, return original URL
            console.debug('[MapAttributionControl] Could not parse URL for location replacement:', url, error);
        }

        return url;
    }

    /**
     * Update attribution content
     */
    _updateAttribution() {
        try {
            // Try to get the style - handle the error if it's not ready
            const style = this._map.getStyle();
            const attributions = new Set();
            const processed = new Set();
            const visibleSources = new Set();
            const visibleConfigLayers = new Set();

            if (!style || !style.sources) {
                return;
            }
            style.layers.forEach(layer => {
                if (layer.source) {
                    // Layer is visible if visibility is undefined or 'visible' (not 'none')
                    const visibility = this._map.getLayoutProperty(layer.id, 'visibility');
                    if (visibility === undefined || visibility === 'visible') {
                        visibleSources.add(layer.source);

                        if (layer.metadata && layer.metadata.groupId) {
                            visibleConfigLayers.add(layer.metadata.groupId);
                        } else {
                            // Try to extract config layer ID from style layer ID patterns
                            // Common patterns: vector-layer-{id}, geojson-{id}-, csv-{id}-, tms-layer-{id}, etc.
                            const patterns = [
                                /^vector-layer-([^-]+)/,
                                /^geojson-([^-]+)-/,
                                /^csv-([^-]+)-/,
                                /^tms-layer-(.+)/,
                                /^wms-layer-(.+)/,
                                /^wmts-layer-(.+)/,
                                /^img-layer-(.+)/,
                            ];

                            for (const pattern of patterns) {
                                const match = layer.id.match(pattern);
                                if (match) {
                                    visibleConfigLayers.add(match[1]);
                                    break;
                                }
                            }

                            // Also check if style layer ID directly matches or starts with a config layer ID
                            // This handles cases where style layer ID is the same as config layer ID
                            this._layerAttributions.forEach((_, configLayerId) => {
                                if (layer.id === configLayerId ||
                                    layer.id.startsWith(configLayerId + '-') ||
                                    layer.id.startsWith(configLayerId + ' ')) {
                                    visibleConfigLayers.add(configLayerId);
                                }
                            });
                        }
                    }
                }
            });

            // Add source attributions only for sources used by visible layers
            Object.entries(style.sources).forEach(([sourceId, source]) => {
                if (source.attribution && visibleSources.has(sourceId)) {
                    // Skip sources that we're managing via _layerAttributions to avoid duplication
                    if (!Array.from(this._layerAttributions.values()).some(attr => attr === source.attribution)) {
                        attributions.add(source.attribution);
                    }
                }
            });

            if (this._layerAttributions.size > 0) {
                // Only add attributions for visible config layers
                // Also verify that the config layer actually has visible style layers (not just pattern matches)
                this._layerAttributions.forEach((attribution, layerId) => {
                    if (attribution && attribution.trim() && visibleConfigLayers.has(layerId)) {
                        // Double-check: verify at least one style layer with this config ID is actually visible
                        const hasVisibleStyleLayer = style.layers.some(styleLayer => {
                            const visibility = this._map.getLayoutProperty(styleLayer.id, 'visibility');
                            const isVisible = visibility === undefined || visibility === 'visible';

                            // Check if this style layer belongs to this config layer
                            // Use strict matching to avoid false positives
                            const belongsToLayer = (styleLayer.metadata && styleLayer.metadata.groupId === layerId) || styleLayer.id.includes(layerId);

                            return isVisible && belongsToLayer;
                        });

                        if (hasVisibleStyleLayer) {
                            attributions.add(attribution);
                        }
                    }
                });
            }

            // Filter out empty attributions
            const validAttributions = Array.from(attributions).filter(attr => attr && attr.trim());

            // Add location attribution at the beginning if available
            if (this._locationName) {
                const center = this._map.getCenter();
                const zoom = this._map.getZoom();
                const lat = center.lat.toFixed(6);
                const lng = center.lng.toFixed(6);
                const zoomRounded = Math.round(zoom);

                const locationUrl = `https://www.openstreetmap.org/search?lat=${lat}&lon=${lng}&zoom=${zoomRounded}`;
                const locationAttribution = `<a class="osm-attribution-link" data-lat="${lat}" data-lon="${lng}" data-zoom="${zoomRounded}" href="${locationUrl}" target="_blank" rel="noopener noreferrer" title="Edit on the OpenStreetMap Project"><img src="https://upload.wikimedia.org/wikipedia/commons/b/b0/Openstreetmap_logo.svg" alt="OSM" width="14" height="14" style="display: inline-block; vertical-align: middle; margin-right: 3px;"><strong>${this._locationName}</strong></a>`;
                processed.add(locationAttribution);
            }

            if (validAttributions.length === 0 && !this._locationName) {
                this._container.innerHTML = '';
                return;
            }

            validAttributions.forEach(attribution => {
                // Parse links from the attribution
                const tempDiv = $('<div>' + attribution + '</div>').get(0);
                if (tempDiv.querySelectorAll('a').length > 0) {
                    // Process each link separately to avoid duplicates
                    tempDiv.querySelectorAll('a').forEach(link => {
                        // Replace location hash parameters with current map view
                        const originalHref = link.getAttribute('href');
                        if (originalHref) {
                            const updatedHref = this._replaceLocationHash(originalHref);
                            link.setAttribute('href', updatedHref);
                        }
                        link.setAttribute('target', '_blank');
                        link.setAttribute('rel', 'noopener noreferrer');
                        processed.add(link.outerHTML);
                    });
                } else {
                    // Handle plain text attributions
                    processed.add(attribution.trim());
                }
            });

            this._container.innerHTML = [...processed].join(' | ');
        } catch (error) {
            // Silently ignore errors during initial load when style isn't ready
            if (error.message !== 'Style is not done loading') {
                console.warn('[MapAttributionControl] Error updating attribution:', error);
            }
        }
    }
}

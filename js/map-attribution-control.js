/**
 * MapAttributionControl - A Mapbox GL JS plugin that manages and formats attribution content
 *
 * This plugin extends the default Mapbox attribution control to:
 * - Remove duplicate "Improve this map" links
 * - Format attribution content as layers change
 * - Provide a cleaner, more organized attribution display
 *
 */

import { LayerThumbnail } from './layer-thumbnail.js';

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
        this._hoverActive = false;
        this._nominatimCache = new Map();
        this._inFlightFetches = new Map();
        this._locationLinkEl = null;
        this._locationLinkTextEl = null;

        this._contentEl = null;
        this._toggleEl = null;
        this._expanded = false;
        this._hiddenCount = 0;
        this._itemLayers = [];

        // Bind methods to preserve context
        this._updateAttribution = this._updateAttribution.bind(this);
        this._handleSourceChange = this._handleSourceChange.bind(this);
        this._handleLinkOver = this._handleLinkOver.bind(this);
        this._handleLinkOut = this._handleLinkOut.bind(this);
        this._handleToggleClick = this._handleToggleClick.bind(this);
        this._handleMoveStart = this._handleMoveStart.bind(this);
        this._handleItemClick = this._handleItemClick.bind(this);
        this._handleItemHover = this._handleItemHover.bind(this);
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

        // Collapse the expanded attribution list as soon as the user starts panning/zooming
        this._map.on('movestart', this._handleMoveStart);

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
        this._map.off('movestart', this._handleMoveStart);
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

        // If a fetch is already in flight for this location, just wait on it.
        // Don't abort on hover-out — let it finish so the cache fills and
        // subsequent hovers of the same location are instant.
        let promise = this._inFlightFetches.get(cacheKey);
        if (!promise) {
            const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=${zoom}`;
            promise = fetch(url, { headers: { 'Accept-Language': 'en' } })
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (data) this._nominatimCache.set(cacheKey, data);
                    return data;
                })
                .catch(err => {
                    console.warn('[MapAttributionControl] Nominatim fetch failed:', err);
                    return null;
                })
                .finally(() => {
                    this._inFlightFetches.delete(cacheKey);
                });
            this._inFlightFetches.set(cacheKey, promise);
        }

        promise.then(data => {
            if (data && this._hoverActive) this._showResult(data);
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

        // Idempotent: if a prior result is still on the map, remove it first.
        // Multiple promise handlers can attach to the same in-flight fetch
        // (one per hover); without this, each handler creates a new
        // marker/popup and overwrites the reference, orphaning the old ones.
        if (this._resultPopup) { this._resultPopup.remove(); this._resultPopup = null; }
        if (this._resultMarker) { this._resultMarker.remove(); this._resultMarker = null; }

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
    addLayerAttribution(layerId, attribution, title, layer) {
        this._layerAttributions.set(layerId, { attribution, title: title || layerId, layer: layer || null });
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

    _ensureContentStructure() {
        if (this._contentEl) return;

        this._contentEl = document.createElement('span');
        this._contentEl.className = 'map-attrib-content';
        this._contentEl.addEventListener('click', this._handleItemClick);
        this._contentEl.addEventListener('mouseover', this._handleItemHover);

        this._toggleEl = document.createElement('button');
        this._toggleEl.type = 'button';
        this._toggleEl.className = 'map-attrib-toggle';
        this._toggleEl.addEventListener('click', this._handleToggleClick);

        this._container.appendChild(this._contentEl);
        this._container.appendChild(this._toggleEl);
    }

    _handleToggleClick(e) {
        e.preventDefault();
        e.stopPropagation();
        this._expanded = !this._expanded;
        this._applyExpandedState();
    }

    _handleMoveStart() {
        if (!this._expanded) return;
        this._expanded = false;
        this._applyExpandedState();
    }

    /**
     * Resolve the layer object backing the .attrib-item an event occurred in,
     * via its data-attrib-idx pointer into this._itemLayers.
     */
    _layerForEvent(e) {
        const item = e.target.closest('.attrib-item');
        const idx = item ? parseInt(item.dataset.attribIdx, 10) : NaN;
        return Number.isInteger(idx) ? this._itemLayers[idx] : null;
    }

    /**
     * Clicking a layer's thumbnail/name opens its map-information.html panel;
     * clicking the hover actions triggers the select/edit/remove behaviors.
     * All go through the same postMessage conventions used elsewhere
     * (LayerThumbnail, map-marker-manager.js) — index.html already has the
     * #layer-info-modal/#layer-info-iframe pair and remove-layer listener.
     */
    _handleItemClick(e) {
        if (!this._expanded) return;

        const selectTrigger = e.target.closest('.attrib-action-select');
        const editTrigger = e.target.closest('.attrib-action-edit');
        const removeTrigger = e.target.closest('.attrib-action-remove');
        const infoTrigger = e.target.closest('.attrib-label, .attrib-layer-thumb');
        const trigger = selectTrigger || editTrigger || removeTrigger || infoTrigger;
        if (!trigger) return;

        const layer = this._layerForEvent(e);
        if (!layer) return;

        e.preventDefault();
        e.stopPropagation();

        if (selectTrigger) {
            window.featureControl?.showLayerSelection(layer.id);
        } else if (editTrigger) {
            window.postMessage({ type: 'open-layer-info', layer, edit: true }, '*');
        } else if (removeTrigger) {
            window.postMessage({ type: 'remove-layer', layerId: layer.id }, '*');
        } else {
            window.postMessage({ type: 'open-layer-info', layer }, '*');
        }
    }

    /**
     * Refresh the "[N features selected]" hover action with a live count —
     * computed on hover rather than baked in at render time since selections
     * can change without the attribution list re-rendering. Only shown when
     * the layer actually has an active selection.
     *
     * Uses visibility (never display) so this can run on every hover without
     * changing the row's layout — the action's space is already reserved via
     * the item's fixed padding-right, whether or not it ends up visible.
     */
    _handleItemHover(e) {
        const item = e.target.closest('.attrib-item');
        if (!item) return;
        const selectAction = item.querySelector('.attrib-action-select');
        if (!selectAction) return;

        const layer = this._layerForEvent(e);
        if (!layer || !window.stateManager) {
            selectAction.style.visibility = 'hidden';
            return;
        }

        const features = window.stateManager.getLayerFeatures(layer.id);
        const count = Array.from(features.values()).filter(f => f.isSelected).length;
        if (count > 0) {
            selectAction.textContent = `[${count} feature${count === 1 ? '' : 's'} selected]`;
            selectAction.style.visibility = '';
        } else {
            selectAction.style.visibility = 'hidden';
        }
    }

    _buildThumbnailHTML(layer) {
        try {
            const thumb = LayerThumbnail.generate(layer, 14, { interactive: false });
            thumb.classList.add('attrib-layer-thumb');
            thumb.style.verticalAlign = 'middle';
            thumb.style.marginRight = '4px';
            thumb.style.cursor = 'pointer';
            return thumb.outerHTML;
        } catch (error) {
            console.warn('[MapAttributionControl] Failed to build layer thumbnail:', error);
            return '';
        }
    }

    _buildActionsHTML() {
        return `<span class="attrib-actions">` +
            `<button type="button" class="attrib-action-btn attrib-action-select" style="visibility:hidden">[0 features selected]</button> ` +
            `<button type="button" class="attrib-action-btn attrib-action-edit">[edit]</button> ` +
            `<button type="button" class="attrib-action-btn attrib-action-remove">[remove]</button>` +
            `</span>`;
    }

    _applyExpandedState() {
        if (!this._contentEl || !this._toggleEl) return;
        this._container.classList.toggle('is-expanded', this._expanded);
        this._toggleEl.textContent = this._expanded
            ? '[x]'
            : `[${this._hiddenCount} more source${this._hiddenCount === 1 ? '' : 's'}...]`;
    }

    _ensureLocationLinkEl() {
        if (this._locationLinkEl) return;

        const a = document.createElement('a');
        a.className = 'osm-attribution-link attrib-item';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = 'Edit on the OpenStreetMap Project';

        const img = document.createElement('img');
        img.src = 'https://upload.wikimedia.org/wikipedia/commons/b/b0/Openstreetmap_logo.svg';
        img.alt = 'OSM';
        img.width = 14;
        img.height = 14;
        img.style.cssText = 'display: inline-block; vertical-align: middle; margin-right: 3px;';

        const strong = document.createElement('strong');

        a.appendChild(img);
        a.appendChild(strong);

        this._locationLinkEl = a;
        this._locationLinkTextEl = strong;
    }

    _updateLocationLinkEl() {
        const center = this._map.getCenter();
        const zoom = this._map.getZoom();
        const lat = center.lat.toFixed(6);
        const lng = center.lng.toFixed(6);
        const zoomRounded = Math.round(zoom);

        this._locationLinkEl.href = `https://www.openstreetmap.org/search?lat=${lat}&lon=${lng}&zoom=${zoomRounded}`;
        this._locationLinkEl.dataset.lat = lat;
        this._locationLinkEl.dataset.lon = lng;
        this._locationLinkEl.dataset.zoom = String(zoomRounded);
        this._locationLinkTextEl.textContent = this._locationName;
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
            // Keyed by attribution HTML so identical attributions (e.g. shared across
            // layers) collapse to a single labeled line rather than repeating.
            const attributionLabels = new Map();
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
                    const isManaged = Array.from(this._layerAttributions.values()).some(entry => entry.attribution === source.attribution);
                    if (!isManaged && !attributionLabels.has(source.attribution)) {
                        attributionLabels.set(source.attribution, { label: sourceId, layer: null });
                    }
                }
            });

            if (this._layerAttributions.size > 0) {
                // Only add attributions for visible config layers
                // Also verify that the config layer actually has visible style layers (not just pattern matches)
                this._layerAttributions.forEach(({ attribution, title, layer }, layerId) => {
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

                        if (hasVisibleStyleLayer && !attributionLabels.has(attribution)) {
                            attributionLabels.set(attribution, { label: title || layerId, layer });
                        }
                    }
                });
            }

            if (attributionLabels.size === 0 && !this._locationName) {
                this._container.innerHTML = '';
                this._contentEl = null;
                this._toggleEl = null;
                this._itemLayers = [];
                return;
            }

            const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
            const processed = [];
            this._itemLayers = [];
            attributionLabels.forEach(({ label, layer }, attribution) => {
                // One line per layer: rewrite any links in-place rather than splitting
                // them into separate items, so a multi-link attribution still reads as
                // a single labeled entry.
                const tempDiv = $('<div>' + attribution + '</div>').get(0);
                tempDiv.querySelectorAll('a').forEach(link => {
                    const originalHref = link.getAttribute('href');
                    if (originalHref) {
                        link.setAttribute('href', this._replaceLocationHash(originalHref));
                    }
                    link.setAttribute('target', '_blank');
                    link.setAttribute('rel', 'noopener noreferrer');
                });
                const idx = this._itemLayers.length;
                this._itemLayers.push(layer || null);
                const thumbHtml = layer ? this._buildThumbnailHTML(layer) : '';
                const actionsHtml = layer ? this._buildActionsHTML() : '';
                const itemClass = layer ? 'attrib-item has-actions' : 'attrib-item';
                processed.push(`<span class="${itemClass}" data-attrib-idx="${idx}">${thumbHtml}<span class="attrib-label">${esc(label)}: </span>${tempDiv.innerHTML.trim()}${actionsHtml}</span>`);
            });

            // Rebuild the static (source) attribution items inside the content wrapper.
            // The location link is a persistent DOM subtree (see _ensureLocationLinkEl)
            // so its <img> isn't destroyed/recreated on every tile-load event —
            // this prevents the OSM logo from flashing and from being refetched.
            this._ensureContentStructure();
            this._contentEl.innerHTML = processed.join('');

            if (this._locationName) {
                this._ensureLocationLinkEl();
                this._updateLocationLinkEl();
                this._contentEl.insertBefore(this._locationLinkEl, this._contentEl.firstChild);
            }

            const totalCount = processed.length + (this._locationName ? 1 : 0);
            this._hiddenCount = Math.max(0, totalCount - 1);
            this._toggleEl.style.display = this._hiddenCount > 0 ? '' : 'none';
            this._applyExpandedState();
        } catch (error) {
            // Silently ignore errors during initial load when style isn't ready
            if (error.message !== 'Style is not done loading') {
                console.warn('[MapAttributionControl] Error updating attribution:', error);
            }
        }
    }
}

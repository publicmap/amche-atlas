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
        this._address = null;
        this._place = null;

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
        this._map = null;
        this._container.parentNode.removeChild(this._container);
        this._container = null;
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
     * Set the current location name to display in attribution. `address` is
     * the raw Nominatim `address` object (road/neighbourhood/state/country/...)
     * from the same reverse-geocode response, kept here so other consumers
     * (e.g. js/map-location-menu-control.js) can reuse it instead of issuing
     * their own reverse-geocode call for the same map center. `place` is the
     * OSM object that response matched ({osmType, osmId, name}), which the
     * place menu links to.
     */
    setLocation(locationName, address = null, place = null) {
        this._locationName = locationName;
        this._address = address;
        this._place = place;
        this._updateAttribution();
        window.dispatchEvent(new CustomEvent('mapLocationChanged', { detail: { address } }));
    }

    /**
     * The raw Nominatim `address` object from the last reverse-geocode (see
     * setLocation above) - used by js/locale-manager.js to default the
     * locale country to wherever the map is currently centered.
     */
    getAddress() {
        return this._address;
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
     * Clicking a layer's thumbnail/name opens its the layer editor (map-creator.html) panel;
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
                    // Format 1: a `map=` key anywhere in the (possibly multi-param,
                    // &-joined) hash, e.g. "#map=zoom/lat/lng" or IndianOpenMaps'
                    // "#source=...&map=zoom/lat/lng&terrain=...&base=...". The value
                    // may also be empty ("&map=") — filled in here on first move.
                    if (/(^#|&)map=/.test(hash)) {
                        urlObj.hash = hash.replace(/(^#|&)map=[^&]*/, `$1map=${zoomRounded}/${lat}/${lng}`);
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
            // Format 1: a `map=` key anywhere in the hash (see comment above)
            if (/[#&]map=/.test(url)) {
                url = url.replace(/([#&])map=[^&]*/, `$1map=${zoomRounded}/${lat}/${lng}`);
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
            // Keyed by layer id (falling back to attribution HTML for unmanaged
            // sources) so distinct layers that happen to share identical attribution
            // text - e.g. multiple Bhunaksha layers all crediting the same source -
            // each still get their own labeled line instead of collapsing to one.
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
            const isAttributionDuplicated = attribution => Array.from(attributionLabels.values()).some(entry => entry.attribution === attribution);

            Object.entries(style.sources).forEach(([sourceId, source]) => {
                if (source.attribution && visibleSources.has(sourceId)) {
                    // Skip sources that we're managing via _layerAttributions to avoid duplication
                    const isManaged = Array.from(this._layerAttributions.values()).some(entry => entry.attribution === source.attribution);
                    if (!isManaged && !isAttributionDuplicated(source.attribution)) {
                        attributionLabels.set(sourceId, { label: sourceId, layer: null, attribution: source.attribution });
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

                        if (hasVisibleStyleLayer) {
                            attributionLabels.set(layerId, { label: title || layerId, layer, attribution });
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
            attributionLabels.forEach(({ label, layer, attribution }) => {
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
                processed.push(`<span class="${itemClass}" data-attrib-idx="${idx}"><span class="attrib-main">${thumbHtml}<span class="attrib-label">${esc(label)}: </span>${tempDiv.innerHTML.trim()}</span>${actionsHtml}</span>`);
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

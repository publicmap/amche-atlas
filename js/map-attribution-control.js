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

        // Bind methods to preserve context
        this._updateAttribution = this._updateAttribution.bind(this);
        this._handleSourceChange = this._handleSourceChange.bind(this);
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

                const locationUrl = `https://www.openstreetmap.org/search?lat=${lat}&lon=${lng}&zoom=${zoomRounded}#map=${zoomRounded}/${lat}/${lng}`;
                const locationAttribution = `<a href="${locationUrl}" target="_blank" rel="noopener noreferrer" title="View on OpenStreetMap">📍 ${this._locationName}</a>`;
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

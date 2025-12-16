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
            if (validAttributions.length === 0) {
                this._container.innerHTML = '';
                return;
            }

            validAttributions.forEach(attribution => {
                // Parse links from the attribution
                const tempDiv = $('<div>' + attribution + '</div>').get(0);
                if (tempDiv.querySelectorAll('a').length > 0) {
                    // Process each link separately to avoid duplicates
                    tempDiv.querySelectorAll('a').forEach(link => {
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

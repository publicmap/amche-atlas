/**
 * LayerThumbnail - Generates thumbnail previews for map layers
 *
 * Creates square thumbnails from layer configurations, either using
 * headerImage or generating from style properties
 */
export class LayerThumbnail {
    /**
     * Generate a thumbnail element for a layer
     * @param {Object} layer - Layer configuration
     * @param {number} size - Thumbnail size in pixels (square)
     * @returns {HTMLElement} Thumbnail element
     */
    static generate(layer, size = 80) {
        const container = document.createElement('div');
        container.className = 'layer-thumbnail';
        container.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            border-radius: 6px;
            overflow: hidden;
            position: relative;
            flex-shrink: 0;
        `;

        // Set background image if available
        if (layer.headerImage) {
            container.style.backgroundImage = `url('${layer.headerImage}')`;
            container.style.backgroundSize = 'cover';
            container.style.backgroundPosition = 'center';
            container.style.backgroundColor = '#f3f4f6';
        } else {
            container.style.backgroundColor = '#f9fafb';
        }

        // Overlay symbology on top
        // Check for style object OR top-level style properties
        if (layer.style || layer['icon-image'] || layer['circle-radius'] || layer['line-color'] || layer['fill-color']) {
            const overlay = this._generateSymbologyOverlay(layer, size);
            if (overlay) {
                container.appendChild(overlay);
            }
        } else if (!layer.headerImage) {
            // No style and no background - show default
            const svg = this._generateDefaultThumbnail(layer, size);
            container.appendChild(svg);
        }

        const typeBadge = this.getTypeBadge(layer.type);
        const typeLabel = document.createElement('div');
        typeLabel.style.cssText = `
            position: absolute;
            bottom: 4px;
            right: 4px;
            padding: 2px 5px;
            border-radius: 3px;
            font-size: 8px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            color: ${typeBadge.color};
            background-color: ${typeBadge.bg};
            opacity: 0.9;
        `;
        typeLabel.textContent = typeBadge.label;
        container.appendChild(typeLabel);

        return container;
    }

    /**
     * Generate symbology overlay for thumbnail
     * @param {Object} layer - Layer configuration
     * @param {number} size - Thumbnail size
     * @returns {SVGElement|null} SVG overlay element
     */
    static _generateSymbologyOverlay(layer, size) {
        // Style properties can be in layer.style OR at the top level
        const style = layer.style || layer;

        // Check for icon-image first (try both locations)
        const iconImage = style['icon-image'] || layer['icon-image'];
        if (iconImage) {
            const iconUrl = this._extractIconUrl(iconImage);
            if (iconUrl) {
                const iconContainer = document.createElement('div');
                iconContainer.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-image: url('${iconUrl}');
                    background-size: 60%;
                    background-position: center;
                    background-repeat: no-repeat;
                    opacity: 0.9;
                    pointer-events: none;
                `;
                iconContainer.className = 'symbology-overlay';
                return iconContainer;
            }
        }

        // Otherwise generate SVG for circle, fill, or line styles
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
        `;

        // Helper to extract simple value from Mapbox expressions
        const getValue = (value, defaultValue = null) => {
            if (typeof value === 'string' || typeof value === 'number') return value;
            if (Array.isArray(value)) {
                for (let i = 1; i < value.length; i++) {
                    if (typeof value[i] === 'string' || typeof value[i] === 'number') {
                        return value[i];
                    }
                }
            }
            return defaultValue;
        };

        // Add semi-transparent background
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('width', size);
        bg.setAttribute('height', size);
        bg.setAttribute('fill', 'rgba(255, 255, 255, 0.5)');
        svg.appendChild(bg);

        // Circle symbology
        if (style['circle-radius'] || style['circle-color']) {
            const color = getValue(style['circle-color'], '#3b82f6');
            const radius = getValue(style['circle-radius'], 6);
            const strokeColor = getValue(style['circle-stroke-color'], '#ffffff');
            const strokeWidth = getValue(style['circle-stroke-width'], 1);
            const opacity = getValue(style['circle-opacity'], 0.9);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', size / 2);
            circle.setAttribute('cy', size / 2);
            circle.setAttribute('r', Math.min(radius * 3, size / 3));
            circle.setAttribute('fill', color);
            circle.setAttribute('opacity', opacity);
            circle.setAttribute('stroke', strokeColor);
            circle.setAttribute('stroke-width', strokeWidth * 1.5);
            svg.appendChild(circle);
        }
        // Line symbology
        else if (style['line-color']) {
            const color = getValue(style['line-color'], '#3b82f6');
            const width = getValue(style['line-width'], 2);
            const opacity = getValue(style['line-opacity'], 1);

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const d = `M ${size * 0.2},${size * 0.5} L ${size * 0.5},${size * 0.3} L ${size * 0.8},${size * 0.5} L ${size * 0.5},${size * 0.7} Z`;
            path.setAttribute('d', d);
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', Math.max(width * 2, 3));
            path.setAttribute('opacity', opacity);
            path.setAttribute('fill', 'none');
            svg.appendChild(path);
        }
        // Fill symbology
        else if (style['fill-color']) {
            const fillColor = getValue(style['fill-color'], '#3b82f6');
            const fillOpacity = getValue(style['fill-opacity'], 0.5);
            const lineColor = getValue(style['line-color'], '#1e40af');
            const lineWidth = getValue(style['line-width'], 2);

            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            const points = `${size * 0.3},${size * 0.3} ${size * 0.7},${size * 0.3} ${size * 0.7},${size * 0.7} ${size * 0.3},${size * 0.7}`;
            polygon.setAttribute('points', points);
            polygon.setAttribute('fill', fillColor);
            polygon.setAttribute('fill-opacity', fillOpacity);
            polygon.setAttribute('stroke', lineColor);
            polygon.setAttribute('stroke-width', lineWidth);
            svg.appendChild(polygon);
        }

        return svg;
    }

    /**
     * Extract icon URL from icon-image property (handles both strings and expressions)
     * @param {string|Array} iconImage - icon-image value
     * @returns {string|null} First icon URL found, or null
     */
    static _extractIconUrl(iconImage) {
        if (typeof iconImage === 'string') {
            // Simple string - check if it looks like a URL or path
            if (iconImage.includes('.png') || iconImage.includes('.jpg') ||
                iconImage.includes('.svg') || iconImage.includes('.jpeg') ||
                iconImage.includes('.gif') || iconImage.startsWith('http')) {
                return iconImage;
            }
        } else if (Array.isArray(iconImage)) {
            // Expression - extract first icon path
            // For match expressions: ["match", ["get", "prop"], "val1", "icon1.png", "val2", "icon2.png", "default.png"]
            for (let i = 0; i < iconImage.length; i++) {
                const item = iconImage[i];

                if (typeof item === 'string') {
                    // Check if it looks like an icon path (not an operator like "match", "get", etc.)
                    const isIconPath = item.includes('.png') || item.includes('.jpg') ||
                        item.includes('.svg') || item.includes('.jpeg') ||
                        item.includes('.gif') || item.startsWith('http') ||
                        item.startsWith('assets/') || item.startsWith('data/') ||
                        item.startsWith('images/');

                    if (isIconPath) {
                        return item;
                    }
                } else if (Array.isArray(item)) {
                    // Nested expression - recurse
                    const nested = this._extractIconUrl(item);
                    if (nested) {
                        return nested;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Generate SVG thumbnail from style properties
     */
    static _generateStyleThumbnail(layer, size) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.style.backgroundColor = '#f9fafb';

        const style = layer.style;

        // Helper to extract simple value from Mapbox expressions
        const getValue = (value, defaultValue = null) => {
            if (typeof value === 'string' || typeof value === 'number') return value;
            if (Array.isArray(value)) {
                // For match/case/step expressions, return first non-expression value
                for (let i = 1; i < value.length; i++) {
                    if (typeof value[i] === 'string' || typeof value[i] === 'number') {
                        return value[i];
                    }
                }
            }
            return defaultValue;
        };

        // Point features (circles)
        if (style['circle-radius'] || style['circle-color']) {
            const color = getValue(style['circle-color'], '#3b82f6');
            const radius = getValue(style['circle-radius'], 6);
            const strokeColor = getValue(style['circle-stroke-color'], '#ffffff');
            const strokeWidth = getValue(style['circle-stroke-width'], 1);
            const opacity = getValue(style['circle-opacity'], 0.9);

            // Draw multiple circles to fill the thumbnail
            const cols = 4;
            const rows = 4;
            const spacing = size / cols;

            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    circle.setAttribute('cx', spacing * col + spacing / 2);
                    circle.setAttribute('cy', spacing * row + spacing / 2);
                    circle.setAttribute('r', Math.min(radius * 1.5, spacing / 3));
                    circle.setAttribute('fill', color);
                    circle.setAttribute('opacity', opacity);
                    circle.setAttribute('stroke', strokeColor);
                    circle.setAttribute('stroke-width', strokeWidth);
                    svg.appendChild(circle);
                }
            }
        }
        // Line features
        else if (style['line-color']) {
            const color = getValue(style['line-color'], '#3b82f6');
            const width = getValue(style['line-width'], 2);
            const opacity = getValue(style['line-opacity'], 1);
            const dasharray = getValue(style['line-dasharray'], null);

            // Draw zigzag lines
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const d = `M 0,${size * 0.3} L ${size * 0.25},${size * 0.5} L ${size * 0.5},${size * 0.3} L ${size * 0.75},${size * 0.5} L ${size},${size * 0.3}
                       M 0,${size * 0.6} L ${size * 0.25},${size * 0.8} L ${size * 0.5},${size * 0.6} L ${size * 0.75},${size * 0.8} L ${size},${size * 0.6}`;

            path.setAttribute('d', d);
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', Math.max(width * 1.5, 2));
            path.setAttribute('opacity', opacity);
            path.setAttribute('fill', 'none');
            if (dasharray) {
                path.setAttribute('stroke-dasharray', dasharray);
            }
            svg.appendChild(path);
        }
        // Polygon features
        else if (style['fill-color']) {
            const fillColor = getValue(style['fill-color'], '#3b82f6');
            const fillOpacity = getValue(style['fill-opacity'], 0.5);
            const lineColor = getValue(style['line-color'], '#1e40af');
            const lineWidth = getValue(style['line-width'], 2);

            // Draw overlapping polygons
            const polygon1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            polygon1.setAttribute('x', size * 0.1);
            polygon1.setAttribute('y', size * 0.1);
            polygon1.setAttribute('width', size * 0.5);
            polygon1.setAttribute('height', size * 0.5);
            polygon1.setAttribute('fill', fillColor);
            polygon1.setAttribute('fill-opacity', fillOpacity);
            polygon1.setAttribute('stroke', lineColor);
            polygon1.setAttribute('stroke-width', lineWidth);
            svg.appendChild(polygon1);

            const polygon2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            polygon2.setAttribute('x', size * 0.4);
            polygon2.setAttribute('y', size * 0.4);
            polygon2.setAttribute('width', size * 0.5);
            polygon2.setAttribute('height', size * 0.5);
            polygon2.setAttribute('fill', fillColor);
            polygon2.setAttribute('fill-opacity', fillOpacity);
            polygon2.setAttribute('stroke', lineColor);
            polygon2.setAttribute('stroke-width', lineWidth);
            svg.appendChild(polygon2);
        }
        // Raster layers (show grid pattern)
        else if (layer.type === 'tms' || layer.type === 'raster-style-layer') {
            const gridSize = size / 4;
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 4; col++) {
                    const shade = ((row + col) % 2 === 0) ? '#e5e7eb' : '#d1d5db';
                    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    rect.setAttribute('x', col * gridSize);
                    rect.setAttribute('y', row * gridSize);
                    rect.setAttribute('width', gridSize);
                    rect.setAttribute('height', gridSize);
                    rect.setAttribute('fill', shade);
                    svg.appendChild(rect);
                }
            }
        }

        return svg;
    }

    /**
     * Generate default thumbnail for layers without styles
     */
    static _generateDefaultThumbnail(layer, size) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.style.backgroundColor = '#f9fafb';

        // Background gradient
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        gradient.setAttribute('id', `bg-gradient-${Date.now()}`);
        gradient.setAttribute('x1', '0%');
        gradient.setAttribute('y1', '0%');
        gradient.setAttribute('x2', '100%');
        gradient.setAttribute('y2', '100%');

        const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('stop-color', '#f9fafb');

        const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop2.setAttribute('offset', '100%');
        stop2.setAttribute('stop-color', '#f3f4f6');

        gradient.appendChild(stop1);
        gradient.appendChild(stop2);
        defs.appendChild(gradient);
        svg.appendChild(defs);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', size);
        rect.setAttribute('height', size);
        rect.setAttribute('fill', `url(#bg-gradient-${Date.now()})`);
        svg.appendChild(rect);

        // Icon
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        icon.setAttribute('x', size / 2);
        icon.setAttribute('y', size * 0.4);
        icon.setAttribute('text-anchor', 'middle');
        icon.setAttribute('dominant-baseline', 'middle');
        icon.setAttribute('font-size', size * 0.35);
        icon.textContent = this._getDefaultIcon(layer.type);
        svg.appendChild(icon);

        // Type text
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', size / 2);
        text.setAttribute('y', size * 0.7);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', '#6b7280');
        text.setAttribute('font-size', '10');
        text.setAttribute('font-weight', 'bold');
        text.textContent = (layer.type || 'layer').toUpperCase();
        svg.appendChild(text);

        return svg;
    }

    /**
     * Get default icon based on layer type
     */
    static _getDefaultIcon(type) {
        const icons = {
            'vector': '🔷',
            'geojson': '📍',
            'csv': '📊',
            'tms': '🗺️',
            'raster-style-layer': '🖼️',
            'style': '🎨'
        };
        return icons[type] || '🗺️';
    }

    /**
     * Get type badge configuration
     */
    static getTypeBadge(type) {
        const configs = {
            'vector': { label: 'Vector', color: '#3b82f6', bg: '#eff6ff' },
            'geojson': { label: 'GeoJSON', color: '#10b981', bg: '#d1fae5' },
            'csv': { label: 'CSV', color: '#f59e0b', bg: '#fef3c7' },
            'tms': { label: 'Raster', color: '#8b5cf6', bg: '#f5f3ff' },
            'raster-style-layer': { label: 'Style', color: '#6b7280', bg: '#f3f4f6' },
            'style': { label: 'Style', color: '#6b7280', bg: '#f3f4f6' }
        };

        // Return config if type matches
        if (type && configs[type]) {
            return configs[type];
        }

        // Fallback for unknown types - show the type name if available
        if (type && typeof type === 'string' && type.length > 0) {
            return { label: type.toUpperCase(), color: '#6b7280', bg: '#f3f4f6' };
        }

        // Final fallback for undefined/null types
        return { label: 'MAP', color: '#6b7280', bg: '#f3f4f6' };
    }
}

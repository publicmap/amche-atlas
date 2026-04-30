/**
 * LayerLegend - Generates interactive HTML legends for map layers
 *
 * Supports both raster (using legendImage) and vector layers (parsing style properties)
 * Inspired by mapboxgl-legend
 */
export class LayerLegend {
    /**
     * Generate legend HTML for a layer
     * @param {Object} layer - Layer configuration
     * @returns {HTMLElement|null} Legend element or null if no legend available
     */
    static generate(layer) {
        if (layer.legendImage) {
            return this._generateRasterLegend(layer);
        }

        if (layer.style) {
            return this._generateVectorLegend(layer);
        }

        return null;
    }

    /**
     * Generate legend for raster layers using legendImage
     */
    static _generateRasterLegend(layer) {
        const container = document.createElement('div');
        container.className = 'legend-raster';
        container.style.cssText = `
            background: white;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            padding: 8px 10px;
        `;

        const images = Array.isArray(layer.legendImage) ? layer.legendImage : [layer.legendImage];

        images.forEach(imageUrl => {
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = 'Legend';
            img.style.cssText = `
                max-width: 100%;
                height: auto;
                display: block;
            `;
            container.appendChild(img);
        });

        return container;
    }

    /**
     * Generate legend for vector layers by parsing style properties
     */
    static _generateVectorLegend(layer) {
        const style = layer.style || {};

        const items = this._parseStyleToLegendItems(style);

        if (items.length === 0) {
            return null;
        }

        const container = document.createElement('div');
        container.className = 'legend-vector';
        container.style.cssText = `
            background: white;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            padding: 6px 10px;
        `;

        items.forEach(item => {
            const legendItem = document.createElement('div');
            legendItem.style.cssText = `
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 3px 0;
            `;

            const symbol = this._createSymbol(item);
            symbol.style.flexShrink = '0';

            const labelSize = item.labelSize ? Math.max(10, Math.min(16, item.labelSize)) : 12;
            const label = document.createElement('span');
            label.style.cssText = `
                font-size: ${labelSize}px;
                color: #111827;
                line-height: 1.3;
            `;
            label.textContent = item.label;

            legendItem.appendChild(symbol);
            legendItem.appendChild(label);
            container.appendChild(legendItem);
        });

        return container;
    }

    /**
     * Parse style object into legend items
     */
    static _parseStyleToLegendItems(style) {
        const items = [];
        const hasLine = !!style['line-color'];
        const hasCircle = !!(style['circle-radius'] || style['circle-color']);
        const hasFill = !!style['fill-color'];

        if (hasFill) {
            const variants = this._extractVariants(style, 'fill');
            if (variants.length > 0) {
                items.push(...variants);
            } else {
                items.push({
                    type: 'fill',
                    label: 'Polygon Features',
                    fillColor: this._getValue(style['fill-color'], '#3b82f6'),
                    fillOpacity: this._getValue(style['fill-opacity'], 0.5),
                    strokeColor: this._getValue(style['line-color'], '#1e40af'),
                    strokeWidth: this._getValue(style['line-width'], 2)
                });
            }
        } else if (hasLine) {
            const type = hasCircle ? 'line-circle' : 'line';
            const variants = this._extractVariants(style, type);
            if (variants.length > 0) {
                items.push(...variants);
            } else {
                items.push({
                    type,
                    label: 'Line Features',
                    color: this._getValue(style['line-color'], '#3b82f6'),
                    width: this._getValue(style['line-width'], 2),
                    opacity: this._getValue(style['line-opacity'], 1),
                    dasharray: this._getValue(style['line-dasharray'], null),
                    offset: this._getValue(style['line-offset'], 0),
                    ...(hasCircle && {
                        circleRadius: this._getValue(style['circle-radius'], 3),
                        circleColor: this._getValue(style['circle-color'], null),
                        circleOpacity: this._getValue(style['circle-opacity'], 0.9),
                        circleStrokeColor: this._getValue(style['circle-stroke-color'], null),
                        circleStrokeWidth: this._getValue(style['circle-stroke-width'], 0)
                    })
                });
            }
        } else if (hasCircle) {
            const variants = this._extractVariants(style, 'circle');
            if (variants.length > 0) {
                items.push(...variants);
            } else {
                items.push({
                    type: 'circle',
                    label: 'Point Features',
                    color: this._getValue(style['circle-color'], '#3b82f6'),
                    radius: this._getValue(style['circle-radius'], 6),
                    strokeColor: this._getValue(style['circle-stroke-color'], 'rgba(0,0,0,0.2)'),
                    strokeWidth: this._getValue(style['circle-stroke-width'], 1),
                    opacity: this._getValue(style['circle-opacity'], 0.9)
                });
            }
        }

        const textSize = this._getValue(style['text-size'], null);
        if (typeof textSize === 'number') {
            items.forEach(item => { item.labelSize = textSize; });
        }

        return items;
    }

    /**
     * Extract variants from match/case expressions
     */
    static _extractVariants(style, type) {
        const variants = [];
        const isLineCircle = type === 'line-circle';
        const colorProp = type === 'circle' ? 'circle-color' : type === 'fill' ? 'fill-color' : 'line-color';
        const colorValue = style[colorProp];

        if (!Array.isArray(colorValue) || colorValue[0] !== 'match') return variants;

        const buildItem = (key, color, isDefault) => {
            const item = {
                type,
                label: isDefault ? 'Other' : this._formatLabel(key),
                color
            };

            if (type === 'line' || isLineCircle) {
                item.width = this._getValue(style['line-width'], 2);
                item.opacity = this._getValue(style['line-opacity'], 1);
                item.dasharray = this._getValue(style['line-dasharray'], null);
                item.offset = isDefault
                    ? this._getMatchDefault(style['line-offset'], 0)
                    : (this._getMatchValue(style['line-offset'], key) ?? 0);
            }

            if (isLineCircle) {
                const cColor = isDefault
                    ? this._getMatchDefault(style['circle-color'], color)
                    : this._getMatchValue(style['circle-color'], key);
                item.circleRadius = this._getValue(style['circle-radius'], 3);
                item.circleColor = (typeof cColor === 'string' ? cColor : null) || color;
                item.circleOpacity = this._getValue(style['circle-opacity'], 0.9);
                item.circleStrokeColor = this._getValue(style['circle-stroke-color'], null);
                item.circleStrokeWidth = this._getValue(style['circle-stroke-width'], 0);
            }

            if (type === 'circle') {
                item.radius = this._getValue(style['circle-radius'], 6);
                item.strokeColor = this._getValue(style['circle-stroke-color'], 'rgba(0,0,0,0.2)');
                item.strokeWidth = this._getValue(style['circle-stroke-width'], 1);
                item.opacity = this._getValue(style['circle-opacity'], 0.9);
            }

            if (type === 'fill') {
                item.fillColor = color;
                item.fillOpacity = this._getValue(style['fill-opacity'], 0.5);
                item.strokeColor = this._getValue(style['line-color'], '#1e40af');
                item.strokeWidth = this._getValue(style['line-width'], 2);
            }

            return item;
        };

        for (let i = 2; i < colorValue.length - 1; i += 2) {
            const key = colorValue[i];
            const color = colorValue[i + 1];
            if (typeof color === 'string') {
                variants.push(buildItem(key, color, false));
            }
        }

        const defaultColor = colorValue[colorValue.length - 1];
        if (typeof defaultColor === 'string') {
            variants.push(buildItem(null, defaultColor, true));
        }

        return variants;
    }

    /**
     * Get value for a specific key from a match expression, returning the expression default if not found
     */
    static _getMatchValue(expr, key) {
        if (!Array.isArray(expr) || expr[0] !== 'match') return this._getValue(expr, null);
        for (let i = 2; i < expr.length - 1; i += 2) {
            if (expr[i] === key) return expr[i + 1];
        }
        return expr[expr.length - 1];
    }

    /**
     * Get the default/fallback value from a match expression
     */
    static _getMatchDefault(expr, fallback = null) {
        if (expr === null || expr === undefined) return fallback;
        if (!Array.isArray(expr) || expr[0] !== 'match') return this._getValue(expr, fallback);
        const def = expr[expr.length - 1];
        return def !== undefined ? def : fallback;
    }

    /**
     * Create visual symbol for legend item
     */
    static _createSymbol(item) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '40');
        svg.setAttribute('height', '40');
        svg.style.display = 'block';

        if (item.type === 'circle') {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', '20');
            circle.setAttribute('cy', '20');
            circle.setAttribute('r', Math.min(item.radius || 6, 12));
            circle.setAttribute('fill', item.color);
            circle.setAttribute('opacity', item.opacity || 0.9);
            circle.setAttribute('stroke', item.strokeColor || 'rgba(0,0,0,0.2)');
            circle.setAttribute('stroke-width', item.strokeWidth || 1);
            svg.appendChild(circle);
        } else if (item.type === 'line' || item.type === 'line-circle') {
            const scaledOffset = Math.max(-8, Math.min(8, (item.offset || 0) * 2));
            const lineY = 20 - scaledOffset;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', '5');
            line.setAttribute('y1', lineY);
            line.setAttribute('x2', '35');
            line.setAttribute('y2', lineY);
            line.setAttribute('stroke', item.color);
            line.setAttribute('stroke-width', Math.min(item.width || 2, 4));
            line.setAttribute('opacity', item.opacity || 1);
            if (item.dasharray) {
                line.setAttribute('stroke-dasharray', item.dasharray);
            }
            svg.appendChild(line);

            if (item.type === 'line-circle' && item.circleRadius > 0) {
                const r = Math.min(Math.max(item.circleRadius, 3), 8);
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', '20');
                circle.setAttribute('cy', lineY);
                circle.setAttribute('r', r);
                circle.setAttribute('fill', item.circleColor || item.color);
                circle.setAttribute('opacity', item.circleOpacity || 0.9);
                if (item.circleStrokeColor && item.circleStrokeWidth > 0) {
                    circle.setAttribute('stroke', item.circleStrokeColor);
                    circle.setAttribute('stroke-width', item.circleStrokeWidth);
                }
                svg.appendChild(circle);
            }
        } else if (item.type === 'fill') {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', '8');
            rect.setAttribute('y', '8');
            rect.setAttribute('width', '24');
            rect.setAttribute('height', '24');
            rect.setAttribute('fill', item.fillColor);
            rect.setAttribute('fill-opacity', item.fillOpacity || 0.5);
            rect.setAttribute('stroke', item.strokeColor || '#1e40af');
            rect.setAttribute('stroke-width', item.strokeWidth || 2);
            svg.appendChild(rect);
        }

        return svg;
    }

    /**
     * Extract simple value from Mapbox expression
     */
    static _getValue(value, defaultValue = null) {
        if (typeof value === 'string' || typeof value === 'number') return value;
        if (Array.isArray(value)) {
            for (let i = 1; i < value.length; i++) {
                if (typeof value[i] === 'string' || typeof value[i] === 'number') {
                    return value[i];
                }
            }
        }
        return defaultValue;
    }

    /**
     * Format label from value
     */
    static _formatLabel(value) {
        if (typeof value === 'string') {
            return value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
        return String(value);
    }
}

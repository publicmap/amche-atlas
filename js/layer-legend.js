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

        const images = Array.isArray(layer.legendImage) ? layer.legendImage : [layer.legendImage];

        images.forEach(imageUrl => {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = `
                margin-bottom: 16px;
                background: #334155;
                border-radius: 8px;
                padding: 12px;
                border: 1px solid #475569;
            `;

            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = 'Legend';
            img.style.cssText = `
                max-width: 100%;
                height: auto;
                border-radius: 4px;
                display: block;
            `;
            wrapper.appendChild(img);
            container.appendChild(wrapper);
        });

        return container;
    }

    /**
     * Generate legend for vector layers by parsing style properties
     */
    static _generateVectorLegend(layer) {
        const style = layer.style || {};
        const container = document.createElement('div');
        container.className = 'legend-vector';

        const items = this._parseStyleToLegendItems(style);

        if (items.length === 0) {
            return null;
        }

        items.forEach(item => {
            const legendItem = document.createElement('div');
            legendItem.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px;
                background: #334155;
                border-radius: 6px;
                margin-bottom: 8px;
                border: 1px solid #475569;
                transition: background 0.2s;
            `;
            legendItem.onmouseenter = () => legendItem.style.background = '#475569';
            legendItem.onmouseleave = () => legendItem.style.background = '#334155';

            const symbol = this._createSymbol(item);
            symbol.style.flexShrink = '0';

            const label = document.createElement('div');
            label.style.cssText = `
                flex: 1;
                font-size: 14px;
                color: #e2e8f0;
                font-weight: 500;
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

        if (style['circle-radius'] || style['circle-color']) {
            const variants = this._extractVariants(style, 'circle');
            if (variants.length > 0) {
                items.push(...variants);
            } else {
                items.push({
                    type: 'circle',
                    label: 'Point Features',
                    color: this._getValue(style['circle-color'], '#3b82f6'),
                    radius: this._getValue(style['circle-radius'], 6),
                    strokeColor: this._getValue(style['circle-stroke-color'], '#ffffff'),
                    strokeWidth: this._getValue(style['circle-stroke-width'], 1),
                    opacity: this._getValue(style['circle-opacity'], 0.9)
                });
            }
        } else if (style['line-color']) {
            const variants = this._extractVariants(style, 'line');
            if (variants.length > 0) {
                items.push(...variants);
            } else {
                items.push({
                    type: 'line',
                    label: 'Line Features',
                    color: this._getValue(style['line-color'], '#3b82f6'),
                    width: this._getValue(style['line-width'], 2),
                    opacity: this._getValue(style['line-opacity'], 1),
                    dasharray: this._getValue(style['line-dasharray'], null)
                });
            }
        } else if (style['fill-color']) {
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
        }

        return items;
    }

    /**
     * Extract variants from match/case expressions
     */
    static _extractVariants(style, type) {
        const variants = [];
        const colorProp = type === 'circle' ? 'circle-color' : type === 'line' ? 'line-color' : 'fill-color';
        const colorValue = style[colorProp];

        if (Array.isArray(colorValue) && colorValue[0] === 'match') {
            const property = colorValue[1];
            const propertyName = Array.isArray(property) && property[0] === 'get' ? property[1] : 'value';

            for (let i = 2; i < colorValue.length - 1; i += 2) {
                const value = colorValue[i];
                const color = colorValue[i + 1];

                if (typeof color === 'string') {
                    variants.push({
                        type: type,
                        label: this._formatLabel(value),
                        color: color,
                        radius: type === 'circle' ? this._getValue(style['circle-radius'], 6) : undefined,
                        strokeColor: type === 'circle' ? this._getValue(style['circle-stroke-color'], '#ffffff') : undefined,
                        strokeWidth: type === 'circle' ? this._getValue(style['circle-stroke-width'], 1) :
                                     type === 'fill' ? this._getValue(style['line-width'], 2) : undefined,
                        opacity: type === 'circle' ? this._getValue(style['circle-opacity'], 0.9) :
                                 type === 'line' ? this._getValue(style['line-opacity'], 1) : undefined,
                        width: type === 'line' ? this._getValue(style['line-width'], 2) : undefined,
                        fillColor: type === 'fill' ? color : undefined,
                        fillOpacity: type === 'fill' ? this._getValue(style['fill-opacity'], 0.5) : undefined
                    });
                }
            }

            const defaultColor = colorValue[colorValue.length - 1];
            if (typeof defaultColor === 'string') {
                variants.push({
                    type: type,
                    label: 'Other',
                    color: defaultColor,
                    radius: type === 'circle' ? this._getValue(style['circle-radius'], 6) : undefined,
                    strokeColor: type === 'circle' ? this._getValue(style['circle-stroke-color'], '#ffffff') : undefined,
                    strokeWidth: type === 'circle' ? this._getValue(style['circle-stroke-width'], 1) :
                                 type === 'fill' ? this._getValue(style['line-width'], 2) : undefined,
                    opacity: type === 'circle' ? this._getValue(style['circle-opacity'], 0.9) :
                             type === 'line' ? this._getValue(style['line-opacity'], 1) : undefined,
                    width: type === 'line' ? this._getValue(style['line-width'], 2) : undefined,
                    fillColor: type === 'fill' ? defaultColor : undefined,
                    fillOpacity: type === 'fill' ? this._getValue(style['fill-opacity'], 0.5) : undefined
                });
            }
        }

        return variants;
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
            circle.setAttribute('stroke', item.strokeColor || '#ffffff');
            circle.setAttribute('stroke-width', item.strokeWidth || 1);
            svg.appendChild(circle);
        } else if (item.type === 'line') {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', '5');
            line.setAttribute('y1', '20');
            line.setAttribute('x2', '35');
            line.setAttribute('y2', '20');
            line.setAttribute('stroke', item.color);
            line.setAttribute('stroke-width', Math.min(item.width || 2, 4));
            line.setAttribute('opacity', item.opacity || 1);
            if (item.dasharray) {
                line.setAttribute('stroke-dasharray', item.dasharray);
            }
            svg.appendChild(line);
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

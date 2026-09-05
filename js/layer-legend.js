/**
 * LayerLegend - Generates interactive HTML legends for map layers
 *
 * Supports both raster (using legendImage) and vector layers (parsing style properties)
 * Inspired by mapboxgl-legend
 */
import {
    collectStylePasses,
    colorBranches,
    branchValue,
    resolveValue,
    formatLabel,
    strokeScaler
} from './layer-style-utils.js';

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
        const items = this._parseStyleToLegendItems(layer.style || {});

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
     * Parse a style into legend items.
     *
     * A style can declare several rendering passes through "prefix/property"
     * keys — a white casing under a coloured route line, waypoint circles over
     * it. Passes that paint the same geometry are stacked into one swatch;
     * a pass that introduces different geometry (circles over a line) becomes
     * its own row. match/case colour expressions expand into one row each.
     */
    static _parseStyleToLegendItems(style) {
        const { fill, line, circle, base } = collectStylePasses(style);

        let items = [];

        if (fill.length) {
            items = this._buildFillItems(fill);
        } else if (line.length) {
            // Circles declared alongside a line (vertex dots) ride on the line
            // swatch; circles from another variant are separate features.
            const linePrefixes = new Set(line.map(pass => pass.prefix));
            const inlineCircles = circle.filter(pass => linePrefixes.has(pass.prefix));
            const separateCircles = circle.filter(pass => !linePrefixes.has(pass.prefix));

            items = this._buildLineItems(line, inlineCircles);
            if (separateCircles.length) {
                items.push(...this._buildCircleItems(separateCircles));
            }
        } else if (circle.length) {
            items = this._buildCircleItems(circle);
        }

        // A variant name ("route/line-color" → "Route") only earns its place
        // when the legend has more than one row to tell apart
        if (items.length === 1) {
            items[0].label = items[0].genericLabel;
        }

        const textSize = resolveValue(base['text-size'], null);
        if (typeof textSize === 'number') {
            items.forEach(item => { item.labelSize = textSize; });
        }

        return items;
    }

    /**
     * Label for a stack of passes: the topmost variant prefix names it
     * ("route/line-color" → "Route"), otherwise null.
     */
    static _stackLabel(passes) {
        for (let i = passes.length - 1; i >= 0; i--) {
            if (passes[i].prefix) return formatLabel(passes[i].prefix);
        }
        return null;
    }

    /**
     * Expand the passes of one geometry into rows, one per colour branch of the
     * topmost pass that classifies features. Only match expressions are split
     * out — a case expression keys off feature state or arbitrary conditions,
     * so its branches have no name to put in the legend.
     */
    static _buildRows(passes, buildRow, genericLabel) {
        const branches = [...passes].reverse().map(pass => colorBranches(pass.colorExpr)).find(Boolean) || null;
        const named = branches && branches.every(branch => branch.isDefault || branch.key !== null);
        const stackLabel = this._stackLabel(passes);

        const rows = named
            ? branches.map(branch => buildRow(
                branch,
                branch.isDefault ? (stackLabel || 'Other') : formatLabel(branch.key)
            ))
            : [buildRow(null, stackLabel || genericLabel)];

        rows.forEach(row => { row.genericLabel = genericLabel; });
        return rows;
    }

    static _buildLineItems(linePasses, circlePasses) {
        const type = circlePasses.length ? 'line-circle' : 'line';

        return this._buildRows(linePasses, (branch, label) => ({
            type,
            label,
            passes: linePasses.map(pass => ({
                color: branchValue(pass.colorExpr, branch, pass.color),
                width: branchValue(pass.style['line-width'], branch, pass.width),
                opacity: branchValue(pass.style['line-opacity'], branch, pass.opacity),
                dasharray: branchValue(pass.style['line-dasharray'], branch, pass.dasharray),
                offset: branchValue(pass.style['line-offset'], branch, pass.offset)
            })),
            circles: circlePasses.map(pass => this._circlePass(pass, branch))
        }), 'Line Features');
    }

    static _buildCircleItems(circlePasses) {
        return this._buildRows(circlePasses, (branch, label) => ({
            type: 'circle',
            label,
            passes: circlePasses.map(pass => this._circlePass(pass, branch))
        }), 'Point Features');
    }

    static _buildFillItems(fillPasses) {
        return this._buildRows(fillPasses, (branch, label) => ({
            type: 'fill',
            label,
            passes: fillPasses.map(pass => ({
                fillColor: branchValue(pass.colorExpr, branch, pass.color),
                fillOpacity: branchValue(pass.style['fill-opacity'], branch, pass.opacity),
                strokeColor: branchValue(pass.style['line-color'], branch, pass.strokeColor),
                strokeWidth: branchValue(pass.style['line-width'], branch, pass.strokeWidth)
            }))
        }), 'Polygon Features');
    }

    static _circlePass(pass, branch) {
        return {
            color: branchValue(pass.colorExpr, branch, pass.color),
            radius: branchValue(pass.style['circle-radius'], branch, pass.radius),
            opacity: branchValue(pass.style['circle-opacity'], branch, pass.opacity),
            strokeColor: branchValue(pass.style['circle-stroke-color'], branch, pass.strokeColor),
            strokeWidth: branchValue(pass.style['circle-stroke-width'], branch, pass.strokeWidth)
        };
    }

    /**
     * Create the visual symbol for a legend item by drawing each pass in the
     * order the map renders them, bottom-most first.
     */
    static _createSymbol(item) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '40');
        svg.setAttribute('height', '40');
        svg.style.display = 'block';

        const passes = item.passes || [];

        if (item.type === 'fill') {
            passes.forEach(pass => {
                svg.appendChild(this._buildRect({
                    fill: pass.fillColor || 'transparent',
                    fillOpacity: pass.fillOpacity != null ? pass.fillOpacity : 0.5,
                    stroke: pass.strokeColor || 'transparent',
                    strokeWidth: pass.strokeWidth || 0
                }));
            });
            return svg;
        }

        if (item.type === 'line' || item.type === 'line-circle') {
            const scaleStroke = strokeScaler(passes.map(pass => pass.width), { maxPx: 6, minPx: 1 });

            passes.forEach(pass => {
                svg.appendChild(this._buildLine({
                    y: 20 - Math.max(-8, Math.min(8, (pass.offset || 0) * 2)),
                    stroke: pass.color || '#3b82f6',
                    width: scaleStroke(pass.width),
                    opacity: pass.opacity != null ? pass.opacity : 1,
                    dasharray: pass.dasharray
                }));
            });

            this._drawCircles(svg, item.circles, 20, 8, 0);
            return svg;
        }

        if (item.type === 'circle') {
            this._drawCircles(svg, passes, 20, 12, 1);
        }

        return svg;
    }

    static _drawCircles(svg, passes, cy, maxRadius, defaultStrokeWidth = 0) {
        (passes || []).forEach(pass => {
            const strokeWidth = pass.strokeWidth != null ? pass.strokeWidth : defaultStrokeWidth;
            svg.appendChild(this._buildCircle({
                cx: 20,
                cy,
                r: Math.max(2, Math.min(pass.radius || 6, maxRadius)),
                fill: pass.color || '#3b82f6',
                opacity: pass.opacity != null ? pass.opacity : 0.9,
                stroke: strokeWidth > 0 ? (pass.strokeColor || 'rgba(0,0,0,0.2)') : 'transparent',
                strokeWidth
            }));
        });
    }

    static _buildLine({ y, stroke, width, opacity, dasharray }) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '5');
        line.setAttribute('y1', y);
        line.setAttribute('x2', '35');
        line.setAttribute('y2', y);
        line.setAttribute('stroke', stroke);
        line.setAttribute('stroke-width', width);
        line.setAttribute('opacity', opacity);
        if (dasharray) line.setAttribute('stroke-dasharray', dasharray);
        return line;
    }

    static _buildCircle({ cx, cy, r, fill, opacity, stroke, strokeWidth }) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', r);
        circle.setAttribute('fill', fill);
        circle.setAttribute('opacity', opacity);
        circle.setAttribute('stroke', stroke);
        circle.setAttribute('stroke-width', strokeWidth);
        return circle;
    }

    static _buildRect({ fill, fillOpacity, stroke, strokeWidth }) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', '8');
        rect.setAttribute('y', '8');
        rect.setAttribute('width', '24');
        rect.setAttribute('height', '24');
        rect.setAttribute('fill', fill);
        rect.setAttribute('fill-opacity', fillOpacity);
        rect.setAttribute('stroke', stroke);
        rect.setAttribute('stroke-width', strokeWidth);
        return rect;
    }
}

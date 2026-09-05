/**
 * LayerThumbnail - Generates thumbnail previews for map layers
 *
 * Creates square thumbnails from layer configurations, either using
 * headerImage or generating from style properties
 */
import {
    collectStylePasses,
    colorBranches,
    branchValue,
    extractIconUrl,
    strokeScaler
} from './layer-style-utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class LayerThumbnail {
    /**
     * Generate a thumbnail element for a layer
     * @param {Object} layer - Layer configuration
     * @param {number} size - Thumbnail size in pixels (square)
     * @param {Object} options - Additional options (isInView, currentBounds)
     * @returns {HTMLElement} Thumbnail element
     */
    static generate(layer, size = 80, options = {}) {
        const { isInView = true, layerDefaults = {}, interactive = true, title = null } = options;
        // Same priority everywhere this is used: a curated headerImage wins,
        // then a curated legendImage, then an auto-generated preview (sample
        // tile for raster layers, or a style-derived/default SVG).
        const legendImage = Array.isArray(layer.legendImage) ? layer.legendImage[0] : layer.legendImage;
        const thumbnailImage = layer.headerImage || legendImage;
        const container = document.createElement('div');
        container.className = 'layer-thumbnail';
        if (title) {
            container.title = title;
        }
        container.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            border-radius: 6px;
            overflow: hidden;
            position: relative;
            flex-shrink: 0;
            transition: all 0.2s ease;
            ${!isInView ? 'opacity: 0.5; border: 2px solid #f59e0b;' : ''}
        `;

        // Set background image if available
        if (thumbnailImage) {
            container.style.backgroundImage = `url('${thumbnailImage}')`;
            container.style.backgroundSize = 'cover';
            container.style.backgroundPosition = 'center';
            container.style.backgroundColor = '#f3f4f6';
        } else if (layer.type === 'tms') {
            const tileUrl = LayerThumbnail._getSampleTileUrl(layer);
            if (tileUrl) {
                container.style.backgroundImage = `url('${tileUrl}')`;
                container.style.backgroundSize = 'cover';
                container.style.backgroundPosition = 'center';
                container.style.backgroundColor = '#e5e7eb';
            } else {
                container.style.backgroundColor = '#f9fafb';
            }
        } else {
            container.style.backgroundColor = '#f9fafb';
        }

        // Add grayscale filter for out-of-view layers
        if (!isInView) {
            container.style.filter = 'grayscale(0.3)';
        }

        // Overlay symbology on top
        // Check for style object OR top-level style properties
        if (layer.style || layer['icon-image'] || layer['circle-radius'] || layer['line-color'] || layer['fill-color']) {
            const overlay = this._generateSymbologyOverlay(layer, size, layerDefaults);
            if (overlay) {
                container.appendChild(overlay);
            }
        } else if (!thumbnailImage) {
            // No style and no background - show default
            const svg = this._generateDefaultThumbnail(layer, size);
            container.appendChild(svg);
        }

        const typeBadge = this.getTypeBadge(layer.type);
        const typeLabel = document.createElement('div');
        typeLabel.className = 'layer-type-badge';
        typeLabel.style.cssText = `
            position: absolute;
            padding: 2px 5px;
            border-radius: 3px;
            font-size: 6px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            color: ${typeBadge.color};
            background-color: ${typeBadge.bg};
            opacity: 0;
            transition: opacity 0.2s ease;
        `;
        typeLabel.textContent = typeBadge.label;
        container.appendChild(typeLabel);

        // Add out-of-view badge if layer is not in view
        if (!isInView) {
            const outOfViewBadge = document.createElement('div');
            outOfViewBadge.className = 'layer-out-of-view-badge';
            outOfViewBadge.style.cssText = `
                position: absolute;
                bottom: 4px;
                left: 50%;
                transform: translateX(-50%);
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 7px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.3px;
                color: white;
                background-color: #f59e0b;
                opacity: 0.9;
            `;
            outOfViewBadge.textContent = 'OUT OF VIEW';
            container.appendChild(outOfViewBadge);
        }

        const actionIcon = document.createElement('div');
        actionIcon.className = 'layer-action-icon';

        if (!isInView) {
            // Show zoom icon for out-of-view layers
            actionIcon.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 24px;
                opacity: 0;
                transition: opacity 0.2s ease;
                background: #f59e0b;
                border-radius: 50%;
                width: 36px;
                height: 36px;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            `;
            actionIcon.textContent = '🔍';
        } else {
            // Show info icon for in-view layers
            actionIcon.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 19px;
                opacity: 0;
                transition: opacity 0.2s ease;
                pointer-events: none;
            `;
            actionIcon.textContent = 'ℹ️';
        }
        container.appendChild(actionIcon);

        let liveStrobe = null;
        let liveBadge = null;
        if (layer.refresh) {
            LayerThumbnail._ensureLiveStyles();

            liveStrobe = document.createElement('div');
            liveStrobe.style.cssText = `
                position: absolute;
                bottom: 4px;
                left: 4px;
                width: 8px;
                height: 8px;
                background: #22c55e;
                border-radius: 50%;
                box-shadow: 0 0 4px #22c55e;
                animation: layer-live-pulse 1.5s ease-in-out infinite;
                transition: opacity 0.15s ease;
                pointer-events: none;
            `;
            container.appendChild(liveStrobe);

            liveBadge = document.createElement('div');
            liveBadge.style.cssText = `
                position: absolute;
                bottom: 4px;
                left: 4px;
                padding: 1px 5px;
                border-radius: 3px;
                font-size: 7px;
                font-weight: 700;
                letter-spacing: 0.5px;
                color: white;
                background: #16a34a;
                opacity: 0;
                transition: opacity 0.15s ease;
                pointer-events: none;
            `;
            liveBadge.textContent = 'LIVE';
            container.appendChild(liveBadge);
        }

        container.style.cursor = interactive ? 'pointer' : 'inherit';

        container.addEventListener('mouseenter', () => {
            typeLabel.style.opacity = '0.9';
            actionIcon.style.opacity = '0.9';
            if (liveStrobe) { liveStrobe.style.opacity = '0'; liveBadge.style.opacity = '0.95'; }
            if (!isInView) {
                container.style.opacity = '0.8';
                container.style.transform = 'scale(1.05)';
            }
        });
        container.addEventListener('mouseleave', () => {
            typeLabel.style.opacity = '0';
            actionIcon.style.opacity = '0';
            if (liveStrobe) { liveStrobe.style.opacity = '1'; liveBadge.style.opacity = '0'; }
            if (!isInView) {
                container.style.opacity = '0.5';
                container.style.transform = 'scale(1)';
            }
        });

        // When non-interactive, let clicks bubble to the surrounding row/group
        // (e.g. collapsed group previews use clicks to expand the group)
        if (interactive) {
            container.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log('[LayerThumbnail] Clicked thumbnail for layer:', layer.id, 'isInView:', isInView);
                if (!isInView) {
                    // Zoom to layer if out of view
                    console.log('[LayerThumbnail] Sending zoom-to-layer message for:', layer.id);
                    window.parent.postMessage({
                        type: 'zoom-to-layer',
                        layerId: layer.id
                    }, '*');
                } else {
                    // Open layer info if in view
                    console.log('[LayerThumbnail] Sending open-layer-info message for:', layer.id);
                    window.parent.postMessage({
                        type: 'open-layer-info',
                        layer: layer
                    }, '*');
                }
            });
        }

        return container;
    }

    /**
     * Generate symbology overlay for thumbnail.
     *
     * A style may declare several rendering passes through "prefix/property"
     * keys — a route line is a white casing under a coloured line with
     * waypoint circles on top. Every pass is drawn in the order the map draws
     * it, and match/case colour expressions expand into parallel symbols.
     *
     * @param {Object} layer - Layer configuration
     * @param {number} size - Thumbnail size
     * @returns {SVGElement|HTMLElement|null} Overlay element
     */
    static _generateSymbologyOverlay(layer, size, layerDefaults = {}) {
        // Style properties can be in layer.style OR at the top level
        const { fill, line, circle, icon, base } = collectStylePasses(layer.style || layer);
        const hasGeometry = fill.length > 0 || line.length > 0 || circle.length > 0;

        // An icon stands in for the whole layer; a prefixed icon variant only
        // does so when nothing else paints (e.g. arrows along a route line
        // shouldn't replace the line itself)
        const iconImage = base['icon-image'] || layer['icon-image'] || (hasGeometry ? null : icon?.iconImage);
        if (iconImage) {
            const iconUrl = extractIconUrl(iconImage);
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

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
        `;

        if (fill.length) {
            this._drawFillSymbols(svg, fill, size);
        } else if (line.length) {
            this._drawLineSymbols(svg, line, circle, size);
        } else if (circle.length) {
            this._drawPointSymbols(svg, circle, size);
        }

        return svg;
    }

    /**
     * Polygons, offset from each other when a match/case expression paints
     * features in more than one colour.
     */
    static _drawFillSymbols(svg, fillPasses, size) {
        const basePass = fillPasses[0];
        const branches = colorBranches(basePass.colorExpr);
        // A fill with no explicit line-width still reads better with an outline
        const strokeWidthOf = (pass, branch) => {
            const width = branchValue(pass.style['line-width'], branch, pass.strokeWidth);
            const resolved = width == null ? 1 : width;
            return resolved > 0 ? Math.max(0.75, Math.min(resolved * (size / 40), size * 0.06)) : 0;
        };

        if (branches) {
            const offsetStep = size * 0.08;

            branches.slice(0, 4).forEach((branch, i) => {
                const offset = i * offsetStep;
                const strokeWidth = strokeWidthOf(basePass, branch);
                svg.appendChild(this._polygon({
                    x1: size * 0.2 + offset,
                    y1: size * 0.2 + offset,
                    x2: size * 0.7 + offset,
                    y2: size * 0.7 + offset,
                    fill: branch.value,
                    fillOpacity: branchValue(basePass.style['fill-opacity'], branch, basePass.opacity),
                    // A hairline keeps overlapping polygons apart when the
                    // style itself draws no outline
                    stroke: strokeWidth > 0 ? (branchValue(basePass.style['line-color'], branch, basePass.strokeColor) || '#1e40af') : 'white',
                    strokeWidth: strokeWidth > 0 ? strokeWidth : 0.5
                }));
            });
            return;
        }

        fillPasses.forEach(pass => {
            const strokeWidth = strokeWidthOf(pass, null);
            svg.appendChild(this._polygon({
                x1: size * 0.2,
                y1: size * 0.2,
                x2: size * 0.8,
                y2: size * 0.8,
                fill: pass.color,
                fillOpacity: pass.opacity,
                stroke: pass.strokeColor || '#1e40af',
                strokeWidth
            }));
        });
    }

    /**
     * Stacked lines: every pass is drawn on the same baseline so casings stay
     * visible, and each colour branch gets its own row.
     */
    static _drawLineSymbols(svg, linePasses, circlePasses, size) {
        // Circles declared alongside a line are its vertices and sit on it;
        // circles from another variant (route waypoints) are separate features
        const linePrefixes = new Set(linePasses.map(pass => pass.prefix));
        const vertexPasses = circlePasses.filter(pass => linePrefixes.has(pass.prefix));
        const markerPasses = circlePasses.filter(pass => !linePrefixes.has(pass.prefix));
        const maxStroke = Math.max(3, size * 0.14);
        const scaleStroke = strokeScaler(linePasses.map(pass => pass.width), {
            maxPx: maxStroke,
            minPx: 1,
            scale: size / 40
        });

        const classified = [...linePasses].reverse().find(pass => colorBranches(pass.colorExpr));
        const branches = classified ? colorBranches(classified.colorExpr) : null;
        // Stacked passes need vertical room, so show fewer branch rows
        const rows = branches ? Math.min(branches.length, linePasses.length > 1 ? 3 : 5) : 1;
        const step = Math.min(size * 0.14, 11, (size * 0.85) / rows);
        const startY = size / 2 - ((rows - 1) * step) / 2;

        for (let row = 0; row < rows; row++) {
            const branch = branches ? branches[row] : null;
            const y = startY + row * step;

            linePasses.forEach(pass => {
                svg.appendChild(this._line({
                    x1: size * 0.1,
                    x2: size * 0.9,
                    y,
                    stroke: branchValue(pass.colorExpr, branch, pass.color) || 'grey',
                    strokeWidth: scaleStroke(branchValue(pass.style['line-width'], branch, pass.width)),
                    opacity: branchValue(pass.style['line-opacity'], branch, pass.opacity),
                    dasharray: branchValue(pass.style['line-dasharray'], branch, pass.dasharray)
                }));
            });

            vertexPasses.forEach(pass => this._drawVertex(svg, pass, branch, size, size / 2, y));
        }

        if (markerPasses.length) {
            this._drawLineMarkers(svg, markerPasses, size, startY + ((rows - 1) * step) / 2);
        }
    }

    /**
     * Circles from their own variant (route waypoints), spaced along the line.
     */
    static _drawLineMarkers(svg, circlePasses, size, cy) {
        const branches = colorBranches(circlePasses[0].colorExpr);
        const slots = branches ? branches.slice(0, 3) : [null];
        const positions = slots.length === 1
            ? [size / 2]
            : slots.map((_, i) => size * (0.3 + (0.4 * i) / (slots.length - 1)));

        slots.forEach((branch, i) => {
            circlePasses.forEach(pass => this._drawVertex(svg, pass, branch, size, positions[i], cy));
        });
    }

    static _drawVertex(svg, pass, branch, size, cx, cy) {
        const radius = Math.max(2, Math.min(
            (branchValue(pass.style['circle-radius'], branch, pass.radius) || 6) * (size / 40),
            size * 0.12
        ));
        const strokeWidth = branchValue(pass.style['circle-stroke-width'], branch, pass.strokeWidth);
        svg.appendChild(this._circle({
            cx,
            cy,
            r: radius,
            fill: branchValue(pass.colorExpr, branch, pass.color),
            opacity: branchValue(pass.style['circle-opacity'], branch, pass.opacity),
            stroke: branchValue(pass.style['circle-stroke-color'], branch, pass.strokeColor) || 'transparent',
            strokeWidth: strokeWidth ? Math.max(0.5, Math.min(strokeWidth * (size / 40), radius * 0.6)) : 0
        }));
    }

    /**
     * Point layers: one circle per colour branch, offset diagonally.
     */
    static _drawPointSymbols(svg, circlePasses, size) {
        const branches = colorBranches(circlePasses[0].colorExpr);
        const slots = branches
            ? branches.slice(0, 4).map((branch, i) => ({
                branch,
                cx: size * 0.35 + i * size * 0.12,
                cy: size * 0.35 + i * size * 0.12,
                scale: 2.5,
                maxRadius: size / 4
            }))
            : [{ branch: null, cx: size / 2, cy: size / 2, scale: 3, maxRadius: size / 3 }];

        slots.forEach(slot => {
            circlePasses.forEach(pass => {
                const radius = branchValue(pass.style['circle-radius'], slot.branch, pass.radius) || 6;
                const strokeWidth = branchValue(pass.style['circle-stroke-width'], slot.branch, pass.strokeWidth);
                svg.appendChild(this._circle({
                    cx: slot.cx,
                    cy: slot.cy,
                    r: Math.min(radius * slot.scale, slot.maxRadius),
                    fill: branchValue(pass.colorExpr, slot.branch, pass.color),
                    opacity: branchValue(pass.style['circle-opacity'], slot.branch, pass.opacity),
                    stroke: branchValue(pass.style['circle-stroke-color'], slot.branch, pass.strokeColor) || '#ffffff',
                    strokeWidth: Math.max((strokeWidth == null ? 1 : strokeWidth) * 1.5, 0.5)
                }));
            });
        });
    }

    static _polygon({ x1, y1, x2, y2, fill, fillOpacity, stroke, strokeWidth }) {
        const polygon = document.createElementNS(SVG_NS, 'polygon');
        polygon.setAttribute('points', `${x1},${y1} ${x2},${y1} ${x2},${y2} ${x1},${y2}`);
        polygon.setAttribute('fill', fill);
        polygon.setAttribute('fill-opacity', fillOpacity != null ? fillOpacity : 0.5);
        if (strokeWidth > 0) {
            polygon.setAttribute('stroke', stroke);
            polygon.setAttribute('stroke-width', strokeWidth);
        }
        return polygon;
    }

    static _line({ x1, x2, y, stroke, strokeWidth, opacity, dasharray }) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y);
        line.setAttribute('stroke', stroke);
        line.setAttribute('stroke-width', strokeWidth);
        line.setAttribute('opacity', opacity != null ? opacity : 1);
        if (dasharray) line.setAttribute('stroke-dasharray', dasharray);
        return line;
    }

    static _circle({ cx, cy, r, fill, opacity, stroke, strokeWidth }) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', r);
        circle.setAttribute('fill', fill || '#3b82f6');
        circle.setAttribute('opacity', opacity != null ? opacity : 0.9);
        circle.setAttribute('stroke', stroke);
        circle.setAttribute('stroke-width', strokeWidth);
        return circle;
    }

    /**
     * Generate default thumbnail for layers without styles
     */
    static _generateDefaultThumbnail(layer, size) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.style.backgroundColor = '#f9fafb';

        // Background gradient
        const defs = document.createElementNS(SVG_NS, 'defs');
        const gradient = document.createElementNS(SVG_NS, 'linearGradient');
        gradient.setAttribute('id', `bg-gradient-${Date.now()}`);
        gradient.setAttribute('x1', '0%');
        gradient.setAttribute('y1', '0%');
        gradient.setAttribute('x2', '100%');
        gradient.setAttribute('y2', '100%');

        const stop1 = document.createElementNS(SVG_NS, 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('stop-color', '#f9fafb');

        const stop2 = document.createElementNS(SVG_NS, 'stop');
        stop2.setAttribute('offset', '100%');
        stop2.setAttribute('stop-color', '#f3f4f6');

        gradient.appendChild(stop1);
        gradient.appendChild(stop2);
        defs.appendChild(gradient);
        svg.appendChild(defs);

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('width', size);
        rect.setAttribute('height', size);
        rect.setAttribute('fill', `url(#bg-gradient-${Date.now()})`);
        svg.appendChild(rect);

        // Icon
        const icon = document.createElementNS(SVG_NS, 'text');
        icon.setAttribute('x', size / 2);
        icon.setAttribute('y', size * 0.4);
        icon.setAttribute('text-anchor', 'middle');
        icon.setAttribute('dominant-baseline', 'middle');
        icon.setAttribute('font-size', size * 0.35);
        icon.textContent = this._getDefaultIcon(layer.type);
        svg.appendChild(icon);

        // Type text
        const text = document.createElementNS(SVG_NS, 'text');
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
            'sheet': '📑',
            'tms': '🗺️',
            'raster-style-layer': '🖼️',
            'style': '🎨'
        };
        return icons[type] || '🗺️';
    }

    /**
     * Get type badge configuration
     */
    static _ensureLiveStyles() {
        if (document.getElementById('layer-thumbnail-live-style')) return;
        const style = document.createElement('style');
        style.id = 'layer-thumbnail-live-style';
        style.textContent = `@keyframes layer-live-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.35;transform:scale(0.75)} }`;
        document.head.appendChild(style);
    }

    static _getSampleTileUrl(layer) {
        const template = layer.url;
        if (!template || !template.includes('{z}')) return null;

        let lng = 74.12, lat = 15.3;
        if (layer.map?.center) {
            [lng, lat] = layer.map.center;
        } else if (layer.bounds) {
            lng = (layer.bounds[0] + layer.bounds[2]) / 2;
            lat = (layer.bounds[1] + layer.bounds[3]) / 2;
        }

        const z = 10;
        const x = Math.floor((lng + 180) / 360 * Math.pow(2, z));
        const latRad = lat * Math.PI / 180;
        const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, z));

        return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    }

    static getTypeBadge(type) {
        const configs = {
            'vector': { label: 'Vector', color: '#3b82f6', bg: '#eff6ff' },
            'geojson': { label: 'GeoJSON', color: '#10b981', bg: '#d1fae5' },
            'csv': { label: 'CSV', color: '#f59e0b', bg: '#fef3c7' },
            'sheet': { label: 'Sheet', color: '#f59e0b', bg: '#fef3c7' },
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

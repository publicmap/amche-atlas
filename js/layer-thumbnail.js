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
     * @param {Object} options - Additional options (isInView, currentBounds)
     * @returns {HTMLElement} Thumbnail element
     */
    static generate(layer, size = 80, options = {}) {
        const { isInView = true, layerDefaults = {}, interactive = true, title = null, useHeaderImage = true } = options;
        // headerImage is rendered as the card's header banner by callers like the
        // inspector, so they can opt out of repeating it as the thumbnail background.
        const headerImage = useHeaderImage ? layer.headerImage : null;
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
        if (headerImage) {
            container.style.backgroundImage = `url('${headerImage}')`;
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
        } else if (!headerImage) {
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
     * Generate symbology overlay for thumbnail
     * @param {Object} layer - Layer configuration
     * @param {number} size - Thumbnail size
     * @returns {SVGElement|null} SVG overlay element
     */
    static _generateSymbologyOverlay(layer, size, layerDefaults = {}) {
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

        // Helper to extract all output values from case/match expressions for multi-symbol rendering
        const getMultiValues = (value) => {
            if (!Array.isArray(value)) return null;

            if (value[0] === 'case') {
                const values = [];
                for (let i = 2; i < value.length; i += 2) {
                    values.push(value[i]);
                }
                if (value.length % 2 === 0) {
                    values.push(value[value.length - 1]);
                }
                return values.length > 1 ? values : null;
            }

            if (value[0] === 'match') {
                // match format: ["match", input, key1, output1, key2, output2, ..., default]
                const values = [];
                for (let i = 3; i < value.length - 1; i += 2) {
                    if (typeof value[i] === 'string') values.push(value[i]);
                }
                const lastVal = value[value.length - 1];
                if (typeof lastVal === 'string') values.push(lastVal);
                return values.length > 1 ? values : null;
            }

            return null;
        };

        // Helper to extract representative value from Mapbox expressions
        // Assumes zoom level 16 for balanced visibility
        const getValue = (value, defaultValue = null) => {
            if (typeof value === 'string' || typeof value === 'number') return value;
            if (!Array.isArray(value)) return defaultValue;

            const expr = value[0];

            // Handle interpolate expressions: ["interpolate", ["linear"], ["zoom"], 14, val1, 18, val2]
            if (expr === 'interpolate' && value.length >= 7) {
                // Find zoom stops and values
                const stops = [];
                for (let i = 3; i < value.length; i += 2) {
                    if (typeof value[i] === 'number' && i + 1 < value.length) {
                        stops.push({ zoom: value[i], value: value[i + 1] });
                    }
                }
                // Use zoom 16 for balanced styling
                if (stops.length >= 2) {
                    const targetZoom = 16;
                    for (let i = 0; i < stops.length - 1; i++) {
                        if (targetZoom >= stops[i].zoom && targetZoom <= stops[i + 1].zoom) {
                            // Take average of zoom position to pick appropriate value
                            const zoomProgress = (targetZoom - stops[i].zoom) / (stops[i + 1].zoom - stops[i].zoom);
                            // Use higher value if halfway or more, for better visibility
                            const val = zoomProgress >= 0.5 ? stops[i + 1].value : stops[i].value;
                            return Array.isArray(val) ? getValue(val, defaultValue) : val;
                        }
                    }
                    // Use middle stop value if available, otherwise first
                    const val = stops[Math.floor(stops.length / 2)].value;
                    return Array.isArray(val) ? getValue(val, defaultValue) : val;
                }
            }

            // Handle case expressions: ["case", condition, trueVal, falseVal]
            // For thumbnails, ignore feature-state and return the default/false value
            if (expr === 'case') {
                // Skip condition, get the last value (default/false case)
                const lastVal = value[value.length - 1];
                return Array.isArray(lastVal) ? getValue(lastVal, defaultValue) : lastVal;
            }

            // Handle step expressions: ["step", ["zoom"], defaultVal, stop1, val1, ...]
            if (expr === 'step' && value.length >= 3) {
                const targetZoom = 16;
                const defaultVal = value[2];
                let selectedVal = defaultVal;
                // Find appropriate step value
                for (let i = 3; i < value.length; i += 2) {
                    if (i + 1 < value.length && typeof value[i] === 'number') {
                        if (targetZoom >= value[i]) {
                            selectedVal = value[i + 1];
                        }
                    }
                }
                return Array.isArray(selectedVal) ? getValue(selectedVal, defaultValue) : selectedVal;
            }

            // Handle match expressions: ["match", input, key1, output1, ..., default]
            if (expr === 'match' && value.length >= 4) {
                const firstOutput = value[3];
                return Array.isArray(firstOutput) ? getValue(firstOutput, defaultValue) : firstOutput;
            }

            // For other expressions, try to find first concrete value
            for (let i = 1; i < value.length; i++) {
                const item = value[i];
                if (typeof item === 'string' || typeof item === 'number') {
                    // Skip expression operators and property accessors
                    if (item !== 'get' && item !== 'zoom' && item !== 'feature-state' &&
                        item !== 'linear' && item !== 'exponential' && item !== 'boolean') {
                        return item;
                    }
                }
            }

            return defaultValue;
        };

        // Fill symbology (with optional line)
        if (style['fill-color']) {
            const fillOpacity = getValue(style['fill-opacity'], 0.5);
            const lineColor = getValue(style['line-color'], '#1e40af');
            const lineWidth = getValue(style['line-width'], 1);

            // Check if fill-color is a case expression with multiple values
            const caseValues = getMultiValues(style['fill-color']);

            if (caseValues && caseValues.length > 1) {
                // Render multiple polygons, one for each case value
                const numPolygons = Math.min(caseValues.length, 4); // Limit to 4 for visibility
                const offsetStep = size * 0.08; // 8% offset between each polygon

                for (let i = 0; i < numPolygons; i++) {
                    const fillColor = caseValues[i];
                    const offset = i * offsetStep;

                    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    // Create offset polygons from bottom-right to top-left
                    const x1 = size * 0.2 + offset;
                    const y1 = size * 0.2 + offset;
                    const x2 = size * 0.7 + offset;
                    const y2 = size * 0.7 + offset;
                    const points = `${x1},${y1} ${x2},${y1} ${x2},${y2} ${x1},${y2}`;

                    polygon.setAttribute('points', points);
                    polygon.setAttribute('fill', fillColor);
                    polygon.setAttribute('fill-opacity', fillOpacity);

                    // Add stroke to make layers distinguishable
                    if (lineWidth > 0) {
                        polygon.setAttribute('stroke', lineColor);
                        polygon.setAttribute('stroke-width', Math.min(lineWidth * 1.5, 3));
                    } else {
                        // Add thin white stroke to separate overlapping polygons
                        polygon.setAttribute('stroke', 'white');
                        polygon.setAttribute('stroke-width', 0.5);
                    }

                    svg.appendChild(polygon);
                }
            } else {
                // Single polygon for non-case expressions
                const fillColor = getValue(style['fill-color'], '#3b82f6');
                const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                // Larger polygon covering more area (from 20% to 80%)
                const points = `${size * 0.2},${size * 0.2} ${size * 0.8},${size * 0.2} ${size * 0.8},${size * 0.8} ${size * 0.2},${size * 0.8}`;
                polygon.setAttribute('points', points);
                polygon.setAttribute('fill', fillColor);
                polygon.setAttribute('fill-opacity', fillOpacity);

                // Only show stroke if line-width is meaningful (> 0)
                if (lineWidth > 0) {
                    polygon.setAttribute('stroke', lineColor);
                    polygon.setAttribute('stroke-width', Math.min(lineWidth * 1.5, 3));
                }
                svg.appendChild(polygon);
            }
        }
        // Line symbology
        else if (style['line-color'] || style['line-width']) {
            const effectiveLineColor = style['line-color'];
            const width = getValue(style['line-width'], 2);
            const opacity = getValue(style['line-opacity'], 1);
            const hasCircle = !!(style['circle-radius'] || style['circle-color']);
            const circleColors = hasCircle ? getMultiValues(style['circle-color']) : null;
            const circleR = hasCircle ? Math.min(Math.max(getValue(style['circle-radius'], 3), 2), size * 0.08) : 0;

            const drawLine = (color, lineY, circleColor) => {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', size * 0.1);
                line.setAttribute('y1', lineY);
                line.setAttribute('x2', size * 0.9);
                line.setAttribute('y2', lineY);
                line.setAttribute('stroke', color);
                line.setAttribute('stroke-width', Math.min(Math.max(width * 2, 2), 4));
                line.setAttribute('opacity', opacity);
                svg.appendChild(line);

                if (hasCircle && circleR > 0) {
                    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    dot.setAttribute('cx', size / 2);
                    dot.setAttribute('cy', lineY);
                    dot.setAttribute('r', circleR);
                    dot.setAttribute('fill', typeof circleColor === 'string' ? circleColor : color);
                    dot.setAttribute('opacity', opacity);
                    svg.appendChild(dot);
                }
            };

            const caseValues = getMultiValues(effectiveLineColor);

            if (caseValues && caseValues.length > 1) {
                const numLines = Math.min(caseValues.length, 5);
                const step = Math.min(size * 0.14, 11);
                const startY = size / 2 - ((numLines - 1) * step) / 2;
                for (let i = 0; i < numLines; i++) {
                    drawLine(caseValues[i], startY + i * step, circleColors?.[i]);
                }
            } else {
                drawLine(getValue(effectiveLineColor, 'grey'), size / 2, getValue(style['circle-color'], null));
            }
        }
        // Circle symbology
        else if (style['circle-radius'] || style['circle-color']) {
            const radius = getValue(style['circle-radius'], 6);
            const strokeColor = getValue(style['circle-stroke-color'], '#ffffff');
            const strokeWidth = getValue(style['circle-stroke-width'], 1);
            const opacity = getValue(style['circle-opacity'], 0.9);

            const caseValues = getMultiValues(style['circle-color']);

            if (caseValues && caseValues.length > 1) {
                const numCircles = Math.min(caseValues.length, 4);
                const offsetStep = size * 0.12;

                for (let i = 0; i < numCircles; i++) {
                    const color = caseValues[i];
                    const offset = i * offsetStep;

                    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    circle.setAttribute('cx', size * 0.35 + offset);
                    circle.setAttribute('cy', size * 0.35 + offset);
                    circle.setAttribute('r', Math.min(radius * 2.5, size / 4));
                    circle.setAttribute('fill', color);
                    circle.setAttribute('opacity', opacity);
                    circle.setAttribute('stroke', strokeColor);
                    circle.setAttribute('stroke-width', Math.max(strokeWidth * 1.5, 0.5));
                    svg.appendChild(circle);
                }
            } else {
                const color = getValue(style['circle-color'], '#3b82f6');
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', size / 2);
                circle.setAttribute('cy', size / 2);
                circle.setAttribute('r', Math.min(radius * 3, size / 3));
                circle.setAttribute('fill', color);
                circle.setAttribute('opacity', opacity);
                circle.setAttribute('stroke', strokeColor);
                circle.setAttribute('stroke-width', Math.max(strokeWidth * 1.5, 0.5));
                svg.appendChild(circle);
            }
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

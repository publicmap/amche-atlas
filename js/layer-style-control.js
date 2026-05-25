/**
 * LayerStyleControl - Dynamic style editor for map layers
 * Renders UI controls to modify layer.style properties based on Mapbox GL JS layer type
 */

export class LayerStyleControl {
    constructor(mapboxAPI, map) {
        this._mapboxAPI = mapboxAPI;
        this._map = map;

        // Property metadata for rendering appropriate controls
        this._propertyMetadata = this._initializePropertyMetadata();
    }

    /**
     * Initialize metadata for style properties
     */
    _initializePropertyMetadata() {
        return {
            opacity: {
                type: 'slider',
                min: 0,
                max: 1,
                step: 0.01,
                suffix: ''
            },
            width: {
                type: 'number',
                min: 0,
                max: 50,
                step: 0.5,
                suffix: 'px'
            },
            radius: {
                type: 'number',
                min: 0,
                max: 100,
                step: 1,
                suffix: 'px'
            },
            color: {
                type: 'color',
                supportsText: true
            },
            blur: {
                type: 'number',
                min: 0,
                max: 20,
                step: 0.5,
                suffix: 'px'
            },
            offset: {
                type: 'array',
                arrayType: 'number'
            },
            translate: {
                type: 'array',
                arrayType: 'number'
            }
        };
    }

    /**
     * Get Mapbox GL JS style spec documentation URL for a property
     */
    _getDocURL(layerType, property, isPaint = true) {
        const section = isPaint ? 'paint' : 'layout';
        const baseURL = 'https://docs.mapbox.com/style-spec/reference/layers/';

        return `${baseURL}#${section}-${layerType}-${property}`;
    }

    /**
     * Render style editor content for a layer
     */
    renderStyleEditor(layerId, config) {
        const container = document.createElement('div');
        container.className = 'layer-style-editor';
        container.style.cssText = `
            padding: 12px;
            font-size: 12px;
        `;

        try {
            // Get layer IDs from MapboxAPI
            const layerIds = this._mapboxAPI.getLayerGroupIds(layerId, config);

            if (layerIds.length === 0) {
                container.innerHTML = `
                    <div style="color: #9ca3af; font-style: italic;">
                        No style properties available for this layer type
                    </div>
                `;
                return container;
            }

            // Get current style properties from map layers
            const styleProperties = this._collectStyleProperties(layerIds, config);

            if (Object.keys(styleProperties).length === 0) {
                container.innerHTML = `
                    <div style="color: #9ca3af; font-style: italic;">
                        No editable style properties found
                    </div>
                `;
                return container;
            }

            // Create style editor table
            const table = this._createStyleTable(layerId, config, layerIds, styleProperties);
            container.appendChild(table);

            return container;
        } catch (error) {
            console.error('[LayerStyleControl] Error rendering style editor:', error);
            container.innerHTML = `
                <div style="color: #ef4444; font-style: italic; padding: 8px;">
                    Error loading style editor: ${error.message}
                </div>
            `;
            return container;
        }
    }

    /**
     * Extract the variant prefix from a generated map layer ID.
     * Variant layers are suffixed with `--<prefix>` (see MapboxAPI._getVariantSuffix).
     */
    _extractVariantPrefix(mapLayerId) {
        const idx = mapLayerId.lastIndexOf('--');
        return idx >= 0 ? mapLayerId.substring(idx + 2) : '';
    }

    /**
     * Build the dictionary key used to dedupe rows in the inspector table.
     * Base variant uses the bare property; variants use `<prefix>/<property>`,
     * matching the syntax in `config.style`.
     */
    _variantKey(variantPrefix, property) {
        return variantPrefix ? `${variantPrefix}/${property}` : property;
    }

    /**
     * Collect style properties from map layers, keyed by variant so that
     * the same property (e.g. line-color) shows up once per variant.
     */
    _collectStyleProperties(layerIds, config) {
        const properties = {};
        const debugInfo = { collected: [], filtered: [] };

        // Get common paint properties based on layer type
        const commonProperties = this._getCommonProperties(config);

        layerIds.forEach(mapLayerId => {
            const layer = this._map.getLayer(mapLayerId);
            if (!layer) return;

            const layerType = layer.type;
            const variantPrefix = this._extractVariantPrefix(mapLayerId);

            // Collect paint properties
            if (layer.paint) {
                Object.keys(layer.paint).forEach(prop => {
                    if (!prop.startsWith('_')) {
                        const value = this._map.getPaintProperty(mapLayerId, prop);

                        // Skip complex expressions that can't be edited with simple controls
                        if (this._isEditableValue(value)) {
                            const key = this._variantKey(variantPrefix, prop);
                            properties[key] = {
                                value: value,
                                property: prop,
                                variantPrefix: variantPrefix,
                                type: 'paint',
                                layerType: layerType,
                                mapLayerId: mapLayerId
                            };
                            debugInfo.collected.push({ key, value, type: 'paint' });
                        } else {
                            debugInfo.filtered.push({ prop, value, type: 'paint', reason: 'not editable' });
                        }
                    }
                });
            }

            // Add common paint properties from config.style if not already present
            if (config.style) {
                commonProperties.paint[layerType]?.forEach(prop => {
                    const configKey = this._variantKey(variantPrefix, prop);
                    if (!properties[configKey] && config.style[configKey] !== undefined) {
                        const value = config.style[configKey];
                        if (this._isEditableValue(value)) {
                            properties[configKey] = {
                                value: value,
                                property: prop,
                                variantPrefix: variantPrefix,
                                type: 'paint',
                                layerType: layerType,
                                mapLayerId: mapLayerId,
                                fromConfig: true
                            };
                            debugInfo.collected.push({ key: configKey, value, type: 'paint', source: 'config' });
                        }
                    }
                });
            }

            // Collect layout properties (excluding visibility)
            if (layer.layout) {
                Object.keys(layer.layout).forEach(prop => {
                    if (!prop.startsWith('_') && prop !== 'visibility') {
                        const value = this._map.getLayoutProperty(mapLayerId, prop);

                        // Skip complex expressions that can't be edited with simple controls
                        if (this._isEditableValue(value)) {
                            const key = this._variantKey(variantPrefix, prop);
                            properties[key] = {
                                value: value,
                                property: prop,
                                variantPrefix: variantPrefix,
                                type: 'layout',
                                layerType: layerType,
                                mapLayerId: mapLayerId
                            };
                            debugInfo.collected.push({ key, value, type: 'layout' });
                        } else {
                            debugInfo.filtered.push({ prop, value, type: 'layout', reason: 'not editable' });
                        }
                    }
                });
            }

            // Add common layout properties from config.style if not already present
            if (config.style) {
                commonProperties.layout[layerType]?.forEach(prop => {
                    const configKey = this._variantKey(variantPrefix, prop);
                    if (!properties[configKey] && config.style[configKey] !== undefined) {
                        const value = config.style[configKey];
                        if (this._isEditableValue(value)) {
                            properties[configKey] = {
                                value: value,
                                property: prop,
                                variantPrefix: variantPrefix,
                                type: 'layout',
                                layerType: layerType,
                                mapLayerId: mapLayerId,
                                fromConfig: true
                            };
                            debugInfo.collected.push({ key: configKey, value, type: 'layout', source: 'config' });
                        }
                    }
                });
            }
        });

        console.log('[LayerStyleControl] Property collection:', debugInfo);
        return properties;
    }

    /**
     * Get common editable properties for each layer type
     */
    _getCommonProperties(config) {
        return {
            paint: {
                fill: ['fill-color', 'fill-opacity', 'fill-outline-color'],
                line: ['line-color', 'line-width', 'line-opacity', 'line-dasharray'],
                circle: ['circle-color', 'circle-radius', 'circle-opacity', 'circle-stroke-color', 'circle-stroke-width'],
                symbol: ['text-color', 'text-halo-color', 'text-halo-width', 'text-opacity', 'icon-color', 'icon-opacity'],
                raster: ['raster-opacity', 'raster-brightness-min', 'raster-brightness-max', 'raster-contrast', 'raster-saturation']
            },
            layout: {
                fill: [],
                line: ['line-cap', 'line-join'],
                circle: [],
                symbol: ['text-size', 'text-font', 'text-offset', 'text-anchor', 'text-transform', 'text-letter-spacing', 'text-line-height', 'text-max-width', 'icon-size', 'icon-offset'],
                raster: []
            }
        };
    }

    /**
     * Check if a value is editable (not a complex expression)
     */
    _isEditableValue(value) {
        // Allow undefined/null (means using default)
        if (value === undefined || value === null) {
            return false;
        }

        // Allow primitives: numbers, strings, booleans
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
            return true;
        }

        // Allow arrays (both simple arrays and expressions)
        if (Array.isArray(value)) {
            // Check if it's a Mapbox expression (first element is a string operator)
            if (value.length > 0 && typeof value[0] === 'string' &&
                ['interpolate', 'step', 'match', 'case', 'get', 'zoom', 'literal', 'coalesce'].includes(value[0])) {
                // Allow expressions - they'll be edited as JSON
                return true;
            }

            // Allow simple arrays (e.g., [0, 0] for offsets)
            return value.every(item =>
                typeof item === 'number' ||
                typeof item === 'string' ||
                typeof item === 'boolean'
            );
        }

        // Reject objects (unless we want to support them in the future)
        return false;
    }

    /**
     * Create style properties table. Rows are grouped by variant prefix —
     * each variant gets a sub-header so the user can tell which style pass
     * a property belongs to.
     */
    _createStyleTable(layerId, config, layerIds, styleProperties) {
        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
        `;

        const tbody = document.createElement('tbody');

        // Group properties by variant prefix
        const byVariant = new Map();
        Object.entries(styleProperties).forEach(([key, propInfo]) => {
            const prefix = propInfo.variantPrefix || '';
            if (!byVariant.has(prefix)) byVariant.set(prefix, []);
            byVariant.get(prefix).push({ key, propInfo });
        });

        // Render base variant first, then named variants sorted alphabetically
        const orderedPrefixes = Array.from(byVariant.keys()).sort((a, b) => {
            if (a === '') return -1;
            if (b === '') return 1;
            return a.localeCompare(b);
        });
        const showHeaders = byVariant.size > 1;

        orderedPrefixes.forEach(prefix => {
            if (showHeaders) {
                const headerRow = document.createElement('tr');
                const headerCell = document.createElement('td');
                headerCell.colSpan = 2;
                headerCell.textContent = prefix === '' ? 'base' : prefix;
                headerCell.style.cssText = `
                    padding: 6px 6px 4px;
                    font-size: 10px;
                    font-weight: 600;
                    color: #6b7280;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    background: #f3f4f6;
                `;
                headerRow.appendChild(headerCell);
                tbody.appendChild(headerRow);
            }

            const entries = byVariant.get(prefix);
            entries.sort((a, b) => a.propInfo.property.localeCompare(b.propInfo.property));

            entries.forEach(({ key, propInfo }) => {
                const row = this._createPropertyRow(
                    layerId,
                    config,
                    key,
                    propInfo,
                    layerIds
                );
                tbody.appendChild(row);
            });
        });

        table.appendChild(tbody);
        return table;
    }

    /**
     * Create a table row for a style property. `propertyKey` is the variant-
     * qualified key used in config.style (e.g. "overlay/line-color"); the
     * underlying property name lives on propInfo.property.
     */
    _createPropertyRow(layerId, config, propertyKey, propInfo, layerIds) {
        const property = propInfo.property || propertyKey;
        const row = document.createElement('tr');
        row.style.cssText = `
            border-bottom: 1px solid #f3f4f6;
        `;

        // Property name cell (with link to docs)
        const nameCell = document.createElement('td');
        nameCell.style.cssText = `
            padding: 8px 6px;
            font-weight: 500;
            color: #374151;
            vertical-align: top;
            width: 40%;
        `;

        const docURL = this._getDocURL(propInfo.layerType, property, propInfo.type === 'paint');
        const link = document.createElement('a');
        link.href = docURL;
        link.target = '_blank';
        link.textContent = property;
        link.style.cssText = `
            color: #3b82f6;
            text-decoration: none;
        `;
        link.addEventListener('mouseenter', () => {
            link.style.textDecoration = 'underline';
        });
        link.addEventListener('mouseleave', () => {
            link.style.textDecoration = 'none';
        });

        nameCell.appendChild(link);

        // Value cell (with appropriate control)
        const valueCell = document.createElement('td');
        valueCell.style.cssText = `
            padding: 8px 6px;
            vertical-align: top;
        `;

        const control = this._createPropertyControl(
            layerId,
            config,
            property,
            propInfo,
            layerIds
        );
        valueCell.appendChild(control);

        row.appendChild(nameCell);
        row.appendChild(valueCell);

        return row;
    }

    /**
     * Create appropriate control for a property
     */
    _createPropertyControl(layerId, config, property, propInfo, layerIds) {
        const container = document.createElement('div');
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        const controlType = this._inferControlType(property, propInfo.value);

        if (controlType === 'expression') {
            const expressionControl = this._createExpressionControl(property, propInfo, (value) => {
                this._updateProperty(layerId, config, property, propInfo, layerIds, value);
            });
            container.appendChild(expressionControl);
        } else if (controlType === 'slider') {
            const slider = this._createSliderControl(property, propInfo, (value) => {
                this._updateProperty(layerId, config, property, propInfo, layerIds, value);
            });
            container.appendChild(slider);
        } else if (controlType === 'color') {
            const colorControl = this._createColorControl(property, propInfo, (value) => {
                this._updateProperty(layerId, config, property, propInfo, layerIds, value);
            });
            container.appendChild(colorControl);
        } else if (controlType === 'number') {
            const numberControl = this._createNumberControl(property, propInfo, (value) => {
                this._updateProperty(layerId, config, property, propInfo, layerIds, value);
            });
            container.appendChild(numberControl);
        } else {
            const textControl = this._createTextControl(property, propInfo, (value) => {
                this._updateProperty(layerId, config, property, propInfo, layerIds, value);
            });
            container.appendChild(textControl);
        }

        return container;
    }

    /**
     * Infer control type from property name and value
     */
    _inferControlType(property, value) {
        // Check if it's a Mapbox expression
        if (Array.isArray(value) && value.length > 0 &&
            typeof value[0] === 'string' &&
            ['interpolate', 'step', 'match', 'case', 'get', 'zoom', 'literal', 'coalesce'].includes(value[0])) {
            return 'expression';
        }

        // Check property metadata
        for (const [key, metadata] of Object.entries(this._propertyMetadata)) {
            if (property.includes(key)) {
                return metadata.type;
            }
        }

        // Fallback inference
        if (property.includes('opacity')) return 'slider';
        if (property.includes('color')) return 'color';
        if (typeof value === 'number') return 'number';
        if (Array.isArray(value)) return 'array';

        return 'text';
    }

    /**
     * Create expression control (textarea for JSON)
     */
    _createExpressionControl(property, propInfo, onChange) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        // Format JSON with proper indentation
        const formattedJSON = JSON.stringify(propInfo.value, null, 2);

        const textarea = document.createElement('textarea');
        textarea.value = formattedJSON;
        textarea.rows = Math.min(10, formattedJSON.split('\n').length + 1);
        textarea.style.cssText = `
            width: 100%;
            padding: 6px;
            border: 1px solid #d1d5db;
            border-radius: 3px;
            font-size: 10px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
            resize: vertical;
            background: #f9fafb;
            line-height: 1.4;
        `;

        // Add info label
        const infoLabel = document.createElement('div');
        infoLabel.textContent = 'Expression (JSON format)';
        infoLabel.style.cssText = `
            font-size: 9px;
            color: #6b7280;
            font-style: italic;
        `;

        // Error display
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            font-size: 9px;
            color: #ef4444;
            display: none;
        `;

        let debounceTimer = null;

        textarea.addEventListener('input', (e) => {
            // Clear previous error
            errorDiv.style.display = 'none';

            // Debounce the update
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            debounceTimer = setTimeout(() => {
                try {
                    const parsed = JSON.parse(e.target.value);
                    onChange(parsed);
                    // Success - green border
                    textarea.style.borderColor = '#10b981';
                    setTimeout(() => {
                        textarea.style.borderColor = '#d1d5db';
                    }, 1000);
                } catch (err) {
                    // Show error
                    errorDiv.textContent = `Invalid JSON: ${err.message}`;
                    errorDiv.style.display = 'block';
                    textarea.style.borderColor = '#ef4444';
                }
            }, 500);
        });

        wrapper.appendChild(infoLabel);
        wrapper.appendChild(textarea);
        wrapper.appendChild(errorDiv);

        return wrapper;
    }

    /**
     * Create slider control
     */
    _createSliderControl(property, propInfo, onChange) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        // Normalize value - handle expressions and non-numeric values
        let numericValue = 0;
        if (typeof propInfo.value === 'number') {
            numericValue = propInfo.value;
        } else if (typeof propInfo.value === 'string') {
            const parsed = parseFloat(propInfo.value);
            numericValue = isNaN(parsed) ? 0 : parsed;
        }

        // Clamp value between 0 and 1
        numericValue = Math.max(0, Math.min(1, numericValue));

        const slider = document.createElement('sl-range');
        slider.min = 0;
        slider.max = 1;
        slider.step = 0.01;
        slider.value = numericValue;
        slider.style.flex = '1';
        slider.style.cssText = `
            flex: 1;
            --track-height: 4px;
            --thumb-size: 14px;
        `;

        const valueLabel = document.createElement('span');
        valueLabel.textContent = numericValue.toFixed(2);
        valueLabel.style.cssText = `
            min-width: 40px;
            text-align: right;
            color: #6b7280;
            font-size: 11px;
        `;

        slider.addEventListener('sl-input', (e) => {
            const value = parseFloat(e.target.value);
            valueLabel.textContent = value.toFixed(2);
            onChange(value);
        });

        wrapper.appendChild(slider);
        wrapper.appendChild(valueLabel);

        return wrapper;
    }

    /**
     * Create color control (text input + color picker)
     */
    _createColorControl(property, propInfo, onChange) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
            display: flex;
            gap: 6px;
            align-items: center;
        `;

        // Normalize the initial value
        const initialValue = propInfo.value || '#000000';
        const normalizedHex = this._normalizeColorForPicker(initialValue);

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = initialValue;
        textInput.style.cssText = `
            flex: 1;
            padding: 4px 6px;
            border: 1px solid #d1d5db;
            border-radius: 3px;
            font-size: 11px;
            font-family: monospace;
        `;

        const colorPicker = document.createElement('input');
        colorPicker.type = 'color';
        colorPicker.value = normalizedHex;
        colorPicker.style.cssText = `
            width: 32px;
            height: 24px;
            border: 1px solid #d1d5db;
            border-radius: 3px;
            cursor: pointer;
            padding: 0;
        `;

        textInput.addEventListener('input', (e) => {
            const value = e.target.value;
            try {
                const newHex = this._normalizeColorForPicker(value);
                // Only update color picker if we got a valid hex
                if (newHex !== '#000000' || value.trim().toLowerCase() === 'black' || value.trim() === '#000000') {
                    colorPicker.value = newHex;
                }
            } catch (err) {
                // Invalid color format - don't update picker
                console.debug('Invalid color format:', value);
            }
            onChange(value);
        });

        colorPicker.addEventListener('input', (e) => {
            const value = e.target.value;
            textInput.value = value;
            onChange(value);
        });

        wrapper.appendChild(textInput);
        wrapper.appendChild(colorPicker);

        return wrapper;
    }

    /**
     * Create number control
     */
    _createNumberControl(property, propInfo, onChange) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
            display: flex;
            gap: 6px;
            align-items: center;
        `;

        // Normalize value
        let numericValue = 0;
        if (typeof propInfo.value === 'number') {
            numericValue = propInfo.value;
        } else if (typeof propInfo.value === 'string') {
            const parsed = parseFloat(propInfo.value);
            numericValue = isNaN(parsed) ? 0 : parsed;
        }

        const input = document.createElement('input');
        input.type = 'number';
        input.value = numericValue;
        input.step = 0.5;
        input.style.cssText = `
            flex: 1;
            padding: 4px 6px;
            border: 1px solid #d1d5db;
            border-radius: 3px;
            font-size: 11px;
        `;

        input.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (!isNaN(value)) {
                onChange(value);
            }
        });

        wrapper.appendChild(input);

        return wrapper;
    }

    /**
     * Create text control
     */
    _createTextControl(property, propInfo, onChange) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = this._formatValue(propInfo.value);
        input.style.cssText = `
            width: 100%;
            padding: 4px 6px;
            border: 1px solid #d1d5db;
            border-radius: 3px;
            font-size: 11px;
            font-family: monospace;
        `;

        input.addEventListener('input', (e) => {
            try {
                const value = this._parseValue(e.target.value, propInfo.value);
                onChange(value);
            } catch (err) {
                console.warn('Invalid value format:', err);
            }
        });

        return input;
    }

    /**
     * Update property on map layers. Only updates layers belonging to the
     * same variant as the property being edited.
     */
    _updateProperty(layerId, config, property, propInfo, layerIds, value) {
        const variantPrefix = propInfo.variantPrefix || '';
        const targetLayers = layerIds.filter(id => this._extractVariantPrefix(id) === variantPrefix);

        targetLayers.forEach(mapLayerId => {
            const layer = this._map.getLayer(mapLayerId);
            if (!layer) return;

            try {
                if (propInfo.type === 'paint') {
                    this._map.setPaintProperty(mapLayerId, property, value);
                } else {
                    this._map.setLayoutProperty(mapLayerId, property, value);
                }
            } catch (error) {
                console.warn(`Failed to update ${property} on ${mapLayerId}:`, error);
            }
        });

        // Persist with the variant-qualified key so the prefix survives round-trips
        if (!config.style) config.style = {};
        const configKey = variantPrefix ? `${variantPrefix}/${property}` : property;
        config.style[configKey] = value;

        // Trigger URL update if available
        if (window.urlManager) {
            setTimeout(() => {
                window.urlManager.updateURL();
            }, 100);
        }
    }

    /**
     * Normalize color value for HTML color picker
     */
    _normalizeColorForPicker(value) {
        if (!value) return '#000000';

        if (typeof value === 'string') {
            const trimmed = value.trim().toLowerCase();

            // Handle hex colors
            if (trimmed.startsWith('#')) {
                // Short hex (#RGB) -> long hex (#RRGGBB)
                if (trimmed.length === 4) {
                    return '#' + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2] + trimmed[3] + trimmed[3];
                }
                // Long hex (#RRGGBB or #RRGGBBAA)
                if (trimmed.length >= 7) {
                    return trimmed.substring(0, 7); // Take only #RRGGBB, ignore alpha
                }
                return trimmed;
            }

            // Handle rgb/rgba
            if (trimmed.startsWith('rgb')) {
                const match = trimmed.match(/\d+/g);
                if (match && match.length >= 3) {
                    const r = parseInt(match[0]).toString(16).padStart(2, '0');
                    const g = parseInt(match[1]).toString(16).padStart(2, '0');
                    const b = parseInt(match[2]).toString(16).padStart(2, '0');
                    return `#${r}${g}${b}`;
                }
            }

            // Handle hsl/hsla
            if (trimmed.startsWith('hsl')) {
                // Convert HSL to RGB then to hex
                const match = trimmed.match(/\d+\.?\d*/g);
                if (match && match.length >= 3) {
                    const h = parseFloat(match[0]);
                    const s = parseFloat(match[1]) / 100;
                    const l = parseFloat(match[2]) / 100;
                    const rgb = this._hslToRgb(h, s, l);
                    return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`;
                }
            }

            // Handle named colors - convert to hex
            const namedColors = {
                'black': '#000000', 'white': '#ffffff', 'red': '#ff0000', 'green': '#008000',
                'blue': '#0000ff', 'yellow': '#ffff00', 'cyan': '#00ffff', 'magenta': '#ff00ff',
                'gray': '#808080', 'grey': '#808080', 'orange': '#ffa500', 'purple': '#800080',
                'pink': '#ffc0cb', 'brown': '#a52a2a', 'lime': '#00ff00', 'navy': '#000080'
            };
            if (namedColors[trimmed]) {
                return namedColors[trimmed];
            }
        }

        return '#000000';
    }

    /**
     * Convert HSL to RGB
     */
    _hslToRgb(h, s, l) {
        h = h / 360;
        let r, g, b;

        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    }

    /**
     * Format value for display
     */
    _formatValue(value) {
        if (Array.isArray(value)) {
            return JSON.stringify(value);
        }
        if (typeof value === 'object') {
            return JSON.stringify(value);
        }
        return String(value);
    }

    /**
     * Parse value from string input
     */
    _parseValue(text, originalValue) {
        if (text.startsWith('[') || text.startsWith('{')) {
            return JSON.parse(text);
        }

        if (typeof originalValue === 'number') {
            return parseFloat(text);
        }

        return text;
    }
}

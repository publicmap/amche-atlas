import {fetchTileJSON} from './map-utils.js';

/**
 * LayerSettingsModal - Handles the layer settings modal functionality
 */
export class LayerSettingsModal {
    constructor(mapLayerControl) {
        this.mapLayerControl = mapLayerControl;
        this._initialized = false;
        this._originalConfig = null;

        this._initializeModal();
    }

    /**
     * Initialize the modal HTML and event listeners
     */
    _initializeModal() {
        if (!document.getElementById('layer-settings-modal')) {
            const modalHTML = `
                <sl-dialog id="layer-settings-modal" label="" class="layer-settings-dialog">
                    <div slot="label" class="settings-header">
                        <div class="header-bg">
                        <div class="header-overlay"></div>
                        <h2 class="header-title text-white relative z-10 px-4"></h2></div>
                    </div>
                    <div class="layer-settings-content">
                        <div class="settings-body grid grid-cols-2 gap-4">
                            <div class="col-1">
                                <div class="description mb-4"></div>
                                <div class="attribution mb-4"></div>
                                <div class="data-source mb-4">
                                    <h3 class="text-sm font-bold mb-2">Data Source</h3>
                                    <div class="source-details"></div>
                                </div>
                                <sl-details class="tilejson-section mb-4">
                                    <div slot="summary" class="text-sm font-bold">View Metadata</div>
                                    <div class="tilejson-content font-mono text-xs"></div>
                                </sl-details>
                                <sl-details class="advanced-section">
                                    <div slot="summary" class="text-sm font-bold">Edit Settings</div>
                                    <div class="config-editor mt-2"></div>
                                </sl-details>
                            </div>
                            <div class="col-2">
                                <div class="legend mb-4"></div>
                                <div class="style-section mb-4">
                                    <div class="style-editor"></div>
                                    <div class="inspect-section mb-4">
                                    <div class="inspect-editor"></div>
                                </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div slot="footer" class="flex justify-end gap-2">
                        <sl-button variant="default" class="cancel-button layer-settings-btn">Close</sl-button>
                        <sl-button variant="primary" class="save-button layer-settings-btn" style="display: none;">Save Changes</sl-button>
                    </div>
                </sl-dialog>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);

            // Add event listeners
            const modal = document.getElementById('layer-settings-modal');
            modal.querySelector('.cancel-button').addEventListener('click', () => modal.hide());
            modal.querySelector('.save-button').addEventListener('click', () => this._saveLayerSettings());
        }
    }

    /**
     * Show the layer settings modal for a given group
     */
    async show(group) {
        const modal = document.getElementById('layer-settings-modal');
        const content = modal.querySelector('.layer-settings-content');
        const saveButton = modal.querySelector('.save-button');

        // Reset save button visibility
        saveButton.style.display = 'none';

        // Store original config for comparison
        this._originalConfig = JSON.stringify(group);

        // Update header with background image
        const headerBg = modal.querySelector('.header-bg');
        const headerTitle = modal.querySelector('.header-title');

        headerTitle.textContent = group.title;

        if (group.headerImage) {
            headerBg.style.backgroundImage = `url('${group.headerImage}')`;
            headerBg.style.opacity = '1';
        } else {
            headerBg.style.backgroundImage = '';
            headerBg.style.opacity = '0';
        }

        // Update description
        const descriptionEl = content.querySelector('.description');
        if (group.description) {
            descriptionEl.innerHTML = `
                <div class="text-m">${group.description}</div>
            `;
            descriptionEl.style.display = '';
        } else {
            descriptionEl.style.display = 'none';
        }

        // Update attribution
        const attributionEl = content.querySelector('.attribution');
        if (group.attribution) {
            attributionEl.innerHTML = `
                <h3 class="text-sm font-bold mb-2">Attribution</h3>
                <div class="text-sm">${group.attribution}</div>
            `;
            attributionEl.style.display = '';
        } else {
            attributionEl.style.display = 'none';
        }

        // Update data source section and TileJSON
        const sourceDetails = content.querySelector('.source-details');
        const tileJSONSection = content.querySelector('.tilejson-section');
        sourceDetails.innerHTML = '';

        if (group.type === 'tms' || group.type === 'vector' || group.type === 'geojson' || group.type === 'raster-style-layer') {
            sourceDetails.innerHTML = `
                <div class="source-details-content bg-gray-100 rounded">
                    <div class="mb-2">
                        <div class="text-xs text-gray-600">Format</div>
                        <div class="font-mono text-sm">${group.type.toUpperCase()}</div>
                    </div>
                    ${group.type !== 'raster-style-layer' ? `
                        <div class="mb-2">
                            <div class="text-xs text-gray-600">URL</div>
                            <div class="font-mono text-sm break-all">${group.url}</div>
                        </div>
                    ` : `
                        <div class="mb-2">
                            <div class="text-xs text-gray-600">Style Layer</div>
                            <div class="font-mono text-sm">${group.styleLayer || group.id}</div>
                        </div>
                    `}
                    ${group.type === 'vector' ? `
                        <div class="mb-2">
                            <div class="text-xs text-gray-600">Source Layer</div>
                            <div class="font-mono text-sm">${group.sourceLayer || ''}</div>
                        </div>
                        <div>
                            <div class="text-xs text-gray-600">Max Zoom</div>
                            <div class="font-mono text-sm">${group.maxzoom || 'Not set'}</div>
                        </div>
                    ` : ''}
                </div>
            `;

            // Fetch and display TileJSON if available
            if ((group.type === 'vector' || group.type === 'tms') && group.url) {
                const tileJSON = await fetchTileJSON(group.url);
                if (tileJSON) {
                    content.querySelector('.tilejson-content').innerHTML = `
                        <div class="p-3 bg-gray-100 rounded">
                            <pre class="whitespace-pre-wrap">${JSON.stringify(tileJSON, null, 2)}</pre>
                        </div>
                    `;
                    tileJSONSection.style.display = '';
                } else {
                    tileJSONSection.style.display = 'none';
                }
            } else {
                tileJSONSection.style.display = 'none';
            }
        } else {
            sourceDetails.parentElement.style.display = 'none';
            tileJSONSection.style.display = 'none';
        }

        // Update legend
        const legendEl = content.querySelector('.legend');
        if (group.legendImage) {
            legendEl.innerHTML = `
                <h3 class="text-sm font-bold mb-2">Legend</h3>
                <img src="${group.legendImage}" alt="Legend" style="max-width: 100%">
            `;
            legendEl.style.display = '';
        } else {
            legendEl.style.display = 'none';
        }

        // Update style section
        const styleEditor = content.querySelector('.style-editor');
        if (group.style) {
            styleEditor.innerHTML = this._generateStyleLegend(group);
            styleEditor.parentElement.style.display = '';
        } else {
            styleEditor.parentElement.style.display = 'none';
        }

        // Update inspect section
        const inspectEditor = content.querySelector('.inspect-editor');
        if (group.inspect) {
            inspectEditor.innerHTML = `
                <sl-textarea
                    rows="10"
                    class="inspect-json"
                    label="Inspect Popup Settings"
                    value='${JSON.stringify(group.inspect, null, 2)}'
                ></sl-textarea>
            `;
            inspectEditor.parentElement.style.display = '';
        } else {
            inspectEditor.parentElement.style.display = 'none';
        }

        // Update advanced section
        const configEditor = content.querySelector('.config-editor');
        const configTextarea = document.createElement('sl-textarea');
        configTextarea.setAttribute('rows', '15');
        configTextarea.setAttribute('class', 'config-json');
        configTextarea.value = JSON.stringify(group, null, 2);

        // Add change listener to track modifications
        configTextarea.addEventListener('input', () => {
            try {
                const newConfig = JSON.parse(configTextarea.value);
                const hasChanges = this._originalConfig !== JSON.stringify(newConfig);
                saveButton.style.display = hasChanges ? '' : 'none';
            } catch (e) {
                // If JSON is invalid, keep save button hidden
                saveButton.style.display = 'none';
            }
        });

        configEditor.innerHTML = '';
        configEditor.appendChild(configTextarea);

        modal.show();
    }

    /**
     * Generate style legend HTML for the modal
     */
    _generateStyleLegend(group) {
        let styleHtml = `
            <div class="vector-legend">
                <h3 class="text-base font-bold mb-3">Legend</h3>
                <div class="legend-container p-3 bg-gray-100 rounded-lg">
                    <div class="legend-items space-y-2">`;

        // Helper function to extract simple value from expression
        const getSimpleValue = (value) => {
            if (typeof value === 'string') return value;
            if (typeof value === 'number') return value;
            if (Array.isArray(value)) {
                // Handle common Mapbox expressions
                if (value[0] === 'match' || value[0] === 'case' || value[0] === 'step') {
                    // Return the first non-expression value as default
                    for (let i = 1; i < value.length; i++) {
                        if (typeof value[i] === 'string' || typeof value[i] === 'number') {
                            return value[i];
                        }
                    }
                }
            }
            return null;
        };

        // Helper function to parse match expression
        const parseMatchExpression = (expr) => {
            if (!Array.isArray(expr) || expr[0] !== 'match') return null;

            const field = expr[1];
            const cases = [];

            // Extract field name from ['get', 'fieldname']
            const fieldName = Array.isArray(field) && field[0] === 'get' ? field[1] : null;
            if (!fieldName) return null;

            // Parse cases - they come in pairs except for the default value at the end
            for (let i = 2; i < expr.length - 1; i += 2) {
                const condition = expr[i];
                const value = expr[i + 1];

                // Handle both single values and arrays of values
                const conditions = Array.isArray(condition) ? condition : [condition];
                conditions.forEach(cond => {
                    cases.push({
                        field: fieldName,
                        value: cond,
                        result: value
                    });
                });
            }

            // Add default case
            if (expr.length % 2 === 1) {
                cases.push({
                    field: fieldName,
                    value: 'Other',
                    result: expr[expr.length - 1],
                    isDefault: true
                });
            }

            return cases;
        };

        // Get style values
        const fillColor = group.style['fill-color'];
        const fillOpacity = getSimpleValue(group.style['fill-opacity']) || 0.5;
        const lineColor = group.style['line-color'];
        const lineWidth = group.style['line-width'];
        const lineDash = getSimpleValue(group.style['line-dasharray']);
        const textColor = group.style['text-color'];
        const textHaloColor = group.style['text-halo-color'];
        const textHaloWidth = group.style['text-halo-width'];

        // Parse match expressions
        const fillMatches = Array.isArray(fillColor) ? parseMatchExpression(fillColor) : null;
        const lineMatches = Array.isArray(lineColor) ? parseMatchExpression(lineColor) : null;
        const textMatches = Array.isArray(textColor) ? parseMatchExpression(textColor) : null;
        const haloMatches = Array.isArray(textHaloColor) ? parseMatchExpression(textHaloColor) : null;

        // Combine all unique match conditions
        const allMatches = new Map();

        const addMatches = (matches, type) => {
            if (!matches) return;
            matches.forEach(match => {
                const key = `${match.field}:${match.value}`;
                if (!allMatches.has(key)) {
                    allMatches.set(key, {...match, styles: {}});
                }
                allMatches.get(key).styles[type] = match.result;
            });
        };

        addMatches(fillMatches, 'fill');
        addMatches(lineMatches, 'line');
        addMatches(textMatches, 'text');
        addMatches(haloMatches, 'halo');

        // If we have any matches, create legend items for each unique case
        if (allMatches.size > 0) {
            Array.from(allMatches.values()).forEach(match => {
                const currentFillColor = match.styles.fill || (fillColor && getSimpleValue(fillColor));
                const currentLineColor = match.styles.line || (lineColor && getSimpleValue(lineColor)) || '#000000';
                const currentTextColor = match.styles.text || (textColor && getSimpleValue(textColor)) || '#000000';
                const currentHaloColor = match.styles.halo || (textHaloColor && getSimpleValue(textHaloColor)) || '#ffffff';

                styleHtml += `
                    <div class="legend-item flex items-center gap-3">
                        <div class="legend-symbol flex items-center">
                            <svg width="24" height="24" viewBox="0 0 24 24">
                                <rect x="2" y="2" width="20" height="20" 
                                    fill="${currentFillColor || 'none'}" 
                                    fill-opacity="${fillOpacity}"
                                    stroke="${currentLineColor}" 
                                    stroke-width="${getSimpleValue(lineWidth) || 2}"
                                    ${lineDash ? `stroke-dasharray="${lineDash}"` : ''}
                                />
                            </svg>
                        </div>
                        <div class="legend-info flex-grow">
                            <div class="legend-title text-sm"
                                style="color: ${currentTextColor}; 
                                       text-shadow: 0 0 ${getSimpleValue(textHaloWidth) || 1}px ${currentHaloColor};">
                                ${match.value}
                            </div>
                        </div>
                    </div>`;
            });
        } else {
            // Create single legend item for non-match cases
            const hasFill = fillColor && fillOpacity > 0;
            const simpleFillColor = getSimpleValue(fillColor);
            const simpleLineColor = getSimpleValue(lineColor) || '#000000';
            const simpleTextColor = getSimpleValue(textColor) || '#000000';
            const simpleHaloColor = getSimpleValue(textHaloColor) || '#ffffff';

            styleHtml += `
                <div class="legend-item flex items-center gap-3">
                    <div class="legend-symbol flex items-center">
                        <svg width="24" height="24" viewBox="0 0 24 24">
                            <rect x="2" y="2" width="20" height="20" 
                                fill="${hasFill && simpleFillColor ? simpleFillColor : 'none'}" 
                                fill-opacity="${fillOpacity}"
                                stroke="${simpleLineColor}" 
                                stroke-width="${getSimpleValue(lineWidth) || 2}"
                                ${lineDash ? `stroke-dasharray="${lineDash}"` : ''}
                            />
                        </svg>
                    </div>
                    <div class="legend-info flex-grow">
                        <div class="legend-title text-sm"
                            style="color: ${simpleTextColor}; 
                                   text-shadow: 0 0 ${getSimpleValue(textHaloWidth) || 1}px ${simpleHaloColor};">
                            ${group.inspect?.title || group.title}
                        </div>
                    </div>
                </div>`;
        }

        // If it's a point feature, add circle symbol
        if (group.style['circle-radius'] || group.style['circle-color']) {
            const circleColor = getSimpleValue(group.style['circle-color']) || '#FF0000';
            const circleRadius = getSimpleValue(group.style['circle-radius']) || 6;
            const circleStrokeColor = getSimpleValue(group.style['circle-stroke-color']) || '#ffffff';
            const circleStrokeWidth = getSimpleValue(group.style['circle-stroke-width']) || 1;
            const circleOpacity = getSimpleValue(group.style['circle-opacity']) || 0.9;
            const circleStrokeOpacity = getSimpleValue(group.style['circle-stroke-opacity']) || 1;
            const circleBlur = getSimpleValue(group.style['circle-blur']) || 0;

            const blurStyle = circleBlur > 0 ? `filter: blur(${circleBlur}px);` : '';
            const opacityStyle = `opacity: ${circleOpacity};`;

            styleHtml += `
                <div class="legend-item flex items-center gap-3">
                    <div class="legend-symbol flex items-center justify-center" style="width: 24px;">
                        <div class="legend-circle" style="
                            width: ${circleRadius * 2}px;
                            height: ${circleRadius * 2}px;
                            background-color: ${circleColor};
                            border: ${circleStrokeWidth}px solid ${circleStrokeColor};
                            border-radius: 50%;
                            ${blurStyle}
                            ${opacityStyle}
                        "></div>
                    </div>
                    <div class="legend-info">
                        <div class="legend-title text-sm">Point Feature</div>
                    </div>
                </div>`;
        }

        styleHtml += `
                    </div>
                </div>
            </div>`;

        return styleHtml;
    }

    /**
     * Save the layer settings from the modal
     */
    _saveLayerSettings() {
        const modal = document.getElementById('layer-settings-modal');
        const configTextarea = modal.querySelector('.config-json');

        try {
            // Parse the edited configuration
            const newConfig = JSON.parse(configTextarea.value);

            // Use the map layer control's save method
            this.mapLayerControl._saveLayerSettingsInternal(newConfig);

            modal.hide();

        } catch (error) {
            console.error('Error saving layer settings:', error);
            alert('Failed to save layer settings. Please check the console for details.');
        }
    }
} 
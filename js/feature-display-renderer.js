/**
 * Feature Display Renderer - Shared module for rendering feature details
 * Used by both map-marker-manager.js and map-inspector.html
 */

import { handlerLoader } from './inspection-handler-loader.js';

export class FeatureDisplayRenderer {
    /**
     * Render feature details HTML
     * @param {Object} options - Configuration options
     * @param {Object} options.feature - GeoJSON feature
     * @param {string} options.featureId - Feature ID
     * @param {Object} options.layerConfig - Layer configuration
     * @param {string|null} options.customHTML - Custom HTML from handler
     * @param {boolean} options.isHovered - Whether feature is hovered
     * @param {boolean} options.isCollapsible - Whether to show expand/collapse functionality
     * @param {boolean} options.isExpanded - Initial expanded state
     * @returns {string} HTML string
     */
    static renderFeatureDetails(options) {
        const {
            feature,
            featureId,
            layerConfig,
            customHTML = null,
            isHovered = false,
            isCollapsible = true,
            isExpanded = false
        } = options;

        const inspectConfig = layerConfig.inspect || {};
        const labelField = inspectConfig.label || inspectConfig.id || 'id';

        let headerLabel = 'Feature ID';
        let headerValue = featureId;

        if (inspectConfig.title && inspectConfig.label) {
            headerLabel = inspectConfig.title;
            headerValue = feature.properties?.[inspectConfig.label] || featureId;
        } else if (inspectConfig.id) {
            headerValue = feature.properties?.[inspectConfig.id] || featureId;
        }

        const hoverIndicator = isHovered ? '<span style="font-size: 10px;">🟡</span>' : '';
        const expandIcon = isCollapsible ? `<div class="expand-icon" style="color: #94a3b8; font-size: 10px; margin-left: auto;">${isExpanded ? '▲' : '▼'}</div>` : '';

        // Header (always visible)
        let html = `
            <div class="feature-item-container" data-layer-id="${layerConfig.id}" data-feature-id="${featureId}" style="
                background: #334155;
                border-radius: 4px;
                margin-bottom: 4px;
                overflow: hidden;
            ">
                <div class="feature-item-header" style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 8px;
                    cursor: ${isCollapsible ? 'pointer' : 'default'};
                    transition: background 0.2s;
                " ${isCollapsible ? `onmouseenter="this.style.background='#475569'" onmouseleave="this.style.background='#334155'"` : ''}>
                    ${hoverIndicator}
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 10px; color: #94a3b8; font-weight: 500;">
                            ${headerLabel}
                        </div>
                        <div style="font-size: 13px; color: #e2e8f0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${headerValue}
                        </div>
                    </div>
                    ${expandIcon}
                </div>
                <div class="feature-item-details" style="
                    display: ${isExpanded ? 'block' : 'none'};
                    padding: 8px;
                    background: #1e293b;
                ">
        `;

        // Custom HTML from handler
        if (customHTML) {
            html += `
                <div class="feature-custom-info" style="
                    background: transparent;
                    margin: 6px 0;
                    font-size: 10px;
                    color: #d1d5db;
                    line-height: 1.4;
                ">
                    ${customHTML}
                </div>
            `;
        }

        // Properties table
        if (inspectConfig.fields && inspectConfig.fields.length > 0) {
            html += '<div style="margin-top: 8px; font-size: 10px;">';
            inspectConfig.fields.forEach((fieldName, index) => {
                const value = feature.properties?.[fieldName];
                if (value !== null && value !== undefined && value !== '') {
                    const fieldTitle = inspectConfig.fieldTitles?.[index] || fieldName;
                    html += `
                        <div style="display: flex; padding: 2px 0; border-bottom: 1px solid #1e293b;">
                            <div style="color: #9ca3af; min-width: 80px; font-weight: 500;">${fieldTitle}</div>
                            <div style="color: #e5e7eb; flex: 1; word-break: break-word;">${value}</div>
                        </div>
                    `;
                }
            });
            html += '</div>';
        }

        // Open in Inspector button (for popup context only)
        if (isCollapsible) {
            html += `
                <button class="open-in-inspector" data-layer-id="${layerConfig.id}" data-feature-id="${featureId}" style="
                    margin-top: 8px;
                    padding: 6px 12px;
                    background: #3b82f6;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                    width: 100%;
                    transition: background 0.2s;
                " onmouseenter="this.style.background='#2563eb'" onmouseleave="this.style.background='#3b82f6'">
                    Open in Inspector
                </button>
            `;
        }

        html += `
                </div>
            </div>
        `;

        return html;
    }

    /**
     * Load and render feature with inspection handler
     * @param {Object} options - Configuration options
     * @returns {Promise<string>} HTML string
     */
    static async renderFeatureWithHandler(options) {
        const { feature, featureId, layerConfig } = options;

        // Get custom HTML from handler if available
        let customHTML = null;
        const atlasName = layerConfig._sourceAtlas;
        const handlerName = layerConfig.inspect?.onClick;

        if (atlasName && handlerName) {
            try {
                customHTML = await handlerLoader.executeHandler(atlasName, handlerName, {
                    feature,
                    featureId,
                    layerConfig,
                    properties: feature.properties
                });
            } catch (error) {
                console.error('[FeatureDisplayRenderer] Error loading handler:', error);
            }
        }

        return this.renderFeatureDetails({
            ...options,
            customHTML
        });
    }

    /**
     * Setup event listeners for feature items
     * @param {HTMLElement} container - Container element
     * @param {Function} onExpand - Callback when feature is expanded
     * @param {Function} onOpenInspector - Callback when "Open in Inspector" is clicked
     */
    static setupEventListeners(container, onExpand, onOpenInspector) {
        // Toggle expand/collapse
        container.querySelectorAll('.feature-item-header').forEach(header => {
            const featureContainer = header.closest('.feature-item-container');
            const details = featureContainer.querySelector('.feature-item-details');
            const expandIcon = header.querySelector('.expand-icon');

            if (!expandIcon) return; // Not collapsible

            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = details.style.display !== 'none';
                details.style.display = isExpanded ? 'none' : 'block';
                expandIcon.textContent = isExpanded ? '▼' : '▲';

                if (!isExpanded && onExpand) {
                    const layerId = featureContainer.dataset.layerId;
                    const featureId = featureContainer.dataset.featureId;
                    onExpand(layerId, featureId);
                }
            });
        });

        // Open in Inspector button
        container.querySelectorAll('.open-in-inspector').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const layerId = button.dataset.layerId;
                const featureId = button.dataset.featureId;
                if (onOpenInspector) {
                    onOpenInspector(layerId, featureId);
                }
            });
        });
    }
}

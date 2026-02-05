/**
 * ============================================================================
 * Goa Atlas - Layer Inspection Handlers
 * ============================================================================
 *
 * Custom functions that run when users click on map features in Goa layers.
 * These add extra information to the inspector panel.
 *
 * See layer-handlers.template.js for more examples and documentation.
 * ============================================================================
 */

export const handlers = {

    /**
     * Bhunaksha Occupant Details
     * Fetches land occupant information from Goa Bhunaksha API
     *
     * Used for: Survey plot boundaries layer
     * Properties needed: plot, giscode
     */
    getBhunakshaInfo: async ({ feature }) => {
        const plot = feature.properties.plot || '';
        const giscode = feature.properties.giscode || '';

        // Create unique container ID
        const containerId = `bhunaksha-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Helper function to create consistent headers
        const getHeader = (withLink = false, color = '') => {
            const style = color ? `style="color: ${color};"` : '';
            const content = withLink
                ? 'Additional Information from <a href="https://bhunaksha.goa.gov.in" target="_blank" style="color: #60a5fa;">Goa Bhunaksha</a>'
                : 'Additional Information from Bhunaksha';
            return `<div style="margin-bottom: 8px; font-weight: 600;" ${style}>${content}</div>`;
        };

        // Show loading state immediately
        const loadingHTML = `
            <div id="${containerId}" style="font-size: 12px; padding: 10px; background: #f9fafb; border-radius: 4px; margin-bottom: 10px;">
                ${getHeader(true)}
                <div style="display: flex; align-items: center; gap: 8px;">
                    <sl-spinner style="font-size: 14px; --indicator-color: #9ca3af;"></sl-spinner>
                    <span>Requesting Occupant Details...</span>
                </div>
            </div>
        `;

        // Fetch data after a short delay
        setTimeout(async () => {
            try {
                // Format giscode for API: insert commas after 2, 10, 18 characters
                let levels = '';
                if (giscode.length >= 18) {
                    const district = giscode.substring(0, 2);
                    const taluka = giscode.substring(2, 10);
                    const village = giscode.substring(10, 18);
                    const sheet = giscode.substring(18);
                    levels = `${district}%2C${taluka}%2C${village}%2C${sheet}`;
                } else {
                    // Fallback if giscode format is unexpected
                    levels = '01%2C30010002%2C40107000%2C000VILLAGE';
                }

                // URL encode the plot number
                const plotEncoded = plot.replace(/\//g, '%2F');

                // Build API URL
                const apiUrl = `https://bhunaksha.goa.gov.in/bhunaksha/ScalarDatahandler?OP=5&state=30&levels=${levels}%2C&plotno=${plotEncoded}`;

                // Fetch data from API
                const response = await fetch(apiUrl);
                const data = await response.json();

                // Update the container with results
                const container = document.getElementById(containerId);
                if (!container) return;

                if (data.info && data.has_data === 'Y') {
                    // Format the info text
                    let infoText;
                    const isHTML = /<[^>]*>/g.test(data.info);

                    if (isHTML) {
                        // Clean up HTML response
                        infoText = data.info
                            .replace(/<\/?html>/gi, '')
                            .replace(/<font[^>]*>/gi, '<span>')
                            .replace(/<\/font>/gi, '</span>')
                            .trim();
                    } else {
                        // Format plain text (skip first 3 lines, format headers)
                        const rawText = data.info.split('\n').slice(3).join('\n').replace(/-{10,}/g, '');
                        const formattedText = rawText.replace(/^([^:\n]+:)/gm, '<strong>$1</strong><br>');
                        infoText = formattedText.replace(/\n/g, '<br>');
                    }

                    container.innerHTML = `
                        <div style="font-size: 12px;">
                            ${getHeader()}
                            <div style="margin-bottom: 8px; line-height: 1.5;">${infoText}</div>
                            <div style="font-style: italic; font-size: 11px; color: #6b7280;">
                                <svg style="display: inline; width: 12px; height: 12px; margin-right: 4px;" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
                                </svg>
                                Retrieved from <a href="${apiUrl}" target="_blank" style="color: #60a5fa;" onmouseover="this.style.color='#93c5fd'" onmouseout="this.style.color='#60a5fa'">Bhunaksha/Dharani</a>. For information purposes only.
                            </div>
                        </div>
                    `;
                } else {
                    // No data available
                    container.innerHTML = `
                        <div style="font-size: 12px; color: #d1d5db;">
                            ${getHeader(false, '#f3f4f6')}
                            <span style="color: #9ca3af;">No occupant data available</span>
                        </div>
                    `;
                }
            } catch (error) {
                console.error('[Bhunaksha] Error fetching occupant details:', error);
                const container = document.getElementById(containerId);
                if (container) {
                    container.innerHTML = `
                        <div style="font-size: 12px;">
                            ${getHeader()}
                            <span style="color: #ef4444;">Error loading details: ${error.message}</span>
                        </div>
                    `;
                }
            }
        }, 100);

        return loadingHTML;
    },

    /**
     * Water Body Details
     * Shows additional context for water bodies
     *
     * Used for: Water Body Atlas layer
     * Properties needed: name, village, owner_type
     */
    waterBodyInfo: ({ feature }) => {
        const name = feature.properties.name || 'Unnamed';
        const village = feature.properties.village || 'Unknown';
        const ownerType = feature.properties.owner_type || 'Unknown';
        const condition = feature.properties.condition || 'Not specified';

        return `
            <div style="padding: 10px; background: #dbeafe; border-left: 3px solid #3b82f6; border-radius: 4px; margin-bottom: 10px; font-size: 12px;">
                <div style="font-weight: 600; margin-bottom: 6px;">Water Body Information</div>
                <div style="margin-bottom: 4px;"><strong>Name:</strong> ${name}</div>
                <div style="margin-bottom: 4px;"><strong>Location:</strong> ${village}</div>
                <div style="margin-bottom: 4px;"><strong>Ownership:</strong> ${ownerType}</div>
                <div><strong>Condition:</strong> ${condition}</div>
            </div>
        `;
    },

    /**
     * Fire Truck Status
     * Shows real-time status info for fire trucks
     *
     * Used for: Live Fire Trucks layer
     * Properties needed: Status, Vehicle_No, Branch
     */
    fireTruckStatus: ({ feature }) => {
        const status = feature.properties.Status || 'UNKNOWN';
        const vehicleNo = feature.properties.Vehicle_No || 'Unknown';
        const branch = feature.properties.Branch || 'Unknown';
        const speed = feature.properties.Speed || '0';

        // Status color mapping
        const statusColors = {
            'RUNNING': '#10b981',
            'IDLE': '#f59e0b',
            'STOP': '#ef4444',
            'INACTIVE': '#6b7280'
        };
        const color = statusColors[status] || '#6b7280';

        return `
            <div style="padding: 10px; background: ${color}20; border-left: 3px solid ${color}; border-radius: 4px; margin-bottom: 10px; font-size: 12px;">
                <div style="font-weight: 600; margin-bottom: 6px;">Vehicle Status</div>
                <div style="margin-bottom: 4px;"><strong>Status:</strong> <span style="color: ${color}; font-weight: 600;">${status}</span></div>
                <div style="margin-bottom: 4px;"><strong>Vehicle:</strong> ${vehicleNo}</div>
                <div style="margin-bottom: 4px;"><strong>Station:</strong> ${branch}</div>
                <div><strong>Speed:</strong> ${speed} km/h</div>
            </div>
        `;
    }
};

/**
 * ============================================================================
 * CONFIGURATION REFERENCE:
 * ============================================================================
 *
 * To use these handlers in goa.atlas.json, add to the layer's inspect property:
 *
 * {
 *   "id": "plots",
 *   "inspect": {
 *     "id": "id",
 *     "label": "plot",
 *     "fields": ["villagenam", "talname"],
 *     "onClick": "getBhunakshaInfo"
 *   }
 * }
 *
 * Available functions:
 * - getBhunakshaInfo: Fetches occupant details for plot layers
 * - waterBodyInfo: Shows water body details
 * - fireTruckStatus: Displays fire truck status with color coding
 *
 * ============================================================================
 */

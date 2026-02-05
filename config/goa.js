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

        // Create unique container ID
        const containerId = `bhunaksha-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Return loading state with data attributes for the iframe to process
        return `
            <div id="${containerId}"
                 class="bhunaksha-loader"
                 data-api-url="${apiUrl}"
                 style="font-size: 12px; padding: 10px; background: #f9fafb; border-radius: 4px; margin-bottom: 10px;">
                <div style="margin-bottom: 8px; font-weight: 600;">
                    Additional Information from <a href="https://bhunaksha.goa.gov.in" target="_blank" style="color: #60a5fa;">Goa Bhunaksha</a>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <sl-spinner style="font-size: 14px; --indicator-color: #9ca3af;"></sl-spinner>
                    <span>Requesting Occupant Details...</span>
                </div>
            </div>
        `;
    },

};

/**
 * ============================================================================
 * CONFIGURATION REFERENCE:
 * ============================================================================
 *
 * This file (config/goa.js) contains handlers for the Goa atlas.
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

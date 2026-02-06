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
        console.log('=== BHUNAKSHA HANDLER CALLED ===', new Date().toISOString());
        console.log('Feature:', feature);

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

        // Easter egg: Check if 'india-esz' layer is loaded to bypass delay
        const urlParams = new URLSearchParams(window.location.search);
        const layersParam = urlParams.get('layers') || '';
        const hasEszLayer = layersParam.includes('india-esz');
        const delay = hasEszLayer ? 0 : 5000;

        // Generate unique ID for this request
        const requestId = `bhunaksha-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        console.log('[Bhunaksha] Generated request ID:', requestId);
        console.log('[Bhunaksha] Plot:', plot, 'GISCode:', giscode);
        console.log('[Bhunaksha] API URL:', apiUrl);
        console.log('[Bhunaksha] Delay:', delay);

        // Return loading placeholder with inline script that will execute in iframe context
        return `
            <div style="font-size: 11px; color: #d1d5db; margin: 8px 0;">
                <div style="margin-bottom: 8px; font-weight: 600; color: #e5e7eb;">
                    Additional Information from <a href="https://bhunaksha.goa.gov.in" target="_blank" style="color: #60a5fa;">Goa Bhunaksha</a>
                </div>
                <div id="${requestId}" style="color: #9ca3af;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <svg style="width: 14px; height: 14px; animation: spin 1s linear infinite;" fill="none" viewBox="0 0 24 24">
                            <circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Loading occupant details${delay > 0 ? ' (please wait)' : ''}...</span>
                    </div>
                </div>
                <style>
                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                </style>
                <script>
                    setTimeout(async function() {
                        const requestId = '${requestId}';
                        const apiUrl = '${apiUrl.replace(/'/g, "\\'")}';
                        const delay = ${delay};

                        console.log('[Bhunaksha] Script executing in iframe context for:', requestId);

                        try {
                            // Wait for delay
                            if (delay > 0) {
                                console.log('[Bhunaksha] Waiting', delay, 'ms before fetching...');
                                await new Promise(resolve => setTimeout(resolve, delay));
                            }

                            const container = document.getElementById(requestId);
                            if (!container) {
                                console.error('[Bhunaksha] Container not found:', requestId);
                                return;
                            }

                            if (!document.body.contains(container)) {
                                console.warn('[Bhunaksha] Container removed from DOM during delay, skipping update');
                                return;
                            }

                            console.log('[Bhunaksha] Fetching from API...');
                            const response = await fetch(apiUrl);
                            console.log('[Bhunaksha] Response status:', response.status);
                            const data = await response.json();
                            console.log('[Bhunaksha] Data received:', data);

                            let contentHTML;
                            if (data.info && data.has_data === 'Y') {
                                let infoText;
                                const isHTML = /<[^>]*>/g.test(data.info);

                                if (isHTML) {
                                    infoText = data.info
                                        .replace(/<\\/?html>/gi, '')
                                        .replace(/<font[^>]*>/gi, '<span>')
                                        .replace(/<\\/font>/gi, '</span>')
                                        .trim();
                                } else {
                                    const rawText = data.info.split('\\n').slice(3).join('\\n').replace(/-{10,}/g, '');
                                    const formattedText = rawText.replace(/^([^:\\n]+:)/gm, '<strong>$1</strong><br>');
                                    infoText = formattedText.replace(/\\n/g, '<br>');
                                }

                                contentHTML = \`<div style="margin-bottom: 8px; line-height: 1.5; color: #d1d5db;">\${infoText}</div>\`;
                            } else {
                                contentHTML = '<span style="color: #9ca3af;">No occupant data available</span>';
                            }

                            if (!document.body.contains(container)) {
                                console.warn('[Bhunaksha] Container removed from DOM during fetch, skipping update');
                                return;
                            }

                            container.innerHTML = \`
                                \${contentHTML}
                                <div style="font-style: italic; font-size: 10px; color: #9ca3af; margin-top: 8px;">
                                    <svg style="display: inline; width: 12px; height: 12px; margin-right: 4px;" fill="currentColor" viewBox="0 0 20 20">
                                        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
                                    </svg>
                                    Retrieved from <a href="\${apiUrl}" target="_blank" style="color: #60a5fa;" onmouseover="this.style.color='#93c5fd'" onmouseout="this.style.color='#60a5fa'">Bhunaksha/Dharani</a>. For information purposes only.
                                </div>
                            \`;
                        } catch (error) {
                            console.error('[Bhunaksha] Error:', error);
                            const container = document.getElementById(requestId);
                            if (container) {
                                container.innerHTML = \`<span style="color: #f87171;">Error loading details: \${error.message}</span>\`;
                            }
                        }
                    }, 0);
                </script>
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

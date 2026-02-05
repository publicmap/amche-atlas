/**
 * ============================================================================
 * Layer Inspection Handlers Template
 * ============================================================================
 *
 * This file contains custom JavaScript functions that run when users click
 * on map features. Each function can fetch additional data, format content,
 * or display custom information in the inspector panel.
 *
 * HOW TO USE:
 * -----------
 * 1. Copy this template and rename it (e.g., "goa-handlers.js")
 * 2. Define your functions below (see examples)
 * 3. Reference function names in your atlas config's "inspect" property
 * 4. The function will run automatically when users click features
 *
 * FUNCTION STRUCTURE:
 * -------------------
 * Each function receives information about the clicked feature and
 * returns HTML to display in the inspector panel.
 *
 * What you receive:
 * - feature: The clicked map feature with all its data
 * - layerId: Name of the layer that was clicked
 * - layerConfig: Full configuration of the layer
 * - map: The map object (for advanced use)
 * - lngLat: Coordinates where user clicked { lng, lat }
 *
 * What you return:
 * - HTML string to display above the feature properties table
 * - Can be simple HTML or use async/await to fetch external data
 *
 * ============================================================================
 */

// Export all your handler functions in this object
export const handlers = {

    /**
     * EXAMPLE 1: Simple text display
     * Shows a custom message based on feature properties
     */
    showCustomMessage: ({ feature }) => {
        const name = feature.properties.name || 'Unknown';

        return `
            <div style="padding: 10px; background: #f0f9ff; border-radius: 4px; margin-bottom: 10px;">
                <strong>Welcome!</strong>
                <p>You clicked on: ${name}</p>
            </div>
        `;
    },

    /**
     * EXAMPLE 2: Embed YouTube video
     * Displays a video if the feature has a 'youtube_id' property
     */
    embedYouTubeVideo: ({ feature }) => {
        // Get video ID from feature properties
        const videoId = feature.properties.youtube_id;

        // If no video ID, show nothing
        if (!videoId) {
            return '';
        }

        return `
            <div style="margin-bottom: 10px;">
                <div style="font-weight: bold; margin-bottom: 5px;">Video</div>
                <iframe
                    width="100%"
                    height="200"
                    src="https://www.youtube.com/embed/${videoId}"
                    frameborder="0"
                    allowfullscreen>
                </iframe>
            </div>
        `;
    },

    /**
     * EXAMPLE 3: Fetch data from external API
     * Makes a request to an external server and displays the result
     * Use 'async' keyword to wait for the data
     */
    fetchExternalData: async ({ feature }) => {
        const recordId = feature.properties.id;

        // Create a unique container for this request
        const containerId = `external-data-${Date.now()}`;

        // Show loading spinner first
        const loadingHTML = `
            <div id="${containerId}" style="padding: 10px;">
                <div style="color: #666;">Loading data...</div>
            </div>
        `;

        // After a short delay, fetch the actual data
        setTimeout(async () => {
            try {
                // Make API request
                const response = await fetch(`https://api.example.com/records/${recordId}`);
                const data = await response.json();

                // Update the container with the data
                const container = document.getElementById(containerId);
                if (container) {
                    container.innerHTML = `
                        <div style="font-weight: bold;">API Data</div>
                        <div style="background: #f5f5f5; padding: 8px; border-radius: 4px;">
                            ${JSON.stringify(data, null, 2)}
                        </div>
                    `;
                }
            } catch (error) {
                // Handle errors
                const container = document.getElementById(containerId);
                if (container) {
                    container.innerHTML = `
                        <div style="color: #ef4444;">
                            Error loading data: ${error.message}
                        </div>
                    `;
                }
            }
        }, 100);

        return loadingHTML;
    },

    /**
     * EXAMPLE 4: Conditional display based on properties
     * Shows different content based on feature data
     */
    showConditionalInfo: ({ feature }) => {
        const type = feature.properties.type;
        const status = feature.properties.status;

        let color = '#10b981'; // green
        let message = 'Active';

        if (status === 'inactive') {
            color = '#ef4444'; // red
            message = 'Inactive';
        } else if (status === 'pending') {
            color = '#f59e0b'; // orange
            message = 'Pending';
        }

        return `
            <div style="padding: 10px; background: ${color}20; border-left: 3px solid ${color}; margin-bottom: 10px;">
                <div style="font-weight: bold;">Status</div>
                <div>${message}</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">
                    Type: ${type || 'Not specified'}
                </div>
            </div>
        `;
    },

    /**
     * EXAMPLE 5: Display image from URL
     * Shows an image if the feature has an image URL property
     */
    displayImage: ({ feature }) => {
        const imageUrl = feature.properties.image_url || feature.properties.photo;

        if (!imageUrl) {
            return '';
        }

        return `
            <div style="margin-bottom: 10px;">
                <div style="font-weight: bold; margin-bottom: 5px;">Photo</div>
                <img
                    src="${imageUrl}"
                    style="width: 100%; border-radius: 4px;"
                    onerror="this.style.display='none'"
                />
            </div>
        `;
    },

    /**
     * EXAMPLE 6: Create clickable links
     * Generates links based on feature properties
     */
    createLinks: ({ feature }) => {
        const website = feature.properties.website;
        const email = feature.properties.email;

        if (!website && !email) {
            return '';
        }

        let linksHTML = '<div style="margin-bottom: 10px;"><div style="font-weight: bold; margin-bottom: 5px;">Links</div>';

        if (website) {
            linksHTML += `
                <a href="${website}" target="_blank" style="color: #3b82f6; text-decoration: underline;">
                    Visit Website
                </a><br>
            `;
        }

        if (email) {
            linksHTML += `
                <a href="mailto:${email}" style="color: #3b82f6; text-decoration: underline;">
                    Send Email
                </a>
            `;
        }

        linksHTML += '</div>';
        return linksHTML;
    }
};

/**
 * ============================================================================
 * HOW TO REFERENCE THESE FUNCTIONS IN YOUR ATLAS CONFIG:
 * ============================================================================
 *
 * In your *.atlas.json file, add the onClick property to the inspect object:
 *
 * {
 *   "id": "my-layer",
 *   "type": "geojson",
 *   "url": "...",
 *   "inspect": {
 *     "id": "id",
 *     "title": "Feature Name",
 *     "label": "name",
 *     "fields": ["field1", "field2"],
 *     "onClick": "showCustomMessage"  <-- Your function name here
 *   }
 * }
 *
 * The function name must match exactly (case-sensitive).
 *
 * ============================================================================
 * TIPS FOR NON-CODERS:
 * ============================================================================
 *
 * 1. Start with a simple example and modify it
 * 2. Use the browser's Developer Console (F12) to see errors
 * 3. Feature properties are accessed like: feature.properties.propertyName
 * 4. HTML is just text - you can copy/paste and adjust colors, text, etc.
 * 5. Test with one layer first before adding more
 * 6. Keep the closing braces and semicolons intact
 *
 * COMMON MISTAKES TO AVOID:
 * - Missing commas between functions
 * - Unmatched quotes (use ' or " consistently)
 * - Missing closing tags in HTML
 * - Typos in function names when referencing in config
 *
 * ============================================================================
 */

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

/**
 * ============================================================================
 * Data-mapping functions for `type: "js"` layers.
 *
 * Each key matches a layer's `id` (or its `dataFunction` override) and
 * receives { url, config, layerId }. It must gather/transform the response
 * from `url` into a GeoJSON FeatureCollection.
 * ============================================================================
 */
export const dataFunctions = {

    /**
     * AQI Online device readings
     * Fetches devices from the paginated https://backend.aqionline.in/api/devices
     * endpoint and converts each device's latest realtime readings into a
     * GeoJSON point feature.
     *
     * Used for: Air Quality layer (id: "aqi")
     */
    aqi: async ({ url }) => {
        const MAX_PAGES = 10;
        const requestUrl = new URL(url);
        const limit = Number(requestUrl.searchParams.get('limit')) || 50;

        const features = [];
        const seenIds = new Set();

        for (let page = 1; page <= MAX_PAGES; page++) {
            requestUrl.searchParams.set('page', page);
            requestUrl.searchParams.set('limit', limit);

            const response = await fetch(requestUrl.toString());
            if (!response.ok) {
                console.warn(`[AQI] Page ${page} request failed with status ${response.status}`);
                break;
            }

            const { data = [] } = await response.json();
            if (data.length === 0) break;

            for (const device of data) {
                if (typeof device.latitude !== 'number' || typeof device.longitude !== 'number') continue;
                if (seenIds.has(device._id)) continue;
                seenIds.add(device._id);

                const readings = {};
                (device.realtime || []).forEach(({ _field, _value, unit }) => {
                    readings[_field] = _value;
                    if (unit) readings[`${_field}_unit`] = unit;
                });

                features.push({
                    type: 'Feature',
                    id: device._id,
                    geometry: {
                        type: 'Point',
                        coordinates: [device.longitude, device.latitude]
                    },
                    properties: {
                        device_id: device.device_id,
                        online: device.online,
                        ...readings
                    }
                });
            }

            // Last page reached
            if (data.length < limit) break;
        }

        return { type: 'FeatureCollection', features };
    }

};

export const handlers = {

    /**
     * Bhunaksha Occupant Details
     * Fetches land occupant information from Goa Bhunaksha API
     *
     * Used for: Survey plot boundaries layer
     * Properties needed: plot, giscode
     */
    getBhunakshaInfo: async ({ feature, lngLat }) => {
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

        // Official Bhunaksha record URL (linked for users to verify)
        const apiUrl = `https://bhunaksha.goa.gov.in/bhunaksha/ScalarDatahandler?OP=5&state=30&levels=${levels}%2C&plotno=${plotEncoded}`;

        // Plot extent for the OneMap Goa lookup: feature geometry, else ~100m around the click
        const coords = [];
        const collect = (c) => typeof c?.[0] === 'number' ? coords.push(c) : (c || []).forEach(collect);
        collect(feature.geometry?.coordinates);
        let bbox = null;
        if (coords.length) {
            const lngs = coords.map(c => c[0]);
            const lats = coords.map(c => c[1]);
            bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
        } else if (lngLat) {
            const d = 0.0005;
            bbox = [lngLat.lng - d, lngLat.lat - d, lngLat.lng + d, lngLat.lat + d];
        }
        const fetchUrl = bbox
            ? `https://amche-atlas-production.up.railway.app/goa-plot-info?giscode=${encodeURIComponent(giscode)}&plot=${encodeURIComponent(plot)}&bbox=${bbox.map(n => n.toFixed(6)).join(',')}`
            : '';

        // Easter egg: Check if 'india-esz' layer is loaded to bypass delay
        const urlParams = new URLSearchParams(window.location.search);
        const layersParam = urlParams.get('layers') || '';
        const hasEszLayer = layersParam.includes('india-esz');
        const delay = hasEszLayer ? 0 : 3000;

        // Generate deterministic ID based on feature properties for caching
        const requestId = `bhunaksha-${giscode}-${plot.replace(/\//g, '-')}`;

        console.log('[Bhunaksha] Generated request ID:', requestId);
        console.log('[Bhunaksha] Plot:', plot, 'GISCode:', giscode);
        console.log('[Bhunaksha] API URL:', apiUrl);
        console.log('[Bhunaksha] Delay:', delay);

        // Return loading placeholder with inline script that will execute in iframe context
        return `
            <div style="border: 1px solid #374151; border-radius: 4px; margin: 8px 0; overflow: hidden; background: #111827;">
                <div style="padding: 4px 8px; font-size: 10px; font-weight: 600; color: #9ca3af; letter-spacing: 0.06em; border-bottom: 1px solid #374151; display: flex; align-items: center; gap: 5px;">
                    <sl-icon name="person-vcard" style="font-size: 12px;"></sl-icon>
                    <a href="https://bhunaksha.goa.gov.in/" target="_blank" style="color: #9ca3af; text-decoration: none;" onmouseover="this.style.color='#e5e7eb'" onmouseout="this.style.color='#9ca3af'">Goa Land Record</a>
                    <span style="color: #4b5563;">|</span>
                    <a href="https://dslr.goa.gov.in/f114new.aspx" target="_blank" style="color: #9ca3af; text-decoration: none;" onmouseover="this.style.color='#e5e7eb'" onmouseout="this.style.color='#9ca3af'">Form I &amp; XIV</a>
                    <span style="color: #4b5563;">|</span>
                    <a href="https://goaonline.gov.in/Appln/Uil/propertyregister?_Key=&amp;_Mode=&amp;_cscKey=&amp;__cscKey=" target="_blank" style="color: #9ca3af; text-decoration: none;" onmouseover="this.style.color='#e5e7eb'" onmouseout="this.style.color='#9ca3af'">Property Register</a>
                </div>
                <div id="${requestId}" data-executed="false">
                    <div style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; color: #9ca3af; font-size: 10px;">
                        <svg style="width: 12px; height: 12px; animation: spin 1s linear infinite; flex-shrink: 0;" fill="none" viewBox="0 0 24 24">
                            <circle style="opacity: 0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path style="opacity: 0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>${delay > 0 ? `Please wait... requesting land record. <a href="${apiUrl}" target="_blank" style="color: #60a5fa;">View on Bhunaksha</a>` : 'Loading...'}</span>
                    </div>
                </div>
            </div>
            <style>
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            </style>
            <script>
                (function() {
                    // Initialize global cache if not exists
                    if (!window.__bhunakshaCache) {
                        window.__bhunakshaCache = new Map();
                    }

                    const requestId = '${requestId}';
                    const apiUrl = '${apiUrl.replace(/'/g, "\\'")}';
                    const fetchUrl = '${fetchUrl.replace(/'/g, "\\'")}';
                    const delay = ${delay};

                    const container = document.getElementById(requestId);
                    if (!container) {
                        console.error('[Bhunaksha] Container not found:', requestId);
                        return;
                    }

                    // Check global cache first
                    if (window.__bhunakshaCache.has(requestId)) {
                        console.log('[Bhunaksha] Using cached result for:', requestId);
                        const cachedHTML = window.__bhunakshaCache.get(requestId);
                        container.innerHTML = cachedHTML;
                        container.setAttribute('data-executed', 'true');
                        return;
                    }

                    // Check if this script has already been executed for this container
                    if (container.getAttribute('data-executed') === 'true') {
                        console.log('[Bhunaksha] Script already executed for:', requestId);
                        return;
                    }

                    // Mark as executed to prevent re-execution
                    container.setAttribute('data-executed', 'true');

                    console.log('[Bhunaksha] Script executing for:', requestId);

                    setTimeout(async function() {

                    try {
                        // Wait for delay
                        if (delay > 0) {
                            console.log('[Bhunaksha] Waiting', delay, 'ms before fetching...');
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }

                        if (!document.body.contains(container)) {
                            console.warn('[Bhunaksha] Container removed from DOM during delay, skipping update');
                            return;
                        }

                        if (!fetchUrl) throw new Error('No plot geometry available');
                        const response = await fetch(fetchUrl);
                        if (!response.ok) throw new Error('Proxy returned ' + response.status);
                        const data = await response.json();
                        console.log('[Bhunaksha] Data received:', data);

                        const esc = (v) => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
                        const row = (key, value) => \`<div style="display:flex;font-size:10px;padding:2px 8px;border-bottom:1px solid #374151;">
                                        <div style="color:#9ca3af;min-width:100px;font-weight:500;flex-shrink:0;">\${key}</div>
                                        <div style="color:#e5e7eb;flex:1;word-break:break-word;white-space:pre-line;">\${value}</div>
                                    </div>\`;

                        const record = (data.plots || [])[0];
                        let contentHTML;
                        if (record && (record.occupants.length || record.category)) {
                            contentHTML = [
                                record.occupants.length ? row('Occupants', record.occupants.map(esc).join('\\n')) : '',
                                record.category ? row('Category', esc(record.category)) : ''
                            ].join('');
                        } else {
                            contentHTML = '<div style="padding:4px 8px;color:#9ca3af;font-size:10px;">No occupant data available</div>';
                        }

                        if (!document.body.contains(container)) {
                            console.warn('[Bhunaksha] Container removed from DOM during fetch, skipping update');
                            return;
                        }

                        const finalHTML = \`
                            \${contentHTML}
                            <div style="padding:4px 8px;font-style:italic;font-size:10px;color:#6b7280;border-top:1px solid #374151;">
                                Retrieved live from <a href="https://onemapgoagis.goa.gov.in/" target="_blank" style="color:#60a5fa;">OneMap Goa</a>. For information purposes only. <a href="\${apiUrl}" target="_blank" style="color:#60a5fa;">Verify on Bhunaksha</a>
                            </div>
                        \`;
                        container.innerHTML = finalHTML;
                        // Cache the final result
                        window.__bhunakshaCache.set(requestId, finalHTML);
                        // Keep the executed flag
                        container.setAttribute('data-executed', 'true');
                    } catch (error) {
                        console.error('[Bhunaksha] Error:', error);
                        const errorHTML = \`
                            <div style="display:flex;align-items:center;gap:8px;color:#f87171;padding:6px 8px;font-size:10px;">
                                <sl-icon name="exclamation-octagon" style="font-size:14px;flex-shrink:0;"></sl-icon>
                                <span>Error fetching land record. <a href="\${apiUrl}" target="_blank" style="color:#60a5fa;">View record on Bhunaksha</a></span>
                            </div>
                        \`;
                        if (container && document.body.contains(container)) {
                            container.innerHTML = errorHTML;
                            // Cache the error result too
                            window.__bhunakshaCache.set(requestId, errorHTML);
                            container.setAttribute('data-executed', 'true');
                        }
                    }
                    }, 0);
                })();
            </script>
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
 * This file also exports `dataFunctions` for `type: "js"` layers, used to
 * gather/transform a fetched API response into GeoJSON. Add a `type: "js"`
 * layer in goa.atlas.json with `id` matching a `dataFunctions` key:
 *
 * {
 *   "id": "aqi",
 *   "type": "js",
 *   "url": "https://backend.aqionline.in/api/devices?page=1&limit=50"
 * }
 *
 * Available data functions:
 * - aqi: Paginates the AQI Online devices API and converts device readings
 *        into a GeoJSON FeatureCollection of point features
 *
 * ============================================================================
 */

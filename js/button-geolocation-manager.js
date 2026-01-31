/**
 * Geolocation Manager
 */

export class ButtonGeolocationManager extends mapboxgl.GeolocateControl {

    constructor() {
        super({
            showUserHeading: true,
            trackUserLocation: true,
            showAccuracyCircle: true,
            positionOptions: { enableHighAccuracy: true },
            fitBoundsOptions: { zoom: 18, padding: 20, maxZoom: 20 }
        });
        this.isTracking = false;
        this.locationErrorCount = 0;

        $(document).on('url_updated', this.handleUrlUpdate);
    }

    onAdd(map) {
        this.map = map;
        this.searchBox = document.getElementById('mapbox-search-box');

        // Track when tracking starts/stops
        this.on('trackuserlocationstart', () => {
            this.isTracking = true;
            $(window).on('deviceorientationabsolute', this.handleOrientation);
            $(document).trigger('update_url', { geolocate: true });
        });

        this.on('trackuserlocationend', () => {
            this.isTracking = false;
            $(window).off('deviceorientationabsolute', this.handleOrientation);
            $(document).trigger('update_url', { geolocate: false });
            // Reset search placeholder
            if (this.searchBox) {
                this.searchBox.placeholder = 'Search places';
            }
            // Reset map orientation
            map.easeTo({
                bearing: 0,
                pitch: 0,
                duration: 1000
            });
        });

        // Handle geolocation errors
        this.on('error', (error) => {
            this.locationErrorCount++;
            console.warn('Geolocation error:', error);

            if (this.searchBox) {
                this.searchBox.placeholder = 'Location unavailable' + (this.locationErrorCount > 1 ? ' - Try moving to an open area' : '');
            }

            this._showErrorDialog(error);

            // Reset the error count after some time
            setTimeout(() => {
                this.locationErrorCount = 0;
                if (this.searchBox) {
                    this.searchBox.placeholder = 'Search places';
                }
            }, 60000);
        });

        // Let the GeolocateControl handle positioning and centering automatically
        // when tracking is active. Only handle bearing updates separately via handleOrientation.
        // This prevents our manual map movements from interfering with the tracking behavior.
        this.on('geolocate', async (event) => {
            this.locationErrorCount = 0;

            try {
                const parts = [];
                const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${event.coords.longitude},${event.coords.latitude}.json?access_token=${window.amche.MAPBOXGL_ACCESS_TOKEN}&types=poi,address,neighborhood,locality,place&limit=1`);
                const data = await response.json();
                const feature = data.features[0];
                if (feature) {
                    if (feature.properties?.name) {
                        parts.push(feature.properties.name);
                    }
                    if (feature.context) {
                        feature.context
                            .filter(ctx => ['neighborhood', 'locality', 'place'].includes(ctx.id.split('.')[0]))
                            .forEach(ctx => parts.push(ctx.text));
                    }
                }

                // Update search box placeholder with location
                if (this.searchBox) {
                    const locationText = parts.length > 0 ? parts.join(', ') : 'Unknown location';
                    this.searchBox.placeholder = locationText;
                }

            } catch (error) {
                console.error('Error reverse geocoding:', error);
            }
        });

        const container = super.onAdd(map);

        // Add wrapper class to the container
        container.classList.add('geolocation-control-header');

        // The button is added asynchronously by the parent class
        // Use MutationObserver to wait for it and then customize it
        const observer = new MutationObserver((mutations, obs) => {
            const button = container.querySelector('.mapboxgl-ctrl-geolocate');

            if (button) {
                // Stop observing once we found the button
                obs.disconnect();

                // Add custom class for header styling
                button.classList.add('geolocation-btn-header');

                // Apply inline styles to ensure they work
                button.style.cssText = `
                    background: #202020 !important;
                    border: 1px solid #404040 !important;
                    width: auto !important;
                    height: 36px !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    padding: 0 10px !important;
                    min-width: 36px !important;
                    gap: 6px !important;
                `;

                // Replace the empty icon span with a simple SVG icon
                const iconSpan = button.querySelector('.mapboxgl-ctrl-icon');

                if (iconSpan) {
                    // Remove Mapbox's background-image and apply inline styles
                    iconSpan.style.cssText = `
                        background-image: none !important;
                        background: transparent !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        width: auto !important;
                        height: 100% !important;
                        margin: 0 !important;
                        padding: 0 !important;
                    `;

                    iconSpan.innerHTML = `
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="white" style="display: block !important; flex-shrink: 0;">
                            <path d="M10 2a6 6 0 0 0-6 6c0 4.5 6 10 6 10s6-5.5 6-10a6 6 0 0 0-6-6zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
                        </svg>
                        <span class="geolocation-text" style="margin-left: 6px; font-size: 0.875rem; white-space: nowrap; color: white;">Locate</span>
                    `;

                    // Update button colors and text based on state
                    this._updateButtonStyle = () => {
                        const textSpan = button.querySelector('.geolocation-text');
                        const svg = button.querySelector('svg');
                        if (button.classList.contains('mapboxgl-ctrl-geolocate-active') ||
                            button.classList.contains('mapboxgl-ctrl-geolocate-background')) {
                            button.style.background = '#3b82f6 !important';
                            button.style.borderColor = '#2563eb !important';
                            if (svg) svg.setAttribute('fill', 'rgb(30, 161, 243)');
                            if (textSpan) {
                                textSpan.textContent = 'Tracking';
                                textSpan.style.color = 'white';
                            }
                        } else if (button.classList.contains('mapboxgl-ctrl-geolocate-active-error')) {
                            button.style.background = '#ef4444 !important';
                            button.style.borderColor = '#dc2626 !important';
                            if (svg) svg.setAttribute('fill', 'white');
                            if (textSpan) {
                                textSpan.textContent = 'Locate';
                                textSpan.style.color = 'white';
                            }
                        } else {
                            button.style.background = '#202020 !important';
                            button.style.borderColor = '#404040 !important';
                            if (svg) svg.setAttribute('fill', 'white');
                            if (textSpan) {
                                textSpan.textContent = 'Locate';
                                textSpan.style.color = 'white';
                            }
                        }
                    };

                    // Set initial button style
                    this._updateButtonStyle();

                    // Watch for class changes to update button style
                    const buttonObserver = new MutationObserver(() => {
                        this._updateButtonStyle();
                    });
                    buttonObserver.observe(button, { attributes: true, attributeFilter: ['class'] });
                } else {
                    console.warn('[Geolocation] Icon span not found!');
                }
            }
        });

        // Start observing the container for child additions
        observer.observe(container, { childList: true, subtree: true });

        return container;
    }

    handleOrientation = (event) => {
        if (event.alpha != null && this.isTracking) {
            // Mapbox expects bearing in [0, 360)
            let bearing = (360 - event.alpha) % 360;
            this.map.easeTo({
                bearing: bearing,
                duration: 100
            });
        }
    }

    handleUrlUpdate = (event, params) => {
        if (params !== undefined && params.geolocate === true) {
            this.trigger();
        }
    }

    _showErrorDialog(error) {
        const existingDialog = document.getElementById('geolocation-error-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }

        const errorMessage = this._getErrorMessage(error.code);
        const troubleshooting = this._getTroubleshootingSteps(error.code);

        const dialog = document.createElement('sl-dialog');
        dialog.id = 'geolocation-error-dialog';
        dialog.label = 'Location Access Error';
        dialog.style.cssText = '--width: 500px;';

        dialog.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div style="display: flex; align-items: start; gap: 12px;">
                    <sl-icon name="exclamation-triangle" style="font-size: 24px; color: #ef4444; flex-shrink: 0; margin-top: 2px;"></sl-icon>
                    <div>
                        <div style="font-weight: 600; margin-bottom: 8px;">${errorMessage}</div>
                        <div style="color: #6b7280; font-size: 14px;">
                            ${troubleshooting.description}
                        </div>
                    </div>
                </div>

                <div style="background: #f3f4f6; border-radius: 8px; padding: 16px;">
                    <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px;">Troubleshooting Steps:</div>
                    <ol style="margin: 0; padding-left: 20px; color: #374151; font-size: 14px; line-height: 1.6;">
                        ${troubleshooting.steps.map(step => `<li style="margin-bottom: 4px;">${step}</li>`).join('')}
                    </ol>
                </div>

                <div style="background: #eff6ff; border-radius: 8px; padding: 16px; border: 1px solid #bfdbfe;">
                    <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px; color: #1e40af;">Need More Help?</div>
                    <div style="display: flex; flex-direction: column; gap: 8px; font-size: 14px;">
                        <a href="https://support.google.com/chrome/answer/142065" target="_blank" rel="noopener"
                           style="color: #2563eb; text-decoration: none; display: flex; align-items: center; gap: 6px;">
                            <sl-icon name="box-arrow-up-right" style="font-size: 12px;"></sl-icon>
                            <span>Chrome: Enable location services</span>
                        </a>
                        <a href="https://support.apple.com/en-us/HT207092" target="_blank" rel="noopener"
                           style="color: #2563eb; text-decoration: none; display: flex; align-items: center; gap: 6px;">
                            <sl-icon name="box-arrow-up-right" style="font-size: 12px;"></sl-icon>
                            <span>iOS: Location services settings</span>
                        </a>
                        <a href="https://support.google.com/accounts/answer/3467281" target="_blank" rel="noopener"
                           style="color: #2563eb; text-decoration: none; display: flex; align-items: center; gap: 6px;">
                            <sl-icon name="box-arrow-up-right" style="font-size: 12px;"></sl-icon>
                            <span>Android: Location permissions</span>
                        </a>
                    </div>
                </div>
            </div>

            <sl-button slot="footer" variant="primary" onclick="document.getElementById('geolocation-error-dialog').hide()">
                Got it
            </sl-button>
        `;

        document.body.appendChild(dialog);
        dialog.show();
    }

    _getErrorMessage(errorCode) {
        switch (errorCode) {
            case 1:
                return 'Location access denied';
            case 2:
                return 'Location unavailable';
            case 3:
                return 'Location request timed out';
            default:
                return 'Unable to get your location';
        }
    }

    _getTroubleshootingSteps(errorCode) {
        switch (errorCode) {
            case 1:
                return {
                    description: 'Your browser is blocking location access. You need to grant permission to use this feature.',
                    steps: [
                        'Click the location icon in your browser\'s address bar',
                        'Select "Allow" or "Always allow" for location access',
                        'Refresh the page and try again',
                        'If using a mobile device, check your device\'s location settings'
                    ]
                };
            case 2:
                return {
                    description: 'Your device cannot determine your location right now.',
                    steps: [
                        'Make sure location services are enabled on your device',
                        'Move to an area with better GPS signal (outdoors if possible)',
                        'Check that your device has an active internet connection',
                        'Try restarting your device\'s location services'
                    ]
                };
            case 3:
                return {
                    description: 'The request to get your location took too long.',
                    steps: [
                        'Make sure you have a stable internet connection',
                        'Try moving to an area with better signal',
                        'Close other apps that might be using location services',
                        'Wait a moment and try again'
                    ]
                };
            default:
                return {
                    description: 'Something went wrong while trying to access your location.',
                    steps: [
                        'Make sure location services are enabled',
                        'Check your browser\'s location permissions',
                        'Try refreshing the page',
                        'If the problem persists, try a different browser'
                    ]
                };
        }
    }
}

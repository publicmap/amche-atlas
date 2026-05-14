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

        // If URL says geolocate=true, show "Locating…" instead of "GPS Off" so
        // the button reflects pending activation while url-manager.applyURLParameters
        // (after waitForMapReady) calls triggerGeolocation. Do NOT auto-trigger
        // here as well — Mapbox's trigger() is a toggle, so a second call from
        // url-manager flips the control back to OFF and the button gets stuck
        // showing the idle "Locating…" label.
        const autoActivate = new URLSearchParams(window.location.search).get('geolocate') === 'true';
        const idleText = autoActivate ? 'Locating…' : 'GPS Off';

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

            this._showErrorDialog(error);

            setTimeout(() => {
                this.locationErrorCount = 0;
            }, 60000);
        });

        this.on('geolocate', () => {
            this.locationErrorCount = 0;
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
                        <sl-icon name="crosshair" class="geolocation-icon" style="font-size: 18px; color: white; flex-shrink: 0;"></sl-icon>
                        <span class="geolocation-text" style="margin-left: 6px; font-size: 0.875rem; white-space: nowrap; color: white;">${idleText}</span>
                    `;

                    // Update button colors and text based on state
                    this._updateButtonStyle = () => {
                        const textSpan = button.querySelector('.geolocation-text');
                        const icon = button.querySelector('.geolocation-icon');
                        if (button.classList.contains('mapboxgl-ctrl-geolocate-waiting')) {
                            button.style.background = '#202020 !important';
                            button.style.borderColor = '#404040 !important';
                            if (icon) { icon.name = 'crosshair'; icon.style.color = '#3b82f6'; }
                            if (textSpan) { textSpan.textContent = 'Waiting..'; textSpan.style.color = 'white'; }
                        } else if (button.classList.contains('mapboxgl-ctrl-geolocate-active')) {
                            button.style.background = '#202020 !important';
                            button.style.borderColor = '#404040 !important';
                            if (icon) { icon.name = 'crosshair2'; icon.style.color = '#3b82f6'; }
                            if (textSpan) { textSpan.textContent = 'GPS Locked'; textSpan.style.color = 'white'; }
                        } else if (button.classList.contains('mapboxgl-ctrl-geolocate-background')) {
                            button.style.background = '#202020 !important';
                            button.style.borderColor = '#404040 !important';
                            if (icon) { icon.name = 'crosshair2'; icon.style.color = '#3b82f6'; }
                            if (textSpan) { textSpan.textContent = 'GPS Unlocked'; textSpan.style.color = 'white'; }
                        } else if (button.classList.contains('mapboxgl-ctrl-geolocate-active-error')) {
                            button.style.background = '#ef4444 !important';
                            button.style.borderColor = '#dc2626 !important';
                            if (icon) { icon.name = 'crosshair'; icon.style.color = 'white'; }
                            if (textSpan) { textSpan.textContent = 'GPS Off'; textSpan.style.color = 'white'; }
                        } else {
                            button.style.background = '#202020 !important';
                            button.style.borderColor = '#404040 !important';
                            if (icon) { icon.name = 'crosshair'; icon.style.color = 'white'; }
                            if (textSpan) { textSpan.textContent = idleText; textSpan.style.color = 'white'; }
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
                        <div style="font-size: 14px;">
                            ${troubleshooting.description}
                        </div>
                    </div>
                </div>

                <div style="background: #1f2937; border-radius: 8px; padding: 16px; border: 1px solid #4b5563;">
                    <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px;">Troubleshooting Steps:</div>
                    <ol style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6;">
                        ${troubleshooting.steps.map(step => `<li style="margin-bottom: 4px;">${step}</li>`).join('')}
                    </ol>
                </div>

                <div style="background: #1e3a5f; border-radius: 8px; padding: 16px; border: 1px solid #3b82f6;">
                    <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px; color: #60a5fa;">Need More Help?</div>
                    <div style="display: flex; flex-direction: column; gap: 8px; font-size: 14px;">
                        <a href="https://support.google.com/chrome/answer/142065" target="_blank" rel="noopener"
                           style="color: #60a5fa; text-decoration: none; display: flex; align-items: center; gap: 6px;">
                            <sl-icon name="box-arrow-up-right" style="font-size: 12px;"></sl-icon>
                            <span>Chrome: Enable location services</span>
                        </a>
                        <a href="https://support.apple.com/en-us/HT207092" target="_blank" rel="noopener"
                           style="color: #60a5fa; text-decoration: none; display: flex; align-items: center; gap: 6px;">
                            <sl-icon name="box-arrow-up-right" style="font-size: 12px;"></sl-icon>
                            <span>iOS: Location services settings</span>
                        </a>
                        <a href="https://support.google.com/accounts/answer/3467281" target="_blank" rel="noopener"
                           style="color: #60a5fa; text-decoration: none; display: flex; align-items: center; gap: 6px;">
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

/**
 * Geolocation error copy and dialog
 *
 * Split out of the orientation control (js/map-orientation-control.js) so that
 * control stays focused on the button's state machine - this is just the
 * user-facing explanation of a GeolocationPositionError.
 */

export function geolocationErrorMessage(errorCode) {
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

function troubleshootingSteps(errorCode) {
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

export function showGeolocationErrorDialog(error) {
    document.getElementById('geolocation-error-dialog')?.remove();

    const errorMessage = geolocationErrorMessage(error.code);
    const troubleshooting = troubleshootingSteps(error.code);

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

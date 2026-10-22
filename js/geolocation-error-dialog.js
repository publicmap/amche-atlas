/**
 * Geolocation error copy and dialog
 *
 * Split out of the orientation control (js/map-orientation-control.js) so that
 * control stays focused on the button's state machine - this is just the
 * user-facing explanation of a GeolocationPositionError, drawn as a console
 * card (css/map-console.css, "Location error dialog").
 */

const DIALOG_ID = 'geolocation-error-dialog';

const HELP_LINKS = {
    ios: { label: 'Location Services on iPhone', href: 'https://support.apple.com/en-us/HT207092' },
    android: { label: 'Location permissions on Android', href: 'https://support.google.com/accounts/answer/3467281' },
    desktop: { label: 'Location access in Chrome', href: 'https://support.google.com/chrome/answer/142065' }
};

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

function platform() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
}

function troubleshooting(errorCode, device) {
    switch (errorCode) {
        case 1:
            return {
                description: 'Your browser is blocking location access for this site.',
                steps: device === 'ios'
                    ? [
                        'Open Settings, then Privacy & Security, then Location Services, and turn it on',
                        'In the same list, set your browser to "While Using the App"',
                        'Tap "aA" in the address bar, then Website Settings, and allow Location',
                        'Reload the page and try again'
                    ]
                    : [
                        'Tap the icon at the start of the address bar',
                        'Set Location to "Allow"',
                        'Reload the page and try again'
                    ]
            };
        case 2:
            return {
                description: 'Your device can\'t work out where you are right now.',
                steps: [
                    'Make sure location services are on for this device',
                    'Move somewhere with a clearer view of the sky',
                    'Check that you\'re connected to the internet'
                ]
            };
        case 3:
            return {
                description: 'Finding your location took too long.',
                steps: [
                    'Move somewhere with better signal',
                    'Check that you\'re connected to the internet',
                    'Wait a moment and try again'
                ]
            };
        default:
            return {
                description: 'Something went wrong while finding your location.',
                steps: [
                    'Make sure location services are on',
                    'Check this site\'s location permission in your browser',
                    'Reload the page and try again'
                ]
            };
    }
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

export function showGeolocationErrorDialog(error) {
    document.getElementById(DIALOG_ID)?.remove();

    const device = platform();
    const { description, steps } = troubleshooting(error.code, device);
    const help = HELP_LINKS[device];

    const dialog = document.createElement('sl-dialog');
    dialog.id = DIALOG_ID;
    dialog.className = 'geolocation-error-dialog';
    dialog.label = geolocationErrorMessage(error.code);
    dialog.setAttribute('no-header', '');

    const header = element('div', 'geolocation-error-header');
    const close = element('button', 'place-data-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<sl-icon name="x-lg"></sl-icon>';
    close.addEventListener('click', () => dialog.hide());
    header.append(element('span', null, 'Your location'), close);

    const body = element('div', 'geolocation-error-body');
    const title = element('div', 'geolocation-error-title');
    const icon = document.createElement('sl-icon');
    icon.name = 'geo-alt';
    title.append(icon, element('span', null, dialog.label));

    const list = element('ol', 'geolocation-error-steps');
    steps.forEach(step => list.append(element('li', null, step)));

    const link = element('a', 'geolocation-error-link', help.label);
    link.href = help.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.insertAdjacentHTML('beforeend', '<sl-icon name="box-arrow-up-right"></sl-icon>');

    body.append(title, element('p', 'geolocation-error-description', description), list, link);

    const footer = element('div', 'geolocation-error-footer');
    const ok = element('button', 'geolocation-error-ok', 'Got it');
    ok.type = 'button';
    ok.addEventListener('click', () => dialog.hide());
    footer.append(ok);

    dialog.append(header, body, footer);
    dialog.addEventListener('sl-after-hide', (e) => { if (e.target === dialog) dialog.remove(); });
    document.body.appendChild(dialog);
    dialog.show();
}

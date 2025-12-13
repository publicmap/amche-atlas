/**
 * The Single Entry Point
 */
import './mapbox-api.js';
import './map-init.js';
import { NavigationControl } from './navigation-control.js';

/**
 * This will execute the google analytics script for the amche.in domain
 */
if (window.location.hostname === window.amche.DOMAIN_URL) {
    // Load Google Analytics
    const gtagScript = document.createElement('script');
    gtagScript.async = true;
    gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + window.amche.GOOGLE_ANALYTICS;
    document.head.appendChild(gtagScript);
    window.dataLayer = window.dataLayer || [];

    function gtag() {
        dataLayer.push(arguments);
    }

    gtag('js', new Date());
    gtag('config', window.amche.GOOGLE_ANALYTICS);
}

// Initialize NavigationControl
document.addEventListener('DOMContentLoaded', () => {
    const navigationControl = new NavigationControl();
    navigationControl.render();
});

// Register service worker
/*
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .catch((error) => {
                console.error('Service Worker registration failed:', error);
            });
    });
}
*/

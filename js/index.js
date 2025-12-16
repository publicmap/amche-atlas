/**
 * The Single Entry Point
 */
import { layerRegistry } from './layer-registry.js';
import './mapbox-api.js';
import { initializeMap, initializeSearch } from './map-init.js';
import { NavigationControl } from './navigation-control.js';

function loadGoogleAnalytics() {
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
}

// Layer registry is now imported from layer-registry.js
// Make it available globally for backwards compatibility
window.layerRegistry = layerRegistry;

// Initialize the map
mapboxgl.accessToken = window.amche.MAPBOXGL_ACCESS_TOKEN;

// Start initialization
$(window).on('load', function () {
    loadGoogleAnalytics(arguments);

    const navigationControl = new NavigationControl();
    navigationControl.render();

    initializeMap().then(() => {
        initializeSearch(); // Now window.map exists, so we can initialize search
    });
})

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

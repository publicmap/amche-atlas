/**
 * The Single Entry Point
 */
import { LayerRegistry } from './layer-registry.js';
import './mapbox-api.js';
import { MapInitializer } from './map-init.js';
import { PermalinkManager } from './permalink-manager.js';
import { NavigationControl } from './navigation-control.js';
import { IntroContentManager } from './intro-content-manager.js';

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

const layerRegistry = new LayerRegistry();
window.layerRegistry = layerRegistry;

// Initialize the map
mapboxgl.accessToken = window.amche.MAPBOXGL_ACCESS_TOKEN;

// Start initialization
$(window).on('load', function () {
    const permalinkHandler = new PermalinkManager();
    permalinkHandler.detectAndRedirect();

    loadGoogleAnalytics();

    const navigationControl = new NavigationControl();
    navigationControl.render();

    MapInitializer.initializeMap().then(() => {
        MapInitializer.initializeSearch(); // Now window.map exists, so we can initialize search
    });

    if (window.amche.ENABLE_INTRO_CONTENT === true) {
        new IntroContentManager();
    }
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

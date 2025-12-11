/**
 * The Single Entry Point
 */
import './drawer-state-manager.js';
import './mapbox-api.js';
import './map-feature-state-manager.js';
import './map-layer-controls.js';
import './map-feature-control.js';
import './map-attribution-control.js';
import './intro-content-manager.js';
import './layer-registry.js';
import './map-init.js';
import './geolocation-manager.js';
import './map-search-control.js';
import { MapLinks } from './map-links.js';
import { ShareLink } from './share-link.js';
import { NavigationControl } from './navigation-control.js';
import { ButtonResetMapView } from './button-reset-map-view.js';

// Initialize NavigationControl
document.addEventListener('DOMContentLoaded', () => {
    const navigationControl = new NavigationControl();
    navigationControl.render();
});

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

/**
 * Initialize drawer functionality and navigation
 */
// Initialize drawer functionality after Shoelace components are ready
customElements.whenDefined('sl-drawer').then(() => {
    const drawer = document.querySelector('.drawer-placement-start');

    // Track if drawer was manually toggled
    let userToggledDrawer = false;

    // Function to handle drawer state based on screen size, respecting user toggles
    function handleDrawerState() {
        // Don't automatically change drawer state if the user manually toggled it
        if (userToggledDrawer) return;

        // Keep drawer closed by default on all screen sizes
        // Users can manually open it if needed
        drawer.hide();
    }

    // Initial state - with a delay to ensure components are fully initialized
    setTimeout(() => {
        handleDrawerState();
    }, 100);

    // Listen for window resize, but don't apply on touch devices
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouch) {
        window.addEventListener('resize', handleDrawerState);
    }

    // Listen for drawer events to track manual toggles
    // Use more specific event handlers to avoid conflicts with programmatic toggles
    drawer.addEventListener('sl-after-show', (event) => {
        // Only mark as user-toggled if it's a direct user interaction
        if (event.target === drawer) {
            userToggledDrawer = true;
            console.log('[HTML] Drawer manually opened by user');
        }
    });

    drawer.addEventListener('sl-after-hide', (event) => {
        // Only mark as user-toggled if it's a direct user interaction
        if (event.target === drawer) {
            userToggledDrawer = true;
            console.log('[HTML] Drawer manually closed by user');
        }
    });
});

/**
 * Add all the buttons.
 */

window.addEventListener('mapReady', (event) => {
    const map = event.detail.map;

    map.addControl(new MapLinks(), 'bottom-right');
    map.addControl(new ButtonResetMapView(), 'top-right');
    map.addControl(new ShareLink({
        url: () => window.location.href,
        showToast: true,
        qrCodeSize: 500
    }), 'bottom-right');
});

document.addEventListener('DOMContentLoaded', () => {
    const parentElement = document.getElementById('mapbox-search-box-container');
    var searchbox = document.createElement('mapbox-search-box');
    Object.assign(searchbox, {
        'access-token': window.amche.MAPBOXGL_ACCESS_TOKEN,
        types: "place,locality,postcode,region,district,street,address,poi",
        country: "IN",
        language: "en",
        proximity: "73.87916,15.26032"
    });
    parentElement.appendChild(searchbox);
})

// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .catch((error) => {
                console.error('Service Worker registration failed:', error);
            });
    });
}

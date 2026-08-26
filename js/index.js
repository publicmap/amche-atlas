/**
 * The Single Entry Point
 */
import { LayerRegistry } from './layer-registry.js';
import './mapbox-api.js';
import { MapInitializer } from './map-init.js';
import { PermalinkManager } from './permalink-manager.js';
import { IntroContentManager } from './intro-content-manager.js';
import { initializeKeyboardController } from './keyboard-controller.js';
import { SplashScreenManager } from './splash-screen-manager.js';
import { initAnalytics, trackEvent } from './analytics.js';

// Make IntroContentManager available globally for inline navigation menu
window.IntroContentManager = IntroContentManager;

const layerRegistry = new LayerRegistry();
window.layerRegistry = layerRegistry;
window.dispatchEvent(new CustomEvent('layerRegistryReady'));

// Initialize the map
mapboxgl.accessToken = window.amche.MAPBOXGL_ACCESS_TOKEN;

// Start initialization
$(window).on('load', async function () {
    console.log(`[Timing] window.load fired at t=${Math.round(performance.now())}ms`);
    const permalinkHandler = new PermalinkManager();
    permalinkHandler.detectAndRedirect();

    initAnalytics();

    // Record which atlas configuration this session loaded
    const atlasParam = new URLSearchParams(window.location.search).get('atlas');
    trackEvent('atlas_load', {
        atlas_id: atlasParam || 'default'
    });

    // Record inbound permalink resolution (stashed before the redirect
    // by PermalinkManager, since the redirect would lose the event)
    const resolvedPermalink = sessionStorage.getItem('amche_permalink_resolved');
    if (resolvedPermalink) {
        sessionStorage.removeItem('amche_permalink_resolved');
        trackEvent('permalink_resolve', { permalink_id: resolvedPermalink });
    }

    // Layer visibility changes (user-initiated; map-layer-controls.js
    // dispatches this only from the show/hide UI handlers, not initial load)
    window.addEventListener('layer-toggled', (e) => {
        trackEvent('layer_toggle', {
            layer_id: e.detail?.layerId,
            visible: e.detail?.visible
        });
    });

    initializeKeyboardController();

    // Initialize splash screen manager (only once)
    if (!window.splashManager) {
        const splashManager = new SplashScreenManager();
        splashManager.initialize();
        window.splashManager = splashManager;
    }

    MapInitializer.initializeMap().then(() => {
        MapInitializer.initializeSearch();
    });

    if (window.amche.ENABLE_INTRO_CONTENT === true) {
        new IntroContentManager();
    }
})



/**
 * Analytics
 *
 * Single entry point for all Google Analytics (GA4) usage across amche pages.
 * - initAnalytics() loads the gtag.js base tag (production hostname only)
 * - trackEvent() safely records custom interaction events
 *
 * All instrumentation in the codebase must go through trackEvent();
 * never call gtag() directly. See docs/analytics-plan.md for the
 * event taxonomy and naming conventions.
 */

const MEASUREMENT_ID = (window.amche && window.amche.GOOGLE_ANALYTICS) || 'G-FBVGZ4HJV0';
const PROD_HOSTNAME = (window.amche && window.amche.DOMAIN_URL) || 'amche.in';

// Dev preview deploys to amche.in/dev on the same hostname, so tag those
// hits with debug_mode to keep them identifiable in GA4 (DebugView + filters).
const IS_DEBUG = window.location.pathname.startsWith('/dev');
const IS_PROD = window.location.hostname === PROD_HOSTNAME;

let initialized = false;

/**
 * Load the GA4 base tag. Safe to call multiple times; only loads once,
 * and only on the production hostname. On localhost it does nothing —
 * trackEvent() falls back to console logging so instrumentation can be
 * verified without a GA property.
 */
export function initAnalytics() {
    if (initialized || !IS_PROD) return;
    initialized = true;

    const gtagScript = document.createElement('script');
    gtagScript.async = true;
    gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
    document.head.appendChild(gtagScript);

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

    window.gtag('js', new Date());
    window.gtag('config', MEASUREMENT_ID, IS_DEBUG ? { debug_mode: true } : {});
}

/**
 * Record a custom event.
 *
 * @param {string} name  snake_case event name, <= 40 chars (GA4 limit)
 * @param {Object} [params]  flat key/value pairs. Values are stringified
 *   and truncated to 100 chars (GA4 param value limit). Never pass PII,
 *   raw user queries, or coordinates.
 */
export function trackEvent(name, params = {}) {
    const clean = {};
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        clean[key] = String(value).slice(0, 100);
    }
    if (IS_DEBUG) clean.debug_mode = true;

    if (typeof window.gtag === 'function') {
        window.gtag('event', name, clean);
    } else if (!IS_PROD) {
        // Local development: make instrumentation visible without GA
        console.debug('[analytics]', name, clean);
    }
}

// Convenience global so non-module scripts (sub-apps) can also report events
window.amcheAnalytics = { initAnalytics, trackEvent };

// Auto-init: pages only need to include this module to get pageview tracking
initAnalytics();

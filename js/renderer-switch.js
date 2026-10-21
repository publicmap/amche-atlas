/**
 * Switching the GL renderer (`?renderer=`, see index.html and docs/API.md)
 * takes a page reload, since it decides which GL library's <script> loads
 * before any app code runs. Used by the settings menu's Map Rendering Engine
 * options (js/settings-menu-control.js) and by js/locale-manager.js, which
 * moves to MapLibre when the user picks a language written in an Indic
 * script - MapLibre shapes those scripts' conjuncts and vowel signs
 * correctly, Mapbox GL JS does not.
 */
import { usesIndicScript } from './language-data.js';

export function rendererURL(nextRenderer, href) {
    const url = new URL(href);
    if (nextRenderer === (window.amche?.DEFAULT_RENDERER || 'mapbox')) {
        url.searchParams.delete('renderer');
    } else {
        url.searchParams.set('renderer', nextRenderer);
    }
    return url.toString();
}

export function switchRenderer(nextRenderer) {
    window.urlManager?.flushURLUpdate?.();
    window.location.href = rendererURL(nextRenderer, window.location.href);
}

/**
 * Reloads with MapLibre if any of `languageCodes` is Indic and the map is on
 * the default Mapbox renderer. Leaves an explicit `?renderer=` alone.
 */
export function ensureRendererForLanguages(languageCodes) {
    if ((window.amche?.RENDERER || 'mapbox') !== 'mapbox') return false;
    if (new URLSearchParams(window.location.search).has('renderer')) return false;
    if (!(languageCodes || []).some(usesIndicScript)) return false;
    switchRenderer('maplibre');
    return true;
}

/**
 * Applies the current locale (see js/locale-manager.js) to a live map:
 * - Mapbox GL JS's `setWorldview()` (Standard-style border/label worldview,
 *   e.g. showing Kashmir per India's claim vs. Pakistan's) from the locale
 *   country. Mapbox-only - MapLibre has no equivalent API, so this is a
 *   no-op there (feature-detected, not renderer-checked, so it degrades
 *   automatically if that ever changes).
 * - Re-localizing every already-rendered layer's `text-field` (see
 *   js/locale-text-field.js) - covers layers baked into the base style
 *   itself (loaded straight from the style JSON, never passing through
 *   js/mapbox-api.js's own layer creation) as well as this app's own
 *   layers, which are localized again here in case the locale changed
 *   *after* they were first added (at creation time they're already
 *   localized once - see mapbox-api.js's _categorizeStyleProperties).
 *
 * initLocaleMapSync(map) runs both once immediately and again on every
 * subsequent locale change for as long as the map exists.
 */
import { localeManager } from './locale-manager.js';
import { localizeTextField } from './locale-text-field.js';

function applyWorldview(map) {
    if (typeof map.setWorldview !== 'function') return; // MapLibre, or a future Mapbox build without it
    const country = localeManager.getCountry();
    if (country?.code) map.setWorldview(country.code);
}

function relocalizeTextFields(map) {
    const languageCodes = localeManager.getLanguageCodes();
    let style;
    try {
        style = map.getStyle();
    } catch (error) {
        return; // style not loaded yet
    }
    (style?.layers || []).forEach(layer => {
        const current = layer.layout?.['text-field'];
        if (current === undefined) return;
        const next = localizeTextField(current, languageCodes);
        if (JSON.stringify(next) === JSON.stringify(current)) return;
        try {
            map.setLayoutProperty(layer.id, 'text-field', next);
        } catch (error) {
            console.warn(`[locale-map-sync] Failed to relocalize text-field on layer "${layer.id}":`, error);
        }
    });
}

export function initLocaleMapSync(map) {
    const apply = () => {
        applyWorldview(map);
        relocalizeTextFields(map);
    };
    if (map.isStyleLoaded && map.isStyleLoaded()) apply();
    else map.once('load', apply);
    return localeManager.onChange(apply);
}

/**
 * LocaleManager - single owner of the app's current locale (country, primary
 * language, fallback languages), edited from the "Locale" section of any
 * layer's settings modal (see js/layer-settings-modal.js) even though the
 * setting itself is global, not per-layer - it's meant to drive which
 * `name_<lang>`-style label a layer's text-field picks app-wide, not one
 * layer's styling alone.
 *
 * Defaults come from `config/_defaults.json`'s `locale` block (fetched once,
 * lazily); a `null` default country there means "whatever the map is
 * currently centered over", read live from js/map-attribution-control.js's
 * last Nominatim reverse-geocode (window.attributionControl.getAddress()).
 * A value the user actually sets (via the modal, or already present in the
 * URL on load) overrides both and is mirrored to `?country=`/`?lang=`/
 * `?fallbackLang=` via js/url-manager.js - see docs/API.md.
 */
import { findLanguageByCode } from './language-data.js';
import { COUNTRIES } from './search/providers/country-provider.js';

function findCountryByCode(code) {
    if (!code) return null;
    const upper = code.toUpperCase();
    const match = COUNTRIES.find(([, iso2]) => iso2 === upper);
    return match ? { name: match[0], code: match[1] } : { name: upper, code: upper };
}

class LocaleManager {
    constructor() {
        this._country = null;
        this._primaryLanguage = null;
        this._fallbackLanguages = [];
        this._defaults = { country: null, primaryLanguage: null, fallbackLanguages: [] };
        this._defaultsLoaded = false;
        this._defaultsPromise = null;
        this._listeners = new Set();
    }

    /** Lazily fetches config/_defaults.json's `locale` block, once. */
    async ensureDefaultsLoaded() {
        if (this._defaultsLoaded) return;
        if (!this._defaultsPromise) {
            this._defaultsPromise = (async () => {
                try {
                    const url = window.amche?.LAYER_DEFAULTS;
                    if (!url) return;
                    const res = await fetch(url);
                    if (!res.ok) return;
                    const json = await res.json();
                    if (json?.locale) this._defaults = json.locale;
                } catch (error) {
                    console.warn('[LocaleManager] Failed to load locale defaults:', error);
                } finally {
                    this._defaultsLoaded = true;
                }
            })();
        }
        await this._defaultsPromise;
    }

    /** Nominatim country for wherever the map is currently centered, if known. */
    _liveCountry() {
        const address = window.attributionControl?.getAddress?.();
        if (!address?.country) return null;
        return { name: address.country, code: (address.country_code || '').toUpperCase() };
    }

    getCountry() {
        return this._country || this._liveCountry() ||
            (this._defaults.country ? findCountryByCode(this._defaults.country) : null);
    }

    getPrimaryLanguage() {
        return this._primaryLanguage || this._defaults.primaryLanguage || null;
    }

    getFallbackLanguages() {
        return this._fallbackLanguages.length ? this._fallbackLanguages : (this._defaults.fallbackLanguages || []);
    }

    /** True once any field has been explicitly set (by the user or the URL), not just defaulted. */
    isCountryDefault() { return this._country === null; }
    isPrimaryLanguageDefault() { return this._primaryLanguage === null; }
    isFallbackLanguagesDefault() { return this._fallbackLanguages.length === 0; }

    setCountry(country) {
        this._country = country;
        this._notify();
        this._syncURL();
    }

    setPrimaryLanguage(lang) {
        this._primaryLanguage = lang;
        this._notify();
        this._syncURL();
    }

    setFallbackLanguages(langs) {
        this._fallbackLanguages = langs || [];
        this._notify();
        this._syncURL();
    }

    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _notify() {
        this._listeners.forEach(fn => {
            try { fn(); } catch (error) { console.error('[LocaleManager] onChange listener failed:', error); }
        });
    }

    _syncURL() {
        if (!window.urlManager) return;
        window.urlManager.updateCountryParam(this._country?.code || null);
        window.urlManager.updateLangParam(this._primaryLanguage?.code || null);
        window.urlManager.updateFallbackLangParam(
            this._fallbackLanguages.length ? this._fallbackLanguages.map(l => l.code).join(',') : null
        );
    }

    /**
     * Called once from js/url-manager.js's applyURLParameters() with whatever
     * `?country=`/`?lang=`/`?fallbackLang=` were present on load.
     */
    initializeFromURL({ country, lang, fallbackLang } = {}) {
        if (country) this._country = findCountryByCode(country);
        if (lang) this._primaryLanguage = findLanguageByCode(lang) || { code: lang, name: lang };
        if (fallbackLang) {
            this._fallbackLanguages = fallbackLang.split(',')
                .map(c => c.trim()).filter(Boolean)
                .map(c => findLanguageByCode(c) || { code: c, name: c });
        }
        this._notify();
    }
}

export const localeManager = new LocaleManager();

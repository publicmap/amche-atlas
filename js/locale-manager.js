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
 * A non-English browser locale takes priority over the config's default
 * language (see _browserLanguage()) - a visitor whose browser is set to e.g.
 * Hindi gets Hindi labels with English as the fallback, without having to
 * touch the settings UI.
 * A value the user actually sets (via the modal, or already present in the
 * URL on load) overrides all of the above and is mirrored to
 * `?country=`/`?lang=` via js/url-manager.js - see docs/API.md. `?lang=` is
 * comma-separated, primary language first followed by fallbacks in priority
 * order (e.g. `?lang=hi,en`).
 */
import { findLanguageByCode } from './language-data.js';
import { COUNTRIES } from './search/providers/country-provider.js';

/**
 * Resolves a BCP 47 tag from `navigator.languages` to one of our language
 * codes. Region subtags ("en-GB", "pt-BR") are dropped - LANGUAGES does list
 * a few of those, but map labels come from `name:<lang>` tags that are keyed
 * by language, not locale. Script subtags ("zh-Hant") are kept and widened
 * away only if unmatched, since those do name distinct label sets.
 */
function matchBrowserTag(tag) {
    const [language, ...subtags] = (tag || '').toLowerCase().split('-').filter(Boolean);
    if (!language) return null;
    const parts = [language, ...subtags.filter(s => !/^([a-z]{2}|\d{3})$/.test(s))];
    while (parts.length) {
        const found = findLanguageByCode(parts.join('-'));
        if (found) return found;
        parts.pop();
    }
    return null;
}

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
        this._browserLanguageResolved = false;
        this._browserLanguageValue = null;
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

    /**
     * The browser's preferred language, if it's anything other than English -
     * an English browser wants no change from the config default, and pinning
     * it would only add a redundant "en" fallback. Regional English variants
     * ("en-GB") resolve to "en" and are skipped too.
     */
    _browserLanguage() {
        if (this._browserLanguageResolved) return this._browserLanguageValue;
        this._browserLanguageResolved = true;
        const tags = navigator?.languages?.length ? navigator.languages : [navigator?.language];
        for (const tag of tags) {
            const lang = matchBrowserTag(tag);
            if (lang && lang.code !== 'en') {
                this._browserLanguageValue = lang;
                break;
            }
            if (lang) break; // English came first in the preference list.
        }
        return this._browserLanguageValue;
    }

    getCountry() {
        return this._country || this._liveCountry() ||
            (this._defaults.country ? findCountryByCode(this._defaults.country) : null);
    }

    getPrimaryLanguage() {
        return this._primaryLanguage || this._browserLanguage() || this._defaults.primaryLanguage || null;
    }

    getFallbackLanguages() {
        if (this._fallbackLanguages.length) return this._fallbackLanguages;
        // A browser-derived primary falls back to English rather than to the
        // config's (which assumes an English primary and so lists none).
        if (!this._primaryLanguage && this._browserLanguage()) {
            return [findLanguageByCode('en') || { name: 'English', code: 'en' }];
        }
        return this._defaults.fallbackLanguages || [];
    }

    /**
     * Language codes in priority order (primary first, then fallbacks) -
     * what js/locale-text-field.js's buildNameCoalesce/localizeTextField
     * take, and what js/locale-map-sync.js re-applies to the map's
     * `text-field` layout properties whenever this changes.
     */
    getLanguageCodes() {
        const primary = this.getPrimaryLanguage();
        const codes = primary ? [primary.code] : [];
        this.getFallbackLanguages().forEach(lang => { if (lang?.code) codes.push(lang.code); });
        return codes;
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
        // Primary language first, then fallbacks - one comma-separated list
        // rather than a separate fallback param (see getLanguageCodes()).
        // Written whenever either has an explicit override, using the
        // *effective* value for whichever one doesn't (e.g. adding just a
        // fallback still needs to spell out the still-default primary, since
        // this one list has no other way to mark "keep the default here").
        const hasOverride = !this.isPrimaryLanguageDefault() || !this.isFallbackLanguagesDefault();
        const codes = hasOverride
            ? [this.getPrimaryLanguage(), ...this.getFallbackLanguages()].filter(Boolean).map(l => l.code)
            : [];
        window.urlManager.updateLangParam(codes.length ? codes.join(',') : null);
    }

    /**
     * Called once from js/url-manager.js's applyURLParameters() with whatever
     * `?country=`/`?lang=` were present on load. `lang` is comma-separated -
     * the first code is the primary language, the rest are fallbacks in
     * priority order.
     */
    initializeFromURL({ country, lang } = {}) {
        if (country) this._country = findCountryByCode(country);
        if (lang) {
            const [primaryCode, ...fallbackCodes] = lang.split(',').map(c => c.trim()).filter(Boolean);
            if (primaryCode) this._primaryLanguage = findLanguageByCode(primaryCode) || { code: primaryCode, name: primaryCode };
            this._fallbackLanguages = fallbackCodes.map(c => findLanguageByCode(c) || { code: c, name: c });
        }
        this._notify();
    }
}

export const localeManager = new LocaleManager();

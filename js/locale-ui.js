/**
 * Shared "Locale" settings UI - three AutocompleteBadgeInput fields
 * (country, primary language, fallback languages) bound to the global
 * js/locale-manager.js singleton. Used from both js/settings-menu-control.js
 * (the header-nav gear menu - the only currently reachable place this
 * renders) and js/layer-settings-modal.js (which isn't wired to any button
 * yet, but gets the same section for whenever it is).
 *
 * mountLocaleSection() owns its own AutocompleteBadgeInput instances and
 * tears them down/rebuilds on every call, so it's safe to call again (e.g.
 * a modal's show()) without leaking the previous ones.
 */
import { AutocompleteBadgeInput } from './autocomplete-badge-input.js';
import { LANGUAGES, COUNTRY_LANGUAGES, COUNTRY_REGION, languageDisplayName, formatLanguageLabel, findLanguageByCode } from './language-data.js';
import { COUNTRIES } from './search/providers/country-provider.js';
import { localeManager } from './locale-manager.js';

/**
 * ISO 3166-1 alpha-2 -> flag emoji, via Unicode's Regional Indicator Symbol
 * letters (U+1F1E6..U+1F1FF map 1:1 onto A-Z at a fixed offset) - every
 * two-letter country code composes into its flag this way, no lookup table
 * needed. Returns null for anything that isn't exactly two letters (a
 * free-typed/unrecognised code - falls back to the generic flag icon).
 */
function countryFlagEmoji(code) {
    if (!/^[A-Za-z]{2}$/.test(code || '')) return null;
    return code.toUpperCase().split('').map(c => String.fromCodePoint(c.codePointAt(0) + 127397)).join('');
}

function countryIcon(value) {
    return (value && countryFlagEmoji(value.code)) || 'flag';
}

/**
 * Exact code matches (typing "ta" for Tamil, or a country's own ISO code)
 * sort first, under their own "Best Match" heading, ahead of whatever
 * category they'd otherwise land in - a query this specific means the user
 * already knows what they want, and a substring hit elsewhere in a long
 * autonym/name (e.g. "ta" inside "Batak") shouldn't outrank it.
 */
function withExactCodeFirst(items, query) {
    if (!query) return items;
    const lower = query.trim().toLowerCase();
    if (!lower) return items;
    const exact = [];
    const rest = [];
    items.forEach(item => {
        if (item.value?.code?.toLowerCase() === lower) {
            exact.push({ ...item, category: 'Best Match' });
        } else {
            rest.push(item);
        }
    });
    return exact.concat(rest);
}

function buildCountryItems(query) {
    const items = COUNTRIES.map(([name, code]) => ({
        category: 'Countries', icon: countryFlagEmoji(code) || 'flag', label: `${name} [${code}]`, value: { name, code }
    }));
    return withExactCodeFirst(items, query);
}

/**
 * Languages relevant to the current locale country sort first, under their
 * own category heading, ahead of the full list. Prefers COUNTRY_LANGUAGES'
 * actual official/major languages for that specific country (see
 * js/language-data.js); falls back to its coarser ULS macro-region only for
 * a country missing from that table, so e.g. India doesn't surface
 * Indonesian regional languages just for both being "somewhere in Asia".
 */
function buildLanguageItems(query) {
    const country = localeManager.getCountry();
    const preferredCodes = country?.code ? COUNTRY_LANGUAGES[country.code] : null;
    const region = !preferredCodes && country?.code ? COUNTRY_REGION[country.code] : null;

    const suggested = [];
    const rest = [];
    LANGUAGES.forEach(([code, autonym, regions]) => {
        const name = languageDisplayName(code, autonym);
        const label = formatLanguageLabel(code, autonym);
        const item = { icon: 'translate', label, value: { name, autonym, code, label } };
        const isSuggested = preferredCodes ? preferredCodes.includes(code) : (region && regions?.includes(region));
        (isSuggested ? suggested : rest).push(item);
    });

    // COUNTRY_LANGUAGES is itself already most-relevant-first; LANGUAGES is
    // sorted by code, which loses that ordering when filtering - restore it.
    if (preferredCodes) {
        suggested.sort((a, b) => preferredCodes.indexOf(a.value.code) - preferredCodes.indexOf(b.value.code));
    }

    suggested.forEach(item => { item.category = `Suggested for ${country.name}`; });
    rest.forEach(item => { item.category = 'All Languages'; });
    return withExactCodeFirst(suggested.concat(rest), query);
}

function parseCountryText(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const upper = trimmed.toUpperCase();
    const byCode = COUNTRIES.find(([, code]) => code === upper);
    if (byCode) return { value: { name: byCode[0], code: byCode[1] } };
    // Not in the (deliberately non-exhaustive) list - accept as free text.
    return { value: { name: trimmed, code: upper } };
}

function parseLanguageText(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const found = findLanguageByCode(trimmed.toLowerCase());
    if (found) return { value: found };
    return { value: { name: trimmed, code: trimmed.toLowerCase() } };
}

function paintBadge(input, value, icon) {
    input.render({
        icon,
        label: value ? (value.label || `${value.name} [${value.code}]`) : '',
        subtext: '',
        isUnset: !value
    });
}

/**
 * Renders into `container` (cleared first). Call again to rebuild against
 * the latest localeManager state (e.g. every time a modal reopens).
 */
export async function mountLocaleSection(container) {
    await localeManager.ensureDefaultsLoaded();
    container.innerHTML = '';

    const countryField = document.createElement('div');
    countryField.className = 'locale-field';
    const countryLabel = document.createElement('label');
    countryLabel.className = 'locale-field-label';
    countryLabel.textContent = 'Country';
    const countryInputEl = document.createElement('div');
    countryField.append(countryLabel, countryInputEl);
    container.appendChild(countryField);

    const countryInput = new AutocompleteBadgeInput({
        placeholder: 'Not set',
        getItems: buildCountryItems,
        parseText: parseCountryText,
        onSelect: (item) => {
            localeManager.setCountry(item.value);
            paintBadge(countryInput, item.value, countryIcon(item.value));
        }
    });
    countryInputEl.appendChild(countryInput.mount());
    paintBadge(countryInput, localeManager.getCountry(), countryIcon(localeManager.getCountry()));

    const primaryField = document.createElement('div');
    primaryField.className = 'locale-field';
    const primaryLabel = document.createElement('label');
    primaryLabel.className = 'locale-field-label';
    primaryLabel.textContent = 'Primary Language';
    const primaryRow = document.createElement('div');
    primaryRow.className = 'locale-fallback-row';
    const primaryInputEl = document.createElement('div');
    primaryInputEl.className = 'locale-fallback-row-input';
    primaryRow.appendChild(primaryInputEl);
    const primaryClearBtn = document.createElement('button');
    primaryClearBtn.type = 'button';
    primaryClearBtn.className = 'locale-fallback-remove-btn';
    primaryClearBtn.setAttribute('aria-label', 'Reset to default primary language');
    primaryClearBtn.innerHTML = '<sl-icon name="x-lg"></sl-icon>';
    primaryRow.appendChild(primaryClearBtn);
    primaryField.append(primaryLabel, primaryRow);
    container.appendChild(primaryField);

    const updatePrimaryClearVisibility = () => {
        primaryClearBtn.hidden = localeManager.isPrimaryLanguageDefault();
    };

    const primaryInput = new AutocompleteBadgeInput({
        placeholder: 'Not set',
        getItems: buildLanguageItems,
        parseText: parseLanguageText,
        onSelect: (item) => {
            localeManager.setPrimaryLanguage(item.value);
            paintBadge(primaryInput, item.value, 'translate');
            updatePrimaryClearVisibility();
        }
    });
    primaryInputEl.appendChild(primaryInput.mount());
    paintBadge(primaryInput, localeManager.getPrimaryLanguage(), 'translate');
    updatePrimaryClearVisibility();

    primaryClearBtn.addEventListener('click', () => {
        localeManager.setPrimaryLanguage(null);
        paintBadge(primaryInput, localeManager.getPrimaryLanguage(), 'translate');
        updatePrimaryClearVisibility();
    });

    const fallbackField = document.createElement('div');
    fallbackField.className = 'locale-field';
    const fallbackLabel = document.createElement('label');
    fallbackLabel.className = 'locale-field-label';
    fallbackLabel.textContent = 'Fallback Languages';
    const fallbackList = document.createElement('div');
    fallbackList.className = 'locale-fallback-list';
    fallbackField.append(fallbackLabel, fallbackList);
    container.appendChild(fallbackField);

    const fallbackEntries = [];
    const commitFallback = () => {
        localeManager.setFallbackLanguages(fallbackEntries.map(e => e.value).filter(Boolean));
    };

    const addFallbackRow = (lang) => {
        const row = document.createElement('div');
        row.className = 'locale-fallback-row';

        const inputEl = document.createElement('div');
        inputEl.className = 'locale-fallback-row-input';
        row.appendChild(inputEl);

        const entry = { value: lang || null };
        const input = new AutocompleteBadgeInput({
            placeholder: 'Not set',
            getItems: buildLanguageItems,
            parseText: parseLanguageText,
            onSelect: (item) => {
                entry.value = item.value;
                paintBadge(input, item.value, 'translate');
                commitFallback();
            }
        });
        inputEl.appendChild(input.mount());
        paintBadge(input, lang, 'translate');

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'locale-fallback-remove-btn';
        removeBtn.setAttribute('aria-label', 'Remove fallback language');
        removeBtn.innerHTML = '<sl-icon name="x-lg"></sl-icon>';
        removeBtn.addEventListener('click', () => {
            input.destroy();
            row.remove();
            const idx = fallbackEntries.indexOf(entry);
            if (idx !== -1) fallbackEntries.splice(idx, 1);
            commitFallback();
        });
        row.appendChild(removeBtn);

        fallbackList.appendChild(row);
        fallbackEntries.push(entry);
    };

    const existingFallbacks = localeManager.getFallbackLanguages();
    if (existingFallbacks.length === 0) {
        addFallbackRow(null);
    } else {
        existingFallbacks.forEach(addFallbackRow);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'shortcut-menu-item locale-add-fallback-btn';
    addBtn.innerHTML = '<sl-icon name="plus-lg"></sl-icon><span>Add fallback language</span>';
    addBtn.addEventListener('click', () => addFallbackRow(null));
    fallbackField.appendChild(addBtn);
}

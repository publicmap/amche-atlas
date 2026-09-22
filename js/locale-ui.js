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
import { LANGUAGES, COUNTRY_REGION, languageDisplayName, findLanguageByCode } from './language-data.js';
import { COUNTRIES } from './search/providers/country-provider.js';
import { localeManager } from './locale-manager.js';

function buildCountryItems() {
    return COUNTRIES.map(([name, code]) => ({
        category: 'Countries', icon: 'flag', label: `${name} [${code}]`, value: { name, code }
    }));
}

/**
 * Languages relevant to the current locale country's ULS macro-region (see
 * js/language-data.js) sort first, under their own category heading, ahead
 * of the full list - approximate (a whole country maps to one broad region,
 * not the other way around), but enough that e.g. a Goa/India locale finds
 * Konkani/Marathi/Hindi before scrolling past everything else.
 */
function buildLanguageItems() {
    const countryCode = localeManager.getCountry()?.code;
    const region = countryCode ? COUNTRY_REGION[countryCode] : null;
    const countryName = localeManager.getCountry()?.name;

    const suggested = [];
    const rest = [];
    LANGUAGES.forEach(([code, autonym, regions]) => {
        const name = languageDisplayName(code, autonym);
        const item = { icon: 'translate', label: `${name} [${code}]`, value: { name, code } };
        (region && regions?.includes(region) ? suggested : rest).push(item);
    });

    suggested.forEach(item => { item.category = `Suggested for ${countryName}`; });
    rest.forEach(item => { item.category = 'All Languages'; });
    return suggested.concat(rest);
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
        label: value ? `${value.name} [${value.code}]` : '',
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
            paintBadge(countryInput, item.value, 'flag');
        }
    });
    countryInputEl.appendChild(countryInput.mount());
    paintBadge(countryInput, localeManager.getCountry(), 'flag');

    const primaryField = document.createElement('div');
    primaryField.className = 'locale-field';
    const primaryLabel = document.createElement('label');
    primaryLabel.className = 'locale-field-label';
    primaryLabel.textContent = 'Primary Language';
    const primaryInputEl = document.createElement('div');
    primaryField.append(primaryLabel, primaryInputEl);
    container.appendChild(primaryField);

    const primaryInput = new AutocompleteBadgeInput({
        placeholder: 'Not set',
        getItems: buildLanguageItems,
        parseText: parseLanguageText,
        onSelect: (item) => {
            localeManager.setPrimaryLanguage(item.value);
            paintBadge(primaryInput, item.value, 'translate');
        }
    });
    primaryInputEl.appendChild(primaryInput.mount());
    paintBadge(primaryInput, localeManager.getPrimaryLanguage(), 'translate');

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

    const addBtn = document.createElement('sl-button');
    addBtn.setAttribute('size', 'small');
    addBtn.className = 'locale-add-fallback-btn';
    addBtn.innerHTML = '<sl-icon slot="prefix" name="plus-lg"></sl-icon>Add fallback language';
    addBtn.addEventListener('click', () => addFallbackRow(null));
    fallbackField.appendChild(addBtn);
}

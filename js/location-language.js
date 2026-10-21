/**
 * The language trigger beside the OSM credit under the address in the place
 * menu (js/map-location-menu-control.js): the languages the address is in,
 * primary first, opening onto the locale fields (js/locale-ui.js) that change
 * them.
 * The language set there is the map labels' and every Nominatim request's
 * (js/nominatim-search.js `nominatimLanguage()`), so the address is asked for
 * again in it.
 */
import { mountLocaleSection } from './locale-ui.js';
import { localeManager } from './locale-manager.js';

let open = false;

/**
 * @returns {{toggle: HTMLElement, panel: HTMLElement, destroy: () => void}} -
 *   the trigger, the fields it opens (placed separately), and `destroy()` to
 *   stop following the locale
 */
export function buildLanguageControl() {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'place-language-toggle';
    const icon = document.createElement('sl-icon');
    icon.setAttribute('name', 'translate');
    const text = document.createElement('span');
    toggle.append(icon, text);

    const panel = document.createElement('div');
    panel.className = 'place-language-panel';

    // The primary language, then the fallbacks: "Hindi, English"
    const paint = () => {
        const names = [localeManager.getPrimaryLanguage(), ...localeManager.getFallbackLanguages()]
            .map(lang => lang?.name).filter(Boolean);
        text.textContent = names.length ? names.join(', ') : 'English';
        toggle.title = 'Change the language of the address and map labels';
    };
    const apply = () => {
        toggle.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
        if (open) mountLocaleSection(panel);
    };
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        open = !open;
        apply();
    });

    paint();
    apply();
    const destroy = localeManager.onChange(paint);
    localeManager.ensureDefaultsLoaded().then(paint);
    return { toggle, panel, destroy };
}

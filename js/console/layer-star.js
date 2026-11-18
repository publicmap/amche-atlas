/**
 * A map's star (js/starred-layers.js) before its title, in the console's map
 * rows and its details page: filled while starred; a click stars or unstars
 * it without opening the row.
 */
import { el, icon } from './find-rows.js';
import { isStarred, setStarred } from '../starred-layers.js';

export function layerStarred(layer) {
    const defaults = window.browserControl?._getAtlasInitiallyCheckedIds?.(layer._sourceAtlas || 'index') || [];
    return isStarred(layer, { isDefault: !!layer.initiallyChecked || defaults.includes(layer._prefixedId) });
}

function paint(button, starred) {
    button.classList.toggle('on', starred);
    button.title = starred ? 'Starred - click to unstar' : 'Star this map to find it again';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(starred));
    button.replaceChildren(icon(starred ? 'star-fill' : 'star'));
}

export function starButton(layer, onChange = null) {
    const button = el('button', 'console-row-star');
    button.type = 'button';
    paint(button, layerStarred(layer));
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        const starred = !button.classList.contains('on');
        setStarred(layer, starred);
        paint(button, starred);
        onChange?.(starred);
    });
    return button;
}

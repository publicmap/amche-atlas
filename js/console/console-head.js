/**
 * The map console's head (js/map-control-bar.js): a header bar over the
 * atlas's header image, its icon and name at one size. Collapsed (Explore)
 * that label is all there is, and opens Find, with the console's status line
 * beneath. In Find the bar adds the menu before it, an info icon at its end -
 * the atlas picker's trigger, its cards (js/console/atlas-cards.js) holding
 * each atlas's description - and the close button.
 *
 * While the picker is open the label reads "‹ Select Atlas" from the bar's
 * left edge, in place of the menu, the atlas's icon and image: a way back to
 * the atlas picked.
 */
import { el, icon } from './find-rows.js';
import { plainText } from './find-browse.js';

function button(className, iconName, title) {
    const node = el('button', className);
    node.type = 'button';
    node.title = title;
    node.setAttribute('aria-label', title);
    if (iconName) node.appendChild(icon(iconName));
    return node;
}

export class ConsoleHead {
    /**
     * @param {{onMenu, onAtlas, onClose}} actions
     */
    constructor(actions) {
        this._iconKey = undefined;
        this.head = el('div', 'map-control-bar-head');

        this.menu = button('console-btn console-home when-find', 'list', 'Menu');
        if (window.amche?.isDevBuild) this.menu.appendChild(el('span', 'console-home-dev'));
        this.menu.addEventListener('click', actions.onMenu);

        this.atlas = button('map-control-bar-main', null, 'Atlas');
        const wrap = el('span', 'map-control-bar-icon-wrap');
        this._icon = el('span', 'map-control-bar-icon');
        const spinner = el('sl-spinner', 'map-control-bar-spinner');
        wrap.append(this._icon, spinner);
        const text = el('span', 'console-atlas-text');
        this._name = el('span', 'map-control-bar-name', 'Loading atlas');
        text.append(this._name);
        const back = icon('chevron-left');
        back.classList.add('console-atlas-back');
        const maps = icon('map');
        maps.classList.add('console-atlas-maps');
        const info = icon('info-circle');
        info.classList.add('console-atlas-chevron', 'when-find');
        this.atlas.append(back, maps, wrap, text, info);
        this.atlas.addEventListener('click', actions.onAtlas);

        const close = button('console-btn console-close-btn when-find', 'x-lg', 'Close ( Esc )');
        close.addEventListener('click', actions.onClose);
        this.head.append(this.menu, this.atlas, close);
    }

    setAtlas({ name = '', description = '', iconSrc = null, image = null } = {}) {
        this._atlasName = name || 'Loading atlas';
        if (!this._picking) this._name.textContent = this._atlasName;
        const desc = plainText(description);
        if (image) this.head.style.setProperty('--head-image', `url("${String(image).replace(/"/g, '%22')}")`);
        else this.head.style.removeProperty('--head-image');
        this._title = name ? `${name}${desc ? ` - ${desc}` : ''} - pick an atlas` : 'Atlas';
        if (!this._picking) this.atlas.title = this._title;
        this.atlas.setAttribute('aria-label', name ? `Atlas: ${name}` : 'Atlas');
        this._setIcon(iconSrc);
    }

    /** While the atlas picker is open the label asks for an atlas instead of naming one. */
    setPickerOpen(open) {
        this._picking = !!open;
        this._name.textContent = open ? 'Select Atlas' : (this._atlasName || 'Loading atlas');
        this.atlas.title = open ? `Back to ${this._atlasName || 'the atlas'}` : (this._title || 'Atlas');
        this.atlas.setAttribute('aria-expanded', String(!!open));
    }

    _setIcon(src) {
        if (src === this._iconKey) return;
        this._iconKey = src;
        this._icon.replaceChildren();
        if (src) {
            const img = el('img');
            img.src = src;
            img.alt = '';
            this._icon.appendChild(img);
        } else {
            this._icon.appendChild(icon('map'));
        }
    }
}

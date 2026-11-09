/**
 * The map console's head (js/map-control-bar.js): a header bar over the
 * atlas's header image, its icon and name at one size. Collapsed (Explore)
 * that label is all there is, and opens Find, with the console's status line
 * beneath. In Find the bar adds the menu before it, an info icon at its end
 * and the close button.
 *
 * The atlas label opens the atlas mode of Find (js/console/find-panel.js):
 * the bar grows to give the atlas's description and attribution beneath its
 * name, then its overview (js/console/atlas-overview.js) - default maps,
 * Reset Maps, and its maps by source - over the list of atlases to browse.
 */
import { el, icon, richText } from './find-rows.js';
import { AtlasOverview } from './atlas-overview.js';
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
     * @param {{onMenu, onAtlas, onClose, onBack}} actions
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
        this._info = icon('info-circle');
        this._info.classList.add('console-atlas-chevron', 'when-find');
        this.atlas.append(wrap, text, this._info);
        this.atlas.addEventListener('click', actions.onAtlas);

        const close = button('console-btn console-close-btn when-find', 'x-lg', 'Close ( Esc )');
        close.addEventListener('click', actions.onClose);
        // The atlas's description, attribution and overview, shown in atlas mode
        this._details = el('div', 'console-atlas-details when-find');
        this._details.hidden = true;
        this._overview = new AtlasOverview({ onBack: actions.onBack });
        this.head.append(this.menu, this.atlas, close, this._details);
    }

    setAtlas({ id = null, name = '', description = '', attribution = '', iconSrc = null, image = null } = {}) {
        this._name.textContent = name || 'Loading atlas';
        const desc = plainText(description);
        if (id) this._overview.render(id);
        // Rebuilt only for another atlas, keeping the details' scroll and open branches
        const detailsKey = `${id}|${description}|${attribution}`;
        if (detailsKey !== this._detailsKey) {
            this._detailsKey = detailsKey;
            const about = richText(description, 'console-atlas-about');
            const credit = richText(attribution, 'console-atlas-credit');
            if (credit) credit.prepend(el('span', 'console-atlas-credit-label', 'Attribution '));
            this._details.replaceChildren(...[about, credit, this._overview.el].filter(Boolean));
        }
        if (image) this.head.style.setProperty('--head-image', `url("${String(image).replace(/"/g, '%22')}")`);
        else this.head.style.removeProperty('--head-image');
        this._title = name ? `${name}${desc ? ` - ${desc}` : ''} - about this atlas, and others` : 'Atlas';
        this.atlas.title = this._picking ? 'Back to the map list' : this._title;
        this.atlas.setAttribute('aria-label', name ? `Atlas: ${name}` : 'Atlas');
        this._setIcon(iconSrc);
    }

    /** Atlas mode: the bar gives the atlas's description and attribution. */
    setPickerOpen(open) {
        this._picking = !!open;
        this._details.hidden = !open;
        if (open) this._overview.refresh();
        this._info.name = open ? 'info-circle-fill' : 'info-circle';
        this.atlas.title = open ? 'Back to the map list' : (this._title || 'Atlas');
        this.atlas.setAttribute('aria-expanded', String(!!open));
    }

    /** The maps on the map changed: the overview's on marks and Reset Maps follow. */
    refreshOverview() {
        if (this._picking) this._overview.refresh();
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

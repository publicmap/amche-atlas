/**
 * The map console's head (js/map-control-bar.js): a header bar over the
 * atlas's header image, its icon and name at one size. Collapsed (Explore)
 * that label is all there is, and opens Find, with the console's status line
 * beneath. In Find the bar adds the menu before it, an info icon at its end
 * and the close button.
 *
 * The atlas label opens the atlas mode of Find (js/console/find-panel.js):
 * the bar turns to navigation - "← Goa › Atlas Details", back to the atlas's
 * map list - and grows to give the atlas as a row with its eye (on; off hides
 * the atlas's own maps for a moment, to see what lies beneath - back on, or
 * leaving atlas mode, brings them back), its description and
 * attribution, then its overview (js/console/atlas-overview.js), over the
 * list of atlases to browse.
 */
import { el, icon, richText, row, imageThumb, eyeButton, setEyeState } from './find-rows.js';
import { AtlasOverview } from './atlas-overview.js';
import { plainText, atlasMapCount } from './find-browse.js';

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
        this._info = icon('info-circle');
        this._info.classList.add('console-atlas-chevron', 'when-find');
        // Atlas mode: the label is the way back - "← Goa › Atlas Details"
        const back = el('span', 'console-atlas-back');
        this._backFrom = el('span', 'console-crumb-from', 'Maps');
        back.append(icon('arrow-left'), this._backFrom, el('span', 'console-crumb-sep', '›'));
        this.atlas.append(back, wrap, text, this._info);
        this.atlas.addEventListener('click', actions.onAtlas);

        const close = button('console-btn console-close-btn when-find', 'x-lg', 'Close ( Esc )');
        close.addEventListener('click', actions.onClose);
        // The atlas's description, attribution and overview, shown in atlas mode
        this._details = el('div', 'console-atlas-details when-find');
        this._details.hidden = true;
        this._overview = new AtlasOverview();
        this.head.append(this.menu, this.atlas, close, this._details);
    }

    setAtlas({ id = null, name = '', description = '', attribution = '', area = '', iconSrc = null, image = null } = {}) {
        this._atlasName = name || 'Loading atlas';
        this._name.textContent = this._picking ? 'Atlas Details' : this._atlasName;
        this._backFrom.textContent = this._atlasName;
        const desc = plainText(description);
        if (id) this._overview.render(id);
        // Rebuilt only for another atlas, keeping the details' scroll and open branches
        const detailsKey = `${id}|${description}|${attribution}`;
        if (detailsKey !== this._detailsKey) {
            this._detailsKey = detailsKey;
            const about = richText(description, 'console-atlas-about');
            const credit = richText(attribution, 'console-atlas-credit');
            if (credit) credit.prepend(el('span', 'console-atlas-credit-label', 'Attribution '));
            this._details.replaceChildren(...[this._atlasRow({ id, name, area, iconSrc }), about, credit, this._overview.el].filter(Boolean));
        }
        if (image) this.head.style.setProperty('--head-image', `url("${String(image).replace(/"/g, '%22')}")`);
        else this.head.style.removeProperty('--head-image');
        this._title = name ? `${name}${desc ? ` - ${desc}` : ''} - about this atlas, and others` : 'Atlas';
        this.atlas.title = this._picking ? `Back to ${this._atlasName} ( Esc )` : this._title;
        this.atlas.setAttribute('aria-label', name ? `Atlas: ${name}` : 'Atlas');
        this._setIcon(iconSrc);
    }

    /** The atlas on the map, with its eye: off hides its own maps for now, on brings them back. */
    _atlasRow({ id, name, area, iconSrc }) {
        if (!id) return null;
        this._hidden = null;
        const count = atlasMapCount(id);
        const index = id === 'index';
        const titleFor = (on) => (index ? `${name} is the base atlas` : on ? `Hide ${name}'s maps for now, to see what lies beneath` : `Show ${name}'s maps again`);
        const eye = eyeButton('on', () => {
            if (this._hidden) this._showAtlasMaps();
            else this._hideAtlasMaps(id);
            setEyeState(eye, this._hidden ? 'off' : 'on', titleFor(!this._hidden));
        }, titleFor(true));
        eye.disabled = index;
        const node = row({
            thumb: imageThumb(iconSrc, 'map'),
            title: name,
            meta: [area, `${count} map${count === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
            trailing: eye,
            className: 'console-atlas-row selected'
        });
        return node;
    }

    // This atlas's own maps on the map - not the index atlas's shared base maps
    _hideAtlasMaps(atlasId) {
        const control = window.browserControl;
        if (!control) return;
        const base = (value) => control._baseLayerId(value);
        const own = new Set(control._getAtlasLayerReferenceIds(atlasId));
        const shared = new Set(control._getAtlasLayerReferenceIds('index').map(base));
        const ids = [...control._getActiveLayers()].filter(active => base(active) !== 'locations' && !shared.has(base(active))
            && (own.has(active) || window.layerRegistry?.getLayer(active)?._sourceAtlas === atlasId));
        ids.forEach(active => control._handleLayerToggle(active, false));
        this._hidden = { atlasId, ids };
    }

    _showAtlasMaps() {
        const hidden = this._hidden;
        this._hidden = null;
        if (hidden && window.layerRegistry?.getCurrentAtlas() === hidden.atlasId) {
            hidden.ids.forEach(id => window.browserControl?._handleLayerToggle(id, true));
        }
    }

    /** Atlas mode: the bar gives the atlas's description and attribution. */
    setPickerOpen(open) {
        // The hidden view lasts while atlas mode does
        if (!open && this._hidden) {
            this._showAtlasMaps();
            this._detailsKey = null;
        }
        this._picking = !!open;
        this._name.textContent = open ? 'Atlas Details' : (this._atlasName || 'Loading atlas');
        this._details.hidden = !open;
        if (open) this._overview.refresh();
        if (open !== this._overview._active) this._overview.setActive(open);
        this._info.name = open ? 'info-circle-fill' : 'info-circle';
        this.atlas.title = open ? `Back to ${this._atlasName || 'the maps'} ( Esc )` : (this._title || 'Atlas');
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

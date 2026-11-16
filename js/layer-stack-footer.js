import { LayerStackOptionsMenu } from './layer-stack-options-menu.js';

const COMMENTS_LAYER_ID = 'index-notes';
export class LayerStackFooter {
    constructor({ post, getLayers, onOptionsToggle }) {
        this._post = post;
        this._getLayers = getLayers;
        this._onOptionsToggle = onOptionsToggle;
        this._menu = null;
        this._commentsBtn = null;
        this.el = this._build();
    }

    mount(map) {
        this._map = map || window.map;
        this._menu = new LayerStackOptionsMenu({ onVisibilityChange: this._onOptionsToggle });
        this._menu.mount(this._map, this._moreBtn);
        this.sync();
    }

    unmount() {
        this._menu?.unmount();
        this._menu = null;
    }

    closeMenu() {
        this._menu?.close();
    }

    // Hover tooltips and zooming to the maps are actions of the Active Maps
    // header now (js/console/active-maps-header.js)
    sync() {
        const comments = !!this._menu?._isLayerVisible(COMMENTS_LAYER_ID);
        this._commentsBtn.classList.toggle('on', comments);
    }

    _build() {
        const footer = document.createElement('div');
        footer.className = 'layer-stack-footer';

        const left = document.createElement('div');
        left.className = 'layer-stack-footer-group';
        this._commentsBtn = this._button('chat-left-text', '', 'Comments', () => this._toggleComments());
        left.append(this._commentsBtn);

        const right = document.createElement('div');
        right.className = 'layer-stack-footer-group';
        this._moreBtn = this._button('three-dots-vertical', '', 'Map and selection options', () => this._menu?.toggle());
        right.append(
            this._button('plus-lg', 'Add Map', 'Add a map from a file, link or atlas (map-creator.html)', () => this._toggleImport()),
            this._button('download', 'Export', 'Export map', () => this._post({ type: 'toggle-export' })),
            this._moreBtn
        );

        footer.append(left, right);
        return footer;
    }

    _button(icon, text, title, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'layer-stack-footer-btn';
        button.title = title;
        button.setAttribute('aria-label', title);
        button.tabIndex = -1;
        const iconEl = document.createElement('sl-icon');
        iconEl.name = icon;
        button.appendChild(iconEl);
        if (text) button.append(text);
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return button;
    }

    /** Opens the map creator in the side panel, or closes it if it is open. */
    _toggleImport() {
        const browser = window.browserControl;
        if (!browser) return;
        if (browser._isOpen) browser.closeBrowser();
        else browser.openCreator();
    }

    _toggleComments() {
        if (!this._menu) return;
        this._menu._lngLat = this._map?.getCenter() || null;
        this._menu._toggleComments();
        setTimeout(() => this.sync(), 150);
    }
}

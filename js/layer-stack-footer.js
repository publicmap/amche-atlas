import { LayerOrderManager } from './layer-order-manager.js';
import { LayerStackOptionsMenu } from './layer-stack-options-menu.js';

const COMMENTS_LAYER_ID = 'index-notes';
const ZOOM_PADDING = 60;

function parseBbox(bbox) {
    const parts = typeof bbox === 'string' ? bbox.split(',').map(parseFloat) : bbox;
    return Array.isArray(parts) && parts.length === 4 && parts.every(Number.isFinite) ? parts : null;
}

export class LayerStackFooter {
    constructor({ post, getLayers, onOptionsToggle }) {
        this._post = post;
        this._getLayers = getLayers;
        this._onOptionsToggle = onOptionsToggle;
        this._menu = null;
        this._hoverBtn = null;
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

    sync() {
        const hover = window.featureControl?.isHoverEnabled?.() ?? false;
        this._hoverBtn.classList.toggle('on', hover);
        this._hoverBtn.querySelector('sl-icon').name = hover ? 'hand-index-thumb-fill' : 'hand-index-thumb';
        const comments = !!this._menu?._isLayerVisible(COMMENTS_LAYER_ID);
        this._commentsBtn.classList.toggle('on', comments);
    }

    _build() {
        const footer = document.createElement('div');
        footer.className = 'layer-stack-footer';

        const left = document.createElement('div');
        left.className = 'layer-stack-footer-group';
        this._hoverBtn = this._button('hand-index-thumb', '', 'Hover tooltips', () => this._toggleHover());
        this._commentsBtn = this._button('chat-left-text', '', 'Comments', () => this._toggleComments());
        left.append(this._hoverBtn, this._commentsBtn, this._button('arrows-fullscreen', '', 'Zoom to maps', () => this._zoomToMaps()));

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

    _toggleHover() {
        const control = window.featureControl;
        control?.setHoverEnabled(!(control.isHoverEnabled?.() ?? false));
        this.sync();
    }

    _toggleComments() {
        if (!this._menu) return;
        this._menu._lngLat = this._map?.getCenter() || null;
        this._menu._toggleComments();
        setTimeout(() => this.sync(), 150);
    }

    _zoomToMaps() {
        const registry = window.layerRegistry;
        let bounds = null;
        this._getLayers().forEach(layer => {
            if (LayerOrderManager.isBasemap(layer)) return;
            const bbox = parseBbox(layer.bbox || registry?.getAtlasMetadata(layer._sourceAtlas)?.bbox);
            if (!bbox) return;
            bounds = bounds
                ? [Math.min(bounds[0], bbox[0]), Math.min(bounds[1], bbox[1]), Math.max(bounds[2], bbox[2]), Math.max(bounds[3], bbox[3])]
                : bbox;
        });
        if (!bounds) {
            window.layerControl?._showToast('No active maps to zoom to', 'info');
            return;
        }
        this._map?.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: ZOOM_PADDING, duration: 1000 });
    }
}

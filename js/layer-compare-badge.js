import { LayerThumbnail } from './layer-thumbnail.js';

const THUMB_SIZE = 36;

export class LayerCompareBadge {
    constructor({ getLayer, onStop }) {
        this._getLayer = getLayer;
        this._onStop = onStop;
        this._el = null;
        this._layerId = null;
    }

    sync(layerId) {
        const swiper = layerId ? document.querySelector('.mapboxgl-compare') : null;
        if (!swiper) {
            this.remove();
            return;
        }
        if (this._el && this._layerId === layerId && this._el.parentNode === swiper) return;

        const layer = this._getLayer(layerId);
        if (!layer) {
            this.remove();
            return;
        }
        this.remove();
        this._layerId = layerId;
        this._el = this._build(layer);
        swiper.appendChild(this._el);
    }

    remove() {
        this._el?.remove();
        this._el = null;
        this._layerId = null;
    }

    _build(layer) {
        const title = layer.title || layer.id;
        const badge = document.createElement('div');
        badge.className = 'layer-compare-badge';

        const thumbnail = LayerThumbnail.generate(layer, THUMB_SIZE, {
            hasFeatures: true,
            layerDefaults: window.layerControl?._defaultStyles || {}
        });
        thumbnail.classList.add('layer-compare-badge-thumb');
        badge.appendChild(thumbnail);

        const text = document.createElement('div');
        text.className = 'layer-compare-badge-text';
        const name = document.createElement('span');
        name.className = 'layer-compare-badge-title';
        name.textContent = title;
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'layer-compare-badge-stop';
        stop.textContent = 'Stop Comparing';
        stop.setAttribute('aria-label', `Stop comparing ${title}`);
        ['click', 'mousedown', 'touchstart'].forEach(type => stop.addEventListener(type, e => e.stopPropagation()));
        stop.addEventListener('click', () => this._onStop(layer.id));
        text.appendChild(name);
        text.appendChild(stop);
        badge.appendChild(text);
        return badge;
    }
}

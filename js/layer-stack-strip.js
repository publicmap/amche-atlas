/**
 * LayerStackStrip - a vertical strip of thumbnail buttons for the layers
 * currently visible on the map, mounted directly below the map browser's
 * "Maps" button.
 *
 * Order matches the map's visual stack as defined by LayerOrderManager:
 * MapLayerControl._state.groups is already held in config/visual/URL order
 * (first = on top), so only the overlay/basemap split is applied - overlays
 * first, then basemaps - and the strip is painted top-to-bottom in that order.
 *
 * Each thumbnail is a LayerThumbnail, so clicking one opens that layer's info
 * panel (or zooms to it when it's out of view) exactly like the thumbnails in
 * map-browser.html. Hovering reveals the full layer title and its atlas name,
 * and isolates that layer through MapLayerControl's shared LayerIsolationManager.
 */
import { LayerThumbnail } from './layer-thumbnail.js';
import { LayerOrderManager } from './layer-order-manager.js';

const THUMB_SIZE = 36;

export class LayerStackStrip {
    constructor() {
        this._el = null;
        this._signature = null;
        this._refreshTimer = null;
        this._clearIsolationTimer = null;
        // Debounced: window.urlManager's active-layers state updates on its own
        // 300ms debounce (see CLAUDE.md), so reading it synchronously on
        // 'layer-toggled' would render from stale state.
        this._onChange = () => {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => this.render(), 400);
        };
    }

    mount(hostEl) {
        if (!hostEl || this._el) return;

        this._el = document.createElement('div');
        this._el.className = 'layer-stack-strip';
        hostEl.appendChild(this._el);

        // 'layersInitialized' is the signal that MapLayerControl has finished
        // building the groups this strip reads (it fires well after the control
        // is added to the map); the other two keep it in sync afterwards.
        window.addEventListener('layersInitialized', this._onChange);
        window.addEventListener('layer-toggled', this._onChange);
        window.addEventListener('urlUpdated', this._onChange);

        // The event may already have fired by the time this mounts.
        if (window.layersInitialized) this._onChange();
    }

    setVisible(visible) {
        if (!this._el) return;
        // Hiding the strip pulls it out from under the cursor, so no mouseleave
        // ever fires — drop any isolation it left applied.
        if (!visible) this._clearIsolation({ immediate: true });
        this._el.style.display = visible ? '' : 'none';
    }

    /**
     * Isolation is applied straight away, but clearing it is deferred by a frame
     * or two: moving the cursor from one thumbnail to the next fires mouseleave
     * before mouseenter, and letting that clear land would tear the whole stack
     * back on and immediately re-isolate - the visible lag between neighbours.
     * A pending clear is cancelled by the next isolate, so a layer-to-layer move
     * is a single re-isolation.
     */
    _isolate(layerId, isBasemap) {
        clearTimeout(this._clearIsolationTimer);
        window.layerControl?.isolation?.hoverIsolate(layerId, isBasemap);
    }

    _clearIsolation({ immediate = false } = {}) {
        clearTimeout(this._clearIsolationTimer);
        const clear = () => window.layerControl?.isolation?.clearHover();
        if (immediate) clear();
        else this._clearIsolationTimer = setTimeout(clear, 60);
    }

    destroy() {
        window.removeEventListener('layersInitialized', this._onChange);
        window.removeEventListener('layer-toggled', this._onChange);
        window.removeEventListener('urlUpdated', this._onChange);
        clearTimeout(this._refreshTimer);
        this._clearIsolation({ immediate: true });
        if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
        this._el = null;
    }

    /**
     * Rebuilds the strip, but only when the visible set or its order actually
     * changed - it is also called on every map 'idle' as a self-heal, so the
     * no-change case has to stay cheap.
     */
    render() {
        if (!this._el) return;
        // Hover isolation hides sibling layers on the map without toggling them
        // off; rebuilding mid-hover would drop the item under the cursor.
        if (this._el.querySelector('.layer-stack-item:hover')) return;

        const layers = this._getVisibleLayers();
        const signature = layers.map(l => l.id).join(',');
        if (signature === this._signature) return;
        this._signature = signature;

        this._el.innerHTML = '';
        layers.forEach(layer => this._el.appendChild(this._createItem(layer)));
    }

    /**
     * Visible layers in URL/visual order (first = top of the map stack).
     * The group entries carry the live state (opacity, sublayers); the registry
     * entry carries the full resolved config the thumbnail draws from, so they
     * are merged with the group winning.
     */
    _getVisibleLayers() {
        const groups = window.layerControl?._state?.groups || [];
        const urlManager = window.urlManager;
        if (!urlManager) return [];

        const visible = [];
        groups.forEach((group, index) => {
            // Internal scratch layer for inspected features, not a browsable map
            if (group.id === 'selection') return;
            if (!urlManager.isGroupActive(index)) return;

            const registryLayer = window.layerRegistry?.getLayer?.(group.id);
            visible.push(registryLayer ? { ...registryLayer, ...group } : group);
        });

        return LayerOrderManager.mapOrderToUrlOrder(visible);
    }

    _createItem(layer) {
        const item = document.createElement('div');
        item.className = 'layer-stack-item';

        const title = layer.title || layer.id;
        const atlasName = this._getAtlasName(layer);

        const thumbnail = LayerThumbnail.generate(layer, THUMB_SIZE, {
            layerDefaults: window.layerControl?._defaultStyles || {}
        });
        thumbnail.setAttribute('role', 'button');
        thumbnail.setAttribute('tabindex', '0');
        thumbnail.setAttribute('aria-label', atlasName ? `${title} (${atlasName})` : title);
        item.appendChild(thumbnail);

        const label = document.createElement('div');
        label.className = 'layer-stack-label';

        const titleEl = document.createElement('div');
        titleEl.className = 'layer-stack-label-title';
        titleEl.textContent = title;
        label.appendChild(titleEl);

        if (atlasName) {
            const atlasEl = document.createElement('div');
            atlasEl.className = 'layer-stack-label-atlas';
            atlasEl.textContent = atlasName;
            label.appendChild(atlasEl);
        }

        item.appendChild(label);

        // Hovering isolates the layer on the map — the same effect (and the same
        // messages) the feature control's marker badges use, so only this layer
        // and the layers in the other section (overlay vs basemap) stay visible.
        const isBasemap = LayerOrderManager.isBasemap(layer);
        const isolate = () => this._isolate(layer.id, isBasemap);
        const clearIsolation = () => this._clearIsolation();

        item.addEventListener('mouseenter', isolate);
        item.addEventListener('mouseleave', clearIsolation);
        item.addEventListener('focusin', isolate);
        item.addEventListener('focusout', clearIsolation);

        return item;
    }

    _getAtlasName(layer) {
        const atlasId = layer._sourceAtlas;
        if (!atlasId) return null;
        const metadata = window.layerRegistry?.getAtlasMetadata?.(atlasId);
        return metadata?.name || atlasId;
    }
}

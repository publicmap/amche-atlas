/**
 * The layer editor's header for an existing layer: its thumbnail, title and
 * badges, opacity, place in the stack, and the actions that work on the live
 * map - zoom, export, compare, isolate, mask and remove.
 *
 * Everything here acts on the map through the parent page (direct access to
 * its controls, or postMessage), so it works the same whether the editor is
 * showing the layer's overview or editing it. While the header is showing, the
 * layer is isolated (the others are dimmed); isolation survives the live
 * preview swapping the layer for a draft, because it only dims the *other*
 * layers.
 */

import { ZoomToParam } from './zoom-to-param.js';
import { LayerOrderManager } from './layer-order-manager.js';
import { RasterAdjust } from './raster-adjust.js';

export class LayerHeader {
    /**
     * @param {Object} options
     * @param {() => void} options.onClose - Close the whole panel
     * @param {(opacity: number) => void} [options.onOpacity] - The opacity slider moved
     * @param {(paint: Object) => void} [options.onPaint] - A raster adjustment slider moved
     */
    constructor({ onClose, onOpacity, onPaint } = {}) {
        this._onClose = onClose || (() => {});
        this._onOpacity = onOpacity || (() => {});
        this.raster = new RasterAdjust({ onChange: onPaint });
        this.layer = null;
        this.layerId = null;
        this.feature = null;
        this._isolateEnabled = true;
        this._isolatedLayerId = null;
        this._activeExport = null;
        this._exportHandler = (event) => this._handleExportProgress(event);
    }

    get embedded() {
        return window.self !== window.top;
    }

    bind() {
        $('#lh-close').on('click', () => this._onClose());
        $('#lh-remove').on('click', () => this._removeLayer());
        $('#lh-compare').on('click', () => this._toggleCompare());
        $('#lh-mask').on('click', () => this._toggleMask());
        $('#lh-isolate').on('click', () => this._toggleIsolate());
        $('#lh-move-up').on('click', () => this._moveLayer(-1));
        $('#lh-move-down').on('click', () => this._moveLayer(1));
        $('#lh-opacity').on('input', () => this._handleOpacityInput());
        this.raster.bind();
        $('#lh-zoom-feature').on('click', () => this._zoomToFeature());
        $('#lh-zoom-layer').on('click', (event) => this._zoomToLayer(event));
        document.querySelector('#lh-export-selected sl-menu')
            ?.addEventListener('sl-select', (e) => this._exportLayer('export-selected', e.detail.item?.value));
        document.querySelector('#lh-export-layer sl-menu')
            ?.addEventListener('sl-select', (e) => this._exportLayer('export-layer', e.detail.item?.value));
        window.addEventListener('pagehide', () => {
            this.release();
            this._stopListeningForExportProgress();
        });
    }

    /** Show a layer, and isolate it on the map. */
    render(layer, { feature = null } = {}) {
        this.layer = layer;
        this.layerId = layer.id || null;
        this.feature = feature;

        $('#lh-zoom-feature').toggle(!!feature);
        $('#lh-export-selected').toggle(!!feature);

        this._renderBadges(layer);
        this._updateOpacityUI(layer.opacity);
        this.raster.render(layer);
        this._updateCompareButton();
        this._updateMaskButton();
        this._updateZoomToLayerLink(layer);
        this.applyIsolation();
        this.updateOrderButtons();
    }

    /** The layer was renamed in the editor: keep acting on the right layer. */
    setLayerId(id) {
        if (!id || id === this.layerId) return;
        this.layerId = id;
        this.raster.setLayerId(id);
        this.applyIsolation();
        this.updateOrderButtons();
    }

    // -- badges and link -------------------------------------------------------

    /**
     * A link back to the current scene (layers, camera, everything in the
     * map's URL) that reopens this layer in the editor: `edit=<layer id>`
     * is read once on load (see openEditorFromUrl in js/map-init.js).
     */
    _shareableLink(layer) {
        const id = String($('#layer-id').val() || '').trim() || layer.id;
        const url = new URL(window.parent.location.href);
        if (id) url.searchParams.set('edit', id);
        return url.toString();
    }

    _renderBadges(layer) {
        const atlasId = layer._sourceAtlas;
        const layerId = layer.id || 'no-id';
        const copied = (selector, text) => {
            const $badge = $(selector);
            const original = $badge.text();
            $badge.addClass('copied').text('LINK COPIED!');
            setTimeout(() => $badge.removeClass('copied').text(original), 2000);
            return text;
        };

        const refreshLink = () => $('#lh-copy-link').attr('href', this._shareableLink(layer));
        refreshLink();
        $('#lh-copy-link').off('mouseenter focus').on('mouseenter focus', refreshLink);

        // The whole "#layer-id" copies the link while viewing; while editing the id is a text
        // field, so only the "#" does.
        $('#lh-id-group').off('click').on('click', (event) => {
            const onHash = $(event.target).closest('#lh-copy-link').length > 0;
            if (!onHash && !$('body').hasClass('is-viewing')) return;
            event.preventDefault();
            const link = this._shareableLink(layer);
            $('#lh-copy-link').attr('href', link);
            navigator.clipboard.writeText(link)
                .then(() => {
                    const $link = $('#lh-copy-link');
                    $link.text('✓');
                    setTimeout(() => $link.text('#'), 1500);
                })
                .catch(err => console.error('Failed to copy URL:', err));
        });

        if (layer._sourceAtlas) {
            const registry = window.parent?.layerRegistry;
            const meta = registry?.getAtlasMetadata?.(layer._sourceAtlas);
            const color = meta?.color || registry?.getAtlasColor?.(layer._sourceAtlas) || '#2563eb';
            const name = meta?.name || (layer._sourceAtlas.charAt(0).toUpperCase() + layer._sourceAtlas.slice(1));
            $('#lh-atlas-badge').text(name).css('background-color', color)
                .attr('title', `Click to copy link to the ${name} atlas config file`).show()
                .off('click').on('click', () => {
                    const url = this._atlasConfigUrl(layer._sourceAtlas);
                    if (url) navigator.clipboard.writeText(url).then(() => copied('#lh-atlas-badge')).catch(() => {});
                });
        } else {
            $('#lh-atlas-badge').hide();
        }
    }

    // The raw config URL for an atlas, preferring where an imported atlas was fetched from.
    _atlasConfigUrl(atlasId) {
        const registry = window.parent?.layerRegistry;
        const meta = registry?.getAtlasMetadata?.(atlasId);
        if (meta?.sourceUrl && /^https?:\/\//i.test(meta.sourceUrl)) return meta.sourceUrl;
        if (meta?.url && /^https?:\/\//i.test(meta.url)) return meta.url;
        if (/^https?:\/\//i.test(atlasId)) return atlasId;
        if (meta?.isImported) return null;
        return `https://raw.githubusercontent.com/publicmap/amche-atlas/refs/heads/dev/config/${atlasId}.atlas.json`;
    }

    // -- opacity ---------------------------------------------------------------

    _updateOpacityUI(opacity) {
        const pct = Math.round((opacity !== undefined ? opacity : 1) * 100);
        $('#lh-opacity').val(pct);
        $('#lh-opacity-value').text(`${pct}%`);
    }

    _handleOpacityInput() {
        if (!this.layer) return;
        const opacity = $('#lh-opacity').val() / 100;
        this.layer.opacity = opacity;
        $('#lh-opacity-value').text(`${Math.round(opacity * 100)}%`);
        this._onOpacity(opacity);
        if (this.embedded) {
            window.parent.postMessage({ type: 'update-layer-opacity', layerId: this.layerId, opacity }, '*');
        }
    }

    // -- zoom ------------------------------------------------------------------

    _zoomToLayer(event) {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
        event.preventDefault();
        if (!this.layer || !this.embedded) return;
        window.parent.postMessage({ type: 'zoom-to-layer', layerId: this.layerId }, '*');
    }

    _updateZoomToLayerLink(layer) {
        const registry = window.parent?.layerRegistry;
        const hasBbox = !!layer.bbox || !!(layer._sourceAtlas && registry?.getAtlasMetadata?.(layer._sourceAtlas)?.bbox);
        $('#lh-zoom-layer').attr('href', ZoomToParam.buildUrl(layer.id)).toggle(hasBbox);
    }

    _zoomToFeature() {
        if (!this.feature || !this.embedded) return;
        window.parent.postMessage({ type: 'zoom-to-feature', feature: this.feature }, '*');
    }

    // -- export ----------------------------------------------------------------

    _exportLayer(kind, format) {
        if (!format || !this.layer || !this.embedded) return;
        if (kind === 'export-selected' && !this.feature) return;
        if (this._activeExport) return;

        this._activeExport = { kind, format, label: format === 'csv' ? 'GeoCSV' : format.toUpperCase() };
        window.parent.addEventListener('map-export-progress', this._exportHandler);
        this._setExportState(0, 'Preparing');

        window.parent.postMessage({
            type: kind, format, layerId: this.layerId, feature: kind === 'export-selected' ? this.feature : null
        }, '*');

        const pending = this._activeExport;
        setTimeout(() => {
            if (this._activeExport === pending && !pending.started) this._setExportState(-1, 'Export failed');
        }, 3000);
    }

    _stopListeningForExportProgress() {
        try {
            window.parent.removeEventListener('map-export-progress', this._exportHandler);
        } catch (e) { /* parent gone */ }
    }

    _handleExportProgress(event) {
        if (!this._activeExport) return;
        this._activeExport.started = true;
        this._setExportState(event.detail.percent, event.detail.message);
    }

    _setExportState(percent, message) {
        const exporting = this._activeExport;
        const $btn = $(exporting.kind === 'export-selected' ? '#lh-export-selected' : '#lh-export-layer').find('button[slot="trigger"]');
        const $icon = $btn.find('sl-icon').first();
        const $text = $btn.find('span');
        const baseLabel = exporting.kind === 'export-selected' ? 'Export Selected' : 'Export Layer';
        const finish = (delay) => {
            this._stopListeningForExportProgress();
            setTimeout(() => {
                if (this._activeExport !== exporting) return;
                $icon.attr('name', 'download');
                $text.text(baseLabel);
                this._activeExport = null;
            }, delay);
        };

        if (percent < 0) {
            $btn.removeClass('processing');
            $icon.attr('name', 'x-circle');
            $text.text('Export failed');
            finish(2000);
        } else if (percent >= 100) {
            $btn.removeClass('processing');
            $icon.attr('name', 'check-circle');
            $text.text('Export complete');
            finish(1500);
        } else {
            $btn.addClass('processing');
            $icon.attr('name', 'arrow-clockwise');
            $text.text(`${exporting.label}: ${message} (${Math.round(percent)}%)`);
        }
    }

    // -- compare and mask ------------------------------------------------------

    _toggleCompare() {
        if (!this.layer) return;
        if (!this.embedded) { alert('Compare requires the map to be embedded.'); return; }
        const enabled = !this._isComparing();
        window.parent.postMessage({ type: 'toggle-compare', layerId: this.layerId, enabled }, '*');
        this._setCompareButton(enabled);
        setTimeout(() => this._updateCompareButton(), 600);
    }

    _isComparing() {
        if (!this.layer || !this.embedded) return false;
        return window.parent?.featureControl?._compareLayerId === this.layerId;
    }

    _setCompareButton(active) {
        const $btn = $('#lh-compare').toggleClass('comparing', active);
        $btn.find('.compare-icons').html(active
            ? '<sl-icon name="caret-left"></sl-icon><sl-icon name="caret-right-fill"></sl-icon>'
            : '<sl-icon name="caret-left"></sl-icon><sl-icon name="caret-right"></sl-icon>');
        $btn.find('span').not('.compare-icons').text(active ? 'Comparing' : 'Compare');
    }

    _updateCompareButton() {
        this._setCompareButton(this._isComparing());
    }

    _toggleMask() {
        if (!this.layer) return;
        if (!this.embedded) { alert('Masking requires the map to be embedded.'); return; }
        const enabled = !this._isMasking();
        window.parent.postMessage({ type: 'toggle-mask', layerId: this.layerId, enabled }, '*');
        this._setMaskButton(enabled);
        setTimeout(() => this._updateMaskButton(), 600);
    }

    _isMasking() {
        if (!this.layer || !this.embedded) return false;
        return window.parent?.maskManager?.getMaskSourceLayerId?.() === this.layerId;
    }

    _setMaskButton(active) {
        $('#lh-mask').toggleClass('masking', active).find('span').text(active ? 'Masking' : 'Toggle Mask');
    }

    _updateMaskButton() {
        this._setMaskButton(this._isMasking());
    }

    // -- isolation -------------------------------------------------------------

    /** Dim the other layers in this layer's section (on by default, toggled by "Hide Other Maps"). */
    applyIsolation() {
        this._setIsolateButton(this._isolateEnabled);
        if (!this.embedded || !this.layer) return;
        const isolation = window.parent?.layerControl?.isolation;
        if (!isolation) return;
        if (!this._isolateEnabled) {
            this.release();
            return;
        }
        isolation.isolate(this.layerId, LayerOrderManager.isBasemap(this.layer));
        this._isolatedLayerId = this.layerId;
    }

    release() {
        if (this._isolatedLayerId === null) return;
        this._isolatedLayerId = null;
        try {
            window.parent?.layerControl?.isolation?.clear();
        } catch (e) { /* parent gone */ }
    }

    _toggleIsolate() {
        if (!this.embedded) { alert('Isolation requires the map to be embedded.'); return; }
        this._isolateEnabled = !this._isolateEnabled;
        this.applyIsolation();
    }

    _setIsolateButton(active) {
        $('#lh-isolate').toggleClass('isolating', active).find('span').text(active ? 'Hiding Other Maps' : 'Hide Other Maps');
    }

    // -- layer order -----------------------------------------------------------

    // The layer's section of the stack, in the order the layer-stack strip lists it.
    _orderContext() {
        if (!this.embedded || !this.layer) return null;
        const parent = window.parent;
        const groups = parent?.layerControl?._state?.groups;
        const urlManager = parent?.urlManager;
        if (!groups || !urlManager) return null;

        const visible = [];
        groups.forEach((group, index) => {
            if (group.id === 'selection' || !urlManager.isGroupActive(index)) return;
            const registryLayer = parent.layerRegistry?.getLayer?.(group.id, null, true);
            visible.push(registryLayer ? { ...registryLayer, ...group } : group);
        });

        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(LayerOrderManager.mapOrderToUrlOrder(visible));
        const isBasemap = LayerOrderManager.isBasemap(this.layer);
        const ids = (isBasemap ? basemaps : overlays).map(l => l.id);
        return {
            overlayIds: overlays.map(l => l.id), basemapIds: basemaps.map(l => l.id), ids, isBasemap, index: ids.indexOf(this.layerId)
        };
    }

    updateOrderButtons() {
        const ctx = this._orderContext();
        const known = !!ctx && ctx.index !== -1;
        $('#lh-move-up').prop('disabled', !known || ctx.index === 0);
        $('#lh-move-down').prop('disabled', !known || ctx.index === ctx.ids.length - 1);
    }

    _moveLayer(delta) {
        const ctx = this._orderContext();
        if (!ctx || ctx.index === -1) return;
        const to = ctx.index + delta;
        if (to < 0 || to >= ctx.ids.length) return;

        const ids = [...ctx.ids];
        ids.splice(to, 0, ids.splice(ctx.index, 1)[0]);
        window.parent.postMessage({
            type: 'reorder-layers',
            overlayOrder: ctx.isBasemap ? ctx.overlayIds : ids,
            basemapOrder: ctx.isBasemap ? ids : ctx.basemapIds
        }, '*');
        setTimeout(() => this.updateOrderButtons(), 150);
    }

    // -- remove ----------------------------------------------------------------

    _removeLayer() {
        if (!this.layer) return;
        if (!this.embedded) { alert('Remove layer functionality requires the map to be embedded.'); return; }
        window.parent.postMessage({ type: 'remove-layer', layerId: this.layerId }, '*');
        setTimeout(() => this._onClose(), 200);
    }
}

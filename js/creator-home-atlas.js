/**
 * "Choose from Atlas" on the creator's home screen: the data sources behind the
 * layers the atlases offer for the current map view. Layers that point at the
 * same data (a tileset, a GeoJSON file, a service) are grouped under one
 * source, with a thumbnail for each layer that references it. Picking a layer
 * opens it in the layer panel after adding it to the map - in view mode, or ready to edit when customizing
 * (see MapBrowserControl's `creator-use-layer`).
 */

import { LayerThumbnail } from './layer-thumbnail.js';

const THUMB_SIZE = 34;
const MAX_THUMBS = 5;
const TYPE_LABELS = {
    vector: 'Vector tiles', geojson: 'GeoJSON', csv: 'CSV', tms: 'Raster tiles', wms: 'WMS',
    wmts: 'WMTS', cog: 'COG', img: 'Image', sheet: 'Sheet'
};

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function flattenBbox(bbox) {
    if (!Array.isArray(bbox)) return null;
    const flat = bbox.flat();
    return flat.length === 4 && flat.every(Number.isFinite) ? flat : null;
}

function intersectsView(bbox, view) {
    const box = flattenBbox(bbox);
    if (!box || !view) return true;
    return box[0] <= view[2] && box[2] >= view[0] && box[1] <= view[3] && box[3] >= view[1];
}

function sourceName(url, layers) {
    if (layers.length === 1) return layers[0].title || layers[0].id;
    try {
        const parsed = new URL(url.replace(/[{}]/g, ''));
        const path = parsed.pathname.split('/').filter(Boolean).filter(part => !/^(z|x|y|\d+)(\.\w+)?$/.test(part)).slice(-2).join('/');
        return `${parsed.hostname}${path ? `/${path}` : ''}`;
    } catch (error) {
        return url;
    }
}

export class AtlasPicker {
    constructor({ $list, onUse }) {
        this.$list = $list;
        this.onUse = onUse;
        this.layers = [];
        this.active = new Set();
        this.view = null;
        this.layerDefaults = {};
        this.selected = null;
    }

    setData({ layers, activeLayers, bounds, layerDefaults }) {
        this.layers = layers || [];
        this.active = new Set(activeLayers || []);
        this.view = bounds || this.view;
        this.layerDefaults = layerDefaults || {};
        this.render();
    }

    setBounds(bounds) {
        this.view = bounds;
        this.render();
    }

    sources() {
        const bySource = new Map();
        this.layers.forEach((layer) => {
            if (!layer.url || typeof layer.url !== 'string' || !layer.type) return;
            if (!intersectsView(layer.bbox, this.view)) return;
            if (!bySource.has(layer.url)) bySource.set(layer.url, []);
            bySource.get(layer.url).push(layer);
        });
        return [...bySource.entries()]
            .map(([url, layers]) => ({ url, layers, name: sourceName(url, layers), type: layers[0].type }))
            .sort((a, b) => b.layers.length - a.layers.length || a.name.localeCompare(b.name));
    }

    render() {
        const sources = this.sources();
        this.$list.empty();
        $('#ch-atlas-count').text(sources.length ? `${sources.length} in view` : '');
        if (!sources.length) {
            this.$list.append('<div class="ch-ds-empty">No data sources in this view. Pan the map to somewhere with maps, or paste a link instead.</div>');
            return;
        }
        sources.forEach((source) => this.$list.append(this.renderSource(source)));
    }

    renderSource(source) {
        const { url, layers, name, type } = source;
        const isOpen = this.selected?.url === url;
        const $row = $('<div class="ch-ds">').toggleClass('open', isOpen);
        const $head = $('<button type="button" class="ch-ds-head">');
        const $thumbs = $('<span class="ch-ds-thumbs">');
        layers.slice(0, MAX_THUMBS).forEach((layer) => {
            $thumbs.append(LayerThumbnail.generate(layer, THUMB_SIZE, { interactive: false, layerDefaults: this.layerDefaults, title: layer.title }));
        });
        if (layers.length > MAX_THUMBS) $thumbs.append(`<span class="ch-ds-more">+${layers.length - MAX_THUMBS}</span>`);

        const atlases = [...new Set(layers.map(l => l._sourceAtlas).filter(Boolean))];
        $head.append($thumbs).append(
            `<span class="ch-ds-text"><span class="ch-ds-name">${escapeHtml(name)}</span>` +
            `<span class="ch-ds-meta">${escapeHtml(TYPE_LABELS[type] || type)} · ${layers.length} ${layers.length === 1 ? 'layer' : 'layers'}` +
            `${atlases.length ? ` · ${escapeHtml(atlases.join(', '))}` : ''}</span></span>`
        );
        $head.on('click', () => {
            this.selected = isOpen ? null : { url, layerId: layers[0].id };
            this.render();
        });
        $row.append($head);
        if (isOpen) $row.append(this.renderActions(layers));
        return $row;
    }

    renderActions(layers) {
        const $actions = $('<div class="ch-ds-actions">');
        if (layers.length > 1) {
            const $picker = $('<div class="ch-ds-layers">');
            layers.forEach((layer) => {
                $('<button type="button" class="ch-ds-layer">')
                    .toggleClass('selected', layer.id === this.selected.layerId)
                    .text(layer.title || layer.id)
                    .on('click', () => {
                        this.selected.layerId = layer.id;
                        this.render();
                    })
                    .appendTo($picker);
            });
            $actions.append($picker);
        }
        const layer = layers.find(l => l.id === this.selected.layerId) || layers[0];
        const onMap = this.active.has(layer.id);
        const $buttons = $('<div class="ch-ds-buttons">');
        $('<button type="button" class="ch-ds-btn primary">')
            .html(onMap ? '<sl-icon name="eye"></sl-icon> View layer' : '<sl-icon name="plus-lg"></sl-icon> Add to map')
            .on('click', () => this.onUse(layer.id, false))
            .appendTo($buttons);
        $('<button type="button" class="ch-ds-btn">')
            .html('<sl-icon name="sliders"></sl-icon> Customize')
            .on('click', () => this.onUse(layer.id, true))
            .appendTo($buttons);
        return $actions.append($buttons);
    }
}

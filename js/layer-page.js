/**
 * The layer editor as one page (map-creator.html), for a new layer and for an
 * existing one: the layer's thumbnail, title and id, then its data source,
 * description and style as sections that stay compact until clicked.
 *
 * - The thumbnail opens the style editor.
 * - The data card (js/data-card.js) shows the link; clicking it opens the data
 *   source editor, with the output and field settings that go with the source.
 * - The description card (js/description-card.js) shows two lines of the
 *   description and one of the attribution; clicking it opens them as text.
 *
 * An existing layer also gets the header's live actions (js/layer-header.js)
 * and starts an edit session (source, live preview, Apply / Cancel) at once.
 */

import { LayerHeader } from './layer-header.js';
import { LayerThumbnail } from './layer-thumbnail.js';
import { DescriptionCard } from './description-card.js';
import { renderOverview } from './layer-overview.js';

export class LayerPage {
    constructor(creator) {
        this.creator = creator;
        this.active = false;
        this.layer = null;
        this.description = new DescriptionCard();
        this.header = new LayerHeader({
            onClose: () => creator.closeBrowser(),
            onOpacity: () => this.refresh(),
            getConfig: () => this.currentConfig()
        });
    }

    init() {
        this.header.bind();
        this.description.init();
        $('#lh-thumbnail').on('click', () => this.setStyleOpen(!this.styleOpen));
        $('#style-done').on('click', () => this.setStyleOpen(false));
        // Renaming the layer in the form: keep isolation and ordering on the right layer.
        $('#layer-id').on('change', (event) => this.header.setLayerId(event.target.value.trim()));

        // A new layer has nothing to look at yet, so its style editor starts open.
        this.setStyleOpen(true);
        this.refresh();
    }

    /**
     * Open an existing layer.
     * @param {Object} layer
     * @param {{tab?: 'edit'|'style'|'data', feature?: Object|null}} [options] which section to open first
     */
    open(layer, { tab = 'edit', feature = null } = {}) {
        this.active = true;
        this.layer = layer;
        $('#edit-tab, #edit-footer, #layer-actions').removeClass('hidden');
        this.header.render(layer, { feature });

        $('#layer-title').val(layer.title || layer.id || '');
        $('#layer-id').val(layer.id || '');
        $('#layer-description').val(layer.description || '');
        $('#layer-attribution').val(layer.attribution || '');
        $('#creator-heading').text('Edit Map Layer');

        this.setStyleOpen(tab === 'style');
        if (!this.creator.edit.active) this.creator.edit.start(layer);
        if (tab === 'data') this.creator.dataCard.setCollapsed(false);
        this.refresh();
    }

    get styleOpen() {
        return !$('#style-section').hasClass('hidden');
    }

    setStyleOpen(open) {
        $('#style-section').toggleClass('hidden', !open);
        $('#lh-thumbnail').toggleClass('is-open', open);
        if (open) this.creator.styleEditor.sync();
    }

    // The layer as edited so far.
    currentConfig() {
        try {
            const parsed = JSON.parse($('#config-preview').val());
            if (parsed && typeof parsed === 'object') return { ...this.layer, ...parsed };
        } catch (error) { /* no config yet, or invalid JSON mid-edit */ }
        return this.layer || {};
    }

    /** Redraw what is derived from the form: thumbnail, description summary, legend and metadata. */
    refresh() {
        this.description.refresh();
        const config = this.currentConfig();
        const key = JSON.stringify(config);
        if (key === this._renderedKey) return;
        this._renderedKey = key;
        $('#lh-thumbnail').empty().append(LayerThumbnail.generate(config, 54, { interactive: false, actionGlyph: '🎨' }));
        renderOverview(config);
    }
}

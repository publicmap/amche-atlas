/**
 * The layer editor as one page for an existing layer (map-creator.html):
 * a header with the layer's identity and live actions, and two tabs - Overview
 * (what the layer is) and Edit (the form that adds or edits a layer).
 *
 * A new layer has no header and no tabs, just the Edit form; opening an
 * existing layer shows the same page with the header, on whichever tab was
 * asked for. The edit session (source, live preview, Apply / Cancel) starts
 * the first time the Edit tab is shown.
 */

import { LayerHeader } from './layer-header.js';
import { renderOverview, bindOverview } from './layer-overview.js';

export class LayerPage {
    constructor(creator) {
        this.creator = creator;
        this.active = false;
        this.layer = null;
        this.tab = 'edit';
        this.header = new LayerHeader({
            onClose: () => creator.closeBrowser(),
            onOpacity: () => { if (this.tab === 'overview') this._renderOverview(); }
        });
    }

    init() {
        this.header.bind();
        bindOverview();
        $('#page-tab-overview').on('click', () => this.showTab('overview'));
        $('#page-tab-edit').on('click', () => this.showTab('edit'));
        // Renaming the layer in the form: keep isolation and ordering on the right layer.
        $('#layer-id').on('change', (event) => this.header.setLayerId(event.target.value.trim()));
    }

    /**
     * Open an existing layer.
     * @param {Object} layer
     * @param {{tab?: 'overview'|'edit', feature?: Object|null}} [options]
     */
    open(layer, { tab = 'overview', feature = null } = {}) {
        this.active = true;
        this.layer = layer;
        $('#layer-header, #page-tabs').removeClass('hidden');
        this.header.render(layer, { feature });
        this.showTab(tab === 'edit' ? 'edit' : 'overview');
    }

    showTab(tab) {
        this.tab = tab;
        const editing = tab === 'edit';
        $('#page-tab-overview').toggleClass('page-tab-active', !editing);
        $('#page-tab-edit').toggleClass('page-tab-active', editing);
        $('#overview-tab').toggleClass('hidden', editing);
        $('#edit-tab, #edit-footer').toggleClass('hidden', !editing);
        $('#creator-heading').text(editing ? 'Edit Map Layer' : 'Layer');

        if (editing) {
            if (!this.creator.edit.active) this.creator.edit.start(this.layer);
        } else {
            this._renderOverview();
        }
    }

    // While an edit is in progress the overview shows the layer as edited so far.
    currentConfig() {
        if (this.creator.edit.active) {
            try {
                return { ...this.layer, ...JSON.parse($('#config-preview').val()) };
            } catch (error) { /* mid-edit invalid JSON: fall back to the layer */ }
        }
        return this.layer;
    }

    _renderOverview() {
        renderOverview(this.currentConfig());
    }
}

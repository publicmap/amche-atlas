/**
 * The layer editor's Data card: the data source as one card.
 *
 * Collapsed (a layer that already has data), it shows the link and, beneath it,
 * the layer type, with an icon for the kind of data (see js/source-icons.js).
 * Expanded, the link becomes an input; the upload button shows only while the
 * input is empty, and a "supported formats" link opens a help section of cards
 * - icon, description and an example link to try.
 */

import { describeSource } from './source-icons.js';
import { describeLayerSource } from './creator-edit-mode.js';

const PLACEHOLDER_TITLE = 'Paste a link or upload a file';

export class DataCard {
    constructor(creator) {
        this.creator = creator;
        this._collapsed = false;
        this._collapsible = false;
        this._viewLayer = null;
    }

    /** Show a layer's source as a card while it is only being viewed (not loaded into the form). */
    setView(layer) {
        this._viewLayer = layer;
        this._collapsible = false;
        this.setCollapsed(true);
        this.refresh();
    }

    _viewSource() {
        const source = describeLayerSource(this._viewLayer);
        if (source.kind === 'url') return source.value;
        if (source.kind === 'overpass') return String(source.value).split('\n')[0];
        if (source.kind === 'local' || source.kind === 'inline') return 'Data stored with this layer';
        return 'No data source of its own';
    }

    init() {
        $('#data-card-toggle').on('click', (event) => {
            event.stopPropagation();
            this.setCollapsed(!this._collapsed);
        });
        // The whole header opens or closes the card, as the Edit button does.
        $('#data-card .data-card-head').on('click', (event) => {
            if (this._collapsible && !$(event.target).closest('#data-card-toggle').length) this.setCollapsed(!this._collapsed);
        });

        $('#url-input').on('input', () => this.refresh());
        $('#clear-url-btn').on('click', () => this.refresh());

        $('#formats-toggle').on('click', (event) => {
            event.preventDefault();
            const open = $('#formats-help').hasClass('hidden');
            $('#formats-help').toggleClass('hidden', !open);
            $('#formats-toggle').attr('aria-expanded', String(open));
        });

        this.refresh();
    }

    /** Editing a layer that has data: start collapsed, and let the Edit button open it. */
    enterEditMode(hasSource) {
        this._viewLayer = null;
        this._collapsible = hasSource;
        $('#data-card-toggle').toggleClass('hidden', !hasSource);
        this.setCollapsed(true);
        this.refresh();
    }

    setCollapsed(collapsed) {
        this._collapsed = collapsed;
        $('#data-card').toggleClass('is-collapsed', collapsed);
        $('#data-card-toggle')
            .attr('title', collapsed ? 'Edit the data source' : 'Collapse')
            .html(collapsed
                ? '<sl-icon name="pencil"></sl-icon> <span>Edit</span>'
                : '<sl-icon name="chevron-up"></sl-icon> <span>Done</span>');
    }

    get collapsed() {
        return this._collapsed;
    }

    // The link or file being used, for the card's title.
    _title() {
        const creator = this.creator;
        if (this._viewLayer && !creator.edit.active) return this._viewSource();
        const url = $('#url-input').val().trim();
        if (url) return url;

        const files = $('#file-input')[0] && $('#file-input')[0].files;
        if (files && files.length) return files.length === 1 ? files[0].name : `${files.length} files`;

        if (!$('#overpass-section').hasClass('hidden') && $('#overpass-query').val().trim()) {
            return $('#overpass-query').val().trim().split('\n')[0];
        }
        if (creator.edit.active) {
            if (creator.edit.source.kind === 'local' || creator.edit.source.kind === 'inline') return 'Data stored with this layer';
            if (!creator.edit.supported) return 'No data source of its own';
        }
        return PLACEHOLDER_TITLE;
    }

    _layerType() {
        const creator = this.creator;
        if (this._viewLayer && !creator.edit.active) return this._viewLayer.type;
        // An edited layer shows its own type until a different source is loaded.
        if (creator.edit.active && !creator.edit.sourceChanged && creator.edit.layer) return creator.edit.layer.type;
        if (!creator.currentLayerType) return undefined;
        return creator.currentLayerType === 'geojson-url' ? 'geojson' : creator.currentLayerType;
    }

    /** Redraw the card's icon, tooltip, link and layer type from what is being used now. */
    refresh() {
        const viewing = this._viewLayer && !this.creator.edit.active;
        const url = viewing ? (describeLayerSource(this._viewLayer).value || '') : $('#url-input').val().trim();
        const { icon, tooltip, subtitle } = describeSource({ url: typeof url === 'string' && url ? url : undefined, layerType: this._layerType() });
        const title = this._title();

        $('#data-card-icon').attr('name', icon);
        $('#data-card-tooltip').attr('content', tooltip);
        $('#data-card-title').text(title).attr('title', title);
        $('#data-card-subtitle').text(subtitle);

        // Upload is the way in only while there is no link.
        $('#upload-file-btn').toggleClass('hidden', url !== '');
    }
}

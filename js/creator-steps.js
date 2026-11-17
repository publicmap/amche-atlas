/**
 * The layer editor's steps (map-creator.html), in the order they apply to a
 * layer: Data source, Filter, Features, Style. A step shows only once there
 * is something for it, and is numbered among those showing:
 *
 *  - Data source: always. Its Source settings (layer type, bbox) only once a
 *    link or file is loaded, not for a layer drawn on the map.
 *  - Filter: for a layer with features (not a raster), once it has some.
 *    Viewing, only when the layer has a filter. Edit opens the style editor's
 *    Rules, where filters live.
 *  - Features: while editing, for data the editor holds (the table and drawing,
 *    js/creator-features.js) or fields it knows (the Feature popup).
 *  - Style: once there is a layer; its legend, and Edit for the style editor.
 *
 * Above the steps, the layer's own options: Shareable (js/creator-feature-share.js)
 * and its Configuration JSON, which opens on demand.
 */

import { collectFilters } from './style-rules.js';
import { stripInternal } from './creator-edit-mode.js';

const NO_FEATURES = new Set(['tms', 'wms', 'wmts', 'cog', 'img', 'raster-style-layer', 'style', 'layer-group', 'atlas']);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export class CreatorSteps {
    constructor(creator) {
        this.creator = creator;
        this._ready = false;
    }

    init() {
        const page = this.creator.layerPage;
        $('#filter-edit-btn').on('click', () => page.openStyleAt(null));
        $('#style-toggle').on('click', () => {
            if (!page.editing) page.enterEdit({ style: true });
            else page.setStyleOpen(!page.styleOpen);
        });
        $('#config-toggle').on('click', () => this.setConfigOpen($('#config-panel').hasClass('hidden')));
        this._ready = true;
        this.refresh();
    }

    setConfigOpen(open) {
        $('#config-panel').toggleClass('hidden', !open);
        $('#config-toggle').attr('aria-expanded', String(open));
        if (open) this._fillViewedConfig();
    }

    // Viewing, the JSON is the layer as it stands, read only; Edit makes it editable.
    _fillViewedConfig() {
        const page = this.creator.layerPage;
        const viewing = page.active && !page.editing;
        $('#config-preview').prop('readonly', viewing);
        if (viewing && page.layer) $('#config-preview').val(JSON.stringify(stripInternal(page.layer), null, 2));
    }

    refresh() {
        if (!this._ready) return;
        const creator = this.creator;
        const page = creator.layerPage;
        const features = creator.features;
        const viewing = page.active && !page.editing;
        const config = page.currentConfig() || {};
        const type = config.type || creator.currentLayerType;
        // An existing layer has its steps even while (or if) its source fails to load.
        const loaded = (page.active && !!page.layer) || !!creator.currentLayerType;
        const hasFeatures = loaded && !NO_FEATURES.has(type);
        const filters = hasFeatures ? collectFilters(config.style, config.filter) : [];
        const collection = viewing ? null : features.collection;
        const fieldsKnown = !viewing && $('#data-fields-section').css('display') !== 'none';
        const hasRows = !!collection?.features?.length;

        // Nothing to filter until there is a feature (a new drawn layer).
        const filterable = viewing ? filters.length > 0 : !collection || hasRows || filters.length > 0;
        this._show('#step-filter', hasFeatures && filterable);
        this._show('#step-features', !viewing && hasFeatures && (!!collection || fieldsKnown));
        this._show('#step-style', loaded);
        this._number();

        $('#filter-summary').text(filters.length
            ? `Only features matching ${filters.length === 1 ? 'this filter' : `these ${plural(filters.length, 'filter')}`} are shown.`
            : 'Every feature is shown.');
        $('#filter-edit-btn span').text(filters.length ? 'Edit' : 'Add filter');

        const sourceSettings = !viewing && !!creator.currentLayerType && !features.isDrawn;
        $('#source-settings').toggleClass('hidden', !sourceSettings);
        const typeLabel = $(`#layer-type option[value="${type}"]`).text() || $('#layer-type option:selected').text();
        $('#source-settings-summary').text(typeLabel.split(' - ')[0] || '');

        $('#popup-settings').toggleClass('hidden', !fieldsKnown || (!!collection && !hasRows));
        const nameField = $('#feature-name-field').val();
        const shown = $('#inspect-fields-list input:checked').length;
        $('#popup-settings-summary').text([nameField && `titled by ${nameField}`, shown && plural(shown, 'field')].filter(Boolean).join(' · '));
        if (collection && !hasRows) $('#data-preview-details').hide();

        const styleOpen = page.styleOpen;
        $('#style-toggle').html(styleOpen
            ? '<sl-icon name="check2"></sl-icon> <span>Done</span>'
            : '<sl-icon name="pencil"></sl-icon> <span>Edit</span>');
        $('#lo-legend-section').toggleClass('hidden', styleOpen);

        features.share.render(config, { editing: !viewing, holdsData: features.editable });
        if (!$('#config-panel').hasClass('hidden')) $('#config-preview').prop('readonly', viewing);
    }

    _show(selector, visible) {
        $(selector).toggleClass('hidden', !visible);
    }

    _number() {
        $('#edit-tab > .step:not(.hidden) .step-num').each((index, el) => { el.textContent = String(index + 1); });
    }
}

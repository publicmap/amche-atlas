/**
 * The layer editor as one page (map-creator.html), for a new layer and for an
 * existing one: the layer's thumbnail, title and id, then its data source,
 * description and style as sections.
 *
 * An existing layer opens in view mode: everything is read-only and the footer
 * has an Edit Layer button in the title bar. Edit starts an edit session, where
 * - the thumbnail opens the style editor,
 * - the data card (js/data-card.js) opens the data source editor,
 * - the description card (js/description-card.js) opens the full text,
 * and the title bar offers Undo / Redo (js/edit-history.js) and Save Layer (back
 * to view mode); closing the panel with × cancels: the original is restored and
 * nothing is saved.
 * A new layer is always in edit mode.
 *
 * The header's live actions (js/layer-header.js) work in both modes.
 */

import { LayerHeader } from './layer-header.js';
import { LayerThumbnail } from './layer-thumbnail.js';
import { DescriptionCard } from './description-card.js';
import { EditHistory } from './edit-history.js';
import { renderOverview } from './layer-overview.js';
import { collectFilters, describeExpression, LAYER_FILTER_KEY } from './style-rules.js';

const RECORD_DELAY = 400;
const RESTORE_SETTLE = 900;

export class LayerPage {
    constructor(creator) {
        this.creator = creator;
        this.active = false;
        this.layer = null;
        this.mode = 'edit';
        this.description = new DescriptionCard();
        this.history = new EditHistory();
        this._baselined = false;
        this._restoring = false;
        this._pending = null;
        this.header = new LayerHeader({
            onClose: () => creator.closeBrowser(),
            onOpacity: () => this.refresh()
        });
    }

    init() {
        this.header.bind();
        this.description.init();
        $('#lh-thumbnail').on('click', () => this.setStyleOpen(!this.styleOpen));
        $('#style-done').on('click', () => this.setStyleOpen(false));
        $('#edit-btn').on('click', () => this.enterEdit());
        $('#undo-btn').on('click', () => this._step(-1));
        $('#redo-btn').on('click', () => this._step(1));
        // Renaming the layer in the form: keep isolation and ordering on the right layer.
        $('#layer-id').on('change', (event) => this.header.setLayerId(event.target.value.trim()));

        // A new layer has nothing to look at yet, so its style editor starts open.
        this.setMode('edit');
        this.setStyleOpen(true);
        this.refresh();
    }

    get editing() {
        return this.mode === 'edit';
    }

    /**
     * Open an existing layer, in view mode unless asked for a section to edit.
     * @param {Object} layer
     * @param {{tab?: 'view'|'edit'|'style'|'data', feature?: Object|null}} [options]
     */
    open(layer, { tab = 'view', feature = null } = {}) {
        this.active = true;
        $('#edit-tab, #nav-actions, #layer-actions, #lh-remove').removeClass('hidden');
        this.header.render(layer, { feature });
        this._show(layer);
        if (tab !== 'view') this.enterEdit({ style: tab === 'style', data: tab === 'data' });
    }

    // The layer as it stands, read-only.
    _show(layer) {
        this.layer = layer;
        $('#layer-title').val(layer.title || layer.id || '');
        $('#layer-id').val(layer.id || '');
        $('#layer-description').val(layer.description || '');
        $('#layer-attribution').val(layer.attribution || '');
        this.creator.dataCard.setView(layer);
        this.description.setOpen(false);
        this.setStyleOpen(false);
        this.setMode('view');
        this._renderedKey = null;
        this.history.reset(null);
        this._baselined = false;
        this.refresh();
    }

    setMode(mode) {
        this.mode = mode;
        const viewing = mode === 'view';
        $('body').toggleClass('is-viewing', viewing);
        $('.lh-title-input, .lh-id-input').prop('readonly', viewing);
        $('#edit-btn').toggleClass('hidden', !viewing);
        $('#add-to-map-btn').toggleClass('hidden', viewing);
        $('#remove-other-maps-btn').toggleClass('hidden', viewing || this.active);
        $('#edit-history').toggleClass('hidden', viewing || !this.active);
        this.updateHistoryButtons();
    }

    // -- edit session ----------------------------------------------------------

    enterEdit({ style = false, data = false, rule = null, clearFilter = null } = {}) {
        if (this.editing && this.creator.edit.active) return;
        this._pending = { style, data, rule, clearFilter };
        this.setMode('edit');
        this.creator.edit.start(this.layer);
    }

    /** The source has loaded and the form is filled in: the layer as the edit begins. */
    onEditSeeded() {
        if (!this._baselined) {
            this._baselined = true;
            this.history.reset(this._snapshot());
        }
        this.updateHistoryButtons();
        const pending = this._pending;
        this._pending = null;
        if (!pending) return;
        if (pending.style) this.openStyleAt(pending.rule);
        if (pending.data) this.creator.dataCard.setCollapsed(false);
        if (pending.clearFilter) this.clearFilter(pending.clearFilter);
    }

    /** Cancel: the original layer comes back and nothing is saved. */
    cancelEdit() {
        clearTimeout(this._recordTimer);
        this.creator.clearPreview();
        this.creator.edit.stop();
        this._leaveEdit(this.layer);
    }

    /** Save Layer: the draft is now the layer; back to view mode on it. */
    finishEdit(config) {
        clearTimeout(this._recordTimer);
        const applied = config || this._parsedConfig() || this.layer;
        this.creator.edit.stop();
        this._leaveEdit(applied);
    }

    _leaveEdit(layer) {
        this.header.render(layer, { feature: this.header.feature });
        this._show(layer);
        // The layer is put back on the map a moment after the preview is cleared or applied.
        setTimeout(() => {
            this.header.setLayerId(layer.id);
            this.header.applyIsolation();
        }, 800);
    }

    // -- data filters ------------------------------------------------------------

    _renderFilters(config) {
        const $row = $('#lh-filters');
        $row.children('.filter-chip').remove();
        const filters = collectFilters(config.style, config.filter);
        $row.css('display', filters.length ? 'flex' : 'none');
        filters.forEach(filter => {
            const text = `${filter.scope}: ${describeExpression(filter.value).text}`;
            const $chip = $('<span>', { class: 'filter-chip', title: `${text}\nClear this filter` });
            $chip.append($('<span>', { class: 'filter-chip-text', text }));
            $chip.append($('<button>', { type: 'button', class: 'filter-chip-clear', text: '×', 'aria-label': `Clear filter: ${text}` })
                .on('click', () => this.clearFilter(filter.key)));
            $row.append($chip);
        });
    }

    /** Remove a data filter from the layer (the layer's own, or one inside its style). Starts an edit from view mode. */
    clearFilter(key) {
        if (!this.editing) {
            this.enterEdit({ clearFilter: key });
            return;
        }
        const config = this._parsedConfig();
        if (!config) return;
        if (key === LAYER_FILTER_KEY) delete config.filter;
        else if (config.style) delete config.style[key];
        this.creator.applyConfigSnapshot(config);
    }

    // -- undo / redo -----------------------------------------------------------

    _parsedConfig() {
        try {
            const parsed = JSON.parse($('#config-preview').val());
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (error) {
            return null;
        }
    }

    _snapshot() {
        const config = this._parsedConfig();
        return config ? JSON.stringify(config) : null;
    }

    _scheduleRecord() {
        clearTimeout(this._recordTimer);
        this._recordTimer = setTimeout(() => {
            const snapshot = this._snapshot();
            if (snapshot && this.history.record(snapshot)) this.updateHistoryButtons();
        }, RECORD_DELAY);
    }

    _step(direction) {
        clearTimeout(this._recordTimer);
        const snapshot = direction < 0 ? this.history.undo() : this.history.redo();
        if (!snapshot) return;
        const config = JSON.parse(snapshot);
        this._restoring = true;
        this.creator.applyConfigSnapshot(config);
        this.header.setLayerId(config.id);
        this.updateHistoryButtons();
        clearTimeout(this._restoreTimer);
        this._restoreTimer = setTimeout(() => { this._restoring = false; }, RESTORE_SETTLE);
    }

    updateHistoryButtons() {
        $('#undo-btn').prop('disabled', !this.history.canUndo);
        $('#redo-btn').prop('disabled', !this.history.canRedo);
    }

    // -- style -----------------------------------------------------------------

    get styleOpen() {
        return !$('#style-section').hasClass('hidden');
    }

    setStyleOpen(open) {
        $('#style-section').toggleClass('hidden', !open);
        $('#lh-thumbnail').toggleClass('is-open', open);
        if (open) this.creator.styleEditor.sync();
    }

    /** Open the style editor on the Rules tab, at one rule when the legend item of a rule was clicked. */
    openStyleAt(ruleId) {
        if (!this.editing) {
            this.enterEdit({ style: true, rule: ruleId });
            return;
        }
        this.setStyleOpen(true);
        const editor = this.creator.styleEditor.editor;
        if (!editor) return;
        if (ruleId) editor.openRule(ruleId);
        else editor.setTab('rules');
        document.getElementById('style-section').scrollIntoView({ block: 'nearest' });
    }

    // The layer as edited so far.
    currentConfig() {
        const parsed = this.editing && this.creator.edit.active ? this._parsedConfig() : null;
        return parsed || this.layer || this._parsedConfig() || {};
    }

    /** Redraw what is derived from the form: thumbnail, description summary, legend and metadata. */
    refresh() {
        this.description.refresh();
        if (this._baselined && !this._restoring && this.creator.edit.active) this._scheduleRecord();
        const config = this.currentConfig();
        const key = JSON.stringify(config);
        if (key === this._renderedKey) return;
        this._renderedKey = key;
        $('#lh-thumbnail').empty().append(LayerThumbnail.generate(config, 54, { interactive: false, actionGlyph: '🎨' }));
        this._renderFilters(config);
        renderOverview(config, { onLegendSelect: (ruleId) => this.openStyleAt(ruleId) });
    }
}

/**
 * The layer editor's Features section (map-creator.html): a layer's features
 * as a table (js/creator-feature-table.js), with drawing on the map
 * (js/feature-draw.js) for a layer whose data the editor holds. "Add Map" and
 * the Data card's Clear start one with no data; each drawn feature gets `fid`,
 * `$rowid` and `name` and a key / value form (js/creator-feature-form.js).
 * Data read from a link is read only, with "Make an editable copy"
 * (js/creator-feature-copy.js); Shareable is js/creator-feature-share.js.
 */

import { FeatureTable } from './creator-feature-table.js';
import { FeatureForm } from './creator-feature-form.js';
import { FeatureShare } from './creator-feature-share.js';
import {
    emptyCollection, defaultProperties, addFeature, removeFeature, removeColumn, addColumn,
    setProperty, setProperties, parseCellValue, compactCollection, geometryBbox, roundGeometry
} from './feature-table-data.js';
import { SOURCE_KEYS } from './creator-edit-mode.js';
import { makeEditableCopy, COPY_SOURCE } from './creator-feature-copy.js';

export const DRAWN_SOURCE = 'drawn';
export const UNTITLED = 'Untitled map';

const FORM_KEYS = new Set(['id', 'title', 'type', 'description', 'attribution', 'license', 'bbox', 'initiallyChecked', 'inspect', 'shareable']);
const HINTS = [
    'Click the map to start a feature.',
    'Click the point again to place a point, or click elsewhere to draw a line.',
    'Keep clicking to add points, or click the last point to end the line. Esc cancels.',
    'Click the first point to close an area, or the last point to end the line. Esc cancels.'
];

const isUrl = (value) => typeof value === 'string' && /^https?:\/\//.test(value);
const post = (message) => window.parent.postMessage(message, '*');
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export class CreatorFeatures {
    constructor(creator) {
        this.creator = creator;
        this.drawing = false;
        this.share = new FeatureShare({ onChange: () => creator.updateConfigPreview() });
    }

    init() {
        this.$section = $('#features-section');
        const collection = () => this.collection;
        this.table = new FeatureTable($('#features-table'), {
            onEdit: (index, key, text) => {
                setProperty(collection(), index, key, parseCellValue(text, collection().features[index]?.properties?.[key]));
                this.changed({ table: false });
            },
            onDeleteRow: (index) => {
                removeFeature(collection(), index);
                this.form.shift(index);
                this.changed();
            },
            onDeleteColumn: (key) => {
                removeColumn(collection(), key);
                this.changed();
            },
            onAddColumn: (key) => {
                if (!key) return this.renderTable();
                addColumn(collection(), key);
                this.changed();
            },
            onZoom: (index) => this.zoomTo(index)
        });
        this.form = new FeatureForm($('#features-form'), {
            onChange: (index, properties) => {
                setProperties(collection(), index, properties);
                this.changed({ debounce: true });
            },
            onDelete: (index) => {
                removeFeature(collection(), index);
                this.changed();
            },
            onClose: () => this.renderTable()
        });

        $('#features-draw-btn').on('click', () => this.setDrawing(!this.drawing));
        $('#features-copy-btn').on('click', () => this.makeEditableCopy());
        this.share.init();
        window.addEventListener('message', (event) => {
            if (event.data?.type === 'draw-complete') this._onDrawn(event.data.geometry);
            if (event.data?.type === 'draw-state') this._hint(event.data.count);
        });
        window.addEventListener('pagehide', () => { if (this.drawing) post({ type: 'draw-stop' }); });
        this.render();
    }

    /** The FeatureCollection the editor holds, or null for a layer it only links to. */
    get collection() {
        const creator = this.creator;
        if (creator.currentLayerType === 'geojson') return creator.currentData?.features ? creator.currentData : null;
        if (creator.currentLayerType === 'csv') return creator.currentData?.geojson || null;
        return null;
    }

    get isDrawn() {
        return this.creator.currentDataSource === DRAWN_SOURCE;
    }

    get editing() {
        const page = this.creator.layerPage;
        return !page.active || (page.editing && this.creator.edit.active);
    }

    /** Data the editor holds itself (drawn, a file, a copy, stored with the layer): it can be edited. */
    get editable() {
        const creator = this.creator;
        return this.editing && creator.currentLayerType === 'geojson' && !!this.collection && !isUrl(creator.currentDataSource);
    }

    get canClear() {
        const creator = this.creator;
        if (!this.editing || (this.isDrawn && !this.collection?.features.length)) return false;
        return creator.edit.active ? creator.edit.supported : !!creator.currentLayerType;
    }

    /** The Data card's title for data the editor holds itself. */
    sourceTitle() {
        const count = this.collection?.features.length || 0;
        if (this.isDrawn) return count ? `Drawn on the map · ${plural(count, 'feature')}` : 'No data yet: draw on the map, paste a link or upload a file';
        if (this.creator.currentDataSource === COPY_SOURCE) return `Editable copy · ${plural(count, 'feature')}`;
        return null;
    }

    // -- starting points ---------------------------------------------------------

    /** "Add Map": a new layer with no data, drawing on. */
    startBlank() {
        const creator = this.creator;
        $('#layer-title').val(UNTITLED);
        $('#layer-id').val(creator.generateId(UNTITLED));
        creator.processGeoJSON(emptyCollection(), DRAWN_SOURCE);
        creator._previewFitted = true;
        $('#add-to-map-btn').prop('disabled', true);
        this.setDrawing(true);
        creator.steps.refresh();
    }

    /** Clear in the Data card: drop the layer's data source and keep its description and style. */
    clearSource() {
        const creator = this.creator;
        const config = creator.layerPage._parsedConfig() || {};
        const kept = {};
        Object.keys(config).forEach(key => { if (!SOURCE_KEYS.has(key) && !FORM_KEYS.has(key)) kept[key] = config[key]; });

        creator.service.reset();
        creator.hideOverpassSection();
        $('#url-input').val('');
        $('#clear-url-btn, #selected-file-info, #edit-unsupported-note, #edit-style-choice').addClass('hidden');
        const fileInput = $('#file-input')[0];
        if (fileInput) fileInput.value = '';
        creator._resolveOptions = null;
        if (creator.edit.active) {
            creator.edit.source = { kind: 'local' };
            creator.edit.supported = true;
            creator.edit.sourceChanged = true;
        }

        creator.currentLayerType = 'geojson';
        creator.currentDataSource = DRAWN_SOURCE;
        creator.currentData = emptyCollection();
        creator._previewFitted = true;
        creator._layerConfigOverride = kept;
        creator._styleManuallyEdited = !!kept.style;
        $('#layer-type').val('geojson');
        creator.showConfigSection();
        this.form.close();
        this.changed();
        this.render();
        this.setDrawing(true);
    }

    /** A source finished loading. */
    onLoaded() {
        if (!this.$section) return;
        const creator = this.creator;
        // A blank map's placeholder title gives way to one from what was imported.
        if (!this.isDrawn && $('#layer-title').val() === UNTITLED && ['geojson', 'csv'].includes(creator.currentLayerType)) {
            $('#layer-title').val('');
            creator.showConfigSection();
            creator.updateConfigPreview();
        }
        this.form.close();
        this.render();
    }

    // -- edits -----------------------------------------------------------------------

    _onDrawn(geometry) {
        const collection = this.collection;
        if (!this.editable || !geometry || !collection) return;
        const index = addFeature(collection, roundGeometry(geometry), defaultProperties(collection, geometry.type));
        this.form.show(index, collection.features[index]);
        this.changed();
        this.$section[0]?.scrollIntoView({ block: 'nearest' });
    }

    /** The data changed: fields, style, config and the live preview follow. */
    changed({ debounce = false, table = true } = {}) {
        const creator = this.creator;
        const collection = this.collection;
        if (!collection) return;
        const fields = creator.extractFields(collection);
        creator.populateDataFields(fields);
        creator.populateLabelFieldOptions(fields);
        creator.updateDataPreview(collection);
        creator.showStyleSection(collection);
        if (!creator.edit.active) $('#add-to-map-btn').prop('disabled', !collection.features.length);
        clearTimeout(this._timer);
        if (debounce) this._timer = setTimeout(() => creator.updateConfigPreview(), 300);
        else creator.updateConfigPreview();
        if (table) this.renderTable();
        this.renderHeader();
        creator.dataCard.refresh();
    }

    /** Undo / Redo or a hand edit of the Configuration JSON brought back other data. */
    applySnapshotData(config) {
        if (!this.editable || !config) return;
        this.setShareable(config.shareable !== false);
        const data = config.data;
        if (data?.type !== 'FeatureCollection') return;
        if (JSON.stringify(data) === JSON.stringify(compactCollection(this.collection))) return;
        this.form.close();
        this.creator.currentData = data;
        this.creator.updateDataPreview(data);
        this.renderHeader();
        this.renderTable();
    }

    zoomTo(index) {
        const bounds = geometryBbox(this.collection?.features[index]?.geometry);
        if (bounds) post({ type: 'zoom-to-bounds', bounds });
    }

    // -- shareable -------------------------------------------------------------------

    setShareable(on) {
        this.share.set(on);
        this.creator.steps?.refresh();
    }

    /** Put the data on a layer config: in the link when shareable and it fits, else in this browser. */
    attachData(config, collection) {
        return this.share.attach(config, collection);
    }

    makeEditableCopy() {
        makeEditableCopy(this);
    }

    // -- drawing ---------------------------------------------------------------------

    setDrawing(on) {
        const drawing = !!on && this.editable;
        if (drawing !== this.drawing) {
            this.drawing = drawing;
            post({ type: drawing ? 'draw-start' : 'draw-stop' });
        }
        $('#features-draw-btn').toggleClass('is-on', this.drawing).attr('aria-pressed', String(this.drawing))
            .find('.fs-draw-label').text(this.drawing ? 'Drawing' : 'Draw');
        this._hint(0);
    }

    _hint(count) {
        $('#features-draw-hint').text(this.drawing ? HINTS[Math.min(count, 3)] : 'Draw points, lines and areas on the map.');
    }

    // -- view ------------------------------------------------------------------------

    render() {
        if (!this.$section) return;
        const visible = this.editing && !!this.collection;
        const editable = visible && this.editable;
        this.$section.toggleClass('hidden', !visible);
        if (!editable) {
            this.setDrawing(false);
            this.form.close();
        }
        if (!visible) return;
        $('#features-draw').toggleClass('hidden', !editable);
        $('#features-readonly').toggleClass('hidden', editable);
        this.renderHeader();
        this.renderTable();
    }

    renderHeader() {
        const count = this.collection?.features.length || 0;
        $('#features-count').text(count ? `(${count.toLocaleString()})` : '');
        this.creator.steps?.refresh();
    }

    renderTable() {
        this.table.render(this.collection, { editable: this.editable, highlight: this.form.index });
    }
}

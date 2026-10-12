/**
 * Edit mode for the layer editor (map-creator.html).
 *
 * The creator is the one place a layer is configured: its source, details,
 * inspect fields, style and filters. Editing an existing layer is the same
 * editor opened on that layer instead of an empty one - the source is loaded
 * in, and everything the layer already carries is laid over what the source
 * would give a new layer. Replacing the source asks whether to keep the
 * layer's styling or restyle it from the new data (what a new layer gets).
 */

import { LayerConfigGenerator } from './layer-creator-ui.js';

const UNSUPPORTED_TYPES = new Set(['style', 'layer-group', 'wmts', 'img', 'raster-style-layer', 'js', 'atlas', 'osm']);

// What makes a layer's data, as opposed to how it is described and styled:
// replacing the source takes these from the new source.
const SOURCE_KEYS = new Set([
    'type', 'url', 'query', 'data', 'geojson', 'dataSource', 'pageSize', 'orderBy', 'where', 'outFields',
    'maxFeatures', 'sourceLayer', 'tiles', 'tileSize', 'srs', 'proxyUrl', 'endpoint', 'endpoints',
    'timeout', 'bboxBuffer', 'debounce'
]);

const isInternal = (key) => key.startsWith('_');

/** The layer without the bookkeeping keys the app adds (`_sourceAtlas`, `_originalJson`, ...). */
export function stripInternal(layer) {
    const clean = {};
    Object.keys(layer || {}).forEach(key => { if (!isInternal(key)) clean[key] = layer[key]; });
    return clean;
}

/**
 * Where a layer's data comes from, as the creator would load it.
 * @returns {{kind: 'url'|'overpass'|'local'|'inline'|'unsupported', value?: string, data?: Object, resolveOptions?: Object}}
 */
export function describeLayerSource(layer) {
    if (!layer || UNSUPPORTED_TYPES.has(layer.type)) return { kind: 'unsupported' };
    if (layer.type === 'overpass' && layer.query) return { kind: 'overpass', value: layer.query };
    if (layer.dataSource === 'localStorage') return { kind: 'local' };
    if (typeof layer.url === 'string' && layer.url) {
        // An ArcGIS layer is edited as the paged type it already is, not
        // whichever output the creator would pick for a new layer.
        return { kind: 'url', value: layer.url, resolveOptions: layer.type === 'arcgis' ? { output: 'arcgis' } : {} };
    }
    const inline = layer.data || layer.geojson;
    if (inline && typeof inline === 'object') return { kind: 'inline', data: inline };
    return { kind: 'unsupported' };
}

/**
 * Keep the layer's inspect settings where they still fit the data: the id and
 * label fields and the shown fields that the (new) source actually has, and any
 * other inspect options (a title, click handler, ...) as they were.
 */
export function reconcileInspect(existing, generated, fields) {
    if (!existing) return generated;
    const has = (field) => !fields || !fields.length || fields.includes(field);
    const base = { ...(generated || {}), ...existing };

    if (!has(existing.id) && generated && generated.id) base.id = generated.id;
    if (!has(existing.label) && generated && generated.label) base.label = generated.label;

    const kept = (existing.fields || []).filter(has);
    if (kept.length) {
        base.fields = kept;
        if (Array.isArray(existing.fieldTitles) && existing.fields) {
            base.fieldTitles = kept.map(field => existing.fieldTitles[existing.fields.indexOf(field)]);
        }
    } else if (generated && generated.fields) {
        base.fields = generated.fields;
        delete base.fieldTitles;
    }
    return base;
}

/**
 * The config an edit starts from, once the source has loaded.
 *
 * Source unchanged: the layer as it was, over whatever the load generated (so
 * anything the creator adds to a layer is there too). Source replaced: what
 * the new source generated for the data itself, with the layer's description,
 * inspect settings, filter, zoom range and the rest laid over it. The layer's
 * style is kept or dropped for the generated one per `keepStyle`.
 */
export function mergeEditedLayer(generated, layer, { sourceChanged = false, keepStyle = true, fields } = {}) {
    const existing = stripInternal(layer);
    let merged;

    if (!sourceChanged) {
        merged = { ...generated, ...existing };
    } else {
        const kept = {};
        Object.keys(existing).forEach(key => { if (!SOURCE_KEYS.has(key)) kept[key] = existing[key]; });
        merged = { ...generated, ...kept };
        // Attribution describes where the data came from, so it follows the source.
        if (generated.attribution) merged.attribution = generated.attribution;
        if (existing.inspect) merged.inspect = reconcileInspect(existing.inspect, generated.inspect, fields);
    }

    if (!keepStyle) {
        if (generated.style) merged.style = generated.style;
        else delete merged.style;
    }
    return merged;
}

/** Which of the creator's style sections a style uses. */
export function styleTypesOf(style) {
    const keys = Object.keys(style || {}).map(key => (key.includes('/') ? key.split('/').pop() : key));
    const some = (test) => keys.some(test);
    return {
        point: some(k => /^circle-(color|radius|stroke-color)$/.test(k)),
        line: some(k => k.startsWith('line-')),
        area: some(k => k.startsWith('fill-')),
        label: keys.includes('text-field'),
        circle: some(k => /^circle-(blur|stroke-width|opacity)$/.test(k)),
        icon: keys.includes('icon-image')
    };
}

export class CreatorEditMode {
    constructor(creator) {
        this.creator = creator;
        this.active = false;
        this.layer = null;
        this.source = { kind: 'unsupported' };
        this.sourceChanged = false;
        this.supported = true;
        this._seeding = false;
        this._timer = null;
    }

    get originalId() {
        return this.layer ? this.layer.id : null;
    }

    start(layer) {
        const creator = this.creator;
        this.active = true;
        this.layer = stripInternal(layer);
        this.source = describeLayerSource(layer);
        this.supported = this.source.kind !== 'unsupported';
        this._applyChrome();

        switch (this.source.kind) {
            case 'url':
                $('#url-input').val(this.source.value);
                $('#clear-url-btn').removeClass('hidden');
                creator._resolveOptions = this.source.resolveOptions;
                creator.handleURLImport();
                break;
            case 'overpass':
                creator.showOverpassSection();
                $('#overpass-query').val(this.source.value);
                creator.handleOverpassImport(this.source.value, { withPreview: true });
                break;
            case 'local': {
                const data = LayerConfigGenerator.retrieveGeoJSONData(layer.id);
                if (data) creator.processGeoJSON(data, 'edit-local');
                else this._startUnsupported('The data for this layer is no longer stored in this browser.');
                break;
            }
            case 'inline':
                creator.processGeoJSON(JSON.parse(JSON.stringify(this.source.data)), 'edit-inline');
                break;
            default:
                this._startUnsupported();
        }

        // A layer that already has data shows it as a collapsed card.
        creator.dataCard.enterEditMode(this.supported);
    }

    // A layer with no source the creator can load (a base-map style layer, a
    // layer group, ...): its settings are still editable as JSON.
    _startUnsupported(message) {
        const creator = this.creator;
        this.supported = false;
        $('#edit-unsupported-note').text(message || 'This layer type has no data source to edit here. Its settings can be edited in the configuration JSON below.').removeClass('hidden');
        creator.currentLayerType = this.layer.type;
        creator.currentData = { ...this.layer };
        creator.currentDataSource = null;
        creator.showTileLayerSuccess(creator.currentData);
        creator.setLoadingState('default');
    }

    _applyChrome() {
        $('#add-to-map-btn').text('Save Layer');
        $('#remove-other-maps-btn').hide();
        document.title = 'Edit Layer';
    }

    /** Called whenever a source finishes loading. Seeding waits a tick so the load's own follow-up steps finish first. */
    onLoaded() {
        if (!this.active || this._seeding || !this.supported) return;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._seed(), 0);
    }

    _sourceChanged() {
        const fileChosen = $('#file-input')[0] && $('#file-input')[0].files.length > 0;
        if (fileChosen) return true;
        const typed = $('#url-input').val().trim();
        switch (this.source.kind) {
            case 'url': return typed !== '' && typed !== this.source.value;
            case 'overpass': return $('#overpass-query').val().trim() !== String(this.source.value).trim();
            default: return typed !== '';
        }
    }

    _keepStyle() {
        return !this.sourceChanged || $('input[name="edit-style-choice"]:checked').val() !== 'restyle';
    }

    _availableFields() {
        const service = this.creator.service && this.creator.service.state && this.creator.service.state.description;
        if (service && service.allFields && service.allFields.length) return service.allFields;
        const fields = [];
        $('#feature-name-field option').each((_, option) => { if (option.value) fields.push(option.value); });
        return fields;
    }

    _seed() {
        const creator = this.creator;
        this._seeding = true;
        try {
            this.sourceChanged = this._sourceChanged();
            $('#edit-style-choice').toggleClass('hidden', !this.sourceChanged);

            const fields = this._availableFields();
            const keepStyle = this._keepStyle();
            if (creator.currentLayerType === 'geojson' || creator.currentLayerType === 'csv') {
                this._seedFromData(keepStyle, fields);
            } else {
                this._seedFromConfig(keepStyle, fields);
            }
            // The first load is the layer's own source; later ones are the user's choices.
            creator._resolveOptions = null;
        } finally {
            this._seeding = false;
        }
        creator.layerPage.onEditSeeded();
    }

    _syncStyleTypes(style) {
        const used = styleTypesOf(style);
        Object.entries(used).forEach(([type, on]) => $(`#style-type-${type}`).prop('checked', on));
        this.creator._styleTypesUserModified = true;
        this.creator.updateStyleSectionVisibility();
    }

    // A restyle gives the layer the style a new layer would get, so the simple
    // style controls go back to their defaults (they were seeded from the old
    // style while it was kept) and the sections follow the data's geometry.
    _resetStyleControls() {
        const creator = this.creator;
        $('.style-color-input, .style-control').each((_, el) => { el.value = el.defaultValue; });
        $('.style-color-input').each((_, el) => { $(el).siblings('.color-preview').css('background-color', el.value); });
        $('.style-control').each((_, el) => { $(`#${el.id}-value`).text(el.value); });
        $('#icon-image').val('');
        $('#style-type-circle, #style-type-icon').prop('checked', false);
        creator._styleTypesUserModified = false;

        const geojson = creator.currentLayerType === 'csv' ? creator.currentData && creator.currentData.geojson
            : creator.currentLayerType === 'geojson' ? creator.currentData : null;
        if (geojson && geojson.features) creator.autoCheckStyleTypes(creator.detectGeometryTypesPresent(geojson));
    }

    /** Point the inspect pickers at the layer's own settings (id, name and shown fields). */
    applyInspect(fields) {
        const creator = this.creator;
        const inspect = reconcileInspect(this.layer.inspect, null, fields);
        if (!inspect) return;
        creator.populateLabelFieldOptions(fields, inspect.label);
        creator.populateDataFields(fields, inspect.id, inspect.label);
        if (inspect.fields && inspect.fields.length) {
            $('#inspect-fields-list input[type="checkbox"]').each((_, el) => { el.checked = inspect.fields.includes(el.value); });
            creator.updateInspectFieldsToggleLabel();
        }
    }

    // geojson / csv: the creator builds the config from its form, so seed the form.
    _seedFromData(keepStyle, fields) {
        const creator = this.creator;
        const layer = this.layer;

        $('#layer-title').val(layer.title || $('#layer-title').val());
        $('#layer-id').val(layer.id);
        $('#layer-description').val(layer.description || '');
        if (!this.sourceChanged || !$('#layer-attribution').val()) $('#layer-attribution').val(layer.attribution || '');
        if (layer.type) $('#layer-type').val(layer.type);
        $('#include-bbox-checkbox').prop('checked', !!layer.bbox);

        this.applyInspect(fields);

        const handled = new Set(['id', 'title', 'type', 'description', 'attribution', 'inspect', 'bbox', 'initiallyChecked', 'saveUrl', 'style']);
        const extras = {};
        Object.keys(layer).forEach(key => { if (!handled.has(key) && !SOURCE_KEYS.has(key)) extras[key] = layer[key]; });
        creator._layerConfigOverride = { ...extras, ...(layer.inspect ? { inspect: layer.inspect } : {}) };

        if (keepStyle && layer.style) {
            creator._styleManuallyEdited = true;
            creator._layerConfigOverride.style = layer.style;
            creator.applyStyleToControls(layer.style);
            this._syncStyleTypes(layer.style);
        } else {
            this._resetStyleControls();
            creator._styleManuallyEdited = false;
        }
        creator.updateConfigPreview();
    }

    // Everything else: the creator's config *is* the layer config, so merge into it.
    _seedFromConfig(keepStyle, fields) {
        const creator = this.creator;
        const generated = creator.currentData || {};
        const merged = mergeEditedLayer(generated, this.layer, { sourceChanged: this.sourceChanged, keepStyle, fields });

        if (!keepStyle) this._resetStyleControls();
        creator.currentLayerType = merged.type === 'geojson' ? 'geojson-url' : merged.type;
        creator.currentData = merged;
        creator.showTileLayerSuccess(merged);

        // showTileLayerSuccess rebuilds the style from the simple controls; the
        // layer's own has to survive that, so hold it as an edit.
        // A service's own styling (ArcGIS) is part of what a restyle gives a new layer, so it is held too.
        const holdStyle = keepStyle || (creator.service.isActive() && !!generated.style);
        if (merged.style && holdStyle) {
            creator._styleManuallyEdited = true;
            creator.currentData = { ...creator.currentData, style: merged.style };
            creator.applyStyleToControls(merged.style);
            this._syncStyleTypes(merged.style);
        }
        if (fields.length) this.applyInspect(fields);
        creator.updateConfigPreview();
    }

    /** Leave edit mode (after Apply or Cancel); the form keeps whatever it holds until the next edit starts. */
    stop() {
        clearTimeout(this._timer);
        clearTimeout(this.creator._previewTimer);
        this.active = false;
        this._seeding = false;
        this.sourceChanged = false;
        this.creator._resolveOptions = null;
        $('#edit-style-choice, #edit-unsupported-note').addClass('hidden');
    }

    /** Save Layer: the live draft becomes the layer (or, for a layer the creator can't preview, its JSON is applied). */
    apply() {
        const creator = this.creator;
        if (!this.supported) {
            let config;
            try {
                config = JSON.parse($('#config-preview').val());
            } catch (error) {
                alert('The configuration JSON is not valid: ' + error.message);
                return;
            }
            const changed = Object.keys({ ...this.layer, ...config }).filter(key => JSON.stringify(this.layer[key]) !== JSON.stringify(config[key]));
            window.parent.postMessage({ type: 'update-layer', layer: config, originalId: this.originalId, changedFields: changed }, '*');
            creator.layerPage.finishEdit(config);
            return;
        }

        clearTimeout(creator._previewTimer);
        creator.sendPreview();
        window.parent.postMessage({ type: 'finalize-creator-layer', keepOpen: true, edit: true }, '*');
        creator.layerPage.finishEdit();
    }
}

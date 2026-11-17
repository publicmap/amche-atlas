/**
 * The layer editor's Style section as two tabs: Simple (a colour, width and
 * label per geometry type, MapCreator's style controls) and Advanced, the
 * StylePropertyEditor (per-property controls, By-data symbology, Rules,
 * hover / selected states) bound to the layer config shown in the
 * Configuration JSON box. MapCreator._styleManuallyEdited is the tab: Advanced
 * owns `style` while it is set, the simple controls build it while it isn't.
 *
 * Leaving Advanced keeps its style aside and seeds the simple controls from
 * each property's fallback value. Coming back restores that style as it was,
 * whatever Simple changed meanwhile; only the first visit to Advanced starts
 * from the style Simple built.
 *
 * Edits go back through MapCreator.handleConfigJSONEdit() - the path a hand
 * edit of that JSON takes - so they reach the live preview and survive the
 * creator's own regeneration of `style`, which stops once the style has been
 * edited by hand. Any other config update reseeds this editor from the JSON.
 */

import { StylePropertyEditor } from './style-property-editor.js';
import { styleTypesOf } from './creator-edit-mode.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

export class CreatorStyleEditor {
    constructor(creator) {
        this.creator = creator;
        this.editor = null;
        this._applying = false;
        this._advancedStyle = null;
    }

    get mode() {
        return this.creator._styleManuallyEdited ? 'advanced' : 'simple';
    }

    init() {
        const host = document.getElementById('advanced-style-editor');
        if (!host) return;

        this.editor = new StylePropertyEditor({
            onChange: (style) => this._apply(style),
            getFields: () => this.knownFields(),
            getSamples: () => this.samples(),
            onFilterChange: (filter) => this._applyFilter(filter)
        });
        host.appendChild(this.editor.element);

        $('#style-mode-tabs').on('click', 'button[data-mode]', (event) => this.setMode(event.currentTarget.dataset.mode));
        this._renderMode();
    }

    /** A new layer, or a new edit of one: Advanced has nothing kept from before. */
    reset() {
        this._advancedStyle = null;
    }

    /** @param {'simple'|'advanced'} mode */
    setMode(mode) {
        if (mode === this.mode) return;
        const creator = this.creator;
        if (mode === 'simple') {
            const style = this._currentConfig()?.style;
            this._advancedStyle = style && typeof style === 'object' ? clone(style) : null;
            if (this._advancedStyle) {
                creator.applyStyleToControls(this._advancedStyle);
                this._checkStyleTypes(this._advancedStyle);
            }
            creator._styleManuallyEdited = false;
            creator.updateConfigPreview();
        } else {
            // Held as an edit, so the config keeps it: what Advanced had, or on its
            // first visit the style Simple built
            const style = this._advancedStyle || this._currentConfig()?.style;
            creator._styleManuallyEdited = true;
            if (style) this._apply(clone(style));
            else creator.updateConfigPreview();
        }
        this.sync();
    }

    // The geometry types the advanced style draws, so Simple builds the same ones
    _checkStyleTypes(style) {
        const used = styleTypesOf(style);
        if (!Object.values(used).some(Boolean)) return;
        Object.entries(used).forEach(([type, on]) => $(`#style-type-${type}`).prop('checked', on));
        this.creator._styleTypesUserModified = true;
        this.creator.updateStyleSectionVisibility();
    }

    _renderMode() {
        const mode = this.mode;
        $('#style-section').attr('data-style-mode', mode);
        $('#style-mode-tabs button[data-mode]').each((_, button) => {
            button.setAttribute('aria-selected', String(button.dataset.mode === mode));
        });
    }

    /** Reseed from the Configuration JSON after the creator regenerates it. */
    sync() {
        if (!this.editor || this._applying) return;
        this._renderMode();
        // The simple controls are hidden (inline, by MapCreator) for a layer they can't style
        const styleable = document.getElementById('style-controls')?.style.display !== 'none';
        $('#style-mode-tabs, #advanced-style-section').toggleClass('hidden', !styleable);
        const config = this._currentConfig();
        if (config) this.editor.setLayer(config);
    }

    _currentConfig() {
        try {
            return JSON.parse(document.getElementById('config-preview').value);
        } catch (error) {
            return null;
        }
    }

    _apply(style) {
        const config = this._currentConfig();
        if (!config) return;

        config.style = style;
        document.getElementById('config-preview').value = JSON.stringify(config, null, 2);
        this._applying = true;
        try {
            this.creator.handleConfigJSONEdit();
        } finally {
            this._applying = false;
        }
    }

    // The layer's own `filter` sits outside `style`, in the same config JSON.
    _applyFilter(filter) {
        const config = this._currentConfig();
        if (!config) return;

        if (filter === undefined) delete config.filter;
        else config.filter = filter;
        document.getElementById('config-preview').value = JSON.stringify(config, null, 2);
        this._applying = true;
        try {
            this.creator.handleConfigJSONEdit();
        } finally {
            this._applying = false;
        }
    }

    /** Field names the data source is known to have, from the Data Fields pickers. */
    knownFields() {
        const names = new Set();
        $('#feature-name-field option, #label-field-select option').each((_, option) => {
            if (option.value) names.add(option.value);
        });
        return [...names];
    }

    /**
     * Feature properties to classify: the creator's own data for an uploaded or
     * fetched file, otherwise whatever the map has loaded for the draft layer.
     */
    samples() {
        const { currentLayerType, currentData } = this.creator;
        const local = currentLayerType === 'geojson' ? currentData
            : currentLayerType === 'csv' ? currentData?.geojson
                : null;
        if (local && Array.isArray(local.features)) {
            return local.features.map(feature => feature.properties || {});
        }

        const layerId = $('#layer-id').val();
        try {
            return window.parent !== window && layerId
                ? window.parent.sampleLayerProperties?.(layerId, currentData) || []
                : [];
        } catch (error) {
            return [];
        }
    }
}

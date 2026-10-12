/**
 * The creator's "Advanced style" panel: the same StylePropertyEditor
 * map-information.html uses (per-property controls, By-data symbology,
 * hover / selected states), bound to the layer config shown in the
 * Configuration JSON box.
 *
 * Edits go back through MapCreator.handleConfigJSONEdit() - the path a hand
 * edit of that JSON takes - so they reach the live preview and survive the
 * creator's own regeneration of `style`, which stops once the style has been
 * edited by hand. Any other config update reseeds this editor from the JSON.
 */

import { StylePropertyEditor } from './style-property-editor.js';

export class CreatorStyleEditor {
    constructor(creator) {
        this.creator = creator;
        this.editor = null;
        this._applying = false;
    }

    init() {
        const host = document.getElementById('advanced-style-editor');
        if (!host) return;

        this.editor = new StylePropertyEditor({
            onChange: (style) => this._apply(style),
            getFields: () => this.knownFields(),
            getSamples: () => this.samples()
        });
        host.appendChild(this.editor.element);

        document.getElementById('advanced-style-reset')?.addEventListener('click', (event) => {
            // The button sits inside the <summary>, which would also toggle the panel.
            event.preventDefault();
            this.creator._styleManuallyEdited = false;
            this.creator.updateConfigPreview();
        });
    }

    /** Reseed from the Configuration JSON after the creator regenerates it. */
    sync() {
        if (!this.editor || this._applying) return;
        $('#advanced-style-section').toggle($('#style-controls').is(':visible'));
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

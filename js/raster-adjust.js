/**
 * Image adjustments for a raster layer in the layer editor's header: sliders
 * for the raster paint properties beside opacity (brightness, contrast,
 * saturation, hue) - https://docs.mapbox.com/style-spec/reference/layers/#raster
 *
 * Like the opacity slider, each change is posted to the parent map
 * ('update-layer-paint', see js/map-feature-control-iframe.js), which paints it
 * live and keeps it in the layer's style so it survives in the URL. A value
 * moved back to the spec default is removed from the style rather than written.
 */

const RASTER_TYPES = new Set(['tms', 'wmts', 'wms', 'cog', 'img', 'raster-style-layer']);

const RASTER_PROPERTIES = [
    { property: 'raster-brightness-min', label: 'Brightness min', min: 0, max: 1, step: 0.01, default: 0 },
    { property: 'raster-brightness-max', label: 'Brightness max', min: 0, max: 1, step: 0.01, default: 1 },
    { property: 'raster-contrast', label: 'Contrast', min: -1, max: 1, step: 0.01, default: 0 },
    { property: 'raster-saturation', label: 'Saturation', min: -1, max: 1, step: 0.01, default: 0 },
    { property: 'raster-hue-rotate', label: 'Hue rotate', min: 0, max: 360, step: 1, default: 0, unit: '°' }
];

export class RasterAdjust {
    /**
     * @param {Object} options
     * @param {() => void} [options.onChange] - A slider moved
     */
    constructor({ onChange } = {}) {
        this._onChange = onChange || (() => {});
        this.layer = null;
        this.layerId = null;
    }

    static isRaster(layer) {
        return RASTER_TYPES.has(layer?.type);
    }

    bind() {
        const $list = $('#lh-raster-sliders').empty();
        RASTER_PROPERTIES.forEach(spec => {
            const $input = $('<input>', {
                type: 'range', class: 'lh-raster-input flex-1', min: spec.min, max: spec.max, step: spec.step,
                'data-property': spec.property, 'aria-label': spec.label
            }).on('input', () => this._handleInput(spec, $input));
            $list.append($('<div>', { class: 'lh-raster-row' }).append(
                $('<span>', { class: 'lh-raster-label', text: spec.label }),
                $input,
                $('<span>', { class: 'lh-raster-value', 'data-value-for': spec.property })
            ));
        });
        $('#lh-raster-reset').on('click', () => this._reset());
    }

    render(layer) {
        this.layer = layer;
        this.layerId = layer.id || null;
        const raster = RasterAdjust.isRaster(layer);
        $('#lh-raster').toggle(raster);
        if (!raster) return;
        const style = layer.style || {};
        RASTER_PROPERTIES.forEach(spec => {
            const value = style[spec.property];
            const numeric = typeof value === 'number';
            const $input = $(`#lh-raster-sliders input[data-property="${spec.property}"]`);
            $input.val(numeric ? value : spec.default)
                .prop('disabled', value !== undefined && !numeric)
                .attr('title', value !== undefined && !numeric ? 'Set by an expression in the layer style' : null);
            this._showValue(spec, numeric ? value : spec.default, value !== undefined && !numeric);
        });
        this._updateResetButton();
    }

    setLayerId(id) {
        if (id) this.layerId = id;
    }

    _showValue(spec, value, fromExpression = false) {
        const text = fromExpression ? 'expr' : `${spec.step < 1 ? Number(value).toFixed(2) : value}${spec.unit || ''}`;
        $(`#lh-raster-sliders [data-value-for="${spec.property}"]`).text(text);
    }

    _handleInput(spec, $input) {
        if (!this.layer) return;
        const value = Number($input.val());
        this._showValue(spec, value);
        this._apply({ [spec.property]: value === spec.default ? null : value });
    }

    _reset() {
        if (!this.layer) return;
        const style = this.layer.style || {};
        const paint = {};
        RASTER_PROPERTIES.filter(spec => typeof style[spec.property] === 'number')
            .forEach(spec => { paint[spec.property] = null; });
        this._apply(paint);
        this.render(this.layer);
    }

    _apply(paint) {
        const style = { ...(this.layer.style || {}) };
        Object.entries(paint).forEach(([property, value]) => {
            if (value === null) delete style[property];
            else style[property] = value;
        });
        this.layer.style = style;
        this._updateResetButton();
        this._onChange(paint);
        if (window.self !== window.top) {
            window.parent.postMessage({ type: 'update-layer-paint', layerId: this.layerId, paint }, '*');
        }
    }

    _updateResetButton() {
        const style = this.layer?.style || {};
        $('#lh-raster-reset').prop('disabled', !RASTER_PROPERTIES.some(spec => typeof style[spec.property] === 'number'));
    }
}

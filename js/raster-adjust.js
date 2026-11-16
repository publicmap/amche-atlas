/**
 * Image adjustments for a raster layer: sliders for the raster paint
 * properties beside opacity (brightness, contrast, saturation, hue) and, for
 * tile layers, a color made transparent (js/raster-color-key.js) -
 * https://docs.mapbox.com/style-spec/reference/layers/#raster
 *
 * Mounted in the layer editor's header (js/layer-header.js) and in the map
 * console's layer details (js/console/layer-details.js). Like the opacity
 * slider, each change is posted to the map ('update-layer-paint', see
 * js/map-feature-control-iframe.js), which paints it live and keeps it in the
 * layer's style so it survives in the URL. A value moved back to the spec
 * default is removed from the style rather than written. The color key is the
 * layer's `colorKey` field and the recolor its `recolor`, posted as 'update-layer-pixels'.
 */
import { KEY_DEFAULTS, canColorKey, normalizeKey, normalizeRecolor, keyToHexa, hexaToKey } from './raster-color-key.js';

const RASTER_TYPES = new Set(['tms', 'wmts', 'wms', 'cog', 'img', 'raster-style-layer']);

const RASTER_PROPERTIES = [
    { property: 'raster-brightness-min', label: 'Brightness min', min: 0, max: 1, step: 0.01, default: 0 },
    { property: 'raster-brightness-max', label: 'Brightness max', min: 0, max: 1, step: 0.01, default: 1 },
    { property: 'raster-contrast', label: 'Contrast', min: -1, max: 1, step: 0.01, default: 0 },
    { property: 'raster-saturation', label: 'Saturation', min: -1, max: 1, step: 0.01, default: 0 },
    { property: 'raster-hue-rotate', label: 'Hue rotate', min: 0, max: 360, step: 1, default: 0, unit: '°' }
];

const TOLERANCE = { label: 'Tolerance', min: 0, max: 0.5, step: 0.01 };
const EXPRESSION_TITLE = 'Set by an expression in the layer style';

const make = (tag, attrs = {}, text) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== undefined) node.textContent = text;
    return node;
};
const row = (label, ...children) => {
    const wrap = make('div', { class: 'raster-row' });
    wrap.append(make('span', { class: 'raster-label' }, label), ...children);
    return wrap;
};
const parentPost = (message) => {
    if (window.self !== window.top) window.parent.postMessage(message, '*');
};

export class RasterAdjust {
    /**
     * @param {Object} options
     * @param {(paint: Object) => void} [options.onChange] - A control changed the paint
     * @param {(message: Object) => void} [options.post] - Sends the paint to the map; the editor's parent by default
     * @param {string} [options.buttonClass] - Class for the reset button
     */
    constructor({ onChange, post, buttonClass = 'info-header-action' } = {}) {
        this._onChange = onChange || (() => {});
        this._post = post || parentPost;
        this._buttonClass = buttonClass;
        this.layer = null;
        this.layerId = null;
        this._inputs = {};
        this._values = {};
    }

    static isRaster(layer) {
        return RASTER_TYPES.has(layer?.type);
    }

    /** Build the controls into a container (an element or a jQuery object). */
    mount(container) {
        const root = container?.jquery ? container[0] : container;
        if (!root) return;
        root.replaceChildren();
        RASTER_PROPERTIES.forEach(spec => {
            const input = make('input', { type: 'range', class: 'raster-input', min: spec.min, max: spec.max, step: spec.step, 'aria-label': spec.label });
            input.addEventListener('input', () => this._handleInput(spec, input));
            this._inputs[spec.property] = input;
            this._values[spec.property] = make('span', { class: 'raster-value' });
            root.appendChild(row(spec.label, input, this._values[spec.property]));
        });
        root.appendChild(this._buildKey());
        this._reset$ = make('button', { type: 'button', class: `${this._buttonClass} raster-reset`, title: 'Put every image adjustment back to its default' });
        this._reset$.append(make('sl-icon', { name: 'arrow-counterclockwise' }), make('span', {}, 'Reset Adjustments'));
        this._reset$.addEventListener('click', () => this._reset());
        root.appendChild(this._reset$);
    }

    _buildKey() {
        const wrap = make('div', { class: 'raster-key' });
        const toggle = make('label', { class: 'raster-key-toggle' });
        this._keyOn = make('input', { type: 'checkbox' });
        this._keyOn.addEventListener('change', () => this._applyKey());
        toggle.append(this._keyOn, make('span', {}, 'Make a color transparent'));

        this._keyColor = make('sl-color-picker', { class: 'raster-swatch', size: 'small', format: 'hex', opacity: '', hoist: '',
            label: 'Color to make transparent', value: keyToHexa(KEY_DEFAULTS),
            title: 'The color to make transparent' });
        this._keyColor.addEventListener('sl-input', () => this._applyKey());
        this._keyColor.addEventListener('sl-change', () => this._applyKey());
        this._keyHex = make('span', { class: 'raster-value raster-key-hex' });
        this._keyOpacity = make('input', { type: 'range', class: 'raster-input', min: 0, max: 100, step: 1, 'aria-label': 'Opacity of the color',
            title: 'How much of the color stays: 0% removes it, 100% leaves it as it is' });
        this._keyOpacityValue = make('span', { class: 'raster-value' });
        this._keyOpacity.addEventListener('input', () => this._applyKey('opacity'));
        this._keyTolerance = make('input', { type: 'range', class: 'raster-input', min: TOLERANCE.min, max: TOLERANCE.max, step: TOLERANCE.step, 'aria-label': TOLERANCE.label,
            title: 'How close to the color a pixel must be to turn transparent' });
        this._keyToleranceValue = make('span', { class: 'raster-value' });
        this._keyTolerance.addEventListener('input', () => this._applyKey());

        this._keyFields = make('div', { class: 'raster-key-fields' });
        this._keyFields.append(
            row('Color', this._keyColor, make('span', { class: 'raster-key-gap' }), this._keyHex),
            row('Opacity', this._keyOpacity, this._keyOpacityValue),
            row(TOLERANCE.label, this._keyTolerance, this._keyToleranceValue)
        );
        this._recolor = {};
        const recolorRow = make('div', { class: 'raster-row raster-recolor' });
        recolorRow.appendChild(make('span', { class: 'raster-label' }, 'Recolor'));
        [['grayscale', 'Grayscale'], ['invert', 'Invert']].forEach(([name, label]) => {
            const option = make('label', { class: 'raster-key-toggle' });
            const input = make('input', { type: 'checkbox' });
            input.addEventListener('change', () => this._applyRecolor());
            option.append(input, make('span', {}, label));
            this._recolor[name] = input;
            recolorRow.appendChild(option);
        });
        wrap.append(toggle, this._keyFields, recolorRow);
        this._keyWrap = wrap;
        return wrap;
    }

    render(layer) {
        this.layer = layer;
        this.layerId = layer.id || null;
        if (!RasterAdjust.isRaster(layer) || !this._reset$) return;
        const style = layer.style || {};
        RASTER_PROPERTIES.forEach(spec => {
            const value = style[spec.property];
            const numeric = typeof value === 'number';
            const fromExpression = value !== undefined && !numeric;
            const input = this._inputs[spec.property];
            input.value = numeric ? value : spec.default;
            input.disabled = fromExpression;
            input.title = fromExpression ? EXPRESSION_TITLE : '';
            this._showValue(spec, numeric ? value : spec.default, fromExpression);
        });
        this._renderKey(layer);
        this._updateResetButton();
    }

    setLayerId(id) {
        if (id) this.layerId = id;
    }

    _renderKey(layer) {
        const keyable = canColorKey(layer);
        this._keyWrap.hidden = !keyable;
        if (!keyable) return;
        const key = normalizeKey(layer.colorKey);
        const values = key || KEY_DEFAULTS;
        this._keyOn.checked = !!key;
        this._keyColor.value = keyToHexa(values);
        this._keyOpacity.value = Math.round(values.alpha * 100);
        this._keyTolerance.value = values.tolerance;
        this._showKey(values);
        this._keyFields.hidden = !key;
        const recolor = normalizeRecolor(layer.recolor) || {};
        Object.entries(this._recolor).forEach(([name, input]) => { input.checked = !!recolor[name]; });
    }

    _applyRecolor() {
        if (!this.layer) return;
        const recolor = normalizeRecolor(Object.fromEntries(Object.entries(this._recolor).map(([name, input]) => [name, input.checked])));
        if (recolor) this.layer.recolor = recolor;
        else delete this.layer.recolor;
        this._updateResetButton();
        this._onChange({ recolor });
        this._post({ type: 'update-layer-pixels', layerId: this.layerId, edits: { recolor } });
    }

    _showKey({ color, alpha, tolerance }) {
        this._keyHex.textContent = color;
        this._keyOpacityValue.textContent = `${Math.round(alpha * 100)}%`;
        this._keyToleranceValue.textContent = Number(tolerance).toFixed(2);
    }

    /** @param {'opacity'} [from] - the opacity slider moved: it sets the picker's alpha, else the picker sets it */
    _applyKey(from) {
        if (!this.layer) return;
        const on = this._keyOn.checked;
        this._keyFields.hidden = !on;
        let key = null;
        if (on) {
            const picked = hexaToKey(this._keyColor.value, Number(this._keyTolerance.value));
            key = from === 'opacity' ? { ...picked, alpha: Number(this._keyOpacity.value) / 100 } : picked;
            if (from === 'opacity') this._keyColor.value = keyToHexa(key);
            else this._keyOpacity.value = Math.round(key.alpha * 100);
            this._showKey(key);
        }
        this._setKey(key);
    }

    _setKey(key) {
        if (key) this.layer.colorKey = key;
        else delete this.layer.colorKey;
        this._updateResetButton();
        this._onChange({ colorKey: key });
        this._post({ type: 'update-layer-pixels', layerId: this.layerId, edits: { colorKey: key } });
    }

    _showValue(spec, value, fromExpression = false) {
        const text = fromExpression ? 'expr' : `${spec.step < 1 ? Number(value).toFixed(2) : value}${spec.unit || ''}`;
        this._values[spec.property].textContent = text;
    }

    _handleInput(spec, input) {
        if (!this.layer) return;
        const value = Number(input.value);
        this._showValue(spec, value);
        this._apply({ [spec.property]: value === spec.default ? null : value });
    }

    _ownProperties(style) {
        const paint = {};
        RASTER_PROPERTIES.filter(spec => typeof style[spec.property] === 'number')
            .forEach(spec => { paint[spec.property] = null; });
        return paint;
    }

    _reset() {
        if (!this.layer) return;
        this._apply(this._ownProperties(this.layer.style || {}));
        if (this.layer.colorKey) this._setKey(null);
        if (this.layer.recolor) {
            Object.values(this._recolor).forEach(input => { input.checked = false; });
            this._applyRecolor();
        }
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
        this._post({ type: 'update-layer-paint', layerId: this.layerId, paint });
    }

    _updateResetButton() {
        this._reset$.disabled = !this.layer?.colorKey && !this.layer?.recolor && !Object.keys(this._ownProperties(this.layer?.style || {})).length;
    }
}

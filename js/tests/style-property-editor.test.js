// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
    StylePropertyEditor,
    numericRange,
    uiControlKind,
    cssColorToHex
} from '../style-property-editor.js';
import { getSpecProperties, guessPropertyKind, lookupPropertyKind } from '../mapbox-style-spec.js';

// jsdom has no canvas, so the colour probe cssColorToHex() falls back to for
// named/hsl colours is unavailable here - stub a minimal 2d context that
// normalizes this small set of named colours to their hex value (and rejects
// anything else, leaving fillStyle unchanged) the way a real canvas would, so
// cssColorToHex() can be exercised end-to-end without jsdom's "not
// implemented" console noise. Hex and rgb()/rgba() forms bypass this probe
// entirely (cssColorToHex checks them first), so most assertions don't need it.
const NAMED_COLOR_HEX = { red: '#ff0000', green: '#008000', blue: '#0000ff', lime: '#00ff00', orange: '#ffa500', black: '#000000' };
HTMLCanvasElement.prototype.getContext = () => ({
    _fillStyle: '#000000',
    get fillStyle() { return this._fillStyle; },
    set fillStyle(value) {
        if (Object.prototype.hasOwnProperty.call(NAMED_COLOR_HEX, value)) this._fillStyle = NAMED_COLOR_HEX[value];
        else if (/^#[0-9a-f]{6}$/i.test(value)) this._fillStyle = value;
        // any other value (an unknown colour, or one of the probe sentinels
        // re-applied) is silently rejected, leaving fillStyle unchanged.
    }
});

function mount(layer) {
    const onChange = vi.fn();
    const editor = new StylePropertyEditor({ onChange });
    document.body.appendChild(editor.element);
    editor.setLayer(layer);
    return { editor, onChange };
}

function rowFor(editor, property) {
    return [...editor.element.querySelectorAll('.spe-row')]
        .find(row => row.querySelector('.spe-name').textContent === property);
}

describe('style spec tables', () => {
    it('classifies properties as paint or layout', () => {
        expect(guessPropertyKind('line-color')).toBe('paint');
        expect(guessPropertyKind('text-field')).toBe('layout');
        expect(guessPropertyKind('visibility')).toBe('layout');
        // Not in the tables - falls back to the name patterns
        expect(lookupPropertyKind('fill-antialias')).toBeNull();
        expect(guessPropertyKind('fill-antialias')).toBe('paint');
        expect(guessPropertyKind('symbol-z-offset')).toBe('layout');
    });

    it('offers only raster properties for a raster source type', () => {
        const properties = getSpecProperties('tms').map(entry => entry.property);
        expect(properties).toContain('raster-opacity');
        expect(properties).not.toContain('line-width');
    });

    it('offers every vector pass for a geojson layer', () => {
        const properties = getSpecProperties('geojson').map(entry => entry.property);
        ['fill-color', 'line-width', 'circle-radius', 'text-field', 'fill-extrusion-height']
            .forEach(property => expect(properties).toContain(property));
    });
});

describe('control resolution', () => {
    it('picks the control from the property name first', () => {
        expect(uiControlKind('fill-color', ['match', ['get', 'x'], 'a', 'red', 'blue'])).toBe('color');
        expect(uiControlKind('circle-radius', ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 6])).toBe('number');
        expect(uiControlKind('fill-opacity', 0.4)).toBe('number');
        expect(uiControlKind('line-dasharray', [2, 2])).toBeNull();
    });

    it('falls back to the value type for unknown properties', () => {
        expect(uiControlKind('custom-thing', '#ff0000')).toBe('color');
        expect(uiControlKind('custom-thing', 3)).toBe('number');
        expect(uiControlKind('custom-thing', { a: 1 })).toBeNull();
    });

    it('bounds numeric controls by property', () => {
        expect(numericRange('fill-opacity')).toEqual({ min: 0, max: 1, step: 0.01 });
        expect(numericRange('circle-radius')).toEqual({ min: 0, max: 100, step: 1 });
        expect(numericRange('line-offset').step).toBe('any');
    });

    it('normalizes colours for the picker', () => {
        expect(cssColorToHex('#f00')).toBe('#ff0000');
        expect(cssColorToHex('rgba(255, 0, 0, 0.5)')).toBe('#ff0000');
        expect(cssColorToHex('nonsense')).toBeNull();
    });
});

describe('StylePropertyEditor', () => {
    const layer = {
        type: 'geojson',
        style: {
            'fill-color': '#ff0000',
            'fill-opacity': 0.5,
            'line-dasharray': [2, 2],
            'text-field': ['get', 'name']
        }
    };

    it('renders one row per style property, grouped by paint and layout', () => {
        const { editor } = mount(layer);
        const names = [...editor.element.querySelectorAll('.spe-name')].map(node => node.textContent);
        expect(names).toEqual(['fill-color', 'fill-opacity', 'line-dasharray', 'text-field']);

        const sections = [...editor.element.querySelectorAll('.spe-section')].map(node => node.textContent);
        expect(sections).toEqual(['Colors', 'Paint', 'Layout']);
    });

    it('gives a colour property a picker and a number property a bounded box', () => {
        const { editor } = mount(layer);

        const swatch = rowFor(editor, 'fill-color').querySelector('input[type="color"]');
        expect(swatch.value).toBe('#ff0000');

        const number = rowFor(editor, 'fill-opacity').querySelector('input[type="number"]');
        expect(number.value).toBe('0.5');
        expect(number.min).toBe('0');
        expect(number.max).toBe('1');
    });

    it('falls back to a JSON textarea for values no control fits', () => {
        const { editor } = mount(layer);
        const textarea = rowFor(editor, 'line-dasharray').querySelector('textarea');
        expect(JSON.parse(textarea.value)).toEqual([2, 2]);
        expect(rowFor(editor, 'line-dasharray').querySelector('input')).toBeNull();
    });

    it('opens an expression as JSON and keeps it until edited', () => {
        const { editor, onChange } = mount(layer);
        const row = rowFor(editor, 'text-field');
        expect(JSON.parse(row.querySelector('textarea').value)).toEqual(['get', 'name']);
        expect(onChange).not.toHaveBeenCalled();
        expect(editor.getStyle()['text-field']).toEqual(['get', 'name']);
    });

    it('reports a valid number edit and rejects an out-of-range one', () => {
        const { editor, onChange } = mount(layer);
        const input = rowFor(editor, 'fill-opacity').querySelector('input[type="number"]');

        input.value = '0.8';
        input.dispatchEvent(new Event('input'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]['fill-opacity']).toBe(0.8);

        input.value = '4';
        input.dispatchEvent(new Event('input'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(input.classList.contains('spe-invalid')).toBe(true);
        expect(editor.getStyle()['fill-opacity']).toBe(0.8);
    });

    it('reports a colour picked from the swatch, keeping any alpha', () => {
        const { editor, onChange } = mount({ type: 'geojson', style: { 'fill-color': 'rgba(255, 0, 0, 0.4)' } });
        const swatch = rowFor(editor, 'fill-color').querySelector('input[type="color"]');

        swatch.value = '#0000ff';
        swatch.dispatchEvent(new Event('input'));
        expect(editor.getStyle()['fill-color']).toBe('rgba(0, 0, 255, 0.4)');
        expect(onChange).toHaveBeenCalled();
    });

    it('rejects a colour Mapbox would not understand', () => {
        const { editor, onChange } = mount(layer);
        const text = rowFor(editor, 'fill-color').querySelector('input[type="text"]');

        text.value = 'not-a-colour';
        text.dispatchEvent(new Event('input'));
        expect(onChange).not.toHaveBeenCalled();
        expect(text.classList.contains('spe-invalid')).toBe(true);
        expect(editor.getStyle()['fill-color']).toBe('#ff0000');
    });

    it('switches a row between its typed control and JSON', () => {
        const { editor } = mount(layer);
        rowFor(editor, 'fill-color').querySelector('.spe-btn').click();

        const row = rowFor(editor, 'fill-color');
        expect(row.querySelector('textarea')).not.toBeNull();
        expect(JSON.parse(row.querySelector('textarea').value)).toBe('#ff0000');

        row.querySelector('.spe-btn').click();
        expect(rowFor(editor, 'fill-color').querySelector('input[type="color"]')).not.toBeNull();
    });

    it('applies a JSON edit and reports invalid JSON without applying it', () => {
        const { editor, onChange } = mount(layer);
        const textarea = rowFor(editor, 'line-dasharray').querySelector('textarea');

        textarea.value = '[4, 1]';
        textarea.dispatchEvent(new Event('input'));
        expect(editor.getStyle()['line-dasharray']).toEqual([4, 1]);

        textarea.value = '[4, ';
        textarea.dispatchEvent(new Event('input'));
        expect(editor.getStyle()['line-dasharray']).toEqual([4, 1]);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('removes a property and says which one went', () => {
        const { editor, onChange } = mount(layer);
        rowFor(editor, 'fill-opacity').querySelector('.spe-remove').click();

        expect(editor.getStyle()['fill-opacity']).toBeUndefined();
        expect(onChange.mock.calls[0][1]).toEqual({ removed: ['fill-opacity'] });
    });

    it('adds a spec property from the picker, skipping the ones already set', () => {
        const { editor, onChange } = mount(layer);
        const select = editor.element.querySelector('select');
        const options = [...select.options].map(option => option.value);

        expect(options).not.toContain('fill-color');
        expect(options).toContain('line-width');

        select.value = 'line-width';
        select.dispatchEvent(new Event('change'));
        expect(editor.getStyle()['line-width']).toBe(1);
        expect(onChange).toHaveBeenCalled();
    });

    it('holds a property with no sensible default out of the style until it parses', () => {
        const { editor, onChange } = mount(layer);
        const select = editor.element.querySelector('select');

        select.value = 'line-cap';
        select.dispatchEvent(new Event('change'));
        expect('line-cap' in editor.getStyle()).toBe(false);
        expect(onChange).not.toHaveBeenCalled();

        const textarea = rowFor(editor, 'line-cap').querySelector('textarea');
        expect(textarea.value).toBe('');
        textarea.value = '"round"';
        textarea.dispatchEvent(new Event('input'));
        expect(editor.getStyle()['line-cap']).toBe('round');
    });

    it('labels a variant property by its full key', () => {
        const { editor } = mount({ type: 'geojson', style: { 'casing/line-color': '#ffffff', 'casing/line-width': 6 } });
        const names = [...editor.element.querySelectorAll('.spe-name')].map(node => node.textContent);
        expect(names).toEqual(['casing/line-color', 'casing/line-width']);
        expect(rowFor(editor, 'casing/line-width').querySelector('input[type="number"]').value).toBe('6');
    });

    it('offers one swatch per unique colour, deduping a repeated colour across properties', () => {
        const { editor } = mount({
            type: 'geojson',
            style: {
                'fill-color': '#ff0000',
                'line-color': '#ff0000',
                'circle-color': ['match', ['get', 'kind'], 'a', '#00ff00', '#0000ff']
            }
        });

        const swatches = [...editor.element.querySelectorAll('.spe-color-gallery .spe-color-swatch')];
        expect(swatches.map(s => s.value)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    });

    it('editing a colour swatch rewrites every occurrence of that colour, including inside expressions', () => {
        const { editor, onChange } = mount({
            type: 'geojson',
            style: {
                'fill-color': '#ff0000',
                'line-color': '#ff0000',
                'circle-color': ['match', ['get', 'kind'], 'a', '#ff0000', '#0000ff']
            }
        });

        const swatch = editor.element.querySelector('.spe-color-gallery .spe-color-swatch');
        swatch.value = '#00ffaa';
        swatch.dispatchEvent(new Event('input'));

        const style = editor.getStyle();
        expect(style['fill-color']).toBe('#00ffaa');
        expect(style['line-color']).toBe('#00ffaa');
        expect(style['circle-color']).toEqual(['match', ['get', 'kind'], 'a', '#00ffaa', '#0000ff']);
        expect(onChange).toHaveBeenCalled();
    });

    it('keeps applying colour across a drag\'s repeated input events without rebuilding the swatch (which would close the native picker)', () => {
        const { editor } = mount({
            type: 'geojson',
            style: { 'fill-color': '#ff0000', 'line-color': '#ff0000' }
        });

        const swatch = editor.element.querySelector('.spe-color-gallery .spe-color-swatch');

        swatch.value = '#00ff00';
        swatch.dispatchEvent(new Event('input'));
        // A rerender would have replaced this node - same identity means the
        // gallery (and any open native picker) was left alone.
        expect(editor.element.querySelector('.spe-color-gallery .spe-color-swatch')).toBe(swatch);
        expect(editor.getStyle()['fill-color']).toBe('#00ff00');
        expect(editor.getStyle()['line-color']).toBe('#00ff00');

        // The drag continues to another colour - must match against the
        // colour just applied, since the style no longer holds the original.
        swatch.value = '#0000ff';
        swatch.dispatchEvent(new Event('input'));
        expect(editor.element.querySelector('.spe-color-gallery .spe-color-swatch')).toBe(swatch);
        expect(editor.getStyle()['fill-color']).toBe('#0000ff');
        expect(editor.getStyle()['line-color']).toBe('#0000ff');
    });

    it('only rebuilds the gallery once the picker closes (change), merging swatches that now match', () => {
        const { editor } = mount({
            type: 'geojson',
            style: { 'fill-color': '#ff0000', 'line-color': '#00ff00' }
        });

        let swatches = [...editor.element.querySelectorAll('.spe-color-gallery .spe-color-swatch')];
        expect(swatches).toHaveLength(2);

        const redSwatch = swatches[0];
        redSwatch.value = '#00ff00';
        redSwatch.dispatchEvent(new Event('input'));
        expect(editor.element.querySelectorAll('.spe-color-gallery .spe-color-swatch')).toHaveLength(2);

        redSwatch.dispatchEvent(new Event('change'));
        swatches = [...editor.element.querySelectorAll('.spe-color-gallery .spe-color-swatch')];
        expect(swatches).toHaveLength(1);
        expect(swatches[0].value).toBe('#00ff00');
    });

    it('keeps a colour with alpha distinct from its opaque form and preserves alpha on edit', () => {
        const { editor } = mount({
            type: 'geojson',
            style: {
                'fill-color': '#ff0000',
                'fill-outline-color': 'rgba(255, 0, 0, 0.5)'
            }
        });

        const swatches = [...editor.element.querySelectorAll('.spe-color-gallery .spe-color-swatch')];
        expect(swatches).toHaveLength(2);

        const translucent = swatches.find(s => s.title.startsWith('rgba'));
        translucent.value = '#00ff00';
        translucent.dispatchEvent(new Event('input'));

        const style = editor.getStyle();
        expect(style['fill-color']).toBe('#ff0000');
        expect(style['fill-outline-color']).toBe('rgba(0, 255, 0, 0.5)');
    });

    it('omits the Colors section when the style has no colours', () => {
        const { editor } = mount({ type: 'geojson', style: { 'line-width': 2 } });
        const sections = [...editor.element.querySelectorAll('.spe-section')].map(node => node.textContent);
        expect(sections).not.toContain('Colors');
    });

    it('finds named colours (not just hex) used as match/case/interpolate/step outputs', () => {
        const { editor } = mount({
            type: 'geojson',
            style: {
                // Real-world shape: a match branching on a data field, with
                // named-colour outputs and a coalesce fallback.
                'circle-color': ['match', ['get', '$sheet'], '17(2)', 'red', '39A', 'red', 'Ht & FAR', 'blue', '#3b82f6'],
                'circle-stroke-color': ['case', ['==', ['get', 'ok'], true], 'lime', 'black'],
                'text-halo-color': ['interpolate', ['linear'], ['zoom'], 10, 'green', 15, 'blue'],
                'fill-color': ['step', ['zoom'], 'red', 12, 'green']
            }
        });

        const swatches = [...editor.element.querySelectorAll('.spe-color-gallery .spe-color-swatch')];
        const hexes = swatches.map(s => s.value).sort();
        // red, blue, #3b82f6, lime, black, green - six distinct colours
        expect(hexes).toEqual(['#008000', '#0000ff', '#000000', '#00ff00', '#3b82f6', '#ff0000'].sort());
    });

    it('does not mistake a match label for a colour, even when the label is itself a colour name', () => {
        const { editor } = mount({
            type: 'geojson',
            // "orange" here is a *label* (a data value being matched), not an
            // output colour - it must not appear as a swatch, and editing the
            // real "red" swatch must not touch it.
            style: { 'circle-color': ['match', ['get', 'kind'], 'orange', 'red', 'blue'] }
        });

        const swatches = [...editor.element.querySelectorAll('.spe-color-gallery .spe-color-swatch')];
        expect(swatches.map(s => s.value).sort()).toEqual(['#0000ff', '#ff0000']);

        const redSwatch = swatches.find(s => s.value === '#ff0000');
        redSwatch.value = '#123456';
        redSwatch.dispatchEvent(new Event('input'));

        expect(editor.getStyle()['circle-color']).toEqual(['match', ['get', 'kind'], 'orange', '#123456', 'blue']);
    });

    it('finds a colour hidden behind a coalesce fallback', () => {
        const { editor } = mount({
            type: 'geojson',
            style: { 'circle-color': ['coalesce', ['get', 'fill-color'], ['get', 'color'], 'red'] }
        });

        const swatches = [...editor.element.querySelectorAll('.spe-color-gallery .spe-color-swatch')];
        expect(swatches.map(s => s.value)).toEqual(['#ff0000']);

        swatches[0].value = '#00ff00';
        swatches[0].dispatchEvent(new Event('input'));
        expect(editor.getStyle()['circle-color']).toEqual(['coalesce', ['get', 'fill-color'], ['get', 'color'], '#00ff00']);
    });
});

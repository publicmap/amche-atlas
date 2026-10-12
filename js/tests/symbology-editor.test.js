// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { SymbologyEditor } from '../symbology-editor.js';
import { StylePropertyEditor } from '../style-property-editor.js';

// jsdom has no canvas; cssColorToHex falls back to hex/rgb parsing without one.
HTMLCanvasElement.prototype.getContext = () => null;

const SAMPLES = [
    { use: 'Park', area: 10 }, { use: 'Park', area: 20 }, { use: 'Road', area: 30 },
    { use: 'Housing', area: 40 }, { use: 'Housing', area: 50 }, { use: 'Housing', area: 60 }
];

function mount(options = {}) {
    const onChange = vi.fn();
    const editor = new SymbologyEditor({
        property: 'fill-color', valueKind: 'color',
        getFields: () => ['use', 'area'], getSamples: () => SAMPLES, onChange, ...options
    });
    document.body.appendChild(editor.element);
    return { editor, onChange };
}

const tab = (editor, label) => [...editor.element.querySelectorAll('.sym-tab')].find(t => t.textContent === label);
const last = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];

describe('SymbologyEditor', () => {
    it('detects categories from the data when switching to Categorized', () => {
        const { editor, onChange } = mount();
        editor.setValue('#3b82f6');
        tab(editor, 'Categorized').click();

        const expression = last(onChange);
        expect(expression[0]).toBe('match');
        expect(expression[1]).toEqual(['to-string', ['get', 'use']]);
        // Most common first: Housing (3), Park (2), Road (1), then the fallback
        expect(expression.filter((_, i) => i >= 2 && i % 2 === 0 && i < expression.length - 1)).toEqual(['Housing', 'Park', 'Road']);
        expect(typeof expression[expression.length - 1]).toBe('string');
        expect(editor.element.querySelectorAll('.sym-row').length).toBeGreaterThanOrEqual(3);
    });

    it('classifies a numeric field when switching to Graduated', () => {
        const { editor, onChange } = mount();
        editor.setValue('#3b82f6');
        tab(editor, 'Graduated').click();

        const expression = last(onChange);
        expect(expression[0]).toBe('case');
        expect(expression[2][0]).toBe('step');
        expect(expression[2][1]).toEqual(['get', 'area']);
        expect(editor.model.outputs).toHaveLength(editor.model.breaks.length + 1);
    });

    it('emits a fallback edit', () => {
        const { editor, onChange } = mount();
        editor.setValue('#3b82f6');
        tab(editor, 'Categorized').click();

        const swatch = editor.element.querySelector('.sym-fallback .sym-swatch');
        swatch.value = '#123456';
        swatch.dispatchEvent(new Event('input'));
        const expression = last(onChange);
        expect(expression[expression.length - 1]).toBe('#123456');
    });

    it('adds and removes hover / selected overrides', () => {
        const { editor, onChange } = mount();
        editor.setValue('#3b82f6');

        const [hoverToggle, selectedToggle] = editor.element.querySelectorAll('.sym-states input[type="checkbox"]');
        hoverToggle.checked = true;
        hoverToggle.dispatchEvent(new Event('change'));
        selectedToggle.checked = true;
        selectedToggle.dispatchEvent(new Event('change'));

        let expression = last(onChange);
        expect(expression[0]).toBe('case');
        expect(JSON.stringify(expression)).toContain('"selected"');
        expect(JSON.stringify(expression)).toContain('"hover"');
        expect(expression[expression.length - 1]).toBe('#3b82f6');

        const [hoverOff] = editor.element.querySelectorAll('.sym-states input[type="checkbox"]');
        hoverOff.checked = false;
        hoverOff.dispatchEvent(new Event('change'));
        expression = last(onChange);
        expect(JSON.stringify(expression)).not.toContain('"hover"');
    });

    it('hides states for properties that cannot take feature-state', () => {
        const { editor } = mount({ states: false });
        editor.setValue('#3b82f6');
        expect(editor.element.querySelector('.sym-states')).toBeNull();
    });

    it('works for numeric properties with a number control', () => {
        const { editor, onChange } = mount({ property: 'circle-radius', valueKind: 'number' });
        editor.setValue(4);
        tab(editor, 'Graduated').click();

        const expression = last(onChange);
        expect(expression[2][0]).toBe('step');
        expect(expression[2].filter(v => typeof v === 'string')).toEqual(['step']);
        expect(editor.element.querySelector('.sym-swatch')).toBeNull();
    });

    it('explains itself when there is no data to detect from', () => {
        const { editor } = mount({ getSamples: () => [], getFields: () => [] });
        editor.setValue('#3b82f6');
        tab(editor, 'Categorized').click();
        expect(editor.element.textContent).toContain('No feature data');
    });

    it('opens an existing categorized expression in its own mode', () => {
        const { editor } = mount();
        editor.setValue(['match', ['to-string', ['get', 'use']], 'Park', '#00aa00', '#cccccc']);
        expect(tab(editor, 'Categorized').classList.contains('sym-tab-active')).toBe(true);
        expect(editor.element.querySelector('.sym-input.sym-grow').value).toBe('Park');
    });
});

describe('StylePropertyEditor integration', () => {
    function mountStyle(style) {
        const onChange = vi.fn();
        const editor = new StylePropertyEditor({ onChange, getFields: () => ['use'], getSamples: () => SAMPLES });
        document.body.appendChild(editor.element);
        editor.setLayer({ type: 'geojson', style });
        return { editor, onChange };
    }

    const row = (editor, property) => [...editor.element.querySelectorAll('.spe-row')]
        .find(r => r.querySelector('.spe-name').textContent === property);

    it('offers a By-data mode on colour rows and writes the expression to the style', () => {
        const { editor, onChange } = mountStyle({ 'fill-color': '#3b82f6' });
        const byData = [...row(editor, 'fill-color').querySelectorAll('.spe-btn')].find(b => b.textContent === 'by data');
        byData.click();

        const categorized = [...row(editor, 'fill-color').querySelectorAll('.sym-tab')].find(t => t.textContent === 'Categorized');
        categorized.click();

        const style = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(style['fill-color'][0]).toBe('match');
    });

    it('opens an existing match expression in the symbology editor, not JSON', () => {
        const { editor } = mountStyle({ 'fill-color': ['match', ['to-string', ['get', 'use']], 'Park', '#0a0', '#ccc'] });
        expect(row(editor, 'fill-color').querySelector('.sym-root')).not.toBeNull();
        expect(row(editor, 'fill-color').querySelector('textarea')).toBeNull();
    });

    it('does not offer By-data for properties that are not colours or numbers', () => {
        const { editor } = mountStyle({ 'line-dasharray': [2, 2], 'line-width': 2 });
        expect([...row(editor, 'line-width').querySelectorAll('.spe-btn')].some(b => b.textContent === 'by data')).toBe(true);
        expect(row(editor, 'line-dasharray').querySelector('.spe-btn:not(.spe-remove)')).toBeNull();
    });
});

describe('StylePropertyEditor links', () => {
    const MATCH = ['match', ['to-string', ['get', 'use']], 'Park', '#16a34a', '#9ca3af'];
    const sources = {
        constants: { brand: '#ff0000', width: 3 },
        layers: [{ id: 'roads', title: 'Roads', style: { 'line-color': '#222222' } }]
    };

    function mountLinked(style) {
        const onChange = vi.fn();
        const editor = new StylePropertyEditor({ onChange, getReferences: () => sources });
        document.body.appendChild(editor.element);
        editor.setLayer({ id: 'zones', type: 'geojson', style });
        return { editor, onChange };
    }
    const row = (editor, property) => [...editor.element.querySelectorAll('.spe-row')]
        .find(r => r.querySelector('.spe-name').textContent === property);
    const button = (editor, property, text) => [...row(editor, property).querySelectorAll('.spe-btn')].find(b => b.textContent === text);

    it('links line-color to fill-color, inheriting the whole mapping', () => {
        const { editor, onChange } = mountLinked({ 'fill-color': MATCH, 'line-color': '#000000' });
        button(editor, 'line-color', 'link').click();

        expect(editor.getStyle()['line-color']).toBe('@fill-color');
        expect(onChange.mock.calls.at(-1)[0]['line-color']).toBe('@fill-color');
        const chips = row(editor, 'line-color').querySelectorAll('.spe-ref-chip');
        expect(chips.length).toBe(2);
        expect(row(editor, 'line-color').textContent).toContain('categories');
    });

    it('opens an existing reference in link mode and can switch the source to a constant or another layer', () => {
        const { editor } = mountLinked({ 'fill-color': '#123456', 'line-color': '@fill-color' });
        const selects = () => row(editor, 'line-color').querySelectorAll('select');
        expect(selects()[0].value).toBe('self');

        selects()[0].value = 'constant';
        selects()[0].dispatchEvent(new Event('change'));
        expect(editor.getStyle()['line-color']).toBe('$brand');

        selects()[0].value = 'layer';
        selects()[0].dispatchEvent(new Event('change'));
        expect(editor.getStyle()['line-color']).toBe('@roads#line-color');
    });

    it('offers only colour constants, and never a property that would loop back', () => {
        const { editor } = mountLinked({ 'fill-color': '@line-color', 'line-color': '#000000' });
        button(editor, 'line-color', 'link').click();
        // fill-color already points at line-color, so line-color may not point back at it
        expect(editor.getStyle()['line-color']).not.toBe('@fill-color');
        expect(editor.getStyle()['line-color']).toBe('$brand');
        const names = [...row(editor, 'line-color').querySelectorAll('select')[1].options].map(o => o.value);
        expect(names).toEqual(['brand']);
    });

    it('detaches into a copy of the inherited value when leaving link mode', () => {
        const { editor } = mountLinked({ 'fill-color': MATCH, 'line-color': '@fill-color' });
        button(editor, 'line-color', '{ }').click();
        expect(editor.getStyle()['line-color']).toEqual(MATCH);
        expect(editor.getStyle()['fill-color']).toEqual(MATCH);
    });

    it('hides link for number properties and when nothing is linkable', () => {
        const { editor } = mountLinked({ 'line-width': 2 });
        expect(button(editor, 'line-width', 'link')).toBeUndefined();

        sources.constants = {};
        sources.layers = [];
        const lone = mountLinked({ 'fill-color': '#fff' });
        expect(button(lone.editor, 'fill-color', 'link')).toBeUndefined();
    });
});

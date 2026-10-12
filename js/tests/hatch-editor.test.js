// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { hatchPreview, openHatchEditor, closeHatchEditor } from '../hatch-editor.js';
import { SymbologyEditor } from '../symbology-editor.js';
import { StylePropertyEditor } from '../style-property-editor.js';
import { parseHatchImageName } from '../hatch-patterns.js';

// jsdom has no canvas; previews fall back to an empty swatch carrying the name.
HTMLCanvasElement.prototype.getContext = () => null;

const INPUT = ['to-string', ['get', 'use_zones']];
const H = (kind) => `hatch|${kind}|#000000|8|1`;
const PATTERN = ['match', INPUT,
    'U', H('horizontal'), 'U1', H('horizontal'), 'G1', H('forward-diagonal'),
    'G2', H('diagonal-cross'), 'T1', H('vertical'), H('horizontal')];

afterEach(() => { closeHatchEditor(); document.body.innerHTML = ''; });

const last = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0];

describe('hatchPreview', () => {
    it('carries the hatch name it draws', () => {
        const swatch = hatchPreview(H('cross'));
        expect(swatch.dataset.hatch).toBe(H('cross'));
        expect(swatch.title).toBe(H('cross'));
    });

    it('shows a plain mark for a name that is not a hatch', () => {
        expect(hatchPreview('marker-15').textContent).toBe('▨');
    });
});

describe('openHatchEditor', () => {
    function open(value = H('diagonal-cross')) {
        const anchor = document.createElement('button');
        document.body.appendChild(anchor);
        const onChange = vi.fn();
        openHatchEditor(anchor, value, onChange);
        return { anchor, onChange, panel: document.querySelector('.hatch-editor') };
    }
    const change = (el, value) => { el.value = value; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input')); };

    it('starts from the current hatch and reports each edit as a new name', () => {
        const { panel, onChange } = open(H('diagonal-cross'));
        const [kind] = panel.querySelectorAll('select');
        expect(kind.value).toBe('diagonal-cross');

        change(kind, 'vertical');
        expect(parseHatchImageName(last(onChange))).toMatchObject({ kind: 'vertical', color: '#000000', spacing: 8, lineWidth: 1 });

        const [spacing, lineWidth] = panel.querySelectorAll('input[type="number"]');
        change(spacing, '12');
        change(lineWidth, '2.5');
        expect(parseHatchImageName(last(onChange))).toMatchObject({ kind: 'vertical', spacing: 12, lineWidth: 2.5 });

        change(panel.querySelector('input[type="color"]'), '#ff0000');
        expect(parseHatchImageName(last(onChange)).color).toBe('#ff0000');
    });

    it('folds line opacity into an rgba colour and reads it back', () => {
        const { panel, onChange } = open();
        change(panel.querySelector('input[type="range"]'), '0.5');
        const name = last(onChange);
        expect(parseHatchImageName(name).color).toBe('rgba(0, 0, 0, 0.5)');

        closeHatchEditor();
        const reopened = open(name);
        expect(reopened.panel.querySelector('input[type="range"]').value).toBe('0.5');
    });

    it('ignores out-of-range numbers', () => {
        const { panel, onChange } = open();
        change(panel.querySelectorAll('input[type="number"]')[0], '1');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('closes on Done, on Escape and on a click elsewhere, one editor at a time', () => {
        let { panel } = open();
        panel.querySelector('.hatch-done').click();
        expect(document.querySelector('.hatch-editor')).toBeNull();

        open();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.querySelector('.hatch-editor')).toBeNull();

        open();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(document.querySelector('.hatch-editor')).toBeNull();

        open();
        open();
        expect(document.querySelectorAll('.hatch-editor').length).toBe(1);
    });
});

describe('SymbologyEditor with hatch patterns', () => {
    function mount(value = PATTERN) {
        const onChange = vi.fn();
        const editor = new SymbologyEditor({
            property: 'fill-pattern', valueKind: 'pattern', states: false,
            getFields: () => ['use_zones'], getSamples: () => [{ use_zones: 'U' }, { use_zones: 'G1' }, { use_zones: 'X' }], onChange
        });
        document.body.appendChild(editor.element);
        editor.setValue(value);
        return { editor, onChange };
    }

    it('reads the match expression: field, one hatch preview per branch, and a fallback hatch', () => {
        const { editor } = mount();
        expect(editor.model).toMatchObject({ mode: 'categorized', field: 'use_zones' });
        expect(editor.element.querySelector('.sym-tab-active').textContent).toBe('Categorized');
        expect(editor.element.querySelector('select').value).toBe('use_zones');

        const rows = [...editor.element.querySelectorAll('.sym-list .sym-row')];
        expect(rows.map(r => r.querySelector('.sym-grow').value)).toEqual(['U', 'U1', 'G1', 'G2', 'T1']);
        expect(rows.map(r => r.querySelector('.hatch-preview').dataset.hatch)).toEqual([
            H('horizontal'), H('horizontal'), H('forward-diagonal'), H('diagonal-cross'), H('vertical')
        ]);
        expect(editor.element.querySelector('.sym-fallback .hatch-preview').dataset.hatch).toBe(H('horizontal'));
        expect(editor.element.querySelector('.sym-states')).toBeNull();
    });

    it('opens the hatch editor from a branch swatch and writes the edit into just that branch', () => {
        const { editor, onChange } = mount();
        const g1 = [...editor.element.querySelectorAll('.sym-list .sym-row')][2];
        g1.querySelector('.hatch-trigger').click();

        const kind = document.querySelector('.hatch-editor select');
        expect(kind.value).toBe('forward-diagonal');
        kind.value = 'cross';
        kind.dispatchEvent(new Event('change'));

        const expression = last(onChange);
        expect(expression[0]).toBe('match');
        expect(expression[expression.indexOf('G1') + 1]).toBe(H('cross'));
        expect(expression[expression.indexOf('G2') + 1]).toBe(H('diagonal-cross'));
        expect(g1.querySelector('.hatch-preview').dataset.hatch).toBe(H('cross'));
    });

    it('edits the fallback hatch', () => {
        const { editor, onChange } = mount();
        editor.element.querySelector('.sym-fallback .hatch-trigger').click();
        const kind = document.querySelector('.hatch-editor select');
        kind.value = 'backward-diagonal';
        kind.dispatchEvent(new Event('change'));
        expect(last(onChange).at(-1)).toBe(H('backward-diagonal'));
    });

    it('detects categories with a different hatch each, and has no palette or ramp', () => {
        const { editor, onChange } = mount('hatch|cross|#000000|8|1');
        [...editor.element.querySelectorAll('.sym-tab')].find(t => t.textContent === 'Categorized').click();
        const expression = last(onChange);
        const outputs = expression.filter((_, i) => i >= 2 && i % 2 === 1 && i < expression.length - 1);
        expect(outputs).toHaveLength(3);
        expect(new Set(outputs).size).toBe(3);
        outputs.forEach(name => expect(parseHatchImageName(name)).not.toBeNull());
        expect(editor.element.textContent).not.toContain('Palette');
    });

    it('offers graduated classes but no continuous blending', () => {
        const { editor, onChange } = mount('hatch|cross|#000000|8|1');
        editor.getSamples = null;
        [...editor.element.querySelectorAll('.sym-tab')].find(t => t.textContent === 'Graduated').click();
        expect(editor.element.textContent).not.toContain('Continuous');
        expect(editor.element.textContent).not.toContain('Ramp');
        expect(editor.model.kind).toBe('step');
        expect(onChange).toHaveBeenCalled();
    });
});

describe('StylePropertyEditor with fill-pattern', () => {
    const row = (editor, key) => [...editor.element.querySelectorAll('.spe-row')]
        .find(r => r.querySelector('.spe-name').textContent === key);

    function mount(style) {
        const onChange = vi.fn();
        const editor = new StylePropertyEditor({ onChange, getFields: () => ['use_zones'], getSamples: () => [] });
        document.body.appendChild(editor.element);
        editor.setLayer({ type: 'arcgis', style });
        editor.setTab('all');
        return { editor, onChange };
    }

    it('opens the hatch/fill-pattern match in the symbology editor instead of JSON', () => {
        const { editor } = mount({ 'hatch/fill-pattern': PATTERN, 'fill-color': '#fff' });
        const patternRow = row(editor, 'hatch/fill-pattern');
        expect(patternRow.querySelector('.sym-root')).not.toBeNull();
        expect(patternRow.querySelector('textarea')).toBeNull();
        expect(patternRow.querySelectorAll('.hatch-preview').length).toBe(6);
    });

    it('edits a literal fill-pattern with a swatch that opens the hatch editor', () => {
        const { editor, onChange } = mount({ 'fill-pattern': H('cross') });
        const patternRow = row(editor, 'fill-pattern');
        patternRow.querySelector('.hatch-trigger').click();

        const kind = document.querySelector('.hatch-editor select');
        kind.value = 'horizontal';
        kind.dispatchEvent(new Event('change'));

        expect(editor.getStyle()['fill-pattern']).toBe(H('horizontal'));
        expect(onChange).toHaveBeenCalled();
        expect(patternRow.querySelector('input[type="text"]').value).toBe(H('horizontal'));
    });

    it('lets a hatch be typed by name and rejects an empty one', () => {
        const { editor } = mount({ 'fill-pattern': H('cross') });
        const text = row(editor, 'fill-pattern').querySelector('input[type="text"]');
        text.value = 'hatch|vertical|#ff0000|6|2';
        text.dispatchEvent(new Event('input'));
        expect(editor.getStyle()['fill-pattern']).toBe('hatch|vertical|#ff0000|6|2');

        text.value = '';
        text.dispatchEvent(new Event('input'));
        expect(editor.getStyle()['fill-pattern']).toBe('hatch|vertical|#ff0000|6|2');
    });

    it('adds fill-pattern from the property picker with a starter hatch', () => {
        const { editor } = mount({ 'fill-color': '#fff' });
        const picker = editor.element.querySelector('.spe-add select');
        picker.value = 'fill-pattern';
        picker.dispatchEvent(new Event('change'));
        expect(parseHatchImageName(editor.getStyle()['fill-pattern'])).not.toBeNull();
    });
});

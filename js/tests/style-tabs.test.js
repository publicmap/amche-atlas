// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { StylePropertyEditor } from '../style-property-editor.js';
import { RulesView, renderRuleSymbol } from '../rules-view.js';
import { analyzeRules } from '../style-rules.js';

HTMLCanvasElement.prototype.getContext = () => null;

const INPUT = ['to-string', ['get', 'use_zones']];
const match = (pairs, fallback) => ['match', INPUT, ...pairs.flat(), fallback];
const H = (kind) => `hatch|${kind}|#000000|8|1`;

const style = () => ({
    'hatch/filter': ['in', INPUT, ['literal', ['G1', 'T1']]],
    'hatch/fill-pattern': match([['G1', H('forward-diagonal')], ['T1', H('vertical')]], H('cross')),
    'hatch/fill-opacity': 1,
    'fill-color': match([['R', '#f59e0b'], ['G1', 'rgba(0, 0, 0, 0)'], ['T1', 'rgba(0, 0, 0, 0)']], 'rgba(0, 0, 0, 0)'),
    'line-color': match([['R', '#9c9c9c'], ['G1', '#000000'], ['T1', '#000000']], 'rgba(0, 0, 0, 0)'),
    'line-width': match([['R', 0.5], ['G1', 0.5], ['T1', 0.5]], 0),
    'fill-opacity': 1,
    'text-field': ['to-string', ['get', 'CODE_PREMI']],
    'text-color': '#000000',
    'text-size': 5
});

function mount(layerStyle, layerId = 'zones') {
    const onChange = vi.fn();
    const editor = new StylePropertyEditor({ onChange, getFields: () => ['use_zones'], getSamples: () => [] });
    document.body.appendChild(editor.element);
    editor.setLayer({ id: layerId, type: 'arcgis', style: layerStyle });
    return { editor, onChange };
}

const tabs = (editor) => [...editor.element.querySelectorAll('.spe-tab')];
const tab = (editor, id) => tabs(editor).find(t => t.dataset.tab === id);
const names = (editor) => [...editor.element.querySelectorAll('.spe-name')].map(n => n.textContent);
const rows = (editor) => [...editor.element.querySelectorAll('.rv-row')];

describe('style tabs', () => {
    it('shows Rules, Point, Line, Area, Label, Circle, Icon and * in that order', () => {
        const { editor } = mount(style());
        expect(tabs(editor).map(t => t.dataset.tab)).toEqual(['rules', 'point', 'line', 'area', 'label', 'circle', 'icon', 'all']);
        expect(tabs(editor).map(t => t.querySelector('span').textContent)).toEqual(['Rules', 'Point', 'Line', 'Area', 'Label', 'Circle', 'Icon', '*']);
    });

    it('opens on Rules when the style has rules, and counts what each tab holds', () => {
        const { editor } = mount(style());
        expect(editor.tab).toBe('rules');
        expect(tab(editor, 'rules').classList.contains('spe-tab-active')).toBe(true);
        expect(tab(editor, 'rules').querySelector('.spe-tab-count').textContent).toBe('3');
        expect(tab(editor, 'area').querySelector('.spe-tab-count').textContent).toBe('4');
        expect(tab(editor, 'line').querySelector('.spe-tab-count').textContent).toBe('2');
        expect(tab(editor, 'label').querySelector('.spe-tab-count').textContent).toBe('3');
        expect(tab(editor, 'circle').classList.contains('spe-tab-empty')).toBe(true);
        expect(tab(editor, 'all').querySelector('.spe-tab-count').textContent).toBe('10');
    });

    it('opens on the one category in use when there are no rules, otherwise on "*"', () => {
        expect(mount({ 'fill-color': '#fff', 'fill-opacity': 0.5 }).editor.tab).toBe('area');
        expect(mount({ 'fill-color': '#fff', 'line-width': 2 }).editor.tab).toBe('all');
        expect(mount({}).editor.tab).toBe('all');
    });

    it('filters the properties shown to the active category', () => {
        const { editor } = mount(style());
        editor.setTab('area');
        expect(names(editor)).toEqual(['hatch/fill-pattern', 'hatch/fill-opacity', 'fill-color', 'fill-opacity']);
        editor.setTab('line');
        expect(names(editor)).toEqual(['line-color', 'line-width']);
        editor.setTab('label');
        expect(names(editor)).toEqual(['text-field', 'text-color', 'text-size']);
    });

    it('lists "*" with unclaimed properties first, then each section in order', () => {
        const { editor } = mount(style());
        editor.setTab('all');
        const sections = [...editor.element.querySelectorAll('.spe-section')].map(n => n.textContent);
        expect(sections).toEqual(['Colors', 'Other', 'Line', 'Area', 'Label']);
        expect(names(editor)[0]).toBe('hatch/filter');
        expect(names(editor)).toHaveLength(10);
    });

    it('shows an empty state and an add control scoped to the tab', () => {
        const { editor } = mount(style());
        editor.setTab('circle');
        expect(editor.element.querySelector('.spe-empty').textContent).toContain('No circle properties');
        const options = [...editor.element.querySelectorAll('.spe-add option')].map(o => o.value).filter(Boolean);
        expect(options).toContain('circle-blur');
        expect(options).not.toContain('line-width');
        expect(options.every(p => p.startsWith('circle-'))).toBe(true);

        editor.setTab('icon');
        const iconOptions = [...editor.element.querySelectorAll('.spe-add option')].map(o => o.value).filter(Boolean);
        expect(iconOptions).toContain('icon-image');
        expect(iconOptions).toContain('icon-size');
    });

    it('keeps its tab when the same layer is reseeded, and picks again for a different layer', () => {
        const { editor } = mount(style(), 'zones');
        editor.setTab('line');
        editor.setLayer({ id: 'zones', type: 'arcgis', style: style() });
        expect(editor.tab).toBe('line');
        editor.setLayer({ id: 'other', type: 'arcgis', style: { 'fill-color': '#fff' } });
        expect(editor.tab).toBe('area');
    });

    it('navigates to a property on its own category tab, highlighted', () => {
        const { editor } = mount(style());
        editor.setTab('rules');
        editor.focusProperty('line-width');
        expect(editor.tab).toBe('line');
        const row = [...editor.element.querySelectorAll('.spe-row')].find(r => r.dataset.key === 'line-width');
        expect(row).toBeDefined();
        expect(row.classList.contains('spe-flash')).toBe(true);

        editor.focusProperty('hatch/fill-pattern');
        expect(editor.tab).toBe('area');
        editor.focusProperty('hatch/filter');
        expect(editor.tab).toBe('all');
    });
});

describe('Rules tab', () => {
    function openRules() {
        const mounted = mount(style());
        return { ...mounted, view: mounted.editor.element };
    }
    const labelOf = (row) => row.querySelector('.rv-label').textContent;

    it('lists a row per rule with the fallback last', () => {
        const { editor } = openRules();
        expect(rows(editor).map(labelOf)).toEqual(['use_zones = R', 'use_zones = G1', 'use_zones = T1', 'Everything else (fallback)']);
        expect(editor.element.querySelector('.rv-summary').textContent).toContain('3 rules');
        expect(editor.element.querySelector('.rv-summary').textContent).toContain('use_zones');
    });

    it('draws each rule\'s consolidated symbol: fill, outline and hatch where they apply', () => {
        const { editor } = openRules();
        const [r, g1] = rows(editor);

        const plain = r.querySelector('.rv-symbol');
        expect(plain.querySelector('.rv-area').style.background).toContain('245, 158, 11');
        expect(plain.querySelector('.rv-hatch')).toBeNull();

        const hatched = g1.querySelector('.rv-symbol');
        expect(hatched.querySelector('.rv-hatch').dataset.hatch).toBe(H('forward-diagonal'));
        expect(hatched.style.border).toContain('1px solid');
    });

    it('renders a line or a dot when that is all a rule styles', () => {
        const line = analyzeRules({ 'line-color': match([['A', '#ff0000']], '#000'), 'line-width': 3 }).rows[0];
        expect(renderRuleSymbol(line).querySelector('.rv-stroke')).not.toBeNull();
        const dot = analyzeRules({ 'circle-color': match([['A', '#00ff00']], '#000'), 'circle-radius': 5 }).rows[0];
        expect(renderRuleSymbol(dot).querySelector('.rv-dot')).not.toBeNull();
    });

    it('opens a row to show the rule and the properties that define it', () => {
        const { editor } = openRules();
        rows(editor)[1].querySelector('.rv-head').click();

        const open = rows(editor)[1];
        expect(open.classList.contains('rv-open')).toBe(true);
        expect(open.querySelector('.rv-condline').textContent).toBe('whenuse_zones = G1');
        const props = [...open.querySelectorAll('.rv-prop .rv-link-name')].map(n => n.textContent);
        expect(props).toEqual(expect.arrayContaining(['fill-color', 'line-color', 'line-width', 'hatch/fill-pattern']));
        expect([...open.querySelectorAll('.rv-chips .rv-link-name')].map(n => n.textContent)).toEqual(expect.arrayContaining(['fill-opacity', 'text-size']));

        rows(editor)[2].querySelector('.rv-head').click();
        expect(rows(editor)[1].classList.contains('rv-open')).toBe(false);
        expect(rows(editor)[2].classList.contains('rv-open')).toBe(true);
    });

    it('shows nested conditions in order, indented, with unreadable ones as JSON', () => {
        const nested = { 'fill-color': ['case', ['within', { type: 'Polygon' }], match([['G1', '#111']], '#222'), '#333'] };
        const { editor } = mount(nested);
        const deep = rows(editor).find(r => r.querySelector('.rv-label').textContent.includes('›'));
        deep.querySelector('.rv-head').click();

        const lines = [...editor.element.querySelectorAll('.rv-condline')];
        expect(lines).toHaveLength(2);
        expect(lines[0].querySelector('.rv-when').textContent).toBe('when');
        expect(lines[0].querySelector('code').textContent.startsWith('["within"')).toBe(true);
        expect(lines[1].querySelector('.rv-when').textContent).toBe('and when');
        expect(lines[1].style.paddingLeft).toBe('14px');
    });

    it('opens a property from the rule on that property\'s own tab', () => {
        const { editor } = openRules();
        rows(editor)[1].querySelector('.rv-head').click();
        const link = [...editor.element.querySelectorAll('.rv-prop .rv-link')].find(l => l.textContent.startsWith('line-color'));
        link.click();

        expect(editor.tab).toBe('line');
        expect([...editor.element.querySelectorAll('.spe-row')].some(r => r.dataset.key === 'line-color')).toBe(true);
        expect(tab(editor, 'line').classList.contains('spe-tab-active')).toBe(true);
    });

    it('edits just that rule\'s branch of a property in place', () => {
        const { editor, onChange } = openRules();
        rows(editor)[1].querySelector('.rv-head').click();

        const prop = [...editor.element.querySelectorAll('.rv-prop')].find(p => p.textContent.startsWith('line-color'));
        const swatch = prop.querySelector('input[type="color"]');
        expect(swatch.value).toBe('#000000');
        swatch.value = '#ff0000';
        swatch.dispatchEvent(new Event('input'));

        const next = editor.getStyle()['line-color'];
        expect(next[next.indexOf('G1') + 1]).toBe('#ff0000');
        expect(next[next.indexOf('T1') + 1]).toBe('#000000');
        expect(next[next.indexOf('R') + 1]).toBe('#9c9c9c');
        expect(onChange.mock.calls.at(-1)[0]['line-color']).toEqual(next);
        // the open row stays open and its symbol is redrawn with the new outline
        expect(rows(editor)[1].classList.contains('rv-open')).toBe(true);
        expect(rows(editor)[1].querySelector('.rv-symbol').style.border).toContain('255, 0, 0');
    });

    it('edits the fallback from the fallback row', () => {
        const { editor } = openRules();
        rows(editor).at(-1).querySelector('.rv-head').click();
        const prop = [...editor.element.querySelectorAll('.rv-prop')].find(p => p.textContent.startsWith('line-width'));
        const number = prop.querySelector('input[type="number"]');
        number.value = '2';
        number.dispatchEvent(new Event('input'));
        expect(editor.getStyle()['line-width'].at(-1)).toBe(2);
    });

    it('edits a hatch from a rule through the hatch editor', () => {
        const { editor } = openRules();
        rows(editor)[1].querySelector('.rv-head').click();
        const prop = [...editor.element.querySelectorAll('.rv-prop')].find(p => p.textContent.startsWith('hatch/fill-pattern'));
        prop.querySelector('.hatch-trigger').click();
        const kind = document.querySelector('.hatch-editor select');
        kind.value = 'cross';
        kind.dispatchEvent(new Event('change'));
        const next = editor.getStyle()['hatch/fill-pattern'];
        expect(next[next.indexOf('G1') + 1]).toBe(H('cross'));
        document.querySelector('.hatch-done').click();
    });

    it('leaves a property that inherits from another read-only', () => {
        const inherited = { 'fill-color': match([['A', '#111111']], '#222222'), 'line-color': '@fill-color' };
        const { editor } = mount(inherited);
        rows(editor).find(r => r.querySelector('.rv-label').textContent === 'use_zones = A').querySelector('.rv-head').click();
        const prop = [...editor.element.querySelectorAll('.rv-prop')].find(p => p.textContent.startsWith('line-color'));
        expect(prop.querySelector('input')).toBeNull();
        expect(prop.querySelector('.rv-readonly').textContent).toBe('inherits @fill-color');
    });

    it('says so when nothing is data-driven', () => {
        const view = new RulesView();
        document.body.appendChild(view.element);
        view.setStyle({ 'fill-color': '#fff', 'line-width': 2 });
        expect(view.element.querySelector('.rv-summary').textContent).toContain('No data-driven rules');
        expect(view.element.querySelectorAll('.rv-row')).toHaveLength(1);
        expect(view.element.querySelector('.rv-label').textContent).toBe('All features');
    });
});

describe('Data filters section', () => {
    const filterRows = (editor) => [...editor.element.querySelectorAll('.rv-filter')];

    function mountFiltered(layerFilter) {
        const onChange = vi.fn();
        const onFilterChange = vi.fn();
        const editor = new StylePropertyEditor({ onChange, onFilterChange });
        document.body.appendChild(editor.element);
        editor.setLayer({ id: 'zones', type: 'arcgis', filter: layerFilter, style: style() });
        return { editor, onChange, onFilterChange };
    }

    it('sits above the rules and lists the layer filter and each overlay filter, readably', () => {
        const { editor } = mountFiltered(['==', ['get', 'zone'], 'N']);
        const headings = [...editor.element.querySelectorAll('.rv-heading')].map(h => h.textContent);
        expect(headings.slice(0, 2)).toEqual(['Data filters', 'Rules']);

        expect(filterRows(editor).map(r => r.querySelector('.rv-scope').textContent)).toEqual(['Layer', 'Overlay “hatch”']);
        expect(filterRows(editor)[0].querySelector('.rv-filter-text').textContent).toBe('zone = N');
        expect(filterRows(editor)[1].querySelector('.rv-filter-text').textContent).toBe('use_zones in G1, T1');
    });

    it('says so when there are none, and offers to add a layer filter', () => {
        const { editor, onFilterChange } = mountFiltered(undefined);
        editor.setTab('rules');
        expect(filterRows(editor)).toHaveLength(1);

        editor.element.querySelector('.rv-add').click();
        expect(onFilterChange).toHaveBeenCalledWith(['has', 'use_zones']);
        const layerRow = filterRows(editor).find(r => r.querySelector('.rv-scope').textContent === 'Layer');
        expect(layerRow.classList.contains('rv-open')).toBe(true);
        expect(layerRow.querySelector('.rv-json').value).toContain('has');
    });

    it('edits the layer filter as JSON, reporting valid edits and rejecting invalid ones', () => {
        const { editor, onFilterChange } = mountFiltered(['==', ['get', 'zone'], 'N']);
        filterRows(editor)[0].querySelector('.rv-icon-btn').click();
        const area = filterRows(editor)[0].querySelector('.rv-json');

        area.value = '["==", ["get", "zone"], "S"]';
        area.dispatchEvent(new Event('input'));
        expect(onFilterChange).toHaveBeenLastCalledWith(['==', ['get', 'zone'], 'S']);
        expect(filterRows(editor)[0].querySelector('.rv-filter-text').textContent).toBe('zone = S');

        const calls = onFilterChange.mock.calls.length;
        area.value = '{ nope';
        area.dispatchEvent(new Event('input'));
        expect(onFilterChange.mock.calls.length).toBe(calls);
        expect(filterRows(editor)[0].querySelector('.rv-error').textContent).not.toBe('');

        area.value = '"not an array"';
        area.dispatchEvent(new Event('input'));
        expect(filterRows(editor)[0].querySelector('.rv-error').textContent).toContain('array');
    });

    it('removes the layer filter', () => {
        const { editor, onFilterChange } = mountFiltered(['has', 'x']);
        filterRows(editor)[0].querySelector('.rv-remove').click();
        expect(onFilterChange).toHaveBeenLastCalledWith(undefined);
        expect(filterRows(editor).some(r => r.querySelector('.rv-scope').textContent === 'Layer')).toBe(false);
    });

    it('edits an overlay filter as a style value, and links to the properties it governs', () => {
        const { editor, onChange } = mountFiltered(undefined);
        const overlay = filterRows(editor).find(r => r.querySelector('.rv-scope').textContent.startsWith('Overlay'));
        overlay.querySelector('.rv-icon-btn').click();

        const open = filterRows(editor).find(r => r.querySelector('.rv-scope').textContent.startsWith('Overlay'));
        const area = open.querySelector('.rv-json');
        area.value = JSON.stringify(['in', INPUT, ['literal', ['G1']]]);
        area.dispatchEvent(new Event('input'));
        expect(editor.getStyle()['hatch/filter'][2]).toEqual(['literal', ['G1']]);
        expect(onChange.mock.calls.at(-1)[0]['hatch/filter'][2]).toEqual(['literal', ['G1']]);

        open.querySelector('.rv-chips .rv-link').click();
        expect(editor.tab).toBe('area');
    });

    it('removes an overlay filter from the style', () => {
        const { editor } = mountFiltered(undefined);
        const overlay = filterRows(editor).find(r => r.querySelector('.rv-scope').textContent.startsWith('Overlay'));
        overlay.querySelector('.rv-remove').click();
        expect(editor.getStyle()['hatch/filter']).toBeUndefined();
    });
});

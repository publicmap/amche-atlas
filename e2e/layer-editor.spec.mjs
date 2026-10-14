import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// One editor for adding and editing layers: map-creator.html. Editing a layer
// (from the layer info panel's Edit button, or anywhere else) opens the same
// editor prefilled with the layer's source, details, inspect fields, style and
// filters; replacing the source asks whether to keep the styling.

const square = (x, y) => [[[x, y], [x + 0.01, y], [x + 0.01, y + 0.01], [x, y + 0.01], [x, y]]];
const collection = (rows) => ({
    type: 'FeatureCollection',
    features: rows.map((properties, i) => ({
        type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: square(73.8 + i * 0.02, 15.47) }
    }))
});

const EDIT_LAYER = {
    id: 'edit-test',
    type: 'geojson',
    title: 'Edit Test',
    description: 'A layer to edit',
    attribution: 'src.example.org',
    geojson: collection([{ id: 1, name: 'A', kind: 'park' }, { id: 2, name: 'B', kind: 'road' }]),
    inspect: { id: 'id', title: 'Name', label: 'name', fields: ['name', 'kind'], fieldTitles: ['Name', 'Kind'] },
    style: { 'fill-color': '#ff0000', 'fill-opacity': 0.5, 'line-width': 2 }
};
const OTHER_LAYER = { id: 'edit-other', type: 'geojson', title: 'Other', geojson: collection([{ id: 9, name: 'Z' }]), style: { 'fill-color': '#00ff00' } };

async function boot(page) {
    await page.goto('/?atlas=index', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(
        () => !!window.layerControl?._mapboxAPI && !!window.browserControl && !!window.featureControl && !!window.map?.isStyleLoaded?.(),
        undefined, { timeout: 90000 }
    );
    await page.evaluate(async ([a, b]) => {
        await window.layerControl._addLayerDirectly(a);
        await window.layerControl._addLayerDirectly(b); // added last, so on top
    }, [EDIT_LAYER, OTHER_LAYER]);
}

async function creatorFrame(page) {
    let frame;
    for (let i = 0; i < 60 && !frame; i++) {
        frame = page.frames().find(f => f.url().includes('map-creator.html'));
        if (!frame) await page.waitForTimeout(250);
    }
    await frame.waitForLoadState('load');
    return frame;
}

async function openEditor(page) {
    await page.evaluate((layer) => window.browserControl.openLayerEditor(layer, { tab: 'edit' }), EDIT_LAYER);
    const frame = await creatorFrame(page);
    // seeded once the source has loaded
    await expect.poll(async () => frame.locator('#layer-id').inputValue(), { timeout: 30000 }).toBe('edit-test');
    // the source has loaded
    await expect(frame.locator('#config-preview')).toHaveValue(/"id": "edit-test"/, { timeout: 30000 });
    return frame;
}

const groupsWith = (page, id) => page.evaluate((i) => window.layerControl._state.groups.filter(g => g.id === i).length, id);
const indexOf = (page, id) => page.evaluate((i) => window.layerControl._state.groups.findIndex(g => g.id === i), id);
const titleOf = (page, id) => page.evaluate((i) => window.layerControl._state.groups.find(g => g.id === i)?.title, id);
const configOf = async (frame) => JSON.parse(await frame.locator('#config-preview').inputValue());

function writeGeoJSON(rows) {
    const file = path.join(os.tmpdir(), `layer-editor-${Date.now()}-${Math.random().toString(16).slice(2)}.geojson`);
    fs.writeFileSync(file, JSON.stringify(collection(rows)));
    return file;
}

test.describe.configure({ timeout: 120000 });

test('opens the editor on the layer with its source, details, inspect fields and style filled in', async ({ page }) => {
    await boot(page);
    const frame = await openEditor(page);

    await expect(frame.locator('#add-to-map-btn')).toHaveText('Save Layer');
    await expect(frame.locator('#remove-other-maps-btn')).toBeHidden();
    expect(await frame.locator('#layer-title').inputValue()).toBe('Edit Test');
    expect(await frame.locator('#layer-description').inputValue()).toBe('A layer to edit');
    expect(await frame.locator('#layer-attribution').inputValue()).toBe('src.example.org');

    // Inspect fields live in the data editor: the ones set on the layer are the ones shown, id and name included.
    await frame.locator('#data-card .data-card-head').click();
    await expect(frame.locator('#data-fields-section')).toBeVisible({ timeout: 30000 });
    expect(await frame.locator('#feature-id-field').inputValue()).toBe('id');
    expect(await frame.locator('#feature-name-field').inputValue()).toBe('name');
    const checked = await frame.locator('#inspect-fields-list input:checked').evaluateAll(els => els.map(e => e.value));
    expect(checked.sort()).toEqual(['kind', 'name']);

    // The style it already had, in the config and in the Advanced style editor.
    const config = await configOf(frame);
    expect(config.style['fill-color']).toBe('#ff0000');
    expect(config.inspect).toMatchObject({ id: 'id', label: 'name', fields: ['name', 'kind'], fieldTitles: ['Name', 'Kind'] });
    await frame.locator('#lh-thumbnail').click();
    await frame.locator('.spe-tab[data-tab="all"]').click();
    expect(await frame.locator('#advanced-style-editor .spe-name').allTextContents()).toEqual(expect.arrayContaining(['fill-color', 'fill-opacity', 'line-width']));

    // The live preview stands in for the layer rather than doubling it.
    await expect.poll(() => groupsWith(page, 'edit-test'), { timeout: 20000 }).toBe(1);
});

test('Save Layer replaces the layer in place, keeping its position in the stack', async ({ page }) => {
    await boot(page);
    await expect.poll(async () => (await indexOf(page, 'edit-other')) < (await indexOf(page, 'edit-test')), { timeout: 20000 }).toBe(true);

    const frame = await openEditor(page);
    await frame.locator('#layer-title').fill('Renamed Layer');
    await frame.locator('#desc-summary').click();
    await frame.locator('#layer-description').fill('Edited description');
    await expect.poll(async () => (await configOf(frame)).title).toBe('Renamed Layer');
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('Renamed Layer');

    await frame.locator('#add-to-map-btn').click();
    // Applied: the panel stays, in view mode, with an Edit button
    await expect(frame.locator('#edit-btn')).toBeVisible({ timeout: 15000 });
    await expect(frame.locator('#add-to-map-btn')).toBeHidden();
    await expect(frame.locator('#layer-title')).toHaveJSProperty('readOnly', true);
    expect(await page.evaluate(() => window.browserControl._isOpen)).toBe(true);

    expect(await groupsWith(page, 'edit-test')).toBe(1);
    const group = await page.evaluate(() => {
        const g = window.layerControl._state.groups.find(x => x.id === 'edit-test');
        return { title: g.title, description: g.description, style: g.style, inspect: g.inspect, json: g._originalJson };
    });
    expect(group).toMatchObject({ title: 'Renamed Layer', description: 'Edited description' });
    expect(group.style['fill-color']).toBe('#ff0000');
    expect(group.inspect.fields).toEqual(['name', 'kind']);
    // The edit is what the URL carries, not the layer as it was.
    expect(group.json).toContain('Renamed Layer');
    // Still below the layer that was above it.
    await expect.poll(async () => (await indexOf(page, 'edit-other')) < (await indexOf(page, 'edit-test'))).toBe(true);
});

test('× mid-edit puts the original layer back, unchanged and in place', async ({ page }) => {
    await boot(page);
    const frame = await openEditor(page);
    await frame.locator('#layer-title').fill('Should Not Stick');
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('Should Not Stick');

    await frame.locator('#close-btn').click();
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('Edit Test');
    await expect(frame.locator('#edit-btn')).toBeVisible();
    await expect(frame.locator('#layer-title')).toHaveValue('Edit Test');
    expect(await page.evaluate(() => window.browserControl._isOpen)).toBe(true);
    expect(await groupsWith(page, 'edit-test')).toBe(1);
    expect(await groupsWith(page, 'edit-other')).toBe(1);
    await expect.poll(async () => { const t = await indexOf(page, 'edit-test'); return t > 0 && (await indexOf(page, 'edit-other')) < t; }, { timeout: 20000 }).toBe(true);
});

test('replacing the source offers to keep the styling or restyle', async ({ page }) => {
    await boot(page);
    const frame = await openEditor(page);
    await expect(frame.locator('#edit-style-choice')).toBeHidden();

    await frame.locator('#file-input').setInputFiles(writeGeoJSON([{ id: 1, name: 'N', area: 40 }, { id: 2, name: 'M', area: 60 }]));
    await expect(frame.locator('#edit-style-choice')).toBeVisible({ timeout: 30000 });

    // Keep (the default): the layer's styling and settings carry over to the new data.
    await expect.poll(async () => (await configOf(frame)).style?.['fill-color'], { timeout: 20000 }).toBe('#ff0000');
    let config = await configOf(frame);
    expect(config).toMatchObject({ id: 'edit-test', title: 'Edit Test', description: 'A layer to edit' });
    // Inspect settings narrow to the fields the new data has: `kind` is gone, `name` stays.
    expect(config.inspect.fields).toEqual(['name']);
    expect(config.inspect.label).toBe('name');

    // Restyle: the style a new layer would get from this data.
    await frame.locator('input[name="edit-style-choice"][value="restyle"]').check();
    await expect.poll(async () => String((await configOf(frame)).style?.['fill-color']), { timeout: 30000 }).not.toContain('#ff0000');
    config = await configOf(frame);
    expect(config.title).toBe('Edit Test');
    expect(config.style['fill-color']).toBeDefined();

    // ...and back.
    await frame.locator('input[name="edit-style-choice"][value="keep"]').check();
    await expect.poll(async () => (await configOf(frame)).style?.['fill-color'], { timeout: 30000 }).toBe('#ff0000');
});

async function openOverview(page) {
    await page.evaluate((layer) => window.browserControl._openLayerInfo(layer), EDIT_LAYER);
    const frame = await creatorFrame(page);
    await expect.poll(async () => frame.locator('#layer-title').inputValue(), { timeout: 30000 }).toBe('Edit Test');
    return frame;
}

test('a layer opens read-only, and Edit makes thumbnail, description and data clickable', async ({ page }) => {
    await boot(page);
    const frame = await openOverview(page);

    await expect(frame.locator('#layer-header')).toBeVisible();
    await expect(frame.locator('#layer-actions')).toBeVisible();
    expect(await frame.locator('#layer-id').inputValue()).toBe('edit-test');
    for (const id of ['#lh-compare', '#lh-isolate', '#lh-mask', '#lh-remove', '#lh-export-layer', '#lh-move-up', '#lh-move-down', '#lh-opacity']) {
        await expect(frame.locator(id)).toBeVisible();
    }
    expect(await groupsWith(page, 'edit-test')).toBe(1);

    // Viewing: the footer is just Edit, nothing opens, no edit session has started.
    await expect(frame.locator('#edit-btn')).toBeVisible();
    await expect(frame.locator('#add-to-map-btn')).toBeHidden();
    await expect(frame.locator('#edit-history')).toBeHidden();
    await expect(frame.locator('#layer-title')).toHaveJSProperty('readOnly', true);
    await expect(frame.locator('#desc-summary-text')).toHaveText('A layer to edit');
    await expect(frame.locator('#desc-summary-attribution')).toHaveText('src.example.org');
    await expect(frame.locator('#data-card-title')).toContainText('Data stored with this layer');
    await expect(frame.locator('#style-section')).toBeHidden();
    await frame.locator('#desc-summary').click({ force: true });
    await expect(frame.locator('#desc-editor')).toBeHidden();
    expect(await page.evaluate(() => !!window.browserControl._editSession)).toBe(false);

    // Edit: sections respond to clicks.
    await frame.locator('#edit-btn').click();
    await expect(frame.locator('#add-to-map-btn')).toHaveText('Save Layer');
    await expect(frame.locator('#edit-history')).toBeVisible();
    await expect(frame.locator('#edit-btn')).toBeHidden();
    await expect(frame.locator('#layer-title')).toHaveJSProperty('readOnly', false);
    await expect(frame.locator('#config-preview')).toHaveValue(/"id": "edit-test"/, { timeout: 30000 });

    await frame.locator('#desc-summary').click();
    await expect(frame.locator('#desc-editor')).toBeVisible();
    await expect(frame.locator('#layer-description')).toHaveValue('A layer to edit');
    await frame.locator('#layer-description').fill('Changed in the form');
    await expect.poll(async () => (await configOf(frame)).description).toBe('Changed in the form');
    await frame.locator('#desc-done').click();
    await expect(frame.locator('#desc-summary-text')).toHaveText('Changed in the form');

    await expect(frame.locator('#style-section')).toBeHidden();
    await frame.locator('#lh-thumbnail').click();
    await expect(frame.locator('#style-section')).toBeVisible();
    await expect(frame.locator('#style-controls')).toBeVisible({ timeout: 30000 });
    await frame.locator('#style-done').click();
    await expect(frame.locator('#style-section')).toBeHidden();

    await expect(frame.locator('#data-card')).toHaveClass(/is-collapsed/, { timeout: 30000 });
    await expect(frame.locator('#data-settings')).toBeHidden();
    await frame.locator('#data-card .data-card-head').click();
    await expect(frame.locator('#data-settings')).toBeVisible();
    await expect(frame.locator('#layer-type')).toBeVisible();
    await frame.locator('#data-card .data-card-head').click();
    await expect(frame.locator('#data-card')).toHaveClass(/is-collapsed/);
});

test('undo and redo step through the changes made while editing', async ({ page }) => {
    await boot(page);
    const frame = await openOverview(page);
    await frame.locator('#edit-btn').click();
    await expect(frame.locator('#config-preview')).toHaveValue(/"id": "edit-test"/, { timeout: 30000 });
    await expect(frame.locator('#undo-btn')).toBeDisabled();

    await frame.locator('#layer-title').fill('First');
    await expect(frame.locator('#undo-btn')).toBeEnabled({ timeout: 10000 });
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('First');
    await frame.locator('#layer-title').fill('Second');
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('Second');
    await page.waitForTimeout(700);

    await frame.locator('#undo-btn').click();
    await expect(frame.locator('#layer-title')).toHaveValue('First');
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('First');
    await expect(frame.locator('#redo-btn')).toBeEnabled();

    await frame.locator('#undo-btn').click();
    await expect(frame.locator('#layer-title')).toHaveValue('Edit Test');
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('Edit Test');
    await expect(frame.locator('#undo-btn')).toBeDisabled();

    await frame.locator('#redo-btn').click();
    await frame.locator('#redo-btn').click();
    await expect(frame.locator('#layer-title')).toHaveValue('Second');
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('Second');
    await expect(frame.locator('#redo-btn')).toBeDisabled();
});

test('isolation is on while viewing and editing, and released when the panel closes', async ({ page }) => {
    await boot(page);
    const isolated = () => page.evaluate(() => window.layerControl.isolation.isActive);
    expect(await isolated()).toBe(false);

    const frame = await openOverview(page);
    await expect.poll(isolated, { timeout: 15000 }).toBe(true);
    await expect(frame.locator('#lh-isolate')).toContainText('Hiding Other Maps');

    // Editing swaps the layer for a draft on every change; the others stay dimmed.
    await frame.locator('#edit-btn').click();
    await expect(frame.locator('#config-preview')).toHaveValue(/"id": "edit-test"/, { timeout: 30000 });
    await frame.locator('#layer-title').fill('Draft Title');
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('Draft Title');
    expect(await isolated()).toBe(true);

    // It can be turned off, and back on.
    await frame.locator('#lh-isolate').click();
    await expect.poll(isolated).toBe(false);
    await expect(frame.locator('#lh-isolate')).toContainText('Hide Other Maps');
    await frame.locator('#lh-isolate').click();
    await expect.poll(isolated).toBe(true);

    // × mid-edit cancels it: the layer is put back, the panel stays. × again closes it and undims everything.
    await frame.locator('#close-btn').click();
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('Edit Test');
    await expect(frame.locator('#edit-btn')).toBeVisible();
    await frame.locator('#close-btn').click();
    await expect.poll(isolated, { timeout: 15000 }).toBe(false);
    expect(await groupsWith(page, 'edit-test')).toBe(1);
});

test('the copied link restores the whole scene with the editor open on the layer', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await boot(page);
    const frame = await openOverview(page);
    await frame.locator('#layer-id').click({ force: true });
    const link = await page.evaluate(() => navigator.clipboard.readText());

    const url = new URL(link);
    expect(url.searchParams.get('edit')).toBe('edit-test');
    // the scene is the page's own URL: nothing else is dropped
    const current = new URL(await page.evaluate(() => window.location.href));
    current.searchParams.set('edit', 'edit-test');
    expect(url.searchParams.get('layers')).toBe(current.searchParams.get('layers'));
    expect(url.hash).toBe(current.hash);

    // opened afresh, the other layers are all still there and the editor is open
    const inline = (layer) => JSON.stringify(layer).replace(/"/g, "'");
    const scene = new URL(url);
    scene.searchParams.set('layers', `${inline({ ...EDIT_LAYER, geojson: undefined, type: 'geojson', url: 'data:application/json,' + encodeURIComponent(JSON.stringify(EDIT_LAYER.geojson)) })},mapbox-satellite`);
    await page.goto(scene.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 });
    const reopened = await creatorFrame(page);
    await expect.poll(async () => reopened.locator('#layer-title').inputValue(), { timeout: 60000 }).toBe('Edit Test');
    expect(await page.evaluate(() => window.layerControl._state.groups.some(g => g.id === 'mapbox-satellite'))).toBe(true);
    expect(new URL(await page.evaluate(() => window.location.href)).searchParams.has('edit')).toBe(false);
});

test('the legend lists each style rule, and clicking it opens that rule in the style editor', async ({ page }) => {
    await boot(page);
    const layer = {
        ...EDIT_LAYER,
        id: 'rules-test',
        inspect: { ...EDIT_LAYER.inspect, label: 'kind' },
        style: { 'fill-color': ['match', ['to-string', ['get', 'kind']], 'park', '#00aa00', 'road', '#888888', '#cccccc'], 'fill-opacity': 0.6 }
    };
    await page.evaluate((l) => window.layerControl._addLayerDirectly(l), layer);
    await page.evaluate((l) => window.browserControl._openLayerInfo(l), layer);
    const frame = await creatorFrame(page);
    await expect(frame.locator('#lo-legend-content [data-rule]')).toHaveCount(3, { timeout: 30000 });

    const titles = await frame.locator('#lo-legend-content .legend-rule-title').allTextContents();
    expect(titles).toEqual(['park', 'road', 'Other']);
    const subtitles = await frame.locator('#lo-legend-content .legend-rule-subtitle').allTextContents();
    expect(subtitles).toEqual(['kind = park', 'kind = road', 'all other features']);

    await expect(frame.locator('#style-section')).toBeHidden();
    await frame.locator('#lo-legend-content [data-rule]').nth(1).click();
    await expect(frame.locator('#style-section')).toBeVisible();
    await expect(frame.locator('.rv-row.rv-open')).toHaveCount(1, { timeout: 15000 });
    await expect(frame.locator('.rv-row.rv-open .rv-head')).toContainText('kind = road');
});

test('data filters show as clearable buttons, and clearing one is an edit', async ({ page }) => {
    await boot(page);
    const layer = {
        ...EDIT_LAYER,
        id: 'filter-test',
        // the shape a quick property filter from a clicked feature's popup leaves on the layer
        filter: ['all', ['==', ['get', 'kind'], 'park']],
        style: { 'fill-color': '#ff0000', 'hatch/filter': ['==', ['get', 'kind'], 'road'], 'hatch/fill-pattern': 'hatch|horizontal|#000000|8|1' }
    };
    await page.evaluate((l) => window.layerControl._addLayerDirectly(l), layer);
    await page.evaluate((l) => window.browserControl._openLayerInfo(l), layer);
    const frame = await creatorFrame(page);

    const chips = frame.locator('#lh-filters .filter-chip');
    await expect(chips).toHaveCount(2, { timeout: 30000 });
    await expect(chips.nth(0)).toContainText('Layer: kind = park');
    await expect(chips.nth(1)).toContainText('kind = road');

    // From view mode, clearing a filter starts an edit and removes it.
    await chips.nth(0).locator('.filter-chip-clear').click();
    await expect(frame.locator('#add-to-map-btn')).toBeVisible({ timeout: 30000 });
    await expect.poll(async () => 'filter' in (await configOf(frame)), { timeout: 30000 }).toBe(false);
    await expect(chips).toHaveCount(1);
    await page.waitForTimeout(700);

    await chips.nth(0).locator('.filter-chip-clear').click();
    await expect.poll(async () => 'hatch/filter' in ((await configOf(frame)).style || {}), { timeout: 20000 }).toBe(false);
    await expect(frame.locator('#lh-filters')).toBeHidden();

    // ...and undo brings the last one back.
    await page.waitForTimeout(700);
    await frame.locator('#undo-btn').click();
    await expect(chips).toHaveCount(1, { timeout: 15000 });
    await expect(chips.nth(0)).toContainText('kind = road');
});

test('Remove Other Maps leaves the layer being previewed in place', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window.browserControl._creatorDraftLayerId = 'edit-test'; });
    await page.evaluate(() => window.browserControl.hideAllLayers());
    const active = await page.evaluate(() => [...window.browserControl._getActiveLayers()]);
    expect(active).toContain('edit-test');
    expect(active).not.toContain('edit-other');
});

test('pointing at a legend item shows only its rule on the map until the pointer leaves', async ({ page }) => {
    await boot(page);
    const layer = {
        ...EDIT_LAYER,
        id: 'preview-test',
        inspect: { ...EDIT_LAYER.inspect, label: 'kind' },
        style: { 'fill-color': ['match', ['to-string', ['get', 'kind']], 'park', '#00aa00', 'road', '#888888', '#cccccc'], 'fill-opacity': 0.6 }
    };
    await page.evaluate((l) => window.layerControl._addLayerDirectly(l), layer);
    await page.evaluate((l) => window.browserControl._openLayerInfo(l), layer);
    const frame = await creatorFrame(page);
    const items = frame.locator('#lo-legend-content [data-rule]');
    await expect(items).toHaveCount(3, { timeout: 30000 });

    const filters = () => page.evaluate(() => window.map.getStyle().layers
        .filter(l => l.metadata?.groupId === 'preview-test')
        .map(l => JSON.stringify(window.map.getFilter(l.id) ?? null)));
    const before = await filters();
    expect(before.some(f => f.includes('road'))).toBe(false);

    await items.nth(1).hover();
    await expect.poll(async () => (await filters()).some(f => f.includes('road')), { timeout: 10000 }).toBe(true);

    await frame.locator('#layer-title').hover({ force: true });
    await expect.poll(filters, { timeout: 10000 }).toEqual(before);

    await items.nth(0).hover();
    await expect.poll(async () => (await filters()).some(f => f.includes('park')), { timeout: 10000 }).toBe(true);
    await page.mouse.move(900, 400);
    await expect.poll(filters, { timeout: 10000 }).toEqual(before);
});

test('the header\'s live actions work from the editor: layer order and opacity', async ({ page }) => {
    await boot(page);
    const frame = await openOverview(page);
    // edit-other sits above edit-test: moving edit-test up swaps them.
    await expect.poll(async () => { const t = await indexOf(page, 'edit-test'); return t > 0 && (await indexOf(page, 'edit-other')) < t; }, { timeout: 20000 }).toBe(true);
    await expect(frame.locator('#lh-move-up')).toBeEnabled({ timeout: 15000 });
    await frame.locator('#lh-move-up').click();
    await expect.poll(async () => (await indexOf(page, 'edit-test')) < (await indexOf(page, 'edit-other')), { timeout: 15000 }).toBe(true);

    await frame.locator('#lh-opacity').evaluate((el) => { el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect(frame.locator('#lh-opacity-value')).toHaveText('40%');
    await expect.poll(() => page.evaluate(() => window.layerControl._state.groups.find(g => g.id === 'edit-test')?.opacity ?? null), { timeout: 10000 }).toBe(0.4);
});

test('the Data card shows the source as a link and layer type, and expands to edit it', async ({ page }) => {
    await boot(page);
    const URL_LAYER = {
        id: 'edit-url', type: 'geojson', title: 'From a link', attribution: 'x',
        url: `${new URL(page.url()).origin}/data/czmp-2019/sand-dune.geojson`,
        inspect: { id: 'id', label: 'name', fields: ['name'] }, style: { 'fill-color': '#0000ff' }
    };
    await page.evaluate((l) => window.browserControl.openLayerEditor(l, { tab: 'edit' }), URL_LAYER);
    const frame = await creatorFrame(page);
    await expect.poll(async () => frame.locator('#layer-id').inputValue(), { timeout: 40000 }).toBe('edit-url');

    // Collapsed: one card with the link, the layer type beneath it, and an icon for the kind of data.
    const card = frame.locator('#data-card');
    await expect(card).toHaveClass(/is-collapsed/);
    await expect(frame.locator('#data-card-title')).toHaveText(URL_LAYER.url);
    await expect(frame.locator('#data-card-subtitle')).toHaveText('GeoJSON');
    await expect(frame.locator('#data-card-icon')).toHaveAttribute('name', 'filetype-json');
    expect(await frame.locator('#data-card-tooltip').getAttribute('content')).toContain('GeoJSON');
    await expect(frame.locator('#url-input')).toBeHidden();
    await expect(frame.locator('#load-data-btn')).toBeHidden();

    // Editing expands it: the link is an input. Upload shows only when the input is empty.
    await frame.locator('#data-card-toggle').click();
    await expect(card).not.toHaveClass(/is-collapsed/);
    await expect(frame.locator('#url-input')).toBeVisible();
    expect(await frame.locator('#url-input').inputValue()).toBe(URL_LAYER.url);
    await expect(frame.locator('#upload-file-btn')).toBeHidden();

    await frame.locator('#url-input').fill('');
    await expect(frame.locator('#upload-file-btn')).toBeVisible();
    await frame.locator('#url-input').fill('https://example.org/places.csv');
    await expect(frame.locator('#upload-file-btn')).toBeHidden();
    await expect(frame.locator('#data-card-icon')).toHaveAttribute('name', 'filetype-csv');

    // Done collapses it again.
    await frame.locator('#data-card-toggle').click();
    await expect(card).toHaveClass(/is-collapsed/);
});

test('"supported formats" opens help cards with an icon, description and example for each', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window.browserControl.openBrowser(); window.browserControl._switchToCreator(); });
    const frame = await creatorFrame(page);
    await frame.locator('body').evaluate(el => el.classList.remove('home-active'));

    // A new layer: the card starts expanded, with the hint and no colour-coded chips.
    await expect(frame.locator('#data-card')).not.toHaveClass(/is-collapsed/);
    await expect(frame.locator('#data-card-toggle')).toBeHidden();
    await expect(frame.locator('#upload-file-btn')).toBeVisible();
    await expect(frame.locator('#formats-help')).toBeHidden();
    await expect(frame.locator('#data-card-body')).toContainText('Autodetect data format from URL');

    await frame.locator('#formats-toggle').click();
    await expect(frame.locator('#formats-help')).toBeVisible();
    const cards = frame.locator('#formats-help .format-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(15);
    expect(await cards.evaluateAll(els => els.every(el => el.querySelector('sl-icon') && el.querySelector('.fc-name').textContent && el.querySelector('.fc-desc').textContent))).toBe(true);
    const icons = await cards.evaluateAll(els => els.map(el => el.querySelector('sl-icon').getAttribute('name')));
    expect(new Set(icons)).toEqual(new Set(['filetype-json', 'filetype-csv', 'filetype-xml', 'bounding-box-circles', 'image', 'globe', 'file-earmark-zip']));

    // Clicking a card tries its example, and the card's icon shows up in the header.
    await frame.locator('#formats-help .format-card[data-format="csv"]').click();
    expect(await frame.locator('#url-input').inputValue()).toContain('docs.google.com/spreadsheets');
    await expect(frame.locator('#data-card-icon')).toHaveAttribute('name', 'filetype-csv');
    await expect(frame.locator('#upload-file-btn')).toBeHidden();

    await frame.locator('#formats-toggle').click();
    await expect(frame.locator('#formats-help')).toBeHidden();
});

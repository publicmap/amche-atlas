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
    await page.evaluate((layer) => window.browserControl.openLayerEditor(layer), EDIT_LAYER);
    const frame = await creatorFrame(page);
    await expect(frame.locator('#creator-heading')).toHaveText('Edit Map Layer');
    // seeded once the source has loaded
    await expect.poll(async () => frame.locator('#layer-id').inputValue(), { timeout: 30000 }).toBe('edit-test');
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

    await expect(frame.locator('#add-to-map-btn')).toHaveText('Apply Changes');
    await expect(frame.locator('#source-step-title')).toHaveText('Data source');
    await expect(frame.locator('#remove-other-maps-btn')).toBeHidden();
    expect(await frame.locator('#layer-title').inputValue()).toBe('Edit Test');
    expect(await frame.locator('#layer-description').inputValue()).toBe('A layer to edit');
    expect(await frame.locator('#layer-attribution').inputValue()).toBe('src.example.org');

    // Inspect fields: the ones set on the layer are the ones shown, id and name included.
    await expect(frame.locator('#data-fields-section')).toBeVisible();
    expect(await frame.locator('#feature-id-field').inputValue()).toBe('id');
    expect(await frame.locator('#feature-name-field').inputValue()).toBe('name');
    const checked = await frame.locator('#inspect-fields-list input:checked').evaluateAll(els => els.map(e => e.value));
    expect(checked.sort()).toEqual(['kind', 'name']);

    // The style it already had, in the config and in the Advanced style editor.
    const config = await configOf(frame);
    expect(config.style['fill-color']).toBe('#ff0000');
    expect(config.inspect).toMatchObject({ id: 'id', label: 'name', fields: ['name', 'kind'], fieldTitles: ['Name', 'Kind'] });
    await frame.locator('.spe-tab[data-tab="all"]').click();
    expect(await frame.locator('#advanced-style-editor .spe-name').allTextContents()).toEqual(expect.arrayContaining(['fill-color', 'fill-opacity', 'line-width']));

    // The live preview stands in for the layer rather than doubling it.
    await expect.poll(() => groupsWith(page, 'edit-test'), { timeout: 20000 }).toBe(1);
});

test('Apply Changes replaces the layer in place, keeping its position in the stack', async ({ page }) => {
    await boot(page);
    expect(await indexOf(page, 'edit-other')).toBeLessThan(await indexOf(page, 'edit-test'));

    const frame = await openEditor(page);
    await frame.locator('#layer-title').fill('Renamed Layer');
    await frame.locator('#layer-description').fill('Edited description');
    await expect.poll(async () => (await configOf(frame)).title).toBe('Renamed Layer');
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('Renamed Layer');

    await frame.locator('#add-to-map-btn').click();
    await expect.poll(() => page.evaluate(() => window.browserControl._isOpen), { timeout: 15000 }).toBe(false);

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

test('Cancel puts the original layer back, unchanged and in place', async ({ page }) => {
    await boot(page);
    const frame = await openEditor(page);
    await frame.locator('#layer-title').fill('Should Not Stick');
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('Should Not Stick');

    await frame.locator('#cancel-btn').click();
    await expect.poll(() => titleOf(page, 'edit-test'), { timeout: 20000 }).toBe('Edit Test');
    expect(await groupsWith(page, 'edit-test')).toBe(1);
    expect(await groupsWith(page, 'edit-other')).toBe(1);
    expect(await indexOf(page, 'edit-other')).toBeLessThan(await indexOf(page, 'edit-test'));
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

test('the layer info panel\'s Edit button opens the editor', async ({ page }) => {
    await boot(page);
    await page.evaluate((layer) => window.browserControl._openLayerInfo(layer), EDIT_LAYER);
    let info;
    for (let i = 0; i < 60 && !info; i++) {
        info = page.frames().find(fr => fr.url().includes('map-information.html'));
        if (!info) await page.waitForTimeout(250);
    }
    await info.waitForSelector('#edit-toggle-btn', { timeout: 30000 });
    // Viewing, not editing: no inline form fields.
    expect(await info.locator('.editable-input').count()).toBe(0);

    await info.locator('#edit-toggle-btn').click();
    const frame = await creatorFrame(page);
    await expect(frame.locator('#creator-heading')).toHaveText('Edit Map Layer');
    await expect.poll(async () => frame.locator('#layer-id').inputValue(), { timeout: 30000 }).toBe('edit-test');
    await expect(page.locator('#layer-info-modal')).toBeHidden();
});


test('the Data card shows the source as a link and layer type, and expands to edit it', async ({ page }) => {
    await boot(page);
    const URL_LAYER = {
        id: 'edit-url', type: 'geojson', title: 'From a link', attribution: 'x',
        url: `${new URL(page.url()).origin}/data/czmp-2019/sand-dune.geojson`,
        inspect: { id: 'id', label: 'name', fields: ['name'] }, style: { 'fill-color': '#0000ff' }
    };
    await page.evaluate((l) => window.browserControl.openLayerEditor(l), URL_LAYER);
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

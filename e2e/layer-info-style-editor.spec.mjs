import { test, expect } from '@playwright/test';

// Verifies map-information.html's edit mode: the Style controls that replace
// the legend (js/style-property-editor.js), their live effect on the rendered
// map layer and the URL, the Reset that restores the layer's configured style,
// and Apply Changes leaving edit mode without reloading the page.
//
// The index atlas takes a while to settle, so the whole file shares one map
// page and re-adds a pristine test layer before each spec instead.
test.describe.configure({ mode: 'serial', timeout: 120000 });

const LAYER = {
    id: 'style-editor-test',
    type: 'geojson',
    title: 'Style Editor Test',
    geojson: {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: { name: 'Test Polygon' },
            geometry: {
                type: 'Polygon',
                coordinates: [[[73.8, 15.4], [73.9, 15.4], [73.9, 15.5], [73.8, 15.5], [73.8, 15.4]]]
            }
        }]
    },
    style: { 'fill-color': '#ff0000', 'fill-opacity': 0.5, 'line-width': 2 }
};

const FILL_LAYER_ID = `geojson-${LAYER.id}-fill`;

let page;
let frame;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/?atlas=index', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () => !!window.featureControl && !!window.layerControl?._mapboxAPI && !!window.map?.isStyleLoaded?.(),
        undefined,
        { timeout: 90000 }
    );
});

test.afterAll(async () => {
    await page?.close();
});

test.beforeEach(async () => {
    // A fresh copy of the layer per spec, so an edit made by one doesn't become
    // the next one's starting point. Same path the creator's live preview and
    // "Add Map Layer" use, so it carries _originalJson into the URL too.
    await page.evaluate(async (layer) => {
        window.layerControl.removeLayerCompletely(layer.id);
        await window.layerControl._addLayerDirectly(JSON.parse(JSON.stringify(layer)));
    }, LAYER);

    await page.waitForFunction(
        (layerId) => !!window.map.getLayer(`geojson-${layerId}-fill`),
        LAYER.id,
        { timeout: 30000 }
    );

    frame = await openStyleEditor();
});

async function openStyleEditor() {
    await page.evaluate((layerId) => {
        const modal = document.getElementById('layer-info-modal');
        const iframe = document.getElementById('layer-info-iframe');
        modal.style.display = 'none';
        iframe.src = '';

        const group = window.layerControl._state.groups.find(g => g.id === layerId);
        window.featureControl._openLayerInfo(group, { edit: true });
    }, LAYER.id);

    let panel;
    for (let i = 0; i < 40; i++) {
        panel = page.frames().find(f => f.url().includes('map-information.html'));
        if (panel) break;
        await page.waitForTimeout(250);
    }
    await panel.waitForLoadState('load');
    await panel.waitForSelector('.spe-row', { timeout: 30000 });
    return panel;
}

function row(property) {
    return frame.locator(`.spe-row:has(.spe-name:text-is("${property}"))`);
}

const paintProperty = (property, layerId = FILL_LAYER_ID) =>
    page.evaluate(([id, prop]) => window.map.getPaintProperty(id, prop), [layerId, property]);

test('renders a control per style property, typed by the style spec', async () => {
    await expect(frame.locator('.spe-name')).toHaveText(['fill-color', 'fill-opacity', 'line-width']);
    await expect(row('fill-color').locator('input[type="color"]')).toHaveValue('#ff0000');
    await expect(row('fill-opacity').locator('input[type="number"]')).toHaveValue('0.5');
    await expect(row('line-width').locator('input[type="number"]')).toHaveValue('2');
});

test('a colour edit repaints the map layer and lands in the URL', async () => {
    await row('fill-color').locator('input[type="color"]').fill('#0000ff');

    await expect.poll(() => paintProperty('fill-color'), { timeout: 10000 }).toBe('#0000ff');
    await expect.poll(() => decodeURIComponent(page.url()), { timeout: 10000 }).toContain("'fill-color':'#0000ff'");
});

test('a number edit is validated before it reaches the map', async () => {
    const opacity = row('fill-opacity').locator('input[type="number"]');

    await opacity.fill('0.9');
    await expect.poll(() => paintProperty('fill-opacity'), { timeout: 10000 }).toBe(0.9);

    // Out of the property's 0-1 range: flagged in the panel, never applied
    await opacity.fill('7');
    await expect(row('fill-opacity').locator('.spe-error')).toBeVisible();
    expect(await paintProperty('fill-opacity')).toBe(0.9);
});

test('removing a property returns it to its spec default', async () => {
    await row('fill-opacity').locator('.spe-remove').click();

    // Cleared on the map layer: getPaintProperty reports nothing set, so the
    // spec default (1) is what renders again.
    await expect.poll(() => paintProperty('fill-opacity'), { timeout: 10000 }).toBeUndefined();
    await expect(frame.locator('.spe-name')).toHaveText(['fill-color', 'line-width']);
});

test('a property added from the picker reaches the map', async () => {
    await frame.locator('.spe-add select').selectOption('line-color');
    await expect(row('line-color').locator('input[type="color"]')).toHaveValue('#3b82f6');

    await expect.poll(() => paintProperty('line-color', `geojson-${LAYER.id}-line`), { timeout: 10000 })
        .toBe('#3b82f6');
});

test('Reset restores the layer\'s configured style', async () => {
    await row('fill-color').locator('input[type="color"]').fill('#0000ff');
    await row('fill-opacity').locator('.spe-remove').click();
    await expect.poll(() => paintProperty('fill-color'), { timeout: 10000 }).toBe('#0000ff');

    await frame.locator('#reset-style-btn').click();

    await expect(row('fill-color').locator('input[type="color"]')).toHaveValue('#ff0000');
    await expect.poll(() => paintProperty('fill-color'), { timeout: 10000 }).toBe('#ff0000');
    await expect.poll(() => paintProperty('fill-opacity'), { timeout: 10000 }).toBe(0.5);
    await expect.poll(() => decodeURIComponent(page.url()), { timeout: 10000 }).not.toContain('#0000ff');
});

test('Apply Changes leaves edit mode in place, without reloading the page', async () => {
    // Survives only as long as the page is never reloaded
    await page.evaluate(() => { window.__notReloaded = true; });

    await frame.fill('#layer-title-edit', 'Renamed Layer');
    await row('fill-color').locator('input[type="color"]').fill('#00ff00');
    await frame.locator('#edit-toggle-btn').click();

    await expect(frame.locator('#edit-toggle-btn')).toHaveText('Edit');
    expect(await page.evaluate(() => window.__notReloaded)).toBe(true);

    // The live layer keeps the new title, and the URL carries it so a reload would too
    expect(await page.evaluate(
        (layerId) => window.layerControl._state.groups.find(g => g.id === layerId)?.title,
        LAYER.id
    )).toBe('Renamed Layer');
    await expect.poll(() => decodeURIComponent(page.url()), { timeout: 10000 }).toContain("'title':'Renamed Layer'");

    // Back in view mode: the legend is rendered again, from the edited style
    await expect(frame.locator('#legend-content svg')).toBeVisible();
    await expect(frame.locator('.spe-row')).toHaveCount(0);
});

test('an edit that needs the layer rebuilt still reloads with the new config', async () => {
    await page.evaluate(() => { window.__notReloaded = true; });

    await frame.fill('#layer-id-edit', 'style-editor-renamed');
    await frame.locator('#edit-toggle-btn').click();

    await page.waitForFunction(
        () => !window.__notReloaded && !!window.map?.getLayer('geojson-style-editor-renamed-fill'),
        undefined,
        { timeout: 90000 }
    );
});

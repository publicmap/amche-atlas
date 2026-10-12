import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Drives the creator's Advanced style panel against a real embedded map: field
// values are sampled from the loaded layer, and the expression it writes must
// reach the map's own paint properties with hover / selected intact.

async function openCreator(page) {
    await page.goto('/?atlas=index', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.layerControl && !!window.browserControl);
    await page.evaluate(() => {
        window.browserControl.openBrowser();
        window.browserControl._switchToCreator();
    });
    let frame;
    for (let i = 0; i < 20; i++) {
        frame = page.frames().find(f => f.url().includes('map-creator.html'));
        if (frame) break;
        await page.waitForTimeout(300);
    }
    await frame.waitForLoadState('load');
    return frame;
}

function writePolygons() {
    const square = (x, y) => [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001], [x, y]]];
    const uses = ['Park', 'Park', 'Road', 'Housing', 'Housing', 'Housing'];
    const filePath = path.join(os.tmpdir(), `creator-symbology-${Date.now()}.geojson`);
    fs.writeFileSync(filePath, JSON.stringify({
        type: 'FeatureCollection',
        features: uses.map((use, i) => ({
            type: 'Feature',
            properties: { id: i + 1, use, area: (i + 1) * 10 },
            geometry: { type: 'Polygon', coordinates: square(73.8 + i * 0.002, 15.47) }
        }))
    }));
    return filePath;
}

const row = (frame, property) => frame.locator('.spe-row', { has: frame.locator(`.spe-name:text-is("${property}")`) });

async function configStyle(frame) {
    return JSON.parse(await frame.locator('#config-preview').inputValue()).style;
}

test('categorized fill with hover and selected states reaches the map', async ({ page }) => {
    const frame = await openCreator(page);
    await frame.locator('#file-input').setInputFiles(writePolygons());
    await page.waitForFunction(() => !!window.browserControl._creatorDraftLayerId, { timeout: 10000 });
    const draftId = await page.evaluate(() => window.browserControl._creatorDraftLayerId);

    const fill = row(frame, 'fill-color');
    await expect(fill).toBeVisible();
    await fill.locator('.spe-btn', { hasText: 'by data' }).click();
    await fill.locator('.sym-tab', { hasText: 'Categorized' }).click();
    await fill.locator('.sym-input').first().selectOption('use');

    // Three distinct values in the data, most common first.
    await expect(fill.locator('.sym-list .sym-row')).toHaveCount(3);
    await expect(fill.locator('.sym-list .sym-row .sym-grow').first()).toHaveValue('Housing');

    const [hover, selected] = await fill.locator('.sym-states input[type="checkbox"]').all();
    await hover.check();
    await selected.check();

    const style = await configStyle(frame);
    const expression = style['fill-color'];
    expect(expression[0]).toBe('case');
    expect(JSON.stringify(expression)).toContain('"match"');
    expect(JSON.stringify(expression)).toContain('"hover"');
    expect(JSON.stringify(expression)).toContain('"selected"');

    await expect.poll(() => page.evaluate((id) => {
        const layer = window.layerControl._mapboxAPI.getLayerGroupIds(id, { type: 'geojson', id })
            .find(l => window.map.getLayer(l)?.type === 'fill');
        return layer ? JSON.stringify(window.map.getPaintProperty(layer, 'fill-color')) : '';
    }, draftId), { timeout: 8000 }).toContain('"match"');

    // The custom selected state replaced the default highlight rather than nesting under it.
    const paint = await page.evaluate((id) => {
        const layer = window.layerControl._mapboxAPI.getLayerGroupIds(id, { type: 'geojson', id })
            .find(l => window.map.getLayer(l)?.type === 'fill');
        return JSON.stringify(window.map.getPaintProperty(layer, 'fill-color'));
    }, draftId);
    expect(paint).not.toContain('rgba(255, 255, 0, 0.5)');
});

test('graduated fill classifies a numeric field and keeps a fallback', async ({ page }) => {
    const frame = await openCreator(page);
    await frame.locator('#file-input').setInputFiles(writePolygons());
    await page.waitForFunction(() => !!window.browserControl._creatorDraftLayerId, { timeout: 10000 });

    const fill = row(frame, 'fill-color');
    await fill.locator('.spe-btn', { hasText: 'by data' }).click();
    await fill.locator('.sym-tab', { hasText: 'Graduated' }).click();
    await fill.locator('.sym-input').first().selectOption('area');

    await expect.poll(async () => JSON.stringify((await configStyle(frame))['fill-color'])).toContain('"step"');
    const expression = (await configStyle(frame))['fill-color'];
    expect(expression[1]).toEqual(['==', ['typeof', ['get', 'area']], 'number']);
    expect(typeof expression[expression.length - 1]).toBe('string');

    const fallback = fill.locator('.sym-fallback .sym-swatch');
    await fallback.evaluate((el) => { el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const updated = (await configStyle(frame))['fill-color'];
    expect(updated[updated.length - 1]).toBe('#123456');
});

test('line-color linked to fill-color inherits the categorized mapping on the map', async ({ page }) => {
    const frame = await openCreator(page);
    await frame.locator('#file-input').setInputFiles(writePolygons());
    await page.waitForFunction(() => !!window.browserControl._creatorDraftLayerId, { timeout: 10000 });
    const draftId = await page.evaluate(() => window.browserControl._creatorDraftLayerId);

    const fill = row(frame, 'fill-color');
    await fill.locator('.spe-btn', { hasText: 'by data' }).click();
    await fill.locator('.sym-tab', { hasText: 'Categorized' }).click();
    await fill.locator('.sym-input').first().selectOption('use');

    await row(frame, 'line-color').locator('.spe-btn', { hasText: 'link' }).click();
    await expect.poll(async () => (await configStyle(frame))['line-color']).toBe('@fill-color');

    // The config keeps the reference; the map's line layer gets the resolved mapping.
    await expect.poll(() => page.evaluate((id) => {
        const lineLayer = window.layerControl._mapboxAPI.getLayerGroupIds(id, { type: 'geojson', id })
            .find(l => window.map.getLayer(l)?.type === 'line');
        return lineLayer ? JSON.stringify(window.map.getPaintProperty(lineLayer, 'line-color')) : '';
    }, draftId), { timeout: 8000 }).toContain('"match"');
});

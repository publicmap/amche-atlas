import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The creator's Advanced style panel as tabs: Rules (rows consolidated across
// properties, plus the layer's data filters), one tab per property category,
// and "*". Also the Circle and Icon simple controls.

async function openCreator(page) {
    await page.goto('/?atlas=index', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => !!window.layerControl && !!window.browserControl, null, { timeout: 90000 });
    await page.evaluate(() => {
        window.browserControl.openBrowser();
        window.browserControl._switchToCreator();
    });
    let frame;
    for (let i = 0; i < 30; i++) {
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
    const filePath = path.join(os.tmpdir(), `creator-tabs-${Date.now()}.geojson`);
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
const configOf = async (frame) => JSON.parse(await frame.locator('#config-preview').inputValue());

async function categorize(frame) {
    await frame.locator('#advanced-style-editor .spe-tab[data-tab="area"]').click();
    const fill = row(frame, 'fill-color');
    await fill.locator('.spe-btn', { hasText: 'by data' }).click();
    await fill.locator('.sym-tab', { hasText: 'Categorized' }).click();
    await fill.locator('.sym-input').first().selectOption('use');
    await expect(fill.locator('.sym-list .sym-row')).toHaveCount(3);
}

test('tabs filter the properties, Rules consolidates the branches, and a property opens on its own tab', async ({ page }) => {
    const frame = await openCreator(page);
    await frame.locator('#file-input').setInputFiles(writePolygons());
    await page.waitForFunction(() => !!window.browserControl._creatorDraftLayerId, { timeout: 30000 });

    const tabs = frame.locator('#advanced-style-editor .spe-tab');
    expect(await tabs.evaluateAll(els => els.map(e => e.dataset.tab))).toEqual(['rules', 'point', 'line', 'area', 'label', 'circle', 'icon', 'all']);

    // Area tab is a filter: fill properties only.
    await frame.locator('.spe-tab[data-tab="area"]').click();
    const areaNames = await frame.locator('#advanced-style-editor .spe-name').allTextContents();
    expect(areaNames.length).toBeGreaterThan(0);
    expect(areaNames.every(n => n.startsWith('fill-'))).toBe(true);

    await categorize(frame);

    // Rules now has a row per category plus the fallback.
    await frame.locator('.spe-tab[data-tab="rules"]').click();
    const labels = await frame.locator('.rv-row .rv-label').allTextContents();
    expect(labels.sort()).toEqual(['Everything else (fallback)', 'use = Housing', 'use = Park', 'use = Road'].sort());

    // Open a rule, follow a property to its own tab.
    await frame.locator('.rv-row', { hasText: 'use = Park' }).locator('.rv-head').click();
    await expect(frame.locator('.rv-row.rv-open .rv-condline')).toContainText('use = Park');
    await frame.locator('.rv-row.rv-open .rv-prop .rv-link', { hasText: 'fill-color' }).click();
    await expect(frame.locator('.spe-tab[data-tab="area"]')).toHaveClass(/spe-tab-active/);
    await expect(frame.locator('.spe-row[data-key="fill-color"]')).toBeVisible();

    // The "*" tab lists everything, grouped.
    await frame.locator('.spe-tab[data-tab="all"]').click();
    const sections = await frame.locator('#advanced-style-editor .spe-section').allTextContents();
    expect(sections).toEqual(expect.arrayContaining(['Area']));
});

test('editing a rule\'s value from the Rules tab changes just that branch on the map', async ({ page }) => {
    const frame = await openCreator(page);
    await frame.locator('#file-input').setInputFiles(writePolygons());
    await page.waitForFunction(() => !!window.browserControl._creatorDraftLayerId, { timeout: 30000 });
    await categorize(frame);

    await frame.locator('.spe-tab[data-tab="rules"]').click();
    await frame.locator('.rv-row', { hasText: 'use = Road' }).locator('.rv-head').click();
    const swatch = frame.locator('.rv-row.rv-open .rv-prop', { hasText: 'fill-color' }).locator('input[type="color"]');
    await swatch.evaluate((el) => { el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); });

    const fill = (await configOf(frame)).style['fill-color'];
    expect(fill[fill.indexOf('Road') + 1]).toBe('#123456');
    expect(fill[fill.indexOf('Park') + 1]).not.toBe('#123456');
});

test('the Data filters section adds, edits and removes a layer filter that the map applies', async ({ page }) => {
    const frame = await openCreator(page);
    await frame.locator('#file-input').setInputFiles(writePolygons());
    await page.waitForFunction(() => !!window.browserControl._creatorDraftLayerId, { timeout: 30000 });
    await categorize(frame);
    await frame.locator('.spe-tab[data-tab="rules"]').click();

    await expect(frame.locator('.rv-filters')).toContainText('No data filters');
    await frame.locator('.rv-add').click();
    const area = frame.locator('.rv-filter.rv-open .rv-json');
    await area.fill('["==", ["get", "use"], "Park"]');
    await expect(frame.locator('.rv-filter .rv-filter-text')).toHaveText('use = Park');

    expect((await configOf(frame)).filter).toEqual(['==', ['get', 'use'], 'Park']);
    await expect.poll(() => page.evaluate(() => {
        const id = window.browserControl._creatorDraftLayerId;
        const fill = window.map.getStyle().layers.find(l => l.id === `geojson-${id}-fill`);
        return fill ? JSON.stringify(window.map.getFilter(fill.id)) : null;
    }), { timeout: 15000 }).toContain('Park');

    await frame.locator('.rv-filter .rv-remove').click();
    expect((await configOf(frame)).filter).toBeUndefined();
});

test('Circle and Icon controls write their properties into the style', async ({ page }) => {
    const frame = await openCreator(page);
    await frame.locator('#file-input').setInputFiles(writePolygons());
    await page.waitForFunction(() => !!window.browserControl._creatorDraftLayerId, { timeout: 30000 });

    await frame.locator('#style-type-circle').check();
    await expect(frame.locator('#style-section-circle')).toBeVisible();
    await frame.locator('#circle-blur').evaluate((el) => { el.value = '0.4'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    let style = (await configOf(frame)).style;
    expect(style['circle-blur']).toBe(0.4);
    expect(style['circle-radius']).toBeDefined();

    await frame.locator('#style-type-icon').check();
    await expect(frame.locator('#style-section-icon')).toBeVisible();
    await frame.locator('#icon-image').fill('marker-15');
    await frame.locator('#icon-size').evaluate((el) => { el.value = '1.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    style = (await configOf(frame)).style;
    expect(style['icon-image']).toBe('marker-15');
    expect(style['icon-size']).toBe(1.5);

    // They show up on the matching tabs.
    await frame.locator('.spe-tab[data-tab="circle"]').click();
    expect(await frame.locator('#advanced-style-editor .spe-name').allTextContents()).toContain('circle-blur');
    await frame.locator('.spe-tab[data-tab="icon"]').click();
    expect(await frame.locator('#advanced-style-editor .spe-name').allTextContents()).toEqual(expect.arrayContaining(['icon-image', 'icon-size']));
});

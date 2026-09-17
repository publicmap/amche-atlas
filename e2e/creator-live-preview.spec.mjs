import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Verifies that live-previewing a layer in map-creator.html is now
// equivalent to actually adding it: it shows up in window.layerControl's
// real state (so it's inspectable via MapMarkerManager and reflected in the
// shareable URL) while still being edited. "Add Map Layer" then just
// finalizes/closes without re-adding it, and "Cancel" removes it again.
//
// Uses a local file upload (not a pasted URL) so the test doesn't depend on
// external network access — the creator's file-upload path exercises the
// same generateLayerConfig()/sendPreview() flow as a pasted GeoJSON URL.

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

function writeSampleGeoJSON() {
    const filePath = path.join(os.tmpdir(), `creator-live-preview-${Date.now()}.geojson`);
    fs.writeFileSync(filePath, JSON.stringify({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: { name: 'Test Point' },
            geometry: { type: 'Point', coordinates: [73.8, 15.47] }
        }]
    }));
    return filePath;
}

test('live preview adds a real, inspectable layer and updates the URL', async ({ page }) => {
    const frame = await openCreator(page);
    await frame.locator('#file-input').setInputFiles(writeSampleGeoJSON());

    await page.waitForFunction(() => !!window.browserControl._creatorDraftLayerId, { timeout: 10000 });
    const draftId = await page.evaluate(() => window.browserControl._creatorDraftLayerId);

    const inGroups = await page.evaluate(
        (id) => (window.layerControl?._state?.groups || []).some(g => g.id === id),
        draftId
    );
    expect(inGroups).toBe(true);

    // URL update is debounced ~50ms after the layer is added (see
    // MapLayerControl._addLayerDirectly).
    await expect.poll(() => page.url()).toContain('layers=');
});

test('"Add Map Layer" finalizes the live-previewed layer without duplicating it', async ({ page }) => {
    const frame = await openCreator(page);
    await frame.locator('#file-input').setInputFiles(writeSampleGeoJSON());
    await page.waitForFunction(() => !!window.browserControl._creatorDraftLayerId, { timeout: 10000 });
    const draftId = await page.evaluate(() => window.browserControl._creatorDraftLayerId);

    await frame.locator('#add-to-map-btn').click();
    await page.waitForTimeout(500);

    const matchCount = await page.evaluate(
        (id) => (window.layerControl?._state?.groups || []).filter(g => g.id === id).length,
        draftId
    );
    expect(matchCount).toBe(1);

    const draftIdAfter = await page.evaluate(() => window.browserControl._creatorDraftLayerId);
    expect(draftIdAfter).toBeNull();
});

test('"Cancel" removes the live-previewed layer', async ({ page }) => {
    const frame = await openCreator(page);
    await frame.locator('#file-input').setInputFiles(writeSampleGeoJSON());
    await page.waitForFunction(() => !!window.browserControl._creatorDraftLayerId, { timeout: 10000 });
    const draftId = await page.evaluate(() => window.browserControl._creatorDraftLayerId);

    await frame.locator('#cancel-btn').click();
    await page.waitForTimeout(500);

    const stillPresent = await page.evaluate(
        (id) => (window.layerControl?._state?.groups || []).some(g => g.id === id),
        draftId
    );
    expect(stillPresent).toBe(false);

    const draftIdAfter = await page.evaluate(() => window.browserControl._creatorDraftLayerId);
    expect(draftIdAfter).toBeNull();
});

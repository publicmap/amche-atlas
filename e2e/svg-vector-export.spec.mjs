import { test, expect } from '@playwright/test';
import fs from 'fs';

// Verifies that the "print > SVG" export produces real vector <path>/<text>
// elements for the atlas's own overlay layers (see js/svg-vector-export.js)
// instead of only a rasterized <image>, which is what map-export.html's SVG
// option previously did. Drives the real export UI (keyboard shortcuts:
// 'p' switches to Print, 's' picks SVG, Space triggers Download) since the
// export frame only becomes visible/sized once that flow actually runs.

const inlineAtlas = {
    name: 'SVG Vector Export E2E Test',
    map: { center: [73.8, 15.47], zoom: 14 },
    layers: [
        {
            id: 'svg-vector-test-layer',
            type: 'geojson',
            title: 'SVG Vector Test Layer',
            initiallyChecked: true,
            // Kept small and clustered tightly around the map center so every
            // vertex stays projectable regardless of exactly how zoomed-in
            // the export camera ends up (this atlas has no other layers, so
            // the app's "fit view to newly added layer" behavior can pick an
            // aggressive zoom for a larger extent).
            data: {
                type: 'FeatureCollection',
                features: [
                    {
                        type: 'Feature',
                        properties: { name: 'Test Parcel' },
                        geometry: {
                            type: 'Polygon',
                            coordinates: [[
                                [73.7999, 15.4699],
                                [73.8001, 15.4699],
                                [73.8001, 15.4701],
                                [73.7999, 15.4701],
                                [73.7999, 15.4699]
                            ]]
                        }
                    },
                    {
                        type: 'Feature',
                        properties: { name: 'Test Line' },
                        geometry: {
                            type: 'LineString',
                            coordinates: [[73.7999, 15.4698], [73.8001, 15.4698]]
                        }
                    },
                    {
                        type: 'Feature',
                        properties: { name: 'Test Point' },
                        geometry: { type: 'Point', coordinates: [73.8, 15.47] }
                    }
                ]
            },
            style: {
                'fill-color': '#3388ff',
                'fill-opacity': 0.6,
                'line-color': '#ff0000',
                'line-width': 3,
                'circle-radius': 8,
                'circle-color': '#00cc44',
                'text-field': ['get', 'name'],
                'text-size': 14,
                'text-color': '#111111'
            }
        }
    ]
};

test('SVG export vectorizes atlas overlay layers as real paths/text', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Avoid the app's own camera-position persistence (localStorage, keyed
    // by atlas name) leaking a stale zoom in from a previous run.
    await page.addInitScript(() => {
        try { localStorage.clear(); } catch (e) { /* ignore */ }
    });

    const url = `/?atlas=${encodeURIComponent(JSON.stringify(inlineAtlas))}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => window.exportControl && window.exportControl._frame, null, { timeout: 30000 });
    await page.waitForFunction(() => {
        const map = window.exportControl._map;
        if (!map || !map.isStyleLoaded()) return false;
        const layers = map.getStyle().layers || [];
        return layers.some(l => l.id.includes('svg-vector-test-layer') && l.type === 'fill');
    }, null, { timeout: 30000 });

    // The export trigger lives in the layer-stack strip (js/layer-stack-strip.js),
    // not as a mounted map control - it's hover-revealed (see css/styles.css),
    // so the strip needs a hover before its export button becomes visible/clickable.
    await page.hover('.layer-stack-strip');
    await page.click('.layer-stack-export-btn');

    const iframeEl = await page.waitForSelector('iframe.map-export-iframe');
    const exportFrame = await iframeEl.contentFrame();
    await exportFrame.waitForSelector('#export-btn');

    await exportFrame.locator('body').click();
    await exportFrame.locator('body').press('p'); // switch to "Print" category
    await page.waitForTimeout(200);
    await exportFrame.locator('body').press('s'); // pick the SVG format
    await page.waitForTimeout(300); // let the frame-show postMessage round-trip

    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        exportFrame.locator('body').press(' ') // trigger Download
    ]);

    const downloadPath = await download.path();
    const svgContent = fs.readFileSync(downloadPath, 'utf8');

    // Fill and circle are deterministic (unaffected by symbol collision
    // culling), so assert their exact styling made it through as real
    // vector shapes. Line/text builder logic is already covered precisely
    // by js/tests/svg-vector-export.test.js against a controlled fake map;
    // here we just also require the overlay isn't empty.
    expect(svgContent).toContain('<g id="amche-vector-overlay">');
    expect(svgContent).toContain('<path');
    expect(svgContent).toContain('fill="#3388ff"');
    expect(svgContent).toContain('<circle');
    expect(svgContent).toContain('fill="#00cc44"');

    // Scoped to just the vector overlay group, not the whole document: the
    // basemap's embedded base64 raster <image> can coincidentally contain
    // the substrings "NaN"/"Infinity" as base64 characters, which would
    // otherwise make this assertion flaky.
    const overlayMatch = svgContent.match(/<g id="amche-vector-overlay">[\s\S]*<\/svg>/);
    expect(overlayMatch).not.toBeNull();
    expect(overlayMatch[0]).not.toContain('Infinity');
    expect(overlayMatch[0]).not.toContain('NaN');

    const relevantErrors = consoleErrors.filter(e => !e.includes('api.mapbox.com') && !e.includes('mapbox-gl'));
    expect(relevantErrors, `Unexpected console errors: ${relevantErrors.join('\n')}`).toEqual([]);
});

import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', msg => {
  const t = msg.text();
  if (t.includes('MapInit') || t.includes('MapBrowser') || t.includes('LayerRegistry')) {
    console.log('[console]', t);
  }
});

await page.goto('http://localhost:4035/docs/guides/embed-osm-india/index.html', { waitUntil: 'load' });
await page.waitForTimeout(6000);
console.log('Initial host URL:', page.url());

const iframeHandle = await page.$('#atlas');
const atlasFrame = await iframeHandle.contentFrame();
await page.waitForTimeout(2000);

const state = await atlasFrame.evaluate(() => {
  const lr = window.layerRegistry;
  if (!lr) return { error: 'no layerRegistry' };
  const atlasLayers = {};
  lr._atlasLayers.forEach((v, k) => { atlasLayers[k] = v.map(l => ({ id: l.id, initiallyChecked: l.initiallyChecked })); });
  const atlasMetaKeys = Array.from(lr._atlasMetadata.keys());
  const hasIndiaState = lr._registry.has('india-state');
  const hasImportedIndiaState = lr._registry.has('imported-india-state');
  return { atlasLayers, atlasMetaKeys, hasIndiaState, hasImportedIndiaState, currentAtlas: lr.getCurrentAtlas() };
});
console.log('Registry state:', JSON.stringify(state, null, 2));

await browser.close();

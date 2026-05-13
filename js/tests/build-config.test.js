import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// Source/tooling/generated dirs that aren't user-facing pages. Kept in sync
// with the same list inside vite.config.mjs.
const NON_PAGE_DIRS = new Set([
  'node_modules', 'dist', 'coverage',
  'playwright-report', 'test-results',
  'js', 'css', 'config', 'docs', 'assets', 'data', 'e2e', 'qgis', 'server',
  'memory',
]);

function collectExpectedHtmlEntries() {
  const entries = {};
  for (const f of fs.readdirSync(rootDir)) {
    if (f.endsWith('.html') && !f.startsWith('.')) {
      entries[f.replace(/\.html$/, '')] = f;
    }
  }
  for (const d of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || NON_PAGE_DIRS.has(d.name)) continue;
    const candidate = path.join(d.name, 'index.html');
    if (fs.existsSync(path.join(rootDir, candidate))) entries[d.name] = candidate;
  }
  return entries;
}

describe('Build Configuration', () => {
  it('vite.config.mjs auto-discovers every HTML entry', async () => {
    // The config defines collectHtmlEntries() — we import the module to invoke
    // it under the same conditions the real build uses.
    const viteConfigUrl = new URL('../../vite.config.mjs', import.meta.url).href;
    const viteConfigModule = await import(viteConfigUrl);
    const viteConfig = typeof viteConfigModule.default === 'function'
      ? viteConfigModule.default({ command: 'build', mode: 'production' })
      : viteConfigModule.default;

    const actualEntries = viteConfig.build?.rollupOptions?.input || {};
    const expectedEntries = collectExpectedHtmlEntries();

    const missing = Object.keys(expectedEntries).filter(k => !(k in actualEntries));

    expect(missing,
      `HTML entries discovered on disk but missing from vite.config.mjs input: ${missing.join(', ')}\n` +
      'This usually means vite.config.mjs was edited and collectHtmlEntries() no longer scans the right paths.'
    ).toEqual([]);
  });

  it('every page directory ships its non-bundled assets via static-copy', async () => {
    // Subdirectory pages may include classic (non-module) <script> tags; Vite
    // can't bundle those, so we copy them as-is. This test asserts that any
    // page directory containing a non-module <script src="..."> reference has
    // a matching entry in the static-copy targets.
    const viteConfigSrc = fs.readFileSync(path.join(rootDir, 'vite.config.mjs'), 'utf8');

    const pageDirsNeedingCopy = [];
    for (const d of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.') || NON_PAGE_DIRS.has(d.name)) continue;
      const indexPath = path.join(rootDir, d.name, 'index.html');
      if (!fs.existsSync(indexPath)) continue;
      const html = fs.readFileSync(indexPath, 'utf8');
      const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(m => m[1]);
      const hasNonModule = scripts.some(attrs =>
        /\bsrc\s*=\s*["'][^"']*\.js["']/.test(attrs) &&
        !/\btype\s*=\s*["']module["']/.test(attrs) &&
        !/\bsrc\s*=\s*["']https?:/.test(attrs)
      );
      if (hasNonModule) pageDirsNeedingCopy.push(d.name);
    }

    const missingCopies = pageDirsNeedingCopy.filter(d =>
      !new RegExp(`src:\\s*['"]${d}/\\*\\.js['"]`).test(viteConfigSrc) &&
      !new RegExp(`src:\\s*['"]${d}/[^'"]*['"]`).test(viteConfigSrc)
    );

    expect(missingCopies,
      `Page directories with non-module <script> tags missing a static-copy entry: ${missingCopies.join(', ')}\n` +
      `Add to viteStaticCopy targets, e.g.: { src: '${missingCopies[0] || 'DIR'}/*.js', dest: '${missingCopies[0] || 'DIR'}' }`
    ).toEqual([]);
  });
});

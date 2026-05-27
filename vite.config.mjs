import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import fs from 'fs';
import path from 'path';

// Source/tooling/generated dirs to ignore when auto-detecting page directories.
const NON_PAGE_DIRS = new Set([
  'node_modules', 'dist', 'coverage',
  'playwright-report', 'test-results',
  'js', 'css', 'config', 'docs', 'assets', 'data', 'e2e', 'qgis', 'server',
  'memory',
]);

// Vite MPA entries: every root-level *.html plus every top-level subdirectory
// containing an index.html. Adding a new page is just creating the file —
// no config edits needed.
function collectHtmlEntries() {
  const root = path.resolve('.');
  const entries = {};
  for (const f of fs.readdirSync(root)) {
    if (f.endsWith('.html') && !f.startsWith('.')) {
      entries[f.replace(/\.html$/, '')] = f;
    }
  }
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || NON_PAGE_DIRS.has(d.name)) continue;
    const candidate = path.join(d.name, 'index.html');
    if (fs.existsSync(candidate)) entries[d.name] = candidate;
  }
  return entries;
}

export default defineConfig({
  root: '.',
  // Relative asset paths so the same build artifact works both at the domain
  // root (amche.in/, main branch) and at a subpath (amche.in/dev/, dev
  // branch). With base: '/' Vite emits absolute URLs like /assets/vite/foo.js
  // which 404 when the site is served under /dev/.
  base: './',
  // We manage all static copies via the static-copy plugin below so URL paths
  // match production exactly (Vite's publicDir flattens its contents to the
  // dist root, which would break absolute /assets/... URL references).
  publicDir: false,

  server: { port: 4035, host: true, open: true, cors: true },
  preview: { port: 4035, host: true, open: true },

  build: {
    outDir: 'dist',
    assetsDir: 'assets/vite',
    sourcemap: true,
    rollupOptions: {
      input: collectHtmlEntries(),
    },
  },

  plugins: [
    // Dev-only resolver for overpass-turbo.eu/s/<id> share URLs.
    // The browser can't read cross-origin redirect Location headers
    // (opaqueredirect), so the map-creator UI calls /api/overpass-share?id=<id>
    // and we resolve it here with fetch+redirect:manual.
    {
      name: 'overpass-share-resolver',
      configureServer(server) {
        server.middlewares.use('/api/overpass-share', async (req, res) => {
          try {
            const u = new URL(req.url, 'http://localhost');
            const id = u.searchParams.get('id') || '';
            if (!/^[A-Za-z0-9_-]+$/.test(id)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Invalid id' }));
              return;
            }

            const upstream = await fetch(`https://overpass-turbo.eu/s/${id}`, { redirect: 'manual' });
            const location = upstream.headers.get('location');
            if (!location) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'No redirect Location from overpass-turbo' }));
              return;
            }

            const params = new URL(location).searchParams;
            const query = params.get('Q');
            if (!query) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              const hasLegacy = params.has('q');
              res.end(JSON.stringify({
                error: hasLegacy
                  ? 'This is a legacy Overpass Turbo share URL (?q=). Open it in overpass-turbo.eu, copy the query, and paste it directly.'
                  : 'Could not extract query from redirect'
              }));
              return;
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify({ query }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: String(err && err.message || err) }));
          }
        });
      }
    },
    viteStaticCopy({
      targets: [
        // Static dirs referenced by absolute URL paths from HTML/JS.
        { src: 'assets/*', dest: 'assets' },
        { src: 'css/*', dest: 'css' },
        // Runtime-fetched data (not traced through HTML entries).
        { src: 'config', dest: '.' },
        { src: 'docs', dest: '.' },
        // /pages/ has loose HTML files (no index.html) — copied as-is.
        { src: 'pages', dest: '.' },
        // Non-module <script src="..."> tags in subdir pages can't be bundled
        // by Vite; copy the source JS so the HTML still resolves them.
        { src: 'sound/*.js', dest: 'sound' },
        { src: 'warper/*.js', dest: 'warper' },
        { src: 'game/*.js', dest: 'game' },
        // Root-level static files.
        { src: 'service-worker.js', dest: '.' },
        { src: 'manifest.json', dest: '.' },
        { src: '.nojekyll', dest: '.' },
      ],
    }),
  ],

  assetsInclude: ['**/*.geojson', '**/*.json'],

  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV === 'development'),
  },

  test: {
    environment: 'node',
    include: ['**/js/tests/**/*.test.js', '**/tests/**/*.test.js'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'js/tests/',
        'dist/',
        'coverage/',
        '**/*.config.js',
      ],
    },
    testTimeout: 10000,
    globals: true,
  },
});

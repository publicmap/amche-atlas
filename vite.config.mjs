import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  // Root directory for the project
  root: '.',

  // Public directory for static assets
  publicDir: 'assets',

  // Plugins
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'config/**/*', dest: 'config' },
        { src: 'docs/**/*', dest: 'docs' },
        { src: 'js/**/*', dest: 'js',
          globOptions: { ignore: ['**/tests/**', '**/index.js'] } },
        { src: 'bus/**/*', dest: 'bus' },
        { src: 'game/**/*', dest: 'game' },
        { src: 'warper/**/*', dest: 'warper' },
        { src: 'sound/**/*', dest: 'sound' },
        { src: 'pages/**/*', dest: 'pages' },
        { src: 'offline.html', dest: '.' },
        { src: 'privacy.html', dest: '.' },
        { src: 'manifest.json', dest: '.' },
        { src: 'service-worker.js', dest: '.' },
        { src: '.nojekyll', dest: '.' }
      ]
    })
  ],
  
  // Server configuration
  server: {
    port: 4035,
    host: true, // Allow external connections
    open: true, // Open browser automatically
    cors: true, // Enable CORS for development
  },
  
  // Build configuration
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        'map-browser': 'map-browser.html',
        'map-creator': 'map-creator.html',
        'map-export': 'map-export.html',
        'map-inspector': 'map-inspector.html',
        'map-information': 'map-information.html',
        'map-export-layout': 'map-export-layout.html'
      }
    }
  },
  
  // Preview server configuration (for built files)
  preview: {
    port: 4035,
    host: true,
    open: true
  },
  
  // Asset handling
  assetsInclude: ['**/*.geojson', '**/*.json'],
  
  // Define global constants
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV === 'development')
  },
  
  // Vitest configuration
  test: {
    // Test environment
    environment: 'node',
    
    // Test file patterns
    include: ['**/js/tests/**/*.test.js', '**/tests/**/*.test.js'],
    
    // Exclude patterns
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'js/tests/',
        'dist/',
        'coverage/',
        '**/*.config.js'
      ]
    },
    
    // Test timeout
    testTimeout: 10000,
    
    // Globals (makes expect, describe, it available without imports)
    globals: true
  }
}); 
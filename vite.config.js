import { defineConfig } from 'vite';

export default defineConfig({
  // Root directory for the project
  root: '.',
  
  // Public directory for static assets
  publicDir: 'assets',
  
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
        'map-inspector': 'map-inspector.html',
        'map-information': 'map-information.html',
        'pdf-layout': 'pdf-layout.html'
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
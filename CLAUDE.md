# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm start` or `npm run dev` - Start development server on port 4035
- `npm run build` - Build for production using Vite
- `npm run preview` - Preview built files on port 4035
- `npm test` - Run tests with Vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test -- path/to/test.js` - Run a single test file
- `npm run lint` - Run JSON linting for atlas configuration files
- `npx playwright test` - Run end-to-end tests (requires dev server running)

## Architecture Overview

This is **amche-atlas**, a web-based GIS platform for interactive spatial data visualization. The application uses a static site architecture with minimal dependencies, designed for simplicity and community contribution.

### Technology Stack
- **Mapbox GL JS** - Client-side map rendering and interactivity
- **jQuery** - DOM manipulation
- **Shoelace** - UI components (primarily for layer controls)
- **Tailwind CSS** - Responsive CSS framework
- **Vite** - Build tool and development server
- **Vitest** - Testing framework

### Core Architecture

**Debounced Updates Pattern**

The application uses setTimeout-based debouncing rather than direct event-driven updates in several critical areas:

- **URL Updates** (`url-manager.js`): 300ms debounce prevents excessive browser history entries when multiple state changes occur rapidly (e.g., selecting multiple features, adjusting layers)
- **Map Interactions**: Debouncing prevents performance issues from frequent map events (pan, zoom, hover)

**Why debouncing instead of direct events:**
- **Browser History Management**: Each URL change creates a history entry; debouncing batches related changes into a single entry
- **Performance**: Serializing layer configurations (including GeoJSON) and updating URLs is expensive; batching reduces overhead
- **User Experience**: Prevents the "back" button requiring many clicks to return to a previous meaningful state

**Tradeoffs:**
- More complex debugging (asynchronous updates, race conditions)
- Potential for option conflicts when multiple debounced calls override each other (see `setStateManager` handling selection layer updates)
- Less predictable timing compared to synchronous event handlers

**When working with debounced updates:**
- Be aware that the last call's options will override earlier calls within the debounce window
- Use console logging to trace the sequence of calls and their options
- Consider whether state changes need to merge options rather than replace them

**Configuration-Driven Maps**
The entire application is driven by JSON configuration files in `/config/`:
- `_defaults.json` - Default styling for atlas and layer types
- `index.atlas.json` - Main map configuration
- `*.atlas.json` - Additional themed configurations

The JSON configurations are cascaded as follows:
1. `_defaults.json` is loaded first
2. `index.atlas.json` is loaded second
3. `*.atlas.json` are loaded third

This makes it possible to scope customizations to specific atlases or layers without affecting other atlases or repeating definitions.

**URL API**

The application supports a URL API for deep linking and sharing map configurations. The following parameters are supported:
- `?atlas=filename` - Load local config file
- `?atlas=https://...` - Load remote config
- `?atlas={"name":"..."}` - Inline JSON config
- `?layers=layer1,layer2` - Override visible layers

Available API options and examples are maintained in `/docs/API.md`

**Modular JavaScript Structure (`/js/`)**
- `map-init.js` - Application entry point and map initialization. This is the main file that is loaded when the application is started and resolves the various atlas configurations and layer presets to apply.
- `layer-registry.js` - Central registry managing layer presets and atlas configurations. This is used to load the various layer presets and atlas configurations.
- `map-layer-controls.js` - Main UI for layer toggles (uses Shoelace components)
- `map-feature-control.js` - Feature inspection and interaction
- `url-manager.js` - URL parameter handling and permalink management
- `mapbox-api.js` - Mapbox GL JS abstraction layer
- `layer-creator-ui.js` - UI for creating custom layers dynamically
- `map-search-control.js` - Location search functionality
- `map-export-control.js` - Export map to PDF/image
- `terrain-3d-control.js` - 3D terrain visualization toggle

**Layer System**
The application supports multiple data layer types:
- `style` - Uses existing Mapbox style sources
- `vector` - Vector tiles (.pbf/.mvt) with sourceLayer
- `geojson` - GeoJSON vector data
- `tms` - Raster tile services
- `csv` - Tabular data with lat/lng columns

**Layer Ordering Logic**
The layer ordering system ensures consistent visual stacking between URL parameters, map rendering, and the inspector UI:

1. **URL Convention**: `?layers=layer1,layer2,layer3`
   - First layer in URL (`layer1`) appears **on top** visually
   - Last layer in URL (`layer3`) appears **at bottom** visually

2. **Map Rendering Order**: Layers are added in **REVERSE** of URL order
   - Mapbox GL JS renders: last added = on top, first added = at bottom
   - To achieve URL convention (first = top), layers are added in reverse
   - Example: URL `[layer1,layer2,layer3]` → Added as `[layer3, layer2, layer1]`

3. **Basemap vs Overlay Groups**:
   - Layers tagged with `basemap` are grouped separately from overlays
   - Basemaps are always added **before** overlays (bottom of stack)
   - **Both groups are reversed** during map rendering to maintain first-in-URL = top convention
   - Example URL: `?layers=overlay1,overlay2,basemap1,basemap2`
     - Map addition order: `basemap2 → basemap1 → overlay2 → overlay1`
     - Visual stack (top to bottom): `overlay1, overlay2, basemap1, basemap2`

4. **Internal Layer Storage** (MapLayerControl._state.groups):
   - Layers are stored in **config/visual order** (same as URL order)
   - NOT stored in map rendering order
   - This means: first in `_state.groups` = first in URL = top visually
   - When generating URLs, layers are taken from `_state.groups` as-is (no reversal needed)

5. **Initial Load Logic** (js/map-init.js):
   - If URL has `?layers=` parameter: layers are loaded from URL in specified order
   - If no URL parameter: layers marked `initiallyChecked: true` in config are loaded
   - Config order is preserved when no URL parameter is present
   - URL layer order always takes precedence over config order
   - Layers in config are stored in visual order (first = top)

6. **Inspector Display** (map-inspector.html):
   - Shows layers in same order as URL (first = top)
   - Gets layers from `_state.groups` which is already in URL/visual order
   - Overlays section shows overlay layers in visual order
   - Basemaps section shows basemap layers in visual order
   - Active/selected layers are sorted to top within each section

7. **Centralized Logic** (js/layer-order-manager.js):
   - `urlOrderToMapOrder()`: Converts URL order to map rendering order (reverses both groups)
   - `mapOrderToUrlOrder()`: Returns layers as-is (no reversal - already in URL order)
   - `getInspectorDisplayOrder()`: Returns layers in URL/visual order for inspector
   - All layer ordering must use these methods for consistency

### Key Files
- `index.html` - Main application entry point
- `css/styles.css` - Global styles and Tailwind customizations
- `config/_defaults.json` - Default styling for layer types
- `vite.config.js` - Build configuration with Vitest and Playwright setup
- `service-worker.js` - PWA offline support

### Special Purpose Pages
- `/bus/` - Transit route explorer application
- `/game/` - Interactive map-based game
- `/warper/` - Tool for georeferencing maps with mapwarper.net integration
- `/contact/` - Contact form page

### Configuration System

Maps are configured through:
1. **Atlas Configs** (`*.atlas.json`) - Reference layers by ID with optional overrides

The `layer-registry.js` module loads all atlas configurations at startup and maintains a central registry. This enables:
- Fast switching between different atlas views
- Layer sharing across multiple atlases
- Metadata tracking (colors, names, bounding boxes) per atlas

Example atlas structure:
```json
{
  "name": "Map Name",
  "color": "#2563eb",
  "map": { "center": [lng, lat], "zoom": 11 },
  "layers": [
    { "id": "mapbox-streets", "initiallyChecked": true },
    { "id": "forests" }
  ]
}
```

### URL Parameter System
- `?atlas=filename` - Load local config file
- `?atlas=https://...` - Load remote config
- `?atlas={"name":"..."}` - Inline JSON config
- `?layers=layer1,layer2` - Override visible layers

## Development Practices

### Code Quality
- Keep files under 300 lines
- No comments unless explicitly requested
- Follow existing code patterns and conventions
- Use project's existing libraries (jQuery, Shoelace, Tailwind)
- Fix root causes, not symptoms
- ES6 modules with explicit imports/exports

### Testing
- Tests are in `js/tests/` directory and `/e2e/` for end-to-end tests
- Use Vitest framework with globals enabled for unit tests
- Use Playwright for end-to-end browser testing
- JSON configuration validation via `js/tests/lint-json.js`
- Test coverage reports generated in `/coverage/`
- Run `npm run test:watch` for continuous testing during development

### Configuration Changes
- Always validate JSON syntax using the lint command
- Test configurations using URL parameters
- Layer presets in `_map-layer-presets.json` require `id` and `title` fields
- Atlas configs require valid `layers` array with `id` references

### Data Processing
- Data processing scripts are in `/data/` organized by data source
- Each subdirectory contains processing code for specific datasets (geojson, mapwarper, etc.)
- GeoJSON files are hosted externally (GitHub Gists, Maphub, Wikimedia Commons)
- Vector tiles hosted on IndianOpenMaps mirror
- Georeferenced rasters served via mapwarper.net TMS

### Deployment
- Main branch deploys to https://amche.in (production)
- Dev branch deploys to https://amche.in/dev (testing)
- Deployment via GitHub Pages with ~1 minute deploy time
- Use `git push origin HEAD:dev --force` to test changes live

**IMPORTANT: New HTML Files and Directories**
When adding new HTML files or directories, they MUST be added to BOTH build configurations:

1. **Root-level HTML files** (e.g., `map-inspector.html`):
   - Add to `vite.config.js` in `build.rollupOptions.input` object
   - Add to `webpack.config.js` in `CopyWebpackPlugin` patterns array
   - Example: `'map-inspector': 'map-inspector.html'`

2. **Special purpose directories** (e.g., `/bus/`, `/game/`, `/warper/`):
   - Add to `webpack.config.js` in `CopyWebpackPlugin` patterns array
   - Example: `{ from: 'warper', to: 'warper' }`

Without these updates, new files/directories will work locally but return 404 on GitHub Pages.

**Testing deployment configuration:**
- Run `npm test` to verify all HTML files and directories are properly configured
- The test suite includes checks for missing deployment configurations
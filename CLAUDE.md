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
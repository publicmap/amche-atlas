# URL API Documentation

The Amche Atlas application supports URL parameters for deep linking and sharing specific map configurations. All parameters can be combined to create comprehensive map states.

## Parameters

### `atlas`

Load a specific atlas configuration.

**Format:** `?atlas=<value>`

**Values:**
- `filename` - Load local config file (e.g., `?atlas=villages`)
- `https://...` - Load remote config URL
- `{"name":"..."}` - Inline JSON config

**Examples:**
```
?atlas=villages
?atlas=https://example.com/map-config.json
?atlas={"name":"Custom Map","layers":[{"id":"mapbox-streets"}]}
```

### `layers`

Override visible layers from the atlas configuration.

**Format:** `?layers=<layer1>,<layer2>,...`

**Values:**
- Comma-separated list of layer IDs
- Supports inline JSON layer definitions with `{...}` syntax
- Can include opacity: `{"id":"layer-name","opacity":0.5}`

**Examples:**
```
?layers=mapbox-streets,forests
?layers=goa-plots,{"id":"custom-layer","opacity":0.7}
```

### `selected`

Deep link to specific selected features on the map, or trigger a location click at the hash position.

**Format:** `?selected=<layerId>:<featureId1>,<featureId2>;<layerId2>:<featureId3>`

**Format (location click):** `?selected` (no value) — combined with a map position hash

**Syntax:**
- Multiple layers separated by semicolons (`;`)
- Each layer segment: `layerId:featureId1,featureId2,...`
- Multiple features from the same layer separated by commas (`,`)
- Feature IDs are the raw IDs from the data source (feature.id, properties.id, or properties.fid)

**Location click behavior:**
When `?selected` is present without a value and a position hash (`#zoom/lat/lng`) is in the URL, the map simulates a click at that location on load. This selects any features at the point, creates a marker, and opens the feature inspector — identical to a user clicking the map.

**Examples:**
```
Single feature:
?selected=goa-plots:12345

Multiple features from one layer:
?selected=goa-plots:12345,67890,11111

Multiple features across layers:
?selected=goa-plots:12345,67890;goa-buildings:11111,22222;roads:999

Combined with layers:
?layers=goa-plots,goa-buildings&selected=goa-plots:12345;goa-buildings:67890

Location click (select whatever is at this point):
?atlas=goa-land-atlas&selected#18/15.54845/73.8187
```

**Notes:**
- Features are automatically selected when the page loads
- Selections persist across map interactions
- Use Cmd/Ctrl+Click to add to existing selections
- Click empty area to clear all selections
- Location click waits for map tiles to load before firing

### `geolocate`

Trigger geolocation to center the map on the user's current location.

**Format:** `?geolocate=true`

**Example:**
```
?geolocate=true
```

### `q`

Pre-populate the search query and trigger a location search.

**Format:** `?q=<search-term>`

**Example:**
```
?q=Panaji
?q=Cabo de Rama Fort
```

### `terrain`

Control 3D terrain visualization and exaggeration level.

**Format:** `?terrain=<exaggeration>`

**Values:**
- `0` - Disable terrain
- `0.5` to `3.0` - Terrain exaggeration multiplier (default: `1.5`)

**Examples:**
```
?terrain=0        (disable terrain)
?terrain=1.5      (default exaggeration)
?terrain=2.5      (more dramatic terrain)
```

### `animate`

Enable automatic camera animation around the terrain.

**Format:** `?animate=true`

**Example:**
```
?terrain=2&animate=true
```

### `fog`

Control atmospheric fog rendering in 3D view.

**Format:** `?fog=false` (fog is enabled by default)

**Example:**
```
?terrain=2&fog=false
```

### `wireframe`

Display terrain as a wireframe mesh for debugging.

**Format:** `?wireframe=true`

**Example:**
```
?terrain=2&wireframe=true
```

### `terrainSource`

Select the terrain data source (default: `mapbox`).

**Format:** `?terrainSource=<source>`

**Values:**
- `mapbox` (default)
- `maptiler`
- Other configured terrain sources

**Example:**
```
?terrain=2&terrainSource=maptiler
```

## Complete Examples

### Basic Map with Layers
```
?atlas=villages&layers=mapbox-streets,forests,water-bodies
```

### Map with Feature Selection
```
?atlas=goa&layers=goa-plots,goa-buildings&selected=goa-plots:12345,67890
```

### 3D Terrain Visualization
```
?atlas=topography&terrain=2.5&animate=true&wireframe=false
```

### Search Location with Terrain
```
?q=Dudhsagar Falls&terrain=2&geolocate=true
```

### Complex Configuration
```
?atlas=environmental&layers=protected-areas,mining-leases,forests&selected=mining-leases:L001,L002;protected-areas:PA123&terrain=1.5&q=Mollem
```

## URL Generation

The application automatically updates the URL as you interact with the map:
- Layer visibility changes update the `layers` parameter
- Feature selections update the `selected` parameter
- Terrain controls update terrain-related parameters
- Search queries update the `q` parameter

Use the share button to copy the current URL with all active parameters.

---

## Architecture

### Two-Phase Parameter Processing

URL parameters are processed in two distinct phases:

**Phase 1 — Startup config (before map creation)**
Handled in `js/map-init.js` → `loadConfiguration()`.
Only `atlas` and `layers` are processed here because they determine which config file to load and which layers to initialize. This runs before the Mapbox map object exists.

**Phase 2 — Runtime apply (after map load)**
Handled in `js/url-manager.js` → `applyURLParameters()`.
All other parameters (`terrain`, `geolocate`, `q`, `selected`, etc.) are applied after the map and layer controls are fully initialized. This is triggered by the `layersInitialized` event in `map-init.js`.

### Key Files

| File | Role |
|------|------|
| `js/url-manager.js` | Central URL management class. Reads parameters on load (`applyURLParameters`), writes parameters on state change (`_performURLUpdate`), and exposes `updateXxxParam()` methods for each parameter. All URL reads and writes go through this class at runtime. |
| `js/map-init.js` | Startup only. Handles `atlas` and `layers` in `loadConfiguration()` before the map exists. Also sets up the `URLManager` instance and wires it to the layer control and state manager. |
| `js/map-utils.js` → `URLUtils` | Static helpers: `getUrlParameter(name)`, `parseLayersFromUrl(str)`, `needsURLPrettification()`. Used by both phases. |
| `js/layer-order-manager.js` | Centralizes layer order logic. `urlOrderToMapOrder()` and `mapOrderToUrlOrder()` are used by `url-manager.js` when serializing the `layers` parameter. |
| `js/terrain-3d-control.js` | Calls `window.urlManager.updateTerrainParam()`, `updateAnimateParam()`, `updateFogParam()`, `updateWireframeParam()`, `updateTerrainSourceParam()`, `updateFovParam()`, `updateBearingParam()`, `updatePitchParam()`, `updateSoundParam()` when terrain state changes. |
| `js/map-search-control.js` | Calls `window.urlManager.updateSearchParam()` when the search query changes. |
| `js/map-export-control.js` | Calls `window.urlManager.updateExportParam()` when export settings change. |
| `js/map-feature-control-iframe.js` | Calls `window.urlManager.updateURL({ updateSelections: true, updateLayers: true })` after feature selections change. Contains the map click handler that `applyLocationClickFromURL()` fires into. |
| `js/map-layer-controls.js` | Calls `window.urlManager.onLayersChanged()` when layer visibility or opacity changes. |

### URL Write Flow

When any component changes state, it calls a method on `window.urlManager`. The call is debounced 300ms in `updateURL()` then executed in `_performURLUpdate()`:

1. `_performURLUpdate()` collects the new value for the parameter being changed
2. All other currently-set parameters are **preserved** from `window.location.search`
3. A clean, human-readable URL is assembled manually (without `URLSearchParams` encoding the `layers` value)
4. `window.history.replaceState()` updates the browser URL
5. A `urlUpdated` custom event is dispatched for other components (e.g., the share button)

The `layers` parameter is intentionally kept unencoded (commas and braces appear as-is) for readability. All other parameters use standard encoding where needed.

### URL Read Flow (on load)

```
index.html loads
  → splash-screen-manager.js: reads atlas/layers to show correct splash screen
  → map-init.js loadConfiguration(): reads atlas + layers to build config object
  → map-init.js initializeMap(): creates Mapbox map, initializes controls
  → layersInitialized event fires
  → url-manager.js applyURLParameters(): applies terrain, geolocate, q, selected, zoomTo
```

The `layersInitialized` event is the handoff point between Phase 1 and Phase 2.

---

## Adding a New URL Parameter

To add a new parameter (e.g., `?foo=bar`), touch these locations in order:

### 1. `js/url-manager.js` — `applyURLParameters()`

Parse the value and add it to the early-return guard:

```javascript
const fooParam = urlParams.get('foo');

// Add to the early-return guard:
if (!layersParam && ... && !fooParam) { return false; }

// Add handling after the existing blocks:
if (fooParam && window.someControl) {
    applied = true;
    window.someControl.setFoo(fooParam);
}
```

### 2. `js/url-manager.js` — `_performURLUpdate()`

Declare a local variable, detect changes, and emit the value:

```javascript
let fooParam = null;

// Detect change:
if (options.foo !== undefined) {
    const currentFooParam = urlParams.get('foo');
    if (options.foo) {
        fooParam = options.foo.toString();
        if (currentFooParam !== fooParam) hasChanges = true;
    } else {
        if (currentFooParam !== null) hasChanges = true;
    }
}

// Emit (in the URL assembly block — add to otherParams.delete() list too):
otherParams.delete('foo');
const currentFoo = fooParam || (options.foo === undefined ? urlParams.get('foo') : null);
if (currentFoo) { params.push('foo=' + currentFoo); }
```

### 3. `js/url-manager.js` — add a named update method

```javascript
updateFooParam(value) {
    this.updateURL({ foo: value, updateLayers: false });
}
```

### 4. The component that owns the state

Call `window.urlManager.updateFooParam(value)` whenever the state changes:

```javascript
// e.g., in js/some-control.js
if (window.urlManager) {
    window.urlManager.updateFooParam(this._fooValue);
}
```

### If the parameter must affect config loading (like `atlas` or `layers`)

Also edit `js/map-init.js` → `loadConfiguration()` to read and act on it before the map is created. Use `URLUtils.getUrlParameter('foo')` for consistency.

---

## Technical Notes

### Parameter Persistence
- URL parameters are debounced (300ms) to prevent excessive history entries
- Browser back/forward buttons restore previous map states via `popstate` → `applyURLParameters()`
- Parameters are preserved during map interactions

### Feature ID Resolution
The `selected` parameter uses feature IDs in this priority order:
1. `feature.id` (if available in the data source)
2. `feature.properties.id`
3. `feature.properties.fid` (common in vector tiles)
4. Other layer-specific identifiers

When creating deep links, use the IDs directly from your data source.

### URL Encoding
- Layer IDs and simple values are not URL-encoded for readability
- Special characters in JSON objects are automatically encoded
- Semicolons and colons in the `selected` parameter are not encoded
- `URLUtils.needsURLPrettification()` detects and fixes inadvertently encoded URLs on load

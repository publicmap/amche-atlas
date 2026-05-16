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

## Layer Source Formats

Layers in an atlas config are objects in the `layers` array. Each one declares a `type` that selects the loader in `js/mapbox-api.js`. This section is the canonical reference for every supported `type`. **When a new layer type is added in `mapbox-api.js`, this section MUST be updated in the same change** — see [Adding a New Layer Type](#adding-a-new-layer-type) below.

### Common Properties

Available on all layer types unless noted otherwise.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique identifier referenced from URLs and other configs. **Required** for all types except inline `style` layers. |
| `type` | string | One of `style`, `vector`, `tms`, `wmts`, `wms`, `cog`, `geojson`, `csv`, `img`, `raster-style-layer`, `layer-group`. **Required.** |
| `title` | string | Display name in the layer control. |
| `description` | string | HTML allowed; shown in the layer info panel. |
| `tags` | string[] | Used to group layers in the UI. Prefix with `N.` (e.g. `"1.Development Plans"`) to control sort order. |
| `headerImage` | string | Thumbnail shown in the layer control. |
| `legendImage` | string | Image shown in the legend panel when the layer is active. |
| `attribution` | string | HTML allowed. Shown in the bottom-right attribution control while the layer is visible. |
| `initiallyChecked` | boolean | If `true`, the layer is on at first load (unless `?layers=` overrides). |
| `opacity` | number | 0–1 multiplier applied on top of any `style` opacity. |
| `style` | object | Mapbox GL paint/layout properties. See `config/_defaults.json` for the cascade. |
| `minzoom`, `maxzoom` | number | Standard Mapbox source zoom range. |
| `inspect` | object | Configures the feature popup. See [Inspect Configuration](#inspect-configuration). Set to `false`/`null` to disable interactivity. |

#### Inspect Configuration

```json
"inspect": {
  "id": "osm_id",
  "title": "Name",
  "label": "name",
  "fields": ["iata", "icao", "aerodrome"]
}
```

- `id` — property used as the feature's stable identifier (also promoted to `feature.id` for state).
- `title` — header text for the popup.
- `label` — property whose value is shown as the popup heading.
- `fields` — properties listed in the popup body.

---

### `style` — Mapbox style layer toggle

Toggle the visibility of layers already present in the base Mapbox style (e.g. Mapbox Streets sublayers). Selects target sublayers by `source-layer`.

| Field | Notes |
|---|---|
| `layers` | Array of `{ title, sourceLayer }` selecting which style sublayers this group controls. **Required.** |

```json
{
  "id": "mapbox-streets",
  "type": "style",
  "title": "Mapbox Streets",
  "description": "Detailed street-level data from Mapbox Streets vector tiles.",
  "attribution": "© Mapbox © OpenStreetMap contributors",
  "layers": [
    { "title": "Hillshade", "sourceLayer": "hillshade" },
    { "title": "Places Labels", "sourceLayer": "place_label" }
  ]
}
```

### `vector` — Vector tile source

Mapbox Vector Tiles (`.pbf` / `.mvt`). Renders as fill / line / circle / symbol layers driven by the `style` object.

| Field | Notes |
|---|---|
| `url` | XYZ template `https://.../{z}/{x}/{y}.pbf` **or** `mapbox://tileset.id`. **Required.** |
| `sourceLayer` | Name of the source-layer inside the tile. **Required.** |
| `minzoom`, `maxzoom` | Vector tile zoom range. |
| `inspect` | Popup configuration (see common properties). |

```json
{
  "id": "tngis_tn_cadastrals",
  "type": "vector",
  "title": "Tamil Nadu Cadastrals",
  "url": "https://indianopenmaps.com/not-so-open/cadastrals/tamil-nadu/tngis/{z}/{x}/{y}.pbf",
  "sourceLayer": "TNGIS_TN_Cadastrals",
  "minzoom": 0,
  "maxzoom": 14,
  "inspect": { "id": "id", "title": "Plot", "label": "survey_no" }
}
```

### `tms` — Raster XYZ tile service

Standard raster tile services (`/{z}/{x}/{y}.png|.jpg`). Supports an optional proxy for CORS / referer-restricted sources.

| Field | Notes |
|---|---|
| `url` | XYZ template **or** `mapbox://...`. **Required.** |
| `scheme` | `xyz` (default) or `tms` (Y-axis flipped). |
| `tileSize` | Default `256`. |
| `proxyUrl`, `proxyReferer` | Wraps the tile URL through a CORS proxy with the given Referer header. |
| `urlTimeParam` | Template such as `TIME={time}` for time-aware sources (see NASA GIBS atlas). |
| `geojson` | Inline GeoJSON drawn as a `simplestyle-spec` overlay on top of the raster. |

```json
{
  "id": "dp-2034",
  "type": "tms",
  "title": "BMC T Ward - 2034 DP",
  "url": "https://mapwarper.net/maps/tile/34909/{z}/{x}/{y}.png",
  "attribution": "<a href='https://mapwarper.net/maps/34909'>Map Warper</a>"
}
```

### `wmts` — Web Map Tile Service

OGC WMTS endpoints. The `TileMatrix={z}` / `TileCol={x}` / `TileRow={y}` placeholders in the URL are converted to XYZ. The application defaults to requesting `GoogleMapsCompatible_Level9` tilematrixset (EPSG:3857) when possible.

| Field | Notes |
|---|---|
| `url` | WMTS GetTile URL with `TileMatrix={z}`, `TileCol={x}`, `TileRow={y}` placeholders. **Required.** |
| `tileSize` | Default `256`. |
| `forceWebMercator` | Override the EPSG:4326 → EPSG:3857 auto-conversion heuristic. |
| `urlTimeParam` | Template such as `TIME={time}` for time-aware layers. |

```json
{
  "id": "modis-terra-truecolor",
  "type": "wmts",
  "title": "MODIS Terra True Color",
  "url": "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?layer=MODIS_Terra_CorrectedReflectance_TrueColor&style=default&tilematrixset=GoogleMapsCompatible_Level9&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}",
  "urlTimeParam": "TIME={time}",
  "attribution": "NASA GIBS"
}
```

### `wms` — Web Map Service

OGC WMS endpoints. Converted to Mapbox raster tile requests with `{bbox-epsg-3857}` / `{bbox-epsg-4326}` placeholders.

| Field | Notes |
|---|---|
| `url` | WMS `GetMap` URL with `LAYERS`, `FORMAT`, etc. The bbox parameter is added/replaced automatically. **Required.** |
| `srs` | Force a specific CRS (e.g. `EPSG:4326`). Auto-detected from URL otherwise. |
| `tileSize` | Default `256`. |
| `proxyUrl`, `proxyReferer` | CORS / referer proxy (same semantics as `tms`). |
| `urlTimeParam` | Template such as `TIME={time}`. |

```json
{
  "id": "gsi-nlsm",
  "type": "wms",
  "title": "Landslide Susceptibility",
  "url": "https://bhukosh.gsi.gov.in/arcgis/services/Landslide/NLSM/MapServer/WMSServer?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=0,2,5&FORMAT=image%2Fpng&CRS=EPSG%3A3857&TRANSPARENT=TRUE",
  "maxzoom": 12,
  "attribution": "Geological Survey of India"
}
```

### `cog` — Cloud Optimized GeoTIFF

A single COG `.tif` served over HTTP. Reads the COG's overview pyramid via HTTP range requests using the Mapbox GL JS 3.23+ [`TileProvider`](https://github.com/mapbox/mapbox-gl-js/commit/2a50e9fa34b7583007c0d752ec76e9a2d028ecb1) API. The actual range-request logic lives in `js/cog-tile-provider.js` (which depends on `geotiff.js` via CDN ESM).

| Field | Notes |
|---|---|
| `url` | Direct URL to the `.tif` file. **Required.** The server **must** support HTTP Range requests (`Accept-Ranges: bytes`) and CORS. |
| `tileSize` | Default `256`. |

**Requirements on the COG:**
- Properly tiled with internal overviews (use `gdal_translate -of COG` or `rio cogeo create`).
- CRS in EPSG:3857 (web mercator) **or** EPSG:4326. Other CRSes will be misregistered.
- Pixel data must be 8-bit RGB, RGBA, or single-band grayscale. Floating-point DEMs / multi-band scientific data are not yet supported.

```json
{
  "id": "2034-development-plan",
  "type": "cog",
  "title": "Greater Mumbai Development Plan 2034",
  "description": "Sanctioned Development Plan 2034 raster.",
  "url": "https://pub-5d7a831c335c4d83b8b0f8ebe750e175.r2.dev/City-Tiles/Mumbai_Final_COG.tif",
  "attribution": "<a href='https://dpremarks.mcgm.gov.in/dp2034/'>MCGM</a>"
}
```

### `geojson` — GeoJSON / KML

Inline or remote GeoJSON. Also accepts a KML URL (auto-converted using `js/kml-converter.js`).

| Field | Notes |
|---|---|
| `url` | Remote GeoJSON or KML URL. |
| `data` | Inline GeoJSON object (mutually exclusive with `url`). |
| `geojson` | Alternative inline GeoJSON property (`null` is treated as an empty FeatureCollection). |
| `dataSource` | `"localStorage"` to read from the in-browser cache populated by the layer creator UI (`url` is used as fallback). |
| `clustered` | Enable point clustering. |
| `clusterMaxZoom`, `clusterRadius` | Standard Mapbox clustering options. |
| `clusterSeparateBy` | Property name used to split clusters into one source per value. |
| `clusterStyles` | Map of `{ propertyValue: { color } }` for per-value cluster styling. |
| `refresh` | Polling interval in milliseconds for refetching the remote URL. |
| `blink` | Animate the layer to blink while visible. |
| `inspect` | Popup configuration. |

```json
{
  "id": "aerodromes",
  "type": "geojson",
  "title": "Aerodrome 10km Buffer",
  "url": "https://gist.githubusercontent.com/planemad/.../india-aerodrome-10km-buffer.geojson",
  "inspect": { "id": "osm_id", "title": "Aerodrome", "label": "name" },
  "style": {
    "fill-color": "rgba(0,150,255,0.2)",
    "line-color": "#0096ff"
  }
}
```

### `csv` — CSV tabular data

CSV with one row per point. Latitude / longitude columns are **auto-detected** by name pattern (`lat`, `latitude`, `y`, `northing`, ... for latitude; `lng`, `lon`, `longitude`, `x`, `easting`, ... for longitude — see `GeoUtils.rowsToGeoJSON` in `js/map-utils.js` for the full pattern list). Renders as points using the GeoJSON style pipeline.

| Field | Notes |
|---|---|
| `url` | CSV URL (e.g. a published Google Sheet `output=csv` link). |
| `data` | Inline CSV text or pre-parsed rows. |
| `cache` | Path to a static CSV under `/data/` used as a fast fallback before the remote URL responds. |
| `csvParser` | Custom parser function (rare; usually omit and let the default delimiter detection handle it). |
| `refresh` | Polling interval in milliseconds. |
| `style` | Mapbox circle/symbol properties (same as GeoJSON). |
| `inspect` | Popup configuration. |

```json
{
  "id": "goa-schools",
  "type": "csv",
  "title": "Schools (by capacity)",
  "url": "https://docs.google.com/.../pub?output=csv",
  "cache": "data/dfes/goa-schools.csv",
  "style": {
    "circle-radius": ["case", [">", ["get", "Capacity"], 500], 8, 5],
    "circle-color": "#e11d48"
  }
}
```

### `img` — Single image overlay

A georeferenced raster bounded by a bounding box. Useful for thumbnails, daily satellite snapshots, etc.

| Field | Notes |
|---|---|
| `url` | Image URL (PNG/JPEG). **Required.** |
| `bounds` (alias: `bbox`) | `[west, south, east, north]` in lng/lat. **Required.** |
| `urlTimeParam` | Template such as `TIME={time}` to refresh the URL on the global time control. |

```json
{
  "id": "imd-satellite",
  "type": "img",
  "title": "INSAT-3DR IR1",
  "url": "https://amche-atlas-production.up.railway.app/proxy?url=https://mausam.imd.gov.in/Satellite/rswmo_ir1.jpg&referer=https://mausam.imd.gov.in/",
  "bounds": [44.5, -15.8, 113, 48.5],
  "attribution": "India Meteorological Department"
}
```

### `raster-style-layer` — Existing raster style layer

Toggles a raster layer already present in the base Mapbox style. Use when the basemap style ships a raster source you want to expose as a toggle (e.g. Mapbox Satellite).

| Field | Notes |
|---|---|
| `styleLayer` | Layer ID inside the base style to toggle. **Required.** |

```json
{
  "id": "satellite-imagery",
  "type": "raster-style-layer",
  "title": "Satellite",
  "styleLayer": "mapbox-satellite"
}
```

### `layer-group` — Grouped toggle

Bundle multiple existing layer IDs under one user-facing toggle. The child layers are referenced by ID and may live in any other atlas.

| Field | Notes |
|---|---|
| `groups` | Array of child references. Each child is `{ id, title, attribution?, location? }`. **Required.** |

```json
{
  "id": "slope",
  "type": "layer-group",
  "title": "Slope (DEM)",
  "description": "Slope classification from multiple DEM sources.",
  "legendImage": "assets/map-layers/goa/legend-slope.png",
  "groups": [
    { "id": "nasadem-30-m", "title": "NASA NASADEM 30m", "location": "Goa" },
    { "id": "cartodem-2-5-m", "title": "ISRO CartoDEM 2.5m", "location": "Bardez" }
  ]
}
```

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

## Adding a New Layer Type

When you add support for a new `type` value (e.g. `cog`, `pmtiles`, ...), touch every location in this list and update [Layer Source Formats](#layer-source-formats) in the same change:

### 1. `js/mapbox-api.js` — add the type to all five dispatch switches

```javascript
// createLayerGroup
case 'mytype': return this._createMyTypeLayer(groupId, config, visible);
// updateLayerGroupVisibility
case 'mytype': return this._updateMyTypeLayerVisibility(groupId, config, visible);
// removeLayerGroup
case 'mytype': return this._removeMyTypeLayer(groupId, config);
// updateLayerOpacity
case 'mytype': return this._updateMyTypeLayerOpacity(groupId, config, opacity);
// getLayerGroupIds — return the actual map layer IDs the type owns
case 'mytype': return [`mytype-layer-${groupId}`].filter(id => this._map.getLayer(id));
```

Implement the four `_createMyTypeLayer` / `_updateMyTypeLayerVisibility` / `_removeMyTypeLayer` / `_updateMyTypeLayerOpacity` methods following the existing TMS / WMS structure.

### 2. `js/layer-order-manager.js` — set the layer slot

Add the type to the appropriate slot bucket in `getInsertPosition()`:

```javascript
if (['tms', 'wmts', 'wms', 'cog', 'mytype', ...].includes(type)) return 'bottom';
```

Vector-like types (querying features, sitting between basemap and labels) should return `null` (default middle slot) instead.

### 3. `docs/API.md` — document the type

**This step is non-negotiable.** Add a `### `mytype` — Title` subsection under [Layer Source Formats](#layer-source-formats) including:

- A one-line description of what it loads.
- A table of required + optional fields (mark which are required).
- A complete JSON example pulled from a real atlas config when possible.
- Any external dependencies (CDN scripts, server requirements like Range-request support, browser API requirements, etc).

Also bump the type list in the [Common Properties](#common-properties) table.

### 4. (If applicable) `index.html` / new ES modules

If the new type needs a CDN library or a Mapbox `TileProvider` module, document it in the type's section so the next person doesn't have to dig through the source.

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

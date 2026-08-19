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

#### Dynamic layer shortcuts

Instead of pasting a full external URL into the map creator to build a complete layer config, a layer entry in `?layers=` can be a compact `<service>:<id>` shorthand that's resolved dynamically against the service's API when the page loads — no need to know the layer's tile URL, title, or attribution in advance.

**Format:** `<service>:<id>`

**Supported services:**

| `type` | `id` format | Resolved via | Produces |
|---|---|---|---|
| `allmaps` | Allmaps image ID (e.g. `bca064e512c963f0`) | `annotations.allmaps.org/images/<id>` | `tms` layer — georeferenced historic map tiles |
| `mapwarper` | MapWarper map ID (e.g. `108838`) | `mapwarper.net/api/v1/maps/<id>` | `tms` layer — georeferenced historic map tiles |
| `osm` | OSM element reference, `<node\|way\|relation>/<id>` (e.g. `relation/21057460`) | Overpass API (fetched once, not re-queried on pan) | `geojson` layer with the element's geometry inlined |

**Examples:**
```
?layers=allmaps:bca064e512c963f0
?layers=mapwarper:108838
?layers=osm:relation/21057460
?layers=mapbox-streets,osm:way/28845634
```

**Opacity:** the plain string form has no room for extra properties. To set opacity on a dynamic layer, use the equivalent `{"type":"<service>","id":"<id>","opacity":<0-1>}` object form instead — this is also what the app writes back to the URL automatically when you adjust opacity on a dynamically-resolved layer:
```
?layers={"type":"osm","id":"relation/21057460","opacity":0.5}
```

**Adding the same source via the map creator:** `map-creator.html` accepts the equivalent full URL pasted directly into the URL box, and auto-fills title/attribution/style from the same API:
- Allmaps: `https://viewer.allmaps.org/?url=...`, `https://annotations.allmaps.org/images/<id>`, or `https://allmaps.xyz/images/<id>/{z}/{x}/{y}@2x.png`
- MapWarper: `https://mapwarper.net/maps/<id>`
- OSM: `https://www.openstreetmap.org/<node|way|relation>/<id>`

**Implementation:** each service's API calls live in its own module — `js/allmaps-url-api.js`, `js/mapwarper-url-api.js`, `js/osm-url-api.js` — so adding a new service means adding one module plus a `case` in the dispatcher, `js/dynamic-layer-shorthand.js`. The `type:id` string is parsed by `parseDynamicLayerShorthandString()` (also in `dynamic-layer-shorthand.js`) wherever `?layers=` is split into individual entries — `js/map-utils.js`'s `URLUtils.parseLayersFromUrl()` (startup) and `js/url-manager.js`'s `parseLayersFromUrl()` (runtime). Resolution happens once, during `js/map-init.js`'s `loadConfiguration()`, before the layer ever reaches `MapboxAPI`; the compact shorthand — not the resolved config — is what's kept in the shareable URL.

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
When `?selected` is present without a value and a position hash (`#zoom/lat/lng`) is in the URL, the map simulates a click at that location on load. This selects any features at the point, creates a marker, and opens the feature inspector — identical to a user clicking the map. This is the same location-based restoration `markers=` uses (see below); `?selected` on its own is the shorthand for a single point taken from the hash instead of an explicit `lng,lat`.

**Note:** the app no longer writes `?selected=<layerId>:<featureId>` when sharing a URL — every selection already has a marker, and `markers=` (below) carries its location, which is enough to recover the same features on load without also duplicating them here. The `layerId:featureId` form is still parsed for links shared before this change, and remains available for hand-written deep links that must pin an exact feature ID rather than a location.

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

Location click with layers (auto-adds a marker at the hash position and selects
whatever features are found there once those layers finish loading):
?atlas=goa&layers=local-body,plots,2019-czmp-tidal-hazard-line,2019-czmp-khazan,2021-regional-plan,selection,mapbox-admin-lines,mapbox-satellite&selected#16.53/15.604468/73.810136
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

### `compare`

Enable swipe-comparison ([mapbox-gl-compare](https://github.com/mapbox/mapbox-gl-compare)) for a single layer. A vertical slider splits the map: the **before** side shows the existing map with all current layers, and the **after** side shows the named layer isolated over the basemap. The layer is hidden on the before side so it appears on only one side of the swipe. Only one layer can be compared at a time.

The layer must also be loaded (via `?layers=` or the atlas config) for the comparison to appear.

**Format:** `?compare=<layer-id>`

**Example:**
```
?layers=goa-plots,goa-satellite&compare=goa-satellite
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

### `fov`

Camera field of view for the 3D / terrain view.

**Format:** `?fov=<value>`

**Values:** `0.1` to `1.5` (default: `0.643`)

**Example:**
```
?terrain=2&fov=0.8
```

### `bearing`

Map rotation, in degrees clockwise from north.

**Format:** `?bearing=<degrees>`

**Example:**
```
?bearing=45
```

### `pitch`

Map tilt, in degrees.

**Format:** `?pitch=<degrees>`

**Values:** `0` to `85`

**Example:**
```
?pitch=60
```

### `sound`

Enable the sound visualization layer.

**Format:** `?sound=true`

**Example:**
```
?sound=true
```

### `export`

Restore export (print/image) settings serialized as a JSON object. Set automatically by the export control when you share a URL with export options open.

**Format:** `?export=<json>`

**Example:**
```
?export={"format":"a4","orientation":"landscape"}
```

### `markers`

Compact encoding of the selection markers on the map. Set automatically when you select features and share the URL. Each marker is just its click location; multiple markers are joined with `|`.

**Format:** `?markers=<lng>,<lat>|<next marker>...`

**Example:**
```
?markers=73.8187,15.54845
?markers=73.809867,15.606272|73.82,15.61
```

**Restoration behavior:** on load, once a marker's layers are ready, its location is re-queried exactly as if the user clicked there — this recovers the same selected features without the URL needing to spell out which `layerId`/`featureId` pairs they were (that would just duplicate what the location already implies, and is what `?selected` used to carry — see above).

**Legacy format:** URLs shared before this change may still contain explicit refs — `?markers=<lng>,<lat>:<layerId>~<featureId>,...` — which are still parsed and restore the exact original feature IDs instead of re-querying the point.

### `zoomTo`

Zoom to a layer's bounding box on load, then remove the parameter from the URL. Used when a newly added layer should be framed on first view.

**Format:** `?zoomTo=<layer-id>`

**Example:**
```
?zoomTo=goa-plots
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
- Feature selections update the `markers` parameter with each marker's click location (see [`markers`](#markers) — `selected` is no longer written automatically, though it's still accepted as a hand-written deep link)
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
| `type` | string | One of `style`, `vector`, `tms`, `wmts`, `wms`, `cog`, `geojson`, `js`, `csv`, `sheet`, `overpass`, `img`, `raster-style-layer`, `layer-group`. **Required.** |
| `title` | string | Display name in the layer control. |
| `description` | string | HTML allowed; shown in the layer info panel. |
| `tags` | string[] | Used to group layers in the UI. Prefix with `N.` (e.g. `"1.Development Plans"`) to control sort order. |
| `headerImage` | string | Thumbnail shown in the layer control. |
| `legendImage` | string | Image shown in the legend panel when the layer is active. |
| `attribution` | string | HTML allowed. Shown in the bottom-right attribution control while the layer is visible. |
| `initiallyChecked` | boolean | If `true`, the layer is on at first load (unless `?layers=` overrides). |
| `opacity` | number | 0–1 multiplier applied on top of any `style` opacity. |
| `style` | object | Mapbox GL paint/layout properties. See `config/_defaults.json` for the cascade. Keys may be prefixed with `<name>/` to create additional style passes from the same source — see [Multi-pass style variants](#multi-pass-style-variants). |
| `minzoom`, `maxzoom` | number | Standard Mapbox source zoom range. |
| `inspect` | object | Configures the feature popup. See [Inspect Configuration](#inspect-configuration). Set to `false`/`null` to disable interactivity. |
| `stylePreset` | string | Name of a preset declared at atlas-level under `stylePresets`. See [Atlas-level style and inspect defaults](#atlas-level-style-and-inspect-defaults). |

#### Atlas-level style and inspect defaults

A `style` and/or `inspect` object can be declared at the **atlas** level, alongside `name`, `layers`, etc. Every layer in the atlas inherits these as defaults, so identical styling does not have to be repeated on each layer.

An atlas may also declare a `stylePresets` dictionary — a named lookup that a layer opts into via `stylePreset: "<name>"`. Each preset entry may carry `style`, `inspect`, or both.

Resolution order (later wins, shallow-merged per top-level key):

1. Atlas-level `style` / `inspect`
2. Preset `style` / `inspect` (when the layer sets `stylePreset`)
3. Layer-level `style` / `inspect`

Setting `inspect: false`/`null` on a layer still disables interactivity (the inspect cascade is skipped). The merge is shallow — a layer's `style.line-color` replaces just that one key; a layer's `inspect.fields` replaces the entire array.

```json
{
  "name": "Environmental Approvals India",
  "style": {
    "line-color": "crimson",
    "line-width": 4,
    "fill-color": "crimson",
    "fill-opacity": 0.1
  },
  "inspect": {
    "id": "Proposal Number",
    "title": "Organization Name",
    "label": "Organization Name",
    "fields": ["Project Category", "Project Name", "Project Description"]
  },
  "stylePresets": {
    "highlighted": {
      "style": { "line-width": 8, "line-color": "#fbbf24" }
    }
  },
  "layers": [
    { "id": "approvals-goa",         "type": "vector", "url": "...", "sourceLayer": "projects_30" },
    { "id": "approvals-maharashtra", "type": "vector", "url": "...", "sourceLayer": "projects_27", "stylePreset": "highlighted" },
    { "id": "approvals-karnataka",   "type": "vector", "url": "...", "sourceLayer": "projects_29", "style": { "line-width": 6 } }
  ]
}
```

Goa renders with the atlas defaults, Maharashtra with the `highlighted` preset on top of the defaults, and Karnataka with the defaults plus a per-layer `line-width` override.

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
- `onClick` — name of a handler function exported from `config/{atlas}.js`'s `handlers` object. Called as `handler({ feature, layerId, layerConfig, map, lngLat })` and must return an HTML string (may include `<script>` tags, which are extracted and executed) appended into the popup. See `config/goa.js` (`getBhunakshaInfo`) and `config/mapillary.js` (`openMapillaryViewer`) for examples.

#### Multi-pass style variants

A `style` object may contain prefixed keys of the form `<variant>/<property>` (e.g. `"overlay/line-width": 2`). Each unique prefix creates an **additional map layer** from the same source — useful for multi-pass cartography like cased roads or shadow + halo text.

- **Supported on**: `vector`, `geojson`, `csv` (any type that renders its `style` via the GL paint/layout pipeline).
- **Sharing**: all variants share one source, one `filter`, one `sourceLayer`, and the same `minzoom`/`maxzoom`.
- **Defaults**: only the base (unprefixed) variant inherits from `_defaults.json`. Secondary variants render exactly the properties you supply.
- **Render order**: variants are rendered in the **reverse** of the order their keys are encountered, so the variant whose last key appears earliest in the JSON ends up **on top**. A simple way to read it: in the JSON, write the topmost layer first.

Example — a cased line (white centerline over a purple casing):

```json
{
  "id": "admin-boundaries",
  "type": "vector",
  "sourceLayer": "admin",
  "style": {
    "overlay/line-color": "white",
    "overlay/line-width": 2,
    "line-color": "purple",
    "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4, 10, 8]
  }
}
```

This produces two line layers from the single `admin` source-layer: the wider purple line is added first (bottom), then the narrower white `overlay` line on top. Toggling the layer in the UI shows/hides both passes together.

#### Custom Cartography

A layer's `style` object is merged on top of the per-type defaults in [`config/_defaults.json`](../config/_defaults.json) → `layer.style.<type>`. Only the keys you set are overridden — everything else (hover/selected feature-state, zoom interpolations, text halos, circle strokes) is inherited. Set a property to `null` to remove an inherited default entirely.

The defaults define behavior for three feature states that you should preserve when overriding paints:

- **`hover`** — set on the feature the cursor is over.
- **`selected`** — set on features picked via click or the `?selected=` URL parameter.
- Neither state — the resting style.

If you write a flat `"fill-color": "crimson"`, you lose the yellow hover/selected highlight that ships in `_defaults.json`. To keep interactivity, wrap your color in the same `case` pattern the defaults use:

```json
"fill-color": [
  "case",
  ["boolean", ["feature-state", "selected"], false], "rgba(255, 255, 0, 0.5)",
  ["boolean", ["feature-state", "hover"], false],    "rgba(255, 255, 0, 0.8)",
  "crimson"
]
```

##### Targeting fill styles by geometry type (mixed line + polygon layers)

When a single source carries both `LineString` and `Polygon` features (common in OSM, cadastral, and Overpass data), an unconditional `fill-color` paints a colored rectangle behind every linear feature's bounding box. Gate the fill on `geometry-type` so it only renders on polygons, and drop opacity to `0` on everything else:

```json
"style": {
  "fill-color": [
    "case",
    ["==", ["geometry-type"], "Polygon"], "crimson",
    "transparent"
  ],
  "fill-opacity": [
    "case",
    ["==", ["geometry-type"], "Polygon"], 0.1,
    0
  ],
  "line-color": "crimson",
  "line-width": 2
}
```

Lines render through the `line-*` paint properties as usual; the geometry-type guard only suppresses the spurious polygon fill on linear features.

##### Common style recipes

- **Choropleth fill** — drive `fill-color` off a property with `interpolate` or `step`:
  ```json
  "fill-color": ["interpolate", ["linear"], ["get", "population"],
    0, "#fee5d9", 10000, "#fcae91", 100000, "#fb6a4a", 1000000, "#a50f15"]
  ```
- **Data-driven circle radius** (CSV / point GeoJSON):
  ```json
  "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 16, 12],
  "circle-color": ["case", [">", ["get", "Capacity"], 500], "#e11d48", "#3887be"]
  ```
- **Labels from a property** — override just the text field, keep the default halo/size cascade:
  ```json
  "text-field": ["to-string", ["get", "survey_no"]]
  ```
- **Remove a default** — pass `null` to drop an inherited property entirely:
  ```json
  "text-halo-color": null
  ```

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
| `timeProperty` | Name of a numeric (epoch ms) feature property. When set, the [`TimeControl`](#adding-a-new-url-parameter) clock control filters the layer client-side to `<= ` the control's selected date via `map.setFilter` — features are hidden once their `timeProperty` value is after the selected date. Unlike `urlTimeParam` (below), no tiles are re-requested. See `config/mapillary.atlas.json`'s `mapillary-coverage` layer (`timeProperty: "captured_at"`). |

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

### `js` — Custom JS data-mapping function

Fetches from an arbitrary API `url` and hands the raw response to an atlas-defined JavaScript function that gathers/paginates/transforms it into GeoJSON. Use this for API shapes that aren't plain GeoJSON, CSV, or a paginated feed `geojson`/`overpass` can't already handle. Once transformed, the layer renders through the same pipeline as a `geojson` layer — `style`, `inspect`, `clustered`, and `opacity` all work identically.

The data function lives in the atlas's own `config/{atlas}.js` file (e.g. `config/goa.js`), exported as `dataFunctions`, keyed by the layer's `id` (or `dataFunction` if that's set) — the same file/convention used by `inspect.onClick` handlers, just a different export. This keeps arbitrary fetch/parse code out of `mapbox-api.js` and scoped to the atlas that needs it.

| Field | Notes |
|---|---|
| `url` | API endpoint passed to the data function. **Required.** |
| `id` | Also used as the default lookup key into `dataFunctions` unless `dataFunction` is set. **Required.** |
| `dataFunction` | Name of the exported `dataFunctions` key to use, if different from `id`. |
| `refresh` | Polling interval in milliseconds — re-runs the data function and updates the source. Same semantics as `geojson`'s `refresh`. |
| `style`, `inspect`, `clustered`, `clusterMaxZoom`, `clusterRadius`, `opacity` | Same semantics as the `geojson` type. |

```json
{
  "id": "aqi",
  "type": "js",
  "title": "Air Quality",
  "url": "https://backend.aqionline.in/api/devices?page=1&limit=50",
  "refresh": 300000,
  "attribution": "<a href='https://aqionline.in'>AQI Online</a>",
  "style": {
    "circle-radius": 5,
    "circle-color": "#4c7fff"
  },
  "inspect": { "id": "device_id", "title": "AQI Monitoring Station", "label": "device_id", "fields": ["aqi", "pm25", "pm10"] }
}
```

The matching function in `config/goa.js`:

```javascript
export const dataFunctions = {
  aqi: async ({ url }) => {
    // Paginate through `url`, gather results, and return a
    // GeoJSON FeatureCollection built from the response.
    // See config/goa.js for the full implementation.
  }
};
```

**Function signature:** `async ({ url, config, layerId }) => geoJsonOrGeometryLikeObject`. The return value is passed through the same normalizer used by `geojson`/`data` (`FeatureCollection`, a single `Feature`, or a bare geometry are all accepted).

**Notes:**
- Resolution happens via `js/inspection-handler-loader.js`'s `loadDataFunctions()`, which dynamically imports `config/{atlas}.js` — the same loader and file used for `inspect.onClick` handlers (`handlers` export vs. `dataFunctions` export).
- The atlas is resolved from the layer's `_sourceAtlas` (set by the layer registry when the config is loaded), so a `js` layer only works within an atlas that has a matching `config/{atlas}.js` module — there is no cross-atlas fallback.
- Errors thrown by the data function are caught and logged to the console; the layer simply fails to load rather than crashing the map.

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
| `saveUrl` | Deployed Google Apps Script web app URL (`…/exec`). Enables the inline **Comment** box in the marker popup, which appends a row (`latitude`, `longitude`, `notes`/`Notes`, `timestamp`/`Timestamp`, plus `atlas`/`layers` for map context) to the underlying Google Sheet for a new note, or updates that row's `notes` column in place when editing an existing one. See **Writing notes back to a Google Sheet** below. |

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

#### Writing notes back to a Google Sheet

A `csv` layer backed by a Google Sheet can opt into the inline **Comment** box that leads every marker popup while the layer is active: click any point, write a note, and **Save** appends a row to the sheet with `latitude`, `longitude`, `notes`, and `timestamp` columns, plus `atlas` and `layers` capturing the map context (the live `?atlas` and `?layers` URL parameters) when the note was added. Clicking an *existing* note prefills the same box for editing — saving it there updates that row's `notes` column in place instead of appending a duplicate, since a note's `latitude` + `longitude` + `timestamp` are unique together and identify the row to update.

Writes go through a small **Google Apps Script web app** that you deploy on your own sheet — there is no shared backend and **no end-user sign-in**. The deployed script runs as *you* (the sheet owner) and appends/updates the row, so any visitor can add or edit a note without authenticating and without an "unverified app" warning. Each sheet has its own script URL, configured per-layer as `saveUrl`.

The browser only needs the `saveUrl`; column mapping and the append/update happen inside the script. The script targets the tab matching the layer URL's `gid` (falling back to the active sheet) and maps values onto columns by header name, case-insensitively: `latitude`/`lat`, `longitude`/`lng`/`lon`, `notes`/`note`/`comment`, `timestamp`/`time`/`date`, `atlas`, `layers`. If the sheet is missing a column for any of these fields, the script adds a labelled header column for it on the first write, so nothing is silently dropped. A request editing an existing note sends `action: "update"` with a `match` object (`{ latitude, longitude, timestamp }`) instead of fresh `latitude`/`longitude`/`timestamp` values; the script scans existing rows for that exact match and overwrites just the `notes` cell, returning an error if no row matches.

**Step 1 — Add the script to your sheet.** Open your Google Sheet → **Extensions → Apps Script**, delete the placeholder, and paste:

```javascript
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Target the tab matching the layer's gid; fall back to the active sheet.
    var sheet = null;
    if (data.gid !== undefined && data.gid !== '') {
      var sheets = ss.getSheets();
      for (var i = 0; i < sheets.length; i++) {
        if (String(sheets[i].getSheetId()) === String(data.gid)) { sheet = sheets[i]; break; }
      }
    }
    if (!sheet) sheet = ss.getActiveSheet();

    var aliases = {
      latitude:  ['latitude', 'lat'],
      longitude: ['longitude', 'lng', 'lon', 'long'],
      notes:     ['notes', 'note', 'comment', 'comments', 'description'],
      timestamp: ['timestamp', 'time', 'date', 'datetime', 'created'],
      atlas:     ['atlas'],
      layers:    ['layers', 'layer']
    };

    var lastCol = sheet.getLastColumn();
    var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var placed = {};
    var colOf = {};
    headers.forEach(function (h, i) {
      var key = String(h).trim().toLowerCase();
      for (var field in aliases) {
        if (!placed[field] && aliases[field].indexOf(key) !== -1) {
          colOf[field] = i;
          placed[field] = true;
          break;
        }
      }
    });

    // Add a labelled header column for any required field the sheet is missing.
    var added = false;
    for (var field in aliases) {
      if (!placed[field]) {
        headers.push(field);
        colOf[field] = headers.length - 1;
        placed[field] = true;
        added = true;
      }
    }
    if (added) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    // Editing an existing note: latitude+longitude+timestamp are unique per
    // note, so `match` identifies the row to update in place instead of
    // appending a duplicate.
    if (data.action === 'update' && data.match) {
      var lastRow = sheet.getLastRow();
      var matchRow = -1;
      if (lastRow > 1) {
        var body = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
        for (var r = 0; r < body.length; r++) {
          if (String(body[r][colOf.latitude]) === String(data.match.latitude) &&
              String(body[r][colOf.longitude]) === String(data.match.longitude) &&
              String(body[r][colOf.timestamp]) === String(data.match.timestamp)) {
            matchRow = r + 2; // +1 for the header row, +1 for 1-based row numbers
            break;
          }
        }
      }

      if (matchRow === -1) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Matching note not found' }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      sheet.getRange(matchRow, colOf.notes + 1).setValue(data.notes != null ? data.notes : '');
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var row = new Array(headers.length).fill('');
    for (var field in aliases) {
      row[colOf[field]] = data[field] != null ? data[field] : '';
    }

    sheet.appendRow(row);
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

**Step 2 — Deploy it.** In the Apps Script editor: **Deploy → New deployment → ⚙ → Web app**.
- **Execute as:** *Me*
- **Who has access:** *Anyone* — **not** "Anyone with Google account" (that forces sign-in and returns `401`/CORS errors to the browser).
- **Deploy**, approve the one-time authorization prompt (this is you authorizing your *own* script — visitors never see it), and copy the **Web app URL** (ends in `/exec`).

Then verify it's public: open the `/exec` URL in an **incognito** tab. It should return `{"status":"ok"}` (from `doGet`). If you get a Google sign-in page instead, the access setting is wrong.

> Editing the script later requires **Deploy → Manage deployments → Edit → New version** for changes to take effect. The `/exec` URL stays the same.
>
> If the `/exec` URL still forces login after setting "Anyone", the owner is likely a **Google Workspace** account whose admin blocks public web apps — use a personal `@gmail.com` account or have the admin allow anonymous web-app publishing.

**Step 3 — Add `saveUrl` to your layer.** Keep `url` as the read-only CSV export and add `saveUrl`:

```json
{
  "id": "community-notes",
  "type": "csv",
  "title": "Community Notes",
  "url": "https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<gid>",
  "saveUrl": "https://script.google.com/macros/s/AKfyc.../exec",
  "inspect": { "fields": ["notes", "timestamp"], "fieldTitles": ["Notes", "Time"] }
}
```

Ideally your sheet has a header row with `latitude`, `longitude`, `notes`, `timestamp`, `atlas`, and `layers` columns, but you don't have to create them — the script adds any missing column (labelled with the field name) on the first write. After a successful save the layer refreshes (~2s) so the new point appears — note Google's CSV export can lag a few seconds behind the edit.

The client side is implemented in `js/google-sheets-writer.js`'s `saveRow()`; the popup UI lives in `js/map-marker-manager.js`. Without `saveUrl`, a sheet layer stays read-only and the comment box's **Save** action reports that the layer is read-only.

> Already have a `doPost` deployed from before this update-in-place matching was added? It only ever appends, so editing an existing note there creates a duplicate row rather than updating it. Paste the script above into **Extensions → Apps Script**, then **Deploy → Manage deployments → Edit → New version** to pick up the fix — the `/exec` URL stays the same.

### `sheet` — Google Sheet, every tab combined

Like `csv`, but instead of one tab's export URL, `url` is just the spreadsheet itself — every tab is discovered and fetched, and their rows are merged client-side into a single layer. Useful when related data is split across tabs (e.g. one per taluka/region) that should render as one map layer.

Google's CSV export (`/export?format=csv&gid=<gid>`) only ever returns a single tab — there is no spreadsheet URL that returns every tab combined. A `sheet` layer instead: lists every tab by scraping the spreadsheet's public `/htmlview` page (name + `gid` per tab, no publish-to-web or API key needed — just "Anyone with the link can view"), fetches each tab's CSV separately, and concatenates the rows. Each row gets a `$sheet` field naming its source tab — the same auto-generated, `$`-prefixed convention as `$row`/`$table` (see `DataUtils.parseCSV` in `js/map-utils.js`), not a real column from the sheet — and its `$row` id is prefixed with the tab's `gid`, so ids stay unique across tabs. The merge happens **on every layer load** (and again on each `refresh` tick) — it is not a one-time snapshot, so edits to any tab show up on next load like a normal `csv` layer.

This is the live equivalent of `map-creator.html`'s "All Sheets (combined)" option, which does the same fetch-and-merge but bakes the result into a static `localStorage` snapshot at layer-creation time instead of re-fetching on every load — see `js/map-creator.js`. Both share the fetch/merge implementation in `js/google-sheets-api.js`.

| Field | Notes |
|---|---|
| `url` | Any URL containing `docs.google.com/spreadsheets/d/<id>/...` — the spreadsheet's `/edit` link works as-is. A `gid` in the URL, if present, is **ignored** since every tab is merged. **Required.** |
| `refresh` | Polling interval in milliseconds. Each tick re-fetches and re-merges **every** tab, so keep this well above the single-tab default if the sheet has many tabs. |
| `style` | Mapbox circle/symbol properties (same as `csv`/GeoJSON). |
| `inspect` | Popup configuration. |

```json
{
  "id": "field-survey",
  "type": "sheet",
  "title": "Field Survey (All Tabs)",
  "url": "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit",
  "style": {
    "circle-radius": 5,
    "circle-color": "#3b82f6"
  },
  "inspect": {
    "fields": ["$sheet", "Status"]
  }
}
```

**Notes:**
- **No `saveUrl`.** Write-back needs one target tab (see `csv`'s **Writing notes back to a Google Sheet** above); a merged `sheet` layer has no single tab to append to, so the Add Note button stays unavailable regardless of `saveUrl`.
- **Cost scales with tab count.** Loading (or refreshing) fetches every tab, one request each — fine for a handful of tabs, less so for dozens. If you only need one tab, use `csv` with an explicit `&gid=<gid>` instead; it's a single request.
- Renders through the same pipeline as `csv` (same `csv-${id}` source, same style/inspect semantics) — everything documented above under `csv` besides `saveUrl` and its single-tab `url` applies here too.
- A tab that fails to fetch is skipped (logged to the console) rather than failing the whole layer.

### `overpass` — OpenStreetMap Overpass API

Live OSM data fetched from an [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) endpoint using a user-supplied Overpass QL query. The response is converted to GeoJSON via [`osmtogeojson`](https://github.com/tyrasd/osmtogeojson) (loaded as ESM from jsdelivr) and rendered through the standard GeoJSON pipeline — so `style`, `inspect`, `clustered`, and `opacity` work identically to a `geojson` layer.

The layer refetches on map `moveend` (debounced 750ms). A bbox-containment cache skips the network call when the current viewport already lies inside a previously-fetched (buffered) bbox, and merges results across fetches deduped by OSM ID, so panning around the same area is free.

`feature.id` is set by `osmtogeojson` to the canonical `"node/123"` / `"way/456"` / `"relation/789"` form, which works directly with `?selected=<layerId>:<featureId>` deep links. `inspect.id` defaults to `"id"` if not set. Every feature also gets a synthetic `$url` property (same `$`-prefixed convention as `csv`/`sheet`'s `$row`/`$table`/`$sheet` — not real OSM data) linking to that feature's own page on openstreetmap.org.

Below `minzoom`, the layer stops auto-refreshing (to avoid expensive worldwide queries) and shows a dismissible message with a manual "Refresh" link instead of silently doing nothing — click it to fetch the current viewport once regardless of zoom.

`style`'s paint properties are filtered by the geometry types actually present in each fetch — same logic as the `osm:` dynamic layer shorthand (see `OSMApi.mergeStyleForGeometryTypes` in `js/osm-url-api.js`). A `fill-color` in `style` only takes effect once the result contains a Polygon/MultiPolygon feature, `circle-*` only once it contains a Point, and so on — so a style written without knowing the query's exact geometry mix (e.g. a `power=line` query that's almost entirely LineStrings) can't paint a fill/circle layer with nothing to draw. Because of this, paint layers are created lazily on the first batch of data rather than at layer-add time.

| Field | Notes |
|---|---|
| `query` | Overpass QL query. **Required.** Supports placeholders `{{bbox}}` (south,west,north,east — Overpass order), `{{center}}` (lat,lng), `{{zoom}}`. If the query does not begin with a setting block (`[...]`), `[out:json][timeout:N];` is auto-prepended. If you write your own settings block, **you must include `[out:json]`** — other output formats cannot be parsed. |
| `endpoint` | Overpass API endpoint. Default: `https://overpass-api.de/api/interpreter`. Use a mirror (e.g. `https://overpass.kumi.systems/api/interpreter`) or self-hosted instance for higher rate limits. |
| `minzoom` | Below this zoom, the layer doesn't auto-fetch (see above — the user can still manually refresh). Use to avoid expensive worldwide queries. Recommended ≥ 12 for point queries, ≥ 10 for areas. |
| `bboxBuffer` | Multiplier applied to the viewport bbox before fetching, so small pans don't trigger refetches. Default `1.5` (50% extra on each axis). |
| `timeout` | Overpass `[timeout:N]` seconds, used only when the header is auto-prepended. Default `25`. |
| `maxFeatures` | Hard cap on features kept from a single response. Default `5000`. Excess features are dropped with a console warning. |
| `debounce` | Milliseconds to wait after `moveend` before issuing a fetch. Default `750`. |
| `style`, `inspect`, `clustered`, `attribution` | Same semantics as the `geojson` type, except `style` is geometry-filtered as described above. |

```json
{
  "id": "osm-cafes",
  "type": "overpass",
  "title": "Cafés (OSM)",
  "query": "nwr[\"amenity\"=\"cafe\"]({{bbox}}); out geom;",
  "minzoom": 13,
  "attribution": "© OpenStreetMap contributors (via Overpass API)",
  "style": {
    "circle-color": "#e11d48",
    "circle-radius": 5,
    "circle-stroke-color": "#fff",
    "circle-stroke-width": 1
  },
  "inspect": {
    "id": "id",
    "title": "Café",
    "label": "name",
    "fields": ["cuisine", "opening_hours", "website"]
  }
}
```

**Notes:**
- Overpass is shared infrastructure with strict rate limits. Pick a high `minzoom` and a narrow query (specific tags + bbox) before deploying.
- The default endpoint supports CORS; no proxy is needed.
- HTTP errors and timeouts are logged to the console; the layer keeps any features already loaded.

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
| `js/map-feature-control-iframe.js` | Calls `window.urlManager.updateURL({ updateSelections: true, updateLayers: true })` after feature selections change. Calls `window.urlManager.updateCompareParam()` when swipe-comparison is toggled. Contains the map click handler that `applyLocationClickFromURL()` fires into. |
| `js/map-layer-controls.js` | Calls `window.urlManager.onLayersChanged()` when layer visibility or opacity changes. |
| `js/dynamic-layer-shorthand.js` | Parses and expands the `type:id` dynamic layer shortcuts (see [Dynamic layer shortcuts](#dynamic-layer-shortcuts)), dispatching to the matching service module. `parseDynamicLayerShorthandString()` is called from `map-utils.js` and `url-manager.js` while splitting `?layers=`; `isDynamicLayerShorthand()`/`expandDynamicLayerShorthand()` are called from `map-init.js`'s per-layer loop in `loadConfiguration()`. |
| `js/allmaps-url-api.js`, `js/mapwarper-url-api.js`, `js/osm-url-api.js` | One module per external service backing the dynamic layer shortcuts — each resolves an ID/URL into a full layer config via that service's API. Also used directly by `map-creator.js` to auto-fill a layer from a pasted full URL. |

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
  → url-manager.js applyURLParameters(): applies terrain, geolocate, q, selected, compare, zoomTo
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

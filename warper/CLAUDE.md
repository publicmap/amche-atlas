# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Amche Warper is a client-side georeferencing tool for aligning historical maps with modern satellite imagery. It integrates with [MapWarper](https://mapwarper.net) and [warper.wmflabs.org](https://warper.wmflabs.org) to load, edit, and push ground control points (GCPs).

No build step — this is a static HTML/JS application served directly. The parent project's dev server (`npm start` from `../`) serves this at `http://localhost:4035/warper/`.

## Architecture

**All application logic lives in `index.html`** (~3,300 lines). There is no module bundler; JS files are loaded as `<script>` tags. External dependencies come from CDN (Mapbox GL JS v3, jQuery, DataTables, Tailwind CSS).

### Module Files

- `mapwarper-api.js` — REST client for MapWarper servers. Exports a singleton `window.mapwarperAPI`. Handles auth (email/password + OAuth popup), map/layer metadata fetching, and GCP CRUD. Auth state persisted in `localStorage`.
- `dataTable.js` — "Map List" modal: a jQuery DataTables table of every mapwarper.net / warper.wmflabs.org map or mosaic referenced by the atlases listed in `../config/index.atlas.json` (matched from each layer's `url`, else its `attribution`).
- `local-georef.js` — a dropped browser-readable image (PNG/JPEG/GIF/WebP) is aligned in the browser before anything is uploaded. Starting unloads the current Mapwarper map (`unloadMapwarperMap()`), closing reloads the URL in the input (`reloadMapwarperUrl()`). Two modes, switched in its panel (`local-georef-panel.js`, at the top of the right controls column, above the undo/redo buttons):
  - **Box** (`body.local-bbox`, reference map full width): the image is a Mapbox `image` source over a box `{cx, cy, w, h, angle}` in Mercator units, plus an anchor `{ax, ay}` (box-local, -1..1, default centre). Handles: corners and edges resize with the opposite side fixed, or around the anchor with Alt (Shift keeps proportions); the top handle and invisible zones just outside each corner rotate around the anchor (Shift snaps 15°); the crosshair is the anchor (drag to move, snaps to corners/edges/centre, double-click resets). Dragging inside the image moves it (`local-georef-drag.js`); outside pans the map. Geometry is in `local-georef-box.js`. Point clicks are ignored (`pointEditingEnabled()`).
  - **Control points** (`body.local-points`, split screen; `local-points.js`): the image is shown on the source map in the same fake-geo space as Mapwarper maps (`imageTransform`), so the normal point tools, table and linked maps apply. Points start as the box corners; with 3+ points an affine fit (pixel → Mercator) previews the image on the reference map. Switching back to Box stashes the points.
  Export GeoTIFF writes EPSG:3857 (`geotiff-writer.js`: uncompressed RGBA; ModelTiepoint + ModelPixelScale when north-up, else ModelTransformation). Save to Mapwarper opens the upload form with the file and the mode's control points (pixel x/y from the top-left).
- `edit-history.js` — undo / redo (`window.editHistory`) for the image box and control points: callers `record(target, label)` before a change, where a target has `snapshot()`, `restore(state)` and `isActive()` (only active targets are undone). Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y outside text fields and modals; buttons via `mount(host)` in the controls panel.
- `upload-map.js` — the "Upload" button (after Load), and a dropped TIFF or a file dropped onto the open form, open a new-map form mirroring mapwarper's `/maps/new`; submits via `mapwarperAPI.createMap()` (`POST /api/v1/maps`, multipart `data[attributes][upload]` for a file — mapwarper's Paperclip 5.3 has no data URI adapter, so base64 uploads 500 — or JSON:API with a remote `upload_url`) to the logged-in server, then loads the new map. When it was opened from `local-georef.js`, a checkbox (on by default) adds its control points as GCPs after the map is created and, with 3 or more, warps it (`mapwarperAPI.warpAndWait()`, shared with the Save button). The API does not accept published/reprint dates or visibility, so those are left out.
- `navbar.js` — Reusable navbar component; auto-initializes on DOM load.

### Dual-Map System

Two independent Mapbox GL instances run side by side:
- **Source map** (left, 40%): Displays the historical map via WMS tiles
- **Reference map** (center, 40%): Mapbox satellite imagery with overlay layers

The source map has no real geographic data — historical map pixels are projected into a "fake geographic" coordinate space: `pixelToFakeGeo = 5 / maxDimension` (keeps coordinates within ±2.5° where Mercator distortion is <0.4%). The `transformRequest` callback intercepts tile requests and converts Mapbox tile z/x/y → pixel BBOX → WMS GetMap URLs.

**Linked movement**: once 3+ complete, non-collinear control points exist, `refreshMapSync()` fits an affine transform between the two maps (in Web Mercator units) and `syncMaps()` moves the other map to match whichever map the pointer is over (center via the affine, zoom via its scale). The lock button on the seam between the maps (`toggleMapLock()`) unlinks them for manual repositioning; linked is the default.

### Control Points

GCPs are stored as objects: `{ id, rowNumber, sourcePixelCoords, sourceCoords, referenceCoords }`. Adding a point requires double-clicking on both maps (one per map, matched by `pendingPoint` state). Points render as Mapbox markers and connecting lines. The CSV export format is `x, y, lon, lat` (pixel coords + geographic coords).

### Mode System

- **Add mode** (key `1`): double-click adds new control points
- **Move mode** (key `2`): click selects a point for dragging
- **Pan mode** (key `3`): default navigation

### View Modes

- **map mode**: Default georeferencing view with dual maps
- **layer mode**: Mosaic/collection browser — reference map fills the viewport, right panel lists maps in the collection with bounding boxes rendered on the map

### MapWarper URL Parsing

`parseMapwarperUrl()` accepts URLs in these forms:
- `https://mapwarper.net/maps/12345`
- `https://mapwarper.net/layers/678`
- `?map_id=12345&base_url=https://mapwarper.net`

Routes to `loadMapWarperMap()` which dispatches to either map or layer view.

### Reference Layers (Reference Map)

Three toggleable overlays on the reference map:
- Village boundaries — vector tiles from `indianopenmaps.fly.dev`
- Cadastral plot boundaries — vector tiles from `indianopenmaps.fly.dev`  
- Local body boundaries — Mapbox tileset `planemad.2bqa1pq1`

## Key Constraints

- The `imageTransform` object (built from map width/height) must be initialized before any pixel↔geo conversion. It is set when map metadata loads from the API.
- OAuth login opens a popup window and communicates back via `postMessage`. The popup URL is served by the MapWarper server itself.
- `mapwarperAPI.replaceGCPs()` deletes all existing GCPs then re-adds them in batch — it is not incremental.

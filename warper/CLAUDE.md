# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Amche Warper is a client-side georeferencing tool for aligning historical maps with modern satellite imagery. It integrates with [MapWarper](https://mapwarper.net) and [warper.wmflabs.org](https://warper.wmflabs.org) to load, edit, and push ground control points (GCPs).

No build step — this is a static HTML/JS application served directly. The parent project's dev server (`npm start` from `../`) serves this at `http://localhost:4035/warper/`.

## Architecture

**All application logic lives in `index.html`** (~3,300 lines). There is no module bundler; JS files are loaded as `<script>` tags. External dependencies come from CDN (Mapbox GL JS v3, jQuery, DataTables, Tailwind CSS).

### Module Files

- `mapwarper-api.js` — REST client for MapWarper servers. Exports a singleton `window.mapwarperAPI`. Handles auth (email/password + OAuth popup), map/layer metadata fetching, and GCP CRUD. Auth state persisted in `localStorage`.
- `dataTable.js` — Modal component for browsing map collections from CSV (Google Sheets) sources. Uses jQuery DataTables.
- `navbar.js` — Reusable navbar component; auto-initializes on DOM load.

### Dual-Map System

Two independent Mapbox GL instances run side by side:
- **Source map** (left, 40%): Displays the historical map via WMS tiles
- **Reference map** (center, 40%): Mapbox satellite imagery with overlay layers

The source map has no real geographic data — historical map pixels are projected into a "fake geographic" coordinate space: `pixelToFakeGeo = 5 / maxDimension` (keeps coordinates within ±2.5° where Mercator distortion is <0.4%). The `transformRequest` callback intercepts tile requests and converts Mapbox tile z/x/y → pixel BBOX → WMS GetMap URLs.

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

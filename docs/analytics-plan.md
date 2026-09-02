# amche-atlas Analytics Plan (GA4)

Goal: understand which features and data layers users actually use, so iteration effort goes where it matters. Property: `G-FBVGZ4HJV0` (already live on index.html, pageviews only today).

## Current state

- GA4 base tag loads only on `index.html`, and only when `hostname === amche.in` (`js/index.js`). The other 12 entry points (bus, game, timelapse, warper, map-*, pages/*) send nothing.
- Zero custom events — no visibility into layer usage, search, share, or export.
- `sound/` has its own Firebase measurement ID (`G-VPDTDN640G`); left untouched.

## Architecture

One new module, `js/analytics.js`:

- `initAnalytics()` — injects the gtag loader (prod hostname only). Replaces the inline copy in `js/index.js`. Included by every HTML entry point so all sub-apps report pageviews.
- `trackEvent(name, params)` — safe wrapper: no-ops if gtag absent, console-logs events on localhost so instrumentation is verifiable without GA access. All instrumentation goes through this; never call `gtag()` directly.

## Event taxonomy (phase 1: main map)

| Event | Params | Trigger | Source file |
|---|---|---|---|
| `layer_toggle` | `layer_id`, `visible` | User toggles a layer group (NOT initial page load) | `map-layer-controls.js` |
| `search_select` | `search_type` (place/cadastral), `result_name` | User picks a search result | `map-search-control.js` |
| `feature_inspect` | `layer_id` | Feature popup opened via map click | `map-feature-state-manager.js` |
| `share_action` | `method` | Share/copy-link button used | share control |
| `map_export` | `export_type` (geojson/style/image/pdf) | Export executed | `map-export-control.js` |
| `geolocate` | `status` (success/error) | Geolocation resolves | `geolocation-watch.js` |
| `measure_use` | — | Measure tool activated | `map-measure-control.js` |
| `terrain_3d_toggle` | `enabled` | 3D terrain toggled | `terrain-3d-control.js` |
| `atlas_load` | `atlas_id` | Map config loaded at init | `index.js` / `config-manager.js` |
| `permalink_resolve` | `permalink_id` | Inbound `?p=` permalink redirect | `permalink-manager.js` |

Conventions: snake_case names ≤40 chars, param values ≤100 chars, no PII — never send raw user queries, plot numbers, or coordinates; only names/ids of public layers and places.

**Highest-value signal:** `layer_toggle` with `layer_id`. This alone answers "which of the curated layers do people actually use" — the core iteration question.

## Phase 2 (later, separate PRs)

- Sub-app events (bus route lookups, game plays, timelapse usage) once the pageview split shows where traffic is.
- Arrival context: which URL-API params sessions land with (`url-api-params.js`).

## GA4 console setup (manual, one-time)

1. Admin → Custom definitions → create event-scoped custom dimensions: `layer_id`, `visible`, `search_type`, `export_type`, `method`, `status`, `atlas_id`, `permalink_id`, `result_name`, `enabled`. Without this, params are collected but invisible in standard reports.
2. Wait ~24h after first events, then build a free-form Exploration: event name × layer_id.
3. Optional: mark `share_action` and `map_export` as key events (proxies for "user got value").

## Verification

1. `npm start` → localhost: events print to console (gtag doesn't load off-prod, debug path does).
2. Push to `dev` branch → amche.in/dev. Caveat: hostname there is still amche.in, so GA loads and dev traffic lands in prod data. analytics.js sends `debug_mode: true` when the path starts with `/dev`, so it appears in DebugView and can be filtered.
3. GA4 DebugView while clicking through layers/search/export.

## Privacy

`privacy.html` updated to disclose GA4 and that interaction events contain feature/layer names, not personal data. Civic-tech audience: keep this honest and specific.

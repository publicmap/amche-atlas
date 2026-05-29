# Prompt: Build an atlas from vector tile endpoints

Use this prompt when you have a set of vector tile (`.pbf` / `.mvt`) endpoints — typically one per region (state, district, country) — and want to expose them as a single themed atlas with consistent styling and a feature inspector.

## Reference

- Atlas JSON schema and all layer source formats: https://github.com/publicmap/amche-atlas/blob/main/docs/API.md
- Defaults applied to every atlas: https://github.com/publicmap/amche-atlas/blob/main/config/_defaults.json
- A complete worked output for this prompt: https://github.com/publicmap/amche-atlas/blob/main/config/parivesh.atlas.json

## Template

Copy the block below into Claude Code, replacing the bracketed values with your data:

```
Build an amche.in atlas json to explore [WHAT] by [REGION GROUPING] using:
https://github.com/publicmap/amche-atlas/blob/main/docs/API.md

Save the result to config/[filename].atlas.json.

# Layer settings

## Data source
- layer list: [URL listing per-region tile endpoints, e.g. a GitHub release page]
- sourcelayer name format: `[pattern, e.g. projects_#]`
- features: [polygons | lines | points | mixed]
- data format: [pbf | mvt | geojson | tms | wms | wmts | cog | csv | img]

## Styling
- color: [css color]
- line-width: [number]
- fill-color: [css color]
- fill-opacity: [0-1]
- circle-color: [css color, optional]
- circle-radius: [number, optional]

## Inspect features
id: [property name used as unique feature id]
title: [property name shown as the inspector title]
label: [property name shown as the on-map label]
fields:
  [property name 1]
  [property name 2]
  ...

## Grouping (optional)
Group layers using the `tags` array. Tag prefixes like `1.North`, `2.Central`
sort the layer list in the UI.
```

## Notes for the LLM

When filling in the atlas, follow these conventions taken from existing atlases in `config/`:

1. **One layer per region**. Each entry has its own `id`, `title`, `url`, and `sourceLayer`. Do not collapse regions into a single layer.
2. **Atlas-level `style` and `inspect`** apply to all layers — define them once at the top, not per layer.
3. **Mixed geometry styling** — when features are a mix of polygons, lines and points, gate `fill-*` properties on `geometry-type == "Polygon"` with a `case` expression so points and lines do not get unwanted fill. See `parivesh.atlas.json` for the exact pattern.
4. **`maxzoom`** — vector tiles typically have a max source zoom (often 14–17). Set it explicitly on each layer so the renderer overzooms cleanly.
5. **`attribution`** — include the upstream data publisher and any community that processed the data.
6. **`initiallyChecked: true`** on at most one layer (usually the home region) so the atlas opens with something visible.
7. **`map.bounds` and `map.center`** — pick bounds that cover all regions and a center inside them.

## Worked example

Input prompt:

```
Build an amche.in atlas json to explore all the environmental approvals in India by state using:
https://github.com/publicmap/amche-atlas/blob/main/docs/API.md

# Layer settings

## Data source
- layer list: https://github.com/ramSeraph/india-environmental-approvals/releases/tag/datasets-2026-05
- sourcelayer name format: `projects_#`
- features: mixed polygons, lines and points
- data format: pbf - vector tiles

## Styling
- color: crimson
- line-width: 4
- fill-color: crimson
- fill-opacity: 0.1

## Inspect features
id: Proposal Number
title: Organization Name
label: Organization Name
fields:
  Project Category
  Project Name
  Project Description
```

Output: [`config/parivesh.atlas.json`](../../config/parivesh.atlas.json) — 35 layers grouped by region (North / Central / East / Northeast / West / South) with a single shared `style` block that handles mixed geometry types.

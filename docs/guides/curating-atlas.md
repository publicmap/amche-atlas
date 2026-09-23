# Curating a map atlas for your community

An "atlas" in amche.in is a named collection of layers, framed by its own basemap, center and zoom — Goa's cadastral atlas, a coastal-zone atlas, a disaster-management atlas. Curating one is mostly deciding which layers matter to your community and in what order they should stack.

## The three files that cascade

Every atlas is assembled from JSON in `config/`, applied in this order:

1. **`_defaults.json`** — base styling shared by every atlas and layer type.
2. **`index.atlas.json`** — the top-level configuration: available atlases, default basemap, area of interest.
3. **`<name>.atlas.json`** — your atlas: its own `layers` array, plus anything it wants to override from the first two.

Because later files only override what they explicitly set, a new atlas can reuse every existing layer definition and default style without repeating it.

## A minimal atlas

```json
{
  "name": "My Community Map",
  "color": "#2563eb",
  "map": { "center": [73.83, 15.49], "zoom": 12 },
  "layers": [
    { "id": "mapbox-streets", "initiallyChecked": true },
    { "id": "goa-plots" },
    { "id": "my-layer", "title": "My Data", "type": "geojson", "url": "https://example.com/data.geojson" }
  ]
}
```

`layers` entries can either reference a layer already defined elsewhere by `id`, or define a brand-new one inline the same way the URL API does — see [Adding your own data](?page=adding-data).

## Layer order

The first layer listed appears on top of the map; the last appears at the bottom. `initiallyChecked: true` marks which layers are visible the moment the atlas loads — everything else stays available in the layer list but off until someone turns it on.

## Publishing it

Add your `<name>.atlas.json` under `config/`, list its name in `index.atlas.json`'s `atlases` array, and open a pull request. Anyone can then load it directly with `?atlas=<name>`, or point `?atlas=` at a URL to try one hosted entirely outside this repository — see [Using the URL API](?page=url-api).

# Adding your own data

Amche Atlas is configuration-driven: every layer, from a government WMS service to a spreadsheet of well-being centres, is a JSON object describing where the data lives and how to draw it. You don't need to touch application code to add one.

## The quickest path: a layer in the URL

Any layer definition can be dropped straight into the `layers` URL parameter as inline JSON, without editing a config file at all:

```
https://amche.in/?layers={"id":"my-layer","type":"geojson","title":"My Data","url":"https://example.com/data.geojson"}
```

Reload the link and the layer renders immediately. This is the fastest way to try a dataset out, and to share it with someone else for review before it earns a permanent place in an atlas.

## Supported source types

A layer's `type` field picks how it's fetched and drawn:

| Type | Source |
|---|---|
| `geojson` | GeoJSON or KML, any URL |
| `csv` | A spreadsheet with lat/lng columns (auto-detected) |
| `vector` | Vector tiles (`.pbf`/`.mvt`) |
| `tms` | XYZ raster tiles |
| `wmts` / `wms` | OGC tile/map services |
| `cog` | A Cloud Optimized GeoTIFF, streamed via HTTP range requests |
| `img` | A single georeferenced image overlay |
| `style` | A layer already defined in the base Mapbox style |

The full field reference for every type, with worked examples, is the **Layer Source Formats** section of the [URL API reference](?page=url-api).

## Making it permanent

A layer tried out via the URL is temporary — reload without the parameter and it's gone. To keep it around for others, add the same JSON object to the `layers` array of an atlas config file under `config/*.atlas.json`, for example:

```json
{
  "id": "my-layer",
  "title": "My Data",
  "type": "geojson",
  "url": "https://example.com/data.geojson",
  "attribution": "<a href=\"https://example.com\">Source</a>"
}
```

Give it a `title`, `description` and `attribution` pointing back to the original publisher — amche.in mirrors data, it never re-hosts it as its own. See [Curating a map atlas for your community](?page=curating-atlas) for how layers, atlases and defaults fit together.

## Where data actually lives

amche.in doesn't host datasets. Vector tiles are mirrored on [IndianOpenMaps](https://indianopenmaps.fly.dev), scanned maps are georeferenced and served via [mapwarper.net](https://mapwarper.net), and GeoJSON commonly lives on a [GitHub Gist](https://gist.github.com) or [Maphub](https://www.maphub.co/). Point `url` at wherever your data already is; there's no upload step.

# Hosting your own atlas instance

There are two ways to put an Amche Atlas map on your own site. Start with the first one — most communities never need the second.

## Option 1: Embed amche.in in an iframe

No fork, no build step, no access token, no data to keep in sync. One HTML file on your own site, pointed at amche.in with the parameters that describe your map:

```html
<iframe
  src="https://amche.in/?atlas=osm&layers=osm-places,topo,mapbox-satellite#10.3/10.83/76.95"
  style="width:100%;height:100%;border:0"
  allow="geolocation; fullscreen; accelerometer; gyroscope; magnetometer"
  title="Community map"></iframe>
```

Because every part of the map's state — the atlas, the visible layers, language, terrain, camera — is a URL parameter, configuring your instance *is* configuring that URL. See [Using the URL API](?page=url-api) for the full set.

Two details matter in practice:

- **The `allow` list is required.** Permissions aren't inherited across a cross-origin iframe: without `geolocation` the embedded map can never find the visitor, and without the motion sensors the compass can't rotate the map with the device.
- **The embedded atlas talks back.** It posts `{ type: 'url', href }` to the parent window once the map has loaded and again after every map move. Listen for that and mirror it onto your own address bar, and links to your homepage become shareable deep links into the map.
- **Its share links point at you, not at amche.in.** The atlas works out that it's embedded and rebases the URLs it hands visitors — the share panel, the QR codes, printed exports — onto your page, keeping the parameters that describe the view. It uses the referrer by default; post `{ type: 'amche:embed', href: location.href }` into the frame to say so explicitly, which also survives a stripped referrer.

### Bring your own collection

Point `?atlas=` at a config file you host, and the map opens with your layers instead of amche.in's defaults — no fork of the application needed. If that config carries an `atlases` array, it curates the switcher too, so visitors are offered your short list rather than every atlas amche.in knows about:

```json
{
  "name": "OpenStreetMap India",
  "atlases": ["osm", "world", "mapbox"],
  "map": { "center": [76.9541, 10.8293], "zoom": 10.32 },
  "layers": [
    { "id": "osm-places", "initiallyChecked": true },
    { "id": "mapbox-satellite", "initiallyChecked": true }
  ]
}
```

Each id in `atlases` is looked for next to your own config first — publish `osm.atlas.json` alongside it and yours is used; leave it out and the embedded instance's own `osm` atlas fills in. So you override only what you actually want to change. A full URL instead of an id loads a collection hosted anywhere. Layer ids are `<atlas>-<layer>`. See [Curating a map atlas for your community](?page=curating-atlas).

Your config has to be reachable by the atlas's own origin, so serve it with `Access-Control-Allow-Origin` (GitHub Pages already does). One wrinkle while developing: a browser won't let `https://amche.in` read a config from `http://localhost`, so test against a deployed copy or an https tunnel rather than your local server.

### Working example

[A complete homepage that embeds a customized instance](embed-osm-india/), with its own hosted collection and both directions of URL syncing wired up — this implements the approach in [osm-in.github.io#90](https://github.com/osm-in/osm-in.github.io/issues/90). Two files, [both readable on GitHub](https://github.com/publicmap/amche-atlas/tree/main/docs/guides/embed-osm-india): an `index.html` whose `CONFIG` block is the only thing you need to change, and the `config/index.atlas.json` next to it that decides what the map holds.

## Option 2: Fork and host your own copy

Worth it when you want your own branding, your own domain serving the app itself, or code changes. Amche Atlas is a static site — Mapbox GL JS, jQuery and Shoelace, built with Vite — so this is a fork and a GitHub Pages toggle, not a server to maintain. [Goa Disaster Management Dashboard](https://github.com/alansaviolobo/dfes-dmp) is a fork built this way.

### 1. Fork and run locally

```
git clone git@github.com:<you>/amche-atlas.git
cd amche-atlas
npm install
npm start
```

`npm start` serves the app at `http://localhost:4035` with your local changes live. `npm run build` produces the static `dist/` folder that gets deployed.

### 2. Point it at your own area

Everything about what an instance shows lives in `config/`, not in code:

- Set your default basemap, center and zoom in `config/index.atlas.json`.
- Add or edit `config/<name>.atlas.json` files for the collections you want — see [Curating a map atlas for your community](?page=curating-atlas).
- Add your own layers, referencing data you host or mirror elsewhere — see [Adding your own data](?page=adding-data).

You need a [Mapbox access token](https://www.mapbox.com/) for the basemap; set it in `index.html`'s `window.amche.MAPBOXGL_ACCESS_TOKEN`. amche.in itself runs on a free token donated by OpenStreetMap India for not-for-profit community use — get your own for a production fork.

### 3. Deploy on GitHub Pages

Push to a branch and enable GitHub Pages on it in the repository settings — that's the whole deploy. This project's own convention:

- `main` deploys to the production URL.
- `dev` deploys to a `/dev` preview path, useful for testing changes live before merging: `git push origin HEAD:dev --force`.

Deploys typically take under a minute.

### 4. Custom domain (optional)

Add a `CNAME` file at the repository root with your domain, and point its DNS at GitHub Pages — the same as any GitHub Pages project. amche.in itself is one such custom domain.

### Staying in sync with upstream

Layer types, URL API parameters and core controls are shared across every instance. Pull upstream changes periodically to pick up new layer types and fixes, keeping your own `config/` and any custom layers as the only real divergence.

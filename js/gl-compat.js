/**
 * Bridges the config-selected renderer (window.amche.RENDERER, set in
 * index.html before this loads) onto the `mapboxgl` global the rest of the
 * app already calls. MapLibre GL JS is an API-compatible fork of Mapbox GL
 * JS - same Map/Marker/Popup/LngLat classes and Mapbox Style Spec support -
 * so aliasing the global is enough for the ~30 files that reference
 * `mapboxgl.*` directly. The handful of real divergences are patched here.
 *
 * Loaded as a classic deferred script, positioned in index.html right after
 * the chosen GL library's own script tag and before js/index.js, so it runs
 * once the library global exists and before anything else touches it.
 */
(function () {
    var renderer = window.amche.RENDERER;

    /**
     * mapbox:// style/sprite/glyph/tileset URLs are normalized to https://
     * internally by Mapbox GL JS but not by MapLibre GL JS (removed when it
     * forked away from requiring a Mapbox token). This reproduces that
     * normalization so existing config values (map.style, layer `url`
     * fields, and the mapbox:// refs *inside* a fetched Mapbox style JSON -
     * sprite/glyphs/composite sources) keep working under MapLibre without
     * changing. Ported from Mapbox GL JS's own url-normalization rules
     * (also documented independently in the `maplibregl-mapbox-request-transformer`
     * package on npm).
     */
    function parseMapboxUrl(url) {
        var match = url.match(/^(\w+):\/\/([^/?]*)(\/[^?]+)?\??(.+)?/);
        if (!match) return null;
        return {
            authority: match[2],
            path: match[3] || '/',
            params: match[4] ? match[4].split('&') : []
        };
    }

    function formatMapboxUrl(urlObject, token) {
        urlObject.params.push('access_token=' + token);
        return 'https://api.mapbox.com' + urlObject.path + '?' + urlObject.params.join('&');
    }

    function normalizeStyleUrl(url, token) {
        var urlObject = parseMapboxUrl(url);
        urlObject.path = '/styles/v1' + urlObject.path;
        return formatMapboxUrl(urlObject, token);
    }

    function normalizeGlyphsUrl(url, token) {
        var urlObject = parseMapboxUrl(url);
        urlObject.path = '/fonts/v1' + urlObject.path;
        return formatMapboxUrl(urlObject, token);
    }

    function normalizeSpriteUrl(url, token) {
        var urlObject = parseMapboxUrl(url);
        var parts = urlObject.path.split('.');
        var base = parts[0];
        var extension = parts[1] || 'json';
        var scale = '';
        if (base.indexOf('@2x') !== -1) {
            base = base.split('@2x')[0];
            scale = '@2x';
        }
        urlObject.path = '/styles/v1' + base + '/sprite' + scale + '.' + extension;
        return formatMapboxUrl(urlObject, token);
    }

    function normalizeSourceUrl(url, token) {
        // `authority` holds the (possibly comma-separated, for composite
        // sources) tileset id list - resolved via its TileJSON, same as
        // Mapbox GL JS does internally.
        var urlObject = parseMapboxUrl(url);
        urlObject.path = '/v4/' + urlObject.authority + '.json';
        urlObject.params.push('secure');
        return formatMapboxUrl(urlObject, token);
    }

    // No-op (returns the url unchanged) when running Mapbox GL JS, which
    // still does its own native mapbox:// resolution.
    window.amche.resolveMapboxUrl = function (url, resourceType) {
        if (renderer !== 'maplibre' || typeof url !== 'string' || url.indexOf('mapbox://') !== 0) {
            return url;
        }
        var token = window.amche.MAPBOXGL_ACCESS_TOKEN;
        if (url.indexOf('/styles/') !== -1 && url.indexOf('/sprite') === -1) return normalizeStyleUrl(url, token);
        if (url.indexOf('/sprites/') !== -1) return normalizeSpriteUrl(url, token);
        if (url.indexOf('/fonts/') !== -1) return normalizeGlyphsUrl(url, token);
        if (resourceType === 'Source' || url.indexOf('/v4/') !== -1) return normalizeSourceUrl(url, token);
        return url;
    };

    // Mapbox GL JS v3 ("Standard" style / globe) paint/layout properties
    // MapLibre's style-spec doesn't know yet. Per-property unknowns are
    // normally harmless (MapLibre warns and drops just that property), so
    // this list only needs entries that turned out to make loading itself
    // hang - found empirically, not from a spec diff.
    var V3_ONLY_PROPERTIES = [
        'text-size-scale-range', 'fill-extrusion-edge-radius', 'fill-extrusion-rounded-roof',
        'fill-extrusion-ambient-occlusion-intensity', 'fill-extrusion-ambient-occlusion-radius',
        'line-elevation-reference'
    ];

    // True if `expr` (a style-spec filter/expression, recursively) uses the
    // Mapbox GL JS v3-only `["pitch"]` expression anywhere.
    function usesPitchExpression(expr) {
        if (!Array.isArray(expr)) return false;
        if (expr[0] === 'pitch') return true;
        return expr.some(usesPitchExpression);
    }

    /**
     * A map.style URL is normally left as a plain URL and fetched by the
     * library itself. That doesn't work for a Mapbox-hosted "Standard"-family
     * style under MapLibre: MapLibre validates/compiles the style *before*
     * `transformStyle` gets a chance to run, and several Mapbox GL JS v3-only
     * constructs are severe enough (unlike most unknown-property mismatches,
     * which just warn and continue) to abort loading entirely - no
     * sources/sprite/glyphs are even attempted afterwards. Found empirically
     * against a real Standard-based style, not from a spec diff:
     *   - `projection: {name: "globe"}` - the legacy object form Mapbox's
     *     Styles API still returns; v3 changed this to a plain string.
     *   - `terrain.exaggeration` as a data/zoom expression (array) - a v3
     *     feature; MapLibre's spec still expects a plain number here.
     *   - a layer `filter` using the v3-only `["pitch"]` expression.
     *   - the v3-only paint/layout properties in V3_ONLY_PROPERTIES.
     * So for MapLibre we fetch the style ourselves, patch all of these, and
     * hand the Map constructor the resulting object instead of the URL
     * (sprite/glyphs/source mapbox:// refs *inside* that object are
     * unaffected - transformRequest above still resolves those fine).
     * No-op (returns the input unchanged) when running Mapbox GL JS.
     */
    window.amche.resolveMapboxStyle = async function (styleUrl) {
        if (renderer !== 'maplibre' || typeof styleUrl !== 'string') return styleUrl;
        var resolvedUrl = window.amche.resolveMapboxUrl(styleUrl, 'Style');
        if (resolvedUrl.indexOf('/styles/v1/') === -1) return resolvedUrl;
        try {
            var response = await fetch(resolvedUrl);
            var styleJson = await response.json();

            if (styleJson.projection && typeof styleJson.projection === 'object') {
                delete styleJson.projection;
            }
            // Mapbox's dedicated terrain-elevation tileset
            // (mapbox.mapbox-terrain-dem-v1, the `style.terrain.source`'s
            // source) requires Mapbox GL JS's own proprietary session-token
            // auth to fetch - MapLibre has no equivalent, so every tile
            // request 401s and retries forever, which blocks the map's
            // 'idle' event (and this app's mapReady signal) from ever
            // firing. Drop terrain and its now-orphaned source entirely
            // under MapLibre rather than let startup hang; 3D terrain is
            // simply unavailable there until a MapLibre-compatible DEM
            // source is configured instead.
            if (styleJson.terrain) {
                var demSourceId = styleJson.terrain.source;
                delete styleJson.terrain;
                if (demSourceId && styleJson.sources) delete styleJson.sources[demSourceId];
            }
            (styleJson.layers || []).forEach(function (layer) {
                if (layer.filter && usesPitchExpression(layer.filter)) delete layer.filter;
                ['paint', 'layout'].forEach(function (block) {
                    if (!layer[block]) return;
                    V3_ONLY_PROPERTIES.forEach(function (prop) {
                        delete layer[block][prop];
                    });
                });
            });

            return styleJson;
        } catch (e) {
            console.warn('[gl-compat] Failed to pre-fetch/patch style, falling back to URL:', e);
            return resolvedUrl;
        }
    };

    if (renderer !== 'maplibre') return;

    if (typeof maplibregl === 'undefined') {
        console.error('[gl-compat] window.amche.RENDERER is "maplibre" but MapLibre GL JS did not load - check the CDN URL in window.amche.RENDERER_ASSETS.');
        return;
    }

    // A copy, not a direct alias: when MapLibre is loaded as an ES module
    // (see index.html - v6 dropped the UMD build), `maplibregl` is a frozen
    // module namespace object and can't take new/reassigned properties
    // (e.g. `mapboxgl.accessToken = ...` below and elsewhere throws
    // "Cannot assign to property"). A shallow copy into a plain object keeps
    // every export by reference (Map, Marker, ... - and mutating
    // `mapboxgl.Map.prototype` still mutates the real class) while making
    // the container itself mutable again.
    window.mapboxgl = Object.assign({}, maplibregl);
    // Kept in sync even though MapLibre doesn't require a token itself - a
    // few files read `mapboxgl.accessToken` directly to build Mapbox REST
    // API URLs (geocoding, TileJSON lookups) regardless of renderer.
    window.mapboxgl.accessToken = window.amche.MAPBOXGL_ACCESS_TOKEN;

    // Mapbox GL JS-only Map methods with no MapLibre equivalent, called
    // unconditionally by js/terrain-3d-control.js and
    // js/map-feature-control-iframe.js. Stubbed as no-ops so those callers
    // don't need feature-detection of their own - atmospheric fog simply
    // isn't rendered under MapLibre, a cosmetic gap only.
    if (typeof maplibregl.Map.prototype.setFog !== 'function') {
        maplibregl.Map.prototype.setFog = function () { return this; };
        maplibregl.Map.prototype.getFog = function () { return null; };
    }

    // Mapbox GL JS v3-only `type: 'slot'` layers (js/map-utils.js
    // initializeSlotLayers - bottom/middle/top insertion anchors used by
    // js/layer-order-manager.js's getInsertPosition as `beforeId` targets).
    // MapLibre's addLayer validates layer types strictly and rejects
    // 'slot' outright (fires 'error', never adds it), silently leaving
    // those anchors missing and degrading layer ordering. Substitute an
    // invisible `background` layer instead - a type MapLibre accepts that
    // still works as a zero-render positional marker for beforeId.
    //
    // Below that: MapLibre's addLayer also validates every paint/layout
    // property *strictly* and throws (not just warns) on the first one it
    // doesn't recognise - unlike style-load-time validation, which just
    // fires 'error' and keeps the rest of the layer. A single unsupported or
    // (as happened with `text-letter-spacing` miscategorised as paint in
    // js/mapbox-style-spec.js - fixed there, but this covers whatever the
    // next one turns out to be) misplaced property this app hands it -
    // whether from atlas-config style objects or from our own paint/layout
    // split - would otherwise sink the entire layer instead of just that one
    // property. Parse the offending block+property out of MapLibre's own
    // error message and retry without it, so it degrades gracefully.
    if (!maplibregl.Map.prototype.addLayer.__patched) {
        var originalAddLayer = maplibregl.Map.prototype.addLayer;
        var patchedAddLayer = function (layer, beforeId, attempt) {
            attempt = attempt || 0;
            if (layer && layer.type === 'slot') {
                layer = Object.assign({}, layer, {
                    type: 'background',
                    layout: Object.assign({ visibility: 'none' }, layer.layout)
                });
            }
            try {
                return originalAddLayer.call(this, layer, beforeId);
            } catch (e) {
                var match = attempt < 10 && /\.(paint|layout)\.([\w-]+)/.exec((e && e.message) || '');
                if (!match) throw e;
                var block = match[1], prop = match[2];
                console.warn('[gl-compat] Dropping style property "' + prop + '" unsupported by MapLibre from layer "' +
                    (layer.id || '') + '":', e.message);
                var patchedLayer = Object.assign({}, layer);
                if (patchedLayer[block]) {
                    patchedLayer[block] = Object.assign({}, patchedLayer[block]);
                    delete patchedLayer[block][prop];
                }
                return patchedAddLayer.call(this, patchedLayer, beforeId, attempt + 1);
            }
        };
        patchedAddLayer.__patched = true;
        maplibregl.Map.prototype.addLayer = patchedAddLayer;
    }

    // MapLibre renders every control/marker/popup element with
    // `maplibregl-*` class names instead of Mapbox's `mapboxgl-*` (a
    // deliberate rename at the fork). This app's CSS and several JS files
    // (positioning, hover styling, z-index, click handling) target
    // `.mapboxgl-*` selectors directly, so nothing about controls positions,
    // styles, or receives clicks correctly otherwise. Rather than duplicate
    // every such rule/selector, mirror each class onto its counterpart in
    // the other naming scheme, for every element under the map container
    // (where controls, markers, and popups are all rendered). Scoped to the
    // container, not `document.body` - the rest of the app mutates classes
    // constantly (Shoelace components, hover states) and observing all of
    // it made the page unusably slow.
    //
    // Bidirectional, not just maplibregl- -> mapboxgl-: several of this
    // app's own controls (js/terrain-3d-control.js, js/streetview-control.js,
    // ...) hardcode literal `mapboxgl-ctrl`/`mapboxgl-ctrl-group` class names
    // in their own onAdd(), predating this renderer switch. Under MapLibre
    // those elements carry ONLY the mapboxgl-* classes, so maplibre-gl.css's
    // own `.maplibregl-ctrl{pointer-events:auto}` rule (which reopens click
    // handling inside the `pointer-events:none` corner container) never
    // matches them - they stayed unclickable even after the one-directional
    // mirror below. Mirroring both ways covers both cases.
    (function mirrorMapboxMaplibreClassNames() {
        var PAIRS = [['maplibregl-', 'mapboxgl-'], ['mapboxgl-', 'maplibregl-']];
        var mapContainer = document.getElementById(window.amche.MAPBOX_MAP_OPTIONS.container || 'map');
        if (!mapContainer) return;

        function mirror(el) {
            if (!(el instanceof Element)) return;
            // Snapshot first - classList.add() below would otherwise mutate
            // the live collection this loop is iterating over.
            var classes = Array.prototype.slice.call(el.classList);
            classes.forEach(function (cls) {
                PAIRS.forEach(function (pair) {
                    if (cls.indexOf(pair[0]) !== 0) return;
                    var mirrored = pair[1] + cls.slice(pair[0].length);
                    if (!el.classList.contains(mirrored)) el.classList.add(mirrored);
                });
            });
        }

        function mirrorTree(root) {
            mirror(root);
            if (root.querySelectorAll) {
                root.querySelectorAll('[class*="maplibregl-"], [class*="mapboxgl-"]').forEach(mirror);
            }
        }

        mirrorTree(mapContainer);
        new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                if (m.type === 'attributes') {
                    mirror(m.target);
                } else {
                    m.addedNodes.forEach(function (node) {
                        if (node.nodeType === 1) mirrorTree(node);
                    });
                }
            });
        }).observe(mapContainer, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class']
        });
    })();

    // Every request MapLibre makes for a style/source/sprite/glyph/tile is
    // passed through here with its literal configured URL (including any
    // unresolved mapbox:// ones) and a resourceType tag - exactly the hook
    // this is designed for.
    var previousTransformRequest = window.amche.MAPBOX_MAP_OPTIONS.transformRequest;
    window.amche.MAPBOX_MAP_OPTIONS.transformRequest = function (url, resourceType) {
        var resolved = window.amche.resolveMapboxUrl(url, resourceType);
        if (resolved !== url) return { url: resolved };
        return previousTransformRequest ? previousTransformRequest(url, resourceType) : undefined;
    };

    // Mapbox GL JS-only extension used for COG raster sources
    // (js/mapbox-api.js). MapLibre has no equivalent yet; the existing
    // `typeof mapboxgl.addTileProvider === 'function'` guards there already
    // no-op safely with this left undefined, so COG layers are simply
    // unsupported under MapLibre until a maplibregl.addProtocol-based shim
    // is written.
})();

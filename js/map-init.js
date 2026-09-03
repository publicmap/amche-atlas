import { URLManager } from './url-manager.js';
import { TimeControl } from './time-control.js';
import { MapLayerControl } from './map-layer-controls.js';
import { LayerOrderManager } from './layer-order-manager.js';
import { StatePersistence } from './state-persistence.js';
import { MapSearchControl } from './map-search-control.js';
import { SearchBoxControl } from './search-box-control.js';
import { configureCadastralSearch, prewarmCadastral, isCadastralSearchEnabled } from './cadastral-search.js';
import { isNominatimBackedOff, reportNominatimFailure } from './nominatim-search.js';
import { initCadastralSearchUI } from './cadastral-search-ui.js';
import { MapExportControl } from './map-export-control.js';
import { Terrain3DControl } from './terrain-3d-control.js';
import { MeasureControl } from './map-measure-control.js';
import { MapFeatureControl } from './map-feature-control-iframe.js';
import { MapBrowserControl } from './map-browser-control.js';
import { AtlasLayerMenuControl } from './atlas-layer-menu-control.js';
import { MapAttributionControl } from './map-attribution-control.js';
import { StreetviewControl } from './streetview-control.js';
import { MapContextMessagesControl, LOADING_ICON_HTML } from './map-context-messages-control.js';
import { ShortcutMenu } from './shortcut-menu.js';
import { HeaderShortcutMenuControl } from './header-shortcut-menu-control.js';
import { MapLocationMenuControl } from './map-location-menu-control.js';
import { ButtonExternalMapLinks } from './button-external-map-links.js';
import { MapFeatureStateManager } from './map-feature-state-manager.js';
import { NearbyFeaturesControl } from './map-nearby-features-control.js';
import { MapOrientationControl } from './map-orientation-control.js';
import { DataUtils, MapUtils, URLUtils } from './map-utils.js';
import { CameraUtils } from './map-camera-utils.js';
import { isDynamicLayerShorthand, expandDynamicLayerShorthand, resolveDynamicLayerShorthands } from './dynamic-layer-shorthand.js';

export class MapInitializer {
    // Note: location-based atlas selection is owned by SplashScreenManager
    // (see js/splash-screen-manager.js: findBestAtlasForLocation +
    // applyLocationBasedAtlas). It writes `?atlas=…` to the URL before
    // loadConfiguration() reads URL state below, so map-init has no need
    // to duplicate that logic. Only LOCAL atlases are candidates for that
    // auto-detection — external (cross-repo) atlases, flagged
    // `isExternal` in the registry, are excluded so they're never
    // auto-selected just because the user falls inside their bbox; they
    // load only when explicitly requested via `?atlas=<id|url>`.

    // Function to load configuration
    static async loadConfiguration() {
        // Initialize the layer registry first
        await layerRegistry.initialize();

        // Handle hash-based layer links (e.g., #layer-name)
        // Note: Skip hashes that look like map positions (e.g., #12/15.4406/73.8274)
        const hash = window.location.hash;
        if (hash && hash.startsWith('#') && !hash.includes('/')) {
            const layerId = hash.substring(1);
            console.log('[MapInit] Detected hash-based layer link:', layerId);

            // Check if this layer exists in the registry
            const layer = layerRegistry.getLayer(layerId);
            console.log('[MapInit] Layer lookup result:', layer ? {
                id: layer.id,
                title: layer.title,
                _sourceAtlas: layer._sourceAtlas,
                hasBbox: !!layer.bbox,
                bboxValue: layer.bbox,
                bboxIsArray: Array.isArray(layer.bbox),
                bboxLength: Array.isArray(layer.bbox) ? layer.bbox.length : 'N/A'
            } : 'NOT FOUND');

            if (layer) {
                // Get initially checked layers from index atlas
                const indexResponse = await fetch(window.amche.DEFAULT_ATLAS);
                const indexConfig = await indexResponse.json();
                const indexLayers = indexConfig.layers?.filter(l => l.initiallyChecked).map(l => l.id) || [];

                // Build layers array with the hash layer first, then index layers
                const allLayers = [layerId, ...indexLayers.filter(id => id !== layerId)];
                const layersParam = allLayers.join(',');

                // Determine initial view from layer bbox or atlas bbox
                let bbox = null;
                let bboxSource = null;

                // Extract bbox from layer (supports multiple formats)
                if (layer.bbox) {
                    if (Array.isArray(layer.bbox) && layer.bbox.length === 4) {
                        // Array format: [west, south, east, north]
                        bbox = layer.bbox;
                        bboxSource = 'layer bbox';
                    } else if (typeof layer.bbox === 'string') {
                        // String format: "west,south,east,north"
                        const parts = layer.bbox.split(',').map(v => parseFloat(v.trim()));
                        if (parts.length === 4 && parts.every(v => !isNaN(v))) {
                            bbox = parts;
                            bboxSource = 'layer bbox (parsed from string)';
                        }
                    }
                } else if (layer.map?.bounds && Array.isArray(layer.map.bounds) && layer.map.bounds.length === 2) {
                    // Handle map.bounds format: [[west, south], [east, north]]
                    const [sw, ne] = layer.map.bounds;
                    if (Array.isArray(sw) && Array.isArray(ne) && sw.length === 2 && ne.length === 2) {
                        bbox = [sw[0], sw[1], ne[0], ne[1]];
                        bboxSource = 'layer map.bounds';
                    }
                }

                // If no layer bbox, try source atlas bbox
                if (!bbox && layer._sourceAtlas) {
                    const atlasMetadata = window.layerRegistry?._atlasMetadata?.get(layer._sourceAtlas);
                    console.log('[MapInit] Source atlas metadata:', layer._sourceAtlas, atlasMetadata ? {
                        name: atlasMetadata.name,
                        hasBbox: !!atlasMetadata.bbox
                    } : 'NOT FOUND');

                    if (atlasMetadata?.bbox && Array.isArray(atlasMetadata.bbox) && atlasMetadata.bbox.length === 4) {
                        bbox = atlasMetadata.bbox;
                        bboxSource = `source atlas (${layer._sourceAtlas})`;
                    }
                }

                // Store bbox for fitBounds, or use index config defaults
                if (bbox) {
                    window.hashLayerView = { bbox, source: bboxSource };
                    console.log('[MapInit] Stored bbox for fitBounds:', bbox, 'source:', bboxSource);

                    // Calculate center for URL hash display
                    const [west, south, east, north] = bbox;
                    const center = [(west + east) / 2, (south + north) / 2];
                    const latDiff = north - south;
                    const lngDiff = east - west;
                    const maxDiff = Math.max(latDiff, lngDiff);
                    let zoom = 12;
                    if (maxDiff > 10) zoom = 6;
                    else if (maxDiff > 5) zoom = 8;
                    else if (maxDiff > 2) zoom = 10;
                    else if (maxDiff > 1) zoom = 11;
                    else if (maxDiff > 0.5) zoom = 12;
                    else zoom = 13;

                    // Build URL with estimated position hash
                    const url = new URL(window.location);
                    url.searchParams.set('layers', layersParam);
                    url.hash = `#${zoom}/${center[1].toFixed(4)}/${center[0].toFixed(4)}`;
                    console.log('[MapInit] Converting hash link to layers parameter:', url.toString());
                    window.history.replaceState({}, '', url.toString());
                } else if (indexConfig.map?.center && indexConfig.map?.zoom) {
                    // Use atlas default center and zoom
                    window.hashLayerView = {
                        center: indexConfig.map.center,
                        zoom: indexConfig.map.zoom,
                        source: 'index atlas defaults'
                    };
                    console.log('[MapInit] Using index atlas defaults');

                    const url = new URL(window.location);
                    url.searchParams.set('layers', layersParam);
                    url.hash = `#${indexConfig.map.zoom}/${indexConfig.map.center[1].toFixed(4)}/${indexConfig.map.center[0].toFixed(4)}`;
                    console.log('[MapInit] Converting hash link to layers parameter:', url.toString());
                    window.history.replaceState({}, '', url.toString());
                } else {
                    console.warn('[MapInit] No view calculated for hash layer link');
                    const url = new URL(window.location);
                    url.searchParams.set('layers', layersParam);
                    url.hash = '';
                    console.log('[MapInit] Converting hash link to layers parameter:', url.toString());
                    window.history.replaceState({}, '', url.toString());
                }
            } else {
                console.warn('[MapInit] Layer not found in registry:', layerId);
            }
        }

        // Synchronize with the splash before we read URL state. The splash
        // detects GPS/GeoIP and writes `?atlas=…` to the URL via
        // history.replaceState — that write must complete before we read
        // URLUtils.getUrlParameter('atlas') below, otherwise we'd boot
        // with the wrong (or no) atlas. The race resolves on any of:
        //   - splash set proceedNormally (user clicked through, or auto-proceed)
        //   - splash set userLocation (GPS resolved → URL is rewritten by now)
        //   - safety timeout (splash never ran / page has no splash hook)
        // 5500ms covers the 5s GPS cap in index.html's handleGeolocation plus
        // a small buffer for the GeoIP fallback (run in parallel by splash,
        // so it's normally done well before GPS gives up).
        const safetyTimeoutMs = window.loadingStartupState?.manualOverlayControl ? 30000 : 5500;
        await Promise.race([
            new Promise(resolve => {
                const check = setInterval(() => {
                    if (window.loadingStartupState?.proceedNormally
                     || window.loadingStartupState?.userLocation) {
                        clearInterval(check); resolve();
                    }
                }, 50);
            }),
            new Promise(resolve => setTimeout(resolve, safetyTimeoutMs))
        ]);

        // Check if a specific config is requested via URL parameter
        var configParam = URLUtils.getUrlParameter('atlas');
        var layersParam = URLUtils.getUrlParameter('layers');

        let configPath = window.amche.DEFAULT_ATLAS;
        let config;
        let atlasId = 'index'; // Track which atlas we're using
        let isImportedAtlas = false; // Track if this is an imported atlas

        // If a config parameter is provided, determine how to handle it
        if (configParam) {
            // Check if the config parameter is a JSON string
            if (configParam.startsWith('{') && configParam.endsWith('}')) {
                try {
                    config = JSON.parse(configParam); // Parse JSON directly

                    // Minify the JSON by removing whitespace and rewrite the URL
                    const minifiedJson = JSON.stringify(config);
                    if (minifiedJson !== configParam) {
                        // Update the URL with minified JSON without URL encoding
                        const url = new URL(window.location);
                        const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
                        const otherParams = new URLSearchParams(url.search);
                        otherParams.delete('atlas'); // Remove existing atlas param

                        // Build the new URL manually to avoid URL encoding the JSON
                        let newUrl = baseUrl;
                        if (otherParams.toString()) {
                            newUrl += '?' + otherParams.toString() + '&atlas=' + minifiedJson;
                        } else {
                            newUrl += '?atlas=' + minifiedJson;
                        }

                        // Add hash if it exists
                        if (url.hash) {
                            newUrl += url.hash;
                        }

                        window.history.replaceState({}, '', newUrl);
                    }
                } catch (error) {
                    console.error('Failed to parse atlas JSON from URL parameter:', error);
                    throw new Error('Invalid JSON in atlas parameter');
                }
            }
            // Check if the config parameter is a URL
            else if (configParam.startsWith('http://') || configParam.startsWith('https://')) {
                configPath = configParam; // Use the URL directly
                atlasId = 'imported'; // Mark as imported atlas
                isImportedAtlas = true; // Flag as imported
            } else {
                // Resolve via the registry so cross-repo atlases (referenced by short
                // id in index.atlas.json's `atlases` array, e.g. dfes-dmp) load from
                // their external URL. Fetching config/<id>.atlas.json blindly returns
                // the SPA's index.html for those → JSON parse error.
                configPath = layerRegistry.getAtlasMetadata(configParam)?.url || `config/${configParam}.atlas.json`;
                atlasId = configParam; // Use the config name as atlas ID
            }
        }

        // Load the configuration file (only if we didn't parse JSON directly)
        if (!config) {
            const configResponse = await fetch(configPath);
            if (!configResponse.ok) {
                console.warn(`[MapInit] Atlas not found: ${configPath} (${configResponse.status}), falling back to index`);
                configPath = window.amche.DEFAULT_ATLAS;
                atlasId = 'index';
                const fallbackResponse = await fetch(configPath);
                config = await fallbackResponse.json();
            } else {
                config = await configResponse.json();
            }
        }

        // For non-index atlases, ensure they inherit the map style from index.atlas.json if not specified
        if (atlasId !== 'index' && (!config.map || !config.map.style)) {
            try {
                const indexResponse = await fetch(window.amche.DEFAULT_ATLAS);
                const indexConfig = await indexResponse.json();
                if (indexConfig.map && indexConfig.map.style) {
                    if (!config.map) {
                        config.map = {};
                    }
                    config.map.style = indexConfig.map.style;
                }
            } catch (error) {
                console.warn('[MapInit] Failed to load index atlas for style inheritance:', error);
            }
        }

        // Set current atlas in registry
        layerRegistry.setCurrentAtlas(atlasId);

        if (config.cadastralSearch?.parquetUrl && config.cadastralSearch?.villagesUrl) {
            configureCadastralSearch(config.cadastralSearch);
            prewarmCadastral();
            MapInitializer._ensureCadastralSearchUI();
        }

        // Mark as imported atlas if loaded via URL
        if (isImportedAtlas) {
            // Store the imported atlas metadata with '*' prefix and register layers
            // `title` is accepted as an alias for `name` - externally authored
            // atlases (e.g. STAC-derived configs) commonly use it.
            const atlasName = config.name || config.title || 'Imported Map';
            layerRegistry.markImportedAtlas(atlasId, {
                name: `* ${atlasName}`,
                originalName: atlasName,
                color: config.color || '#059669',
                areaOfInterest: config.areaOfInterest || '',
                description: config.description || '',
                bbox: layerRegistry._extractBbox(config),
                isImported: true,
                sourceUrl: configPath
            }, config);
        }

        // Notify the user (with an Undo) whenever the resolved atlas differs from
        // the one they were just looking at - covers every atlas-switch entry
        // point (bounds-suggestion nudge, atlas badge, map browser/creator import)
        // since they all land here via a normal navigation, leaving
        // history.back() as a reliable way to return to the previous atlas.
        let previousAtlasId = null;
        try {
            previousAtlasId = sessionStorage.getItem('amche_last_atlas');
        } catch (error) { /* sessionStorage unavailable (e.g. private browsing) */ }

        if (previousAtlasId && previousAtlasId !== atlasId) {
            const atlasDisplayName = layerRegistry.getAtlasMetadata(atlasId)?.name || config.name || atlasId;
            MapContextMessagesControl.show(
                `Switched to <strong>${MapInitializer._escapeHtml(atlasDisplayName)}</strong> atlas &middot; <a href="#" onclick="window.history.back();return false;">Undo</a>`
            );
        }

        try {
            sessionStorage.setItem('amche_last_atlas', atlasId);
        } catch (error) { /* sessionStorage unavailable (e.g. private browsing) */ }

        // If loading a non-index atlas without explicit layers parameter,
        // merge with index atlas layers (common layers across all atlases)
        if (atlasId !== 'index' && !layersParam && !isImportedAtlas) {
            try {
                console.log('[MapInit] Loading non-index atlas without layers param, merging with index atlas');

                // Load index atlas to get common layers
                const indexResponse = await fetch(window.amche.DEFAULT_ATLAS);
                const indexConfig = await indexResponse.json();

                // Get layers marked as initiallyChecked from both configs
                const atlasLayers = config.layers?.filter(l => l.initiallyChecked).map(l => l.id) || [];
                const indexLayers = indexConfig.layers?.filter(l => l.initiallyChecked).map(l => l.id) || [];

                console.log('[MapInit] Atlas layers with initiallyChecked:', atlasLayers);
                console.log('[MapInit] Index layers with initiallyChecked:', indexLayers);

                // Merge layers: atlas layers first, then index layers (excluding duplicates)
                const allLayers = [...atlasLayers, ...indexLayers.filter(id => !atlasLayers.includes(id))];

                if (allLayers.length > 0) {
                    const layersParamValue = allLayers.join(',');
                    console.log('[MapInit] Merged layers:', layersParamValue);

                    // Set layersParam so it will be processed below
                    layersParam = layersParamValue;

                    // Update URL to include merged layers parameter
                    const url = new URL(window.location);
                    url.searchParams.set('layers', layersParamValue);
                    window.history.replaceState({}, '', url.toString());
                }
            } catch (error) {
                console.warn('[MapInit] Failed to merge index atlas layers:', error);
            }
        }

        // Parse layers from URL parameter if provided
        if (layersParam) {
            const urlLayers = URLUtils.parseLayersFromUrl(layersParam);

            // Set URL layers to be visible by default and maintain order
            if (urlLayers.length > 0) {
                // Set initiallyChecked to true for all URL layers
                const processedUrlLayers = urlLayers.map(layer => ({
                    ...layer,
                    initiallyChecked: true,
                    // Preserve the original JSON for custom layers
                    ...(layer._originalJson && { _originalJson: layer._originalJson })
                }));

                // Queue a "Loading map ..." message for every URL layer right away, before
                // any async resolution (registry lookups, Overpass/Allmaps/Mapwarper
                // shorthand expansion) runs below - otherwise slow shorthand resolution
                // (e.g. a batched Overpass request) leaves the user with no feedback
                // until it completes. _loadingMessageId travels with the layer object
                // through cascade/merge below so _initializeAllLayers can close it once
                // the layer actually renders (or this file closes it early on failure).
                processedUrlLayers.forEach(layer => {
                    const title = MapInitializer._getQueuedLayerTitle(layer);
                    layer._loadingMessageId = MapContextMessagesControl.show(
                        `${LOADING_ICON_HTML}${MapInitializer._buildQueuedLayerLabel(layer, title)}`
                    );
                });

                // When URL layers are specified, set ALL existing layers to initiallyChecked: false
                // This ensures only URL-specified layers are visible
                const existingLayers = config.layers || [];
                const urlLayerIds = new Set(processedUrlLayers.map(l => l.id));

                // Reset all existing layers to not be initially checked
                existingLayers.forEach(layer => {
                    if (!urlLayerIds.has(layer.id)) {
                        layer.initiallyChecked = false;
                    }
                });

                // Create minified layers parameter for URL rewriting
                const minifiedLayersParam = processedUrlLayers.map(layer => {
                    return layer._originalJson || layer.id;
                }).join(',');

                // Check if we need to create a pretty URL (either layers changed or URL has encoded params)
                const shouldPrettifyURL = minifiedLayersParam !== layersParam || URLUtils.needsURLPrettification();

                if (shouldPrettifyURL) {
                    const url = new URL(window.location);
                    const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
                    const otherParams = new URLSearchParams(url.search);
                    otherParams.delete('layers'); // Remove existing layers param

                    // Build a clean, pretty URL without URL encoding the layers parameter
                    let newUrl = baseUrl;
                    const params = [];

                    // Add other parameters first (these may be URL-encoded)
                    const otherParamsString = otherParams.toString();
                    if (otherParamsString) {
                        params.push(otherParamsString);
                    }

                    // Add layers parameter without URL encoding to keep it readable,
                    // but escape `#` (fragment delimiter — appears in hex colors) and `&` (param separator).
                    if (minifiedLayersParam) {
                        params.push('layers=' + minifiedLayersParam.replace(/#/g, '%23').replace(/&/g, '%26'));
                    }

                    // Build the final URL
                    if (params.length > 0) {
                        newUrl += '?' + params.join('&');
                    }

                    // Add hash if it exists
                    if (url.hash) {
                        newUrl += url.hash;
                    }

                    // Update to ensure we have a pretty URL
                    window.history.replaceState({}, '', newUrl);
                }

                // Keep layers in URL/visual order (first = top)
                // The conversion to map rendering order will happen when layers are added to the map

                // Build final layers array by merging with existing config
                const finalLayers = [];

                // Add URL layers in URL/visual order (first = top)
                processedUrlLayers.forEach(urlLayer => {
                    // Find matching layer in existing config to merge properties
                    const existingLayer = existingLayers.find(layer => layer.id === urlLayer.id);

                    if (existingLayer) {
                        // Merge existing layer with URL layer properties
                        finalLayers.push({
                            ...existingLayer,
                            ...urlLayer,
                            // Ensure critical URL properties are preserved
                            ...(urlLayer._originalJson && { _originalJson: urlLayer._originalJson }),
                            ...(urlLayer.initiallyChecked !== undefined && { initiallyChecked: urlLayer.initiallyChecked }),
                            ...(urlLayer.opacity !== undefined && { opacity: urlLayer.opacity })
                        });
                    } else {
                        // New layer not in existing config
                        finalLayers.push(urlLayer);
                    }
                });

                // Add any remaining layers from existing config that weren't in URL (set to not initially checked)
                existingLayers.forEach(layer => {
                    if (!urlLayerIds.has(layer.id)) {
                        finalLayers.push({
                            ...layer,
                            initiallyChecked: false
                        });
                    }
                });

                config.layers = finalLayers;

            }
        }

        // Load defaults
        try {
            const configDefaultsResponse = await fetch('config/_defaults.json');
            const configDefaults = await configDefaultsResponse.json();

            // Merge defaults with anyoverrides in config
            config.defaults = config.defaults ?
                DataUtils.deepMerge(configDefaults, config.defaults) :
                configDefaults;
        } catch (error) {
            console.warn('Default configuration values not found or invalid:', error);
        }

        // Imported atlases (`?atlas=<url>` / inline JSON) loaded with no `?layers=`
        // override are meant to show the whole map they were shared as - same
        // rationale as bulk STAC atlases (see docs/API.md: "every layer in a
        // bulk-built atlas is initiallyChecked:true ... otherwise the map
        // visibly shows nothing"). Without this, an atlas whose author forgot
        // `initiallyChecked` on every layer silently renders an empty map.
        // Only kicks in when NONE of the atlas's layers opted in explicitly,
        // so an atlas that intentionally checks a subset is left alone.
        if (isImportedAtlas && !layersParam && Array.isArray(config.layers) &&
            !config.layers.some(l => l.initiallyChecked === true)) {
            console.log('[MapInit] Imported atlas has no initiallyChecked layers - defaulting all to visible:',
                config.layers.map(l => l.id));
            config.layers.forEach(l => { l.initiallyChecked = true; });
        }

        // Process each layer in the config using the layer registry
        if (config.layers && Array.isArray(config.layers)) {
            const validLayers = [];
            const invalidLayers = [];

            // Batch-resolve any "osm:" shorthand layers into a single Overpass
            // request before the per-layer loop below, which otherwise fires
            // one Overpass request per layer sequentially (see
            // resolveDynamicLayerShorthands' docs for why).
            const precomputedDynamicLayers = await resolveDynamicLayerShorthands(config.layers);

            // Process layers one by one
            for (const layerConfig of config.layers) {
                // Dynamic layer shorthand from the URL API, e.g. "allmaps:<id>"
                // — resolve via the matching service's API before anything else touches it,
                // since its `type` isn't a real MapboxAPI layer type until expanded.
                if (isDynamicLayerShorthand(layerConfig)) {
                    const expanded = precomputedDynamicLayers.has(layerConfig)
                        ? precomputedDynamicLayers.get(layerConfig)
                        : await expandDynamicLayerShorthand(layerConfig);
                    if (expanded) {
                        validLayers.push(layerRegistry.applyAtlasCascade({
                            ...expanded,
                            // Preserve URL-critical properties from the original shorthand,
                            // same as the registry-resolution branch below.
                            ...(layerConfig._originalJson && { _originalJson: layerConfig._originalJson }),
                            ...(layerConfig.initiallyChecked !== undefined && { initiallyChecked: layerConfig.initiallyChecked }),
                            ...(layerConfig.opacity !== undefined && { opacity: layerConfig.opacity }),
                            ...(layerConfig._loadingMessageId && { _loadingMessageId: layerConfig._loadingMessageId })
                        }, atlasId));
                    } else {
                        console.warn(`[Dynamic Layer] Could not resolve layer from URL: "${layerConfig.type}:${layerConfig.id}" - ignoring.`);
                        invalidLayers.push(layerConfig.id);
                        // This layer will never reach _initializeAllLayers, so its queued
                        // loading message would otherwise be stuck on screen forever.
                        MapContextMessagesControl.close(layerConfig._loadingMessageId);
                    }
                    continue;
                }

                // If the layer only has an id (or minimal properties), look it up using the registry.
                // Also route through registry resolution when `type` is present but the type's
                // required tile source is missing (e.g. a "vector" entry with no `url`/`tiles`) -
                // that shape shows up when an atlas embeds cross-atlas metadata (title/style/
                // attribution, often alongside a prefixed id like "osm-landuse" and a `_sourceAtlas`
                // hint) without the actual source, expecting it to be resolved the same way a bare
                // `{id: "osm-landuse"}` reference is. Passing it straight to MapboxAPI as a "full
                // definition" would crash on the missing url instead of rendering anything.
                if (layerConfig.id && (!layerConfig.type || MapInitializer._isUnresolvedTypeStub(layerConfig))) {
                    // Try to resolve the layer from the registry
                    // This handles both current atlas layers and cross-atlas references
                    // Silent: cross-config loading follows and the final outcome is
                    // reported below, so suppress the premature "not found" warning.
                    // getLayer already falls back to the index atlas for system layers.
                    let resolvedLayer = layerRegistry.getLayer(layerConfig.id, atlasId, true);

                    // An imported atlas pre-registers its own layers verbatim under its
                    // atlas-prefixed key (see markImportedAtlas), so `getLayer`'s first
                    // lookup - `${atlasId}-${layerConfig.id}` - can shadow a real
                    // cross-atlas definition with a copy of this same unresolved stub
                    // (e.g. "imported-osm-landuse" matching before "osm-landuse" ever
                    // gets tried). Discard a stub hit and keep looking instead of
                    // treating it as a real answer.
                    if (resolvedLayer && MapInitializer._isUnresolvedTypeStub(resolvedLayer)) {
                        resolvedLayer = null;
                    }

                    // If still not found, try cross-config loading
                    if (!resolvedLayer) {
                        resolvedLayer = await layerRegistry.tryLoadCrossConfigLayer(layerConfig.id, layerConfig);
                    }

                    if (resolvedLayer) {
                        if (!resolvedLayer.type) {
                            console.warn(`[LayerRegistry] Resolved layer ${layerConfig.id} from registry is missing type property. Registry entry:`, resolvedLayer);
                        }

                        // Merge the resolved layer with any custom overrides from config
                        // Preserve important URL-specific properties
                        // Note: layerConfig is spread after resolvedLayer, so it can override properties
                        // But we explicitly preserve critical properties from resolvedLayer if layerConfig doesn't provide them
                        // Preserve type before merging - critical for cross-atlas references
                        const preservedType = layerConfig.type || resolvedLayer.type;

                        const mergedLayer = {
                            ...resolvedLayer,
                            ...layerConfig,
                            // Explicitly set type to ensure it's never lost during merge
                            // layerConfig.type takes precedence if provided, otherwise use resolvedLayer.type
                            type: preservedType,
                            // Preserve proxy settings from resolved layer if not overridden
                            ...(resolvedLayer.proxyUrl && !layerConfig.proxyUrl && {
                                proxyUrl: resolvedLayer.proxyUrl,
                                proxyReferer: resolvedLayer.proxyReferer
                            }),
                            // Ensure these critical properties are preserved
                            ...(layerConfig._originalJson && { _originalJson: layerConfig._originalJson }),
                            ...(layerConfig.initiallyChecked !== undefined && { initiallyChecked: layerConfig.initiallyChecked }),
                            ...(layerConfig.opacity !== undefined && { opacity: layerConfig.opacity }),
                            // Store normalized ID for URL serialization
                            _normalizedId: layerRegistry.normalizeLayerId(layerConfig.id, atlasId)
                        };

                        // Verify the merge preserved important properties
                        if (!mergedLayer.title) {
                            console.warn(`[LayerRegistry] Cross-atlas layer ${layerConfig.id} from ${resolvedLayer._sourceAtlas} atlas missing title after merge (this is unusual)`);
                        }
                        if (!mergedLayer.type) {
                            console.warn(`[LayerRegistry] Cross-atlas layer ${layerConfig.id} from ${resolvedLayer._sourceAtlas} atlas missing type after merge - this may cause layer creation to fail`);
                        }

                        validLayers.push(mergedLayer);
                    } else {
                        // Layer not found in registry - check if it came from URL
                        if (layerConfig.initiallyChecked === true) {
                            console.warn(`[LayerRegistry] Unknown layer ID from URL: "${layerConfig.id}" - ignoring.`);
                            invalidLayers.push(layerConfig.id);
                            // This layer will never reach _initializeAllLayers, so its queued
                            // loading message would otherwise be stuck on screen forever.
                            MapContextMessagesControl.close(layerConfig._loadingMessageId);
                        } else {
                            console.warn(`[LayerRegistry] Layer "${layerConfig.id}" not found in registry, using as-is (might be missing metadata)`);
                            // For non-URL layers, keep them as-is (they might be fully defined custom layers)
                            validLayers.push(layerConfig);
                        }
                    }
                } else {
                    // Full-definition layer in the active atlas — apply atlas-level
                    // style/inspect/stylePresets cascade. (Bare references in the
                    // branch above already get the cascade via the registry entry.)
                    validLayers.push(layerRegistry.applyAtlasCascade(layerConfig, atlasId));
                }
            }

            config.layers = validLayers;

            console.log(`[MapInit] Parsed ${validLayers.length} layer(s) from atlas "${atlasId}"` +
                (invalidLayers.length ? ` (${invalidLayers.length} invalid: ${invalidLayers.join(', ')})` : ''),
                validLayers.map(l => ({ id: l.id, type: l.type, initiallyChecked: !!l.initiallyChecked })));

            // Ensure the selection layer (system layer for map markers) is always present
            if (!config.layers.find(l => l.id === 'selection')) {
                const selectionLayer = layerRegistry.getLayer('selection', 'index');
                if (selectionLayer) {
                    config.layers.unshift({ ...selectionLayer, id: 'selection', initiallyChecked: true });
                }
            }

            // If we found invalid layers from URL, update the URL to remove them
            if (invalidLayers.length > 0 && layersParam) {
                console.warn(`Removing invalid layer IDs from URL: ${invalidLayers.join(', ')}`);

                // Get the remaining valid layers that were originally from URL
                const validUrlLayers = validLayers.filter(layer => layer.initiallyChecked === true);

                // Reconstruct the layers parameter with only valid layers
                const newLayersParam = validUrlLayers.map(layer => {
                    return layer._originalJson || layer._normalizedId || layer.id;
                }).join(',');

                // Update the URL
                const url = new URL(window.location);
                const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
                const otherParams = new URLSearchParams(url.search);
                otherParams.delete('layers');

                let newUrl = baseUrl;
                if (newLayersParam) {
                    // Encode `#` (would be misread as fragment delimiter; e.g. hex colors)
                    // and `&` (param separator) — keep everything else readable.
                    const safeLayersParam = newLayersParam.replace(/#/g, '%23').replace(/&/g, '%26');
                    if (otherParams.toString()) {
                        newUrl += '?' + otherParams.toString() + '&layers=' + safeLayersParam;
                    } else {
                        newUrl += '?layers=' + safeLayersParam;
                    }
                } else {
                    // No valid layers left, just add other parameters if any
                    if (otherParams.toString()) {
                        newUrl += '?' + otherParams.toString();
                    }
                }

                // Add hash if it exists
                if (url.hash) {
                    newUrl += url.hash;
                }

                window.history.replaceState({}, '', newUrl);
            }
        }

        // Final check: prettify URL if it still has encoded parameters (e.g., terrain parameter)
        if (URLUtils.needsURLPrettification()) {
            const url = new URL(window.location);
            const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
            const params = new URLSearchParams(url.search);

            // Manually build pretty URL without re-encoding
            let newUrl = baseUrl;
            const prettyParams = [];

            for (const [key, value] of params.entries()) {
                if (key === 'layers') {
                    // Keep layers parameter unencoded for readability, but escape `#`
                    // (fragment delimiter — present in hex colors) and `&` (param separator).
                    prettyParams.push(`${key}=${value.replace(/#/g, '%23').replace(/&/g, '%26')}`);
                } else {
                    // For other parameters, we can allow minimal encoding if needed
                    prettyParams.push(`${key}=${value}`);
                }
            }

            if (prettyParams.length > 0) {
                newUrl += '?' + prettyParams.join('&');
            }

            // Add hash if it exists
            if (url.hash) {
                newUrl += url.hash;
            }

            window.history.replaceState({}, '', newUrl);
        }

        return config;
    }

    // Fast-path config used only to create the Mapbox map. Fetches the
    // defaults + active atlas (+ index for style inheritance) in parallel,
    // skipping the full layer registry, layer resolution, and waitForStartupChoice
    // that loadConfiguration() does later. Returns the merged `map` block.
    // Critically includes `hash: true` from _defaults.json so the URL hash
    // (#zoom/lat/lng) is respected at initial render.
    static async _loadInitialMapOptions(configParam) {
        let configPath = window.amche.DEFAULT_ATLAS;
        let inlineConfig = null;

        if (configParam) {
            if (configParam.startsWith('{') && configParam.endsWith('}')) {
                try { inlineConfig = JSON.parse(configParam); } catch (e) {
                    console.warn('[MapInit] Inline atlas JSON parse failed:', e);
                }
            } else if (configParam.startsWith('http://') || configParam.startsWith('https://')) {
                configPath = configParam;
            } else {
                configPath = `config/${configParam}.atlas.json`;
            }
        }

        const needsIndex = configPath !== window.amche.DEFAULT_ATLAS;

        // Parallel fetches: defaults + active atlas + (optional) index for style inheritance
        const [defaultsResult, atlasResult, indexResult] = await Promise.allSettled([
            fetch(window.amche.LAYER_DEFAULTS).then(r => r.ok ? r.json() : null),
            inlineConfig ? Promise.resolve(inlineConfig) : fetch(configPath).then(r => r.ok ? r.json() : null),
            needsIndex ? fetch(window.amche.DEFAULT_ATLAS).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
        ]);

        const defaults = defaultsResult.status === 'fulfilled' ? defaultsResult.value : null;
        let atlas = atlasResult.status === 'fulfilled' ? atlasResult.value : null;
        const indexConfig = indexResult.status === 'fulfilled' ? indexResult.value : null;

        // If the requested atlas failed, fall back to the index atlas wholesale
        if (!atlas && indexConfig) atlas = indexConfig;

        // Inherit missing style/center/zoom from index — matches loadConfiguration()
        if (atlas && indexConfig && atlas !== indexConfig) {
            atlas.map = atlas.map || {};
            atlas.map.style = atlas.map.style || indexConfig.map?.style;
            atlas.map.center = atlas.map.center || indexConfig.map?.center;
            if (atlas.map.zoom === undefined) atlas.map.zoom = indexConfig.map?.zoom;
        }

        // Layer defaults' map block first (hash: true, attributionControl: false, ...),
        // then atlas-specific overrides — same order loadConfiguration uses
        return { ...(defaults?.map || {}), ...(atlas?.map || {}) };
    }

    // Initialize the map with the configuration
    static async initializeMap() {
        // Kick off the full atlas registry in parallel. We do NOT await it
        // here — loadConfiguration() awaits it inside map.on('load') once the
        // map is already rendering. The registry dedupes concurrent calls so
        // this and the await in loadConfiguration() share one promise.
        layerRegistry.initialize();

        // Fast path: fetch just the active atlas (and index fallback if
        // needed) to build the minimal map options. This lets the map start
        // rendering its base style ~immediately instead of waiting for all
        // ~15 atlas JSONs + waitForStartupChoice + layer resolution.
        const configParam = URLUtils.getUrlParameter('atlas');
        const initialMapOptions = await this._loadInitialMapOptions(configParam);
        Object.assign(window.amche.MAPBOX_MAP_OPTIONS, initialMapOptions);

        // Snapshot whether the incoming URL already had a position hash
        // *before* constructing the map — Mapbox's `hash: true` option (see
        // _defaults.json) starts writing its own #zoom/lat/lng hash within
        // milliseconds of construction even when the URL had none, so
        // `window.location.hash` can no longer be trusted for this check
        // once the map exists.
        const hadInitialHash = !!window.location.hash;

        const map = new mapboxgl.Map(window.amche.MAPBOX_MAP_OPTIONS);

        // Make map accessible globally for debugging
        window.map = map;
        window.dispatchEvent(new CustomEvent('mapInstanceReady', { detail: { map } }));

        // Mount the geolocation control IMMEDIATELY (before map.on('load')) so
        // its auto-trigger starts navigator.geolocation.watchPosition in
        // parallel with Mapbox's style/tile fetching. The button is just DOM;
        // Mapbox's GeolocateControl defers the location-marker layer addition
        // until style.load fires internally, so this is safe.
        // Previously this ran inside map.on('load'), which delayed trigger()
        // by the ~1.5-2s Mapbox spends loading the style after construction.
        const userLoc = window.loadingStartupState?.userLocation;
        if (userLoc) {
            console.log(
                `[GPS] Splash-detected location available before map.on('load'): ` +
                `${userLoc.lat.toFixed(6)}, ${userLoc.lng.toFixed(6)} at t=${Math.round(performance.now())}ms`
            );
        }
        // One button covers both GPS tracking and map bearing; window
        // .geolocationControl stays as an alias for the callers that used to
        // talk to the separate geolocation button.
        // onAdd is called directly here, rather than waiting for the
        // map.addControl() that mounts it bottom-right on load, so its GPS
        // auto-trigger starts in parallel with style/tile loading. The element
        // stays detached until then; the second onAdd returns the same one.
        window.orientationControl = new MapOrientationControl();
        window.geolocationControl = window.orientationControl;
        window.orientationControl.onAdd(map);

        // Also added immediately (rather than inside map.on('load') below) so
        // it exists before initializeSearch()'s searchSetup can possibly run -
        // that fires on the 'style.load' event, which can happen before our
        // own 'load' handler below gets to set up the other chrome controls.
        // This is the single top-left row hosting the Maps button, the
        // search box, and the geolocation button together, in that order.
        window.searchBoxControl = new SearchBoxControl();
        map.addControl(window.searchBoxControl, 'top-left');

        // Built immediately too (same reasoning as above) so it can be
        // inserted as the row's first item right away - MapBrowserControl's
        // onAdd() only wires up DOM/message-listeners/overlay, none of which
        // need the map to have fully loaded.
        window.browserControl = new MapBrowserControl();
        window.searchBoxControl.mountBrowserControl(window.browserControl.onAdd(map));

        // Setup proper cursor handling for map dragging
        map.on('load', async () => {
            console.log(`[GPS] map.on('load') fired at t=${Math.round(performance.now())}ms`);

            // Initialize slot layers for proper layer ordering
            // Reference: https://docs.mapbox.com/style-spec/reference/slots/
            MapUtils.initializeSlotLayers(map);

            // Add debugging method to global scope
            window.verifyLayerOrder = () => {
                const urlParams = new URLSearchParams(window.location.search);
                const layersParam = urlParams.get('layers');
                if (!layersParam) {
                    console.error('No layers parameter in URL');
                    return;
                }
                const urlLayers = layersParam.split(',').map(id => ({ id: id.trim() }));
                const result = LayerOrderManager.verifyLayerOrder(map, urlLayers);
                console.group('🔍 Layer Order Verification');
                console.log(result.message);
                console.log('URL order (first = on top):', result.urlOrder);
                console.log('Visual order (first = on bottom):', result.visualOrder);
                console.log('Expected visual order:', result.expectedOrder);
                console.log('Slots:', result.slots);
                if (!result.valid) {
                    console.error('❌ Mismatch detected!');
                }
                console.groupEnd();
                return result;
            };

            const canvas = map.getCanvas();

            // Set default cursor
            canvas.style.cursor = 'grab';

            // Handle mouse events for proper cursor states
            map.on('mousedown', () => {
                canvas.style.cursor = 'grabbing';
            });

            map.on('mouseup', () => {
                canvas.style.cursor = 'grab';
            });

            map.on('mouseleave', () => {
                canvas.style.cursor = 'grab';
            });

            // Handle drag events
            map.on('dragstart', () => {
                canvas.style.cursor = 'grabbing';
            });

            map.on('dragend', () => {
                canvas.style.cursor = 'grab';
            });

            // Initialize centralized state manager (NEW ARCHITECTURE)
            const stateManager = new MapFeatureStateManager(map);

            // Enable debug logging temporarily to diagnose layer matching issues
            stateManager.setDebug(true);

            // Make components globally accessible
            window.stateManager = stateManager;

            // Add custom attribution control that handles formatting and removes duplicates
            window.attributionControl = new MapAttributionControl();
            // Add 3D terrain control (will be initialized after URL manager is ready)
            window.terrain3DControl = new Terrain3DControl();
            // Initialize the feature control with state manager and config
            window.featureControl = new MapFeatureControl();

            // The inspector lives inside the primary top-left row (added
            // earlier, see above), between the Maps button and the search box,
            // rather than as its own stacked top-left control.
            window.searchBoxControl.mountInspectorControl(window.featureControl.onAdd(map));

            // Header-nav atlas + layers nested menu (top-left of the header,
            // not a map control) - reuses browserControl's layer-toggle logic
            // so it behaves exactly like map-browser.html.
            window.atlasLayerMenuControl = new AtlasLayerMenuControl(window.browserControl);
            window.atlasLayerMenuControl.mount(document.getElementById('atlas-layer-menu-container'));

            // Header-nav shortcuts menu, next to the atlas + layers menu -
            // same item tree/actions as the map's right-click/long-press menu
            // (see shortcut-menu-base.js), acting on the current map center.
            window.headerShortcutMenuControl = new HeaderShortcutMenuControl();
            window.headerShortcutMenuControl.mount(document.getElementById('header-shortcut-menu-container'), map);

            // Header-nav map location menu: coordinates, bearing, pitch, and
            // the reverse-geocoded address for the current map center (see
            // map-location-menu-control.js).
            window.mapLocationMenuControl = new MapLocationMenuControl();
            window.mapLocationMenuControl.mount(document.getElementById('map-location-menu-container'), map);

            // Bottom-right, in stacking order from the corner up: attribution
            // sits lowest, the orientation button next (nearest the thumb), and
            // the 3D panel's toggle above it. Bottom corners insert each new
            // control above the previous one, so add order is bottom-to-top.
            map.addControl(window.attributionControl, 'bottom-right');
            map.addControl(window.orientationControl, 'bottom-right');
            map.addControl(window.terrain3DControl, 'bottom-right');

            // Right-click / long-press shortcut menu, relies on the controls above
            window.shortcutMenu = new ShortcutMenu();
            window.shortcutMenu.onAdd(map);

            const supportedExts = ['geojson', 'json', 'kml', 'csv', 'geojsonl', 'ndjson', 'jsonl', 'gpkg', 'zip'];
            const dropOverlay = document.createElement('div');
            dropOverlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(30,64,175,0.55);display:none;align-items:center;justify-content:center;pointer-events:none;';
            dropOverlay.innerHTML = '<div style="background:#1e3a8a;color:#fff;border-radius:1rem;padding:2rem 3rem;font-size:1.5rem;font-weight:600;border:3px dashed #93c5fd;">Drop file to add layer</div>';
            document.body.appendChild(dropOverlay);

            let dragCounter = 0;
            document.addEventListener('dragenter', (e) => {
                const items = e.dataTransfer?.items;
                if (!items) return;
                const hasFile = Array.from(items).some(i => i.kind === 'file');
                if (!hasFile) return;
                dragCounter++;
                dropOverlay.style.display = 'flex';
            });
            document.addEventListener('dragleave', () => {
                dragCounter--;
                if (dragCounter <= 0) { dragCounter = 0; dropOverlay.style.display = 'none'; }
            });
            document.addEventListener('dragover', (e) => e.preventDefault());
            document.addEventListener('drop', (e) => {
                e.preventDefault();
                dragCounter = 0;
                dropOverlay.style.display = 'none';
                const files = Array.from(e.dataTransfer?.files || []).filter(file =>
                    supportedExts.includes(file.name.split('.').pop().toLowerCase())
                );
                if (files.length > 0) {
                    window.browserControl.openCreatorWithFiles(files);
                }
            });

            // (Geolocation control already mounted at the top of map.on('load')
            // so its GPS auto-trigger runs in parallel with the rest of setup.)
            window.nearbyFeaturesControl = new NearbyFeaturesControl(stateManager);
            map.addControl(window.nearbyFeaturesControl, 'top-right');
            map.addControl(new TimeControl(), 'top-right');
            // Street view goes last in the top-right stack
            window.streetviewControl = new StreetviewControl();
            map.addControl(window.streetviewControl, 'top-right');
            window.contextMessagesControl = new MapContextMessagesControl();
            window.contextMessagesControl.onAdd(map);
            const shortcutHintId = MapContextMessagesControl.show('Long press/right click map for shortcuts');
            setTimeout(() => MapContextMessagesControl.close(shortcutHintId), 8000);
            // Both open top-anchored panels, so they live in the top-right
            // stack, below the controls added above.
            window.exportControl = new MapExportControl();
            map.addControl(window.exportControl, 'top-right');
            window.externalMapLinksControl = new ButtonExternalMapLinks();
            map.addControl(window.externalMapLinksControl, 'top-right');
            map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');
            // Added after ScaleControl so it stacks above it (bottom corners
            // insert each new control above the previous one).
            if (typeof MapboxDraw !== 'undefined') {
                window.measureControl = new MeasureControl();
                map.addControl(window.measureControl, 'bottom-left');
            }

            // Resolve the full config now that the map and all chrome controls
            // are in place. loadConfiguration() awaits the (already in-flight)
            // layer registry, location detection, and layer resolution — work
            // that previously blocked map creation.
            const config = await MapInitializer.loadConfiguration();
            const layers = config.layers || [];

            // Hide loader and show controls
            document.getElementById('map-layer-filter').classList.remove('hidden');

            // Initialize layer control & Make it globally accessible
            window.layerControl = new MapLayerControl(layers);
            window.layerControl.renderToContainer('#layer-controls-container', map);
            window.layerControl.setStateManager(stateManager);

            // Initialize feature control (panel starts collapsed)
            window.featureControl.initialize(stateManager, config);

            // Preload iframe-backed controls once the map is idle, so their
            // bundles (map-inspector.html, map-export.html, map-browser.html)
            // load off the critical path but are ready before the user clicks.
            map.once('idle', () => {
                window.featureControl?.preload?.();
                window.exportControl?.preload?.();
                window.browserControl?.preload?.();
            });

            // Initialize 3D control from URL parameters after URL manager is ready
            window.terrain3DControl.initializeFromURL();

            // Setup pitch listener for lazy terrain loading (ignores initial animations)
            window.terrain3DControl.setupPitchListener();

            // Initialize state persistence and try to restore saved state
            const statePersistence = new StatePersistence();
            const stateRestored = statePersistence.restoreStateOnLoad();

            // Initialize URL manager after layer control is ready
            const urlManager = new URLManager(window.layerControl, map);
            urlManager.setupLayerControlEventListeners();

            // Make URL manager globally accessible
            window.urlManager = urlManager;

            // Connect URL manager with state manager for feature selection URL sync
            urlManager.setStateManager(stateManager);

            // Apply URL parameters as soon as the map/layer control are ready — NOT
            // gated on 'layersInitialized' (all config layers finishing their serial
            // add loop, which can take many seconds with a slow sheet/basemap layer).
            // applyURLParameters()'s own waitForMapReady() is a much lighter check
            // (map style loaded + mapLayerControl._state exists, both true almost
            // immediately), and the marker/selection restoration it triggers
            // (MapMarkerManager.restoreMarkersFromSelectionLayer) already does its own
            // per-layer readiness polling — it doesn't need every OTHER layer to have
            // finished first. Waiting for 'layersInitialized' here used to hold URL-driven
            // markers off the map until every layer had already loaded, defeating the
            // point of that per-layer streaming. (applyLayerState(), the one piece of
            // applyURLParameters() that would actually re-add layers, is a no-op stub, so
            // there's no double-add risk from running this concurrently with the initial
            // layer-add loop.)
            const applyParams = () => {
                if (!stateRestored) {
                    urlManager.applyURLParameters();
                } else {
                    setTimeout(() => urlManager.applyURLParameters(), 100);
                }
            };
            applyParams();

            // Initialize state persistence event listeners after URL manager is ready
            statePersistence.initialize();

            // Make URL manager globally accessible for ShareLink
            window.urlManager = urlManager;

            // Update attribution with location name on map movement
            let reverseGeocodeTimeout;
            const updateAttributionLocation = async () => {
                if (isNominatimBackedOff()) return;

                try {
                    const center = map.getCenter();
                    const zoom = map.getZoom();
                    const latRounded = Math.round(center.lat * 100000) / 100000;
                    const lngRounded = Math.round(center.lng * 100000) / 100000;
                    const nominatimZoom = Math.max(0, Math.min(18, Math.round(zoom)));
                    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latRounded}&lon=${lngRounded}&zoom=${nominatimZoom}&addressdetails=1`;

                    const response = await fetch(url, {
                        headers: { 'User-Agent': 'AMChe-Goa-Map/1.0' }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        if (data.display_name && window.attributionControl) {
                            window.attributionControl.setLocation(data.display_name, data.address || null);
                        }
                    } else {
                        reportNominatimFailure();
                    }
                } catch (e) {
                    reportNominatimFailure();
                    console.debug('Reverse geocoding failed', e);
                }
            };

            map.on('moveend', (e) => {
                // Search suggestion hover/typing previews (map-search-control.js) tag
                // their fitBounds calls with this so they don't spam the reverse-geocode
                // call below on every hovered result.
                if (e && e._isSearchPreview) return;

                clearTimeout(reverseGeocodeTimeout);
                reverseGeocodeTimeout = setTimeout(updateAttributionLocation, 1000);
            });

            updateAttributionLocation();

            // Set camera position: prioritize hash layer view, then URL hash, then config defaults
            const signalMapReady = () => {
                window.mapDisplayReady = true;
                window.dispatchEvent(new CustomEvent('mapDisplayReady'));
                window.dispatchEvent(new CustomEvent('mapReady', { detail: { map } }));
            };

            // Computed once, up front, so it's available both to the "no hash"
            // fallback below and to the GPS-lock message's "Switch to map
            // default" link (which can fire long after this block runs).
            const indexAtlasMap = layerRegistry.getAtlasMetadata('index')?.map || {};
            const fallbackCenter = config.map?.center || indexAtlasMap.center || [0, 0];
            const fallbackZoom = config.map?.zoom ?? indexAtlasMap.zoom ?? 2;
            window.__amcheAtlasDefaultView = { center: fallbackCenter, zoom: fallbackZoom };

            // Whenever a real GPS fix is established — at startup (possibly
            // after the fallback camera below already ran, since GeoIP/atlas
            // defaults shouldn't block on the up-to-5s GPS cap) or later from
            // a manual geolocate click — prefer zooming to it and let the user
            // choose between staying locked to GPS or returning to the atlas's
            // default view.
            let gpsLockMessageTimer = null;
            const applyGpsLock = (lat, lng) => {
                map.flyTo({ center: [lng, lat], zoom: 17, pitch: 0, bearing: 0, duration: 2000, essential: true });
                MapContextMessagesControl.show(
                    'Locked to <a href="#" onclick="window.orientationControl?.turnOff();return false;">GPS</a>. ' +
                    'Switch to <a href="#" onclick="window.__amcheSwitchToAtlasDefault?.();return false;">map default</a>',
                    { id: 'gps-lock-status' }
                );
                clearTimeout(gpsLockMessageTimer);
                gpsLockMessageTimer = setTimeout(() => MapContextMessagesControl.close('gps-lock-status'), 10000);
            };
            window.__amcheSwitchToAtlasDefault = () => {
                if (window.orientationControl?.isTracking) window.orientationControl.turnOff();
                MapContextMessagesControl.close('gps-lock-status');
                const view = window.__amcheAtlasDefaultView;
                map.flyTo({ center: view.center, zoom: view.zoom, pitch: 28, bearing: 0, duration: 1500, essential: true });
            };
            // A GPS fix that arrives AFTER the placement chain below has
            // already run (or is mid-flight) always wins — it corrects
            // whatever GeoIP/atlas-default camera was used to avoid blocking
            // startup on the up-to-5s GPS cap.
            window.addEventListener('amche:gps-resolved', (e) => {
                if (e.detail) applyGpsLock(e.detail.lat, e.detail.lng);
            });

            // Suggest switching atlases when the map center drifts outside the
            // active atlas's bbox (e.g. panning from Goa into Karnataka).
            // Debounced on moveend and gated behind a grace period so the
            // startup camera-placement chain below (flyTo/fitBounds) never
            // triggers it before the user has actually panned anywhere.
            const ATLAS_BOUNDS_MESSAGE_ID = 'atlas-bounds-suggestion';
            let atlasBoundsCheckReady = false;
            setTimeout(() => { atlasBoundsCheckReady = true; }, 6000);
            let atlasBoundsCheckTimeout = null;

            // Switches the active atlas live (layer visibility only, no reload) -
            // the same mechanism map-browser.html's atlas dropdown/[Select]
            // buttons use (MapBrowserControl.switchAtlasLive), so the map stays
            // exactly where the user already was.
            window.__amcheSwitchAtlas = (targetAtlasId) => {
                window.browserControl?.switchAtlasLive(targetAtlasId);
            };

            const checkAtlasBounds = () => {
                if (!atlasBoundsCheckReady) return;
                const currentAtlasId = layerRegistry.getCurrentAtlas();
                const currentMetadata = layerRegistry.getAtlasMetadata(currentAtlasId);
                if (!currentMetadata || !currentMetadata.bbox) {
                    // Nothing to compare against (e.g. the global index atlas) -
                    // clear any stale suggestion and stop.
                    MapContextMessagesControl.close(ATLAS_BOUNDS_MESSAGE_ID);
                    return;
                }

                const { lng, lat } = map.getCenter();
                if (layerRegistry.isPointInAtlasBbox(currentAtlasId, lng, lat)) {
                    MapContextMessagesControl.close(ATLAS_BOUNDS_MESSAGE_ID);
                    return;
                }

                const suggestedAtlasId = layerRegistry.findBestAtlasForPoint(lng, lat, { excludeAtlasId: currentAtlasId });
                if (!suggestedAtlasId) {
                    // Outside the current atlas but no other atlas covers this
                    // location either - nothing useful to suggest.
                    MapContextMessagesControl.close(ATLAS_BOUNDS_MESSAGE_ID);
                    return;
                }

                const currentName = MapInitializer._escapeHtml(currentMetadata.name || currentAtlasId);
                const suggestedName = MapInitializer._escapeHtml(
                    layerRegistry.getAtlasMetadata(suggestedAtlasId)?.name || suggestedAtlasId
                );
                MapContextMessagesControl.show(
                    `You've panned outside the <strong>${currentName}</strong> atlas. Switch to <a href="#" onclick="window.__amcheSwitchAtlas('${suggestedAtlasId}');return false;">${suggestedName}</a>?`,
                    { id: ATLAS_BOUNDS_MESSAGE_ID }
                );
            };

            map.on('moveend', () => {
                clearTimeout(atlasBoundsCheckTimeout);
                atlasBoundsCheckTimeout = setTimeout(checkAtlasBounds, 600);
            });

            if (window.loadingStartupState?.gpsFix) {
                // GPS already resolved by the time we got here — go straight
                // to it instead of running the placement chain below at all.
                const { lat, lng } = window.loadingStartupState.gpsFix;
                applyGpsLock(lat, lng);
                map.once('moveend', () => map.once('idle', signalMapReady));
            } else if (window.hashLayerView) {
                // Hash layer view was calculated from layer/atlas bbox
                console.log('[MapInit] Applying hashLayerView:', window.hashLayerView);
                setTimeout(() => {
                    if (window.hashLayerView.bbox) {
                        // Fit to full bbox extent
                        console.log('[MapInit] Fitting to bbox:', window.hashLayerView.bbox);
                        map.fitBounds(window.hashLayerView.bbox, {
                            pitch: 0,
                            bearing: 0,
                            duration: 3000,
                            padding: 50,
                            essential: true
                        });
                    } else {
                        // Fall back to center/zoom if no bbox
                        const flyToOptions = {
                            center: window.hashLayerView.center,
                            zoom: window.hashLayerView.zoom,
                            pitch: 0,
                            bearing: 0,
                            duration: 3000,
                            essential: true,
                            curve: 1.42,
                            speed: 0.6
                        };
                        console.log('[MapInit] Flying to:', flyToOptions);
                        map.flyTo(flyToOptions);
                    }
                    delete window.hashLayerView; // Clean up
                    map.once('moveend', () => map.once('idle', signalMapReady));
                }, 2000);
            } else if (hadInitialHash) {
                // Had a hash at construction time — Mapbox's hash:true option
                // already jumped to it synchronously in the Map constructor.
                map.once('idle', signalMapReady);
            } else if (MapInitializer._parseHashLocation(window.location.hash)) {
                // hadInitialHash only reflects the hash at map-CONSTRUCTION
                // time (captured before this atlas/location was even known).
                // Splash resolves GPS/GeoIP asynchronously and writes
                // ?...&geolocate=true#zoom/lat/lng via history.replaceState,
                // which fires no 'hashchange' event — Mapbox's hash:true never
                // re-reads it, so the map's camera is still sitting on
                // whatever defaults were used at construction even though the
                // URL now has a real resolved position (loadConfiguration()
                // above always waits for splash to finish before we get here,
                // so the hash can be trusted at this point). Fly to it instead
                // of falling through to the atlas's generic default center/zoom.
                const lateHash = MapInitializer._parseHashLocation(window.location.hash);
                map.flyTo({
                    center: [lateHash.lng, lateHash.lat],
                    zoom: lateHash.zoom,
                    pitch: 28,
                    bearing: 0,
                    duration: 1500,
                    essential: true
                });
                map.once('moveend', () => map.once('idle', signalMapReady));
            } else {
                // fallbackCenter/fallbackZoom are computed above (config.map
                // inherits the index atlas's when the active atlas doesn't
                // define its own — see the style-inheritance step in
                // loadConfiguration()); this branch is a last-resort guard
                // against a totally missing `map` block.

                // If the URL specified layers (deep link) and any of them carry
                // geojson/csv data or a known bbox, fit the camera to that data
                // instead of the atlas's default center/zoom — the data is
                // presumably why the link was shared. Layers are folded into
                // the shared viewport one by one as each finishes loading (see
                // CameraUtils.autoFitLayers). Falls through to the default
                // flyTo below if nothing in the URL layers is fittable, or if
                // fitting never completes.
                const layersParam = URLUtils.getUrlParameter('layers');
                const urlLayers = (config.layers || []).filter(l => l.initiallyChecked === true);

                let autoFitSignaled = false;
                const signalReadyOnce = () => {
                    if (autoFitSignaled) return;
                    autoFitSignaled = true;
                    map.once('moveend', () => map.once('idle', signalMapReady));
                };

                const isAutoFitting = !!layersParam && CameraUtils.autoFitLayers(map, urlLayers, {
                    duration: 1500,
                    onFit: signalReadyOnce
                });

                if (isAutoFitting) {
                    // Safety net: if none of the eligible layers ever produced
                    // a fit (all failed to load, or had no usable geometry),
                    // don't leave the loading state stuck — fall back to defaults.
                    setTimeout(() => {
                        if (autoFitSignaled) return;
                        map.flyTo({
                            center: fallbackCenter,
                            zoom: fallbackZoom,
                            pitch: 28,
                            bearing: 0,
                            duration: 1500,
                            essential: true
                        });
                        signalReadyOnce();
                    }, 16000);
                } else {
                    // No hash in URL, use config defaults
                    setTimeout(() => {
                        const flyToOptions = {
                            center: fallbackCenter,
                            zoom: fallbackZoom,
                            pitch: 28,
                            bearing: 0,
                            duration: 3000,
                            essential: true,
                            curve: 1.42,
                            speed: 0.6
                        };
                        map.flyTo(flyToOptions);
                        map.once('moveend', () => map.once('idle', signalMapReady));
                    }, 2000);
                }
            }

            // Add global keyboard shortcuts
            document.addEventListener('keydown', (event) => {
                // Toggle layer drawer with '/' key
                if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                    // First, check if the event target itself is an input field
                    const target = event.target;
                    const isTargetInput = target && (
                        target.tagName === 'INPUT' ||
                        target.tagName === 'TEXTAREA' ||
                        target.contentEditable === 'true' ||
                        target.tagName === 'SL-INPUT' ||
                        target.tagName === 'SL-TEXTAREA' ||
                        target.tagName === 'MAPBOX-SEARCH-BOX' ||
                        target.type === 'text' ||
                        target.type === 'search' ||
                        target.type === 'email' ||
                        target.type === 'password' ||
                        target.type === 'number' ||
                        target.type === 'tel' ||
                        target.type === 'url'
                    );

                    if (isTargetInput) {
                        return; // Don't prevent default, let the input handle the key
                    }
                    // Check if we're in an input field or search box
                    const activeElement = document.activeElement;

                    // Comprehensive check for input fields including shadow DOM
                    const isInputField = activeElement && (
                        // Direct input elements
                        activeElement.tagName === 'INPUT' ||
                        activeElement.tagName === 'TEXTAREA' ||
                        activeElement.contentEditable === 'true' ||
                        activeElement.tagName === 'SL-INPUT' ||
                        activeElement.tagName === 'SL-TEXTAREA' ||
                        activeElement.tagName === 'MAPBOX-SEARCH-BOX' ||

                        // Check if element is inside any input container
                        activeElement.closest('mapbox-search-box') ||
                        activeElement.closest('input') ||
                        activeElement.closest('textarea') ||
                        activeElement.closest('[contenteditable="true"]') ||
                        activeElement.closest('sl-input') ||
                        activeElement.closest('sl-textarea') ||
                        activeElement.closest('sl-select') ||
                        activeElement.closest('sl-combobox') ||

                        // Check if element is inside a shadow DOM input
                        activeElement.closest('*').shadowRoot?.querySelector('input:focus') ||
                        activeElement.closest('*').shadowRoot?.querySelector('textarea:focus') ||

                        // Check for common input-related classes and attributes
                        activeElement.classList.contains('search-input') ||
                        activeElement.classList.contains('geocoder-input') ||
                        activeElement.hasAttribute('data-input') ||
                        activeElement.hasAttribute('role') && activeElement.getAttribute('role') === 'combobox' ||

                        // Check if the element or its parent has input-related properties
                        activeElement.type === 'text' ||
                        activeElement.type === 'search' ||
                        activeElement.type === 'email' ||
                        activeElement.type === 'password' ||
                        activeElement.type === 'number' ||
                        activeElement.type === 'tel' ||
                        activeElement.type === 'url'
                    );

                    // If we're in any input field, don't trigger the shortcut
                    if (isInputField) {
                        return; // Don't prevent default, let the input handle the key
                    }

                    // Additional check for Mapbox search box shadow DOM
                    const mapboxSearchBox = document.querySelector('mapbox-search-box');
                    if (mapboxSearchBox && mapboxSearchBox.shadowRoot) {
                        const shadowInput = mapboxSearchBox.shadowRoot.querySelector('input:focus');
                        if (shadowInput) {
                            return; // Don't prevent default, let the input handle the key
                        }
                    }

                    // Prevent default behavior (e.g., quick search in browsers)
                    event.preventDefault();

                    // Special case: if focused on the layer search input, blur it and toggle
                    if (activeElement && activeElement.id === 'layer-search-input') {
                        // Blur the search input and toggle the drawer
                        activeElement.blur();
                    }
                }
            });

            // Hide loading overlay after initialization is complete (only if startup choice was made)
            // Skip auto-close if manualOverlayControl is enabled (startup handler will close it)
            if (!window.loadingStartupState?.manualOverlayControl &&
                (window.loadingStartupState?.proceedNormally || window.loadingStartupState?.userLocation)) {
                requestAnimationFrame(() => {
                    const loadingOverlay = document.getElementById('loading-overlay');
                    if (loadingOverlay) {
                        loadingOverlay.style.opacity = '0';
                        loadingOverlay.style.transition = 'opacity 0.3s ease';
                        setTimeout(() => {
                            loadingOverlay.style.display = 'none';
                        }, 300);
                    }
                });
            }
        });
    }

    // Best-effort display name for a layer that hasn't been resolved yet -
    // used for the "Loading map ..." message shown while URL layers (including
    // dynamic shorthands like "osm:relation/123") are still being resolved.
    static _getQueuedLayerTitle(layer) {
        if (layer.title) return layer.title;
        if (isDynamicLayerShorthand(layer)) return `${layer.type}:${layer.id}`;
        const registryLayer = window.layerRegistry?.getLayer(layer.id);
        if (registryLayer?.title) return registryLayer.title;
        return layer.id;
    }

    // Bold name for the "Loading map ..." placeholder - no thumbnail, since the
    // layer isn't resolved yet at this point (registry lookup, shorthand
    // expansion) and would only show a generic fallback icon. The spinner
    // conveys "loading"; the real thumbnail appears once the layer actually
    // loads and map-layer-controls.js swaps this message for the confirmation.
    static _buildQueuedLayerLabel(layer, title) {
        return `<strong>${MapInitializer._escapeHtml(title)}</strong>`;
    }

    // Parses a Mapbox-style `#zoom/lat/lng` hash into { zoom, lat, lng }, or
    // null if absent/malformed. Mirrors SplashScreenManager.parseHashLocation.
    static _parseHashLocation(hash) {
        if (!hash || hash.length <= 1) return null;
        const parts = hash.substring(1).split('/');
        if (parts.length !== 3) return null;
        const zoom = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        const lng = parseFloat(parts[2]);
        if (isNaN(zoom) || isNaN(lat) || isNaN(lng)) return null;
        return { zoom, lat, lng };
    }

    // True for a layer whose `type` requires a tile/asset `url` (per
    // docs/API.md's Layer Source Formats) but doesn't have one - a sign the
    // entry is really a reference to a registry layer, not a self-contained
    // definition. See the atlas-layer-resolution loop in loadConfiguration().
    static _isUnresolvedTypeStub(layerConfig) {
        const URL_REQUIRED_TYPES = new Set(['vector', 'tms', 'wmts', 'wms', 'cog', 'img']);
        if (!URL_REQUIRED_TYPES.has(layerConfig.type)) return false;
        return !layerConfig.url && !(Array.isArray(layerConfig.tiles) && layerConfig.tiles.length > 0);
    }

    static _escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    static _configureCadastralForCurrentAtlas() {
        const registry = window.layerRegistry;
        if (!registry) return;

        const atlasId = registry.getCurrentAtlas?.() || registry._currentAtlas;
        let cadastralSearch = registry.getAtlasMetadata(atlasId)?.cadastralSearch;

        if (!cadastralSearch) {
            const urlAtlas = URLUtils.getUrlParameter('atlas');
            if (urlAtlas && urlAtlas !== 'index') {
                cadastralSearch = registry.getAtlasMetadata(urlAtlas)?.cadastralSearch;
            }
        }

        if (cadastralSearch?.parquetUrl && cadastralSearch?.villagesUrl) {
            configureCadastralSearch(cadastralSearch);
            prewarmCadastral();
        }
    }

    static _ensureCadastralSearchUI() {
        if (!window.searchControl || !window.map || !isCadastralSearchEnabled()) return;
        initCadastralSearchUI(window.map, window.searchControl);
    }

    // Initialize search box with enhanced functionality
    static initializeSearch() {
        const searchSetup = () => {
            if (window.searchControl) return;

            // Populate the search row (already added to the map, top-left)
            // with the search box, before MapSearchControl looks it up via
            // document.querySelector.
            window.searchBoxControl.mount();

            const featureStateManager = new MapFeatureStateManager(window.map);

            featureStateManager.watchLayerAdditions();

            const searchControl = new MapSearchControl(window.map);

            searchControl.setFeatureStateManager(featureStateManager);

            window.featureStateManager = featureStateManager;
            window.searchControl = searchControl;

            MapInitializer._configureCadastralForCurrentAtlas();
            MapInitializer._ensureCadastralSearchUI();
        };

        if (window.map) {
            if (window.map.isStyleLoaded()) {
                searchSetup();
            }
            window.map.on('style.load', searchSetup);
        } else {
            const checkMapInterval = setInterval(() => {
                if (window.map) {
                    clearInterval(checkMapInterval);
                    if (window.map.isStyleLoaded()) {
                        searchSetup();
                    }
                    window.map.on('style.load', searchSetup);
                }
            }, 100);
        }
    }
}
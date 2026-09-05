/**
 * Splash Screen Manager
 * Two-state UI: "Detecting user location" (with optional Allow/Deny when the
 * geolocation permission has never been answered), then "Loading map atlas of
 * <name> [Change]" once an atlas has been picked. The map loads in the
 * background; watchForMapReady auto-proceeds the splash when the map is
 * renderable.
 */

import { DataUtils } from './map-utils.js';

export class SplashScreenManager {
    constructor() {
        this.elements = {};
        this.state = {
            atlas: null,
            layers: [],
            locationSource: null,
            locationData: null,
            urlParams: new URLSearchParams(window.location.search),
            urlHash: window.location.hash,
            manualAtlasSelection: false,
            manualLocationSelection: false,
            wasLocated: false
        };
        this.autoProceed = { cancelled: false };
        this.hasProceeded = false;
    }

    async initialize() {
        window.loadingStartupState = window.loadingStartupState || {};
        window.loadingStartupState.manualOverlayControl = true;

        this.cacheElements();
        await this.parseURLConfiguration();
        this.showSplashSection();
        this.setupEventListeners();
        this.applyAtlasName();

        // URL drives atlas/coords → no detection needed, and parseURLConfiguration
        // above already resolved the atlas without the registry (see
        // loadConfigurationFromURL's local-path-first fetch). Wire up the map-ready
        // close trigger immediately in this case — waiting on waitForLayerRegistry()
        // (which fetches every atlas json in index.atlas.json's `atlases` list,
        // including slow external cross-repo ones) used to hold the splash open
        // long after the map itself was actually ready.
        //
        // The GPS/GeoIP flow below is different: it needs the full registry
        // (findBestAtlasForLocation requires _atlasMetadata populated for every
        // atlas) AND it must finish picking the location-based atlas before the
        // map is allowed to close the "Detecting user location" state — otherwise
        // a fast map 'load' (which usually beats the up-to-5s GPS cap) would snap
        // the splash closed onto the wrong (default) atlas mid-detection. So
        // watchForMapReady() stays deferred until after that flow completes, same
        // as before this fix.
        if (this.state.locationSource === 'atlas' || this.state.locationSource === 'url') {
            this.showAtlasState();
            this.watchForMapReady();
        } else {
            await this.waitForLayerRegistry();
            await this.runLocationDetectionFlow();
            this.applyAtlasName();
            this.showAtlasState();
            this.watchForMapReady();
        }
    }

    /**
     * Wait for layer registry to be fully initialized — findBestAtlasForLocation
     * needs `_atlasMetadata` populated, which only happens after the registry's
     * idempotent initialize() resolves (deduped via in-flight WeakMap shared
     * with map-init.js).
     *
     * `window.layerRegistry` is normally already set by the time this runs
     * (index.js assigns it at module-eval time, before the window `load`
     * handler that constructs SplashScreenManager). The event listener is
     * only a fallback for out-of-order execution, not the common path.
     */
    async waitForLayerRegistry() {
        if (!window.layerRegistry) {
            await new Promise((resolve) => window.addEventListener('layerRegistryReady', resolve, { once: true }));
        }
        try {
            await window.layerRegistry.initialize();
        } catch (e) {
            console.warn('[SplashScreen] Layer registry initialize failed, continuing with partial state:', e);
        }
    }

    cacheElements() {
        this.elements = {
            splashSection: document.getElementById('splash-atlas-section'),
            detectingState: document.getElementById('splash-detecting-state'),
            atlasState: document.getElementById('splash-atlas-state'),
            locatedText: document.getElementById('splash-located-text'),
            atlasName: document.getElementById('splash-atlas-name'),
            changeAtlasBtn: document.getElementById('splash-change-atlas-btn'),
            atlasDropdown: document.getElementById('splash-atlas-dropdown')
        };
    }

    showSplashSection() {
        if (this.elements.splashSection) {
            this.elements.splashSection.style.display = 'block';
        }
    }

    /**
     * Parse URL configuration and determine what to load
     */
    async parseURLConfiguration() {
        const atlasParam = this.state.urlParams.get('atlas');
        const layersParam = this.state.urlParams.get('layers');
        const hashLocation = this.parseHashLocation();

        if (atlasParam || layersParam) {
            await this.loadConfigurationFromURL(atlasParam, layersParam);
        } else {
            await this.loadDefaultConfiguration();
        }

        if (atlasParam) {
            this.state.locationSource = 'atlas';
            this.state.manualAtlasSelection = true;
        } else if (layersParam) {
            this.state.locationSource = 'atlas';
        } else if (hashLocation) {
            this.state.locationSource = 'url';
            this.state.locationData = hashLocation;
        } else {
            this.state.locationSource = 'gps';
        }
    }

    parseHashLocation() {
        if (!this.state.urlHash || this.state.urlHash.length <= 1) return null;
        const parts = this.state.urlHash.substring(1).split('/');
        if (parts.length !== 3) return null;
        const zoom = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        const lng = parseFloat(parts[2]);
        if (isNaN(lat) || isNaN(lng) || isNaN(zoom)) return null;
        return { lat, lng, zoom };
    }

    async loadConfigurationFromURL(atlasParam, layersParam) {
        try {
            let atlasConfig;
            let atlasId = 'index';

            if (atlasParam) {
                if (atlasParam.startsWith('{') && atlasParam.endsWith('}')) {
                    atlasConfig = JSON.parse(atlasParam);
                    atlasId = 'imported';
                } else if (atlasParam.startsWith('http')) {
                    const response = await fetch(atlasParam);
                    atlasConfig = await response.json();
                    atlasId = 'imported';
                } else {
                    // Short-id atlas: try the conventional local path directly first —
                    // this is the common case and avoids waiting on the full layer
                    // registry (which fetches every atlas in index.atlas.json's
                    // `atlases` list, including slow external cross-repo ones) just to
                    // show the splash / close it once the map is ready. Only consult
                    // the registry — which knows external URL mappings like dfes-dmp —
                    // if the local guess turns out to be wrong (a static-file server's
                    // SPA fallback returns index.html with a 200, not a real 404, hence
                    // the content-type check, mirrored from LayerRegistry._doInitialize).
                    let fetchUrl = `config/${atlasParam}.atlas.json`;
                    let response = await fetch(fetchUrl);
                    const contentType = response.headers.get('content-type') || '';
                    const looksLikeJson = contentType.includes('json');
                    if (!response.ok || !looksLikeJson) {
                        await this.waitForLayerRegistry();
                        const meta = window.layerRegistry?.getAtlasMetadata?.(atlasParam);
                        if (meta?.url) {
                            fetchUrl = meta.url;
                            response = await fetch(fetchUrl);
                        }
                    }
                    atlasConfig = await response.json();
                    atlasId = atlasParam;
                }
            } else {
                const response = await fetch('config/index.atlas.json');
                atlasConfig = await response.json();
            }

            this.state.atlas = this._atlasFromConfig(atlasId, atlasConfig);

            if (layersParam) {
                this.state.layers = this.parseLayersParam(layersParam);
            } else if (atlasConfig.layers) {
                this.state.layers = atlasConfig.layers.filter(l => l.initiallyChecked);
            }
        } catch (error) {
            console.error('[SplashScreen] Error loading configuration:', error);
            await this.loadFallbackConfiguration();
        }
    }

    parseLayersParam(layersParam) {
        const items = [];
        let depth = 0;
        let current = '';
        for (const char of layersParam) {
            if (char === '{') depth++;
            else if (char === '}') depth--;
            if (char === ',' && depth === 0) {
                items.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        if (current.trim()) items.push(current.trim());

        const layers = [];
        for (const item of items) {
            if (item.startsWith('{') && item.endsWith('}')) {
                const parsed = DataUtils.parseDirtyJson(item);
                if (parsed) {
                    layers.push(parsed);
                } else {
                    console.warn('[SplashScreen] Failed to parse layer JSON:', item);
                }
            } else {
                layers.push({ id: item });
            }
        }
        return layers;
    }

    async loadDefaultConfiguration() {
        try {
            const response = await fetch('config/index.atlas.json');
            const config = await response.json();
            this.state.atlas = this._atlasFromConfig('index', config);
            this.state.layers = config.layers?.filter(l => l.initiallyChecked) || [];
        } catch (error) {
            console.error('[SplashScreen] Error loading default configuration:', error);
            await this.loadFallbackConfiguration();
        }
    }

    async loadFallbackConfiguration() {
        try {
            const response = await fetch('config/index.atlas.json');
            const config = await response.json();
            this.state.atlas = {
                ...this._atlasFromConfig('index', config),
                name: 'Goa Map (Fallback)',
                description: 'Default map view',
                color: '#3b82f6'
            };
            this.state.layers = config.layers?.filter(l => l.initiallyChecked) || [];
        } catch (error) {
            console.error('[SplashScreen] Critical error: Cannot load fallback configuration');
        }
    }

    _atlasFromConfig(id, config) {
        return {
            id,
            name: config.name || config.title || 'Map',
            description: config.description || '',
            color: config.color || '#3b82f6',
            headerImage: config.headerImage || null,
            center: config.map?.center,
            zoom: config.map?.zoom,
            bbox: config.bbox
        };
    }

    /**
     * The detect-then-show flow. No artificial wait before requesting a GPS
     * fix — the browser's own native permission dialog (if permission is
     * still 'prompt') handles asking the user, so calling getCurrentPosition
     * immediately is the fastest path in every state except 'denied', where
     * asking would just fail after a delay.
     */
    async runLocationDetectionFlow() {
        let permissionState = 'prompt';
        if ('permissions' in navigator) {
            try {
                const status = await navigator.permissions.query({ name: 'geolocation' });
                permissionState = status.state;
            } catch (e) {}
        }

        this.showDetectingState();

        if (permissionState === 'denied') {
            await this.detectGeoIP();
        } else {
            await this.detectGPSThenGeoIP();
        }
        this.state.wasLocated = true;
    }

    showDetectingState() {
        if (this.elements.detectingState) this.elements.detectingState.style.display = 'block';
        if (this.elements.atlasState) this.elements.atlasState.style.display = 'none';
    }

    /**
     * Race GPS (capped at 5s inside window.handleGeolocation) against GeoIP,
     * kicked off in parallel so a slow/denied/timed-out GPS fix doesn't add
     * GeoIP's own network latency on top of the 5s cap — GeoIP is typically
     * already resolved (or close to it) by the time GPS gives up.
     */
    async detectGPSThenGeoIP() {
        if (!window.handleGeolocation) return this.detectGeoIP();

        const geoipPromise = window.handleIPLocationFallback ? window.handleIPLocationFallback() : Promise.resolve(false);
        const gpsSuccess = await window.handleGeolocation(false);
        if (this.state.manualLocationSelection) return;

        if (gpsSuccess) {
            const loc = window.loadingStartupState?.userLocation;
            if (loc) await this.applyLocationBasedAtlas(loc.lat, loc.lng, 'gps');
            return;
        }

        // GPS failed or timed out — fall back to the GeoIP request already in flight.
        await geoipPromise;
        if (this.state.manualLocationSelection) return;
        const ip = window.ipLocationData;
        if (ip?.lat && ip?.lng) await this.applyLocationBasedAtlas(ip.lat, ip.lng, 'geoip');
    }

    async detectGeoIP() {
        if (!window.handleIPLocationFallback) return;
        const success = await window.handleIPLocationFallback();
        if (success && !this.state.manualLocationSelection) {
            const ip = window.ipLocationData;
            if (ip?.lat && ip?.lng) await this.applyLocationBasedAtlas(ip.lat, ip.lng, 'geoip');
        }
    }

    /**
     * Find the smallest atlas whose bbox contains the point. Synchronous —
     * relies on layerRegistry being initialized (waitForLayerRegistry already
     * ensured this in initialize()). Delegates to LayerRegistry.findBestAtlasForPoint,
     * which is also used by map-init.js's "you've panned outside this atlas" prompt.
     */
    findBestAtlasForLocation(lat, lng) {
        return window.layerRegistry?.findBestAtlasForPoint(lng, lat) || null;
    }

    /**
     * Build URL layer list as atlas-initiallyChecked + index-initiallyChecked
     * (atlas wins on conflicts). Mirrors the merge in map-init.js so behavior
     * matches when splash drives atlas selection.
     */
    buildMergedLayerIds(atlasId) {
        const reg = window.layerRegistry;
        if (!reg) return [];
        const idsFrom = (id) => (reg.getAtlasLayers(id) || [])
            .filter(l => l.initiallyChecked)
            .map(l => l.id)
            .filter(Boolean);
        const atlasLayers = idsFrom(atlasId);
        const indexLayers = idsFrom('index');
        return [...atlasLayers, ...indexLayers.filter(id => !atlasLayers.includes(id))];
    }

    /**
     * Owned by splash: pick the best atlas for the detected coords, write the
     * URL (with hash zoom that lands directly on the user — 18 for GPS, 12 for
     * GeoIP), and refresh state so the UI matches.
     *
     * URL update must be synchronous before any await: map-init.js's
     * waitForStartupChoice polls userLocation at 50ms; once it sees the value,
     * it checks `URLUtils.getUrlParameter('atlas')` for shouldSkip. Our
     * replaceState here gates that skip — losing the race re-runs findBestAtlas
     * in map-init.js and rewrites the URL twice.
     */
    async applyLocationBasedAtlas(lat, lng, source) {
        if (this.state.manualAtlasSelection) return;

        const bestAtlasId = this.findBestAtlasForLocation(lat, lng);
        if (!bestAtlasId || bestAtlasId === this.state.atlas?.id) return;

        const hashZoom = source === 'gps' ? 18 : 12;
        const layerIds = this.buildMergedLayerIds(bestAtlasId);
        const layersParam = layerIds.length ? `&layers=${layerIds.join(',')}` : '';
        const hash = `#${hashZoom}/${lat.toFixed(6)}/${lng.toFixed(6)}`;
        // The watch can already have handed the camera back to the user by the
        // time this lands (js/geolocation-watch.js drops the param when it
        // does), so don't resurrect it here.
        const geolocateParam = window.geolocationControl?.mode === 'unlocked' ? '' : '&geolocate=true';
        const newUrl = `${window.location.pathname}?atlas=${bestAtlasId}${layersParam}${geolocateParam}${hash}`;

        // Debug: this rebuilds the URL from the detected atlas, which discards or
        // replaces whatever URL-API params the visitor arrived with (e.g. an inline
        // `layers={...}` custom layer or a `q=` search). Surface those so a dropped
        // param isn't silently lost — see docs/API.md.
        const prevParams = new URLSearchParams(window.location.search);
        const nextParams = new URLSearchParams(newUrl.split('?')[1] || '');
        const discarded = [];
        for (const [key, value] of prevParams.entries()) {
            if (nextParams.get(key) !== value) discarded.push(`${key}=${value}`);
        }
        if (discarded.length) {
            console.warn(`[SplashScreen] Location-based atlas "${bestAtlasId}" (${source}) override discarded URL params:`, discarded);
        }

        window.history.replaceState({}, '', newUrl);

        await this.loadAtlasById(bestAtlasId);
        this.state.locationSource = source;
        this.state.locationData = { lat, lng, zoom: hashZoom };
    }

    async loadAtlasById(atlasId) {
        try {
            const meta = window.layerRegistry?.getAtlasMetadata?.(atlasId);
            const fetchUrl = meta?.url || `config/${atlasId}.atlas.json`;
            const response = await fetch(fetchUrl);
            const config = await response.json();
            this.state.atlas = this._atlasFromConfig(atlasId, config);
            this.state.layers = config.layers?.filter(l => l.initiallyChecked) || [];
        } catch (error) {
            console.error('[SplashScreen] Error loading atlas:', atlasId, error);
        }
    }

    applyAtlasName() {
        if (!this.elements.atlasName) return;
        this.elements.atlasName.textContent = this.state.atlas?.name || 'Map';
        if (this.state.atlas?.color) {
            this.elements.atlasName.style.color = this.state.atlas.color;
        }
    }

    showAtlasState() {
        if (this.elements.detectingState) this.elements.detectingState.style.display = 'none';
        if (this.elements.atlasState) this.elements.atlasState.style.display = 'block';
        if (this.elements.locatedText) {
            this.elements.locatedText.style.display = this.state.wasLocated ? 'flex' : 'none';
        }
    }

    populateAtlasDropdown() {
        const dropdown = this.elements.atlasDropdown;
        const reg = window.layerRegistry;
        if (!dropdown || !reg?._atlasMetadata) return;

        dropdown.innerHTML = '';
        const currentId = this.state.atlas?.id;
        const entries = Array.from(reg._atlasMetadata.entries())
            .filter(([id]) => id !== 'index')
            .sort((a, b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0]));

        const indexMeta = reg._atlasMetadata.get('index');
        if (indexMeta) entries.unshift(['index', indexMeta]);

        entries.forEach(([id, meta]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = meta.name || id;
            if (id === currentId) opt.selected = true;
            dropdown.appendChild(opt);
        });
    }

    setupEventListeners() {
        if (this.elements.changeAtlasBtn) {
            this.elements.changeAtlasBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                // The dropdown needs every atlas's metadata, which the fast path
                // taken elsewhere in this class deliberately avoids waiting for —
                // await it here, lazily, only now that it's actually needed.
                await this.waitForLayerRegistry();
                this.populateAtlasDropdown();
                if (this.elements.atlasDropdown) this.elements.atlasDropdown.style.display = 'inline-block';
                if (this.elements.atlasName) this.elements.atlasName.style.display = 'none';
                this.elements.changeAtlasBtn.style.display = 'none';
                this.cancelAutoProceed();
            });
        }

        if (this.elements.atlasDropdown) {
            this.elements.atlasDropdown.addEventListener('change', (e) => {
                const newAtlasId = e.target.value;
                if (newAtlasId && newAtlasId !== this.state.atlas?.id) {
                    this.switchAtlas(newAtlasId);
                }
            });
        }
    }

    /**
     * Full reload with the selected atlas. The hash (if present) is preserved
     * so any detected coordinates remain in effect for the new atlas.
     */
    switchAtlas(atlasId) {
        const hash = window.location.hash || '';
        window.location.href = `${window.location.pathname}?atlas=${atlasId}${hash}`;
    }

    /**
     * Close the splash as soon as the map is renderable. We listen for the
     * earliest available signal: map.on('load') (style + initial tiles
     * parsed) — much earlier than mapDisplayReady, which is gated on a full
     * map.idle and can be several seconds after the map is usable.
     */
    watchForMapReady() {
        const proceed = () => {
            if (this.autoProceed.cancelled || this.hasProceeded) return;
            this.proceedToMap();
        };

        window.addEventListener('mapDisplayReady', proceed, { once: true });

        // `window.map` is unreliable before map-init assigns it: it can be the
        // <div id="map"> element via the named-access window proxy, or
        // undefined. Treat it as a Mapbox map only once it has `on`. If it
        // isn't ready yet, map-init.js dispatches 'mapInstanceReady' the
        // instant it constructs the map — no polling needed.
        const attachLoad = (m) => {
            if (this.autoProceed.cancelled || this.hasProceeded) return;
            if (window.mapDisplayReady) { proceed(); return; }
            if (typeof m.loaded === 'function' && m.loaded()) proceed();
            else m.once('load', proceed);
        };

        const existing = window.map;
        if (existing && typeof existing.on === 'function') {
            attachLoad(existing);
        } else {
            window.addEventListener('mapInstanceReady', (e) => attachLoad(e.detail.map), { once: true });
        }
    }

    cancelAutoProceed() {
        this.autoProceed.cancelled = true;
        if (window.cancelAutoProceed && typeof window.cancelAutoProceed === 'function') {
            window.cancelAutoProceed();
        }
    }

    proceedToMap() {
        if (this.hasProceeded) return;
        this.hasProceeded = true;

        window.loadingStartupState = {
            ...window.loadingStartupState,
            proceedNormally: true,
            selectedAtlas: this.state.atlas,
            selectedLayers: this.state.layers,
            locationSource: this.state.locationSource,
            locationData: this.state.locationData,
            manualAtlasSelection: this.state.manualAtlasSelection,
            manualLocationSelection: this.state.manualLocationSelection
        };

        this.closeLoadingOverlay();
    }

    closeLoadingOverlay() {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return;
        overlay.style.transition = 'opacity 0.3s ease';
        overlay.addEventListener('transitionend', () => { overlay.style.display = 'none'; }, { once: true });
        overlay.style.opacity = '0';
    }
}

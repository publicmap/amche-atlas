/**
 * Splash Screen Manager
 * Two-state UI: "Detecting user location" (with optional Allow/Deny when the
 * geolocation permission has never been answered), then "Loading map atlas of
 * <name> [Change]" once an atlas has been picked. The map loads in the
 * background; watchForMapReady auto-proceeds the splash when the map is
 * renderable.
 */

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

        await this.waitForLayerRegistry();
        this.cacheElements();
        await this.parseURLConfiguration();
        this.showSplashSection();
        this.setupEventListeners();
        this.applyAtlasName();

        // URL drives atlas/coords → no detection. Otherwise run the
        // detect-then-pick-atlas flow.
        if (this.state.locationSource === 'atlas' || this.state.locationSource === 'url') {
            this.showAtlasState();
        } else {
            await this.runLocationDetectionFlow();
            this.applyAtlasName();
            this.showAtlasState();
        }

        this.watchForMapReady();
    }

    /**
     * Wait for layer registry to be fully initialized — findBestAtlasForLocation
     * needs `_atlasMetadata` populated, which only happens after the registry's
     * idempotent initialize() resolves (deduped via in-flight WeakMap shared
     * with map-init.js).
     */
    async waitForLayerRegistry() {
        const waitForInstance = () => new Promise((resolve) => {
            const check = () => {
                if (window.layerRegistry) resolve();
                else setTimeout(check, 50);
            };
            check();
        });
        await waitForInstance();
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
            permissionButtons: document.getElementById('splash-permission-buttons'),
            allowBtn: document.getElementById('splash-allow-btn'),
            denyBtn: document.getElementById('splash-deny-btn'),
            allowCountdown: document.getElementById('splash-allow-countdown'),
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
                    // Short-id atlas: resolve via the registry, which knows whether the
                    // id maps to a local config/<id>.atlas.json or an external URL (e.g.
                    // a cross-repo atlas like dfes-dmp). Fetching the local path blindly
                    // returns the SPA's index.html for external atlases → JSON parse error.
                    const meta = window.layerRegistry?.getAtlasMetadata?.(atlasParam);
                    const fetchUrl = meta?.url || `config/${atlasParam}.atlas.json`;
                    const response = await fetch(fetchUrl);
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
                try {
                    layers.push(JSON.parse(item));
                } catch (e) {
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
            name: config.name || 'Map',
            description: config.description || '',
            color: config.color || '#3b82f6',
            headerImage: config.headerImage || null,
            center: config.map?.center,
            zoom: config.map?.zoom,
            bbox: config.bbox
        };
    }

    /**
     * The detect-then-show flow. Three permission states:
     *   - granted  → silent GPS detection (no Allow/Deny buttons shown)
     *   - prompt   → show "Detecting..." + Allow/Deny with 3s auto-Allow
     *   - denied   → skip GPS, go straight to GeoIP (no buttons either)
     */
    async runLocationDetectionFlow() {
        let permissionState = 'prompt';
        if ('permissions' in navigator) {
            try {
                const status = await navigator.permissions.query({ name: 'geolocation' });
                permissionState = status.state;
            } catch (e) {}
        }

        this.showDetectingState({ withPermissionButtons: permissionState === 'prompt' });

        if (permissionState === 'granted') {
            await this.detectGPSThenGeoIP();
            this.state.wasLocated = true;
            return;
        }

        if (permissionState === 'denied') {
            await this.detectGeoIP();
            this.state.wasLocated = true;
            return;
        }

        const choice = await this.waitForPermissionChoice();
        this.hidePermissionButtons();

        if (choice === 'allow') {
            await this.detectGPSThenGeoIP();
        } else {
            await this.detectGeoIP();
        }
        this.state.wasLocated = true;
    }

    showDetectingState({ withPermissionButtons }) {
        if (this.elements.detectingState) this.elements.detectingState.style.display = 'block';
        if (this.elements.atlasState) this.elements.atlasState.style.display = 'none';
        if (this.elements.permissionButtons) {
            this.elements.permissionButtons.style.display = withPermissionButtons ? 'flex' : 'none';
        }
    }

    hidePermissionButtons() {
        if (this.elements.permissionButtons) this.elements.permissionButtons.style.display = 'none';
    }

    /**
     * Resolve with 'allow' or 'deny'. 3s auto-Allow countdown — clears on click.
     */
    waitForPermissionChoice() {
        return new Promise(resolve => {
            let countdown = 3;
            let timer = null;
            const finish = (choice) => {
                if (timer) clearInterval(timer);
                resolve(choice);
            };

            if (this.elements.allowBtn) {
                this.elements.allowBtn.addEventListener('click', () => finish('allow'), { once: true });
            }
            if (this.elements.denyBtn) {
                this.elements.denyBtn.addEventListener('click', () => finish('deny'), { once: true });
            }

            timer = setInterval(() => {
                countdown--;
                if (this.elements.allowCountdown) this.elements.allowCountdown.textContent = countdown;
                if (countdown <= 0) finish('allow');
            }, 1000);
        });
    }

    async detectGPSThenGeoIP() {
        if (!window.handleGeolocation) return this.detectGeoIP();
        const success = await window.handleGeolocation(false);
        if (this.state.manualLocationSelection) return;

        if (success) {
            const loc = window.loadingStartupState?.userLocation;
            if (loc) await this.applyLocationBasedAtlas(loc.lat, loc.lng, 'gps');
        } else {
            await this.detectGeoIP();
        }
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
     * ensured this in initialize()).
     *
     * External (cross-repo) atlases are excluded: they're referenced by full
     * URL in index's `atlases` array and shouldn't be auto-selected as the
     * initial atlas purely because the user happens to be inside their bbox.
     */
    findBestAtlasForLocation(lat, lng) {
        const reg = window.layerRegistry;
        if (!reg?._atlasMetadata) return null;

        let best = null;
        for (const [atlasId, metadata] of reg._atlasMetadata.entries()) {
            if (atlasId === 'index' || !metadata.bbox) continue;
            if (metadata.isExternal) continue;
            if (!reg.isPointInAtlasBbox(atlasId, lng, lat)) continue;
            const [w, s, e, n] = metadata.bbox;
            const area = (e - w) * (n - s);
            if (!best || area < best.area) best = { id: atlasId, area };
        }
        return best?.id || null;
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
        const newUrl = `${window.location.pathname}?atlas=${bestAtlasId}${layersParam}&geolocate=true${hash}`;

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
            this.elements.changeAtlasBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
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
        // undefined. Treat it as a Mapbox map only once it has `on`.
        const attachLoad = () => {
            if (this.autoProceed.cancelled || this.hasProceeded) return;
            if (window.mapDisplayReady) { proceed(); return; }
            const m = window.map;
            const isMapboxMap = m && typeof m.on === 'function';
            if (isMapboxMap) {
                if (typeof m.loaded === 'function' && m.loaded()) proceed();
                else m.once('load', proceed);
            } else {
                setTimeout(attachLoad, 50);
            }
        };
        attachLoad();
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
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.3s ease';
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
    }
}

/**
 * Splash Screen Manager
 * Handles the initial loading screen with atlas/layer selection and location options
 */

import { LayerThumbnail } from './layer-thumbnail.js';

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
            manualLocationSelection: false
        };
        // Auto-proceed gating. We used to track delayElapsed/styleLoaded as a
        // two-gate AND, but the delay was always 0ms (one rAF) and the style
        // signal was tied to mapDisplayReady — which only fires after a full
        // map.idle (every layer/tile loaded). The result was the splash sat
        // open for seconds after the map was already usable. Now we proceed
        // on the earliest map-ready signal we can observe.
        this.autoProceed = {
            cancelled: false
        };
        this.hasProceeded = false; // Prevent multiple proceed calls
    }

    /**
     * Initialize the splash screen
     */
    async initialize() {
        // Tell map initialization NOT to auto-close the overlay
        // SplashScreenManager will control it
        window.loadingStartupState = window.loadingStartupState || {};
        window.loadingStartupState.manualOverlayControl = true;

        // Wait for layer registry to be ready
        await this.waitForLayerRegistry();

        this.cacheElements();
        // Synchronously fill the panel from URL params so the user sees real
        // info (atlas id, layer ids, hash coords) instead of "Loading..." /
        // "Detecting..." placeholders while parseURLConfiguration() fetches
        // the atlas JSON in the background.
        this.prefillPanelFromURL();
        await this.parseURLConfiguration();
        this.populateActivationPanel();
        this.setupEventListeners();

        // If URL has no atlas/hash, ask user before triggering GPS so a slow
        // permission prompt can't lose the race to a wrong-atlas GeoIP fallback.
        await this.maybeShowGPSPermissionNotice();

        // Trigger geolocation detection if needed (but don't wait for it)
        this.triggerLocationDetectionIfNeeded();

        // The button text used to be set by the (now-removed) auto-proceed
        // countdown. Set it directly here so the user sees "Loading map…"
        // until proceedToMap() runs.
        if (this.elements.openMapButton) {
            this.elements.openMapButton.textContent = 'Loading map…';
        }
        this.watchForMapReady();
    }

    /**
     * When URL has no atlas/hash, locationSource is 'gps' and we'd otherwise
     * race a browser permission prompt against GeoIP. Show an in-app notice
     * so the user can decide synchronously: Locate Now = GPS (with GeoIP
     * fallback), Later = GeoIP only. Auto-defaults to GPS after 5s.
     *
     * Skips the notice only when permission is already granted (GPS resolves
     * without a prompt — no race to worry about). In the 'denied' state we
     * still show the notice; otherwise the user just sees the atlas silently
     * jump on GeoIP, which is the exact surprise this is meant to prevent.
     * "Locate Now" with denied permission falls through to GeoIP anyway.
     */
    async maybeShowGPSPermissionNotice() {
        if (this.state.locationSource !== 'gps') return;

        if ('permissions' in navigator) {
            try {
                const status = await navigator.permissions.query({ name: 'geolocation' });
                if (status.state === 'granted') return;
            } catch (e) {}
        }

        const notice = document.getElementById('gps-permission-notice');
        const locateBtn = document.getElementById('gps-locate-now-btn');
        const laterBtn = document.getElementById('gps-later-btn');
        const locateText = document.getElementById('gps-locate-now-text');
        if (!notice || !locateBtn || !laterBtn || !locateText) return;

        notice.style.display = 'flex';

        return new Promise(resolve => {
            let countdown = 5;
            let timer = null;

            const cleanup = () => {
                if (timer) clearInterval(timer);
                notice.style.display = 'none';
            };

            const useGPS = () => {
                cleanup();
                this.state.locationSource = 'gps';
                resolve();
            };

            const useGeoIP = () => {
                cleanup();
                this.state.locationSource = 'geoip';
                this.updateLocationText();
                resolve();
            };

            locateText.textContent = `Locate Now (${countdown}s)`;
            timer = setInterval(() => {
                countdown--;
                if (countdown <= 0) {
                    useGPS();
                } else {
                    locateText.textContent = `Locate Now (${countdown}s)`;
                }
            }, 1000);

            locateBtn.addEventListener('click', useGPS, { once: true });
            laterBtn.addEventListener('click', useGeoIP, { once: true });
        });
    }

    /**
     * Trigger location detection based on locationSource.
     * For 'gps', tries device GPS first and falls back to GeoIP on failure so
     * a wrong hotspot IP doesn't pick the initial atlas.
     */
    triggerLocationDetectionIfNeeded() {
        if (this.state.locationSource === 'gps') {
            this.detectGPSThenGeoIP();
        } else if (this.state.locationSource === 'geoip') {
            this.detectGeoIP();
        }
    }

    async detectGPSThenGeoIP() {
        if ('permissions' in navigator) {
            try {
                const status = await navigator.permissions.query({ name: 'geolocation' });
                if (status.state === 'denied') {
                    console.log('[SplashScreen] GPS permission denied, using GeoIP');
                    return this.fallbackToGeoIP();
                }
            } catch (e) {}
        }

        if (!window.handleGeolocation) {
            return this.fallbackToGeoIP();
        }

        console.log('[SplashScreen] Trying GPS first');
        const success = await window.handleGeolocation(false);

        if (this.state.manualLocationSelection) return;

        if (success) {
            // Synchronously update URL with best atlas before map-init.js's race
            // callback (50ms cadence) sees userLocation and runs its own detection.
            const loc = window.loadingStartupState?.userLocation;
            if (loc) {
                console.log(
                    `[SplashScreen] GPS resolved at t=${Math.round(performance.now())}ms:`,
                    `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)} — applying atlas`
                );
                await this.applyLocationBasedAtlas(loc.lat, loc.lng, 'gps');
            }
            console.log(`[SplashScreen] GPS detection succeeded at t=${Math.round(performance.now())}ms`);
            this.updateLocationText();
        } else {
            console.log('[SplashScreen] GPS detection failed, falling back to GeoIP');
            this.fallbackToGeoIP();
        }
    }

    async fallbackToGeoIP() {
        this.state.locationSource = 'geoip';
        this.updateLocationText();
        await this.detectGeoIP();
    }

    async detectGeoIP() {
        if (!window.handleIPLocationFallback) return;
        console.log('[SplashScreen] Triggering GeoIP location detection');
        const success = await window.handleIPLocationFallback();
        if (success && !this.state.manualLocationSelection) {
            const ip = window.ipLocationData;
            if (ip?.lat && ip?.lng) await this.applyLocationBasedAtlas(ip.lat, ip.lng, 'geoip');
            console.log('[SplashScreen] GeoIP detection completed');
            this.updateLocationText();
        }
    }

    /**
     * Find the smallest atlas whose bbox contains the point. Synchronous —
     * relies on layerRegistry being initialized (waitForLayerRegistry already
     * ensured this in initialize()).
     */
    findBestAtlasForLocation(lat, lng) {
        const reg = window.layerRegistry;
        if (!reg?._atlasMetadata) return null;

        let best = null;
        for (const [atlasId, metadata] of reg._atlasMetadata.entries()) {
            if (atlasId === 'index' || !metadata.bbox) continue;
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
     * GeoIP), and re-render the panel so the UI matches.
     *
     * Why URL update must be synchronous before any await: map-init.js's
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
        window.history.replaceState({}, '', newUrl);
        console.log('[SplashScreen] Auto-selected atlas:', bestAtlasId, 'for', source, 'location');

        await this.loadAtlasById(bestAtlasId);
        // loadAtlasById sets locationSource='atlas' — restore detected source
        this.state.locationSource = source;
        this.state.locationData = { lat, lng, zoom: hashZoom };
        this.populateActivationPanel();
    }

    /**
     * Wait for layer registry to be fully initialized. We can't just check
     * `_atlasMetadata` truthiness — the Map is created (empty) in the
     * LayerRegistry constructor at module load, so that check passes before
     * any atlas JSON has been fetched. findBestAtlasForLocation needs the
     * Map *populated*, so await the registry's idempotent initialize() —
     * it dedupes concurrent calls with map-init.js via an in-flight WeakMap.
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

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            activationPanel: document.getElementById('map-activation-panel'),
            headerImage: document.getElementById('activation-header-image'),
            atlasName: document.getElementById('activation-atlas-name'),
            atlasDescription: document.getElementById('activation-atlas-description'),
            layersList: document.getElementById('activation-layers-list'),
            locationBtn: document.getElementById('activation-location-btn'),
            locationText: document.getElementById('activation-location-text'),
            locationDropdown: document.getElementById('activation-location-dropdown'),
            openMapButton: document.getElementById('activation-open-map')
        };
    }

    /**
     * Parse URL configuration and determine what to load
     */
    async parseURLConfiguration() {
        const atlasParam = this.state.urlParams.get('atlas');
        const layersParam = this.state.urlParams.get('layers');
        const hashLocation = this.parseHashLocation();

        // Parse atlas and layers first
        if (atlasParam || layersParam) {
            await this.loadConfigurationFromURL(atlasParam, layersParam);
        } else {
            // No URL params - use auto-detection or index atlas
            await this.loadDefaultConfiguration();
        }

        // Determine location source AFTER loading atlas
        // If explicit atlas parameter is provided, treat it as manual selection
        if (atlasParam) {
            // User explicitly requested an atlas - don't override with location detection
            this.state.locationSource = 'atlas';
            this.state.manualAtlasSelection = true;
            console.log('[SplashScreen] Explicit atlas parameter detected - treating as manual selection');
        } else if (hashLocation) {
            // Hash location in URL takes precedence
            this.state.locationSource = 'url';
            this.state.locationData = hashLocation;
        } else {
            // Try GPS first, fall back to GeoIP on failure.
            // GeoIP on hotspots/VPNs can pick the wrong atlas before GPS corrects it.
            this.state.locationSource = 'gps';
        }
    }

    /**
     * Parse location from URL hash (#zoom/lat/lng)
     */
    parseHashLocation() {
        if (!this.state.urlHash || this.state.urlHash.length <= 1) {
            return null;
        }

        const hash = this.state.urlHash.substring(1);
        const parts = hash.split('/');

        if (parts.length === 3) {
            const zoom = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            const lng = parseFloat(parts[2]);

            if (!isNaN(lat) && !isNaN(lng) && !isNaN(zoom)) {
                return { lat, lng, zoom };
            }
        }

        return null;
    }

    /**
     * Load configuration from URL parameters
     */
    async loadConfigurationFromURL(atlasParam, layersParam) {
        try {
            // Load atlas config
            let atlasConfig;
            let atlasId = 'index';

            if (atlasParam) {
                if (atlasParam.startsWith('{') && atlasParam.endsWith('}')) {
                    // Inline JSON
                    atlasConfig = JSON.parse(atlasParam);
                    atlasId = 'imported';
                } else if (atlasParam.startsWith('http')) {
                    // Remote URL
                    const response = await fetch(atlasParam);
                    atlasConfig = await response.json();
                    atlasId = 'imported';
                } else {
                    // Local file
                    const response = await fetch(`config/${atlasParam}.atlas.json`);
                    atlasConfig = await response.json();
                    atlasId = atlasParam;
                }
            } else {
                // Default to index
                const response = await fetch('config/index.atlas.json');
                atlasConfig = await response.json();
            }

            this.state.atlas = {
                id: atlasId,
                name: atlasConfig.name || 'Map',
                description: atlasConfig.description || '',
                color: atlasConfig.color || '#3b82f6',
                headerImage: atlasConfig.headerImage || null,
                center: atlasConfig.map?.center,
                zoom: atlasConfig.map?.zoom,
                bbox: atlasConfig.bbox
            };

            // Parse layers
            if (layersParam) {
                this.state.layers = await this.parseLayersParam(layersParam);
            } else if (atlasConfig.layers) {
                this.state.layers = atlasConfig.layers.filter(l => l.initiallyChecked);
            }

        } catch (error) {
            console.error('[SplashScreen] Error loading configuration:', error);
            await this.loadFallbackConfiguration();
        }
    }

    /**
     * Parse layers parameter from URL
     */
    async parseLayersParam(layersParam) {
        const layers = [];
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

        for (const item of items) {
            const trimmed = item.trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    layers.push(JSON.parse(trimmed));
                } catch (e) {
                    console.warn('[SplashScreen] Failed to parse layer JSON:', trimmed);
                }
            } else {
                layers.push({ id: trimmed });
            }
        }

        return layers;
    }

    /**
     * Load default configuration (index atlas)
     */
    async loadDefaultConfiguration() {
        try {
            const response = await fetch('config/index.atlas.json');
            const config = await response.json();

            this.state.atlas = {
                id: 'index',
                name: config.name || 'Map',
                description: config.description || '',
                color: config.color || '#3b82f6',
                headerImage: config.headerImage || null,
                center: config.map?.center,
                zoom: config.map?.zoom,
                bbox: config.bbox
            };

            this.state.layers = config.layers?.filter(l => l.initiallyChecked) || [];
        } catch (error) {
            console.error('[SplashScreen] Error loading default configuration:', error);
            await this.loadFallbackConfiguration();
        }
    }

    /**
     * Fallback to index.atlas.json on any error
     */
    async loadFallbackConfiguration() {
        try {
            const response = await fetch('config/index.atlas.json');
            const config = await response.json();

            this.state.atlas = {
                id: 'index',
                name: 'Goa Map (Fallback)',
                description: 'Default map view',
                color: '#3b82f6',
                headerImage: null,
                center: config.map?.center || [73.8274, 15.4406],
                zoom: config.map?.zoom || 9
            };

            this.state.layers = config.layers?.filter(l => l.initiallyChecked) || [];
        } catch (error) {
            console.error('[SplashScreen] Critical error: Cannot load fallback configuration');
        }
    }

    /**
     * Synchronous fast-fill from URL params. Runs before parseURLConfiguration()
     * has fetched the atlas JSON, so the panel shows useful info immediately
     * rather than the "Loading..." / "Detecting..." placeholders.
     */
    prefillPanelFromURL() {
        const atlasParam = this.state.urlParams.get('atlas');
        const layersParam = this.state.urlParams.get('layers');
        const hashLocation = this.parseHashLocation();

        if (this.elements.activationPanel) {
            this.elements.activationPanel.style.display = 'block';
        }

        if (this.elements.atlasName) {
            let display;
            if (!atlasParam) {
                display = 'Map';
            } else if (atlasParam.startsWith('{')) {
                display = 'Custom map';
            } else if (atlasParam.startsWith('http')) {
                display = 'Imported map';
            } else {
                display = atlasParam.charAt(0).toUpperCase() + atlasParam.slice(1);
            }
            this.elements.atlasName.textContent = display;
        }

        if (this.elements.layersList && layersParam) {
            this.elements.layersList.innerHTML = '';
            // Split on top-level commas (don't split inside {...} layer JSON)
            const items = [];
            let depth = 0, current = '';
            for (const ch of layersParam) {
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
                if (ch === ',' && depth === 0) { items.push(current.trim()); current = ''; }
                else current += ch;
            }
            if (current.trim()) items.push(current.trim());

            items.forEach(id => {
                if (id === 'selection') return;
                const chip = document.createElement('div');
                chip.style.cssText = 'display:flex;align-items:center;gap:5px;padding:3px 8px;background:rgba(255,255,255,0.07);border-radius:12px;border:1px solid rgba(255,255,255,0.12);';
                const name = document.createElement('span');
                name.textContent = id.startsWith('{') ? 'custom' : id;
                name.style.cssText = 'color:#e5e7eb;font-size:0.75rem;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;';
                chip.appendChild(name);
                this.elements.layersList.appendChild(chip);
            });
        }

        if (this.elements.locationText) {
            if (hashLocation) {
                this.elements.locationText.textContent =
                    `${hashLocation.lat.toFixed(2)}, ${hashLocation.lng.toFixed(2)}`;
            } else if (atlasParam) {
                // URL specifies atlas -> location detection will be skipped;
                // surface that immediately instead of "Detecting...".
                this.elements.locationText.textContent = 'Atlas default';
            }
        }
    }

    /**
     * Populate the activation panel with current state
     */
    populateActivationPanel() {
        if (!this.elements.activationPanel) return;

        this.elements.activationPanel.style.display = 'block';

        if (this.state.atlas) {
            // Header thumbnail
            if (this.elements.headerImage && this.state.atlas.headerImage) {
                this.elements.headerImage.src = this.state.atlas.headerImage;
                this.elements.headerImage.style.display = 'block';
            } else if (this.elements.headerImage) {
                this.elements.headerImage.style.display = 'none';
            }

            if (this.elements.atlasName) {
                this.elements.atlasName.textContent = this.state.atlas.name;
                this.elements.atlasName.style.color = this.state.atlas.color;
            }

            if (this.elements.atlasDescription && this.state.atlas.description) {
                this.elements.atlasDescription.innerHTML = this.state.atlas.description;
                this.elements.atlasDescription.style.display = 'block';
            }
        }

        // Compact layer chips
        if (this.elements.layersList) {
            this.elements.layersList.innerHTML = '';

            const displayLayers = this.state.layers.filter(l => l.id !== 'selection');
            if (displayLayers.length > 0) {
                displayLayers.forEach(layer => {
                    let fullLayer = layer;

                    if (layer.id && window.layerRegistry) {
                        try {
                            const originalWarn = console.warn;
                            console.warn = () => {};
                            const registryLayer = window.layerRegistry.getLayer(layer.id);
                            console.warn = originalWarn;
                            if (registryLayer) fullLayer = { ...registryLayer, ...layer };
                        } catch (e) {}
                    }

                    const chip = document.createElement('div');
                    chip.style.cssText = 'display:flex;align-items:center;gap:5px;padding:3px 8px 3px 4px;background:rgba(255,255,255,0.07);border-radius:12px;border:1px solid rgba(255,255,255,0.12);';

                    if (fullLayer.type) {
                        try {
                            const thumb = LayerThumbnail.generate(fullLayer, 18, { isInView: true });
                            thumb.style.borderRadius = '50%';
                            chip.appendChild(thumb);
                        } catch (e) {}
                    }

                    const name = document.createElement('span');
                    name.textContent = fullLayer.title || fullLayer.id || 'Layer';
                    name.style.cssText = 'color:#e5e7eb;font-size:0.75rem;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;';
                    chip.appendChild(name);
                    this.elements.layersList.appendChild(chip);
                });
            }
        }

        // Show URL option only if there's a hash location
        const urlOption = document.getElementById('location-option-url');
        if (urlOption) {
            urlOption.style.display = this.parseHashLocation() ? 'block' : 'none';
        }

        this.updateLocationText();
    }

    /**
     * Update the location button text based on current locationSource
     */
    updateLocationText() {
        if (!this.elements.locationText) return;

        switch (this.state.locationSource) {
            case 'geoip':
                if (window.ipLocationData?.city) {
                    this.elements.locationText.textContent = window.ipLocationData.city;
                } else {
                    this.elements.locationText.textContent = 'Detecting...';
                }
                break;
            case 'gps':
                this.elements.locationText.textContent = window.loadingStartupState?.userLocation
                    ? 'GPS'
                    : 'Detecting...';
                break;
            case 'atlas':
                this.elements.locationText.textContent = this.state.atlas?.name || 'Atlas default';
                break;
            case 'url':
                if (this.state.locationData) {
                    this.elements.locationText.textContent = `${this.state.locationData.lat.toFixed(2)}, ${this.state.locationData.lng.toFixed(2)}`;
                } else {
                    this.elements.locationText.textContent = 'From URL';
                }
                break;
            default:
                this.elements.locationText.textContent = 'Auto';
        }
    }

    /**
     * Apply current locationSource to the map camera (for post-load interactions)
     */
    _applyLocationToMap() {
        const source = this.state.locationSource;
        const doFly = (map) => {
            if (source === 'atlas' && this.state.atlas?.center) {
                map.flyTo({ center: this.state.atlas.center, zoom: this.state.atlas.zoom || 10, essential: true });
            } else if (source === 'geoip' && window.ipLocationData) {
                map.flyTo({ center: [window.ipLocationData.lng, window.ipLocationData.lat], zoom: 12, essential: true });
            } else if (source === 'gps') {
                if (window.handleGeolocation) window.handleGeolocation(false);
            } else if (source === 'url' && this.state.locationData) {
                map.flyTo({ center: [this.state.locationData.lng, this.state.locationData.lat], zoom: this.state.locationData.zoom, essential: true });
            }
        };

        if (window.map) {
            if (window.map.loaded()) {
                doFly(window.map);
            } else {
                window.map.once('load', () => doFly(window.map));
            }
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Location dropdown toggle
        if (this.elements.locationBtn) {
            this.elements.locationBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const dd = this.elements.locationDropdown;
                if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
            });
        }

        // Location option selection
        if (this.elements.locationDropdown) {
            this.elements.locationDropdown.querySelectorAll('.location-option').forEach(opt => {
                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.state.locationSource = opt.dataset.value;
                    this.state.manualLocationSelection = true;
                    this.elements.locationDropdown.style.display = 'none';
                    this.updateLocationText();
                    this.cancelAutoProceed();
                    this._applyLocationToMap();
                });
            });
        }

        // Close dropdown on outside click
        document.addEventListener('click', () => {
            if (this.elements.locationDropdown) {
                this.elements.locationDropdown.style.display = 'none';
            }
        });

        // Open Map button - first click cancels auto-proceed, second click proceeds
        if (this.elements.openMapButton) {
            this.elements.openMapButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (!this.autoProceed.cancelled) {
                    this.cancelAutoProceed();
                } else {
                    this.proceedToMap();
                }
            });
        }
    }

    /**
     * Load atlas by ID
     */
    async loadAtlasById(atlasId) {
        try {
            const response = await fetch(`config/${atlasId}.atlas.json`);
            const config = await response.json();

            this.state.atlas = {
                id: atlasId,
                name: config.name || 'Map',
                description: config.description || '',
                color: config.color || '#3b82f6',
                headerImage: config.headerImage || null,
                center: config.map?.center,
                zoom: config.map?.zoom,
                bbox: config.bbox
            };

            this.state.layers = config.layers?.filter(l => l.initiallyChecked) || [];

            // Update location source to atlas default
            this.state.locationSource = 'atlas';

        } catch (error) {
            console.error('[SplashScreen] Error loading atlas:', atlasId, error);
        }
    }

    /**
     * Close the splash as soon as the map is renderable. We listen for the
     * earliest available signal: map.on('load') (style + initial tiles
     * parsed) — much earlier than the previous mapDisplayReady event, which
     * was gated on a full map.idle and could be several seconds after the
     * map was already visible/interactive.
     */
    watchForMapReady() {
        const proceed = () => {
            if (this.autoProceed.cancelled || this.hasProceeded) return;
            console.log(`[SplashScreen] Map ready at t=${Math.round(performance.now())}ms, proceeding`);
            this.proceedToMap();
        };

        // Always listen for the parent's signal as one fallback path.
        window.addEventListener('mapDisplayReady', proceed, { once: true });

        // `window.map` is unreliable in two ways before map-init assigns it:
        // (a) it can be the <div id="map"> element exposed via the named-
        //     access window proxy, and
        // (b) it can be undefined.
        // Treat it as a real Mapbox map only once it has the `on` method.
        const attachLoad = () => {
            if (this.autoProceed.cancelled || this.hasProceeded) return;
            if (window.mapDisplayReady) { proceed(); return; }
            const m = window.map;
            const isMapboxMap = m && typeof m.on === 'function';
            if (isMapboxMap) {
                if (typeof m.loaded === 'function' && m.loaded()) proceed();
                else m.once('load', proceed);
            } else {
                // map-init.js hasn't created the map yet; check again shortly.
                setTimeout(attachLoad, 50);
            }
        };
        attachLoad();
    }

    /**
     * Cancel auto-proceed
     */
    cancelAutoProceed() {
        this.autoProceed.cancelled = true;

        // Also notify the inline JavaScript to cancel its auto-proceed
        if (window.cancelAutoProceed && typeof window.cancelAutoProceed === 'function') {
            window.cancelAutoProceed();
        }

        if (this.elements.openMapButton) {
            this.elements.openMapButton.textContent = 'Open Map';
            this.elements.openMapButton.disabled = false;
        }
        console.log('[SplashScreen] Auto-proceed cancelled - click "Open Map" to continue');
    }

    /**
     * Proceed to map with current configuration
     */
    proceedToMap() {
        // Prevent multiple calls
        if (this.hasProceeded) {
            console.log('[SplashScreen] Already proceeding to map, ignoring duplicate call');
            return;
        }
        this.hasProceeded = true;

        // Set global state for map initialization
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

        console.log('[SplashScreen] Proceeding to map with configuration:', this.state);

        // Apply location to already-loaded map (if user changed location after map started loading)
        if (this.state.manualLocationSelection) {
            this._applyLocationToMap();
        }

        this.closeLoadingOverlay();
    }

    /**
     * Close the loading overlay with animation
     */
    closeLoadingOverlay() {
        const loadingOverlay = document.getElementById('loading-overlay');
        if (loadingOverlay) {
            console.log('[SplashScreen] Closing loading overlay');
            loadingOverlay.style.opacity = '0';
            loadingOverlay.style.transition = 'opacity 0.3s ease';
            setTimeout(() => {
                loadingOverlay.style.display = 'none';
            }, 300);
        }
    }
}

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
        this.autoProceed = {
            enabled: true,
            minDelay: 5000, // 5 seconds minimum
            timer: null,
            delayElapsed: false,
            styleLoaded: false,
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
        await this.parseURLConfiguration();
        this.populateActivationPanel();
        this.setupEventListeners();

        // Trigger geolocation detection if needed (but don't wait for it)
        this.triggerLocationDetectionIfNeeded();

        this.startAutoProceedTimer();
        this.watchForStyleLoad();
    }

    /**
     * Trigger location detection based on locationSource
     * This runs in the background and doesn't block the UI
     */
    triggerLocationDetectionIfNeeded() {
        if (this.state.locationSource === 'geoip') {
            if (window.handleIPLocationFallback) {
                console.log('[SplashScreen] Triggering GeoIP location detection');
                window.handleIPLocationFallback().then(success => {
                    if (success && !this.state.manualLocationSelection) {
                        console.log('[SplashScreen] GeoIP detection completed');
                        this.updateLocationText();
                    }
                });
            }
        } else if (this.state.locationSource === 'gps') {
            if (window.handleGeolocation) {
                console.log('[SplashScreen] Triggering GPS location detection');
                window.handleGeolocation(false);
            }
        }
    }

    /**
     * Wait for layer registry to be initialized
     */
    async waitForLayerRegistry() {
        return new Promise((resolve) => {
            const checkRegistry = () => {
                if (window.layerRegistry && window.layerRegistry._atlasMetadata) {
                    resolve();
                } else {
                    setTimeout(checkRegistry, 100);
                }
            };
            checkRegistry();
        });
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
            openMapButton: document.getElementById('activation-open-map'),
            atlasCards: document.querySelectorAll('.atlas-card')
        };
    }

    /**
     * Parse URL configuration and determine what to load
     */
    async parseURLConfiguration() {
        const atlasParam = this.state.urlParams.get('atlas');
        const layersParam = this.state.urlParams.get('layers');
        const geolocateParam = this.state.urlParams.get('geolocate');
        const hashLocation = this.parseHashLocation();

        // Check if user has granted GPS permission before
        const hasGrantedGPS = localStorage.getItem('gps-permission-granted') === 'true';

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
        } else if (geolocateParam === 'true') {
            // Handle ?geolocate=true - auto-select GPS
            this.state.locationSource = 'gps';
        } else if (hashLocation) {
            // Hash location in URL takes precedence
            this.state.locationSource = 'url';
            this.state.locationData = hashLocation;
        } else if (hasGrantedGPS) {
            // Prefer GPS if previously granted (only when no explicit atlas)
            this.state.locationSource = 'gps';
        } else {
            // Default to GeoIP
            this.state.locationSource = 'geoip';
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
        const items = layersParam.split(',');

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

            if (this.state.layers.length > 0) {
                this.state.layers.forEach(layer => {
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
                this.elements.locationText.textContent = 'GPS';
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

        // Atlas card selection
        this.elements.atlasCards.forEach(card => {
            card.addEventListener('click', async () => {
                const atlasId = card.dataset.atlasId;
                if (atlasId) {
                    this.cancelAutoProceed();
                    await this.loadAtlasById(atlasId);
                    this.state.manualAtlasSelection = true;
                    this.populateActivationPanel();
                }
            });
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
     * Store GPS permission grant in localStorage
     */
    static rememberGPSPermission() {
        try {
            localStorage.setItem('gps-permission-granted', 'true');
            console.log('[SplashScreen] GPS permission remembered');
        } catch (e) {
            console.warn('[SplashScreen] Failed to store GPS permission:', e);
        }
    }

    /**
     * Start auto-proceed timer (5 second minimum)
     */
    startAutoProceedTimer() {
        const startTime = Date.now();

        const updateCountdown = () => {
            if (this.autoProceed.cancelled) {
                console.log('[SplashScreen] Auto-proceed countdown stopped');
                return;
            }

            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, this.autoProceed.minDelay - elapsed);
            const seconds = Math.ceil(remaining / 1000);

            // Update countdown display with cancel instruction
            if (this.elements.openMapButton && seconds > 0) {
                this.elements.openMapButton.textContent = `Click to cancel (${seconds}s)`;
            } else if (this.elements.openMapButton && !this.autoProceed.styleLoaded) {
                this.elements.openMapButton.textContent = 'Map loading...';
            }

            if (remaining > 0) {
                requestAnimationFrame(updateCountdown);
            } else {
                this.autoProceed.delayElapsed = true;
                this.checkAutoProceedReady();
            }
        };

        updateCountdown();
    }

    /**
     * Watch for map to be ready for display (style loaded + initial move initiated)
     */
    watchForStyleLoad() {
        const onReady = () => {
            if (this.autoProceed.cancelled) return;
            this.autoProceed.styleLoaded = true;
            this.checkAutoProceedReady();
        };

        // Already fired before we set up listener
        if (window.mapDisplayReady) {
            onReady();
            return;
        }

        window.addEventListener('mapDisplayReady', onReady, { once: true });

        // Fallback: if mapDisplayReady event never fires, use map.idle
        const fallback = () => {
            if (this.autoProceed.cancelled || this.autoProceed.styleLoaded) return;
            if (window.map) {
                window.map.once('idle', onReady);
            } else {
                setTimeout(fallback, 500);
            }
        };
        setTimeout(fallback, 5000);
    }

    /**
     * Check if both conditions are met and proceed
     */
    checkAutoProceedReady() {
        if (this.autoProceed.cancelled) {
            console.log('[SplashScreen] Auto-proceed cancelled, not checking conditions');
            return;
        }

        console.log('[SplashScreen] Checking auto-proceed conditions:', {
            delayElapsed: this.autoProceed.delayElapsed,
            styleLoaded: this.autoProceed.styleLoaded,
            cancelled: this.autoProceed.cancelled
        });

        if (this.autoProceed.delayElapsed && this.autoProceed.styleLoaded) {
            console.log('[SplashScreen] Auto-proceed conditions met, proceeding to map');
            this.proceedToMap();
        } else {
            console.log('[SplashScreen] Waiting for conditions to be met');
        }
    }

    /**
     * Cancel auto-proceed
     */
    cancelAutoProceed() {
        this.autoProceed.cancelled = true;
        this.autoProceed.delayElapsed = false;
        this.autoProceed.styleLoaded = false;

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

        // If GPS is selected, remember the permission for next time
        if (this.state.locationSource === 'gps') {
            SplashScreenManager.rememberGPSPermission();
        }

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

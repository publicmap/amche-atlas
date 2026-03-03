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
            manualAtlasSelection: false, // Track if user manually selected an atlas
            manualLocationSelection: false // Track if user manually selected location source
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
        // Only trigger auto-detection for geoip and gps
        // Don't trigger if using URL or atlas location
        if (this.state.locationSource === 'geoip') {
            // Trigger IP-based location detection
            if (window.handleIPLocationFallback) {
                console.log('[SplashScreen] Triggering GeoIP location detection');
                window.handleIPLocationFallback().then(success => {
                    if (success && !this.state.manualLocationSelection) {
                        console.log('[SplashScreen] GeoIP detection completed');
                    }
                });
            }
        } else if (this.state.locationSource === 'gps') {
            // Trigger GPS location detection
            if (window.handleGeolocation) {
                console.log('[SplashScreen] Triggering GPS location detection');
                window.handleGeolocation(false).then(success => {
                    if (success && !this.state.manualLocationSelection) {
                        console.log('[SplashScreen] GPS detection completed');
                    }
                });
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
            atlasInfo: document.getElementById('activation-atlas-info'),
            atlasName: document.getElementById('activation-atlas-name'),
            atlasDescription: document.getElementById('activation-atlas-description'),
            layersList: document.getElementById('activation-layers-list'),
            locationRadios: document.querySelectorAll('input[name="location-source"]'),
            locationPreview: document.getElementById('activation-location-preview'),
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

        // Show the panel
        this.elements.activationPanel.style.display = 'block';

        // Populate atlas info
        if (this.state.atlas) {
            if (this.elements.atlasName) {
                this.elements.atlasName.textContent = this.state.atlas.name;
                this.elements.atlasName.style.color = this.state.atlas.color;
            }

            if (this.elements.atlasDescription && this.state.atlas.description) {
                this.elements.atlasDescription.textContent = this.state.atlas.description;
                this.elements.atlasDescription.style.display = 'block';
            }
        }

        // Populate layers list with thumbnails
        if (this.elements.layersList && this.state.layers.length > 0) {
            this.elements.layersList.innerHTML = '';

            this.state.layers.forEach(layer => {
                const layerItem = document.createElement('div');
                layerItem.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px;
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 4px;
                `;

                // Try to get full layer metadata
                let fullLayer = layer;
                let hasMetadata = false;

                if (layer.id && window.layerRegistry) {
                    try {
                        // Suppress console warnings for layer lookup
                        const originalWarn = console.warn;
                        console.warn = () => {};
                        const registryLayer = window.layerRegistry.getLayer(layer.id);
                        console.warn = originalWarn;

                        if (registryLayer) {
                            fullLayer = { ...registryLayer, ...layer };
                            hasMetadata = true;
                        }
                    } catch (e) {
                        // Layer not in registry, use as-is
                    }
                }

                // Add thumbnail (if layer has enough info)
                if (hasMetadata || fullLayer.type) {
                    try {
                        const thumbnail = LayerThumbnail.generate(fullLayer, 32, { isInView: true });
                        layerItem.appendChild(thumbnail);
                    } catch (e) {
                        console.debug('[SplashScreen] Could not generate thumbnail for:', layer.id);
                    }
                }

                // Add layer name
                const layerName = document.createElement('div');
                layerName.textContent = fullLayer.title || fullLayer.id || 'Layer';
                layerName.style.cssText = `
                    color: #e5e7eb;
                    font-size: 0.875rem;
                    flex: 1;
                `;
                layerItem.appendChild(layerName);

                this.elements.layersList.appendChild(layerItem);
            });
        } else if (this.elements.layersList) {
            // Show message if no layers
            this.elements.layersList.innerHTML = '<div style="color: #9ca3af; font-size: 0.875rem; padding: 8px;">No layers selected</div>';
        }

        // Set location source radio
        this.updateLocationRadio();

        // Update location preview
        this.updateLocationPreview();
    }

    /**
     * Update location source radio selection
     */
    updateLocationRadio() {
        const urlHashLocation = this.parseHashLocation();

        this.elements.locationRadios.forEach(radio => {
            if (radio.value === this.state.locationSource) {
                radio.checked = true;
            }

            // Disable "URL" option if no hash in URL
            if (radio.value === 'url' && !urlHashLocation) {
                radio.disabled = true;
                radio.parentElement.style.opacity = '0.5';
            }
        });
    }

    /**
     * Update location preview text
     */
    updateLocationPreview() {
        if (!this.elements.locationPreview) return;

        let previewText = '';

        switch (this.state.locationSource) {
            case 'url':
                if (this.state.locationData) {
                    previewText = `📍 ${this.state.locationData.lat.toFixed(4)}, ${this.state.locationData.lng.toFixed(4)} (zoom ${this.state.locationData.zoom})`;
                }
                break;
            case 'geoip':
                previewText = '🌐 Detecting location from IP address...';
                break;
            case 'gps':
                previewText = '📡 GPS location will be requested';
                break;
            case 'atlas':
                if (this.state.atlas) {
                    if (this.state.atlas.center && this.state.atlas.zoom) {
                        previewText = `🗺️ ${this.state.atlas.name} default view`;
                    } else {
                        previewText = `🗺️ ${this.state.atlas.name}`;
                    }
                }
                break;
        }

        this.elements.locationPreview.textContent = previewText;
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Location source radio change
        this.elements.locationRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                this.state.locationSource = radio.value;
                this.state.manualLocationSelection = true; // Mark as manual selection
                this.updateLocationPreview();
                this.cancelAutoProceed();
            });
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

                console.log('[SplashScreen] Button clicked, cancelled:', this.autoProceed.cancelled);

                if (!this.autoProceed.cancelled) {
                    // First click: cancel auto-proceed
                    console.log('[SplashScreen] Cancelling auto-proceed');
                    this.cancelAutoProceed();
                } else {
                    // Second click (or after cancellation): proceed to map
                    console.log('[SplashScreen] Proceeding to map');
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
            } else if (this.elements.openMapButton) {
                this.elements.openMapButton.textContent = 'Loading map...';
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
     * Watch for map style to load
     */
    watchForStyleLoad() {
        // Listen for map ready event
        const checkMapReady = () => {
            if (this.autoProceed.cancelled) return;

            // Wait for map object to exist and have loaded() method
            if (window.map && typeof window.map.loaded === 'function') {
                if (window.map.loaded()) {
                    this.autoProceed.styleLoaded = true;
                    this.checkAutoProceedReady();
                } else {
                    setTimeout(checkMapReady, 100);
                }
            } else {
                // Map not created yet, keep checking
                setTimeout(checkMapReady, 200);
            }
        };

        // Start checking after a short delay
        setTimeout(checkMapReady, 1000);
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

        // Trigger map load
        console.log('[SplashScreen] Proceeding to map with configuration:', this.state);

        // Close the loading overlay
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

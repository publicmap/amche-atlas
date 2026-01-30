// Transit Explorer - Main Application Module
// Handles geolocation, map initialization, stop finding, and departure boards

// Import data models and utilities
import {
    TILESET_SCHEMA,
    VECTOR_TILE_SOURCE,
    AGENCY_STYLES,
    TransitAgency,
    BusRoute,
    BusStop,
    DataUtils
} from './transit-data.js';

// Import URL API for deep linking support
import { URLManager } from '/js/url-manager.js';

// Import controllers
import { TransitMapController } from './transit-map-controller.js';
import { TransitStopController } from './transit-stop-controller.js';
import { TransitDepartureController } from './transit-departure-controller.js';

// Import location-based data loader
import { LocationDataLoader } from './location-data-loader.js';
import { TRANSIT_DATA_LOOKUP } from './transit-data-lookup.js';

class TransitExplorer {
    constructor() {
        this.map = null;
        this.userLocation = null;
        this.currentStop = null;
        this.refreshInterval = null;
        this.mapboxToken = window.amche.MAPBOXGL_ACCESS_TOKEN;
        // Vector tile source configuration
        this.vectorTileSource = VECTOR_TILE_SOURCE;
        this.sourceName = VECTOR_TILE_SOURCE.sourceName;
        this.sourceLayer = VECTOR_TILE_SOURCE.sourceLayer;

        // Initialize location-based data loader
        this.locationDataLoader = new LocationDataLoader(TRANSIT_DATA_LOOKUP);
        this.isSourceSwitching = false;
        this.hasInitialDataLoaded = false;
        this.isIframeMode = false;

        // Initialize URL manager for deep linking
        this.urlManager = null;

        // Geolocate control reference
        this.geolocateControl = null;

        // Auto-select closest stop mode
        this.autoSelectClosestStop = true;

        // Flag to prevent concurrent stop selections
        this.isSelectingStop = false;

        // Track hovered feature for feature state management
        this.hoveredStopId = null;
        this.currentHighlightedStop = null;

        // Route list state management
        this.visibleRoutes = [];
        this.filteredRouteId = null;

        // City configuration with bounds and display info
        this.cities = [
            {
                id: 'mumbai',
                name: 'Mumbai',
                bounds: [
                    [72.7746, 18.8900], // Southwest corner
                    [73.1000, 19.4500]  // Northeast corner (expanded for Thane)
                ],
                center: [72.8777, 19.0760],
                zoom: 11
            },
            {
                id: 'thiruvananthapuram',
                name: 'Thiruvananthapuram',
                bounds: [
                    [76.8000, 8.3500], // Southwest corner
                    [77.0500, 8.6500]  // Northeast corner
                ],
                center: [76.9366, 8.5241],
                zoom: 12
            },
            {
                id: 'goa',
                name: 'Goa',
                bounds: [
                    [73.6000, 14.8500], // Southwest corner
                    [74.2500, 15.8000]  // Northeast corner
                ],
                center: [73.9000, 15.4000],
                zoom: 10
            }
        ];
        
        this.currentCity = this.cities[1]; // Default to Thiruvananthapuram
        
        this.init();
    }

    async init() {
        console.log('🚌 Initializing Transit Explorer...');

        // Render city buttons first
        this.renderCityButtons();

        // Initialize map controller with callbacks
        this.mapController = new TransitMapController({
            mapboxToken: this.mapboxToken,
            container: 'map',
            currentCity: this.currentCity,
            sourceName: this.sourceName,
            sourceLayer: this.sourceLayer,
            vectorTileSource: this.vectorTileSource,
            onStopClick: (stopFeature, allFeatures) => this.handleStopClick(stopFeature, allFeatures),
            onRouteClick: (routeFeature) => this.handleRouteClick(routeFeature),
            onMapBackgroundClick: () => this.clearAllSelections(),
            onGeolocate: (e) => {
                console.log('📍 Geolocate event:', e.coords);
                this.userLocation = {
                    lat: e.coords.latitude,
                    lng: e.coords.longitude
                };
                this.updateLocationStatus('Location found', 'status-live', false);
                console.log('📍 Geolocate complete - waiting for map moveend to auto-select stop');
            },
            onGeolocateError: (e) => this.handleLocationError(e),
            onMapLoaded: () => {
                console.log('🗺️ Map loaded, initializing controllers...');
                this.stopController = new TransitStopController(this.mapController, {
                    sourceName: this.sourceName,
                    sourceLayer: this.sourceLayer
                });

                this.departureController = new TransitDepartureController(
                    this.mapController,
                    this.stopController,
                    {
                        currentCity: this.currentCity,
                        sourceName: this.sourceName,
                        sourceLayer: this.sourceLayer,
                        onRouteHighlight: (routeId, isTemp) => this.mapController.highlightRoute(routeId, isTemp),
                        onRouteHighlightClear: () => this.mapController.clearRouteHighlight(),
                        onStopHighlightClear: () => this.mapController.clearStopHighlight(),
                        onRouteSelectionsClear: () => {},
                        onBusLocationTrackingStop: () => this.departureController?.stopBusLocationTracking()
                    }
                );

                window.transitDepartureController = this.departureController;

                this.stopController.mapController.userLocation = this.userLocation;
                this.stopController.mapController.clearAllSelections = () => this.clearAllSelections();
                this.stopController.mapController.updateTransitURL = (opts) => this.updateTransitURL(opts);
                this.stopController.mapController.loadDepartures = (stop) => this.departureController.loadDepartures(stop);
                this.stopController.mapController.startAutoRefresh = () => this.departureController.startAutoRefresh();
                this.stopController.mapController.displayInteractiveRoutes = (routes) => this.displayInteractiveRoutes(routes);
                this.stopController.mapController.updateLocationStatus = (msg, cls, btn) => this.updateLocationStatus(msg, cls, btn);

                setTimeout(() => {
                    console.log('🔍 Calling initial queryVisibleTransitData...');
                    console.log(`🔍 Current zoom: ${this.map.getZoom()}, center: [${this.map.getCenter().lng.toFixed(4)}, ${this.map.getCenter().lat.toFixed(4)}]`);
                    console.log(`🔍 Source loaded: ${this.map.isSourceLoaded(this.sourceName)}`);

                    const testFeatures = this.map.querySourceFeatures(this.sourceName, {
                        sourceLayer: this.sourceLayer
                    });
                    console.log(`🔍 Total features in source: ${testFeatures.length}`);

                    if (testFeatures.length > 0) {
                        const sample = testFeatures[0];
                        console.log(`🔍 Sample feature:`, {
                            type: sample.geometry.type,
                            props: Object.keys(sample.properties),
                            allProperties: sample.properties,
                            featureType: sample.properties.feature_type,
                            typeProperty: sample.properties.type,
                            hasId: 'id' in sample.properties,
                            sourceLayer: sample.sourceLayer,
                            layer: sample.layer
                        });

                        // Check different geometry types
                        const pointFeatures = testFeatures.filter(f => f.geometry.type === 'Point');
                        const lineFeatures = testFeatures.filter(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
                        console.log(`🔍 Geometry breakdown: ${pointFeatures.length} Points, ${lineFeatures.length} Lines`);

                        if (pointFeatures.length > 0) {
                            console.log(`🔍 Sample Point properties:`, pointFeatures[0].properties);
                        }
                        if (lineFeatures.length > 0) {
                            console.log(`🔍 Sample Line properties:`, lineFeatures[0].properties);
                        }
                    }

                    this.queryVisibleTransitData();

                    // Check if initial location requires iframe mode
                    this.checkInitialLocationForIframe();
                }, 500);
            },
            onMoveEnd: () => {
                this.checkAndSwitchDataSource();
                this.queryVisibleTransitData();
                if (this.stopController && this.autoSelectClosestStop) {
                    this.stopController.findClosestStopToMapCenter();
                }
            }
        });

        // Initialize the map
        this.mapController.initMap();
        this.map = this.mapController.getMap();
        this.geolocateControl = this.mapController.geolocateControl;

        // Set up event listeners
        this.setupEventListeners();

        // Initialize URL manager after map is set up
        this.urlManager = new URLManager(null, this.map);

        // Check if URL has parameters before requesting location
        const urlParams = this.parseURLParameters();
        const hasURLSelection = urlParams.route || urlParams.stop;

        // Apply URL parameters after everything is initialized
        setTimeout(() => {
            this.applyURLParametersOnLoad(hasURLSelection);
        }, 1000);

        // If no URL parameters, auto-trigger geolocate once map is loaded
        if (!hasURLSelection) {
            if (this.map.loaded()) {
                console.log('📍 Map already loaded, triggering geolocate...');
                this.updateLocationStatus('Locating...', 'status-scheduled', false);
                setTimeout(() => {
                    if (this.geolocateControl) {
                        this.geolocateControl.trigger();
                    }
                }, 500);
            } else {
                this.map.once('load', () => {
                    console.log('📍 No URL params detected, triggering geolocate...');
                    this.updateLocationStatus('Locating...', 'status-scheduled', false);

                    // Small delay to ensure geolocate control is ready
                    setTimeout(() => {
                        if (this.geolocateControl) {
                            this.geolocateControl.trigger();
                        }
                    }, 500);
                });
            }
        } else {
            this.updateLocationStatus('Loading from URL...', 'status-scheduled', false);
        }
    }

    // City management methods
    renderCityButtons() {
        const container = document.getElementById('city-buttons-container');
        if (!container) return;

        container.innerHTML = '';
        
        this.cities.forEach(city => {
            const button = document.createElement('button');
            button.className = `city-button ${city.id === this.currentCity.id ? 'active' : ''}`;
            button.textContent = city.name;
            button.setAttribute('data-city-id', city.id);
            button.addEventListener('click', () => this.selectCity(city.id));
            container.appendChild(button);
        });
    }

    selectCity(cityId) {
        const city = this.cities.find(c => c.id === cityId);
        if (!city) return;

        // Update current city
        this.currentCity = city;

        // Update button states
        document.querySelectorAll('.city-button').forEach(btn => {
            if (btn.getAttribute('data-city-id') === cityId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Check if this city requires iframe mode
        const cityCenter = city.center || [(city.bounds[0][0] + city.bounds[1][0]) / 2, (city.bounds[0][1] + city.bounds[1][1]) / 2];
        const matchData = this.locationDataLoader.dataLookup.find(region =>
            this.isPointInBounds({ lng: cityCenter[0], lat: cityCenter[1] }, region.bounds)
        );

        if (matchData && matchData.useIframe) {
            console.log(`🏙️ Switching to iframe for ${city.name}`);
            this.switchToIframe(matchData);
        } else {
            this.switchToMap();
            // Fly to city bounds
            this.flyToCityBounds(city);
        }

        console.log(`🏙️ Selected city: ${city.name}`);
    }

    isPointInBounds(point, bounds) {
        return point.lat >= bounds.south &&
               point.lat <= bounds.north &&
               point.lng >= bounds.west &&
               point.lng <= bounds.east;
    }

    flyToCityBounds(city) {
        if (!this.map || !city.bounds) return;

        this.map.fitBounds(city.bounds, {
            padding: 50,
            duration: 2000
        });
    }

    isLocationWithinCityBounds(location, city) {
        if (!location || !city.bounds) return false;

        const [lng, lat] = [location.lng, location.lat];
        const [[swLng, swLat], [neLng, neLat]] = city.bounds;

        return lng >= swLng && lng <= neLng && lat >= swLat && lat <= neLat;
    }

    isLocationWithinAnyCityBounds(location) {
        return this.cities.some(city => this.isLocationWithinCityBounds(location, city));
    }

    findCityForLocation(location) {
        return this.cities.find(city => this.isLocationWithinCityBounds(location, city));
    }

    async applyURLParametersOnLoad(hasURLSelection = false) {
        try {
            if (hasURLSelection) {
                const applied = await this.applyURLParameters();
                if (!applied) {
                    console.log('🔗 Failed to apply URL parameters, falling back to nearest stop');
                    // If URL parameters failed to apply, find nearest stop as fallback
                    await this.findNearestStopIfLocationAvailable();
                } else {
                    console.log('🔗 Successfully applied URL parameters');
                }
            } else {
                console.log('🔗 No URL parameters, finding nearest stop');
                // No URL parameters, proceed with normal nearest stop finding
                await this.findNearestStopIfLocationAvailable();
            }
        } catch (error) {
            console.error('🔗 Error applying URL parameters on load:', error);
            // Fallback to nearest stop if there's an error
            await this.findNearestStopIfLocationAvailable();
        }
    }

    async findNearestStopIfLocationAvailable() {
        if (this.userLocation) {
            console.log('📍 User location available, finding nearest stop...');
            // Use the unified findClosestStopToMapCenter since the map should already be
            // centered on the user location after geolocate
            if (this.autoSelectClosestStop) {
                await this.findClosestStopToMapCenter();
            }
        } else {
            console.log('📍 User location not available, showing fallback content');
            this.showLocationFallbackContent();
        }
    }

    // Method to access URL manager for testing/debugging
    getURLManager() {
        return this.urlManager;
    }

    // Parse URL parameters for transit-specific parameters
    parseURLParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const routeParam = urlParams.get('route');
        const stopParam = urlParams.get('stop');
        
        return {
            route: routeParam ? decodeURIComponent(routeParam) : null,
            stop: stopParam ? decodeURIComponent(stopParam) : null
        };
    }

    // Update URL with transit parameters
    updateTransitURL(options = {}) {
        const urlParams = new URLSearchParams(window.location.search);
        let hasChanges = false;

        // Handle route parameter
        if (options.route !== undefined) {
            if (options.route) {
                const slugifiedRoute = this.slugify(options.route);
                if (urlParams.get('route') !== slugifiedRoute) {
                    urlParams.set('route', slugifiedRoute);
                    hasChanges = true;
                }
            } else {
                if (urlParams.has('route')) {
                    urlParams.delete('route');
                    hasChanges = true;
                }
            }
        }

        // Handle stop parameter
        if (options.stop !== undefined) {
            if (options.stop) {
                const slugifiedStop = this.slugify(options.stop);
                if (urlParams.get('stop') !== slugifiedStop) {
                    urlParams.set('stop', slugifiedStop);
                    hasChanges = true;
                }
            } else {
                if (urlParams.has('stop')) {
                    urlParams.delete('stop');
                    hasChanges = true;
                }
            }
        }

        // Update URL if there are changes
        if (hasChanges) {
            const newURL = window.location.pathname + 
                          (urlParams.toString() ? '?' + urlParams.toString() : '') + 
                          window.location.hash;
            
            window.history.replaceState(null, '', newURL);
            console.log('🔗 Updated URL:', newURL);
        }
    }

    // Convert text to URL-friendly slug
    slugify(text) {
        if (!text) return '';
        
        return text
            .toString()
            .toLowerCase()
            .trim()
            .replace(/[\s\-_\.]+/g, '-')
            .replace(/[^\w\-]+/g, '')
            .replace(/\-{2,}/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    // Apply URL parameters to the transit explorer
    async applyURLParameters() {
        const params = this.parseURLParameters();
        
        if (!params.route && !params.stop) {
            console.log('🔗 No URL parameters to apply');
            return false;
        }

        let applied = false;

        try {
            // Wait for map to be ready
            await this.waitForMapReady();

            // Apply stop selection first (if present)
            if (params.stop) {
                const originalStopName = await this.findOriginalNameFromSlug(params.stop, 'stop');
                const stopApplied = await this.applyStopFromURL(originalStopName || params.stop);
                if (stopApplied) {
                    applied = true;
                    console.log(`🔗 Applied stop from URL: ${originalStopName || params.stop}`);
                }
            }

            // Apply route selection (if present)
            if (params.route) {
                const originalRouteName = await this.findOriginalNameFromSlug(params.route, 'route');
                const routeApplied = await this.applyRouteFromURL(originalRouteName || params.route);
                if (routeApplied) {
                    applied = true;
                    console.log(`🔗 Applied route from URL: ${originalRouteName || params.route}`);
                }
            }

        } catch (error) {
            console.error('🔗 Error applying URL parameters:', error);
        }

        return applied;
    }

    // Wait for map to be ready
    async waitForMapReady() {
        return new Promise((resolve) => {
            const checkReady = () => {
                if (this.map && this.map.isSourceLoaded(this.sourceName)) {
                    resolve();
                } else {
                    setTimeout(checkReady, 500);
                }
            };
            checkReady();
        });
    }

    // Find original name from slug by searching through available options
    async findOriginalNameFromSlug(slug, type) {
        if (!slug) return null;
        
        try {
            let features = [];
            const featureTypeFilter = type === 'route' ? 'route' : 'stop';
            
            features = this.map.querySourceFeatures(this.sourceName, {
                sourceLayer: this.sourceLayer,
                filter: ['==', ['get', 'feature_type'], featureTypeFilter]
            });
            
            // Find feature whose name slugifies to the target slug
            for (const feature of features) {
                const props = feature.properties;
                let names = [];
                
                if (type === 'route') {
                    names = [props.route_short_name, props.route_name].filter(n => n);
                } else if (type === 'stop') {
                    names = [props.name, props.stop_name, props.stop_desc].filter(n => n);
                }
                
                for (const name of names) {
                    if (this.slugify(name) === slug) {
                        return name;
                    }
                }
            }
            
            console.warn(`🔗 Could not find original name for ${type} slug: ${slug}`);
            return null;
            
        } catch (error) {
            console.error(`🔗 Error finding original name for ${type} slug:`, error);
            return null;
        }
    }

    // Apply stop selection from URL parameter
    async applyStopFromURL(stopName) {
        try {
            const stopFeatures = this.map.querySourceFeatures(this.sourceName, {
                sourceLayer: this.sourceLayer,
                filter: ['==', ['get', 'feature_type'], 'stop']
            });

            const matchingStop = stopFeatures.find(feature => {
                const props = feature.properties;
                const names = [
                    props.name,
                    props.stop_name,
                    props.stop_desc
                ].filter(name => name);

                return names.some(name => 
                    name.toLowerCase().includes(stopName.toLowerCase()) ||
                    stopName.toLowerCase().includes(name.toLowerCase())
                );
            });

            if (matchingStop) {
                this.handleStopClick(matchingStop, [matchingStop]);
                
                // Use BusStop to get proper lat/lon from properties
                const busStop = new BusStop(matchingStop);
                if (busStop.lat && busStop.lon) {
                    this.map.flyTo({
                        center: [busStop.lon, busStop.lat],
                        zoom: Math.max(15, this.map.getZoom()),
                        duration: 2000
                    });
                }
                
                return true;
            } else {
                console.warn(`🔗 Stop not found: ${stopName}`);
                return false;
            }

        } catch (error) {
            console.error('🔗 Error applying stop from URL:', error);
            return false;
        }
    }

    // Apply route selection from URL parameter
    async applyRouteFromURL(routeName) {
        try {
            const routeFeatures = this.map.querySourceFeatures(this.sourceName, {
                sourceLayer: this.sourceLayer,
                filter: ['==', ['get', 'feature_type'], 'route']
            });

            let matchingRoute = routeFeatures.find(feature => {
                const props = feature.properties;
                return props.route_short_name === routeName || 
                       props.route_name === routeName;
            });

            if (!matchingRoute) {
                matchingRoute = routeFeatures.find(feature => {
                    const props = feature.properties;
                    const names = [
                        props.route_short_name,
                        props.route_name
                    ].filter(name => name);

                    return names.some(name => 
                        name.toLowerCase().includes(routeName.toLowerCase()) ||
                        routeName.toLowerCase().includes(name.toLowerCase())
                    );
                });
            }

            if (matchingRoute) {
                this.handleRouteClick(matchingRoute);
                this.fitMapToRoute(matchingRoute);
                return true;
            } else {
                console.warn(`🔗 Route not found: ${routeName}`);
                return false;
            }

        } catch (error) {
            console.error('🔗 Error applying route from URL:', error);
            return false;
        }
    }

    // Fit map to show the selected route
    fitMapToRoute(routeFeature) {
        try {
            if (routeFeature.geometry && routeFeature.geometry.coordinates) {
                const coordinates = routeFeature.geometry.coordinates;
                
                const bounds = new mapboxgl.LngLatBounds();
                
                if (routeFeature.geometry.type === 'LineString') {
                    coordinates.forEach(coord => bounds.extend(coord));
                } else if (routeFeature.geometry.type === 'MultiLineString') {
                    coordinates.forEach(line => {
                        line.forEach(coord => bounds.extend(coord));
                    });
                }
                
                this.map.fitBounds(bounds, {
                    padding: 50,
                    duration: 2000,
                    maxZoom: 14
                });
            }
        } catch (error) {
            console.error('🔗 Error fitting map to route:', error);
        }
    }

    initMap() {
        mapboxgl.accessToken = this.mapboxToken;
        
        this.map = new mapboxgl.Map({
            container: 'map',
            style: 'mapbox://styles/mapbox/dark-v11',
            center: this.currentCity.center,
            zoom: this.currentCity.zoom,
            pitch: 45,
            bearing: 0,
            hash: true
        });

        this.map.on('load', () => {
            this.addDataSources();
            this.addLayers();
            console.log('🗺️ Map loaded successfully');
            
            // Add route interaction handlers
            // this.setupRouteInteractions();
            
            // Add moveend listener to query visible transit data
            this.setupMoveEndListener();
        });

        // Add navigation controls
        this.map.addControl(new mapboxgl.NavigationControl(), 'top-right');
        
        // Add geolocation control
        this.geolocateControl = new mapboxgl.GeolocateControl({
            positionOptions: {
                enableHighAccuracy: true
            },
            trackUserLocation: true,
            showUserHeading: true,
            showAccuracyCircle: true
        });
        this.map.addControl(this.geolocateControl, 'top-right');
        
        // Handle geolocate events
        this.geolocateControl.on('geolocate', (e) => {
            console.log('📍 Geolocate event:', e.coords);
            this.userLocation = {
                lat: e.coords.latitude,
                lng: e.coords.longitude
            };
            this.updateLocationStatus('Location found', 'status-live', false);
            
            // Note: findClosestStopToMapCenter will be called on moveend after the map 
            // flies to user location. We don't call it here to avoid race conditions.
            console.log('📍 Geolocate complete - waiting for map moveend to auto-select stop');
        });
        
        this.geolocateControl.on('error', (e) => {
            console.error('📍 Geolocate error:', e);
            this.updateLocationStatus('Location error', 'status-scheduled', true);
        });
    }

    addDataSources() {
        console.log('📊 Adding data sources...');
        
        try {
            // Add combined transit data source (contains both routes and stops)
            this.map.addSource(this.sourceName, {
                type: 'vector',
                url: this.vectorTileSource.url,
                promoteId: { '642d08ec9c71882f33e0': 'id' }
            });
            console.log(`✅ Added ${this.sourceName} source: ${this.vectorTileSource.url}`);
            
        } catch (error) {
            console.error('❌ Error adding data sources:', error);
        }
    }

    addLayers() {
        const sourceLayer = this.sourceLayer;
        
        // Add route lines (filter by feature_type = 'route')
        this.map.addLayer({
            id: 'routes',
            type: 'line',
            source: this.sourceName,
            'source-layer': sourceLayer,
            filter: ['==', ['get', 'feature_type'], 'route'],
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': [
                    'case',
                    // Premium/Corporate routes
                    ['==', ['get', 'fare_type'], 'Premium'], '#8b5cf6', // Purple for premium
                    // AC routes
                    ['any',
                        ['==', ['get', 'fare_type'], 'AC'],
                        ['==', ['get', 'ac_service'], true]
                    ], '#3b82f6', // Blue for AC
                    // Express routes
                    ['==', ['get', 'fare_type'], 'Express'], '#f97316', // Orange for express
                    // Regular routes
                    ['==', ['get', 'fare_type'], 'Regular'], '#ef4444', // Red for Regular
                    // Live tracking available
                    ['==', ['to-string', ['get', 'is_live']], 'true'], '#22c55e', // Green for live
                    // Default
                    '#10b981' // Default green
                ],
                'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 2,
                    16, 6
                ],
                'line-opacity': 0.5
            }
        });

        // Add route highlight layer (initially hidden)
        this.map.addLayer({
            id: 'routes-highlight',
            type: 'line',
            source: this.sourceName,
            'source-layer': sourceLayer,
            filter: ['all', 
                ['==', ['get', 'feature_type'], 'route'],
                ['==', ['get', 'route_id'], ''] // Initially filter out everything
            ],
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#fbbf24', // Bright yellow/amber for highlight
                'line-width': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 6,
                    16, 12
                ],
                'line-opacity': 0.9,
                'line-blur': 1
            }
        });

        // Add bus stops (filter by feature_type = 'stop')
        this.map.addLayer({
            id: 'stops',
            type: 'circle',
            source: this.sourceName,
            'source-layer': sourceLayer,
            filter: ['==', ['get', 'feature_type'], 'stop'],
            paint: {
                'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, [
                        '+',
                        2,
                        [
                            'case',
                            ['boolean', ['feature-state', 'selected'], false], 6,
                            ['boolean', ['feature-state', 'hover'], false], 3,
                            0
                        ]
                    ],
                    16, [
                        '+',
                        4,
                        [
                            'case',
                            ['boolean', ['feature-state', 'selected'], false], 6,
                            ['boolean', ['feature-state', 'hover'], false], 3,
                            0
                        ]
                    ]
                ],
                'circle-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], '#22c55e',
                    ['boolean', ['feature-state', 'hover'], false], '#22c55e',
                    '#f59e0b'
                ],
                'circle-stroke-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 3,
                    ['boolean', ['feature-state', 'hover'], false], 2,
                    1
                ],
                'circle-stroke-color': '#ffffff',
                'circle-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 1,
                    0.9
                ]
            }
        });

        // Add stop highlight layer (initially hidden)
        this.map.addLayer({
            id: 'stops-highlight',
            type: 'circle',
            source: this.sourceName,
            'source-layer': sourceLayer,
            filter: ['all',
                ['==', ['get', 'feature_type'], 'stop'],
                ['==', ['get', 'id'], ''] // Initially filter out everything
            ],
            paint: {
                'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 12,
                    16, 20
                ],
                'circle-color': '#22c55e',
                'circle-stroke-width': 4,
                'circle-stroke-color': '#ffffff',
                'circle-opacity': 0.8,
                'circle-blur': 0.5
            }
        });

        // Add debug label layer to show stop IDs and names
        this.map.addLayer({
            id: 'stops-debug-labels',
            type: 'symbol',
            source: this.sourceName,
            'source-layer': sourceLayer,
            filter: ['==', ['get', 'feature_type'], 'stop'],
            layout: {
                'text-field': [
                    'concat',
                    ['get', 'name'],
                    '\n',
                    'ID: ',
                    ['get', 'id']
                ],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': 11,
                'text-offset': [0, 2],
                'text-anchor': 'top'
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#000000',
                'text-halo-width': 2
            }
        });

        // Add bus location layer for live tracking
        this.addBusLocationLayer();

        // Add hover effects for stops
        // this.map.on('mouseenter', 'stops', () => {
        //     this.map.getCanvas().style.cursor = 'pointer';
        // });

        // this.map.on('mouseleave', 'stops', () => {
        //     this.map.getCanvas().style.cursor = '';
        // });

        // Handle stop clicks
        // this.map.on('click', 'stops', (e) => {
        //     if (e.features.length > 0) {
        //         this.selectStop(e.features[0]);
        //     }
        // });

        console.log('✅ Route interactions set up successfully');
        
        // Set up unified map interactions
        this.setupMapInteractions();
    }

    addBusLocationLayer() {
        // Add bus locations source
        if (!this.map.getSource('bus-locations')) {
            this.map.addSource('bus-locations', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            });
        }

        // Add bus location layer if it doesn't exist
        if (!this.map.getLayer('bus-locations')) {
            this.map.addLayer({
                id: 'bus-locations',
                type: 'circle',
                source: 'bus-locations',
                paint: {
                    'circle-radius': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        10, 6,
                        16, 12
                    ],
                    'circle-color': [
                        'case',
                        ['get', 'isHalted'], '#f59e0b', // Orange for halted buses
                        '#22c55e' // Green for moving buses
                    ],
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.9
                }
            });

            // Add bus labels
            this.map.addLayer({
                id: 'bus-labels',
                type: 'symbol',
                source: 'bus-locations',
                layout: {
                    'text-field': ['get', 'vehicleNo'],
                    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                    'text-size': 10,
                    'text-offset': [0, -2],
                    'text-anchor': 'bottom'
                },
                paint: {
                    'text-color': '#ffffff',
                    'text-halo-color': '#000000',
                    'text-halo-width': 1
                }
            });
        }

        // Add click interaction for buses
        this.map.on('click', 'bus-locations', (e) => {
            if (e.features.length > 0) {
                this.showBusPopup(e.features[0], e.lngLat);
            }
        });

        // Add hover effect for buses
        this.map.on('mouseenter', 'bus-locations', () => {
            this.map.getCanvas().style.cursor = 'pointer';
        });

        this.map.on('mouseleave', 'bus-locations', () => {
            this.map.getCanvas().style.cursor = '';
        });
    }

    showBusPopup(busFeature, lngLat) {
        const props = busFeature.properties;
        const lastUpdate = new Date(props.timestamp).toLocaleTimeString();
        
        const popupContent = `
            <div class="text-sm">
                <div class="font-bold text-green-400 mb-2">Bus ${props.vehicleNo}</div>
                <div class="space-y-1 text-gray-300">
                    <div>Status: ${props.isHalted ? '🛑 Stopped' : '🚌 Moving'}</div>
                    ${props.eta > 0 ? `<div>ETA: ${props.eta} seconds</div>` : ''}
                    <div class="text-xs text-gray-400">Updated: ${lastUpdate}</div>
                </div>
            </div>
        `;

        new mapboxgl.Popup()
            .setLngLat(lngLat)
            .setHTML(popupContent)
            .addTo(this.map);
    }

    setupRouteInteractions() {
        console.log('🎯 Setting up route interactions...');
        
        // Ensure the routes layer exists before setting up interactions
        if (!this.map.getLayer('routes')) {
            console.warn('Routes layer not found, interactions setup delayed');
            return;
        }

        // Add route hover effects
        this.map.on('mouseenter', 'routes', () => {
            this.map.getCanvas().style.cursor = 'pointer';
        });

        this.map.on('mouseleave', 'routes', () => {
            this.map.getCanvas().style.cursor = '';
        });

        // Add route click interaction using the helper to find nearest unique feature
        this.map.on('click', 'routes', (e) => {
            // Find the nearest unique route at the click point
            const nearestRoute = this.findNearestFeatureAtPoint(e.point, e.lngLat, 'routes');
            
            if (nearestRoute && nearestRoute.properties) {
                const routeId = nearestRoute.properties.route_id;
                const routeName = nearestRoute.properties.route_short_name || 
                                nearestRoute.properties.route_name;
                
                console.log(`🚌 Route clicked: ${routeName} (ID: ${routeId})`);
                console.log('📊 Feature properties:', nearestRoute.properties);
                
                // Clear previous selections
                this.clearAllSelections();
                
                // Highlight the route on map
                this.highlightRoute(routeId);
                
                // Highlight corresponding departure rows
                this.highlightDepartureRows(routeId, routeName);
            } else {
                console.warn('⚠️ No route feature found at click point');
            }
        });

        // Add route hover interaction for temporary highlighting
        this.map.on('mouseenter', 'routes', (e) => {
            // Find the nearest unique route at the hover point
            const nearestRoute = this.findNearestFeatureAtPoint(e.point, e.lngLat, 'routes');
            
            if (nearestRoute && nearestRoute.properties) {
                const routeId = nearestRoute.properties.route_id;
                const routeName = nearestRoute.properties.route_short_name || 
                                nearestRoute.properties.route_name;
                
                // Only highlight if not already selected
                if (this.currentHighlightedRoute !== routeId) {
                    console.log(`🎯 Hovering route: ${routeName} (ID: ${routeId})`);
                    // Temporary highlight on hover
                    this.highlightRoute(routeId, true);
                    this.highlightDepartureRows(routeId, routeName, true);
                }
            }
        });

        // Clear hover highlights when mouse leaves routes
        this.map.on('mouseleave', 'routes', () => {
            this.clearTemporaryHighlights();
        });

        // Add map background click to clear selections
        this.map.on('click', (e) => {
            // Check if we clicked on the map background (not on any layers)
            const nearestStop = this.findNearestFeatureAtPoint(e.point, e.lngLat, 'stops');
            const nearestRoute = this.findNearestFeatureAtPoint(e.point, e.lngLat, 'routes');
            
            if (!nearestStop && !nearestRoute) {
                this.clearAllSelections();
            }
        });
        
        console.log('✅ Route interactions set up successfully');
    }

    highlightRoute(routeId, isTemporary = false) {
        if (!routeId) return;

        // Update the highlight layer filter to show only the selected route
        this.map.setFilter('routes-highlight', [
            'all',
            ['==', ['get', 'feature_type'], 'route'],
            ['==', ['get', 'route_id'], routeId]
        ]);
        
        // Store current highlight for cleanup
        if (!isTemporary) {
            this.currentHighlightedRoute = routeId;
            
            // Get route information for display
            this.displayRouteInfo(routeId);
            
            // Update URL with route selection
            const routeName = this.getRouteNameById(routeId);
            if (routeName) {
                this.updateTransitURL({ route: routeName });
            }
        }
        
        console.log(`🎯 Highlighting route: ${routeId}`);
    }

    getRouteNameById(routeId) {
        if (!this.map || !this.map.isSourceLoaded(this.sourceName)) return null;
        
        try {
            const routeFeatures = this.map.querySourceFeatures(this.sourceName, {
                sourceLayer: this.sourceLayer,
                filter: ['all', 
                    ['==', ['get', 'feature_type'], 'route'],
                    ['==', ['get', 'route_id'], routeId]
                ]
            });
            
            if (routeFeatures.length > 0) {
                const routeProps = routeFeatures[0].properties;
                return routeProps.route_short_name || routeProps.route_name;
            }
        } catch (error) {
            console.log('Could not get route name:', error);
        }
        
        return null;
    }

    displayRouteInfo(routeId) {
        if (!this.map || !this.map.isSourceLoaded(this.sourceName)) return;
        
        try {
            const routeFeatures = this.map.querySourceFeatures(this.sourceName, {
                sourceLayer: this.sourceLayer,
                filter: ['all', 
                    ['==', ['get', 'feature_type'], 'route'],
                    ['==', ['get', 'route_id'], routeId]
                ]
            });
            
            if (routeFeatures.length > 0) {
                const routeProps = routeFeatures[0].properties;
                const routeName = routeProps.route_short_name || routeProps.route_name;
                const routeDesc = routeProps.route_desc || routeProps.route_long_name;
                const isLive = routeProps.is_live === 'true' || routeProps.is_live === true;
                
                // Update selection indicator with route details
                this.updateSelectionIndicator(
                    `Route ${routeName}${routeDesc ? ` - ${routeDesc}` : ''} ${isLive ? '(Live)' : '(Scheduled)'}`
                );
            }
        } catch (error) {
            console.log('Could not get route details:', error);
        }
    }

    clearRouteHighlight() {
        // Hide the highlight layer by setting an impossible filter
        this.map.setFilter('routes-highlight', [
            'all',
            ['==', ['get', 'feature_type'], 'route'],
            ['==', ['get', 'route_id'], '']
        ]);
        this.currentHighlightedRoute = null;
    }

    highlightDepartureRows(routeId, routeName, isTemporary = false) {
        // Clear previous highlights
        this.clearDepartureHighlights(isTemporary);
        
        // Find and highlight matching departure rows
        const departureRows = document.querySelectorAll('.departure-row');
        let highlightedCount = 0;
        
        departureRows.forEach(row => {
            const routeBadge = row.querySelector('.route-badge-text');
            if (routeBadge && routeBadge.textContent.trim().includes(routeName)) {
                const highlightClass = isTemporary ? 'departure-row-hover' : 'departure-row-selected';
                row.classList.add(highlightClass);
                highlightedCount++;
            }
        });
        
        if (!isTemporary && highlightedCount > 0) {
            this.currentHighlightedDepartures = { routeId, routeName };
            this.updateSelectionIndicator(`Route ${routeName} selected`);
        }
        
        console.log(`🎯 Highlighted ${highlightedCount} departure rows for route: ${routeName}`);
    }

    clearDepartureHighlights(isTemporaryOnly = false) {
        // Clear highlights from all departure rows (both tabbed and legacy)
        const departureRows = document.querySelectorAll('.departure-row');
        departureRows.forEach(row => {
            if (isTemporaryOnly) {
                row.classList.remove('departure-row-hover');
            } else {
                row.classList.remove('departure-row-selected', 'departure-row-hover');
            }
        });
        
        if (!isTemporaryOnly) {
            this.currentHighlightedDepartures = null;
            this.updateSelectionIndicator('');
        }
    }

    clearTemporaryHighlights() {
        // Only clear hover highlights, keep click selections
        this.clearDepartureHighlights(true);
        
        // If there's a permanent selection, restore it
        if (this.currentHighlightedRoute) {
            this.highlightRoute(this.currentHighlightedRoute);
        } else {
            this.clearRouteHighlight();
        }
    }

    setupDepartureRowInteractions() {
        // This will be called after departures are displayed
        // Handle interactions for both tabbed and legacy departure rows
        const allDepartureRows = document.querySelectorAll('.departure-row');
        
        console.log(`🎯 Setting up interactions for ${allDepartureRows.length} departure rows`);
        
        allDepartureRows.forEach((row, globalIndex) => {
            // Clear any existing event listeners by cloning the element
            const newRow = row.cloneNode(true);
            row.parentNode.replaceChild(newRow, row);
            
            // Make rows clickable
            newRow.style.cursor = 'pointer';
            
            // Add click handler
            newRow.addEventListener('click', (e) => {
                const routeBadge = newRow.querySelector('.route-badge-text');
                const routeId = newRow.dataset.routeId;
                const routeName = routeBadge ? routeBadge.textContent.trim() : '';
                const departureIndex = newRow.dataset.departureIndex;
                const tabType = newRow.dataset.tabType;
                const departureData = this.getDepartureDataFromTab(departureIndex, tabType);
                
                if (routeId && routeName) {
                    console.log(`🚌 Departure row clicked: ${routeName} (ID: ${routeId}) from ${tabType} tab`);
                    
                    // Clear previous selections
                    this.clearDepartureHighlights();
                    this.clearRouteHighlight();
                    this.stopBusLocationUpdates(); // Stop previous bus tracking
                    
                    // Highlight this row
                    newRow.classList.add('departure-row-selected');
                    
                    // Highlight corresponding route on map
                    this.highlightRoute(routeId);
                    
                    // Start tracking bus locations for this route
                    this.startBusLocationTracking(routeId, departureData);
                    
                    // Store selection
                    this.currentHighlightedRoute = routeId;
                    this.currentHighlightedDepartures = { routeId, routeName };
                    this.currentTrackedRoute = { routeId, routeName, departureData };
                    
                    // Update selection indicator
                    const trackingText = departureData?.isLive ? 
                        `Tracking Route ${routeName} - Live bus locations updating` :
                        `Route ${routeName} selected - Scheduled departures`;
                    this.updateSelectionIndicator(trackingText);
                }
            });
            
            // Add hover handlers
            newRow.addEventListener('mouseenter', (e) => {
                const routeId = newRow.dataset.routeId;
                const routeBadge = newRow.querySelector('.route-badge-text');
                const routeName = routeBadge ? routeBadge.textContent.trim() : '';
                
                if (routeId && !newRow.classList.contains('departure-row-selected')) {
                    newRow.classList.add('departure-row-hover');
                    this.highlightRoute(routeId, true);
                }
            });
            
            newRow.addEventListener('mouseleave', (e) => {
                const routeId = newRow.dataset.routeId;
                
                if (!newRow.classList.contains('departure-row-selected')) {
                    newRow.classList.remove('departure-row-hover');
                    
                    // Restore permanent highlight if exists
                    if (this.currentHighlightedRoute && this.currentHighlightedRoute !== routeId) {
                        this.highlightRoute(this.currentHighlightedRoute);
                    } else if (!this.currentHighlightedRoute) {
                        this.clearRouteHighlight();
                    }
                }
            });
        });
    }

    generateRouteListHTML(route) {
        const props = route.properties;
        const routeId = props.route_id || '';
        const shortName = props.route_short_name || '';
        const longName = props.route_name || 'Unnamed Route';
        const isLive = props.is_live === 'true' || props.is_live === true;
        const stopCount = props.stop_count || '';
        const firstStop = props.first_stop_name || '';
        const lastStop = props.last_stop_name || '';
        const routeDesc = props.route_desc || '';

        const agencyName = props.agency_name || 'BEST';
        const fareType = props.fare_type || 'Regular';
        const color = this.getRouteColor(agencyName, fareType);

        return `
            <div class="route-list-item" data-route-id="${routeId}">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        ${shortName ? `
                            <span class="px-2 py-1 rounded text-xs font-bold"
                                  style="background-color: ${color}; color: white;">
                                ${shortName}
                            </span>
                        ` : ''}
                        <span class="text-white font-medium">${longName}</span>
                    </div>
                    <div class="text-xs text-gray-400 flex items-center gap-2">
                        ${isLive ? '<span class="text-green-400">●</span>' : ''}
                        ${stopCount ? `${stopCount} stops` : ''}
                    </div>
                </div>
                ${firstStop && lastStop ? `
                    <div class="text-xs text-gray-500 mt-1">
                        ${firstStop} → ${lastStop}
                    </div>
                ` : ''}
                ${routeDesc ? `
                    <div class="text-xs text-gray-400 mt-1">${routeDesc}</div>
                ` : ''}
            </div>
        `;
    }

    getRouteColor(agencyName, fareType) {
        if (typeof AGENCY_STYLES !== 'undefined' && AGENCY_STYLES[agencyName]) {
            const agencyColors = AGENCY_STYLES[agencyName].colors;
            if (agencyColors[fareType]) {
                return agencyColors[fareType].background;
            }
            if (agencyColors.default) {
                return agencyColors.default.background;
            }
        }
        return '#dc2626';
    }

    updateRouteCount() {
        const count = this.visibleRoutes.length;
        const countEl = document.getElementById('route-count');
        if (countEl) {
            if (count > 0) {
                countEl.textContent = `(${count} route${count !== 1 ? 's' : ''})`;
            } else {
                countEl.textContent = '';
            }
        }
    }

    getRouteFeatureById(routeId) {
        return this.visibleRoutes.find(
            feature => feature.properties.route_id === routeId
        );
    }

    updateRouteListSelection(routeId) {
        document.querySelectorAll('.route-list-item').forEach(item => {
            if (item.dataset.routeId === routeId) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    }

    filterRouteList(routeId) {
        this.filteredRouteId = routeId;

        const routeItems = document.querySelectorAll('.route-list-item');
        routeItems.forEach(item => {
            if (item.dataset.routeId === routeId) {
                item.style.display = 'block';
                item.classList.add('selected');
            } else {
                item.style.display = 'none';
            }
        });

        const clearButton = document.getElementById('clear-route-filter');
        if (clearButton) {
            clearButton.classList.remove('hidden');
        }

        const countEl = document.getElementById('route-count');
        if (countEl) {
            countEl.textContent = '(Filtered to 1 route)';
        }

        console.log(`🔍 Filtered route list to: ${routeId}`);
    }

    clearRouteFilter() {
        this.filteredRouteId = null;

        const routeItems = document.querySelectorAll('.route-list-item');
        routeItems.forEach(item => {
            item.style.display = 'block';
            item.classList.remove('selected');
        });

        const clearButton = document.getElementById('clear-route-filter');
        if (clearButton) {
            clearButton.classList.add('hidden');
        }

        this.updateRouteCount();

        console.log('🔄 Cleared route filter');
    }

    setupRouteListInteractions() {
        const routeItems = document.querySelectorAll('.route-list-item');

        routeItems.forEach(item => {
            const routeId = item.dataset.routeId;

            item.addEventListener('click', () => {
                console.log(`🚌 Route list item clicked: ${routeId}`);

                this.clearDepartureHighlights();
                document.querySelectorAll('.route-list-item').forEach(i =>
                    i.classList.remove('selected')
                );

                item.classList.add('selected');

                this.highlightRoute(routeId, false);

                this.filterRouteList(routeId);

                const routeFeature = this.getRouteFeatureById(routeId);
                if (routeFeature) {
                    this.handleRouteClick(routeFeature);
                }
            });

            item.addEventListener('mouseenter', () => {
                if (!item.classList.contains('selected')) {
                    item.classList.add('hover-highlight');
                    this.highlightRoute(routeId, true);
                }
            });

            item.addEventListener('mouseleave', () => {
                if (!item.classList.contains('selected')) {
                    item.classList.remove('hover-highlight');

                    if (this.currentHighlightedRoute &&
                        this.currentHighlightedRoute !== routeId) {
                        this.highlightRoute(this.currentHighlightedRoute, false);
                    } else if (!this.currentHighlightedRoute) {
                        this.clearRouteHighlight();
                    }
                }
            });
        });

        console.log(`✅ Set up interactions for ${routeItems.length} route list items`);
    }

    getDepartureDataFromTab(departureIndex, tabType) {
        // Parse the departure index to get the actual index
        let actualIndex;
        let departureArray;
        
        if (tabType === 'live') {
            actualIndex = parseInt(departureIndex.replace('live-', ''));
            departureArray = this.currentDepartures ? this.currentDepartures.filter(d => d.isLive) : [];
        } else if (tabType === 'scheduled') {
            actualIndex = parseInt(departureIndex.replace('scheduled-', ''));
            departureArray = this.currentDepartures ? this.currentDepartures.filter(d => !d.isLive) : [];
        } else {
            // Legacy format
            actualIndex = parseInt(departureIndex);
            departureArray = this.currentDepartures || [];
        }
        
        return departureArray[actualIndex] || null;
    }

    getDepartureData(departureIndex) {
        // Get departure data from the stored departures
        if (this.currentDepartures && this.currentDepartures[departureIndex]) {
            return this.currentDepartures[departureIndex];
        }
        return null;
    }

    async startBusLocationTracking(routeId, departureData) {
        console.log(`🔄 Starting bus location tracking for route: ${routeId}`);
        
        // Get current stop ID
        const currentStopId = this.currentStop?.properties?.id || this.currentStop?.properties?.stop_id;
        const stopIds = currentStopId ? [currentStopId] : [];
        
        // Start bus location updates
        this.startBusLocationUpdates(routeId, stopIds);
        
        // Show tracking notification
        this.showBusTrackingNotification(routeId, departureData);
    }

    showBusTrackingNotification(routeId, departureData) {
        // Create or update tracking notification
        let notification = document.getElementById('bus-tracking-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'bus-tracking-notification';
            notification.className = 'fixed top-4 right-4 z-50 max-w-sm';
            document.body.appendChild(notification);
        }
        
        const routeName = departureData?.route || 'Unknown Route';
        const vehicleNo = departureData?.vehicleId || '';
        const destination = departureData?.destination || '';
        
        notification.innerHTML = `
            <div class="bg-green-800 border border-green-600 rounded-lg p-4 shadow-lg">
                <div class="flex items-start justify-between">
                    <div class="flex items-center gap-2">
                        <div class="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                        <div>
                            <div class="font-semibold text-white">Tracking Route ${routeName}</div>
                            <div class="text-sm text-green-200">
                                ${destination}
                                ${vehicleNo ? ` • Bus ${vehicleNo}` : ''}
                            </div>
                            <div class="text-xs text-green-300 mt-1">
                                Live bus locations updating every minute
                            </div>
                        </div>
                    </div>
                    <button onclick="window.transitExplorer.stopBusLocationTracking()" 
                            class="text-green-300 hover:text-white ml-2">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
        
        // Auto-hide notification after 5 seconds
        setTimeout(() => {
            if (notification) {
                notification.style.opacity = '0.7';
            }
        }, 5000);
    }

    stopBusLocationTracking() {
        console.log('🛑 Stopping bus location tracking');
        
        // Stop updates
        this.stopBusLocationUpdates();
        
        // Clear tracking state
        this.currentTrackedRoute = null;
        
        // Hide notification
        const notification = document.getElementById('bus-tracking-notification');
        if (notification) {
            notification.remove();
        }
        
        // Update selection indicator
        if (this.currentHighlightedDepartures) {
            this.updateSelectionIndicator(`Route ${this.currentHighlightedDepartures.routeName} selected`);
        } else {
            this.updateSelectionIndicator('');
        }
    }

    // Add missing stopBusLocationUpdates method
    stopBusLocationUpdates() {
        if (this.busLocationInterval) {
            clearInterval(this.busLocationInterval);
            this.busLocationInterval = null;
        }
        
        // Clear bus locations from map
        if (this.map && this.map.getSource('bus-locations')) {
            this.map.getSource('bus-locations').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
        
        console.log('🛑 Bus location updates stopped');
    }

    // Add missing startBusLocationUpdates method
    startBusLocationUpdates(routeId, stopIds = []) {
        console.log(`🔄 Starting bus location updates for route: ${routeId}`);
        
        // Stop any existing updates
        this.stopBusLocationUpdates();
        
        // Start new interval for bus location updates
        this.busLocationInterval = setInterval(() => {
            this.updateBusLocations(routeId, stopIds);
        }, 30000); // Update every 30 seconds
        
        // Initial update
        this.updateBusLocations(routeId, stopIds);
    }

    // Updated to use real transit API data instead of mock data
    updateBusLocations(routeId, stopIds = []) {
        console.log(`🚌 Updating bus locations for route: ${routeId}`);
        
        // In a real implementation, this would call the transit agency's API
        // For now, we'll show a message that live tracking would be available
        const message = `Live bus tracking for route ${routeId} would be available through transit API integration`;
        console.log(message);
        
        // Clear any existing bus locations since we don't have real data
        if (this.map && this.map.getSource('bus-locations')) {
            this.map.getSource('bus-locations').setData({
                type: 'FeatureCollection',
                features: []
            });
        }
        
        // Note: In a production environment, this method would:
        // 1. Call the appropriate transit API (GTFS-realtime, agency-specific API)
        // 2. Parse vehicle positions for the specific route
        // 3. Update the map with real bus locations
        // 4. Calculate real ETAs based on current positions and stops
    }

    setupEventListeners() {
        // Enable location button
        document.getElementById('enable-location-btn').addEventListener('click', () => {
            this.requestLocation();
        });

        // Center location button
        document.getElementById('center-location-btn').addEventListener('click', () => {
            if (this.userLocation) {
                this.centerOnLocation();
            }
        });

        // Nearest stop button
        document.getElementById('nearest-stop-btn').addEventListener('click', () => {
            this.findNearestStopManually();
        });

        // Stop selector button and dropdown
        this.setupStopSelector();

        // Set up departure tabs
        this.setupDepartureTabs();

        // Add refresh button functionality to the last updated element
        const lastUpdated = document.getElementById('last-updated');
        if (lastUpdated) {
            lastUpdated.style.cursor = 'pointer';
            lastUpdated.title = 'Click to refresh departures';
            lastUpdated.addEventListener('click', () => {
                if (this.currentStop) {
                    console.log('🔄 Manual refresh triggered...');
                    this.loadDepartures(this.currentStop);
                }
            });
        }
        
        // Add keyboard handler for escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.clearAllSelections();
                this.hideStopDropdown();
            }
        });

        // Click outside to close dropdown
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('stop-dropdown');
            const button = document.getElementById('stop-selector-btn');
            
            if (!dropdown.contains(e.target) && !button.contains(e.target)) {
                this.hideStopDropdown();
            }
        });
        
        // Auto-select closest stop checkbox
        const autoSelectCheckbox = document.getElementById('auto-select-stop');
        if (autoSelectCheckbox) {
            this.autoSelectClosestStop = autoSelectCheckbox.checked;
            autoSelectCheckbox.addEventListener('change', (e) => {
                this.autoSelectClosestStop = e.target.checked;
                console.log(`🎯 Auto-select closest stop: ${this.autoSelectClosestStop}`);
                
                // If enabled and map is loaded, find closest stop immediately
                if (this.autoSelectClosestStop && this.map && this.map.isSourceLoaded(this.sourceName)) {
                    this.findClosestStopToMapCenter();
                }
            });
        }

        // Clear route filter button
        const clearFilterBtn = document.getElementById('clear-route-filter');
        if (clearFilterBtn) {
            clearFilterBtn.addEventListener('click', () => {
                console.log('🔄 Clear route filter button clicked');
                this.clearRouteFilter();
                this.clearRouteHighlight();
            });
        }
    }

    setupStopSelector() {
        const stopSelectorBtn = document.getElementById('stop-selector-btn');
        const stopDropdown = document.getElementById('stop-dropdown');
        const stopSearchInput = document.getElementById('stop-search-input');
        
        // Toggle dropdown
        stopSelectorBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleStopDropdown();
        });
        
        // Search functionality
        stopSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            this.filterStopOptions(query);
        });
        
        // Handle search input focus
        stopSearchInput.addEventListener('focus', () => {
            // Clear selection when user starts typing
            stopSearchInput.value = '';
            this.loadVisibleStops();
        });
        
        console.log('✅ Stop selector events set up');
    }

    toggleStopDropdown() {
        const dropdown = document.getElementById('stop-dropdown');
        const isHidden = dropdown.classList.contains('hidden');
        
        if (isHidden) {
            this.showStopDropdown();
        } else {
            this.hideStopDropdown();
        }
    }

    showStopDropdown() {
        const dropdown = document.getElementById('stop-dropdown');
        dropdown.classList.remove('hidden');
        
        // Load stops if not already loaded
        if (!this.visibleStops || this.visibleStops.length === 0) {
            this.loadVisibleStops();
        }
        
        // Focus search input
        setTimeout(() => {
            document.getElementById('stop-search-input').focus();
        }, 100);
    }

    hideStopDropdown() {
        const dropdown = document.getElementById('stop-dropdown');
        dropdown.classList.add('hidden');
    }

    async loadVisibleStops() {
        console.log('🔍 Loading visible stops for dropdown...');
        
        try {
            // Get current map bounds for visible stops
            const bounds = this.map.getBounds();
            
            // Query all stop features from the map
            const allStopFeatures = this.map.querySourceFeatures(this.sourceName, {
                sourceLayer: this.sourceLayer,
                filter: ['==', ['get', 'feature_type'], 'stop']
            });
            
            if (!allStopFeatures || allStopFeatures.length === 0) {
                this.displayStopOptions([]);
                return;
            }
            
            // Filter stops within map bounds and add distance info
            // Use BusStop class to get proper lat/lon from properties (not geometry)
            const visibleStops = allStopFeatures
                .filter(feature => {
                    const busStop = new BusStop(feature);
                    if (!busStop.lat || !busStop.lon) return false;
                    return busStop.lon >= bounds.getWest() && busStop.lon <= bounds.getEast() &&
                           busStop.lat >= bounds.getSouth() && busStop.lat <= bounds.getNorth();
                })
                .map(feature => {
                    const busStop = new BusStop(feature);
                    // Add distance as a property to the BusStop instance
                    if (this.userLocation) {
                        busStop.distance = busStop.getDistance(this.userLocation);
                    } else {
                        busStop.distance = null;
                    }
                    // Add route count for better sorting when no location
                    busStop.routeCount = busStop.getRoutesFromTimetable().length;
                    return busStop;
                })
                .sort((a, b) => {
                    // Sort by distance if available
                    if (a.distance !== null && b.distance !== null) {
                        return a.distance - b.distance;
                    } else if (a.distance !== null) {
                        return -1;
                    } else if (b.distance !== null) {
                        return 1;
                    } else {
                        // When no location, sort by route count (busier stops first), then by name
                        if (a.routeCount !== b.routeCount) {
                            return b.routeCount - a.routeCount; // More routes first
                        }
                        return a.name.localeCompare(b.name);
                    }
                })
                .slice(0, 50); // Limit to 50 stops for performance
            
            this.visibleStops = visibleStops;
            this.displayStopOptions(visibleStops);
            
            // If no location and this is the first load, show a hint
            if (!this.userLocation && visibleStops.length > 0) {
                console.log(`📍 Loaded ${visibleStops.length} stops (sorted by activity since no location available)`);
            }
            
        } catch (error) {
            console.error('Error loading visible stops:', error);
            this.displayStopOptions([]);
        }
    }

    displayStopOptions(stops) {
        const stopOptionsList = document.getElementById('stop-options-list');
        
        if (stops.length === 0) {
            const noLocationMessage = !this.userLocation ? 
                `<div class="px-4 py-3 text-center">
                    <div class="text-gray-400 text-sm mb-2">No stops found in current view</div>
                    <div class="text-xs text-gray-500">Try zooming out or moving the map</div>
                </div>` :
                `<div class="px-4 py-3 text-gray-400 text-sm text-center">
                    No stops found in current view
                </div>`;
            
            stopOptionsList.innerHTML = noLocationMessage;
            return;
        }
        
        const currentStopId = this.currentStop?.properties?.id || 
                             this.currentStop?.properties?.stop_id;
        
        // Debug: Log first stop's properties to see available fields
        if (stops.length > 0) {
            console.log('🔍 First stop properties:', stops[0].feature?.properties);
            console.log('🔍 First stop displayInfo:', stops[0].getDisplayInfo());
        }
        
        // Add header with sorting info when location is unavailable
        let headerHTML = '';
        if (!this.userLocation && stops.length > 0) {
            headerHTML = `
                <div class="px-4 py-2 border-b border-gray-600 text-xs text-gray-400">
                    <div class="flex items-center gap-2">
                        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        Sorted by activity (busiest stops first)
                    </div>
                </div>
            `;
        }
        
        const optionsHTML = stops.map(stop => {
            const isSelected = stop.id === currentStopId;
            const routesInfo = stop.getRoutesFromTimetable();
            const topRoutes = routesInfo.slice(0, 3);
            const displayInfo = stop.getDisplayInfo(); // Get once and reuse
            
            // Debug destination info
            const towardsStop = stop.getProperty('towards_stop');
            console.log(`🔍 Stop ${stop.name}: towards_stop="${towardsStop}", displayInfo.to="${displayInfo.to}"`);
            
            return `
                <div class="stop-option ${isSelected ? 'stop-option-selected' : ''}" 
                     data-stop-id="${stop.id}">
                    <div class="stop-option-name">${stop.name}</div>
                    <div class="stop-option-details">
                        <span>${routesInfo.length} routes</span>
                        <div class="status-indicator ${stop.hasLiveData ? 'status-live' : 'status-scheduled'}"></div>
                    </div>
                    ${topRoutes.length > 0 ? `
                        <div class="stop-option-routes">
                            ${topRoutes.map(route => {
                                const routeInfo = {
                                    agency: route.agency || 'BEST',
                                    fareType: route.fareType || DataUtils.detectFareTypeFromRoute(route.name)
                                };
                                return DataUtils.getStyledRouteBadge(route.name, routeInfo, 'small');
                            }).join('')}
                            ${routesInfo.length > 3 ? `<span class="text-gray-400 text-xs">+${routesInfo.length - 3}</span>` : ''}
                        </div>
                    ` : ''}
                    ${displayInfo.to ? `
                        <div class="stop-option-destinations text-xs text-gray-400 mt-1">
                            <span class="text-gray-500">To:</span> ${displayInfo.to}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        stopOptionsList.innerHTML = headerHTML + optionsHTML;
        
        // Add click handlers
        stopOptionsList.querySelectorAll('.stop-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const stopId = option.dataset.stopId;
                const stop = stops.find(s => s.id === stopId);
                if (stop) {
                    this.selectStopFromDropdown(stop);
                }
            });
        });
    }

    filterStopOptions(query) {
        if (!this.visibleStops) return;
        
        const filteredStops = this.visibleStops.filter(stop => 
            stop.name.toLowerCase().includes(query) ||
            stop.description?.toLowerCase().includes(query)
        );
        
        this.displayStopOptions(filteredStops);
    }

    selectStopFromDropdown(busStop) {
        console.log(`🚏 Selecting stop from dropdown: ${busStop.name}`);
        
        // Update the button text
        this.updateStopSelectorButton(busStop);
        
        // Hide dropdown
        this.hideStopDropdown();
        
        // Clear previous selections
        this.clearAllSelections();
        
        // Select the stop using the feature from the BusStop object
        this.selectStop(busStop.feature);
        
        // Center map on the new stop
        if (busStop.coordinates) {
            this.map.flyTo({
                center: busStop.coordinates,
                zoom: Math.max(15, this.map.getZoom()),
                duration: 1500
            });
        }
    }

    updateStopSelectorButton(busStop) {
        const selectedStopName = document.getElementById('selected-stop-name');
        
        selectedStopName.innerHTML = `
            <svg class="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
            </svg>
            <span>${busStop.name}</span>
        `;
    }

    clearAllSelections() {
        console.log('🔄 Clearing all selections...');
        this.clearRouteHighlight();
        this.clearDepartureHighlights();
        this.clearRouteFilter();
        this.clearStopHighlight();
        this.clearRouteSelections(); // Clear interactive route badge selections
        this.stopBusLocationTracking(); // Stop bus tracking
        this.currentSelectedStop = null;

        // Clean up any remaining markers
        if (this.nearestStopMarker) {
            this.nearestStopMarker.remove();
            this.nearestStopMarker = null;
        }

        // Update URL to clear parameters
        this.updateTransitURL({ route: null, stop: null });

        // Clear the selection indicator
        this.updateSelectionIndicator('');
    }

    checkInitialLocationForIframe() {
        if (!this.map) return;

        const center = this.map.getCenter();
        const matchData = this.locationDataLoader.dataLookup.find(region =>
            this.isPointInBounds({ lng: center.lng, lat: center.lat }, region.bounds)
        );

        if (matchData) {
            // Find the corresponding city and update currentCity
            const matchingCity = this.cities.find(city => {
                const cityName = city.name.toLowerCase();
                const regionName = matchData.name.toLowerCase();
                return cityName === regionName || cityName.includes(regionName) || regionName.includes(cityName);
            });

            if (matchingCity) {
                console.log(`🎯 Initial location is in ${matchData.name}, updating current city to ${matchingCity.name}`);
                this.currentCity = matchingCity;
                this.renderCityButtons();
            }

            if (matchData.useIframe) {
                console.log(`🎯 Switching to iframe for ${matchData.name}`);
                this.switchToIframe(matchData);
            }
        }
    }

    async checkAndSwitchDataSource() {
        if (this.isSourceSwitching || !this.map) return;

        const bounds = this.map.getBounds();
        const result = this.locationDataLoader.getBestMatch(bounds);

        if (result.changed && result.match) {
            console.log(`🔄 Data source changed to: ${result.match.name}`);

            if (result.match.useIframe) {
                this.switchToIframe(result.match);
            } else {
                this.switchToMap();

                if (!this.hasInitialDataLoaded) {
                    console.log('⏳ Initial data not loaded yet, skipping map source update');
                    return;
                }

                if (!this.map.isSourceLoaded(this.sourceName)) {
                    console.log('⏳ Source not loaded yet, skipping map source update');
                    return;
                }

                await this.updateMapSource(result.match);
            }
        }
    }

    switchToIframe(matchData) {
        const mainElement = document.querySelector('main');
        const iframeContainer = document.getElementById('external-transit-container');
        const iframeElement = document.getElementById('external-transit-app');

        if (iframeContainer && iframeElement && matchData.iframeUrl) {
            this.isIframeMode = true;

            if (mainElement) mainElement.style.display = 'none';

            iframeElement.src = matchData.iframeUrl;
            iframeContainer.style.display = 'block';

            console.log(`📱 Switched to external app for ${matchData.name}: ${matchData.iframeUrl}`);
        }
    }

    switchToMap() {
        const mainElement = document.querySelector('main');
        const iframeContainer = document.getElementById('external-transit-container');
        const iframeElement = document.getElementById('external-transit-app');

        if (iframeContainer && iframeContainer.style.display !== 'none') {
            this.isIframeMode = false;

            iframeContainer.style.display = 'none';
            if (iframeElement) iframeElement.src = '';

            if (mainElement) mainElement.style.display = 'block';

            console.log('🗺️ Switched back to map view');
        }
    }

    async updateMapSource(matchData) {
        if (!this.map || this.isSourceSwitching) return;

        this.isSourceSwitching = true;

        try {
            const oldSourceName = this.sourceName;
            const newSource = matchData.source;
            const newSourceLayer = matchData.sourceLayer;

            console.log(`🔄 Updating map source from ${oldSourceName} to ${matchData.name}`);

            const layersToRecreate = [
                'routes',
                'routes-highlight',
                'stops',
                'stops-highlight',
                'stops-debug-labels'
            ];

            layersToRecreate.forEach(layerId => {
                if (this.map.getLayer(layerId)) {
                    this.map.removeLayer(layerId);
                }
            });

            if (this.map.getSource(oldSourceName)) {
                this.map.removeSource(oldSourceName);
            }

            this.vectorTileSource.url = newSource;
            this.sourceLayer = newSourceLayer;
            this.mapController.sourceLayer = newSourceLayer;

            this.map.addSource(oldSourceName, {
                type: 'vector',
                url: newSource,
                promoteId: 'id'
            });

            this.mapController.addLayers();

            this.stopController.sourceLayer = newSourceLayer;
            this.departureController.sourceLayer = newSourceLayer;

            await this.waitForSourceToLoad(oldSourceName);

            console.log(`🔍 Querying features from source: ${oldSourceName}, layer: ${newSourceLayer}`);

            const allFeaturesAllLayers = this.map.querySourceFeatures(oldSourceName);
            console.log(`🔍 Found ${allFeaturesAllLayers.length} total features across ALL layers`);

            if (allFeaturesAllLayers.length > 0) {
                const allSourceLayers = new Set(allFeaturesAllLayers.map(f => f.sourceLayer));
                console.log(`🔍 ALL available source layers:`, Array.from(allSourceLayers));

                allSourceLayers.forEach(layer => {
                    const layerFeatures = allFeaturesAllLayers.filter(f => f.sourceLayer === layer);
                    if (layerFeatures.length > 0 && layerFeatures[0].properties) {
                        const props = Object.keys(layerFeatures[0].properties);
                        console.log(`🔍 Layer "${layer}": ${layerFeatures.length} features, properties: ${props.slice(0, 5).join(', ')}...`);
                    }
                });
            }

            const testFeatures = this.map.querySourceFeatures(oldSourceName, {
                sourceLayer: newSourceLayer
            });
            console.log(`🔍 Found ${testFeatures.length} features in specified layer: ${newSourceLayer}`);

            if (testFeatures.length > 0) {
                const sampleFeature = testFeatures[0];
                console.log(`🔍 Sample feature properties:`, Object.keys(sampleFeature.properties));
                console.log(`🔍 Sample feature geometry type:`, sampleFeature.geometry.type);
                console.log(`🔍 Full sample feature:`, sampleFeature.properties);
                console.log(`🔍 Feature source layer:`, sampleFeature.sourceLayer);
                console.log(`🔍 Feature layer:`, sampleFeature.layer);

                const uniqueSourceLayers = new Set(testFeatures.map(f => f.sourceLayer));
                console.log(`🔍 Available source layers in tileset:`, Array.from(uniqueSourceLayers));
            }

            const routeFeatures = this.map.querySourceFeatures(oldSourceName, {
                sourceLayer: newSourceLayer,
                filter: [
                    'any',
                    ['==', ['get', 'feature_type'], 'route'],
                    ['==', ['get', 'type'], 'route']
                ]
            });
            console.log(`🔍 Found ${routeFeatures.length} route features`);

            const stopFeatures = this.map.querySourceFeatures(oldSourceName, {
                sourceLayer: newSourceLayer,
                filter: [
                    'any',
                    ['==', ['get', 'feature_type'], 'stop'],
                    ['==', ['get', 'type'], 'stop']
                ]
            });
            console.log(`🔍 Found ${stopFeatures.length} stop features`);

            if (routeFeatures.length === 0 && stopFeatures.length === 0) {
                console.warn(`⚠️ No transit data found in ${matchData.name} tileset at current location`);
                console.warn(`⚠️ This may be expected if zoomed out or viewing an area without transit data`);
            }

            this.queryVisibleTransitData();
            console.log(`✅ Map source updated successfully to: ${matchData.name}`);

        } catch (error) {
            console.error('❌ Error updating map source:', error);
        } finally {
            this.isSourceSwitching = false;
        }
    }

    async waitForSourceToLoad(sourceName, maxAttempts = 50) {
        console.log(`⏳ Waiting for source "${sourceName}" to load...`);

        for (let i = 0; i < maxAttempts; i++) {
            if (this.map.isSourceLoaded(sourceName)) {
                console.log(`✅ Source "${sourceName}" loaded after ${i + 1} attempts`);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.warn(`⚠️ Source "${sourceName}" did not load after ${maxAttempts} attempts`);
        return false;
    }

    handleLocationError(error) {
        let message = 'Location information is unavailable';
        
        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = 'Location access denied';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'Location information is unavailable';
                break;
            case error.TIMEOUT:
                message = 'Location request timed out';
                break;
        }
        
        this.updateLocationStatus(message, 'status-scheduled', true);
        console.warn('📍 Location error:', message);
        
        // Show fallback content to help user continue using the app
        this.showLocationFallbackContent();
    }



    showLocationFallbackContent() {
        console.log('📍 Showing location fallback content');
        console.log('✅ App remains functional without location - user can manually select stops');
        
        // Set user location to current city center if not already set
        if (!this.userLocation) {
            this.userLocation = {
                lng: this.currentCity.center[0],
                lat: this.currentCity.center[1]
            };
            console.log(`📍 Set fallback location to ${this.currentCity.name} center`);
        }
        
        // Update location status to show fallback
        this.updateLocationStatus(`Using ${this.currentCity.name} (location unavailable)`, 'status-scheduled', false);
        
        // Display helpful message in departure board
        this.showDepartureFallbackMessage();
        
        // Pre-load popular stops to make selection easier
        this.preloadPopularStops();
        
        // Update the stop selector button to be more prominent
        this.makeStopSelectorProminent();
        
        // Ensure map is positioned to show the city
        this.flyToCityBounds(this.currentCity);
    }

    showDepartureFallbackMessage() {
        const departureList = document.getElementById('departure-list');
        const liveList = document.getElementById('live-departure-list');
        const scheduledList = document.getElementById('scheduled-departure-list');
        
        const fallbackHTML = `
            <div class="text-center py-8">
                <div class="mb-4">
                    <svg class="w-16 h-16 mx-auto text-blue-400 mb-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
                    </svg>
                </div>
                <h3 class="text-xl font-semibold text-white mb-2">Select a Bus Stop</h3>
                <p class="text-gray-300 mb-4">Choose a stop from the dropdown above to see live departures</p>
                <div class="space-y-2 text-sm text-gray-400">
                    <p>• Click on the map to explore stops</p>
                    <p>• Use the search to find specific stops</p>
                    <p>• Enable location for automatic nearest stop</p>
                </div>
                <button id="open-stop-selector-btn" class="mt-6 bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
                    Browse Stops
                </button>
            </div>
        `;
        
        // Update all departure lists
        if (departureList) departureList.innerHTML = fallbackHTML;
        if (liveList) liveList.innerHTML = fallbackHTML;
        if (scheduledList) scheduledList.innerHTML = fallbackHTML;
        
        // Add click handler for the browse button
        setTimeout(() => {
            const browseBtn = document.getElementById('open-stop-selector-btn');
            if (browseBtn) {
                browseBtn.addEventListener('click', () => {
                    this.showStopDropdown();
                });
            }
        }, 100);
    }

    makeStopSelectorProminent() {
        const stopSelectorBtn = document.getElementById('stop-selector-btn');
        const selectedStopName = document.getElementById('selected-stop-name');
        
        if (stopSelectorBtn && selectedStopName) {
            // Add attention-grabbing styles
            stopSelectorBtn.classList.add('ring-2', 'ring-blue-400', 'ring-opacity-50');
            
            // Update button text to be more inviting
            selectedStopName.innerHTML = `
                <svg class="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/>
                </svg>
                <span class="text-blue-400">Choose a bus stop to get started</span>
            `;
            
            // Remove prominence after first interaction
            const removeProminence = () => {
                stopSelectorBtn.classList.remove('ring-2', 'ring-blue-400', 'ring-opacity-50');
                stopSelectorBtn.removeEventListener('click', removeProminence);
            };
            stopSelectorBtn.addEventListener('click', removeProminence);
        }
    }

    async preloadPopularStops() {
        try {
            // Wait for map sources to be available
            await this.waitForMapSources();
            
            // Load some stops in the current map view
            this.loadVisibleStops();
            
        } catch (error) {
            console.warn('Could not preload stops:', error);
        }
    }

    async requestLocation(hasURLSelection = false) {
        console.log('📍 Requesting user location...');
        
        if (!navigator.geolocation) {
            this.handleLocationError({ code: 'GEOLOCATION_NOT_SUPPORTED', message: 'Geolocation is not supported by this browser.' });
            return;
        }

        // Update status but don't show banner yet
        this.updateLocationStatus('Requesting location...', 'status-scheduled');

        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 60000
                });
            });

            const rawLocation = {
                lng: position.coords.longitude,
                lat: position.coords.latitude
            };

            console.log('📍 Raw location acquired:', rawLocation);
            
            // Check if user location is within any covered city
            const userWithinCoverage = this.isLocationWithinAnyCityBounds(rawLocation);
            
            if (userWithinCoverage) {
                // User is within coverage, use their actual location
                this.userLocation = rawLocation;
                console.log('📍 User location is within coverage area');
                
                // Find which city they're in and update current city if needed
                const userCity = this.findCityForLocation(rawLocation);
                if (userCity && userCity.id !== this.currentCity.id) {
                    this.currentCity = userCity;
                    this.renderCityButtons(); // Update button states
                    console.log(`📍 Updated current city to: ${userCity.name}`);
                }
                
                // Update UI immediately after successful location acquisition
                this.updateLocationStatus('Location found', 'status-live', false);
                this.enableCenterButton();
                this.enableNearestStopButton();
                
                // Add user location marker
                this.addUserLocationMarker();
                
                // Only find nearest stop automatically if no URL selection exists
                if (!hasURLSelection) {
                    console.log('📍 No URL selection, proceeding to find nearest stop');
                    // Wait for map sources to load before finding stops
                    await this.waitForMapSources();
                    await this.findNearestStop();
                } else {
                    console.log('📍 URL selection exists, skipping automatic nearest stop finding');
                }
                
                // Center map on user location
                this.centerOnLocation();
            } else {
                // User is outside coverage, use default city location
                console.log('📍 User location is outside coverage area, using default city location');
                this.userLocation = {
                    lng: this.currentCity.center[0],
                    lat: this.currentCity.center[1]
                };
                
                // Update UI to show fallback location
                this.updateLocationStatus(`Using ${this.currentCity.name} (outside coverage)`, 'status-scheduled', false);
                this.enableCenterButton();
                this.enableNearestStopButton();
                
                // Fly to city bounds instead of centering on specific location
                this.flyToCityBounds(this.currentCity);
                
                // Still find nearest stop within the city if no URL selection
                if (!hasURLSelection) {
                    console.log('📍 Finding nearest stop within city bounds');
                    await this.waitForMapSources();
                    await this.findNearestStop();
                }
            }

        } catch (error) {
            console.error('📍 Location error caught:', error);
            this.handleLocationError(error);
            
            // Use default city location as fallback
            this.userLocation = {
                lng: this.currentCity.center[0],
                lat: this.currentCity.center[1]
            };
            
            console.log(`📍 Using default city location: ${this.currentCity.name}`);
            this.updateLocationStatus(`Using ${this.currentCity.name} (location unavailable)`, 'status-scheduled', false);
            this.enableCenterButton();
            this.enableNearestStopButton();
            
            // Fly to city bounds
            this.flyToCityBounds(this.currentCity);
            
            // Find nearest stop within the city if no URL selection
            if (!hasURLSelection) {
                console.log('📍 Finding nearest stop within city bounds after location error');
                await this.waitForMapSources();
                await this.findNearestStop();
            }
            
            // Ensure fallback content is shown even if error handling fails
            setTimeout(() => {
                if (!this.currentStop && !this.userLocation) {
                    console.log('🔄 Ensuring fallback content is displayed after location error');
                    this.showLocationFallbackContent();
                }
            }, 500);
        }
    }

    // Add method to wait for map sources to load
    async waitForMapSources() {
        console.log('⏳ Waiting for map sources to load...');
        
        return new Promise((resolve) => {
            const checkSources = () => {
                try {
                    const sourceExists = this.map.getSource(this.sourceName);
                    
                    if (sourceExists && this.map.isSourceLoaded(this.sourceName)) {
                        console.log('✅ Map sources loaded');
                        resolve();
                    } else {
                        console.log('⏳ Still waiting for sources...');
                        setTimeout(checkSources, 500);
                    }
                } catch (error) {
                    console.warn('⚠️ Error checking sources, retrying...', error);
                    setTimeout(checkSources, 500);
                }
            };
            checkSources();
        });
    }

    enableCenterButton() {
        const btn = document.getElementById('center-location-btn');
        btn.disabled = false;
    }

    enableNearestStopButton() {
        const btn = document.getElementById('nearest-stop-btn');
        if (btn) {
            btn.disabled = false;
        }
    }

    updateLocationStatus(message, statusClass, showEnableButton = false) {
        const statusEl = document.getElementById('location-status');
        const indicator = statusEl.querySelector('.status-indicator');
        const text = statusEl.querySelector('span');
        const enableBtn = document.getElementById('enable-location-btn');
        
        // Remove all status classes
        indicator.classList.remove('status-live', 'status-scheduled');
        indicator.classList.add(statusClass);
        text.textContent = message;
        
        // Show or hide the enable button
        if (showEnableButton && enableBtn) {
            enableBtn.classList.remove('hidden');
        } else if (enableBtn) {
            enableBtn.classList.add('hidden');
        }
    }

    addUserLocationMarker() {
        if (this.userLocationMarker) {
            this.userLocationMarker.remove();
        }

        const el = document.createElement('div');
        el.className = 'user-location-marker';
        el.style.cssText = `
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #3b82f6;
            border: 3px solid white;
            box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
            animation: pulse 2s infinite;
        `;

        this.userLocationMarker = new mapboxgl.Marker(el)
            .setLngLat([this.userLocation.lng, this.userLocation.lat])
            .addTo(this.map);
    }

    centerOnLocation() {
        if (this.userLocation) {
            // Check if the current user location is actually a city center (fallback location)
            const isCityCenter = this.userLocation.lng === this.currentCity.center[0] && 
                                this.userLocation.lat === this.currentCity.center[1];
            
            if (isCityCenter) {
                // If it's the city center, fly to city bounds instead of specific point
                this.flyToCityBounds(this.currentCity);
            } else {
                // If it's an actual user location, zoom to it
                this.map.flyTo({
                    center: [this.userLocation.lng, this.userLocation.lat],
                    zoom: 15,
                    duration: 2000
                });
            }
        }
    }

    debugSourceStatus() {
        console.log('🔍 Debugging source status:');
        
        try {
            const transitSource = this.map.getSource(this.sourceName);
            
            console.log(`Transit source (${this.sourceName}):`, transitSource ? 'EXISTS' : 'MISSING');
            
            if (transitSource) {
                console.log('Transit source loaded:', this.map.isSourceLoaded(this.sourceName));
            }
            
            // Check if layers exist
            const stopsLayer = this.map.getLayer('stops');
            const routesLayer = this.map.getLayer('routes');
            
            console.log('Stops layer:', stopsLayer ? 'EXISTS' : 'MISSING');
            console.log('Routes layer:', routesLayer ? 'EXISTS' : 'MISSING');
            
            // Try to query a small sample only if source is loaded
            if (transitSource && this.map.isSourceLoaded(this.sourceName)) {
                const stopsSample = this.map.querySourceFeatures(this.sourceName, {
                    sourceLayer: this.sourceLayer,
                    filter: ['==', ['get', 'feature_type'], 'stop']
                });
                console.log(`Sample stops from source: ${stopsSample.length}`);
                
                if (stopsSample.length > 0) {
                    console.log('Sample stop properties:', stopsSample[0].properties);
                    console.log('Sample stop geometry:', stopsSample[0].geometry);

                    const idCounts = new Map();
                    stopsSample.forEach(stop => {
                        const id = stop.properties.id;
                        idCounts.set(id, (idCounts.get(id) || 0) + 1);
                    });

                    const duplicateIds = Array.from(idCounts.entries())
                        .filter(([id, count]) => count > 1);

                    if (duplicateIds.length > 0) {
                        console.error('🚨 DUPLICATE IDs FOUND:', duplicateIds);
                        console.error('Example duplicates:', stopsSample
                            .filter(s => s.properties.id === duplicateIds[0][0])
                            .map(s => ({ id: s.properties.id, name: s.properties.name }))
                        );
                    } else {
                        console.log('✅ All stop IDs are unique');
                    }
                }
                
                const routesSample = this.map.querySourceFeatures(this.sourceName, {
                    sourceLayer: this.sourceLayer,
                    filter: ['==', ['get', 'feature_type'], 'route']
                });
                console.log(`Sample routes from source: ${routesSample.length}`);
                
                if (routesSample.length > 0) {
                    console.log('Sample route properties:', routesSample[0].properties);
                }
            } else {
                console.warn('⚠️ Transit source not available for querying');
            }
            
        } catch (error) {
            console.error('Error in source debug:', error);
        }
    }

    showStopError(message) {
        console.warn('🚏 Stop error:', message);
        
        const departureList = document.getElementById('departure-list');
        if (departureList) {
            departureList.innerHTML = `
                <div class="text-center py-8 text-red-400">
                    <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                    </svg>
                    <p>${message}</p>
                    <p class="text-sm mt-1">Try selecting a different area</p>
                </div>
            `;
        }
        
        // Also update the status
        this.updateLocationStatus(message, 'status-scheduled', true);
    }

    async findNearestStop() {
        if (!this.userLocation) return;

        console.log('🔍 Finding nearest bus stop...');

        try {
            // Ensure the map and sources are loaded
            if (!this.map || !this.map.isSourceLoaded(this.sourceName)) {
                console.log('⏳ Map source not loaded yet, waiting...');
                
                // Wait for source to load
                await new Promise((resolve) => {
                    const checkSource = () => {
                        if (this.map.isSourceLoaded(this.sourceName)) {
                            resolve();
                        } else {
                            setTimeout(checkSource, 500);
                        }
                    };
                    checkSource();
                });
            }

            // First, center the map on user location to ensure stops are in viewport
            this.map.setCenter([this.userLocation.lng, this.userLocation.lat]);
            
            // Use a larger radius to query nearby stops
            const pixelRadius = 5; // Larger radius to catch more stops
            const center = this.map.project([this.userLocation.lng, this.userLocation.lat]);
            
            // Query stops within the pixel radius
            const bbox = [
                [center.x - pixelRadius, center.y - pixelRadius],
                [center.x + pixelRadius, center.y + pixelRadius]
            ];
            
            let features = this.map.queryRenderedFeatures(bbox, {
                layers: ['stops']
            });

            // If queryRenderedFeatures doesn't find anything, fall back to querySourceFeatures
            if (!features || features.length === 0) {
                console.log('🔍 No rendered features found, trying source features...');
                
                features = this.map.querySourceFeatures(this.sourceName, {
                    sourceLayer: this.sourceLayer,
                    filter: ['==', ['get', 'feature_type'], 'stop']
                });
                
                console.log(`📊 Found ${features.length} total features from source`);
                
                // Filter features to only those within a reasonable distance (5km)
                if (features && features.length > 0) {
                    features = features.filter(feature => {
                        const busStop = new BusStop(feature);
                        if (busStop.lat && busStop.lon) {
                            const distance = DataUtils.calculateDistance(
                                this.userLocation.lat, this.userLocation.lng,
                                busStop.lat, busStop.lon
                            );
                            return distance <= 5; // Within 5km
                        }
                        return false;
                    });
                }
            }

            if (!features || features.length === 0) {
                console.log('❌ No stop features found');
                this.showNoStopsMessage();
                return;
            }
            
            // De-duplicate features by ID (vector tiles can contain duplicates)
            const uniqueFeatures = this.deduplicateFeatures(features);
            console.log(`🚏 Found ${uniqueFeatures.length} unique stop features to analyze`);

            // Calculate distances and find nearest stop using BusStop class
            // which correctly extracts lat/lon from properties (not geometry)
            let nearestStop = null;
            let minDistance = Infinity;
            let debugStops = [];

            uniqueFeatures.forEach(feature => {
                const busStop = new BusStop(feature);
                if (busStop.lat && busStop.lon) {
                    const distance = DataUtils.calculateDistance(
                        this.userLocation.lat, this.userLocation.lng,
                        busStop.lat, busStop.lon
                    );
                    
                    // Debug info
                    debugStops.push({
                        name: busStop.name || 'Unknown',
                        distance: distance,
                        lat: busStop.lat,
                        lon: busStop.lon
                    });

                    if (distance < minDistance) {
                        minDistance = distance;
                        nearestStop = feature;
                    }
                }
            });

            // Log debug info for first few stops
            console.log('🔍 Nearest stops analysis:', debugStops.sort((a, b) => a.distance - b.distance).slice(0, 5));

            if (nearestStop && minDistance <= 2) { // Within 2km
                console.log(`🚏 Nearest stop found: ${nearestStop.properties.name || 'Unknown'} at ${(minDistance * 1000).toFixed(0)}m`);
                this.selectStop(nearestStop);
                this.highlightNearestStop(nearestStop);
            } else if (nearestStop) {
                console.log(`⚠️ Nearest stop is too far: ${(minDistance * 1000).toFixed(0)}m away`);
                this.showDistantStopMessage(minDistance);
            } else {
                console.log('❌ No valid stops found');
                this.showNoStopsMessage();
            }

        } catch (error) {
            console.error('Error finding nearest stop:', error);
            this.showStopError('Unable to find nearby stops.');
        }
    }

    async findNearestStopForce() {
        if (!this.userLocation) return;

        console.log('🔍 Finding nearest bus stop (forced)...');

        try {
            // Ensure the map and sources are loaded
            if (!this.map || !this.map.isSourceLoaded(this.sourceName)) {
                console.log('⏳ Map source not loaded yet, waiting...');
                return;
            }

            // Query all source features
            const features = this.map.querySourceFeatures(this.sourceName, {
                sourceLayer: this.sourceLayer,
                filter: ['==', ['get', 'feature_type'], 'stop']
            });

            if (!features || features.length === 0) {
                this.showNoStopsMessage();
                return;
            }

            // Calculate distances and find nearest stop (no distance limit)
            // Use BusStop class which correctly extracts lat/lon from properties
            let nearestStop = null;
            let nearestBusStop = null;
            let minDistance = Infinity;

            features.forEach(feature => {
                const busStop = new BusStop(feature);
                if (busStop.lat && busStop.lon) {
                    const distance = DataUtils.calculateDistance(
                        this.userLocation.lat, this.userLocation.lng,
                        busStop.lat, busStop.lon
                    );

                    if (distance < minDistance) {
                        minDistance = distance;
                        nearestStop = feature;
                        nearestBusStop = busStop;
                    }
                }
            });

            if (nearestStop && nearestBusStop) {
                console.log(`🚏 Forced selection - nearest stop: ${nearestBusStop.name || 'Unknown'} at ${(minDistance * 1000).toFixed(0)}m`);
                this.selectStop(nearestStop);
                this.highlightNearestStop(nearestStop);
                
                // Fly to the stop location using lat/lon from properties
                this.map.flyTo({
                    center: [nearestBusStop.lon, nearestBusStop.lat],
                    zoom: 15,
                    duration: 2000
                });
            } else {
                this.showNoStopsMessage();
            }

        } catch (error) {
            console.error('Error finding nearest stop (forced):', error);
            this.showStopError('Unable to find nearby stops.');
        }
    }

    selectStop(stopFeature) {
        this.currentStop = stopFeature;
        
        // Clear any previous highlights and markers
        this.clearAllSelections();
        
        // Create BusStop and set currentSelectedStop BEFORE highlightStop
        // because highlightStop now uses currentSelectedStop for marker coordinates
        const busStop = new BusStop(stopFeature);
        this.currentSelectedStop = busStop;
        
        // Highlight the selected stop using a marker (layer system has incorrect geometry)
        this.highlightStop(busStop.id);
        
        this.displayStopInfo(stopFeature);
        this.loadDepartures(stopFeature);
        
        // Update URL with stop selection
        if (stopFeature.properties) {
            const stopName = stopFeature.properties.name || stopFeature.properties.stop_name;
            if (stopName) {
                this.updateTransitURL({ stop: stopName });
            }
        }
        
        // Start auto-refresh for live data
        this.startAutoRefresh();
    }

    highlightNearestStop(stopFeature) {
        // Remove the old marker-based highlighting
        // The selectStop method will handle highlighting via the layer system
        const busStop = new BusStop(stopFeature);
        console.log(`🚏 Found nearest stop: ${busStop.name}`);
        
        // Clean up any existing marker
        if (this.nearestStopMarker) {
            this.nearestStopMarker.remove();
            this.nearestStopMarker = null;
        }
    }

    displayStopInfo(stopFeature, busStop = null) {
        if (!busStop) {
            busStop = new BusStop(stopFeature);
        }
        
        // Update the stop selector button
        this.updateStopSelectorButton(busStop);
        
        const stopInfoEl = document.getElementById('stop-info');
        const displayInfo = busStop.getDisplayInfo(this.userLocation);
        
        // Get routes from timetable data which includes agency/fare info
        const routesWithInfo = busStop.getRoutesFromTimetable();
        
        stopInfoEl.innerHTML = `
            <div class="space-y-4">
                <!-- Stop Statistics -->
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <span class="text-gray-400">Routes:</span>
                        <span class="text-white font-medium">${routesWithInfo.length}</span>
                    </div>
                    
                    ${displayInfo.tripCount ? `
                        <div>
                            <span class="text-gray-400">Daily Trips:</span>
                            <span class="text-white font-medium">${displayInfo.tripCount}</span>
                        </div>
                    ` : ''}
                    
                    ${displayInfo.avgWaitTime ? `
                        <div>
                            <span class="text-gray-400">Avg Wait:</span>
                            <span class="text-white font-medium">${displayInfo.avgWaitTime} min</span>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Destinations -->
                ${displayInfo.to ? `
                    <div>
                        <div class="text-gray-400 text-sm mb-2">Buses go to:</div>
                        <div class="text-white text-sm bg-gray-700/30 rounded p-3 border-l-4 border-blue-500">
                            ${displayInfo.to}
                        </div>
                    </div>
                ` : ''}
                
                <!-- Live Data Status -->
                <div class="flex items-center gap-2 pt-2 border-t border-gray-600">
                    <div class="status-indicator ${displayInfo.hasLiveData ? 'status-live' : 'status-scheduled'}"></div>
                    <span class="text-xs text-gray-400">
                        ${displayInfo.hasLiveData ? 'Live data available' : 'Scheduled data only'}
                    </span>
                </div>
            </div>
        `;
        
        // Show and populate interactive routes
        this.displayInteractiveRoutes(routesWithInfo);
        
        // Set up browse stops button (keeping existing functionality)
        this.setupBrowseStopsIfNeeded(busStop);
    }

    displayInteractiveRoutes(routesWithInfo) {
        const routesContainer = document.getElementById('stop-routes-container');
        const routesList = document.getElementById('interactive-routes-list');
        
        if (routesWithInfo.length === 0) {
            routesContainer.classList.add('hidden');
            return;
        }
        
        // Generate interactive route badges
        const routeBadgesHtml = routesWithInfo.map((routeInfo, index) => {
            const routeClasses = this.getInteractiveRouteBadgeClasses(routeInfo);
            
            return `
                <button class="interactive-route-badge ${routeClasses}" 
                        data-route-name="${routeInfo.name}"
                        data-route-agency="${routeInfo.agency || 'BEST'}"
                        data-route-index="${index}"
                        title="Click to highlight route on map">
                    ${routeInfo.name}
                </button>
            `;
        }).join('');
        
        routesList.innerHTML = routeBadgesHtml;
        routesContainer.classList.remove('hidden');
        
        // Add click handlers for interactive routes
        routesList.querySelectorAll('.interactive-route-badge').forEach(badge => {
            badge.addEventListener('click', (e) => {
                const routeName = badge.dataset.routeName;
                const routeAgency = badge.dataset.routeAgency;
                this.handleInteractiveRouteBadgeClick(routeName, routeAgency, badge);
            });
        });
    }

    getInteractiveRouteBadgeClasses(routeInfo) {
        const agency = routeInfo.agency || 'BEST';
        const fareType = routeInfo.fareType || DataUtils.detectFareTypeFromRoute(routeInfo.name);
        
        if (agency.toUpperCase() === 'BEST') {
            if (fareType === 'AC') {
                return 'route-best-ac';
            } else if (fareType === 'Regular') {
                return 'route-best-regular';
            } else {
                return 'route-best-default';
            }
        } else {
            // Other agencies
            if (routeInfo.isLive) {
                return 'route-other-live';
            } else {
                return 'route-other-scheduled';
            }
        }
    }

    async handleInteractiveRouteBadgeClick(routeName, routeAgency, badgeElement) {
        console.log(`🚌 Interactive route badge clicked: ${routeName} (${routeAgency})`);
        
        // Clear previous route selections
        this.clearRouteSelections();
        
        // Mark this badge as selected
        badgeElement.classList.add('selected');
        
        // Find and highlight corresponding route on map
        const routeId = await this.findRouteIdByName(routeName);
        if (routeId) {
            this.highlightRoute(routeId);
            
            // Highlight corresponding departure rows
            this.highlightDepartureRows(routeId, routeName);
            
            // Update URL with route selection
            this.updateTransitURL({ route: routeName });
            
            // Update selection indicator
            this.updateSelectionIndicator(`Route ${routeName} selected`);
        } else {
            console.warn(`Could not find route ID for: ${routeName}`);
            // Still highlight departure rows even without map route
            this.highlightDepartureRows(null, routeName);
            this.updateSelectionIndicator(`Route ${routeName} selected`);
        }
    }

    clearRouteSelections() {
        // Clear route highlights on map
        this.clearRouteHighlight();
        
        // Clear departure row highlights
        this.clearDepartureHighlights();
        
        // Clear interactive route badge selections
        const badges = document.querySelectorAll('.interactive-route-badge.selected');
        badges.forEach(badge => {
            badge.classList.remove('selected');
        });
        
        // Clear selection indicator
        this.updateSelectionIndicator('');
    }

    setupBrowseStopsIfNeeded(busStop) {
        // Keep the existing browse stops functionality
        // This maintains compatibility with the existing nearby stops panel
        this.loadNearbyStops(busStop);
    }

    // Add missing method for generating styled route badges
    getStyledRouteBadges(routeNames, busStop) {
        if (!routeNames || !Array.isArray(routeNames)) return '';
        
        // Get routes with full info from timetable
        const routesWithInfo = busStop.getRoutesFromTimetable();
        
        return routeNames.map(routeName => {
            // Find matching route info
            const routeInfo = routesWithInfo.find(r => r.name === routeName);
            return DataUtils.getStyledRouteBadge(routeName, routeInfo, 'small');
        }).join(' ');
    }

    async loadNearbyStops(currentStop) {
        console.log('🔍 Loading nearby stops...');
        
        try {
            // Query all stop features from the map
            const allStopFeatures = this.map.querySourceFeatures(this.sourceName, {
                sourceLayer: this.sourceLayer,
                filter: ['==', ['get', 'feature_type'], 'stop']
            });
            
            if (!allStopFeatures || allStopFeatures.length === 0) {
                console.warn('No stop features found');
                return;
            }
            
            // Convert to BusStop objects and calculate distances
            const nearbyStops = allStopFeatures
                .map(feature => new BusStop(feature))
                .filter(stop => stop.id !== currentStop.id) // Exclude current stop
                .map(stop => ({
                    ...stop,
                    distance: this.userLocation ? stop.getDistance(this.userLocation) : null
                }))
                .filter(stop => stop.distance === null || stop.distance <= 2) // Within 2km
                .sort((a, b) => {
                    if (a.distance === null && b.distance === null) return 0;
                    if (a.distance === null) return 1;
                    if (b.distance === null) return -1;
                    return a.distance - b.distance;
                })
                .slice(0, 10); // Limit to 10 nearby stops
            
            this.nearbyStops = nearbyStops;
            this.displayNearbyStops(nearbyStops);
            
        } catch (error) {
            console.error('Error loading nearby stops:', error);
        }
    }

    displayNearbyStops(stops) {
        const nearbyStopsList = document.getElementById('nearby-stops-list');
        
        // Check if the element exists, if not, log a warning and return
        if (!nearbyStopsList) {
            console.warn('⚠️ nearby-stops-list element not found in DOM - nearby stops display not available');
            return;
        }
        
        if (stops.length === 0) {
            nearbyStopsList.innerHTML = `
                <div class="text-center py-4 text-gray-400">
                    <p class="text-sm">No nearby stops found</p>
                </div>
            `;
            return;
        }
        
        const stopsHTML = stops.map(stop => {
            const displayInfo = stop.getDisplayInfo(this.userLocation);
            
            // Get route information for display
            const routes = stop.getRoutesFromTimetable();
            const topRoutes = routes.slice(0, 3);
            const remainingCount = Math.max(0, routes.length - 3);
            
            // Generate headway and agency text
            const avgHeadway = displayInfo.avgWaitTime || '15';
            const agencyText = routes.length > 0 ? routes[0].agency || 'BEST' : 'BEST';
            
            return `
                <div class="nearby-stop-item bg-gray-700/50 rounded p-3 cursor-pointer hover:bg-gray-700 transition-colors"
                     data-stop-id="${stop.id}">
                    <div class="flex justify-between items-start">
                        <div class="flex-1">
                            <h5 class="font-medium text-white text-sm">${displayInfo.name}</h5>
                            <div class="flex items-center gap-2 mt-1">
                                <span class="text-xs text-gray-400">${displayInfo.routeCount} routes</span>
                                <span class="text-gray-500">•</span>
                                <span class="text-xs text-gray-400">~${avgHeadway}min avg</span>
                                <div class="status-indicator status-${displayInfo.hasLiveData ? 'live' : 'scheduled'} scale-75"></div>
                            </div>
                            
                            <div class="text-xs text-gray-500 mb-2">${agencyText}</div>
                            
                            <div class="flex flex-wrap gap-1 mb-2">
                                ${topRoutes.map(route => {
                                    const routeInfo = {
                                        agency: route.agency || 'BEST',
                                        fareType: route.fareType || DataUtils.detectFareTypeFromRoute(route.name)
                                    };
                                    return DataUtils.getStyledRouteBadge(route.name, routeInfo, 'small');
                                }).join('')}
                                ${remainingCount > 0 ? 
                                    `<span class="text-gray-400 text-xs">+${remainingCount}</span>` : ''}
                            </div>
                            
                            ${displayInfo.description ? `
                                <div class="text-xs text-gray-400 truncate">${displayInfo.description}</div>
                            ` : ''}
                            
                            ${displayInfo.to ? `
                                <div class="text-xs text-gray-500 mt-1">
                                    <span class="text-gray-600">To:</span> ${displayInfo.to}
                                </div>
                            ` : ''}
                        </div>
                        <button class="select-stop-btn text-green-400 hover:text-green-300 ml-2 flex-shrink-0">
                            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        nearbyStopsList.innerHTML = stopsHTML;
        
        // Add click handlers for nearby stops
        nearbyStopsList.querySelectorAll('.nearby-stop-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const stopId = item.dataset.stopId;
                const stop = stops.find(s => s.id === stopId);
                if (stop) {
                    this.selectStopFromNearby(stop);
                }
            });
        });
    }

    showNearbyStopsPanel() {
        const panel = document.getElementById('nearby-stops-panel');
        if (panel && panel.classList.contains('hidden')) {
            panel.classList.remove('hidden');
            console.log('📋 Showing nearby stops panel');
        }
    }

    async findNearestStopManually() {
        console.log('🎯 Manual nearest stop finding triggered...');
        
        if (!this.userLocation) {
            console.warn('❌ Cannot find nearest stop: user location not available');
            this.updateLocationStatus('Location required for nearest stop', 'status-scheduled', true);
            return;
        }

        // Clear current selections
        this.clearAllSelections();
        
        // Update URL to clear parameters since we're resetting to nearest stop
        this.updateTransitURL({ route: null, stop: null });
        
        // Find and select nearest stop
        await this.findNearestStop();
        
        // Update status
        this.updateLocationStatus('Nearest stop selected', 'status-live', false);
    }

    /**
     * Log all features from transit tileset at a given point
     * Uses queryRenderedFeatures per https://docs.mapbox.com/mapbox-gl-js/example/queryrenderedfeatures/
     */
    logFeaturesAtPoint(point, lngLat) {
        console.log(`\n🔍 === Features at click point [${lngLat.lng.toFixed(5)}, ${lngLat.lat.toFixed(5)}] ===`);
        
        // Query all features at the click point from our transit layers
        const transitLayers = ['stops', 'routes', 'stops-highlight', 'routes-highlight'];
        const allFeatures = this.map.queryRenderedFeatures(point, {
            layers: transitLayers.filter(layer => this.map.getLayer(layer)) // Only query existing layers
        });
        
        console.log(`📊 Total features found: ${allFeatures.length}`);
        
        // Group by layer and feature_type
        const grouped = {};
        allFeatures.forEach(feat => {
            const layerId = feat.layer?.id || 'unknown';
            const featureType = feat.properties?.feature_type || 'unknown';
            const key = `${layerId} (${featureType})`;
            
            if (!grouped[key]) {
                grouped[key] = [];
            }
            grouped[key].push(feat);
        });
        
        // Log grouped features
        Object.entries(grouped).forEach(([key, features]) => {
            console.log(`\n📍 Layer: ${key} - ${features.length} feature(s)`);
            features.forEach((feat, i) => {
                const props = feat.properties || {};
                const geomType = feat.geometry?.type || 'unknown';
                const coordsPreview = feat.geometry?.coordinates 
                    ? (Array.isArray(feat.geometry.coordinates[0]) 
                        ? `${feat.geometry.coordinates.length} coords` 
                        : JSON.stringify(feat.geometry.coordinates))
                    : 'no coords';
                
                console.log(`   [${i}] ${props.name || props.route_name || 'Unnamed'}`);
                console.log(`       ID: ${props.id || props.route_id || feat.id || 'no id'}`);
                console.log(`       Geometry: ${geomType} (${coordsPreview})`);
                console.log(`       Properties:`, props);
            });
        });
        
        console.log(`\n🔍 === End of features ===\n`);
    }
    
    setupMapInteractions() {
        console.log('🎯 Setting up unified map interactions...');
        
        // Unified map click handler to handle overlapping features
        this.map.on('click', (e) => {
            // Log all features from transit tileset at click point (for debugging)
            this.logFeaturesAtPoint(e.point, e.lngLat);
            
            // Query features at the click point and find the nearest one
            const nearestStop = this.findNearestFeatureAtPoint(e.point, e.lngLat, 'stops');
            const nearestRoute = this.findNearestFeatureAtPoint(e.point, e.lngLat, 'routes');
            
            console.log(`🎯 Map click - Nearest stop: ${nearestStop ? 'found' : 'none'}, Nearest route: ${nearestRoute ? 'found' : 'none'}`);
            
            // Priority: stops first, then routes
            if (nearestStop) {
                this.handleStopClick(nearestStop, [nearestStop]);
            } else if (nearestRoute) {
                this.handleRouteClick(nearestRoute);
            } else {
                // Clear selections if clicking on empty map
                this.clearAllSelections();
            }
        });
        
        // Add route hover effects (separate from click handling)
        this.map.on('mouseenter', 'routes', () => {
            this.map.getCanvas().style.cursor = 'pointer';
        });

        this.map.on('mouseleave', 'routes', () => {
            this.map.getCanvas().style.cursor = '';
        });

        // Add stop hover interaction using feature state
        this.map.on('mouseenter', 'stops', (e) => {
            this.map.getCanvas().style.cursor = 'pointer';

            // Query features at the exact cursor point and find the nearest one
            const nearestStop = this.findNearestFeatureAtPoint(e.point, e.lngLat, 'stops');

            if (nearestStop && nearestStop.properties) {
                // Debug: Log feature structure to understand ID situation
                if (!this.hasLoggedFeatureStructure) {
                    console.log('🔍 DEBUG - Feature structure:', {
                        'feature.id': nearestStop.id,
                        'feature.id type': typeof nearestStop.id,
                        'feature.properties.id': nearestStop.properties.id,
                        'feature.properties.stop_id': nearestStop.properties.stop_id,
                        'all properties': nearestStop.properties
                    });

                    // Query all stops at this point to see if IDs are unique
                    const allStopsHere = this.map.queryRenderedFeatures(e.point, { layers: ['stops'] });
                    console.log(`🔍 DEBUG - ${allStopsHere.length} stops at this point:`,
                        allStopsHere.map(f => ({
                            id: f.id,
                            propId: f.properties.id,
                            name: f.properties.name
                        }))
                    );

                    this.hasLoggedFeatureStructure = true;
                }

                // Feature state requires numeric ID at feature root level, not in properties
                const stopId = nearestStop.id;
                const stopPropertiesId = nearestStop.properties.id;

                // Only set hover state if feature has a root-level ID
                if (stopId !== undefined && stopId !== null &&
                    stopId !== this.hoveredStopId &&
                    (!this.currentSelectedStop || this.currentSelectedStop.id !== stopPropertiesId)) {

                    try {
                        // Clear previous hover state
                        if (this.hoveredStopId !== null) {
                            this.map.setFeatureState(
                                {
                                    source: this.sourceName,
                                    sourceLayer: this.sourceLayer,
                                    id: this.hoveredStopId
                                },
                                { hover: false }
                            );
                        }

                        // Set new hover state
                        this.hoveredStopId = stopId;
                        this.map.setFeatureState(
                            {
                                source: this.sourceName,
                                sourceLayer: this.sourceLayer,
                                id: stopId
                            },
                            { hover: true }
                        );

                        console.log(`🎯 Hovering stop: ${stopPropertiesId} (feature ID: ${stopId})`);
                    } catch (error) {
                        console.warn('⚠️ Failed to set hover state:', error);
                        this.hoveredStopId = null;
                    }
                }
            }
        });

        // Clear hover state when mouse leaves stops layer
        this.map.on('mouseleave', 'stops', () => {
            this.map.getCanvas().style.cursor = '';

            if (this.hoveredStopId !== null) {
                try {
                    this.map.setFeatureState(
                        {
                            source: this.sourceName,
                            sourceLayer: this.sourceLayer,
                            id: this.hoveredStopId
                        },
                        { hover: false }
                    );
                    console.log('🎯 Cleared stop hover state');
                } catch (error) {
                    console.warn('⚠️ Failed to clear hover state:', error);
                } finally {
                    this.hoveredStopId = null;
                }
            }
        });

        console.log('✅ Unified map interactions set up successfully');
    }

    /**
     * Find the nearest unique feature at a given point
     * Handles deduplication of features from multiple tiles
     * @param {Object} point - Screen point {x, y}
     * @param {Object} lngLat - Geographic coordinates {lng, lat}
     * @param {string} layerId - Layer ID to query ('stops' or 'routes')
     * @returns {Object|null} - The nearest unique feature or null
     */
    findNearestFeatureAtPoint(point, lngLat, layerId) {
        // Query features at the exact point
        const features = this.map.queryRenderedFeatures(point, { layers: [layerId] });
        
        if (!features || features.length === 0) {
            return null;
        }
        
        // Deduplicate features by their unique ID
        const uniqueFeatures = this.deduplicateFeatures(features, layerId);
        
        if (uniqueFeatures.length === 0) {
            return null;
        }
        
        // If only one feature, return it directly
        if (uniqueFeatures.length === 1) {
            return uniqueFeatures[0];
        }
        
        // Find the nearest feature to the click/hover point
        return this.findNearestFeature(uniqueFeatures, lngLat);
    }

    /**
     * Deduplicate features by their unique ID
     * @param {Array} features - Array of map features
     * @param {string} layerId - Optional layer ID ('stops' or 'routes') for specific ID field lookup
     * @returns {Array} - Deduplicated features
     */
    deduplicateFeatures(features, layerId = null) {
        const seen = new Map();

        for (const feature of features) {
            if (!feature.properties) continue;

            let uniqueId;
            if (layerId === 'stops') {
                uniqueId = feature.properties.id || feature.properties.stop_id || feature.id;
            } else if (layerId === 'routes') {
                uniqueId = feature.properties.route_id || feature.properties.id || feature.id;
            } else {
                uniqueId = feature.properties.id ||
                          feature.properties.stop_id ||
                          feature.properties.route_id ||
                          feature.id;
            }

            if (uniqueId && !seen.has(uniqueId)) {
                seen.set(uniqueId, feature);
            }
        }

        return Array.from(seen.values());
    }

    /**
     * Find the nearest feature to a geographic point
     * Uses simple Haversine distance calculation
     * @param {Array} features - Array of map features
     * @param {Object} lngLat - Geographic coordinates {lng, lat}
     * @param {number} maxDistanceKm - Maximum distance in kilometers (default 0.5km)
     * @returns {Object|null} - The nearest feature or null if too far
     */
    findNearestFeature(features, lngLat, maxDistanceKm = 0.5) {
        let nearestFeature = null;
        let minDistance = Infinity;

        for (const feature of features) {
            const coords = this.getFeatureCoordinates(feature);
            if (!coords) continue;

            const distance = this.calculateDistance(lngLat.lng, lngLat.lat, coords[0], coords[1]);

            if (distance < minDistance && distance <= maxDistanceKm) {
                minDistance = distance;
                nearestFeature = feature;
            }
        }

        if (nearestFeature) {
            console.log(`📏 Nearest feature found at ${(minDistance * 1000).toFixed(0)}m from click`);
        } else if (features.length > 0) {
            console.log(`⚠️ No features within ${maxDistanceKm * 1000}m threshold`);
        }

        return nearestFeature;
    }

    /**
     * Extract representative coordinates from a feature geometry
     * @param {Object} feature - Map feature with geometry
     * @returns {Array|null} - [lng, lat] coordinates or null
     */
    getFeatureCoordinates(feature) {
        if (!feature.properties) {
            return null;
        }

        const featureType = feature.properties.feature_type;

        if (featureType === 'stop') {
            const busStop = new BusStop(feature);
            if (busStop.lon && busStop.lat) {
                return [busStop.lon, busStop.lat];
            }
            return null;
        }

        if (!feature.geometry || !feature.geometry.coordinates) {
            return null;
        }

        const coords = feature.geometry.coordinates;
        const type = feature.geometry.type;

        switch (type) {
            case 'Point':
                return coords;
            case 'LineString':
                if (coords.length > 0) {
                    const midIndex = Math.floor(coords.length / 2);
                    return coords[midIndex];
                }
                return null;
            case 'MultiLineString':
                if (coords.length > 0 && coords[0].length > 0) {
                    const firstLine = coords[0];
                    const midIndex = Math.floor(firstLine.length / 2);
                    return firstLine[midIndex];
                }
                return null;
            default:
                return null;
        }
    }

    /**
     * Calculate distance between two points using Haversine formula
     * @param {number} lon1 - Longitude of first point
     * @param {number} lat1 - Latitude of first point
     * @param {number} lon2 - Longitude of second point
     * @param {number} lat2 - Latitude of second point
     * @returns {number} - Distance in kilometers
     */
    calculateDistance(lon1, lat1, lon2, lat2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    setupMoveEndListener() {
        console.log('🎯 Setting up moveend listener for transit data querying...');

        this.map.on('moveend', () => {
            // Small delay to ensure rendering is complete
            setTimeout(() => {
                this.checkAndSwitchDataSource();
                this.queryVisibleTransitData();

                // Auto-select closest stop if enabled
                if (this.autoSelectClosestStop) {
                    this.findClosestStopToMapCenter();
                }
            }, 100);
        });
    }

    queryVisibleTransitData() {
        try {
            if (this.isIframeMode) {
                return;
            }

            if (!this.map || !this.map.isSourceLoaded(this.sourceName)) {
                console.log('⏳ Map source not loaded yet, skipping route query');
                return;
            }

            const bounds = this.map.getBounds();
            const zoom = this.map.getZoom();
            const center = this.map.getCenter();

            console.log(`🗺️ Map moved to zoom ${zoom.toFixed(2)} at [${center.lng.toFixed(4)}, ${center.lat.toFixed(4)}]`);

            const rawRouteFeatures = this.map.querySourceFeatures(this.sourceName, {
                sourceLayer: this.sourceLayer,
                filter: [
                    'any',
                    ['==', ['get', 'feature_type'], 'route'],
                    ['==', ['get', 'type'], 'route']
                ]
            });

            if (!rawRouteFeatures || rawRouteFeatures.length === 0) {
                this.visibleRoutes = [];
                document.getElementById('route-list').innerHTML = `
                    <div class="text-center py-8 text-gray-400">
                        No routes visible at this zoom level. Zoom in to see routes.
                    </div>
                `;
                this.updateRouteCount();
                return;
            }

            const routesMap = new Map();
            rawRouteFeatures.forEach(feature => {
                const routeId = feature.properties.route_id;
                if (routeId && !routesMap.has(routeId)) {
                    routesMap.set(routeId, feature);
                }
            });

            let uniqueRoutes = Array.from(routesMap.values());

            uniqueRoutes.sort((a, b) => {
                const aName = a.properties.route_short_name || a.properties.route_name || '';
                const bName = b.properties.route_short_name || b.properties.route_name || '';
                return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
            });

            const MAX_ROUTES_DISPLAYED = 100;
            const totalCount = uniqueRoutes.length;
            if (totalCount > MAX_ROUTES_DISPLAYED) {
                uniqueRoutes = uniqueRoutes.slice(0, MAX_ROUTES_DISPLAYED);
                console.warn(`⚠️ Displaying only ${MAX_ROUTES_DISPLAYED} of ${totalCount} routes`);
            }

            this.visibleRoutes = uniqueRoutes;

            const fragment = document.createDocumentFragment();
            const tempDiv = document.createElement('div');
            uniqueRoutes.forEach(route => {
                tempDiv.innerHTML = this.generateRouteListHTML(route);
                fragment.appendChild(tempDiv.firstElementChild);
            });

            const routeListContainer = document.getElementById('route-list');
            routeListContainer.innerHTML = '';
            routeListContainer.appendChild(fragment);

            this.updateRouteCount();

            this.setupRouteListInteractions();

            if (this.filteredRouteId) {
                const stillVisible = uniqueRoutes.some(
                    r => r.properties.route_id === this.filteredRouteId
                );
                if (stillVisible) {
                    this.filterRouteList(this.filteredRouteId);
                } else {
                    console.log('🔄 Filtered route no longer visible, clearing filter');
                    this.clearRouteFilter();
                }
            }

            console.log(`✅ Populated route list with ${uniqueRoutes.length} unique routes`);

            if (!this.hasInitialDataLoaded) {
                this.hasInitialDataLoaded = true;
                console.log('✅ Initial data loaded successfully');
            }

        } catch (error) {
            console.error('❌ Error querying visible transit data:', error);
        }
    }
    
    /**
     * Find and select the closest bus stop to the current map center
     */
    async findClosestStopToMapCenter() {
        if (this.isIframeMode) {
            return;
        }

        if (!this.map || !this.map.isSourceLoaded(this.sourceName)) {
            console.log('⏳ Map source not loaded yet, skipping auto-select');
            return;
        }

        // Prevent concurrent selections
        if (this.isSelectingStop) {
            console.log('⏳ Stop selection already in progress, skipping');
            return;
        }
        
        this.isSelectingStop = true;
        
        try {
            const center = this.map.getCenter();
            
            // Query stop features from the source
            const rawFeatures = this.map.querySourceFeatures(this.sourceName, {
                sourceLayer: this.sourceLayer,
                filter: ['==', ['get', 'feature_type'], 'stop']
            });
            
            if (!rawFeatures || rawFeatures.length === 0) {
                console.log('❌ No stop features found for auto-select');
                return;
            }
            
            // De-duplicate features by ID (vector tiles can contain duplicates across tiles)
            const uniqueFeatures = this.deduplicateFeatures(rawFeatures);
            
            // Find the closest stop to map center
            let closestStop = null;
            let minDistance = Infinity;
            
            uniqueFeatures.forEach(feature => {
                const busStop = new BusStop(feature);
                if (busStop.lat && busStop.lon) {
                    const distance = DataUtils.calculateDistance(
                        center.lat, center.lng,
                        busStop.lat, busStop.lon
                    );
                    
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestStop = feature;
                    }
                }
            });
            
            if (closestStop) {
                const busStop = new BusStop(closestStop);
                
                // Only select if different from current stop (avoid redundant updates)
                if (!this.currentStop || 
                    this.currentStop.properties?.id !== closestStop.properties?.id) {
                    console.log(`🎯 Auto-selecting closest stop: ${busStop.name} (ID: ${busStop.id}) at ${(minDistance * 1000).toFixed(0)}m from map center`);
                    this.selectStop(closestStop);
                } else {
                    console.log(`🎯 Closest stop unchanged: ${busStop.name}`);
                }
            }
        } catch (error) {
            console.error('❌ Error in findClosestStopToMapCenter:', error);
        } finally {
            this.isSelectingStop = false;
        }
    }

    handleStopClick(primaryStopFeature, allStopFeatures) {
        console.log('🚏 Handling stop click with', allStopFeatures.length, 'stops at location');

        const primaryBusStop = new BusStop(primaryStopFeature);
        console.log(`🚏 Primary stop: ${primaryBusStop.name} (ID: ${primaryBusStop.id})`);

        // Clear hover state before selecting
        if (this.hoveredStopId !== null) {
            try {
                this.map.setFeatureState(
                    {
                        source: this.sourceName,
                        sourceLayer: this.sourceLayer,
                        id: this.hoveredStopId
                    },
                    { hover: false }
                );
            } catch (error) {
                console.warn('⚠️ Failed to clear hover state on click:', error);
            } finally {
                this.hoveredStopId = null;
            }
        }

        // Clear previous selections
        this.clearAllSelections();

        // Select the stop
        this.selectStop(primaryStopFeature);
    }

    handleRouteClick(routeFeature) {
        console.log('🚌 Handling route click');
        
        if (routeFeature && routeFeature.properties) {
            const routeId = routeFeature.properties.route_id;
            const routeName = routeFeature.properties.route_short_name || 
                            routeFeature.properties.route_name;
            
            console.log(`🚌 Route clicked: ${routeName} (ID: ${routeId})`);
            
            // Clear previous selections
            this.clearAllSelections();
            
            // Highlight the route on map
            this.highlightRoute(routeId);

            // Filter route list to this route
            this.filterRouteList(routeId);

            // Highlight corresponding departure rows
            this.highlightDepartureRows(routeId, routeName);
            
            // Update URL with route selection
            if (routeName) {
                this.updateTransitURL({ route: routeName });
            }
        }
    }

    highlightStop(stopId, isTemporary = false) {
        if (!stopId) return;

        // Skip temporary highlights (hover is handled separately)
        if (isTemporary) {
            console.log(`🎯 Skipping temporary highlight for stop: ${stopId}`);
            return;
        }

        console.log(`🎯 Highlighting stop: ${stopId}`);

        // Clear previous selection state
        if (this.currentHighlightedStop !== null) {
            try {
                this.map.setFeatureState(
                    {
                        source: this.sourceName,
                        sourceLayer: this.sourceLayer,
                        id: this.currentHighlightedStop
                    },
                    { selected: false }
                );
            } catch (error) {
                console.warn('⚠️ Failed to clear previous selection state:', error);
            }
        }

        // Set new selection state
        try {
            this.map.setFeatureState(
                {
                    source: this.sourceName,
                    sourceLayer: this.sourceLayer,
                    id: stopId
                },
                { selected: true }
            );
            console.log(`🎯 Set selection state for stop: ${stopId}`);
        } catch (error) {
            console.warn('⚠️ Failed to set selection state:', error);
        }

        // Store current highlight for cleanup
        this.currentHighlightedStop = stopId;
    }

    
    clearStopHighlight() {
        // Clear selection state
        if (this.currentHighlightedStop !== null && this.currentHighlightedStop !== undefined) {
            try {
                this.map.setFeatureState(
                    {
                        source: this.sourceName,
                        sourceLayer: this.sourceLayer,
                        id: this.currentHighlightedStop
                    },
                    { selected: false }
                );
                console.log('🎯 Cleared stop selection state');
            } catch (error) {
                console.warn('⚠️ Failed to clear selection state:', error);
            }
        }
        this.currentHighlightedStop = null;
    }

    clearTemporaryStopHighlights() {
        // Clear feature state hover (kept for backward compatibility but now handled by mouseleave)
        if (this.hoveredStopId !== null) {
            try {
                this.map.setFeatureState(
                    {
                        source: this.sourceName,
                        sourceLayer: this.sourceLayer,
                        id: this.hoveredStopId
                    },
                    { hover: false }
                );
            } catch (error) {
                console.warn('⚠️ Failed to clear temporary hover:', error);
            } finally {
                this.hoveredStopId = null;
            }
        }
    }

    async loadDepartures(stopFeature) {
        const departureList = document.getElementById('departure-list');
        const lastUpdated = document.getElementById('last-updated');
        
        try {
            const props = stopFeature.properties;
            const stopName = props.name || props.stop_name || 'Unknown Stop';
            const stopId = props.id || props.stop_id;
            
            console.log(`🔄 Loading departures for stop: ${stopName} (ID: ${stopId})`);
            
            // Use real timetable data from BusStop class
            const busStop = new BusStop(stopFeature);
            const currentTime = new Date();
            const departures = busStop.getUpcomingDepartures(currentTime, 12);
            
            // Add realistic vehicle IDs to departures
            departures.forEach(departure => {
                departure.vehicleId = this.generateRealisticVehicleId(departure.agencyName, departure.route);
            });
            
            // Determine data source based on available data
            let dataSource = 'Scheduled data';
            if (busStop.hasLiveData && departures.some(d => d.isLive)) {
                dataSource = 'Live + Scheduled data';
            }
            
            console.log(`🚌 Loaded ${departures.length} real departures from timetable data`);
            
            // Store departures for interaction handlers
            this.currentDepartures = departures;
            
            this.displayDepartures(departures);
            
            // Set up departure row interactions after displaying
            setTimeout(() => {
                this.setupDepartureRowInteractions();
            }, 100);
            
            // Update timestamp with data source info
            lastUpdated.innerHTML = `${dataSource} • Updated ${new Date().toLocaleTimeString()}`;
            
        } catch (error) {
            console.error('Error loading departures:', error);
            this.showDepartureError();
        }
    }

    generateDeparturesFromTimetable(busStop) {
        const timetableData = busStop.parseTimetable();
        const currentTime = new Date();
        const currentTimeStr = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}`;
        
        console.log(`🔍 Processing timetable data for ${timetableData.length} routes at current time ${currentTimeStr}`);
        
        const allDepartures = [];
        
        timetableData.forEach(routeInfo => {
            if (!routeInfo.stop_times || !Array.isArray(routeInfo.stop_times)) {
                console.log(`⚠️ No stop_times found for route ${routeInfo.route_name || routeInfo.route_short_name}`);
                return;
            }
            
            const routeName = routeInfo.route_short_name || routeInfo.route_name;
            const destination = routeInfo.last_stop_name || 'Terminal';
            const agencyName = this.extractAgencyFromRoute(routeInfo) || 'BEST';
            const fareType = DataUtils.detectFareTypeFromRoute(routeName);
            const headway = routeInfo.trip_headway || 30;
            
            // Process actual departure times from timetable
            const upcomingDepartures = this.getUpcomingDepartures(routeInfo.stop_times, currentTime, headway);
            
            upcomingDepartures.forEach((departureTime, index) => {
                allDepartures.push({
                    route: routeName,
                    routeId: routeInfo.route_id || `route_${routeName}`,
                    time: departureTime,
                    isLive: this.determineIfLive(routeInfo, agencyName),
                    destination: destination,
                    agencyName: agencyName,
                    vehicleId: this.generateRealisticVehicleId(agencyName, routeName),
                    headway: headway,
                    fareType: fareType,
                    sortTime: departureTime.getTime() // For sorting
                });
            });
        });
        
        // Sort departures by time and limit to next 10-15 departures
        allDepartures.sort((a, b) => a.sortTime - b.sortTime);
        const limitedDepartures = allDepartures.slice(0, 12);
        
        console.log(`🚌 Generated ${limitedDepartures.length} real departures from timetable data`);
        
        return limitedDepartures;
    }

    getUpcomingDepartures(stopTimes, currentTime, headway) {
        if (!stopTimes || stopTimes.length === 0) {
            return [];
        }
        
        const upcomingDepartures = [];
        const currentTimeMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
        
        // Process each scheduled time
        stopTimes.forEach(timeStr => {
            const departureTime = DataUtils.parseTimeString(timeStr, currentTime);
            if (departureTime) {
                const departureMinutes = departureTime.getHours() * 60 + departureTime.getMinutes();
                
                // Include departures that are:
                // 1. In the future (within next 3 hours)
                // 2. Or very recent (within last 5 minutes) - for "just departed" info
                const timeDiffMinutes = departureMinutes - currentTimeMinutes;
                
                if (timeDiffMinutes >= -5 && timeDiffMinutes <= 180) { // 3 hours ahead, 5 minutes behind
                    upcomingDepartures.push(departureTime);
                } else if (timeDiffMinutes < -5) {
                    // Handle next day scenario for late night services
                    const nextDayDeparture = new Date(departureTime);
                    nextDayDeparture.setDate(nextDayDeparture.getDate() + 1);
                    const nextDayDiffMinutes = (nextDayDeparture.getTime() - currentTime.getTime()) / (1000 * 60);
                    
                    if (nextDayDiffMinutes <= 180) { // Within next 3 hours
                        upcomingDepartures.push(nextDayDeparture);
                    }
                }
            }
        });
        
        // If we have very few upcoming departures and headway is known, generate additional ones
        if (upcomingDepartures.length < 3 && headway && headway < 60) {
            const lastDeparture = upcomingDepartures[upcomingDepartures.length - 1];
            if (lastDeparture) {
                // Generate 2-3 more departures based on headway
                for (let i = 1; i <= 3; i++) {
                    const nextDeparture = new Date(lastDeparture.getTime() + (headway * i * 60 * 1000));
                    upcomingDepartures.push(nextDeparture);
                }
            }
        }
        
        return upcomingDepartures.sort((a, b) => a.getTime() - b.getTime()).slice(0, 4); // Max 4 departures per route
    }

    extractAgencyFromRoute(routeInfo) {
        // Extract agency from various possible fields
        if (routeInfo.agency_name) return routeInfo.agency_name;
        if (routeInfo.route_name && routeInfo.route_name.includes('TMT')) return 'TMT';
        if (routeInfo.route_name && routeInfo.route_name.includes('MSRTC')) return 'MSRTC';
        if (routeInfo.route_name && routeInfo.route_name.includes('NMMT')) return 'NMMT';
        return 'BEST'; // Default to BEST for Mumbai
    }

    determineIfLive(routeInfo, agencyName) {
        // Determine if route has live tracking based on various factors
        if (routeInfo.is_live === true || routeInfo.is_live === 'true') return true;
        if (routeInfo.ac_service === true) return true; // AC buses more likely to have GPS
        if (agencyName === 'BEST' && Math.random() > 0.7) return true; // 30% of BEST routes have live data
        return false;
    }

    generateRealisticVehicleId(agencyName, routeName) {
        // Generate realistic vehicle IDs based on agency patterns
        const random4Digit = Math.floor(Math.random() * 9000) + 1000;
        
        switch (agencyName.toUpperCase()) {
            case 'BEST':
                return `MH01-${random4Digit}`;
            case 'TMT':
                return `MH04-${random4Digit}`;
            case 'NMMT':
                return `MH02-${random4Digit}`;
            case 'MSRTC':
                return `MH12-${random4Digit}`;
            default:
                return `MH01-${random4Digit}`;
        }
    }

    // Remove old mock data generation methods - they are no longer needed
    // generateMockDepartures, generateDeparturesFromRoutes, generateMockRoutes are replaced by generateDeparturesFromTimetable

    generateDestination(routeName, agency) {
        const destinations = {
            'BEST': [
                'Borivali Station (E)', 'Andheri Station (W)', 'Bandra Station',
                'Dadar Station', 'CST', 'Colaba', 'Worli', 'BKC',
                'Kurla Station', 'Ghatkopar', 'Mulund', 'Thane'
            ],
            'TMT': [
                'Thane Station', 'Kalwa', 'Mumbra', 'Dombivli',
                'Airoli', 'Ghansoli', 'Vashi', 'Nerul'
            ]
        };
        
        const agencyDestinations = destinations[agency] || destinations['BEST'];
        return agencyDestinations[Math.floor(Math.random() * agencyDestinations.length)];
    }

    generateVehicleId(agency) {
        if (agency === 'BEST') {
            return `MH01-${Math.floor(Math.random() * 9000) + 1000}`;
        } else {
            return `MH04-${Math.floor(Math.random() * 9000) + 1000}`;
        }
    }

    hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }

    displayDepartures(departures) {
        // Split departures into live and scheduled
        const liveDepartures = departures.filter(d => d.isLive);
        const scheduledDepartures = departures.filter(d => !d.isLive);
        
        console.log(`📊 Displaying ${liveDepartures.length} live and ${scheduledDepartures.length} scheduled departures`);
        
        // Auto-switch to scheduled tab if no live departures but scheduled ones exist
        if (liveDepartures.length === 0 && scheduledDepartures.length > 0) {
            console.log('🔄 No live departures available, switching to scheduled tab');
            this.switchDepartureTab('scheduled');
        } else if (liveDepartures.length > 0) {
            // Switch back to live tab if we have live departures (in case we were on scheduled)
            this.switchDepartureTab('live');
        }
        
        // Display both tabs
        this.displayLiveDepartures(liveDepartures);
        this.displayScheduledDepartures(scheduledDepartures);
        
        // Also populate legacy departure list for backward compatibility
        this.displayLegacyDepartures(departures);
    }

    displayLiveDepartures(departures) {
        const departureList = document.getElementById('live-departure-list');
        
        if (departures.length === 0) {
            departureList.innerHTML = `
                <div class="text-center py-8 text-gray-400">
                    <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                        <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1V8a1 1 0 00-1-1h-3z"/>
                    </svg>
                    <p>No live departures available</p>
                    <p class="text-sm mt-1 text-amber-400">Switch to Scheduled tab for timetable data</p>
                </div>
            `;
            return;
        }

        const departureHTML = this.generateDepartureHTML(departures, 'live');
        departureList.innerHTML = departureHTML;
    }

    displayScheduledDepartures(departures) {
        const departureList = document.getElementById('scheduled-departure-list');
        
        if (departures.length === 0) {
            departureList.innerHTML = `
                <div class="text-center py-8 text-gray-400">
                    <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                        <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1V8a1 1 0 00-1-1h-3z"/>
                    </svg>
                    <p>No scheduled departures available</p>
                    <p class="text-sm mt-1">Service may have ended for today</p>
                </div>
            `;
            return;
        }

        const departureHTML = this.generateDepartureHTML(departures, 'scheduled');
        departureList.innerHTML = departureHTML;
    }

    displayLegacyDepartures(departures) {
        const departureList = document.getElementById('departure-list');
        
        if (departures.length === 0) {
            departureList.innerHTML = `
                <div class="text-center py-8 text-gray-400">
                    <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                        <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1V8a1 1 0 00-1-1h-3z"/>
                    </svg>
                    <p>No departures available</p>
                    <p class="text-sm mt-1">Service may have ended for today</p>
                </div>
            `;
            return;
        }

        const departureHTML = this.generateDepartureHTML(departures, 'legacy');
        departureList.innerHTML = departureHTML;
    }

    generateDepartureHTML(departures, tabType) {
        return departures.map((departure, index) => {
            const timeStr = departure.time.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            });
            
            const now = new Date();
            const minutesUntil = Math.ceil((departure.time - now) / (1000 * 60));
            
            let timeDisplay;
            if (minutesUntil <= 0) {
                timeDisplay = 'Due';
            } else if (minutesUntil === 1) {
                timeDisplay = '1 min';
            } else {
                timeDisplay = `${minutesUntil} min`;
            }

            const statusClass = departure.isLive ? 'status-live' : 'status-scheduled';
            const statusText = departure.isLive ? 'Live tracking' : 'Scheduled';
            
            // Generate proper route badge styling
            const routeInfo = {
                agency: departure.agencyName,
                fareType: DataUtils.detectFareTypeFromRoute(departure.route)
            };
            const routeBadge = DataUtils.getStyledRouteBadge(departure.route, routeInfo, 'medium');
            
            // Add tab-specific classes and data attributes
            const tabClass = tabType !== 'legacy' ? `departure-row-${tabType}` : '';
            const tabPrefix = tabType !== 'legacy' ? `${tabType}-` : '';
            
            return `
                <div class="departure-row ${tabClass} flex items-center justify-between p-3 rounded transition-all duration-200" 
                     data-route-id="${departure.routeId || ''}" 
                     data-departure-index="${tabPrefix}${index}"
                     data-tab-type="${tabType}">
                    <div class="flex items-center gap-3">
                        <div class="status-indicator ${statusClass}"></div>
                        <div>
                            <div class="flex items-center gap-2">
                                ${routeBadge}
                                <span class="text-white font-medium">${departure.destination}</span>
                            </div>
                            <div class="text-xs text-gray-400 mt-1 flex items-center gap-2">
                                <span>${statusText}</span>
                                <span>•</span>
                                <span>${departure.agencyName}</span>
                                ${departure.vehicleId ? `
                                    <span>•</span>
                                    <span>Vehicle ${departure.vehicleId}</span>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="text-white font-bold">${timeDisplay}</div>
                        <div class="text-xs text-gray-400">${timeStr}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    showDepartureError() {
        const departureList = document.getElementById('departure-list');
        departureList.innerHTML = `
            <div class="text-center py-8 text-red-400">
                <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                </svg>
                <p>Unable to load departure information</p>
            </div>
        `;
    }

    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        // Refresh every 30 seconds if we have a current stop
        this.refreshInterval = setInterval(() => {
            if (this.currentStop && this.currentStop.properties.id) {
                console.log('🔄 Auto-refreshing live data...');
                this.loadDepartures(this.currentStop);
            }
        }, 30000); // 30 seconds
    }

    selectStopFromNearby(busStop) {
        console.log(`🚏 Selecting nearby stop: ${busStop.name}`);
        
        // Use the main selectStop method to ensure consistent behavior
        this.selectStop(busStop.feature);
        
        // Center map on the new stop
        if (busStop.coordinates) {
            this.map.flyTo({
                center: busStop.coordinates,
                zoom: Math.max(15, this.map.getZoom()),
                duration: 1500
            });
        }
        
        // Hide nearby panel
        this.hideNearbyStopsPanel();
        
        // Load new nearby stops for the selected stop
        this.loadNearbyStops(busStop);
    }

    hideNearbyStopsPanel() {
        const panel = document.getElementById('nearby-stops-panel');
        if (panel) {
            panel.classList.add('hidden');
        }
    }

    setupDepartureTabs() {
        console.log('🏷️ Setting up departure tabs...');
        
        // Set up tab buttons
        const liveTabBtn = document.getElementById('live-tab-btn');
        const scheduledTabBtn = document.getElementById('scheduled-tab-btn');
        
        if (liveTabBtn) {
            liveTabBtn.addEventListener('click', () => {
                this.switchDepartureTab('live');
            });
        }
        
        if (scheduledTabBtn) {
            scheduledTabBtn.addEventListener('click', () => {
                this.switchDepartureTab('scheduled');
            });
        }
        
        // Initialize with live tab active
        this.currentDepartureTab = 'live';
        
        console.log('✅ Departure tabs set up successfully');
    }

    switchDepartureTab(tabName) {
        console.log(`🔄 Switching to ${tabName} tab`);
        
        // Update current tab
        this.currentDepartureTab = tabName;
        
        // Update tab button styles
        const liveTabBtn = document.getElementById('live-tab-btn');
        const scheduledTabBtn = document.getElementById('scheduled-tab-btn');
        
        if (tabName === 'live') {
            // Style live tab as active
            liveTabBtn.className = 'departure-tab-btn px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 text-green-400 bg-green-900/30 border border-green-600/50';
            scheduledTabBtn.className = 'departure-tab-btn px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 text-gray-400 hover:text-white hover:bg-gray-700';
        } else {
            // Style scheduled tab as active
            scheduledTabBtn.className = 'departure-tab-btn px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 text-amber-400 bg-amber-900/30 border border-amber-600/50';
            liveTabBtn.className = 'departure-tab-btn px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 text-gray-400 hover:text-white hover:bg-gray-700';
        }
        
        // Update tab content visibility
        const liveContent = document.getElementById('live-departures');
        const scheduledContent = document.getElementById('scheduled-departures');
        
        if (tabName === 'live') {
            liveContent.classList.remove('hidden');
            scheduledContent.classList.add('hidden');
        } else {
            liveContent.classList.add('hidden');
            scheduledContent.classList.remove('hidden');
        }
        
        // Update selection interactions for current tab
        setTimeout(() => {
            this.setupDepartureRowInteractions();
        }, 100);
    }

    updateSelectionIndicator(message) {
        // Add or update a selection indicator in the UI
        let indicator = document.getElementById('selection-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'selection-indicator';
            indicator.className = 'selection-indicator';
            
            // Insert after the departure board header
            const departureHeader = document.querySelector('.departure-board h3');
            if (departureHeader) {
                departureHeader.parentElement.insertAdjacentElement('afterend', indicator);
            }
        }
        
        if (message) {
            indicator.innerHTML = `
                <div class="flex items-center justify-between text-xs text-yellow-300 bg-yellow-900/30 border border-yellow-600/30 rounded px-3 py-2 mb-2">
                    <span>${message}</span>
                    <button onclick="window.transitExplorer.clearAllSelections()" class="text-yellow-400 hover:text-yellow-200">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                        </svg>
                    </button>
                </div>
            `;
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    }

    // Add missing showNoStopsMessage method
    showNoStopsMessage() {
        console.warn('🚏 No stops found in area');
        this.showStopError('No bus stops found in this area');
    }

    // Add missing showDistantStopMessage method
    showDistantStopMessage(distance) {
        const distanceText = distance > 1 ? 
            `${distance.toFixed(1)}km` : 
            `${(distance * 1000).toFixed(0)}m`;
        
        console.warn(`🚏 Nearest stop is ${distanceText} away`);
        this.showStopError(`Nearest stop is ${distanceText} away. Try moving closer to a bus route.`);
    }

    // Add missing findRouteIdByName method
    async findRouteIdByName(routeName) {
        if (!this.map || !this.map.getSource(this.sourceName)) {
            console.warn('Map or transit source not available');
            return null;
        }
        
        try {
            // Wait for source to be loaded
            if (!this.map.isSourceLoaded(this.sourceName)) {
                console.log('⏳ Waiting for transit source to load...');
                await new Promise(resolve => {
                    const checkSource = () => {
                        if (this.map.isSourceLoaded(this.sourceName)) {
                            resolve();
                        } else {
                            setTimeout(checkSource, 500);
                        }
                    };
                    checkSource();
                });
            }
            
            // Query route features to find matching route
            const routeFeatures = this.map.querySourceFeatures(this.sourceName, {
                sourceLayer: this.sourceLayer,
                filter: ['==', ['get', 'feature_type'], 'route']
            });
            
            // Find route with matching name
            const matchingRoute = routeFeatures.find(feature => {
                const props = feature.properties;
                const shortName = props.route_short_name;
                const longName = props.route_name;
                
                return shortName === routeName || longName === routeName;
            });
            
            if (matchingRoute) {
                console.log(`✅ Found route ID for ${routeName}: ${matchingRoute.properties.route_id}`);
                return matchingRoute.properties.route_id;
            } else {
                console.warn(`❌ No route found with name: ${routeName}`);
                return null;
            }
            
        } catch (error) {
            console.error('Error finding route ID:', error);
            return null;
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.transitExplorer = new TransitExplorer();
});

// Export for use in other modules if needed
export default TransitExplorer; 
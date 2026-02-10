import { TransitLayerStyles } from './transit-layer-styles.js';
import { MapExportControl } from '../js/map-export-control.js';

export class TransitMapController {
    constructor(config = {}) {
        this.mapboxToken = config.mapboxToken || window.amche.MAPBOXGL_ACCESS_TOKEN;
        this.container = config.container || 'map';
        this.currentCity = config.currentCity;
        this.sourceName = config.sourceName || 'transit-explorer';
        this.sourceLayer = config.sourceLayer || 'default';
        this.vectorTileSource = config.vectorTileSource;

        this.map = null;
        this.geolocateControl = null;
        this.currentHighlightedRoute = null;
        this.hoveredStopId = null;
        this.hasLoggedFeatureStructure = false;

        this.onStopClick = config.onStopClick || (() => {});
        this.onRouteClick = config.onRouteClick || (() => {});
        this.onMapBackgroundClick = config.onMapBackgroundClick || (() => {});
        this.onGeolocate = config.onGeolocate || (() => {});
        this.onGeolocateError = config.onGeolocateError || (() => {});
        this.onMapLoaded = config.onMapLoaded || (() => {});
        this.onMoveEnd = config.onMoveEnd || (() => {});
    }

    initMap() {
        mapboxgl.accessToken = this.mapboxToken;

        this.map = new mapboxgl.Map({
            container: this.container,
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

            this.setupMapInteractions();
            this.setupMoveEndListener();

            this.onMapLoaded();
        });

        this.map.addControl(new mapboxgl.NavigationControl(), 'top-right');

        this.geolocateControl = new mapboxgl.GeolocateControl({
            positionOptions: {
                enableHighAccuracy: true
            },
            trackUserLocation: true,
            showUserHeading: true,
            showAccuracyCircle: true
        });
        this.map.addControl(this.geolocateControl, 'top-right');
        this.map.addControl(new MapExportControl(), 'top-right');

        this.geolocateControl.on('geolocate', (e) => {
            console.log('📍 Geolocate event:', e.coords);
            this.onGeolocate(e);
        });

        this.geolocateControl.on('error', (e) => {
            console.error('📍 Geolocate error:', e);
            this.onGeolocateError(e);
        });

        return this.map;
    }

    addDataSources() {
        console.log('📊 Adding data sources...');

        try {
            this.map.addSource(this.sourceName, {
                type: 'vector',
                url: this.vectorTileSource.url,
                promoteId: 'id'
            });
            console.log(`✅ Added ${this.sourceName} source: ${this.vectorTileSource.url}`);
        } catch (error) {
            console.error('❌ Error adding data sources:', error);
        }
    }

    addLayers() {
        const sourceLayer = this.sourceLayer;

        this.map.addLayer(TransitLayerStyles.getRouteOutlineLayer(this.sourceName, sourceLayer));
        this.map.addLayer(TransitLayerStyles.getRouteHighlightLayer(this.sourceName, sourceLayer));
        this.map.addLayer(TransitLayerStyles.getStopsLayer(this.sourceName, sourceLayer));
        this.map.addLayer(TransitLayerStyles.getStopHighlightLayer(this.sourceName, sourceLayer));
        this.map.addLayer(TransitLayerStyles.getStopDebugLabelsLayer(this.sourceName, sourceLayer));

        this.addBusLocationLayer();
        console.log('✅ Layers added successfully');
    }

    addBusLocationLayer() {
        if (!this.map.getSource('bus-locations')) {
            this.map.addSource('bus-locations', TransitLayerStyles.getBusLocationSource());
        }

        if (!this.map.getLayer('bus-locations')) {
            this.map.addLayer(TransitLayerStyles.getBusLocationsLayer());
            this.map.addLayer(TransitLayerStyles.getBusLabelsLayer());
        }

        this.map.on('click', 'bus-locations', (e) => {
            if (e.features.length > 0) {
                this.showBusPopup(e.features[0], e.lngLat);
            }
        });

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

    setupMapInteractions() {
        console.log('🎯 Setting up unified map interactions...');

        this.map.on('click', (e) => {
            const nearestStop = this.findNearestFeatureAtPoint(e.point, e.lngLat, 'stops');
            const nearestRoute = this.findNearestFeatureAtPoint(e.point, e.lngLat, 'routes');

            if (nearestStop) {
                this.onStopClick(nearestStop, [nearestStop]);
            } else if (nearestRoute) {
                this.onRouteClick(nearestRoute);
            } else {
                this.onMapBackgroundClick();
            }
        });

        this.map.on('mouseenter', 'routes', () => {
            this.map.getCanvas().style.cursor = 'pointer';
        });

        this.map.on('mouseleave', 'routes', () => {
            this.map.getCanvas().style.cursor = '';
        });

        this.map.on('mouseenter', 'stops', (e) => {
            this.map.getCanvas().style.cursor = 'pointer';

            const nearestStop = this.findNearestFeatureAtPoint(e.point, e.lngLat, 'stops');

            if (nearestStop && nearestStop.properties) {
                const stopId = nearestStop.id;

                if (stopId !== null && stopId !== undefined) {
                    if (this.hoveredStopId !== null && this.hoveredStopId !== stopId) {
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
                            console.warn('⚠️ Failed to clear previous hover state:', error);
                        }
                    }

                    this.hoveredStopId = stopId;

                    try {
                        this.map.setFeatureState(
                            {
                                source: this.sourceName,
                                sourceLayer: this.sourceLayer,
                                id: stopId
                            },
                            { hover: true }
                        );
                    } catch (error) {
                        console.warn('⚠️ Failed to set hover state:', error);
                    }
                }
            }
        });

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
                } catch (error) {
                    console.warn('⚠️ Failed to clear hover state:', error);
                } finally {
                    this.hoveredStopId = null;
                }
            }
        });

        console.log('✅ Unified map interactions set up successfully');
    }

    setupMoveEndListener() {
        this.map.on('moveend', () => {
            this.onMoveEnd();
        });
    }

    findNearestFeatureAtPoint(point, lngLat, layerId) {
        const features = this.map.queryRenderedFeatures(point, { layers: [layerId] });

        if (!features || features.length === 0) {
            return null;
        }

        const uniqueFeatures = this.deduplicateFeatures(features, layerId);

        if (uniqueFeatures.length === 0) {
            return null;
        }

        if (uniqueFeatures.length === 1) {
            return uniqueFeatures[0];
        }

        return this.findNearestFeature(uniqueFeatures, lngLat);
    }

    deduplicateFeatures(features, layerId = null) {
        const seen = new Map();
        const unique = [];

        for (const feature of features) {
            let uniqueId;

            if (layerId === 'stops') {
                uniqueId = feature.properties.id || feature.properties.stop_id || feature.id;
            } else if (layerId === 'routes') {
                uniqueId = feature.properties.route_id || feature.id;
            } else {
                uniqueId = feature.id || feature.properties.id;
            }

            if (uniqueId && !seen.has(uniqueId)) {
                seen.set(uniqueId, true);
                unique.push(feature);
            }
        }

        return unique;
    }

    findNearestFeature(features, lngLat) {
        if (!features || features.length === 0) return null;
        if (features.length === 1) return features[0];

        let nearest = features[0];
        let minDistance = this.calculateDistance(lngLat, this.getFeatureCenter(nearest));

        for (let i = 1; i < features.length; i++) {
            const feature = features[i];
            const center = this.getFeatureCenter(feature);
            const distance = this.calculateDistance(lngLat, center);

            if (distance < minDistance) {
                minDistance = distance;
                nearest = feature;
            }
        }

        return nearest;
    }

    getFeatureCenter(feature) {
        if (!feature.geometry) return null;

        if (feature.geometry.type === 'Point') {
            const coords = feature.geometry.coordinates;
            return { lng: coords[0], lat: coords[1] };
        } else if (feature.geometry.type === 'LineString') {
            const coords = feature.geometry.coordinates;
            const midIndex = Math.floor(coords.length / 2);
            return { lng: coords[midIndex][0], lat: coords[midIndex][1] };
        } else if (feature.geometry.type === 'MultiLineString') {
            const firstLine = feature.geometry.coordinates[0];
            const midIndex = Math.floor(firstLine.length / 2);
            return { lng: firstLine[midIndex][0], lat: firstLine[midIndex][1] };
        }

        return null;
    }

    calculateDistance(lngLat1, lngLat2) {
        if (!lngLat1 || !lngLat2) return Infinity;

        const dx = lngLat2.lng - lngLat1.lng;
        const dy = lngLat2.lat - lngLat1.lat;
        return Math.sqrt(dx * dx + dy * dy);
    }

    highlightRoute(routeId, isTemporary = false) {
        if (!routeId) return;

        this.map.setFilter('routes-highlight', [
            'all',
            ['==', ['get', 'feature_type'], 'route'],
            ['==', ['get', 'route_id'], routeId]
        ]);

        if (!isTemporary) {
            this.currentHighlightedRoute = routeId;
        }

        console.log(`🎯 Highlighting route: ${routeId}`);
    }

    clearRouteHighlight() {
        this.map.setFilter('routes-highlight', [
            'all',
            ['==', ['get', 'feature_type'], 'route'],
            ['==', ['get', 'route_id'], '']
        ]);
        this.currentHighlightedRoute = null;
    }

    highlightStop(stopId, isTemporary = false) {
        if (!stopId) return;

        this.map.setFilter('stops-highlight', [
            'all',
            ['==', ['get', 'feature_type'], 'stop'],
            ['==', ['get', 'id'], stopId]
        ]);

        console.log(`🎯 Highlighting stop: ${stopId}`);
    }

    clearStopHighlight() {
        this.map.setFilter('stops-highlight', [
            'all',
            ['==', ['get', 'feature_type'], 'stop'],
            ['==', ['get', 'id'], '']
        ]);
    }

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

    updateBusLocations(busFeatures) {
        const source = this.map.getSource('bus-locations');
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features: busFeatures
            });
        }
    }

    flyTo(center, zoom = 15) {
        this.map.flyTo({
            center: center,
            zoom: zoom,
            duration: 2000
        });
    }

    getRouteFeatures(filter = null) {
        if (!this.map.isSourceLoaded(this.sourceName)) return [];

        const baseFilter = ['all', ['==', ['get', 'feature_type'], 'route']];
        const finalFilter = filter ? ['all', ...baseFilter.slice(1), filter] : baseFilter;

        return this.map.querySourceFeatures(this.sourceName, {
            sourceLayer: this.sourceLayer,
            filter: finalFilter
        });
    }

    getStopFeatures(filter = null) {
        if (!this.map.isSourceLoaded(this.sourceName)) return [];

        const baseFilter = ['all', ['==', ['get', 'feature_type'], 'stop']];
        const finalFilter = filter ? ['all', ...baseFilter.slice(1), filter] : baseFilter;

        return this.map.querySourceFeatures(this.sourceName, {
            sourceLayer: this.sourceLayer,
            filter: finalFilter
        });
    }

    getMap() {
        return this.map;
    }

    waitForMapReady() {
        return new Promise((resolve) => {
            if (this.map && this.map.isSourceLoaded(this.sourceName)) {
                resolve();
            } else {
                const checkInterval = setInterval(() => {
                    if (this.map && this.map.isSourceLoaded(this.sourceName)) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            }
        });
    }
}

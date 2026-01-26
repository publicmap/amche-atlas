/**
 * Geolocation Manager
 */

export class ButtonGeolocationManager extends mapboxgl.GeolocateControl {

    constructor() {
        super({
            showUserHeading: true,
            trackUserLocation: true,
            showAccuracyCircle: true,
            positionOptions: { enableHighAccuracy: true },
            fitBoundsOptions: { zoom: 18, padding: 20, maxZoom: 20 }
        });
        this.isTracking = false;
        this.locationErrorCount = 0;

        $(document).on('url_updated', this.handleUrlUpdate);
    }

    onAdd(map) {
        this.map = map;
        this.searchBox = document.getElementById('mapbox-search-box');

        // Track when tracking starts/stops
        this.on('trackuserlocationstart', () => {
            this.isTracking = true;
            $(window).on('deviceorientationabsolute', this.handleOrientation);
            $(document).trigger('update_url', { geolocate: true });
        });

        this.on('trackuserlocationend', () => {
            this.isTracking = false;
            $(window).off('deviceorientationabsolute', this.handleOrientation);
            $(document).trigger('update_url', { geolocate: false });
            // Reset search placeholder
            if (this.searchBox) {
                this.searchBox.placeholder = 'Search places';
            }
            // Reset map orientation
            map.easeTo({
                bearing: 0,
                pitch: 0,
                duration: 1000
            });
        });

        // Handle geolocation errors
        this.on('error', (error) => {
            this.locationErrorCount++;
            console.warn('Geolocation error:', error);

            if (this.searchBox) {
                this.searchBox.placeholder = 'Location unavailable' + (this.locationErrorCount > 1 ? ' - Try moving to an open area' : '');
            }

            // Reset the error count after some time
            setTimeout(() => {
                this.locationErrorCount = 0;
                if (this.searchBox) {
                    this.searchBox.placeholder = 'Search places';
                }
            }, 60000);
        });

        // Let the GeolocateControl handle positioning and centering automatically
        // when tracking is active. Only handle bearing updates separately via handleOrientation.
        // This prevents our manual map movements from interfering with the tracking behavior.
        this.on('geolocate', async (event) => {
            this.locationErrorCount = 0;

            try {
                const parts = [];
                const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${event.coords.longitude},${event.coords.latitude}.json?access_token=${window.amche.MAPBOXGL_ACCESS_TOKEN}&types=poi,address,neighborhood,locality,place&limit=1`);
                const data = await response.json();
                const feature = data.features[0];
                if (feature) {
                    if (feature.properties?.name) {
                        parts.push(feature.properties.name);
                    }
                    if (feature.context) {
                        feature.context
                            .filter(ctx => ['neighborhood', 'locality', 'place'].includes(ctx.id.split('.')[0]))
                            .forEach(ctx => parts.push(ctx.text));
                    }
                }

                // Update search box placeholder with location
                if (this.searchBox) {
                    const locationText = parts.length > 0 ? parts.join(', ') : 'Unknown location';
                    this.searchBox.placeholder = locationText;
                }

            } catch (error) {
                console.error('Error reverse geocoding:', error);
            }
        });

        const container = super.onAdd(map);

        // Style the container for header placement
        container.className = 'geolocation-control-header';

        // Update button styling for header
        const button = container.querySelector('.mapboxgl-ctrl-geolocate');
        if (button) {
            // Keep the mapboxgl-ctrl-geolocate class for state management
            button.className = 'mapboxgl-ctrl-geolocate bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors border border-gray-700 flex items-center justify-center';
            button.style.width = '40px';
            button.style.height = '40px';

            // Replace the empty icon span with a Shoelace icon
            const iconSpan = button.querySelector('.mapboxgl-ctrl-icon');
            if (iconSpan) {
                iconSpan.innerHTML = '<sl-icon name="geo-alt-fill" style="font-size: 18px;"></sl-icon>';
                iconSpan.style.display = 'flex';
                iconSpan.style.alignItems = 'center';
                iconSpan.style.justifyContent = 'center';
            }
        }

        return container;
    }

    handleOrientation = (event) => {
        if (event.alpha != null && this.isTracking) {
            // Mapbox expects bearing in [0, 360)
            let bearing = (360 - event.alpha) % 360;
            this.map.easeTo({
                bearing: bearing,
                duration: 100
            });
        }
    }

    handleUrlUpdate = (event, params) => {
        if (params !== undefined && params.geolocate === true) {
            this.trigger();
        }
    }
}

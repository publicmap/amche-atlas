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
        console.log('[Geolocation] onAdd called, container:', container);

        // Add wrapper class to the container
        container.classList.add('geolocation-control-header');

        // The button is added asynchronously by the parent class
        // Use MutationObserver to wait for it and then customize it
        const observer = new MutationObserver((mutations, obs) => {
            const button = container.querySelector('.mapboxgl-ctrl-geolocate');
            console.log('[Geolocation] MutationObserver - Found button:', button);

            if (button) {
                // Stop observing once we found the button
                obs.disconnect();

                // Add custom class for header styling
                button.classList.add('geolocation-btn-header');
                console.log('[Geolocation] Added geolocation-btn-header class');

                // Replace the empty icon span with a simple SVG icon
                const iconSpan = button.querySelector('.mapboxgl-ctrl-icon');
                console.log('[Geolocation] Found icon span:', iconSpan);

                if (iconSpan) {
                    iconSpan.innerHTML = `
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 2a6 6 0 0 0-6 6c0 4.5 6 10 6 10s6-5.5 6-10a6 6 0 0 0-6-6zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
                        </svg>
                    `;
                    console.log('[Geolocation] Set SVG innerHTML');
                } else {
                    console.warn('[Geolocation] Icon span not found!');
                }
            }
        });

        // Start observing the container for child additions
        observer.observe(container, { childList: true, subtree: true });
        console.log('[Geolocation] MutationObserver started');

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

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
            this.render(' Location unavailable' + (this.locationErrorCount > 1 ? ' - Try moving to an open area' : ''), 'error');

            // Reset the error count after some time
            setTimeout(() => {
                this.locationErrorCount = 0;
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
                this.render(` My location: ` + (parts.length > 0 ? parts.join(', ') : 'Unknown location'));

            } catch (error) {
                console.error('Error reverse geocoding:', error);
            }
        });

        return super.onAdd(map);
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

    render(text, className) {
        const geolocateButton = $('.mapboxgl-ctrl-geolocate');
        geolocateButton.find('span:not(.mapboxgl-ctrl-icon)').remove();
        geolocateButton.attr('aria-label', 'Find my location');
        geolocateButton.append($('<span>', {
            text: text,
            'class': className,
        }));
    }

    handleUrlUpdate = (event, params) => {
        if (params !== undefined && params.geolocate === true) {
            this.trigger();
        }
    }
}

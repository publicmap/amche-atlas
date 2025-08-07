class GeolocationManager {
    constructor(map) {
        this.map = map;
        this.setupGeolocation();
        this.locationLabelSet = false;
        this.isTracking = false;
        this.locationErrorCount = 0;
    }

    setupGeolocation() {
        // Add geolocate control with bearing tracking
        this.geolocate = new mapboxgl.GeolocateControl({
            positionOptions: {
                enableHighAccuracy: true
            },
            trackUserLocation: true,
            showUserHeading: true,
            showAccuracyCircle: true,
            fitBoundsOptions: {
                zoom: 18,
                padding: 20,
                maxZoom: 20
            }
        });
        
        this.map.addControl(this.geolocate);

        // Track when tracking starts/stops
        this.geolocate.on('trackuserlocationstart', () => {
            this.isTracking = true;
            $(window).on('deviceorientationabsolute', this.handleOrientation);
        });

        this.geolocate.on('trackuserlocationend', () => {
            this.isTracking = false;
            $(window).off('deviceorientationabsolute', this.handleOrientation);
            // Reset map orientation
            this.map.easeTo({
                bearing: 0,
                pitch: 0,
                duration: 1000
            });
        });

        // Handle geolocation errors
        this.geolocate.on('error', (error) => {
            this.locationErrorCount++;
            console.warn('Geolocation error:', error);
            
            // Update the geolocate button to show error
            const $geolocateButton = $('.mapboxgl-ctrl-geolocate');
            if ($geolocateButton.length) {
                // Remove any existing location text
                $geolocateButton.find('span:not(.mapboxgl-ctrl-icon)').remove();
                
                // Add error message
                let errorMessage = 'Location unavailable';
                if (this.locationErrorCount > 1) {
                    errorMessage += ' - Try moving to an open area';
                }
                
                $('<span>', {
                    text: errorMessage,
                    css: { 
                        marginLeft: '5px',
                        color: '#d9534f' 
                    }
                }).appendTo($geolocateButton);
                
                // Style the button to indicate error
                $geolocateButton.css({
                    width: 'auto',
                    minWidth: '30px',
                    whiteSpace: 'nowrap',
                    padding: '6px 10px'
                });
                
                const $buttonParent = $geolocateButton.parent();
                $buttonParent.css({
                    minWidth: 'auto',
                    width: 'auto'
                });
            }
            
            // Reset the error count after some time
            setTimeout(() => {
                this.locationErrorCount = 0;
            }, 60000);
        });

        // Handle successful geolocation
        this.geolocate.on('geolocate', async (event) => {
            this.lastPosition = event;
            this.locationErrorCount = 0;
            
            // Let the GeolocateControl handle positioning and centering automatically
            // when tracking is active. Only handle bearing updates separately via handleOrientation.
            // This prevents our manual map movements from interfering with the tracking behavior.
            
            if (!this.locationLabelSet) {
                try {
                    const response = await fetch(
                        `https://api.mapbox.com/geocoding/v5/mapbox.places/${event.coords.longitude},${event.coords.latitude}.json?access_token=${mapboxgl.accessToken}&types=poi,address,neighborhood,locality,place&limit=1`
                    );
                    const data = await response.json();
                    
                    const feature = data.features[0];
                    let addressText = 'Unknown location';
                    
                    if (feature) {
                        const parts = [];
                        
                        if (feature.properties?.name) {
                            parts.push(feature.properties.name);
                        }
                        
                        if (feature.context) {
                            const relevantTypes = ['neighborhood', 'locality', 'place'];
                            feature.context
                                .filter(ctx => relevantTypes.includes(ctx.id.split('.')[0]))
                                .forEach(ctx => parts.push(ctx.text));
                        }
                        
                        addressText = parts.join(', ');
                    }
                    
                    // Update the geolocate button using jQuery
                    const $geolocateButton = $('.mapboxgl-ctrl-geolocate');
                    if ($geolocateButton.length) {
                        const $buttonParent = $geolocateButton.parent();
                        
                        // Style the container
                        $buttonParent.css({
                            minWidth: 'auto',
                            width: 'auto'
                        });
                        
                        // Style the button
                        $geolocateButton.css({
                            width: 'auto',
                            minWidth: '30px',
                            whiteSpace: 'nowrap',
                            padding: '6px 10px'
                        });
                        
                        // Remove any existing location text
                        $geolocateButton.find('span:not(.mapboxgl-ctrl-icon)').remove();
                        
                        // Add new location text
                        $('<span>', {
                            text: `My location: ${addressText}`,
                            css: { marginLeft: '5px' }
                        }).appendTo($geolocateButton);
                        
                        this.locationLabelSet = true;
                    }
                } catch (error) {
                    console.error('Error reverse geocoding:', error);
                }
            }
        });
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
} 
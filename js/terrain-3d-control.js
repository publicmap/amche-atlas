/**
 * Controller for Three Dimensional Terrain
 */
export class Terrain3DControl {
    constructor(options = {}) {
        this.options = {
            initialExaggeration: 1.5,
            minExaggeration: 0,
            maxExaggeration: 100.0,
            step: 0.5,
            ...options
        };

        this._enabled = true; // Default to enabled
        this._exaggeration = this.options.initialExaggeration;
        this._animate = false; // Default to disabled
        this._showWireframe = false; // Default to disabled
        this._enableFog = true; // Default to enabled
        this._visualizeSound = false; // Default to disabled
        this._animationFrame = null; // For requestAnimationFrame
        this._panel = null;
        this._map = null;
        this._terrainSource = 'mapbox'; // Default to Mapbox terrain
        this._initializing = false; // Flag to prevent URL updates during initialization
        
        // Audio visualization properties
        this._audioContext = null;
        this._analyser = null;
        this._microphone = null;
        this._audioStream = null;
        this._audioAnimationFrame = null;
        this._baseExaggeration = this.options.initialExaggeration; // Store base value

        // Define terrain sources
        this._terrainSources = {
            'mapbox': {
                name: 'Mapbox Terrain',
                sourceConfig: {
                    'type': 'raster-dem',
                    'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                    'tileSize': 512,
                    'maxzoom': 14
                },
                sourceId: 'mapbox-dem'
            },
            'cartodem': {
                name: 'ISRO CartoDEM 30m',
                sourceConfig: {
                    'type': 'raster-dem',
                    'tiles': [
                        'https://indianopenmaps.fly.dev/dem/terrain-rgb/cartodem-v3r1/bhuvan/{z}/{x}/{y}.webp'
                    ],
                    'tileSize': 512,
                    'attribution': 'ISRO/Bhuvan CartoDEM'
                },
                sourceId: 'cartodem',
                hillshadeLayerId: 'cartodem-hillshade'
            }
        };
    }

    onAdd(map) {
        this._map = map;

        // Create container with jQuery
        this._container = $('<div>', {
            class: 'mapboxgl-ctrl mapboxgl-ctrl-group'
        })[0];

        // Create button with jQuery
        const $button = $('<button>', {
            class: 'mapboxgl-ctrl-icon',
            type: 'button',
            'aria-label': '3D Controls',
            css: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px',
                fontSize: '12px',
                fontWeight: 'bold',
                color: '#666'
            }
        });

        // Create 3D text
        const $text = $('<span>', {
            text: '3D',
            css: {
                display: 'block',
                lineHeight: '1'
            }
        });

        // Add event handlers using jQuery
        $button
            .append($text)
            .on('click', () => {
                this._togglePanel();
            })
            .on('mouseenter', function () {
                $(this).css('backgroundColor', '#f0f0f0');
            })
            .on('mouseleave', function () {
                $(this).css('backgroundColor', '#ffffff');
            })
            .appendTo(this._container);

        // Create panel
        this._createPanel();

        return this._container;
    }

    onRemove() {
        // Stop animation if running
        this._stopAnimation();
        
        // Stop audio visualization if running
        this._stopAudioVisualization();

        if (this._panel) {
            $(this._panel).remove();
        }
        $(this._container).remove();
        this._map = undefined;
    }

    _createPanel() {
        // Create panel container
        this._panel = $('<div>', {
            class: 'terrain-3d-panel',
            css: {
                position: 'absolute',
                top: '40px',
                right: '10px',
                width: '250px',
                backgroundColor: 'white',
                border: '1px solid #ccc',
                borderRadius: '4px',
                padding: '15px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                zIndex: '1000',
                display: 'none',
                fontSize: '14px'
            }
        });

        // Create panel content
        const $content = $('<div>');

        // Title
        const $title = $('<h3>', {
            text: '3D Controls',
            css: {
                margin: '0 0 15px 0',
                fontSize: '16px',
                fontWeight: 'bold',
                color: '#333'
            }
        });

        // Terrain source selector
        const $terrainSourceContainer = $('<div>', {
            css: {
                marginBottom: '15px'
            }
        });

        const $terrainSourceLabel = $('<label>', {
            text: 'Terrain Source',
            css: {
                display: 'block',
                marginBottom: '5px',
                fontWeight: '500'
            }
        });

        const $terrainSourceSelect = $('<select>', {
            id: 'terrain-source-select',
            css: {
                width: '100%',
                padding: '5px',
                borderRadius: '3px',
                border: '1px solid #ccc',
                fontSize: '14px'
            }
        });

        // Populate terrain source options
        Object.keys(this._terrainSources).forEach(key => {
            const option = $('<option>', {
                value: key,
                text: this._terrainSources[key].name,
                selected: key === this._terrainSource
            });
            $terrainSourceSelect.append(option);
        });

        $terrainSourceContainer.append($terrainSourceLabel, $terrainSourceSelect);

        // Animation checkbox
        const $animateContainer = $('<div>', {
            css: {
                marginBottom: '15px',
                display: 'flex',
                alignItems: 'center'
            }
        });

        const $animateCheckbox = $('<input>', {
            type: 'checkbox',
            id: 'terrain-3d-animate',
            css: {
                marginRight: '8px'
            }
        });

        const $animateLabel = $('<label>', {
            text: 'Animate around location',
            'for': 'terrain-3d-animate',
            css: {
                cursor: 'pointer',
                fontWeight: '500'
            }
        });

        $animateContainer.append($animateCheckbox, $animateLabel);

        // Fog checkbox
        const $fogContainer = $('<div>', {
            css: {
                marginBottom: '15px',
                display: 'flex',
                alignItems: 'center'
            }
        });

        const $fogCheckbox = $('<input>', {
            type: 'checkbox',
            id: 'terrain-3d-fog',
            checked: this._enableFog,
            css: {
                marginRight: '8px'
            }
        });

        const $fogLabel = $('<label>', {
            text: 'Enable Fog',
            'for': 'terrain-3d-fog',
            css: {
                cursor: 'pointer',
                fontWeight: '500'
            }
        });

        $fogContainer.append($fogCheckbox, $fogLabel);

        // Visualize Sound checkbox
        const $soundContainer = $('<div>', {
            css: {
                marginBottom: '15px',
                display: 'flex',
                alignItems: 'center'
            }
        });

        const $soundCheckbox = $('<input>', {
            type: 'checkbox',
            id: 'terrain-3d-sound',
            checked: this._visualizeSound,
            css: {
                marginRight: '8px'
            }
        });

        const $soundLabel = $('<label>', {
            text: 'Visualize 3D Sound',
            'for': 'terrain-3d-sound',
            css: {
                cursor: 'pointer',
                fontWeight: '500'
            }
        });

        $soundContainer.append($soundCheckbox, $soundLabel);

        // Enable checkbox
        const $checkboxContainer = $('<div>', {
            css: {
                marginBottom: '15px',
                display: 'flex',
                alignItems: 'center'
            }
        });

        const $checkbox = $('<input>', {
            type: 'checkbox',
            id: 'terrain-3d-enabled',
            css: {
                marginRight: '8px'
            }
        });

        const $checkboxLabel = $('<label>', {
            text: 'Enable 3D Terrain',
            'for': 'terrain-3d-enabled',
            css: {
                cursor: 'pointer',
                fontWeight: '500'
            }
        });

        $checkboxContainer.append($checkbox, $checkboxLabel);

        // Exaggeration slider container (only shown when enabled)
        const $sliderContainer = $('<div>', {
            css: {
                marginBottom: '10px',
                display: this._enabled ? 'block' : 'none'
            }
        });

        const $sliderLabel = $('<label>', {
            text: 'Vertical Exaggeration',
            css: {
                display: 'block',
                marginBottom: '5px',
                fontWeight: '500'
            }
        });

        const $slider = $('<input>', {
            type: 'range',
            min: this.options.minExaggeration,
            max: this.options.maxExaggeration,
            step: this.options.step,
            value: this._exaggeration,
            css: {
                width: '100%',
                marginBottom: '5px'
            }
        });

        const $sliderValue = $('<span>', {
            text: this._exaggeration.toFixed(1),
            css: {
                fontSize: '12px',
                color: '#666',
                fontWeight: 'bold'
            }
        });

        // Wireframe checkbox (grouped with exaggeration controls)
        const $wireframeContainer = $('<div>', {
            css: {
                marginTop: '15px',
                display: 'flex',
                alignItems: 'center'
            }
        });

        const $wireframeCheckbox = $('<input>', {
            type: 'checkbox',
            id: 'terrain-3d-wireframe',
            css: {
                marginRight: '8px'
            }
        });

        const $wireframeLabel = $('<label>', {
            text: 'Show terrain mesh',
            'for': 'terrain-3d-wireframe',
            css: {
                cursor: 'pointer',
                fontWeight: '500'
            }
        });

        $wireframeContainer.append($wireframeCheckbox, $wireframeLabel);

        $sliderContainer.append($sliderLabel, $slider, $sliderValue, $wireframeContainer);

        // Close button
        const $closeButton = $('<button>', {
            text: '×',
            css: {
                position: 'absolute',
                top: '5px',
                right: '10px',
                background: 'none',
                border: 'none',
                fontSize: '18px',
                cursor: 'pointer',
                color: '#999',
                padding: '0',
                width: '20px',
                height: '20px',
                lineHeight: '1'
            }
        });

        // Assemble panel
        $content.append($title, $terrainSourceContainer, $animateContainer, $fogContainer, $soundContainer, $checkboxContainer, $sliderContainer);
        this._panel.append($closeButton, $content);

        // Add event handlers
        $terrainSourceSelect.on('change', (e) => {
            this._terrainSource = e.target.value;
            this._updateTerrain();
            this._updateTerrainSourceURLParameter();
        });

        $animateCheckbox.on('change', (e) => {
            this._animate = e.target.checked;
            this._updateAnimation();
        });

        $fogCheckbox.on('change', (e) => {
            this._enableFog = e.target.checked;
            this._updateFog();
        });

        $soundCheckbox.on('change', (e) => {
            this._visualizeSound = e.target.checked;
            this._updateAudioVisualization();
        });

        $wireframeCheckbox.on('change', (e) => {
            this._showWireframe = e.target.checked;
            this._updateWireframe();
        });

        $checkbox.on('change', (e) => {
            this._enabled = e.target.checked;
            // Show/hide slider container (which includes wireframe checkbox) based on checkbox state
            $sliderContainer.css('display', this._enabled ? 'block' : 'none');
            this._updateTerrain();
        });

        $slider.on('input', (e) => {
            this._exaggeration = parseFloat(e.target.value);
            $sliderValue.text(this._exaggeration.toFixed(1));
            if (this._enabled) {
                this._updateTerrain();
            }
        });

        $closeButton.on('click', () => {
            this._hidePanel();
        });

        // Close panel when clicking outside
        $(document).on('click.terrain3d', (e) => {
            if (!$(e.target).closest('.terrain-3d-panel, .mapboxgl-ctrl-icon').length) {
                this._hidePanel();
            }
        });

        // Add panel to map container
        $(this._map.getContainer()).append(this._panel);
    }

    _togglePanel() {
        if (this._panel.css('display') === 'none') {
            this._showPanel();
        } else {
            this._hidePanel();
        }
    }

    _showPanel() {
        $(this._panel).show();
    }

    _hidePanel() {
        $(this._panel).hide();
    }

    _updateTerrain() {
        if (!this._map) return;

        // Skip terrain updates during initialization to prevent interference with layer creation
        if (this._initializing) {
            return;
        }

        if (this._enabled) {
            const terrainConfig = this._terrainSources[this._terrainSource];
            if (!terrainConfig) {
                console.warn(`Unknown terrain source: ${this._terrainSource}`);
                return;
            }

            // Check if we already have the correct terrain source active
            const currentTerrain = this._map.getTerrain();
            const targetSourceExists = this._map.getSource(terrainConfig.sourceId);

            if (currentTerrain && currentTerrain.source === terrainConfig.sourceId && targetSourceExists) {
                // Same source is already active, just update exaggeration
                this._map.setTerrain({
                    'source': terrainConfig.sourceId,
                    'exaggeration': this._exaggeration
                });
                this._updateURLParameter();
                return;
            }

            // First, disable terrain if it's currently active to avoid conflicts
            if (currentTerrain) {
                this._map.setTerrain(null);
            }

            // Remove existing terrain sources and layers (now safe since terrain is disabled)
            this._removeExistingTerrainSources();

            // Add the selected terrain source
            if (!this._map.getSource(terrainConfig.sourceId)) {
                this._map.addSource(terrainConfig.sourceId, terrainConfig.sourceConfig);
            }

            // For CartoDEM, also add hillshade layer
            if (this._terrainSource === 'cartodem' && terrainConfig.hillshadeLayerId) {
                if (!this._map.getLayer(terrainConfig.hillshadeLayerId)) {
                    this._map.addLayer({
                        'id': terrainConfig.hillshadeLayerId,
                        'type': 'hillshade',
                        'source': terrainConfig.sourceId
                    });
                }
            }

            // Set terrain with the new source
            this._map.setTerrain({
                'source': terrainConfig.sourceId,
                'exaggeration': this._exaggeration
            });
        } else {
            // Disable terrain, remove sources
            this._map.setTerrain(null);
            this._removeExistingTerrainSources();
        }

        // Update fog separately based on fog setting
        this._updateFog();

        // Update URL parameter
        this._updateURLParameter();
    }

    _removeExistingTerrainSources() {
        // Remove all terrain sources and associated layers
        Object.values(this._terrainSources).forEach(config => {
            try {
                // Remove hillshade layer if it exists
                if (config.hillshadeLayerId && this._map.getLayer(config.hillshadeLayerId)) {
                    this._map.removeLayer(config.hillshadeLayerId);
                }

                // Remove source if it exists
                if (this._map.getSource(config.sourceId)) {
                    this._map.removeSource(config.sourceId);
                }
            } catch (error) {
                console.warn(`Error removing terrain source ${config.sourceId}:`, error);
            }
        });
    }

    _updateURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateTerrainParam) {
            if (this._enabled) {
                window.urlManager.updateTerrainParam(this._exaggeration);
            } else {
                window.urlManager.updateTerrainParam(0);
            }
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (this._enabled) {
                url.searchParams.set('terrain', this._exaggeration.toString());
            } else {
                url.searchParams.set('terrain', '0'); // Set to 0 when disabled
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updateAnimation() {
        if (this._animate) {
            this._startAnimation();
        } else {
            this._stopAnimation();
        }

        // Update URL parameter
        this._updateAnimationURLParameter();
    }

    _startAnimation() {
        if (!this._map || this._animationFrame) return;

        const rotateCamera = (timestamp) => {
            // clamp the rotation between 0 -360 degrees
            // Divide timestamp by 100 to slow rotation to ~10 degrees / sec
            this._map.rotateTo((timestamp / 100) % 360, {duration: 0});
            // Request the next frame of the animation.
            this._animationFrame = requestAnimationFrame(rotateCamera);
        };

        // Start the animation
        this._animationFrame = requestAnimationFrame(rotateCamera);
    }

    _stopAnimation() {
        if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
            this._animationFrame = null;
        }
    }

    _updateAnimationURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateAnimateParam) {
            window.urlManager.updateAnimateParam(this._animate);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (this._animate) {
                url.searchParams.set('animate', 'true');
            } else {
                url.searchParams.delete('animate');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updateFog() {
        if (!this._map) return;

        if (this._enableFog) {
            // Set fog with the specified configuration
            this._map.setFog({
                'range': [-0.5, 10],
                'color': '#def',
                'high-color': '#def',
                'space-color': '#def'
            });
        } else {
            // Disable fog
            this._map.setFog(null);
        }

        // Update URL parameter
        this._updateFogURLParameter();
    }

    _updateWireframe() {
        if (!this._map) return;

        // Toggle the terrain wireframe debug feature
        this._map.showTerrainWireframe = this._showWireframe;

        // Update URL parameter
        this._updateWireframeURLParameter();
    }

    _updateWireframeURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateWireframeParam) {
            window.urlManager.updateWireframeParam(this._showWireframe);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (this._showWireframe) {
                url.searchParams.set('wireframe', 'true');
            } else {
                url.searchParams.delete('wireframe');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updateFogURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateFogParam) {
            window.urlManager.updateFogParam(this._enableFog);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (!this._enableFog) { // Only set if not default (default is true)
                url.searchParams.set('fog', 'false');
            } else {
                url.searchParams.delete('fog');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updateTerrainSourceURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateTerrainSourceParam) {
            window.urlManager.updateTerrainSourceParam(this._terrainSource);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (this._terrainSource !== 'mapbox') { // Only set if not default
                url.searchParams.set('terrainSource', this._terrainSource);
            } else {
                url.searchParams.delete('terrainSource');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    // Public methods for external control
    setEnabled(enabled) {
        this._enabled = enabled;
        $('#terrain-3d-enabled').prop('checked', enabled);
        // Show/hide slider container (which includes wireframe checkbox) based on enabled state
        $('.terrain-3d-panel input[type="range"]').closest('div').css('display', enabled ? 'block' : 'none');
        this._updateTerrain();
    }

    setExaggeration(exaggeration) {
        this._exaggeration = Math.max(this.options.minExaggeration,
            Math.min(this.options.maxExaggeration, exaggeration));
        $('input[type="range"]', this._panel).val(this._exaggeration);
        $('.terrain-3d-panel span').text(this._exaggeration.toFixed(1));
        if (this._enabled) {
            this._updateTerrain();
        }
    }

    getEnabled() {
        return this._enabled;
    }

    getExaggeration() {
        return this._exaggeration;
    }

    setAnimate(animate) {
        this._animate = animate;
        $('#terrain-3d-animate').prop('checked', animate);
        this._updateAnimation();
    }

    getAnimate() {
        return this._animate;
    }

    setWireframe(wireframe) {
        this._showWireframe = wireframe;
        $('#terrain-3d-wireframe').prop('checked', wireframe);
        this._updateWireframe();
    }

    getWireframe() {
        return this._showWireframe;
    }

    setTerrainSource(source) {
        if (this._terrainSources[source]) {
            this._terrainSource = source;
            $('#terrain-source-select').val(source);
            this._updateTerrain();
            this._updateTerrainSourceURLParameter();
        }
    }

    getTerrainSource() {
        return this._terrainSource;
    }

    setFog(enableFog) {
        this._enableFog = enableFog;
        $('#terrain-3d-fog').prop('checked', enableFog);
        this._updateFog();
    }

    getFog() {
        return this._enableFog;
    }

    setVisualizeSound(visualizeSound) {
        this._visualizeSound = visualizeSound;
        $('#terrain-3d-sound').prop('checked', visualizeSound);
        this._updateAudioVisualization();
    }

    getVisualizeSound() {
        return this._visualizeSound;
    }

    async _updateAudioVisualization() {
        if (this._visualizeSound) {
            await this._startAudioVisualization();
        } else {
            this._stopAudioVisualization();
        }

        // Update URL parameter
        this._updateSoundURLParameter();
    }

    async _startAudioVisualization() {
        if (this._audioContext) return; // Already running

        try {
            // Request microphone access
            this._audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Create audio context and analyser
            this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this._analyser = this._audioContext.createAnalyser();
            this._analyser.fftSize = 256;

            // Connect microphone to analyser
            this._microphone = this._audioContext.createMediaStreamSource(this._audioStream);
            this._microphone.connect(this._analyser);

            // Store the current exaggeration as base
            this._baseExaggeration = this._exaggeration;

            // Start visualization loop
            const visualize = () => {
                if (!this._visualizeSound) return;

                const bufferLength = this._analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                this._analyser.getByteFrequencyData(dataArray);

                // Calculate average volume (0-255)
                const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;

                // Map volume to exaggeration multiplier (0.5x to 3x of base)
                // Normalize average from 0-255 to 0-1, then scale
                const normalizedVolume = average / 255;
                const multiplier = 0.5 + (normalizedVolume * 2.5);
                const newExaggeration = Math.max(
                    this.options.minExaggeration,
                    Math.min(this.options.maxExaggeration, this._baseExaggeration * multiplier)
                );

                // Update terrain exaggeration
                this._exaggeration = newExaggeration;
                $('input[type="range"]', this._panel).val(this._exaggeration);
                $('.terrain-3d-panel span').first().text(this._exaggeration.toFixed(1));

                if (this._enabled && this._map) {
                    const terrainConfig = this._terrainSources[this._terrainSource];
                    if (terrainConfig && this._map.getSource(terrainConfig.sourceId)) {
                        this._map.setTerrain({
                            'source': terrainConfig.sourceId,
                            'exaggeration': this._exaggeration
                        });
                    }
                }

                // Continue animation
                this._audioAnimationFrame = requestAnimationFrame(visualize);
            };

            visualize();
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Unable to access microphone. Please grant microphone permissions and try again.');
            this._visualizeSound = false;
            $('#terrain-3d-sound').prop('checked', false);
        }
    }

    _stopAudioVisualization() {
        // Stop animation loop
        if (this._audioAnimationFrame) {
            cancelAnimationFrame(this._audioAnimationFrame);
            this._audioAnimationFrame = null;
        }

        // Disconnect and close audio nodes
        if (this._microphone) {
            this._microphone.disconnect();
            this._microphone = null;
        }

        if (this._analyser) {
            this._analyser = null;
        }

        if (this._audioContext) {
            this._audioContext.close();
            this._audioContext = null;
        }

        // Stop audio stream
        if (this._audioStream) {
            this._audioStream.getTracks().forEach(track => track.stop());
            this._audioStream = null;
        }

        // Restore base exaggeration
        if (this._baseExaggeration !== undefined) {
            this.setExaggeration(this._baseExaggeration);
        }
    }

    _updateSoundURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateSoundParam) {
            window.urlManager.updateSoundParam(this._visualizeSound);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            if (this._visualizeSound) {
                url.searchParams.set('sound', 'true');
            } else {
                url.searchParams.delete('sound');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    // Method to initialize from URL parameter
    initializeFromURL() {
        // Set initialization flag to prevent URL updates during initialization
        this._initializing = true;

        const urlParams = new URLSearchParams(window.location.search);
        const terrainParam = urlParams.get('terrain');
        const animateParam = urlParams.get('animate');
        const wireframeParam = urlParams.get('wireframe');
        const terrainSourceParam = urlParams.get('terrainSource');
        const fogParam = urlParams.get('fog');
        const soundParam = urlParams.get('sound');

        // Handle terrain source parameter first
        if (terrainSourceParam && this._terrainSources[terrainSourceParam]) {
            this.setTerrainSource(terrainSourceParam);
        } else {
            this.setTerrainSource('mapbox');
        }

        if (terrainParam) {
            const exaggeration = parseFloat(terrainParam);
            if (!isNaN(exaggeration)) {
                if (exaggeration === 0) {
                    // Explicitly disabled
                    this.setEnabled(false);
                } else if (exaggeration >= this.options.minExaggeration &&
                    exaggeration <= this.options.maxExaggeration) {
                    // Valid exaggeration value
                    this.setExaggeration(exaggeration);
                    this.setEnabled(true);
                }
            }
        } else {
            // No terrain parameter - use default enabled state
            this.setEnabled(true);
            this.setExaggeration(this.options.initialExaggeration);
        }

        // Handle animate parameter
        if (animateParam === 'true') {
            this.setAnimate(true);
        } else {
            this.setAnimate(false);
        }

        // Handle wireframe parameter
        if (wireframeParam === 'true') {
            this.setWireframe(true);
        } else {
            this.setWireframe(false);
        }

        // Handle fog parameter
        if (fogParam === 'false') {
            this.setFog(false);
        } else {
            this.setFog(true);
        }

        // Handle sound parameter
        if (soundParam === 'true') {
            this.setVisualizeSound(true);
        } else {
            this.setVisualizeSound(false);
        }

        // Clear initialization flag to allow normal URL updates
        this._initializing = false;
    }
}

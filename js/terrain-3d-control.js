/**
 * Controller for Three Dimensional Terrain
 */
export class Terrain3DControl {
    constructor(options = {}) {
        this.options = {
            initialExaggeration: 1.5,
            minExaggeration: 0,
            maxExaggeration: 20.0,
            step: 0.5,
            ...options
        };

        this._enabled = false; // Default to disabled for lazy loading
        this._exaggeration = this.options.initialExaggeration;
        this._animate = false; // Default to disabled
        this._showWireframe = false; // Default to disabled
        this._enableFog = true; // Default to enabled
        this._visualizeSound = false; // Default to disabled
        this._fov = 0.643; // Default FOV in radians (~36.87°)
        this._bearing = 0; // Default bearing (rotation) in degrees
        this._pitch = 0; // Default pitch (tilt) in degrees
        this._animationFrame = null; // For requestAnimationFrame
        this._panel = null;
        this._map = null;
        this._terrainSource = 'mapbox'; // Default to Mapbox terrain
        this._initializing = false; // Flag to prevent URL updates during initialization
        this._pitchListener = null; // Track pitch change listener for cleanup
        this._autoPitchAnimationFrame = null;
        this._autoPitchAnimating = false;
        this._autoPitchUserOverrode = false;
        this._pitchBeforePanel = null;
        
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

        // Initialize bearing and pitch from current map state
        this._bearing = this._map.getBearing();
        this._pitch = this._map.getPitch();

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

        // Remove pitch listener
        this.removePitchListener();

        if (this._panel) {
            $(this._panel).remove();
        }
        $(this._container).remove();
        this._map = undefined;
    }

    _createPanel() {
        // Create panel container with scrolling
        this._panel = $('<div>', {
            class: 'terrain-3d-panel',
            css: {
                position: 'absolute',
                top: '40px',
                right: '10px',
                width: '280px',
                maxHeight: '600px',
                backgroundColor: 'white',
                border: '1px solid #ccc',
                borderRadius: '4px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                zIndex: '1000',
                display: 'none',
                fontSize: '14px',
                overflow: 'hidden'
            }
        });

        // Create scrollable content container
        const $scrollContent = $('<div>', {
            css: {
                maxHeight: '600px',
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: '15px',
                paddingRight: '10px'
            }
        });

        // Create panel content
        const $content = $('<div>');

        // Title
        const $title = $('<h3>', {
            text: '3D Controls',
            css: {
                margin: '0 0 15px 0',
                paddingRight: '30px',
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

        // Visualize Sound checkbox (grouped with exaggeration controls)
        const $soundContainer = $('<div>', {
            css: {
                marginTop: '15px',
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
            text: 'Dancing Terrain',
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

        // Wireframe checkbox
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

        // Helper function to create slider with icon
        const createSliderControl = (label, icon, min, max, step, value, valueId, sliderId, formatValue, defaultValue, resetCallback) => {
            const $container = $('<div>', { css: { marginBottom: '12px' } });

            const $labelRow = $('<div>', {
                css: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '5px'
                }
            });

            const $labelWithIcon = $('<div>', {
                css: { display: 'flex', alignItems: 'center', gap: '6px' }
            });

            if (icon) {
                $labelWithIcon.append(`<sl-icon name="${icon}" style="font-size: 14px;"></sl-icon>`);
            }

            $labelWithIcon.append($('<span>', {
                text: label,
                css: { fontWeight: '500', fontSize: '13px' }
            }));

            const $value = $('<span>', {
                id: valueId,
                text: formatValue(value),
                css: {
                    fontSize: '12px',
                    color: '#666',
                    fontWeight: 'bold',
                    cursor: 'default'
                }
            });

            // Update value style based on whether it differs from default
            const updateValueStyle = (currentValue) => {
                const isDifferent = Math.abs(currentValue - defaultValue) > 0.001;
                $value.css({
                    cursor: isDifferent ? 'pointer' : 'default',
                    color: isDifferent ? '#2563eb' : '#666',
                    textDecoration: isDifferent ? 'underline' : 'none'
                });
            };

            updateValueStyle(value);

            // Make value clickable to reset
            $value.on('click', () => {
                if (Math.abs(parseFloat($slider.val()) - defaultValue) > 0.001) {
                    $slider.val(defaultValue).trigger('input');
                    if (resetCallback) resetCallback();
                }
            });

            $labelRow.append($labelWithIcon, $value);

            const $slider = $('<input>', {
                type: 'range',
                id: sliderId,
                min, max, step, value,
                css: { width: '100%' }
            });

            $container.append($labelRow, $slider);
            return { $container, $slider, $value, updateValueStyle };
        };

        // CAMERA SECTION
        const $cameraSection = $('<div>', {
            css: {
                marginBottom: '20px',
                paddingBottom: '15px',
                borderBottom: '1px solid #e5e5e5'
            }
        });

        const $cameraHeader = $('<div>', {
            css: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
                gap: '10px'
            }
        });

        const $cameraHeading = $('<h4>', {
            text: 'Camera',
            css: {
                margin: 0,
                fontSize: '14px',
                fontWeight: 'bold',
                color: '#333',
                flexShrink: 0
            }
        });

        const $cameraResetButton = $('<button>', {
            text: 'Reset',
            css: {
                padding: '2px 8px',
                fontSize: '11px',
                backgroundColor: '#f8f8f8',
                border: '1px solid #d0d0d0',
                borderRadius: '3px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                color: '#333'
            }
        });

        // Define camera defaults
        const cameraDefaults = {
            bearing: 0,
            pitch: 0,
            fov: 0.643
        };

        // Function to check if camera is at defaults
        const isCameraAtDefaults = () => {
            return Math.abs(this._bearing - cameraDefaults.bearing) < 0.1 &&
                   Math.abs(this._pitch - cameraDefaults.pitch) < 0.1 &&
                   Math.abs(this._fov - cameraDefaults.fov) < 0.001;
        };

        // Update camera reset button visibility
        const updateCameraResetVisibility = () => {
            $cameraResetButton.css('display', isCameraAtDefaults() ? 'none' : 'block');
        };

        $cameraHeader.append($cameraHeading, $cameraResetButton);

        // Create sliders for camera controls
        const bearingControl = createSliderControl('Rotation', 'arrow-counterclockwise', 0, 360, 1, this._bearing, 'terrain-3d-bearing-value', 'terrain-3d-bearing-slider', v => v.toFixed(0) + '°', cameraDefaults.bearing, updateCameraResetVisibility);
        const pitchControl = createSliderControl('Tilt', 'chevron-bar-expand', 0, 85, 1, this._pitch, 'terrain-3d-pitch-value', 'terrain-3d-pitch-slider', v => v.toFixed(0) + '°', cameraDefaults.pitch, updateCameraResetVisibility);
        const fovControl = createSliderControl('Perspective', 'arrows-expand-vertical', 0.1, 1.5, 0.01, this._fov, 'terrain-3d-fov-value', 'terrain-3d-fov-slider', v => (v * (180 / Math.PI)).toFixed(1) + '°', cameraDefaults.fov, updateCameraResetVisibility);

        $cameraSection.append($cameraHeader, bearingControl.$container, pitchControl.$container, fovControl.$container);

        // Set initial visibility
        updateCameraResetVisibility();

        // TERRAIN SECTION
        const $terrainSection = $('<div>', {
            css: {
                marginBottom: '20px',
                paddingBottom: '15px',
                borderBottom: '1px solid #e5e5e5'
            }
        });

        const $terrainHeader = $('<div>', {
            css: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
                gap: '10px'
            }
        });

        const $terrainHeading = $('<h4>', {
            text: 'Terrain',
            css: {
                margin: 0,
                fontSize: '14px',
                fontWeight: 'bold',
                color: '#333',
                flexShrink: 0
            }
        });

        const $terrainResetButton = $('<button>', {
            text: 'Reset',
            css: {
                padding: '2px 8px',
                fontSize: '11px',
                backgroundColor: '#f8f8f8',
                border: '1px solid #d0d0d0',
                borderRadius: '3px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                color: '#333'
            }
        });

        // Define terrain defaults
        const terrainDefaults = {
            source: 'mapbox',
            exaggeration: this.options.initialExaggeration,
            wireframe: false
        };

        // Function to check if terrain is at defaults
        const isTerrainAtDefaults = () => {
            return this._terrainSource === terrainDefaults.source &&
                   Math.abs(this._exaggeration - terrainDefaults.exaggeration) < 0.01 &&
                   this._showWireframe === terrainDefaults.wireframe;
        };

        // Update terrain reset button visibility
        const updateTerrainResetVisibility = () => {
            $terrainResetButton.css('display', isTerrainAtDefaults() ? 'none' : 'block');
        };

        $terrainHeader.append($terrainHeading, $terrainResetButton);

        $terrainSection.append($terrainHeader, $checkboxContainer, $terrainSourceContainer);

        // Terrain controls container (shown when enabled)
        const $terrainControls = $('<div>', {
            id: 'terrain-3d-controls-container',
            css: { display: this._enabled ? 'block' : 'none' }
        });

        const exaggerationControl = createSliderControl('Vertical Scale', 'arrow-bar-up', this.options.minExaggeration, this.options.maxExaggeration, this.options.step, this._exaggeration, 'terrain-3d-exaggeration-value', 'terrain-3d-exaggeration-slider', v => v.toFixed(1), terrainDefaults.exaggeration, updateTerrainResetVisibility);

        $terrainControls.append(exaggerationControl.$container, $wireframeContainer);
        $terrainSection.append($terrainControls);

        // Set initial visibility
        updateTerrainResetVisibility();

        // MORE CAMERA OPTIONS (collapsible)
        const $moreOptionsContainer = $('<div>', {
            css: { marginTop: '10px' }
        });

        const $moreOptionsHeader = $('<div>', {
            css: {
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                padding: '8px 0',
                fontSize: '13px',
                fontWeight: '500',
                color: '#666',
                userSelect: 'none'
            }
        });

        const $moreOptionsIcon = $('<span>', {
            text: '▸',
            css: {
                fontSize: '10px',
                transition: 'transform 0.2s ease'
            }
        });

        const $moreOptionsLabel = $('<span>', {
            text: 'More Camera Options'
        });

        $moreOptionsHeader.append($moreOptionsIcon, $moreOptionsLabel);

        const $moreContent = $('<div>', {
            css: {
                display: 'none',
                paddingTop: '10px'
            }
        });
        $moreContent.append($animateContainer, $fogContainer, $soundContainer);

        $moreOptionsContainer.append($moreOptionsHeader, $moreContent);

        // Toggle handler
        $moreOptionsHeader.on('click', () => {
            const isVisible = $moreContent.is(':visible');
            $moreContent.slideToggle(200);
            $moreOptionsIcon.css('transform', isVisible ? 'rotate(0deg)' : 'rotate(90deg)');
        });

        // Assemble all sections into scrollable content
        $scrollContent.append($title, $cameraSection, $terrainSection, $moreOptionsContainer);

        // Close button
        const $closeButton = $('<button>', {
            class: 'terrain-3d-close-button',
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
                lineHeight: '1',
                zIndex: '10'
            }
        });

        this._panel.append($closeButton, $scrollContent);

        // Update slider references for event handlers
        const $bearingSlider = bearingControl.$slider;
        const $bearingValue = bearingControl.$value;
        const $pitchSlider = pitchControl.$slider;
        const $pitchValue = pitchControl.$value;
        const $fovSlider = fovControl.$slider;
        const $fovValue = fovControl.$value;
        const $exaggerationSlider = exaggerationControl.$slider;
        const $exaggerationValue = exaggerationControl.$value;

        // Add event handlers
        $terrainSourceSelect.on('change', (e) => {
            this._terrainSource = e.target.value;
            this._updateTerrain();
            this._updateTerrainSourceURLParameter();
            updateTerrainResetVisibility();
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
            updateTerrainResetVisibility();
        });

        $checkbox.on('change', (e) => {
            this._enabled = e.target.checked;
            // Show/hide terrain controls based on checkbox state
            $terrainControls.css('display', this._enabled ? 'block' : 'none');
            this._updateTerrain();
        });

        $exaggerationSlider.on('input', (e) => {
            this._exaggeration = parseFloat(e.target.value);
            $exaggerationValue.text(this._exaggeration.toFixed(1));
            exaggerationControl.updateValueStyle(this._exaggeration);
            updateTerrainResetVisibility();
            if (this._enabled) {
                this._updateTerrain();
            }
        });

        $fovSlider.on('input', (e) => {
            this._fov = parseFloat(e.target.value);
            $fovValue.text((this._fov * (180 / Math.PI)).toFixed(1) + '°');
            fovControl.updateValueStyle(this._fov);
            updateCameraResetVisibility();
            this._updateFov();
        });

        $bearingSlider.on('input', (e) => {
            this._bearing = parseFloat(e.target.value);
            $bearingValue.text(this._bearing.toFixed(0) + '°');
            bearingControl.updateValueStyle(this._bearing);
            updateCameraResetVisibility();
            this._updateBearing();
        });

        $pitchSlider.on('input', (e) => {
            // Cancel auto-animation if user manually moves slider
            if (this._autoPitchAnimating) {
                this._autoPitchUserOverrode = true;
                this._autoPitchAnimating = false;
                if (this._autoPitchAnimationFrame) {
                    cancelAnimationFrame(this._autoPitchAnimationFrame);
                    this._autoPitchAnimationFrame = null;
                }
            }
            this._pitch = parseFloat(e.target.value);
            $pitchValue.text(this._pitch.toFixed(0) + '°');
            pitchControl.updateValueStyle(this._pitch);
            updateCameraResetVisibility();
            this._updatePitch();
        });

        // Camera reset button
        $cameraResetButton.on('click', () => {
            this.setBearing(cameraDefaults.bearing);
            this.setPitch(cameraDefaults.pitch);
            this.setFov(cameraDefaults.fov);
            // Update sliders and values
            $bearingSlider.val(cameraDefaults.bearing);
            $bearingValue.text(cameraDefaults.bearing.toFixed(0) + '°');
            bearingControl.updateValueStyle(cameraDefaults.bearing);
            $pitchSlider.val(cameraDefaults.pitch);
            $pitchValue.text(cameraDefaults.pitch.toFixed(0) + '°');
            pitchControl.updateValueStyle(cameraDefaults.pitch);
            $fovSlider.val(cameraDefaults.fov);
            $fovValue.text((cameraDefaults.fov * (180 / Math.PI)).toFixed(1) + '°');
            fovControl.updateValueStyle(cameraDefaults.fov);
            updateCameraResetVisibility();
        });

        $cameraResetButton.on('mouseenter', function() {
            $(this).css('backgroundColor', '#e0e0e0');
        });

        $cameraResetButton.on('mouseleave', function() {
            $(this).css('backgroundColor', '#f0f0f0');
        });

        // Terrain reset button
        $terrainResetButton.on('click', () => {
            this.setTerrainSource(terrainDefaults.source);
            this.setEnabled(true);
            this.setExaggeration(terrainDefaults.exaggeration);
            this.setWireframe(terrainDefaults.wireframe);
            // Update UI
            $terrainSourceSelect.val(terrainDefaults.source);
            $exaggerationSlider.val(terrainDefaults.exaggeration);
            $exaggerationValue.text(terrainDefaults.exaggeration.toFixed(1));
            exaggerationControl.updateValueStyle(terrainDefaults.exaggeration);
            $wireframeCheckbox.prop('checked', terrainDefaults.wireframe);
            updateTerrainResetVisibility();
        });

        $terrainResetButton.on('mouseenter', function() {
            $(this).css('backgroundColor', '#e0e0e0');
        });

        $terrainResetButton.on('mouseleave', function() {
            $(this).css('backgroundColor', '#f0f0f0');
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

        // Lazy load: enable terrain when panel is opened for the first time
        if (!this._enabled) {
            this.setEnabled(true);
        }

        // Auto-animate pitch to 50° if pitch is at default (0)
        if (Math.abs(this._pitch) < 0.5) {
            this._pitchBeforePanel = this._pitch;
            this._autoPitchUserOverrode = false;
            this._animatePitch(this._pitch, 50, 2000);
        } else {
            this._pitchBeforePanel = null;
        }
    }

    _hidePanel() {
        // Cancel any in-progress auto-pitch animation
        if (this._autoPitchAnimationFrame) {
            cancelAnimationFrame(this._autoPitchAnimationFrame);
            this._autoPitchAnimationFrame = null;
            this._autoPitchAnimating = false;
        }

        // Reverse-animate pitch back if user didn't manually override
        if (this._pitchBeforePanel !== null && !this._autoPitchUserOverrode) {
            this._animatePitch(this._pitch, this._pitchBeforePanel, 2000);
        }
        this._pitchBeforePanel = null;

        $(this._panel).hide();
    }

    _animatePitch(from, to, duration) {
        if (this._autoPitchAnimationFrame) {
            cancelAnimationFrame(this._autoPitchAnimationFrame);
            this._autoPitchAnimationFrame = null;
        }

        const start = performance.now();
        const easeOut = t => 1 - Math.pow(1 - t, 3);

        const animate = (now) => {
            const t = Math.min((now - start) / duration, 1);
            const pitch = from + (to - from) * easeOut(t);

            this._pitch = pitch;
            $('#terrain-3d-pitch-slider').val(pitch);
            $('#terrain-3d-pitch-value').text(pitch.toFixed(0) + '°');
            this._updatePitch();

            if (t < 1) {
                this._autoPitchAnimationFrame = requestAnimationFrame(animate);
            } else {
                this._autoPitchAnimationFrame = null;
                this._autoPitchAnimating = false;
            }
        };

        this._autoPitchAnimating = true;
        this._autoPitchAnimationFrame = requestAnimationFrame(animate);
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
                url.searchParams.delete('terrain');
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

    _updateFov() {
        if (!this._map) return;

        // Set the field of view using internal API
        this._map.transform._fov = this._fov;
        this._map.transform._calcMatrices();
        this._map.triggerRepaint();

        // Update URL parameter
        this._updateFovURLParameter();
    }

    _updateBearing() {
        if (!this._map) return;

        this._map.setBearing(this._bearing);

        // Update URL parameter
        this._updateBearingURLParameter();
    }

    _updatePitch() {
        if (!this._map) return;

        this._map.setPitch(this._pitch);

        // Update URL parameter
        this._updatePitchURLParameter();
    }

    _resetToDefaults() {
        // Reset all values to defaults
        this.setTerrainSource('mapbox');
        this.setAnimate(false);
        this.setFog(true);
        this.setEnabled(true);
        this.setExaggeration(this.options.initialExaggeration);
        this.setWireframe(false);
        this.setVisualizeSound(false);
        this.setFov(0.643);
        this.setBearing(0);
        this.setPitch(0);
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

    _updateFovURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateFovParam) {
            window.urlManager.updateFovParam(this._fov);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            // Only set if not default (0.643 is default)
            if (Math.abs(this._fov - 0.643) > 0.001) {
                url.searchParams.set('fov', this._fov.toFixed(3));
            } else {
                url.searchParams.delete('fov');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updateBearingURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updateBearingParam) {
            window.urlManager.updateBearingParam(this._bearing);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            // Only set if not default (0 is default)
            if (Math.abs(this._bearing) > 0.1) {
                url.searchParams.set('bearing', this._bearing.toFixed(0));
            } else {
                url.searchParams.delete('bearing');
            }

            // Update URL without reloading the page
            window.history.replaceState({}, '', url);
        }
    }

    _updatePitchURLParameter() {
        // Skip URL updates during initialization to prevent encoding issues
        if (this._initializing) {
            return;
        }

        // Use URL API if available, otherwise fall back to direct URL manipulation
        if (window.urlManager && window.urlManager.updatePitchParam) {
            window.urlManager.updatePitchParam(this._pitch);
        } else {
            // Fallback to direct URL manipulation
            const url = new URL(window.location);
            // Only set if not default (0 is default)
            if (Math.abs(this._pitch) > 0.1) {
                url.searchParams.set('pitch', this._pitch.toFixed(0));
            } else {
                url.searchParams.delete('pitch');
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
        // Show/hide terrain controls container based on enabled state
        $('#terrain-3d-controls-container').css('display', enabled ? 'block' : 'none');
        this._updateTerrain();
    }

    setExaggeration(exaggeration) {
        this._exaggeration = Math.max(this.options.minExaggeration,
            Math.min(this.options.maxExaggeration, exaggeration));
        $('#terrain-3d-exaggeration-slider').val(this._exaggeration);
        $('#terrain-3d-exaggeration-value').text(this._exaggeration.toFixed(1));
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

    setFov(fov) {
        this._fov = Math.max(0.1, Math.min(1.5, fov));
        $('#terrain-3d-fov-slider').val(this._fov);
        $('#terrain-3d-fov-value').text((this._fov * (180 / Math.PI)).toFixed(1) + '°');
        this._updateFov();
    }

    getFov() {
        return this._fov;
    }

    setBearing(bearing) {
        this._bearing = bearing % 360;
        if (this._bearing < 0) this._bearing += 360;
        $('#terrain-3d-bearing-slider').val(this._bearing);
        $('#terrain-3d-bearing-value').text(this._bearing.toFixed(0) + '°');
        this._updateBearing();
    }

    getBearing() {
        return this._bearing;
    }

    setPitch(pitch) {
        this._pitch = Math.max(0, Math.min(85, pitch));
        $('#terrain-3d-pitch-slider').val(this._pitch);
        $('#terrain-3d-pitch-value').text(this._pitch.toFixed(0) + '°');
        this._updatePitch();
    }

    getPitch() {
        return this._pitch;
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
        const fovParam = urlParams.get('fov');
        const bearingParam = urlParams.get('bearing');
        const pitchParam = urlParams.get('pitch');

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
            // No terrain parameter in URL - keep terrain disabled
            this.setEnabled(false);
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

        // Handle fov parameter
        if (fovParam) {
            const fov = parseFloat(fovParam);
            if (!isNaN(fov) && fov >= 0.1 && fov <= 1.5) {
                this.setFov(fov);
            }
        }

        // Handle bearing parameter
        if (bearingParam) {
            const bearing = parseFloat(bearingParam);
            if (!isNaN(bearing)) {
                this.setBearing(bearing);
            }
        } else if (this._map) {
            this._bearing = this._map.getBearing();
            $('#terrain-3d-bearing-slider').val(this._bearing);
            $('#terrain-3d-bearing-value').text(this._bearing.toFixed(0) + '°');
        }

        // Handle pitch parameter
        if (pitchParam) {
            const pitch = parseFloat(pitchParam);
            if (!isNaN(pitch) && pitch >= 0 && pitch <= 85) {
                this.setPitch(pitch);
            }
        } else if (this._map) {
            this._pitch = this._map.getPitch();
            $('#terrain-3d-pitch-slider').val(this._pitch);
            $('#terrain-3d-pitch-value').text(this._pitch.toFixed(0) + '°');
        }

        // Clear initialization flag to allow normal URL updates
        this._initializing = false;
    }

    setupPitchListener() {
        if (!this._map || this._pitchListener) return;

        const setupTime = Date.now();
        const initialLoadGracePeriod = 6000;

        this._pitchListener = () => {
            const timeSinceSetup = Date.now() - setupTime;
            if (timeSinceSetup < initialLoadGracePeriod) {
                return;
            }

            const pitch = this._map.getPitch();
            if (pitch > 0 && !this._enabled) {
                this.setEnabled(true);
            }
        };

        this._map.on('pitch', this._pitchListener);
    }

    removePitchListener() {
        if (this._map && this._pitchListener) {
            this._map.off('pitch', this._pitchListener);
            this._pitchListener = null;
        }
    }
}

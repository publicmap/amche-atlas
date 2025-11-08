export class TimeControl {
    constructor(options = {}) {
        this.options = {
            initialDaysBack: 0, // Start at current time
            maxDaysBack: 7,    // Maximum 7 days back
            stepHours: 24,     // Step by 24 hours
            ...options
        };

        this._selectedDate = new Date(); // Default to current date/time
        this._panel = null;
        this._map = null;
        this._container = null;
        this._eventListeners = new Set();
        this._isVisible = false; // Track visibility state
        this._stateManager = null; // Reference to state manager for layer monitoring

        // Calculate min and max dates
        this._updateDateRange();
    }

    onAdd(map) {
        this._map = map;

        // Create container with jQuery
        this._container = $('<div>', {
            class: 'mapboxgl-ctrl mapboxgl-ctrl-group time-control',
            css: {
                display: 'none' // Start hidden until we check for time-based layers
            }
        })[0];

        // Create button with jQuery
        const $button = $('<button>', {
            class: 'mapboxgl-ctrl-icon',
            type: 'button',
            'aria-label': 'Time Controls',
            css: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px',
                fontSize: '16px',
                color: '#666'
            }
        });

        // Create clock icon (using unicode clock symbol)
        const $icon = $('<span>', {
            text: '🕐',
            css: {
                display: 'block',
                lineHeight: '1'
            }
        });

        // Add event handlers using jQuery
        $button
            .append($icon)
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

        // Set up layer monitoring
        this._setupLayerMonitoring();

        // Initial visibility check with delays to allow for initialization
        setTimeout(() => this._checkTimeBasedLayers(), 500);
        setTimeout(() => this._checkTimeBasedLayers(), 2000);
        setTimeout(() => this._checkTimeBasedLayers(), 5000);

        return this._container;
    }

    onRemove() {
        // Clean up layer monitoring
        this._cleanupLayerMonitoring();

        if (this._panel) {
            $(this._panel).remove();
        }
        $(this._container).remove();
        this._map = undefined;
        this._stateManager = null;

        // Clean up event listeners
        this._eventListeners.clear();
    }

    _createPanel() {
        // Create panel container
        this._panel = $('<div>', {
            class: 'time-control-panel',
            css: {
                position: 'absolute',
                top: '40px',
                right: '10px',
                width: '300px',
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
            text: 'Time Controls',
            css: {
                margin: '0 0 15px 0',
                fontSize: '16px',
                fontWeight: 'bold',
                color: '#333'
            }
        });

        // Date/Time input container
        const $inputContainer = $('<div>', {
            css: {
                marginBottom: '15px'
            }
        });

        const $inputLabel = $('<label>', {
            text: 'Selected Date & Time',
            css: {
                display: 'block',
                marginBottom: '5px',
                fontWeight: '500'
            }
        });

        const $dateTimeInput = $('<input>', {
            type: 'datetime-local',
            id: 'time-control-datetime',
            css: {
                width: '100%',
                padding: '8px',
                borderRadius: '3px',
                border: '1px solid #ccc',
                fontSize: '14px'
            }
        });

        // Set initial value to current date/time
        this._updateDateTimeInput($dateTimeInput);

        $inputContainer.append($inputLabel, $dateTimeInput);

        // Slider container
        const $sliderContainer = $('<div>', {
            css: {
                marginBottom: '15px'
            }
        });

        const $sliderLabel = $('<label>', {
            text: 'Time Range (Days Back)',
            css: {
                display: 'block',
                marginBottom: '5px',
                fontWeight: '500'
            }
        });

        const $slider = $('<input>', {
            type: 'range',
            id: 'time-control-slider',
            min: 0,
            max: this.options.maxDaysBack,
            step: 1, // Step by days
            value: this.options.initialDaysBack,
            css: {
                width: '100%',
                marginBottom: '5px'
            }
        });

        const $sliderValue = $('<span>', {
            id: 'time-control-slider-value',
            css: {
                fontSize: '12px',
                color: '#666',
                fontWeight: 'bold'
            }
        });

        this._updateSliderLabel($sliderValue, this.options.initialDaysBack);

        $sliderContainer.append($sliderLabel, $slider, $sliderValue);

        // Info text
        const $infoText = $('<div>', {
            text: 'Drag slider to go back in time (24 hour increments) or edit the date/time directly.',
            css: {
                fontSize: '12px',
                color: '#666',
                fontStyle: 'italic',
                marginBottom: '15px'
            }
        });

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
        $content.append($title, $inputContainer, $sliderContainer, $infoText);
        this._panel.append($closeButton, $content);

        // Add event handlers
        $dateTimeInput.on('change', (e) => {
            const newDate = new Date(e.target.value);
            if (!isNaN(newDate.getTime())) {
                this._selectedDate = newDate;
                this._updateDateRange();
                this._updateSliderFromDate($slider, $sliderValue);
                this._emitTimeChangeEvent();
            }
        });

        $slider.on('input', (e) => {
            const daysBack = parseInt(e.target.value);
            this._updateSelectedDateFromSlider(daysBack);
            this._updateDateTimeInput($dateTimeInput);
            this._updateSliderLabel($sliderValue, daysBack);
            this._emitTimeChangeEvent();
        });

        $closeButton.on('click', () => {
            this._hidePanel();
        });

        // Close panel when clicking outside
        $(document).on('click.timecontrol', (e) => {
            if (!$(e.target).closest('.time-control-panel, .mapboxgl-ctrl-icon').length) {
                this._hidePanel();
            }
        });

        // Add panel to map container
        $(this._map.getContainer()).append(this._panel);
    }

    _updateDateRange() {
        // Max date is always the selected date
        this._maxDate = new Date(this._selectedDate);

        // Min date is 7 days before the selected date
        this._minDate = new Date(this._selectedDate);
        this._minDate.setDate(this._minDate.getDate() - this.options.maxDaysBack);
    }

    _updateSelectedDateFromSlider(daysBack) {
        this._selectedDate = new Date(this._maxDate);
        this._selectedDate.setDate(this._selectedDate.getDate() - daysBack);
    }

    _updateSliderFromDate($slider, $sliderValue) {
        // Calculate how many days back the current selected date is from max
        const timeDiff = this._maxDate.getTime() - this._selectedDate.getTime();
        const daysBack = Math.round(timeDiff / (1000 * 60 * 60 * 24));

        // Update slider
        $slider.attr('max', this.options.maxDaysBack);
        $slider.val(daysBack);

        this._updateSliderLabel($sliderValue, daysBack);
    }

    _updateSliderLabel($sliderValue, daysBack) {
        if (daysBack === 0) {
            $sliderValue.text('Current time');
        } else if (daysBack === 1) {
            $sliderValue.text('1 day ago');
        } else {
            $sliderValue.text(`${daysBack} days ago`);
        }
    }

    _updateDateTimeInput($input) {
        // Format date for datetime-local input (YYYY-MM-DDTHH:mm)
        const year = this._selectedDate.getFullYear();
        const month = String(this._selectedDate.getMonth() + 1).padStart(2, '0');
        const day = String(this._selectedDate.getDate()).padStart(2, '0');
        const hours = String(this._selectedDate.getHours()).padStart(2, '0');
        const minutes = String(this._selectedDate.getMinutes()).padStart(2, '0');

        const dateTimeString = `${year}-${month}-${day}T${hours}:${minutes}`;
        $input.val(dateTimeString);
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

    _emitTimeChangeEvent() {
        // Create custom event with selected time
        const event = new CustomEvent('timechange', {
            detail: {
                selectedDate: new Date(this._selectedDate),
                isoString: this._selectedDate.toISOString(),
                // Format for URL parameters (YYYY-MM-DDTHH:mm:ssZ)
                urlFormat: this._selectedDate.toISOString()
            }
        });

        // Emit on map container
        this._map.getContainer().dispatchEvent(event);

        // Also emit on window for global listeners
        window.dispatchEvent(event);
    }

    // Public methods for external control
    getSelectedDate() {
        return new Date(this._selectedDate);
    }

    setSelectedDate(date) {
        if (date instanceof Date && !isNaN(date.getTime())) {
            this._selectedDate = new Date(date);
            this._updateDateRange();

            // Update UI elements if panel exists
            if (this._panel) {
                const $input = $('#time-control-datetime');
                const $slider = $('#time-control-slider');
                const $sliderValue = $('#time-control-slider-value');

                this._updateDateTimeInput($input);
                this._updateSliderFromDate($slider, $sliderValue);
            }

            this._emitTimeChangeEvent();
            return true;
        }
        return false;
    }

    getCurrentTime() {
        return this._selectedDate.toISOString();
    }

    // Method to format time for URL parameters
    getTimeForUrl() {
        return this._selectedDate.toISOString();
    }

    /**
     * Set up layer monitoring to show/hide control based on time-based layers
     */
    _setupLayerMonitoring() {
        // Get state manager reference from global scope or feature control
        this._getStateManagerReference();

        // Listen for layer state changes
        if (this._stateManager) {
            this._layerStateListener = (event) => {
                const {eventType} = event.detail;
                if (eventType === 'layer-registered' || eventType === 'layer-unregistered') {
                    setTimeout(() => this._checkTimeBasedLayers(), 100);
                }
            };
            this._stateManager.addEventListener('state-change', this._layerStateListener);
        } else {
            // Set up a retry mechanism to get the state manager
            setTimeout(() => {
                this._getStateManagerReference();
                if (this._stateManager && !this._layerStateListener) {
                    this._layerStateListener = (event) => {
                        const {eventType} = event.detail;
                        if (eventType === 'layer-registered' || eventType === 'layer-unregistered') {
                            setTimeout(() => this._checkTimeBasedLayers(), 100);
                        }
                    };
                    this._stateManager.addEventListener('state-change', this._layerStateListener);
                }
            }, 2000);
        }

        // Also listen for global layer control events as fallback
        this._globalLayerListener = (event) => {
            setTimeout(() => this._checkTimeBasedLayers(), 100); // Small delay to let changes settle
        };
        window.addEventListener('layer-toggled', this._globalLayerListener);
        window.addEventListener('layer-registered', this._globalLayerListener);
        window.addEventListener('layer-unregistered', this._globalLayerListener);

        // Also listen for Shoelace events that might be fired from layer toggles
        this._shoelaceListener = (event) => {
            if (event.target && event.target.matches && event.target.matches('input[type="checkbox"]')) {
                setTimeout(() => this._checkTimeBasedLayers(), 100);
            }
        };
        document.addEventListener('sl-change', this._shoelaceListener);
        document.addEventListener('change', this._shoelaceListener);
    }

    /**
     * Clean up layer monitoring event listeners
     */
    _cleanupLayerMonitoring() {
        if (this._stateManager && this._layerStateListener) {
            this._stateManager.removeEventListener('state-change', this._layerStateListener);
        }

        if (this._globalLayerListener) {
            window.removeEventListener('layer-toggled', this._globalLayerListener);
            window.removeEventListener('layer-registered', this._globalLayerListener);
            window.removeEventListener('layer-unregistered', this._globalLayerListener);
        }

        if (this._shoelaceListener) {
            document.removeEventListener('sl-change', this._shoelaceListener);
            document.removeEventListener('change', this._shoelaceListener);
        }

        this._layerStateListener = null;
        this._globalLayerListener = null;
        this._shoelaceListener = null;
    }

    /**
     * Get reference to state manager from global scope
     */
    _getStateManagerReference() {
        // Try to get state manager from global feature control
        if (window.mapFeatureControl && window.mapFeatureControl._stateManager) {
            this._stateManager = window.mapFeatureControl._stateManager;
            return;
        }

        // Try to get from layer control if available
        if (window.layerControl && window.layerControl._stateManager) {
            this._stateManager = window.layerControl._stateManager;
            return;
        }

        // Retry after a delay as controls might not be initialized yet
        if (!this._retryCount) this._retryCount = 0;
        this._retryCount++;

        if (this._retryCount < 10) {
            setTimeout(() => {
                if (!this._stateManager) {
                    this._getStateManagerReference();
                }
            }, 1000);
        }
    }

    /**
     * Check if there are any active layers with urlTimeParam and show/hide control accordingly
     */
    _checkTimeBasedLayers() {
        const hasTimeBasedLayers = this._hasActiveTimeBasedLayers();

        if (hasTimeBasedLayers !== this._isVisible) {
            this._setVisibility(hasTimeBasedLayers);
        }
    }

    /**
     * Check if there are any active layers with urlTimeParam defined
     */
    _hasActiveTimeBasedLayers() {
        // Method 1: Check via state manager (most reliable)
        if (this._stateManager) {
            const activeLayers = this._stateManager.getActiveLayers();

            for (const [layerId, layerData] of activeLayers) {
                if (layerData.config && layerData.config.urlTimeParam) {
                    return true;
                }
            }
        }

        // Method 2: Check via MapboxAPI time-based layers
        if (window.mapboxAPI) {
            if (window.mapboxAPI._timeBasedLayers) {
                const timeBasedLayers = window.mapboxAPI._timeBasedLayers;

                for (const [layerId, layerInfo] of timeBasedLayers) {
                    if (layerInfo.visible) {
                        return true;
                    }
                }
            }
        }

        // Method 3: Check via global layer control as fallback
        if (window.layerControl) {
            const layerControl = window.layerControl;

            // Try to get active layers from different methods
            let activeLayers = [];
            if (layerControl.getActiveLayers) {
                activeLayers = layerControl.getActiveLayers();
            } else if (layerControl._state && layerControl._state.groups) {
                // Check which groups are currently visible
                activeLayers = layerControl._state.groups
                    .filter(group => {
                        // Check if this group is checked/visible
                        const toggleElement = document.querySelector(`[data-layer-id="${group.id}"] input[type="checkbox"]`);
                        return toggleElement && toggleElement.checked;
                    })
                    .map(group => group.id);
            }

            for (const layerId of activeLayers) {
                // Find layer config in the state
                let layerConfig = null;
                if (layerControl._state && layerControl._state.groups) {
                    layerConfig = layerControl._state.groups.find(group => group.id === layerId);
                }

                if (layerConfig && layerConfig.urlTimeParam) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Set control visibility with smooth transition
     */
    _setVisibility(visible) {
        if (!this._container) return;

        this._isVisible = visible;

        if (visible) {
            // Show the control with fade-in effect
            $(this._container).css({
                display: 'block',
                opacity: '0'
            }).animate({
                opacity: '1'
            }, 200);
        } else {
            // Hide the control with fade-out effect
            $(this._container).animate({
                opacity: '0'
            }, 200, () => {
                $(this._container).css('display', 'none');
            });

            // Also hide panel if it's open
            this._hidePanel();
        }
    }

    /**
     * Public method to manually check and update visibility
     */
    updateVisibility() {
        this._checkTimeBasedLayers();
    }

    /**
     * Check if control is currently visible
     */
    isVisible() {
        return this._isVisible;
    }
}

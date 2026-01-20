/**
 * MapSearchControl - A class to handle Mapbox search box functionality
 * with support for coordinate search and local layer suggestions
 */
export class MapSearchControl {
    /**
     * @param {Object} map - The Mapbox GL map instance
     * @param {Object} options - Configuration options
     */
    constructor(map, options = {}) {
        this.map = map;
        this.options = {
            accessToken: window.amche.MAPBOXGL_ACCESS_TOKEN,
            proximity: '73.87916,15.26032', // Default to Goa center
            country: 'IN',
            language: 'en',
            types: 'place,locality,postcode,region,district,street,address,poi',
            ...options
        };

        this.isCoordinateInput = false;
        this.coordinateSuggestion = null;
        this.localSuggestions = [];
        this.currentQuery = '';
        this.injectionTimeout = null;
        this.lastInjectedQuery = '';

        this.indiaCoordinateBounds = {
            latMin: 6,
            latMax: 37,
            lngMin: 68,
            lngMax: 97
        };

        // Add marker for search results
        this.searchMarker = null;

        // Suggestion markers management
        this.suggestionMarkers = []; // Array to track markers for each local suggestion
        this.hoveredMarkerIndex = -1; // Track which marker is currently being hovered

        // Feature state manager reference (will be set externally)
        this.featureStateManager = null;

        // Map view context management
        this.referenceView = null; // Saved reference view when search starts
        this.hasActiveSearch = false; // Track if we're in an active search state

        this.searchBox = document.querySelector('mapbox-search-box');

        // Set up mapbox integration
        this.searchBox.mapboxgl = mapboxgl;
        this.searchBox.marker = false; // Disable default marker, we'll handle it ourselves
        this.searchBox.setAttribute('access-token', this.options.accessToken);
        this.searchBox.setAttribute('proximity', this.options.proximity);
        this.searchBox.setAttribute('country', this.options.country);
        this.searchBox.setAttribute('language', this.options.language);
        this.searchBox.setAttribute('types', this.options.types);
        this.searchBox.addEventListener('suggest', this.handleSuggest.bind(this));
        this.searchBox.addEventListener('retrieve', this.handleRetrieve.bind(this));
        this.searchBox.addEventListener('input', this.handleInput.bind(this));
        this.searchBox.addEventListener('keydown', this.handleKeyDown.bind(this));
        this.searchBox.addEventListener('clear', this.handleClear.bind(this));
        this.searchBox.addEventListener('input', () => {
            if (window.urlManager) {
                window.urlManager.updateSearchParam(this.getCurrentQuery());
            }
        });
        this.searchBox.bindMap(this.map);

        // Add required ARIA attributes for the combobox input
        this.setupComboboxAriaAttributes();

        // Monitor input changes more aggressively
        this.setupInputMonitoring();

        // Set up clear button monitoring
        this.setupClearButtonMonitoring();

        // Add map moveend listener to refresh search results when viewport changes
        this.map.on('moveend', this.handleMapMoveEnd.bind(this));

        // Monitor for changes to update aria-expanded when suggestions appear/disappear
        this.setupAriaExpandedMonitoring();
    }

    /**
     * Set the feature state manager instance
     * @param {MapFeatureStateManager} featureStateManager - The feature state manager instance
     */
    setFeatureStateManager(featureStateManager) {
        this.featureStateManager = featureStateManager;
    }

    /**
     * Parse coordinate string in various formats
     * Supports:
     * - Decimal degrees: "15.4921, 73.8435" or "73.8435, 15.4921"
     * - Space separated: "15.4921 73.8435" or "73.8435 15.4921"
     * - DMS: "15°29'31.5\"N 73°50'36.5\"E"
     * - URLs from OSM, Google Maps, and other mapping services
     * Note: Shortened URLs (maps.app.goo.gl) are not supported - open them in a browser and copy the full URL
     * @param {string} input - Input string to parse
     * @returns {Object|null} Object with {lat, lng, format} or null if not parseable
     */
    parseCoordinateInput(input) {
        if (!input || typeof input !== 'string') {
            return null;
        }

        input = input.trim();

        const urlResult = this.parseMapURL(input);
        if (urlResult) {
            return urlResult;
        }

        const dmsResult = this.parseDMS(input);
        if (dmsResult) {
            return dmsResult;
        }

        const decimalResult = this.parseDecimalDegrees(input);
        if (decimalResult) {
            return decimalResult;
        }

        return null;
    }

    /**
     * Parse mapping service URLs using regex patterns
     * Works with any mapping service that uses standard coordinate URL formats
     * Note: Shortened URLs (goo.gl) require JavaScript and cannot be parsed
     * @param {string} url - URL string
     * @returns {Object|null} Coordinate object or null
     */
    parseMapURL(url) {
        try {

            const patterns = [
                {
                    regex: /#map=([\d.]+)\/([-\d.]+)\/([-\d.]+)/,
                    latIndex: 2,
                    lngIndex: 3,
                    name: 'Hash map format'
                },
                {
                    regex: /#([\d.]+)\/([-\d.]+)\/([-\d.]+)/,
                    latIndex: 2,
                    lngIndex: 3,
                    name: 'Hash zoom/lat/lng format'
                },
                {
                    regex: /@([-\d.]+),([-\d.]+),[\d.]+[mz]/,
                    latIndex: 1,
                    lngIndex: 2,
                    name: 'Google Maps @ format'
                },
                {
                    regex: /ll=([-\d.]+),([-\d.]+)/,
                    latIndex: 1,
                    lngIndex: 2,
                    name: 'LL parameter format'
                },
                {
                    regex: /\?lat=([-\d.]+)&lon=([-\d.]+)/,
                    latIndex: 1,
                    lngIndex: 2,
                    name: 'Query param lat/lon format'
                },
                {
                    regex: /\?lon=([-\d.]+)&lat=([-\d.]+)/,
                    latIndex: 2,
                    lngIndex: 1,
                    name: 'Query param lon/lat format'
                }
            ];

            for (const pattern of patterns) {
                const match = url.match(pattern.regex);
                if (match) {
                    const lat = parseFloat(match[pattern.latIndex]);
                    const lng = parseFloat(match[pattern.lngIndex]);

                    if (!isNaN(lat) && !isNaN(lng) && this.isValidCoordinate(lat, lng)) {
                        const hostname = this.extractHostname(url);
                        const displayName = hostname ? `${hostname} URL (${pattern.name})` : `Map URL (${pattern.name})`;
                        return { lat, lng, format: displayName };
                    }
                }
            }
        } catch (error) {
        }
        return null;
    }

    /**
     * Extract hostname from URL for display purposes
     * @param {string} url - URL string
     * @returns {string|null} Hostname or null
     */
    extractHostname(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.replace('www.', '');
        } catch (error) {
            return null;
        }
    }

    /**
     * Parse decimal degrees (handles both lat,lng and lng,lat with smart detection)
     * @param {string} input - Coordinate string
     * @returns {Object|null} Coordinate object or null
     */
    parseDecimalDegrees(input) {
        const commaMatch = input.match(/^([-+]?\d+\.?\d*)\s*[,]\s*([-+]?\d+\.?\d*)$/);
        const spaceMatch = input.match(/^([-+]?\d+\.?\d*)\s+([-+]?\d+\.?\d*)$/);

        const match = commaMatch || spaceMatch;
        if (!match) {
            return null;
        }

        const num1 = parseFloat(match[1]);
        const num2 = parseFloat(match[2]);

        if (isNaN(num1) || isNaN(num2)) {
            return null;
        }

        const result = this.determineCoordinateOrder(num1, num2);
        if (result && this.isValidCoordinate(result.lat, result.lng)) {
            result.format = commaMatch ? 'Decimal degrees (comma)' : 'Decimal degrees (space)';
            return result;
        }

        return null;
    }

    /**
     * Parse DMS (Degrees, Minutes, Seconds) notation
     * Supports formats like: 15°29'31.5"N 73°50'36.5"E
     * @param {string} input - DMS string
     * @returns {Object|null} Coordinate object or null
     */
    parseDMS(input) {
        const dmsPattern = /(\d+)[°\s]+(\d+)['\s]+(\d+\.?\d*)["\s]*([NSEW])?/gi;
        const matches = [...input.matchAll(dmsPattern)];

        if (matches.length < 2) {
            return null;
        }

        const convertDMSToDecimal = (degrees, minutes, seconds, direction) => {
            let decimal = parseFloat(degrees) + parseFloat(minutes) / 60 + parseFloat(seconds) / 3600;
            if (direction === 'S' || direction === 'W') {
                decimal = -decimal;
            }
            return decimal;
        };

        const coord1 = convertDMSToDecimal(
            matches[0][1],
            matches[0][2],
            matches[0][3],
            matches[0][4]
        );

        const coord2 = convertDMSToDecimal(
            matches[1][1],
            matches[1][2],
            matches[1][3],
            matches[1][4]
        );

        const dir1 = matches[0][4]?.toUpperCase();
        const dir2 = matches[1][4]?.toUpperCase();

        let lat, lng;
        if (dir1 === 'N' || dir1 === 'S') {
            lat = coord1;
            lng = coord2;
        } else if (dir2 === 'N' || dir2 === 'S') {
            lat = coord2;
            lng = coord1;
        } else {
            const result = this.determineCoordinateOrder(coord1, coord2);
            if (!result) return null;
            lat = result.lat;
            lng = result.lng;
        }

        if (this.isValidCoordinate(lat, lng)) {
            return { lat, lng, format: 'DMS notation' };
        }

        return null;
    }

    /**
     * Determine coordinate order based on India bounds
     * @param {number} num1 - First number
     * @param {number} num2 - Second number
     * @returns {Object|null} {lat, lng} or null
     */
    determineCoordinateOrder(num1, num2) {
        const { latMin, latMax, lngMin, lngMax } = this.indiaCoordinateBounds;

        const num1InLatRange = num1 >= latMin && num1 <= latMax;
        const num1InLngRange = num1 >= lngMin && num1 <= lngMax;
        const num2InLatRange = num2 >= latMin && num2 <= latMax;
        const num2InLngRange = num2 >= lngMin && num2 <= lngMax;

        if (num1InLatRange && num2InLngRange) {
            return { lat: num1, lng: num2 };
        }

        if (num1InLngRange && num2InLatRange) {
            return { lat: num2, lng: num1 };
        }

        if (num1 >= -90 && num1 <= 90 && num2 >= -180 && num2 <= 180) {
            return { lat: num1, lng: num2 };
        }

        if (num2 >= -90 && num2 <= 90 && num1 >= -180 && num1 <= 180) {
            return { lat: num2, lng: num1 };
        }

        return null;
    }

    /**
     * Validate coordinates are within global bounds
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @returns {boolean} True if valid
     */
    isValidCoordinate(lat, lng) {
        return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }

    /**
     * Remove the current search marker if it exists
     */
    removeSearchMarker() {
        if (this.searchMarker) {
            this.searchMarker.remove();
            this.searchMarker = null;
        }
    }

    /**
     * Add a search marker at the specified coordinates
     * @param {Array} coordinates - [longitude, latitude]
     * @param {string} title - Title for the marker popup
     */
    addSearchMarker(coordinates, title) {
        // Remove existing marker first
        this.removeSearchMarker();

        // Create a new marker with a popup
        this.searchMarker = new mapboxgl.Marker({
            color: '#ff6b6b', // Red color to distinguish from other markers
            scale: 1.2
        })
            .setLngLat(coordinates)
            .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(`<div><strong>${title}</strong></div>`))
            .addTo(this.map);

    }

    /**
     * Update the search box input value
     * @param {string} value - The value to set in the search box
     */
    updateSearchBoxInput(value) {
        try {
            // Try to find the input element in the search box
            const searchBoxInput = this.searchBox.shadowRoot?.querySelector('input') ||
                this.searchBox.querySelector('input');

            if (searchBoxInput) {
                searchBoxInput.value = value;

                const inputEvent = new Event('input', { bubbles: true });
                searchBoxInput.dispatchEvent(inputEvent);
            }
        } catch (error) {
            console.error('Error updating search box input:', error);
        }
    }

    /**
     * Reset the search state to allow for new searches
     */
    resetSearchState() {
        this.lastInjectedQuery = '';
        this.localSuggestions = [];
        this.currentQuery = '';
        this.isCoordinateInput = false;
        this.coordinateSuggestion = null;

        // Clear suggestion markers
        this.clearSuggestionMarkers();

        // Clear any pending injection timeout
        if (this.injectionTimeout) {
            clearTimeout(this.injectionTimeout);
            this.injectionTimeout = null;
        }

        // Reset search state flags but don't change map location
        this.hasActiveSearch = false;
        this.referenceView = null;

        // Clear any injected suggestions from the DOM
        try {
            const $resultsList = this.searchBox.shadowRoot ?
                $(this.searchBox.shadowRoot.querySelector('[role="listbox"]')) :
                $('[role="listbox"]').first();

            if ($resultsList.length > 0) {
                const removedCount = $resultsList.find('.local-suggestion').length;
                $resultsList.find('.local-suggestion').remove();
                this.updateComboboxAriaExpanded(false); // Update aria-expanded on clear
            }
        } catch (error) {
            console.error('Error clearing injected suggestions:', error);
        }
    }

    /**
     * Set up required ARIA attributes for the combobox input
     */
    setupComboboxAriaAttributes() {
        try {
            // Find the input element in shadow DOM or regular DOM
            const findInput = () => {
                if (this.searchBox.shadowRoot) {
                    return this.searchBox.shadowRoot.querySelector('input[role="combobox"]');
                }
                return this.searchBox.querySelector('input[role="combobox"]');
            };

            // Set attributes after a short delay to ensure the component is fully initialized
            setTimeout(() => {
                const input = findInput();
                if (input) {
                    // Add required ARIA attributes for combobox
                    input.setAttribute('aria-expanded', 'false');
                    input.setAttribute('aria-haspopup', 'listbox');

                    // Get the results list ID if it exists
                    const resultsList = this.searchBox.shadowRoot?.querySelector('[role="listbox"]') ||
                        this.searchBox.querySelector('[role="listbox"]');
                    if (resultsList && resultsList.id) {
                        input.setAttribute('aria-controls', resultsList.id);
                    }
                }
            }, 100);
        } catch (error) {
            console.error('Error setting up combobox ARIA attributes:', error);
        }
    }

    /**
     * Update aria-expanded attribute on the combobox input
     * @param {boolean} expanded - Whether the combobox is expanded
     */
    updateComboboxAriaExpanded(expanded) {
        try {
            const input = this.searchBox.shadowRoot?.querySelector('input[role="combobox"]') ||
                this.searchBox.querySelector('input[role="combobox"]');
            if (input) {
                input.setAttribute('aria-expanded', expanded.toString());
            }
        } catch (error) {
            // Silently fail to avoid console spam
        }
    }

    /**
     * Monitor and update aria-expanded attribute based on suggestions visibility
     */
    setupAriaExpandedMonitoring() {
        // Use MutationObserver to watch for changes in the results list
        const observer = new MutationObserver(() => {
            try {
                const input = this.searchBox.shadowRoot?.querySelector('input[role="combobox"]') ||
                    this.searchBox.querySelector('input[role="combobox"]');
                const resultsList = this.searchBox.shadowRoot?.querySelector('[role="listbox"]') ||
                    this.searchBox.querySelector('[role="listbox"]');

                if (input && resultsList) {
                    // Check if results list is visible and has options
                    const isVisible = resultsList.offsetParent !== null ||
                        resultsList.style.display !== 'none' ||
                        window.getComputedStyle(resultsList).display !== 'none';
                    const hasOptions = resultsList.querySelectorAll('[role="option"]').length > 0;

                    const expanded = isVisible && hasOptions;
                    input.setAttribute('aria-expanded', expanded.toString());
                }
            } catch (error) {
                // Silently fail to avoid console spam
            }
        });

        // Observe changes in the shadow DOM or regular DOM
        try {
            const target = this.searchBox.shadowRoot || this.searchBox;
            observer.observe(target, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'hidden']
            });
        } catch (error) {
            console.error('Error setting up aria-expanded monitoring:', error);
        }

        // Store observer for cleanup
        this.ariaObserver = observer;
    }

    /**
     * Set the search query from URL parameter
     * @param {string} query - The search query to set
     */
    setQueryFromURL(query) {
        if (!query) return;

        try {
            this.updateSearchBoxInput(query);

            setTimeout(() => {
                const inputEvent = new Event('input', { bubbles: true });
                const searchBoxInput = this.searchBox.shadowRoot?.querySelector('input') ||
                    this.searchBox.querySelector('input');

                if (searchBoxInput) {
                    searchBoxInput.dispatchEvent(inputEvent);
                }
            }, 500);
        } catch (error) {
            console.error('Error setting query from URL:', error);
        }
    }

    /**
     * Get the current search query
     * @returns {string} The current search query
     */
    getCurrentQuery() {
        try {
            const searchBoxInput = this.searchBox.shadowRoot?.querySelector('input') ||
                this.searchBox.querySelector('input');

            return searchBoxInput ? (searchBoxInput.value || '') : '';
        } catch (error) {
            console.error('Error getting current query:', error);
            return '';
        }
    }

    /**
     * Handle keydown events to handle Enter key for coordinates
     * @param {Event} event - The keydown event
     */
    handleKeyDown(event) {
        // If we've detected a coordinate input and the user presses Enter
        if (this.isCoordinateInput && event.key === 'Enter' && this.coordinateSuggestion) {

            // Prevent the default behavior
            event.preventDefault();
            event.stopPropagation();

            // Simulate a retrieve event with our coordinate suggestion
            const retrieveEvent = new CustomEvent('retrieve', {
                detail: {
                    features: [this.coordinateSuggestion]
                }
            });

            // Dispatch the event
            this.searchBox.dispatchEvent(retrieveEvent);
        }
    }

    /**
     * Handle explicit clear events
     * @param {Event} event - The clear event
     */
    handleClear(event) {
        this.handleEmptyInput();

        if (window.urlManager) {
            window.urlManager.updateSearchParam('');
        }
    }

    /**
     * Handle map moveend events to refresh search results for current viewport
     */
    handleMapMoveEnd() {
        // Only refresh if we have an active search query that's not a coordinate
        if (this.hasActiveSearch && this.currentQuery && !this.isCoordinateInput && this.currentQuery.length > 0) {

            // Re-query local suggestions with the new viewport
            const newLocalSuggestions = this.queryLocalCadastralSuggestions(this.currentQuery);

            // Only update if suggestions have changed
            if (this.haveSuggestionsChanged(this.localSuggestions, newLocalSuggestions)) {

                this.localSuggestions = newLocalSuggestions;

                // Clear existing markers and UI
                this.clearSuggestionMarkers();

                if (this.localSuggestions.length > 0) {
                    // Create new markers and update UI
                    this.createSuggestionMarkers();
                    this.showSuggestionMarkers();

                    // Re-inject suggestions into UI
                    if (this.injectionTimeout) {
                        clearTimeout(this.injectionTimeout);
                    }

                    this.injectionTimeout = setTimeout(() => {
                        this.injectLocalSuggestionsIntoUI();
                    }, 100);
                } else {
                    // Clear UI if no suggestions in current viewport
                    this.clearInjectedSuggestions();
                }
            }
        }
    }

    /**
     * Check if two suggestion arrays are different
     * @param {Array} oldSuggestions - Previous suggestions
     * @param {Array} newSuggestions - New suggestions
     * @returns {boolean} True if suggestions have changed
     */
    haveSuggestionsChanged(oldSuggestions, newSuggestions) {
        if (oldSuggestions.length !== newSuggestions.length) {
            return true;
        }

        // Compare feature IDs to detect changes
        const oldIds = new Set(oldSuggestions.map(s => s.properties._featureId));
        const newIds = new Set(newSuggestions.map(s => s.properties._featureId));

        if (oldIds.size !== newIds.size) {
            return true;
        }

        for (const id of oldIds) {
            if (!newIds.has(id)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Clear injected suggestions from the UI
     */
    clearInjectedSuggestions() {
        try {
            const $resultsList = this.searchBox.shadowRoot ?
                $(this.searchBox.shadowRoot.querySelector('[role="listbox"]')) :
                $('[role="listbox"]').first();

            if ($resultsList.length > 0) {
                $resultsList.find('.local-suggestion').remove();
                this.updateComboboxAriaExpanded(false);
            }
        } catch (error) {
            console.error('Error clearing injected suggestions:', error);
        }
    }

    /**
     * Set up clear button monitoring
     */
    setupClearButtonMonitoring() {
        // Monitor for clear button clicks in the shadow DOM
        const checkAndAttachClearHandler = () => {
            const clearButton = this.searchBox.shadowRoot?.querySelector('.mbx08a7cde1--ClearBtn, [aria-label="Clear"]');

            if (clearButton && !clearButton._clearHandlerAttached) {
                clearButton.addEventListener('click', () => {
                    setTimeout(() => {
                        if (window.urlManager) {
                            window.urlManager.updateSearchParam('');
                        }
                        this.handleEmptyInput();
                    }, 50);
                });
                clearButton._clearHandlerAttached = true;
            }
        };

        // Try immediately
        setTimeout(checkAndAttachClearHandler, 100);

        // Also watch for DOM changes in case the button is added later
        if (this.searchBox.shadowRoot) {
            const observer = new MutationObserver(checkAndAttachClearHandler);
            observer.observe(this.searchBox.shadowRoot, {
                childList: true,
                subtree: true
            });
            this.clearButtonObserver = observer;
        }
    }

    /**
     * Set up more aggressive input monitoring
     */
    setupInputMonitoring() {
        // Poll the input value periodically to catch changes we might miss
        this.inputMonitorInterval = setInterval(() => {
            this.checkInputValue();
        }, 200);
    }

    /**
     * Check the current input value and handle changes
     */
    checkInputValue() {
        try {
            const searchBoxInput = this.searchBox.shadowRoot?.querySelector('input') ||
                this.searchBox.querySelector('input');

            if (searchBoxInput) {
                const currentValue = searchBoxInput.value || '';

                if (!currentValue && this.currentQuery) {
                    this.handleEmptyInput();
                }
            }
        } catch (error) {
            // Silently fail to avoid console spam
        }
    }

    /**
     * Handle empty input state
     */
    handleEmptyInput() {
        this.resetSearchState();

        this.removeSearchMarker();

        if (this.featureStateManager) {
            this.featureStateManager.clearAllSelections();
        }

        if (window.urlManager) {
            window.urlManager.updateSearchParam('');
        }
    }

    /**
     * Handle input events to detect coordinate patterns and query local suggestions
     * @param {Event} event - The input event
     */
    handleInput(event) {
        // Get the input value from the search box
        let query = '';

        // Try to get the query from the search box input element
        try {
            const searchBoxInput = this.searchBox.shadowRoot?.querySelector('input') ||
                this.searchBox.querySelector('input') ||
                event.target;

            if (searchBoxInput && searchBoxInput.value !== undefined) {
                query = searchBoxInput.value;
            } else {
                return;
            }
        } catch (error) {
            console.error('Error accessing search box input:', error);
            return;
        }

        if (!query) {
            this.handleEmptyInput();
            return;
        }

        if (!this.hasActiveSearch && query.length > 0) {
            this.saveReferenceView();
            this.hasActiveSearch = true;
        }

        this.currentQuery = query;

        const coordinateResult = this.parseCoordinateInput(query);
        if (coordinateResult) {
            this.isCoordinateInput = true;

            const { lat, lng, format } = coordinateResult;

            this.coordinateSuggestion = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [lng, lat]
                },
                properties: {
                    name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                    place_name: `Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)} (${format})`,
                    place_type: ['coordinate'],
                    text: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
                    _isLocalSuggestion: true
                }
            };

            this.localSuggestions = [];

            this.addSearchMarker([lng, lat], this.coordinateSuggestion.properties.place_name);

            if (this.referenceView) {
                const bounds = this.calculateContextBounds([[lng, lat]]);
                if (bounds) {
                    this.map.fitBounds(bounds, {
                        padding: { top: 50, bottom: 50, left: 50, right: 50 },
                        maxZoom: 16,
                        duration: 1000
                    });
                }
            }
        } else {
            this.isCoordinateInput = false;
            this.coordinateSuggestion = null;

            this.removeSearchMarker();

            this.localSuggestions = this.queryLocalCadastralSuggestions(query);

            if (this.localSuggestions.length > 0) {
                this.createSuggestionMarkers();

                if (this.injectionTimeout) {
                    clearTimeout(this.injectionTimeout);
                }

                this.injectionTimeout = setTimeout(() => {
                    this.injectLocalSuggestionsIntoUI();
                    this.showSuggestionMarkers();
                    this.fitToContextWithAllSuggestions();
                }, 300);

                setTimeout(() => {
                    if (this.suggestionMarkers.length > 0) {
                        const visibleCount = this.suggestionMarkers.filter(m => m.visible).length;
                        if (visibleCount === 0) {
                            this.showSuggestionMarkers();
                            this.fitToContextWithAllSuggestions();
                        }
                    }
                }, 100);

            } else {
                this.clearSuggestionMarkers();
            }
        }
    }

    /**
     * Handle suggest events - now mainly for coordinate suggestions
     * @param {Event} event - The suggest event
     */
    handleSuggest(event) {
        if (this.isCoordinateInput && this.coordinateSuggestion) {
            event.preventDefault();
            event.stopPropagation();

            const customSuggestEvent = new CustomEvent('suggest', {
                detail: {
                    suggestions: [this.coordinateSuggestion]
                },
                bubbles: true,
                cancelable: true
            });

            // Dispatch the custom event asynchronously
            setTimeout(() => {
                this.searchBox.dispatchEvent(customSuggestEvent);
            }, 0);

            return false;
        }

        // If we have local suggestions, re-inject them after Mapbox updates
        if (!this.isCoordinateInput && this.localSuggestions.length > 0) {
            // Clear any existing timeout
            if (this.injectionTimeout) {
                clearTimeout(this.injectionTimeout);
            }

            // Reset the injection tracking since Mapbox just updated
            this.lastInjectedQuery = '';

            // Re-inject after a short delay
            this.injectionTimeout = setTimeout(() => {
                this.injectLocalSuggestionsIntoUI();
            }, 100);
        }
    }

    /**
     * Handle retrieve events to fly to the selected location
     * @param {Event} event - The retrieve event
     */
    handleRetrieve(event) {
        if (event.detail && event.detail.features && event.detail.features.length > 0) {
            const feature = event.detail.features[0];
            const coordinates = feature.geometry.coordinates;

            const isLocalSuggestion = feature.properties && feature.properties._isLocalSuggestion;

            if (isLocalSuggestion) {
                this.updateSearchBoxInput(feature.properties.name);

                // Add a marker at the location
                this.addSearchMarker(coordinates, feature.properties.name);

                // For cadastral plots, zoom in closer to see the plot boundaries
                this.map.flyTo({
                    center: coordinates,
                    zoom: 18, // Zoom in closer for cadastral plots
                    essential: true,
                    duration: 2000
                });

                if (this.featureStateManager && feature.properties._featureId) {
                    this.featureStateManager.clearAllSelections();

                    this.featureStateManager.selectedFeatureId = feature.properties._featureId;
                    this.featureStateManager.selectedSourceId = 'vector-goa-plots';
                    this.featureStateManager.selectedSourceLayer = 'Onemapgoa_GA_Cadastrals';

                    try {
                        this.map.setFeatureState(
                            {
                                source: 'vector-goa-plots',
                                sourceLayer: 'Onemapgoa_GA_Cadastrals',
                                id: feature.properties._featureId
                            },
                            { selected: true }
                        );
                    } catch (error) {
                        console.error('Error setting feature state:', error);
                    }
                }

                // Clear the injection state to allow future searches
                this.resetSearchState();

                // Optionally highlight the plot (if you want to add visual feedback)
                this.highlightCadastralPlot(feature.properties._originalProperties);
            } else {
                // Regular search result or coordinate
                this.addSearchMarker(coordinates, feature.properties.name || feature.properties.place_name || 'Search Result');

                this.map.flyTo({
                    center: coordinates,
                    zoom: 16,
                    essential: true
                });
            }
        }
    }

    /**
     * Highlight a cadastral plot on the map (optional visual feedback)
     * @param {Object} plotProperties - The original plot properties
     */
    highlightCadastralPlot(plotProperties) {
        try {
        } catch (error) {
            console.error('Error highlighting cadastral plot:', error);
        }
    }

    /**
     * Query local cadastral layer for plot suggestions
     * @param {string} query - The search query
     * @returns {Array} Array of matching plot suggestions
     */
    queryLocalCadastralSuggestions(query) {
        if (!query || query.length < 1) {
            return [];
        }

        try {
            const bounds = this.map.getBounds();

            const features = this.map.querySourceFeatures('vector-goa-plots', {
                sourceLayer: 'Onemapgoa_GA_Cadastrals',
                filter: ['has', 'plot']
            });

            const featuresInBounds = features.filter(feature => {
                const center = this.getFeatureCenter(feature);
                if (!center || center.length < 2) return false;

                const [lng, lat] = center;
                return bounds.contains([lng, lat]);
            });

            const matchingFeatures = featuresInBounds.filter(feature => {
                const plotValue = feature.properties.plot;
                if (!plotValue) return false;

                const plotString = String(plotValue).toLowerCase();
                const queryLower = query.toLowerCase();

                const isMatch = plotString.startsWith(queryLower);

                return isMatch;
            });

            const uniqueFeatures = [];
            const seenLocations = new Set();

            for (const feature of matchingFeatures) {
                const plotValue = feature.properties.plot;
                const lname = feature.properties.lname || '';
                const villagenam = feature.properties.villagenam || '';

                const locationKey = `${plotValue}|${villagenam}|${lname}`;

                if (!seenLocations.has(locationKey)) {
                    seenLocations.add(locationKey);
                    uniqueFeatures.push(feature);

                    if (uniqueFeatures.length >= 5) break;
                }
            }

            // Convert to suggestion format and limit results
            const suggestions = uniqueFeatures
                .map(feature => {
                    const plotValue = feature.properties.plot;
                    const lname = feature.properties.lname || ''; // Place name
                    const villagenam = feature.properties.villagenam || ''; // Village/locality name
                    const center = this.getFeatureCenter(feature);
                    const featureId = feature.properties.id || feature.id; // Get the feature ID

                    // Build a descriptive location string
                    let locationParts = [];
                    if (villagenam) locationParts.push(villagenam);
                    if (lname && lname !== villagenam) locationParts.push(lname);
                    locationParts.push('Goa'); // Always add Goa

                    const locationString = locationParts.join(', ');
                    const fullDescription = locationParts.length > 1 ?
                        `Plot ${plotValue}, ${locationString}` :
                        `Plot ${plotValue}, Cadastral Survey, Goa`;

                    return {
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: center
                        },
                        properties: {
                            name: `Plot ${plotValue}`,
                            place_name: fullDescription,
                            place_type: ['cadastral', 'plot'],
                            text: `Plot ${plotValue}`,
                            full_address: fullDescription,
                            context: [
                                {
                                    id: 'cadastral',
                                    text: 'Cadastral Survey'
                                },
                                ...(villagenam ? [{
                                    id: 'locality',
                                    text: villagenam
                                }] : []),
                                ...(lname && lname !== villagenam ? [{
                                    id: 'place',
                                    text: lname
                                }] : []),
                                {
                                    id: 'region',
                                    text: 'Goa'
                                }
                            ],
                            // Store location info for display
                            _locationString: locationString,
                            // Store original feature properties for potential use
                            _originalProperties: feature.properties,
                            // Store the feature ID for selection state management
                            _featureId: featureId,
                            // Mark as local suggestion
                            _isLocalSuggestion: true
                        }
                    };
                });

            return suggestions;
        } catch (error) {
            console.error('Error querying local cadastral suggestions:', error);
            return [];
        }
    }

    /**
     * Get the center point of a feature
     * @param {Object} feature - GeoJSON feature
     * @returns {Array} [longitude, latitude]
     */
    getFeatureCenter(feature) {
        if (!feature.geometry) return [0, 0];

        switch (feature.geometry.type) {
            case 'Point':
                return feature.geometry.coordinates;

            case 'Polygon':
            case 'MultiPolygon':
                // Calculate centroid of polygon
                return this.calculatePolygonCentroid(feature.geometry);

            case 'LineString':
            case 'MultiLineString':
                // Get midpoint of line
                return this.calculateLineMidpoint(feature.geometry);

            default:
                return [0, 0];
        }
    }

    /**
     * Calculate the centroid of a polygon
     * @param {Object} geometry - Polygon or MultiPolygon geometry
     * @returns {Array} [longitude, latitude]
     */
    calculatePolygonCentroid(geometry) {
        let coordinates;

        if (geometry.type === 'Polygon') {
            coordinates = geometry.coordinates[0]; // Use exterior ring
        } else if (geometry.type === 'MultiPolygon') {
            coordinates = geometry.coordinates[0][0]; // Use first polygon's exterior ring
        } else {
            return [0, 0];
        }

        // Calculate centroid using simple average of coordinates
        let x = 0, y = 0, count = 0;

        for (const coord of coordinates) {
            if (Array.isArray(coord) && coord.length >= 2) {
                x += coord[0];
                y += coord[1];
                count++;
            }
        }

        return count > 0 ? [x / count, y / count] : [0, 0];
    }

    /**
     * Calculate the midpoint of a line
     * @param {Object} geometry - LineString or MultiLineString geometry
     * @returns {Array} [longitude, latitude]
     */
    calculateLineMidpoint(geometry) {
        let coordinates;

        if (geometry.type === 'LineString') {
            coordinates = geometry.coordinates;
        } else if (geometry.type === 'MultiLineString') {
            coordinates = geometry.coordinates[0]; // Use first line
        } else {
            return [0, 0];
        }

        if (coordinates.length === 0) return [0, 0];

        // Return midpoint
        const midIndex = Math.floor(coordinates.length / 2);
        return coordinates[midIndex];
    }

    /**
     * Clean up the search control
     */
    cleanup() {
        this.removeSearchMarker();

        this.clearSuggestionMarkers();

        if (this.injectionTimeout) {
            clearTimeout(this.injectionTimeout);
            this.injectionTimeout = null;
        }

        if (this.inputMonitorInterval) {
            clearInterval(this.inputMonitorInterval);
            this.inputMonitorInterval = null;
        }

        this.hasActiveSearch = false;
        this.referenceView = null;

        if (this.searchBox) {
            this.searchBox.removeEventListener('suggest', this.handleSuggest.bind(this));
            this.searchBox.removeEventListener('retrieve', this.handleRetrieve.bind(this));
            this.searchBox.removeEventListener('input', this.handleInput.bind(this));
            this.searchBox.removeEventListener('keydown', this.handleKeyDown.bind(this));
            this.searchBox.removeEventListener('clear', this.handleClear.bind(this));
        }

        this.map.off('moveend', this.handleMapMoveEnd.bind(this));

        if (this.ariaObserver) {
            this.ariaObserver.disconnect();
            this.ariaObserver = null;
        }

        if (this.clearButtonObserver) {
            this.clearButtonObserver.disconnect();
            this.clearButtonObserver = null;
        }
    }

    /**
     * Inject local suggestions directly into the search results UI using jQuery
     */
    injectLocalSuggestionsIntoUI() {
        try {
            if (this.lastInjectedQuery === this.currentQuery) {
                return;
            }

            // Find the results list in the shadow DOM or regular DOM
            let $resultsList = null;
            let $resultsContainer = null;

            const findResultsContainer = () => {
                if (this.searchBox.shadowRoot) {
                    const shadowResults = this.searchBox.shadowRoot.querySelector('[role="listbox"]');
                    if (shadowResults) {
                        $resultsList = $(shadowResults);
                        $resultsContainer = $resultsList.parent();
                        return true;
                    }
                }

                $resultsList = $('[role="listbox"]').first();
                if ($resultsList.length > 0) {
                    $resultsContainer = $resultsList.parent();
                    return true;
                }

                const searchResultsContainers = $('.mapboxgl-ctrl-geocoder, [class*="search"], [class*="suggest"], [class*="result"]');
                for (let i = 0; i < searchResultsContainers.length; i++) {
                    const $container = $(searchResultsContainers[i]);
                    const listbox = $container.find('[role="listbox"]');
                    if (listbox.length > 0) {
                        $resultsList = listbox.first();
                        $resultsContainer = $container;
                        return true;
                    }
                }

                // Method 4: Create a results container if none exists
                if (this.searchBox.shadowRoot) {
                    const shadowRoot = this.searchBox.shadowRoot;
                    let listbox = shadowRoot.querySelector('[role="listbox"]');
                    if (!listbox) {
                        // Create a new listbox
                        listbox = document.createElement('div');
                        listbox.setAttribute('role', 'listbox');
                        listbox.style.cssText = `
                            position: absolute;
                            top: 100%;
                            left: 0;
                            right: 0;
                            background: white;
                            border: 1px solid #ccc;
                            border-radius: 4px;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                            max-height: 200px;
                            overflow-y: auto;
                            z-index: 1000;
                        `;

                        // Find the input container and append the listbox
                        const inputContainer = shadowRoot.querySelector('div') || shadowRoot;
                        inputContainer.appendChild(listbox);
                    }

                    $resultsList = $(listbox);
                    $resultsContainer = $resultsList.parent();
                    return true;
                }

                return false;
            };

            if (!findResultsContainer()) {
                return;
            }

            // Remove any previously injected local suggestions
            $resultsList.find('.local-suggestion').remove();

            const existingSuggestions = $resultsList.find('[role="option"]');
            const existingCount = existingSuggestions.length;

            if (existingCount > 5) {
                existingSuggestions.slice(5).remove();
            }

            const remainingMapboxSuggestions = $resultsList.find('[role="option"]').length;
            const localSuggestionsToAdd = Math.min(5, this.localSuggestions.length);
            const totalCount = remainingMapboxSuggestions + localSuggestionsToAdd;

            // Make sure the results container is visible
            if ($resultsContainer) {
                $resultsContainer.show();
            }
            $resultsList.show();

            // Create HTML for each local suggestion
            this.localSuggestions.slice(0, localSuggestionsToAdd).forEach((suggestion, index) => {
                const suggestionIndex = index; // Local suggestions will be at positions 0, 1, 2, etc.
                const plotName = suggestion.properties.name;
                const plotDesc = suggestion.properties.place_name;

                // Create the suggestion HTML with robust styling
                const suggestionHtml = `
                    <div class="mbx09bc48e7--Suggestion local-suggestion" 
                         role="option" 
                         tabindex="-1" 
                         id="mbx09bc48e7-ResultsList-${suggestionIndex}" 
                         aria-posinset="${suggestionIndex + 1}" 
                         aria-setsize="${totalCount}"
                         data-suggestion-index="${suggestionIndex}"
                         data-local-index="${index}"
                         data-local-suggestion="true"
                         style="
                             display: flex !important;
                             align-items: center;
                             padding: 8px 12px;
                             cursor: pointer;
                             background: white;
                             border-bottom: 1px solid #eee;
                             min-height: 40px;
                             font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                         ">
                        <div class="mbx09bc48e7--SuggestionIcon" aria-hidden="true" style="margin-right: 8px; font-size: 16px;">📍</div>
                        <div class="mbx09bc48e7--SuggestionText" style="flex: 1; overflow: hidden;">
                            <div class="mbx09bc48e7--SuggestionName" style="font-weight: 500; color: #333; font-size: 14px; line-height: 1.2;">${plotName}</div>
                            <div class="mbx09bc48e7--SuggestionDesc" style="color: #666; font-size: 12px; line-height: 1.2; margin-top: 2px;">${plotDesc}</div>
                        </div>
                    </div>
                `;

                // Insert at the beginning (before Mapbox suggestions)
                $resultsList.prepend(suggestionHtml);
            });

            // Update aria-setsize for all suggestions
            $resultsList.find('[role="option"]').each((index, element) => {
                $(element).attr('aria-posinset', index + 1);
                $(element).attr('aria-setsize', totalCount);
            });

            // Add click and hover handlers for local suggestions
            $resultsList.find('.local-suggestion')
                .on('click', (event) => {
                    const localIndex = parseInt($(event.currentTarget).data('local-index'));

                    if (localIndex >= 0 && localIndex < this.localSuggestions.length) {
                        const selectedSuggestion = this.localSuggestions[localIndex];

                        this.clearSuggestionMarkers();

                        // Clear the results list immediately to prevent UI issues
                        $resultsList.empty();
                        $resultsList.parent().hide();

                        // Create a retrieve event
                        const retrieveEvent = new CustomEvent('retrieve', {
                            detail: {
                                features: [selectedSuggestion]
                            }
                        });

                        // Dispatch the retrieve event
                        this.searchBox.dispatchEvent(retrieveEvent);
                    }
                })
                .on('mouseenter', (event) => {
                    const localIndex = parseInt($(event.currentTarget).data('local-index'));

                    // Change suggestion item background
                    $(event.currentTarget).css('background-color', '#f0f0f0');

                    // Handle marker hover effect
                    this.handleSuggestionHover(localIndex, true);
                })
                .on('mouseleave', (event) => {
                    const localIndex = parseInt($(event.currentTarget).data('local-index'));

                    // Reset suggestion item background
                    $(event.currentTarget).css('background-color', 'white');

                    // Handle marker hover effect
                    this.handleSuggestionHover(localIndex, false);
                });

            this.updateComboboxAriaExpanded(true);

            // Mark this query as injected
            this.lastInjectedQuery = this.currentQuery;

        } catch (error) {
            console.error('Error injecting local suggestions into UI:', error);
        }
    }

    /**
     * Create suggestion markers for all local suggestions
     */
    createSuggestionMarkers() {
        this.clearSuggestionMarkers();

        this.localSuggestions.forEach((suggestion, index) => {
            try {
                const coordinates = suggestion.geometry.coordinates;
                const title = suggestion.properties.name;

                // Create marker with blue color and smaller scale
                const marker = new mapboxgl.Marker({
                    color: '#3b82f6', // Blue color for suggestion markers
                    scale: 0.8 // Smaller than search result markers
                })
                    .setLngLat(coordinates)
                    .setPopup(new mapboxgl.Popup({
                        offset: 25,
                        closeButton: false,
                        closeOnClick: false
                    }).setHTML(`<div><strong>${title}</strong><br/><small>${suggestion.properties._locationString}</small></div>`));

                // Store the marker with metadata
                this.suggestionMarkers.push({
                    marker: marker,
                    index: index,
                    suggestion: suggestion,
                    coordinates: coordinates,
                    title: title,
                    visible: false
                });

            } catch (error) {
                console.error(`Error creating suggestion marker ${index}:`, error);
            }
        });
    }

    /**
     * Show all suggestion markers on the map
     */
    showSuggestionMarkers() {
        this.suggestionMarkers.forEach((markerData, index) => {
            try {
                if (!markerData.visible) {
                    markerData.marker.addTo(this.map);
                    markerData.visible = true;

                    const markerElement = markerData.marker.getElement();
                    if (markerElement) {
                        markerElement.style.opacity = '0.7';
                        markerElement.style.transition = 'opacity 0.2s ease-in-out';
                    }
                }
            } catch (error) {
                console.error(`Error showing suggestion marker ${index}:`, error);
            }
        });
    }

    /**
     * Clear all suggestion markers completely
     */
    clearSuggestionMarkers() {
        this.suggestionMarkers.forEach((markerData, index) => {
            try {
                if (markerData.marker) {
                    markerData.marker.remove();
                }
            } catch (error) {
                console.error(`Error clearing suggestion marker ${index}:`, error);
            }
        });

        this.suggestionMarkers = [];
        this.hoveredMarkerIndex = -1;
    }

    /**
     * Handle hover effects on suggestion markers
     * @param {number} suggestionIndex - Index of the suggestion being hovered
     * @param {boolean} isHovering - Whether currently hovering (true) or leaving (false)
     */
    handleSuggestionHover(suggestionIndex, isHovering) {
        try {
            if (this.hoveredMarkerIndex !== -1 && this.hoveredMarkerIndex !== suggestionIndex) {
                const prevMarkerData = this.suggestionMarkers[this.hoveredMarkerIndex];
                if (prevMarkerData && prevMarkerData.marker) {
                    const prevMarkerElement = prevMarkerData.marker.getElement();
                    if (prevMarkerElement) {
                        prevMarkerElement.style.opacity = '0.7';
                        prevMarkerElement.style.transition = 'opacity 0.2s ease-in-out';
                    }
                }
            }

            if (suggestionIndex >= 0 && suggestionIndex < this.suggestionMarkers.length) {
                const markerData = this.suggestionMarkers[suggestionIndex];
                if (markerData && markerData.marker && markerData.visible) {
                    const markerElement = markerData.marker.getElement();
                    if (markerElement) {
                        if (isHovering) {
                            markerElement.style.opacity = '1.0';
                            markerElement.style.transition = 'opacity 0.2s ease-in-out';
                            this.hoveredMarkerIndex = suggestionIndex;

                            if (markerData.marker.getPopup()) {
                                markerData.marker.togglePopup();
                            }

                            this.fitToContextWithHoveredSuggestion(suggestionIndex);

                        } else {
                            markerElement.style.opacity = '0.7';
                            markerElement.style.transition = 'opacity 0.2s ease-in-out';

                            if (markerData.marker.getPopup() && markerData.marker.getPopup().isOpen()) {
                                markerData.marker.togglePopup();
                            }

                            this.fitToContextWithAllSuggestions();
                        }
                    }
                }
            }

            // Update hover index
            if (!isHovering && this.hoveredMarkerIndex === suggestionIndex) {
                this.hoveredMarkerIndex = -1;
            }

        } catch (error) {
            console.error('Error handling suggestion hover:', error);
        }
    }

    /**
     * Save the current map view as reference for search context
     */
    saveReferenceView() {
        try {
            this.referenceView = {
                center: this.map.getCenter().toArray(),
                zoom: this.map.getZoom(),
                bearing: this.map.getBearing(),
                pitch: this.map.getPitch(),
                bounds: this.map.getBounds()
            };
        } catch (error) {
            console.error('Error saving reference view:', error);
        }
    }

    /**
     * Calculate bounds that include the reference view and given coordinates
     * @param {Array<Array<number>>} coordinates - Array of [lng, lat] coordinates to include
     * @returns {mapboxgl.LngLatBounds|null} The calculated bounds or null if error
     */
    calculateContextBounds(coordinates) {
        try {
            if (!this.referenceView || !coordinates || coordinates.length === 0) {
                return null;
            }

            const bounds = new mapboxgl.LngLatBounds();
            bounds.extend(this.referenceView.center);

            coordinates.forEach(coord => {
                if (Array.isArray(coord) && coord.length >= 2) {
                    bounds.extend(coord);
                }
            });

            return bounds;
        } catch (error) {
            console.error('Error calculating context bounds:', error);
            return null;
        }
    }

    /**
     * Fit map to show reference view and all current suggestions
     */
    fitToContextWithAllSuggestions() {
        try {
            if (!this.referenceView || this.localSuggestions.length === 0) {
                return;
            }

            const suggestionCoordinates = this.localSuggestions.map(s => s.geometry.coordinates);

            const bounds = this.calculateContextBounds(suggestionCoordinates);

            if (bounds) {
                this.map.fitBounds(bounds, {
                    padding: {
                        top: 50,
                        bottom: 50,
                        left: 50,
                        right: 50
                    },
                    maxZoom: 16,
                    duration: 1000
                });
            }
        } catch (error) {
            console.error('Error fitting to context with all suggestions:', error);
        }
    }

    /**
     * Fit map to show reference view and a specific hovered suggestion
     * @param {number} suggestionIndex - Index of the suggestion to focus on
     */
    fitToContextWithHoveredSuggestion(suggestionIndex) {
        try {
            if (!this.referenceView ||
                suggestionIndex < 0 ||
                suggestionIndex >= this.localSuggestions.length) {
                return;
            }

            const hoveredSuggestion = this.localSuggestions[suggestionIndex];
            const hoveredCoordinates = [hoveredSuggestion.geometry.coordinates];

            const bounds = this.calculateContextBounds(hoveredCoordinates);

            if (bounds) {
                this.map.fitBounds(bounds, {
                    padding: {
                        top: 50,
                        bottom: 50,
                        left: 50,
                        right: 50
                    },
                    maxZoom: 16,
                    duration: 500
                });
            }
        } catch (error) {
            console.error('Error fitting to context with hovered suggestion:', error);
        }
    }
}
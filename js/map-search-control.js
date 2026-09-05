import { reverseGeocodeNominatim } from './nominatim-search.js'
import { trackEvent } from './analytics.js'
import { parseCoordinateInput } from './search/coordinate-parser.js'
import { parseDirectionsQuery } from './search/directions-query.js'
import { createNominatimProvider } from './search/providers/nominatim-provider.js'
import { createCadastralProvider } from './search/providers/cadastral-provider.js'
import { createAtlasLayerProvider } from './search/providers/atlas-layer-provider.js'
import { createFeatureInViewProvider } from './search/providers/feature-in-view-provider.js'
import { createMarkerProvider } from './search/providers/marker-provider.js'
import { createCountryProvider } from './search/providers/country-provider.js'
import { createDirectionsProvider } from './search/providers/directions-provider.js'
import { fetchRoute } from './search/directions-router.js'
import { DirectionsLayer } from './search/directions-layer.js'
import { SearchSuggestionsPanel } from './search/search-suggestions-panel.js'

/**
 * MapSearchControl - Mapbox search with coordinate search and Goa cadastral
 * plot search (village + survey) via statewide parquet, not viewport vector tiles.
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
            language: 'en',
            ...options
        };

        this.isCoordinateInput = false;
        this.coordinateSuggestion = null;
        this.localSuggestions = []; // place/parcel/current-location features - marker-eligible
        this.mapSuggestions = []; // atlas/layer matches - never marker-eligible
        this.mapFeatureSuggestions = []; // rendered features currently in view
        this.markerSuggestions = []; // user-added markers/notes
        this.countrySuggestions = []; // bundled country-name matches
        this.directionsSuggestions = []; // "X to Y" route matches
        this.currentQuery = '';
        this.injectionTimeout = null;

        // Add marker for search results
        this.searchMarker = null;

        // Suggestion markers management
        this.suggestionMarkers = []; // Array to track markers for each local suggestion
        this.hoveredMarkerIndex = -1; // Track which marker is currently being hovered

        this.cadastralProvider = createCadastralProvider();
        this.nominatimProvider = createNominatimProvider();
        this.atlasLayerProvider = createAtlasLayerProvider();
        this.featureInViewProvider = createFeatureInViewProvider();
        this.markerProvider = createMarkerProvider();
        this.countryProvider = createCountryProvider();
        this.directionsProvider = createDirectionsProvider();
        this.directionsLayer = new DirectionsLayer(this.map);
        this._fetchingCurrentLocation = false;

        // Feature state manager reference (will be set externally)
        this.featureStateManager = null;

        // Map view context management
        this.referenceView = null; // Saved reference view when search starts
        this.hasActiveSearch = false; // Track if we're in an active search state

        this.searchBox = document.querySelector('mapbox-search-box');

        // The single, shared suggestions dropdown - see search-suggestions-panel.js
        // for why owning this DOM node in one place matters.
        this.suggestionsPanel = new SearchSuggestionsPanel(this.searchBox, {
            onSelect: (item) => this._selectSuggestion(item),
            onHover: (item, index, isHovering) => this.handleSuggestionHover(item, isHovering)
        });

        // Set up mapbox integration
        this.searchBox.mapboxgl = mapboxgl;
        this.searchBox.marker = false; // Disable default marker, we'll handle it ourselves
        this.searchBox.setAttribute('access-token', this.options.accessToken);
        this.searchBox.setAttribute('proximity', this._getMapProximity());
        this.searchBox.setAttribute('types', this._getSearchTypes());
        this.searchBox.setAttribute('language', this.options.language);
        this.searchBox.setAttribute('placeholder', 'Search place name or location..');
        this.searchBox.addEventListener('suggest', this.handleSuggest.bind(this));
        this.searchBox.addEventListener('retrieve', this.handleRetrieve.bind(this));
        this.searchBox.addEventListener('input', this.handleInput.bind(this));
        this.searchBox.addEventListener('keydown', this.handleKeyDown.bind(this));
        this.searchBox.addEventListener('clear', this.handleClear.bind(this));

        // 'focusin'/'focusout' are composed events, so listening on the host
        // element still catches focus moving in/out of the input inside its
        // shadow root.
        this._boundHandleSearchBoxFocus = this.handleSearchBoxFocus.bind(this);
        this._boundHandleSearchBoxBlur = this.handleSearchBoxBlur.bind(this);
        this.searchBox.addEventListener('focusin', this._boundHandleSearchBoxFocus);
        this.searchBox.addEventListener('focusout', this._boundHandleSearchBoxBlur);

        // The fetch() patch in index.html (installed before the search-js CDN script loads,
        // since that library caches globalThis.fetch at load time) consults this to decide
        // whether to bypass the suggest endpoint's network request for the current input.
        // Also bypassed for a directions-shaped query ("X to Y"): otherwise Mapbox's own
        // native place suggest keeps running in the background regardless of what we show,
        // and can independently resolve and fire its own 'retrieve' well after the user
        // picked our Directions result - flying the camera to an unrelated place and
        // undoing the route view (confirmed live: it fired seconds after a route was
        // already drawn and fitted).
        window.amche.shouldBypassSearchSuggest = () =>
            this.isCoordinateInput || !!parseDirectionsQuery(this.currentQuery);
        this.searchBox.bindMap(this.map);

        // Add required ARIA attributes for the combobox input
        this.setupComboboxAriaAttributes();

        // Monitor input changes more aggressively
        this.setupInputMonitoring();

        // Set up clear button monitoring
        this.setupClearButtonMonitoring();

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
     * Remove the current search marker if it exists
     */
    removeSearchMarker() {
        if (this.searchMarker) {
            const marker = this.searchMarker;
            this.searchMarker = null;
            marker.remove();
        }
    }

    /**
     * Add a search marker at the specified coordinates
     * @param {Array} coordinates - [longitude, latitude]
     * @param {string} title - Title for the marker popup
     */
    _escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    addSearchMarker(coordinates, title) {
        this.removeSearchMarker();

        const popup = new mapboxgl.Popup({
            className: 'search-result-popup',
            anchor: 'bottom',
            offset: 28,
            closeButton: true,
            maxWidth: '320px',
        }).setHTML(`<p class="search-result-popup__title">${this._escapeHtml(title)}</p>`);
        popup.on('close', () => this.removeSearchMarker());

        this.searchMarker = new mapboxgl.Marker({
            color: '#ff6b6b',
            scale: 1.2
        })
            .setLngLat(coordinates)
            .setPopup(popup)
            .addTo(this.map);
    }

    /**
     * A chosen search result becomes a real marker (map-marker-manager.js),
     * not the transient red preview pin: it carries the full inspector balloon
     * and a shareable `markers=` id derived from the result's own label, and
     * survives the next search instead of being replaced by it.
     *
     * The preview pin (addSearchMarker) stays for what it is actually for -
     * previewing a coordinate as it is typed, before anything is chosen.
     */
    _addResultMarker(coordinates, label) {
        this.removeSearchMarker();

        const markerManager = window.featureControl?._markerManager;
        if (!markerManager) {
            this.addSearchMarker(coordinates, label);
            return null;
        }

        const lngLat = { lng: coordinates[0], lat: coordinates[1] };

        // Choosing the same result again (or one on top of an existing marker)
        // should surface that marker rather than stack a duplicate on it.
        const existing = markerManager.findMarkerNear(lngLat);
        if (existing) {
            markerManager.focusMarker(existing);
            return existing;
        }

        return markerManager.addMarker(lngLat, [], { urlId: label });
    }

    /**
     * Update the search box input value
     * @param {string} value - The value to set in the search box
     */
    updateSearchBoxInput(value, { silent = false } = {}) {
        try {
            const searchBoxInput = this.searchBox.shadowRoot?.querySelector('input') ||
                this.searchBox.querySelector('input');

            if (searchBoxInput) {
                searchBoxInput.value = value;

                if (!silent) {
                    const inputEvent = new Event('input', { bubbles: true });
                    searchBoxInput.dispatchEvent(inputEvent);
                }
            }
        } catch (error) {
            console.error('Error updating search box input:', error);
        }
    }

    suppressSuggestions() {
        this.suggestionsPanel.clear();

        const input = this.searchBox.querySelector('input')
        if (!input) return
        const resultsId = input.getAttribute('aria-controls')
        const resultsEl = resultsId
            ? document.getElementById(resultsId)
            : this.searchBox.querySelector('[class*="Results"]')
        if (resultsEl) resultsEl.setAttribute('aria-hidden', 'true')
        input.setAttribute('aria-expanded', 'false')
        input.blur()
    }

    /**
     * Reset the search state to allow for new searches
     */
    resetSearchState() {
        this.localSuggestions = [];
        this.mapSuggestions = [];
        this.mapFeatureSuggestions = [];
        this.markerSuggestions = [];
        this.countrySuggestions = [];
        this.directionsSuggestions = [];
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
            this.suggestionsPanel.clear();
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
        // Arrow/Enter/Escape navigation of our own suggestions panel, when visible.
        if (this.suggestionsPanel.handleKeydown(event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

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
     * Get current map center as a proximity string for Mapbox search
     * @returns {string} "lng,lat"
     */
    _getMapProximity() {
        const center = this.map.getCenter();
        return `${center.lng},${center.lat}`;
    }

    /**
     * Get search types based on current zoom level
     * @returns {string} Comma-separated Mapbox search types
     */
    _getSearchTypes() {
        const base = 'place,locality,postcode,region,district';
        return this.map.getZoom() >= 11
            ? `${base},street,address,poi`
            : base;
    }

    handleMapMoveEnd() {
        if (!this.hasActiveSearch || !this.currentQuery || this.isCoordinateInput) return;
        this.searchBox.setAttribute('proximity', this._getMapProximity());
        this.searchBox.setAttribute('types', this._getSearchTypes());
    }

    /**
     * Clear injected suggestions from the UI
     */
    clearInjectedSuggestions() {
        try {
            this.suggestionsPanel.clear();
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
        this.directionsProvider.cancel();
        this.directionsLayer.clear();

        if (this.featureStateManager) {
            this.featureStateManager.clearAllSelections();
        }

        if (window.urlManager) {
            window.urlManager.updateSearchParam('');
        }
    }

    /**
     * When the (empty) search box gains focus, offer the current map center's
     * reverse-geocoded address as a one-click default suggestion.
     */
    handleSearchBoxFocus() {
        if (this.currentQuery || this.isCoordinateInput) return;
        // The cadastral village/survey picker (js/cadastral-search-ui.js) owns
        // the dropdown when it's active - don't also show our own suggestion
        // underneath/behind it.
        if (window.cadastralSearchUI?.isActive()) return;

        // Show "what's on the map right now" immediately (synchronous, no
        // network) - the current-location suggestion joins it once its
        // reverse-geocode call resolves.
        this.mapSuggestions = this.atlasLayerProvider.getActiveLayers();
        this._renderSuggestions();
        this.showCurrentLocationSuggestion();
    }

    /**
     * On blur, drop the focus-triggered suggestions (current-location default
     * and/or currently-active-layers) if the user never typed a query (a short
     * delay so a click on a suggestion itself, which blurs the input first,
     * still gets to run its own handler).
     */
    handleSearchBoxBlur() {
        setTimeout(() => {
            if (this.currentQuery) return;

            this.clearInjectedSuggestions();
            this.clearSuggestionMarkers();
            this.localSuggestions = [];
            this.mapSuggestions = [];
            this.mapFeatureSuggestions = [];
            this.markerSuggestions = [];
            this.countrySuggestions = [];
            this.directionsSuggestions = [];
        }, 200);
    }

    /**
     * Reverse-geocode the current map center (single request per focus, not
     * tied to typing — see startNominatimSearch for why that distinction
     * matters for Nominatim's usage policy) and show it as a selectable
     * "Current location" suggestion.
     */
    async showCurrentLocationSuggestion() {
        if (this._fetchingCurrentLocation) return;
        this._fetchingCurrentLocation = true;

        try {
            const center = this.map.getCenter();
            const feature = await reverseGeocodeNominatim(center.lat, center.lng, this.map.getZoom());

            // Bail if the user started typing or moved on while this was in flight.
            if (!feature || this.currentQuery || this.isCoordinateInput) return;

            feature.properties.name = `Current location: ${feature.properties.name}`;
            feature.properties._isCurrentLocation = true;

            this.localSuggestions = [feature];
            this._renderSuggestions();
        } catch (error) {
            // Best-effort only; a failed/backed-off reverse geocode just means no default entry.
        } finally {
            this._fetchingCurrentLocation = false;
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

        // Drop any suggestion already showing (e.g. the focus-triggered "current
        // location" entry) — the branches below only redraw the panel once their
        // own (async) results are ready.
        this.clearInjectedSuggestions();

        if (window.urlManager) {
            window.urlManager.updateSearchParam(query);
        }

        const coordinateResult = parseCoordinateInput(query);
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
            this.mapSuggestions = [];
            this.mapFeatureSuggestions = [];
            this.markerSuggestions = [];
            this.countrySuggestions = [];
            this.directionsSuggestions = [];
            this.directionsProvider.cancel();
            this.directionsLayer.clear();

            this.addSearchMarker([lng, lat], this.coordinateSuggestion.properties.place_name);

            this.map.flyTo({
                center: [lng, lat],
                zoom: Math.max(this.map.getZoom(), 14),
                essential: true,
                duration: 1000
            });
        } else {
            this.isCoordinateInput = false;
            this.coordinateSuggestion = null;

            this.removeSearchMarker();
            this.directionsLayer.clear();

            // Atlas/layer matches, on-screen feature matches, and marker
            // matches are all synchronous (in-memory) and apply regardless of
            // which async place-search path runs below.
            this.mapSuggestions = this.atlasLayerProvider.search(query);
            this.mapFeatureSuggestions = this.featureInViewProvider.search(query);
            this.markerSuggestions = this.markerProvider.search(query);
            this.countrySuggestions = this.countryProvider.search(query);

            this.directionsSuggestions = [];
            this.directionsProvider.search(query, {
                map: this.map,
                onResult: (items) => {
                    this.directionsSuggestions = items;
                    this._renderSuggestions();
                }
            });

            const cadastralParsed = this.cadastralProvider.isEnabled() && !window.cadastralSearchUI?.isActive()
                ? this.cadastralProvider.parseQuery(query)
                : null;
            if (cadastralParsed) {
                this.startCadastralParquetSearch(query, cadastralParsed);
            } else {
                this.cadastralProvider.cancel();
                this.startNominatimSearch(query);
            }
        }
    }

    startCadastralParquetSearch(query, parsed) {
        this.nominatimProvider.cancel();

        this.localSuggestions = [];
        this.clearSuggestionMarkers();
        this._renderSuggestions(); // show any Maps matches immediately

        this.cadastralProvider.search(query, parsed, (features) => {
            this.localSuggestions = features;
            if (!features.length) return;

            this.createSuggestionMarkers();
            clearTimeout(this.injectionTimeout);
            this.scheduleSuggestionInjection();
        });
    }

    /**
     * Query Nominatim for general place search, debounced and rate-capped to
     * respect its usage policy (max ~1 request/second, no raw autocomplete spam)
     * - see search/providers/nominatim-provider.js.
     */
    startNominatimSearch(query) {
        this.localSuggestions = [];
        this.clearSuggestionMarkers();
        this._renderSuggestions(); // show any Maps matches immediately, drop stale places

        this.nominatimProvider.search(query, {
            bounds: this.map.getBounds(),
            onResult: (features) => {
                this.localSuggestions = features;
                if (!features.length) return;

                this.createSuggestionMarkers();
                clearTimeout(this.injectionTimeout);
                this.scheduleSuggestionInjection();
            }
        });
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

        if (this.isCoordinateInput) return;

        if (this.localSuggestions.length > 0 || this.mapSuggestions.length > 0 ||
            this.mapFeatureSuggestions.length > 0 || this.markerSuggestions.length > 0 ||
            this.countrySuggestions.length > 0 || this.directionsSuggestions.length > 0) {
            clearTimeout(this.injectionTimeout);
            this.scheduleSuggestionInjection();
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
            const isCurrentLocation = feature.properties && feature.properties._isCurrentLocation;

            // Cadastral plot selections are deliberately not named in analytics:
            // plot identifiers can reveal personal interest in specific parcels.
            trackEvent('search_select', {
                search_type: isCurrentLocation ? 'current_location' : (isLocalSuggestion ? 'cadastral' : 'place'),
                result_name: (isLocalSuggestion && !isCurrentLocation) ? undefined : feature.properties?.name
            });

            if (isLocalSuggestion) {
                // Set value silently (no input event) so Mapbox doesn't fetch suggestions
                this.updateSearchBoxInput(feature.properties.name, { silent: true });

                // Before the marker, not after: clearing selections emits
                // 'selections-cleared', which the marker manager answers with
                // clearAllMarkers() - dropping the result marker along with the
                // old selection if it already existed.
                if (this.featureStateManager) {
                    this.featureStateManager.clearAllSelections();
                }

                // Add a marker at the location
                this._addResultMarker(coordinates, feature.properties.name);

                if (!isCurrentLocation) {
                    // For cadastral plots, zoom in closer to see the plot boundaries
                    this.map.flyTo({
                        center: coordinates,
                        zoom: 18, // Zoom in closer for cadastral plots
                        essential: true,
                        duration: 2000
                    });
                }
                // "Current location" is, by definition, already where the map is
                // centered — leave the camera alone and just drop the marker.

                this.resetSearchState();
            } else {
                // Regular search result or coordinate
                this._addResultMarker(coordinates, feature.properties.name || feature.properties.place_name || 'Search Result');

                this.map.flyTo({
                    center: coordinates,
                    zoom: 16,
                    essential: true
                });
            }
        }
    }

    /**
     * Clean up the search control
     */
    cleanup() {
        this.removeSearchMarker();

        this.clearSuggestionMarkers();
        this.suggestionsPanel.clear();
        this.cadastralProvider.cancel();
        this.nominatimProvider.cancel();
        this.directionsProvider.cancel();
        this.directionsLayer.clear();

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

        if (window.amche?.shouldBypassSearchSuggest) {
            delete window.amche.shouldBypassSearchSuggest;
        }

        if (this.searchBox) {
            this.searchBox.removeEventListener('suggest', this.handleSuggest.bind(this));
            this.searchBox.removeEventListener('retrieve', this.handleRetrieve.bind(this));
            this.searchBox.removeEventListener('input', this.handleInput.bind(this));
            this.searchBox.removeEventListener('keydown', this.handleKeyDown.bind(this));
            this.searchBox.removeEventListener('clear', this.handleClear.bind(this));
            this.searchBox.removeEventListener('focusin', this._boundHandleSearchBoxFocus);
            this.searchBox.removeEventListener('focusout', this._boundHandleSearchBoxBlur);
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

    scheduleSuggestionInjection() {
        // Captured so a stale timer (from a query the user has since changed)
        // skips re-rendering instead of clobbering newer suggestions.
        const query = this.currentQuery;
        const delays = [0, 100, 300, 600, 1500, 3000];
        delays.forEach(delay => {
            setTimeout(() => {
                if (this.currentQuery !== query) return;
                this._renderSuggestions();
                this.showSuggestionMarkers();
                this.fitToContextWithAllSuggestions();
            }, delay);
        });
    }

    /**
     * Best-effort lookup of Mapbox's own listbox, used only to close its dropdown
     * when the user picks one of OUR suggestions instead. Excludes our own panel
     * (also role="listbox" - see search-suggestions-panel.js) from the
     * document-wide fallback.
     */
    _getMapboxListbox() {
        // This widget doesn't set role="listbox" and its CSS classes are
        // per-build-hashed (e.g. "mbx0cedb16f--Results") - substring-match on
        // the stable "Results" suffix, same fallback suppressSuggestions()
        // above already uses when aria-controls isn't pointing at it.
        const el = this.searchBox.shadowRoot?.querySelector('[class*="Results"]') ||
            this.searchBox.querySelector('[class*="Results"]');
        return el ? $(el) : $();
    }

    /**
     * Render this.mapSuggestions (atlas/layer matches) and this.localSuggestions
     * (place/parcel/current-location features) into the shared suggestions
     * panel as separate labeled sections.
     */
    _renderSuggestions() {
        const sections = [];

        // Shown first - a resolved "X to Y" match is a strong, deliberate
        // signal when present, ahead of the more incidental result types.
        if (this.directionsSuggestions.length) {
            sections.push({ ariaLabel: 'Directions', items: this.directionsSuggestions });
        }

        if (this.mapSuggestions.length) {
            sections.push({ ariaLabel: 'Maps', items: this.mapSuggestions });
        }

        if (this.mapFeatureSuggestions.length) {
            sections.push({ ariaLabel: 'On the map', items: this.mapFeatureSuggestions });
        }

        if (this.markerSuggestions.length) {
            sections.push({ ariaLabel: 'Your markers', items: this.markerSuggestions });
        }

        if (this.countrySuggestions.length) {
            sections.push({ ariaLabel: 'Countries', items: this.countrySuggestions });
        }

        if (this.localSuggestions.length) {
            const isCurrentLocation = this.localSuggestions.some(s => s.properties._isCurrentLocation);
            const isNominatim = this.localSuggestions.some(s => s.properties._isNominatim);
            const ariaLabel = isCurrentLocation
                ? 'Current location'
                : (isNominatim ? 'Place suggestions' : 'Cadastral plot suggestions');

            sections.push({
                ariaLabel,
                items: this.localSuggestions.slice(0, 5),
                attribution: isNominatim ? 'Powered by Nominatim' : undefined
            });
        }

        if (!sections.length) {
            this.suggestionsPanel.clear();
            return;
        }

        this.suggestionsPanel.render(sections);
    }

    /**
     * Handle a click/keyboard selection of one of our own suggestions - a
     * place/parcel/current-location feature, an atlas/layer match, an
     * on-screen feature, or a marker.
     */
    _selectSuggestion(item) {
        if (!item) return;

        // Reset first (clears currentQuery, all suggestion arrays, markers,
        // and the panel): without this, scheduleSuggestionInjection()'s
        // already-scheduled staggered re-render timers from this same
        // keystroke (see its 0/100/300/600/1500/3000ms delays) would still
        // see the old currentQuery unchanged, and resurrect this exact panel
        // moments after selection.
        this.resetSearchState();

        // Best-effort close of Mapbox's own dropdown too (never mutating it —
        // just hiding its container, which _getMapboxListbox() already
        // resolves to - see its comment for why no .parent() is needed here).
        this._getMapboxListbox().hide();

        // Reflect the pick in the input (silently, no 'input' event) so
        // leftover typed text doesn't sit there and let Mapbox's own native
        // autosuggest independently complete its own retrieve later on that
        // stale text.
        this.updateSearchBoxInput(item.properties.name, { silent: true });

        if (item._searchResultType === 'atlas') {
            trackEvent('search_select', { search_type: 'atlas', result_name: item.properties.name });
            window.layerControl?._navigateToAtlas(item.atlasId);
            return;
        }

        if (item._searchResultType === 'layer') {
            this._toggleLayerSuggestion(item);
            return;
        }

        if (item._searchResultType === 'map-feature') {
            this._selectMapFeatureSuggestion(item);
            return;
        }

        if (item._searchResultType === 'marker') {
            this._selectMarkerSuggestion(item);
            return;
        }

        if (item._searchResultType === 'country') {
            trackEvent('search_select', { search_type: 'country', result_name: item.properties.name });
            this.map.flyTo({ center: item.center, zoom: item.zoom, essential: true });
            return;
        }

        if (item._searchResultType === 'directions') {
            this._selectDirectionsSuggestion(item);
            return;
        }

        const retrieveEvent = new CustomEvent('retrieve', {
            detail: { features: [item] }
        });
        this.searchBox.dispatchEvent(retrieveEvent);
    }

    /**
     * Add or remove a layer search result, reusing the existing cross-atlas
     * add/remove machinery in map-layer-controls.js (the same code path the
     * layer control drawer's own cross-atlas search results use). Which
     * action to take is fixed by which section the item came from (see
     * search/providers/atlas-layer-provider.js) rather than re-detected here.
     */
    _toggleLayerSuggestion(item) {
        const control = window.layerControl;
        if (!control) return;

        trackEvent('search_select', { search_type: 'layer', result_name: item.properties.name });

        if (item.action === 'remove') {
            control._removeCrossAtlasLayer(item.layer._prefixedId || item.layer.id);
        } else {
            control._addCrossAtlasLayer(item.layer);
        }
    }

    /**
     * Select a feature that's already rendered in the current view, via the
     * same handleFeatureClicks() pipeline a real map click uses (see
     * js/map-nearby-features-control.js's _selectFeature for the identical
     * pattern) - marker creation, the inspector panel, and URL state all
     * behave exactly as if the user had clicked the feature on the map. No
     * camera movement needed since the feature is already on screen.
     */
    _selectMapFeatureSuggestion(item) {
        trackEvent('search_select', { search_type: 'map_feature', result_name: item.properties.name });

        window.featureControl?._stateManager?.handleFeatureClicks([item.mapFeature]);
        window.featureControl?._markerManager?._openInspectorPanel();
    }

    /**
     * Fly to and focus an existing user-added marker/note, mirroring
     * map-marker-manager.js's own prev/next marker navigation
     * (_navigateMarker) and its focusCommentInput() helper.
     */
    _selectMarkerSuggestion(item) {
        // Marker labels are often user-authored note text (or another feature's
        // properties) - never sent to analytics, same reasoning as cadastral
        // plot names in handleRetrieve below.
        trackEvent('search_select', { search_type: 'marker' });

        this.map.flyTo({
            center: [item.markerLngLat.lng, item.markerLngLat.lat],
            duration: 500
        });
        window.featureControl?._markerManager?.focusCommentInput(item.markerId);
    }

    /**
     * Fetch and draw the route for a resolved "X to Y" match (see
     * search/directions-router.js for the Mapbox-then-OSRM fallback).
     */
    async _selectDirectionsSuggestion(item) {
        trackEvent('search_select', { search_type: 'directions' });

        try {
            const route = await fetchRoute(item.from, item.to);
            const waypoints = [item.from.coordinates, item.to.coordinates];
            this.directionsLayer.show(route, waypoints, [item.from.label || '', item.to.label || '']);
            this.map.fitBounds(this.directionsLayer.bounds(route.geometry), {
                padding: 60,
                duration: 1000
            });

            const distanceKm = (route.distance / 1000).toFixed(1);
            const durationMin = Math.round(route.duration / 60);
            window.keyboardController?.announceToScreenReader(
                `Route found: ${distanceKm} kilometers, about ${durationMin} minutes`
            );
        } catch (error) {
            console.error('[directions]', error);
            window.keyboardController?.announceToScreenReader('Could not find a route');
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
     * Handle hover effects on suggestion markers.
     * @param {object} item - The hovered suggestion item. Only place/parcel/
     *   current-location items (present in this.localSuggestions) have a map
     *   marker; atlas/layer items resolve to index -1 and are a no-op below.
     * @param {boolean} isHovering - Whether currently hovering (true) or leaving (false)
     */
    handleSuggestionHover(item, isHovering) {
        const suggestionIndex = item ? this.localSuggestions.indexOf(item) : -1;
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
                // Tag this as a search preview so map-init.js's reverse-geocode-on-move
                // listener can skip it — hovering/typing through suggestions can fire
                // this repeatedly and would otherwise spam Nominatim's reverse endpoint.
                this.map.fitBounds(bounds, {
                    padding: {
                        top: 50,
                        bottom: 50,
                        left: 50,
                        right: 50
                    },
                    maxZoom: 16,
                    duration: 1000
                }, { _isSearchPreview: true });
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
                }, { _isSearchPreview: true });
            }
        } catch (error) {
            console.error('Error fitting to context with hovered suggestion:', error);
        }
    }
}
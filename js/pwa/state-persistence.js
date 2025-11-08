// State Persistence - Saves and restores app state when switching/reopening the PWA
// This ensures users can continue where they left off when reopening the app

class StatePersistence {
    constructor() {
        this.storageKey = 'amche-goa-state';
        this.isInitialized = false;
    }

    /**
     * Initialize state persistence
     * Should be called after map and URL manager are ready
     */
    initialize() {
        if (this.isInitialized) return;

        this.setupEventListeners();
        this.restoreStateOnLoad();
        this.isInitialized = true;
    }

    /**
     * Setup event listeners for state saving
     */
    setupEventListeners() {
        // Save state when page is about to be unloaded
        window.addEventListener('beforeunload', () => {
            this.saveCurrentState();
        });

        // Save state when page becomes hidden (mobile app switching)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.saveCurrentState();
                console.debug('🔄 State saved on visibility change');
            }
        });

        // Save state when PWA loses focus (iOS/Android app switching)
        window.addEventListener('blur', () => {
            this.saveCurrentState();
        });

        // Save state when PWA is paused (Android)
        window.addEventListener('pagehide', () => {
            this.saveCurrentState();
        });

        // Periodic state saving (every 30 seconds as backup)
        setInterval(() => {
            this.saveCurrentState();
        }, 30000);
    }

    /**
     * Save current app state to localStorage
     */
    saveCurrentState() {
        try {
            const state = {
                url: window.location.href,
                timestamp: Date.now(),
                // Also save map position if available
                mapState: this.getMapState()
            };

            localStorage.setItem(this.storageKey, JSON.stringify(state));
        } catch (error) {
            console.warn('Failed to save state:', error);
        }
    }

    /**
     * Get current map state (center, zoom, bearing, pitch)
     */
    getMapState() {
        if (typeof window !== 'undefined' && window.map && window.map.loaded()) {
            try {
                const center = window.map.getCenter();
                const zoom = window.map.getZoom();
                const bearing = window.map.getBearing();
                const pitch = window.map.getPitch();

                return {
                    center: [center.lng, center.lat],
                    zoom,
                    bearing,
                    pitch
                };
            } catch (error) {
                console.debug('Could not get map state:', error);
                return null;
            }
        }
        return null;
    }

    /**
     * Restore state on app load
     */
    restoreStateOnLoad() {
        // Only restore if there are no URL parameters (fresh app load)
        const hasURLParams = window.location.search.length > 0 || window.location.hash.length > 0;

        if (hasURLParams) {
            return false;
        }

        try {
            const savedStateStr = localStorage.getItem(this.storageKey);
            if (!savedStateStr) {
                return false;
            }

            const savedState = JSON.parse(savedStateStr);

            // Check if saved state is recent (within last 7 days)
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
            if (Date.now() - savedState.timestamp > maxAge) {
                console.debug('🔄 Saved state too old, ignoring');
                localStorage.removeItem(this.storageKey);
                return false;
            }

            // Extract just the search params and hash from saved URL
            const savedUrl = new URL(savedState.url);
            const currentUrl = new URL(window.location.href);

            // Only restore if it's a different state
            if (savedUrl.search === currentUrl.search && savedUrl.hash === currentUrl.hash) {
                console.debug('🔄 Current URL matches saved state');
                return false;
            }

            // Build restored URL with current origin but saved parameters
            let restoredUrl = currentUrl.origin + currentUrl.pathname;
            if (savedUrl.search) {
                restoredUrl += savedUrl.search;
            }
            if (savedUrl.hash) {
                restoredUrl += savedUrl.hash;
            }

            // Replace current URL without triggering navigation
            window.history.replaceState(null, '', restoredUrl);

            // If map state was saved and map is available, restore map position
            this.restoreMapState(savedState.mapState);

            return true;
        } catch (error) {
            console.warn('Failed to restore state:', error);
            localStorage.removeItem(this.storageKey);
            return false;
        }
    }

    /**
     * Restore map state (position, zoom, etc.)
     */
    restoreMapState(mapState) {
        if (!mapState || !window.map) return;

        // Wait for map to be ready before applying saved position
        const applyMapState = () => {
            if (window.map && window.map.loaded()) {
                try {
                    window.map.jumpTo({
                        center: mapState.center,
                        zoom: mapState.zoom,
                        bearing: mapState.bearing,
                        pitch: mapState.pitch
                    });
                    console.debug('🔄 Map state restored');
                } catch (error) {
                    console.debug('Could not restore map state:', error);
                }
            } else {
                // If map not ready, try again in 100ms
                setTimeout(applyMapState, 100);
            }
        };

        applyMapState();
    }

    /**
     * Clear saved state
     */
    clearSavedState() {
        localStorage.removeItem(this.storageKey);
        console.debug('🔄 Saved state cleared');
    }

    /**
     * Get saved state (for debugging)
     */
    getSavedState() {
        try {
            const savedStateStr = localStorage.getItem(this.storageKey);
            return savedStateStr ? JSON.parse(savedStateStr) : null;
        } catch (error) {
            return null;
        }
    }
}

// Create global instance
window.statePersistence = new StatePersistence();

// Export the class
export {StatePersistence};
/**
 * Centralized Drawer State Manager
 * 
 * Manages the layer drawer state and provides a unified event system
 * for components to listen to drawer state changes.
 */
export class DrawerStateManager {
    constructor() {
        this._drawer = null;
        this._isOpen = false;
        this._listeners = [];
        
        // Custom event target for event dispatching
        this._eventTarget = new EventTarget();
        
        this._initialize();
    }

    /**
     * Initialize the drawer state manager
     */
    _initialize() {
        // Wait for drawer to be available
        this._waitForDrawer().then(() => {
            this._setupDrawerListeners();
            this._checkInitialState();
        });
    }

    /**
     * Wait for the drawer element to be available
     */
    async _waitForDrawer() {
        return new Promise((resolve) => {
            const checkDrawer = () => {
                this._drawer = document.querySelector('.drawer-placement-start');
                if (this._drawer) {
                    resolve();
                } else {
                    setTimeout(checkDrawer, 100);
                }
            };
            checkDrawer();
        });
    }

    /**
     * Set up listeners for drawer events
     */
    _setupDrawerListeners() {
        if (!this._drawer) return;

        // Listen for drawer show events
        this._drawer.addEventListener('sl-show', (event) => {
            // CRITICAL: Only respond to events from the main drawer itself
            // Ignore events from child sl-details elements that bubble up
            if (event.target !== this._drawer) {
                return;
            }
            this._isOpen = true;
            this._emitStateChange('show');
        });

        this._drawer.addEventListener('sl-after-show', (event) => {
            // CRITICAL: Only respond to events from the main drawer itself
            if (event.target !== this._drawer) {
                return;
            }
            this._isOpen = true;
            this._emitStateChange('after-show');
        });

        // Listen for drawer hide events
        this._drawer.addEventListener('sl-hide', (event) => {
            // CRITICAL: Only respond to events from the main drawer itself
            if (event.target !== this._drawer) {
                return;
            }
            this._isOpen = false;
            this._emitStateChange('hide');
        });

        this._drawer.addEventListener('sl-after-hide', (event) => {
            // CRITICAL: Only respond to events from the main drawer itself
            if (event.target !== this._drawer) {
                return;
            }
            this._isOpen = false;
            this._emitStateChange('after-hide');
        });
    }

    /**
     * Check the initial state of the drawer
     */
    _checkInitialState() {
        if (!this._drawer) return;

        // Use multiple methods to determine initial state
        const isOpen = this._drawer.open || 
                      this._drawer.hasAttribute('open') || 
                      this._drawer.classList.contains('sl-drawer--open') ||
                      getComputedStyle(this._drawer).display !== 'none';

        this._isOpen = isOpen;
        
        // Emit initial state after a delay to allow components to register listeners
        setTimeout(() => {
            this._emitStateChange('initial-state');
        }, 100);
    }

    /**
     * Emit state change event
     */
    _emitStateChange(eventType) {
        const event = new CustomEvent('drawer-state-change', {
            detail: {
                eventType,
                isOpen: this._isOpen,
                drawer: this._drawer
            }
        });

        // Dispatch to both the custom event target and window
        this._eventTarget.dispatchEvent(event);
        window.dispatchEvent(event);
    }

    /**
     * Get current drawer state
     */
    isOpen() {
        return this._isOpen;
    }

    /**
     * Toggle the drawer
     */
    toggle() {
        if (!this._drawer) return;

        if (this._isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Open the drawer
     */
    open() {
        if (!this._drawer) return;
        this._drawer.show();
    }

    /**
     * Close the drawer
     */
    close() {
        if (!this._drawer) return;
        this._drawer.hide();
    }

    /**
     * Add event listener for drawer state changes
     */
    addEventListener(callback) {
        this._eventTarget.addEventListener('drawer-state-change', callback);
    }

    /**
     * Remove event listener
     */
    removeEventListener(callback) {
        this._eventTarget.removeEventListener('drawer-state-change', callback);
    }

    /**
     * Clean up
     */
    destroy() {
        this._listeners.forEach(({ element, event, listener }) => {
            element.removeEventListener(event, listener);
        });
        this._listeners = [];
    }
}

// Create a global instance
export const drawerStateManager = new DrawerStateManager();

// Make it globally accessible
if (typeof window !== 'undefined') {
    window.drawerStateManager = drawerStateManager;
} 
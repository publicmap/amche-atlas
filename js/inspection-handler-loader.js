/**
 * Inspection Handler Loader
 *
 * Dynamically loads and executes layer inspection handlers from config files.
 * STRICT NAMING CONVENTION: Handler files must match the atlas name.
 * - config/{atlas-name}.js (e.g., config/goa.js, config/index.js)
 */

export class InspectionHandlerLoader {
    constructor() {
        this._handlersCache = new Map(); // atlas name -> handlers object
        this._loadingPromises = new Map(); // track in-progress loads
    }

    /**
     * Load handlers for a specific atlas
     * @param {string} atlasName - Name of the atlas (e.g., 'goa', 'index')
     * @returns {Promise<Object>} Handlers object
     */
    async loadHandlers(atlasName) {
        // Return cached handlers if available
        if (this._handlersCache.has(atlasName)) {
            return this._handlersCache.get(atlasName);
        }

        // Return existing promise if already loading
        if (this._loadingPromises.has(atlasName)) {
            return this._loadingPromises.get(atlasName);
        }

        // Start loading
        const loadPromise = this._loadHandlersInternal(atlasName);
        this._loadingPromises.set(atlasName, loadPromise);

        try {
            const handlers = await loadPromise;
            this._handlersCache.set(atlasName, handlers);
            return handlers;
        } finally {
            this._loadingPromises.delete(atlasName);
        }
    }

    /**
     * Internal method to load handlers from file
     */
    async _loadHandlersInternal(atlasName) {
        try {
            // Try to import the handlers file (config/{atlas}.js)
            const handlersModule = await import(`../config/${atlasName}.js`);

            if (handlersModule.handlers && typeof handlersModule.handlers === 'object') {
                console.log(`[HandlerLoader] Loaded ${Object.keys(handlersModule.handlers).length} handlers from ${atlasName}.js`);
                this._exposeHandlersGlobally(handlersModule.handlers);
                return handlersModule.handlers;
            } else {
                console.warn(`[HandlerLoader] No handlers export found in ${atlasName}.js`);
                return {};
            }
        } catch (error) {
            // File doesn't exist or failed to load
            if (error.message.includes('Failed to fetch') || error.message.includes('Cannot find module')) {
                console.log(`[HandlerLoader] No handlers file found: ${atlasName}.js`);
            } else {
                console.error(`[HandlerLoader] Error loading handlers from ${atlasName}.js:`, error);
            }
            return {};
        }
    }

    _exposeHandlersGlobally(handlers) {
        if (typeof window !== 'undefined') {
            if (!window.inspectionHandlers) {
                window.inspectionHandlers = {};
            }
            Object.assign(window.inspectionHandlers, handlers);
        }
    }

    /**
     * Execute a handler function
     * @param {string} atlasName - Atlas name
     * @param {string} handlerName - Handler function name
     * @param {Object} context - Context object passed to handler
     * @returns {Promise<string|null>} HTML string or null if handler not found
     */
    async executeHandler(atlasName, handlerName, context) {
        // Load handlers for this atlas
        const handlers = await this.loadHandlers(atlasName);

        // Check if handler exists
        if (!handlers || !handlers[handlerName]) {
            console.warn(`[HandlerLoader] Handler not found: ${handlerName} in ${atlasName}.js`);
            return null;
        }

        const handler = handlers[handlerName];

        if (typeof handler !== 'function') {
            console.warn(`[HandlerLoader] Handler is not a function: ${handlerName}`);
            return null;
        }

        try {
            console.log(`[HandlerLoader] Executing handler: ${handlerName} from ${atlasName}.js`);
            const result = await handler(context);
            return result;
        } catch (error) {
            console.error(`[HandlerLoader] Error executing handler ${handlerName}:`, error);
            return `<div style="color: #ef4444; font-size: 12px; padding: 10px;">Error loading inspection data: ${error.message}</div>`;
        }
    }

    /**
     * Clear cached handlers (useful for development/hot reload)
     */
    clearCache() {
        this._handlersCache.clear();
        console.log('[HandlerLoader] Handler cache cleared');
    }

    /**
     * Get list of loaded atlases
     */
    getLoadedAtlases() {
        return Array.from(this._handlersCache.keys());
    }
}

// Create singleton instance
export const handlerLoader = new InspectionHandlerLoader();

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.inspectionHandlerLoader = handlerLoader;
}

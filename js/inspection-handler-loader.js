/**
 * Inspection Handler Loader
 *
 * Dynamically loads and executes layer inspection handlers and data-mapping
 * functions from config files.
 * STRICT NAMING CONVENTION: Handler files must match the atlas name.
 * - config/{atlas-name}.js (e.g., config/goa.js, config/index.js)
 */

export class InspectionHandlerLoader {
    constructor() {
        this._moduleCache = new Map(); // atlas name -> imported module namespace
        this._loadingPromises = new Map(); // track in-progress loads
    }

    /**
     * Load handlers for a specific atlas
     * @param {string} atlasName - Name of the atlas (e.g., 'goa', 'index')
     * @returns {Promise<Object>} Handlers object
     */
    async loadHandlers(atlasName) {
        const module = await this._loadModule(atlasName);
        return module.handlers || {};
    }

    /**
     * Load data-mapping functions for a specific atlas, used by `type: "js"`
     * layers to transform a fetched API response into GeoJSON.
     * @param {string} atlasName - Name of the atlas (e.g., 'goa', 'index')
     * @returns {Promise<Object>} dataFunctions object
     */
    async loadDataFunctions(atlasName) {
        const module = await this._loadModule(atlasName);
        return module.dataFunctions || {};
    }

    /**
     * Load and cache the config/{atlas}.js module (handlers + dataFunctions)
     */
    async _loadModule(atlasName) {
        if (this._moduleCache.has(atlasName)) {
            return this._moduleCache.get(atlasName);
        }

        if (this._loadingPromises.has(atlasName)) {
            return this._loadingPromises.get(atlasName);
        }

        const loadPromise = this._loadModuleInternal(atlasName);
        this._loadingPromises.set(atlasName, loadPromise);

        try {
            const module = await loadPromise;
            this._moduleCache.set(atlasName, module);
            return module;
        } finally {
            this._loadingPromises.delete(atlasName);
        }
    }

    /**
     * Internal method to load the module from file
     */
    async _loadModuleInternal(atlasName) {
        try {
            // Try to import the handlers file (config/{atlas}.js)
            const handlersModule = await import(`../config/${atlasName}.js`);

            if (handlersModule.handlers && typeof handlersModule.handlers === 'object') {
                console.log(`[HandlerLoader] Loaded ${Object.keys(handlersModule.handlers).length} handlers from ${atlasName}.js`);
                this._exposeHandlersGlobally(handlersModule.handlers);
            }

            if (handlersModule.dataFunctions && typeof handlersModule.dataFunctions === 'object') {
                console.log(`[HandlerLoader] Loaded ${Object.keys(handlersModule.dataFunctions).length} data functions from ${atlasName}.js`);
            }

            return handlersModule;
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
        this._moduleCache.clear();
        console.log('[HandlerLoader] Handler cache cleared');
    }

    /**
     * Get list of loaded atlases
     */
    getLoadedAtlases() {
        return Array.from(this._moduleCache.keys());
    }
}

// Create singleton instance
export const handlerLoader = new InspectionHandlerLoader();

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.inspectionHandlerLoader = handlerLoader;
}

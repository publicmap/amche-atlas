/**
 * Permalink Handler
 * Handles resolution of permalink shortcuts to full URLs
 */

class PermalinkHandler {
    constructor() {
        this.permalinks = null;
        this.loadPromise = this.loadPermalinks();
    }

    /**
     * Load permalink definitions from config
     */
    async loadPermalinks() {
        try {
            const response = await fetch('config/permalinks.json');
            const data = await response.json();
            this.permalinks = data.permalinks || {};
            console.log('📚 Loaded permalinks:', this.permalinks);
        } catch (error) {
            console.warn('⚠️ Failed to load permalinks:', error);
            this.permalinks = {};
        }
    }

    /**
     * Resolve a permalink to its full URL parameters
     * @param {string} permalinkId - The permalink identifier
     * @returns {Object|null} Object with URL parameters or null if not found
     */
    async resolvePermalink(permalinkId) {
        await this.loadPromise;

        if (!permalinkId || !this.permalinks[permalinkId]) {
            return null;
        }

        const permalink = this.permalinks[permalinkId];

        // Handle aliases
        if (permalink.alias_for) {
            return this.resolvePermalink(permalink.alias_for);
        }

        // Parse the full URL to extract parameters
        try {
            const url = new URL(permalink.url);
            const params = new URLSearchParams(url.search);

            return {
                atlas: params.get('atlas'),
                layers: params.get('layers'),
                hash: url.hash,
                title: permalink.title,
                description: permalink.description,
                category: permalink.category
            };
        } catch (error) {
            console.error('❌ Failed to parse permalink URL:', permalink.url, error);
            return null;
        }
    }

    /**
     * Check if current URL has a permalink parameter and resolve it
     * @returns {Object|null} Resolved permalink parameters or null
     */
    async checkForPermalink() {
        const urlParams = new URLSearchParams(window.location.search);
        const permalinkId = urlParams.get('map') || urlParams.get('permalink');

        if (permalinkId) {
            console.log('🔗 Found permalink:', permalinkId);
            const resolved = await this.resolvePermalink(permalinkId);

            if (resolved) {
                console.log('✅ Resolved permalink:', resolved);
                return resolved;
            } else {
                console.warn('❌ Permalink not found:', permalinkId);
            }
        }

        return null;
    }

    /**
     * Apply permalink parameters to the current URL
     * @param {Object} resolvedParams - Parameters from resolved permalink
     */
    applyPermalinkToURL(resolvedParams) {
        if (!resolvedParams) return;

        const url = new URL(window.location);
        const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;

        // Preserve original hash if it exists, otherwise use permalink hash
        const originalHash = url.hash;

        // Build new URL with resolved parameters
        const params = new URLSearchParams();

        if (resolvedParams.atlas) {
            params.set('atlas', resolvedParams.atlas);
        }

        if (resolvedParams.layers) {
            params.set('layers', resolvedParams.layers);
        }

        let newUrl = baseUrl;
        if (params.toString()) {
            newUrl += '?' + params.toString();
        }

        // Add hash - prefer original hash over permalink hash
        const hashToUse = originalHash || resolvedParams.hash;
        if (hashToUse) {
            newUrl += hashToUse;
        }

        console.log('🔄 Applying permalink URL:', newUrl);
        if (originalHash) {
            console.log('✅ Preserved original hash:', originalHash);
        }
        window.history.replaceState({}, '', newUrl);
    }

    /**
     * Get all available permalinks for display/debugging
     * @returns {Object} All permalinks
     */
    async getAllPermalinks() {
        await this.loadPromise;
        return this.permalinks;
    }

    /**
     * Create a new permalink (for future admin functionality)
     * @param {string} id - Permalink identifier
     * @param {Object} config - Permalink configuration
     * @returns {boolean} Success status
     */
    async createPermalink(id, config) {
        await this.loadPromise;

        if (!id || !config.url) {
            console.error('❌ Invalid permalink configuration');
            return false;
        }

        this.permalinks[id] = {
            url: config.url,
            title: config.title || id,
            description: config.description || '',
            category: config.category || 'general',
            created: new Date().toISOString(),
            ...config
        };

        console.log('✅ Created permalink:', id);
        return true;
    }
}

// Export singleton instance
export const permalinkHandler = new PermalinkHandler(); 
/**
 * Simple localization system for the map application
 */
export class Localization {
    constructor() {
        // These will be overridden by the defaults from config
        this.defaultStrings = {
            title: "Maps",
            shareButton: "Share"
        };
        this.currentStrings = {...this.defaultStrings};
    }

    /**
     * Set the default strings from configuration
     * @param {Object} defaultStrings - Default UI strings from config
     */
    setDefaults(defaultStrings) {
        if (defaultStrings) {
            this.defaultStrings = {...this.defaultStrings, ...defaultStrings};
            // If no current strings are set yet, use the new defaults
            if (!this.currentStrings || Object.keys(this.currentStrings).length === 0) {
                this.currentStrings = {...this.defaultStrings};
            }
        }
    }

    /**
     * Load UI strings from configuration
     * @param {Object} config - Configuration object that may contain ui strings
     */
    loadStrings(config) {
        // First, set defaults if they exist in config.defaults.ui
        if (config && config.defaults && config.defaults.ui) {
            this.setDefaults(config.defaults.ui);
        }

        // Then apply specific UI strings if they exist
        if (config && config.ui) {
            this.currentStrings = {...this.defaultStrings, ...config.ui};
            this.updateUIElements();
        } else {
            // Reset to default if no UI config provided
            this.currentStrings = {...this.defaultStrings};
            this.updateUIElements();
        }
    }

    /**
     * Get a localized string by key
     * @param {string} key - The string key
     * @returns {string} The localized string
     */
    getString(key) {
        return this.currentStrings[key] || this.defaultStrings[key] || key;
    }

    /**
     * Update UI elements with current localized strings
     */
    updateUIElements() {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
            this._updateUIElementsImpl();
        });
    }

    /**
     * Internal implementation for updating UI elements
     */
    _updateUIElementsImpl() {
        // Update drawer title
        const drawer = document.getElementById('map-controls-drawer');
        if (drawer) {
            drawer.setAttribute('label', this.currentStrings.title);

            // Also update the slot label content
            const labelSlot = drawer.querySelector('[slot="label"]');
            if (labelSlot) {
                // Find the text node and update it
                const textNode = Array.from(labelSlot.childNodes).find(
                    node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
                );
                if (textNode) {
                    textNode.textContent = this.currentStrings.title;
                }
            }
        }

        // Update share button
        const shareButton = document.getElementById('share-link');
        if (shareButton) {
            // Update the text content while preserving the SVG icon
            // Look for the text node that comes after the SVG
            const textNodes = Array.from(shareButton.childNodes).filter(
                node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
            );
            if (textNodes.length > 0) {
                // Update the last text node (which should be the share text)
                const lastTextNode = textNodes[textNodes.length - 1];
                lastTextNode.textContent = '\n                ' + this.currentStrings.shareButton + '\n            ';
            }
        }
    }

    /**
     * Force update UI elements (call when DOM is definitely ready)
     */
    forceUpdateUIElements() {
        this._updateUIElementsImpl();
    }

    /**
     * Reset to default strings
     */
    reset() {
        this.currentStrings = {...this.defaultStrings};
        this.updateUIElements();
    }
}

// Create and export a singleton instance
export const localization = new Localization(); 
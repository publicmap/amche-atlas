/**
 * Permalink Handler
 * Handles resolution of permalink shortcuts to full URLs
 */

export class PermalinkManager {
    constructor(links = 'config/permalinks.json') {
        this.links = links;
    }

    /**
     * Check if current URL has a permalink parameter and resolve it
     * @returns {Object|null} Resolved permalink parameters or null
     */
    async detectAndRedirect() {

        const urlParams = new URLSearchParams(window.location.search);
        const permalinkId = urlParams.get('p') || urlParams.get('permalink');
        if (!permalinkId) {
            return;
        }

        const response = await fetch(this.links);
        const data = await response.json();
        if (!(permalinkId in data.permalinks)) {
            return;
        }

        window.location.replace(data.permalinks[permalinkId].url)
    }
}
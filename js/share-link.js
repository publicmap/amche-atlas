/**
 * ShareLink Plugin - A reusable share button with QR code functionality
 *
 * Usage:
 * const shareLink = new ShareLink({
 *   containerId: 'my-container',
 *   url: 'https://example.com',
 *   buttonText: 'Share',
 *   buttonClasses: 'share-button'
 * });
 * shareLink.render();
 */

export class ShareLink {
    constructor(options = {}) {
        this.containerId = options.containerId || 'share-container';
        this.url = options.url || window.location.href;
        this.buttonText = options.buttonText || 'Share';
        this.buttonClasses = options.buttonClasses || 'share-button';
        this.buttonId = options.buttonId || 'share-link';
        this.showToast = options.showToast !== false; // Default to true
        this.qrCodeSize = options.qrCodeSize || 500;
        this.useURLManager = options.useURLManager !== false; // Default to true

        // Bind methods to preserve context
        this._handleShareClick = this._handleShareClick.bind(this);
        this._showToast = this._showToast.bind(this);
        this._onURLUpdated = this._onURLUpdated.bind(this);

        // Set up URL manager integration if enabled
        if (this.useURLManager) {
            this.setupURLManagerIntegration();
        }
    }

    /**
     * Render the share button in the specified container
     */
    render() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`ShareLink: Container with ID "${this.containerId}" not found`);
            return;
        }

        // Create share button HTML
        const button = document.createElement('button');
        button.id = this.buttonId;
        button.className = this.buttonClasses;
        button.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            ${this.buttonText}
        `;

        // Add click event listener
        button.addEventListener('click', this._handleShareClick);

        // Clear container and add button
        container.innerHTML = '';
        container.appendChild(button);
    }

    /**
     * Update the URL to share
     */
    updateUrl(newUrl) {
        this.url = newUrl;
    }

    /**
     * Set up URL manager integration
     */
    setupURLManagerIntegration() {
        // Listen for URL updates from the URL manager
        window.addEventListener('urlUpdated', this._onURLUpdated);

        // Check if URL manager is available when we render
        const checkURLManager = () => {
            if (window.urlManager) {
                return true;
            }
            return false;
        };

        // Try to connect immediately, or set up a listener
        if (!checkURLManager()) {
            const interval = setInterval(() => {
                if (checkURLManager()) {
                    clearInterval(interval);
                }
            }, 100);

            // Stop trying after 5 seconds
            setTimeout(() => clearInterval(interval), 5000);
        }
    }

    /**
     * Handle URL updated event from URL manager
     */
    _onURLUpdated(event) {
        // Update our internal URL reference
        if (event.detail && event.detail.url) {
            this.cachedURL = event.detail.url;
            console.log('🔗 ShareLink URL updated:', this.cachedURL);
        }
    }

    /**
     * Get the current shareable URL
     */
    getCurrentURL() {
        // If URL manager is available, use it for the most current URL
        if (this.useURLManager && window.urlManager) {
            return window.urlManager.getShareableURL();
        }

        // Fall back to cached URL or original URL
        if (this.cachedURL) {
            return this.cachedURL;
        }

        // Original behavior
        return typeof this.url === 'function' ? this.url() : this.url;
    }

    /**
     * Handle share button click
     */
    _handleShareClick() {
        const shareButton = document.getElementById(this.buttonId);
        if (!shareButton) return;

        // Get the URL to share using the new method
        const urlToShare = this.getCurrentURL();

        // Copy to clipboard
        navigator.clipboard.writeText(urlToShare).then(() => {
            // Show toast notification
            if (this.showToast) {
                this._showToast('Link copied to clipboard!');
            }

            // Create QR code using Shoelace component
            const qrCode = document.createElement('sl-qr-code');
            qrCode.value = urlToShare;
            qrCode.size = 30;
            qrCode.style.cursor = 'pointer';

            // Store original button content
            const originalContent = shareButton.innerHTML;

            // Remove existing event listeners to prevent duplicates
            const newButton = shareButton.cloneNode(false);
            shareButton.parentNode.replaceChild(newButton, shareButton);

            // Replace button content with QR code
            newButton.innerHTML = '';
            newButton.appendChild(qrCode);

            // Function to reset button to original state
            const resetButton = () => {
                newButton.innerHTML = originalContent;
                newButton.addEventListener('click', this._handleShareClick);
            };

            // Add click handler to QR code to show full screen overlay
            qrCode.addEventListener('click', (e) => {
                e.stopPropagation();

                // Reset button content immediately
                resetButton();

                // Show full-screen QR code overlay
                this._showQROverlay(urlToShare);
            });

            // Auto-revert after 30 seconds (if user hasn't clicked the QR code)
            setTimeout(() => {
                if (newButton.contains(qrCode)) {
                    resetButton();
                }
            }, 30000);
        }).catch(err => {
            console.error('Failed to copy link:', err);
            if (this.showToast) {
                this._showToast('Failed to copy link', 'error');
            }
        });
    }

    /**
     * Show full-screen QR code overlay
     */
    _showQROverlay(urlToShare) {
        // Create full screen overlay
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '9999';
        overlay.style.cursor = 'pointer';
        overlay.style.padding = '10px';

        // Create container for QR code and caption
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';
        container.style.gap = '20px';

        // Create large QR code using Shoelace component
        const largeQRCode = document.createElement('sl-qr-code');
        largeQRCode.value = urlToShare;
        largeQRCode.size = Math.min(this.qrCodeSize, 400); // Cap at 400px for overlay
        largeQRCode.style.maxWidth = '90vw';
        largeQRCode.style.maxHeight = '70vh';

        // Create caption with the full URL
        const caption = document.createElement('div');
        caption.textContent = urlToShare;
        caption.style.color = 'white';
        caption.style.fontSize = '14px';
        caption.style.textAlign = 'center';
        caption.style.wordBreak = 'break-all';
        caption.style.padding = '0 20px';
        caption.style.maxWidth = '90vw';
        caption.style.fontFamily = 'monospace';

        // Close overlay when clicked
        overlay.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });

        container.appendChild(largeQRCode);
        container.appendChild(caption);
        overlay.appendChild(container);
        document.body.appendChild(overlay);
    }

    /**
     * Show toast notification
     */
    _showToast(message, type = 'success', duration = 3000) {
        // Create toast element if it doesn't exist
        let toast = document.querySelector('.toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast-notification';
            document.body.appendChild(toast);
        }

        // Set message and style based on type
        toast.textContent = message;
        toast.style.backgroundColor = type === 'success' ? '#4CAF50' :
            type === 'error' ? '#f44336' :
                type === 'info' ? '#2196F3' : '#4CAF50';

        // Show toast
        requestAnimationFrame(() => {
            toast.classList.add('show');

            // Hide toast after specified duration
            setTimeout(() => {
                toast.classList.remove('show');

                // Remove element after animation
                setTimeout(() => {
                    toast.remove();
                }, 300);
            }, duration);
        });
    }

    /**
     * Remove the share button and clean up
     */
    destroy() {
        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }

        // Clean up URL manager integration
        if (this.useURLManager) {
            window.removeEventListener('urlUpdated', this._onURLUpdated);
        }

        // Remove any existing toast notifications
        const toasts = document.querySelectorAll('.toast-notification');
        toasts.forEach(toast => toast.remove());

        // Remove any QR overlays
        const overlays = document.querySelectorAll('div[style*="position: fixed"][style*="z-index: 9999"]');
        overlays.forEach(overlay => overlay.remove());
    }
} 
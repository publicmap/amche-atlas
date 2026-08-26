export class KeyboardController {
    constructor() {
        this.activeModal = null;
        this.modalStack = [];
        this.setupEventListeners();
        this.autoFocusSearch();
    }

    setupEventListeners() {
        document.addEventListener('keydown', (e) => this.handleGlobalKeydown(e));

        window.addEventListener('message', (event) => {
            if (event.data.type === 'browser-ready') {
                this.setupIframeFocus('map-browser');
            }
        });

        document.addEventListener('focusin', (e) => {
            if (e.target.closest('.mapboxgl-ctrl-geocoder')) {
                e.target.setAttribute('aria-label', 'Search for locations');
            }
        });
    }

    async autoFocusSearch() {
        // Programmatically focusing the search input opens the on-screen
        // keyboard on touch devices, which then reappears if the user is
        // mid-pan when a retry fires. Autofocus is a desktop-only convenience.
        if (window.matchMedia('(pointer: coarse)').matches) return;

        try {
            const waitForLoadingOverlayRemoval = () => {
                return new Promise((resolve) => {
                    const overlay = document.getElementById('loading-overlay');
                    if (!overlay || overlay.style.display === 'none') {
                        resolve();
                        return;
                    }

                    const observer = new MutationObserver(() => {
                        if (overlay.style.display === 'none' || !document.body.contains(overlay)) {
                            observer.disconnect();
                            resolve();
                        }
                    });

                    observer.observe(overlay, {
                        attributes: true,
                        attributeFilter: ['style']
                    });

                    observer.observe(document.body, {
                        childList: true,
                        subtree: true
                    });

                    setTimeout(() => {
                        observer.disconnect();
                        resolve();
                    }, 10000);
                });
            };

            await waitForLoadingOverlayRemoval();
            await customElements.whenDefined('mapbox-search-box');

            const searchBox = document.querySelector('mapbox-search-box');
            if (!searchBox) return;

            const tryFocus = (attempt = 1) => {
                if (typeof searchBox.focus === 'function') {
                    searchBox.focus();

                    setTimeout(() => {
                        const activeEl = document.activeElement;

                        const isFocused = activeEl === searchBox ||
                                        activeEl?.closest?.(searchBox.tagName.toLowerCase()) === searchBox ||
                                        searchBox.contains(activeEl) ||
                                        (searchBox.shadowRoot && searchBox.shadowRoot.activeElement);

                        if (!isFocused && attempt < 3) {
                            setTimeout(() => tryFocus(attempt + 1), 300);
                        }
                    }, 100);
                }
            };

            setTimeout(() => tryFocus(), 300);

        } catch (error) {
            console.error('[KeyboardController] Error in autoFocusSearch:', error);
        }
    }

    handleGlobalKeydown(e) {
        if (e.key === 'Escape') {
            this.handleEscape(e);
        }

        if (e.key === '/' && !this.isInputActive()) {
            e.preventDefault();
            this.focusSearch();
        }

        if (e.key === '?' && !this.isInputActive()) {
            e.preventDefault();
            this.openWelcomeScreen();
        }

        if (e.key === 'b' && e.ctrlKey && !this.isInputActive()) {
            e.preventDefault();
            this.toggleMapBrowser();
        }

        if (e.key === 'l' && e.ctrlKey && !this.isInputActive()) {
            e.preventDefault();
            this.focusLayerControls();
        }

        if (e.key === ' ' && !this.isInputActive()) {
            e.preventDefault();
            this.triggerCenterSelection();
        }

        if (e.key === 'x' && !this.isInputActive()) {
            e.preventDefault();
            this.toggleExportPanel();
        }

        if (e.key === 'Tab' && this.activeModal) {
            this.handleModalTabbing(e);
        }

        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !this.isInputActive()) {
            e.preventDefault();
            const direction = e.key === 'ArrowLeft' ? -1 : 1;
            const markerManager = window.featureControl?._markerManager;
            if (markerManager) {
                markerManager._navigateMarker(direction);
            }
        }
    }

    handleEscape(e) {
        const navMenu = document.getElementById('nav-menu-overlay');
        if (navMenu && navMenu.style.display !== 'none') {
            document.getElementById('nav-menu-close')?.click();
            this.focusMap();
            return;
        }

        const updatesModal = document.getElementById('updates-modal-overlay');
        if (updatesModal && updatesModal.style.display !== 'none') {
            document.getElementById('updates-modal-close')?.click();
            this.focusMap();
            return;
        }

        const layerInfoModal = document.getElementById('layer-info-modal');
        if (layerInfoModal && layerInfoModal.style.display !== 'none') {
            window.postMessage({ type: 'close-layer-info' }, '*');
            this.focusMap();
            return;
        }

        const mapBrowser = document.querySelector('iframe[src*="map-browser.html"]');
        if (mapBrowser && mapBrowser.offsetParent !== null) {
            const closeBtn = mapBrowser.contentWindow?.document?.getElementById('close-browser-btn');
            if (closeBtn) {
                closeBtn.click();
            } else {
                window.postMessage({ type: 'close-browser' }, '*');
            }
            this.focusMap();
            return;
        }

        const exportIframe = document.querySelector('iframe[src*="map-export.html"]');
        if (exportIframe && exportIframe.offsetParent !== null) {
            window.postMessage({ type: 'export-close' }, '*');
            this.focusMap();
            return;
        }

        if (this.activeModal) {
            this.closeActiveModal();
            this.focusMap();
            return;
        }

        this.focusMap();
    }

    isInputActive() {
        const active = document.activeElement;
        if (!active) return false;
        if (
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.isContentEditable ||
            active.closest('mapbox-search-box') ||
            active.tagName === 'SL-INPUT' ||
            active.tagName === 'SL-SELECT' ||
            active.closest('sl-input') ||
            active.closest('sl-select')
        ) return true;
        // Shoelace components delegate focus into their shadow DOM; the light-DOM
        // active element becomes the sl-* host. Also catch focus inside shadow roots.
        const host = active.getRootNode?.()?.host;
        return Boolean(host && (
            host.tagName === 'SL-INPUT' ||
            host.tagName === 'SL-SELECT' ||
            host.closest('sl-input') ||
            host.closest('sl-select')
        ));
    }

    focusSearch() {
        const searchBox = document.querySelector('mapbox-search-box');

        if (searchBox) {
            if (searchBox.shadowRoot) {
                const input = searchBox.shadowRoot.querySelector('input');
                if (input) {
                    input.focus();
                    return true;
                }
            }

            if (typeof searchBox.focus === 'function') {
                searchBox.focus();
                return true;
            }
        }

        const geocoderInput = document.querySelector('.mapboxgl-ctrl-geocoder--input');
        if (geocoderInput) {
            geocoderInput.focus();
            return true;
        }

        const anyInput = document.querySelector('#mapbox-search-box input, [id*="search"] input');
        if (anyInput) {
            anyInput.focus();
            return true;
        }

        return false;
    }

    focusMap() {
        const mapCanvas = document.querySelector('.mapboxgl-canvas');
        if (mapCanvas) {
            mapCanvas.focus();
            return true;
        }

        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.focus();
            return true;
        }

        return false;
    }

    toggleMapBrowser() {
        const trigger = document.querySelector('[data-action="toggle-map-browser"]');
        if (trigger) {
            trigger.click();
        }
    }

    focusLayerControls() {
        const layerControl = document.querySelector('.map-layer-controls');
        if (layerControl) {
            const firstCheckbox = layerControl.querySelector('sl-checkbox, input[type="checkbox"]');
            if (firstCheckbox) {
                firstCheckbox.focus();
            }
        }
    }

    triggerCenterSelection() {
        window.postMessage({
            type: 'trigger-center-selection'
        }, '*');
    }

    toggleExportPanel() {
        window.postMessage({
            type: 'toggle-export'
        }, '*');
    }

    openWelcomeScreen() {
        if (window.IntroContentManager) {
            new window.IntroContentManager({ enableAutoClose: false });
        }
    }

    setupIframeFocus(iframeId) {
        const iframe = document.querySelector(`iframe[src*="${iframeId}"]`);
        if (!iframe) return;

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
                    const isVisible = iframe.offsetParent !== null;
                    if (isVisible) {
                        this.focusIframe(iframe);
                    }
                }
            }
        });

        observer.observe(iframe.parentElement || iframe, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }

    focusIframe(iframe) {
        setTimeout(() => {
            try {
                iframe.contentWindow?.focus();

                const searchInput = iframe.contentWindow?.document?.getElementById('search-input');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.setAttribute('aria-label', 'Search maps in browser');
                }
            } catch (e) {
                console.warn('Could not focus iframe:', e);
            }
        }, 100);
    }

    handleModalTabbing(e) {
        const modal = this.activeModal;
        if (!modal) return;

        const focusableElements = modal.querySelectorAll(
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
        }
    }

    registerModal(modalElement) {
        this.activeModal = modalElement;
        this.modalStack.push(modalElement);

        const firstFocusable = modalElement.querySelector(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (firstFocusable) {
            firstFocusable.focus();
        }

        modalElement.setAttribute('role', 'dialog');
        modalElement.setAttribute('aria-modal', 'true');
    }

    closeActiveModal() {
        this.modalStack.pop();
        this.activeModal = this.modalStack[this.modalStack.length - 1] || null;
    }

    announceToScreenReader(message) {
        const announcement = document.createElement('div');
        announcement.setAttribute('role', 'status');
        announcement.setAttribute('aria-live', 'polite');
        announcement.setAttribute('aria-atomic', 'true');
        announcement.className = 'sr-only';
        announcement.style.position = 'absolute';
        announcement.style.left = '-10000px';
        announcement.style.width = '1px';
        announcement.style.height = '1px';
        announcement.style.overflow = 'hidden';
        announcement.textContent = message;

        document.body.appendChild(announcement);

        setTimeout(() => {
            document.body.removeChild(announcement);
        }, 1000);
    }

    enhanceAccessibility() {
        document.querySelectorAll('button:not([aria-label])').forEach(button => {
            const text = button.textContent?.trim() || button.title || 'Button';
            button.setAttribute('aria-label', text);
        });

        document.querySelectorAll('a:not([aria-label])').forEach(link => {
            if (!link.textContent?.trim()) {
                link.setAttribute('aria-label', link.href || 'Link');
            }
        });

        const mapContainer = document.getElementById('map');
        if (mapContainer && !mapContainer.getAttribute('aria-label')) {
            mapContainer.setAttribute('role', 'application');
            mapContainer.setAttribute('aria-label', 'Interactive map');
        }
    }
}

export function initializeKeyboardController() {
    if (window.keyboardController) return window.keyboardController;

    const controller = new KeyboardController();
    controller.enhanceAccessibility();
    window.keyboardController = controller;
    return controller;
}

export class NavigationControl {

    constructor(file = './config/navigation_links.json', target = 'top-header') {
        this.file = file;
        this.target = target;
    }

    async render() {
        try {
            const response = await fetch(this.file);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            const container = document.getElementById(this.target);

            if (!container) {
                console.error(`NavigationControl: #${this.target} element not found`);
                return;
            }

            // Clear existing content if any
            container.innerHTML = '';

            if (data.items) {
                data.items.forEach(item => {
                    const element = this.createElement(item);
                    container.appendChild(element);
                });
            }

            this.attachEventListeners(container);
        } catch (error) {
            console.error('NavigationControl: Failed to load or render links', error);
        }
    }

    attachEventListeners(container) {
        container.addEventListener('click', (event) => {
            const menuItem = event.target.closest('sl-menu-item');
            if (!menuItem) return;

            // Handle help menu item click
            if (menuItem.id === 'help-menu-item') {
                event.preventDefault();
                // Create new IntroContentManager instance without auto-close
                // Assuming IntroContentManager is available globally
                if (window.IntroContentManager) {
                    new window.IntroContentManager({ enableAutoClose: false });
                } else {
                    console.error('IntroContentManager is not defined');
                }
                return;
            }

            // Handle game menu item click
            if (menuItem.id === 'game-menu-item') {
                event.preventDefault();
                const currentHash = window.location.hash;
                window.location.href = './game/' + currentHash;
                return;
            }

            // Handle href navigation
            const href = menuItem.getAttribute('href');
            if (href) {
                if (href.startsWith('http')) {
                    // External links - open in new tab if target="_blank"
                    if (menuItem.getAttribute('target') === '_blank') {
                        event.preventDefault();
                        window.open(href, '_blank');
                    }
                } else {
                    // Internal navigation
                    if (!menuItem.hasAttribute('onclick')) {
                        event.preventDefault();
                        window.location.href = href;
                    }
                }
            }
        });
    }

    createElement(config) {
        const element = document.createElement(config.element);

        if (config.attributes) {
            Object.entries(config.attributes).forEach(([key, value]) => {
                element.setAttribute(key, value);
            });
        }

        if (config.innerHTML) {
            element.innerHTML = config.innerHTML;
        }

        if (config.children) {
            config.children.forEach(childConfig => {
                const child = this.createElement(childConfig);
                element.appendChild(child);
            });
        }

        return element;
    }
}
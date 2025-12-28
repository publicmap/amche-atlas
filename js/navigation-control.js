import { IntroContentManager } from './intro-content-manager.js';
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
                throw new Error(`NavigationControl: #${this.target} element not found`);
            }

            // Clear existing content if any
            container.innerHTML = '';

            if (data.items) {
                data.items.forEach(item => {
                    container.appendChild(this.createElement(item));
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
            event.preventDefault();

            // Handle help menu item click
            if (menuItem.id === 'help-menu-item') {
                new IntroContentManager({enableAutoClose: false});
                return;
            }

            // Handle href navigation
            let href = menuItem.getAttribute('href');
            const target = menuItem.getAttribute('target');
            
            // Preserve hash parameters when navigating to relative URLs
            if (href && !href.startsWith('http') && window.location.hash) {
                href = href + window.location.hash;
            }
            
            window.open(href, target);
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
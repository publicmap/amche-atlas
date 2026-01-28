import { IntroContentManager } from './intro-content-manager.js';

export class NavigationControl {
    constructor(file = './config/navigation_links.json') {
        this.file = file;
        this._overlay = null;
        this._iframe = null;
        this._isOpen = false;
        this._menuData = null;
        this._setupMessageListener();
    }

    async render() {
        try {
            const response = await fetch(this.file);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this._menuData = await response.json();

            this._createOverlay();
            this._setupSiteNameTrigger();
        } catch (error) {
            console.error('NavigationControl: Failed to load menu data', error);
        }
    }

    _createOverlay() {
        this._overlay = document.createElement('div');
        this._overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            display: none;
        `;

        const menuContainer = document.createElement('div');
        menuContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 300px;
            height: 100%;
            background: #1f2937;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        `;

        // Responsive width
        if (window.matchMedia('(max-width: 640px)').matches) {
            menuContainer.style.width = '280px';
        }

        window.addEventListener('resize', () => {
            if (window.matchMedia('(max-width: 640px)').matches) {
                menuContainer.style.width = '280px';
            } else {
                menuContainer.style.width = '300px';
            }
        });

        this._iframe = document.createElement('iframe');
        this._iframe.src = 'menu.html';
        this._iframe.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
        `;

        menuContainer.appendChild(this._iframe);
        this._overlay.appendChild(menuContainer);
        document.body.appendChild(this._overlay);

        this._overlay.addEventListener('click', (e) => {
            if (e.target === this._overlay) {
                this.closeMenu();
            }
        });
    }

    _setupMessageListener() {
        window.addEventListener('message', (event) => {
            if (event.data.type === 'request-menu-data') {
                this._sendMenuData();
            }

            if (event.data.type === 'close-menu') {
                this.closeMenu();
            }

            if (event.data.type === 'menu-action') {
                if (event.data.action === 'show-help') {
                    new IntroContentManager({enableAutoClose: false});
                }
            }
        });
    }

    _sendMenuData() {
        if (!this._menuData || !this._iframe) return;

        // Parse navigation_links.json structure into simple menu items
        const menuItems = this._parseMenuItems(this._menuData);

        this._iframe.contentWindow.postMessage({
            type: 'menu-data',
            items: menuItems
        }, '*');
    }

    _parseMenuItems(data) {
        const items = [];

        if (data.items && data.items.length > 0) {
            const dropdown = data.items[0];
            if (dropdown.children) {
                dropdown.children.forEach(child => {
                    if (child.element === 'sl-menu' && child.children) {
                        child.children.forEach(menuChild => {
                            items.push(this._parseMenuItem(menuChild));
                        });
                    }
                });
            }
        }

        return items;
    }

    _parseMenuItem(config) {
        if (config.element === 'sl-divider') {
            return { element: 'divider' };
        }

        if (config.element === 'sl-menu-item') {
            const item = {
                element: 'menu-item',
                text: this._extractText(config.innerHTML),
                icon: this._extractIcon(config.innerHTML),
                href: config.attributes?.href || '#',
                target: config.attributes?.target || '_self',
                id: config.attributes?.id || null
            };

            return item;
        }

        return null;
    }

    _extractText(innerHTML) {
        if (!innerHTML) return '';
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = innerHTML;
        // Remove icon elements, keep text
        const svgs = tempDiv.querySelectorAll('svg');
        svgs.forEach(svg => svg.remove());
        const icons = tempDiv.querySelectorAll('sl-icon');
        icons.forEach(icon => icon.remove());
        return tempDiv.textContent.trim();
    }

    _extractIcon(innerHTML) {
        if (!innerHTML) return null;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = innerHTML;
        const svg = tempDiv.querySelector('svg');
        return svg ? svg.outerHTML : null;
    }

    _setupSiteNameTrigger() {
        const siteNameBtn = document.getElementById('site-name-nav-trigger');
        if (siteNameBtn) {
            siteNameBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openMenu();
            });
        }
    }

    openMenu() {
        if (this._overlay) {
            this._overlay.style.display = 'block';
            this._isOpen = true;

            setTimeout(() => {
                this._sendMenuData();
            }, 100);
        }
    }

    closeMenu() {
        if (this._overlay) {
            this._overlay.style.display = 'none';
            this._isOpen = false;
        }
    }
}

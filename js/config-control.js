/**
 * Config Control Module
 * Handles expanding navigation menu with layers from config files
 * and adding them to the currently loaded configuration
 */

export class ConfigControl {
    constructor() {
        this.configCache = new Map();
        this.currentLayerControl = null;
        this.initialized = false;
    }

    /**
     * Initialize the config control system
     * @param {MapLayerControl} layerControl - The current layer control instance
     */
    async initialize(layerControl) {
        this.currentLayerControl = layerControl;
        
        if (this.initialized) {
            return;
        }
        
        try {
            await this.expandNavigationMenu();
            this.initialized = true;
        } catch (error) {
            console.error('Failed to initialize config control:', error);
        }
    }

    /**
     * Expand the navigation menu with layers from each config
     */
    async expandNavigationMenu() {
        // Wait for Shoelace components to be ready
        await customElements.whenDefined('sl-menu-item');
        
        // Extract config menu items directly from the HTML
        const configMenuItems = this.extractConfigMenuItems();

        for (const item of configMenuItems) {
            await this.expandConfigMenuItem(item.name, item.config);
        }
    }

    /**
     * Extract config menu items from the HTML navigation menu
     * @returns {Array} Array of config items with name and config properties
     */
    extractConfigMenuItems() {
        const configMenuItems = [];
        
        // Find all menu items with href attributes
        const menuItems = document.querySelectorAll('sl-menu-item[href]');
        
        for (const menuItem of menuItems) {
            const href = menuItem.getAttribute('href');
            const displayName = menuItem.textContent.trim();
            
            let configName = null;
            
            // Parse the href to extract config name
            if (href === './') {
                configName = 'index';
            } else if (href.startsWith('./?atlas=')) {
                configName = href.replace('./?atlas=', '');
            }
            
            // Only include items that have atlas configs (skip other navigation items)
            if (configName) {
                configMenuItems.push({
                    name: displayName,
                    config: configName
                });
            }
        }
        
        return configMenuItems;
    }

    /**
     * Expand a specific config menu item with its layers
     * @param {string} configName - Display name of the config
     * @param {string} configFile - Config file name (without .json)
     */
    async expandConfigMenuItem(configName, configFile) {
        try {
            // Find the menu item for this config
            const menuItems = document.querySelectorAll('sl-menu-item[href]');
            let targetMenuItem = null;
            
            for (const item of menuItems) {
                const href = item.getAttribute('href');
                const itemName = item.textContent.trim();
                
                // Match by both href and name to ensure we get the right item
                if (itemName === configName && 
                    ((configFile === 'index' && href === './') || 
                     href === `./?atlas=${configFile}`)) {
                    targetMenuItem = item;
                    break;
                }
            }

            if (!targetMenuItem) {
                console.warn(`Could not find menu item for config: ${configName} (looking for href="./?atlas=${configFile}" or "./" for index)`);
                return;
            }

            // Load the config if not cached
            const config = await this.loadConfig(configFile);
            if (!config || !config.layers) {
                console.warn(`No layers found in config: ${configFile}`);
                return;
            }

            // Group layers by type for better organization
            const layersByType = this.groupLayersByType(config.layers);
            
            // Create submenu for this config
            const submenu = document.createElement('sl-menu');
            submenu.setAttribute('slot', 'submenu');
            
            // Add layers organized by type
            for (const [type, layers] of Object.entries(layersByType)) {
                if (layers.length === 0) continue;
                
                // Add type header
                const typeLabel = document.createElement('sl-menu-label');
                typeLabel.textContent = this.getTypeDisplayName(type);
                submenu.appendChild(typeLabel);
                
                // Add layers of this type
                for (const layer of layers) {
                    const layerItem = this.createLayerMenuItem(layer, configFile);
                    submenu.appendChild(layerItem);
                }
                
                // Add divider after each type (except the last one)
                const types = Object.keys(layersByType);
                if (type !== types[types.length - 1]) {
                    const divider = document.createElement('sl-divider');
                    submenu.appendChild(divider);
                }
            }

            // Replace the simple menu item with one that has a submenu
            const newMenuItem = document.createElement('sl-menu-item');
            newMenuItem.innerHTML = `
                <svg slot="prefix" class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M12 1.586l-4 4v12.828l4-4V1.586zM3.707 3.293A1 1 0 002 4v10a1 1 0 00.293.707L6 18.414V5.586L3.707 3.293zM17.707 5.293L14 1.586v12.828l2.293 2.293A1 1 0 0018 16V6a1 1 0 00-.293-.707z" clip-rule="evenodd"/>
                </svg>
                ${configName}
            `;
            
            // Add the original navigation functionality
            const originalHref = targetMenuItem.getAttribute('href');
            newMenuItem.addEventListener('click', (event) => {
                // Only navigate if clicking on the main item, not submenu
                if (event.target === newMenuItem) {
                    window.location.href = originalHref;
                }
            });
            
            // Add submenu
            newMenuItem.appendChild(submenu);
            
            // Replace the original menu item
            targetMenuItem.parentNode.replaceChild(newMenuItem, targetMenuItem);
            
        } catch (error) {
            console.error(`Failed to expand config menu for ${configName}:`, error);
        }
    }

    /**
     * Load a config file and cache it
     * @param {string} configFile - Config file name (without .json)
     * @returns {Object} The loaded config
     */
    async loadConfig(configFile) {
        if (this.configCache.has(configFile)) {
            return this.configCache.get(configFile);
        }

        try {
            let configPath;
            if (configFile === 'index') {
                configPath = 'config/index.atlas.json';
            } else if (configFile.startsWith('examples/')) {
                configPath = `config/${configFile}.atlas.json`;
            } else {
                configPath = `config/${configFile}.atlas.json`;
            }
            const response = await fetch(configPath);
            
            if (!response.ok) {
                throw new Error(`Failed to load config: ${response.status}`);
            }
            
            const config = await response.json();
            
            // Process layers with library lookup (similar to map-init.js)
            await this.processConfigLayers(config);
            
            this.configCache.set(configFile, config);
            return config;
            
        } catch (error) {
            console.error(`Error loading config ${configFile}:`, error);
            return null;
        }
    }

    /**
     * Process config layers by looking up library definitions
     * @param {Object} config - The config object to process
     */
    async processConfigLayers(config) {
        try {
            const libraryResponse = await fetch('config/_map-layer-presets.json');
            const layerLibrary = await libraryResponse.json();
            
            if (config.layers && Array.isArray(config.layers)) {
                config.layers = config.layers.map(layerConfig => {
                    // If the layer only has an id, look it up in the library
                    if (layerConfig.id && !layerConfig.type) {
                        const libraryLayer = layerLibrary.layers.find(lib => lib.id === layerConfig.id);
                        if (libraryLayer) {
                            return { ...libraryLayer, ...layerConfig };
                        }
                    }
                    return layerConfig;
                });
            }
        } catch (error) {
            console.warn('Could not load layer library for config processing:', error);
        }
    }

    /**
     * Group layers by their type
     * @param {Array} layers - Array of layer objects
     * @returns {Object} Layers grouped by type
     */
    groupLayersByType(layers) {
        const groups = {
            'base': [],
            'geojson': [],
            'vector': [],
            'tms': [],
            'csv': [],
            'other': []
        };

        for (const layer of layers) {
            if (!layer.title) continue; // Skip layers without titles (like base maps)
            
            const type = layer.type || 'other';
            if (groups[type]) {
                groups[type].push(layer);
            } else {
                groups.other.push(layer);
            }
        }

        // Remove empty groups
        Object.keys(groups).forEach(key => {
            if (groups[key].length === 0) {
                delete groups[key];
            }
        });

        return groups;
    }

    /**
     * Get display name for layer type
     * @param {string} type - Layer type
     * @returns {string} Display name
     */
    getTypeDisplayName(type) {
        const typeNames = {
            'base': 'Base Maps',
            'geojson': 'GeoJSON Layers',
            'vector': 'Vector Layers', 
            'tms': 'Tile Layers',
            'csv': 'Data Layers',
            'other': 'Other Layers'
        };
        return typeNames[type] || 'Other Layers';
    }

    /**
     * Create a menu item for a layer
     * @param {Object} layer - Layer configuration
     * @param {string} configFile - Source config file
     * @returns {HTMLElement} Menu item element
     */
    createLayerMenuItem(layer, configFile) {
        const menuItem = document.createElement('sl-menu-item');
        
        // Add CSS class for styling
        menuItem.classList.add('config-layer-item');
        
        // Create icon based on layer type
        const icon = this.getLayerTypeIcon(layer.type);
        
        menuItem.innerHTML = `
            <svg slot="prefix" class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                ${icon}
            </svg>
            ${layer.title}
        `;

        // Add background image if available
        if (layer.headerImage) {
            menuItem.style.setProperty('--layer-bg-image', `url('${layer.headerImage}')`);
            menuItem.classList.add('has-background-image');
        }

        // Add click handler to add layer to current config
        menuItem.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.addLayerToCurrentConfig(layer, configFile);
        });

        return menuItem;
    }

    /**
     * Get SVG icon path for layer type
     * @param {string} type - Layer type
     * @returns {string} SVG path
     */
    getLayerTypeIcon(type) {
        const icons = {
            'geojson': '<path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"/>',
            'vector': '<path fill-rule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>',
            'tms': '<path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd"/>',
            'csv': '<path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/>'
        };
        return icons[type] || icons['geojson'];
    }

    /**
     * Add a layer to the current configuration
     * @param {Object} layer - Layer to add
     * @param {string} sourceConfig - Source config file name
     */
    async addLayerToCurrentConfig(layer, sourceConfig) {
        if (!this.currentLayerControl) {
            console.error('No layer control instance available');
            this.showToast('Layer control not available', 'error');
            return;
        }

        try {
            // Check if layer already exists to avoid duplicates
            const currentState = this.currentLayerControl._state;
            const existingLayer = currentState.groups.find(g => 
                g.id === `${sourceConfig}-${layer.id}` || 
                (g._originalId === layer.id && g._sourceConfig === sourceConfig)
            );
            
            if (existingLayer) {
                this.showToast(`Layer "${layer.title}" from ${sourceConfig} is already added`, 'warning');
                return;
            }

            // Create a copy of the layer with a unique ID to avoid conflicts
            const newLayer = {
                ...layer,
                id: `${sourceConfig}-${layer.id}`,
                title: `${layer.title} (${sourceConfig})`,
                _sourceConfig: sourceConfig,
                _originalId: layer.id,
                initiallyChecked: true // Auto-enable imported layers
            };

            
            // Find the position to insert the new layer
            const insertPosition = this.findInsertPosition(currentState.groups, newLayer);
            
            // Create new state with the added layer
            const newGroups = [...currentState.groups];
            newGroups.splice(insertPosition, 0, newLayer);
            
            
            // Update the layer control state
            this.currentLayerControl._updateState({
                groups: newGroups
            });

            // Show success message
            this.showToast(`Added and enabled "${layer.title}" from ${sourceConfig} config`, 'success');
            
        } catch (error) {
            console.error('Failed to add layer to current config:', error);
            this.showToast(`Failed to add layer: ${error.message}`, 'error');
        }
    }

    /**
     * Find the position to insert a new layer based on type
     * @param {Array} currentGroups - Current layer groups
     * @param {Object} newLayer - Layer to insert
     * @returns {number} Insert position
     */
    findInsertPosition(currentGroups, newLayer) {
        const newLayerType = newLayer.type || 'other';
        
        // Define type priority order (higher priority types go first)
        const typePriority = {
            'geojson': 1,
            'csv': 2,
            'vector': 3,
            'tms': 4,
            'other': 5
        };
        
        const newLayerPriority = typePriority[newLayerType] || typePriority['other'];
        
        // Find the position to insert based on type priority
        for (let i = 0; i < currentGroups.length; i++) {
            const currentType = currentGroups[i].type || 'other';
            const currentPriority = typePriority[currentType] || typePriority['other'];
            
            // If we find a layer with lower priority (higher number), insert before it
            if (currentPriority > newLayerPriority) {
                return i;
            }
            
            // If same priority, find the last layer of the same type and insert after it
            if (currentPriority === newLayerPriority) {
                let lastSameTypeIndex = i;
                // Look ahead to find the last layer of this type
                for (let j = i + 1; j < currentGroups.length; j++) {
                    const nextType = currentGroups[j].type || 'other';
                    const nextPriority = typePriority[nextType] || typePriority['other'];
                    if (nextPriority === currentPriority) {
                        lastSameTypeIndex = j;
                    } else {
                        break;
                    }
                }
                return lastSameTypeIndex + 1;
            }
        }
        
        // If no suitable position found, append at the end
        return currentGroups.length;
    }

    /**
     * Show a toast notification
     * @param {string} message - Message to show
     * @param {string} type - Toast type (success, error, warning)
     */
    showToast(message, type = 'success') {
        // Use the layer control's toast method if available
        if (this.currentLayerControl && this.currentLayerControl._showToast) {
            this.currentLayerControl._showToast(message, type);
        } else {
            // Fallback to console
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}

// Create and export a singleton instance
export const configControl = new ConfigControl(); 
/**
 * AtlasLayerMenuControl - header-nav button (top-left) showing the active
 * atlas name. Opens a nested menu: every atlas in window.layerRegistry at
 * the first level, every one of that atlas's map layers at the second level.
 * Clicking a layer toggles it on/off using the exact same code path as
 * map-browser.html (MapBrowserControl._handleLayerToggle/_getActiveLayers),
 * so behavior (including dynamically adding a layer from a non-active atlas)
 * matches exactly.
 *
 * Not a mapboxgl control - this lives in the header-nav DOM, not on the map.
 */
export class AtlasLayerMenuControl {
    constructor(browserControl) {
        this._browserControl = browserControl;
        this._container = null;
        this._button = null;
        this._label = null;
        this._panel = null;
        this._isOpen = false;
        this._expandedAtlases = new Set();

        this._refreshTimer = null;
        this._onUrlUpdated = () => this._updateButtonLabel();
        // Debounced: window.urlManager's active-layers list (what
        // _getActiveLayers() reads) updates on its own 300ms debounce (see
        // CLAUDE.md), so reading it synchronously on 'layer-toggled' would
        // read stale state and immediately revert our own optimistic toggle.
        this._onLayerToggled = () => {
            if (!this._isOpen) return;
            clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => this._refreshActiveStates(), 400);
        };
        this._onDocClick = (e) => {
            if (!this._isOpen || this._container.contains(e.target)) return;
            this.close();
        };
    }

    mount(hostEl) {
        if (!hostEl) return;

        this._container = document.createElement('div');
        this._container.className = 'atlas-layer-menu';

        this._button = document.createElement('button');
        this._button.type = 'button';
        this._button.className = 'atlas-layer-menu-btn';
        this._button.setAttribute('aria-label', 'Browse atlases and map layers');

        this._label = document.createElement('span');
        this._label.className = 'atlas-layer-menu-label';
        this._button.appendChild(this._label);

        const chevron = document.createElement('sl-icon');
        chevron.setAttribute('name', 'chevron-down');
        chevron.className = 'atlas-layer-menu-chevron';
        this._button.appendChild(chevron);

        this._button.addEventListener('click', () => this.toggle());

        this._panel = document.createElement('div');
        this._panel.className = 'atlas-layer-menu-panel';
        this._panel.style.display = 'none';

        this._container.appendChild(this._button);
        this._container.appendChild(this._panel);
        hostEl.appendChild(this._container);

        this._updateButtonLabel();
        window.addEventListener('urlUpdated', this._onUrlUpdated);
        window.addEventListener('layer-toggled', this._onLayerToggled);
        document.addEventListener('click', this._onDocClick);

        // Some atlas switches (e.g. splash-screen geolocation auto-select)
        // rewrite the URL via history.replaceState with no matching event, so
        // poll as a fallback to keep the label honest even when the menu is
        // never opened.
        this._lastAtlasId = window.layerRegistry?.getCurrentAtlas?.() || null;
        this._pollTimer = setInterval(() => {
            const atlasId = window.layerRegistry?.getCurrentAtlas?.() || null;
            if (atlasId !== this._lastAtlasId) {
                this._lastAtlasId = atlasId;
                this._updateButtonLabel();
            }
        }, 1000);
    }

    _updateButtonLabel() {
        if (!this._label) return;
        const atlasId = window.layerRegistry?.getCurrentAtlas?.() || 'index';
        const metadata = window.layerRegistry?.getAtlasMetadata(atlasId);
        this._label.textContent = metadata?.name || atlasId;
    }

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    }

    async open() {
        this._isOpen = true;
        this._panel.style.display = 'block';
        this._button.classList.add('active');
        this._panel.innerHTML = '<div class="atlas-layer-menu-loading">Loading atlases…</div>';
        // Some atlas switches (e.g. splash-screen geolocation auto-select)
        // rewrite the URL via history.replaceState with no 'urlUpdated' event,
        // so refresh the label here too rather than relying on that alone.
        this._updateButtonLabel();

        // "Full" registry - include deferred external atlases too, same as
        // map-browser.html does when it opens (openBrowser()).
        if (window.layerRegistry?.ensureAllAtlasesLoaded) {
            await window.layerRegistry.ensureAllAtlasesLoaded();
        }
        if (!this._isOpen) return; // closed while awaiting

        this._render();
    }

    close() {
        this._isOpen = false;
        if (this._panel) this._panel.style.display = 'none';
        this._button?.classList.remove('active');
    }

    _render() {
        const registry = window.layerRegistry;
        this._panel.innerHTML = '';
        if (!registry) return;

        const currentAtlasId = registry.getCurrentAtlas?.() || 'index';
        const atlases = registry.getAllAtlasMetadata()
            .slice()
            .sort((a, b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0]));

        atlases.forEach(([atlasId, metadata]) => {
            this._panel.appendChild(this._buildAtlasRow(atlasId, metadata, atlasId === currentAtlasId));
        });
    }

    _buildAtlasRow(atlasId, metadata, isCurrent) {
        const wrapper = document.createElement('div');
        wrapper.className = 'atlas-layer-menu-atlas';

        const header = document.createElement('div');
        header.className = 'atlas-layer-menu-atlas-header';
        if (isCurrent) header.classList.add('current');

        const expanded = this._expandedAtlases.has(atlasId);

        const chevron = document.createElement('span');
        chevron.className = 'atlas-layer-menu-atlas-chevron';
        chevron.textContent = expanded ? '▾' : '▸';

        const name = document.createElement('span');
        name.className = 'atlas-layer-menu-atlas-name';
        name.textContent = metadata.name || atlasId;

        const layerRefs = this._browserControl._getAtlasLayerReferenceIds(atlasId);
        const count = document.createElement('span');
        count.className = 'atlas-layer-menu-atlas-count';
        count.textContent = String(new Set(layerRefs).size);

        header.appendChild(chevron);
        header.appendChild(name);
        header.appendChild(count);

        const layersEl = document.createElement('div');
        layersEl.className = 'atlas-layer-menu-layers';
        layersEl.style.display = expanded ? 'block' : 'none';

        header.addEventListener('click', () => {
            const nowExpanded = layersEl.style.display === 'none';
            layersEl.style.display = nowExpanded ? 'block' : 'none';
            chevron.textContent = nowExpanded ? '▾' : '▸';
            if (nowExpanded) {
                this._expandedAtlases.add(atlasId);
                if (!layersEl.dataset.built) this._buildLayerRows(layersEl, atlasId);
            } else {
                this._expandedAtlases.delete(atlasId);
            }
        });

        wrapper.appendChild(header);
        wrapper.appendChild(layersEl);

        if (expanded) this._buildLayerRows(layersEl, atlasId);

        return wrapper;
    }

    _buildLayerRows(layersEl, atlasId) {
        layersEl.dataset.built = 'true';
        layersEl.innerHTML = '';

        const registry = window.layerRegistry;
        const configs = registry.getAtlasLayers(atlasId);
        const resolvedIds = this._browserControl._getAtlasLayerReferenceIds(atlasId);
        const activeIds = this._browserControl._getActiveLayers();

        configs.forEach((config, i) => {
            const resolvedId = resolvedIds[i];
            const layer = registry.getLayer(resolvedId, atlasId, true) || config;
            const title = layer.title || layer.id || resolvedId;
            const isActive = activeIds.has(resolvedId);

            const row = document.createElement('div');
            row.className = 'atlas-layer-menu-layer-row';
            row.dataset.layerId = resolvedId;

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'atlas-layer-menu-toggle';
            toggle.classList.toggle('on', isActive);
            toggle.innerHTML = `<sl-icon name="${isActive ? 'eye' : 'eye-slash'}"></sl-icon>`;
            toggle.setAttribute('aria-label', isActive ? `Hide ${title}` : `Show ${title}`);

            const label = document.createElement('span');
            label.className = 'atlas-layer-menu-layer-title';
            label.textContent = title;

            row.appendChild(toggle);
            row.appendChild(label);

            row.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (row.classList.contains('loading')) return; // toggle already in flight
                const currentlyActive = toggle.classList.contains('on');
                const nextActive = !currentlyActive;
                row.classList.add('loading');
                try {
                    await this._browserControl._handleLayerToggle(resolvedId, nextActive);
                } finally {
                    row.classList.remove('loading');
                }
                toggle.classList.toggle('on', nextActive);
                toggle.querySelector('sl-icon')?.setAttribute('name', nextActive ? 'eye' : 'eye-slash');
                toggle.setAttribute('aria-label', nextActive ? `Hide ${title}` : `Show ${title}`);
            });

            layersEl.appendChild(row);
        });
    }

    _refreshActiveStates() {
        if (!this._panel) return;
        const activeIds = this._browserControl._getActiveLayers();
        this._panel.querySelectorAll('.atlas-layer-menu-layer-row').forEach(row => {
            const id = row.dataset.layerId;
            const toggle = row.querySelector('.atlas-layer-menu-toggle');
            if (!toggle) return;
            const isActive = activeIds.has(id);
            toggle.classList.toggle('on', isActive);
            toggle.querySelector('sl-icon')?.setAttribute('name', isActive ? 'eye' : 'eye-slash');
        });
    }
}

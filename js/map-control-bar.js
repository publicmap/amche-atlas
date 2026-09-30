export class MapControlBar {
    constructor() {
        this._el = null;
        this._iconEl = null;
        this._nameEl = null;
        this._countEl = null;
        this._iconKey = null;
        this._imageKey = null;
        this._main = null;
        this._trigger = null;
        this._observer = null;
        this._layerCount = null;
        this._onAtlasChanged = () => this.update(this._layerCount);
    }

    mount(hostEl, { triggerButton = null, editButton = null } = {}) {
        this._trigger = triggerButton;
        this._el = document.createElement('div');
        this._el.className = 'map-control-bar';

        this._main = document.createElement('button');
        this._main.type = 'button';
        this._main.className = 'map-control-bar-main';
        this._main.title = 'Browse all maps';
        this._main.addEventListener('click', (e) => {
            e.stopPropagation();
            this._trigger?.click();
        });
        this._main.addEventListener('pointerenter', () => {
            this._trigger?.dispatchEvent(new Event('pointerenter'));
        }, { once: true });

        this._iconEl = document.createElement('span');
        this._iconEl.className = 'map-control-bar-icon';
        const iconWrap = document.createElement('span');
        iconWrap.className = 'map-control-bar-icon-wrap';
        const spinner = document.createElement('sl-spinner');
        spinner.className = 'map-control-bar-spinner';
        iconWrap.append(this._iconEl, spinner);

        const text = document.createElement('span');
        text.className = 'map-control-bar-text';
        this._nameEl = document.createElement('span');
        this._nameEl.className = 'map-control-bar-name';
        this._countEl = document.createElement('span');
        this._countEl.className = 'map-control-bar-count';
        text.append(this._nameEl, this._countEl);
        this._main.append(iconWrap, text);

        const slot = document.createElement('div');
        slot.className = 'map-control-bar-search-slot';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'map-control-bar-search-btn';
        toggle.title = 'Search places';
        toggle.setAttribute('aria-label', 'Search places');
        toggle.innerHTML = '<sl-icon name="search"></sl-icon>';
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this._expandSearch();
        });
        slot.appendChild(toggle);
        slot.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this._searchInput()?.blur();
                this._collapseSearch(true);
            }
        });
        this._el.addEventListener('focusin', (e) => {
            if (e.target.closest?.('mapbox-search-box')) this._el.classList.add('searching');
        });
        this._el.addEventListener('focusout', () => setTimeout(() => this._collapseSearch(), 150));

        if (editButton) this._el.appendChild(editButton);
        this._el.append(this._main, slot);
        hostEl.appendChild(this._el);
        hostEl.classList.add('has-map-control-bar');

        window.addEventListener('atlasChanged', this._onAtlasChanged);

        if (this._trigger) {
            const sync = () => this._el?.classList.toggle('active', this._trigger.classList.contains('active'));
            this._observer = new MutationObserver(sync);
            this._observer.observe(this._trigger, { attributes: true, attributeFilter: ['class'] });
            sync();
        }
    }

    _searchInput() {
        const box = document.querySelector('mapbox-search-box');
        return box?.shadowRoot?.querySelector('input') || box?.querySelector('input') || null;
    }

    _expandSearch() {
        this._el.classList.add('searching');
        requestAnimationFrame(() => {
            const input = this._searchInput();
            if (input) input.focus();
            else document.querySelector('mapbox-search-box')?.focus?.();
        });
    }

    _collapseSearch(force = false) {
        if (!this._el) return;
        const box = document.querySelector('mapbox-search-box');
        if (!force && (this._el.matches(':focus-within') || box?.matches(':focus-within'))) return;
        if (!force && this._searchInput()?.value) return;
        this._el.classList.remove('searching');
    }

    setVisible(visible) {
        if (this._el) this._el.style.display = visible ? '' : 'none';
    }

    update(layerCount) {
        if (!this._el) return;
        this._layerCount = layerCount;
        const registry = window.layerRegistry;
        const resolved = registry?._currentAtlasSet;
        const atlasId = resolved ? registry.getCurrentAtlas() : null;
        const metadata = atlasId ? registry.getAtlasMetadata(atlasId) : null;
        const name = metadata ? (metadata.name || atlasId) : '';

        this._nameEl.textContent = name || 'Loading Atlas';
        this._nameEl.classList.toggle('placeholder', !name);
        this._main.title = name ? `${name} - browse all maps` : 'Browse all maps';
        this._countEl.textContent = layerCount == null ? '' : `Displaying ${layerCount} map layer${layerCount === 1 ? '' : 's'}`;
        this._setIcon(metadata?.icon || null);
        this._setBackground(metadata?.headerImage || null);
    }

    setLoading(loading) {
        this._el?.classList.toggle('loading', !!loading);
    }

    _setBackground(src) {
        if (src === this._imageKey) return;
        this._imageKey = src;
        if (src) this._el.style.setProperty('--bar-image', `url("${src.replace(/"/g, '%22')}")`);
        else this._el.style.removeProperty('--bar-image');
    }

    _setIcon(src) {
        if (src === this._iconKey) return;
        this._iconKey = src;
        this._iconEl.replaceChildren();
        if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            this._iconEl.appendChild(img);
        } else {
            this._iconEl.appendChild(document.createElement('sl-icon')).name = 'map';
        }
    }

    destroy() {
        window.removeEventListener('atlasChanged', this._onAtlasChanged);
        this._observer?.disconnect();
        this._el?.parentNode?.classList.remove('has-map-control-bar');
        this._el?.remove();
        this._el = null;
    }
}

const LONG_NAME_LENGTH = 22;

export class LayerStackAtlasCaption {
    constructor() {
        this._el = null;
        this._iconEl = null;
        this._nameEl = null;
        this._countEl = null;
        this._iconKey = null;
        this._main = null;
        this._trigger = null;
        this._observer = null;
    }

    mount(hostEl, { triggerButton = null } = {}) {
        this._trigger = triggerButton;
        this._el = document.createElement('div');
        this._el.className = 'layer-stack-atlas';

        this._main = document.createElement('button');
        this._main.type = 'button';
        this._main.className = 'layer-stack-atlas-main';
        this._main.title = 'Browse all maps';
        this._main.addEventListener('click', (e) => {
            e.stopPropagation();
            this._trigger?.click();
        });
        this._main.addEventListener('pointerenter', () => {
            this._trigger?.dispatchEvent(new Event('pointerenter'));
        }, { once: true });

        this._iconEl = document.createElement('span');
        this._iconEl.className = 'layer-stack-atlas-icon';

        const text = document.createElement('span');
        text.className = 'layer-stack-atlas-text';
        this._nameEl = document.createElement('span');
        this._nameEl.className = 'layer-stack-atlas-name';
        this._countEl = document.createElement('span');
        this._countEl.className = 'layer-stack-atlas-count';
        text.append(this._nameEl, this._countEl);
        this._main.append(this._iconEl, text);

        const slot = document.createElement('div');
        slot.className = 'layer-stack-atlas-search-slot';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'layer-stack-atlas-search-btn';
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

        this._el.append(this._main, slot);
        hostEl.appendChild(this._el);
        hostEl.classList.add('has-atlas-caption');

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
        const registry = window.layerRegistry;
        const atlasId = registry?.getCurrentAtlas?.();
        const metadata = atlasId ? registry.getAtlasMetadata(atlasId) : null;
        const name = metadata?.name || atlasId || '';

        this._nameEl.textContent = name;
        this._nameEl.classList.toggle('long', name.length > LONG_NAME_LENGTH);
        this._main.title = name ? `${name} - browse all maps` : 'Browse all maps';
        this._countEl.textContent = `Displaying ${layerCount} map layer${layerCount === 1 ? '' : 's'}`;
        this._setIcon(metadata?.icon || null);
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
        this._observer?.disconnect();
        this._el?.parentNode?.classList.remove('has-atlas-caption');
        this._el?.remove();
        this._el = null;
    }
}

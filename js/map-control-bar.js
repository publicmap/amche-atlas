import { SEARCH_SOURCES, isSearchSourceEnabled, setSearchSourceEnabled } from './search/search-sources.js';

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
        this._layers = null;
        this._summaryEl = null;
        this._summaryTextEl = null;
        this._summaryKey = null;
        this._onAtlasChanged = () => this.update(this._layers);
    }

    mount(hostEl, { triggerButton = null, onSummaryClick = null, onSummaryEnter = null, onSummaryLeave = null } = {}) {
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
        this._mountSummary({ onSummaryClick, onSummaryEnter, onSummaryLeave });
        text.append(this._nameEl, this._countEl);
        this._main.append(iconWrap, text);

        const slot = document.createElement('div');
        slot.className = 'map-control-bar-search-slot';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'map-control-bar-search-btn';
        this._searchBtn = toggle;
        toggle.setAttribute('aria-pressed', 'false');
        toggle.title = 'Search places';
        toggle.setAttribute('aria-label', 'Search places');
        toggle.innerHTML = '<sl-icon name="search"></sl-icon>';
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._el.classList.contains('searching')) {
                this._searchInput()?.blur();
                this._collapseSearch(true);
            } else {
                this._expandSearch();
            }
        });
        slot.append(toggle, this._buildSourcesMenu());
        slot.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this._searchInput()?.blur();
                this._collapseSearch(true);
            }
        });
        this._el.addEventListener('focusin', (e) => {
            if (e.target.closest?.('mapbox-search-box')) this._setSearching(true);
        });
        this._el.addEventListener('focusout', () => setTimeout(() => this._collapseSearch(), 150));

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

    _buildSourcesMenu() {
        const dropdown = document.createElement('sl-dropdown');
        dropdown.className = 'map-control-bar-sources';
        dropdown.placement = 'bottom-end';
        dropdown.setAttribute('stay-open-on-select', '');
        dropdown.hoist = true;
        const more = document.createElement('button');
        more.type = 'button';
        more.slot = 'trigger';
        more.className = 'map-control-bar-search-btn map-control-bar-sources-btn';
        more.title = 'Search sources';
        more.setAttribute('aria-label', 'Search sources');
        more.innerHTML = '<sl-icon name="three-dots"></sl-icon>';
        const menu = document.createElement('sl-menu');
        const label = document.createElement('sl-menu-label');
        label.textContent = 'Search in';
        menu.appendChild(label);
        for (const { id, label: text } of SEARCH_SOURCES) {
            const item = document.createElement('sl-menu-item');
            item.type = 'checkbox';
            item.checked = isSearchSourceEnabled(id);
            item.textContent = text;
            item.addEventListener('click', () => setSearchSourceEnabled(id, item.checked));
            menu.appendChild(item);
        }
        dropdown.append(more, menu);
        dropdown.addEventListener('mousedown', (e) => e.preventDefault());
        return dropdown;
    }

    _searchInput() {
        const box = document.querySelector('mapbox-search-box');
        return box?.shadowRoot?.querySelector('input') || box?.querySelector('input') || null;
    }

    _setSearching(on) {
        this._el.classList.toggle('searching', on);
        this._searchBtn?.setAttribute('aria-pressed', String(on));
    }

    _expandSearch() {
        this._setSearching(true);
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
        this._setSearching(false);
    }

    setVisible(visible) {
        if (this._el) this._el.style.display = visible ? '' : 'none';
    }

    update(layers) {
        if (!this._el) return;
        this._layers = layers;
        const registry = window.layerRegistry;
        const resolved = registry?._currentAtlasSet;
        const atlasId = resolved ? registry.getCurrentAtlas() : null;
        const metadata = atlasId ? registry.getAtlasMetadata(atlasId) : null;
        const name = metadata ? (metadata.name || atlasId) : '';

        this._nameEl.textContent = name || 'Loading Atlas';
        this._nameEl.classList.toggle('placeholder', !name);
        this._main.title = name ? `${name} - browse all maps` : 'Browse all maps';
        this._setSummary(layers);
        this._setIcon(metadata?.icon || null);
        this._setBackground(metadata?.headerImage || null);
    }

    _mountSummary({ onSummaryClick, onSummaryEnter, onSummaryLeave }) {
        const summary = document.createElement('span');
        summary.className = 'map-control-bar-summary';
        summary.setAttribute('role', 'button');
        summary.tabIndex = 0;
        summary.title = 'Edit layers';
        const icon = document.createElement('sl-icon');
        icon.name = 'sliders';
        this._summaryTextEl = document.createElement('span');
        summary.append(icon, this._summaryTextEl);
        const activate = (e) => {
            e.stopPropagation();
            onSummaryClick?.();
        };
        summary.addEventListener('click', activate);
        summary.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate(e);
            }
        });
        summary.addEventListener('pointerenter', () => onSummaryEnter?.());
        summary.addEventListener('pointerleave', () => onSummaryLeave?.());
        summary.addEventListener('focus', () => onSummaryEnter?.());
        summary.addEventListener('blur', () => onSummaryLeave?.());
        this._summaryEl = summary;
        this._countEl.appendChild(summary);
    }

    get summaryEl() {
        return this._summaryEl;
    }

    setSummaryActive(active) {
        this._summaryEl?.classList.toggle('active', !!active);
    }

    _setSummary(layers) {
        const count = (layers || []).length;
        if (this._summaryKey === count) return;
        this._summaryKey = count;
        this._summaryTextEl.textContent = `Configure ${count} ${count === 1 ? 'Map' : 'Maps'}`;
    }

    setMinWidth(px) {
        if (this._el) this._el.style.minWidth = px ? `${px}px` : '';
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

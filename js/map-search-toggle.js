import { SEARCH_SOURCES, isSearchSourceEnabled, setSearchSourceEnabled } from './search/search-sources.js';

export class MapSearchToggle {
    constructor() {
        this._el = null;
        this._btn = null;
    }

    build() {
        this._el = document.createElement('div');
        this._el.className = 'map-search-control';

        this._btn = document.createElement('button');
        this._btn.type = 'button';
        this._btn.className = 'map-search-btn';
        this._btn.setAttribute('aria-pressed', 'false');
        this._btn.title = 'Search places';
        this._btn.setAttribute('aria-label', 'Search places');
        this._btn.innerHTML = '<sl-icon name="search"></sl-icon>';
        this._btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._el.classList.contains('searching')) {
                this._searchInput()?.blur();
                this._collapse(true);
            } else {
                this._expand();
            }
        });

        this._el.append(this._btn, this._buildSourcesMenu());
        this._el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this._searchInput()?.blur();
                this._collapse(true);
            }
        });
        this._el.addEventListener('focusin', (e) => {
            if (e.target.closest?.('mapbox-search-box')) this._setSearching(true);
        });
        document.addEventListener('focusout', () => {
            if (this._el.classList.contains('searching')) setTimeout(() => this._collapse(), 250);
        });
        return this._el;
    }

    _buildSourcesMenu() {
        const dropdown = document.createElement('sl-dropdown');
        dropdown.className = 'map-search-sources';
        dropdown.placement = 'bottom-end';
        dropdown.setAttribute('stay-open-on-select', '');
        dropdown.hoist = true;
        const more = document.createElement('button');
        more.type = 'button';
        more.slot = 'trigger';
        more.className = 'map-search-btn';
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
        if (on && !this._el.classList.contains('searching')) {
            window.dispatchEvent(new CustomEvent('mapSearchStart'));
        }
        this._el.classList.toggle('searching', on);
        this._btn.setAttribute('aria-pressed', String(on));
    }

    _expand() {
        this._setSearching(true);
        requestAnimationFrame(() => {
            const input = this._searchInput();
            if (input) input.focus();
            else document.querySelector('mapbox-search-box')?.focus?.();
        });
    }

    _collapse(force = false) {
        if (!this._el) return;
        const box = document.querySelector('mapbox-search-box');
        if (!force && (this._el.matches(':focus-within') || box?.matches(':focus-within'))) return;
        if (!force && this._searchInput()?.value) return;
        if (!force && window.cadastralSearchUI?.isActive()) return;
        this._setSearching(false);
    }
}

import { SEARCH_SOURCES, isSearchSourceEnabled, setSearchSourceEnabled } from './search/search-sources.js';

const ADMIN_UNITS_FINE_TO_COARSE = [
    'neighbourhood', 'suburb', 'quarter', 'city_district', 'borough', 'village', 'hamlet',
    'town', 'city', 'municipality', 'county', 'state_district', 'state', 'country'
];

export function finestAdminUnit(address) {
    if (!address) return '';
    const key = ADMIN_UNITS_FINE_TO_COARSE.find(k => address[k]);
    return key ? String(address[key]) : '';
}

// The place line's slots, finest first; each takes the first of its keys the
// address has. Neighbourhood, then quarter or suburb, then town or city; the
// coarser slots only fill in where those are missing, as in a village.
const PLACE_LINE_SLOTS = [
    ['neighbourhood'], ['quarter', 'suburb'], ['village', 'hamlet'], ['town', 'city'],
    ['municipality'], ['county'], ['state_district'], ['state'], ['country']
];

/** Up to three distinct place names in a Nominatim address, finest first. */
export function placeLine(address, count = 3) {
    if (!address) return '';
    const names = [];
    PLACE_LINE_SLOTS.forEach(keys => {
        const key = keys.find(k => address[k]);
        const value = key && String(address[key]);
        if (value && !names.includes(value)) names.push(value);
    });
    return names.slice(0, count).join(', ');
}

/**
 * The search field of the map console's Find mode (js/map-control-bar.js):
 * the <mapbox-search-box> host behind a search icon, which resets Find to its
 * default atlas view, plus the "Search in" settings menu (`sourcesEl`), which
 * the console places just outside the field, to its right.
 * The console decides when Find is open; this only reflects it (the
 * `searching` class that shows the field) and offers focus/clear/placeholder
 * helpers.
 */
export class MapSearchToggle {
    constructor() {
        this._el = null;
    }

    build() {
        this._el = document.createElement('div');
        this._el.className = 'map-search-control';

        this._glyph = document.createElement('button');
        this._glyph.type = 'button';
        this._glyph.className = 'map-search-glyph';
        this._glyph.title = 'Back to the atlas view';
        this._glyph.setAttribute('aria-label', this._glyph.title);
        this._glyph.innerHTML = '<sl-icon name="search"></sl-icon>';
        this._glyph.addEventListener('click', () => window.mapConsole?.resetFind());

        this._el.append(this._glyph);
        this.sourcesEl = this._buildSourcesMenu();
        this._el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                window.mapConsole?.escape();
            }
        });
        // Tabbing into the field opens Find the same as the search button does
        this._el.addEventListener('focusin', (e) => {
            if (e.target.closest?.('mapbox-search-box')) window.mapConsole?.setMode('find', { focus: false });
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
        more.className = 'console-btn map-search-sources-btn';
        more.title = 'Search settings: choose what to search';
        more.setAttribute('aria-label', more.title);
        more.innerHTML = '<sl-icon name="three-dots-vertical"></sl-icon>';
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

    get value() {
        return this._searchInput()?.value || '';
    }

    setPlaceholder(text) {
        const box = document.querySelector('mapbox-search-box');
        if (!box || box.getAttribute('placeholder') === text) return;
        box.setAttribute('placeholder', text);
        const input = this._searchInput();
        if (input) input.placeholder = text;
    }

    setSearching(on) {
        if (!this._el) return;
        if (on && !this._el.classList.contains('searching')) {
            window.dispatchEvent(new CustomEvent('mapSearchStart'));
        }
        this._el.classList.toggle('searching', on);
        document.body.classList.toggle('map-search-active', on);
    }

    focus() {
        requestAnimationFrame(() => {
            const input = this._searchInput();
            if (input) {
                input.focus();
                input.select();
            } else document.querySelector('mapbox-search-box')?.focus?.();
        });
    }

    /** Empties the field and drops its results and preview pins, keeping any selection. */
    clear() {
        const control = window.searchControl;
        if (!control || !this.value) return;
        // Emptied first: resetSearchState() redraws Find from the field's value
        control.updateSearchBoxInput('', { silent: true });
        control.resetSearchState();
        control.removeSearchMarker();
        control.directionsProvider?.cancel();
        window.urlManager?.updateSearchParam('');
    }
}

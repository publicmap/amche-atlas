/**
 * SearchBoxControl - Mapbox GL JS control hosting the primary top-left row:
 * the map-browser "Maps" button and the <mapbox-search-box> web component,
 * in one row, in that order.
 *
 * onAdd() only builds the empty row and returns it - it's added to the map
 * immediately (before map.on('load')) purely to claim its slot at the top of
 * the top-left stack, since Mapbox stacks controls in insertion order and the
 * other pieces aren't ready yet at that point:
 *   - MapBrowserControl's element is built around the same time (see
 *     map-init.js) and inserted via mountBrowserControl() right away.
 *   - The search box itself can't initialize until much later (map style
 *     loaded, layer registry ready, etc) - see mount(), called once
 *     MapSearchControl is ready.
 *
 * MapSearchControl (see map-search-control.js) looks up the search box via
 * document.querySelector('mapbox-search-box'), so mount() must run before
 * MapSearchControl is constructed.
 */
export class SearchBoxControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'search-box-control mapboxgl-ctrl';

        this._row = document.createElement('div');
        this._row.className = 'search-box-row';
        this._container.appendChild(this._row);

        return this._container;
    }

    onRemove() {
        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._map = null;
    }

    getDefaultPosition() {
        return 'top-left';
    }

    // Inserts MapBrowserControl's element (its own onAdd() return value) as
    // the first item in the row.
    mountBrowserControl(browserControlEl) {
        if (this._browserEl || !browserControlEl) return; // already mounted
        this._browserEl = browserControlEl;
        this._row.insertBefore(browserControlEl, this._row.firstChild);
    }

    // Adds the search box at the end of the row, after the Maps button.
    mount() {
        if (this._searchBox) return; // already mounted

        this._searchBox = document.createElement('mapbox-search-box');
        this._searchBox.id = 'mapbox-search-box';
        this._row.appendChild(this._searchBox);
    }
}

/**
 * SearchBoxControl - Mapbox GL JS control that hosts the <mapbox-search-box>
 * web component (and the geolocation button, in the same row) as a floating
 * top-right map control.
 *
 * onAdd() only builds the empty row and returns it - it's added to the map
 * early (alongside the other top-right controls) purely to claim its slot at
 * the top of the top-right stack, since Mapbox stacks controls in insertion
 * order and the actual search behavior (MapSearchControl) can't initialize
 * until much later (map style loaded, layer registry ready, etc). Once ready,
 * the caller populates the row via mount({ geolocationEl }).
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
        return 'top-right';
    }

    // Populates the row with the search box and, when provided, the
    // geolocation control's element (already built via its own onAdd) so it
    // renders in the same row as the search input.
    mount({ geolocationEl } = {}) {
        if (this._searchBox) return; // already mounted

        this._searchBox = document.createElement('mapbox-search-box');
        this._searchBox.id = 'mapbox-search-box';
        this._row.appendChild(this._searchBox);

        if (geolocationEl) {
            this._row.appendChild(geolocationEl);
        }
    }
}

import { MapSearchToggle } from './map-search-toggle.js';

/**
 * SearchBoxControl - the Mapbox GL JS control that holds the map console
 * (js/map-control-bar.js) in the top-left corner.
 *
 * onAdd() only builds the empty host and returns it - it's added to the map
 * immediately (before map.on('load')) purely to claim its slot at the top of
 * the top-left stack, since Mapbox stacks controls in insertion order and the
 * other pieces aren't ready yet at that point:
 *   - MapBrowserControl's element (which mounts the console) is built around
 *     the same time (see map-init.js) and inserted via mountBrowserControl().
 *   - The search box itself can't initialize until much later (map style
 *     loaded, layer registry ready, etc) - see mount(), called once
 *     MapSearchControl is ready. It goes into the console's search field.
 *
 * The host deliberately does not carry Mapbox's `mapboxgl-ctrl` class: the
 * generic corner-control theme in css/styles.css restyles every button inside
 * one, and the console has its own (css/map-console.css).
 *
 * MapSearchControl (see map-search-control.js) looks up the search box via
 * document.querySelector('mapbox-search-box'), so mount() must run before
 * MapSearchControl is constructed.
 */
export class SearchBoxControl {
    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'search-box-control map-console-host';

        this.searchToggle = new MapSearchToggle();
        this._searchEl = this.searchToggle.build();

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

    mountBrowserControl(browserControlEl) {
        if (this._browserEl || !browserControlEl) return; // already mounted
        this._browserEl = browserControlEl;
        this._container.appendChild(browserControlEl);
    }

    // Adds the search box into the console's search field.
    mount() {
        if (this._searchBox) return; // already mounted
        this._searchBox = document.createElement('mapbox-search-box');
        this._searchBox.id = 'mapbox-search-box';
        this._searchEl.appendChild(this._searchBox);
    }
}

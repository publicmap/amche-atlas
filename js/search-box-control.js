/**
 * SearchBoxControl - Mapbox GL JS control hosting the primary top-left row:
 * the map-browser "Maps" button, the map-inspector button, the
 * <mapbox-search-box> web component, the geolocation button, and the compass,
 * all in one row, in that order.
 *
 * onAdd() only builds the empty row and returns it - it's added to the map
 * immediately (before map.on('load')) purely to claim its slot at the top of
 * the top-left stack, since Mapbox stacks controls in insertion order and the
 * other two pieces aren't ready yet at that point:
 *   - MapBrowserControl's element is built around the same time (see
 *     map-init.js) and inserted via mountBrowserControl() right away.
 *   - MapFeatureControl's element is built on map load and inserted via
 *     mountInspectorControl().
 *   - The search box itself can't initialize until much later (map style
 *     loaded, layer registry ready, etc) - see mount({ geolocationEl }),
 *     called once MapSearchControl is ready.
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

    // Inserts MapFeatureControl's element (its own onAdd() return value)
    // directly after the Maps button, so the inspector sits between the map
    // browser and the search box. Position-based rather than order-based, so
    // it works whether or not the browser button and search box are mounted
    // yet.
    mountInspectorControl(inspectorEl) {
        if (this._inspectorEl || !inspectorEl) return; // already mounted
        this._inspectorEl = inspectorEl;
        inspectorEl.classList.add('map-inspector-control');

        if (this._browserEl && this._browserEl.parentNode === this._row) {
            this._browserEl.insertAdjacentElement('afterend', inspectorEl);
        } else {
            this._row.insertBefore(inspectorEl, this._row.firstChild);
        }
    }

    // Inserts the compass control's element (its own onAdd() return value) at
    // the end of the row, to the right of the geolocation button. The compass
    // is built on map load, which can be before or after mount() runs, so the
    // row keeps it last from either direction (see mount() below).
    mountCompassControl(compassEl) {
        if (this._compassEl || !compassEl) return; // already mounted
        this._compassEl = compassEl;
        compassEl.classList.add('map-compass-control');
        this._row.appendChild(compassEl);
    }

    // Populates the row with the search box and, when provided, the
    // geolocation control's element (already built via its own onAdd) so it
    // renders after the Maps button, in the same row as the search input.
    mount({ geolocationEl } = {}) {
        if (this._searchBox) return; // already mounted

        this._searchBox = document.createElement('mapbox-search-box');
        this._searchBox.id = 'mapbox-search-box';
        // insertBefore(x, null) is appendChild, so both pieces land at the end
        // of the row unless the compass is already there to stay right of them.
        this._row.insertBefore(this._searchBox, this._compassEl || null);

        if (geolocationEl) {
            this._row.insertBefore(geolocationEl, this._compassEl || null);
        }
    }
}

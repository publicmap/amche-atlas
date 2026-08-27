const SOURCE_ID = 'amche-directions-route'
const LAYER_ID = 'amche-directions-route-line'
const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] }

/**
 * Owns the map source/layer that draws a route line, following the same
 * getSource/getLayer-guarded add pattern as map-measure-control.js.
 */
export class DirectionsLayer {
    constructor(map) {
        this.map = map
    }

    _ensureLayer() {
        if (!this.map.getSource(SOURCE_ID)) {
            this.map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY_COLLECTION })
        }
        if (!this.map.getLayer(LAYER_ID)) {
            this.map.addLayer({
                id: LAYER_ID,
                type: 'line',
                source: SOURCE_ID,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#3b82f6',
                    'line-width': 5,
                    'line-opacity': 0.85
                }
            })
        }
    }

    show(geometry) {
        this._ensureLayer()
        this.map.getSource(SOURCE_ID).setData({ type: 'Feature', geometry, properties: {} })
    }

    /** Bounds of the currently-shown route, for fitBounds(). */
    bounds(geometry) {
        const bounds = new mapboxgl.LngLatBounds()
        geometry.coordinates.forEach(coord => bounds.extend(coord))
        return bounds
    }

    clear() {
        if (this.map.getSource(SOURCE_ID)) {
            this.map.getSource(SOURCE_ID).setData(EMPTY_COLLECTION)
        }
    }

    remove() {
        if (this.map.getLayer(LAYER_ID)) this.map.removeLayer(LAYER_ID)
        if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID)
    }
}

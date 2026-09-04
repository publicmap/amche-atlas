import { routeStore } from './route-store.js'
import { routeBounds } from './route-geojson.js'

/**
 * The search control's handle on the route drawing. Everything it does now
 * goes through route-store.js, the single owner of the `directions` layer
 * (config/index.atlas.json) - so an "X to Y" search adds a route the same way
 * clicking a destination in the Visible Features menu does, and the two can
 * coexist instead of overwriting each other.
 */
export class DirectionsLayer {
    constructor(map) {
        this.map = map
        // Only the route this control drew, so clearing the search box can't
        // take routes the user built in the Visible Features menu with it.
        this._routeId = null
    }

    /**
     * @param {Object} route - the Directions result (see directions-router.js)
     * @param {Array<Array<number>>} waypoints - [lng, lat] per waypoint, in order
     * @param {Array<string>} [names] - optional label per waypoint
     */
    show(route, waypoints, names = []) {
        this._routeId = routeStore.adopt(route, waypoints, names)?.id || null
    }

    /** Bounds of a route geometry, for fitBounds(). */
    bounds(geometry) {
        return routeBounds(geometry)
    }

    clear() {
        if (!this._routeId) return
        routeStore.remove(this._routeId)
        this._routeId = null
    }
}

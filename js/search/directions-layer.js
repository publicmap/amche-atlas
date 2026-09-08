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

// How far from the line a press still counts as grabbing it. The route line is
// 5px wide over a 9px casing (see route-geojson.js's ROUTE_STYLE), so this is
// roughly "on the line" rather than a generous catch radius - the map under it
// stays clickable.
const HIT_TOLERANCE_PX = 6

// Below this the press is a click, not a drag: it selects the route as before
// and inserts nothing. Only once the pointer has travelled this far does the
// new waypoint appear, so an ordinary click on the line never adds a stop.
const DRAG_THRESHOLD_PX = 4

// A mouse drag ends with mousedown and mouseup on the same target, so release
// fires a click straight after - which would run the map's own selection at
// the drop point. This is the same guard MapMarkerManager's drag uses.
const DRAG_CLICK_SUPPRESS_MS = 400

/**
 * RouteDragHandler - drag any point of a drawn route line to route through it.
 *
 * Pressing the line and moving inserts a new waypoint where it was grabbed
 * (routeStore.insertWaypoint) and then moves that waypoint for the rest of the
 * drag, re-routing live under the cursor exactly as dragging one of the
 * route's existing waypoint pins does. On release the stop stays, with its own
 * pin like every other waypoint - so the detour is a normal part of the route
 * and can be dragged, renamed or removed again afterwards.
 *
 * Works on every route on the map, not just the one the search box drew: the
 * hit test asks routeStore which route was grabbed, so a route restored from a
 * shared link (its own layer, see route-url-api.js) drags the same way.
 *
 * Mouse only. Touch already owns press-and-drag on the canvas: a stationary
 * press opens the long-press shortcut menu (../shortcut-menu.js) and a moving
 * one pans the map, and neither should turn into a reroute.
 */
export class RouteDragHandler {
    constructor(map) {
        this.map = map
        // Set for the whole gesture, from press to release - `index` is -1
        // until the pointer passes DRAG_THRESHOLD_PX and the waypoint is
        // actually inserted, so a press that never moves inserts nothing.
        this._drag = null

        this._onMouseDown = this._onMouseDown.bind(this)
        this._onMouseMove = this._onMouseMove.bind(this)
        this._onMouseUp = this._onMouseUp.bind(this)
        this._onLayersInitialized = () => routeStore.sync()
    }

    enable() {
        this.map.on('mousedown', this._onMouseDown)

        // A route restored from a shared link is drawn as its own layer before
        // routeStore has ever seen it, and only routes the store tracks can be
        // dragged (it is what re-routes them). Adopting them once the layers
        // are up makes a shared route draggable without waiting for whatever
        // else happens to call sync() - the Visible Features menu being opened,
        // today (see ../map-nearby-features-control.js).
        if (window.layersInitialized) routeStore.sync()
        else window.addEventListener('layersInitialized', this._onLayersInitialized)
    }

    disable() {
        this.map.off('mousedown', this._onMouseDown)
        window.removeEventListener('layersInitialized', this._onLayersInitialized)
        this._endDrag()
    }

    _onMouseDown(e) {
        if (this._drag || e.originalEvent?.button !== 0) return
        // Markers (waypoint pins and their panels) sit inside the canvas
        // container, so their presses reach the map too - and a waypoint pin's
        // own drag is a different gesture on the same route. Only a press
        // landing on the canvas itself is ours.
        if (e.originalEvent?.target !== this.map.getCanvas()) return

        const hit = this._hitRoute(e.point)
        if (!hit) return

        this._drag = {
            routeId: hit.route.id,
            insertAt: insertIndexForPoint(hit.route, e.lngLat),
            startX: e.point.x,
            startY: e.point.y,
            index: -1
        }

        // Otherwise the same press pans the map out from under the drag.
        this.map.dragPan.disable()
        this.map.on('mousemove', this._onMouseMove)
        window.addEventListener('mouseup', this._onMouseUp, true)
    }

    _onMouseMove(e) {
        const drag = this._drag
        if (!drag) return

        if (drag.index === -1) {
            if (Math.hypot(e.point.x - drag.startX, e.point.y - drag.startY) < DRAG_THRESHOLD_PX) return
            drag.index = routeStore.insertWaypoint(drag.routeId, drag.insertAt, e.lngLat, { live: true })
            if (drag.index === -1) this._endDrag()
            return
        }

        routeStore.moveWaypoint(drag.routeId, drag.index, e.lngLat, { live: true })
    }

    _onMouseUp(e) {
        const drag = this._drag
        this._endDrag()
        if (!drag || drag.index === -1) return

        // The live re-routes above are on a trailing timer, so the last frame
        // of the drag may not have been routed yet - settle the stop where it
        // was actually dropped.
        const rect = this.map.getContainer().getBoundingClientRect()
        const lngLat = this.map.unproject([e.clientX - rect.left, e.clientY - rect.top])
        routeStore.moveWaypoint(drag.routeId, drag.index, lngLat)

        const stateManager = window.featureControl?._stateManager
        if (stateManager) stateManager._suppressClickUntil = Date.now() + DRAG_CLICK_SUPPRESS_MS
    }

    _endDrag() {
        if (!this._drag) return
        this._drag = null
        this.map.off('mousemove', this._onMouseMove)
        window.removeEventListener('mouseup', this._onMouseUp, true)
        this.map.dragPan.enable()
    }

    /**
     * The route under a screen point, or null. Only route lines are queried -
     * the waypoint dots and the line's own labels share the layer, and neither
     * is something to drag a detour out of.
     */
    _hitRoute(point) {
        const routes = routeStore.routes
        if (!routes.length) return null

        const layers = this._routeLineLayerIds(routes)
        if (!layers.length) return null

        const box = [
            [point.x - HIT_TOLERANCE_PX, point.y - HIT_TOLERANCE_PX],
            [point.x + HIT_TOLERANCE_PX, point.y + HIT_TOLERANCE_PX]
        ]

        const feature = this.map.queryRenderedFeatures(box, { layers })
            .find(f => f.properties?.kind === 'route')
        if (!feature) return null

        // Routes this store wrote carry their own id on every feature; one
        // adopted off a `route:` URL layer (see routeStore.sync) may not, so
        // fall back to whichever route lives in the layer that was hit.
        const groupId = String(feature.layer?.source || '').replace(/^geojson-/, '')
        const route = routes.find(r => r.id === feature.properties?.routeId)
            || routes.find(r => r.groupId === groupId)
        return route ? { route } : null
    }

    /**
     * The line layers of every layer a route is drawn in - both the blue route
     * line and the white casing under it (see ROUTE_STYLE), since either can
     * be the topmost thing under the pointer. Read off the style rather than
     * rebuilt from the id scheme in ../mapbox-api.js, which appends a suffix
     * per style variant.
     */
    _routeLineLayerIds(routes) {
        const sources = new Set(routes.map(r => `geojson-${r.groupId}`))
        const order = this.map.getLayersOrder?.() || (this.map.getStyle()?.layers || []).map(l => l.id)

        return order.filter(id => {
            const layer = this.map.getLayer(id)
            return layer?.type === 'line' && sources.has(layer.source)
        })
    }
}

/**
 * Which pair of stops a point on the route falls between - the index a
 * waypoint grabbed there should be inserted at.
 *
 * Measured in vertices along the drawn line rather than by distance to each
 * stop: a route that doubles back passes close to a stop it left long ago, and
 * "nearest stop" would insert the detour into the wrong leg of it. Every
 * waypoint sits on the line (the API snaps them to the road network, see
 * route-geojson.js), so each one's own nearest vertex is where it sits in that
 * order, and the grabbed point lands before or after it unambiguously.
 */
function insertIndexForPoint(route, lngLat) {
    const line = route.geojson?.features?.find(f => f.properties?.kind === 'route')
    const coordinates = line?.geometry?.coordinates || []
    const last = route.waypoints.length - 1
    if (coordinates.length < 2) return last

    const grabbed = nearestVertexIndex(coordinates, [lngLat.lng, lngLat.lat])
    for (let i = 1; i <= last; i++) {
        if (nearestVertexIndex(coordinates, route.waypoints[i]) >= grabbed) return i
    }
    return last
}

/**
 * Index of the line vertex closest to `point`. Compared as plain squared
 * degrees: over the span between two vertices of one route the difference from
 * a true great-circle distance cannot reorder them, and this runs once per
 * waypoint on every press.
 */
function nearestVertexIndex(coordinates, point) {
    let best = 0
    let bestDistance = Infinity

    coordinates.forEach(([lng, lat], index) => {
        const dx = lng - point[0]
        const dy = lat - point[1]
        const distance = dx * dx + dy * dy
        if (distance < bestDistance) {
            bestDistance = distance
            best = index
        }
    })

    return best
}

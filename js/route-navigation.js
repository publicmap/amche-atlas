/**
 * Turn-by-turn navigation along a route (Start navigation on a route card,
 * js/console/route-card.js). A new route in the same travel mode is fetched
 * from Mapbox Directions with its steps, from where the device is through the
 * stops still ahead, and drawn in a layer of its own that is not written to
 * the URL. The device's position is then followed: snapped to the line, it
 * moves the current step and the time and distance left on; straying from the
 * line re-routes from where it now is. One route is navigated at a time, so
 * starting another ends this one.
 *
 * While it runs the atlas's traffic layer is switched on (the panel can turn
 * it off), and put back as it was when navigation ends. The panel is
 * js/route-navigation-panel.js. `window.routeNavigation` is this instance.
 */
import { haversineDistanceMeters } from './geo-distance-utils.js';
import { NavigationPanel } from './route-navigation-panel.js';
import { nearestOnLine, lineLength } from './route-navigation-geometry.js';

const DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox';
const MAPBOX_PROFILES = { driving: 'driving-traffic', walking: 'walking', cycling: 'cycling' };
const SOURCE_ID = 'route-navigation';
const AT_STOP_METERS = 40;
const OFF_ROUTE_METERS = 50;
const OFF_ROUTE_FIXES = 3;
const TRAFFIC_LAYER_IDS = ['traffic', 'mapbox-traffic'];

export class RouteNavigation {
    constructor(map) {
        this._map = map;
        this._session = null;
        this._panel = new NavigationPanel({
            onEnd: () => this.stop(),
            onTraffic: (on) => this._setTraffic(on),
            onFollow: (on) => {
                if (this._session) this._session.follow = on;
            }
        });
        window.routeNavigation = this;
    }

    get active() {
        return !!this._session;
    }

    async start(route) {
        if (!route?.waypoints?.length) return;
        this.stop();
        const session = { route, profile: route.profile || 'driving', remaining: route.waypoints.map(p => [...p]), follow: true, offRoute: 0, traffic: this._trafficLayer() };
        this._session = session;
        this._panel.open({ route, status: 'Finding your location…', traffic: true });
        this._setTraffic(true);
        try {
            const position = await currentPosition();
            if (this._session !== session) return;
            session.position = position;
            while (session.remaining.length > 1 && haversineDistanceMeters(position, at(session.remaining[0])) < AT_STOP_METERS) session.remaining.shift();
            await this._fetch(session);
            if (this._session !== session) return;
            session.unwatch = watchPosition(
                (fix) => this._onFix(session, fix),
                (message) => this._panel.setStatus(message)
            );
            this._onFix(session, position);
        } catch (error) {
            if (this._session !== session) return;
            console.warn('[navigation] could not start:', error);
            this._panel.setStatus(error.message || 'Could not start navigation');
        }
    }

    stop() {
        const session = this._session;
        if (!session) return;
        this._session = null;
        session.unwatch?.();
        this._setTraffic(false, session);
        this._removeLayers();
        this._panel.close();
    }

    async _fetch(session) {
        const points = [[session.position.lng, session.position.lat], ...session.remaining];
        const profile = MAPBOX_PROFILES[session.profile] || 'driving-traffic';
        const url = `${DIRECTIONS_URL}/${profile}/${points.map(p => p.join(',')).join(';')}` +
            `?geometries=geojson&overview=full&steps=true&access_token=${mapboxgl.accessToken}`;
        session.fetching = true;
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Directions failed: ${response.status}`);
            const route = (await response.json()).routes?.[0];
            if (!route) throw new Error('No route from your location');
            session.directions = route;
            session.steps = route.legs.flatMap((leg, legIndex) => leg.steps.map(step => ({ ...step, legIndex })));
            let along = 0;
            session.steps.forEach(step => {
                step.start = along;
                along += step.distance;
            });
            session.offRoute = 0;
            this._draw(session);
        } finally {
            session.fetching = false;
        }
    }

    _onFix(session, position) {
        if (this._session !== session || !session.directions) return;
        session.position = position;
        const line = session.directions.geometry.coordinates;
        const snap = nearestOnLine(line, [position.lng, position.lat]);
        if (snap.distance > OFF_ROUTE_METERS) session.offRoute += 1;
        else session.offRoute = 0;
        if (session.offRoute >= OFF_ROUTE_FIXES && !session.fetching) {
            this._panel.setStatus('Re-routing…');
            this._fetch(session).then(() => this._onFix(session, position)).catch(error => this._panel.setStatus(error.message));
            return;
        }
        const total = lineLength(line);
        const travelled = Math.min(snap.along, total);
        const index = Math.max(0, session.steps.findIndex(step => step.start + step.distance > travelled));
        const step = session.steps[index];
        const next = session.steps[index + 1] || null;
        const left = Math.max(0, total - travelled);
        const duration = session.directions.duration * (total ? left / total : 0);
        while (session.remaining.length > 1 && haversineDistanceMeters(position, at(session.remaining[0])) < AT_STOP_METERS) session.remaining.shift();
        const arrived = left < AT_STOP_METERS && session.remaining.length <= 1;
        this._panel.update({
            step: next || step,
            toManeuver: next ? Math.max(0, next.start - travelled) : left,
            then: session.steps[index + 2] || null,
            steps: session.steps.slice(index + 1),
            distanceLeft: left,
            durationLeft: duration,
            stopsLeft: session.remaining.length,
            arrived
        });
        this._map.getSource(`${SOURCE_ID}-me`)?.setData({ type: 'Point', coordinates: snap.point });
        if (session.follow) {
            const bearing = Number.isFinite(position.heading) ? position.heading : this._map.getBearing();
            this._map.easeTo({ center: snap.point, zoom: Math.max(this._map.getZoom(), 16), bearing, pitch: 45, duration: 800 });
        }
    }

    _draw(session) {
        this._removeLayers();
        const map = this._map;
        map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'Feature', geometry: session.directions.geometry, properties: {} } });
        map.addSource(`${SOURCE_ID}-me`, { type: 'geojson', data: { type: 'Point', coordinates: [session.position.lng, session.position.lat] } });
        const color = session.route.color || '#1da1f2';
        map.addLayer({ id: `${SOURCE_ID}-casing`, type: 'line', source: SOURCE_ID, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 11 } });
        map.addLayer({ id: SOURCE_ID, type: 'line', source: SOURCE_ID, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 7 } });
        map.addLayer({ id: `${SOURCE_ID}-me`, type: 'circle', source: `${SOURCE_ID}-me`, paint: { 'circle-radius': 8, 'circle-color': '#1da1f2', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
    }

    _removeLayers() {
        const map = this._map;
        [`${SOURCE_ID}-me`, SOURCE_ID, `${SOURCE_ID}-casing`].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        [SOURCE_ID, `${SOURCE_ID}-me`].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
    }

    /** The atlas's traffic layer and whether it was already on before navigation started. */
    _trafficLayer() {
        const registry = window.layerRegistry;
        const atlas = registry?.getCurrentAtlas?.();
        const candidates = ['mapbox-traffic', ...(atlas ? [`${atlas}-traffic`] : []), ...TRAFFIC_LAYER_IDS];
        const id = candidates.find(candidate => registry?.getLayer?.(candidate, null, true));
        if (!id) return null;
        const active = window.browserControl?._getActiveLayers?.() || new Set();
        return { id, wasOn: active.has(id) };
    }

    _setTraffic(on, session = this._session) {
        const traffic = session?.traffic;
        if (!traffic) {
            this._panel.setTrafficAvailable(false);
            return;
        }
        const target = on || traffic.wasOn;
        const active = window.browserControl?._getActiveLayers?.() || new Set();
        if (active.has(traffic.id) !== target) window.browserControl?._handleLayerToggle(traffic.id, target);
        if (this._session) this._panel.setTraffic(on);
    }
}

function at(point) {
    return { lng: point[0], lat: point[1] };
}

const toFix = (coords) => ({ lng: coords.longitude, lat: coords.latitude, heading: coords.heading });

/**
 * Where the device is. The map's own location control (js/map-orientation-
 * control.js) is asked first - its last fix if it has one, else it is
 * switched on and its next fix taken - so navigation shares the watch the
 * blue location disc already runs rather than waiting on a second one.
 */
function currentPosition() {
    const control = window.orientationControl;
    if (control?.lastPosition) return Promise.resolve({ ...control.lastPosition });
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (fix, error) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            control?.off?.('geolocate', onFix);
            if (fix) resolve(fix);
            else reject(error);
        };
        const onFix = (event) => finish(toFix(event.coords));
        const timer = setTimeout(() => finish(null, new Error('Could not find your location. Check that location is allowed for this site.')), 30000);
        if (control) {
            control.on('geolocate', onFix);
            if (!control.isTracking) control.trigger?.();
        }
        navigator.geolocation?.getCurrentPosition(
            (fix) => finish(toFix(fix.coords)),
            () => { if (!control) finish(null, new Error('Location unavailable')); },
            { enableHighAccuracy: true, timeout: 25000, maximumAge: 60000 }
        );
    });
}

/** Follows the device through the map's location control, else the browser's own watch; returns a stop function. */
function watchPosition(onFix, onError) {
    const control = window.orientationControl;
    if (control) {
        const listener = (event) => onFix(toFix(event.coords));
        control.on('geolocate', listener);
        if (!control.isTracking) control.trigger?.();
        return () => control.off('geolocate', listener);
    }
    const id = navigator.geolocation.watchPosition(
        (fix) => onFix(toFix(fix.coords)),
        (error) => onError(`Location unavailable: ${error.message}`),
        { enableHighAccuracy: true, maximumAge: 2000 }
    );
    return () => navigator.geolocation.clearWatch(id);
}

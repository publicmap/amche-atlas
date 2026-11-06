/**
 * A `"type": "routes"` layer: a route network kept in a Google Sheet
 * (docs/route-sheets.md), drawn and edited like any other route.
 *
 * Loading reads the sheet (js/route-sheet-sync.js), routes each row through
 * its stops, and hands the routes to the route store (search/route-store.js)
 * so they show as route cards and can be edited there. Nothing is written
 * back until Save: the routes as they now are are compared with the sheet as
 * it was loaded, and the routes and stops that differ are written, the ones
 * taken off deleted. Save re-reads the sheet first; a row someone else changed
 * in the meantime is a conflict, and while any is open those rows can't be
 * written or deleted - each is settled by inserting the local version as a
 * new row or discarding it, and the layer reloads once none are left.
 *
 * `window.routeSheets` is the one instance; the legend's sync bar
 * (js/route-sheet-bar.js) drives it and listens for `route-sheet-changed`.
 */
import { routeSheetSyncFor } from './route-sheet-sync.js';
import { routeToRow, freshId } from './route-sheet-format.js';
import { sameContent } from './route-sheet-conflicts.js';
import { fetchRouteForWaypoints } from './search/directions-router.js';
import { buildRouteFeatureCollection, defaultRouteColor } from './search/route-geojson.js';
import { haversineDistanceMeters } from './geo-distance-utils.js';
import { labelToId } from './shorthand-id-utils.js';

const SAME_STOP_METERS = 60;
const PARALLEL_ROUTES = 4;
const READ_ONLY_KEY = 'amche:sheet-read-only:';
const EMPTY = { type: 'FeatureCollection', features: [] };

const at = (p) => (Array.isArray(p) ? { lng: p[0], lat: p[1] } : p);

async function drawRoute(groupId, route, stops) {
    const coords = stops.map(m => [m.lng, m.lat]);
    const result = await fetchRouteForWaypoints(coords, { engine: route.service || null, profile: route.profile || undefined });
    route.drawnProfile = result.profile;
    route.drawnService = result.source;
    const collection = buildRouteFeatureCollection(result, coords, { profile: result.profile, source: result.source, names: stops.map(m => m.name || m.id) });
    const color = route.color || defaultRouteColor({ rid: route.id });
    collection.features.forEach(feature => {
        Object.assign(feature.properties, { routeId: `${groupId}:${route.id}`, rid: route.id, sheetName: route.name || '', color, colorCustom: !!route.color });
        if (feature.properties.kind === 'waypoint') feature.properties.markerId = stops[feature.properties.index]?.id || null;
    });
    return collection.features;
}

class RouteSheets {
    constructor() {
        this._layers = new Map();
    }

    owns(groupId) {
        return this._layers.has(groupId);
    }

    state(groupId) {
        const entry = this._layers.get(groupId);
        if (!entry) return null;
        return {
            busy: entry.busy,
            error: entry.error,
            message: entry.message,
            readOnly: !entry.config.saveUrl || entry.config.readOnly === true || this.userReadOnly(groupId),
            canWrite: !!entry.config.saveUrl && entry.config.readOnly !== true,
            configuredReadOnly: entry.config.readOnly === true,
            loadedAt: entry.loadedAt,
            conflicts: entry.sync.conflicts.list(),
            pending: this.pending(groupId)
        };
    }

    /** Whether the user turned writes off for this sheet (the editor's Save settings); kept per sheet in this browser. */
    userReadOnly(groupId) {
        const url = this._layers.get(groupId)?.config.url;
        try {
            return !!url && localStorage.getItem(READ_ONLY_KEY + url) === '1';
        } catch {
            return false;
        }
    }

    setUserReadOnly(groupId, readOnly) {
        const entry = this._layers.get(groupId);
        if (!entry) return;
        try {
            if (readOnly) localStorage.setItem(READ_ONLY_KEY + entry.config.url, '1');
            else localStorage.removeItem(READ_ONLY_KEY + entry.config.url);
        } catch { /* storage blocked: the switch lasts until the page closes */ }
        this._set(entry, groupId, {});
    }

    /** Reads the sheet and returns the layer's FeatureCollection (js/mapbox-api.js's routes type). */
    async load(groupId, config) {
        let entry = this._layers.get(groupId);
        if (!entry) {
            entry = { config, sync: routeSheetSyncFor(config), network: { routes: [], markers: [] } };
            this._layers.set(groupId, entry);
        }
        entry.config = config;
        this._set(entry, groupId, { busy: 'Loading the sheet…', error: null });
        try {
            const network = await entry.sync.refresh();
            const byId = new Map(network.markers.map(m => [String(m.id), m]));
            const features = [];
            const errors = [...(network.errors || []).map(e => e.message)];
            const queue = [...network.routes];
            const worker = async () => {
                while (queue.length) {
                    const route = queue.shift();
                    const stops = route.waypoints.map(id => byId.get(String(id))).filter(Boolean);
                    if (stops.length < 2) {
                        errors.push(`Route ${route.id} has fewer than two known stops`);
                        continue;
                    }
                    try {
                        features.push(...await drawRoute(groupId, route, stops));
                    } catch (error) {
                        errors.push(`Route ${route.id}: ${error.message}`);
                    }
                }
            };
            await Promise.all(Array.from({ length: PARALLEL_ROUTES }, worker));
            entry.network = network;
            entry.loadedAt = new Date();
            const geojson = { type: 'FeatureCollection', features };
            this._set(entry, groupId, { busy: null, message: errors.length ? errors.join('\n') : null });
            this._adopt(groupId, geojson);
            return geojson;
        } catch (error) {
            this._set(entry, groupId, { busy: null, error: error.message });
            return EMPTY;
        }
    }

    /** Throws away local edits and draws the sheet as it is now. */
    async refresh(groupId) {
        const entry = this._layers.get(groupId);
        if (!entry) return;
        window.routeStore?.removeGroup(groupId);
        const geojson = await this.load(groupId, entry.config);
        window.featureControl?._stateManager?._mapboxAPI?.updateGeoJSONLayerData?.(groupId, geojson)
            ?? window.mapboxAPI?.updateGeoJSONLayerData?.(groupId, geojson);
    }

    /** What Save would write: changed and new routes, moved locations, new locations routes stop at, and the routes taken off. */
    pending(groupId) {
        const entry = this._layers.get(groupId);
        const store = window.routeStore;
        if (!entry || !store) return { routes: [], locations: [], deleted: [] };
        const markers = entry.network.markers.map(m => ({ ...m }));
        const locations = [];
        const idFor = (coord, name, markerId) => {
            const point = at(coord);
            // A stop bound to one of the sheet's locations keeps its row; moved, the row follows it
            // (the location's own position: a route's stops are snapped to the road)
            const manager = window.featureControl?._markerManager;
            const urlId = markerId && manager?.getMarkerUrlId?.(markerId);
            const own = urlId && markers.find(m => String(m.id) === String(urlId));
            if (own) {
                const where = manager._markers?.get(markerId)?.lngLat;
                if (where && haversineDistanceMeters(where, own) > 1 && !locations.includes(own)) {
                    Object.assign(own, { lng: where.lng, lat: where.lat });
                    locations.push(own);
                }
                return own.id;
            }
            let marker = markers.find(m => haversineDistanceMeters(point, m) < SAME_STOP_METERS);
            if (!marker) {
                marker = { id: freshId(labelToId(name || '') || 'location', markers.map(m => String(m.id))), lng: point.lng, lat: point.lat, name: name || '', description: '' };
                markers.push(marker);
                locations.push(marker);
            }
            return marker.id;
        };
        const current = store.routes.filter(r => r.groupId === groupId);
        const rows = current.map(route => routeToRow({
            id: route.rid,
            name: route.title || '',
            profile: route.profile,
            service: route.engine,
            color: route.colorCustom ? route.color : '',
            waypoints: route.waypoints.map((coord, i) => idFor(coord, route.names[i], route.markerIds?.[i]))
        }));
        const baseRow = (base) => routeToRow({ ...base, profile: base.profile || base.drawnProfile, service: base.service || base.drawnService });
        const routes = rows.filter(row => {
            const base = entry.network.routes.find(b => String(b.id) === row.id);
            return !base || !sameContent('routes', baseRow(base), row);
        });
        const deleted = entry.network.routes.map(b => String(b.id)).filter(id => !rows.some(row => row.id === id));
        const moved = locations.filter(l => entry.network.markers.some(m => String(m.id) === String(l.id)));
        const added = locations.filter(l => !moved.includes(l) && routes.some(r => r.locations.split(',').includes(String(l.id))));
        return { routes, locations: [...moved, ...added], deleted };
    }

    async save(groupId) {
        const entry = this._layers.get(groupId);
        if (!entry || entry.busy || this.state(groupId).readOnly) return;
        const { routes, locations, deleted } = this.pending(groupId);
        if (!routes.length && !locations.length && !deleted.length) return;
        this._set(entry, groupId, { busy: 'Checking the sheet for changes…', error: null });
        try {
            if (deleted.length) {
                const result = await entry.sync.delete({ routes: deleted });
                if (result.conflict) return this._conflicted(entry, groupId);
            }
            if (routes.length || locations.length) {
                const result = await entry.sync.save({ locations, routes });
                if (result.conflict) return this._conflicted(entry, groupId);
            }
            this._set(entry, groupId, { busy: null });
            await this.refresh(groupId);
        } catch (error) {
            this._set(entry, groupId, { busy: null, error: error.message });
        }
    }

    /** Settles one conflict: 'insert' keeps the local version as a new row, 'discard' takes the sheet's. */
    async resolve(groupId, conflict, action) {
        const entry = this._layers.get(groupId);
        if (!entry) return;
        this._set(entry, groupId, { busy: action === 'insert' ? 'Inserting as a new row…' : null, error: null });
        try {
            if (action === 'insert') await entry.sync.conflicts.insertAsNew(conflict);
            else entry.sync.conflicts.discard(conflict.id, conflict.table);
            this._set(entry, groupId, { busy: null });
            if (!entry.sync.conflicts.active) await this.refresh(groupId);
        } catch (error) {
            this._set(entry, groupId, { busy: null, error: error.message });
        }
    }

    _conflicted(entry, groupId) {
        const count = entry.sync.conflicts.list().length;
        this._set(entry, groupId, { busy: null, error: `${count} row${count === 1 ? '' : 's'} changed in the sheet since you loaded it. Keep your version as a new row, or discard it.` });
    }

    _adopt(groupId, geojson) {
        const group = window.layerControl?._state?.groups?.find(g => g.id === groupId);
        if (group) group.geojson = geojson;
        setTimeout(() => window.routeStore?.sync());
    }

    _set(entry, groupId, patch) {
        Object.assign(entry, patch);
        window.dispatchEvent(new CustomEvent('route-sheet-changed', { detail: { groupId } }));
    }
}

export const routeSheets = new RouteSheets();
if (typeof window !== 'undefined') window.routeSheets = routeSheets;

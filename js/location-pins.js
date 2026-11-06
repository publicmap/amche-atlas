/**
 * A pin on the map at every location in the `locations` layer
 * (js/map-marker-manager.js) - saved places, and the stops of routes alike.
 * Clicking a pin opens its location's panel wherever that panel lives (the
 * dock column under the console in Explore, else beside the point), or
 * removes a location a map click left and nobody saved; dragging
 * it moves the location, through the marker's own drag handling, so a route
 * through it follows and the features under it are looked up again on release.
 * Let go on the open route, it joins that route instead (location-pin-drop.js).
 *
 * A location keeps its own colour whatever routes stop at it. While a route
 * is open or pointed at, the locations it stops at are drawn as its stops in
 * the route's diagram are (.route-stop-dot): numbered, in the route's colour.
 */
import { routeColorOf } from './search/route-meta.js';
import { dropTargetAt, showDropTarget, joinRoute } from './location-pin-drop.js';

const PIN_COLOR = '#f97316';
// A stop is a 22px disc centred on its point; the pin's anchor is its tip
const STOP_OFFSET = [0, 11];

/** The pin's shape, coloured by `--pin-color` on an ancestor; also the icon in its panel's header. */
export function pinSvg(width = 24, height = 32) {
    return `
    <svg width="${width}" height="${height}" viewBox="0 0 24 32" aria-hidden="true">
        <path class="location-pin-body" d="M12 31C12 31 2 18.6 2 11.5a10 10 0 0 1 20 0C22 18.6 12 31 12 31z"/>
        <circle cx="12" cy="11.5" r="4" fill="#fff"/>
    </svg>`;
}

/** A location's pin colour: one picked for it, else the default. */
export function pinColorOf(m) {
    return m?.color || PIN_COLOR;
}

export class LocationPins {
    /** @param {import('./map-marker-manager.js').MapMarkerManager} manager */
    constructor(manager) {
        this._manager = manager;
        this._pins = new Map();
        if (typeof window !== 'undefined') window.addEventListener('routes-changed', () => this.sync());
    }

    /** One pin per location, placed and coloured after it; pins of removed locations go. */
    sync() {
        if (typeof mapboxgl === 'undefined') return;
        const markers = this._manager._markers;
        const route = this._manager.activeRoute?.() || null;
        this._pins.forEach((pin, id) => {
            if (markers.has(id)) return;
            pin.marker.remove();
            this._pins.delete(id);
        });
        markers.forEach((m, id) => {
            const pin = this._pins.get(id) || this._create(id, m);
            if (!pin.dragging) pin.marker.setLngLat([m.lngLat.lng, m.lngLat.lat]);
            const el = pin.marker.getElement();
            el.style.display = m.routeHidden ? 'none' : '';
            el.style.setProperty('--pin-color', pinColorOf(m));
            this._syncPanelIcon(m);
            el.classList.toggle('selected', !!m.marker.getElement()?.classList.contains('marker-selected'));
            this._syncStop(pin, route, id);
            const label = this._manager.savedLabel(id);
            el.title = label ? `${label} - click to open, drag to move`
                : (!m.saved && !m.role ? 'Not saved - click to remove, drag to move' : 'Click to open, drag to move');
        });
    }

    /** Drawn as the active route's stop (numbered, in its colour) when that route stops here, else as a pin. */
    _syncStop(pin, route, id) {
        const index = route ? route.markerIds.indexOf(id) : -1;
        const el = pin.marker.getElement();
        const stop = index >= 0;
        if (el.classList.contains('is-stop') !== stop) pin.marker.setOffset(stop ? STOP_OFFSET : [0, 0]);
        el.classList.toggle('is-stop', stop);
        if (!stop) return;
        el.style.setProperty('--route-color', routeColorOf(route));
        el.querySelector('.location-pin-stop').textContent = String(index + 1);
    }

    /** The pin in the location's panel header, and its colour picker, in the pin's colour. */
    _syncPanelIcon(m) {
        const button = m.marker.getElement()?.querySelector('.marker-id-color');
        if (!button) return;
        const color = pinColorOf(m);
        button.style.setProperty('--pin-color', color);
        const input = button.querySelector('input');
        if (input && document.activeElement !== input) input.value = color;
    }

    /** Outlines a location's pin while its row in Find is pointed at. */
    highlight(id, on) {
        this._pins.get(id)?.marker.getElement().classList.toggle('active', !!on);
    }

    /** Keeps a location's pin on it while its panel is dragged instead. */
    follow(id) {
        const m = this._manager._markers.get(id);
        const pin = this._pins.get(id);
        if (m && pin && !pin.dragging) pin.marker.setLngLat(m.marker.getLngLat());
    }

    _create(id, m) {
        const map = this._manager._map;
        const el = document.createElement('div');
        el.className = 'location-pin';
        el.innerHTML = `${pinSvg()}<span class="location-pin-stop"></span>`;
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom', draggable: true })
            .setLngLat([m.lngLat.lng, m.lngLat.lat])
            .addTo(map);
        const pin = { marker, dragging: false, moved: false };
        const location = () => this._manager._markers.get(id);
        let frame = null;
        // Where the drag started, and where the pointer is: a drop on the open
        // route is read from the pointer, which can be over Find, not the map.
        // Over Find the map hears neither the moves (the pin waits at the
        // panel's edge) nor the release, so both are followed here, and a
        // release off the map ends mapbox's drag for it.
        let start = null;
        let pointer = null;
        const track = (e) => {
            pointer = { x: e.clientX, y: e.clientY, offMap: !e.target?.closest?.('.mapboxgl-canvas-container') };
            if (pin.dragging) showDropTarget(this._manager, dropTargetAt(this._manager, id, pointer.x, pointer.y), pointer.x, pointer.y);
        };
        const release = (e) => {
            if (!pin.dragging) return;
            track(e);
            if (e.target?.closest?.('.mapboxgl-canvas-container')) return;
            const box = map.getCanvas().getBoundingClientRect();
            const point = new mapboxgl.Point(e.clientX - box.left, e.clientY - box.top);
            map.fire('mouseup', { originalEvent: e, point, lngLat: map.unproject(point) });
        };

        el.addEventListener('pointerdown', (e) => {
            pin.moved = false;
            track(e);
        });
        marker.on('dragstart', () => {
            pin.dragging = true;
            pin.moved = true;
            start = { ...location()?.lngLat };
            window.addEventListener('pointermove', track, true);
            window.addEventListener('pointerup', release, true);
            this._manager._handleMarkerDragStart(id);
        });
        marker.on('drag', () => {
            const current = location();
            if (!current) return;
            current.marker.setLngLat(marker.getLngLat());
            if (current.docked) this._manager._layoutDockedPanels();
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                if (location()) this._manager._handleMarkerDrag(current.marker, id);
            });
        });
        marker.on('dragend', () => {
            if (frame) cancelAnimationFrame(frame);
            frame = null;
            pin.dragging = false;
            window.removeEventListener('pointermove', track, true);
            window.removeEventListener('pointerup', release, true);
            const current = location();
            const joining = pointer && dropTargetAt(this._manager, id, pointer.x, pointer.y);
            showDropTarget(this._manager, null);
            if (!current) return;
            if (joining && start?.lng !== undefined) {
                this._putBack(current, marker, start);
                joinRoute(this._manager, id, joining, start);
                return;
            }
            // Let go over Find but not on the route: nothing was meant to move
            if (pointer?.offMap && start?.lng !== undefined) {
                this._putBack(current, marker, start);
                return;
            }
            current.marker.setLngLat(marker.getLngLat());
            this._manager._handleMarkerDragEnd(current.marker, id);
        });
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!pin.moved) this._manager.openLocation(id);
        });
        ['mousemove', 'mouseover', 'dblclick'].forEach(type => el.addEventListener(type, (e) => e.stopPropagation()));
        // Pointing at a stop's pin picks out the same stop in its route's diagram
        const diagramStops = () => document.querySelectorAll(`.route-stop[data-marker-id="${CSS.escape(id)}"]`);
        el.addEventListener('mouseenter', () => diagramStops().forEach(node => node.classList.add('active')));
        el.addEventListener('mouseleave', () => diagramStops().forEach(node => node.classList.remove('active')));

        this._pins.set(id, pin);
        return pin;
    }

    /** A pin let go on the open route goes back where it was, and so does any route that followed it. */
    _putBack(current, marker, start) {
        this._manager._draggingMarkerId = null;
        current.lngLat = start;
        current.marker.setLngLat([start.lng, start.lat]);
        marker.setLngLat([start.lng, start.lat]);
        current.onDragEnd?.(start);
        this._manager._stateManager?.handleMapMouseLeave?.();
        if (current.docked) this._manager._layoutDockedPanels();
    }

    destroy() {
        this._pins.forEach(pin => pin.marker.remove());
        this._pins.clear();
    }
}

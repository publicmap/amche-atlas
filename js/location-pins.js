/**
 * A pin on the map at every location in the `locations` layer
 * (js/map-marker-manager.js) - saved places, and the stops of routes alike.
 * Clicking a pin opens its location's panel wherever that panel lives (the
 * dock column under the console in Explore, else beside the point); dragging
 * it moves the location, through the marker's own drag handling, so a route
 * through it follows and the features under it are looked up again on release.
 */
const PIN_COLOR = '#f97316';
const PIN_SVG = `
    <svg width="24" height="32" viewBox="0 0 24 32" aria-hidden="true">
        <path class="location-pin-body" d="M12 31C12 31 2 18.6 2 11.5a10 10 0 0 1 20 0C22 18.6 12 31 12 31z"/>
        <circle cx="12" cy="11.5" r="4" fill="#fff"/>
    </svg>`;

export class LocationPins {
    /** @param {import('./map-marker-manager.js').MapMarkerManager} manager */
    constructor(manager) {
        this._manager = manager;
        this._pins = new Map();
    }

    /** One pin per location, placed and coloured after it; pins of removed locations go. */
    sync() {
        if (typeof mapboxgl === 'undefined') return;
        const markers = this._manager._markers;
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
            el.style.setProperty('--pin-color', m.pinColor || PIN_COLOR);
            el.classList.toggle('selected', !!m.marker.getElement()?.classList.contains('marker-selected'));
            const label = this._manager.savedLabel(id);
            el.title = label ? `${label} - click to open, drag to move` : 'Click to open, drag to move';
        });
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
        el.innerHTML = PIN_SVG;
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom', draggable: true })
            .setLngLat([m.lngLat.lng, m.lngLat.lat])
            .addTo(map);
        const pin = { marker, dragging: false, moved: false };
        const location = () => this._manager._markers.get(id);
        let frame = null;

        el.addEventListener('pointerdown', () => { pin.moved = false; });
        marker.on('dragstart', () => {
            pin.dragging = true;
            pin.moved = true;
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
            const current = location();
            if (!current) return;
            current.marker.setLngLat(marker.getLngLat());
            this._manager._handleMarkerDragEnd(current.marker, id);
        });
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!pin.moved) this._manager.openLocation(id);
        });
        ['mousemove', 'mouseover', 'dblclick'].forEach(type => el.addEventListener(type, (e) => e.stopPropagation()));

        this._pins.set(id, pin);
        return pin;
    }

    destroy() {
        this._pins.forEach(pin => pin.marker.remove());
        this._pins.clear();
    }
}

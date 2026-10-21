/**
 * Map scale control - the representative fraction ("Scale: 1:X") over a
 * graduated scale bar (js/map-scale-bar.js), both for the map's centre at a
 * 96dpi screen. The label opens a menu of zoom levels and common map scales to
 * jump the map to.
 */

import { scaleBarSpec, createScaleBar, renderScaleBar } from './map-scale-bar.js';

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const METERS_PER_CSS_PIXEL = 0.0254 / 96;
const MAX_MENU_ZOOM = 19;
const COMMON_SCALES = [
    50000000, 25000000, 10000000, 5000000, 2500000, 1000000, 500000, 250000,
    100000, 50000, 25000, 10000, 5000, 2500, 1000, 500
];

export function metersPerPixel(latitude, zoom) {
    return EARTH_CIRCUMFERENCE_M * Math.abs(Math.cos(latitude * Math.PI / 180)) / Math.pow(2, zoom + 9);
}

export function scaleDenominator(latitude, zoom) {
    return metersPerPixel(latitude, zoom) / METERS_PER_CSS_PIXEL;
}

export function zoomForScale(latitude, denominator) {
    const metersPerPixel = denominator * METERS_PER_CSS_PIXEL;
    return Math.log2(EARTH_CIRCUMFERENCE_M * Math.abs(Math.cos(latitude * Math.PI / 180)) / metersPerPixel) - 9;
}

function roundScale(denominator) {
    const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(denominator)) - 2));
    return Math.round(denominator / magnitude) * magnitude;
}

// Rounded to three significant figures: the last digits only flicker as the
// map moves and say nothing a reader can use.
export function formatScale(denominator) {
    if (!Number.isFinite(denominator) || denominator <= 0) return '';
    return `Scale: 1:${roundScale(denominator).toLocaleString()}`;
}

// Zoom levels and common scales as one list, zoomed out first, kept to the
// zooms the map allows.
export function scaleOptions(latitude, minZoom = 0, maxZoom = 22) {
    const zooms = [];
    for (let z = 0; z <= MAX_MENU_ZOOM; z++) {
        zooms.push({ zoom: z, denominator: scaleDenominator(latitude, z), label: `z${z}` });
    }
    const scales = COMMON_SCALES.map(denominator => ({
        zoom: zoomForScale(latitude, denominator), denominator, label: null
    }));
    return [...zooms, ...scales]
        .filter(option => option.zoom >= minZoom && option.zoom <= maxZoom)
        .sort((a, b) => b.denominator - a.denominator);
}

export class MapScaleControl {
    constructor() {
        this._tools = [];
    }

    // Mounts another control inside the scale card, to the right of the bar.
    addTool(control) {
        this._card.append(this._mount(control));
    }

    // Mounts another control as its own card beside the scale card, in the
    // same row - side by side, where a corner control would stack above.
    addBeside(control) {
        this._container.append(this._mount(control));
    }

    // Drops the Mapbox control classes so the control takes the row's own
    // styling (css/styles.css) rather than the dark corner-control theme.
    _mount(control) {
        this._tools.push(control);
        const el = control.onAdd(this._map);
        el.classList.remove('mapboxgl-ctrl', 'mapboxgl-ctrl-group');
        return el;
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'map-scale-control';
        this._card = document.createElement('div');
        this._card.className = 'map-scale-card';
        this._container.append(this._card);
        this._label = document.createElement('button');
        this._label.type = 'button';
        this._label.className = 'map-scale-label';
        this._label.title = 'Set the map scale';
        this._label.setAttribute('aria-haspopup', 'menu');
        this._label.setAttribute('aria-expanded', 'false');
        this._label.addEventListener('click', this._toggleMenu);
        this._menu = document.createElement('div');
        this._menu.className = 'map-scale-menu';
        this._menu.setAttribute('role', 'menu');
        this._menu.hidden = true;
        this._menu.addEventListener('click', this._onMenuClick);
        this._bar = createScaleBar();
        const scale = document.createElement('div');
        scale.className = 'map-scale';
        scale.append(this._menu, this._label, this._bar);
        this._card.append(scale);
        map.on('move', this._update);
        this._update();
        return this._container;
    }

    onRemove() {
        this._closeMenu();
        this._map?.off('move', this._update);
        this._tools.forEach(control => control.onRemove());
        this._tools = [];
        this._container?.remove();
        this._map = null;
    }

    _update = () => {
        if (!this._map) return;
        const lat = this._map.getCenter().lat;
        const zoom = this._map.getZoom();
        this._label.textContent = formatScale(scaleDenominator(lat, zoom));
        renderScaleBar(this._bar, scaleBarSpec(metersPerPixel(lat, zoom)));
    }

    _toggleMenu = () => {
        if (this._menu.hidden) this._openMenu();
        else this._closeMenu();
    }

    _openMenu() {
        const lat = this._map.getCenter().lat;
        const zoom = this._map.getZoom();
        const options = scaleOptions(lat, this._map.getMinZoom(), this._map.getMaxZoom());
        const current = options.reduce((best, option) =>
            Math.abs(option.zoom - zoom) < Math.abs(best.zoom - zoom) ? option : best, options[0]);
        this._menu.innerHTML = '';
        options.forEach(option => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = option.label ? 'map-scale-option is-zoom' : 'map-scale-option';
            item.setAttribute('role', 'menuitem');
            item.dataset.zoom = String(option.zoom);
            item.classList.toggle('is-current', option === current);
            item.innerHTML = option.label
                ? `<span class="map-scale-zoom">${option.label}</span><span>1:${roundScale(option.denominator).toLocaleString()}</span>`
                : `<span class="map-scale-zoom"></span><span>1:${option.denominator.toLocaleString()}</span>`;
            this._menu.append(item);
        });
        this._menu.hidden = false;
        this._label.setAttribute('aria-expanded', 'true');
        const currentItem = this._menu.querySelector('.is-current');
        if (currentItem) {
            this._menu.scrollTop = currentItem.offsetTop - (this._menu.clientHeight - currentItem.offsetHeight) / 2;
        }
        document.addEventListener('pointerdown', this._onOutsidePointer, true);
        document.addEventListener('keydown', this._onKeydown);
    }

    _closeMenu() {
        if (!this._menu || this._menu.hidden) return;
        this._menu.hidden = true;
        this._label.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', this._onOutsidePointer, true);
        document.removeEventListener('keydown', this._onKeydown);
    }

    _onMenuClick = (event) => {
        const item = event.target.closest('.map-scale-option');
        if (!item) return;
        this._map.easeTo({ zoom: Number(item.dataset.zoom), duration: 500 });
        this._closeMenu();
    }

    _onOutsidePointer = (event) => {
        if (!this._container.contains(event.target)) this._closeMenu();
    }

    _onKeydown = (event) => {
        if (event.key === 'Escape') this._closeMenu();
    }
}

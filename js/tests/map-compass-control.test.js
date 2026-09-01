// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jQuery from 'jquery';

global.$ = global.jQuery = jQuery;
window.$ = window.jQuery = jQuery;

// The module extends mapboxgl.NavigationControl at load time, so the global has
// to exist first. This stub keeps the parts the compass touches: a button with
// an icon span for the tooltip, a click listener that would reset north, and
// the bearing/pitch accessors.
class NavigationControlStub {
    constructor(options) {
        this.options = options;
        this.resetNorthCalls = 0;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
        this._compass = document.createElement('button');
        this._compass.className = 'mapboxgl-ctrl-compass';
        this._compass.addEventListener('click', () => { this.resetNorthCalls++; });
        this._compassIcon = document.createElement('span');
        this._compassIcon.className = 'mapboxgl-ctrl-icon';
        this._compass.appendChild(this._compassIcon);
        this._container.appendChild(this._compass);
    }

    onAdd(map) {
        this._map = map;
        this._compassIcon.setAttribute('title', 'Reset bearing to north');
        return this._container;
    }

    onRemove() {
        this._container.remove();
        this._map = undefined;
    }
}

global.mapboxgl = { NavigationControl: NavigationControlStub };

const { MapCompassControl, bearingToCompassPoint, formatBearing, buildCompassTooltipLines } =
    await import('../map-compass-control.js');

function createMap(initial = {}) {
    const state = { bearing: 0, pitch: 0, ...initial };
    return {
        state,
        getBearing: () => state.bearing,
        getPitch: () => state.pitch,
        easeTo: vi.fn(({ bearing }) => { if (bearing != null) state.bearing = bearing; }),
        resetNorthPitch: vi.fn(() => { state.bearing = 0; state.pitch = 0; }),
        resetNorth: vi.fn(() => { state.bearing = 0; }),
        on: vi.fn(),
        off: vi.fn()
    };
}

function mount(map = createMap()) {
    const control = new MapCompassControl();
    const container = control.onAdd(map);
    document.body.appendChild(container);
    return { control, map, container };
}

// Simulates the absolute-orientation event browsers other than iOS emit.
function sendHeading(heading) {
    $(window).trigger($.Event('deviceorientationabsolute', {
        absolute: true,
        alpha: (360 - heading) % 360
    }));
}

function tooltipOf(control) {
    return control._compassTitleEl.getAttribute('title').split('\n');
}

describe('bearing formatting', () => {
    it('maps degrees to 16-point compass names', () => {
        expect(bearingToCompassPoint(0)).toBe('N');
        expect(bearingToCompassPoint(168)).toBe('SSE');
        expect(bearingToCompassPoint(22.5)).toBe('NNE');
        expect(bearingToCompassPoint(359)).toBe('N');
        expect(bearingToCompassPoint(-90)).toBe('W');
    });

    it('formats as compass point plus rounded degrees', () => {
        expect(formatBearing(168.4)).toBe('SSE 168');
        expect(formatBearing(-45)).toBe('NW 315');
        expect(formatBearing(359.7)).toBe('N 0');
    });
});

describe('tooltip lines', () => {
    it('omits the device line when no heading is available', () => {
        expect(buildCompassTooltipLines({
            deviceBearing: null, mapBearing: 45, lockedToDevice: false, canOfferDeviceLock: false
        })).toEqual([
            'Map Bearing NE 45',
            'Click to lock map bearing to North'
        ]);
    });

    it('reports the device bearing and offers the device lock first', () => {
        expect(buildCompassTooltipLines({
            deviceBearing: 168, mapBearing: 0, lockedToDevice: false, canOfferDeviceLock: true
        })).toEqual([
            'Device Bearing SSE 168',
            'Map Bearing N 0',
            'Click to lock map bearing to device'
        ]);
    });

    it('offers north once the map bearing is locked to the device', () => {
        expect(buildCompassTooltipLines({
            deviceBearing: 168, mapBearing: 168, lockedToDevice: true, canOfferDeviceLock: true
        })).toEqual([
            'Device Bearing SSE 168',
            'Map Bearing locked to device',
            'Click to lock map bearing to North'
        ]);
    });
});

describe('MapCompassControl', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('replaces the reset-bearing tooltip on mount', () => {
        const { control } = mount(createMap({ bearing: 90 }));
        expect(tooltipOf(control)).toEqual([
            'Map Bearing E 90',
            'Click to lock map bearing to North'
        ]);
    });

    it('tracks the device heading in the tooltip', () => {
        const { control } = mount(createMap({ bearing: 90 }));
        sendHeading(168);
        expect(tooltipOf(control)).toEqual([
            'Device Bearing SSE 168',
            'Map Bearing E 90',
            'Click to lock map bearing to device'
        ]);
    });

    it('locks to the device on first click instead of resetting north', () => {
        const { control, map } = mount(createMap({ bearing: 90 }));
        sendHeading(168);
        control._compass.click();

        expect(control.lockedToDevice).toBe(true);
        expect(map.resetNorthPitch).not.toHaveBeenCalled();
        expect(map.easeTo).toHaveBeenCalledWith({ bearing: 168, duration: 100 });
        expect(tooltipOf(control)[1]).toBe('Map Bearing locked to device');
    });

    it('suppresses the inherited reset-north click handler', () => {
        const { control } = mount();
        control._compass.click();
        expect(control.resetNorthCalls).toBe(0);
    });

    it('resets north and stops following the device on the next click', () => {
        const { control, map } = mount(createMap({ bearing: 90 }));
        sendHeading(168);
        control._compass.click();
        control._compass.click();

        expect(control.lockedToDevice).toBe(false);
        expect(map.resetNorthPitch).toHaveBeenCalled();
        expect(tooltipOf(control)[2]).toBe('Click to lock map bearing to device');
    });

    it('follows later headings only while locked', () => {
        const { control, map } = mount(createMap({ bearing: 90 }));
        sendHeading(168);
        expect(map.easeTo).not.toHaveBeenCalled();

        control.lockToDevice();
        control._lastDeviceEaseAt = -Infinity;
        sendHeading(200);
        expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 200, duration: 100 });

        control.unlockFromDevice();
        map.easeTo.mockClear();
        sendHeading(250);
        expect(map.easeTo).not.toHaveBeenCalled();
    });

    it('leaves the bearing untouched when unlocking', () => {
        const { control, map } = mount(createMap({ bearing: 90 }));
        sendHeading(168);
        control.lockToDevice();
        control.unlockFromDevice();
        expect(map.resetNorthPitch).not.toHaveBeenCalled();
        expect(map.state.bearing).toBe(168);
    });

    it('ignores unlock requests when it was never following the device', () => {
        const { control } = mount(createMap({ bearing: 90 }));
        control.unlockFromDevice();
        expect(control.lockedToDevice).toBe(false);
        expect(tooltipOf(control)[0]).toBe('Map Bearing E 90');
    });

    it('ignores relative orientation events', () => {
        const { control } = mount();
        $(window).trigger($.Event('deviceorientation', { absolute: false, alpha: 30 }));
        expect(control.deviceBearing).toBeNull();
    });

    it('reads the true heading iOS reports', () => {
        const { control } = mount();
        $(window).trigger($.Event('deviceorientation', { webkitCompassHeading: 168 }));
        expect(control.deviceBearing).toBe(168);
        expect(tooltipOf(control)[0]).toBe('Device Bearing SSE 168');
    });
});

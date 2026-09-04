// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jQuery from 'jquery';

global.$ = global.jQuery = jQuery;
window.$ = window.jQuery = jQuery;

// Mirrors the parts of mapboxgl.GeolocateControl the orientation button drives:
// the watch state machine, the class list it keeps in sync with it (the only
// way to read that state back), and the two calls that move between states.
const WATCH_STATE_CLASSES = {
    OFF: [],
    WAITING_ACTIVE: ['waiting', 'active'],
    ACTIVE_LOCK: ['active'],
    ACTIVE_ERROR: ['waiting', 'active-error'],
    BACKGROUND: ['background'],
    BACKGROUND_ERROR: ['waiting', 'background-error']
};

class GeolocateControlStub {
    constructor(options) {
        this.options = { followUserLocation: true, ...options };
        this._watchState = 'OFF';
        this._listeners = {};
        this._container = document.createElement('div');
        this._button = document.createElement('button');
        this._button.className = 'mapboxgl-ctrl-geolocate';
    }

    onAdd(map) {
        this._map = map;
        this._container.appendChild(this._button);
        return this._container;
    }

    onRemove() { this._container.remove(); }

    on(type, listener) { (this._listeners[type] ||= []).push(listener); }
    once(type, listener) { this.on(type, listener); }
    off(type, listener) {
        this._listeners[type] = (this._listeners[type] || []).filter(l => l !== listener);
    }

    _setWatchState(state) {
        this._watchState = state;
        this._button.className = ['mapboxgl-ctrl-geolocate',
            ...WATCH_STATE_CLASSES[state].map(c => `mapboxgl-ctrl-geolocate-${c}`)].join(' ');
    }

    trigger() {
        if (this._watchState === 'OFF') this._setWatchState('WAITING_ACTIVE');
        else if (this._watchState === 'BACKGROUND') this._setWatchState('ACTIVE_LOCK');
        else this._setWatchState('OFF');
        return true;
    }

    setFollowUserLocation(follow) {
        this.options.followUserLocation = follow;
        if (this._watchState === 'OFF') return this;
        if (follow && this._watchState.startsWith('BACKGROUND')) this._setWatchState('ACTIVE_LOCK');
        if (!follow && this._watchState.startsWith('ACTIVE')) this._setWatchState('BACKGROUND');
        return this;
    }

    // Test-only: the first position fix landing, and the user panning away.
    resolvePosition() { this._setWatchState(this.options.followUserLocation ? 'ACTIVE_LOCK' : 'BACKGROUND'); }
    panAway() { if (this._watchState === 'ACTIVE_LOCK') this._setWatchState('BACKGROUND'); }
}

global.mapboxgl = window.mapboxgl = { GeolocateControl: GeolocateControlStub };

const { MapOrientationControl } = await import('../map-orientation-control.js');
const { MODE, nextOrientationAction, bearingToCompassPoint, formatBearing, buildOrientationTooltipLines } =
    await import('../map-orientation-modes.js');

function createMap(initial = {}) {
    const state = { bearing: 0, pitch: 0, ...initial };
    return {
        state,
        getBearing: () => state.bearing,
        getPitch: () => state.pitch,
        easeTo: vi.fn(({ bearing, pitch }) => {
            if (bearing != null) state.bearing = bearing;
            if (pitch != null) state.pitch = pitch;
        }),
        on: vi.fn(),
        off: vi.fn()
    };
}

// MutationObserver callbacks land on a microtask, so every class change the
// control reads back needs a tick to arrive.
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let mounted = [];

function mount(map = createMap()) {
    const control = new MapOrientationControl();
    const container = control.onAdd(map);
    document.body.appendChild(container);
    // Nothing in the test URL asks for tracking, so drop the 15s poll the
    // splash hand-off would otherwise leave running.
    control._watch.cancelAutoActivate();
    mounted.push(control);
    return { control, map, container, geolocate: control._watch._control, button: container.querySelector('button') };
}

function sendHeading(heading) {
    $(window).trigger($.Event('deviceorientationabsolute', { absolute: true, alpha: (360 - heading) % 360 }));
}

function tooltipOf(control) {
    return control._button.getAttribute('title').split('\n');
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => {
    mounted.forEach(control => control.onRemove());
    mounted = [];
});

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

describe('click cycle', () => {
    it('walks lock, north, unlock, off', () => {
        expect(nextOrientationAction({ mode: MODE.OFF, mapBearing: 0 })).toBe('start');
        expect(nextOrientationAction({ mode: MODE.FOLLOW_HEADING })).toBe('north');
        expect(nextOrientationAction({ mode: MODE.FOLLOW_NORTH })).toBe('unlock');
        expect(nextOrientationAction({ mode: MODE.UNLOCKED })).toBe('off');
    });

    it('cancels a pending fix and clears an error', () => {
        expect(nextOrientationAction({ mode: MODE.LOCATING })).toBe('off');
        expect(nextOrientationAction({ mode: MODE.ERROR })).toBe('off');
    });

    it('straightens a hand-rotated map before asking for location', () => {
        expect(nextOrientationAction({ mode: MODE.OFF, mapBearing: 45 })).toBe('north');
        expect(nextOrientationAction({ mode: MODE.OFF, mapBearing: 359.7 })).toBe('start');
    });
});

describe('tooltip lines', () => {
    it('omits the device line when no heading is available', () => {
        expect(buildOrientationTooltipLines({
            mode: MODE.OFF, deviceBearing: null, mapBearing: 45, lockedToDevice: false, canOfferDeviceLock: false
        })).toEqual([
            'Map Bearing NE 45',
            'GPS off',
            'Click to face the map North'
        ]);
    });

    it('offers the heading lock when a device compass is available', () => {
        expect(buildOrientationTooltipLines({
            mode: MODE.OFF, deviceBearing: 168, mapBearing: 0, lockedToDevice: false, canOfferDeviceLock: true
        })).toEqual([
            'Device Bearing SSE 168',
            'Map Bearing N 0',
            'GPS off',
            'Click to lock the map to your location and heading'
        ]);
    });

    it('reports the device lock and offers north next', () => {
        expect(buildOrientationTooltipLines({
            mode: MODE.FOLLOW_HEADING, deviceBearing: 168, mapBearing: 168, lockedToDevice: true, canOfferDeviceLock: true
        })).toEqual([
            'Device Bearing SSE 168',
            'Map Bearing locked to device',
            'GPS locked, map follows your heading',
            'Click to face the map North'
        ]);
    });
});

describe('MapOrientationControl', () => {
    it('renders the map bearing on the needle', () => {
        const { control, map } = mount(createMap({ bearing: 90 }));
        expect(control._needle.getAttribute('transform')).toBe('rotate(-90 18 18)');
        expect(tooltipOf(control)[0]).toBe('Map Bearing E 90');
        expect(map.on).toHaveBeenCalledWith('rotate', control._render);
    });

    it('leans the rose back with the map pitch', () => {
        const { control, map } = mount(createMap({ pitch: 60 }));
        // NavigationControl's visualizePitch transform: rotateX by the pitch,
        // scaled by 1/sqrt(cos(pitch)) to counter the foreshortening.
        const [, scale] = control._icon.style.transform.match(/^scale\(([\d.]+)\) rotateX\(60deg\)$/);
        expect(Number(scale)).toBeCloseTo(Math.SQRT2, 6);

        map.state.pitch = 0;
        control._render();
        expect(control._icon.style.transform).toBe('');
    });

    it('shows the device heading on the ring without following it', () => {
        const { control, map } = mount(createMap({ bearing: 90 }));
        sendHeading(168);
        expect(control.deviceBearing).toBe(168);
        expect(control._headingTick.getAttribute('transform')).toBe('rotate(78 18 18)');
        expect(map.easeTo).not.toHaveBeenCalled();
    });

    it('reads the true heading iOS reports', () => {
        const { control } = mount();
        $(window).trigger($.Event('deviceorientation', { webkitCompassHeading: 168 }));
        expect(control.deviceBearing).toBe(168);
    });

    it('ignores relative orientation events', () => {
        const { control } = mount();
        $(window).trigger($.Event('deviceorientation', { absolute: false, alpha: 30 }));
        expect(control.deviceBearing).toBeNull();
    });

    it('cycles through both locks and back to off', async () => {
        const { control, map, geolocate, button } = mount();
        sendHeading(168);

        button.click();
        await flush();
        expect(geolocate._watchState).toBe('WAITING_ACTIVE');
        expect(control.mode).toBe(MODE.LOCATING);
        expect(button.dataset.mode).toBe('locating');

        geolocate.resolvePosition();
        await flush();
        expect(control.mode).toBe(MODE.FOLLOW_HEADING);
        expect(control.lockedToDevice).toBe(true);
        expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 168, duration: 100 }, { geolocateSource: true });

        button.click();
        await flush();
        expect(control.mode).toBe(MODE.FOLLOW_NORTH);
        expect(control.lockedToDevice).toBe(false);
        // Still following the user's position - only the bearing changed.
        expect(geolocate._watchState).toBe('ACTIVE_LOCK');
        expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 0, pitch: 0, duration: 500 }, { geolocateSource: true });

        button.click();
        await flush();
        expect(control.mode).toBe(MODE.UNLOCKED);
        expect(geolocate._watchState).toBe('BACKGROUND');
        expect(control.isTracking).toBe(true);

        button.click();
        await flush();
        expect(control.mode).toBe(MODE.OFF);
        expect(geolocate._watchState).toBe('OFF');
        expect(control.isTracking).toBe(false);
        expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 0, pitch: 0, duration: 1000 }, { geolocateSource: true });
    });

    it('tags its own camera moves so GL JS does not read them as panning away', async () => {
        const { map, geolocate, button } = mount();
        sendHeading(168);
        button.click();
        geolocate.resolvePosition();
        await flush();
        expect(map.easeTo.mock.calls.every(([, eventData]) => eventData?.geolocateSource === true)).toBe(true);
    });

    it('skips the heading lock where no device compass is available', async () => {
        const { control, geolocate, button } = mount();
        button.click();
        geolocate.resolvePosition();
        await flush();
        expect(control.mode).toBe(MODE.FOLLOW_NORTH);
        expect(control.lockedToDevice).toBe(false);
    });

    it('restores position following after an unlock, then off, then on', async () => {
        const { control, geolocate, button } = mount();
        button.click();
        geolocate.resolvePosition();
        await flush();
        button.click(); // unlock (no device heading, so this is the second step)
        await flush();
        expect(geolocate._watchState).toBe('BACKGROUND');

        button.click(); // off
        await flush();
        expect(geolocate._watchState).toBe('OFF');

        button.click(); // on again
        geolocate.resolvePosition();
        await flush();
        expect(geolocate._watchState).toBe('ACTIVE_LOCK');
        expect(control.mode).toBe(MODE.FOLLOW_NORTH);
    });

    it('drops to unlocked, and releases the device lock, when the user pans away', async () => {
        const { control, geolocate, button } = mount();
        sendHeading(168);
        button.click();
        geolocate.resolvePosition();
        await flush();
        expect(control.lockedToDevice).toBe(true);

        geolocate.panAway();
        await flush();
        expect(control.mode).toBe(MODE.UNLOCKED);
        expect(control.lockedToDevice).toBe(false);
        expect(button.dataset.mode).toBe('unlocked');
    });

    it('stops following the device once unlocked', async () => {
        const { control, map, geolocate, button } = mount();
        sendHeading(168);
        button.click();
        geolocate.resolvePosition();
        await flush();

        control._lastDeviceEaseAt = -Infinity;
        sendHeading(200);
        expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 200, duration: 100 }, { geolocateSource: true });

        geolocate.panAway();
        await flush();
        map.easeTo.mockClear();
        control._lastDeviceEaseAt = -Infinity;
        sendHeading(250);
        expect(map.easeTo).not.toHaveBeenCalled();
    });

    it('turns off from unlocked in a single call', async () => {
        const { control, geolocate, button } = mount();
        button.click();
        geolocate.resolvePosition();
        await flush();
        geolocate.panAway();
        await flush();

        control.turnOff();
        await flush();
        expect(geolocate._watchState).toBe('OFF');
        expect(control.mode).toBe(MODE.OFF);
    });

    it('writes geolocate to the URL only while the camera is locked', async () => {
        const updates = [];
        const listener = (event, params) => { if (params?.geolocate !== undefined) updates.push(params.geolocate); };
        $(document).on('update_url', listener);
        try {
            const { geolocate, button } = mount();
            button.click();
            await flush();
            expect(updates).toEqual([true]);

            geolocate.resolvePosition();
            await flush();
            expect(updates).toEqual([true]);

            geolocate.panAway();
            await flush();
            expect(updates).toEqual([true, false]);

            button.click(); // off
            await flush();
            expect(updates).toEqual([true, false]);
        } finally {
            $(document).off('update_url', listener);
        }
    });

    it('straightens a hand-rotated map before starting GPS', async () => {
        const { control, map, geolocate, button } = mount(createMap({ bearing: 90 }));
        button.click();
        await flush();
        expect(geolocate._watchState).toBe('OFF');
        expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 0, pitch: 0, duration: 500 }, { geolocateSource: true });

        button.click();
        await flush();
        expect(geolocate._watchState).toBe('WAITING_ACTIVE');
        expect(control.mode).toBe(MODE.LOCATING);
    });
});

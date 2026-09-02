/**
 * Orientation button modes
 *
 * The pure half of js/map-orientation-control.js: the mode enum, the click
 * cycle, and the wording that goes in the tooltip and the status bar. Kept
 * free of DOM and map references so the cycle is testable on its own.
 *
 * One button now owns both GPS tracking and map bearing, so a click walks a
 * single loop:
 *
 *   off -> locating -> follow + heading -> follow + north -> unlocked -> off
 *
 * `follow + heading` is skipped where no device compass is available (most
 * desktops), and panning the map while following drops straight to `unlocked`
 * - which is the same place the third click would have landed anyway.
 */

export const MODE = {
    OFF: 'off',
    LOCATING: 'locating',
    FOLLOW_HEADING: 'follow-heading',
    FOLLOW_NORTH: 'follow-north',
    UNLOCKED: 'unlocked',
    ERROR: 'error'
};

const COMPASS_POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function normalizeBearing(bearing) {
    return ((bearing % 360) + 360) % 360;
}

export function bearingToCompassPoint(bearing) {
    return COMPASS_POINTS[Math.round(normalizeBearing(bearing) / 22.5) % 16];
}

export function formatBearing(bearing) {
    const normalized = normalizeBearing(bearing);
    return `${bearingToCompassPoint(normalized)} ${Math.round(normalized) % 360}`;
}

// What the next click does. `north` is the one action that means two different
// things depending on where it's reached from - with GPS off it's the plain
// compass reset the button used to offer on its own, and while following it
// also stops the map turning with the device.
export function nextOrientationAction({ mode, mapBearing = 0 }) {
    switch (mode) {
        case MODE.FOLLOW_HEADING:
            return 'north';
        case MODE.FOLLOW_NORTH:
            return 'unlock';
        case MODE.LOCATING:
        case MODE.UNLOCKED:
        case MODE.ERROR:
            return 'off';
        default:
            // GPS is off, but the map can still have been rotated by hand and
            // this is the only button left that can straighten it - so clear
            // the bearing first and start GPS on the click after that. Without
            // this, getting back to north would need location permission.
            return Math.round(normalizeBearing(mapBearing)) % 360 === 0 ? 'start' : 'north';
    }
}

const MODE_LABELS = {
    [MODE.OFF]: 'GPS off',
    [MODE.LOCATING]: 'Finding your location…',
    [MODE.FOLLOW_HEADING]: 'GPS locked, map follows your heading',
    [MODE.FOLLOW_NORTH]: 'GPS locked, map faces North',
    [MODE.UNLOCKED]: 'GPS on, map unlocked',
    [MODE.ERROR]: 'GPS unavailable'
};

const ACTION_LABELS = {
    start: 'Click to lock the map to your location',
    north: 'Click to face the map North',
    unlock: 'Click to unlock the map from your location',
    off: 'Click to turn GPS off'
};

// Status bar text, shown for a few seconds on every mode change. The tooltip
// is unreachable on touch devices, so this is the only running commentary a
// phone user gets on what their tap just did.
export const MODE_MESSAGES = {
    [MODE.LOCATING]: 'Finding your location…',
    [MODE.FOLLOW_HEADING]: 'Map locked to your location, following your heading',
    [MODE.FOLLOW_NORTH]: 'Map locked to your location, facing North',
    [MODE.UNLOCKED]: 'Map unlocked. GPS still on',
    [MODE.OFF]: 'Location tracking stopped'
};

export function buildOrientationTooltipLines({ mode, deviceBearing, mapBearing, lockedToDevice, canOfferDeviceLock }) {
    const lines = [];
    if (deviceBearing != null) {
        lines.push(`Device Bearing ${formatBearing(deviceBearing)}`);
    }
    lines.push(lockedToDevice
        ? 'Map Bearing locked to device'
        : `Map Bearing ${formatBearing(mapBearing)}`);
    lines.push(MODE_LABELS[mode] || MODE_LABELS[MODE.OFF]);

    const action = nextOrientationAction({ mode, mapBearing });
    lines.push(action === 'start' && canOfferDeviceLock
        ? 'Click to lock the map to your location and heading'
        : ACTION_LABELS[action]);
    return lines;
}

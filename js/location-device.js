/**
 * The Locate panel (js/locate-panel.js): where the
 * device is - its latest GPS fix, accuracy, altitude, speed, heading and the
 * compass bearing it faces - and
 * its track log (js/gpx-log.js): Log Track and how often it logs, how the map
 * follows the device (the orientation button's modes, js/map-orientation-control.js),
 * then the tracks of this and past sessions, each to fit the map to, download
 * as GPX or delete, and Clear all.
 */
import { INTERVALS, formatDistance, trackDistance, trackName, trackToGpx, trackLog } from './gpx-log.js';

const DASH = '—';

const ORIENTATION_OPTIONS = [
    ['off', 'Off', 'Turn GPS off'],
    ['north', 'North up', 'Follow your location with north at the top'],
    ['heading', 'Heading', 'Follow your location and turn the map with the way the device faces'],
    ['free', 'Free', 'Keep GPS on and leave the map where you put it']
];

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function iconButton(icon, title, onClick) {
    const button = el('button', 'place-track-action');
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = `<sl-icon name="${icon}"></sl-icon>`;
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return button;
}

function intervalLabel(seconds) {
    return seconds < 60 ? `${seconds} s` : `${seconds / 60} min`;
}

function ago(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds} s ago`;
    return seconds < 3600 ? `${Math.round(seconds / 60)} min ago` : new Date(timestamp).toLocaleTimeString();
}

function download(track) {
    const url = URL.createObjectURL(new Blob([trackToGpx(track)], { type: 'application/gpx+xml' }));
    const link = el('a');
    link.href = url;
    link.download = `amche-track-${new Date(track.startedAt).toISOString().slice(0, 16).replace(/[-:T]/g, '')}.gpx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fitTrack(map, track) {
    const lngs = track.points.map(p => p[0]);
    const lats = track.points.map(p => p[1]);
    map?.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, maxZoom: 17 });
}

/**
 * @param {HTMLElement} panel - where the readouts and log go
 * @param {Object} map
 * @returns {{refresh: () => void, destroy: () => void}} - `refresh()` updates
 *   the live readouts, `destroy()` stops following the log
 */
export function buildDevicePanel(panel, map) {
    const grid = el('div', 'place-readouts');
    const values = {};
    [
        ['position', 'Position', 'place-readout-wide'],
        ['accuracy', 'Accuracy'],
        ['altitude', 'Altitude'],
        ['speed', 'Speed'],
        ['heading', 'Heading'],
        ['compass', 'Compass'],
        ['updated', 'Updated']
    ].forEach(([key, label, extra]) => {
        const cell = el('div', `place-readout ${extra || ''}`.trim());
        values[key] = el('span', 'place-readout-value', DASH);
        cell.append(el('span', 'place-readout-label', label), values[key]);
        grid.appendChild(cell);
    });

    const log = el('div', 'place-log');
    const toggle = el('button', 'place-switch');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.innerHTML = '<span class="place-switch-track" aria-hidden="true"></span><span>Log Track</span>';
    toggle.title = 'Record this device\'s location as a track on the map';
    toggle.addEventListener('click', () => trackLog.setLogging(!trackLog.logging));
    const every = el('label', 'place-log-interval', 'Every');
    const select = el('select');
    select.setAttribute('aria-label', 'How often to log a point');
    INTERVALS.forEach(seconds => select.appendChild(Object.assign(el('option', null, intervalLabel(seconds)), { value: seconds })));
    select.addEventListener('change', () => trackLog.setInterval(Number(select.value)));
    every.appendChild(select);
    log.append(toggle, every);

    const follow = el('div', 'place-follow');
    const options = el('div', 'place-segments');
    options.setAttribute('role', 'radiogroup');
    options.setAttribute('aria-label', 'Map follows');
    const optionButtons = ORIENTATION_OPTIONS.map(([id, label, title]) => {
        const button = el('button', 'place-segment', label);
        button.type = 'button';
        button.title = title;
        button.setAttribute('role', 'radio');
        button.addEventListener('click', () => {
            window.geolocationControl?.setOrientationOption(id);
            refresh();
        });
        options.appendChild(button);
        return [id, button, title];
    });
    follow.append(el('span', 'place-follow-label', 'Map'), options);

    const error = el('div', 'place-log-error');
    const tracks = el('section', 'place-compartment place-tracks');
    tracks.setAttribute('aria-label', 'Tracks on this device');
    panel.append(grid, log, follow, error, tracks);

    const renderTracks = () => {
        tracks.innerHTML = '';
        const head = el('div', 'place-compartment-title place-tracks-head');
        head.appendChild(el('span', null, 'Tracks on this device'));
        const list = trackLog.tracks();
        if (list.length) {
            const clear = el('button', 'place-tracks-clear', 'Clear all');
            clear.type = 'button';
            clear.title = 'Delete every track stored on this device';
            clear.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.confirm(`Delete all ${list.length} track${list.length === 1 ? '' : 's'} from this device?`)) trackLog.clear();
            });
            head.appendChild(clear);
        }
        tracks.appendChild(head);
        if (!list.length) {
            tracks.appendChild(el('p', 'place-tracks-empty', 'No tracks yet. Turn on Log Track to record where this device goes. Tracks stay in this browser only.'));
            return;
        }
        list.forEach(track => {
            const row = el('div', 'place-track');
            const current = track.id === trackLog.sessionId;
            const name = el('button', 'place-track-name');
            name.type = 'button';
            name.title = 'Show this track on the map';
            name.appendChild(el('span', null, trackName(track).replace(/^Track /, '')));
            if (current) name.appendChild(el('span', 'place-track-now', trackLog.logging ? 'Logging' : 'This session'));
            name.appendChild(el('span', 'place-track-meta',
                `${formatDistance(trackDistance(track.points))} · ${track.points.length} point${track.points.length === 1 ? '' : 's'}`));
            name.addEventListener('click', () => fitTrack(map, track));
            row.append(name,
                iconButton('download', 'Download as GPX', () => download(track)),
                iconButton('trash3', 'Delete this track', () => trackLog.clear(track.id)));
            row.classList.toggle('is-current', current);
            tracks.appendChild(row);
        });
    };

    const render = () => {
        toggle.setAttribute('aria-checked', String(trackLog.logging));
        select.value = String(trackLog.settings.interval);
        renderTracks();
    };

    const refresh = () => {
        const fix = trackLog.fix;
        const control = window.geolocationControl;
        values.position.textContent = fix ? `${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}` : DASH;
        values.accuracy.textContent = fix?.accuracy != null ? `±${Math.round(fix.accuracy)} m` : DASH;
        values.altitude.textContent = fix?.altitude != null ? `${Math.round(fix.altitude)} m` : DASH;
        values.speed.textContent = fix?.speed != null ? `${(fix.speed * 3.6).toFixed(1)} km/h` : DASH;
        values.heading.textContent = fix?.heading != null && !Number.isNaN(fix.heading) ? `${Math.round(fix.heading)}°` : DASH;
        values.compass.textContent = control?.deviceBearing != null ? `${Math.round(control.deviceBearing)}°` : DASH;
        values.updated.textContent = fix ? ago(fix.timestamp) : (control?.isTracking ? 'Locating' : 'GPS off');
        const option = control?.orientationOption ?? 'off';
        optionButtons.forEach(([id, button, title]) => {
            const noCompass = id === 'heading' && !control?.canFollowHeading;
            button.setAttribute('aria-checked', String(id === option));
            button.disabled = noCompass || (id === 'free' && !control?.isTracking);
            button.title = noCompass ? 'This device has no compass to follow' : title;
        });
        const message = trackLog.error || (trackLog.paused ? 'Paused while location is off. Click Locate Me to resume.' : '');
        error.textContent = message;
        error.hidden = !message;
    };

    render();
    refresh();
    const destroy = trackLog.onChange(render);
    return { refresh, destroy };
}

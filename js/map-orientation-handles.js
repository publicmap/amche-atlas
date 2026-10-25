const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const PITCH_LABEL = 'Drag to tilt the map. Click to flatten.';
const BEARING_LABEL = 'Drag the N around the compass to rotate the map. Click to face north.';

const CLICK_SLOP = 3;
const TILT_STEP = 15;

// Tilting is not the user panning away, so it must not unlock GPS following
// (see _easeTo in js/map-orientation-control.js).
const CAMERA_SOURCE = { geolocateSource: true };

const toRadians = (degrees) => degrees * (Math.PI / 180);

// The compass leans back by a share of the map pitch rather than all of it:
// near the 85 degree maximum a full lean would flatten the dial to a line.
const TILT_SHARE = 0.6;

// The icon is 0.85 of its button (css/styles.css), so this is as far as the
// tilted compass can grow before it spills out of the button.
const MAX_PITCH_SCALE = 1.15;

export function compassTilt(pitch) {
    return pitch * TILT_SHARE;
}

export function pitchTransform(pitch) {
    if (!pitch) return '';
    const tilt = compassTilt(pitch);
    const scale = Math.min(1 / Math.pow(Math.cos(toRadians(tilt)), 0.5), MAX_PITCH_SCALE);
    return `scale(${scale}) rotateX(${tilt}deg)`;
}

export class OrientationHandles {
    constructor(map, { pitchParent, ringParent }, onChange) {
        this._map = map;
        this._onChange = onChange;
        this._dragging = 0;

        this._pitchTrack = this._element('map-orientation-track map-orientation-track--pitch', PITCH_LABEL);
        this._ring = this._element('map-orientation-ring', BEARING_LABEL);
        pitchParent.append(
            this._tiltButton(TILT_STEP, 'Tilt the map', 'M3 7.5 L6 4.5 L9 7.5'),
            this._pitchTrack,
            this._tiltButton(-TILT_STEP, 'Flatten the map', 'M3 4.5 L6 7.5 L9 4.5')
        );
        ringParent.append(this._ring);

        this._drag(this._pitchTrack.firstChild, (event) => {
            const rect = this._pitchTrack.getBoundingClientRect();
            const ratio = clamp((rect.bottom - event.clientY) / rect.height, 0, 1);
            this._map.jumpTo({ pitch: ratio * this._map.getMaxPitch() }, CAMERA_SOURCE);
        }, () => this._map.easeTo({ pitch: 0, duration: 300 }, CAMERA_SOURCE));

        this._drag(this._ring.firstChild, (event) => {
            const rect = this._ring.getBoundingClientRect();
            const dx = (event.clientX - (rect.left + rect.width / 2)) * Math.cos(toRadians(compassTilt(this._map.getPitch())));
            const dy = event.clientY - (rect.top + rect.height / 2);
            this._map.jumpTo({ bearing: -Math.atan2(dx, -dy) * (180 / Math.PI) });
        }, () => this._map.easeTo({ bearing: 0, duration: 300 }));
    }

    get active() { return this._dragging > 0; }

    sync() {
        const pitch = this._map.getPitch();
        this._pitchTrack.style.setProperty('--pos', clamp(pitch / this._map.getMaxPitch(), 0, 1));
        this._pitchTrack.setAttribute('aria-valuenow', String(Math.round(pitch)));
        this._ring.style.transform = `${pitchTransform(pitch)} rotate(${-this._map.getBearing()}deg)`;
    }

    _tiltButton(step, label, path) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'map-orientation-tilt';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const pitch = clamp(this._map.getPitch() + step, 0, this._map.getMaxPitch());
            this._map.easeTo({ pitch, duration: 300 }, CAMERA_SOURCE);
        });
        return button;
    }

    _element(className, label) {
        const element = document.createElement('div');
        element.className = className;
        element.setAttribute('role', 'slider');
        element.setAttribute('aria-label', label);
        element.title = label;
        element.innerHTML = '<div class="map-orientation-thumb"></div>';
        return element;
    }

    _drag(target, move, reset) {
        let start = null;
        let moved = false;
        target.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            target.setPointerCapture(event.pointerId);
            start = { x: event.clientX, y: event.clientY };
            moved = false;
            this._dragging++;
        });
        target.addEventListener('pointermove', (event) => {
            if (!start) return;
            if (!moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < CLICK_SLOP) return;
            moved = true;
            move(event);
        });
        const end = (event) => {
            if (!start) return;
            start = null;
            this._dragging--;
            if (!moved && event.type === 'pointerup') reset();
            this._onChange();
        };
        target.addEventListener('pointerup', end);
        target.addEventListener('pointercancel', end);
        target.addEventListener('click', (event) => event.stopPropagation());
    }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const PITCH_LABEL = 'Drag to tilt the map. Click to flatten.';
const BEARING_LABEL = 'Drag the north marker around the compass to rotate the map. Click to face north.';

const CLICK_SLOP = 3;

const toRadians = (degrees) => degrees * (Math.PI / 180);

export function pitchTransform(pitch) {
    if (!pitch) return '';
    return `scale(${1 / Math.pow(Math.cos(toRadians(pitch)), 0.5)}) rotateX(${pitch}deg)`;
}

export class OrientationHandles {
    constructor(map, container, onChange) {
        this._map = map;
        this._onChange = onChange;
        this._dragging = 0;

        this._pitchTrack = this._element('map-orientation-track map-orientation-track--pitch', PITCH_LABEL);
        this._ring = this._element('map-orientation-ring', BEARING_LABEL);
        container.append(this._pitchTrack, this._ring);

        this._drag(this._pitchTrack.firstChild, (event) => {
            const rect = this._pitchTrack.getBoundingClientRect();
            const ratio = clamp((rect.bottom - event.clientY) / rect.height, 0, 1);
            this._map.jumpTo({ pitch: ratio * this._map.getMaxPitch() });
        }, () => this._map.easeTo({ pitch: 0, duration: 300 }));

        this._drag(this._ring.firstChild, (event) => {
            const rect = this._ring.getBoundingClientRect();
            const flatten = Math.pow(Math.cos(toRadians(this._map.getPitch())), 0.5);
            const dx = (event.clientX - (rect.left + rect.width / 2)) * flatten;
            const dy = (event.clientY - (rect.top + rect.height / 2)) / flatten;
            this._map.jumpTo({ bearing: -Math.atan2(dx, -dy) * (180 / Math.PI) });
        }, () => this._map.easeTo({ bearing: 0, duration: 300 }));
    }

    get active() { return this._dragging > 0; }

    sync() {
        const ratio = this._map.getPitch() / this._map.getMaxPitch();
        this._pitchTrack.style.setProperty('--pos', clamp(ratio, 0, 1));
        this._ring.style.transform = `${pitchTransform(this._map.getPitch())} rotate(${-this._map.getBearing()}deg)`;
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

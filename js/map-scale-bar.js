/**
 * Graduated scale bar, drawn like the one on a printed map: alternating black
 * and white segments under 0 / half / full distance ticks. Used by
 * js/map-scale-control.js under its "Scale: 1:X" label.
 */

const SEGMENTS = 4;

// The largest 1, 2 or 5 x 10^n distance that fits in maxWidth pixels.
export function scaleBarSpec(metersPerPixel, maxWidth = 100) {
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
    const maxMeters = metersPerPixel * maxWidth;
    const pow10 = Math.pow(10, Math.floor(Math.log10(maxMeters)));
    const step = [5, 2, 1].find(d => d * pow10 <= maxMeters) || 1;
    const meters = step * pow10;
    const unit = meters >= 1000 ? 'km' : 'm';
    const total = unit === 'km' ? meters / 1000 : meters;
    return { width: meters / metersPerPixel, total, half: total / 2, unit };
}

export function createScaleBar() {
    const el = document.createElement('div');
    el.className = 'map-scale-bar';
    el.innerHTML = `
        <div class="map-scale-ticks">
            <span class="map-scale-tick is-start">0</span>
            <span class="map-scale-tick is-half"></span>
            <span class="map-scale-tick is-end"></span>
        </div>
        <div class="map-scale-segments">${'<span></span>'.repeat(SEGMENTS)}</div>
    `;
    return el;
}

export function renderScaleBar(el, spec) {
    el.hidden = !spec;
    if (!spec) return;
    el.style.width = `${Math.round(spec.width)}px`;
    el.querySelector('.is-half').textContent = spec.half.toLocaleString();
    el.querySelector('.is-end').textContent = `${spec.total.toLocaleString()} ${spec.unit}`;
}

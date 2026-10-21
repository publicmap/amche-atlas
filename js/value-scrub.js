/**
 * A value you drag to change, as in a design tool: drag sideways across it
 * to scrub, click it to type a value, double-click to reset it, or use the
 * arrow keys (Shift for bigger steps). A bar under the value shows where it
 * sits in its range. Used by the place menu's Map view tab
 * (js/location-view.js).
 */

const DRAG_THRESHOLD_PX = 3;

/**
 * @param {Object} options
 * @param {string} options.label
 * @param {string} [options.icon] - a Shoelace icon name
 * @param {number} options.min
 * @param {number} options.max
 * @param {number} options.step - change per arrow key press and per `pxPerStep` dragged
 * @param {number} [options.pxPerStep]
 * @param {boolean} [options.wrap] - wrap around the range (a bearing) rather than stop at its ends
 * @param {number} options.defaultValue
 * @param {(value: number) => string} options.format
 * @param {(value: number) => void} options.onInput
 * @param {string} [options.title]
 * @returns {{el: HTMLElement, set: (value: number) => void, setDisabled: (disabled: boolean) => void}}
 */
export function createScrub({ label, icon, min, max, step, pxPerStep = 4, wrap = false, defaultValue, format, onInput, title }) {
    const el = document.createElement('div');
    el.className = 'place-scrub';
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', label);
    el.setAttribute('aria-valuemin', String(min));
    el.setAttribute('aria-valuemax', String(max));
    el.title = title || `Drag to change ${label.toLowerCase()} · click to type · double-click to reset`;

    const name = document.createElement('span');
    name.className = 'place-scrub-label';
    if (icon) name.innerHTML = `<sl-icon name="${icon}"></sl-icon>`;
    name.append(label);
    const value = document.createElement('span');
    value.className = 'place-scrub-value';
    el.append(name, value);

    let current = defaultValue;
    let editing = false;

    const clamp = (v) => {
        if (wrap) return ((v - min) % (max - min) + (max - min)) % (max - min) + min;
        return Math.min(max, Math.max(min, v));
    };
    const snap = (v) => Math.round(v / step) * step;

    const set = (v) => {
        if (!Number.isFinite(v)) return;
        current = v;
        if (!editing) value.textContent = format(v);
        el.setAttribute('aria-valuenow', String(v));
        el.setAttribute('aria-valuetext', format(v));
        el.style.setProperty('--fill', `${((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100}%`);
        el.classList.toggle('is-modified', Math.abs(v - defaultValue) > step / 2);
    };
    const commit = (v) => {
        const next = clamp(snap(v));
        set(next);
        onInput(next);
    };

    let drag = null;
    el.addEventListener('pointerdown', (e) => {
        if (editing || e.button !== 0 || el.classList.contains('is-disabled')) return;
        drag = { x: e.clientX, start: current, moved: false };
        el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
        if (!drag || !el.hasPointerCapture(e.pointerId)) return;
        const dx = e.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        el.classList.add('is-dragging');
        commit(drag.start + Math.round(dx / pxPerStep) * step * (e.shiftKey ? 10 : 1));
    });
    const endDrag = (e) => {
        if (!drag) return;
        const { moved } = drag;
        drag = null;
        el.classList.remove('is-dragging');
        if (e.type === 'pointerup' && !moved) edit();
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    el.addEventListener('dblclick', () => {
        if (el.classList.contains('is-disabled')) return;
        editing = false;
        commit(defaultValue);
    });

    el.addEventListener('keydown', (e) => {
        if (editing) return;
        const direction = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (direction) {
            e.preventDefault();
            commit(current + direction * step * (e.shiftKey ? 10 : 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            edit();
        }
    });

    // Typing a value, in the units the readout shows.
    function edit() {
        if (el.classList.contains('is-disabled')) return;
        editing = true;
        const input = document.createElement('input');
        input.className = 'place-scrub-input';
        input.type = 'text';
        input.inputMode = 'decimal';
        input.value = format(current).replace(/[^\d.-]/g, '');
        value.textContent = '';
        value.appendChild(input);
        input.focus();
        input.select();
        const finish = (apply) => {
            if (!editing) return;
            editing = false;
            const typed = parseFloat(input.value);
            input.remove();
            value.textContent = format(current);
            if (apply && Number.isFinite(typed)) commit(typed);
            el.focus();
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') finish(true);
            if (e.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    const setDisabled = (disabled) => {
        el.classList.toggle('is-disabled', disabled);
        el.setAttribute('aria-disabled', String(disabled));
    };

    set(defaultValue);
    return { el, set, setDisabled };
}

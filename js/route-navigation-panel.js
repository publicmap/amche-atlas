/**
 * The navigation panel (js/route-navigation.js): the next turn with its
 * distance and what follows it, the time, distance and stops left with the
 * arrival time, the steps still ahead, and switches for following the
 * position and for the traffic layer. End navigation closes it.
 */
import { formatDistance } from './geo-distance-utils.js';
import { formatDuration, routeColorOf } from './search/route-meta.js';
import { routeSymbol } from './console/route-card.js';

const TURN_ICONS = {
    left: 'arrow-90deg-left', right: 'arrow-90deg-right', 'sharp left': 'arrow-90deg-left', 'sharp right': 'arrow-90deg-right',
    'slight left': 'arrow-up-left', 'slight right': 'arrow-up-right', straight: 'arrow-up', uturn: 'arrow-return-left'
};

export function maneuverIcon(maneuver = {}) {
    if (maneuver.type === 'arrive') return 'flag-fill';
    if (maneuver.type === 'depart') return 'geo-alt-fill';
    if (/roundabout|rotary/.test(maneuver.type || '')) return 'arrow-clockwise';
    return TURN_ICONS[maneuver.modifier] || 'arrow-up';
}

function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
}

function toggle(label, checked, onChange) {
    const wrap = node('label', 'nav-toggle');
    const box = node('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.addEventListener('change', () => onChange(box.checked));
    wrap.append(box, node('span', '', label));
    return { wrap, box };
}

export class NavigationPanel {
    constructor({ onEnd, onTraffic, onFollow }) {
        this._handlers = { onEnd, onTraffic, onFollow };
        this.el = null;
    }

    open({ route, status, traffic }) {
        this.close();
        const el = node('div', 'nav-panel');
        el.style.setProperty('--route-color', routeColorOf(route));
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', 'Navigation');
        this._turn = node('div', 'nav-turn');
        this._turnIcon = document.createElement('sl-icon');
        this._turnIcon.name = 'cursor-fill';
        this._turnText = node('div', 'nav-turn-text');
        this._turnDistance = node('div', 'nav-turn-distance');
        this._turnInstruction = node('div', 'nav-turn-instruction', status);
        this._turnText.append(this._turnDistance, this._turnInstruction);
        this._turn.append(this._turnIcon, this._turnText);
        this._then = node('div', 'nav-then');
        this._then.hidden = true;

        this._summary = node('div', 'nav-summary');
        const head = node('div', 'nav-head');
        head.append(routeSymbol(route, { small: true }), this._summary);

        this._steps = node('ol', 'nav-steps');
        this._steps.hidden = true;
        const stepsButton = node('button', 'nav-link', 'Steps');
        stepsButton.type = 'button';
        stepsButton.addEventListener('click', () => {
            this._steps.hidden = !this._steps.hidden;
            stepsButton.classList.toggle('active', !this._steps.hidden);
        });

        const follow = toggle('Follow', true, (on) => this._handlers.onFollow(on));
        this._traffic = toggle('Traffic', traffic, (on) => this._handlers.onTraffic(on));
        const end = node('button', 'nav-end', 'End');
        end.type = 'button';
        end.addEventListener('click', () => this._handlers.onEnd());
        const controls = node('div', 'nav-controls');
        controls.append(stepsButton, follow.wrap, this._traffic.wrap, end);

        el.append(this._turn, this._then, head, controls, this._steps);
        document.body.appendChild(el);
        this.el = el;
    }

    close() {
        this.el?.remove();
        this.el = null;
    }

    setStatus(text) {
        if (!this.el) return;
        this._turnDistance.textContent = '';
        this._turnInstruction.textContent = text;
    }

    setTraffic(on) {
        if (this._traffic) this._traffic.box.checked = on;
    }

    setTrafficAvailable(available) {
        if (this._traffic) this._traffic.wrap.hidden = !available;
    }

    update({ step, toManeuver, then, steps, distanceLeft, durationLeft, stopsLeft, arrived }) {
        if (!this.el) return;
        if (arrived) {
            this._turnIcon.name = 'flag-fill';
            this._turnDistance.textContent = 'You have arrived';
            this._turnInstruction.textContent = '';
        } else {
            this._turnIcon.name = maneuverIcon(step?.maneuver);
            this._turnDistance.textContent = formatDistance(toManeuver);
            this._turnInstruction.textContent = step?.maneuver?.instruction || '';
        }
        this._then.hidden = !then || arrived;
        if (then && !arrived) this._then.textContent = `Then ${then.maneuver?.instruction || ''}`;
        const eta = new Date(Date.now() + durationLeft * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const stops = stopsLeft > 1 ? ` · ${stopsLeft} stops left` : '';
        this._summary.textContent = `${formatDuration(durationLeft)} · ${formatDistance(distanceLeft)} · arrive ${eta}${stops}`;
        this._steps.replaceChildren(...steps.map(s => {
            const item = node('li', 'nav-step');
            const icon = document.createElement('sl-icon');
            icon.name = maneuverIcon(s.maneuver);
            item.append(icon, node('span', 'nav-step-text', s.maneuver?.instruction || ''), node('span', 'nav-step-distance', formatDistance(s.distance)));
            return item;
        }));
    }
}

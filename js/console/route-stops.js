/**
 * An open route card's diagram (js/console/route-card.js): the route as a
 * line drawn the way the map draws it - driving solid, cycling dashed,
 * walking dotted - with a numbered stop per waypoint and each leg's time and
 * length between them. A stop flies the map to it; dragging one reorders the
 * route; its × takes it off the route and leaves its pin on the map.
 *
 * Each card draws its own stops, so a pin shared by many routes appears once
 * in each of them rather than in one list every route has to point into.
 */
import { el, icon } from './find-rows.js';
import { badgeMode } from '../search/route-badge.js';
import { stopLabels, legSummary } from '../search/route-meta.js';
import { routeActions } from './route-actions.js';

export function routeStops(route) {
    const list = el('ol', `route-stops route-stops-${badgeMode(route.profile)}`);
    const labels = stopLabels(route, routeActions.savedLabel);
    const last = route.waypoints.length - 1;
    let dragFrom = null;

    labels.forEach((label, index) => {
        const item = el('li', 'route-stop' + (index === 0 ? ' first' : '') + (index === last ? ' last' : ''));
        item.draggable = route.markerIds?.length === route.waypoints.length;
        item.tabIndex = 0;
        item.title = `Go to ${label}`;
        const dot = el('span', 'route-stop-dot', String(index + 1));
        const text = el('span', 'route-stop-text');
        text.appendChild(el('span', 'route-stop-name', label));
        if (index < last) text.appendChild(el('span', 'route-stop-leg', legSummary(route, index)));
        const remove = el('button', 'route-stop-remove');
        remove.type = 'button';
        remove.title = `Take ${label} off this route (its pin stays)`;
        remove.setAttribute('aria-label', remove.title);
        remove.appendChild(icon('x-lg'));
        remove.hidden = route.waypoints.length <= 2;
        remove.addEventListener('click', (e) => {
            e.stopPropagation();
            routeActions.removeStop(route, index);
        });
        item.append(dot, text, remove);

        item.addEventListener('click', () => routeActions.focusStop(route, index));
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') routeActions.focusStop(route, index);
        });
        item.addEventListener('dragstart', (e) => {
            dragFrom = index;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(index));
        });
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            list.querySelectorAll('.drop-before, .drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
        });
        item.addEventListener('dragover', (e) => {
            if (dragFrom === null) return;
            e.preventDefault();
            const after = e.offsetY > item.offsetHeight / 2;
            item.classList.toggle('drop-after', after);
            item.classList.toggle('drop-before', !after);
        });
        item.addEventListener('dragleave', () => item.classList.remove('drop-before', 'drop-after'));
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const after = item.classList.contains('drop-after');
            item.classList.remove('drop-before', 'drop-after');
            if (dragFrom === null) return;
            let to = index + (after ? 1 : 0);
            if (dragFrom < to) to -= 1;
            routeActions.moveStop(route, dragFrom, to);
            dragFrom = null;
        });
        list.appendChild(item);
    });
    return list;
}

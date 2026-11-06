/**
 * Under an open route's diagram (js/console/route-stops.js): the locations
 * the route doesn't stop at, each a chip in its pin's colour. Click one and it
 * becomes the route's last stop; drag one onto a stop in the diagram and it
 * joins the route there. A click on the map adds a new location as a stop
 * too, while the route is open (map-marker-manager.js's _addClickedMarker),
 * and so does dropping a location's pin on the diagram or the route's line
 * (js/location-pin-drop.js).
 */
import { el, icon } from './find-rows.js';
import { routeActions } from './route-actions.js';

export const LOCATION_DRAG_TYPE = 'application/x-amche-location';

export function routeAddStops(route) {
    const wrap = el('div', 'route-add-stops');
    wrap.appendChild(el('div', 'route-add-stops-title', 'Add a stop'));
    const chips = el('div', 'route-add-stops-chips');
    routeActions.otherLocations(route).forEach(({ id, label, color }) => {
        const chip = el('button', 'route-add-stop');
        chip.type = 'button';
        chip.draggable = true;
        chip.title = `Add ${label} as the last stop, or drag it onto a stop`;
        chip.style.setProperty('--pin-color', color);
        chip.append(el('span', 'route-add-stop-dot'), el('span', 'route-add-stop-label', label));
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            routeActions.addStop(route, id);
        });
        chip.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData(LOCATION_DRAG_TYPE, id);
        });
        chips.appendChild(chip);
    });
    if (chips.children.length) wrap.appendChild(chips);
    const hint = el('div', 'route-add-stops-hint');
    hint.append(icon('hand-index'), el('span', '', chips.children.length
        ? 'Or click the map, or drop a location’s pin here or on the route'
        : 'Click the map, or drop a location’s pin here or on the route'));
    wrap.appendChild(hint);
    return wrap;
}

/**
 * A route as a card, in Find's Routes section (js/console/find-results.js)
 * and as the legend of a route layer (js/layer-legend.js).
 *
 * Closed it is the route's symbol (its colour, travel mode and id), its name
 * and its travel time and length. Pointing at it tells where it runs from and
 * to, how many stops it makes, which routes it connects with, and that a
 * click opens it. Open it lists its stops (js/console/route-stops.js) under
 * the route's controls: show / hide, reverse, Start navigation, and a menu
 * with Share, Download, Duplicate, Change routing profile and Delete
 * (js/console/route-actions.js).
 */
import { el, icon } from './find-rows.js';
import { profileIcon } from '../search/route-badge.js';
import { DIRECTIONS_PROFILES } from '../search/directions-profile.js';
import { routeTitle, routeSummary, routeColorOf, stopLabels, connectedRoutes } from '../search/route-meta.js';
import { routeActions, liveRoutes } from './route-actions.js';
import { routeStops } from './route-stops.js';

export function routeSymbol(route, { small = false } = {}) {
    const symbol = el('span', 'route-symbol' + (small ? ' small' : ''));
    symbol.style.setProperty('--route-color', routeColorOf(route));
    symbol.appendChild(icon(profileIcon(route.profile)));
    symbol.appendChild(el('span', 'route-symbol-id', route.rid));
    symbol.title = `route-${route.rid}`;
    return symbol;
}

function actionButton(name, title, onClick, className = '') {
    const button = el('button', `route-card-action ${className}`.trim());
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.appendChild(icon(name));
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return button;
}

function menuItem(value, label, iconName) {
    const item = document.createElement('sl-menu-item');
    item.value = value;
    item.appendChild(document.createTextNode(label));
    const prefix = icon(iconName);
    prefix.slot = 'prefix';
    item.appendChild(prefix);
    return item;
}

function moreMenu(route) {
    const dropdown = document.createElement('sl-dropdown');
    dropdown.hoist = true;
    dropdown.placement = 'bottom-end';
    const trigger = el('button', 'route-card-action');
    trigger.type = 'button';
    trigger.title = 'More';
    trigger.setAttribute('aria-label', 'More');
    trigger.appendChild(icon('three-dots'));
    trigger.slot = 'trigger';
    const menu = document.createElement('sl-menu');
    const profiles = menuItem('profile', 'Change routing profile', 'signpost-split');
    const sub = document.createElement('sl-menu');
    sub.slot = 'submenu';
    DIRECTIONS_PROFILES.forEach(profile => {
        const option = menuItem(`profile:${profile.id}`, profile.label, profile.icon);
        option.type = 'checkbox';
        option.checked = profile.id === route.profile;
        sub.appendChild(option);
    });
    profiles.appendChild(sub);
    menu.append(
        menuItem('share', 'Share', 'link-45deg'),
        menuItem('download', 'Download', 'download'),
        menuItem('duplicate', 'Duplicate', 'copy'),
        profiles,
        document.createElement('sl-divider'),
        menuItem('delete', 'Delete', 'trash')
    );
    menu.addEventListener('sl-select', (e) => {
        const value = e.detail.item?.value || '';
        dropdown.hide?.();
        if (value.startsWith('profile:')) routeActions.setProfile(route, value.slice(8));
        else if (value === 'share') routeActions.share(route);
        else if (value === 'download') routeActions.download(route);
        else if (value === 'duplicate') routeActions.duplicate(route);
        else if (value === 'delete') routeActions.remove(route);
    });
    dropdown.append(trigger, menu);
    dropdown.addEventListener('click', (e) => e.stopPropagation());
    dropdown.addEventListener('mousedown', (e) => e.stopPropagation());
    return dropdown;
}

function hoverDetails(route, routes) {
    const labels = stopLabels(route, routeActions.savedLabel);
    const box = el('div', 'route-card-hover');
    box.appendChild(el('div', 'route-card-ends', `From ${labels[0]} to ${labels[labels.length - 1]}`));
    box.appendChild(el('div', 'route-card-sub', `${route.waypoints.length} stops`));
    const links = connectedRoutes(route, routes);
    if (links.length) {
        const connects = el('div', 'route-card-connects');
        connects.appendChild(el('span', '', 'Connects with'));
        links.forEach(other => connects.appendChild(routeSymbol(other, { small: true })));
        box.appendChild(connects);
    }
    box.appendChild(el('div', 'route-card-hint', 'Click for details'));
    return box;
}

function controls(route) {
    const bar = el('div', 'route-card-controls');
    bar.append(
        actionButton(route.hidden ? 'eye-slash' : 'eye', route.hidden ? 'Show this route' : 'Hide this route', () => routeActions.toggleHidden(route), route.hidden ? 'off' : ''),
        actionButton('arrow-down-up', 'Reverse the order of the stops', () => routeActions.reverse(route))
    );
    const navigate = el('button', 'route-card-navigate');
    navigate.type = 'button';
    navigate.append(icon('cursor-fill'), el('span', '', 'Start navigation'));
    navigate.title = 'Navigate from where you are through this route’s stops';
    navigate.addEventListener('click', (e) => {
        e.stopPropagation();
        routeActions.navigate(route);
    });
    bar.append(navigate, moreMenu(route));
    return bar;
}

/**
 * @param {Object} route - a route from js/search/route-store.js
 * @param {{open?: boolean, onToggle?: (open: boolean) => void, routes?: Object[]}} [options]
 */
export function routeCard(route, { open = false, onToggle = null, routes = liveRoutes() } = {}) {
    const card = el('div', 'route-card' + (open ? ' open' : '') + (route.hidden ? ' is-hidden' : ''));
    card.style.setProperty('--route-color', routeColorOf(route));
    card.dataset.routeId = route.id;

    const head = el('div', 'route-card-head');
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    head.setAttribute('aria-expanded', String(open));
    const symbol = routeSymbol(route);
    if (open) {
        const picker = el('input', 'route-symbol-color');
        picker.type = 'color';
        picker.value = routeColorOf(route);
        picker.title = 'Route colour';
        picker.addEventListener('click', (e) => e.stopPropagation());
        picker.addEventListener('change', () => routeActions.setColor(route, picker.value));
        symbol.appendChild(picker);
    }
    const text = el('div', 'route-card-text');
    text.appendChild(el('div', 'route-card-name', routeTitle(route, routes)));
    text.appendChild(el('div', 'route-card-sub route-card-summary', routeSummary(route)));
    if (!open) text.appendChild(hoverDetails(route, routes));
    const chevron = icon(open ? 'chevron-up' : 'chevron-down');
    chevron.classList.add('route-card-chevron');
    head.append(symbol, text, chevron);

    const toggle = () => {
        if (open) routeActions.deselect(route.id);
        else routeActions.select(route.id);
        onToggle?.(!open);
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target === head) toggle();
    });
    card.addEventListener('mouseenter', () => routeActions.hover(route.id));
    card.addEventListener('mouseleave', () => routeActions.hover(null));
    card.appendChild(head);

    if (open) {
        const body = el('div', 'route-card-body');
        body.append(controls(route), routeStops(route));
        card.appendChild(body);
    }
    return card;
}

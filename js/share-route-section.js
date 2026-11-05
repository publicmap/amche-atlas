/**
 * The Share panel (js/share-view-panel.js) opened from a route card: a banner
 * naming the route, so the panel reads apart from sharing the whole view, and
 * "Open route with" - the map services that take directions
 * (js/route-share-links.js), the others left out. "Start with my location"
 * (on by default) begins the directions wherever the visitor is.
 */
import { routeMapLinks, satelliteShowing } from './route-share-links.js';
import { routeSymbol } from './console/route-card.js';
import { routeTitle, routeSummary, stopLabels } from './search/route-meta.js';
import { routeActions, liveRoutes } from './console/route-actions.js';

function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
}

export function routeContextBanner(route, onClear) {
    const banner = node('div', 'share-context');
    const text = node('div', 'share-context-text');
    text.append(
        node('div', 'share-context-title', `Sharing ${routeTitle(route, liveRoutes())}`),
        node('div', 'share-context-sub', `${routeSummary(route)} · ${route.waypoints.length} stops`)
    );
    const clear = node('button', 'share-context-clear', 'Share the whole view instead');
    clear.type = 'button';
    clear.addEventListener('click', (e) => {
        e.stopPropagation();
        onClear();
    });
    banner.append(routeSymbol(route), text, clear);
    return banner;
}

function linkRow(link) {
    const a = node('a', 'share-link-row');
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = `Open this route in ${link.name}`;
    const icon = link.icon ? node('img', 'share-link-icon' + (link.lightIcon ? ' is-light-logo' : '')) : node('span', 'share-link-icon share-link-icon-text', link.name.slice(0, 2).toUpperCase());
    if (link.icon) {
        icon.src = link.icon;
        icon.alt = '';
    }
    const text = node('span', 'share-link-text');
    text.append(node('span', 'share-link-name', link.name), node('span', 'share-link-tags', link.note));
    const open = node('sl-icon', 'share-link-open');
    open.setAttribute('name', 'box-arrow-up-right');
    a.append(icon, text, open);
    return a;
}

/** Fills `section` with the route's links; returns {render} to rebuild them as the map moves. */
export function buildRouteLinksSection(section, map, route) {
    let fromMyLocation = true;
    const head = node('div', 'place-label', 'Open route with');
    const option = node('label', 'share-route-option');
    const box = node('input');
    box.type = 'checkbox';
    box.checked = fromMyLocation;
    box.addEventListener('change', () => {
        fromMyLocation = box.checked;
        render();
    });
    option.append(box, node('span', '', 'Start with my location'));
    const list = node('div', 'share-links-list');
    section.append(head, option, list);

    function render() {
        const centre = map.getCenter();
        const view = { lat: +centre.lat.toFixed(5), lng: +centre.lng.toFixed(5), zoom: Math.round(map.getZoom() * 100) / 100, satellite: satelliteShowing() };
        const labels = stopLabels(route, routeActions.savedLabel);
        list.replaceChildren(...routeMapLinks(route, { labels, fromMyLocation, view }).map(linkRow));
    }
    render();
    return { render, pinned: false };
}

/**
 * A route layer's legend (js/layer-legend.js): one route card
 * (js/console/route-card.js) per route the layer draws, instead of a swatch
 * per style rule. Drawn in Find's map details and in the layer editor, which
 * reaches the routes through the window that owns them (route-actions.js).
 * Cards follow the routes as they change, for as long as the legend is shown.
 */
import { routeCard } from './console/route-card.js';
import { liveRoutes, routeHost } from './console/route-actions.js';
import { routeSheetBar } from './route-sheet-bar.js';

export function isRouteLayer(layer) {
    if (!layer) return false;
    if (layer.type === 'routes' || layer.id === 'directions' || /^route-/.test(layer.id || '')) return true;
    return !!layer.geojson?.features?.some(f => f.properties?.kind === 'route');
}

function routesOf(layer) {
    const ids = [layer.id, layer._prefixedId].filter(Boolean);
    return liveRoutes().filter(route => ids.some(id => id === route.groupId || id.endsWith(`-${route.groupId}`)));
}

function sheetGroupId(layer) {
    const sheets = routeHost()?.routeSheets;
    return [layer.id, layer._prefixedId].filter(Boolean).find(id => sheets?.owns(id)) || null;
}

export function generateRouteLegend(layer) {
    if (!isRouteLayer(layer)) return null;
    const sheetId = sheetGroupId(layer);
    if (!sheetId && !routesOf(layer).length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'legend-routes-wrap';
    const bar = sheetId ? routeSheetBar(sheetId) : null;
    const container = document.createElement('div');
    container.className = 'route-cards legend-routes';
    wrap.append(...[bar, container].filter(Boolean));
    const open = new Set();
    const render = () => {
        const routes = liveRoutes();
        container.replaceChildren(...routesOf(layer).map(route => routeCard(route, {
            open: open.has(route.id),
            routes,
            onToggle: (next) => {
                if (next) open.add(route.id);
                else open.delete(route.id);
                render();
            }
        })));
    };
    const host = routeHost();
    const onChange = () => {
        if (!wrap.isConnected) {
            host?.removeEventListener('routes-changed', onChange);
            return;
        }
        if (!container.matches(':hover')) render();
    };
    host?.addEventListener('routes-changed', onChange);
    render();
    return wrap;
}

/**
 * What Find (js/console/find-panel.js) lists for a query, view by view.
 * Results nest under what they belong to: a feature under its map, so a map
 * with matching features is listed even when only its features matched.
 * Maps with matching features lead,
 * then maps matching by name.
 *
 * Every list is scoped to the view (js/console/find-scope.js); what lies
 * outside is either left out and counted, or listed with a zoom button.
 */
import { el, sectionLabel, row, iconThumb, chevron, moreRow, deleteButton } from './find-rows.js';
import { layerRow, atlasName, activeIds } from './find-browse.js';
import { scoped, layerBbox, routeBbox, zoomButton } from './find-scope.js';
import { byRank, matchRank } from './find-rank.js';
import { createMarkerProvider } from '../search/providers/marker-provider.js';
import { matchingRoutes } from './route-list.js';
import { routeCard } from './route-card.js';
import { routeTitle } from '../search/route-meta.js';
import { routeBadges } from './location-routes.js';

const markers = createMarkerProvider();
const pins = () => window.featureControl?._markerManager?._locationPins;
const FEATURES_PER_MAP = 5;
const PREVIEW_COUNT = 5;
const OWN_SECTIONS = new Set(['Atlases', 'Layers', 'Features', 'Your markers', 'Data link']);
const ITEM_ICONS = { 'country': 'globe2', 'directions': 'signpost-split', 'mapbox-place': 'geo-alt' };

export function liveLayer(groupId) {
    const group = (window.layerControl?._state?.groups || []).find(g => g.id === groupId);
    const registryLayer = window.layerRegistry?.getLayer?.(groupId, null, true);
    const config = registryLayer || window.featureControl?._stateManager?.getLayerConfig(groupId);
    return config || group ? { ...(config || {}), ...(group || {}) } : null;
}

function sameLayer(layer, groupId) {
    const ids = [layer.id, layer._prefixedId];
    return ids.includes(groupId) || (!!layer._sourceAtlas && ids.includes(`${layer._sourceAtlas}-${groupId}`));
}

export function matchingLayers(term) {
    if (!term) return [];
    const layers = window.layerRegistry?.searchLayers(term.toLowerCase()) || [];
    return byRank(layers, term, layer => layer.title || layer.name || layer.id,
        layer => [layer.id, layer.description, ...(layer.tags || [])]);
}

export function featureItems(sections) {
    return sections.filter(s => s.ariaLabel === 'Features').flatMap(s => s.items || []);
}

export function placeItems(sections) {
    return sections.filter(s => !OWN_SECTIONS.has(s.ariaLabel)).flatMap(s => s.items || []);
}

function placePoint(item) {
    const coords = item.geometry?.coordinates;
    return Array.isArray(coords) && coords.length >= 2 ? { lngLat: coords } : null;
}

/** Maps with matching features (each with its features), then maps matching by name. */
export function mapResults(term, sections) {
    const groups = new Map();
    featureItems(sections).forEach(item => {
        const id = item.mapFeature?.layerId;
        if (!id) return;
        if (!groups.has(id)) groups.set(id, { layer: liveLayer(id) || { id, title: id }, features: [] });
        groups.get(id).features.push(item);
    });
    const featureName = item => item.properties?.name;
    const bestRank = group => Math.min(...group.features.map(item => matchRank(featureName(item), term)));
    groups.forEach(group => { group.features = byRank(group.features, term, featureName); });
    const withFeatures = [...groups.entries()].sort(([, a], [, b]) => bestRank(a) - bestRank(b));
    const byName = matchingLayers(term).filter(layer => !withFeatures.some(([id]) => sameLayer(layer, id)));
    const { shown, outside, hidden } = scoped(byName, layer => ({ bbox: layerBbox(layer) }));
    return {
        groups: [...withFeatures.map(([, group]) => group), ...shown.map(layer => ({ layer, features: [] }))],
        outside,
        hidden,
        count: withFeatures.length + shown.length,
        featureGroups: withFeatures.length
    };
}

export function locationResults(term) {
    const locations = byRank(markers.list(term.toLowerCase()), term, item => item.properties?.name);
    return scoped(locations, item => ({ lngLat: item.markerLngLat }));
}

export function routeResults(term) {
    const routes = byRank(matchingRoutes(term), term, route => routeTitle(route, matchingRoutes()), route => [route.name, `route-${route.rid}`]);
    return scoped(routes, route => ({ bbox: routeBbox(route) }));
}

export function placeResults(sections) {
    return scoped(placeItems(sections), placePoint);
}

/**
 * Renders into Find. `ctx` carries Find's own hooks: track(node, item) for
 * keyboard order, featureSync (js/console/feature-sync.js), expanded/toggle
 * for "Show more", selectFeature, selectLocation, openRouteStop, selectRoute,
 * selectPlace, isSelected(key) and stopFocus (the highlighted route stop).
 */
export class ResultsRenderer {
    constructor(ctx) {
        this.ctx = ctx;
    }

    maps(container, { groups, outside }, { label = 'Maps', key = 'maps', source = 'all atlases' } = {}) {
        if (!groups.length) return 0;
        const section = el('section', 'console-section');
        section.appendChild(sectionLabel(label, el('span', '', source)));
        const active = activeIds();
        this._limited(section, key, groups, ({ layer, features }) => {
            const parent = layerRow(layer, { active, meta: atlasName(layer._sourceAtlas), outside: outside.has(layer),
                className: features.length ? 'console-parent' : '' });
            const nodes = [this.ctx.track(parent, { layer })];
            const key = `features:${layer.id}`;
            const open = this.ctx.expanded.has(key);
            const shown = open ? features : features.slice(0, FEATURES_PER_MAP);
            shown.forEach(item => {
                const node = this.ctx.featureSync.featureRow(item, { onSelect: this.ctx.selectFeature });
                node.classList.add('console-nested');
                nodes.push(this.ctx.track(node, item));
            });
            if (features.length > shown.length) {
                const more = moreRow(`${features.length - shown.length} more in ${layer.title || layer.id}`, () => this.ctx.toggle(key));
                more.classList.add('console-nested');
                nodes.push(more);
            }
            return nodes;
        });
        container.appendChild(section);
        return groups.length;
    }

    /** Locations; one that is a stop on routes carries a badge per route. */
    locations(container, { shown, outside }, { label = 'Locations', side = null } = {}) {
        if (!shown.length) return 0;
        const section = el('section', 'console-section');
        section.appendChild(sectionLabel(label, side));
        this._limited(section, 'locations', shown, item => {
            const key = `location:${item.markerId}`;
            const name = item.properties?.name || 'this location';
            const actions = el('span', 'console-row-actions');
            const badges = routeBadges(item.markerId, (route, index) => this.ctx.openRouteStop(route, index));
            actions.append(
                ...(badges ? [badges] : []),
                zoomButton({ lngLat: item.markerLngLat }, outside.has(item) ? `${name} is outside this view - zoom to it` : `Zoom to ${name}`, { outside: outside.has(item) }),
                deleteButton(`Delete ${name}`, () => window.featureControl?._markerManager?.deleteMarker(item.markerId))
            );
            const node = row({
                thumb: iconThumb(badges ? 'signpost-split' : 'pin-map'),
                title: item.properties?.name || '',
                meta: item.properties?.place_name || '',
                trailing: actions,
                className: [outside.has(item) && 'outside', this.ctx.isSelected(key) && 'selected'].filter(Boolean).join(' '),
                onClick: () => this.ctx.selectLocation(item, key),
                onEnter: () => pins()?.highlight(item.markerId, true),
                onLeave: () => pins()?.highlight(item.markerId, false)
            });
            return [this.ctx.track(node, item)];
        });
        container.appendChild(section);
        return shown.length;
    }

    routes(container, { shown, outside }, { label = 'Routes', side = null } = {}) {
        if (!shown.length) return 0;
        const section = el('section', 'console-section');
        section.appendChild(sectionLabel(label, side));
        const cards = el('div', 'route-cards');
        this._limited(cards, 'routes', shown, route => {
            const key = `route-card:${route.id}`;
            const card = routeCard(route, { open: this.ctx.expanded.has(key), onToggle: () => this.ctx.toggle(key) });
            if (this.ctx.stopFocus?.routeId === route.id) requestAnimationFrame(() => card.querySelector('.route-stop.highlighted')?.scrollIntoView({ block: 'nearest' }));
            if (outside.has(route)) {
                card.classList.add('outside');
                card.querySelector('.route-card-chevron')?.before(zoomButton({ bbox: routeBbox(route) }, 'This route is outside this view - zoom to it'));
            }
            this.ctx.track(card.querySelector('.route-card-head'), route);
            return [card];
        });
        section.appendChild(cards);
        container.appendChild(section);
        return shown.length;
    }

    // A pasted data link: one row that opens it in the layer editor
    links(container, sections) {
        const items = sections.filter(s => s.ariaLabel === 'Data link').flatMap(s => s.items || []);
        if (!items.length) return 0;
        const section = el('section', 'console-section');
        section.appendChild(sectionLabel('Data link'));
        items.forEach(item => {
            section.appendChild(this.ctx.track(row({
                thumb: iconThumb('link-45deg'),
                title: item.properties.name,
                meta: item.properties.place_name,
                trailing: chevron(),
                onClick: () => this.ctx.selectPlace(item)
            }), item));
        });
        container.appendChild(section);
        return items.length;
    }

    places(container, { shown, outside }) {
        if (!shown.length) return 0;
        const section = el('section', 'console-section');
        section.appendChild(sectionLabel('Places', el('span', '', 'Mapbox · OpenStreetMap')));
        this._limited(section, 'places', shown, item => {
            const isPlot = !!item.properties?._isCadastralParquet;
            const point = placePoint(item);
            const node = row({
                thumb: iconThumb(isPlot ? 'grid-3x3' : (ITEM_ICONS[item._searchResultType] || 'geo-alt')),
                title: item.properties?.name || '',
                meta: item.properties?.place_name || '',
                trailing: outside.has(item) && point ? zoomButton(point) : chevron(),
                className: outside.has(item) ? 'outside' : '',
                onClick: () => this.ctx.selectPlace(item),
                onEnter: () => this.ctx.hoverPlace(item, true),
                onLeave: () => this.ctx.hoverPlace(item, false)
            });
            return [this.ctx.track(node, item)];
        });
        container.appendChild(section);
        return shown.length;
    }

    _limited(section, key, items, build) {
        const open = this.ctx.expanded.has(key);
        const shown = open ? items : items.slice(0, PREVIEW_COUNT);
        shown.forEach(item => build(item).forEach(node => section.appendChild(node)));
        if (items.length > shown.length) {
            section.appendChild(moreRow(`Show ${items.length - shown.length} more`, () => this.ctx.toggle(key)));
        }
    }
}

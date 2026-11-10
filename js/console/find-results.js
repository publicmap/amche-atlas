/**
 * What Find (js/console/find-panel.js) lists for a query, view by view.
 * Results nest under what they belong to (js/console/layer-features.js): a
 * feature under its map and a saved location under the locations layer, so a
 * map with matching features is listed even when only its features matched.
 * Maps with matching features lead,
 * then maps matching by name.
 *
 * Every list is scoped to the view (js/console/find-scope.js); what lies
 * outside is either left out and counted, or listed with a zoom button.
 */
import { el, sectionLabel, row, iconThumb, chevron, moreRow, deleteButton, geometryIcon } from './find-rows.js';
import { layerRow, atlasName, activeIds, openLayerInfo } from './find-browse.js';
import { nestResults } from './layer-features.js';
import { scoped, layerBbox, routeBbox, zoomButton, bboxInView, distanceInView } from './find-scope.js';
import { byRank, matchRank } from './find-rank.js';
import { createMarkerProvider } from '../search/providers/marker-provider.js';
import { matchingRoutes } from './route-list.js';
import { routeCard } from './route-card.js';
import { routeTitle } from '../search/route-meta.js';
import { routeBadges } from './location-routes.js';

const markers = createMarkerProvider();
const pins = () => window.featureControl?._markerManager?._locationPins;
const PREVIEW_COUNT = 5;
const OWN_SECTIONS = new Set(['Atlases', 'Layers', 'Features', 'Your markers', 'Data link']);
const ITEM_ICONS = { 'country': 'globe2', 'directions': 'signpost-split', 'mapbox-place': 'geo-alt' };

export function liveLayer(groupId) {
    const group = (window.layerControl?._state?.groups || []).find(g => g.id === groupId);
    const registryLayer = window.layerRegistry?.getLayer?.(groupId, null, true);
    const config = registryLayer || window.featureControl?._stateManager?.getLayerConfig(groupId);
    return config || group ? { ...(config || {}), ...(group || {}) } : null;
}

export function sameLayer(layer, groupId) {
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
    const coords = item.geometry?.coordinates || item.center;
    return Array.isArray(coords) && coords.length >= 2 ? { lngLat: coords } : null;
}

// A Mapbox suggestion has no point, only its distance from where the search was made
function placeWhere(item) {
    const distance = item._raw?.distance;
    if (!placePoint(item) && item._proximity && Number.isFinite(distance)) return { inView: distanceInView(item._proximity, distance) };
    return placePoint(item);
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

/**
 * Places in view, and those outside it - listed or behind a "Show" row, as the
 * in-view filter says. Of the countries matching, only the best leads, wherever it is.
 */
export function placeResults(sections, term = '') {
    const all = placeItems(sections);
    const isCountry = item => item._searchResultType === 'country';
    const country = byRank(all.filter(isCountry), term, item => item.properties?.name).slice(0, 1);
    const scope = scoped(all.filter(item => !isCountry(item)), placeWhere);
    const shown = [...country, ...scope.shown];
    const items = [...country, ...all.filter(item => !isCountry(item))];
    if (!scope.hidden) return { ...scope, shown, items };
    const inside = new Set(shown);
    return { ...scope, shown, items, outside: new Set(items.filter(item => !inside.has(item))) };
}

/**
 * Renders into Find. `ctx` carries Find's own hooks: track(node, item) for
 * keyboard order, featureSync (js/console/feature-sync.js), expanded/toggle
 * for "Show more", selectFeature, selectLocation, shareLocations, openRoute,
 * openRouteStop, selectRoute, selectPlace, isSelected(key) and stopFocus (the
 * highlighted route stop).
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
        this._limited(section, key, groups, ({ layer, features, routes }) => {
            const parent = this.ctx.track(layerRow(layer, { active, meta: atlasName(layer._sourceAtlas), outside: outside.has(layer) }), { layer });
            return this.nest(parent, layer, features, { routes });
        });
        container.appendChild(section);
        return groups.length;
    }

    /** A map row's results nested under it: features, a routes layer's routes, or the locations layer's locations. */
    nest(parent, layer, items, { routes = false } = {}) {
        if (routes) {
            return nestResults(parent, {
                key: layer.id, items, ctx: this.ctx,
                rowOf: route => this.routeCard(route),
                pick: route => this.ctx.openRoute(route),
                nameOf: route => routeTitle(route, matchingRoutes()),
                iconOf: () => 'signpost-split',
                wrap: 'route-cards',
                footer: this.ctx.shareLocations ? [{ text: 'Share these routes', onClick: this.ctx.shareLocations }] : []
            });
        }
        if (layer.id === 'locations') {
            return nestResults(parent, {
                key: layer.id, items, ctx: this.ctx,
                rowOf: item => this.locationRow(item),
                pick: item => this.ctx.selectLocation(item, `location:${item.markerId}`),
                hover: (item, on) => pins()?.highlight(item.markerId, on),
                iconOf: () => 'pin-map',
                footer: this.ctx.shareLocations ? [{ text: 'Share these locations', onClick: this.ctx.shareLocations }] : []
            });
        }
        return nestResults(parent, {
            key: layer.id, items, ctx: this.ctx,
            rowOf: item => this.ctx.featureSync.featureRow(item, { onSelect: this.ctx.selectFeature }),
            pick: this.ctx.selectFeature,
            hover: (item, on) => this.ctx.featureSync.hover(item.mapFeature, on),
            iconOf: item => geometryIcon(item.mapFeature?.feature?.geometry),
            footer: [{ text: `About ${layer.title || layer.id}`, onClick: () => openLayerInfo(layer) }]
        });
    }

    /** A saved location; one that is a stop on routes carries a badge per route. */
    locationRow(item, outside = false) {
        const key = `location:${item.markerId}`;
        const name = item.properties?.name || 'this location';
        const actions = el('span', 'console-row-actions');
        const badges = routeBadges(item.markerId, (route, index) => this.ctx.openRouteStop(route, index));
        actions.append(
            ...(badges ? [badges] : []),
            zoomButton({ lngLat: item.markerLngLat }, outside ? `${name} is outside this view - zoom to it` : `Zoom to ${name}`, { outside }),
            deleteButton(`Delete ${name}`, () => window.featureControl?._markerManager?.deleteMarker(item.markerId))
        );
        return row({
            thumb: iconThumb(badges ? 'signpost-split' : 'pin-map'),
            title: item.properties?.name || '',
            meta: item.properties?.place_name || '',
            trailing: actions,
            className: [outside && 'outside', this.ctx.isSelected(key) && 'selected'].filter(Boolean).join(' '),
            onClick: () => this.ctx.selectLocation(item, key),
            onEnter: () => pins()?.highlight(item.markerId, true),
            onLeave: () => pins()?.highlight(item.markerId, false)
        });
    }

    /** A route's card; outside the view it carries a zoom button. */
    routeCard(route) {
        const key = `route-card:${route.id}`;
        const card = routeCard(route, { open: this.ctx.expanded.has(key), onToggle: () => this.ctx.toggle(key) });
        if (this.ctx.stopFocus?.routeId === route.id) requestAnimationFrame(() => card.querySelector('.route-stop.highlighted')?.scrollIntoView({ block: 'nearest' }));
        const box = routeBbox(route);
        if (box && !bboxInView(box)) {
            card.classList.add('outside');
            card.querySelector('.route-card-chevron')?.before(zoomButton({ bbox: box }, 'This route is outside this view - zoom to it'));
        }
        this.ctx.track(card.querySelector('.route-card-head'), route);
        return card;
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

    places(container, { shown, outside, hidden, items }) {
        if (!items.length) return 0;
        const revealed = hidden && this.ctx.expanded.has('places-outside');
        const list = revealed ? items : shown;
        const section = el('section', 'console-section');
        section.appendChild(sectionLabel('Places', el('span', '', 'Mapbox · OpenStreetMap')));
        this._limited(section, 'places', list, item => {
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
        if (hidden) {
            section.appendChild(moreRow(revealed ? 'Only results in map view' : `Show ${hidden} result${hidden === 1 ? '' : 's'} outside map view`,
                () => this.ctx.toggle('places-outside')));
        }
        container.appendChild(section);
        return items.length;
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

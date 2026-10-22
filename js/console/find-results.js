/**
 * What Find (js/console/find-panel.js) lists for a query, view by view.
 * Results nest under what they belong to: a feature under its map, so a map
 * with matching features is listed even when only its features matched; in
 * the Maps view, a map under its atlas. Maps with matching features lead,
 * then maps matching by name.
 *
 * Every list is scoped to the view (js/console/find-scope.js); what lies
 * outside is either left out and counted, or listed with a zoom button.
 */
import { el, sectionLabel, row, iconThumb, imageThumb, chevron, moreRow } from './find-rows.js';
import { layerRow, atlasName, atlasMapCount, activeIds } from './find-browse.js';
import { scoped, layerBbox, routeBbox, zoomButton } from './find-scope.js';
import { byRank, matchRank } from './find-rank.js';
import { isSearchSourceEnabled } from '../search/search-sources.js';
import { createMarkerProvider } from '../search/providers/marker-provider.js';
import { matchingRoutes, routeRow } from './route-list.js';

const markers = createMarkerProvider();
const FEATURES_PER_MAP = 5;
const PREVIEW_COUNT = 5;
const OWN_SECTIONS = new Set(['Atlases', 'Layers', 'Features', 'Your markers']);
const ITEM_ICONS = { 'country': 'globe2', 'directions': 'signpost-split', 'mapbox-place': 'geo-alt' };

function liveLayer(groupId) {
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
    if (!term || !isSearchSourceEnabled('layers')) return [];
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

export function pinResults(term) {
    const pins = byRank(markers.list(term.toLowerCase()), term, item => item.properties?.name);
    return scoped(pins, item => ({ lngLat: item.markerLngLat }));
}

export function routeResults(term) {
    const routes = byRank(matchingRoutes(term), term, route => route.name, route => [`route-${route.rid}`]);
    return scoped(routes, route => ({ bbox: routeBbox(route) }));
}

export function placeResults(sections) {
    return scoped(placeItems(sections), placePoint);
}

/**
 * Renders into Find. `ctx` carries Find's own hooks: track(node, item) for
 * keyboard order, featureSync (js/console/feature-sync.js), expanded/toggle
 * for "Show more", selectFeature, selectPin, selectRoute, selectPlace and
 * isSelected(key).
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

    /**
     * The Maps view: matching maps under their atlas. `groups` arrive ranked
     * (js/console/find-rank.js), so each atlas is placed by its best match.
     */
    mapsByAtlas(container, { groups, outside }) {
        const byAtlas = new Map();
        groups.forEach(group => {
            const atlasId = group.layer._sourceAtlas || 'index';
            if (!byAtlas.has(atlasId)) byAtlas.set(atlasId, []);
            byAtlas.get(atlasId).push(group.layer);
        });
        const current = window.layerRegistry?.getCurrentAtlas() || 'index';
        const atlases = [...byAtlas.keys()];
        const active = activeIds();
        atlases.forEach(atlasId => {
            const section = el('section', 'console-section');
            const meta = window.layerRegistry?.getAtlasMetadata(atlasId);
            section.appendChild(row({
                thumb: imageThumb(meta?.icon, 'map'),
                title: meta?.name || atlasId,
                meta: [`${byAtlas.get(atlasId).length} of ${atlasMapCount(atlasId)} maps`, atlasId === current && 'Current atlas'].filter(Boolean).join(' · '),
                className: 'console-parent console-atlas-parent'
            }));
            byAtlas.get(atlasId).forEach(layer => {
                const node = layerRow(layer, { active, meta: (layer.tags || []).join(' › '), outside: outside.has(layer), className: 'console-nested' });
                section.appendChild(this.ctx.track(node, { layer }));
            });
            container.appendChild(section);
        });
        return groups.length;
    }

    pins(container, { shown, outside }, { label = 'Pins', side = null } = {}) {
        if (!shown.length) return 0;
        const section = el('section', 'console-section');
        section.appendChild(sectionLabel(label, side));
        this._limited(section, 'pins', shown, item => {
            const key = `pin:${item.markerId}`;
            const node = row({
                thumb: iconThumb('pin-map'),
                title: item.properties?.name || '',
                meta: item.properties?.place_name || '',
                trailing: outside.has(item) ? zoomButton({ lngLat: item.markerLngLat }) : chevron(),
                className: [outside.has(item) && 'outside', this.ctx.isSelected(key) && 'selected'].filter(Boolean).join(' '),
                onClick: () => this.ctx.selectPin(item, key)
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
        this._limited(section, 'routes', shown, route => {
            const key = `route:${route.id}`;
            const node = routeRow(route, { onDone: () => this.ctx.selectRoute(key) });
            if (outside.has(route)) {
                node.classList.add('outside');
                node.querySelector('.console-row-go')?.replaceWith(zoomButton({ bbox: routeBbox(route) }));
            }
            if (this.ctx.isSelected(key)) node.classList.add('selected');
            return [this.ctx.track(node, route)];
        });
        container.appendChild(section);
        return shown.length;
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

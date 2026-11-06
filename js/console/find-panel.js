/**
 * Find - the console's results (see js/map-control-bar.js). The query stays
 * in the console's search field while the views switch what it lists:
 *
 * - atlas: with no query the current atlas as one row (opening the atlas
 *   cards, the only place an atlas is switched), then its maps filtered by
 *   Active (what is on the map, from any atlas: the layer stack strip, moved
 *   in here), All or a tag; with a query the matching maps with their
 *   matching features nested beneath, atlases, locations, routes and places.
 * - locations, routes: the locations and routes on the map, matching the query.
 *
 * Every view is scoped to the map view and follows it as it moves; the scope
 * switch (js/console/find-scope.js) includes what lies outside, with zoom
 * buttons. Results are built by js/console/find-results.js.
 */
import { el, icon, sectionLabel, linkButton, hint, imageThumb } from './find-rows.js';
import { watchLoading } from './layer-loading.js';
import { atlasesForSelector, atlasCards, atlasPicker, atlasName, atlasLayers, layerRow, activeIds, switchAtlas, clearPreview } from './find-browse.js';
import { scoped, layerBbox, scopeOption } from './find-scope.js';
import { ResultsRenderer, mapResults, matchingLayers, locationResults, routeResults, placeResults, liveLayer } from './find-results.js';
import { featureResults } from './find-features.js';
import { FindSections } from './find-sections.js';
import { FeatureSync } from './feature-sync.js';
import { tagFilterBar, filterByTags } from './tag-filter.js';
import { OnMapActions } from './on-map-actions.js';
import { LayerDetails } from './layer-details.js';
import { routeActions } from './route-actions.js';

export const VIEWS = {
    atlas: { label: 'Map', icon: 'map', browse: 'Atlases and maps in this view', search: 'Maps, features and places matching' },
    features: { label: 'Features', icon: 'bounding-box-circles', placeholder: 'Search features', browse: 'Features on the map', search: 'Features matching' },
    locations: { label: 'Locations', icon: 'pin-map', placeholder: 'Search locations', browse: 'Locations on the map', search: 'Locations matching' },
    routes: { label: 'Routes', icon: 'signpost-split', placeholder: 'Search routes', browse: 'Routes on the map', search: 'Routes matching' }
};

// The type filters and views Find used to have, for callers that still name
// them; the on-map list is now the atlas view's Active filter
const LEGACY_VIEWS = { all: 'atlas', atlases: 'atlas', maps: 'atlas', features: 'atlas', places: 'atlas', onmap: 'atlas', layers: 'atlas' };

export function viewFor(name) {
    return VIEWS[name] ? name : (LEGACY_VIEWS[name] || 'atlas');
}

export class FindPanel {
    constructor({ onSelect, onHover, clearQuery, onDone, onShareLocations, onViewChange } = {}) {
        this._onSelect = onSelect;
        this._onShareLocations = onShareLocations;
        this._onDone = onDone;
        this._clearQuery = clearQuery;
        this._onHover = onHover;
        this._onViewChange = onViewChange;
        this._openAtlas = (atlasId) => this.openAtlas(atlasId);
        this._view = 'atlas';
        this._query = '';
        this._tagPath = [];
        this._filter = 'active';
        this._atlasOpen = false;
        this._onMapLayers = [];
        this._sections = [];
        this._entries = [];
        this._expanded = new Set();
        this._selectedKey = null;
        this._visible = false;
        this._refreshTimer = null;
        this.counts = null;
        this.onEntriesChanged = null;
        this.featureSync = new FeatureSync({ onPin: (selection, label) => this._pin(selection, label) });
        this._results = new ResultsRenderer(this._context());
        // A refresh under the pointer would move the row being aimed at, so it
        // waits for the pointer to leave the list - unless a route card was
        // just edited, whose change is what the pointer is waiting to see.
        this._scheduleRefresh = () => {
            if (!this._visible) return;
            clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => {
                if (this._body?.matches(':hover') && !routeActions.recentlyEdited()) this._pendingRefresh = true;
                else this.render();
            }, 250);
        };
        // Features in view are queried afresh for the new view
        this._onMoveEnd = () => {
            if (this._visible && this._query) window.searchControl?.refreshInViewResults?.();
            this._scheduleRefresh();
        };
        this._onScope = (e) => {
            if (e.detail?.includeOutside) window.browserControl?.showSkippedDefaults?.();
            this.render();
        };
    }

    mount(host, { stripEl = null, footerEl = null, subSearchEl = null, onToggleHidden = null, map = null } = {}) {
        this._map = map || window.map;
        this.el = el('div', 'console-find');
        this._body = el('div', 'console-find-body');
        this.onMapActions = new OnMapActions({ onToggleHidden });
        this._atlasHead = el('section', 'console-section console-atlas-selector');
        this._scope = scopeOption();
        if (subSearchEl) subSearchEl.prepend(this._scope.el);
        this._tags = el('div', 'console-tags');
        this._onMap = el('section', 'console-section console-onmap');
        this._onMap.append(sectionLabel('On the map', this.onMapActions.el));
        if (stripEl) this._onMap.appendChild(stripEl);
        this._content = el('div', 'console-find-content');
        this._title = el('div', 'console-view-title');
        this._body.append(this._title, this._atlasHead, this._tags, this._onMap, this._content);
        this._sectionsBar = new FindSections({ views: VIEWS, onOpen: (view) => this.setView(view) });
        const sections = this._sectionsBar.mount(this._body);
        this._body.addEventListener('mouseleave', () => {
            clearPreview();
            if (this._pendingRefresh) this.render();
        });

        this.details = new LayerDetails({
            onBack: () => this.closeDetails(),
            onSelectFeature: () => this._onDone?.()
        });
        this.el.append(sections, this.details.el);
        if (footerEl) this.el.appendChild(footerEl);
        host.appendChild(this.el);

        ['layer-toggled', 'urlUpdated', 'atlasChanged', 'layersInitialized', 'routes-changed'].forEach(type => {
            window.addEventListener(type, this._scheduleRefresh);
        });
        window.addEventListener('find-scope-changed', this._onScope);
        this._map?.on?.('moveend', this._onMoveEnd);
        watchLoading(this._map);
    }

    _context() {
        return {
            track: (node, item) => this._track(node, item),
            featureSync: this.featureSync,
            expanded: this._expanded,
            toggle: (key) => {
                if (this._expanded.has(key)) this._expanded.delete(key);
                else this._expanded.add(key);
                this.render();
            },
            isSelected: (key) => key === this._selectedKey,
            selectFeature: (item) => this.featureSync.select(item.mapFeature),
            selectLocation: (item, key) => {
                this._selectedKey = key;
                window.featureControl?._markerManager?.selectLocation(item.markerId);
                this._map?.flyTo({ center: [item.markerLngLat.lng, item.markerLngLat.lat], duration: 500 });
                this.render();
            },
            openRouteStop: (route, index) => this.openRouteStop(route, index),
            get stopFocus() { return routeActions.highlightedStop(); },
            selectRoute: (key) => {
                this._selectedKey = key;
                this.render();
            },
            selectPlace: (item) => this._onSelect?.(item),
            hoverPlace: (item, on) => this._onHover?.(item, on)
        };
    }

    /** The Routes list with this route's card open, the route isolated on the map. */
    openRoute(route) {
        this._expanded.add(`route-card:${route.id}`);
        routeActions.select(route.id);
        this.setView('routes');
    }

    /** As openRoute, with one stop highlighted in the diagram and on the map. */
    openRouteStop(route, index) {
        routeActions.highlightStop(route, index);
        this.openRoute(route);
    }

    /** A map's details page, over the list it was opened from. */
    showLayer(layer) {
        const list = this._view !== 'atlas' ? VIEWS[this._view].label.toLowerCase()
            : this._filter === 'active' && !this._tagPath.length ? 'maps on the map'
                : `maps in ${atlasName(window.layerRegistry?.getCurrentAtlas() || 'index')}`;
        const backLabel = this._query ? `Back to results for “${this._query}”` : `Back to ${list}`;
        clearPreview();
        this.details.open(layer, { backLabel });
        this.el.classList.add('showing-details');
    }

    closeDetails() {
        if (!this.details?.isOpen) return;
        this.details.close();
        this.el.classList.remove('showing-details');
        this.render();
    }

    get detailsOpen() {
        return !!this.details?.isOpen;
    }

    /** Switch to an atlas and show it: its default maps, now on the map. */
    openAtlas(atlasId) {
        switchAtlas(atlasId);
        this._clearQuery?.();
        this._query = '';
        this._sections = [];
        this.setView('atlas');
    }

    /** Redraw soon, if Find is showing - e.g. the on-map list changed. */
    refresh() {
        this._scheduleRefresh();
    }

    /** The maps on the map, in stack order (js/layer-stack-strip.js). */
    setOnMap(layers) {
        this._onMapLayers = Array.isArray(layers) ? layers.filter(layer => layer.id !== 'locations') : [];
    }

    setVisible(visible) {
        this._visible = visible;
        if (visible) this.render();
        else {
            clearPreview();
            this.closeDetails();
            this._selectedKey = null;
            routeActions.clearStopHighlight();
        }
    }

    setView(view) {
        this.closeDetails();
        this._view = viewFor(view);
        this._tagPath = [];
        this._filter = 'active';
        this._atlasOpen = false;
        this._body.scrollTop = 0;
        this.render();
    }

    /** @deprecated Find's old type filters; each now opens its view. */
    setFilter(filter) {
        this.setView(filter);
    }

    get view() {
        return this._view;
    }

    get filter() {
        return this._view;
    }

    get query() {
        return this._query;
    }

    setQuery(query) {
        const next = (query || '').trim();
        if (next === this._query) return;
        this.closeDetails();
        this._query = next;
        this._expanded.clear();
        if (!next) this._sections = [];
        this.render();
    }

    /** Called by SearchSuggestionsPanel with MapSearchControl's sections. */
    renderResults(sections) {
        this._sections = sections || [];
        this.render();
        return this._entries;
    }

    get entries() {
        return this._entries;
    }

    render() {
        if (!this.el) return;
        if (this.details?.isOpen) this.details.refresh();
        this._pendingRefresh = false;
        this._entries = [];
        this.featureSync.reset();
        this._content.replaceChildren();
        this._atlasHead.replaceChildren();
        this._renderTitle();
        this._tags.replaceChildren();
        this._atlasHead.hidden = this._view !== 'atlas';
        this._onMap.hidden = !this._showingOnMap();

        let hidden = 0;
        if (this._view === 'atlas') hidden = this._renderAtlasView();
        else if (this._view === 'features') hidden = this._renderFeaturesView();
        else if (this._view === 'locations') hidden = this._renderLocationsView();
        else if (this._view === 'routes') hidden = this._renderRoutesView();
        this._scope.sync(hidden);

        const features = featureResults(this._query, liveLayer);
        this.counts = this._query ? {
            layers: scoped(matchingLayers(this._query), layer => ({ bbox: layerBbox(layer) })).shown.length,
            features: features.savedCount + features.moreCount,
            locations: locationResults(this._query).shown.length,
            routes: routeResults(this._query).shown.length
        } : null;
        this._sectionsBar.sync(this._view, this.counts ? { atlas: this.counts.layers, ...this.counts } : {
            atlas: this._onMapLayers.length,
            features: features.savedCount,
            locations: locationResults('').shown.length,
            routes: routeResults('').shown.length
        }, !!this.counts);
        this._onViewChange?.(this._view);
        this.onEntriesChanged?.(this._entries);
    }

    /** The heading naming the view and what it lists. */
    _renderTitle() {
        // The atlas view opens straight onto its atlas selector, or its results
        this._title.hidden = this._view === 'atlas';
        if (this._title.hidden) return;
        const view = VIEWS[this._view];
        const atlasId = window.layerRegistry?.getCurrentAtlas() || 'index';
        const meta = window.layerRegistry?.getAtlasMetadata(atlasId);
        const mark = this._view === 'atlas' ? imageThumb(meta?.icon, 'map') : el('span', 'console-thumb console-thumb-icon');
        if (view.icon) mark.appendChild(icon(view.icon));
        const text = el('div', 'console-view-title-text');
        text.append(
            el('div', 'console-view-title-name', this._view === 'atlas' ? atlasName(atlasId) : view.label),
            el('div', 'console-view-title-sub', this._query ? `${view.search} “${this._query}”` : view.browse)
        );
        this._title.replaceChildren(mark, text);
    }

    _showingOnMap() {
        return this._view === 'atlas' && !this._query && this._filter === 'active' && !this._tagPath.length;
    }

    /**
     * Shows the filter for the maps about to be listed and returns them
     * narrowed to the chosen tags. `layerOf` reads the map from an item.
     * Browsing an atlas it leads with Active and All; with a query, All
     * clears a chosen tag.
     */
    _tagFilter(items, layerOf = item => item) {
        const layers = items.map(layerOf);
        while (this._tagPath.length && !filterByTags(layers, this._tagPath).length) this._tagPath.pop();
        const all = { id: 'all', label: 'All', count: layers.length };
        const modes = this._query ? [all] : [{ id: 'active', label: 'Active', count: this._onMapLayers.length }, all];
        const bar = tagFilterBar(layers, this._tagPath, (path) => {
            this._tagPath = path;
            if (path.length) this._filter = 'all';
            this.render();
        }, {
            modes: this._query && !layers.some(layer => layer?.tags?.length) ? [] : modes,
            mode: this._query ? 'all' : this._filter,
            onMode: (id) => this._setFilter(id)
        });
        if (bar) this._tags.appendChild(bar);
        return filterByTags(items, this._tagPath, layerOf);
    }

    _setFilter(filter) {
        this._filter = filter;
        this._tagPath = [];
        this._body.scrollTop = 0;
        this.render();
    }

    /**
     * With a query the atlas view lists features on the map (under their
     * maps) first, then atlases and maps by name, places, locations and routes.
     */
    _renderAtlasView() {
        const { entries, hidden: hiddenAtlases } = atlasesForSelector(this._query);
        const cards = entries.length ? atlasCards(entries, this._openAtlas) : null;
        const atlasSection = cards ? (this._query ? [sectionLabel('Atlases'), cards] : [cards]) : [];
        this._atlasHead.hidden = !!this._query;
        if (!this._query) return this._renderAtlasBrowse(cards, hiddenAtlases);
        const maps = mapResults(this._query, this._sections);
        const locations = locationResults(this._query);
        const routes = routeResults(this._query);
        const places = placeResults(this._sections);
        const featureGroups = new Set(maps.groups.slice(0, maps.featureGroups));
        const groups = this._tagFilter(maps.groups, group => group.layer);
        const withFeatures = { ...maps, groups: groups.filter(group => featureGroups.has(group)) };
        const byName = { ...maps, groups: groups.filter(group => !featureGroups.has(group)) };
        let shown = this._results.links(this._content, this._sections)
            + this._results.maps(this._content, withFeatures, { label: 'Features', key: 'features', source: 'on the map' });
        if (atlasSection.length) {
            this._section(...atlasSection);
            shown += entries.length;
        }
        shown += this._results.maps(this._content, byName, { label: 'Maps' })
            + this._results.places(this._content, places)
            + this._results.locations(this._content, locations)
            + this._results.routes(this._content, routes);
        if (!shown) this._content.appendChild(hint(`Nothing found for “${this._query}” in this view yet. Results from place search can take a moment.`));
        return hiddenAtlases + maps.hidden + locations.hidden + routes.hidden + places.hidden;
    }

    /**
     * No query: the current atlas's row (its cards open beneath it), the
     * filter, then the maps on the map (Active - never scoped to the view, so
     * nothing on the map goes missing) or the atlas's maps in view.
     */
    _renderAtlasBrowse(cards, hiddenAtlases) {
        const atlasId = window.layerRegistry?.getCurrentAtlas() || 'index';
        this._atlasHead.append(atlasPicker(atlasId, {
            open: this._atlasOpen,
            onToggle: () => {
                this._atlasOpen = !this._atlasOpen;
                this.render();
            }
        }));
        if (this._atlasOpen && cards) this._atlasHead.appendChild(cards);
        const atlasHidden = this._atlasOpen ? hiddenAtlases : 0;

        const { shown: inScope, outside, hidden } = scoped(atlasLayers(atlasId), layer => ({ bbox: layerBbox(layer) }));
        const shown = this._tagFilter(inScope);
        this._onMap.hidden = !this._showingOnMap();
        if (this._showingOnMap()) {
            if (!this._onMapLayers.length) {
                const empty = hint('Nothing is on the map yet. ');
                empty.appendChild(linkButton(`Browse all maps in ${atlasName(atlasId)}`, () => this._setFilter('all')));
                this._content.appendChild(empty);
            }
            return atlasHidden;
        }
        const byTitle = (a, b) => (a.title || a.id).localeCompare(b.title || b.id, undefined, { numeric: true, sensitivity: 'base' });
        const active = activeIds();
        const rows = shown.sort(byTitle).map(layer => this._track(layerRow(layer, { active, meta: (layer.tags || []).join(' › '), outside: outside.has(layer) }), { layer }));
        const label = this._tagPath.length ? this._tagPath.join(' › ') : `All maps in ${atlasName(atlasId)}`;
        this._section(sectionLabel(label), ...(rows.length ? rows : [hint('None of this atlas’s maps are in this view.')]));
        return atlasHidden + hidden;
    }

    /**
     * Features under their maps: those saved locations stand on first, the rest in
     * view under "more" - all at once when the link names nothing of its own.
     */
    _renderFeaturesView() {
        const { saved, more, savedCount, moreCount, showAll } = featureResults(this._query, liveLayer);
        const none = () => ({ outside: new Set() });
        const shown = this._results.maps(this._content, { groups: saved, ...none() },
            { label: showAll ? 'Features in view' : 'Saved features', key: 'features-saved', source: showAll ? 'all maps on the map' : 'kept in the link' });
        if (!showAll && !savedCount && moreCount) this._content.appendChild(hint('No features are saved in this link yet. Save a feature as a location to keep it.'));
        if (more.length) {
            if (this._expanded.has('features-more')) {
                this._results.maps(this._content, { groups: more, ...none() }, { label: 'More in this view', key: 'features-more-list', source: `${moreCount}` });
            } else {
                const section = el('section', 'console-section');
                section.appendChild(linkButton(`${moreCount} more feature${moreCount === 1 ? '' : 's'} in this view`, () => {
                    this._expanded.add('features-more');
                    this.render();
                }));
                section.classList.add('console-more-section');
                this._content.appendChild(section);
            }
        }
        if (!shown && !moreCount) {
            this._content.appendChild(hint(this._query ? `No features match “${this._query}” in this view.` : 'No features in this view. Turn on a map, or move the map to where its features are.'));
        }
        return 0;
    }

    _renderLocationsView() {
        const locations = locationResults(this._query);
        const share = locations.shown.length && this._onShareLocations ? linkButton('Share', () => this._onShareLocations()) : null;
        if (!this._results.locations(this._content, locations, { side: share })) {
            this._content.appendChild(hint(this._query ? `No locations match “${this._query}” in this view.`
                : (locations.hidden ? 'No locations in this view.' : 'No locations yet. Places you save on the map, and the stops of routes, are listed here.')));
        }
        return locations.hidden;
    }

    _renderRoutesView() {
        const routes = routeResults(this._query);
        const share = routes.shown.length && this._onShareLocations ? linkButton('Share', () => this._onShareLocations()) : null;
        if (!this._results.routes(this._content, routes, { side: share })) {
            this._content.appendChild(hint(this._query ? `No routes match “${this._query}” in this view.`
                : (routes.hidden ? 'No routes in this view.' : 'No routes yet. Right-click the map and pick Route From, then Route To.')));
        }
        return routes.hidden;
    }

    _section(...children) {
        const node = el('section', 'console-section');
        node.append(...children);
        this._content.appendChild(node);
    }

    _pin(selection, label) {
        this._onDone?.();
        window.featureControl?._markerManager?.pinFeature(selection, label);
    }

    _track(node, item) {
        this._entries.push({ el: node, item });
        return node;
    }

    destroy() {
        clearTimeout(this._refreshTimer);
        ['layer-toggled', 'urlUpdated', 'atlasChanged', 'layersInitialized', 'routes-changed'].forEach(type => {
            window.removeEventListener(type, this._scheduleRefresh);
        });
        window.removeEventListener('find-scope-changed', this._onScope);
        this._map?.off?.('moveend', this._onMoveEnd);
        this.featureSync.destroy();
        this.onMapActions?.destroy();
        this.el?.remove();
    }
}

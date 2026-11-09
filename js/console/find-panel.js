/**
 * Find - the console's results (see js/map-control-bar.js): one scrolling
 * list of sections - Routes, Locations, Places, Features and Map - under the
 * search field, with a tab for each section that has anything in it
 * (js/console/find-sections.js) to scroll to it. In atlas mode, opened from
 * the console's atlas label, the list is every atlas instead
 * (js/console/find-atlases.js) and the search field's filters act on those.
 *
 * The search field narrows the list one of two ways (js/console/find-filters.js):
 * by default its filters keep the Map section to the maps on the map and every
 * section to the map view (js/console/find-scope.js); browsing by tag lists
 * every map instead, narrowed by the tag chips (js/console/tag-filter.js).
 * The filter toggles or the tag chips open under the search field.
 *
 * With no query the Map section is the maps on the map - the layer stack strip
 * in stack order (js/layer-stack-strip.js) - or with the eye off the atlas's
 * maps; with a query, the data links, atlases and maps matching it. Results
 * are built by js/console/find-results.js.
 */
import { el, sectionLabel, linkButton, hint } from './find-rows.js';
import { watchLoading } from './layer-loading.js';
import { atlasesForSelector, atlasName, atlasLayers, layerRow, activeIds, isLayerActive, switchAtlas, clearPreview } from './find-browse.js';
import { scoped, layerBbox, isIncludingOutside } from './find-scope.js';
import { atlasCards, updateAtlasCards } from './atlas-cards.js';
import { renderAtlases } from './find-atlases.js';
import { ResultsRenderer, mapResults, locationResults, routeResults, placeResults, liveLayer } from './find-results.js';
import { featureResults } from './find-features.js';
import { FindSections } from './find-sections.js';
import { FindFilters } from './find-filters.js';
import { FeatureSync } from './feature-sync.js';
import { tagFilterBar, filterByTags } from './tag-filter.js';
import { OnMapActions } from './on-map-actions.js';
import { LayerDetails } from './layer-details.js';
import { routeActions } from './route-actions.js';

export const VIEWS = {
    routes: { label: 'Routes', icon: 'signpost-split' },
    locations: { label: 'Locations', icon: 'pin-map' },
    places: { label: 'Places', icon: 'geo-alt' },
    features: { label: 'Features', icon: 'bounding-box-circles' },
    atlas: { label: 'Map', icon: 'map' }
};

// The type filters and views Find used to have, for callers that still name them
const LEGACY_VIEWS = { all: 'atlas', atlases: 'atlas', maps: 'atlas', onmap: 'atlas', layers: 'atlas' };
const SPY_LOCK_MS = 700;
const byTitle = (a, b) => (a.title || a.id).localeCompare(b.title || b.id, undefined, { numeric: true, sensitivity: 'base' });

export function viewFor(name) {
    return VIEWS[name] ? name : (LEGACY_VIEWS[name] || 'atlas');
}

export class FindPanel {
    constructor({ onSelect, onHover, clearQuery, onDone, onShareLocations, onAtlasToggle } = {}) {
        this._onSelect = onSelect;
        this._onShareLocations = onShareLocations;
        this._onDone = onDone;
        this._clearQuery = clearQuery;
        this._onHover = onHover;
        this._onAtlasToggle = onAtlasToggle;
        this._openAtlas = (atlasId) => this.openAtlas(atlasId);
        // Picking in atlas mode keeps it open, to try one atlas after another
        this._tryAtlas = (atlasId) => {
            switchAtlas(atlasId);
            this._tagPath = [];
        };
        this._onAtlasTag = (tag) => {
            this._atlasTag = tag;
            this.render();
        };
        // Distances and arrows follow the map as it moves, in place
        this._onMapMove = () => {
            if (!this._atlasOpen || this._moveFrame) return;
            this._moveFrame = requestAnimationFrame(() => {
                this._moveFrame = null;
                updateAtlasCards(this._content);
            });
        };
        // The cards are redrawn once the switch lands, to move the eye
        this._onAtlasChanged = () => {
            if (!this._atlasOpen) return;
            this._atlasKey = null;
            this.render();
        };
        this._view = 'atlas';
        this._scrollTarget = null;
        this._spyLock = 0;
        this._query = '';
        this._tagPath = [];
        this._atlasOpen = false;
        this._atlasTag = null;
        this._atlasKey = null;
        this._onMapLayers = [];
        this._onMapHidden = 0;
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
            const include = !!e.detail?.includeOutside;
            if (include) window.browserControl?.showSkippedDefaults?.();
            this._onToggleHidden?.(include);
            this.render();
        };
    }

    /**
     * @param {HTMLElement} host - where Find's tabs, list and details go
     * @param {{searchEl?: HTMLElement, optionsEl?: HTMLElement}} options - searchEl
     *   takes the filter buttons and optionsEl, under it, their toggles or tag chips
     */
    mount(host, { searchEl = null, optionsEl = null, stripEl = null, footerEl = null, onToggleHidden = null, map = null } = {}) {
        this._map = map || window.map;
        this._onToggleHidden = onToggleHidden;
        this.el = el('div', 'console-find');
        this.onMapActions = new OnMapActions();
        this.filters = new FindFilters({
            onChange: () => {
                if (!this.filters.browsingTags) {
                    this._tagPath = [];
                    this._atlasTag = null;
                }
                this._scrollTarget = 'atlas';
                this.render();
            }
        });
        searchEl?.appendChild(this.filters.el);
        this._tagSlot = el('div', 'console-tag-slot');
        optionsEl?.append(this.filters.row, this._tagSlot);
        this._onMap = el('section', 'console-section console-onmap');
        this._onMap.append(sectionLabel('On the map', this.onMapActions.el));
        if (stripEl) this._onMap.appendChild(stripEl);

        this._content = el('div', 'console-find-content');
        this._body = el('div', 'console-find-body');
        this._body.appendChild(this._content);
        this._body.addEventListener('scroll', () => this._followScroll(), { passive: true });
        this._body.addEventListener('mouseleave', () => {
            clearPreview();
            if (this._pendingRefresh) this.render();
        });
        this._sectionsBar = new FindSections({ views: VIEWS, onOpen: (view) => this._scrollToSection(view, { smooth: true }) });
        this._main = el('div', 'console-find-main');
        this._main.append(this._sectionsBar.mount(), this._body);

        this.details = new LayerDetails({
            onBack: () => this.closeDetails(),
            onSelectFeature: () => this._onDone?.()
        });
        this.el.append(this._main, this.details.el);
        if (footerEl) this.el.appendChild(footerEl);
        host.appendChild(this.el);

        ['layer-toggled', 'urlUpdated', 'atlasChanged', 'layersInitialized', 'routes-changed'].forEach(type => {
            window.addEventListener(type, this._scheduleRefresh);
        });
        window.addEventListener('find-scope-changed', this._onScope);
        window.addEventListener('atlasChanged', this._onAtlasChanged);
        this._map?.on?.('moveend', this._onMoveEnd);
        this._map?.on?.('move', this._onMapMove);
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

    /** The Routes section with this route's card open, the route isolated on the map. */
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
        const backLabel = this._query ? `Back to results for “${this._query}”` : `Back to ${atlasName(window.layerRegistry?.getCurrentAtlas() || 'index')}`;
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
        this._tagPath = [];
        this._setAtlasOpen(false);
        this.setView('atlas');
    }

    /** Atlas mode, in or out, from the console's atlas label. */
    toggleAtlas() {
        this.closeDetails();
        this._setAtlasOpen(!this._atlasOpen);
        this._scrollTarget = 'top';
        this.render();
    }

    get atlasOpen() {
        return this._atlasOpen;
    }

    _setAtlasOpen(open) {
        this._atlasOpen = open;
        this._atlasKey = null;
        this.filters?.setAtlasMode(open);
        this.el?.classList.toggle('atlas-mode', open);
        this._onAtlasToggle?.(open);
    }

    /** Redraw soon, if Find is showing - e.g. the on-map list changed. */
    refresh() {
        this._scheduleRefresh();
    }

    /** The maps on the map, in stack order (js/layer-stack-strip.js). */
    setOnMap(layers) {
        this._onMapLayers = Array.isArray(layers) ? layers.filter(layer => layer.id !== 'locations') : [];
    }

    /** How many maps on the map the strip leaves out for having nothing in view. */
    setOnMapHidden(count, shown) {
        const hidden = shown ? 0 : count;
        if (hidden === this._onMapHidden) return;
        this._onMapHidden = hidden;
        this._scheduleRefresh();
    }

    setVisible(visible) {
        this._visible = visible;
        if (visible) this.render();
        else {
            clearPreview();
            this.closeDetails();
            this._setAtlasOpen(false);
            this._selectedKey = null;
            routeActions.clearStopHighlight();
        }
    }

    /** Scrolls the list to a section: routes, locations, places, features or atlas (Map). */
    setView(view) {
        this.closeDetails();
        this._view = viewFor(view);
        this._scrollTarget = this._view;
        this.render();
    }

    /** @deprecated Find's old type filters; each now scrolls to its section. */
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
        this._scrollTarget = 'top';
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
        if (this._atlasOpen) {
            this._renderAtlasMode();
            return;
        }
        this._entries = [];
        this.featureSync.reset();
        const scrollTop = this._body.scrollTop;
        this._content.replaceChildren();
        this._tagSlot.replaceChildren();

        const q = this._query;
        const searched = q ? mapResults(q, this._sections) : null;
        const routes = routeResults(q);
        const locations = locationResults(q);
        const places = q ? placeResults(this._sections) : { shown: [], outside: new Set(), hidden: 0 };
        const features = this._featureSection(searched);
        const maps = q ? this._mapSearch(searched) : this._mapBrowse();
        const share = () => (this._onShareLocations ? linkButton('Share', () => this._onShareLocations()) : null);
        const sections = [
            ['routes', routes.shown.length, (c) => this._results.routes(c, routes, { side: share() })],
            ['locations', locations.shown.length, (c) => this._results.locations(c, locations, { side: share() })],
            ['places', places.shown.length, (c) => this._results.places(c, places)],
            ['features', features.count, features.build],
            ['atlas', maps.count, maps.build]
        ];
        const counts = {};
        sections.forEach(([id, count, build]) => {
            counts[id] = count;
            if (!count && !(id === 'atlas' && !q)) return;
            const group = el('div', 'console-group');
            group.dataset.section = id;
            build(group);
            this._content.appendChild(group);
        });
        if (q && !Object.values(counts).some(Boolean)) {
            this._content.prepend(hint(`Nothing found for “${q}” here yet. Results from place search can take a moment.`));
        }

        this.counts = counts;
        this.filters.sync({ inactive: maps.inactive, outside: routes.hidden + locations.hidden + places.hidden + maps.hidden });
        this._sectionsBar.sync(this._view, counts, !!q);
        this._restoreScroll(scrollTop);
        this.onEntriesChanged?.(this._entries);
    }

    /**
     * Atlas mode: every atlas, filtered by the query, the view and the atlas
     * tags (js/console/find-atlases.js). Redrawn only when one of those or the
     * atlas on the map changes - hovering a card previews its atlas on the
     * map, and a redraw then would restart the hover and the scroll under it.
     */
    _renderAtlasMode() {
        const key = [this._query, this._atlasTag, this.filters.mode, isIncludingOutside(), window.layerRegistry?.getCurrentAtlas()].join('|');
        if (key === this._atlasKey) {
            this.filters.sync({ outside: this._atlasHidden });
            return;
        }
        this._atlasKey = key;
        const scrollTop = this._body.scrollTop;
        this._entries = [];
        this._content.replaceChildren();
        this._tagSlot.replaceChildren();
        this._sectionsBar.el.hidden = true;
        const { hidden, tag } = renderAtlases(this._content, this._tagSlot, {
            query: this._query,
            browsingTags: this.filters.browsingTags,
            tag: this._atlasTag,
            onTag: this._onAtlasTag,
            onPick: this._tryAtlas
        });
        this._atlasTag = tag;
        this._atlasHidden = hidden;
        this.filters.sync({ outside: hidden });
        this._restoreScroll(scrollTop);
        this.onEntriesChanged?.(this._entries);
    }

    /** Browsing by tag, the chips for the maps about to be listed; returns them narrowed to the chosen tags. */
    _tagFilter(items, layerOf = item => item) {
        if (!this.filters.browsingTags) return items;
        const layers = items.map(layerOf);
        while (this._tagPath.length && !filterByTags(layers, this._tagPath).length) this._tagPath.pop();
        const bar = tagFilterBar(layers, this._tagPath, (path) => {
            this._tagPath = path;
            this._scrollTarget = 'atlas';
            this.render();
        });
        if (bar) this._tagSlot.appendChild(bar);
        return filterByTags(items, this._tagPath, layerOf);
    }

    /**
     * No query: the maps on the map - the strip, in stack order, unless a tag
     * narrows them - or with the eye off the atlas's maps in view.
     */
    _mapBrowse() {
        const atlasId = window.layerRegistry?.getCurrentAtlas() || 'index';
        const active = activeIds();
        const atlas = scoped(atlasLayers(atlasId), layer => ({ bbox: layerBbox(layer) }));
        if (!this.filters.activeOnly) {
            const shown = this._tagFilter(atlas.shown).sort(byTitle);
            const label = this._tagPath.length ? this._tagPath.join(' › ') : `Maps in ${atlasName(atlasId)}`;
            return {
                count: shown.length, hidden: atlas.hidden, inactive: 0,
                build: (c) => this._listLayers(c, label, shown, { active, outside: atlas.outside, empty: 'None of this atlas’s maps are in this view.' })
            };
        }
        const onMap = this._tagFilter(this._onMapLayers);
        const inactive = filterByTags(atlas.shown, this._tagPath).filter(layer => !isLayerActive(layer, active)).length;
        if (!this._tagPath.length) {
            return {
                count: this._onMapLayers.length - this._onMapHidden, hidden: this._onMapHidden, inactive,
                build: (c) => {
                    c.appendChild(this._onMap);
                    if (!this._onMapLayers.length) {
                        const empty = hint('Nothing is on the map yet. ');
                        empty.appendChild(linkButton(`Browse the maps in ${atlasName(atlasId)}`, () => this._showAllMaps()));
                        c.appendChild(empty);
                    }
                }
            };
        }
        const inView = scoped(onMap, layer => ({ bbox: layerBbox(layer) }));
        return {
            count: inView.shown.length, hidden: inView.hidden, inactive,
            build: (c) => this._listLayers(c, `On the map › ${this._tagPath.join(' › ')}`, inView.shown, { active, outside: inView.outside })
        };
    }

    /** A query: data links, atlases by name, then maps by name - on the map only while the eye is on. */
    _mapSearch(searched) {
        const { entries } = atlasesForSelector(this._query);
        const links = this._sections.filter(s => s.ariaLabel === 'Data link').flatMap(s => s.items || []).length;
        const byName = searched.groups.slice(searched.featureGroups);
        const active = activeIds();
        const candidates = this.filters.activeOnly ? byName.filter(group => isLayerActive(group.layer, active)) : byName;
        const groups = this._tagFilter(candidates, group => group.layer);
        const inactive = this.filters.activeOnly ? filterByTags(byName, this._tagPath, group => group.layer).length - groups.length : 0;
        return {
            count: links + entries.length + groups.length,
            hidden: searched.hidden,
            inactive,
            build: (c) => {
                this._results.links(c, this._sections);
                if (entries.length) {
                    const section = el('section', 'console-section');
                    section.append(sectionLabel('Atlases'), atlasCards(entries, this._openAtlas));
                    c.appendChild(section);
                }
                this._results.maps(c, { groups, outside: searched.outside }, { label: 'Maps' });
            }
        };
    }

    /**
     * Features under their maps. A query lists those matching it; otherwise the
     * features saved locations stand on lead, and the rest in view wait behind
     * a link - all of them when the link names nothing of its own.
     */
    _featureSection(searched) {
        const none = { outside: new Set() };
        if (searched) {
            const groups = searched.groups.slice(0, searched.featureGroups);
            return {
                count: groups.reduce((sum, group) => sum + group.features.length, 0),
                build: (c) => this._results.maps(c, { groups, ...none }, { label: 'Features', key: 'features', source: 'on the map' })
            };
        }
        const { saved, more, savedCount, moreCount, showAll } = featureResults('', liveLayer);
        const lead = showAll ? [] : saved;
        const rest = showAll ? saved : more;
        const restCount = showAll ? savedCount + moreCount : moreCount;
        return {
            count: (showAll ? 0 : savedCount) + restCount,
            build: (c) => {
                if (lead.length) this._results.maps(c, { groups: lead, ...none }, { label: 'Saved features', key: 'features-saved', source: 'kept in the link' });
                if (!rest.length) return;
                if (this._expanded.has('features-more')) {
                    this._results.maps(c, { groups: rest, ...none }, { label: lead.length ? 'More in this view' : 'Features in view', key: 'features-more-list', source: `${restCount}` });
                    return;
                }
                const section = el('section', 'console-section console-more-section');
                if (!lead.length) section.appendChild(sectionLabel('Features'));
                section.appendChild(linkButton(`${restCount} ${lead.length ? 'more ' : ''}feature${restCount === 1 ? '' : 's'} in this view`, () => {
                    this._expanded.add('features-more');
                    this.render();
                }));
                c.appendChild(section);
            }
        };
    }

    _listLayers(container, label, layers, { active, outside, empty = null }) {
        const rows = layers.map(layer => this._track(layerRow(layer, { active, meta: (layer.tags || []).join(' › '), outside: outside.has(layer) }), { layer }));
        const section = el('section', 'console-section');
        section.append(sectionLabel(label), ...(rows.length ? rows : (empty ? [hint(empty)] : [])));
        container.appendChild(section);
    }

    _showAllMaps() {
        this.filters.activeOnly = false;
        this._scrollTarget = 'atlas';
        this.render();
    }

    // Keeps the list where it was across a redraw, or takes it to the section
    // asked for once the list can be seen.
    _restoreScroll(scrollTop) {
        if (!this._body.offsetParent) return;
        const target = this._scrollTarget;
        this._scrollTarget = null;
        if (target === 'top') this._body.scrollTop = 0;
        else if (target) this._scrollToSection(target);
        else this._body.scrollTop = scrollTop;
        this._followScroll();
    }

    _scrollToSection(view, { smooth = false } = {}) {
        const group = this._content.querySelector(`[data-section="${view}"]`);
        this._view = view;
        this._sectionsBar.setActive(view);
        if (!group) return;
        this._spyLock = Date.now() + SPY_LOCK_MS;
        this._body.scrollTo({ top: group.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
    }

    /** The tab of the section at the top of the list. */
    _followScroll() {
        if (Date.now() < this._spyLock) return;
        const groups = [...this._content.querySelectorAll('[data-section]')];
        if (!groups.length) return;
        const top = this._body.scrollTop + 12;
        let current = groups[0];
        groups.forEach(group => { if (group.offsetTop <= top) current = group; });
        if (current.dataset.section === this._view) return;
        this._view = current.dataset.section;
        this._sectionsBar.setActive(this._view);
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
        window.removeEventListener('atlasChanged', this._onAtlasChanged);
        this._map?.off?.('moveend', this._onMoveEnd);
        this._map?.off?.('move', this._onMapMove);
        cancelAnimationFrame(this._moveFrame);
        this.featureSync.destroy();
        this.onMapActions?.destroy();
        this.el?.remove();
    }
}

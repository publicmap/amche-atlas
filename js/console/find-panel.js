/**
 * Find - the console's results (see js/map-control-bar.js). The query stays
 * in the console's search field while the views switch what it lists:
 *
 * - atlas: the atlas selector (the only place an atlas is switched), then
 *   with no query the current atlas's maps in view - the layer browser -
 *   and with a query the matching maps with their matching features nested
 *   beneath, pins, routes and places.
 * - layers: with no query what is on the map (the layer stack strip, moved
 *   in here); with a query the matching maps grouped under their atlas.
 * - pins, routes: the pins and routes on the map, matching the query.
 *
 * Every view is scoped to the map view and follows it as it moves; the scope
 * switch (js/console/find-scope.js) includes what lies outside, with zoom
 * buttons. Results are built by js/console/find-results.js.
 */
import { el, icon, sectionLabel, linkButton, hint, imageThumb } from './find-rows.js';
import { atlasesForSelector, atlasCards, atlasName, atlasLayers, layerRow, activeIds, switchAtlas, clearPreview } from './find-browse.js';
import { scoped, layerBbox, scopeOption } from './find-scope.js';
import { ResultsRenderer, mapResults, matchingLayers, pinResults, routeResults, placeResults } from './find-results.js';
import { FeatureSync } from './feature-sync.js';
import { tagFilterBar, filterByTags } from './tag-filter.js';
import { OnMapActions } from './on-map-actions.js';
import { LayerDetails } from './layer-details.js';

export const VIEWS = {
    atlas: { label: 'Atlas', browse: 'Atlases and maps in this view', search: 'Maps, features and places matching' },
    layers: { label: 'Maps', icon: 'layers', placeholder: 'Search by map name', browse: 'Maps on the map now', search: 'Maps named' },
    pins: { label: 'Pins', icon: 'pin-map', placeholder: 'Search pins', browse: 'Pins on the map', search: 'Pins matching' },
    routes: { label: 'Routes', icon: 'signpost-split', placeholder: 'Search routes', browse: 'Routes on the map', search: 'Routes matching' }
};

// The type filters Find used to have, for callers that still name them
const LEGACY_VIEWS = { all: 'atlas', atlases: 'atlas', maps: 'atlas', features: 'atlas', places: 'atlas', onmap: 'layers' };

export function viewFor(name) {
    return VIEWS[name] ? name : (LEGACY_VIEWS[name] || 'atlas');
}

export class FindPanel {
    constructor({ onSelect, onHover, clearQuery, onDone, onSharePins, onViewChange } = {}) {
        this._onSelect = onSelect;
        this._onSharePins = onSharePins;
        this._onDone = onDone;
        this._clearQuery = clearQuery;
        this._onHover = onHover;
        this._onViewChange = onViewChange;
        this._openAtlas = (atlasId) => this.openAtlas(atlasId);
        this._view = 'atlas';
        this._query = '';
        this._tagPath = [];
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
        // waits for the pointer to leave the list.
        this._scheduleRefresh = () => {
            if (!this._visible) return;
            clearTimeout(this._refreshTimer);
            this._refreshTimer = setTimeout(() => {
                if (this._body?.matches(':hover')) this._pendingRefresh = true;
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
        this._body.addEventListener('mouseleave', () => {
            clearPreview();
            if (this._pendingRefresh) this.render();
        });

        this.details = new LayerDetails({
            onBack: () => this.closeDetails(),
            onSelectFeature: () => this._onDone?.()
        });
        this.el.append(this._body, this.details.el);
        if (footerEl) this.el.appendChild(footerEl);
        host.appendChild(this.el);

        ['layer-toggled', 'urlUpdated', 'atlasChanged', 'layersInitialized', 'routes-changed'].forEach(type => {
            window.addEventListener(type, this._scheduleRefresh);
        });
        window.addEventListener('find-scope-changed', this._onScope);
        this._map?.on?.('moveend', this._onMoveEnd);
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
            selectPin: (item, key) => {
                this._selectedKey = key;
                this._map?.flyTo({ center: [item.markerLngLat.lng, item.markerLngLat.lat], duration: 500 });
                this.render();
            },
            selectRoute: (key) => {
                this._selectedKey = key;
                this.render();
            },
            selectPlace: (item) => this._onSelect?.(item),
            hoverPlace: (item, on) => this._onHover?.(item, on)
        };
    }

    /** A map's details page, over the list it was opened from. */
    showLayer(layer) {
        const backLabel = this._query ? `Back to results for “${this._query}”`
            : `Back to ${this._view === 'atlas' ? `maps in ${atlasName(window.layerRegistry?.getCurrentAtlas() || 'index')}` : VIEWS[this._view].label.toLowerCase()}`;
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

    /** Switch to an atlas and show it: the selector, then its maps in view. */
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

    setVisible(visible) {
        this._visible = visible;
        if (visible) this.render();
        else {
            clearPreview();
            this.closeDetails();
            this._selectedKey = null;
        }
    }

    setView(view) {
        this.closeDetails();
        this._view = viewFor(view);
        this._tagPath = [];
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
        this._onMap.hidden = !(this._view === 'layers' && !this._query);

        let hidden = 0;
        if (this._view === 'atlas') hidden = this._renderAtlasView();
        else if (this._view === 'layers') hidden = this._renderLayersView();
        else if (this._view === 'pins') hidden = this._renderPinsView();
        else if (this._view === 'routes') hidden = this._renderRoutesView();
        this._scope.sync(hidden);

        this.counts = this._query ? {
            layers: scoped(matchingLayers(this._query), layer => ({ bbox: layerBbox(layer) })).shown.length,
            pins: pinResults(this._query).shown.length,
            routes: routeResults(this._query).shown.length
        } : null;
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

    /**
     * Shows the tag filter for the maps about to be listed and returns them
     * narrowed to the chosen tags. `layerOf` reads the map from an item.
     */
    _tagFilter(items, layerOf = item => item) {
        const layers = items.map(layerOf);
        while (this._tagPath.length && !filterByTags(layers, this._tagPath).length) this._tagPath.pop();
        const bar = tagFilterBar(layers, this._tagPath, (path) => {
            this._tagPath = path;
            this.render();
        });
        if (bar) this._tags.appendChild(bar);
        return filterByTags(items, this._tagPath, layerOf);
    }

    /**
     * With a query the atlas view lists features on the map (under their
     * maps) first, then atlases and maps by name, places, pins and routes.
     */
    _renderAtlasView() {
        const { entries, hidden: hiddenAtlases } = atlasesForSelector(this._query);
        const cards = entries.length ? atlasCards(entries, this._openAtlas) : null;
        const atlasSection = cards ? (this._query ? [sectionLabel('Atlases'), cards] : [cards]) : [];
        this._atlasHead.hidden = !!this._query || !entries.length;
        if (!this._query) {
            this._atlasHead.append(...atlasSection);
            const atlasId = window.layerRegistry?.getCurrentAtlas() || 'index';
            const { shown: inScope, outside, hidden } = scoped(atlasLayers(atlasId), layer => ({ bbox: layerBbox(layer) }));
            const byTitle = (a, b) => (a.title || a.id).localeCompare(b.title || b.id, undefined, { numeric: true, sensitivity: 'base' });
            const shown = this._tagFilter(inScope).sort(byTitle);
            // The same rows as the Maps view: each map with its themes (tags)
            const active = activeIds();
            const rows = shown.map(layer => this._track(layerRow(layer, { active, meta: (layer.tags || []).join(' › '), outside: outside.has(layer) }), { layer }));
            this._section(sectionLabel(`Maps in ${atlasName(atlasId)}`), ...(rows.length ? rows : [hint('None of this atlas’s maps are in this view.')]));
            return hiddenAtlases + hidden;
        }
        const maps = mapResults(this._query, this._sections);
        const pins = pinResults(this._query);
        const routes = routeResults(this._query);
        const places = placeResults(this._sections);
        const featureGroups = new Set(maps.groups.slice(0, maps.featureGroups));
        const groups = this._tagFilter(maps.groups, group => group.layer);
        const withFeatures = { ...maps, groups: groups.filter(group => featureGroups.has(group)) };
        const byName = { ...maps, groups: groups.filter(group => !featureGroups.has(group)) };
        let shown = this._results.maps(this._content, withFeatures, { label: 'Features', key: 'features', source: 'on the map' });
        if (atlasSection.length) {
            this._section(...atlasSection);
            shown += entries.length;
        }
        shown += this._results.maps(this._content, byName, { label: 'Maps' })
            + this._results.places(this._content, places)
            + this._results.pins(this._content, pins)
            + this._results.routes(this._content, routes);
        if (!shown) this._content.appendChild(hint(`Nothing found for “${this._query}” in this view yet. Results from place search can take a moment.`));
        return hiddenAtlases + maps.hidden + pins.hidden + routes.hidden + places.hidden;
    }

    _renderLayersView() {
        if (!this._query) return 0;
        const { shown: inScope, outside, hidden } = scoped(matchingLayers(this._query), layer => ({ bbox: layerBbox(layer) }));
        const shown = this._tagFilter(inScope);
        const count = this._results.mapsByAtlas(this._content, { groups: shown.map(layer => ({ layer })), outside });
        if (!count) this._content.appendChild(hint(`No maps named “${this._query}” in this view.`));
        return hidden;
    }

    _renderPinsView() {
        const pins = pinResults(this._query);
        const share = pins.shown.length && this._onSharePins ? linkButton('Share', () => this._onSharePins()) : null;
        if (!this._results.pins(this._content, pins, { side: share })) {
            this._content.appendChild(hint(this._query ? `No pins match “${this._query}” in this view.`
                : (pins.hidden ? 'No pins in this view.' : 'No pins yet. Pins you save on the map are listed here.')));
        }
        return pins.hidden;
    }

    _renderRoutesView() {
        const routes = routeResults(this._query);
        const share = routes.shown.length && this._onSharePins ? linkButton('Share', () => this._onSharePins()) : null;
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

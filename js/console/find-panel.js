/**
 * Find - the console's one list for atlases, maps, features and places
 * (see js/map-control-bar.js). Type filters come first, then results.
 *
 * With no query it browses: what is on the map (the layer stack strip, moved
 * in here), the atlases covering the view, and the current atlas's maps by
 * theme. With a query it groups MapSearchControl's results by type; under
 * All each group shows its top few with a "Show all" row that switches the
 * filter rather than expanding in place.
 *
 * Map rows toggle with their eye and open details on click. Picking an atlas
 * switches to it and opens it here: the query clears and Find shows the atlas,
 * what is on the map and its maps by theme. Feature, pin and place rows select
 * the point and close Find.
 */
import { el, sectionLabel, linkButton, row, iconThumb, chevron, moreRow, hint } from './find-rows.js';
import {
    atlasesByRelevance, atlasCards, atlasRow, atlasName, atlasLayers, atlasHeader, mapsTree, layerRow, activeIds,
    isLayerActive, switchAtlas, clearPreview, plainText
} from './find-browse.js';
import { OnMapActions } from './on-map-actions.js';
import { LayerDetails } from './layer-details.js';
import { createMarkerProvider } from '../search/providers/marker-provider.js';
import { matchingRoutes, routeRow } from './route-list.js';

const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'onmap', label: 'On map' },
    { id: 'atlases', label: 'Atlases' },
    { id: 'maps', label: 'Maps' },
    { id: 'pins', label: 'Pins' },
    { id: 'routes', label: 'Routes' },
    { id: 'features', label: 'Features' },
    { id: 'places', label: 'Places' }
];
const GROUP_ORDER = ['onmap', 'atlases', 'maps', 'pins', 'routes', 'features', 'places'];
const GROUP_LABELS = { onmap: 'On the map', atlases: 'Atlases', maps: 'Maps', pins: 'Pins', routes: 'Routes', features: 'Features', places: 'Places' };
const GROUP_NOUNS = { onmap: 'maps on the map', atlases: 'atlases', maps: 'maps', pins: 'pins', routes: 'routes', features: 'features', places: 'places' };
const markers = createMarkerProvider();
const PREVIEW_COUNT = 3;
const ATLAS_CARD_COUNT = 8;

// Section labels from MapSearchControl._renderSuggestions -> Find type
const SECTION_TYPE = {
    'Atlases': 'atlases', 'Layers': 'maps', 'Features': 'features', 'Your markers': 'pins',
    'Directions': 'places', 'Countries': 'places', 'Mapbox': 'places', 'Nominatim': 'places',
    'Cadastral plots': 'places', 'Current location': 'places'
};
const ITEM_ICONS = {
    'map-feature': 'bounding-box-circles', 'marker': 'pin-map', 'country': 'globe2',
    'directions': 'signpost-split', 'mapbox-place': 'geo-alt'
};

export class FindPanel {
    constructor({ onSelect, onHover, getOnMapLayers, clearQuery, onDone, onSharePins } = {}) {
        this._onSelect = onSelect;
        this._onSharePins = onSharePins;
        this._onDone = onDone;
        this._clearQuery = clearQuery;
        this._openAtlas = (atlasId) => this.openAtlas(atlasId);
        this._onHover = onHover;
        this._getOnMapLayers = getOnMapLayers || (() => []);
        this._filter = 'all';
        this._query = '';
        this._sections = [];
        this._entries = [];
        this._expanded = new Set();
        this._seeded = new Set();
        this._visible = false;
        this._refreshTimer = null;
        this.onEntriesChanged = null;
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
    }

    mount(host, { stripEl = null, onToggleHidden = null, map = null } = {}) {
        this._map = map || window.map;
        this.el = el('div', 'console-find');

        this._chips = el('div', 'console-filters');
        this._chips.setAttribute('role', 'tablist');
        this._chipEls = new Map();
        FILTERS.forEach(({ id, label }) => {
            const chip = el('button', 'console-chip');
            chip.type = 'button';
            chip.setAttribute('role', 'tab');
            chip.append(el('span', '', label), el('span', 'console-chip-count'));
            chip.addEventListener('click', () => this.setFilter(id));
            this._chips.appendChild(chip);
            this._chipEls.set(id, chip);
        });

        this._body = el('div', 'console-find-body');
        this.onMapActions = new OnMapActions({ onToggleHidden });
        this._atlasHead = el('section', 'console-section');
        this._onMap = el('section', 'console-section console-onmap');
        this._onMap.append(sectionLabel('On the map', this.onMapActions.el));
        if (stripEl) this._onMap.appendChild(stripEl);
        this._content = el('div', 'console-find-content');
        this._body.append(this._atlasHead, this._onMap, this._content);
        this._body.addEventListener('mouseleave', () => {
            clearPreview();
            if (this._pendingRefresh) this.render();
        });

        this.details = new LayerDetails({
            onBack: () => this.closeDetails(),
            onSelectFeature: () => this._onDone?.()
        });
        this.el.append(this._chips, this._body, this.details.el);
        host.appendChild(this.el);

        ['layer-toggled', 'urlUpdated', 'atlasChanged', 'layersInitialized'].forEach(type => {
            window.addEventListener(type, this._scheduleRefresh);
        });
        this._map?.on?.('moveend', this._scheduleRefresh);
    }

    /** A map's details page, over the list it was opened from. */
    showLayer(layer) {
        const filter = FILTERS.find(f => f.id === this._filter);
        const backLabel = this._query ? `Results for “${this._query}”` : (this._filter === 'all' ? 'Find' : filter.label);
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

    /** Switch to an atlas and show it: its header, what is on the map, its maps. */
    openAtlas(atlasId) {
        switchAtlas(atlasId);
        this._clearQuery?.();
        this._query = '';
        this._sections = [];
        this._filter = 'all';
        this.render();
        this._body.scrollTop = 0;
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
        }
    }

    setFilter(filter) {
        this.closeDetails();
        this._filter = filter;
        this._body.scrollTop = 0;
        this.render();
    }

    get filter() {
        return this._filter;
    }

    setQuery(query) {
        const next = (query || '').trim();
        if (next === this._query) return;
        this.closeDetails();
        this._query = next;
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
        const groups = this._query ? this._resultGroups() : null;
        this._renderChips(groups);
        this._content.replaceChildren();

        const showOnMap = !this._query && (this._filter === 'all' || this._filter === 'onmap');
        this._onMap.hidden = !showOnMap;
        const showAtlas = !this._query && (this._filter === 'all' || this._filter === 'maps');
        this._atlasHead.hidden = !showAtlas;
        if (showAtlas) this._atlasHead.replaceChildren(atlasHeader(this._currentAtlas()));

        if (this._query) this._renderResults(groups);
        else this._renderBrowse();
        this.onEntriesChanged?.(this._entries);
    }

    _renderChips(groups) {
        const counts = groups
            ? Object.fromEntries(GROUP_ORDER.map(type => [type, groups[type].length]))
            : {
                onmap: this._getOnMapLayers().length,
                atlases: window.layerRegistry?.getAllAtlasMetadata().length || 0,
                maps: atlasLayers(this._currentAtlas()).length,
                pins: markers.list().length,
                routes: matchingRoutes().length
            };
        this._chipEls.forEach((chip, id) => {
            const count = id === 'all'
                ? (groups ? GROUP_ORDER.reduce((sum, type) => sum + counts[type], 0) : null)
                : counts[id];
            chip.querySelector('.console-chip-count').textContent = count == null ? '' : String(count);
            const selected = id === this._filter;
            chip.classList.toggle('selected', selected);
            chip.setAttribute('aria-selected', String(selected));
            chip.disabled = !!groups && id !== 'all' && count === 0 && !selected;
        });
    }

    _currentAtlas() {
        return window.layerRegistry?.getCurrentAtlas() || 'index';
    }

    _renderBrowse() {
        const atlasId = this._currentAtlas();
        const section = (...children) => {
            const node = el('section', 'console-section');
            node.append(...children);
            this._content.appendChild(node);
        };
        if (this._filter === 'all') {
            const atlases = atlasesByRelevance();
            section(
                sectionLabel('Atlases', linkButton(`All ${atlases.length}`, () => this.setFilter('atlases'))),
                atlasCards(atlases.slice(0, ATLAS_CARD_COUNT), this._openAtlas)
            );
            section(sectionLabel(`Maps in ${atlasName(atlasId)}`), mapsTree(atlasId, this._expanded, this._seeded));
        } else if (this._filter === 'atlases') {
            const node = el('section', 'console-section');
            node.appendChild(sectionLabel('Atlases'));
            atlasesByRelevance().forEach(entry => node.appendChild(atlasRow(entry, this._openAtlas)));
            this._content.appendChild(node);
        } else if (this._filter === 'maps') {
            section(sectionLabel(`Maps in ${atlasName(atlasId)}`), mapsTree(atlasId, this._expanded, this._seeded));
        } else if (this._filter === 'pins') {
            const pins = markers.list();
            const share = pins.length && this._onSharePins ? linkButton('Share', () => this._onSharePins()) : null;
            section(sectionLabel('Pins', share), ...(pins.length
                ? pins.map(item => this._resultRow('pins', item))
                : [hint('No pins yet. Pins you save on the map are listed here.')]));
        } else if (this._filter === 'routes') {
            const routes = matchingRoutes();
            const share = routes.length && this._onSharePins ? linkButton('Share', () => this._onSharePins()) : null;
            section(sectionLabel('Routes', share), ...(routes.length
                ? routes.map(route => this._resultRow('routes', route))
                : [hint('No routes yet. Right-click the map and pick Route From, then Route To.')]));
        } else if (this._filter === 'features') {
            section(hint('Type to search features on the visible maps. Click the map to see everything at one point.'));
        } else if (this._filter === 'places') {
            section(hint('Type a place, an address or coordinates, such as 15.4989, 73.8278.'));
        }
    }

    _resultGroups() {
        const groups = Object.fromEntries(GROUP_ORDER.map(type => [type, []]));
        const term = this._query.toLowerCase();
        groups.onmap = this._getOnMapLayers().filter(layer =>
            [layer.title, layer.id, plainText(layer.description)].some(text => String(text || '').toLowerCase().includes(term)));
        groups.routes = matchingRoutes(term);
        // A map already on the map is listed under On the map, not again under Maps
        const active = activeIds();
        this._sections.forEach(section => {
            const type = SECTION_TYPE[section.ariaLabel] || 'places';
            (section.items || []).forEach(item => {
                if (type === 'maps' && item.layer && isLayerActive(item.layer, active)) return;
                groups[type].push(item);
            });
        });
        return groups;
    }

    _renderResults(groups) {
        const types = this._filter === 'all' ? GROUP_ORDER : [this._filter];
        let shown = 0;
        types.forEach(type => {
            const items = groups[type];
            if (!items.length) return;
            shown += items.length;
            const node = el('section', 'console-section');
            node.appendChild(sectionLabel(GROUP_LABELS[type], this._groupSource(type)));
            const limit = this._filter === 'all' ? PREVIEW_COUNT : items.length;
            items.slice(0, limit).forEach(item => node.appendChild(this._resultRow(type, item)));
            if (items.length > limit) {
                node.appendChild(moreRow(`Show all ${items.length} ${GROUP_NOUNS[type]}`, () => this.setFilter(type)));
            }
            this._content.appendChild(node);
        });
        if (!shown) {
            const where = this._filter === 'all' ? '' : ` in ${FILTERS.find(f => f.id === this._filter).label}`;
            this._content.appendChild(hint(`Nothing found for “${this._query}”${where} yet. Results from place search can take a moment.`));
        }
    }

    _groupSource(type) {
        if (type === 'maps') return el('span', '', 'all atlases');
        if (type === 'places') return el('span', '', 'Mapbox · OpenStreetMap');
        if (type === 'features') return el('span', '', 'visible maps');
        return null;
    }

    _resultRow(type, item) {
        if (type === 'routes') return this._track(routeRow(item, { onDone: this._onDone }), item);
        if (type === 'onmap') return this._track(layerRow(item, { meta: atlasName(item._sourceAtlas) }), item);
        if (item._searchResultType === 'layer') {
            const layer = item.layer;
            const path = [layer._sourceAtlas && atlasName(layer._sourceAtlas), ...(layer.tags || [])].filter(Boolean).join(' › ');
            return this._track(layerRow(layer, { active: activeIds(), meta: path }), item);
        }
        if (item._searchResultType === 'atlas') {
            const current = item.atlasId === this._currentAtlas();
            const meta = window.layerRegistry?.getAtlasMetadata(item.atlasId);
            return this._track(atlasRow({ id: item.atlasId, meta, current, inView: false }, this._openAtlas), item);
        }
        const isPlot = !!item.properties?._isCadastralParquet;
        const node = row({
            thumb: iconThumb(isPlot ? 'grid-3x3' : (ITEM_ICONS[item._searchResultType] || 'geo-alt')),
            title: item.properties?.name || '',
            meta: item.properties?.place_name || '',
            trailing: chevron(),
            onClick: () => this._onSelect?.(item),
            onEnter: () => this._onHover?.(item, true),
            onLeave: () => this._onHover?.(item, false)
        });
        return this._track(node, item);
    }

    _track(node, item) {
        this._entries.push({ el: node, item });
        return node;
    }

    destroy() {
        clearTimeout(this._refreshTimer);
        ['layer-toggled', 'urlUpdated', 'atlasChanged', 'layersInitialized'].forEach(type => {
            window.removeEventListener(type, this._scheduleRefresh);
        });
        this._map?.off?.('moveend', this._scheduleRefresh);
        this.onMapActions?.destroy();
        this.el?.remove();
    }
}

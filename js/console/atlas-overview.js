/**
 * The current atlas's overview, under its description and attribution in
 * atlas mode (js/console/console-head.js):
 *
 * - Active Maps: the maps on the map, with Default Maps - its starred maps
 *   (js/starred-layers.js) - and Show all in view (js/console/active-maps.js);
 * - Reset Zoom, fitting the map to the atlas while the view doesn't take all
 *   of it in; while atlas mode is open the atlas's outline and its maps'
 *   extents are drawn on the main map (js/console/atlas-outlines.js);
 * - Data Sources: its maps as a tree of where their data comes from
 *   (js/console/data-sources.js), starred maps and their groups first, beside
 *   a map of the atlas and its maps' extents (js/console/sources-map.js).
 *
 * A map opens its details page in Find (js/console/layer-details.js), without
 * turning it on, and Back returns here.
 */
import { el, icon, eyeButton, setEyeState, layerThumb } from './find-rows.js';
import { atlasLayers } from './find-browse.js';
import { dataSourcesTree, filterTree } from './data-sources.js';
import { SourcesMap } from './sources-map.js';
import { ActiveMaps } from './active-maps.js';
import { isStarred, onStarredChange } from '../starred-layers.js';
import { showOutlines, viewHoldsAtlas, zoomToAtlas, atlasExtent } from './atlas-outlines.js';

const TREE_THUMB = 20;
const browser = () => window.browserControl;
const baseId = (id) => browser()?._baseLayerId?.(id) ?? id;

function activeBaseIds() {
    return new Set([...(browser()?._getActiveLayers?.() || [])].map(baseId).filter(id => id !== 'locations'));
}

export class AtlasOverview {
    constructor() {
        this._key = null;
        this._items = [];
        this.el = el('div', 'console-atlas-overview');
        // A star set here, on a map's details page or in the layer editor
        // Maps turned on or off - here, on the map or anywhere else
        // (the active maps are read back from the URL state, written on its own
        // 300ms debounce - see CLAUDE.md - so urlUpdated is the settled signal)
        let timer = null;
        const later = () => {
            clearTimeout(timer);
            timer = setTimeout(() => this.refresh(), 150);
        };
        window.addEventListener('layer-toggled', later);
        window.addEventListener('urlUpdated', later);
        onStarredChange(() => {
            if (!this._atlasId) return;
            this._key = null;
            this.render(this._atlasId);
        });
    }

    /** Builds the overview for an atlas, unless it already shows it. */
    render(atlasId) {
        const layers = atlasLayers(atlasId);
        const key = `${atlasId}:${layers.length}`;
        if (key === this._key) return this.refresh();
        this._key = key;
        this._atlasId = atlasId;
        // Bound once the map exists - the overview is built before it is
        if (!this._moveBound && typeof window.map?.on === 'function') {
            this._moveBound = true;
            window.map.on('moveend', () => this._syncZoom());
        }
        this._items = [];
        const defaults = new Set((browser()?._getAtlasInitiallyCheckedIds?.(atlasId) || []).map(baseId));
        const starred = (layer) => isStarred(layer, { isDefault: defaults.has(baseId(layer._prefixedId || layer.id)) });
        this._starred = layers.filter(starred);
        this._isStarred = starred;

        // Outlines drawn for the atlas left behind follow to this one
        if (this._active) showOutlines(atlasId);

        this._zoomButton = el('button', 'console-overview-action');
        this._zoomButton.type = 'button';
        this._zoomButton.append(icon('arrows-fullscreen'), el('span', '', 'Reset Zoom'));
        this._zoomButton.addEventListener('click', () => zoomToAtlas(this._atlasId));

        const controls = el('div', 'console-overview-actions');
        controls.append(this._zoomButton);
        this._activeMaps ||= new ActiveMaps({ row: (layer) => this._item(layer, this._isStarred(layer)), defaults: () => this._starred });
        // Its rows are drawn afresh, so their eyes are among this overview's
        this._activeMaps.reset();
        // The tree beside a map of the atlas and its maps' extents
        const tree = dataSourcesTree(layers, (layer, isOn) => this._item(layer, isOn), starred);
        const heading = tree.querySelector('.console-sources-heading');
        const count = heading.querySelector('.console-tree-count');
        const allCount = count.textContent;
        // The map's point filters the tree to the maps there
        this._map = new SourcesMap({
            atlasId,
            layers,
            keyOf: (layer) => baseId(layer._prefixedId || layer.id),
            onFilter: (keys, at) => {
                const shown = filterTree(tree, keys);
                count.textContent = keys ? `${shown} of ${layers.length} maps at ${at[1].toFixed(3)}, ${at[0].toFixed(3)}` : allCount;
                heading.classList.toggle('is-filtered', !!keys);
            }
        });
        const columns = el('div', 'atlas-browser');
        columns.append(tree, this._map.el);
        this.el.replaceChildren(controls, this._activeMaps.el, heading, columns);
        this.refresh();
    }

    /** Atlas mode open or shut: the atlas's outlines on the main map while it is open. */
    setActive(open) {
        this._active = !!open;
        showOutlines(open ? this._atlasId : null);
    }

    /** Keeps the on marks and Active Maps in step with the maps on the map. */
    refresh() {
        if (!this._atlasId) return;
        this._activeMaps?.render(this._atlasId);
        const active = activeBaseIds();
        this._items.forEach(({ node, eye, id, title }) => {
            const on = active.has(id);
            node.classList.toggle('on', on);
            setEyeState(eye, on ? 'on' : 'off', on ? `Hide ${title}` : `Show ${title}`);
        });
        this._syncZoom();
    }

    /** Reset Zoom only while the view doesn't take in the whole atlas; the map's view box follows. */
    _syncZoom() {
        this._map?.updateView();
        this._activeMaps?.syncCounts();
        if (!this._zoomButton || !this._atlasId) return;
        const global = !atlasExtent(this._atlasId);
        const holds = global || viewHoldsAtlas(this._atlasId);
        this._zoomButton.disabled = holds;
        this._zoomButton.title = global ? 'This atlas covers the whole world'
            : holds ? 'The map already shows all of this atlas' : 'Fit the map to this atlas';
    }

    /** One map: its thumbnail (js/layer-thumbnail.js), title, a star when starred, and its eye at the end; opens its details. */
    _item(layer, starred) {
        const node = el('div', 'console-tree-item' + (starred ? ' is-starred' : ''));
        node.setAttribute('role', 'button');
        node.tabIndex = 0;
        const title = layer.title || layer.name || layer.id;
        node.title = `${title} - details`;
        const thumb = layerThumb(layer, TREE_THUMB);
        thumb.classList.add('console-tree-thumb');
        node.append(thumb, el('span', 'console-tree-title', title));
        if (starred) node.appendChild(Object.assign(icon('star-fill'), { className: 'console-tree-star' }));
        const id = baseId(layer._prefixedId || layer.id);
        node.dataset.layerKey = id;
        node.addEventListener('mouseenter', () => this._map?.hover(id, true));
        node.addEventListener('mouseleave', () => this._map?.hover(id, false));
        const on = activeBaseIds().has(id);
        const eye = eyeButton(on ? 'on' : 'off', () => {
            const show = !eye.classList.contains('on');
            browser()?._handleLayerToggle(layer._prefixedId || layer.id, show);
            setEyeState(eye, show ? 'on' : 'off', show ? `Hide ${title}` : `Show ${title}`);
        }, on ? `Hide ${title}` : `Show ${title}`);
        eye.classList.add('console-tree-eye');
        node.appendChild(eye);
        node.classList.toggle('on', on);
        const open = () => window.mapConsole?.showLayer(layer, { activate: false });
        node.addEventListener('click', (e) => {
            e.stopPropagation();
            open();
        });
        node.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target === node) open();
        });
        this._items.push({ node, eye, id, title });
        return node;
    }
}

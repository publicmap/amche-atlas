/**
 * Active Maps, above Data Sources in atlas mode (js/console/atlas-overview.js):
 * the maps now on the map, as the tree's rows, and beside its heading Show:
 * two links, each only while it would change what is on the map -
 * Starred (x): the atlas's starred maps (js/starred-layers.js - its
 * `initiallyChecked` maps unless the viewer changed the stars), and only
 * those, keeping the index atlas's shared base maps; In Current View (y):
 * every map of the atlas taking in the view - its own extent, or, without
 * one, its atlas's - turned on beside what is on already; once they all are,
 * Hide All instead, leaving only the shared base maps.
 */
import { el, icon, linkButton, hint } from './find-rows.js';
import { atlasLayers } from './find-browse.js';
import { parseBbox, viewBbox, bboxInView } from './find-scope.js';
import { atlasExtent } from './atlas-outlines.js';

const browser = () => window.browserControl;
const baseId = (id) => browser()?._baseLayerId?.(id) ?? id;

function activeIds() {
    return [...(browser()?._getActiveLayers?.() || [])].filter(id => baseId(id) !== 'locations');
}

/**
 * Each map on the map once: a map is active under its plain and its
 * atlas-prefixed id alike, so they are told apart by the id the registry
 * resolves them to.
 */
function activeMaps() {
    const byLayer = new Map();
    activeIds().forEach(id => {
        const key = window.layerRegistry?.getLayer?.(id, null, true)?._prefixedId || baseId(id);
        if (!byLayer.has(key)) byLayer.set(key, key);
    });
    return [...byLayer.values()];
}

/** The atlas's maps taking in the view. */
function mapsInView(atlasId) {
    const view = viewBbox();
    const atlasBox = atlasExtent(atlasId);
    const atlasInView = !atlasBox || bboxInView(atlasBox, view);
    return atlasLayers(atlasId).filter(layer => {
        const box = parseBbox(layer.bbox) || parseBbox(layer.bounds);
        return box ? bboxInView(box, view) : atlasInView;
    });
}

/** Only the default (starred) maps, and the index atlas's shared base maps. */
function setDefaults(defaults) {
    const control = browser();
    if (!control) return;
    const wanted = new Set(defaults.map(layer => baseId(layer._prefixedId || layer.id)));
    const base = new Set((control._getAtlasInitiallyCheckedIds('index') || []).map(baseId));
    activeIds().forEach(id => {
        if (!wanted.has(baseId(id)) && !base.has(baseId(id))) control._handleLayerToggle(id, false);
    });
    const on = new Set(activeIds().map(baseId));
    defaults.forEach(layer => {
        const id = layer._prefixedId || layer.id;
        if (!on.has(baseId(id))) control._handleLayerToggle(id, true);
    });
}

function showInView(atlasId) {
    const control = browser();
    if (!control) return;
    const on = new Set(activeIds().map(baseId));
    mapsInView(atlasId).forEach(layer => {
        const id = layer._prefixedId || layer.id;
        if (!on.has(baseId(id))) control._handleLayerToggle(id, true);
    });
}

export class ActiveMaps {
    /**
     * @param {{row: (layer) => HTMLElement, defaults: () => Array}} options - row: draws a
     *   map's row, as the tree does; defaults: the atlas's default (starred) maps
     */
    constructor({ row, defaults }) {
        this._row = row;
        this._getDefaults = defaults;
        this.el = el('section', 'console-active-maps');
        const heading = el('div', 'console-sources-heading');
        this._count = el('span', 'console-tree-count');
        this._list = el('div', 'console-tree-items');
        this._defaults = linkButton('', () => setDefaults(this._getDefaults()), 'Only this atlas’s default (starred) maps, and the shared base maps');
        this._inView = linkButton('', () => {
            if (this._allShown) browser()?.hideAllLayers?.();
            else showInView(this._atlasId);
        }, '');
        this._links = el('span', 'console-active-links');
        this._sep = el('span', 'console-active-sep', '|');
        this._links.append(el('span', 'console-active-label', 'Show'), this._defaults, this._sep, this._inView);
        heading.append(icon('layers'), el('span', 'console-sources-title', 'Active Maps'), this._count, this._links);
        this.el.append(heading, this._list);
    }

    reset() {
        this._key = null;
    }

    /** Lists the maps on the map again, when they changed; the links' counts always. */
    render(atlasId) {
        this._atlasId = atlasId;
        const ids = activeMaps();
        const key = `${atlasId}|${ids.join(',')}`;
        if (key !== this._key) {
            this._key = key;
            const layers = ids.map(id => window.layerRegistry?.getLayer?.(id, null, true) || { id }).map((layer, i) => ({ ...layer, _prefixedId: layer._prefixedId || ids[i] }));
            this._list.replaceChildren(...(layers.length ? layers.map(layer => this._row(layer)) : [hint('Nothing is on the map.')]));
            this._count.textContent = `(${ids.length})`;
        }
        this.syncCounts();
    }

    syncCounts() {
        if (!this._atlasId) return;
        this._defaults.replaceChildren(el('span', '', 'Starred'), icon('star-fill'), el('span', '', `(${this._getDefaults().length})`));
        const inView = mapsInView(this._atlasId);
        const on = new Set(activeIds().map(baseId));
        const base = new Set((browser()?._getAtlasInitiallyCheckedIds?.('index') || []).map(baseId));
        const starred = new Set(this._getDefaults().map(layer => baseId(layer._prefixedId || layer.id)));
        // Everything in view on already: the link takes them all off instead
        this._allShown = inView.length > 0 && inView.every(layer => on.has(baseId(layer._prefixedId || layer.id)));
        // Only the links that would change what is on the map
        const starredShowing = [...starred].every(id => on.has(id)) && [...on].every(id => starred.has(id) || base.has(id));
        const nothingToHide = [...on].every(id => base.has(id));
        this._defaults.hidden = !starred.size || starredShowing;
        this._inView.hidden = this._allShown ? nothingToHide : !inView.length;
        this._sep.hidden = this._defaults.hidden || this._inView.hidden;
        this._links.hidden = this._defaults.hidden && this._inView.hidden;
        this._inView.textContent = this._allShown ? 'Hide All' : `In Current View (${inView.length})`;
        this._inView.title = this._allShown ? 'Turn every map off, but the shared base maps' : 'Turn on every map of this atlas in the view';
    }
}

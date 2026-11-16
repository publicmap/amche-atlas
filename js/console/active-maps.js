/**
 * Active Maps, above Data Sources in atlas mode (js/console/atlas-overview.js):
 * the maps now on the map, then those the atlas has had on that are off now
 * (js/active-map-history.js), as the tree's rows. Its header's actions:
 * Starred - the atlas's starred maps (js/starred-layers.js - its
 * `initiallyChecked` maps unless the viewer changed the stars), and only
 * those, keeping the index atlas's shared base maps; In view - every map of
 * the atlas taking in the view (its own extent, or, without one, its
 * atlas's) turned on beside what is on already; and the eye over them all.
 *
 * The actions (ShowLinks) are also in Find's Active Maps header
 * (js/console/find-panel.js).
 */
import { el, hint, sectionHeader, sectionAction, setActionTitle, setSectionCount } from './find-rows.js';
import { atlasLayers, layersGroupEye, syncLayersGroupEye } from './find-browse.js';
import { activeMapHistory } from '../active-map-history.js';
import { parseBbox, viewBbox, bboxInView } from './find-scope.js';
import { atlasExtent } from './atlas-outlines.js';
import { isStarred } from '../starred-layers.js';

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

/** The atlas's starred maps: its `initiallyChecked` ones unless the viewer changed the stars. */
export function starredMaps(atlasId) {
    const defaults = new Set((browser()?._getAtlasInitiallyCheckedIds?.(atlasId) || []).map(baseId));
    return atlasLayers(atlasId).filter(layer => isStarred(layer, { isDefault: defaults.has(baseId(layer._prefixedId || layer.id)) }));
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

/**
 * Two square actions for a section header (sectionAction, js/console/find-rows.js),
 * each shown only while it would change what is on the map: Starred - only
 * the atlas's starred maps, and the shared base maps; In view - turn on every
 * map of the atlas taking in the view. (Turning everything off is the
 * section's eye.)
 */
export class ShowLinks {
    /** @param {{defaults?: (atlasId: string) => Array}} [options] - the atlas's default (starred) maps */
    constructor({ defaults = starredMaps } = {}) {
        this._getDefaults = () => defaults(this._atlasId);
        this._defaults = sectionAction('star', '', () => setDefaults(this._getDefaults()));
        this._inView = sectionAction('bounding-box-circles', '', () => showInView(this._atlasId));
        this.buttons = [this._defaults, this._inView];
    }

    sync(atlasId) {
        this._atlasId = atlasId;
        if (!atlasId) return;
        const defaults = this._getDefaults();
        const inView = mapsInView(atlasId);
        const on = new Set(activeIds().map(baseId));
        const base = new Set((browser()?._getAtlasInitiallyCheckedIds?.('index') || []).map(baseId));
        const starred = new Set(defaults.map(layer => baseId(layer._prefixedId || layer.id)));
        const starredShowing = [...starred].every(id => on.has(id)) && [...on].every(id => starred.has(id) || base.has(id));
        const offInView = inView.filter(layer => !on.has(baseId(layer._prefixedId || layer.id)));
        this._defaults.hidden = !starred.size || starredShowing;
        this._inView.hidden = !offInView.length;
        setActionTitle(this._defaults, `Show only this atlas’s ${defaults.length} starred map${defaults.length === 1 ? '' : 's'}, and the shared base maps`);
        setActionTitle(this._inView, `Turn on ${offInView.length === 1 ? 'the 1 map' : `the ${offInView.length} maps`} of this atlas in the view that ${offInView.length === 1 ? 'is' : 'are'} off`);
    }
}

export class ActiveMaps {
    /**
     * @param {{row: (layer) => HTMLElement, defaults: () => Array}} options - row: draws a
     *   map's row, as the tree does; defaults: the atlas's default (starred) maps
     */
    constructor({ row, defaults }) {
        this._row = row;
        this.el = el('section', 'console-section console-active-maps');
        this._list = el('div', 'console-tree-items');
        this._links = new ShowLinks({ defaults: () => defaults() });
        this._eye = layersGroupEye(() => this._layers || [], 'the maps in this list');
        this._head = sectionHeader({ label: 'Active Maps', actions: this._links.buttons, eye: this._eye });
        this.el.append(this._head, this._list);
    }

    reset() {
        this._key = null;
    }

    /**
     * The maps on the map, then those the atlas has had on and are off now
     * (js/active-map-history.js), when they changed; the actions always.
     */
    render(atlasId) {
        this._atlasId = atlasId;
        const ids = activeMaps();
        const off = activeMapHistory.list(atlasId).filter(id => id !== 'locations' && !ids.some(on => baseId(on) === baseId(id)));
        const key = `${atlasId}|${ids.join(',')}|${off.join(',')}`;
        if (key !== this._key) {
            this._key = key;
            this._layers = [...ids, ...off]
                .map(id => {
                    const layer = window.layerRegistry?.getLayer?.(id, null, true);
                    return layer || (ids.includes(id) ? { id } : null);
                })
                .filter(Boolean)
                .map(layer => ({ ...layer, _prefixedId: layer._prefixedId || layer.id }));
            this._list.replaceChildren(...(this._layers.length ? this._layers.map(layer => this._row(layer)) : [hint('Nothing is on the map.')]));
            setSectionCount(this._head, this._layers.length);
        }
        this.syncCounts();
    }

    syncCounts() {
        if (this._atlasId) this._links.sync(this._atlasId);
        syncLayersGroupEye(this._eye, this._layers || []);
    }
}

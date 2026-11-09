/**
 * The current atlas's overview, under its description and attribution in
 * atlas mode (js/console/console-head.js):
 *
 * - its default maps - those marked `initiallyChecked`, which it opens with -
 *   each marked when it is on the map;
 * - Reset Maps, once the maps on the map differ from those defaults, and a
 *   way back to the map list;
 * - Data Sources: its maps as a collapsed tree of where their data comes
 *   from (js/console/data-sources.js).
 *
 * A map opens its details page in Find (js/console/layer-details.js), without
 * turning it on, and Back returns here.
 */
import { el, icon } from './find-rows.js';
import { atlasLayers } from './find-browse.js';
import { dataSourcesTree } from './data-sources.js';

const browser = () => window.browserControl;
const baseId = (id) => browser()?._baseLayerId?.(id) ?? id;

function activeBaseIds() {
    return new Set([...(browser()?._getActiveLayers?.() || [])].map(baseId).filter(id => id !== 'locations'));
}

/** Whether the maps on the map are not the atlas's defaults (its own and the index atlas's). */
function isCustomized(atlasId) {
    const defaults = new Set((browser()?._getAtlasDefaultLayerIds?.(atlasId) || []).map(baseId));
    const active = activeBaseIds();
    return defaults.size !== active.size || [...defaults].some(id => !active.has(id));
}

/** Turns off every map that is not a default, then on every default that is off. */
function resetMaps(atlasId) {
    const control = browser();
    if (!control) return;
    const defaultIds = control._getAtlasDefaultLayerIds(atlasId);
    const defaults = new Set(defaultIds.map(baseId));
    control._getActiveLayers().forEach(id => {
        const base = baseId(id);
        if (base !== 'locations' && !defaults.has(base)) control._handleLayerToggle(id, false);
    });
    const active = activeBaseIds();
    defaultIds.forEach(id => {
        if (!active.has(baseId(id))) control._handleLayerToggle(id, true);
    });
}

function actionButton(label, iconName, onClick) {
    const node = el('button', 'console-overview-action');
    node.type = 'button';
    node.append(icon(iconName), el('span', '', label));
    node.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return node;
}

export class AtlasOverview {
    constructor({ onBack } = {}) {
        this._onBack = onBack;
        this._key = null;
        this._items = [];
        this.el = el('div', 'console-atlas-overview');
    }

    /** Builds the overview for an atlas, unless it already shows it. */
    render(atlasId) {
        const layers = atlasLayers(atlasId);
        const key = `${atlasId}:${layers.length}`;
        if (key === this._key) return this.refresh();
        this._key = key;
        this._atlasId = atlasId;
        this._items = [];
        this.el.replaceChildren();

        const defaults = (browser()?._getAtlasInitiallyCheckedIds?.(atlasId) || [])
            .map(id => layers.find(layer => layer._prefixedId === id || layer.id === baseId(id)))
            .filter(Boolean);
        if (defaults.length) {
            const list = el('div', 'console-tree-items');
            defaults.forEach(layer => list.appendChild(this._item(layer)));
            this.el.append(el('div', 'console-overview-label', `Default maps · ${defaults.length}`), list);
        }

        const actions = el('div', 'console-overview-actions');
        this._reset = actionButton('Reset Maps', 'arrow-counterclockwise', () => resetMaps(this._atlasId));
        actions.append(this._reset, actionButton('Back to maps', 'chevron-left', () => this._onBack?.()));
        this.el.appendChild(actions);

        this.el.appendChild(dataSourcesTree(layers, (layer) => this._item(layer)));
        this.refresh();
    }

    /** Keeps the on marks and Reset Maps in step with the maps on the map. */
    refresh() {
        if (!this._atlasId) return;
        const active = activeBaseIds();
        this._items.forEach(({ node, id }) => node.classList.toggle('on', active.has(id)));
        const customized = isCustomized(this._atlasId);
        this._reset.disabled = !customized;
        this._reset.title = customized ? 'Bring back the maps this atlas opens with, and only those' : 'The map shows this atlas’s default maps';
    }

    /** One map: a dot when it is on, and its title; opens in the layer editor. */
    _item(layer) {
        const node = el('button', 'console-tree-item');
        node.type = 'button';
        const title = layer.title || layer.name || layer.id;
        node.title = `${title} - details`;
        node.append(el('span', 'console-tree-dot'), el('span', 'console-tree-title', title));
        node.addEventListener('click', (e) => {
            e.stopPropagation();
            window.mapConsole?.showLayer(layer, { activate: false });
        });
        const id = baseId(layer._prefixedId || layer.id);
        node.classList.toggle('on', activeBaseIds().has(id));
        this._items.push({ node, id });
        return node;
    }
}

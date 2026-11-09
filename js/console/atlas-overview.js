/**
 * The current atlas's overview, under its description and attribution in
 * atlas mode (js/console/console-head.js):
 *
 * - its default maps - those marked `initiallyChecked`, which it opens with -
 *   each marked when it is on the map;
 * - Reset Maps, once the maps on the map differ from those defaults, and a
 *   way back to the map list;
 * - how many maps it has, as a collapsed tree by source (each map's
 *   attribution, up to any "via ...", else its tile host), every branch
 *   built only when opened, so even hundreds of maps stay quick to browse.
 *
 * A map opens in the layer editor (map-creator.html).
 */
import { el, icon } from './find-rows.js';
import { atlasLayers, plainText } from './find-browse.js';

const SOURCE_MAX = 60;
const browser = () => window.browserControl;
const baseId = (id) => browser()?._baseLayerId?.(id) ?? id;

export function sourceOf(layer) {
    const credit = plainText(layer?.attribution)
        .split(/\s+via\s+/i)[0]
        .replace(/^(©|\(c\)|copyright|source:|data:)\s*/i, '')
        .replace(/^©\s*/, '')
        .trim();
    if (credit) return credit.length > SOURCE_MAX ? `${credit.slice(0, SOURCE_MAX - 1)}…` : credit;
    try {
        return new URL(String(layer?.url || '').replace(/\{[^}]*\}/g, '0')).hostname.replace(/^www\./, '');
    } catch {
        return 'No source given';
    }
}

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

        this.el.appendChild(this._tree(layers));
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

    _tree(layers) {
        const groups = new Map();
        layers.forEach(layer => {
            const source = sourceOf(layer);
            if (!groups.has(source)) groups.set(source, []);
            groups.get(source).push(layer);
        });
        const root = el('details', 'console-tree');
        const summary = el('summary', 'console-tree-summary');
        summary.append(icon('stack'), el('span', 'console-tree-name', `${layers.length} Maps`), el('span', 'console-tree-count', `${groups.size} source${groups.size === 1 ? '' : 's'}`));
        root.appendChild(summary);
        [...groups.entries()]
            .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
            .forEach(([source, items]) => root.appendChild(this._branch(source, items)));
        return root;
    }

    _branch(source, layers) {
        const branch = el('details', 'console-tree console-tree-branch');
        const summary = el('summary', 'console-tree-summary');
        summary.append(el('span', 'console-tree-name', source), el('span', 'console-tree-count', String(layers.length)));
        summary.title = source;
        branch.appendChild(summary);
        branch.addEventListener('toggle', () => {
            if (!branch.open || branch.childElementCount > 1) return;
            const list = el('div', 'console-tree-items');
            [...layers]
                .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id, undefined, { numeric: true, sensitivity: 'base' }))
                .forEach(layer => list.appendChild(this._item(layer)));
            branch.appendChild(list);
            this.refresh();
        });
        return branch;
    }

    /** One map: a dot when it is on, its title and type; opens in the layer editor. */
    _item(layer) {
        const node = el('button', 'console-tree-item');
        node.type = 'button';
        const title = layer.title || layer.name || layer.id;
        node.title = `${title} - open in the layer editor`;
        node.append(el('span', 'console-tree-dot'), el('span', 'console-tree-title', title), el('span', 'console-tree-type', layer.type || ''));
        node.addEventListener('click', (e) => {
            e.stopPropagation();
            browser()?.openLayerEditor(layer, { tab: 'view' });
        });
        this._items.push({ node, id: baseId(layer._prefixedId || layer.id) });
        return node;
    }
}

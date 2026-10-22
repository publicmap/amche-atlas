/**
 * Find's atlas view (js/console/find-panel.js): the atlas selector - index,
 * current, then the rest, matches for a query leading - and the current
 * atlas's maps grouped by theme (their `tags`). Also the
 * layer/atlas actions every Find list shares - toggling a map, opening its
 * details, previewing its extent - which all go through MapBrowserControl so
 * Find behaves exactly as the old map browser panel did.
 */
import { el, icon, row, eyeButton, layerThumb, imageThumb, hint } from './find-rows.js';
import { matchRank } from './find-rank.js';
import { viewBbox, bboxInView, parseBbox, layerBbox, isIncludingOutside, zoomButton } from './find-scope.js';

const browser = () => window.browserControl;
const registry = () => window.layerRegistry;

export function activeIds() {
    return browser()?._getActiveLayers?.() || new Set();
}

export function isLayerActive(layer, active = activeIds()) {
    return active.has(layer._prefixedId) || active.has(layer.id);
}

export function setLayerActive(layer, on) {
    browser()?._handleLayerToggle(layer._prefixedId || layer.id, on);
}

export function openLayerInfo(layer) {
    if (window.mapConsole) window.mapConsole.showLayer(layer);
    else browser()?._openLayerInfo(layer);
}

export function previewLayer(layer) {
    browser()?._handleLayerPreview?.(layer._prefixedId || layer.id);
}

export function previewAtlas(atlasId) {
    browser()?._handleAtlasPreview?.(atlasId);
}

export function clearPreview() {
    browser()?._clearPreview?.();
}

export function plainText(html) {
    if (!html) return '';
    const holder = document.createElement('div');
    holder.innerHTML = String(html);
    return (holder.textContent || '').replace(/\s+/g, ' ').trim();
}

export function atlasName(atlasId) {
    return registry()?.getAtlasMetadata(atlasId)?.name || atlasId;
}

export function atlasMapCount(atlasId) {
    return registry()?.getAtlasLayers(atlasId)?.length || 0;
}

/**
 * The atlas selector's order: the index atlas, the current atlas, then the
 * rest - those covering the view first, smallest first, then by name. Atlases
 * outside the view are left out unless Find includes outside the view (the
 * index and current atlases always stay). With a `term`, only the atlases
 * whose name matches, best match first.
 */
export function atlasesForSelector(term = '') {
    const reg = registry();
    if (!reg) return [];
    const current = reg.getCurrentAtlas() || 'index';
    const view = viewBbox();
    const needle = term.toLowerCase();
    const entries = reg.getAllAtlasMetadata().map(([id, meta]) => {
        const inView = !parseBbox(meta?.bbox) || bboxInView(meta.bbox, view);
        const nameRank = needle ? matchRank(meta?.name || id, needle, [id]) : 5;
        return { id, meta, current: id === current, inView, match: nameRank < 5, nameRank, outside: !inView };
    });
    const rank = (e) => (e.id === 'index' ? 0 : e.current ? 1 : 2);
    const sorted = entries
        .filter(e => (needle ? e.match : (rank(e) < 2 || e.inView || isIncludingOutside())))
        .sort((a, b) => (b.match - a.match) || (a.match && a.nameRank - b.nameRank) || (rank(a) - rank(b)) || (b.inView - a.inView) ||
            (a.inView ? bboxArea(a.meta?.bbox) - bboxArea(b.meta?.bbox) : 0) ||
            (a.meta?.name || a.id).localeCompare(b.meta?.name || b.id));
    return { entries: sorted, hidden: needle ? 0 : entries.length - sorted.length };
}

function bboxArea(bbox) {
    const box = parseBbox(bbox);
    return box ? (box[2] - box[0]) * (box[3] - box[1]) : Infinity;
}

/**
 * Switches atlas and, if it lies outside the view, flies to it. Its default
 * maps are judged against the view it opens onto: those outside are left off
 * unless Find includes outside the view.
 */
export function switchAtlas(atlasId) {
    const control = browser();
    if (!control || !atlasId) return;
    clearPreview();
    const meta = registry()?.getAtlasMetadata(atlasId);
    const atlasBox = parseBbox(meta?.bbox);
    const moving = atlasBox && !bboxInView(atlasBox);
    const target = moving ? atlasBox : viewBbox();
    control.switchAtlasLive(atlasId, { viewBbox: isIncludingOutside() ? null : target });
    if (moving) control._handleResetView(meta.map || null, meta.bbox);
}

export function atlasCards(entries, onPick = switchAtlas) {
    const strip = el('div', 'console-atlas-cards');
    entries.forEach(({ id, meta, current, outside }) => {
        const card = el('button', 'console-atlas-card' + (current ? ' current' : ''));
        card.type = 'button';
        card.title = current ? `${meta?.name || id} (current atlas)` : `Switch to ${meta?.name || id}`;
        if (meta?.headerImage) card.style.setProperty('--card-image', `url("${String(meta.headerImage).replace(/"/g, '%22')}")`);
        card.appendChild(el('span', 'console-atlas-card-bg'));
        if (current) card.appendChild(el('span', 'console-atlas-card-tag', 'Current'));
        else if (outside) {
            const tag = el('span', 'console-atlas-card-tag console-atlas-card-outside');
            tag.title = 'Outside this view - picking it zooms to it';
            tag.appendChild(icon('zoom-in'));
            card.appendChild(tag);
        }
        card.appendChild(imageThumb(meta?.icon, 'map'));
        card.appendChild(el('span', 'console-atlas-card-name', meta?.name || id));
        card.appendChild(el('span', 'console-atlas-card-meta', `${atlasMapCount(id)} maps`));
        card.addEventListener('click', () => onPick(id));
        card.addEventListener('mouseenter', () => previewAtlas(id));
        card.addEventListener('mouseleave', clearPreview);
        strip.appendChild(card);
    });
    return strip;
}

export function layerRow(layer, { active = activeIds(), meta = null, outside = false, className = '' } = {}) {
    const on = isLayerActive(layer, active);
    const title = layer.title || layer.name || layer.id;
    const trailing = el('span', 'console-row-actions');
    if (outside) trailing.appendChild(zoomButton({ bbox: layerBbox(layer) }, `${title} is outside this view - zoom to it`));
    trailing.appendChild(eyeButton(on ? 'on' : 'off', () => setLayerActive(layer, !on), on ? `Hide ${title}` : `Show ${title}`));
    return row({
        thumb: layerThumb(layer),
        title,
        meta: meta ?? (plainText(layer.description) || (layer.tags || []).join(' › ')),
        trailing,
        className: [className, outside && 'outside'].filter(Boolean).join(' '),
        onClick: () => openLayerInfo(layer),
        onEnter: () => previewLayer(layer),
        onLeave: clearPreview
    });
}

/** The atlas's maps resolved from its own layer references, in config order. */
export function atlasLayers(atlasId) {
    const control = browser();
    const reg = registry();
    if (!control || !reg) return [];
    return control._getAtlasLayerReferenceIds(atlasId)
        .map(id => {
            const layer = reg._registry.get(id) || reg.getLayer(id, atlasId, true);
            return layer ? { ...layer, _prefixedId: layer._prefixedId || id } : null;
        })
        .filter(Boolean);
}

function titleCase(tag) {
    return String(tag).charAt(0).toUpperCase() + String(tag).slice(1);
}

function buildTree(layers) {
    const root = { children: new Map(), layers: [] };
    layers.forEach(layer => {
        const path = Array.isArray(layer.tags) && layer.tags.length ? layer.tags.map(titleCase) : ['Other'];
        let node = root;
        path.forEach(part => {
            if (!node.children.has(part)) node.children.set(part, { name: part, children: new Map(), layers: [] });
            node = node.children.get(part);
        });
        node.layers.push(layer);
    });
    return root;
}

function nodeLayers(node) {
    return [...node.layers, ...[...node.children.values()].flatMap(nodeLayers)];
}

/**
 * The atlas's maps as a collapsible theme tree. `expanded` is the caller's
 * Set of open paths, kept across re-renders; on first sight of an atlas the
 * themes holding a visible map are opened for it.
 */
export function mapsTree(atlasId, expanded, seeded, { layers = atlasLayers(atlasId), outside = new Set(), empty = 'This atlas has no maps of its own yet.' } = {}) {
    const holder = el('div', 'console-tree');
    if (!layers.length) {
        holder.appendChild(hint(empty));
        return holder;
    }
    const active = activeIds();
    const tree = buildTree(layers);
    if (!seeded.has(atlasId)) {
        seeded.add(atlasId);
        tree.children.forEach((node, name) => {
            if (nodeLayers(node).some(l => isLayerActive(l, active))) expanded.add(`${atlasId}/${name}`);
        });
    }
    const rerender = () => holder.replaceWith(mapsTree(atlasId, expanded, seeded, { layers, outside, empty }));
    renderNode(tree, [], 0);
    return holder;

    function renderNode(node, path, depth) {
        [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(child => {
            const childPath = [...path, child.name];
            const key = `${atlasId}/${childPath.join('/')}`;
            const all = nodeLayers(child);
            const onCount = all.filter(l => isLayerActive(l, active)).length;
            const open = expanded.has(key);
            const state = onCount === 0 ? 'off' : (onCount === all.length ? 'on' : 'part');
            const toggleGroup = () => {
                const target = onCount === 0;
                all.forEach(l => { if (isLayerActive(l, active) !== target) setLayerActive(l, target); });
            };
            const chev = icon('chevron-right');
            chev.classList.add('console-tree-chevron');
            if (open) chev.classList.add('open');
            const header = row({
                thumb: chev,
                title: child.name,
                trailing: eyeButton(state, toggleGroup, onCount ? `Hide the ${onCount} visible maps in ${child.name}` : `Show all maps in ${child.name}`),
                className: 'console-tree-node',
                onClick: () => {
                    if (open) expanded.delete(key);
                    else expanded.add(key);
                    rerender();
                }
            });
            header.style.setProperty('--depth', depth);
            header.querySelector('.console-row-text').appendChild(el('span', 'console-count', `${onCount} of ${all.length}`));
            holder.appendChild(header);
            if (!open) return;
            child.layers.forEach(layer => {
                const item = layerRow(layer, { active, outside: outside.has(layer), className: 'console-tree-leaf' });
                item.style.setProperty('--depth', depth + 1);
                holder.appendChild(item);
            });
            renderNode(child, childPath, depth + 1);
        });
    }
}

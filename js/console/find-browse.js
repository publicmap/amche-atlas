/**
 * What Find shows before anything is typed: the atlases that cover the view
 * and the current atlas's maps grouped by theme (their `tags`). Also the
 * layer/atlas actions every Find list shares - toggling a map, opening its
 * details, previewing its extent - which all go through MapBrowserControl so
 * Find behaves exactly as the old map browser panel did.
 */
import { el, icon, row, eyeButton, layerThumb, imageThumb, hint } from './find-rows.js';

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

// getBounds() can throw mid camera transition with terrain on (an unprojectable
// corner); Find then just ranks atlases without the view this time.
function viewBbox() {
    try {
        const bounds = window.map?.getBounds?.();
        return bounds ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] : null;
    } catch (error) {
        return null;
    }
}

function bboxInView(bbox, view = viewBbox()) {
    if (!Array.isArray(bbox) || bbox.length !== 4 || !view) return false;
    return bbox[0] <= view[2] && bbox[2] >= view[0] && bbox[1] <= view[3] && bbox[3] >= view[1];
}

function bboxArea(bbox) {
    return Array.isArray(bbox) && bbox.length === 4 ? (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) : Infinity;
}

/** Current atlas first, then atlases covering the view (smallest first), then the rest by name. */
export function atlasesByRelevance() {
    const reg = registry();
    if (!reg) return [];
    const current = reg.getCurrentAtlas();
    const view = viewBbox();
    return reg.getAllAtlasMetadata()
        .map(([id, meta]) => ({ id, meta, current: id === current, inView: bboxInView(meta?.bbox, view) }))
        .sort((a, b) => (b.current - a.current) || (b.inView - a.inView) ||
            (a.inView ? bboxArea(a.meta?.bbox) - bboxArea(b.meta?.bbox) : 0) ||
            (a.meta?.name || a.id).localeCompare(b.meta?.name || b.id));
}

export function switchAtlas(atlasId) {
    const control = browser();
    if (!control || !atlasId) return;
    clearPreview();
    control.switchAtlasLive(atlasId);
    const meta = registry()?.getAtlasMetadata(atlasId);
    if (meta?.bbox && !bboxInView(meta.bbox)) control._handleResetView(meta.map || null, meta.bbox);
}

export function atlasCards(entries, onPick = switchAtlas) {
    const strip = el('div', 'console-atlas-cards');
    entries.forEach(({ id, meta, current, inView }) => {
        const card = el('button', 'console-atlas-card' + (current ? ' current' : ''));
        card.type = 'button';
        card.title = current ? `${meta?.name || id} (current atlas)` : `Switch to ${meta?.name || id}`;
        if (meta?.headerImage) card.style.setProperty('--card-image', `url("${String(meta.headerImage).replace(/"/g, '%22')}")`);
        if (current) card.appendChild(el('span', 'console-atlas-card-tag', 'Current'));
        card.appendChild(imageThumb(meta?.icon, 'map'));
        card.appendChild(el('span', 'console-atlas-card-name', meta?.name || id));
        card.appendChild(el('span', 'console-atlas-card-meta', `${atlasMapCount(id)} maps${inView && !current ? ' · in view' : ''}`));
        card.addEventListener('click', () => onPick(id));
        card.addEventListener('mouseenter', () => previewAtlas(id));
        card.addEventListener('mouseleave', clearPreview);
        strip.appendChild(card);
    });
    return strip;
}

export function atlasRow({ id, meta, current, inView }, onPick = switchAtlas) {
    const where = current ? 'Current atlas' : (inView ? 'Covers this view' : '');
    return row({
        thumb: imageThumb(meta?.icon, 'map'),
        title: meta?.name || id,
        meta: [`${atlasMapCount(id)} maps`, where].filter(Boolean).join(' · '),
        trailing: current ? el('span', 'console-tag', 'Current') : icon('chevron-right'),
        className: current ? 'current' : '',
        onClick: () => onPick(id),
        onEnter: () => previewAtlas(id),
        onLeave: clearPreview
    });
}

/**
 * The current atlas at the head of Find: its name, description and how many
 * of its maps are on, so a picked atlas opens onto what it holds.
 */
export function atlasHeader(atlasId) {
    const meta = registry()?.getAtlasMetadata(atlasId) || {};
    const layers = atlasLayers(atlasId);
    const active = activeIds();
    const onCount = layers.filter(layer => isLayerActive(layer, active)).length;
    const header = el('div', 'console-atlas-header');
    if (meta.headerImage) header.style.setProperty('--card-image', `url("${String(meta.headerImage).replace(/"/g, '%22')}")`);
    const top = el('div', 'console-atlas-header-top');
    top.append(imageThumb(meta.icon, 'map'), el('div', 'console-atlas-header-name', meta.name || atlasId));
    header.appendChild(top);
    const description = plainText(meta.description);
    if (description) header.appendChild(el('div', 'console-atlas-header-desc', description));
    header.appendChild(el('div', 'console-atlas-header-meta', `${layers.length} maps · ${onCount} on the map`));
    return header;
}

export function layerRow(layer, { active = activeIds(), meta = null } = {}) {
    const on = isLayerActive(layer, active);
    const title = layer.title || layer.name || layer.id;
    return row({
        thumb: layerThumb(layer),
        title,
        meta: meta ?? (plainText(layer.description) || (layer.tags || []).join(' › ')),
        trailing: eyeButton(on ? 'on' : 'off', () => setLayerActive(layer, !on), on ? `Hide ${title}` : `Show ${title}`),
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
export function mapsTree(atlasId, expanded, seeded) {
    const layers = atlasLayers(atlasId);
    const holder = el('div', 'console-tree');
    if (!layers.length) {
        holder.appendChild(hint('This atlas has no maps of its own yet.'));
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
    const rerender = () => holder.replaceWith(mapsTree(atlasId, expanded, seeded));
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
                const item = layerRow(layer, { active });
                item.classList.add('console-tree-leaf');
                item.style.setProperty('--depth', depth + 1);
                holder.appendChild(item);
            });
            renderNode(child, childPath, depth + 1);
        });
    }
}

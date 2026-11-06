/**
 * Find's atlas view (js/console/find-panel.js): the atlas selector - index,
 * current, then the rest, matches for a query leading - and the current
 * atlas's maps. Also the
 * layer/atlas actions every Find list shares - toggling a map, opening its
 * details, previewing its extent - which all go through MapBrowserControl so
 * Find behaves exactly as the old map browser panel did.
 */
import { el, row, eyeButton, setEyeState, layerThumb } from './find-rows.js';
import { pendingState, setPending, eyeKey, trackEye, isLayerLoading } from './layer-loading.js';
import { matchRank } from './find-rank.js';
import { viewBbox, bboxInView, parseBbox, isIncludingOutside, bboxDistance } from './find-scope.js';
import { layerZoomButton } from './layer-zoom.js';

const browser = () => window.browserControl;
const registry = () => window.layerRegistry;

export function activeIds() {
    return browser()?._getActiveLayers?.() || new Set();
}

export function isLayerActive(layer, active = activeIds()) {
    const asked = pendingState(layer);
    if (asked !== undefined) return asked;
    return active.has(layer._prefixedId) || active.has(layer.id);
}

/** Shows the new state on the layer's eyes at once, before the map catches up. */
export function setLayerActive(layer, on) {
    setPending(layer, on);
    const title = layer.title || layer.name || layer.id;
    document.querySelectorAll(`.console-eye[data-layer-key="${CSS.escape(eyeKey(layer))}"]`).forEach(button => {
        setEyeState(button, on ? 'on' : 'off', on ? `Hide ${title}` : `Show ${title}`);
        button.classList.toggle('loading', on);
    });
    browser()?._handleLayerToggle(layer._prefixedId || layer.id, on);
}

/** A layer's eye: toggles it from whatever it shows now, spinning while it loads. */
export function layerEye(layer, { active = activeIds(), on = isLayerActive(layer, active) } = {}) {
    const title = layer.title || layer.name || layer.id;
    const button = eyeButton(on ? 'on' : 'off', () => setLayerActive(layer, !button.classList.contains('on')), on ? `Hide ${title}` : `Show ${title}`);
    trackEye(button, layer);
    if (on && isLayerLoading(layer)) button.classList.add('loading');
    return button;
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
 * The atlas selector's order, which follows the map and not the choice of
 * atlas: the index atlas, then those covering the view, smallest first, then
 * those outside it, nearest first. Atlases outside the view are left out
 * unless Find includes outside the view or `all` is asked for (the current
 * atlas always stays). With a `term`, only the atlases whose name matches,
 * best match first.
 */
export function atlasesForSelector(term = '', { all = false } = {}) {
    const reg = registry();
    if (!reg) return [];
    const current = reg.getCurrentAtlas() || 'index';
    const view = viewBbox();
    const needle = term.toLowerCase();
    const entries = reg.getAllAtlasMetadata().map(([id, meta]) => {
        const inView = !parseBbox(meta?.bbox) || bboxInView(meta.bbox, view);
        const nameRank = needle ? matchRank(meta?.name || id, needle, [id]) : 5;
        const away = inView ? 0 : (bboxDistance(meta.bbox)?.km ?? Infinity);
        return { id, meta, current: id === current, inView, match: nameRank < 5, nameRank, outside: !inView, away };
    });
    const isIndex = (e) => (e.id === 'index' ? 0 : 1);
    const sorted = entries
        .filter(e => (needle ? e.match : (e.current || e.id === 'index' || e.inView || all || isIncludingOutside())))
        .sort((a, b) => (b.match - a.match) || (a.match && a.nameRank - b.nameRank) || (isIndex(a) - isIndex(b)) || (b.inView - a.inView) ||
            (a.inView ? bboxArea(a.meta?.bbox) - bboxArea(b.meta?.bbox) : a.away - b.away) ||
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

/**
 * The one row every map list in Find uses: thumbnail, title over meta, then
 * zoom (which flies back on a second click) and the show/hide eye. The on-map
 * list passes its own thumbnail and hover (isolating the layer on the map).
 */
export function layerRow(layer, { active = activeIds(), on, meta = null, outside = false, className = '', thumb = null, onEnter = null, onLeave = null } = {}) {
    const title = layer.title || layer.name || layer.id;
    const trailing = el('span', 'console-row-actions');
    trailing.append(layerZoomButton(layer, { outside }), layerEye(layer, on === undefined ? { active } : { active, on }));
    return row({
        thumb: thumb || layerThumb(layer),
        title,
        meta: meta ?? (plainText(layer.description) || (layer.tags || []).join(' › ')),
        trailing,
        className: [className, outside && 'outside'].filter(Boolean).join(' '),
        onClick: () => openLayerInfo(layer),
        onEnter: onEnter || (() => previewLayer(layer)),
        onLeave: onLeave || clearPreview
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

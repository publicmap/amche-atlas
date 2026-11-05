/**
 * Find's Features section (js/console/find-panel.js): individual features
 * across every map on the map, under their maps. Features kept in the link -
 * the ones saved pins stand on (`?markers=`) - lead; the rest drawn in the
 * view follow under "more". Opening a plain link, with no atlas, maps or pins
 * of its own, lists everything at once instead.
 */
import { matchRank } from './find-rank.js';

const VIEW_LIMIT = 200;

const stateManager = () => window.featureControl?._stateManager || null;
const markerManager = () => window.featureControl?._markerManager || null;

/** Whether the link names an atlas, maps or pins - what the user came to see. */
export function urlHasFocus() {
    const params = new URLSearchParams(window.location.search);
    return ['atlas', 'layers', 'markers', 'selected'].some(key => params.get(key));
}

function label(selection) {
    const config = stateManager()?.getLayerConfig(selection.layerId);
    const inspect = config?.inspect || {};
    const field = inspect.label || inspect.id || 'id';
    const props = selection.feature?.properties || {};
    return String(props[field] ?? props.name ?? props.title ?? selection.feature?.id ?? 'Feature').trim();
}

function keyOf(selection) {
    const manager = stateManager();
    const id = manager?._getFeatureId?.(selection.feature) ?? JSON.stringify(selection.feature?.properties || {});
    return `${selection.layerId}|${id}`;
}

function toItem(selection, saved) {
    return { mapFeature: selection, saved, properties: { name: label(selection) } };
}

export function savedFeatureItems() {
    const markers = markerManager()?._markers;
    if (!markers) return [];
    const items = [];
    markers.forEach(marker => {
        if (!marker.saved) return;
        (marker.features || []).forEach(selection => {
            if (selection?.feature && selection.layerId) items.push(toItem({ ...selection, lngLat: selection.lngLat || marker.lngLat }, true));
        });
    });
    return items;
}

function viewFeatureItems() {
    try {
        return (stateManager()?.getFeaturesInView?.() || []).slice(0, VIEW_LIMIT).map(selection => toItem(selection, false));
    } catch (error) {
        return [];
    }
}

function groupByLayer(items, layerOf) {
    const groups = new Map();
    items.forEach(item => {
        const id = item.mapFeature.layerId;
        if (!groups.has(id)) groups.set(id, { layer: layerOf(id) || { id, title: id }, features: [] });
        groups.get(id).features.push(item);
    });
    return [...groups.values()];
}

/**
 * @returns {{saved: Array, more: Array, savedCount: number, moreCount: number, showAll: boolean}}
 *   saved / more are `{layer, features}` groups
 */
export function featureResults(term, layerOf) {
    const needle = (term || '').toLowerCase();
    const seen = new Set();
    const unique = (items) => items.filter(item => {
        const key = keyOf(item.mapFeature);
        if (seen.has(key) || !item.properties.name) return false;
        seen.add(key);
        return !needle || item.properties.name.toLowerCase().includes(needle);
    });
    const rank = (items) => needle ? items.sort((a, b) => matchRank(a.properties.name, needle) - matchRank(b.properties.name, needle)) : items;
    const saved = rank(unique(savedFeatureItems()));
    const rest = rank(unique(viewFeatureItems()));
    const showAll = !urlHasFocus();
    return {
        saved: groupByLayer(showAll ? [...saved, ...rest] : saved, layerOf),
        more: showAll ? [] : groupByLayer(rest, layerOf),
        savedCount: saved.length,
        moreCount: rest.length,
        showAll
    };
}

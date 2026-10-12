/**
 * The layer editor's read-only notes on a layer: its legend and metadata. The
 * description, attribution and configuration are editable in their own sections.
 */

import { LayerLegend } from './layer-legend.js';

function formatBbox(bbox) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return String(bbox);
    return `[${bbox.map(n => n.toFixed(4)).join(', ')}]`;
}

function infoItem(key, value) {
    const $item = $('<div>', { class: 'bg-gray-900 rounded-lg p-3' });
    $item.append($('<div>', { class: 'text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1', text: key }));
    $item.append($('<div>', { class: 'text-sm text-gray-200', text: value }));
    return $item;
}

/** Fill the legend and metadata from a layer config. */
export function renderOverview(layer) {
    $('#lo-legend-content, #lo-metadata-content').empty();

    const legend = LayerLegend.generate(layer);
    $('#lo-legend-section').toggle(!!legend);
    if (legend) $('#lo-legend-content').append(legend);

    const metadata = {};
    if (layer.bbox) metadata['Bounding Box'] = formatBbox(layer.bbox);
    if (layer.tags && Array.isArray(layer.tags)) metadata['Tags'] = layer.tags.join(', ');
    if (layer._sourceAtlas) metadata['Source Atlas'] = layer._sourceAtlas;
    if (layer.opacity !== undefined) metadata['Opacity'] = `${Math.round(layer.opacity * 100)}%`;
    $('#lo-metadata-section').toggle(Object.keys(metadata).length > 0);
    Object.entries(metadata).forEach(([key, value]) => $('#lo-metadata-content').append(infoItem(key, value)));
}

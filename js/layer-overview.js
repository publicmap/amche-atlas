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
    const $item = $('<div>', { class: 'py-1' });
    $item.append($('<div>', { class: 'text-xs text-gray-500 mb-0.5', text: key }));
    $item.append($('<div>', { class: 'text-sm text-gray-200', text: value }));
    return $item;
}

/** Fill the legend and metadata from a layer config. */
export function renderOverview(layer, { onLegendSelect, onLegendPreview } = {}) {
    $('#lo-legend-content, #lo-metadata-content').empty();

    const legend = LayerLegend.generate(layer, { onSelect: onLegendSelect, onPreview: onLegendPreview });
    $('#lo-legend-section').toggle(!!legend);
    if (legend) $('#lo-legend-content').append(legend);

    const metadata = {};
    $('#data-bbox-value').text(layer.bbox ? formatBbox(layer.bbox) : 'none');
    if (layer.tags && Array.isArray(layer.tags)) metadata['Tags'] = layer.tags.join(', ');
    if (layer._sourceAtlas) metadata['Source Atlas'] = layer._sourceAtlas;
    if (layer.opacity !== undefined) metadata['Opacity'] = `${Math.round(layer.opacity * 100)}%`;
    $('#lo-metadata-section').toggle(Object.keys(metadata).length > 0);
    Object.entries(metadata).forEach(([key, value]) => $('#lo-metadata-content').append(infoItem(key, value)));
}

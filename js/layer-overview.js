/**
 * The layer editor's Overview tab: what a layer is, as it stands - its
 * description, attribution, legend, metadata and raw configuration. Read-only;
 * changing any of it is the Edit tab.
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

function displayConfig(layer) {
    const filtered = { ...layer };
    delete filtered._originalJson;
    return JSON.stringify(filtered, null, 2);
}

/** Fill the Overview tab from a layer config. */
export function renderOverview(layer) {
    $('#lo-description-content, #lo-legend-content, #lo-metadata-content, #lo-attribution-content').empty();

    $('#lo-description-content').html(layer.description || '<span class="text-gray-500">No description.</span>');

    $('#lo-attribution-section').toggle(!!layer.attribution);
    if (layer.attribution) $('#lo-attribution-content').html(layer.attribution);

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

    $('#lo-config-content').text(displayConfig(layer));
}

export function bindOverview() {
    $('#lo-config-copy').on('click', () => {
        navigator.clipboard.writeText($('#lo-config-content').text()).then(() => {
            const $label = $('#lo-config-copy span');
            $label.text('Copied!');
            setTimeout(() => $label.text('Copy'), 2000);
        }).catch(err => console.error('Failed to copy configuration:', err));
    });
}

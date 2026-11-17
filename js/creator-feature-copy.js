/**
 * "Make an editable copy" in the layer editor's Features section
 * (js/creator-features.js), for a layer whose data is read from a link and so
 * can't be edited in place.
 *
 * A new layer simply takes the loaded data instead of the link. An existing
 * layer stays as it was: the copy - its settings and style, with the loaded
 * features as its own data - is added beside it and opened for editing (see
 * MapBrowserControl._duplicateCreatorLayer).
 */

import { SOURCE_KEYS } from './creator-edit-mode.js';
import { LayerConfigGenerator } from './layer-creator-ui.js';
import { mapWindow } from './layer-customizations.js';

export const COPY_SOURCE = 'copy';

function uniqueId(base) {
    const host = mapWindow();
    const taken = (id) => !!host.layerControl?._state?.groups?.some(group => group.id === id) ||
        !!host.layerRegistry?.getLayer?.(id, null, true);
    let id = base;
    for (let n = 2; taken(id); n++) id = `${base}-${n}`;
    return id;
}

/** The copy's config: everything but the source, under a new id and title. */
export function copyConfig(config, id) {
    const copy = {};
    Object.keys(config || {}).forEach(key => {
        if (!SOURCE_KEYS.has(key) && !key.startsWith('_')) copy[key] = config[key];
    });
    copy.type = 'geojson';
    copy.id = id;
    copy.title = `${config?.title || config?.id || 'Layer'} (copy)`;
    return copy;
}

/** @param {import('./creator-features.js').CreatorFeatures} features */
export async function makeEditableCopy(features) {
    const creator = features.creator;
    const collection = features.collection;
    if (!collection) return;
    const geojson = JSON.parse(JSON.stringify(collection));
    $('#url-input').val('');
    $('#clear-url-btn').addClass('hidden');

    if (!creator.layerPage.active) {
        creator.service.reset();
        creator.processGeoJSON(geojson, COPY_SOURCE);
        return;
    }

    const config = creator.layerPage._parsedConfig() || creator.layerPage.layer || {};
    const copy = copyConfig(config, uniqueId(`${config.id || 'layer'}-copy`));
    features.attachData(copy, geojson);
    try {
        await LayerConfigGenerator.storeGeoJSONData(copy.id, geojson);
    } catch (error) {
        if (copy.dataSource === 'localStorage') {
            alert('This layer\'s data is too large to copy into this browser.');
            return;
        }
    }
    features.setDrawing(false);
    creator.edit.stop();
    window.parent.postMessage({ type: 'creator-duplicate-layer', config: copy }, '*');
}

/**
 * The layer's Shareable option in the layer editor (map-creator.html, beside the
 * layer's title; see js/creator-steps.js).
 *
 * A layer read from a link is always shareable: the map link carries that link
 * and the layer's settings. For a layer whose data the editor holds (drawn,
 * uploaded, copied), Shareable (the default) puts its features in the map link
 * as `data` in its `?layers=` entry (docs/API.md "Shareable layers"), as well
 * as in this browser. Off, or when the link would pass what browsers and
 * servers accept (js/layer-customizations.js), the layer reads them from this
 * browser only (`dataSource: "localStorage"`); the checkbox is then disabled
 * and its tooltip says why.
 */

import { compactCollection, inlineSize } from './feature-table-data.js';
import { urlUsage, URL_MAX_LENGTH } from './layer-customizations.js';

// Data this large is never going to fit in a link; skip measuring it.
const RAW_SIZE_LIMIT = 200000;
const TIP = 'This layer\'s features ride in the map link, so anyone you share it with sees them. They are also kept in this browser.';
const LINKED_TIP = 'Anyone with the map link sees this layer: the link carries where its data comes from and its settings.';
const LOCAL_TIP = 'This layer\'s features are kept in this browser only. Edit the layer to put them in the map link.';
const TOO_LARGE_TIP = 'This layer\'s features are too large for the map link, so they are kept in this browser only.';

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/**
 * Link length with a layer's entry replaced by one carrying `data`.
 * @returns {number} Infinity when the data is too large to measure
 */
export function linkLengthWith(config, collection, usage) {
    if (JSON.stringify(collection || {}).length > RAW_SIZE_LIMIT) return Infinity;
    const data = compactCollection(collection);
    const own = usage?.entries?.find(entry => entry.id === config.id)?.size || 0;
    return (usage?.length || 0) - own + inlineSize({ ...config, data }) + 1;
}

export class FeatureShare {
    constructor({ onChange }) {
        this.onChange = onChange;
        this.shareable = true;
        this.canShare = true;
        this.note = '';
    }

    init() {
        $('#layer-shareable').on('change', (event) => {
            this.shareable = event.target.checked;
            this.onChange();
        });
    }

    set(on) {
        this.shareable = on;
    }

    /** Put the data on a layer config: inline when shareable and it fits the link, else in this browser. */
    attach(config, collection) {
        delete config.data;
        delete config.geojson;
        delete config.dataSource;
        delete config.shareable;
        let usage = null;
        try {
            usage = urlUsage();
        } catch {
            // No map page to measure against
        }
        const total = linkLengthWith(config, collection, usage);
        const count = collection?.features?.length || 0;
        this.canShare = total <= URL_MAX_LENGTH;
        const size = Number.isFinite(total) ? `about ${total.toLocaleString()}` : 'far more than';
        this.note = `Too large for the map link: with ${plural(count, 'feature')} it would be ${size} characters, over the ${URL_MAX_LENGTH.toLocaleString()} that browsers and servers accept. The features are kept in this browser only.`;

        if (this.shareable && this.canShare) config.data = compactCollection(collection);
        else config.dataSource = 'localStorage';
        if (!this.shareable) config.shareable = false;
        return config;
    }

    /**
     * @param {Object} config - the layer as it stands (or as edited so far)
     * @param {{editing: boolean, holdsData: boolean}} state - whether it is being edited, and holds its own data
     */
    render(config, { editing, holdsData }) {
        const local = holdsData || (!config.url && (config.data !== undefined || config.dataSource === 'localStorage'));
        let checked = true;
        let disabled = true;
        let tip = LINKED_TIP;
        if (local && editing) {
            checked = this.shareable && this.canShare;
            disabled = !this.canShare;
            tip = this.canShare ? TIP : this.note;
        } else if (local) {
            checked = config.data !== undefined;
            tip = checked ? TIP : config.shareable === false ? LOCAL_TIP : TOO_LARGE_TIP;
        }
        $('#layer-shareable').prop('checked', checked).prop('disabled', disabled);
        $('#layer-share-tip').attr('content', tip);
        $('#layer-share-note').text(local && !checked ? 'Only in this browser' : '');
    }
}

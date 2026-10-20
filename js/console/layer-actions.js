/**
 * The action grid on a map's details page (js/console/layer-details.js): zoom,
 * show only, compare, mask, export and edit. Everything but Edit acts on the
 * live map through the window messages MapFeatureControl already handles
 * (the same ones the layer editor's header, js/layer-header.js, posts), so
 * actions that need the map on it are disabled while it is off.
 */
import { el, icon } from './find-rows.js';
import { LayerOrderManager } from '../layer-order-manager.js';
import { ZoomToParam } from '../zoom-to-param.js';

const EXPORT_FORMATS = [['geojson', 'GeoJSON'], ['kml', 'KML'], ['csv', 'GeoCSV']];
const post = (message) => window.postMessage(message, '*');

function actionButton(iconName, label, onClick, { pressed = false, disabled = false, title = label } = {}) {
    const button = el('button', 'console-action' + (pressed ? ' pressed' : ''));
    button.type = 'button';
    button.title = title;
    button.disabled = disabled;
    button.setAttribute('aria-pressed', String(pressed));
    button.append(icon(iconName), el('span', '', label));
    button.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onClick(e);
    });
    return button;
}

export class LayerActions {
    /** @param {{onChange: () => void}} options - redraw the page after an action */
    constructor({ onChange } = {}) {
        this._onChange = onChange || (() => {});
        this._isolated = false;
        this._exporting = null;
        this._onExportProgress = (e) => this._exportProgress(e.detail || {});
    }

    /** Undo what only lasts while the page is open: Show only. */
    release() {
        if (this._isolated) window.layerControl?.isolation?.clear();
        this._isolated = false;
    }

    render(live, on) {
        const grid = el('div', 'console-actions');
        const offTitle = 'Put the map on the map first';
        const isBasemap = LayerOrderManager.isBasemap(live);
        const comparing = window.featureControl?._compareLayerId === live.id;
        const masking = window.maskManager?.getMaskSourceLayerId?.() === live.id;

        const zoom = actionButton('arrows-fullscreen', 'Zoom to', () => post({ type: 'zoom-to-layer', layerId: live.id }));
        const zoomLink = el('a', 'console-action-link');
        zoomLink.href = ZoomToParam.buildUrl(live.id);
        zoomLink.appendChild(zoom);
        grid.appendChild(zoomLink);

        grid.appendChild(actionButton('bullseye', this._isolated ? 'Showing only' : 'Show only', () => {
            const isolation = window.layerControl?.isolation;
            if (!isolation) return;
            if (this._isolated) isolation.clear();
            else isolation.isolate(live.id, isBasemap);
            this._isolated = !this._isolated;
            this._onChange();
        }, { pressed: this._isolated, disabled: !on, title: on ? 'Dim every other map' : offTitle }));

        grid.appendChild(actionButton('layout-split', comparing ? 'Comparing' : 'Compare', () => {
            post({ type: 'toggle-compare', layerId: live.id, enabled: !comparing });
            setTimeout(() => this._onChange(), 600);
        }, { pressed: comparing, disabled: !on, title: on ? 'Swipe between this map and the rest' : offTitle }));

        grid.appendChild(actionButton('mask', masking ? 'Masking' : 'Mask', () => {
            post({ type: 'toggle-mask', layerId: live.id, enabled: !masking });
            setTimeout(() => this._onChange(), 600);
        }, { pressed: masking, disabled: !on, title: on ? 'Mask the map to this layer\'s shapes' : offTitle }));

        grid.appendChild(this._exportMenu(live, on, offTitle));

        grid.appendChild(actionButton('pencil', 'Edit', () => {
            window.browserControl?.openLayerEditor(live, { tab: 'edit' });
        }, { title: 'Edit the data source, style and details' }));
        return grid;
    }

    _exportMenu(live, on, offTitle) {
        const dropdown = document.createElement('sl-dropdown');
        dropdown.className = 'console-action-menu';
        dropdown.hoist = true;
        const trigger = actionButton('download', this._exporting ? this._exporting.text : 'Export', () => {}, {
            disabled: !on || !!this._exporting, title: on ? 'Download the features of this map' : offTitle
        });
        trigger.slot = 'trigger';
        const menu = document.createElement('sl-menu');
        EXPORT_FORMATS.forEach(([value, label]) => {
            const item = document.createElement('sl-menu-item');
            item.value = value;
            item.textContent = label;
            menu.appendChild(item);
        });
        menu.addEventListener('sl-select', (e) => this._export(live, e.detail.item?.value));
        dropdown.append(trigger, menu);
        return dropdown;
    }

    _export(live, format) {
        if (!format || this._exporting) return;
        this._exporting = { text: 'Preparing…' };
        window.addEventListener('map-export-progress', this._onExportProgress);
        post({ type: 'export-layer', format, layerId: live.id, feature: null });
        this._onChange();
    }

    _exportProgress({ percent = 0, message = '' }) {
        if (!this._exporting) return;
        const done = percent >= 100 || percent < 0;
        this._exporting.text = percent < 0 ? 'Export failed' : (percent >= 100 ? 'Exported' : `${Math.round(percent)}% ${message}`.trim());
        this._onChange();
        if (!done) return;
        window.removeEventListener('map-export-progress', this._onExportProgress);
        setTimeout(() => { this._exporting = null; this._onChange(); }, 1500);
    }
}

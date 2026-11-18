/**
 * The header of Find's Active Maps (js/console/find-panel.js), the standard
 * section header (sectionHeader, js/console/find-rows.js): "Active Maps (n)"
 * and, while the section is hovered, actions on all its maps - Starred and
 * In view (ShowLinks, js/console/active-maps.js), zoom to the maps on the
 * map, hover tooltips, remove the maps that are off from the list - then the
 * eye over all their eyes.
 */
import { sectionHeader, sectionAction, setActionTitle, setSectionCount } from './find-rows.js';
import { layersGroupEye, syncLayersGroupEye } from './find-browse.js';
import { parseBbox } from './find-scope.js';
import { ShowLinks } from './active-maps.js';
import { LayerOrderManager } from '../layer-order-manager.js';
import { activeMapHistory } from '../active-map-history.js';

const ZOOM_PADDING = 60;

export class ActiveMapsHeader {
    constructor() {
        this._rows = [];
        this._links = new ShowLinks();
        this._zoom = sectionAction('arrows-fullscreen', 'Zoom to the maps on the map', () => this._zoomToMaps());
        this._hover = sectionAction('hand-index-thumb', '', () => this._toggleHover());
        this._forget = sectionAction('trash', '', () => this._forgetOff());
        this._forget.classList.add('console-danger');
        this._eye = layersGroupEye(() => this._rows.map(row => row.layer), 'every map in this list');
        this.el = sectionHeader({
            label: 'Active Maps',
            actions: [...this._links.buttons, this._zoom, this._hover, this._forget],
            eye: this._eye
        });
    }

    /** How many maps the list holds, on or off. */
    get count() {
        return this._rows.length;
    }

    /** @param {Array<{layer: Object, on: boolean}>} rows - the list's maps (js/layer-stack-strip.js) */
    setRows(rows) {
        this._rows = rows;
        this.sync(this._atlasId);
    }

    sync(atlasId) {
        this._atlasId = atlasId;
        if (atlasId) this._links.sync(atlasId);
        setSectionCount(this.el, this._rows.length);
        syncLayersGroupEye(this._eye, this._rows.map(row => row.layer));

        const hover = window.featureControl?.isHoverEnabled?.() ?? false;
        this._hover.classList.toggle('on', hover);
        this._hover.querySelector('sl-icon').name = hover ? 'hand-index-thumb-fill' : 'hand-index-thumb';
        setActionTitle(this._hover, hover ? 'Hover tooltips are on - turn them off' : 'Show a tooltip for the features under the pointer');

        const off = this._rows.filter(row => !row.on).length;
        this._forget.hidden = !off;
        setActionTitle(this._forget, `Remove the ${off === 1 ? 'map' : `${off} maps`} that ${off === 1 ? 'is' : 'are'} off from this list`);
        this._zoom.hidden = !this._rows.some(row => row.on);
    }

    _toggleHover() {
        const control = window.featureControl;
        control?.setHoverEnabled?.(!(control.isHoverEnabled?.() ?? false));
        this.sync(this._atlasId);
    }

    _forgetOff() {
        const atlasId = window.layerRegistry?.getCurrentAtlas?.() || 'index';
        this._rows.filter(row => !row.on).forEach(row => activeMapHistory.remove(atlasId, row.layer.id));
    }

    _zoomToMaps() {
        const registry = window.layerRegistry;
        let bounds = null;
        this._rows.forEach(({ layer, on }) => {
            if (!on || LayerOrderManager.isBasemap(layer)) return;
            const bbox = parseBbox(layer.bbox || registry?.getAtlasMetadata(layer._sourceAtlas)?.bbox);
            if (!bbox) return;
            bounds = bounds
                ? [Math.min(bounds[0], bbox[0]), Math.min(bounds[1], bbox[1]), Math.max(bounds[2], bbox[2]), Math.max(bounds[3], bbox[3])]
                : bbox;
        });
        if (!bounds) {
            window.layerControl?._showToast?.('No active maps to zoom to', 'info');
            return;
        }
        window.map?.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: ZOOM_PADDING, duration: 1000 });
    }
}

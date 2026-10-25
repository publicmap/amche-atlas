/**
 * The Map view panel: the camera and 3D terrain (js/location-view.js), opened
 * from the 3D status icon on the console's place line and from the terrain
 * control's "Vertical Scale" link. `window.mapViewPanel` is this instance.
 */
import { ConsolePanel } from './console-panel.js';
import { buildViewPanel } from './location-view.js';

export class MapViewPanel extends ConsolePanel {
    constructor() {
        super({ title: 'Map view', icon: 'badge-3d', className: 'map-view-panel' });
    }

    mount(map, options) {
        super.mount(map, options);
        window.mapViewPanel = this;
    }

    unmount() {
        super.unmount();
        if (window.mapViewPanel === this) window.mapViewPanel = null;
    }

    _build(section) {
        this._view = buildViewPanel(section, this._map, { icon: this._headerIcon });
    }

    _refresh() {
        this._view?.refresh();
    }

    _teardown() {
        this._view?.destroy();
        this._view = null;
    }
}

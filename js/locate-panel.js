/**
 * The Locate panel: the device's GPS fix, how the map follows it and its track
 * log (js/location-device.js), opened from the location status icon on the
 * console's place line. Its header's Locate Me button locks the camera onto
 * the device (starting GPS if needed) and says so while it is locked.
 * `window.locatePanel` is this instance.
 */
import { ConsolePanel } from './console-panel.js';
import { buildDevicePanel } from './location-device.js';

export class LocatePanel extends ConsolePanel {
    constructor() {
        super({ title: 'Location', icon: 'crosshair', className: 'locate-panel' });
    }

    mount(map, options) {
        super.mount(map, options);
        window.locatePanel = this;
    }

    unmount() {
        super.unmount();
        if (window.locatePanel === this) window.locatePanel = null;
    }

    _build(section, header) {
        this._locate = document.createElement('button');
        this._locate.type = 'button';
        this._locate.className = 'place-locate-btn';
        this._locate.innerHTML = '<sl-icon name="crosshair"></sl-icon><span></span>';
        this._locate.addEventListener('click', () => {
            window.geolocationControl?.locate();
            this._updateLocate();
        });
        header.appendChild(this._locate);
        this._updateLocate();
        this._device = buildDevicePanel(section, this._map);
    }

    _refresh() {
        this._updateLocate();
        this._device?.refresh();
    }

    _teardown() {
        this._device?.destroy();
        this._device = null;
    }

    _updateLocate() {
        if (!this._locate) return;
        const locked = !!window.geolocationControl?.isLockedToLocation;
        this._locate.classList.toggle('is-on', locked);
        this._locate.querySelector('span').textContent = locked ? 'Tracking' : 'Locate Me';
        this._locate.title = locked ? 'The map is following your location' : 'Centre the map on where you are';
    }
}

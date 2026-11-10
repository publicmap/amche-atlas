/**
 * Feature results in Find (js/console/find-panel.js) and the features on the
 * map share one hover and one selection: pointing at a result hovers its
 * feature through MapFeatureStateManager, as the pointer on the map would,
 * and whatever the map hovers or selects is marked on its result row.
 *
 * A feature row's pin action drops a marker on the feature and opens its
 * label editor with the result's label filled in
 * (MapMarkerManager.pinFeature).
 */
import { row, icon, el, iconThumb, geometryIcon } from './find-rows.js';
import { zoomButton } from './find-scope.js';

const stateManager = () => window.featureControl?._stateManager || null;

function geometryBbox(geometry) {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const walk = (coords) => {
        if (!Array.isArray(coords)) return;
        if (typeof coords[0] === 'number') {
            box[0] = Math.min(box[0], coords[0]);
            box[1] = Math.min(box[1], coords[1]);
            box[2] = Math.max(box[2], coords[0]);
            box[3] = Math.max(box[3], coords[1]);
        } else coords.forEach(walk);
    };
    if (geometry?.type === 'GeometryCollection') geometry.geometries?.forEach(g => walk(g.coordinates));
    else walk(geometry?.coordinates);
    return box.every(Number.isFinite) ? box : null;
}

function zoomTarget(selection) {
    const bbox = geometryBbox(selection?.feature?.geometry);
    const lngLat = selection?.lngLat;
    if (bbox) return { bbox };
    return lngLat ? { lngLat: Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat] } : null;
}

function featureKey(selection) {
    const manager = stateManager();
    if (!manager || !selection?.feature) return null;
    return manager._getCompositeKey(selection.layerId, manager._getFeatureId(selection.feature));
}

export class FeatureSync {
    constructor({ onPin } = {}) {
        this._onPin = onPin;
        this._rows = new Map();
        this._manager = null;
        this._frame = null;
        this._onState = (e) => {
            const type = e.detail?.eventType;
            if (/hover|leave|click|select|clear/.test(type || '')) this._schedulePaint();
        };
    }

    /** Called before each render: forgets the old rows, follows the current manager. */
    reset() {
        this._rows.clear();
        const manager = stateManager();
        if (manager === this._manager) return;
        this._manager?.removeEventListener('state-change', this._onState);
        this._manager = manager;
        this._manager?.addEventListener('state-change', this._onState);
    }

    featureRow(item, { onSelect } = {}) {
        const selection = item.mapFeature;
        const label = item.properties?.name || '';
        const pin = el('button', 'console-row-action');
        pin.type = 'button';
        pin.title = `Save ${label} as a location`;
        pin.setAttribute('aria-label', pin.title);
        pin.appendChild(icon('pin-map'));
        pin.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hover(selection, false);
            this._onPin?.(selection, label);
        });
        const actions = el('span', 'console-row-actions');
        const target = zoomTarget(selection);
        if (target) actions.appendChild(zoomButton(target, `Zoom to ${label}`, { outside: false }));
        actions.appendChild(pin);
        const node = row({
            thumb: iconThumb(geometryIcon(selection?.feature?.geometry)),
            title: label,
            trailing: actions,
            className: 'console-feature-row',
            onClick: () => onSelect?.(item),
            onEnter: () => this.hover(selection, true),
            onLeave: () => this.hover(selection, false)
        });
        const key = featureKey(selection);
        if (key) {
            if (!this._rows.has(key)) this._rows.set(key, []);
            this._rows.get(key).push(node);
        }
        this._paint();
        return node;
    }

    hover(selection, on) {
        const manager = stateManager();
        if (!manager || !selection?.feature) return;
        if (on) manager.handleFeatureHovers([selection], selection.lngLat, true);
        else manager.handleMapMouseLeave(true);
    }

    select(selection) {
        const manager = stateManager();
        if (!manager || !selection?.feature) return;
        manager.handleFeatureClicks([selection]);
    }

    _schedulePaint() {
        if (this._frame) return;
        this._frame = requestAnimationFrame(() => {
            this._frame = null;
            this._paint();
        });
    }

    _paint() {
        const manager = this._manager;
        if (!manager) return;
        this._rows.forEach((nodes, key) => {
            const state = manager._featureStates?.get(key);
            const hovered = !!state?.isHovered;
            const selected = !!manager._selectedFeatures?.has(key);
            nodes.forEach(node => {
                node.classList.toggle('map-hover', hovered);
                node.classList.toggle('selected', selected);
            });
        });
    }

    destroy() {
        cancelAnimationFrame(this._frame);
        this._manager?.removeEventListener('state-change', this._onState);
        this._manager = null;
        this._rows.clear();
    }
}

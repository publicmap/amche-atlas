import { CameraUtils } from './map-camera-utils.js';

const PARAM = 'zoomTo';
const GRACE_MS = 1800;
const attached = new WeakSet();
let graceUntil = 0;

function queryParts(search) {
    return search.replace(/^\?/, '').split('&').filter(p => p && !p.startsWith(`${PARAM}=`));
}

function embedderLocation() {
    try {
        return window.parent.location;
    } catch {
        return window.location;
    }
}

export const ZoomToParam = {
    PARAM,

    buildUrl(layerId, loc = embedderLocation()) {
        const params = queryParts(loc.search);
        params.push(`${PARAM}=${encodeURIComponent(layerId)}`);
        return `${loc.origin}${loc.pathname}?${params.join('&')}`;
    },

    resolveBbox(layerId, registry = window.layerRegistry) {
        const layer = registry?.getLayer?.(layerId, null, true)
            || window.layerControl?._state?.groups?.find(g => g.id === layerId);
        if (!layer) return null;

        const own = CameraUtils.getSyncLayerBbox(layer);
        if (own) return own;

        const atlasBbox = layer._sourceAtlas && registry?.getAtlasMetadata?.(layer._sourceAtlas)?.bbox;
        return Array.isArray(atlasBbox) && atlasBbox.length === 4 ? atlasBbox : null;
    },

    hasParam() {
        return new URLSearchParams(window.location.search).has(PARAM);
    },

    removeParam() {
        if (!this.hasParam()) return;
        const params = queryParts(window.location.search);
        const query = params.length ? `?${params.join('&')}` : '';
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${query}${window.location.hash}`);
    },

    markFit(map) {
        if (!attached.has(map)) {
            attached.add(map);
            map.on('movestart', (e) => {
                if (!this.hasParam()) return;
                if (e.originalEvent || Date.now() > graceUntil) this.removeParam();
            });
        }
        graceUntil = Date.now() + GRACE_MS;
    },

    setParam(map, layerId) {
        if (!map || !layerId) return;
        this.markFit(map);
        const params = queryParts(window.location.search);
        params.push(`${PARAM}=${encodeURIComponent(layerId)}`);
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.join('&')}${window.location.hash}`);
    },

    apply(map, layerId, registry = window.layerRegistry) {
        const bbox = this.resolveBbox(layerId, registry);
        if (!map || !bbox) return false;
        this.markFit(map);
        CameraUtils.fitBounds(map, bbox, { pitch: 0, bearing: 0 });
        return true;
    }
};

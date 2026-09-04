/**
 * NearbyPreviewLayer - the dashed sight line the nearby-features menu (see
 * map-nearby-features-control.js) draws while a destination row is hovered or
 * focused: origin to target as the crow flies over a solid white casing, a dot
 * at each end, labelled with the distance and compass bearing, fitted into
 * view so both ends show. Coloured like the GL user-location disc.
 *
 * It also owns the camera the menu was opened with, so leaving a row - or
 * closing the menu - puts the view back exactly where it was. A row that
 * commits to something (selecting a feature, flying to a marker, drawing a
 * route) keeps the camera it moved to instead: see release().
 *
 * Same getSource/getLayer-guarded add pattern as search/directions-layer.js,
 * and the same halo'd label styling as map-measure-control.js.
 */
const SOURCE_ID = 'amche-nearby-preview';
const CASING_LAYER_ID = 'amche-nearby-preview-casing';
const LINE_LAYER_ID = 'amche-nearby-preview-line';
const POINT_LAYER_ID = 'amche-nearby-preview-points';
const LABEL_LAYER_ID = 'amche-nearby-preview-label';
const EMPTY_DATA = { type: 'FeatureCollection', features: [] };

// The GL user-location disc: #1da1f2 inside a white ring. Reused here so the
// sight line and its target read as the same "you and your bearing" idiom.
const LINE_COLOR = '#1da1f2';
const CASING_COLOR = '#ffffff';

export class NearbyPreviewLayer {
    constructor(map) {
        this._map = map;
        this._savedCamera = null;
    }

    /** Remembers the current camera as the view a preview should return to. */
    captureCamera() {
        if (!this._map) return;
        this._savedCamera = {
            center: this._map.getCenter(),
            zoom: this._map.getZoom(),
            bearing: this._map.getBearing(),
            pitch: this._map.getPitch()
        };
    }

    /** Drops the saved camera, so the view the user was moved to is kept. */
    release() {
        this._savedCamera = null;
    }

    restoreCamera() {
        if (!this._savedCamera || !this._map) return;
        this._map.easeTo({ ...this._savedCamera, duration: 400 });
    }

    /**
     * Draws origin → target and frames both. `label` is the text shown at the
     * midpoint, e.g. "320 m · NE".
     */
    show(from, to, label) {
        if (!this._map) return;
        this._ensureLayers();

        const fromCoord = [from.lng, from.lat];
        const toCoord = [to.lng, to.lat];
        this._map.getSource(SOURCE_ID)?.setData({
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', geometry: { type: 'LineString', coordinates: [fromCoord, toCoord] }, properties: {} },
                { type: 'Feature', geometry: { type: 'Point', coordinates: fromCoord }, properties: {} },
                { type: 'Feature', geometry: { type: 'Point', coordinates: toCoord }, properties: {} },
                {
                    type: 'Feature',
                    // The label rides a midpoint of its own rather than
                    // 'line-center' placement, which drops the text whenever
                    // the line is too short to fit it - exactly the nearby case.
                    geometry: { type: 'Point', coordinates: [(from.lng + to.lng) / 2, (from.lat + to.lat) / 2] },
                    properties: { label }
                }
            ]
        });

        const bounds = new mapboxgl.LngLatBounds().extend(fromCoord).extend(toCoord);
        this._map.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 500 });
    }

    clear() {
        this._map?.getSource(SOURCE_ID)?.setData(EMPTY_DATA);
    }

    remove() {
        if (!this._map) return;
        [LABEL_LAYER_ID, POINT_LAYER_ID, LINE_LAYER_ID, CASING_LAYER_ID].forEach(id => {
            if (this._map.getLayer(id)) this._map.removeLayer(id);
        });
        if (this._map.getSource(SOURCE_ID)) this._map.removeSource(SOURCE_ID);
        this._map = null;
    }

    _ensureLayers() {
        if (!this._map.getSource(SOURCE_ID)) {
            this._map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY_DATA });
        }

        // A solid white casing under the dashes, so the line stays readable over
        // satellite imagery and dark basemaps alike.
        if (!this._map.getLayer(CASING_LAYER_ID)) {
            this._map.addLayer({
                id: CASING_LAYER_ID,
                type: 'line',
                source: SOURCE_ID,
                filter: ['==', ['geometry-type'], 'LineString'],
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': CASING_COLOR,
                    'line-width': 7,
                    'line-opacity': 0.9
                }
            });
        }

        if (!this._map.getLayer(LINE_LAYER_ID)) {
            this._map.addLayer({
                id: LINE_LAYER_ID,
                type: 'line',
                source: SOURCE_ID,
                filter: ['==', ['geometry-type'], 'LineString'],
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': LINE_COLOR,
                    'line-width': 3,
                    'line-opacity': 1,
                    'line-dasharray': [2, 1.5]
                }
            });
        }

        if (!this._map.getLayer(POINT_LAYER_ID)) {
            this._map.addLayer({
                id: POINT_LAYER_ID,
                type: 'circle',
                source: SOURCE_ID,
                filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'label']]],
                paint: {
                    'circle-radius': 6,
                    'circle-color': LINE_COLOR,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': CASING_COLOR
                }
            });
        }

        if (!this._map.getLayer(LABEL_LAYER_ID)) {
            this._map.addLayer({
                id: LABEL_LAYER_ID,
                type: 'symbol',
                source: SOURCE_ID,
                filter: ['has', 'label'],
                layout: {
                    'text-field': ['get', 'label'],
                    'text-font': ['Open Sans Bold'],
                    'text-size': 13,
                    'text-letter-spacing': 0.05,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true
                },
                paint: {
                    'text-color': '#0b4f7a',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2
                }
            });
        }
    }
}

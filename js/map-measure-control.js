/**
 * MeasureControl - draw lines/polygons and measure their length and area.
 *
 * Adapted from https://github.com/jdsantos/maplibre-gl-measures for Mapbox GL JS.
 * Uses the globally loaded MapboxDraw (@mapbox/mapbox-gl-draw) and turf (@turf/turf).
 */

const DRAW_LABELS_SOURCE_ID = 'source-draw-labels';
const DRAW_LABELS_LAYER_ID = 'layer-draw-labels';
const DRAW_NODES_SOURCE_ID = 'source-draw-nodes';
const DRAW_NODES_LAYER_ID = 'layer-draw-nodes';
const EMPTY_DATA = { type: 'FeatureCollection', features: [] };

const lengthUnits = { m: 1, km: 1000, mi: 1609.344, ft: 0.3048 };
const areaUnits = { m2: 1, ha: 10000, km2: 1000000, ac: 4046.8564224, mi2: 2589988.110336, ft2: 0.092903 };

export class MeasureControl {
    constructor(options = {}) {
        this.options = {
            units: 'metric',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
            style: {},
            ...options
        };

        const s = this.options.style;
        this._drawCtrl = new MapboxDraw({
            displayControlsDefault: false,
            styles: [
                {
                    id: 'gl-draw-line',
                    type: 'line',
                    filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: {
                        'line-color': s?.lengthMeasurement?.lineColor ?? '#D20C0C',
                        'line-dasharray': [0.2, 2],
                        'line-width': s?.lengthMeasurement?.lineWidth ?? 2
                    }
                },
                {
                    id: 'gl-draw-polygon-fill',
                    type: 'fill',
                    filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                    paint: {
                        'fill-color': s?.areaMeasurement?.fillColor ?? '#D20C0C',
                        'fill-outline-color': s?.areaMeasurement?.fillOutlineColor ?? '#D20C0C',
                        'fill-opacity': s?.areaMeasurement?.fillOpacity ?? 0.1
                    }
                },
                {
                    id: 'gl-draw-polygon-stroke-active',
                    type: 'line',
                    filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: {
                        'line-color': s?.areaMeasurement?.fillOutlineColor ?? '#D20C0C',
                        'line-dasharray': [0.2, 2],
                        'line-width': s?.areaMeasurement?.lineWidth ?? 2
                    }
                },
                {
                    id: 'gl-draw-polygon-and-line-vertex-halo-active',
                    type: 'circle',
                    filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
                    paint: {
                        'circle-radius': (s?.common?.midPointRadius ?? 3) + 2,
                        'circle-color': s?.common?.midPointHaloColor ?? '#FFF'
                    }
                },
                {
                    id: 'gl-draw-polygon-and-line-vertex-active',
                    type: 'circle',
                    filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
                    paint: {
                        'circle-radius': s?.common?.midPointRadius ?? 3,
                        'circle-color': s?.common?.midPointColor ?? '#fbb03b'
                    }
                },
                {
                    id: 'gl-draw-line-static',
                    type: 'line',
                    filter: ['all', ['==', '$type', 'LineString'], ['==', 'mode', 'static']],
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: {
                        'line-color': s?.lengthMeasurement?.lineColor ?? '#D20C0C',
                        'line-width': s?.lengthMeasurement?.lineWidth ?? 3
                    }
                },
                {
                    id: 'gl-draw-polygon-fill-static',
                    type: 'fill',
                    filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']],
                    paint: {
                        'fill-color': s?.areaMeasurement?.fillColor ?? '#D20C0C',
                        'fill-outline-color': s?.areaMeasurement?.fillOutlineColor ?? '#D20C0C',
                        'fill-opacity': s?.areaMeasurement?.fillOpacity ?? 0.1
                    }
                },
                {
                    id: 'gl-draw-polygon-stroke-static',
                    type: 'line',
                    filter: ['all', ['==', '$type', 'Polygon'], ['==', 'mode', 'static']],
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: {
                        'line-color': s?.areaMeasurement?.fillOutlineColor ?? '#D20C0C',
                        'line-width': s?.areaMeasurement?.lineWidth ?? 2
                    }
                }
            ]
        });
    }

    onAdd(map) {
        this._map = map;
        this._map.addControl(this._drawCtrl, 'top-left');
        // MapboxDraw renders an empty control group (displayControlsDefault: false);
        // it is hidden via the `.mapboxgl-ctrl-group:empty` rule in css/styles.css.
        this._initControl();
        this._registerEvents();
        this._recreateSourceAndLayers();
        // Start collapsed: measurements hidden until the control is toggled on.
        this._setMeasurementsVisible(false);
        return this._container;
    }

    onRemove() {
        try {
            if (this._map.getLayer(DRAW_LABELS_LAYER_ID)) this._map.removeLayer(DRAW_LABELS_LAYER_ID);
            if (this._map.getLayer(DRAW_NODES_LAYER_ID)) this._map.removeLayer(DRAW_NODES_LAYER_ID);
            if (this._map.getSource(DRAW_LABELS_SOURCE_ID)) this._map.removeSource(DRAW_LABELS_SOURCE_ID);
            if (this._map.getSource(DRAW_NODES_SOURCE_ID)) this._map.removeSource(DRAW_NODES_SOURCE_ID);
            this._map.removeControl(this._drawCtrl);
        } catch (e) { /* ignore */ }
        if (this._container?.parentNode) this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }

    _initControl() {
        this._expanded = false;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group maplibregl-measures';

        // Single toggle button; expands to reveal the measure tools.
        this._toggleBtn = document.createElement('button');
        this._toggleBtn.type = 'button';
        this._toggleBtn.title = 'Measure distance and area';
        this._toggleBtn.className = 'measure-toggle-btn';
        this._toggleBtn.innerHTML = '<sl-icon name="rulers" style="font-size:18px;"></sl-icon>';
        this._toggleBtn.addEventListener('click', () => this._toggleTools());
        this._container.appendChild(this._toggleBtn);

        // Sub-tools, hidden until the control is toggled on.
        this._toolsContainer = document.createElement('div');
        this._toolsContainer.className = 'measure-tools';
        this._toolsContainer.style.display = 'none';
        this._container.appendChild(this._toolsContainer);

        this._initDrawBtn(this._drawCtrl.modes.DRAW_LINE_STRING);
        this._initDrawBtn(this._drawCtrl.modes.DRAW_POLYGON);
        this._initClearBtn();
    }

    _toggleTools() {
        this._expanded = !this._expanded;
        this._toolsContainer.style.display = this._expanded ? 'block' : 'none';
        this._toggleBtn.classList.toggle('active', this._expanded);
        if (this._expanded) {
            // Reveal existing measurements and activate line measurement by default.
            this._setMeasurementsVisible(true);
            const lineMode = this._drawCtrl.modes.DRAW_LINE_STRING;
            try { this._drawCtrl.changeMode(lineMode); } catch (e) { /* ignore */ }
            this._setActiveMode(lineMode);
        } else {
            // Leave any active drawing mode and hide measurements when collapsing.
            try { this._drawCtrl.changeMode('simple_select'); } catch (e) { /* ignore */ }
            this._setActiveMode(null);
            this._setMeasurementsVisible(false);
        }
    }

    _setActiveMode(mode) {
        this._toolsContainer.querySelectorAll('button[data-mode]').forEach((b) => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
    }

    _initDrawBtn(mode) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.mode = mode;
        if (mode === this._drawCtrl.modes.DRAW_LINE_STRING) {
            btn.title = 'Measure distance';
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="padding:6px" fill="#333">
                <path d="M503.467,0h-51.2c-4.71,0-8.533,3.814-8.533,8.533v51.2c0,4.719,3.823,8.533,8.533,8.533h16.077
                c-15.027,136.132-31.095,243.354-75.81,275.678V332.8c0-4.719-3.823-8.533-8.533-8.533h-51.2c-4.71,0-8.533,3.814-8.533,8.533
                v9.207c-24.226-20.591-47.59-60.45-70.298-99.26c-22.485-38.426-43.793-74.795-66.236-93.269V128c0-4.719-3.823-8.533-8.533-8.533
                H128c-4.71,0-8.533,3.814-8.533,8.533v20.326c-45.833,25.207-73.916,114.697-93.005,295.407H8.533
                c-4.71,0-8.533,3.814-8.533,8.533v51.2C0,508.186,3.823,512,8.533,512h51.2c4.71,0,8.533-3.814,8.533-8.533v-51.2
                c0-4.719-3.823-8.533-8.533-8.533H43.622c16.734-157.124,41.054-245.598,75.844-274.765V179.2c0,4.719,3.823,8.533,8.533,8.533
                h51.2c4.71,0,8.533-3.814,8.533-8.533v-5.973c16.614,18.56,33.664,47.667,51.499,78.14
                c26.539,45.363,53.948,92.117,85.035,111.829V384c0,4.719,3.823,8.533,8.533,8.533H384c4.71,0,8.533-3.814,8.533-8.533v-20.096
                c58.539-29.158,75.981-141.21,92.979-295.637h17.954c4.71,0,8.533-3.814,8.533-8.533v-51.2C512,3.814,508.177,0,503.467,0z"/>
            </svg>`;
        } else {
            btn.title = 'Measure area';
            btn.innerHTML = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style="padding:4px">
                <path d="M18 38C18 40.2091 16.2091 42 14 42C11.7909 42 10 40.2091 10 38C10 35.7909 11.7909 34 14 34C16.2091 34 18 35.7909 18 38Z" fill="#333"/>
                <path d="M14 20C14 22.2091 12.2091 24 10 24C7.79086 24 6 22.2091 6 20C6 17.7909 7.79086 16 10 16C12.2091 16 14 17.7909 14 20Z" fill="#333"/>
                <path d="M42 20C42 22.2091 40.2091 24 38 24C35.7909 24 34 22.2091 34 20C34 17.7909 35.7909 16 38 16C40.2091 16 42 17.7909 42 20Z" fill="#333"/>
                <path d="M38 38C38 40.2091 36.2091 42 34 42C31.7909 42 30 40.2091 30 38C30 35.7909 31.7909 34 34 34C36.2091 34 38 35.7909 38 38Z" fill="#333"/>
                <path d="M28 10C28 12.2091 26.2091 14 24 14C21.7909 14 20 12.2091 20 10C20 7.79086 21.7909 6 24 6C26.2091 6 28 7.79086 28 10Z" fill="#333"/>
                <path fill-rule="evenodd" clip-rule="evenodd" d="M34.9188 19.028L25.9188 12.5994L27.0812 10.9719L36.0812 17.4005L34.9188 19.028ZM21.7844 12.8114L13.0812 19.028L11.9187 17.4005L20.6219 11.1839L21.7844 12.8114ZM11.6428 22.783L14.3095 34.783L12.3571 35.2169L9.69047 23.2169L11.6428 22.783ZM33.6905 34.783L36.246 23.283L38.1984 23.7169L35.6428 35.2169L33.6905 34.783ZM17 36.9999H31V38.9999H17V36.9999Z" fill="#333"/>
            </svg>`;
        }
        btn.addEventListener('click', () => {
            this._drawCtrl.changeMode(mode);
            this._setActiveMode(mode);
        });
        this._toolsContainer.appendChild(btn);
    }

    _initClearBtn() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Clear measurements';
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 465.311 465.311" style="padding:7px" fill="#333">
            <path d="M372.811,51.002h-59.908V36.566C312.902,16.404,296.499,0,276.335,0h-87.356c-20.163,0-36.567,16.404-36.567,36.566v14.436
            H92.5c-20.726,0-37.587,16.861-37.587,37.587v38.91c0,8.284,6.716,15,15,15h7.728v307.812c0,8.284,6.716,15,15,15H372.67
            c8.284,0,15-6.716,15-15V142.499h7.728c8.284,0,15-6.716,15-15v-38.91C410.397,67.863,393.536,51.002,372.811,51.002z
            M182.412,36.566c0-3.621,2.946-6.566,6.567-6.566h87.356c3.621,0,6.567,2.946,6.567,6.566v14.436h-100.49V36.566z M84.914,88.589
            c0-4.184,3.403-7.587,7.587-7.587h280.31c4.184,0,7.587,3.403,7.587,7.587v23.91H84.914V88.589z M357.67,435.311H107.641V142.499
            H357.67V435.311z"/>
            <path d="M137.41,413.485c5.523,0,10-4.477,10-10V166.497c0-5.523-4.477-10-10-10s-10,4.477-10,10v236.988
            C127.41,409.008,131.887,413.485,137.41,413.485z"/>
            <path d="M200.907,413.485c5.523,0,10-4.477,10-10V166.497c0-5.523-4.477-10-10-10s-10,4.477-10,10v236.988
            C190.907,409.008,195.384,413.485,200.907,413.485z"/>
            <path d="M264.404,413.485c5.523,0,10-4.477,10-10V166.497c0-5.523-4.477-10-10-10s-10,4.477-10,10v236.988
            C254.404,409.008,258.881,413.485,264.404,413.485z"/>
            <path d="M327.901,413.485c5.523,0,10-4.477,10-10V166.497c0-5.523-4.477-10-10-10s-10,4.477-10,10v236.988
            C317.901,409.008,322.378,413.485,327.901,413.485z"/>
        </svg>`;
        btn.addEventListener('click', () => {
            this._drawCtrl.deleteAll();
            this._updateLabels();
        });
        this._toolsContainer.appendChild(btn);
    }

    _registerEvents() {
        this._map.on('draw.create', () => this._updateLabels());
        this._map.on('draw.update', () => this._updateLabels());
        this._map.on('draw.delete', () => this._updateLabels());
        this._map.on('draw.render', () => this._updateLabels());
        this._map.on('draw.modechange', (e) => this._setActiveMode(e.mode));
        // Re-add the labels source/layer if the style is reloaded, preserving
        // the current toggle visibility state.
        this._map.on('styledata', () => {
            this._recreateSourceAndLayers();
            this._setMeasurementsVisible(this._expanded);
        });
    }

    _setMeasurementsVisible(visible) {
        if (!this._map) return;
        const vis = visible ? 'visible' : 'none';
        const drawSources = ['mapbox-gl-draw-hot', 'mapbox-gl-draw-cold'];
        this._map.getStyle().layers.forEach((l) => {
            if (drawSources.includes(l.source)) {
                try { this._map.setLayoutProperty(l.id, 'visibility', vis); } catch (e) { /* ignore */ }
            }
        });
        [DRAW_NODES_LAYER_ID, DRAW_LABELS_LAYER_ID].forEach((id) => {
            if (this._map.getLayer(id)) {
                try { this._map.setLayoutProperty(id, 'visibility', vis); } catch (e) { /* ignore */ }
            }
        });
    }

    _recreateSourceAndLayers() {
        if (!this._map) return;
        const s = this.options.style;
        // Vertex node markers (added below the labels so labels stay on top).
        if (!this._map.getSource(DRAW_NODES_SOURCE_ID)) {
            this._map.addSource(DRAW_NODES_SOURCE_ID, { type: 'geojson', data: EMPTY_DATA });
        }
        if (!this._map.getLayer(DRAW_NODES_LAYER_ID)) {
            this._map.addLayer({
                id: DRAW_NODES_LAYER_ID,
                type: 'circle',
                source: DRAW_NODES_SOURCE_ID,
                paint: {
                    'circle-radius': s?.node?.radius ?? 4,
                    'circle-color': s?.node?.color ?? '#fff',
                    'circle-stroke-width': s?.node?.strokeWidth ?? 2,
                    'circle-stroke-color': s?.node?.strokeColor ?? '#D20C0C'
                }
            });
        }
        if (!this._map.getSource(DRAW_LABELS_SOURCE_ID)) {
            this._map.addSource(DRAW_LABELS_SOURCE_ID, { type: 'geojson', data: EMPTY_DATA });
        }
        if (!this._map.getLayer(DRAW_LABELS_LAYER_ID)) {
            this._map.addLayer({
                id: DRAW_LABELS_LAYER_ID,
                type: 'symbol',
                source: DRAW_LABELS_SOURCE_ID,
                layout: {
                    'text-font': [this.options?.style?.text?.font ?? 'Open Sans Bold'],
                    'text-field': ['get', 'measurement'],
                    'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                    'text-radial-offset': this.options?.style?.text?.radialOffset ?? 0.5,
                    'text-justify': 'auto',
                    'text-letter-spacing': this.options?.style?.text?.letterSpacing ?? 0.05,
                    'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 12, 13, 14, 14, 16, 18, 18]
                },
                paint: {
                    'text-color': this.options?.style?.text?.color ?? '#D20C0C',
                    'text-halo-color': this.options?.style?.text?.haloColor ?? '#fff',
                    'text-halo-width': this.options?.style?.text?.haloWidth ?? 2
                }
            });
        }
    }

    _updateLabels() {
        if (!this._map) return;
        let source = this._map.getSource(DRAW_LABELS_SOURCE_ID);
        if (!source) {
            this._recreateSourceAndLayers();
            source = this._map.getSource(DRAW_LABELS_SOURCE_ID);
        }
        if (source) source.setData(this._getDrawnFeatures());

        const nodeSource = this._map.getSource(DRAW_NODES_SOURCE_ID);
        if (nodeSource) nodeSource.setData(this._getNodeFeatures());
    }

    _getNodeFeatures() {
        const features = [];
        this._drawCtrl.getAll().features.forEach((feature) => {
            try {
                if (feature.geometry.type === 'LineString' || feature.geometry.type === 'Polygon') {
                    turf.explode(feature).features.forEach((p) => features.push(p));
                }
            } catch (e) { /* ignore malformed in-progress geometry */ }
        });
        return { type: 'FeatureCollection', features };
    }

    _getDrawnFeatures() {
        const features = [];
        const drawn = this._drawCtrl.getAll();
        drawn.features.forEach((feature) => {
            try {
                if (feature.geometry.type === 'Polygon') {
                    const centroid = turf.centroid(feature);
                    const perimeter = turf.length(turf.polygonToLine(feature)) * 1000; // km -> m
                    centroid.properties = {
                        measurement: `${this._formatArea(turf.area(feature))}\n${this._formatLength(perimeter)}`
                    };
                    features.push(centroid);
                } else if (feature.geometry.type === 'LineString') {
                    if (this.options?.showOnlyTotalLineLength) {
                        const centroid = turf.centroid(feature);
                        centroid.properties = { measurement: this._formatLength(turf.length(feature) * 1000) };
                        features.push(centroid);
                    } else {
                        turf.lineSegment(feature).features.forEach((segment) => {
                            const centroid = turf.centroid(segment);
                            centroid.properties = { measurement: this._formatLength(turf.length(segment) * 1000) };
                            features.push(centroid);
                        });
                    }
                }
            } catch (e) { /* ignore malformed in-progress geometry */ }
        });
        return { type: 'FeatureCollection', features };
    }

    _formatLength(meters) {
        const imperial = this.options?.units === 'imperial';
        let val, unit;
        if (imperial) {
            const ft = meters / lengthUnits.ft;
            if (ft < 5280) { val = ft; unit = 'ft'; }
            else { val = meters / lengthUnits.mi; unit = 'mi'; }
        } else {
            if (meters < 1000) { val = meters; unit = 'm'; }
            else { val = meters / lengthUnits.km; unit = 'km'; }
        }
        return `${this._localeNumber(val)} ${unit}`;
    }

    _formatArea(sqMeters) {
        const imperial = this.options?.units === 'imperial';
        let val, unit;
        if (imperial) {
            const ft2 = sqMeters / areaUnits.ft2;
            if (ft2 < 43560) { val = ft2; unit = 'ft²'; }
            else if (ft2 < 6272640) { val = sqMeters / areaUnits.ac; unit = 'ac'; }
            else { val = sqMeters / areaUnits.mi2; unit = 'mi²'; }
        } else {
            if (sqMeters < 10000) { val = sqMeters; unit = 'm²'; }
            else if (sqMeters < 1000000) { val = sqMeters / areaUnits.ha; unit = 'ha'; }
            else { val = sqMeters / areaUnits.km2; unit = 'km²'; }
        }
        return `${this._localeNumber(val)} ${unit}`;
    }

    _localeNumber(num) {
        return num.toLocaleString(undefined, {
            minimumFractionDigits: this.options.minimumFractionDigits,
            maximumFractionDigits: this.options.maximumFractionDigits
        });
    }
}

const LOCAL_GEOREF_SOURCE = 'local-georef-image';
const LOCAL_GEOREF_LAYER = 'local-georef-layer';
const LOCAL_GEOREF_OUTLINE = 'local-georef-outline';
const ROTATE_HANDLE_OFFSET_PX = 36;
const ROTATE_ZONE_OFFSET_PX = 16;
const ANCHOR_SNAP_PX = 10;

class LocalGeoref {
    constructor() {
        this.file = null;
        this.bitmap = null;
        this.imageUrl = null;
        this.box = null;
        this.markers = [];
        this.panel = null;
        this.opacity = 0.7;
        this.mode = 'bbox';
        this.points = new LocalPointsMode(this);
        this._shift = false;
        this._alt = false;
        this.historyTarget = {
            isActive: () => this.active && this.mode === 'bbox',
            snapshot: () => ({ ...this.box }),
            restore: box => {
                this.box = box;
                this._update();
            }
        };
        const trackKeys = e => {
            this._shift = e.shiftKey;
            this._alt = e.altKey;
        };
        window.addEventListener('keydown', trackKeys);
        window.addEventListener('keyup', trackKeys);
        window.addEventListener('blur', () => { this._shift = this._alt = false; });
    }

    get active() {
        return !!this.file;
    }

    canGeoreference(file) {
        return /^image\/(png|jpe?g|gif|webp|bmp)$/.test(file.type);
    }

    async start(file) {
        if (this.active) this.close({ reload: false });
        if (!unloadMapwarperMap()) return;
        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch (e) {
            alert(`Could not read ${file.name} in the browser: ${e.message}`);
            return;
        }
        this.file = file;
        this.bitmap = bitmap;
        this.imageUrl = URL.createObjectURL(file);
        this.mode = 'bbox';
        document.body.classList.add('local-mode', 'local-bbox');
        referenceMap.resize();
        this.box = this._initialBox();
        this._addLayers();
        this._addHandles();
        this.panel = buildLocalGeorefPanel(this);
        this._update();
        editHistory.refresh();
    }

    async setMode(mode) {
        if (!this.active || mode === this.mode || this._switching) return;
        this._switching = true;
        try {
            if (mode === 'points') {
                this.mode = 'points';
                document.body.classList.replace('local-bbox', 'local-points');
                this._setBoxVisible(false);
                await this.points.enter();
            } else {
                this.points.exit();
                this.mode = 'bbox';
                document.body.classList.replace('local-points', 'local-bbox');
                this._setBoxVisible(true);
                this._update();
            }
            referenceMap.resize();
            sourceMap.resize();
            if (mode === 'points') this._fitReference(this.points.corners || this.mercatorCorners());
            editHistory.refresh();
            updateLocalGeorefPanel(this);
        } finally {
            this._switching = false;
        }
    }

    _fitReference(mercatorCorners) {
        const bounds = new mapboxgl.LngLatBounds();
        mercatorCorners.forEach(p => bounds.extend(this._lngLat(p)));
        referenceMap.fitBounds(bounds, { padding: 60, duration: 0 });
    }

    _setBoxVisible(visible) {
        this.markers.forEach(m => { m.getElement().style.display = visible ? 'flex' : 'none'; });
        referenceMap.setLayoutProperty(LOCAL_GEOREF_OUTLINE, 'visibility', visible ? 'visible' : 'none');
        referenceMap.setLayoutProperty(LOCAL_GEOREF_LAYER, 'visibility', 'visible');
    }

    showPreview(mercatorCorners) {
        if (mercatorCorners) referenceMap.getSource(LOCAL_GEOREF_SOURCE).setCoordinates(mercatorCorners.map(p => this._lngLat(p)));
        referenceMap.setLayoutProperty(LOCAL_GEOREF_LAYER, 'visibility', mercatorCorners ? 'visible' : 'none');
        updateLocalGeorefPanel(this);
    }

    close({ reload = true } = {}) {
        if (!this.active) return;
        const wasPoints = this.mode === 'points';
        this.mode = 'bbox';
        this.points.dispose();
        if (wasPoints) clearControlPoints();
        referenceMap.off('zoom', this._onZoom);
        this._detachBodyDrag();
        this.markers.forEach(m => m.remove());
        this.markers = [];
        [LOCAL_GEOREF_OUTLINE, LOCAL_GEOREF_LAYER].forEach(id => referenceMap.getLayer(id) && referenceMap.removeLayer(id));
        [LOCAL_GEOREF_OUTLINE, LOCAL_GEOREF_SOURCE].forEach(id => referenceMap.getSource(id) && referenceMap.removeSource(id));
        if (this.panel) this.panel.remove();
        this.panel = null;
        URL.revokeObjectURL(this.imageUrl);
        this.bitmap.close();
        this.file = this.bitmap = this.imageUrl = this.box = null;
        editHistory.clear(this.historyTarget);
        document.body.classList.remove('local-mode', 'local-bbox', 'local-points');
        referenceMap.resize();
        sourceMap.resize();
        if (reload) reloadMapwarperUrl();
    }

    _initialBox() {
        const canvas = referenceMap.getCanvas();
        const { width, height } = this.bitmap;
        const pxPerImagePx = Math.min(0.7 * canvas.clientWidth / width, 0.7 * canvas.clientHeight / height);
        const unitsPerPx = this._unitsPerPx();
        const c = mapboxgl.MercatorCoordinate.fromLngLat(referenceMap.getCenter());
        return { cx: c.x, cy: c.y, w: width * pxPerImagePx * unitsPerPx, h: height * pxPerImagePx * unitsPerPx, angle: 0 };
    }

    _unitsPerPx() {
        return 1 / (512 * Math.pow(2, referenceMap.getZoom()));
    }

    _toWorld(lx, ly) {
        return boxToWorld(this.box, lx, ly);
    }

    _lngLat([x, y]) {
        const ll = new mapboxgl.MercatorCoordinate(x, y).toLngLat();
        return [ll.lng, ll.lat];
    }

    mercatorCorners() {
        const { w, h } = this.box;
        return CORNER_SIGNS.map(([sx, sy]) => this._toWorld(sx * w / 2, sy * h / 2));
    }

    corners() {
        return this.mercatorCorners().map(p => this._lngLat(p));
    }

    boxControlPoints() {
        const { width, height } = this.bitmap;
        return this.corners().map(([lon, lat], i) => ({
            x: (CORNER_SIGNS[i][0] + 1) / 2 * width,
            y: (CORNER_SIGNS[i][1] + 1) / 2 * height,
            lon, lat
        }));
    }

    center() {
        const [lon, lat] = this._lngLat([this.box.cx, this.box.cy]);
        return { lon, lat };
    }

    _rotateHandle() {
        const lift = ROTATE_HANDLE_OFFSET_PX * this._unitsPerPx();
        return [this._toWorld(0, -this.box.h / 2), this._toWorld(0, -this.box.h / 2 - lift)];
    }

    _addLayers() {
        referenceMap.addSource(LOCAL_GEOREF_SOURCE, { type: 'image', url: this.imageUrl, coordinates: this.corners() });
        referenceMap.addLayer({
            id: LOCAL_GEOREF_LAYER, type: 'raster', source: LOCAL_GEOREF_SOURCE,
            paint: { 'raster-opacity': this.opacity, 'raster-fade-duration': 0 }
        });
        referenceMap.addSource(LOCAL_GEOREF_OUTLINE, { type: 'geojson', data: this._outline() });
        referenceMap.addLayer({
            id: LOCAL_GEOREF_OUTLINE, type: 'line', source: LOCAL_GEOREF_OUTLINE,
            paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-dasharray': [2, 1] }
        });
    }

    _outline() {
        const ring = this.corners();
        const stem = this._rotateHandle().map(p => this._lngLat(p));
        return {
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } },
                { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: stem } }
            ]
        };
    }

    _handle(kind, label, onDrag) {
        const marker = new mapboxgl.Marker({ element: localGeorefHandleElement(kind), draggable: true });
        marker.on('dragstart', () => {
            editHistory.record(this.historyTarget, label);
            const p = mapboxgl.MercatorCoordinate.fromLngLat(marker.getLngLat());
            this._dragStart = { box: { ...this.box }, at: [p.x, p.y] };
        });
        marker.on('drag', () => {
            const p = mapboxgl.MercatorCoordinate.fromLngLat(marker.getLngLat());
            onDrag([p.x, p.y]);
            this._update(marker);
        });
        marker.on('dragend', () => this._update());
        return marker;
    }

    _addHandles() {
        const aspect = () => (this._shift ? this.bitmap.width / this.bitmap.height : null);
        const rotate = p => {
            this.box = rotateBoxBy(this._dragStart.box, this._dragStart.at, p, this._shift);
        };
        const zones = CORNER_SIGNS.map(() => this._handle('rotate-zone', 'rotate image', rotate));
        this.markers = CORNER_SIGNS.map((signs, i) => this._handle('corner', 'resize image', p => {
            this.box = (this._alt ? scaleBoxFromCorner : resizeBoxFromCorner)(this.box, i, p, aspect());
        }));
        const anchor = this._handle('anchor', 'move anchor', p => {
            this.box = moveBoxAnchor(this.box, p, ANCHOR_SNAP_PX * this._unitsPerPx());
        });
        anchor.getElement().addEventListener('dblclick', e => {
            e.stopPropagation();
            editHistory.record(this.historyTarget, 'reset anchor');
            this.box = { ...this.box, ax: 0, ay: 0 };
            this._update();
        });
        this.markers.push(anchor);
        this.markers.push(this._handle('rotate', 'rotate image', rotate));
        EDGE_NORMALS.forEach(([nx], i) => this.markers.push(this._handle(nx ? 'edge-ew' : 'edge-ns', 'resize image', p => {
            this.box = (this._alt ? scaleBoxFromEdge : resizeBoxFromEdge)(this.box, i, p, aspect());
        })));
        this._detachBodyDrag = attachBoxBodyDrag(this);
        zones.forEach(m => m.setLngLat([0, 0]).addTo(referenceMap));
        this.markers.forEach(m => m.setLngLat([0, 0]).addTo(referenceMap));
        this.markers.push(...zones);
        this._onZoom = () => this.mode === 'bbox' && this._update();
        referenceMap.on('zoom', this._onZoom);
    }

    _update(dragging = null) {
        const corners = this.corners();
        referenceMap.getSource(LOCAL_GEOREF_SOURCE).setCoordinates(corners);
        referenceMap.getSource(LOCAL_GEOREF_OUTLINE).setData(this._outline());
        const c = this._lngLat(boxAnchor(this.box));
        const rotate = this._lngLat(this._rotateHandle()[1]);
        const { w, h } = this.box;
        const edges = EDGE_NORMALS.map(([nx, ny]) => this._lngLat(this._toWorld(nx * w / 2, ny * h / 2)));
        const off = ROTATE_ZONE_OFFSET_PX * this._unitsPerPx();
        const zones = CORNER_SIGNS.map(([sx, sy]) => this._lngLat(this._toWorld(sx * (w / 2 + off), sy * (h / 2 + off))));
        [...corners, c, rotate, ...edges, ...zones].forEach((ll, i) => {
            if (this.markers[i] !== dragging) this.markers[i].setLngLat(ll);
        });
        updateLocalGeorefPanel(this);
    }

    _exportCorners() {
        return this.mode === 'bbox' ? this.mercatorCorners() : this.points.corners;
    }

    async exportGeoTIFF(button) {
        const corners = this._exportCorners();
        if (!corners) return alert('Add at least 3 control points (not in a line) to export.');
        button.disabled = true;
        try {
            await downloadGeoTIFF(this.bitmap, corners, `${this.file.name.replace(/\.[^.]+$/, '')}.tif`);
        } catch (e) {
            alert(`GeoTIFF export failed: ${e.message}`);
        } finally {
            button.disabled = false;
        }
    }

    saveToMapwarper() {
        const gcps = this.mode === 'bbox' ? this.boxControlPoints() : this.points.gcps();
        const corners = this._exportCorners();
        let center = null;
        if (corners) {
            const [lon, lat] = this._lngLat([0, 1].map(k => corners.reduce((sum, c) => sum + c[k], 0) / 4));
            center = { lon, lat };
        }
        mapUploader.open(this.file, { gcps: gcps.length ? gcps : null, center });
    }
}

window.localGeoref = new LocalGeoref();

const LOCAL_SOURCE_IMAGE = 'local-source-image';

class LocalPointsMode {
    constructor(georef) {
        this.georef = georef;
        this.stash = null;
        this.corners = null;
    }

    async enter() {
        const { width, height } = this.georef.bitmap;
        const pixelToFakeGeo = 5 / Math.max(width, height);
        const bounds = { west: 0, south: 0, east: width * pixelToFakeGeo, north: height * pixelToFakeGeo };
        imageTransform = { width, height, bounds, pixelToFakeGeo, isFakeGeo: true };
        sourceMap.resize();
        await this._styleReady();
        sourceMap.addSource(LOCAL_SOURCE_IMAGE, {
            type: 'image',
            url: this.georef.imageUrl,
            coordinates: [[bounds.west, bounds.north], [bounds.east, bounds.north], [bounds.east, bounds.south], [bounds.west, bounds.south]]
        });
        sourceMap.addLayer({ id: LOCAL_SOURCE_IMAGE, type: 'raster', source: LOCAL_SOURCE_IMAGE, paint: { 'raster-fade-duration': 0 } });
        const imageBounds = new mapboxgl.LngLatBounds([bounds.west, bounds.south], [bounds.east, bounds.north]);
        sourceMap.setMaxBounds(null);
        sourceMap.fitBounds(imageBounds, { padding: 10, duration: 0 });
        sourceMap.setMaxBounds(imageBounds);

        if (this.stash) {
            controlPoints = this.stash.points;
            nextPointId = Math.max(nextPointId, this.stash.nextPointId);
            deletedRowNumbers = new Set(this.stash.deletedRowNumbers);
        } else if (!controlPoints.length) {
            this._seedFromBox();
        }
        this.stash = null;
        this._refreshPoints();
    }

    exit() {
        this.stash = { points: controlPoints, nextPointId, deletedRowNumbers: [...deletedRowNumbers] };
        controlPoints = [];
        selectedPointIndex = -1;
        this._refreshPoints();
        this._removeSourceImage();
    }

    dispose() {
        this.stash = null;
        this.corners = null;
        this._removeSourceImage();
    }

    _removeSourceImage() {
        if (sourceMap.getLayer(LOCAL_SOURCE_IMAGE)) sourceMap.removeLayer(LOCAL_SOURCE_IMAGE);
        if (sourceMap.getSource(LOCAL_SOURCE_IMAGE)) sourceMap.removeSource(LOCAL_SOURCE_IMAGE);
        sourceMap.setMaxBounds(null);
        imageTransform = null;
    }

    _styleReady() {
        return new Promise(resolve => {
            const check = () => (sourceMap.isStyleLoaded() ? resolve() : setTimeout(check, 50));
            check();
        });
    }

    _seedFromBox() {
        recordPointsChange('add the box corners as points');
        this.georef.boxControlPoints().forEach(({ x, y, lon, lat }) => {
            controlPoints.push({ id: nextPointId++, rowNumber: getNextRowNumber(), sourcePixelCoords: [x, y], referenceCoords: [lon, lat] });
        });
    }

    _refreshPoints() {
        updateMarkers();
        updateCSVFromPoints();
        updateRowNumbers();
    }

    _complete() {
        return controlPoints
            .map(p => ({ pixel: getSourcePixelCoords(p), ref: p.referenceCoords }))
            .filter(e => e.pixel && e.ref);
    }

    gcps() {
        return this._complete().map(({ pixel, ref }) => ({ x: pixel[0], y: pixel[1], lon: ref[0], lat: ref[1] }));
    }

    update() {
        if (this.georef.mode !== 'points') return;
        const complete = this._complete();
        const toMercator = ([lon, lat]) => {
            const m = mapboxgl.MercatorCoordinate.fromLngLat({ lng: lon, lat });
            return [m.x, m.y];
        };
        const w = complete.length >= 3 ? fitAffine(complete.map(e => e.pixel), complete.map(e => toMercator(e.ref))) : null;
        const { width, height } = this.georef.bitmap;
        this.corners = w ? [[0, 0], [width, 0], [width, height], [0, height]].map(p => applyAffine(w, p)) : null;
        if (this.corners && this.corners.some(c => !c.every(isFinite))) this.corners = null;
        this.georef.showPreview(this.corners);
    }
}

window.LocalPointsMode = LocalPointsMode;

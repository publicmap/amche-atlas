export class DXFCoordinateTransformer {
    constructor(options) {
        this.coordSystem = options.coordSystem || 'local';
        this.mapCenter = options.mapCenter;
        this.map = options.map;
        this.bounds = options.bounds;

        this._initializeTransformer();
    }

    _initializeTransformer() {
        switch (this.coordSystem) {
            case 'local':
                this._setupLocalTransform();
                break;
            case 'wgs84':
                this._setupWGS84Transform();
                break;
            case 'utm':
                this._setupUTMTransform();
                break;
            default:
                this._setupLocalTransform();
        }
    }

    _setupLocalTransform() {
        this.origin = this.mapCenter;
        this.units = 'meters';

        const lat = this.mapCenter.lat * Math.PI / 180;
        this.metersPerDegreeLat = 111319.9;
        this.metersPerDegreeLng = 111319.9 * Math.cos(lat);
    }

    _setupWGS84Transform() {
        this.units = 'degrees';
    }

    _setupUTMTransform() {
        this.utmZone = Math.floor((this.mapCenter.lng + 180) / 6) + 1;
        this.hemisphere = this.mapCenter.lat >= 0 ? 'N' : 'S';
        this.units = 'meters';

        const lat = this.mapCenter.lat * Math.PI / 180;
        this.metersPerDegreeLat = 111319.9;
        this.metersPerDegreeLng = 111319.9 * Math.cos(lat);
        this.origin = this.mapCenter;
    }

    transformFeatures(features) {
        return features.map(feature => {
            const transformedGeometry = this._transformGeometry(feature.geometry);
            return {
                ...feature,
                geometry: transformedGeometry
            };
        });
    }

    _transformGeometry(geometry) {
        if (!geometry) return geometry;

        switch (geometry.type) {
            case 'Point':
                return {
                    type: 'Point',
                    coordinates: this._transformCoordinate(geometry.coordinates)
                };
            case 'LineString':
                return {
                    type: 'LineString',
                    coordinates: geometry.coordinates.map(c => this._transformCoordinate(c))
                };
            case 'Polygon':
                return {
                    type: 'Polygon',
                    coordinates: geometry.coordinates.map(ring =>
                        ring.map(c => this._transformCoordinate(c))
                    )
                };
            case 'MultiPoint':
                return {
                    type: 'MultiPoint',
                    coordinates: geometry.coordinates.map(c => this._transformCoordinate(c))
                };
            case 'MultiLineString':
                return {
                    type: 'MultiLineString',
                    coordinates: geometry.coordinates.map(line =>
                        line.map(c => this._transformCoordinate(c))
                    )
                };
            case 'MultiPolygon':
                return {
                    type: 'MultiPolygon',
                    coordinates: geometry.coordinates.map(polygon =>
                        polygon.map(ring =>
                            ring.map(c => this._transformCoordinate(c))
                        )
                    )
                };
            case 'GeometryCollection':
                return {
                    type: 'GeometryCollection',
                    geometries: geometry.geometries.map(g => this._transformGeometry(g))
                };
            default:
                return geometry;
        }
    }

    _transformCoordinate(coord) {
        const [lng, lat, alt = 0] = coord;

        switch (this.coordSystem) {
            case 'local':
                return this._transformToLocal(lng, lat, alt);
            case 'wgs84':
                return [lng, lat, alt];
            case 'utm':
                return this._transformToUTM(lng, lat, alt);
            default:
                return [lng, lat, alt];
        }
    }

    _transformToLocal(lng, lat, alt = 0) {
        const x = (lng - this.origin.lng) * this.metersPerDegreeLng;
        const y = (lat - this.origin.lat) * this.metersPerDegreeLat;
        return [x, y, alt];
    }

    _transformToUTM(lng, lat, alt = 0) {
        const x = (lng - this.origin.lng) * this.metersPerDegreeLng;
        const y = (lat - this.origin.lat) * this.metersPerDegreeLat;

        const centralMeridian = (this.utmZone - 1) * 6 - 180 + 3;
        const utmEasting = 500000 + x;
        const utmNorthing = this.hemisphere === 'N' ? y : 10000000 + y;

        return [utmEasting, utmNorthing, alt];
    }

    getUnits() {
        return this.units;
    }

    getCoordSystemInfo() {
        switch (this.coordSystem) {
            case 'local':
                return {
                    type: 'Local',
                    origin: this.origin,
                    units: 'meters'
                };
            case 'wgs84':
                return {
                    type: 'WGS84',
                    units: 'degrees'
                };
            case 'utm':
                return {
                    type: 'UTM',
                    zone: this.utmZone,
                    hemisphere: this.hemisphere,
                    units: 'meters'
                };
            default:
                return { type: 'Unknown' };
        }
    }

    getImageDimensions(pixelWidth, pixelHeight, dpi) {
        if (!this.map) {
            return { width: pixelWidth, height: pixelHeight };
        }

        const metersPerPixel = this._calculateGroundResolution();

        return {
            width: pixelWidth * metersPerPixel,
            height: pixelHeight * metersPerPixel
        };
    }

    _calculateGroundResolution() {
        if (!this.map) return 1;

        const zoom = this.map.getZoom();
        const lat = this.mapCenter.lat * Math.PI / 180;
        const earthCircumference = 40075017;
        const resolution = (earthCircumference * Math.cos(lat)) / (256 * Math.pow(2, zoom));

        return resolution;
    }
}

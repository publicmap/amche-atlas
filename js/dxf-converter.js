export class DXFConverter {
    static geoJsonToDxf(geojson, options = {}) {
        const {
            title = 'Exported Data',
            coordSystem = 'local',
            units = 'meters',
            rasterImage = null
        } = options;

        const features = geojson.type === 'FeatureCollection'
            ? geojson.features
            : [geojson];

        const layers = this._extractLayers(features);

        let dxf = '';
        dxf += this._generateHeader(title, units);
        dxf += this._generateTables(layers);
        dxf += this._generateBlocks();
        dxf += this._generateEntities(features, rasterImage);

        if (rasterImage && rasterImage.filename) {
            dxf += this._generateObjects(rasterImage.filename);
        }

        dxf += this._generateEnd();

        return dxf;
    }

    static _generateHeader(title, units) {
        let header = '0\nSECTION\n';
        header += '2\nHEADER\n';

        header += '9\n$ACADVER\n1\nAC1014\n';

        header += '9\n$INSUNITS\n';
        header += '70\n';
        header += units === 'meters' ? '6\n' : '0\n';

        header += '9\n$EXTMIN\n';
        header += '10\n-1000000.0\n';
        header += '20\n-1000000.0\n';
        header += '30\n0.0\n';

        header += '9\n$EXTMAX\n';
        header += '10\n1000000.0\n';
        header += '20\n1000000.0\n';
        header += '30\n0.0\n';

        header += '0\nENDSEC\n';
        return header;
    }

    static _generateTables(layers) {
        let tables = '0\nSECTION\n';
        tables += '2\nTABLES\n';

        tables += '0\nTABLE\n';
        tables += '2\nLAYER\n';
        tables += '70\n' + (layers.size + 1) + '\n';

        tables += '0\nLAYER\n';
        tables += '2\n0\n';
        tables += '70\n0\n';
        tables += '62\n7\n';
        tables += '6\nCONTINUOUS\n';

        layers.forEach((color, layerName) => {
            tables += '0\nLAYER\n';
            tables += '2\n' + this._sanitizeLayerName(layerName) + '\n';
            tables += '70\n0\n';
            tables += '62\n' + color + '\n';
            tables += '6\nCONTINUOUS\n';
        });

        tables += '0\nENDTAB\n';

        tables += '0\nTABLE\n';
        tables += '2\nLTYPE\n';
        tables += '70\n1\n';
        tables += '0\nLTYPE\n';
        tables += '2\nCONTINUOUS\n';
        tables += '70\n0\n';
        tables += '3\nSolid line\n';
        tables += '72\n65\n';
        tables += '73\n0\n';
        tables += '40\n0.0\n';
        tables += '0\nENDTAB\n';

        tables += '0\nTABLE\n';
        tables += '2\nAPPID\n';
        tables += '70\n1\n';
        tables += '0\nAPPID\n';
        tables += '2\nAMCHE_GEO\n';
        tables += '70\n0\n';
        tables += '0\nENDTAB\n';

        tables += '0\nENDSEC\n';
        return tables;
    }

    static _generateBlocks() {
        let blocks = '0\nSECTION\n';
        blocks += '2\nBLOCKS\n';
        blocks += '0\nENDSEC\n';
        return blocks;
    }

    static _generateEntities(features, rasterImage) {
        let entities = '0\nSECTION\n';
        entities += '2\nENTITIES\n';

        if (rasterImage) {
            entities += this._rasterImageToDxf(rasterImage);
        }

        features.forEach((feature, index) => {
            const layerName = this._getFeatureLayer(feature);
            entities += this._geometryToDxf(feature.geometry, feature.properties, layerName);
        });

        entities += '0\nENDSEC\n';
        return entities;
    }

    static _generateEnd() {
        return '0\nEOF\n';
    }

    static _extractLayers(features) {
        const layers = new Map();
        let colorIndex = 1;

        layers.set('0', 7);

        features.forEach(feature => {
            const layerName = this._getFeatureLayer(feature);
            if (!layers.has(layerName)) {
                layers.set(layerName, (colorIndex % 255) + 1);
                colorIndex++;
            }
        });

        return layers;
    }

    static _getFeatureLayer(feature) {
        if (feature.properties) {
            if (feature.properties.layer) return String(feature.properties.layer);
            if (feature.properties.layerName) return String(feature.properties.layerName);
            if (feature.sourceLayer) return String(feature.sourceLayer);
        }
        return 'DEFAULT';
    }

    static _sanitizeLayerName(name) {
        return String(name)
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .substring(0, 255);
    }

    static _geometryToDxf(geometry, properties, layerName) {
        if (!geometry) return '';

        switch (geometry.type) {
            case 'Point':
                return this._pointToDxf(geometry.coordinates, properties, layerName);
            case 'LineString':
                return this._lineStringToDxf(geometry.coordinates, properties, layerName);
            case 'Polygon':
                return this._polygonToDxf(geometry.coordinates, properties, layerName);
            case 'MultiPoint':
                return this._multiPointToDxf(geometry.coordinates, properties, layerName);
            case 'MultiLineString':
                return this._multiLineStringToDxf(geometry.coordinates, properties, layerName);
            case 'MultiPolygon':
                return this._multiPolygonToDxf(geometry.coordinates, properties, layerName);
            case 'GeometryCollection':
                return this._geometryCollectionToDxf(geometry.geometries, properties, layerName);
            default:
                return '';
        }
    }

    static _pointToDxf(coordinates, properties, layerName) {
        const [x, y, z = 0] = coordinates;

        let dxf = '0\nPOINT\n';
        dxf += '8\n' + this._sanitizeLayerName(layerName) + '\n';
        dxf += '10\n' + x + '\n';
        dxf += '20\n' + y + '\n';
        dxf += '30\n' + z + '\n';
        dxf += this._propertiesToXData(properties);

        if (properties && properties.name) {
            dxf += this._textToDxf([x, y + 10, z], properties.name, layerName);
        }

        return dxf;
    }

    static _lineStringToDxf(coordinates, properties, layerName) {
        let dxf = '0\nPOLYLINE\n';
        dxf += '8\n' + this._sanitizeLayerName(layerName) + '\n';
        dxf += '66\n1\n';
        dxf += '70\n0\n';
        dxf += this._propertiesToXData(properties);

        coordinates.forEach(coord => {
            const [x, y, z = 0] = coord;
            dxf += '0\nVERTEX\n';
            dxf += '8\n' + this._sanitizeLayerName(layerName) + '\n';
            dxf += '10\n' + x + '\n';
            dxf += '20\n' + y + '\n';
            dxf += '30\n' + z + '\n';
        });

        dxf += '0\nSEQEND\n';

        return dxf;
    }

    static _polygonToDxf(rings, properties, layerName) {
        let dxf = '';

        rings.forEach((ring, index) => {
            dxf += '0\nPOLYLINE\n';
            dxf += '8\n' + this._sanitizeLayerName(layerName) + '\n';
            dxf += '66\n1\n';
            dxf += '70\n1\n';

            if (index === 0) {
                dxf += this._propertiesToXData(properties);
            }

            ring.forEach(coord => {
                const [x, y, z = 0] = coord;
                dxf += '0\nVERTEX\n';
                dxf += '8\n' + this._sanitizeLayerName(layerName) + '\n';
                dxf += '10\n' + x + '\n';
                dxf += '20\n' + y + '\n';
                dxf += '30\n' + z + '\n';
            });

            dxf += '0\nSEQEND\n';
        });

        return dxf;
    }

    static _multiPointToDxf(coordinates, properties, layerName) {
        let dxf = '';
        coordinates.forEach(coord => {
            dxf += this._pointToDxf(coord, properties, layerName);
        });
        return dxf;
    }

    static _multiLineStringToDxf(lines, properties, layerName) {
        let dxf = '';
        lines.forEach(line => {
            dxf += this._lineStringToDxf(line, properties, layerName);
        });
        return dxf;
    }

    static _multiPolygonToDxf(polygons, properties, layerName) {
        let dxf = '';
        polygons.forEach(rings => {
            dxf += this._polygonToDxf(rings, properties, layerName);
        });
        return dxf;
    }

    static _geometryCollectionToDxf(geometries, properties, layerName) {
        let dxf = '';
        geometries.forEach(geom => {
            dxf += this._geometryToDxf(geom, properties, layerName);
        });
        return dxf;
    }

    static _textToDxf(coordinates, text, layerName) {
        const [x, y, z = 0] = coordinates;

        let dxf = '0\nTEXT\n';
        dxf += '8\n' + this._sanitizeLayerName(layerName) + '\n';
        dxf += '10\n' + x + '\n';
        dxf += '20\n' + y + '\n';
        dxf += '30\n' + z + '\n';
        dxf += '40\n5.0\n';
        dxf += '1\n' + String(text) + '\n';

        return dxf;
    }

    static _propertiesToXData(properties) {
        if (!properties || typeof properties !== 'object' || Object.keys(properties).length === 0) {
            return '';
        }

        let xdata = '1001\nAMCHE_GEO\n';

        for (const [key, value] of Object.entries(properties)) {
            if (value === null || value === undefined) continue;

            const keyStr = String(key).substring(0, 255);
            const valueStr = String(value).substring(0, 255);

            xdata += '1000\n' + keyStr + '\n';
            xdata += '1000\n' + valueStr + '\n';
        }

        return xdata;
    }

    static _rasterImageToDxf(imageOptions) {
        const { dataUrl, width, height, position, filename = 'map_raster.png', pixelWidth, pixelHeight } = imageOptions;
        const [x, y] = position;

        const pixelSizeX = width / pixelWidth;
        const pixelSizeY = height / pixelHeight;

        const insertX = x - (width / 2);
        const insertY = y - (height / 2);

        let dxf = '0\nIMAGE\n';
        dxf += '5\nA1\n';
        dxf += '8\nRaster_Layer\n';
        dxf += '100\nAcDbEntity\n';
        dxf += '100\nAcDbRasterImage\n';

        dxf += '10\n' + insertX + '\n';
        dxf += '20\n' + insertY + '\n';
        dxf += '30\n0.0\n';

        dxf += '11\n' + pixelSizeX + '\n';
        dxf += '21\n0.0\n';
        dxf += '31\n0.0\n';

        dxf += '12\n0.0\n';
        dxf += '22\n' + pixelSizeY + '\n';
        dxf += '32\n0.0\n';

        dxf += '13\n' + pixelWidth + '\n';
        dxf += '23\n' + pixelHeight + '\n';

        dxf += '340\nA0\n';

        dxf += '70\n7\n';
        dxf += '280\n1\n';
        dxf += '281\n50\n';
        dxf += '282\n50\n';
        dxf += '283\n0\n';

        return dxf;
    }

    static _generateObjects(rasterFilename) {
        if (!rasterFilename) return '';

        let objects = '0\nSECTION\n';
        objects += '2\nOBJECTS\n';

        objects += '0\nIMAGEDEF\n';
        objects += '5\nA0\n';
        objects += '100\nAcDbRasterImageDef\n';
        objects += '90\n0\n';
        objects += '1\n' + rasterFilename + '\n';
        objects += '10\n1.0\n';
        objects += '20\n1.0\n';
        objects += '11\n1.0\n';
        objects += '21\n1.0\n';
        objects += '280\n1\n';
        objects += '281\n0\n';

        objects += '0\nENDSEC\n';
        return objects;
    }
}

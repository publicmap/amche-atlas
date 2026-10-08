const PARIVESH_DOWNLOAD_RE = /^https?:\/\/parivesh\.nic\.in\/dms\/okm\/downloadDocument\?/i;
const CORS_PROXY_URL = 'https://amche-atlas-production.up.railway.app/proxy';

export class KMLConverter {
    static async kmlToGeoJson(kmlString) {
        const parser = new DOMParser();
        const kmlDoc = parser.parseFromString(kmlString, 'text/xml');

        const parseError = kmlDoc.querySelector('parsererror');
        if (parseError) {
            throw new Error('Invalid KML: ' + parseError.textContent);
        }

        return this._parseKMLDocument(kmlDoc);
    }

    static _parseKMLDocument(kmlDoc) {
        const features = [];

        const placemarks = kmlDoc.querySelectorAll('Placemark');
        placemarks.forEach(placemark => {
            const feature = this._parsePlacemark(placemark);
            if (feature) {
                features.push(feature);
            }
        });

        return {
            type: 'FeatureCollection',
            features: features
        };
    }

    static _parsePlacemark(placemark) {
        const properties = {};

        const name = placemark.querySelector('name');
        if (name) properties.name = name.textContent;

        const description = placemark.querySelector('description');
        if (description) properties.description = description.textContent;

        const extendedData = placemark.querySelector('ExtendedData');
        if (extendedData) {
            const dataElements = extendedData.querySelectorAll('Data');
            dataElements.forEach(data => {
                const name = data.getAttribute('name');
                const value = data.querySelector('value');
                if (name && value) {
                    properties[name] = value.textContent;
                }
            });

            const simpleData = extendedData.querySelectorAll('SimpleData');
            simpleData.forEach(data => {
                const name = data.getAttribute('name');
                if (name) {
                    properties[name] = data.textContent;
                }
            });
        }

        let geometry = null;

        const point = placemark.querySelector('Point coordinates');
        if (point) {
            geometry = this._parsePoint(point.textContent);
        }

        const lineString = placemark.querySelector('LineString coordinates');
        if (lineString) {
            geometry = this._parseLineString(lineString.textContent);
        }

        const polygon = placemark.querySelector('Polygon');
        if (polygon) {
            geometry = this._parsePolygon(polygon);
        }

        const multiGeometry = placemark.querySelector('MultiGeometry');
        if (multiGeometry) {
            geometry = this._parseMultiGeometry(multiGeometry);
        }

        if (!geometry) return null;

        return {
            type: 'Feature',
            properties: properties,
            geometry: geometry
        };
    }

    static _parseCoordinates(coordString) {
        return coordString.trim().split(/\s+/).map(coord => {
            const [lng, lat, alt] = coord.split(',').map(Number);
            return alt !== undefined ? [lng, lat, alt] : [lng, lat];
        });
    }

    static _parsePoint(coordString) {
        const coords = this._parseCoordinates(coordString);
        return {
            type: 'Point',
            coordinates: coords[0]
        };
    }

    static _parseLineString(coordString) {
        return {
            type: 'LineString',
            coordinates: this._parseCoordinates(coordString)
        };
    }

    static _parsePolygon(polygonElement) {
        const rings = [];

        const outerBoundary = polygonElement.querySelector('outerBoundaryIs LinearRing coordinates');
        if (outerBoundary) {
            rings.push(this._parseCoordinates(outerBoundary.textContent));
        }

        const innerBoundaries = polygonElement.querySelectorAll('innerBoundaryIs LinearRing coordinates');
        innerBoundaries.forEach(inner => {
            rings.push(this._parseCoordinates(inner.textContent));
        });

        return {
            type: 'Polygon',
            coordinates: rings
        };
    }

    static _parseMultiGeometry(multiGeometry) {
        const geometries = [];

        const points = multiGeometry.querySelectorAll('Point coordinates');
        points.forEach(point => {
            geometries.push(this._parsePoint(point.textContent));
        });

        const lineStrings = multiGeometry.querySelectorAll('LineString coordinates');
        lineStrings.forEach(line => {
            geometries.push(this._parseLineString(line.textContent));
        });

        const polygons = multiGeometry.querySelectorAll('Polygon');
        polygons.forEach(polygon => {
            geometries.push(this._parsePolygon(polygon));
        });

        if (geometries.length === 0) return null;
        if (geometries.length === 1) return geometries[0];

        return {
            type: 'GeometryCollection',
            geometries: geometries
        };
    }

    static geoJsonToKml(geojson, options = {}) {
        const { name = 'Exported Data', description = '' } = options;

        let kml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n';
        kml += '<Document>\n';

        if (name) {
            kml += `  <name>${this._escapeXml(name)}</name>\n`;
        }
        if (description) {
            kml += `  <description>${this._escapeXml(description)}</description>\n`;
        }

        const features = geojson.type === 'FeatureCollection'
            ? geojson.features
            : [geojson];

        features.forEach(feature => {
            kml += this._featureToKml(feature);
        });

        kml += '</Document>\n';
        kml += '</kml>';

        return kml;
    }

    static _featureToKml(feature) {
        let kml = '  <Placemark>\n';

        if (feature.properties) {
            if (feature.properties.name) {
                kml += `    <name>${this._escapeXml(feature.properties.name)}</name>\n`;
            }
            if (feature.properties.description) {
                kml += `    <description>${this._escapeXml(feature.properties.description)}</description>\n`;
            }

            const otherProps = Object.keys(feature.properties).filter(
                key => key !== 'name' && key !== 'description'
            );

            if (otherProps.length > 0) {
                kml += '    <ExtendedData>\n';
                otherProps.forEach(key => {
                    const value = feature.properties[key];
                    if (value !== null && value !== undefined) {
                        kml += `      <Data name="${this._escapeXml(key)}">\n`;
                        kml += `        <value>${this._escapeXml(String(value))}</value>\n`;
                        kml += '      </Data>\n';
                    }
                });
                kml += '    </ExtendedData>\n';
            }
        }

        kml += this._geometryToKml(feature.geometry);

        kml += '  </Placemark>\n';
        return kml;
    }

    static _geometryToKml(geometry) {
        if (!geometry) return '';

        switch (geometry.type) {
            case 'Point':
                return this._pointToKml(geometry.coordinates);
            case 'LineString':
                return this._lineStringToKml(geometry.coordinates);
            case 'Polygon':
                return this._polygonToKml(geometry.coordinates);
            case 'MultiPoint':
                return this._multiPointToKml(geometry.coordinates);
            case 'MultiLineString':
                return this._multiLineStringToKml(geometry.coordinates);
            case 'MultiPolygon':
                return this._multiPolygonToKml(geometry.coordinates);
            case 'GeometryCollection':
                return this._geometryCollectionToKml(geometry.geometries);
            default:
                return '';
        }
    }

    static _pointToKml(coordinates) {
        return `    <Point>\n      <coordinates>${this._formatCoordinates([coordinates])}</coordinates>\n    </Point>\n`;
    }

    static _lineStringToKml(coordinates) {
        return `    <LineString>\n      <coordinates>${this._formatCoordinates(coordinates)}</coordinates>\n    </LineString>\n`;
    }

    static _polygonToKml(rings) {
        let kml = '    <Polygon>\n';

        if (rings.length > 0) {
            kml += '      <outerBoundaryIs>\n';
            kml += '        <LinearRing>\n';
            kml += `          <coordinates>${this._formatCoordinates(rings[0])}</coordinates>\n`;
            kml += '        </LinearRing>\n';
            kml += '      </outerBoundaryIs>\n';
        }

        for (let i = 1; i < rings.length; i++) {
            kml += '      <innerBoundaryIs>\n';
            kml += '        <LinearRing>\n';
            kml += `          <coordinates>${this._formatCoordinates(rings[i])}</coordinates>\n`;
            kml += '        </LinearRing>\n';
            kml += '      </innerBoundaryIs>\n';
        }

        kml += '    </Polygon>\n';
        return kml;
    }

    static _multiPointToKml(coordinates) {
        let kml = '    <MultiGeometry>\n';
        coordinates.forEach(coord => {
            kml += `      <Point>\n        <coordinates>${this._formatCoordinates([coord])}</coordinates>\n      </Point>\n`;
        });
        kml += '    </MultiGeometry>\n';
        return kml;
    }

    static _multiLineStringToKml(lines) {
        let kml = '    <MultiGeometry>\n';
        lines.forEach(line => {
            kml += `      <LineString>\n        <coordinates>${this._formatCoordinates(line)}</coordinates>\n      </LineString>\n`;
        });
        kml += '    </MultiGeometry>\n';
        return kml;
    }

    static _multiPolygonToKml(polygons) {
        let kml = '    <MultiGeometry>\n';
        polygons.forEach(rings => {
            kml += '      <Polygon>\n';
            if (rings.length > 0) {
                kml += '        <outerBoundaryIs>\n';
                kml += '          <LinearRing>\n';
                kml += `            <coordinates>${this._formatCoordinates(rings[0])}</coordinates>\n`;
                kml += '          </LinearRing>\n';
                kml += '        </outerBoundaryIs>\n';
            }
            for (let i = 1; i < rings.length; i++) {
                kml += '        <innerBoundaryIs>\n';
                kml += '          <LinearRing>\n';
                kml += `            <coordinates>${this._formatCoordinates(rings[i])}</coordinates>\n`;
                kml += '          </LinearRing>\n';
                kml += '        </innerBoundaryIs>\n';
            }
            kml += '      </Polygon>\n';
        });
        kml += '    </MultiGeometry>\n';
        return kml;
    }

    static _geometryCollectionToKml(geometries) {
        let kml = '    <MultiGeometry>\n';
        geometries.forEach(geom => {
            kml += this._geometryToKml(geom).replace(/^    /gm, '      ');
        });
        kml += '    </MultiGeometry>\n';
        return kml;
    }

    static _formatCoordinates(coordinates) {
        return coordinates.map(coord => {
            if (coord.length === 3) {
                return `${coord[0]},${coord[1]},${coord[2]}`;
            }
            return `${coord[0]},${coord[1]},0`;
        }).join(' ');
    }

    static _escapeXml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    static splitPariveshUrls(url) {
        if (!url) return [];
        return url.split(';').map(u => u.trim()).filter(Boolean);
    }

    static isPariveshKmlUrl(url) {
        const urls = this.splitPariveshUrls(url);
        return urls.length > 0 && urls.every(u => PARIVESH_DOWNLOAD_RE.test(u));
    }

    static isKmlUrl(url) {
        if (!url) return false;
        if (this.isPariveshKmlUrl(url)) return true;
        const urlLower = url.toLowerCase();
        return urlLower.endsWith('.kml') || urlLower.includes('.kml?');
    }

    static async fetchPariveshAndConvert(url) {
        const urls = this.splitPariveshUrls(url);
        const collections = await Promise.all(urls.map(async (u) => {
            const response = await fetch(`${CORS_PROXY_URL}?url=${encodeURIComponent(u)}`);
            if (!response.ok) {
                throw new Error(`Could not download Parivesh KML (HTTP ${response.status})`);
            }
            return this.kmlToGeoJson(await response.text());
        }));
        return {
            type: 'FeatureCollection',
            features: collections.flatMap((fc, i) =>
                (fc.features || []).map(f => ({
                    ...f,
                    properties: urls.length > 1 ? { ...f.properties, source_file: i + 1 } : f.properties
                })))
        };
    }

    static async fetchAndConvert(url) {
        if (this.isPariveshKmlUrl(url)) {
            return this.fetchPariveshAndConvert(url);
        }
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch KML: ${response.status} ${response.statusText}`);
            }

            const kmlText = await response.text();
            return await this.kmlToGeoJson(kmlText);
        } catch (error) {
            console.error('Error fetching and converting KML:', error);
            throw error;
        }
    }
}

import { KMLConverter } from './kml-converter.js';
import { OSMApi } from './osm-url-api.js';

const DOWNLOAD_URL = 'https://parivesh.nic.in/dms/okm/downloadDocument';
const DEFAULT_VERSION = '1.0';

const KML_STYLE = {
    'fill-color': ['coalesce', ['get', 'fill-color'], ['get', 'color'], '#3b82f6'],
    'fill-opacity': 0.4,
    'line-color': ['coalesce', ['get', 'stroke-color'], ['get', 'color'], '#1e40af'],
    'line-width': 2,
    'circle-color': ['coalesce', ['get', 'fill-color'], ['get', 'color'], '#3b82f6'],
    'circle-radius': 4,
    'circle-stroke-color': ['coalesce', ['get', 'stroke-color'], ['get', 'color'], '#1e40af'],
    'circle-stroke-width': 2,
    'text-field': ['to-string', ['get', 'name']]
};

export class PariveshAPI {
    static parseId(input) {
        if (!input) return null;
        const value = decodeURIComponent(input.trim());

        if (/^https?:\/\//i.test(value)) {
            try {
                const params = new URL(value).searchParams;
                const parts = {
                    docTypemappingId: params.get('docTypemappingId'),
                    refId: params.get('refId'),
                    refType: params.get('refType'),
                    uuid: params.get('uuid'),
                    version: params.get('version') || DEFAULT_VERSION
                };
                return Object.values(parts).every(Boolean) ? parts : null;
            } catch {
                return null;
            }
        }

        const [docTypemappingId, refId, refType, uuid, version] = value.split('/');
        if (!docTypemappingId || !refId || !refType || !uuid) return null;
        return { docTypemappingId, refId, refType, uuid, version: version || DEFAULT_VERSION };
    }

    static buildUrl({ docTypemappingId, refId, refType, uuid, version }) {
        const query = new URLSearchParams({ docTypemappingId, refId, refType, uuid, version });
        return `${DOWNLOAD_URL}?${query}`;
    }

    static layerId({ refId, docTypemappingId }) {
        return `parivesh-${refId}-${docTypemappingId}`;
    }

    static async createConfigFromId(input) {
        const parts = this.parseId(input);
        if (!parts) {
            throw new Error('Could not parse a PARIVESH reference (expected "<docTypemappingId>/<refId>/<refType>/<uuid>")');
        }

        const geojson = await KMLConverter.fetchAndConvert(this.buildUrl(parts));
        if (!geojson.features?.length) {
            throw new Error('PARIVESH KML contained no features');
        }

        return {
            id: this.layerId(parts),
            title: `PARIVESH ${parts.refType.toUpperCase()} ${parts.refId}`,
            type: 'geojson',
            geojson,
            attribution: '<a href="https://parivesh.nic.in" target="_blank" rel="noopener">PARIVESH</a>',
            style: OSMApi.mergeStyleForGeometryTypes(geojson, KML_STYLE),
            inspect: { id: 'name', title: 'Name', label: 'name', fields: ['name'], fieldTitles: ['Name'] },
            initiallyChecked: false
        };
    }
}

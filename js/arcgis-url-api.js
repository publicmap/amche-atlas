const OPERATIONS = new Set(['query', 'export', 'identify', 'find', 'exportimage', 'generatekml', 'queryrelatedrecords', 'info']);
const SERVICE_TYPE_RE = /^(FeatureServer|MapServer|ImageServer|VectorTileServer|GeocodeServer|GPServer|GeometryServer|SceneServer|WFSServer|WMSServer|NAServer|StreamServer)$/i;
const BROWSABLE_TYPES = new Set(['featureserver', 'mapserver']);
const HIDDEN_FIELD_RE = /^(shape([_.].*)?|globalid|objectid(_\d+)?|fid|st_(area|length)\(shape\).*)$/i;
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_FEATURES = 50000;
const PAGE_CONCURRENCY = 4;

function slug(text) {
    return String(text || 'arcgis')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'arcgis';
}

function prettify(name) {
    return String(name || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildQuery(base, params) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') search.set(key, value);
    });
    return `${base}?${search}`;
}

export class ArcgisAPI {
    static isArcgisUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return /^https?:\/\/[^?#]+\/rest\/services(\/|\?|#|$)/i.test(url.trim());
    }

    static parseUrl(url) {
        const match = String(url).trim().match(/^(https?:\/\/[^?#]+?\/rest\/services)(\/[^?#]*)?(?:\?([^#]*))?/i);
        if (!match) return null;

        const [, root, path = '', query = ''] = match;
        const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
        while (segments.length && OPERATIONS.has(segments[segments.length - 1].toLowerCase())) segments.pop();

        const where = new URLSearchParams(query).get('where');
        const parsed = { root, where: where && where.replace(/\s/g, '') !== '1=1' ? where : null };
        const typeIndex = segments.findIndex(s => SERVICE_TYPE_RE.test(s));

        if (typeIndex === -1) {
            const folder = segments.join('/');
            return { ...parsed, kind: folder ? 'folder' : 'root', folder, url: folder ? `${root}/${folder}` : root };
        }

        const serviceUrl = `${root}/${segments.slice(0, typeIndex + 1).map(encodeURIComponent).join('/')}`;
        const layerSegment = segments[typeIndex + 1];
        const layerId = /^\d+$/.test(layerSegment || '') ? Number(layerSegment) : null;
        return {
            ...parsed,
            kind: layerId === null ? 'service' : 'layer',
            folder: segments.slice(0, typeIndex - 1).join('/'),
            serviceName: segments.slice(0, typeIndex).join('/'),
            serviceType: segments[typeIndex],
            serviceUrl,
            layerId,
            url: layerId === null ? serviceUrl : `${serviceUrl}/${layerId}`
        };
    }

    // Nodes the browser walks from the services root down to the target.
    static ancestorUrls(parsed) {
        const urls = [parsed.root];
        if (parsed.kind === 'root') return urls;
        const folderParts = (parsed.kind === 'folder' ? parsed.folder : parsed.serviceName.split('/').slice(0, -1).join('/')).split('/').filter(Boolean);
        folderParts.forEach((_, i) => urls.push(`${parsed.root}/${folderParts.slice(0, i + 1).join('/')}`));
        if (parsed.kind === 'layer') urls.push(parsed.serviceUrl);
        return urls;
    }

    static rootNode(parsed) {
        return { key: parsed.root, url: parsed.root, name: new URL(parsed.root).hostname, kind: 'root' };
    }

    static async fetchJson(url, params = {}) {
        const response = await fetch(buildQuery(url, { ...params, f: 'json' }));
        if (!response.ok) throw new Error(`ArcGIS request failed (HTTP ${response.status})`);
        const data = await response.json();
        if (data.error) throw new Error(data.error.message || `ArcGIS error ${data.error.code}`);
        return data;
    }

    static async listChildren(node) {
        const data = await this.fetchJson(node.url);
        const root = node.root || (this.parseUrl(node.url) || {}).root;

        if (node.kind === 'root' || node.kind === 'folder') {
            const folders = (data.folders || []).map(name => ({
                key: `${root}/${name}`, url: `${root}/${name}`, root, name, kind: 'folder'
            }));
            const services = (data.services || [])
                .filter(s => BROWSABLE_TYPES.has(String(s.type).toLowerCase()))
                .map(s => ({
                    key: `${root}/${s.name}/${s.type}`,
                    url: `${root}/${s.name.split('/').map(encodeURIComponent).join('/')}/${s.type}`,
                    root,
                    name: s.name.split('/').pop(),
                    hint: s.type,
                    kind: 'service'
                }));
            return [...folders, ...services];
        }

        const entries = [...(data.layers || []), ...(data.tables || []).map(t => ({ ...t, isTable: true }))];
        const toNode = (layer) => {
            const isGroup = Array.isArray(layer.subLayerIds) && layer.subLayerIds.length > 0;
            const url = `${node.url}/${layer.id}`;
            const result = {
                key: url, url, root, name: layer.name, kind: isGroup ? 'group' : 'layer',
                geometryType: layer.geometryType || null,
                selectable: !isGroup && !layer.isTable,
                hint: layer.isTable ? 'table' : (layer.geometryType || '').replace('esriGeometry', '').toLowerCase()
            };
            if (isGroup) {
                result.children = layer.subLayerIds
                    .map(id => entries.find(e => e.id === id))
                    .filter(Boolean)
                    .map(toNode);
            }
            return result;
        };
        const topLevel = entries.filter(e => e.parentLayerId === undefined || e.parentLayerId === -1);
        return topLevel.map(toNode);
    }

    static layerQueryUrl(layerUrl, params = {}) {
        return buildQuery(`${layerUrl}/query`, params);
    }

    static geojsonQueryUrl(layerUrl, where) {
        return this.layerQueryUrl(layerUrl, {
            where: where || '1=1', outFields: '*', outSR: 4326, geometryPrecision: 6, f: 'geojson'
        });
    }

    static mapExportUrl(parsed) {
        return buildQuery(`${parsed.serviceUrl}/export`, {
            bbox: '{bbox-epsg-3857}', bboxSR: 3857, imageSR: 3857, size: '256,256',
            format: 'png32', transparent: 'true', layers: `show:${parsed.layerId}`, f: 'image'
        }).replace(/%7B(bbox-epsg-3857)%7D/i, '{$1}');
    }

    static async countFeatures(layerUrl, where) {
        const data = await this.fetchJson(`${layerUrl}/query`, { where: where || '1=1', returnCountOnly: true });
        return typeof data.count === 'number' ? data.count : null;
    }

    static async layerExtent(layerUrl, where) {
        const data = await this.fetchJson(`${layerUrl}/query`, {
            where: where || '1=1', returnExtentOnly: true, outSR: 4326
        });
        const e = data.extent;
        if (!e || ![e.xmin, e.ymin, e.xmax, e.ymax].every(Number.isFinite)) return null;
        return [e.xmin, e.ymin, e.xmax, e.ymax];
    }

    static pickOutput(info, count) {
        const limit = info.maxRecordCount || DEFAULT_PAGE_SIZE;
        const geojsonOk = /geojson/i.test(info.supportedQueryFormats || 'geojson');
        return geojsonOk && count !== null && count <= limit ? 'geojson' : 'arcgis';
    }

    static outputOptions(parsed, info, count) {
        const limit = info.maxRecordCount || DEFAULT_PAGE_SIZE;
        const options = [
            { id: 'geojson', label: 'GeoJSON URL', hint: `One live request, rendered natively. The server returns at most ${limit} features, so larger layers are cut off.` },
            { id: 'arcgis', label: 'ArcGIS paged (arcgis)', hint: `Fetches every page of results (up to ${DEFAULT_MAX_FEATURES} features) when the layer is turned on. Use for layers over ${limit} features.` },
            { id: 'snapshot', label: 'Static snapshot', hint: 'Downloads all features once into your browser and stores them as a local GeoJSON layer. Not shareable.' }
        ];
        if (/mapserver/i.test(parsed.serviceType || '')) {
            options.push({ id: 'raster', label: 'Server-rendered map tiles (tms)', hint: 'Uses the service\'s own symbology as raster images. No attribute inspection or restyling.' });
        }
        return options;
    }

    static async describeLayer(url, { output = 'auto', where } = {}) {
        const parsed = this.parseUrl(url);
        if (!parsed || parsed.kind !== 'layer') throw new Error('Not an ArcGIS layer URL');
        const layerWhere = where !== undefined ? where : parsed.where;

        const [info, count, extent] = await Promise.all([
            this.fetchJson(parsed.url),
            this.countFeatures(parsed.url, layerWhere).catch(() => null),
            this.layerExtent(parsed.url, layerWhere).catch(() => null)
        ]);

        const drawable = info.geometryType && info.type !== 'Table';
        if (!drawable && output !== 'snapshot') throw new Error(`"${info.name}" is a table with no geometry, so it can't be drawn on a map`);

        const outputs = this.outputOptions(parsed, info, count);
        const chosen = output === 'auto' || !outputs.some(o => o.id === output) ? this.pickOutput(info, count) : output;
        const allFields = (info.fields || []).map(f => f.name).filter(name => !/^shape([_.].*)?$/i.test(name));
        const fields = allFields.filter(name => !HIDDEN_FIELD_RE.test(name));
        const geometryTypes = {
            esriGeometryPoint: ['Point'], esriGeometryMultipoint: ['MultiPoint'],
            esriGeometryPolyline: ['LineString', 'MultiLineString'], esriGeometryPolygon: ['Polygon', 'MultiPolygon'],
            esriGeometryEnvelope: ['Polygon']
        }[info.geometryType] || [];

        const title = prettify(info.name) || 'ArcGIS Layer';
        const label = info.displayField && fields.includes(info.displayField) ? info.displayField : fields[0];
        const config = {
            id: `${slug(info.name)}-${Math.floor(Math.random() * 90) + 10}`,
            title,
            ...(info.description ? { description: info.description } : {}),
            attribution: info.copyrightText && info.copyrightText.length > 2 ? info.copyrightText : new URL(parsed.root).hostname,
            ...(extent ? { bbox: extent.map(n => Number(n.toFixed(5))) } : {}),
            inspect: {
                id: info.objectIdField || 'objectid',
                title: 'Name',
                label,
                fields: fields.slice(0, 8)
            }
        };

        const configOutput = chosen === 'snapshot' ? 'arcgis' : chosen;
        if (configOutput === 'raster') {
            Object.assign(config, { type: 'tms', url: this.mapExportUrl(parsed), tileSize: 256, maxzoom: 22 });
            delete config.inspect;
        } else if (configOutput === 'arcgis') {
            Object.assign(config, {
                type: 'arcgis', url: parsed.url,
                ...(layerWhere ? { where: layerWhere } : {}),
                pageSize: info.maxRecordCount || DEFAULT_PAGE_SIZE,
                ...(info.supportsAdvancedQueries && info.objectIdField ? { orderBy: info.objectIdField } : {})
            });
        } else {
            Object.assign(config, { type: 'geojson', url: this.geojsonQueryUrl(parsed.url, layerWhere) });
        }

        return { config, output: chosen, outputs, fields, allFields, geometryTypes, count, parsed, info, where: layerWhere };
    }

    static async fetchAllFeatures(config, { onProgress } = {}) {
        const layerUrl = String(config.url).replace(/\/query(\?.*)?$/i, '');
        const pageSize = config.pageSize || DEFAULT_PAGE_SIZE;
        const maxFeatures = config.maxFeatures ?? DEFAULT_MAX_FEATURES;
        const base = {
            where: config.where || '1=1', outFields: config.outFields || '*', outSR: 4326,
            geometryPrecision: 6, orderByFields: config.orderBy, f: 'geojson'
        };

        const fetchPage = async (offset) => {
            const response = await fetch(this.layerQueryUrl(layerUrl, { ...base, resultOffset: offset, resultRecordCount: pageSize }));
            if (!response.ok) throw new Error(`ArcGIS request failed (HTTP ${response.status})`);
            const data = await response.json();
            if (data.error) throw new Error(data.error.message || 'ArcGIS query failed');
            return data.features || [];
        };

        const count = await this.countFeatures(layerUrl, base.where).catch(() => null);
        const features = [];

        if (count !== null) {
            const total = Math.min(count, maxFeatures);
            const offsets = [];
            for (let offset = 0; offset < total; offset += pageSize) offsets.push(offset);
            const pages = new Array(offsets.length);
            let next = 0;
            const worker = async () => {
                while (next < offsets.length) {
                    const index = next++;
                    pages[index] = await fetchPage(offsets[index]);
                    if (onProgress) onProgress(pages.reduce((n, p) => n + (p ? p.length : 0), 0), total);
                }
            };
            await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, worker));
            pages.forEach(page => features.push(...page));
        } else {
            for (let offset = 0; offset < maxFeatures; offset += pageSize) {
                const page = await fetchPage(offset);
                features.push(...page);
                if (onProgress) onProgress(features.length, null);
                if (page.length === 0 || page.length < pageSize) break;
            }
        }

        return { type: 'FeatureCollection', features: features.slice(0, maxFeatures) };
    }
}

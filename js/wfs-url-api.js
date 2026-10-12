const JSON_FORMAT_PREFERENCE = [/^application\/json$/i, /geo\+?json/i, /json/i];

function slug(text) {
    return String(text || 'wfs')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'wfs';
}

function textOf(parent, name) {
    const el = parent.getElementsByTagNameNS('*', name)[0];
    return el ? el.textContent.trim() : '';
}

export class WfsAPI {
    static isWfsUrl(url) {
        if (!url || typeof url !== 'string') return false;
        const lower = url.toLowerCase();
        return lower.includes('service=wfs') || /\/wfs(server)?\/?$/.test(lower.split(/[?#]/)[0]);
    }

    static parseUrl(url) {
        const [endpoint, query = ''] = String(url).trim().split('#')[0].split('?');
        const params = {};
        new URLSearchParams(query).forEach((value, key) => { params[key.toLowerCase()] = value; });
        return {
            endpoint,
            params,
            version: params.version || null,
            typeName: params.typenames || params.typename || null,
            isGetFeature: (params.request || '').toLowerCase() === 'getfeature'
        };
    }

    static capabilitiesUrl(endpoint, version) {
        const search = new URLSearchParams({ service: 'WFS', request: 'GetCapabilities' });
        if (version) search.set('version', version);
        return `${endpoint}?${search}`;
    }

    static rootNode(parsed) {
        return { key: `wfs:${parsed.endpoint}`, url: parsed.endpoint, name: new URL(parsed.endpoint).hostname, kind: 'root' };
    }

    static async fetchCapabilities(endpoint, version) {
        const response = await fetch(this.capabilitiesUrl(endpoint, version));
        if (!response.ok) throw new Error(`WFS GetCapabilities failed (HTTP ${response.status})`);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/xml');
        const root = doc.documentElement;
        if (doc.getElementsByTagName('parsererror').length || !/capabilities/i.test(root.localName)) {
            const message = textOf(doc, 'ExceptionText');
            throw new Error(message || 'The server did not return a WFS capabilities document');
        }

        const featureTypes = Array.from(doc.getElementsByTagNameNS('*', 'FeatureType')).map(el => {
            const lower = textOf(el, 'LowerCorner').split(/\s+/).map(Number);
            const upper = textOf(el, 'UpperCorner').split(/\s+/).map(Number);
            const box = [...lower, ...upper];
            return {
                name: textOf(el, 'Name'),
                title: textOf(el, 'Title'),
                abstract: textOf(el, 'Abstract'),
                bbox: box.length === 4 && box.every(Number.isFinite) ? box : null
            };
        }).filter(t => t.name);

        const operation = Array.from(doc.getElementsByTagNameNS('*', 'Operation'))
            .find(op => op.getAttribute('name') === 'GetFeature');
        const formatParam = operation && Array.from(operation.getElementsByTagNameNS('*', 'Parameter'))
            .find(p => /^outputformat$/i.test(p.getAttribute('name')));
        const outputFormats = formatParam
            ? Array.from(formatParam.getElementsByTagNameNS('*', 'Value')).map(v => v.textContent.trim())
            : [];

        return {
            version: root.getAttribute('version') || version || '2.0.0',
            title: textOf(doc.getElementsByTagNameNS('*', 'ServiceIdentification')[0] || doc, 'Title') || textOf(root, 'Title'),
            provider: textOf(doc, 'ProviderName'),
            featureTypes,
            outputFormats
        };
    }

    static async listChildren(node) {
        const caps = await this.fetchCapabilities(node.url);
        return caps.featureTypes.map(type => ({
            key: `wfs:${node.url}#${type.name}`,
            url: node.url,
            typeName: type.name,
            name: type.title || type.name,
            hint: type.title && type.title !== type.name ? type.name : '',
            kind: 'layer',
            selectable: true
        }));
    }

    static pickJsonFormat(outputFormats) {
        for (const pattern of JSON_FORMAT_PREFERENCE) {
            const match = outputFormats.find(f => pattern.test(f));
            if (match) return match;
        }
        return null;
    }

    static getFeatureUrl({ endpoint, version = '2.0.0', typeName, outputFormat, count, resultType }) {
        const v2 = /^2\./.test(version);
        const search = new URLSearchParams({ service: 'WFS', version, request: 'GetFeature' });
        search.set(v2 ? 'typeNames' : 'typeName', typeName);
        if (outputFormat) search.set('outputFormat', outputFormat);
        search.set('srsName', 'EPSG:4326');
        if (count) search.set(v2 ? 'count' : 'maxFeatures', count);
        if (resultType) search.set('resultType', resultType);
        return `${endpoint}?${search}`;
    }

    static async countFeatures({ endpoint, version, typeName }) {
        if (!/^2\./.test(version)) return null;
        const response = await fetch(this.getFeatureUrl({ endpoint, version, typeName, resultType: 'hits' }));
        const match = (await response.text()).match(/numberMatched="(\d+)"/);
        return match ? Number(match[1]) : null;
    }

    static outputOptions() {
        return [
            { id: 'geojson', label: 'GeoJSON URL', hint: 'A GetFeature request returning every feature as GeoJSON, loaded live by the map.' },
            { id: 'snapshot', label: 'Static snapshot', hint: 'Downloads all features once into your browser and stores them as a local GeoJSON layer. Not shareable.' }
        ];
    }

    static async describeLayer(url, { typeName: pickedType, output = 'auto' } = {}) {
        const parsed = this.parseUrl(url);
        const typeName = pickedType || parsed.typeName;
        if (!typeName) throw new Error('No WFS feature type selected');

        const caps = await this.fetchCapabilities(parsed.endpoint, parsed.version);
        const type = caps.featureTypes.find(t => t.name === typeName);
        const outputFormat = parsed.params.outputformat && /json/i.test(parsed.params.outputformat)
            ? parsed.params.outputformat
            : this.pickJsonFormat(caps.outputFormats);
        if (!outputFormat) throw new Error('This WFS server has no GeoJSON output format. Only GeoJSON-capable servers are supported.');

        const request = { endpoint: parsed.endpoint, version: caps.version, typeName, outputFormat };
        const [sample, count] = await Promise.all([
            fetch(this.getFeatureUrl({ ...request, count: 1 })).then(r => r.json()).catch(() => null),
            this.countFeatures(request).catch(() => null)
        ]);
        const sampleFeatures = (sample && sample.features) || [];
        const fields = sampleFeatures[0] ? Object.keys(sampleFeatures[0].properties || {}) : [];
        const geometryTypes = [...new Set(sampleFeatures.map(f => f.geometry && f.geometry.type).filter(Boolean))];

        const title = (type && type.title) || typeName.split(':').pop().replace(/_/g, ' ');
        const nameField = fields.find(f => /^name$/i.test(f)) || fields.find(f => /name|title|label/i.test(f)) || fields[0];
        const config = {
            id: `${slug(typeName.split(':').pop())}-${Math.floor(Math.random() * 90) + 10}`,
            title,
            ...(type && type.abstract ? { description: type.abstract } : {}),
            attribution: caps.provider || new URL(parsed.endpoint).hostname,
            ...(type && type.bbox ? { bbox: type.bbox } : {}),
            type: 'geojson',
            url: this.getFeatureUrl(request),
            inspect: { id: fields.find(f => /^(id|fid|gid|objectid)$/i.test(f)) || 'id', title: 'Name', label: nameField, fields: fields.slice(0, 8) }
        };

        return {
            config, output: output === 'snapshot' ? 'snapshot' : 'geojson', outputs: this.outputOptions(),
            fields, allFields: fields, geometryTypes, count, parsed: { ...parsed, kind: 'layer', typeName }, info: caps
        };
    }

    static async fetchAllFeatures(config) {
        const response = await fetch(config.url);
        if (!response.ok) throw new Error(`WFS request failed (HTTP ${response.status})`);
        return response.json();
    }
}

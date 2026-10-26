/**
 * Turns a single-file PMTiles archive URL into a layer config by reading its
 * header and metadata with HTTP range requests: MVT archives become `vector`
 * layers, image archives (png / jpg / webp / avif) become `tms` layers. Both
 * keep the `.pmtiles` URL; js/mapbox-api.js reads it through the PMTiles tile
 * provider (or the pmtiles:// protocol under MapLibre).
 */

const PMTILES_LIB_URL = 'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm';
export const PMTILES_PROXY_URL = 'https://amche-atlas-production.up.railway.app/proxy';
const TILE_TYPE_MVT = 1;
const RASTER_TILE_TYPES = new Set([2, 3, 4, 5]);

export function pmtilesArchiveUrl(config) {
    return config.proxyUrl ? `${config.proxyUrl}?url=${encodeURIComponent(config.url)}` : config.url;
}

export function isPMTilesUrl(url) {
    return typeof url === 'string' && /^https?:\/\/.+\.pmtiles(\?|$)/i.test(url.trim());
}

function titleFromUrl(url) {
    const filename = url.split('/').pop().split(/[?#]/)[0];
    return filename.replace(/\.pmtiles$/i, '').replace(/\.[0-9a-f]{6,}$/i, '').replace(/[_-]+/g, ' ').trim() || 'PMTiles';
}

function layerId(title) {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pmtiles';
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

function fieldTitle(field) {
    return field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

async function openArchive(url, proxyUrl) {
    const { PMTiles } = await import(/* @vite-ignore */ PMTILES_LIB_URL);
    const archive = new PMTiles(pmtilesArchiveUrl({ url, proxyUrl }));
    return { archive, header: await archive.getHeader() };
}

async function readArchive(url) {
    let opened;
    let proxyUrl = null;
    try {
        opened = await openArchive(url);
    } catch (directError) {
        console.warn('Direct PMTiles read failed, retrying through the proxy:', directError);
        proxyUrl = PMTILES_PROXY_URL;
        try {
            opened = await openArchive(url, proxyUrl);
        } catch (error) {
            throw new Error(`Could not read the PMTiles archive, directly or through the proxy. The server must support HTTP Range requests. (${error.message})`);
        }
    }
    const { archive, header } = opened;
    let metadata = {};
    try {
        metadata = (await archive.getMetadata()) || {};
    } catch (error) {
        console.warn('Failed to read PMTiles metadata:', error);
    }
    return { header, metadata, proxyUrl };
}

function buildVectorConfig(url, base, metadata) {
    const vectorLayers = Array.isArray(metadata.vector_layers) ? metadata.vector_layers : [];
    const first = vectorLayers[0];
    const fields = first?.fields ? Object.keys(first.fields).slice(0, 6) : [];
    const config = {
        ...base,
        type: 'vector',
        sourceLayer: first?.id || 'default'
    };
    if (fields.length) {
        const label = ['name', 'title', 'label'].find(f => first.fields[f]) || fields[0];
        config.inspect = {
            id: first.fields.id ? 'id' : fields[0],
            title: fieldTitle(label),
            label,
            fields,
            fieldTitles: fields.map(fieldTitle)
        };
    }
    return { config, availableSourceLayers: vectorLayers.map(l => l.id) };
}

export async function resolvePMTilesSource(url) {
    const { header, metadata, proxyUrl } = await readArchive(url);
    const title = metadata.name || titleFromUrl(url);
    const base = {
        id: layerId(title),
        title,
        url,
        minzoom: header.minZoom,
        maxzoom: header.maxZoom,
        bbox: [header.minLon, header.minLat, header.maxLon, header.maxLat],
        initiallyChecked: false
    };
    if (proxyUrl) base.proxyUrl = proxyUrl;
    if (metadata.description) base.description = metadata.description;
    if (metadata.attribution) base.attribution = String(metadata.attribution).replace(/"/g, "'");

    if (header.tileType === TILE_TYPE_MVT) {
        const { config, availableSourceLayers } = buildVectorConfig(url, base, metadata);
        return { layerType: 'vector', config, availableSourceLayers };
    }
    if (RASTER_TILE_TYPES.has(header.tileType)) {
        return { layerType: 'tms', config: { ...base, type: 'tms' } };
    }
    throw new Error('Unsupported PMTiles tile type. Only vector (MVT) and image (PNG, JPEG, WebP, AVIF) archives can be added.');
}

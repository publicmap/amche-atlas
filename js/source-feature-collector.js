import { reassembleTiledFeatures } from './tile-fragment-assembler.js';

const geojsonCache = new Map();

function toFeatures(data) {
    if (!data || typeof data !== 'object') return [];
    if (data.type === 'FeatureCollection') return data.features || [];
    if (data.type === 'Feature') return [data];
    if (data.type && data.coordinates) return [{ type: 'Feature', properties: {}, geometry: data }];
    return [];
}

async function loadGeoJSONSource(source) {
    const data = source.serialize?.().data;
    if (typeof data !== 'string') return toFeatures(data);

    if (!geojsonCache.has(data)) {
        geojsonCache.set(data, fetch(data, { cache: 'force-cache' }).then(r => r.json()).catch(err => {
            geojsonCache.delete(data);
            throw err;
        }));
    }
    return toFeatures(await geojsonCache.get(data));
}

async function collectFromRef(map, { source: sourceId, sourceLayer }) {
    const source = map.getSource(sourceId);
    if (!source) return [];

    if (source.type === 'geojson') {
        try {
            const features = await loadGeoJSONSource(source);
            if (features.length) return features;
        } catch (err) {
            console.warn(`[SourceFeatureCollector] Could not read GeoJSON source "${sourceId}", using loaded tiles:`, err);
        }
    }

    try {
        const query = sourceLayer ? { sourceLayer } : {};
        return reassembleTiledFeatures(map.querySourceFeatures(sourceId, query) || []);
    } catch (err) {
        console.warn(`[SourceFeatureCollector] Could not query source "${sourceId}":`, err);
        return [];
    }
}

export function prefetchGeoJSONSources(map, refs) {
    refs.forEach(({ source: sourceId }) => {
        const source = map.getSource(sourceId);
        if (source?.type === 'geojson') loadGeoJSONSource(source).catch(() => {});
    });
}

/**
 * Every feature of the given source references ({ source, sourceLayer }),
 * independent of the viewport: GeoJSON sources return their full dataset,
 * vector sources every feature of the tiles loaded so far with tile
 * fragments stitched back together.
 */
export async function collectSourceFeatures(map, refs) {
    const seen = new Set();
    const unique = refs.filter(ref => {
        const key = `${ref.source}|${ref.sourceLayer || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const results = await Promise.all(unique.map(ref => collectFromRef(map, ref)));
    return results.flat().filter(f => f?.geometry?.type);
}

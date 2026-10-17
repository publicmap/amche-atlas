const MAX_RENDERED_FEATURES = 50;
const TILEQUERY_URL = 'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8,mapbox.mapbox-models-v1/tilequery';
const TILEQUERY_LAYERS = 'road,structure,aeroway,waterway,water,landuse,landuse_overlay,tree,generated_tree,wind_turbine';
const TILEQUERY_RADIUS = 10;
const MODELS_LAYERS = new Set(['tree', 'generated_tree', 'wind_turbine']);

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function queryImportFeaturesets(map, lngLat, group) {
    const imported = map.getStyle().imports?.find(i => i.id === group.id);
    const featuresetIds = Object.keys(imported?.data?.featuresets || {});
    const point = map.project(lngLat);
    return featuresetIds.flatMap(featuresetId => {
        try {
            return map
                .queryRenderedFeatures(point, { target: { featuresetId, importId: group.id } })
                .map(f => ({
                    layer: featuresetId,
                    sourceLayer: featuresetId,
                    properties: f.properties || {},
                    meta: { Source: `${group.id} import featureset`, Featureset: featuresetId, 'Feature id': f.id }
                }));
        } catch (error) {
            return [];
        }
    });
}

async function tilequeryFeatures(lngLat, token) {
    if (!token) return [];
    const url = `${TILEQUERY_URL}/${lngLat.lng},${lngLat.lat}.json?radius=${TILEQUERY_RADIUS}&limit=50&dedupe=true&layers=${TILEQUERY_LAYERS}&access_token=${token}`;
    try {
        const response = await fetch(url);
        if (!response.ok) return [];
        const { features = [] } = await response.json();
        return features.map(f => {
            const { tilequery = {}, ...properties } = f.properties || {};
            const tileset = MODELS_LAYERS.has(tilequery.layer) ? 'mapbox.mapbox-models-v1' : 'mapbox.mapbox-streets-v8';
            return {
                layer: tilequery.layer,
                sourceLayer: tilequery.layer,
                properties,
                meta: {
                    Source: `${tileset} (Tilequery API)`,
                    'Source layer': tilequery.layer,
                    Geometry: tilequery.geometry || f.geometry?.type,
                    Coordinates: f.geometry?.coordinates,
                    'Distance (m)': tilequery.distance,
                    'Feature id': f.id
                }
            };
        });
    } catch (error) {
        return [];
    }
}

function queryStyleLayerFeatures(map, lngLat, group, mapboxAPI) {
    try {
        const layerIds = new Set(mapboxAPI?.getLayerGroupIds(group.id, group) || []);
        return map.queryRenderedFeatures(map.project(lngLat))
            .filter(f => layerIds.has(f.layer?.id))
            .map(f => ({
                layer: f.layer.id,
                sourceLayer: f.sourceLayer,
                properties: f.properties || {},
                meta: { Source: f.source, 'Source layer': f.sourceLayer, Layer: f.layer.id, Geometry: f.geometry?.type, 'Feature id': f.id }
            }));
    } catch (error) {
        return [];
    }
}

export async function inspectStyleLayers(map, lngLat, activeLayers, mapboxAPI) {
    const styleGroups = [...new Map(activeLayers.filter(l => l.type === 'style').map(l => [l.id, l])).values()];
    if (!map || !styleGroups.length) return [];

    const token = window.mapboxgl?.accessToken;
    const results = await Promise.all(styleGroups.map(async group => {
        const isImport = !group.layers && group.url;
        const found = isImport
            ? [...queryImportFeaturesets(map, lngLat, group), ...await tilequeryFeatures(lngLat, token)]
            : queryStyleLayerFeatures(map, lngLat, group, mapboxAPI);
        const seen = new Set();
        const features = found.filter(item => {
            const key = JSON.stringify([item.sourceLayer, item.meta?.['Feature id'], item.meta?.Coordinates, item.properties]);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, MAX_RENDERED_FEATURES);
        if (!features.length) return null;
        return {
            layerId: group.id,
            featureId: `${features.length} rendered ${features.length === 1 ? 'feature' : 'features'}`,
            feature: { properties: {} },
            lngLat,
            isStyleInspection: true,
            styleTitle: group.title || group.id,
            renderedFeatures: features
        };
    }));
    const signatures = new Set();
    return results.filter(Boolean).filter(result => {
        const signature = JSON.stringify(result.renderedFeatures);
        if (signatures.has(signature)) return false;
        signatures.add(signature);
        return true;
    });
}

export function buildStyleInspectionHTML(f) {
    const cell = 'padding:3px 6px;vertical-align:top;font-size:10px;color:#e5e7eb;word-break:break-word;';
    const key = 'padding:3px 6px;vertical-align:top;font-size:10px;color:#9ca3af;';
    const sections = f.renderedFeatures.map(item => {
        const present = ([, v]) => v !== undefined && v !== null && v !== '';
        const entries = [...Object.entries(item.meta || {}).filter(present), ...Object.entries(item.properties)];
        const rows = entries
            .map(([k, v]) => `<tr><td style="${key}">${escapeHtml(k)}</td><td style="${cell}">${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`)
            .join('');
        const label = item.properties.name || item.properties.class || item.properties.type || item.meta?.['Feature id'];
        const heading = label && label !== item.sourceLayer ? `${item.sourceLayer} · ${label}` : item.sourceLayer || item.layer;
        return `<details style="border-top:1px solid #374151;">` +
            `<summary style="cursor:pointer;padding:4px 6px;font-size:10px;font-weight:600;color:#f3f4f6;">${escapeHtml(heading)}</summary>` +
            `<table style="width:100%;border-collapse:collapse;">${rows || `<tr><td style="${key}">No properties</td></tr>`}</table>` +
            `</details>`;
    }).join('');
    return `<div class="style-inspection-details" style="width:100%;max-height:260px;overflow-y:auto;">${sections}</div>`;
}

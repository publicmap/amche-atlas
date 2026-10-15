const WORLD_HALF = 20037508.342789244;
const MAP_TILE_SIZE = 512;

function tileUrl(template, z, x, y, scheme) {
    const n = 2 ** z;
    const row = scheme === 'tms' ? n - 1 - y : y;
    const span = (2 * WORLD_HALF) / n;
    const lat = (ty) => Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180 / Math.PI;
    const lng = (tx) => (tx / n) * 360 - 180;

    return template
        .replace(/\{z\}/g, z)
        .replace(/\{x\}/g, x)
        .replace(/\{y\}/g, row)
        .replace(/\{-y\}/g, n - 1 - y)
        .replace(/\{bbox-epsg-3857\}/g, [
            -WORLD_HALF + x * span, WORLD_HALF - (y + 1) * span,
            -WORLD_HALF + (x + 1) * span, WORLD_HALF - y * span
        ].join(','))
        .replace(/\{bbox-epsg-4326\}/g, [lng(x), lat(y + 1), lng(x + 1), lat(y)].join(','));
}

function rasterSourcesOf(map, layerId) {
    const layers = map.getStyle()?.layers || [];
    const ids = new Set();
    layers.forEach(l => {
        if (l.type === 'raster' && l.metadata?.groupId === layerId && l.source) ids.add(l.source);
    });
    return [...ids].map(id => map.getSource(id)).filter(Boolean);
}

/**
 * The tile images of one raster layer's own sources that cover a `size` CSS
 * pixel window centred on `lngLat`, at the scale the map is showing them -
 * positioned in the window, as <img> boxes rather than pixels read off the
 * canvas, so other layers stacked above and below never appear and no CORS
 * access is needed. [] when the layer has no tile-template source (a COG).
 *
 * @returns {Array<{url:string,left:number,top:number,width:number}>}
 */
export function rasterTileWindow(map, layerId, lngLat, size) {
    const source = rasterSourcesOf(map, layerId)[0];
    const template = source && (source.tiles?.[0] || source.serialize?.().tiles?.[0]);
    if (!template || !lngLat) return [];

    const tileSize = source.tileSize || 256;
    const minZoom = source.minzoom ?? 0;
    const maxZoom = source.maxzoom ?? 22;
    const zoom = map.getZoom();
    const z = Math.max(minZoom, Math.min(maxZoom, Math.floor(zoom + Math.log2(MAP_TILE_SIZE / tileSize))));
    const n = 2 ** z;

    const sinLat = Math.sin(lngLat.lat * Math.PI / 180);
    const worldX = ((lngLat.lng + 180) / 360) * n * tileSize;
    const worldY = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n * tileSize;

    const windowPx = size * (tileSize * n) / (MAP_TILE_SIZE * 2 ** zoom);
    const scale = size / windowPx;
    const left = worldX - windowPx / 2;
    const top = worldY - windowPx / 2;

    const tiles = [];
    for (let ty = Math.floor(top / tileSize); ty <= Math.floor((top + windowPx) / tileSize); ty++) {
        if (ty < 0 || ty >= n) continue;
        for (let tx = Math.floor(left / tileSize); tx <= Math.floor((left + windowPx) / tileSize); tx++) {
            tiles.push({
                url: tileUrl(template, z, ((tx % n) + n) % n, ty, source.scheme),
                left: (tx * tileSize - left) * scale,
                top: (ty * tileSize - top) * scale,
                width: tileSize * scale
            });
        }
    }
    return tiles;
}

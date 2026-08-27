/**
 * COG TileProvider for Mapbox GL JS 3.23+
 *
 * Default-exported class implementing the experimental TileProvider interface
 * (see src/source/tile_provider.ts in mapbox-gl-js). Reads a Cloud Optimized
 * GeoTIFF via geotiff.js HTTP range requests and returns each WebMercator
 * z/x/y tile as a PNG ArrayBuffer.
 *
 * Source spec usage:
 *   { type: 'raster', provider: 'cog', url: 'https://.../file.tif', tileSize: 256 }
 *
 * Supported COG flavors:
 *   - 3-band uint8 RGB
 *   - 4-band uint8 RGBA
 *   - 1-band uint8 grayscale (rendered as grayscale RGB)
 *   - Any of the above JPEG-compressed (PhotometricInterpretation YCbCr,
 *     Compression 7) — the common case for satellite "visual" COGs — is
 *     converted to RGB via geotiff.js's readRGB() (see readRgbRasters()).
 *
 * CRS: COG must be in EPSG:3857 (web mercator) OR EPSG:4326. Tiles outside the
 * COG bounds (or where reprojection would degrade quality) are returned as
 * transparent.
 */
import { fromUrl, Pool } from 'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm';

const TILE_SIZE = 256;
const EARTH_CIRCUMFERENCE = 40075016.685578486;
const HALF_CIRCUMFERENCE = EARTH_CIRCUMFERENCE / 2;

let sharedPool = null;
function getPool() {
    if (!sharedPool) sharedPool = new Pool();
    return sharedPool;
}

function tileMercatorBounds(z, x, y) {
    const size = EARTH_CIRCUMFERENCE / Math.pow(2, z);
    const minX = -HALF_CIRCUMFERENCE + x * size;
    const maxY = HALF_CIRCUMFERENCE - y * size;
    return { minX, minY: maxY - size, maxX: minX + size, maxY };
}

function mercatorToLngLat(x, y) {
    const lng = (x / HALF_CIRCUMFERENCE) * 180;
    const lat = (Math.atan(Math.exp((y / HALF_CIRCUMFERENCE) * Math.PI)) * 360) / Math.PI - 90;
    return [lng, lat];
}

function detectCrs(image) {
    const geoKeys = image.getGeoKeys() || {};
    const proj = geoKeys.ProjectedCSTypeGeoKey;
    const geo = geoKeys.GeographicTypeGeoKey;
    if (proj === 3857 || proj === 900913 || proj === 102100) return 'EPSG:3857';
    if (geo === 4326 && !proj) return 'EPSG:4326';
    const bbox = image.getBoundingBox();
    if (Math.abs(bbox[0]) <= 180 && Math.abs(bbox[2]) <= 180 && Math.abs(bbox[1]) <= 90 && Math.abs(bbox[3]) <= 90) {
        return 'EPSG:4326';
    }
    return 'EPSG:3857';
}

// Reads a window as RGB(A), converting non-RGB photometric interpretations
// (most commonly YCbCr — the norm for JPEG-compressed satellite COGs) to RGB
// first. Plain readRasters() returns YCbCr's raw luma/chroma planes verbatim,
// which paints as a red/magenta-tinted image (bright luma channel splashed
// into "red", chroma left near its neutral ~128 midpoint in "green"/"blue").
// readRGB() does the same window/resample/pool read but runs the appropriate
// colorspace conversion (YCbCr/CMYK/Palette/WhiteIsZero/BlackIsZero -> RGB)
// before returning; plain RGB/RGBA imagery passes through unchanged. Falls
// back to readRasters for any photometric interpretation readRGB doesn't
// recognize (missing/non-standard tag) so those COGs keep working as before.
async function readRgbRasters(image, options) {
    try {
        return await image.readRGB({ ...options, enableAlpha: true });
    } catch (error) {
        return image.readRasters(options);
    }
}

function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

async function canvasToPngArrayBuffer(canvas) {
    const blob = canvas.convertToBlob
        ? await canvas.convertToBlob({ type: 'image/png' })
        : await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob.arrayBuffer();
}

export default class COGTileProvider {
    constructor(options) {
        this.url = options.url;
        this._opening = null;
        this._images = null;
        this._bounds = null;
        this._crs = null;
    }

    async _open() {
        if (this._images) return;
        if (!this._opening) {
            this._opening = (async () => {
                const tiff = await fromUrl(this.url, { allowFullFile: false });
                const count = await tiff.getImageCount();
                const images = [];
                for (let i = 0; i < count; i++) images.push(await tiff.getImage(i));
                images.sort((a, b) => b.getWidth() - a.getWidth());
                this._images = images;
                this._bounds = images[0].getBoundingBox();
                this._crs = detectCrs(images[0]);
            })();
        }
        await this._opening;
    }

    _boundsInMercator() {
        if (this._crs === 'EPSG:3857') return this._bounds;
        const [minLng, minLat, maxLng, maxLat] = this._bounds;
        const [minX, minY] = lngLatToMercator(minLng, minLat);
        const [maxX, maxY] = lngLatToMercator(maxLng, maxLat);
        return [minX, minY, maxX, maxY];
    }

    _pickImage(tileResolution) {
        const full = this._images[0];
        const fullResX = (this._bounds[2] - this._bounds[0]) / full.getWidth();
        const fullResMeters = this._crs === 'EPSG:4326'
            ? Math.abs(fullResX) * (HALF_CIRCUMFERENCE / 180)
            : Math.abs(fullResX);

        // Walk overviews from coarse → fine. Pick the coarsest level whose
        // pixels are still finer than (or equal to) what the tile needs —
        // that minimises bytes downloaded without sacrificing visible detail.
        // When NO overview qualifies (tile resolution finer than image[0],
        // i.e. the user has zoomed past the COG's native resolution), fall
        // back to image[0] so overzoom still shows real pixels instead of a
        // pixelated low-res overview.
        for (let i = this._images.length - 1; i >= 0; i--) {
            const img = this._images[i];
            const overviewScale = full.getWidth() / img.getWidth();
            const res = fullResMeters * overviewScale;
            if (res <= tileResolution) return img;
        }
        return full;
    }

    async load() {
        await this._open();
        const [minX, minY, maxX, maxY] = this._bounds;
        const bounds = this._crs === 'EPSG:4326'
            ? [minX, minY, maxX, maxY]
            : [...mercatorToLngLat(minX, minY), ...mercatorToLngLat(maxX, maxY)];
        return {
            tiles: [`${this.url}#cog/{z}/{x}/{y}`],
            bounds,
            minzoom: 0,
            maxzoom: 22,
        };
    }

    async loadTile({ z, x, y }, { signal }) {
        await this._open();
        if (signal && signal.aborted) return null;

        const tile = tileMercatorBounds(z, x, y);
        const cogMerc = this._boundsInMercator();
        if (tile.maxX <= cogMerc[0] || tile.minX >= cogMerc[2] || tile.maxY <= cogMerc[1] || tile.minY >= cogMerc[3]) {
            return null;
        }

        const tileResolution = (tile.maxX - tile.minX) / TILE_SIZE;
        const image = this._pickImage(tileResolution);

        // Overview images in a COG typically lack their own ModelTiepoint /
        // ModelPixelScale tags, so calling getBoundingBox() on them throws.
        // Use image[0]'s bbox + dimensions for geo math and scale the pixel
        // window to the picked overview's resolution.
        const fullImage = this._images[0];
        const imgBbox = this._bounds;
        const fullW = fullImage.getWidth();
        const fullH = fullImage.getHeight();
        const imgW = image.getWidth();
        const imgH = image.getHeight();
        const scaleX = imgW / fullW;
        const scaleY = imgH / fullH;

        const tileGeo = this._crs === 'EPSG:4326'
            ? mercatorTileToGeoBounds(tile)
            : { minX: tile.minX, minY: tile.minY, maxX: tile.maxX, maxY: tile.maxY };

        const sx0Full = ((tileGeo.minX - imgBbox[0]) / (imgBbox[2] - imgBbox[0])) * fullW;
        const sx1Full = ((tileGeo.maxX - imgBbox[0]) / (imgBbox[2] - imgBbox[0])) * fullW;
        const sy0Full = ((imgBbox[3] - tileGeo.maxY) / (imgBbox[3] - imgBbox[1])) * fullH;
        const sy1Full = ((imgBbox[3] - tileGeo.minY) / (imgBbox[3] - imgBbox[1])) * fullH;

        const sx0 = sx0Full * scaleX;
        const sx1 = sx1Full * scaleX;
        const sy0 = sy0Full * scaleY;
        const sy1 = sy1Full * scaleY;

        const wMin = Math.max(0, Math.floor(Math.min(sx0, sx1)));
        const wMax = Math.min(imgW, Math.ceil(Math.max(sx0, sx1)));
        const hMin = Math.max(0, Math.floor(Math.min(sy0, sy1)));
        const hMax = Math.min(imgH, Math.ceil(Math.max(sy0, sy1)));
        if (wMax <= wMin || hMax <= hMin) return null;

        const tileW = sx1 - sx0;
        const tileH = sy1 - sy0;
        const dstX0 = Math.round(((wMin - sx0) / tileW) * TILE_SIZE);
        const dstX1 = Math.round(((wMax - sx0) / tileW) * TILE_SIZE);
        const dstY0 = Math.round(((hMin - sy0) / tileH) * TILE_SIZE);
        const dstY1 = Math.round(((hMax - sy0) / tileH) * TILE_SIZE);
        const dstW = Math.max(1, dstX1 - dstX0);
        const dstH = Math.max(1, dstY1 - dstY0);

        const rasters = await readRgbRasters(image, {
            window: [wMin, hMin, wMax, hMax],
            width: dstW,
            height: dstH,
            resampleMethod: 'bilinear',
            pool: getPool(),
            interleave: false,
        });
        if (signal && signal.aborted) return null;

        const channels = Array.isArray(rasters) ? rasters.length : 1;
        const r = Array.isArray(rasters) ? rasters[0] : rasters;
        const g = channels >= 3 ? rasters[1] : r;
        const b = channels >= 3 ? rasters[2] : r;
        const a = channels === 4 ? rasters[3] : null;

        const partial = makeCanvas(dstW, dstH);
        const partialCtx = partial.getContext('2d');
        const partialData = partialCtx.createImageData(dstW, dstH);
        const px = partialData.data;
        const n = dstW * dstH;
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            px[o] = r[i];
            px[o + 1] = g[i];
            px[o + 2] = b[i];
            px[o + 3] = a ? a[i] : 255;
        }
        partialCtx.putImageData(partialData, 0, 0);

        const out = makeCanvas(TILE_SIZE, TILE_SIZE);
        const outCtx = out.getContext('2d');
        outCtx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
        outCtx.drawImage(partial, dstX0, dstY0, dstW, dstH);

        const data = await canvasToPngArrayBuffer(out);
        if (signal && signal.aborted) return null;
        return { data };
    }
}

function lngLatToMercator(lng, lat) {
    const x = (lng / 180) * HALF_CIRCUMFERENCE;
    const sin = Math.sin((lat * Math.PI) / 180);
    const y = (HALF_CIRCUMFERENCE / Math.PI) * Math.log((1 + sin) / (1 - sin)) / 2;
    return [x, y];
}

function mercatorTileToGeoBounds(tile) {
    const [minLng, minLat] = mercatorToLngLat(tile.minX, tile.minY);
    const [maxLng, maxLat] = mercatorToLngLat(tile.maxX, tile.maxY);
    return { minX: minLng, minY: minLat, maxX: maxLng, maxY: maxLat };
}

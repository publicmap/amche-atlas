/**
 * TileProvider (Mapbox GL JS 3.23+) that fetches a raster tile and edits its
 * pixels: those near one color turn transparent, keeping every other pixel as
 * it is, and then the image can be recolored in greys and/or inverted. The
 * edits travel in each tile URL's fragment (`#ck=<rrggbb>,<alpha>,<tolerance>&rc=gi`,
 * see js/raster-color-key.js), which fetch never sends to the server.
 *
 * Distance is the largest per-channel difference (0..1). Pixels within the
 * tolerance take the key's alpha; a narrow band beyond it fades back to opaque.
 */

const FEATHER = 0.04;

function parseFragment(hash) {
    const params = new URLSearchParams(hash || '');
    const ck = /^([0-9a-f]{6}),([\d.]+),([\d.]+)$/i.exec(params.get('ck') || '');
    const rc = params.get('rc') || '';
    const key = ck && {
        rgb: [0, 2, 4].map(i => parseInt(ck[1].slice(i, i + 2), 16)),
        alpha: Math.min(1, Math.max(0, Number(ck[2]))),
        tolerance: Number(ck[3])
    };
    const grayscale = rc.includes('g');
    const invert = rc.includes('i');
    return key || grayscale || invert ? { key, grayscale, invert } : null;
}

function makeCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function editPixels(bitmap, { key, grayscale, invert }) {
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = image.data;
    const [r, g, b] = key?.rgb || [0, 0, 0];
    const limit = (key?.tolerance || 0) * 255;
    const edge = ((key?.tolerance || 0) + FEATHER) * 255;
    for (let i = 0; i < px.length; i += 4) {
        if (key) {
            const distance = Math.max(Math.abs(px[i] - r), Math.abs(px[i + 1] - g), Math.abs(px[i + 2] - b));
            if (distance < edge) {
                const keep = distance <= limit ? key.alpha : key.alpha + (1 - key.alpha) * (distance - limit) / (edge - limit);
                px[i + 3] = Math.round(px[i + 3] * keep);
            }
        }
        if (grayscale) {
            const grey = Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
            px[i] = px[i + 1] = px[i + 2] = grey;
        }
        if (invert) {
            px[i] = 255 - px[i];
            px[i + 1] = 255 - px[i + 1];
            px[i + 2] = 255 - px[i + 2];
        }
    }
    ctx.putImageData(image, 0, 0);
    return createImageBitmap(canvas);
}

export default class ColorKeyTileProvider {
    constructor(options) {
        this.options = options;
    }

    async loadTile(_tile, { request, signal }) {
        const [url, hash] = String(request.url).split('#');
        const response = await fetch(url, {
            signal,
            mode: 'cors',
            credentials: request.credentials === 'include' ? 'include' : 'same-origin',
            headers: request.headers || {}
        });
        if (response.status === 404 || response.status === 204) return { data: null };
        if (!response.ok) throw new Error(`Tile request failed: ${response.status}`);
        const blob = await response.blob();
        if (!blob.size) return { data: null };
        const bitmap = await createImageBitmap(blob);
        const edits = parseFragment(hash);
        const data = edits ? await editPixels(bitmap, edits) : bitmap;
        return {
            data,
            cacheControl: response.headers.get('cache-control') || undefined,
            expires: response.headers.get('expires') || undefined
        };
    }
}

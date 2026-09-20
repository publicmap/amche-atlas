/**
 * RasterPixelInspector - Labels a clicked raster pixel using a layer's
 * `legendMap` (see docs/API.md's "Categorical Raster Legends" section).
 *
 * Mapbox GL JS's Map#queryRasterValue() only supports `raster-array`
 * sources, which none of this app's raster layer types (tms/wmts/wms/cog)
 * use — their tiles are plain colored images with the classification
 * already baked in server-side. So instead of querying a value, this reads
 * the actual rendered pixel color back off the WebGL canvas and matches it
 * to the nearest color in a legendMap.
 */
export class RasterPixelInspector {
    /**
     * Read the RGBA color rendered at a screen point.
     * @param {mapboxgl.Map} map
     * @param {{x:number,y:number}} point - CSS pixels, e.g. from map.project()
     * @returns {{r:number,g:number,b:number,a:number}|null} null if the
     *   canvas has no readable WebGL context (e.g. preserveDrawingBuffer
     *   wasn't set on the map, or the point is off-canvas).
     */
    static sample(map, point) {
        const canvas = map?.getCanvas?.();
        if (!canvas) return null;

        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) return null;

        const dpr = window.devicePixelRatio || 1;
        const x = Math.round(point.x * dpr);
        // WebGL's readPixels origin is bottom-left; screen points are top-left.
        const y = canvas.height - Math.round(point.y * dpr) - 1;
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;

        const pixel = new Uint8Array(4);
        try {
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        } catch (error) {
            console.warn('[RasterPixelInspector] readPixels failed (is preserveDrawingBuffer enabled?):', error);
            return null;
        }

        return { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] };
    }

    /**
     * Find the legendMap entry whose color is closest to a sampled pixel.
     * @param {Array<{value:*, color:string, label:string}>} legendMap
     * @param {{r:number,g:number,b:number,a:number}} rgba
     * @param {number} maxDistance - reject matches farther than this
     *   (0-441.7, the max possible Euclidean RGB distance) so an unrelated
     *   color (e.g. a basemap showing through) isn't mis-labeled.
     * @returns {{value:*, color:string, label:string}|null}
     */
    static matchClass(legendMap, rgba, maxDistance = 24) {
        if (!Array.isArray(legendMap) || !legendMap.length || !rgba) return null;
        if (rgba.a === 0) return null;

        let best = null;
        let bestDistance = Infinity;

        for (const entry of legendMap) {
            const color = this._parseColor(entry.color);
            if (!color) continue;

            const distance = Math.sqrt(
                (color.r - rgba.r) ** 2 +
                (color.g - rgba.g) ** 2 +
                (color.b - rgba.b) ** 2
            );

            if (distance < bestDistance) {
                bestDistance = distance;
                best = entry;
            }
        }

        return bestDistance <= maxDistance ? best : null;
    }

    /**
     * Parse a CSS hex color (#rgb, #rrggbb) into {r,g,b}. Legend colors are
     * documented as hex; other CSS color forms aren't supported here.
     */
    static _parseColor(color) {
        if (typeof color !== 'string') return null;
        const hex = color.trim().replace(/^#/, '');

        if (hex.length === 3) {
            const [r, g, b] = hex.split('');
            return {
                r: parseInt(r + r, 16),
                g: parseInt(g + g, 16),
                b: parseInt(b + b, 16)
            };
        }

        if (hex.length === 6) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16)
            };
        }

        return null;
    }
}

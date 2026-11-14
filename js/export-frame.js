import { ExportLayout } from './export-layout.js';

const PADDING = 20;

/**
 * The print export's frame: a page-shaped window fixed in the part of the map
 * the Export panel leaves free, with everything outside it dimmed. The map
 * pans and zooms beneath it; the page's elements (js/export-layout.js) sit on
 * top of it.
 */
export class ExportFrame {
    constructor(map, control) {
        this._map = map;
        this._control = control;
        this._el = document.createElement('div');
        this._el.className = 'map-export-frame';
        this._aspectRatio = 297 / 210;

        this.layout = new ExportLayout({
            onInteractionStart: () => control?._onFrameInteractionStart?.(),
            onInteractionEnd: () => control?._onFrameInteractionEnd?.(),
            onTextChange: (name, text) => control?._onLayoutTextChange?.(name, text),
            onSelectionChange: (name, state) => control?._onLayoutSelectionChange?.(name, state),
            onLegendChange: (entries) => control?._onLayoutLegendChange?.(entries)
        });

        this._map.getContainer().appendChild(this._el);
        this._onResize = () => {
            if (this.isActive()) this.fit();
        };
        window.addEventListener('resize', this._onResize);
    }

    remove() {
        window.removeEventListener('resize', this._onResize);
        this._el.remove();
    }

    isActive() {
        return this._el.classList.contains('active');
    }

    show() {
        this._el.classList.add('active');
        this.fit();
        this.layout.mount(this._el)
            .then(() => {
                this.fit();
                this._control?._refreshLayout?.();
            })
            .catch(error => console.warn('[Export] Could not load the page layout', error));
    }

    hide() {
        this._el.classList.remove('active');
        this.layout.select(null);
    }

    // Only the print formats carry the page's elements; GeoTIFF and the DXF
    // raster use the frame alone.
    setLayoutShown(shown) {
        this._el.classList.toggle('no-layout', !shown);
    }

    setPage(widthMm, heightMm) {
        if (!widthMm || !heightMm) return;
        this._aspectRatio = widthMm / heightMm;
        this.layout.setPage(widthMm, heightMm);
        this.fit();
    }

    /** Fit the page's shape, centred, into the free part of the map. */
    fit() {
        const mapRect = this._map.getContainer().getBoundingClientRect();
        const region = this._control?._frameRegion?.(mapRect)
            || { left: 0, top: 0, right: mapRect.width, bottom: mapRect.height };
        const availW = Math.max(40, region.right - region.left - 2 * PADDING);
        const availH = Math.max(40, region.bottom - region.top - 2 * PADDING);
        const width = Math.min(availW, availH * this._aspectRatio);
        const height = width / this._aspectRatio;

        Object.assign(this._el.style, {
            width: `${width}px`,
            height: `${height}px`,
            left: `${region.left + (region.right - region.left - width) / 2}px`,
            top: `${region.top + (region.bottom - region.top - height) / 2}px`
        });
        this.layout.fit(width);
    }

    getBounds() {
        const rect = this._el.getBoundingClientRect();
        const mapCanvas = this._map.getCanvas().getBoundingClientRect();

        const p1 = this._map.unproject([rect.left - mapCanvas.left, rect.top - mapCanvas.top]);
        const p2 = this._map.unproject([rect.right - mapCanvas.left, rect.bottom - mapCanvas.top]);

        // p1 (screen top-left) is the geographic north-west corner and p2
        // (screen bottom-right) the south-east, so min/max picks the true
        // sw/ne rather than constructing LngLatBounds with north and south
        // swapped (which flipped every raster/PDF export's georeferencing).
        const sw = new mapboxgl.LngLat(Math.min(p1.lng, p2.lng), Math.min(p1.lat, p2.lat));
        const ne = new mapboxgl.LngLat(Math.max(p1.lng, p2.lng), Math.max(p1.lat, p2.lat));

        return new mapboxgl.LngLatBounds(sw, ne);
    }
}

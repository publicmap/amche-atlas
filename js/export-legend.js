/**
 * The export page's legend groups (js/export-layout.js), one per active map:
 * its name, attribution and detailed legend (js/layer-legend.js) - the legend
 * on by default for rasters and for maps whose legend tells a few classes
 * apart, and switched per map from its editor. For the export itself images
 * are inlined as data URLs (through the CORS proxy when needed) so html2canvas
 * can draw them; the on-map preview uses them as they are.
 */
const PROXY_URL = 'https://amche-atlas-production.up.railway.app/proxy';
const RASTER_TYPES = ['tms', 'wmts', 'wms', 'cog', 'img', 'raster-style-layer'];
// A vector map's classes are listed by default only while they stay short
const MAX_DEFAULT_ROWS = 8;

function imageToDataURL(url, useProxy = false) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const actualUrl = useProxy ? `${PROXY_URL}?url=${encodeURIComponent(url)}` : url;
        const timeout = setTimeout(() => resolve(null), 6000);

        img.onload = () => {
            clearTimeout(timeout);
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.getContext('2d').drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            } catch (e) {
                resolve(null);
            }
        };
        img.onerror = async () => {
            clearTimeout(timeout);
            resolve(useProxy ? null : await imageToDataURL(url, true));
        };
        img.src = actualUrl;
    });
}

function cachedDataURL(url, cache) {
    if (!cache.has(url)) cache.set(url, imageToDataURL(url));
    return cache.get(url);
}

function plainText(html) {
    if (!html) return '';
    const holder = document.createElement('div');
    holder.innerHTML = String(html);
    return (holder.textContent || '').replace(/\s+/g, ' ').trim();
}

function withRegistryTags(config) {
    const registryLayer = window.layerRegistry?.getLayer(config.id);
    if (!registryLayer?.tags) return config;
    const tags = Array.isArray(config.tags) ? [...new Set([...config.tags, ...registryLayer.tags])] : registryLayer.tags;
    return { ...config, tags };
}

// Every <img> and background image under root, as data URLs
async function inlineImages(root, cache) {
    const images = [...root.querySelectorAll('img')].map(async (img) => {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:')) return;
        const dataUrl = await cachedDataURL(new URL(src, window.location.href).href, cache);
        if (dataUrl) img.src = dataUrl;
        else img.remove();
    });
    const backgrounds = [...root.querySelectorAll('[style*="background-image"]')].map(async (el) => {
        const match = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
        if (!match || match[1].startsWith('data:')) return;
        const dataUrl = await cachedDataURL(new URL(match[1], window.location.href).href, cache);
        el.style.backgroundImage = dataUrl ? `url('${dataUrl}')` : 'none';
    });
    await Promise.all([...images, ...backgrounds]);
}

function detailLegend(LayerLegend, config) {
    try {
        const legend = LayerLegend.generate(config);
        if (!legend || legend.classList.contains('legend-routes-wrap')) return null;
        return legend;
    } catch (e) {
        return null;
    }
}

function detailByDefault(config, legend) {
    if (!legend) return false;
    if (config.legendImage || config.legendMap?.length || RASTER_TYPES.includes(config.type)) return true;
    return legend.childElementCount > 1 && legend.childElementCount <= MAX_DEFAULT_ROWS;
}

/**
 * A legend group per active map, in the map's stack order: its name and
 * attribution, and its detailed legend - or, without one, its thumbnail as
 * the key.
 *
 * @param {Document} doc - the document the groups are built in
 * @param {Object} options
 * @param {mapboxgl.Map} options.map
 * @param {boolean} [options.forExport] - inline images
 * @param {Map} [options.imageCache] - url -> Promise<dataUrl|null>, shared across exports
 * @param {Object<string, {detail?: boolean}>} [options.overrides] - per map, over the defaults
 * @returns {Promise<Array<{entry: {id: string, title: string, detail: boolean, hasDetail: boolean}, content: HTMLElement}>>}
 */
export async function renderLegendGroups(doc, { map, forExport = false, imageCache = new Map(), overrides = {} }) {
    const active = window.stateManager?.getActiveLayers?.();
    if (!active || !map) return [];

    const [{ LayerThumbnail }, { MapUtils }, { LayerLegend }] = await Promise.all([
        import('./layer-thumbnail.js'),
        import('./map-utils.js'),
        import('./layer-legend.js')
    ]);

    const bounds = map.getBounds();
    const boundsArray = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const groups = [];

    Array.from(active.values()).forEach(layerData => {
        const config = withRegistryTags({ ...layerData.config });
        const legend = detailLegend(LayerLegend, config);
        const entry = {
            id: config.id,
            title: config.title || config.id,
            attribution: plainText(config.attribution),
            hasDetail: !!legend,
            detail: !!legend && (overrides[config.id]?.detail ?? detailByDefault(config, legend))
        };

        try {
            const content = doc.createElement('div');
            content.className = 'legend-group-body';

            const head = doc.createElement('div');
            head.className = 'legend-group-head';
            if (!entry.detail) {
                const thumbnail = LayerThumbnail.generate(config, 38, {
                    isInView: MapUtils.isLayerInView(config, boundsArray)
                }).cloneNode(true);
                thumbnail.className = 'layer-thumbnail-item';
                head.appendChild(doc.importNode(thumbnail, true));
            }
            const text = doc.createElement('div');
            text.className = 'legend-group-text';
            const title = doc.createElement('div');
            title.className = 'layer-thumbnail-title';
            title.textContent = entry.title;
            text.appendChild(title);
            if (config.attribution) {
                const attribution = doc.createElement('div');
                attribution.className = 'layer-thumbnail-attribution';
                attribution.innerHTML = config.attribution;
                text.appendChild(attribution);
            }
            head.appendChild(text);
            content.appendChild(head);

            if (entry.detail) {
                const detail = doc.createElement('div');
                detail.className = 'layer-legend-detail';
                detail.appendChild(doc.importNode(legend, true));
                content.appendChild(detail);
            }
            groups.push({ entry, content });
        } catch (e) {
            console.warn(`[Export] Failed to build the legend for ${config.id}`, e);
        }
    });

    if (forExport) await Promise.all(groups.map(group => inlineImages(group.content, imageCache)));
    return groups;
}

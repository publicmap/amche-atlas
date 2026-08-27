/**
 * STAC (SpatioTemporal Asset Catalog) URL API Middleware.
 *
 * Resolves STAC Items, Collections, and Catalogs — and the developmentseed.org
 * "stac-map" viewer share links that wrap them — into `cog` layer configs
 * pointing at a single COG asset. See docs/API.md → `cog` — STAC support.
 *
 * Usage:
 * ```javascript
 * import { StacAPI } from './stac-url-api.js';
 *
 * const config = await StacAPI.createConfigFromItemUrl(url);       // Item JSON
 * const config = await StacAPI.createConfigFromViewerUrl(url);     // stac-map share link
 * const config = StacAPI.createCogConfigFromUrl(url);              // bare .tif
 * ```
 */

function generateId(prefix) {
    const base = String(prefix || 'stac')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    const random = String(Math.floor(Math.random() * 90) + 10);
    return `${base || 'stac'}-${random}`;
}

// Filenames STAC catalogs/collections conventionally use for every entry —
// meaningless as a label on their own ("collection.json" repeated for every
// child), so listChildren() falls back to the containing directory segment
// instead (e.g. ".../Nepal-Flooding-Aug-2026/collection.json" -> "Nepal
// Flooding Aug 2026").
const GENERIC_STAC_FILENAMES = new Set(['collection.json', 'catalog.json', 'index.json']);

export class StacAPI {
    static isCogUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return /\.tiff?($|\?)/i.test(url);
    }

    static isStacMapViewerUrl(url) {
        if (!url || typeof url !== 'string') return false;
        try {
            const parsed = new URL(url);
            return parsed.hostname === 'developmentseed.org' &&
                parsed.pathname.replace(/\/+$/, '') === '/stac-map' &&
                parsed.searchParams.has('href');
        } catch (error) {
            return false;
        }
    }

    /** Parses the stac-map viewer's `href`/`bbox`/`viz` query params. */
    static parseStacMapViewerUrl(url) {
        const parsed = new URL(url);
        const href = parsed.searchParams.get('href');
        const bboxParam = parsed.searchParams.get('bbox');
        const vizParam = parsed.searchParams.get('viz');

        let assetKey = null;
        if (vizParam) {
            const match = vizParam.match(/^asset:(.+)$/i);
            if (match) assetKey = match[1];
        }

        let bbox = null;
        if (bboxParam) {
            const parts = bboxParam.split(',').map(Number);
            if (parts.length === 4 && parts.every(n => !isNaN(n))) bbox = parts;
        }

        return { href, bbox, assetKey };
    }

    static isStacObject(data) {
        return !!data && typeof data === 'object' && typeof data.stac_version === 'string';
    }

    static isStacItem(data) {
        return this.isStacObject(data) && data.type === 'Feature' && !!data.assets;
    }

    static isStacCatalogOrCollection(data) {
        return this.isStacObject(data) && (data.type === 'Catalog' || data.type === 'Collection');
    }

    /**
     * Picks the best COG-like asset from a STAC Item's `assets` dict.
     * Preference order: an explicit `assetKey`, then an asset with a
     * `visual` role and a GeoTIFF media type, then any GeoTIFF-typed asset,
     * then any `visual`-role asset, then the first asset with an href.
     */
    static pickCogAsset(assets, assetKey) {
        if (!assets) return null;

        if (assetKey && assets[assetKey]?.href) {
            return { key: assetKey, asset: assets[assetKey] };
        }

        const entries = Object.entries(assets).filter(([, asset]) => !!asset?.href);
        const isCogType = (asset) => /image\/tiff|geotiff/i.test(asset.type || '');
        const isVisual = (asset) => Array.isArray(asset.roles) && asset.roles.includes('visual');

        const found =
            entries.find(([, asset]) => isVisual(asset) && isCogType(asset)) ||
            entries.find(([, asset]) => isCogType(asset)) ||
            entries.find(([, asset]) => isVisual(asset)) ||
            entries[0];

        return found ? { key: found[0], asset: found[1] } : null;
    }

    static buildAttribution(item, sourceUrl) {
        const providers = Array.isArray(item.properties?.providers) ? item.properties.providers : [];
        const named = providers.find(p => p.name)?.name;
        const label = named || 'STAC Item';
        return sourceUrl ? `<a href='${sourceUrl}' target='_blank' rel='noopener noreferrer'>${label}</a>` : label;
    }

    static buildDescription(item, assetKey) {
        const parts = [];
        if (item.properties?.datetime) parts.push(`Captured ${item.properties.datetime}`);
        parts.push(`Asset: <code>${assetKey}</code>`);
        return parts.join(' — ');
    }

    /**
     * Normalizes a STAC `bbox` (4-element 2D, or 6-element 3D per the STAC/
     * GeoJSON spec: `[west, south, minAlt, east, north, maxAlt]`) down to the
     * `[west, south, east, north]` array the app's "Zoom to layer" affordance
     * and creator preview fitBounds expect (see `_getLayerBbox` in
     * js/map-layer-controls.js).
     */
    static toBboxArray(bbox) {
        if (!Array.isArray(bbox)) return null;
        if (bbox.length === 4) return bbox;
        if (bbox.length === 6) return [bbox[0], bbox[1], bbox[3], bbox[4]];
        return null;
    }

    /** Builds a `cog` layer config from an already-fetched STAC Item object. */
    static createCogConfigFromItem(item, { assetKey, sourceUrl } = {}) {
        const picked = this.pickCogAsset(item.assets, assetKey);
        if (!picked) {
            throw new Error('No usable COG asset found in this STAC item');
        }

        const title = item.properties?.title || item.id || 'STAC Item';
        const bbox = this.toBboxArray(item.bbox);

        return {
            id: generateId(title),
            type: 'cog',
            title,
            description: this.buildDescription(item, picked.key),
            url: picked.asset.href,
            attribution: this.buildAttribution(item, sourceUrl),
            initiallyChecked: false,
            ...(bbox && { bbox })
        };
    }

    static async fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Could not fetch STAC resource (HTTP ${response.status})`);
        }
        return response.json();
    }

    /** Fetches a STAC Item JSON URL directly and resolves it to a `cog` config. */
    static async createConfigFromItemUrl(url) {
        const item = await this.fetchJson(url);
        if (!this.isStacItem(item)) {
            throw new Error('URL does not point to a STAC Item');
        }
        return this.createCogConfigFromItem(item, { sourceUrl: url });
    }

    /** Resolves a developmentseed.org stac-map viewer share link to a `cog` config. */
    static async createConfigFromViewerUrl(viewerUrl) {
        const { href, assetKey } = this.parseStacMapViewerUrl(viewerUrl);
        if (!href) {
            throw new Error('stac-map URL is missing its "href" parameter');
        }
        const item = await this.fetchJson(href);
        if (!this.isStacItem(item)) {
            throw new Error('stac-map "href" does not point to a STAC Item');
        }
        return this.createCogConfigFromItem(item, { assetKey, sourceUrl: href });
    }

    /** Builds a `cog` config directly from a bare `.tif`/`.tiff` URL. */
    static createCogConfigFromUrl(url) {
        const filename = url.split('/').pop().split('?')[0] || 'COG';
        const title = filename.replace(/\.tiff?$/i, '').replace(/[_-]+/g, ' ').trim() || 'COG';

        return {
            id: generateId(title),
            type: 'cog',
            title,
            url,
            initiallyChecked: false
        };
    }

    /** Title-cases a `-`/`_`-separated slug into a human-readable label. */
    static formatLabel(text) {
        return text
            .replace(/[-_]+/g, ' ')
            .split(' ')
            .filter(Boolean)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Derives a human-readable label for a link with no `title` of its own.
     * STAC catalogs/collections conventionally name every child the same
     * generic filename (`collection.json`, `catalog.json`), so the
     * meaningful part is the containing directory instead.
     */
    static labelForHref(href) {
        let pathname;
        try {
            pathname = new URL(href).pathname;
        } catch (error) {
            pathname = href;
        }

        const segments = pathname.split('/').filter(Boolean);
        const last = segments[segments.length - 1] || '';
        const isGeneric = GENERIC_STAC_FILENAMES.has(last.toLowerCase());
        const slug = isGeneric && segments.length > 1
            ? segments[segments.length - 2]
            : last.replace(/\.json$/i, '');

        return this.formatLabel(slug) || href;
    }

    /**
     * Lists the immediate `item`/`child` links of a STAC Catalog or
     * Collection, resolved to absolute URLs against `baseUrl`.
     */
    static listChildren(stacObject, baseUrl) {
        const links = Array.isArray(stacObject.links) ? stacObject.links : [];
        return links
            .filter(link => link.rel === 'item' || link.rel === 'child')
            .map(link => {
                let href;
                try {
                    href = new URL(link.href, baseUrl).href;
                } catch (error) {
                    return null;
                }
                return { rel: link.rel, href, title: link.title || this.labelForHref(href) };
            })
            .filter(Boolean);
    }

    /**
     * Resolves the `stac:<id>` dynamic layer shorthand's id — either a
     * stac-map viewer URL or a direct STAC Item JSON URL (URL-encoded query
     * strings survive here fine since parseDynamicLayerShorthandString keeps
     * everything after the first colon as-is).
     */
    static async createConfigFromShorthandId(id) {
        const url = decodeURIComponent(id);
        if (this.isStacMapViewerUrl(url)) {
            return this.createConfigFromViewerUrl(url);
        }
        if (this.isCogUrl(url)) {
            return this.createCogConfigFromUrl(url);
        }
        return this.createConfigFromItemUrl(url);
    }
}

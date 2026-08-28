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
import { TextbSync } from './textb-sync.js';

// textb.org pads used as the transport for STAC bulk-import atlases — same
// trick js/geolibre-api.js uses to hand GeoLibre a whole-map project via its
// `?url=` loader, here handing this app's own `?atlas=` loader a freshly
// built atlas it has no other public URL for. Publishing overwrites the pad
// (see textb-sync.js), which is fine: it's a "publish, then immediately load"
// transport, not a durable link.
//
// The pad id is derived from the source STAC URL (catalog or collection)
// rather than fixed, so importing the *same* STAC URL always resolves to the
// *same* pad/URL — independently, anyone else importing that URL lands on
// the pad this run just published, without coordinating an id.
async function hashToPadId(sourceUrl) {
    const bytes = new TextEncoder().encode(sourceUrl);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return `amche-atlas-stac-${hex.slice(0, 32)}.json`;
}

// developmentseed.org's STAC viewer - used to build attribution links that
// open a STAC Item somewhere explorable (footprint, asset list, a preview of
// the picked asset) rather than straight at its raw Item JSON. Also the
// target of isStacMapViewerUrl()/parseStacMapViewerUrl() below (share links
// this same viewer produces).
const STAC_MAP_VIEWER_URL = 'https://developmentseed.org/stac-map/';

// `random: false` is used by buildAtlasFromCatalog(), which needs stable ids
// (deduplicated against everything already generated for that catalog) rather
// than the random suffix that keeps a single interactively-added layer from
// colliding with whatever's already on the map.
function generateId(prefix, { random = true } = {}) {
    const base = String(prefix || 'stac')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'stac';
    if (!random) return base;
    const suffix = String(Math.floor(Math.random() * 90) + 10);
    return `${base}-${suffix}`;
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

    /**
     * Builds the attribution HTML for a STAC Item. Links through
     * developmentseed.org's stac-map viewer (`?href=<sourceUrl>&viz=asset:<key>`)
     * rather than straight to `sourceUrl`'s raw Item JSON, so clicking
     * attribution opens something explorable — footprint, asset list, and a
     * preview of the picked asset — instead of a JSON blob.
     */
    static buildAttribution(item, sourceUrl, assetKey) {
        const providers = Array.isArray(item.properties?.providers) ? item.properties.providers : [];
        const named = providers.find(p => p.name)?.name;
        const label = named || 'STAC Item';
        if (!sourceUrl) return label;

        const params = new URLSearchParams({ href: sourceUrl });
        if (assetKey) params.set('viz', `asset:${assetKey}`);
        const viewerUrl = `${STAC_MAP_VIEWER_URL}?${params.toString()}`;
        return `<a href='${viewerUrl}' target='_blank' rel='noopener noreferrer'>${label}</a>`;
    }

    static buildDescription(item, assetKey) {
        const parts = [];
        if (item.properties?.datetime) parts.push(`Captured ${item.properties.datetime}`);
        parts.push(`Asset: <code>${assetKey}</code>`);
        return parts.join(' — ');
    }

    /**
     * Prefixes a STAC Item's title with its capture date as `[YYYY-MM-DD]`
     * (sliced straight off `properties.datetime`, an RFC 3339 timestamp that
     * always starts with a plain date — no parsing/timezone conversion
     * needed) so layer lists sort/scan chronologically at a glance.
     */
    static buildTitle(item) {
        const rawTitle = item.properties?.title || item.id || 'STAC Item';
        const datetime = item.properties?.datetime;
        return datetime ? `[${datetime.slice(0, 10)}] ${rawTitle}` : rawTitle;
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

    /**
     * Builds a `cog` layer config from an already-fetched STAC Item object.
     * When the item has a `geometry`, it's carried through as `config.geojson`
     * so the cog layer draws it as a footprint outline (see `_addSimpleStyleGeoJSONOverlay`
     * in js/mapbox-api.js) — the item's `bbox` alone can span a lot of empty
     * area for a narrow/diagonal scene footprint.
     *
     * `id` and `tags` are overridable so buildAtlasFromCatalog() can assign a
     * stable, deduplicated id and a collection-derived tag per item instead of
     * the random single-layer id this generates by default.
     */
    static createCogConfigFromItem(item, { assetKey, sourceUrl, id, tags } = {}) {
        const picked = this.pickCogAsset(item.assets, assetKey);
        if (!picked) {
            throw new Error('No usable COG asset found in this STAC item');
        }

        const title = this.buildTitle(item);
        const bbox = this.toBboxArray(item.bbox);

        return {
            id: id || generateId(title),
            type: 'cog',
            title,
            description: this.buildDescription(item, picked.key),
            url: picked.asset.href,
            attribution: this.buildAttribution(item, sourceUrl, picked.key),
            initiallyChecked: false,
            ...(bbox && { bbox }),
            // `properties.id` is what map-marker-manager.js's hover/inspect badge
            // shows by default (layerConfig.inspect.label/id, falling back to
            // 'id') when a layer has no `inspect` config of its own, which cog
            // layers never do here — without this the footprint's inspect badge
            // falls back to an opaque generated feature id instead of anything
            // recognizable.
            ...(item.geometry && { geojson: { type: 'Feature', properties: { id: title }, geometry: item.geometry } }),
            ...(tags && tags.length && { tags })
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
     * Builds a full atlas config `{ name, description, layers }` from a STAC
     * Catalog by walking every child Collection and turning each Item into a
     * `cog` layer, tagged with its owning collection's title so the layer
     * list can be searched/filtered by event (see `tags` handling in
     * js/map-layer-controls.js). A Collection URL (or a Catalog whose items
     * are linked directly, with no sub-collections) is treated as the one
     * collection to import. Used by map-creator.html's "Import entire
     * catalog" bulk-import flow (see `handleStacBulkImport` in js/map-creator.js).
     *
     * Items that fail to fetch or resolve (missing/broken asset, network
     * error, ...) are skipped with a console warning rather than aborting
     * the whole import — a bad item shouldn't block the other ~90.
     *
     * `onProgress({ done, total, collection })` is called after each
     * collection finishes, for a "collection 3 of 10" style status line.
     */
    static async buildAtlasFromCatalog(catalogUrl, { onProgress } = {}) {
        const catalog = await this.fetchJson(catalogUrl);
        if (!this.isStacCatalogOrCollection(catalog)) {
            throw new Error('URL does not point to a STAC Catalog or Collection');
        }

        const childLinks = this.listChildren(catalog, catalogUrl);
        const collectionLinks = childLinks.filter(link => link.rel === 'child');
        const directItemLinks = childLinks.filter(link => link.rel === 'item');

        const collections = collectionLinks.length
            ? collectionLinks
            : [{ href: catalogUrl, title: catalog.title || catalog.id || this.labelForHref(catalogUrl), isSelf: true }];

        const seenIds = new Set();
        const uniqueId = (base) => {
            let id = base;
            for (let n = 2; seenIds.has(id); n++) id = `${base}-${n}`;
            seenIds.add(id);
            return id;
        };

        const layers = [];
        const total = collections.length;
        let done = 0;

        for (const collectionLink of collections) {
            let itemLinks, tag;
            if (collectionLink.isSelf) {
                itemLinks = directItemLinks;
                tag = collectionLink.title;
            } else {
                const collectionData = await this.fetchJson(collectionLink.href);
                itemLinks = this.listChildren(collectionData, collectionLink.href).filter(link => link.rel === 'item');
                tag = collectionData.title || collectionData.id || collectionLink.title;
            }

            const itemConfigs = await Promise.all(itemLinks.map(async (itemLink) => {
                try {
                    const item = await this.fetchJson(itemLink.href);
                    if (!this.isStacItem(item)) return null;
                    const config = this.createCogConfigFromItem(item, {
                        sourceUrl: itemLink.href,
                        id: uniqueId(generateId(item.id || item.properties?.title, { random: false })),
                        tags: [tag]
                    });
                    // Unlike a single interactive import (left unchecked so the
                    // user opts in), a bulk-built atlas has nothing else on it —
                    // leaving every layer off would load an "atlas" that shows
                    // nothing until the user manually checks each one.
                    config.initiallyChecked = true;
                    return config;
                } catch (error) {
                    console.warn(`[STAC] Skipping item ${itemLink.href}: ${error.message}`);
                    return null;
                }
            }));

            layers.push(...itemConfigs.filter(Boolean));
            done++;
            onProgress?.({ done, total, collection: tag });
        }

        return {
            name: catalog.title || catalog.id || this.labelForHref(catalogUrl),
            ...(catalog.description && { description: catalog.description }),
            layers
        };
    }

    /**
     * Publishes an atlas built by buildAtlasFromCatalog(sourceUrl) to a
     * textb.org pad keyed off `sourceUrl` (see hashToPadId above). Returns
     * `atlasUrl` (the `/r/<id>/` plain-text mirror — pass this straight to
     * `?atlas=`, or the `load-atlas` postMessage map-creator.html's
     * bulk-import button sends its parent, to open it immediately with no
     * hosting step of your own) and `editUrl` (the live collaborative editor
     * page at the same pad, for a human to read/tweak the JSON directly).
     * Mirrors GeoLibreAPI.publishProject/PROJECT_RAW_URL in
     * js/geolibre-api.js, except the pad id is content-addressed by the STAC
     * URL rather than fixed, so everyone importing the same catalog/collection
     * converges on one pad.
     */
    static async publishAtlas(atlasData, sourceUrl) {
        const padId = await hashToPadId(sourceUrl);
        await TextbSync.publish(padId, JSON.stringify(atlasData, null, 2));
        return { atlasUrl: TextbSync.rawUrl(padId), editUrl: TextbSync.editUrl(padId) };
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

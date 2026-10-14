const OAM_HOST = 'api.imagery.hotosm.org';
const OAM_STAC_BASE = `https://${OAM_HOST}/stac`;
const OAM_BROWSE_BASE = 'https://imagery.hotosm.org/browse';
const OAM_BROWSE_HOST = 'imagery.hotosm.org';
const DEFAULT_COLLECTION = 'openaerialmap';
const STAC_BROWSER_PATH = /^\/browser\/(?:external\/[^/]+\/)?(?:stac\/)?collections\/([^/]+)\/items\/([^/?#]+)\/?$/;
const TILE_PATH = /^\/raster\/collections\/([^/]+)\/items\/([^/]+)\/tiles\//;

const PLATFORM_LABELS = { uav: 'UAV / drone', satellite: 'Satellite', aircraft: 'Aircraft' };

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toTileTemplate(url) {
    return url.replace(/\/\d+\/\d+\/\d+(@[1-4]x)?($|\?)/i, (match, retina, end) => `/{z}/{x}/{y}${retina || ''}${end}`);
}

export class HotosmOamAPI {
    static isTileUrl(url) {
        if (!url || typeof url !== 'string') return false;
        try {
            const parsed = new URL(url.replace(/[{}]/g, ''));
            return parsed.hostname === OAM_HOST && TILE_PATH.test(parsed.pathname);
        } catch (error) {
            return false;
        }
    }

    static parseBrowseUrl(url) {
        try {
            const parsed = new URL(url);
            if (parsed.hostname === OAM_BROWSE_HOST && /^\/browse\/?$/.test(parsed.pathname)) {
                const item = parsed.searchParams.get('selected_id');
                return item ? { collection: DEFAULT_COLLECTION, item } : null;
            }
            if (parsed.hostname === OAM_HOST) {
                const match = parsed.pathname.match(STAC_BROWSER_PATH);
                return match ? { collection: match[1], item: match[2] } : null;
            }
        } catch (error) {
            return null;
        }
        return null;
    }

    static isBrowseUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return !!this.parseBrowseUrl(url);
    }

    static browseUrlToTileUrl(url) {
        const { collection, item } = this.parseBrowseUrl(url);
        return `https://${OAM_HOST}/raster/collections/${collection}/items/${item}/tiles/WebMercatorQuad/{z}/{x}/{y}?assets=visual&nodata=0`;
    }

    static parseTileUrl(url) {
        const parsed = new URL(url.replace(/[{}]/g, ''));
        const [, collection, item] = parsed.pathname.match(TILE_PATH);
        return { collection, item };
    }

    static async fetchItem(collection, item) {
        try {
            const response = await fetch(`${OAM_STAC_BASE}/collections/${collection}/items/${item}`);
            if (!response.ok) return null;
            return await response.json();
        } catch (error) {
            console.warn('[HotosmOAM] Failed to fetch STAC item:', error);
            return null;
        }
    }

    static buildAttribution(stacItem, { collection, item }) {
        const props = stacItem?.properties || {};
        const producer = props.providers?.find(p => p.roles?.includes('producer'))?.name || props['oam:producer_name'];
        const browseUrl = `${OAM_BROWSE_BASE}?selected_id=${item}`;
        const parts = [];
        if (producer) parts.push(`© ${escapeHtml(producer)}`);
        if (props.license) parts.push(escapeHtml(props.license));
        const prefix = parts.length ? `${parts.join(', ')} - via ` : '';
        const source = collection === 'openaerialmap' ? 'OpenAerialMap' : 'HOT Imagery';
        return `${prefix}<a href='${browseUrl}' target='_blank' rel='noopener noreferrer'>${source}</a>`;
    }

    static buildDescription(stacItem, { item }) {
        const props = stacItem?.properties;
        if (!props) return `Open aerial imagery from <a href='${OAM_BROWSE_BASE}?selected_id=${item}'>HOT Imagery</a>.`;
        const bits = [];
        if (props['oam:platform_type']) bits.push(PLATFORM_LABELS[props['oam:platform_type']] || escapeHtml(props['oam:platform_type']));
        if (props.gsd) bits.push(`${Math.round(props.gsd * 1000) / 10} cm/pixel`);
        const start = props.start_datetime?.slice(0, 10);
        if (start) bits.push(`captured ${start}`);
        const detail = bits.length ? ` (${bits.join(', ')})` : '';
        return `Open aerial imagery${detail} from OpenAerialMap.`;
    }

    static async createConfigFromTileUrl(url) {
        if (this.isBrowseUrl(url)) url = this.browseUrlToTileUrl(url);
        const parsed = this.parseTileUrl(url);
        const stacItem = await this.fetchItem(parsed.collection, parsed.item);
        const props = stacItem?.properties || {};
        const bbox = Array.isArray(stacItem?.bbox) && stacItem.bbox.length === 4 ? stacItem.bbox : null;
        const date = (props.start_datetime || props.datetime)?.slice(0, 10);
        const thumbnail = stacItem?.assets?.thumbnail?.href;

        return {
            id: `oam-${parsed.item}`,
            type: 'tms',
            title: props.title || 'OpenAerialMap Imagery',
            description: this.buildDescription(stacItem, parsed),
            url: toTileTemplate(url),
            style: {
                'raster-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.95, 18, 0.8, 19, 0.3]
            },
            attribution: this.buildAttribution(stacItem, parsed),
            initiallyChecked: false,
            ...(date && { date }),
            ...(bbox && { bbox }),
            ...(thumbnail && { headerImage: thumbnail })
        };
    }
}

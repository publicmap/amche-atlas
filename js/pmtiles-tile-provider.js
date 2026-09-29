import { PMTiles } from 'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm';

export default class PMTilesTileProvider {
    constructor(options) {
        this.url = options.url;
        this._archive = new PMTiles(this.url);
    }

    async load() {
        const header = await this._archive.getHeader();
        return {
            tiles: [`${this.url}#pmtiles/{z}/{x}/{y}`],
            bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
            minzoom: header.minZoom,
            maxzoom: header.maxZoom,
        };
    }

    async loadTile({ z, x, y }, { signal }) {
        const tile = await this._archive.getZxy(z, x, y, signal);
        if (!tile || !tile.data) return null;
        return { data: tile.data };
    }
}

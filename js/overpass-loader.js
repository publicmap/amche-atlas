/**
 * Fetches OSM data from an Overpass API endpoint, converts the response to
 * GeoJSON via osmtogeojson, and emits merged FeatureCollections through the
 * `onData` callback. One loader instance per `overpass` layer group.
 *
 * Viewport behavior: refetches on map moveend (debounced). A bbox-containment
 * cache skips the network call when the current viewport is already inside a
 * previously-fetched (buffered) bbox.
 */

import osmtogeojson from 'https://cdn.jsdelivr.net/npm/osmtogeojson@3.0.0-beta.5/+esm';

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';

export class OverpassLoader {
    constructor({ map, groupId, config, onData, onError }) {
        this._map = map;
        this._groupId = groupId;
        this._config = config;
        this._onData = onData;
        this._onError = onError || ((err) => console.error(`Overpass layer ${groupId}:`, err));

        this._endpoint = config.endpoint || DEFAULT_ENDPOINT;
        this._minzoom = config.minzoom ?? 0;
        this._bboxBuffer = config.bboxBuffer ?? 1.5;
        this._timeout = config.timeout ?? 25;
        this._maxFeatures = config.maxFeatures ?? 5000;
        this._debounceMs = config.debounce ?? 750;

        this._fetchedBboxes = [];
        this._features = new Map();
        this._abortController = null;
        this._debounceTimer = null;
        this._enabled = false;
        this._inflight = false;
        this._rateLimitedUntil = 0;

        this._handleMoveEnd = this._handleMoveEnd.bind(this);
    }

    start() {
        if (this._enabled) return;
        this._enabled = true;
        this._map.on('moveend', this._handleMoveEnd);
        this._scheduleFetch(0);
    }

    stop() {
        if (!this._enabled) return;
        this._enabled = false;
        this._map.off('moveend', this._handleMoveEnd);
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    destroy() {
        this.stop();
        this._features.clear();
        this._fetchedBboxes = [];
    }

    _handleMoveEnd() {
        if (!this._enabled) return;
        this._scheduleFetch(this._debounceMs);
    }

    _scheduleFetch(delay) {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            this._maybeFetch();
        }, delay);
    }

    async _maybeFetch() {
        if (!this._enabled) return;

        const zoom = this._map.getZoom();
        if (zoom < this._minzoom) return;

        if (Date.now() < this._rateLimitedUntil) return;

        const viewBbox = this._getViewportBbox();
        if (this._fetchedBboxes.some(b => containsBbox(b, viewBbox))) return;

        const fetchBbox = expandBbox(viewBbox, this._bboxBuffer);

        if (this._abortController) this._abortController.abort();
        this._abortController = new AbortController();
        this._inflight = true;

        try {
            const query = this._buildQuery(fetchBbox);
            const osmJson = await this._fetch(query, this._abortController.signal);
            const geojson = osmtogeojson(osmJson);

            let features = geojson.features || [];
            if (features.length > this._maxFeatures) {
                console.warn(`Overpass layer ${this._groupId}: ${features.length} features exceeds maxFeatures=${this._maxFeatures}, truncating`);
                features = features.slice(0, this._maxFeatures);
            }

            for (const f of features) {
                if (f.id != null) this._features.set(String(f.id), f);
            }
            this._fetchedBboxes.push(fetchBbox);

            this._onData({
                type: 'FeatureCollection',
                features: Array.from(this._features.values())
            });
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (err.isRateLimit) {
                this._rateLimitedUntil = Date.now() + err.retryAfterMs;
                console.warn(`Overpass layer ${this._groupId}: rate limited (HTTP ${err.status}), backing off ${Math.round(err.retryAfterMs / 1000)}s`);
                return;
            }
            this._onError(err);
        } finally {
            this._inflight = false;
            this._abortController = null;
        }
    }

    _getViewportBbox() {
        const b = this._map.getBounds();
        return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    }

    _buildQuery(bbox) {
        let query = (this._config.query || '').trim();
        if (!query) return '';

        // Only inject [out:json][timeout:N]; if the query has no [out:...]
        // setting block at all. Overpass-turbo wizard queries start with a
        // /* ... */ comment, so checking only the leading character would
        // double-inject and produce malformed QL.
        if (!/\[\s*out\s*:/i.test(query)) {
            query = `[out:json][timeout:${this._timeout}];${query}`;
        }

        const [w, s, e, n] = bbox;
        const center = this._map.getCenter();
        const zoom = this._map.getZoom();

        return query
            .replace(/\{\{\s*bbox\s*\}\}/g, `${s},${w},${n},${e}`)
            .replace(/\{\{\s*center\s*\}\}/g, `${center.lat},${center.lng}`)
            .replace(/\{\{\s*zoom\s*\}\}/g, zoom.toFixed(2));
    }

    async _fetch(query, signal) {
        const response = await fetch(this._endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query),
            signal
        });
        if (!response.ok) {
            if (response.status === 429 || response.status === 504) {
                const retryAfter = parseInt(response.headers.get('Retry-After'), 10);
                const retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 10000;
                const err = new Error(`Overpass HTTP ${response.status} ${response.statusText}`);
                err.isRateLimit = true;
                err.status = response.status;
                err.retryAfterMs = retryAfterMs;
                throw err;
            }
            throw new Error(`Overpass HTTP ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
}

function containsBbox(outer, inner) {
    return outer[0] <= inner[0]
        && outer[1] <= inner[1]
        && outer[2] >= inner[2]
        && outer[3] >= inner[3];
}

function expandBbox(bbox, factor) {
    const [w, s, e, n] = bbox;
    const dx = (e - w) * (factor - 1) / 2;
    const dy = (n - s) * (factor - 1) / 2;
    return [
        Math.max(-180, w - dx),
        Math.max(-90, s - dy),
        Math.min(180, e + dx),
        Math.min(90, n + dy)
    ];
}

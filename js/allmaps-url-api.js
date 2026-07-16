/**
 * Allmaps URL API Middleware
 *
 * Provides a unified interface for working with Allmaps georeferenced image
 * URLs. Recognizes the viewer, annotation, and XYZ tile URL forms — all of
 * them carry the same Allmaps image ID in an `images/<id>` path segment —
 * and resolves that ID to a Georeference Annotation Page, from which a
 * ready-to-use `tms` layer config is built.
 *
 * Usage:
 * ```javascript
 * import { AllmapsAPI } from './allmaps-url-api.js';
 *
 * const config = await AllmapsAPI.createConfigFromUrl(url);
 * ```
 */

export class AllmapsAPI {
    static isAllmapsUrl(url) {
        if (!url || typeof url !== 'string') return false;
        if (!/allmaps\.(org|xyz)/i.test(url)) return false;
        return /images\/[0-9a-f]+/i.test(url);
    }

    // The viewer (?url=...), annotation, and XYZ tile forms all carry the
    // same image ID in an "images/<id>" path segment, so one pattern covers
    // every supported URL shape without needing per-form parsing.
    static extractImageId(url) {
        if (!url) return null;
        const match = url.match(/images\/([0-9a-f]+)/i);
        return match ? match[1] : null;
    }

    static annotationsUrl(imageId) {
        return `https://annotations.allmaps.org/images/${imageId}`;
    }

    static tileUrl(imageId) {
        return `https://allmaps.xyz/images/${imageId}/{z}/{x}/{y}@2x.png`;
    }

    static async fetchAnnotationPage(imageId) {
        const apiUrl = this.annotationsUrl(imageId);
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch Allmaps metadata: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    // Control points (body.features) are the only geometry Allmaps gives us
    // per image — their extent is a reasonable stand-in for the image bbox.
    static bboxFromAnnotationPage(annotationPage) {
        const items = Array.isArray(annotationPage?.items) ? annotationPage.items : [];
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

        items.forEach(item => {
            const features = item?.body?.features || [];
            features.forEach(feature => {
                const coords = feature?.geometry?.coordinates;
                if (!Array.isArray(coords) || coords.length !== 2) return;
                const [lng, lat] = coords;
                if (typeof lng !== 'number' || typeof lat !== 'number') return;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            });
        });

        if (!isFinite(minLng) || !isFinite(minLat) || !isFinite(maxLng) || !isFinite(maxLat)) {
            return undefined;
        }
        return `${minLng},${minLat},${maxLng},${maxLat}`;
    }

    static createConfig(imageId, annotationPage) {
        const items = Array.isArray(annotationPage?.items) ? annotationPage.items : [];
        const source = items[0]?.target?.source;
        const canvas = source?.partOf?.[0];
        const manifest = canvas?.partOf?.[0];

        const title = manifest?.label?.none?.[0] || canvas?.label?.none?.[0] || `Allmaps Image ${imageId}`;

        const provider = source?.provider?.[0];
        const providerLabel = provider?.label?.none?.[0];
        const providerUrl = provider?.homepage?.[0]?.id;

        let attribution = providerLabel
            ? (providerUrl ? `<a href='${providerUrl}' target='_blank'>${providerLabel}</a>` : providerLabel)
            : '';
        attribution += attribution ? ' via ' : '';
        attribution += `<a href='https://viewer.allmaps.org/?url=${this.annotationsUrl(imageId)}' target='_blank'>Allmaps</a>`;

        const config = {
            title,
            type: 'tms',
            id: `allmaps-${imageId}`,
            url: this.tileUrl(imageId),
            style: {
                'raster-opacity': [
                    'interpolate', ['linear'], ['zoom'], 6, 0.95, 18, 0.8, 19, 0.3
                ]
            },
            attribution,
            headerImage: source?.id ? `${source.id}/full/400,/0/default.jpg` : undefined,
            bbox: this.bboxFromAnnotationPage(annotationPage),
            initiallyChecked: false
        };

        Object.keys(config).forEach(key => {
            if (config[key] === undefined) delete config[key];
        });

        return config;
    }

    static async createConfigFromId(imageId) {
        const annotationPage = await this.fetchAnnotationPage(imageId);
        return this.createConfig(imageId, annotationPage);
    }

    static async createConfigFromUrl(url) {
        const imageId = this.extractImageId(url);
        if (!imageId) {
            throw new Error('Could not extract an Allmaps image ID from URL');
        }

        return this.createConfigFromId(imageId);
    }
}

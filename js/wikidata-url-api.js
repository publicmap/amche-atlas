/**
 * Wikidata / Wikimedia Commons URL API Middleware
 *
 * Resolves a Wikidata QID (e.g. from an OSM `wikidata=*` tag) into a plain
 * label/description pair and a representative header image — used by
 * js/osm-url-api.js to enrich a feature's layer description and headerImage.
 *
 * Usage:
 * ```javascript
 * import { WikidataAPI } from './wikidata-url-api.js';
 *
 * const summary = await WikidataAPI.getSummary('Q64');
 * ```
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

export class WikidataAPI {
    static isQid(value) {
        return typeof value === 'string' && /^Q\d+$/i.test(value.trim());
    }

    // Special:FilePath redirects straight to the current version of a Commons
    // file, so a filename from a claim can be used directly as an <img src>.
    static commonsFilePath(filename) {
        if (!filename) return undefined;
        return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;
    }

    // P948 (page banner) is purpose-made wide header art; fall back to P18
    // (image), the generic photo most items have, when no banner exists.
    static imageFromClaims(claims) {
        const bannerFile = claims?.P948?.[0]?.mainsnak?.datavalue?.value;
        if (bannerFile) return this.commonsFilePath(bannerFile);

        const imageFile = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if (imageFile) return this.commonsFilePath(imageFile);

        return undefined;
    }

    static async fetchEntity(qid) {
        const url = `${WIKIDATA_API}?action=wbgetentities&ids=${encodeURIComponent(qid)}` +
            `&props=labels%7Cdescriptions%7Cclaims&languages=en&format=json&origin=*`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Wikidata HTTP ${response.status}`);
        }
        const data = await response.json();
        const entity = data.entities?.[qid];
        if (!entity || entity.missing !== undefined) {
            throw new Error(`Wikidata entity ${qid} not found`);
        }
        return entity;
    }

    static async getSummary(qid) {
        const entity = await this.fetchEntity(qid);
        return {
            title: entity.labels?.en?.value || qid,
            description: entity.descriptions?.en?.value,
            headerImage: this.imageFromClaims(entity.claims)
        };
    }
}

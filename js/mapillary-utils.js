/**
 * Shared Mapillary Graph API helpers used by both `config/mapillary.js`
 * (click-to-nearest-image on a coverage line) and `js/streetview-control.js`
 * (map-center-to-nearest-image for the toolbar Street View button).
 */

export const MAPILLARY_ACCESS_TOKEN = 'MLY|8622412231200477|66830abef280d6a3194896f742927e78';

/**
 * A sequence's line geometry is dissolved into a single tile feature carrying
 * just one `image_id`, so every click along the same tiled segment resolves
 * to that one reference image regardless of where on the line it lands. To
 * open the image actually nearest a point, search by location instead and
 * pick the closest result by geometry.
 *
 * Mapillary's Graph API rejects `sequence_ids` combined with `lat`/`lng`
 * outright ("Incompatible filters") regardless of whether the id is valid,
 * so there's no way to narrow this location search to a single sequence in
 * one request - it always searches by location alone.
 */
export async function resolveNearestImageId({ lng, lat }) {
    const params = new URLSearchParams({
        access_token: MAPILLARY_ACCESS_TOKEN,
        fields: 'id,geometry',
        lat: String(lat),
        lng: String(lng),
        radius: '30',
        limit: '10'
    });

    const response = await fetch(`https://graph.mapillary.com/images?${params.toString()}`);
    if (!response.ok) throw new Error(`Mapillary image lookup failed (${response.status})`);
    const data = await response.json();
    const results = (data && data.data) || [];
    if (!results.length) return null;

    let best = null;
    let bestDist = Infinity;
    for (const result of results) {
        const coords = result.geometry && result.geometry.coordinates;
        if (!coords) continue;
        const dist = Math.hypot(coords[0] - lng, coords[1] - lat);
        if (dist < bestDist) {
            bestDist = dist;
            best = result;
        }
    }
    return String((best || results[0]).id);
}

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
 * open the image actually nearest a point, search by location instead
 * (optionally narrowed to a sequence via `sequence_ids`), and pick the
 * closest result by geometry.
 */
export async function resolveNearestImageId({ lng, lat, sequenceId }) {
    const search = async (withSequence) => {
        const params = new URLSearchParams({
            access_token: MAPILLARY_ACCESS_TOKEN,
            fields: 'id,geometry',
            lat: String(lat),
            lng: String(lng),
            radius: '30',
            limit: '10'
        });
        if (withSequence && sequenceId) params.set('sequence_ids', sequenceId);

        const response = await fetch(`https://graph.mapillary.com/images?${params.toString()}`);
        if (!response.ok) throw new Error(`Mapillary image lookup failed (${response.status})`);
        const data = await response.json();
        return (data && data.data) || [];
    };

    let results = await search(true);
    if (!results.length && sequenceId) results = await search(false);
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

/**
 * ============================================================================
 * Mapillary Atlas - Layer Inspection Handlers
 * ============================================================================
 *
 * Resolves the image nearest a mapillary-coverage / mapillary-coverage-photos
 * click and opens it in the standalone Street View panel (js/streetview-
 * control.js + streetview.html), rather than embedding a viewer inline in the
 * popup.
 * ============================================================================
 */

import { resolveNearestImageId } from '../js/mapillary-utils.js';

/**
 * Vector tiles use `promoteId` to turn the `id`/`image_id` property into each
 * feature's stable `feature.id`. When a sequence's dissolved LineString gets
 * split into multiple tile-local sub-features sharing that same property
 * value, Mapbox GL disambiguates them by appending `:1`, `:2`, ... to the
 * *property* value itself - so the raw property can come back as e.g.
 * `"g1hcoFQLp5X26CvidyRtOe:1"` instead of the real Mapillary id. Strip it
 * before using the value as an image id anywhere.
 */
function baseId(value) {
    if (value == null) return null;
    return String(value).split(':')[0];
}

export const handlers = {

    /**
     * Opens the Street View panel for the clicked feature: the exact photo
     * when clicking a mapillary-coverage-photos point (its `id` *is* the
     * image id), otherwise the image nearest the click on a
     * mapillary-coverage line.
     * Used by: mapillary-coverage, mapillary-coverage-photos
     */
    openMapillaryViewer: async ({ feature, lngLat, layerConfig }) => {
        let imageId = null;

        if (layerConfig?.sourceLayer === 'image') {
            const pointId = baseId(feature?.properties?.id);
            if (pointId && /^\d+$/.test(pointId)) imageId = pointId;
        }

        if (!imageId) {
            const lng = Number(lngLat?.lng);
            const lat = Number(lngLat?.lat);
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
                try {
                    imageId = await resolveNearestImageId({ lng, lat });
                } catch (error) {
                    console.error('[Mapillary] Nearest-image lookup failed:', error);
                }
            }
            if (!imageId) {
                const fallbackImageId = baseId(feature?.properties?.image_id);
                if (fallbackImageId && /^\d+$/.test(fallbackImageId)) imageId = fallbackImageId;
            }
        }

        if (window.streetviewControl) {
            window.streetviewControl.open({ imageId });
        }

        return `
            <div style="border: 1px solid #374151; border-radius: 4px; margin: 8px 0; overflow: hidden; background: #111827;">
                <div style="padding: 4px 8px; font-size: 10px; font-weight: 600; color: #9ca3af; letter-spacing: 0.06em; border-bottom: 1px solid #374151; display: flex; align-items: center; gap: 5px;">
                    <sl-icon name="camera" style="font-size: 12px;"></sl-icon>
                    <a href="https://www.mapillary.com/" target="_blank" style="color: #9ca3af; text-decoration: none;" onmouseover="this.style.color='#e5e7eb'" onmouseout="this.style.color='#9ca3af'">Mapillary</a>
                </div>
                <div style="padding: 8px; font-size: 11px; color: #9ca3af; line-height: 1.5;">
                    ${imageId
                        ? 'Opened in the Street View panel (top-left camera icon).'
                        : `No nearby imagery. <a href="https://www.mapillary.com/app" target="_blank" style="color: #9ca3af; text-decoration: underline;">Browse coverage elsewhere</a> or <a href="https://www.mapillary.com/download" target="_blank" style="color: #9ca3af; text-decoration: underline;">capture some yourself</a>.`}
                </div>
            </div>
        `;
    }

};

/**
 * ============================================================================
 * CONFIGURATION REFERENCE:
 * ============================================================================
 *
 * This file (config/mapillary.js) contains handlers for the Mapillary atlas.
 *
 * To use this handler in mapillary.atlas.json, add to a layer's inspect property:
 *
 * {
 *   "id": "mapillary-coverage",
 *   "inspect": {
 *     "id": "id",
 *     "label": "id",
 *     "onClick": "openMapillaryViewer"
 *   }
 * }
 *
 * Available functions:
 * - openMapillaryViewer: Resolves the image id for the clicked feature
 *   (exact for mapillary-coverage-photos points, nearest-search via
 *   js/mapillary-utils.js's resolveNearestImageId() for mapillary-coverage
 *   lines) and calls window.streetviewControl.open({ imageId }) to show it in
 *   the standalone Street View panel (js/streetview-control.js +
 *   streetview.html) instead of rendering a viewer inline in the popup. Not
 *   wired up on mapillary-map-features/mapillary-traffic-signs — those point
 *   detections have no associated image.
 *
 * ============================================================================
 */

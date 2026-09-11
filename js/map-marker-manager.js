/**
 * MapMarkerManager - Manages selection markers on the map
 * Creates markers at selection locations with badges showing selected features
 */
import { LayerThumbnail } from './layer-thumbnail.js';
import { reverseGeocodeAddress, fetchNominatimAddressParts } from './nominatim-search.js';
import { FeatureDisplayRenderer } from './feature-display-renderer.js';
import { LayerOrderManager } from './layer-order-manager.js';
import { CameraUtils } from './map-camera-utils.js';
import { GeoLibreAPI } from './geolibre-api.js';
import { MapContextMessagesControl } from './map-context-messages-control.js';
import { formatAttributeValue } from './attribute-value-renderer.js';
import { sanitizeId, isValidId, nextSerialId, labelToId, uniqueId, sanitizeRouteRefPrefix, isValidRouteRefId } from './shorthand-id-utils.js';
import * as markerRegistry from './marker-registry.js';
import { WAYPOINT_PIN_COLOR } from './search/route-store.js';

// How long to ignore map clicks after a touch marker/balloon drag ends. Covers
// the browser's phantom click (fired from touch-to-mouse-event emulation,
// which mapbox-gl's Marker never suppresses — see `_suppressClickUntil` in
// MapFeatureStateManager) plus this app's own 60ms touchend tap-fallback timer.
const MARKER_DRAG_CLICK_SUPPRESS_MS = 400;

// Nominatim's usage policy: no more than one request a second per origin.
const ADDRESS_LOOKUP_GAP_MS = 1100;

// Gap between the id label and the actions beside it.
const MARKER_ACTION_ROW_GAP = 4;

// How far the panel sits from the point it describes, leaving room for the
// leader line that joins the two (see _syncMarkerLeader).
const MARKER_ANCHOR_GAP = 16;

// The panel's rounded corners - all but the one the leader line meets, which is
// squared off so the line reads as running into the panel.
const MARKER_CORNER_RADIUS = 8;

// Half-extent of the leader line's drawing surface, centred on the point. The
// panel can be dragged to either side of the point, so the line has to be able
// to run in any direction - and an outermost <svg> does not reliably paint
// outside its own viewport, `overflow: visible` or not. So the surface is big
// enough to contain any drag instead, with the point at its centre.
const MARKER_LEADER_EXTENT = 1200;

// How wide the leader is where it meets the panel. It tapers to nothing at the
// point itself, so the join reads as a speech-bubble tail rather than a wire.
const MARKER_LEADER_WIDTH = 4;

// How wide the tail's invisible grab area is - a 4px triangle is too fine to
// aim at, so it is stroked transparently out to something a pointer can hit.
const MARKER_LEADER_GRAB = 12;

// How far inside the panel the tail's base sits. The panel paints over the tail
// (it comes later in the DOM and is positioned), so tucking the base under the
// corner hides the base's own corners: the tail reads as emerging from the
// panel's edge rather than as a triangle parked against it.
const MARKER_LEADER_INSET = 3;

// The panel's surface, shared with the tail that carries it back to its point so
// the two read as one callout. Matches .shortcut-menu (see css/styles.css),
// since a marker panel is the same kind of surface. Translucent so the map
// underneath still reads through a collapsed chip - MARKER_PANEL_BG_ACTIVE
// (see _syncMarkerContent) opts a selected/hovered/edited panel into a more
// opaque fill instead, since that's the one actually being read.
const MARKER_PANEL_BG_RGB = '31, 41, 55'; // #1f2937
const MARKER_PANEL_BG = `rgba(${MARKER_PANEL_BG_RGB}, 0.7)`;
const MARKER_PANEL_BG_ACTIVE = `rgba(${MARKER_PANEL_BG_RGB}, 0.9)`;
const MARKER_PANEL_BORDER = '#374151';
// Separator between rows inside the panel (see _buildMarkerSummaryHTML) -
// translucent black rather than MARKER_PANEL_BORDER's fixed gray, which reads
// lighter than the panel's own translucent fill wherever it sits over a dark
// map. Black-with-alpha only ever darkens whatever is behind it, so it stays
// a shade below the panel's fill regardless of what that fill is blended over.
const MARKER_ROW_BORDER = 'rgba(0, 0, 0, 0.35)';

// The panel's resting shadow - unaffected by hover/selection, see MARKER_GLOW_FILTER below.
const MARKER_PANEL_SHADOW = '0 4px 16px rgba(0, 0, 0, 0.35)';

// Hover/selected halo, the same yellow used for a hovered/selected feature
// everywhere else in the app (see the feature-state "hover"/"selected" colors
// in config/_defaults.json), so a marker being read glows the same way the
// feature it describes would.
//
// Applied as a `filter` on the marker element as a whole - the panel and the
// tail together - rather than as a `box-shadow` on the panel alone. The tail
// is a separate sibling that the panel already paints over (see
// _buildMarkerLeaderHTML's comment on MARKER_LEADER_INSET), so a box-shadow
// on the panel alone would sit in front of the tail and cut across it right
// where they meet. A `filter` is computed from the rendered result of the
// whole element it's applied to - tail and panel together, exactly as
// stacked - and painted behind that result, so the glow reads as one outline
// around the combined silhouette with the tail sitting in front of it, the
// same as everything else. Layered at two tight radii - a thin crisp edge
// plus a touch of soft falloff - so it reads as a subtle shadow rather than
// a glow.
const MARKER_GLOW_FILTER = [
    'drop-shadow(0 0 1px rgba(255, 255, 0, 0.8))',
    'drop-shadow(0 0 2px rgba(255, 255, 0, 0.4))'
].join(' ');

// Height of the id header row, used to place things that sit below it without
// having to measure a marker that may not be laid out yet. Approximate, like
// the row itself: the header's own padding (see _buildMarkerMenuHeaderHTML)
// matches .shortcut-menu-item's 8px/10px so the label reads at the same size
// as the feature rows beneath it.
const MARKER_ID_ROW_HEIGHT = 36;

// What the panel widens to once it opens into a menu. Matches .shortcut-menu's
// own min-width (css/styles.css) so the two read as the same kind of surface.
const MARKER_MENU_MIN_WIDTH = 220;

// Cap on the marker menu body's height once it's open, so a marker with many
// selected features (or one with its accordion details expanded) scrolls
// internally instead of growing past the edge of the viewport - vh-relative
// so it adapts to a small/mobile screen, with a pixel ceiling so it doesn't
// stretch absurdly tall on a big desktop display.
const MARKER_BODY_MAX_HEIGHT = 'min(60vh, 420px)';

// Mapbox gives marker elements no z-index of their own, so they stack in DOM
// order and a marker added later covers one added earlier. The one being read
// comes forward instead: hover wins over selection, so the marker actually
// under the pointer is always the one on top.
const MARKER_Z_HOVERED = 3;
const MARKER_Z_SELECTED = 2;

/**
 * How a `markers=` id reads on screen. Ids allow no spaces (see
 * shorthand-id-utils.js), so a name that had them is stored with underscores -
 * but "Assagao_Survey_17_1" is the storage form, not the name. Everywhere the
 * id is shown, and while it is being edited, underscores read as the spaces
 * they stand for; sanitizeId turns them back on the way in.
 */
function idToLabel(urlId) {
    return String(urlId ?? '').replace(/_/g, ' ');
}

// Shown on the id badge in place of the real id until a fresh marker (a plain
// auto-numbered "1", "2", ... - see nextSerialId) is named for the first time.
// Also the signal _attachMarkerIdRowHandlers reads to let a single click open
// the editor directly, instead of the usual two-step arm-then-edit.
const MARKER_ID_PLACEHOLDER = 'Click to save label';
// The id badge's text color: muted while it is still showing the placeholder
// above, back to full brightness once it reads as a real name - see
// _buildMarkerMenuHeaderHTML's first render and endEdit's after-the-fact one.
const MARKER_ID_TEXT_COLOR = '#f3f4f6';
const MARKER_ID_MUTED_COLOR = '#6b7280';
// The id input's border at rest, and while its current text collides with
// another marker's id (see _attachMarkerIdRowHandlers's syncValidity).
const MARKER_ID_INPUT_BORDER = '#374151';
const MARKER_ID_ERROR_COLOR = '#ef4444';

/**
 * Which of a panel's corners faces its point, from where the panel has been
 * dragged to. The offset is that corner's position relative to the panel's
 * resting place beside the point, so a negative x means the panel lies to the
 * left of it - and the corner facing back is the opposite one.
 *
 * Only the two top corners are candidates, so a panel always grows downwards
 * from the corner its leader meets, whichever side of the point it sits on
 * (see _syncMarkerLeader).
 */
function anchorFromOffset({ x = 0 } = {}) {
    return x < 0 ? 'top-right' : 'top-left';
}

// Width ceiling for the balloon and its id badge, whether collapsed to a chip
// or expanded into a menu (see labelStyle in _buildMarkerMenuHeaderHTML and
// _syncMarkerContent) - past it, a long id (a search-result one can run to 64
// characters, see shorthand-id-utils.labelToId) wraps onto another line
// rather than ellipsising or running off across the map.
const MARKER_ID_MAX_WIDTH = 240;

// Wider ceiling for the balloon while the id is actively being edited: the
// header row also has to fit the save/delete/options buttons and the input's
// own clear icon alongside the textarea, which the ordinary MARKER_ID_MAX_WIDTH
// leaves it no room for (it works out to a textarea with no headroom to grow
// into at all before wrapping).
const MARKER_ID_EDIT_MAX_WIDTH = 320;

// The id textarea's own max-width, sized to fit comfortably inside a balloon
// capped at MARKER_ID_EDIT_MAX_WIDTH alongside the header row's other
// furniture (the save/delete/options buttons and their gaps) - see
// _buildMarkerMenuHeaderHTML. Content-box (see "does not let padding eat into
// either label box" in map-marker-popup.test.js), so this is purely the text
// area itself - the icon-reserving padding-right and the rest of the
// textarea's own padding/border sit outside of it.
const MARKER_ID_INPUT_MAX_WIDTH = 190;

// `data-badge-index` for the address row - the one summary chip shown when
// nothing was selected here (see _buildMarkerSummaryHTML). Real features index
// from 0, and -1 belonged to the coordinates badge that the address's own
// $coordinates field replaced, so the address takes -2.
const ADDRESS_BADGE_INDEX = -2;


export class MapMarkerManager {
    constructor(map, stateManager, mapboxAPI = null) {
        this._map = map;
        this._stateManager = stateManager;
        this._mapboxAPI = mapboxAPI;
        this._markers = new Map();
        this._hoverMarker = null;
        this._currentMarkerIndex = 0;
        // Set while a rebuild re-queries a point through the selection pipeline,
        // so that pass doesn't clear the markers around it (see
        // _clearUnsavedMarkers).
        this._suppressReplaceClear = false;
        this._isMapMoving = false;
        this._isProgrammaticZoom = false; // Track programmatic zooms
        this._selectionLayerId = 'selection'; // Layer ID for selection markers
        this._selectedBadges = new Set(); // Expanded (selected) feature badges
        // Marker select mode: the marker last clicked or created (see _selectMarker).
        this._selectedMarkerId = null;
        // Identity a dragged marker hands to the marker replacing it (see
        // _handleMarkerDragEnd), since that rebuild goes through the generic
        // selection pipeline and can't be passed options directly.
        this._adoptedIdentity = null;
        this._isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        this._markerAddedListeners = new Set();

        this._setupEventListeners();
        this._setupMapMovementTracking();
    }

    /**
     * Set the MapboxAPI reference (can be called after construction)
     */
    setMapboxAPI(mapboxAPI) {
        this._mapboxAPI = mapboxAPI;
    }

    /**
     * Notified as `(markerId, lngLat)` whenever addMarker() creates a marker,
     * regardless of what triggered it (feature click, empty-map click,
     * programmatic call). Used by map-nearby-features-control.js's "Choose
     * from Map" waypoint option to bind the next marker the user places to a
     * route endpoint.
     */
    onMarkerAdded(callback) {
        this._markerAddedListeners.add(callback);
    }

    offMarkerAdded(callback) {
        this._markerAddedListeners.delete(callback);
    }

    /**
     * Focus belongs to the marker you are working with, so a press anywhere that
     * isn't a marker gives it up - otherwise the last marker created stays open
     * for the rest of the session. Capture phase, and on the press rather than
     * the click, so this lands before whatever that press goes on to do: a map
     * click that drops a new marker still selects that one afterwards.
     */
    _setupOutsidePressListener() {
        if (this._onOutsidePress) return;
        this._onOutsidePress = (e) => {
            if (!this._selectedMarkerId) return;
            if (e.target.closest?.('.selection-marker')) return;
            // The shortcut menu (route-from/route-to among its items) lives
            // outside the marker's own DOM, so a press on it would otherwise
            // read as "outside" and deselect - discarding an unsaved marker
            // (see _syncMarkerContent) before its own click handler ever runs.
            if (e.target.closest?.('.shortcut-menu')) return;
            this._selectMarker(null);
        };
        document.addEventListener('mousedown', this._onOutsidePress, true);
        document.addEventListener('touchstart', this._onOutsidePress, true);
    }

    _setupEventListeners() {
        this._setupOutsidePressListener();

        this._stateManager.addEventListener('state-change', (event) => {
            const { eventType, data } = event.detail;

            if (eventType === 'feature-click' || eventType === 'feature-click-multiple' || eventType === 'empty-map-click') {
                console.log('[TapDebug] markerManager received', { eventType, isTouch: this._isTouch });
            }

            if (eventType === 'feature-click' || eventType === 'feature-click-multiple') {
                this._handleSelection(data);
            }

            if (eventType === 'empty-map-click') {
                this._handleEmptyMapClick(data);
            }

            if (eventType === 'features-batch-hover') {
                this._handleBatchHover(data);
            }

            if (eventType === 'map-mouse-leave') {
                this._clearHoverMarker();
                this._clearAllMarkerHoverStates();
            }

            if (eventType === 'selections-cleared') {
                this.clearAllMarkers();
            }

            if (eventType === 'selection-cleared') {
                const clearedLayerId = data.layerId;
                this._markers.forEach((markerData) => {
                    markerData.features = markerData.features.filter(f => f.layerId !== clearedLayerId);
                });
                this._updateSelectionLayer();
            }
        });

    }

    _setupMapMovementTracking() {
        this._map.on('movestart', () => {
            this._isMapMoving = true;
        });

        this._map.on('moveend', () => {
            this._isMapMoving = false;
        });

        // A dragged panel keeps a fixed pixel offset from its marker (see
        // _attachBalloonDragHandler), and the marker element is what mapbox
        // moves - so the panel follows through every pan and zoom on its own,
        // with nothing to recompute here.
    }

    /**
     * Moves a marker's panel clear of its default position by a pixel offset
     * from the point it describes, and records that offset - on the marker, and
     * in the registry `?markers=` is built from (marker-registry.js), so a link
     * carries a marker's arrangement and not just its location.
     *
     * Pixels rather than a map location: the panel is part of the marker's own
     * furniture, so it should hold its place beside it at every zoom. Anchoring
     * the panel to a second lngLat instead made it drift away from its marker as
     * the scale changed, which is not what dragging it there meant.
     */
    _setMarkerPanelOffset(markerData, dx, dy, { anchor = null } = {}) {
        const offset = { x: Math.round(dx), y: Math.round(dy) };
        markerData.panelOffset = offset;
        // The anchor only changes when something decides it has (a restore, or
        // _rebasePanelAnchor after a drag) - deriving it here would make that
        // decision unobservable, since the offset it is derived from has just
        // been written.
        if (anchor) markerData.panelAnchor = anchor;
        this._applyPanelTransform(markerData);

        const entry = markerRegistry.get(markerData.urlId);
        if (entry) markerRegistry.set(markerData.urlId, { ...entry, offset });
    }

    /**
     * Places the panel so its *anchored* corner - the one the leader line meets -
     * sits at the stored offset, by shifting the box off that corner with a
     * percentage translate.
     *
     * Percentages are of the element's own size, so the browser re-resolves them
     * as the panel grows: opening the menu expands it away from the anchor
     * rather than dragging that corner off the point. Since the anchor is always
     * a top corner, a panel grows downwards - leftwards or rightwards depending
     * on which side of the point it sits.
     */
    _applyPanelTransform(markerData) {
        if (!markerData.contentEl) return;
        const { x, y } = markerData.panelOffset || { x: 0, y: 0 };
        const anchor = markerData.panelAnchor || 'top-left';
        const shiftX = anchor.endsWith('right') ? '-100%' : '0';
        markerData.contentEl.style.transform =
            `translate(${x}px, ${y}px) translate(${shiftX}, 0)`;
    }

    /**
     * Re-bases the stored offset when a drag moves the panel across its point,
     * so that switching which corner is anchored doesn't make the panel jump:
     * the offset is now measured from the opposite edge, so it has to move by
     * the panel's own width to describe the same place.
     */
    _rebasePanelAnchor(markerData) {
        const offset = markerData.panelOffset;
        if (!markerData.contentEl || !offset) return;

        const next = anchorFromOffset(offset);
        const prev = markerData.panelAnchor || 'top-left';
        if (next === prev) return;

        const { width } = markerData.contentEl.getBoundingClientRect();
        const x = offset.x + (next.endsWith('right') ? width : -width);

        this._setMarkerPanelOffset(markerData, x, offset.y, { anchor: next });
    }

    /** Puts a restored panel back where the link left it. */
    _applyStoredPanelOffset(markerId) {
        const markerData = this._markers.get(markerId);
        const offset = markerRegistry.get(markerData?.urlId)?.offset;
        if (!markerData || !markerData.contentEl || !offset) return;
        if (!offset.x && !offset.y) return;

        // A link records the anchored corner's offset, so which corner it was is
        // read straight back off the sign of that offset.
        this._setMarkerPanelOffset(markerData, offset.x, offset.y, { anchor: anchorFromOffset(offset) });
        this._syncMarkerLeader(markerData.marker.getElement());
    }

    /**
     * Get active layers that are in current view
     */
    _getActiveLayersInView() {
        if (!window.layerControl?._state?.groups) {
            return [];
        }

        const currentBounds = this._map.getBounds();
        const bounds = [
            currentBounds.getWest(),
            currentBounds.getSouth(),
            currentBounds.getEast(),
            currentBounds.getNorth()
        ];

        // Get active layers
        const activeLayers = [];
        window.layerControl._state.groups.forEach((group, index) => {
            const isActive = this._isLayerActive(index);
            if (isActive && group.id) {
                activeLayers.push(group);
            }
        });

        // Filter by view using MapUtils if available
        if (window.MapUtils) {
            return activeLayers.filter(layer => {
                // Check if layer has bbox
                if (!layer.bbox && layer._sourceAtlas && window.layerRegistry) {
                    const atlasMetadata = window.layerRegistry._atlasMetadata?.get(layer._sourceAtlas);
                    if (atlasMetadata?.bbox) {
                        const layerWithAtlasBbox = { ...layer, bbox: atlasMetadata.bbox };
                        return window.MapUtils.isLayerInView(layerWithAtlasBbox, bounds);
                    }
                }
                return window.MapUtils.isLayerInView(layer, bounds);
            });
        }

        return activeLayers;
    }

    /**
     * Check if a layer is currently active
     */
    _isLayerActive(groupIndex) {
        if (!window.layerControl?._sourceControls?.[groupIndex]) {
            return false;
        }

        const $groupControl = $(window.layerControl._sourceControls[groupIndex]);
        const $toggle = $groupControl.find('.toggle-switch input[type="checkbox"]');
        return $toggle.length > 0 && $toggle.prop('checked');
    }

    /**
     * Get all active layers in the same order as inspector display
     */
    _getAllActiveLayersInInspectorOrder() {
        const activeLayers = this._getActiveLayerConfigs();
        const { overlays, basemaps } = LayerOrderManager.getInspectorDisplayOrder(activeLayers);
        return [...overlays, ...basemaps];
    }

    /**
     * Active layer configs, preferring MapFeatureControl's visibility check
     * over the plain checkbox check below. That check falls back to reading
     * actual map layer visibility for `style`/`raster-style-layer` layers
     * (e.g. basemap imagery), which don't necessarily expose a checkbox at a
     * stable index in `_sourceControls`, so relying on the checkbox alone
     * under-counts active layers here.
     */
    _getActiveLayerConfigs() {
        if (window.featureControl?._getActiveLayersFromConfig) {
            return Array.from(window.featureControl._getActiveLayersFromConfig().values()).map(d => d.config);
        }

        if (!window.layerControl?._state?.groups) return [];
        const activeLayers = [];
        window.layerControl._state.groups.forEach((group, index) => {
            if (this._isLayerActive(index) && group.id) {
                activeLayers.push(group);
            }
        });
        return activeLayers;
    }

    _handleSelection(data) {
        // Selections restored from a shared URL already had their markers created by
        // restoreMarkersFromSelectionLayer; this event only notifies other listeners
        // (e.g. map-browser.html), so don't re-create the markers here.
        if (data.fromMarkerRestore) return;

        const features = data.selectedFeatures || [data];
        const lngLat = features[0]?.lngLat;

        if (!lngLat) {
            console.log('[TapDebug] _handleSelection bail: no lngLat', { features });
            return;
        }
        console.log('[TapDebug] _handleSelection -> addMarker', { lngLat, featureCount: features.length });

        // Clear hover marker and marker hover states on selection
        this._clearHoverMarker();
        this._clearAllMarkerHoverStates();

        this._clearUnsavedMarkers();
        this.addMarker(lngLat, features);
    }

    _handleEmptyMapClick(data) {
        const { lngLat } = data;
        if (!lngLat) {
            console.log('[TapDebug] _handleEmptyMapClick bail: no lngLat');
            return;
        }
        console.log('[TapDebug] _handleEmptyMapClick -> addMarker', { lngLat });

        // Clear hover marker and marker hover states on selection
        this._clearHoverMarker();
        this._clearAllMarkerHoverStates();

        this._clearUnsavedMarkers();
        // Empty features array — the marker shows layer info only.
        this.addMarker(lngLat, []);
    }

    /**
     * Dropping a marker replaces the last one, so the map doesn't fill up with
     * every point you looked at - but a marker whose id has been saved is one
     * you named on purpose, so it stays. That is what replaced the old explicit
     * "Multi Select" mode: keeping a marker is now something you say about that
     * marker, not a mode you have to be in beforehand.
     *
     * A drag re-queries its own drop point through this same path, so it sets
     * `_suppressReplaceClear` to keep its neighbours out of it.
     */
    _clearUnsavedMarkers() {
        if (this._suppressReplaceClear) return;

        [...this._markers.entries()]
            .filter(([, markerData]) => !markerData.saved)
            .forEach(([id]) => this.removeMarker(id, { silent: true }));
    }

    _handleBatchHover(data) {
        // Touch devices have no cursor, so this used to be driven by a center-of-screen
        // query that showed an inspect popup there. The draggable inspect marker now
        // covers that use case directly, so hover popups are desktop-only.
        if (this._isTouch) {
            return;
        }

        // Don't update hover markers during map movement (pan/zoom).
        if (this._isMapMoving) {
            return;
        }

        // A marker being repositioned carries its own panel with it, and the
        // drop re-queries the point into that panel - so a hover popup trailing
        // the pointer would only say the same thing twice. The features beneath
        // it still highlight (see _handleMarkerDrag); it is just the popup that
        // has nothing to add.
        if (this._draggingMarkerId) {
            this._clearHoverMarker();
            return;
        }

        // Pointer is over an existing inspect marker (buttons or badges) — those
        // capture the interaction, so don't show a redundant hover popup.
        if (this._pointerOverMarker) {
            this._clearHoverMarker();
            return;
        }

        const hoveredFeatures = data.hoveredFeatures || [];

        if (!hoveredFeatures || hoveredFeatures.length === 0) {
            this._clearHoverMarker();
            this._clearAllMarkerHoverStates();
            return;
        }

        const lngLat = data.lngLat || hoveredFeatures[0]?.lngLat;

        if (!lngLat) {
            this._clearHoverMarker();
            this._clearAllMarkerHoverStates();
            return;
        }

        // Drop hovered features that already have an inspect marker — re-showing them
        // in a hover popup is redundant.
        const markedKeys = new Set();
        this._markers.forEach(markerData => {
            markerData.features.forEach(f => markedKeys.add(`${f.layerId}:${f.featureId}`));
        });
        const freshFeatures = hoveredFeatures.filter(f => !markedKeys.has(`${f.layerId}:${f.featureId}`));

        if (freshFeatures.length === 0) {
            // Everything under the cursor is already marked — highlight the marker
            // instead of showing a redundant hover popup.
            this._clearHoverMarker();
            const matchingMarker = this._findMarkerByFeatures(hoveredFeatures);
            if (matchingMarker) {
                this._setMarkerHoverState(matchingMarker.id, true);
            }
            return;
        }

        // Show hover popup only for the not-yet-marked features.
        this._clearAllMarkerHoverStates();

        const labels = freshFeatures.map(f => {
            const layerConfig = this._stateManager.getLayerConfig(f.layerId);
            const inspectConfig = layerConfig?.inspect || {};
            const labelField = inspectConfig.label || inspectConfig.id || 'id';
            return f.feature.properties?.[labelField] || f.featureId;
        });
        const labelText = labels.join(', ');

        this._showHoverMarker(lngLat, labelText, freshFeatures);
    }

    _truncateName(value, max = 50) {
        const s = String(value ?? '');
        return s.length > max ? `${s.slice(0, max)}...` : s;
    }

    _escapeAttr(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _getBadgeLabelInfo(f) {
        const layerConfig = this._stateManager.getLayerConfig(f.layerId);
        const inspectConfig = layerConfig?.inspect || {};
        const labelField = inspectConfig.label || inspectConfig.id || 'id';
        const value = f.feature?.properties?.[labelField] ?? f.featureId;
        return { fieldName: inspectConfig.title || inspectConfig.label || labelField, value };
    }

    _createFeatureBadgeHTML(fieldName, value, index, f) {
        const display = this._truncateName(value, 50);
        const detailsHTML = f ? this._buildBadgeAttributeTable(f) : '';
        return `
            <div class="feature-badge" data-badge-index="${index}" title="${this._escapeAttr(value)}" style="
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                width: 100%;
                box-sizing: border-box;
                background: transparent;
                border-radius: 5px;
                padding: 4px 8px;
                cursor: pointer;
                transition: background 0.15s, opacity 0.15s;
            ">
                <div class="feature-badge-header" style="display: flex; flex-direction: row; align-items: center; gap: 4px; width: 100%;">
                    <div style="display: flex; flex-direction: column; align-items: flex-start; width: 100%; min-width: 0;">
                        <span style="font-size: 8px; line-height: 1.1; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; min-width: 0;">${this._escapeAttr(fieldName)}</span>
                        <span class="badge-value" data-full="${this._escapeAttr(value)}" data-short="${this._escapeAttr(display)}" style="font-size: 11px; line-height: 1.2; font-weight: 700; color: #f3f4f6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; min-width: 0;">${this._escapeAttr(display)}</span>
                    </div>
                </div>
                ${detailsHTML}
            </div>
        `;
    }

    /**
     * A "Locating…" placeholder shown in place of a feature badge for a layer whose
     * query hasn't resolved yet (see MapMarkerManager.restoreMarkersFromSelectionLayer).
     * Not a `.feature-badge` — has no backing feature, so it's excluded from
     * _attachBadgeHandlers' click/hover wiring without any special-casing there.
     */
    _createPendingLayerBadgeHTML(layerId) {
        const layerConfig = this._stateManager.getLayerConfig(layerId);
        const title = layerConfig?.title || layerId;
        return `
            <div class="pending-layer-badge" style="
                display: flex;
                align-items: center;
                gap: 6px;
                width: 100%;
                box-sizing: border-box;
                border-radius: 5px;
                padding: 4px 8px;
                opacity: 0.7;
            ">
                <sl-spinner style="font-size: 10px; --indicator-color: #9ca3af;"></sl-spinner>
                <span style="font-size: 10px; font-weight: 600; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this._escapeAttr(title)}: Locating…</span>
            </div>
        `;
    }

    /**
     * Build the collapsible attribute table shown when a badge is selected.
     * Uses the layer's field-selection config (inspect.fields / fieldTitles,
     * falling back to all non-empty properties), styled to match the yellow badge.
     */
    _buildBadgeAttributeTable(f) {
        if (!f || !f.feature) return '';

        return `<div class="feature-badge-details" ${this._featureHandlerAttrs(f)} style="display:none;width:100%;margin-top:3px;border-top:1px solid #374151;padding-top:3px;max-height:180px;overflow-y:auto;">` +
            `<div class="custom-html-container"></div>` +
            this._buildFeatureRowsHTML(f) +
            this._buildBadgeLayerFooter(f) +
            `</div>`;
    }

    /**
     * A feature's fields as label/value rows - the shared body of both the
     * stacked badge table (hover markers) and the flyout (selection markers).
     *
     * `interactive` (the accordion only - see _buildFeatureFlyoutContentHTML)
     * makes each row clickable (see _attachFeatureRowActionHandlers) - left
     * off for the hover badge table, whose popup is too transient for that to
     * make sense.
     */
    _buildFeatureRowsHTML(f, interactive = false) {
        if (!f || !f.feature) return '';
        const layerConfig = this._stateManager.getLayerConfig(f.layerId);
        const inspectConfig = layerConfig?.inspect || {};
        const properties = f.feature.properties || {};
        const fields = inspectConfig.fields || [];
        const fieldTitles = inspectConfig.fieldTitles || [];

        // Value first, field name as a subheader below it - the same
        // hierarchy the summary chip's own label uses (marker-summary-chip__value
        // / __field), just smaller and unbold here since a feature can have
        // many of these stacked rows in a row, not one leading label.
        // Interactive rows also carry a Replace/Add Filter action pair,
        // hidden until the row is clicked (see _attachFeatureRowActionHandlers).
        const buildRow = (label, value, key) => {
            const valueHTML = formatAttributeValue(value, { truncateMax: 40 });
            const actionsHTML = interactive ? `
                <div class="feature-row-actions" style="display:none; gap:6px; padding-top:3px;">
                    <button type="button" class="feature-row-action" data-action="replace"
                        style="display:inline-flex; align-items:center; gap:3px; font-size:8px; font-weight:600; color:#93c5fd; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.4); border-radius:4px; padding:2px 6px; cursor:pointer;">Replace Filter</button>
                    <button type="button" class="feature-row-action" data-action="add"
                        style="display:inline-flex; align-items:center; gap:3px; font-size:8px; font-weight:600; color:#93c5fd; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.4); border-radius:4px; padding:2px 6px; cursor:pointer;">
                        <sl-icon name="plus-circle-dotted" style="font-size:9px;"></sl-icon>Add To Filter</button>
                    <button type="button" class="feature-row-action" data-action="remove"
                        style="display:none; align-items:center; gap:3px; font-size:8px; font-weight:600; color:#93c5fd; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.4); border-radius:4px; padding:2px 6px; cursor:pointer;">
                        <sl-icon name="dash-circle" style="font-size:9px;"></sl-icon>Remove From Filter</button>
                </div>` : '';
            return `<div class="feature-row" data-field-key="${this._escapeAttr(key ?? '')}"
                    style="display:flex; flex-direction:column; align-items:stretch; padding:3px 0; border-bottom:1px solid #374151; ${interactive ? 'cursor:pointer;' : ''}">` +
                `<div style="color:#f3f4f6;font-size:10px;line-height:1.3;word-break:break-word;white-space:pre-line;">${valueHTML}</div>` +
                `<div style="color:#9ca3af;font-size:8px;line-height:1.3;font-weight:400;word-break:break-word;">${this._escapeAttr(label)}</div>` +
                actionsHTML +
                `</div>`;
        };

        const validEntries = Object.entries(properties).filter(([, v]) => v !== null && v !== undefined && v !== '');

        let rows = [];
        if (fields.length > 0) {
            rows = fields.map((fieldName, i) => {
                const value = properties[fieldName];
                if (value !== null && value !== undefined && value !== '') {
                    return buildRow(fieldTitles[i] || fieldName, value, fieldName);
                }
                return '';
            }).filter(Boolean);
        } else {
            rows = validEntries.map(([k, v]) => buildRow(k, v, k));
        }

        if (rows.length === 0) {
            rows = [`<div style="font-size:9px;color:#9ca3af;padding:2px 0;">No attributes</div>`];
        }

        // Configured `fields` only shows a curated subset — offer a toggle to reveal
        // every non-empty property.
        let allPropertiesHTML = '';
        let showAllButton = '';
        if (fields.length > 0 && validEntries.length > rows.length) {
            const allRows = validEntries.map(([k, v]) => buildRow(k, v, k));
            allPropertiesHTML = `<div class="badge-all-properties" style="display:none;">${allRows.join('')}</div>`;
            const btnStyle = `margin-top:2px;padding:2px 0;background:transparent;color:#9ca3af;border:none;border-top:1px dashed #374151;font-size:9px;font-weight:600;cursor:pointer;width:100%;text-align:left;`;
            showAllButton = `<button class="badge-show-all-props-btn" data-total="${validEntries.length}" style="${btnStyle}">Show all ${validEntries.length} properties</button>`;
        }

        return `<div class="badge-shown-properties">${rows.join('')}</div>${allPropertiesHTML}${showAllButton}`;
    }

    /** Data attributes _loadInspectionHandlerHTML reads to load a layer's inspect.onClick handler (config/{atlas}.js). */
    _featureHandlerAttrs(f) {
        const layerConfig = this._stateManager.getLayerConfig(f.layerId);
        const onClick = layerConfig?.inspect?.onClick || '';
        const needsHandler = layerConfig?._sourceAtlas && onClick;
        return `data-needs-handler="${needsHandler ? 'true' : 'false'}" data-atlas="${layerConfig?._sourceAtlas || ''}" ` +
            `data-handler="${onClick}" data-feature-data="${encodeURIComponent(JSON.stringify(f.feature))}"`;
    }

    /**
     * One feature's table for its accordion details: just the fields now -
     * the layer-info row that used to lead it (thumbnail/atlas/name/actions)
     * has moved up into the chip itself (see _buildChipLayerRowHTML), since
     * that row is what the chip's own icon collapses back down to when this
     * feature isn't the one expanded.
     */
    _buildFeatureFlyoutContentHTML(f) {
        return `<div class="feature-badge-details" ${this._featureHandlerAttrs(f)} style="display:block;width:100%;">` +
            `<div class="custom-html-container"></div>` +
            this._buildFeatureRowsHTML(f, true) +
            `</div>`;
    }

    /**
     * The expanded form of a chip's own layer icon (see _buildMarkerSummaryHTML's
     * `row`): a thumbnail beside the layer's title, one line, styled like
     * layer-stack-strip.js's own item row. Sits inside the chip, above the
     * value/field-title column, hidden until this row is the one expanded
     * (_openSummaryDetails shows it and hides the plain icon in its place;
     * _closeAllSummaryDetails swaps them back).
     *
     * The whole row is a button: clicking it opens map-information.html for
     * this layer (see _attachChipLayerRowHandler), carrying this specific
     * feature along so that panel can offer per-feature actions (zoom to
     * feature, export selected) alongside the whole-layer ones - which used
     * to crowd a three-dot menu into this row instead of living there.
     */
    _buildChipLayerRowHTML(layerId) {
        const layerConfig = this._stateManager.getLayerConfig(layerId);
        if (!layerConfig) return '';

        const thumbnail = LayerThumbnail.generate(layerConfig, 20, { interactive: false });
        let thumbnailHTML = '';
        if (thumbnail) {
            thumbnail.style.borderRadius = '4px';
            thumbnail.style.margin = '0';
            thumbnailHTML = thumbnail.outerHTML;
        }

        const layerName = this._escapeAttr(layerConfig.title || layerId);

        return `
            <div class="marker-layer-info-row" data-layer-id="${this._escapeAttr(layerId)}"
                title="Open details for ${layerName}"
                style="display:none; flex:none; align-items:center; gap:6px; width:100%; cursor:pointer;
                       padding-bottom:6px; margin-bottom:3px; border-bottom:1px solid ${MARKER_ROW_BORDER};">
                ${thumbnailHTML}
                <span style="flex:1; min-width:0; overflow-wrap:break-word; white-space:normal; line-height:1.15; font-size:10px; color:#9ca3af; font-weight:700; text-transform:uppercase; letter-spacing:0.02em;">${layerName}</span>
                <sl-icon name="info-circle" style="font-size:10px;color:#6b7280;flex:none;"></sl-icon>
            </div>
        `;
    }

    /**
     * Wires the layer-info row built above, once per chip (not per open, since
     * unlike the fields table this row is static markup built alongside the
     * chip itself): a click posts the same `open-layer-info` message
     * layer-stack-strip.js's own title button does, plus this feature - the
     * one thing that message never carried before, since every other sender
     * opens a layer's info with nothing selected. stopPropagation so it
     * doesn't also toggle the chip's own accordion closed underneath it.
     */
    _attachChipLayerRowHandler(chip, f) {
        const row = chip.querySelector('.marker-layer-info-row');
        if (!row) return;
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            const layerConfig = this._stateManager.getLayerConfig(f.layerId);
            if (!layerConfig) return;
            window.postMessage({
                type: 'open-layer-info',
                layer: this._serializableForInfo(layerConfig),
                feature: this._serializableForInfo(f.feature)
            }, '*');
        });
    }

    /**
     * postMessage still structured-clones its payload even within the same
     * window, and a resolved layer config or feature can carry values
     * (functions, DOM nodes) that won't clone - same guard
     * layer-stack-strip.js's own _serializable uses.
     */
    _serializableForInfo(value) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            return null;
        }
    }

    /**
     * Footer for the expanded badge: layer thumbnail, atlas badge and layer name,
     * styled for the yellow badge.
     */
    _buildBadgeLayerFooter(f) {
        const layerConfig = this._stateManager.getLayerConfig(f.layerId);
        if (!layerConfig) return '';

        const thumbnail = LayerThumbnail.generate(layerConfig, 18, { interactive: false });
        let thumbnailHTML = '';
        if (thumbnail) {
            thumbnail.style.borderRadius = '3px';
            thumbnail.style.margin = '0';
            thumbnailHTML = thumbnail.outerHTML;
        }

        let atlasBadge = '';
        const atlasName = layerConfig._sourceAtlas;
        const atlasMetadata = atlasName && window.layerRegistry?._atlasMetadata?.get(atlasName);
        if (atlasMetadata) {
            atlasBadge = `<span style="font-size:8px;padding:1px 5px;border-radius:3px;font-weight:600;color:white;background-color:${atlasMetadata.color || '#2563eb'};flex-shrink:0;">${this._escapeAttr(atlasMetadata.name)}</span>`;
        }

        const layerName = this._escapeAttr(layerConfig.title || f.layerId);

        return `<div class="feature-badge-footer" style="display:flex;align-items:center;gap:4px;margin-top:4px;padding-top:3px;border-top:1px solid #374151;">` +
            `${thumbnailHTML}${atlasBadge}` +
            `<span style="font-size:9px;color:#9ca3af;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${layerName}</span>` +
            this._buildLayerActionsMenuHTML(f.layerId, f.feature) +
            `</div>`;
    }

    /**
     * Actions menu (three-dot trigger) shown in the badge footer.
     * See _handleZoomToFeatureAction and _handleLayerExportAction.
     */
    _buildLayerActionsMenuHTML(layerId, feature) {
        const featureData = feature ? encodeURIComponent(JSON.stringify(feature)) : '';
        const layerConfig = this._stateManager.getLayerConfig(layerId);
        const geoLibreUrl = GeoLibreAPI.buildViewerUrl(layerConfig);
        return `
            <sl-dropdown class="layer-actions-dropdown" data-layer-id="${layerId}" data-feature-data="${featureData}" hoist style="flex-shrink:0;">
                <sl-icon-button slot="trigger" name="three-dots-vertical" label="Layer actions" style="font-size:12px;color:#6b7280;"></sl-icon-button>
                <sl-menu style="font-size:11px;">
                    ${feature ? `
                    <sl-menu-item value="zoom-to-feature">
                        <sl-icon slot="prefix" name="zoom-in"></sl-icon>
                        Zoom to Feature
                    </sl-menu-item>
                    <sl-divider></sl-divider>
                    ` : ''}
                    <sl-menu-item value="export-selected">
                        <sl-icon slot="prefix" name="download"></sl-icon>
                        Export Selected
                        <sl-menu slot="submenu">
                            <sl-menu-item value="export-selected:geojson">GeoJSON</sl-menu-item>
                            <sl-menu-item value="export-selected:kml">KML</sl-menu-item>
                            <sl-menu-item value="export-selected:csv">GeoCSV</sl-menu-item>
                        </sl-menu>
                    </sl-menu-item>
                    <sl-menu-item value="export-layer">
                        <sl-icon slot="prefix" name="download"></sl-icon>
                        Export Layer
                        <sl-menu slot="submenu">
                            <sl-menu-item value="export-layer:geojson">GeoJSON</sl-menu-item>
                            <sl-menu-item value="export-layer:kml">KML</sl-menu-item>
                            <sl-menu-item value="export-layer:csv">GeoCSV</sl-menu-item>
                        </sl-menu>
                    </sl-menu-item>
                    ${geoLibreUrl ? `
                    <sl-menu-item value="open-geolibre" data-geolibre-url="${this._escapeAttr(geoLibreUrl)}">
                        <sl-icon slot="prefix" name="box-arrow-up-right"></sl-icon>
                        Open Layer in GeoLibre
                    </sl-menu-item>
                    ` : ''}
                    <sl-divider></sl-divider>
                    <sl-menu-item value="remove-layer" style="color:#ef4444;">
                        <sl-icon slot="prefix" name="trash" style="color:#ef4444;"></sl-icon>
                        Remove Layer
                    </sl-menu-item>
                </sl-menu>
            </sl-dropdown>
        `;
    }

    /**
     * Wires up sl-select on a layer actions dropdown (badge footer)
     * to trigger _handleZoomToFeatureAction / _handleLayerExportAction.
     */
    _attachLayerActionsMenuHandlers(root) {
        root.querySelectorAll('.layer-actions-dropdown').forEach(dropdown => {
            if (dropdown._exportMenuWired) return;
            dropdown._exportMenuWired = true;
            dropdown.addEventListener('click', (e) => e.stopPropagation());
            const menu = dropdown.querySelector('sl-menu');
            menu?.addEventListener('sl-select', (e) => {
                // Let sl-select keep bubbling to <sl-dropdown> — that's what makes
                // it auto-close after picking an item; stopping it here left the
                // dropdown open after every action.
                const value = e.detail.item?.value || '';
                if (value === 'zoom-to-feature') {
                    this._handleZoomToFeatureAction(dropdown);
                    return;
                }
                if (value === 'remove-layer') {
                    this._handleRemoveLayerAction(dropdown.dataset.layerId);
                    return;
                }
                if (value === 'open-geolibre') {
                    const geoLibreUrl = e.detail.item?.dataset.geolibreUrl;
                    if (geoLibreUrl) window.open(geoLibreUrl, '_blank', 'noopener');
                    return;
                }
                const [action, format] = value.split(':');
                if (!format) return;
                this._handleLayerExportAction(action, format, dropdown.dataset.layerId, dropdown.dataset.featureData);
            });
        });
    }

    /**
     * User-triggered zoom from the layer actions menu — the app no longer zooms
     * automatically when a badge/feature card is selected.
     */
    _handleZoomToFeatureAction(dropdown) {
        const featureData = dropdown.dataset.featureData;
        if (!featureData) return;
        try {
            const feature = JSON.parse(decodeURIComponent(featureData));
            this._isProgrammaticZoom = true;
            this._zoomToFeature(feature);
            setTimeout(() => { this._isProgrammaticZoom = false; }, 1500);
        } catch (err) {
            console.warn('[MapMarkerManager] Could not zoom to feature:', err);
        }
    }

    _handleRemoveLayerAction(layerId) {
        if (!layerId) return;
        if (!confirm(`Remove layer "${layerId}"?`)) return;
        window.postMessage({ type: 'remove-layer', layerId }, '*');
    }

    /**
     * Finds the notes layer's group index in map-layer-controls' _state.groups.
     * The shared 'notes' layer (defined once in index.atlas.json) keeps its bare
     * `id` there but is referenced elsewhere as 'index-notes' via `_prefixedId` —
     * match on either, plus `_originalId`, mirroring shortcut-menu.js's
     * `_getGroupElement`.
     */
    _getNotesGroupIndex() {
        const groups = window.layerControl?._state?.groups;
        if (!groups) return -1;
        return groups.findIndex(g => g.id === 'notes' || g._prefixedId === 'index-notes' || g._originalId === 'notes');
    }

    /**
     * Whether the notes layer is currently toggled on — same checkbox-based
     * check as `_isLayerActive`/shortcut-menu.js's `_isLayerVisible`, so the
     * comment box's activation state always matches what actually toggled the
     * layer on (the sidebar checkbox or the shortcut menu's "Comments" item).
     */
    _isNotesLayerActive() {
        const groupIndex = this._getNotesGroupIndex();
        if (groupIndex === -1) return false;
        return this._isLayerActive(groupIndex);
    }

    /**
     * The notes layer's active config (if currently toggled on), used to
     * resolve its exact layerId for excluding it from the "N more layers"
     * summary even when no notes feature was clicked (empty comment case).
     */
    _getActiveNotesLayer() {
        const groupIndex = this._getNotesGroupIndex();
        if (groupIndex === -1 || !this._isLayerActive(groupIndex)) return null;
        return window.layerControl._state.groups[groupIndex] || null;
    }

    /**
     * Finds the clicked feature (if any) that belongs to a writable notes-style
     * CSV layer — the one the special "Comment" rendering edits in place.
     */
    _findNoteEntry(features) {
        return (features || []).find(f => {
            const layerConfig = this._stateManager.getLayerConfig(f.layerId);
            return layerConfig?.type === 'csv' && (layerConfig.saveUrl || window.GOOGLE_SHEETS_SAVE_URL);
        });
    }

    /**
     * Format a note's ISO timestamp for display below the comment input:
     * "Added at 11:35 AM" if it was added today, otherwise "Added on 29 May 2026".
     */
    _formatCommentDate(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';

        const now = new Date();
        const isSameDay = date.getFullYear() === now.getFullYear() &&
            date.getMonth() === now.getMonth() &&
            date.getDate() === now.getDate();

        if (isSameDay) {
            const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            return `Added at ${time}`;
        }

        const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        return `Added on ${dateStr}`;
    }

    /**
     * The marker's header row: the id it is referenced by in `markers=`/a
     * route's `route-<rid>:` waypoint list (marker-registry.js), and the
     * options that act on this point.
     *
     * The id is dotted-underlined, rather than carrying an edit icon, only
     * while the marker is expanded - the dotted line is the affordance, and an
     * icon (or a permanent underline) beside every collapsed chip on the map
     * would be noise. It stays a real <input>, swapped in on click, because
     * renaming is the point of showing the id at all (a shared link reads
     * better as `home(...)` than `3(...)`); see _attachMarkerIdRowHandlers
     * for that swap, the rename commit, the options button, and the hover
     * highlight that previews the same affordance; _syncMarkerContent is what
     * shows/hides the underline as the marker expands and collapses.
     *
     * Unfocused this row is the whole marker, so it reads as a plain chip.
     *
     * `saved` (default true - most callers, including every existing unit test,
     * build a header for a marker that already has a meaningful id) governs the
     * badge's very first render only: false shows MARKER_ID_PLACEHOLDER instead
     * of the raw auto-numbered id, inviting the tap that names it. addMarker
     * passes the real flag for a freshly dropped marker.
     */
    _buildMarkerMenuHeaderHTML(urlId, saved = true) {
        const labelStyle = `
            box-sizing: content-box;
            max-width: ${MARKER_ID_MAX_WIDTH}px;
            background: transparent;
            border: 1px solid transparent;
            color: #f3f4f6;
            font-size: 15px;
            font-weight: 500;
            font-family: inherit;
            line-height: 1.2;
            padding: 1px 3px;
            border-radius: 4px;
        `;
        const badgeLabel = saved ? idToLabel(urlId) : MARKER_ID_PLACEHOLDER;
        // The placeholder is an invitation, not a name - muted so it reads as a
        // hint rather than something already given to the marker.
        const badgeColor = saved ? MARKER_ID_TEXT_COLOR : MARKER_ID_MUTED_COLOR;

        return `
            <div class="marker-menu-header" style="display: flex; align-items: center; gap: 4px; padding: 8px 10px;">
                <button type="button" class="marker-id-action marker-id-move" title="Drag to reposition"
                    style="display: none; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0;
                           background: transparent; border: none; border-radius: 50%; cursor: move; flex-shrink: 0;">
                    <sl-icon name="arrows-move" style="font-size: 14px; color: #9ca3af; pointer-events: none;"></sl-icon>
                </button>
                <button type="button" class="marker-id-badge" title="${this._escapeAttr(badgeLabel)}"
                    style="${labelStyle} display: flex; flex-direction: column; align-items: flex-start; white-space: normal; overflow-wrap: break-word; text-align: left; cursor: pointer;
                           text-decoration-line: none; text-decoration-style: dotted; text-decoration-color: #6b7280; text-underline-offset: 3px;
                           color: ${badgeColor};">
                    <span class="marker-id-text">${this._escapeAttr(badgeLabel)}</span>
                </button>
                <span class="marker-id-input-wrap" style="position: relative; display: none;">
                    <textarea class="marker-id-input" hidden rows="1"
                        spellcheck="false" autocomplete="off"
                        style="${labelStyle} background: #111827; border-color: ${MARKER_ID_INPUT_BORDER}; cursor: text; min-width: 140px;
                               max-width: ${MARKER_ID_INPUT_MAX_WIDTH}px;
                               white-space: pre-wrap; overflow-wrap: break-word; overflow: hidden; resize: none; padding-right: 18px;"
                    >${this._escapeHtml(idToLabel(urlId))}</textarea>
                    <button type="button" class="marker-id-clear" title="Clear"
                        style="display: none; position: absolute; top: 2px; right: 2px; align-items: center; justify-content: center;
                               width: 16px; height: 16px; padding: 0; background: transparent; border: none; border-radius: 50%; cursor: pointer;">
                        <sl-icon name="x" style="font-size: 12px; color: #9ca3af; pointer-events: none;"></sl-icon>
                    </button>
                </span>
                <span class="marker-menu-header-spacer" style="flex: 1; display: none;"></span>
                <button type="button" class="marker-id-action marker-id-save" title="Save id (Enter)"
                    style="display: none; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0;
                           background: transparent; border: none; border-radius: 50%; cursor: pointer; flex-shrink: 0;">
                    <sl-icon name="check-circle" style="font-size: 14px; color: #22c55e; pointer-events: none;"></sl-icon>
                </button>
                <button type="button" class="marker-id-action marker-id-delete" title="Delete this marker"
                    style="display: none; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0;
                           background: transparent; border: none; border-radius: 50%; cursor: pointer; flex-shrink: 0;">
                    <sl-icon name="trash-fill" style="font-size: 14px; color: #ef4444; pointer-events: none;"></sl-icon>
                </button>
                <button type="button" class="marker-id-action marker-id-shortcuts" title="Options for this point"
                    style="display: none; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0;
                           background: transparent; border: none; border-radius: 50%; cursor: pointer; flex-shrink: 0;">
                    <sl-icon name="three-dots-vertical" style="font-size: 14px; color: #9ca3af; pointer-events: none;"></sl-icon>
                </button>
            </div>
        `;
    }

    /**
     * The leader that stands in for the old map pin: a tail running from the
     * point the marker describes to the nearest top corner of its panel,
     * tapering from nothing at the point to MARKER_LEADER_WIDTH where it meets
     * the panel, so the pair reads as one callout.
     *
     * A polygon rather than a stroked line, because a stroke cannot taper - and
     * not a fixed tail either, because the panel does not stay put: it can be
     * dragged clear of whatever sits under it (see _attachBalloonDragHandler),
     * so the shape is recomputed from wherever the panel ended up
     * (_syncMarkerLeader).
     *
     * The tail is also the handle the marker's *location* is dragged by - it
     * stands in for the pin in that too - so it is the one part of the
     * surrounding space that hit-tests, and it carries the move cursor to say
     * so. Nothing here stops the press: mapbox's marker drag listens on the map
     * container this marker sits in and checks whether the press landed inside
     * the marker element, so letting it bubble is what arms the drag.
     *
     * Live only while the marker is expanded, though (see _syncMarkerContent,
     * which flips `pointer-events` on `.marker-leader-line` between this and
     * 'auto') - `pointer-events: none` at rest here is what a collapsed chip
     * starts from, so a press glancing off it lands on the map underneath
     * instead of relocating the marker.
     *
     * The <svg> around the tail stays transparent to the pointer: it spans
     * MARKER_LEADER_EXTENT in every direction, and only the triangle actually
     * drawn inside it is the handle. The transparent stroke widens that handle
     * to something grabbable without widening what is painted.
     */
    _buildMarkerLeaderHTML() {
        const c = MARKER_LEADER_EXTENT;
        const size = c * 2;
        return `
            <svg class="marker-leader" width="${size}" height="${size}" aria-hidden="true"
                style="position: absolute; top: ${-c}px; left: ${-c}px; pointer-events: none;">
                <polygon class="marker-leader-line" points="${c},${c} ${c},${c} ${c},${c}"
                    fill="${MARKER_PANEL_BG}" stroke="transparent"
                    stroke-width="${MARKER_LEADER_GRAB}" stroke-linejoin="round"
                    style="pointer-events: none; cursor: move;"/>
            </svg>
        `;
    }

    /**
     * Joins the panel back to its point: finds whichever of the panel's two top
     * corners is nearer the point, and draws the tail running into it.
     *
     * The tail lands MARKER_LEADER_INSET inside that corner rather than on it,
     * so the panel covers where it terminates (see the constant).
     *
     * Only the top corners are candidates. A panel is a header that grows
     * downwards as it opens, so joining it at a bottom corner would put the tail
     * on the moving edge - the panel would have to grow upwards to keep it in
     * place, and the corner chosen would keep changing as it did. Anchoring at
     * the top means the panel always grows down, away from the join.
     *
     * Both rects are read from the DOM rather than tracked, so this stays
     * correct however the panel got where it is - the drag transform, the panel
     * growing from chip to menu, or the id being renamed to something wider.
     */
    _syncMarkerLeader(el) {
        const content = el.querySelector('.marker-content');
        const svg = el.querySelector('.marker-leader');
        if (!content || !svg) return;

        // el's border box is anchored at the point (mapbox anchor 'top-left',
        // zero offset), and a child's transform never moves it - so the point is
        // the origin here whatever the panel does.
        const origin = el.getBoundingClientRect();
        const panel = content.getBoundingClientRect();
        if (!panel.width || !panel.height) return;

        const inset = Math.min(MARKER_LEADER_INSET, panel.width / 2, panel.height / 2);
        const left = panel.left - origin.left + inset;
        const top = panel.top - origin.top + inset;

        const corners = [
            { name: 'top-left', x: left, y: top },
            { name: 'top-right', x: left + panel.width - inset * 2, y: top }
        ];
        const nearest = corners.reduce((a, b) => (Math.hypot(a.x, a.y) <= Math.hypot(b.x, b.y) ? a : b));

        this._drawMarkerLeaderTail(svg, nearest);
        el.dataset.leaderCorner = nearest.name;
    }

    /**
     * The tail as a triangle: apex at the point, base MARKER_LEADER_WIDTH wide
     * astride the panel corner and square to the direction of travel, so the
     * taper is even however the panel has been dragged.
     *
     * Drawn relative to the surface's centre, which is the point itself.
     */
    _drawMarkerLeaderTail(svg, corner) {
        const c = MARKER_LEADER_EXTENT;
        const len = Math.hypot(corner.x, corner.y);
        // A panel sitting on its point has nowhere to taper towards, so there is
        // no tail to draw - and normalising by zero would put it at NaN.
        const half = len ? MARKER_LEADER_WIDTH / 2 : 0;
        const nx = len ? (-corner.y / len) * half : 0;
        const ny = len ? (corner.x / len) * half : 0;

        const base = { x: c + corner.x, y: c + corner.y };
        const pt = (x, y) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
        const points = `${pt(c, c)} ${pt(base.x + nx, base.y + ny)} ${pt(base.x - nx, base.y - ny)}`;

        svg.querySelectorAll('.marker-leader-line').forEach(tail => {
            tail.setAttribute('points', points);
        });
    }

    /**
     * One menu row per feature selected here, in the same vocabulary as the
     * long-press shortcut menu (shortcut-menu-base.js) - layer thumbnail,
     * label, chevron - so a marker reads as a menu of what is at this point
     * rather than as a stack of cards. Each row expands its own details
     * accordion-style directly beneath it (see _openSummaryDetails) rather
     * than opening a separate flyout, so the whole marker scrolls as one
     * column no matter how many rows are open.
     *
     * The last row is always the reverse-geocoded address of the point itself,
     * so a marker says where it is whether or not anything was selected there.
     */
    _buildMarkerSummaryHTML(features, lngLat) {
        // A hairline on every row rather than one thick divider above the
        // whole list - the same per-row border _buildFeatureRowsHTML's own
        // field rows use, just one level up. Doubles as the separator from
        // whatever sits above the list (the comment box, or the header),
        // since the first row gets one too.
        // The pick checkbox (every row, the address included - see
        // _applyLabelPick) sits outside the chip button so it doesn't itself
        // toggle the accordion open; hidden until the id is being edited (see
        // startEdit/endEdit), where it becomes the name-picker widget's row.
        // It's centered against the chip alone (their own flex row, not the
        // item as a whole) so it lines up with the label regardless of
        // whether that row's details are open below it.
        // The layer-info row (_buildChipLayerRowHTML) is this chip's icon,
        // grown up: collapsed, only the small icon shows beside the value;
        // once this row is the one expanded, _openSummaryDetails hides that
        // icon and reveals the layer row in its place, as a full line above
        // the value instead of a small mark beside it (_closeAllSummaryDetails
        // swaps them back). The address row has no layer behind it, so it
        // keeps its plain icon always - layerRowHTML is just '' for it.
        const row = (iconHTML, fieldName, label, index, extraClass = '', layerRowHTML = '') => `
            <div class="marker-summary-item" data-badge-index="${index}" style="border-top: 1px solid ${MARKER_ROW_BORDER};">
                <div style="display: flex; align-items: center;">
                    <input type="checkbox" class="marker-summary-pick" data-badge-index="${index}"
                        style="display: none; flex-shrink: 0; cursor: pointer; margin-left: 8px; accent-color: #3b82f6;" />
                    <button type="button" class="shortcut-menu-item marker-summary-chip ${extraClass}"
                        data-badge-index="${index}" aria-expanded="false"
                        style="flex: 1; min-width: 0; flex-direction: column; align-items: stretch; gap: 3px;"
                        title="${this._escapeAttr(fieldName ? `${fieldName}: ${label}` : label)}">
                        ${layerRowHTML}
                        <div style="display: flex; align-items: center; gap: 8px; width: 100%; flex: none;">
                            <span class="marker-summary-chip__icon" style="display: inline-flex; flex: none;">${iconHTML}</span>
                            <div style="display: flex; flex-direction: column; align-items: flex-start; flex: 1; min-width: 0; overflow: hidden;">
                                <span class="marker-summary-chip__value" style="flex: none; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this._escapeAttr(this._truncateName(label, 30))}</span>
                                ${fieldName ? `<span class="marker-summary-chip__field" style="flex: none; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; line-height: 1.3; color: #9ca3af;">${this._escapeAttr(fieldName)}</span>` : ''}
                            </div>
                            <sl-icon class="shortcut-menu-chevron marker-summary-chevron" name="chevron-right" style="flex-shrink: 0;"></sl-icon>
                        </div>
                    </button>
                </div>
                <div class="marker-summary-details" style="display: none; width: 100%; box-sizing: border-box; padding: 0 10px;"></div>
            </div>
        `;

        const rows = this._featuresInInspectorOrder(features).map(({ f, index }) => {
            const { fieldName, value } = this._getBadgeLabelInfo(f);
            return row(this._layerIconHTML(f.layerId), fieldName, value, index, '', this._buildChipLayerRowHTML(f.layerId));
        });

        // Always last, never instead: where the point is is one more thing known
        // about it, alongside whatever was selected there - not a stand-in for
        // having selected nothing. Reads as pending until the reverse geocode
        // lands and rewrites it (see _renderMarkerAddress); the coordinates are
        // a field inside it rather than a placeholder for it (_coordinateField).
        rows.push(row('<sl-icon name="signpost"></sl-icon>', 'Address', 'Locating…',
            ADDRESS_BADGE_INDEX, 'marker-summary-chip--address'));

        return `
            <div class="marker-summary-row" style="display: flex; flex-direction: column; align-items: stretch;">
                ${rows.join('')}
            </div>
        `;
    }

    /** A layer's thumbnail sized for a menu row, falling back to a generic icon. */
    _layerIconHTML(layerId) {
        const layerConfig = this._stateManager.getLayerConfig(layerId);
        const thumbnail = layerConfig && LayerThumbnail.generate(layerConfig, 15, { interactive: false });
        if (!thumbnail) return '<sl-icon name="square"></sl-icon>';

        thumbnail.classList.add('shortcut-menu-icon-img');
        thumbnail.style.margin = '0';
        return thumbnail.outerHTML;
    }


    /** The indices of `features`, ordered the way the badge list orders them (LayerOrderManager.getInspectorDisplayOrder). */
    _featuresInInspectorOrder(features) {
        const order = new Map(this._getAllActiveLayersInInspectorOrder().map((l, i) => [l.id, i]));
        const orderOf = (layerId) => order.has(layerId) ? order.get(layerId) : Infinity;

        return (features || [])
            .map((f, index) => ({ f, index, order: orderOf(f.layerId) }))
            .sort((a, b) => a.order - b.order || a.index - b.index);
    }

    /**
     * Every marker balloon leads with an inline "Comment" box in place of the
     * notes layer's normal badge, prefilled from a notes-layer feature already
     * selected at this point (if any) so an existing note is editable in place
     * instead of behind a separate form. Only shown while the notes layer
     * itself is active.
     */
    _buildCommentSectionHTML(noteEntry) {
        if (!this._isNotesLayerActive()) return '';

        const existingValue = String(noteEntry?.feature?.properties?.notes || '');
        const dateLabel = this._formatCommentDate(noteEntry?.feature?.properties?.timestamp);

        return `
            <div class="marker-comment-section" style="
                width: 100%;
                box-sizing: border-box;
                padding-bottom: 4px;
                margin-bottom: 4px;
                border-bottom: 1px solid #334155;
            ">
                <span style="font-size: 8px; line-height: 1.1; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.02em; display: block; margin-bottom: 2px;">Comment</span>
                <textarea class="marker-comment-input" rows="1" placeholder="Add a comment..." style="
                    display: block;
                    width: 100%;
                    max-width: 100%;
                    box-sizing: border-box;
                    background: #0a0a0a;
                    color: #e2e8f0;
                    border: 1px solid #334155;
                    border-radius: 4px;
                    padding: 4px 6px;
                    font-size: 11px;
                    font-family: inherit;
                    resize: none;
                    overflow: hidden;
                    line-height: 1.3;
                    cursor: text;
                ">${this._escapeHtml(existingValue)}</textarea>
                ${dateLabel ? `<span class="marker-comment-date" style="display: block; margin-top: 3px; font-size: 9px; color: #6b7280;">${this._escapeHtml(dateLabel)}</span>` : ''}
                <button type="button" class="marker-comment-save-btn" style="
                    display: none;
                    width: 100%;
                    margin-top: 4px;
                    background: #16a34a;
                    border: none;
                    color: #fff;
                    padding: 4px 0;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                ">Save</button>
            </div>
        `;
    }

    _buildMarkerBadgesHTML(features, lngLat, options = {}) {
        const { suppressEmptyBadge = false, pendingLayerIds = null, includeAddress = false } = options;

        // Layers still being queried (see MapMarkerManager.restoreMarkersFromSelectionLayer)
        // that haven't already produced a real badge — shown as a "Locating…" placeholder,
        // interleaved with real feature badges in the same layer order used elsewhere
        // (see LayerOrderManager.getInspectorDisplayOrder), so the list doesn't jump
        // around as each layer resolves.
        const foundLayerIds = new Set((features || []).map(f => f.layerId));
        const pendingIds = pendingLayerIds
            ? [...pendingLayerIds].filter(id => !foundLayerIds.has(id))
            : [];

        let html;
        if ((features && features.length > 0) || pendingIds.length > 0) {
            const order = new Map(this._getAllActiveLayersInInspectorOrder().map((l, i) => [l.id, i]));
            const orderOf = (layerId) => order.has(layerId) ? order.get(layerId) : Infinity;
            const entries = [
                ...this._featuresInInspectorOrder(features).map(({ f, index }) => ({ order: orderOf(f.layerId), sortIndex: index, render: () => {
                    const { fieldName, value } = this._getBadgeLabelInfo(f);
                    return this._createFeatureBadgeHTML(fieldName, value, index, f);
                } })),
                ...pendingIds.map(layerId => ({ order: orderOf(layerId), sortIndex: Infinity, render: () => this._createPendingLayerBadgeHTML(layerId) }))
            ].sort((a, b) => a.order - b.order || a.sortIndex - b.sortIndex);
            html = entries.map(entry => entry.render()).join('');
        } else if (suppressEmptyBadge) {
            // The clicked feature was a note, already shown in the comment box
            // above - nothing else to say about the point here.
            html = '';
        } else {
            // No features (empty map click) - nothing but the address row below.
            // Where the point is is a field of that address ($coordinates, see
            // _coordinateField), not a badge of its own: a popup whose whole
            // content is a pair of numbers says nothing the address doesn't.
            html = '';
        }

        // The place this point sits in, after whatever was selected here -
        // filled in once the reverse geocode returns (see _resolveMarkerAddress).
        if (includeAddress) html += this._createAddressBadgeHTML();

        return html;
    }

    /**
     * The address row: the place this marker sits in, as one more property
     * after the features selected here. The signpost icon carries the meaning,
     * so the row is just that and the value - the `$address` property name is
     * only how it travels in the data (see _updateSelectionLayer).
     *
     * Rendered empty and hidden, then filled
     * in by _resolveMarkerAddress when the reverse geocode returns - the
     * balloon shouldn't wait on a network round trip to appear.
     *
     * Clicking it expands the one-line address into its full hierarchy, each
     * level linked to the OSM object it came from (see
     * nominatim-search.js's fetchNominatimAddressParts). Those links are a
     * second request, so they're fetched on that first expand rather than for
     * every marker dropped.
     */
    _createAddressBadgeHTML() {
        return `
            <div class="feature-badge address-badge" style="
                display: none;
                flex-direction: column;
                align-items: flex-start;
                width: 100%;
                box-sizing: border-box;
                background: transparent;
                border-radius: 5px;
                padding: 4px 8px;
                cursor: pointer;
                transition: background 0.15s;
            ">
                <div class="feature-badge-header" style="display: flex; flex-direction: row; align-items: center; gap: 4px; width: 100%;">
                    <sl-icon name="signpost" style="font-size: 11px; color: #9ca3af;"></sl-icon>
                    <span class="address-badge-value" style="font-size: 11px; font-weight: 700; color: #f3f4f6; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
                    <sl-icon class="address-badge-chevron" name="chevron-down" style="font-size: 10px; color: #6b7280; flex-shrink: 0;"></sl-icon>
                </div>
                <div class="address-badge-details" style="display:none;width:100%;margin-top:3px;border-top:1px solid #374151;padding-top:3px;max-height:180px;overflow-y:auto;"></div>
            </div>
        `;
    }

    /**
     * Reverse geocodes a marker's point and hangs the result off its data as
     * `$address`, so it travels with the marker into the selection layer's
     * feature properties like any other attribute. Silent on failure: an
     * address is a nicety, and Nominatim is rate limited (the module backs off
     * on its own, see isNominatimBackedOff).
     */
    _resolveMarkerAddress(markerId) {
        const markerData = this._markers.get(markerId);
        if (!markerData || markerData.address) return;

        const { lng, lat } = markerData.lngLat;
        // Always Nominatim's finest detail, whatever the map is showing - its
        // zoom parameter picks how coarse an answer to give, so feeding it the
        // map zoom returned a city when the map happened to be zoomed out.
        this._queueAddressLookup(() => reverseGeocodeAddress(lat, lng))
            .then(address => {
                if (!address) return;
                const current = this._markers.get(markerId);
                if (!current) return;
                current.address = address;
                this._renderMarkerAddress(current);
                this._updateSelectionLayer();
            })
            .catch(error => console.warn('[MarkerManager] Address lookup failed:', error.message));
    }

    _renderMarkerAddress(markerData) {
        const el = markerData.marker?.getElement();
        const text = markerData.address?.text;
        if (!el || !text) return;

        // The stacked badge only exists on the hover marker, which still uses the
        // old layout - a selection marker has the row below instead, so this
        // must not gate on finding it.
        const badge = el.querySelector('.address-badge');
        if (badge) {
            badge.querySelector('.address-badge-value').textContent = text;
            badge.style.display = 'flex';
        }

        // The address row started life as the raw coordinates - now it can say
        // where the point actually is.
        const chip = el.querySelector('.marker-summary-chip--address');
        const chipValue = chip?.querySelector('.marker-summary-chip__value');
        if (chip && chipValue) {
            chipValue.textContent = this._truncateName(text, 34);
            chip.title = text;
        }
    }

    /**
     * Expands the address row into one row per level, each linking to its own
     * OSM object where it has one (a postcode or country often doesn't).
     */
    _attachAddressBadgeHandler(el, markerId) {
        const badge = el.querySelector('.address-badge');
        if (!badge) return;

        const details = badge.querySelector('.address-badge-details');
        ['wheel', 'touchmove', 'touchstart', 'touchend', 'mousedown'].forEach(type => {
            details.addEventListener(type, (e) => e.stopPropagation());
        });
        // Let a link through, but never let its click collapse the row.
        details.addEventListener('click', (e) => e.stopPropagation());

        const toggle = (e) => {
            e.stopPropagation();
            if (e.type === 'touchend') e.preventDefault();

            const isOpen = details.style.display !== 'none';
            details.style.display = isOpen ? 'none' : 'block';
            badge.querySelector('.address-badge-chevron')?.setAttribute('name', isOpen ? 'chevron-down' : 'chevron-up');
            if (isOpen || details.dataset.loaded) return;

            details.dataset.loaded = '1';
            this._fillAddressDetails(details, markerId);
        };

        badge.addEventListener('click', toggle);
        if (this._isTouch) badge.addEventListener('touchend', toggle);
    }

    _fillAddressDetails(details, markerId) {
        const markerData = this._markers.get(markerId);
        const address = markerData?.address;
        if (!address) return;

        // The point itself leads the hierarchy it sits in - the most specific
        // thing known about it, and the only place the coordinates are shown.
        const coords = this._coordinateField(markerData.lngLat);

        // The flat name-only components are shown straight away; the linked
        // hierarchy replaces them once the second request lands.
        details.innerHTML = this._addressRowsHTML([coords,
            ...(address.parts || []).map(part => ({ name: part.value, category: part.key, url: null }))
        ]);

        this._queueAddressLookup(() => fetchNominatimAddressParts(address.osmType, address.osmId))
            .then(parts => {
                if (parts.length > 0) details.innerHTML = this._addressRowsHTML([coords, ...parts]);
            })
            .catch(error => console.warn('[MarkerManager] Address detail lookup failed:', error.message));
    }

    /**
     * Nominatim asks for at most one request a second, and restoring a shared
     * link can bring back a dozen markers at once - firing those together
     * would earn a 429 and put the whole module into its shared backoff, which
     * the search control draws on too. So address lookups run one at a time,
     * spaced out; they're a nicety that can afford to arrive late.
     */
    _queueAddressLookup(task) {
        this._addressQueue = (this._addressQueue || Promise.resolve())
            .catch(() => {})
            .then(async () => {
                const since = Date.now() - (this._lastAddressLookupAt || 0);
                if (since < ADDRESS_LOOKUP_GAP_MS) {
                    await new Promise(resolve => setTimeout(resolve, ADDRESS_LOOKUP_GAP_MS - since));
                }
                this._lastAddressLookupAt = Date.now();
                return task();
            });
        return this._addressQueue;
    }

    /**
     * The point's own coordinates, shaped like one of the address's components
     * so it reads as one more field of it. `lng,lat` in one string and at full
     * map precision, because what it is for is being copied somewhere else.
     *
     * `$` marks it as belonging to the marker rather than to Nominatim's
     * answer, the same way `$address` does where the marker travels as data
     * (see _updateSelectionLayer).
     */
    _coordinateField(lngLat) {
        return {
            category: '$coordinates',
            name: `${lngLat.lng.toFixed(6)},${lngLat.lat.toFixed(6)}`,
            url: null
        };
    }

    _addressRowsHTML(parts) {
        return parts.map(part => {
            const label = String(part.category || '').replace(/_/g, ' ');
            const name = part.url
                ? `<a href="${part.url}" target="_blank" rel="noopener" style="color:#60a5fa;text-decoration:none;">${part.name}</a>`
                : `<span style="color:#f3f4f6;">${part.name}</span>`;
            return `
                <div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:11px;">
                    <span style="color:#6b7280;flex-shrink:0;min-width:74px;">${label}</span>
                    <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * Called after promoting a hover badge to a selection (here and from
     * map-search-control.js / map-nearby-features-control.js). There's no
     * docked panel to open any more — the badge's own inline attribute
     * display is the only view — so this is a kept no-op.
     */
    _openInspectorPanel() {
    }

    _attachBadgeHandlers(el, features, lngLat, isHover) {
        el.querySelectorAll('.feature-badge').forEach(badge => {
            const idx = parseInt(badge.dataset.badgeIndex, 10);
            const f = (idx >= 0 && features) ? features[idx] : null;
            const valueSpan = badge.querySelector('.badge-value');
            const details = badge.querySelector('.feature-badge-details');

            // The badge lives inside a Mapbox marker element, so wheel events would
            // bubble to the map's scroll-zoom handler. Capture them on the scrollable
            // attribute table so it scrolls natively instead of zooming the map.
            if (details) {
                details.addEventListener('wheel', (e) => e.stopPropagation());
                // On touch, stop touchmove from reaching the map's drag-pan handler.
                details.addEventListener('touchmove', (e) => e.stopPropagation());
                details.addEventListener('touchstart', (e) => e.stopPropagation());
                // Without this, any click bubbling up from the table (including the
                // click that ends a text selection drag) hits the badge's own click
                // handler below and toggles the table closed, making selecting or
                // copying text inside it impossible.
                details.addEventListener('mousedown', (e) => e.stopPropagation());
                details.addEventListener('click', (e) => e.stopPropagation());
                // Also stop touchend: the badge itself listens for touchend to toggle
                // open/closed (see `handler`/`this._isTouch` below), so without this,
                // lifting a finger after scrolling the table — or tapping a button
                // inside it — bubbles up and collapses the badge before the tap's own
                // handler (e.g. showAllBtn's click) even runs.
                details.addEventListener('touchend', (e) => e.stopPropagation());

                const showAllBtn = details.querySelector('.badge-show-all-props-btn');
                if (showAllBtn) {
                    showAllBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const shown = details.querySelector('.badge-shown-properties');
                        const all = details.querySelector('.badge-all-properties');
                        const total = showAllBtn.dataset.total;
                        const isShowingAll = all.style.display !== 'none';
                        all.style.display = isShowingAll ? 'none' : 'block';
                        if (shown) shown.style.display = isShowingAll ? 'block' : 'none';
                        showAllBtn.textContent = isShowingAll ? `Show all ${total} properties` : 'Show less';
                    });
                }
            }

            const layerIsBasemap = () => {
                const lc = f ? this._stateManager.getLayerConfig(f.layerId) : null;
                return Array.isArray(lc?.tags) && lc.tags.includes('basemap');
            };

            if (!this._isTouch) {
                badge.addEventListener('mouseenter', () => {
                    if (!badge.classList.contains('badge-selected')) {
                        badge.style.background = '#374151';
                    }
                    this._expandBadgeValue(valueSpan);
                    // Isolation (sibling dimming + layer isolation) is reserved for
                    // clicked selection markers; hover popups only highlight the badge.
                    if (!isHover) {
                        // Dim the sibling badges to signal this layer is isolated.
                        this._setSiblingBadgesDimmed(badge, true);
                    }
                    if (f) {
                        this._stateManager.setFeatureHoverState(f.layerId, f.featureId, true);
                        if (!isHover) {
                            // Hovering a badge dims sibling layers via the shared isolation manager.
                            window.layerControl?.isolation?.hoverIsolate(f.layerId, layerIsBasemap());
                        }
                    }
                });
                badge.addEventListener('mouseleave', () => {
                    if (!badge.classList.contains('badge-selected')) {
                        badge.style.background = 'transparent';
                        this._collapseBadgeValue(valueSpan);
                    }
                    if (!isHover) {
                        // Restore sibling badges — isolation is cleared on mouseout.
                        this._setSiblingBadgesDimmed(badge, false);
                    }
                    if (f) {
                        this._stateManager.setFeatureHoverState(f.layerId, f.featureId, false);
                        if (!isHover) {
                            window.layerControl?.isolation?.clearHover();
                        }
                    }
                });
            }

            const handler = (e) => {
                e.stopPropagation();
                if (e.type === 'touchend') e.preventDefault();
                // Hover markers aren't selected yet — clicking promotes them to a selection
                // marker, which rebuilds the badges.
                if (isHover && f) {
                    this._stateManager.handleFeatureClicks([{ ...f, lngLat }]);
                    this._openInspectorPanel();
                    return;
                }
                // Selection-marker badge: toggle the selected (expanded) state inline.
                this._toggleBadgeSelected(badge, f);
            };
            badge.addEventListener('click', handler);
            if (this._isTouch) badge.addEventListener('touchend', handler);
        });

        // Layer actions menu (export shortcuts) in each badge's footer
        this._attachLayerActionsMenuHandlers(el);

    }

    /**
     * Wires the summary chips (_buildMarkerSummaryHTML) to the detail panel
     * that expands directly beneath each one, accordion-style: clicking a row
     * toggles its own details open and closes whichever other row was open,
     * so the marker never shows more than one feature's fields at once and
     * everything scrolls as a single column (see the marker-menu-body
     * max-height in addMarker) instead of spilling a flyout off the edge of
     * a small screen.
     */
    _attachMarkerSummaryHandlers(el, features, lngLat) {
        el.querySelectorAll('.marker-summary-item').forEach(item => {
            const chip = item.querySelector('.marker-summary-chip');
            const details = item.querySelector('.marker-summary-details');
            if (!chip || !details) return;

            const index = parseInt(chip.dataset.badgeIndex, 10);
            const f = index >= 0 ? (features || [])[index] : null;

            // Wired once here, not on every open/close - unlike the fields
            // table below, the layer-info row is static markup built
            // alongside the chip itself (_buildChipLayerRowHTML), just shown
            // or hidden as this row expands and collapses.
            if (f) this._attachChipLayerRowHandler(chip, f);

            // The name-picker checkbox (see _applyLabelPick, exposed by
            // _attachMarkerIdRowHandlers) - stopPropagation so ticking it
            // doesn't also toggle the chip's own accordion below, or arm the
            // balloon drag the way any other press on the panel would.
            const pick = item.querySelector('.marker-summary-pick');
            if (pick) {
                // Same reasoning as wireEditAction's save/delete/clear
                // buttons: a plain click would first focus the checkbox,
                // blurring the id textarea - and blur discards the edit
                // (see discard()), closing the whole editor out from under
                // the click before its own `change` handler ever runs.
                // preventDefault on the press keeps focus on the textarea;
                // the checkbox still toggles and fires `change` off the
                // click that follows, since neither is prevented.
                ['mousedown', 'touchstart'].forEach(type => pick.addEventListener(type, (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                }));
                pick.addEventListener('click', (e) => e.stopPropagation());
                pick.addEventListener('change', () => el._applyLabelPick?.(index, pick.checked));
            }

            const toggle = (e) => {
                e.stopPropagation();
                if (e.type === 'touchend') e.preventDefault();

                const isOpen = details.style.display !== 'none';
                this._closeAllSummaryDetails(el);
                if (isOpen) return;
                this._openSummaryDetails(el, chip, details, f);
            };
            chip.addEventListener('click', toggle);
            if (this._isTouch) chip.addEventListener('touchend', toggle);

            // The details panel is a scrollable table nested inside the
            // marker's own scrollable body - without these, a scroll/select
            // inside it would zoom the map (wheel/touchmove bubbling to
            // mapbox) or re-collapse the row it belongs to (click bubbling
            // back up to the chip's own toggle above).
            details.addEventListener('wheel', (e) => e.stopPropagation());
            details.addEventListener('touchmove', (e) => e.stopPropagation());
            details.addEventListener('touchstart', (e) => e.stopPropagation());
            details.addEventListener('mousedown', (e) => e.stopPropagation());
            details.addEventListener('click', (e) => e.stopPropagation());
            details.addEventListener('touchend', (e) => e.stopPropagation());
        });
    }

    /**
     * Collapses every expanded summary row in this marker and drops the
     * active highlight - including swapping each chip's layer-info row back
     * down to its plain icon (see _buildChipLayerRowHTML/_openSummaryDetails).
     *
     * Deliberately leaves any quick property filter a row applied (see
     * _applyFeatureFilter) exactly as it is: collapsing the row - to look at
     * another feature, or just to tidy the panel up - isn't itself a decision
     * to undo the filter, only removing the marker that never got a name
     * counts as that (see removeMarker).
     */
    _closeAllSummaryDetails(el) {
        el.querySelectorAll('.marker-summary-details').forEach(d => { d.style.display = 'none'; });
        el.querySelectorAll('.marker-summary-chevron').forEach(c => c.setAttribute('name', 'chevron-right'));
        el.querySelectorAll('.marker-summary-chip').forEach(c => c.setAttribute('aria-expanded', 'false'));
        // `visibility`, not `display: none` - the icon still has to hold its
        // place in the row so the value beside it lines up with where it sat
        // collapsed, the same indent the property rows below line up with too.
        el.querySelectorAll('.marker-summary-chip__icon').forEach(icon => { icon.style.visibility = 'visible'; });
        el.querySelectorAll('.marker-layer-info-row').forEach(row => { row.style.display = 'none'; });
        this._setActiveSummaryChip(el, null);
    }

    /**
     * Fills and reveals one row's details, rebuilt fresh on every open - so an
     * address still being reverse-geocoded, or a handler still loading, is
     * never shown stale from an earlier open. The address row has no feature
     * of its own - it shows the reverse-geocoded hierarchy instead (see
     * _fillAddressDetails).
     */
    _openSummaryDetails(el, chip, details, f) {
        this._setActiveSummaryChip(el, chip);
        chip.setAttribute('aria-expanded', 'true');
        chip.querySelector('.marker-summary-chevron')?.setAttribute('name', 'chevron-down');
        // The chip's own icon collapses back to this same layer-info row once
        // expanded (see _buildChipLayerRowHTML) - swap them, rather than
        // rebuilding either, since both were already built with the chip.
        // `visibility`, not `display: none`, so the icon keeps its place in
        // the row and the value beside it doesn't shift left to fill the gap.
        const icon = chip.querySelector('.marker-summary-chip__icon');
        if (icon) icon.style.visibility = 'hidden';
        const layerRow = chip.querySelector('.marker-layer-info-row');
        if (layerRow) layerRow.style.display = 'flex';

        if (f) {
            details.innerHTML = this._buildFeatureFlyoutContentHTML(f);
            this._attachFeatureDetailsHandlers(details);
            this._attachFeatureRowActionHandlers(details, f);
            const badgeDetails = details.querySelector('.feature-badge-details');
            if (badgeDetails) this._loadInspectionHandlerHTML(badgeDetails, f.layerId, f.featureId);
        } else {
            details.innerHTML = `<div class="marker-flyout-drag-handle" style="display:flex;align-items:center;gap:4px;padding:4px 6px;background:#111827;border-bottom:1px solid #374151;">` +
                `<sl-icon name="signpost" style="font-size:12px;color:#9ca3af;"></sl-icon>` +
                `<span style="font-size:10px;color:#e5e7eb;font-weight:600;flex:1;">Address</span></div>` +
                `<div class="address-badge-details" style="width:100%;box-sizing:border-box;padding:4px 6px;"></div>`;
            const markerId = this._findMarkerIdByElement(el);
            const addrDetails = details.querySelector('.address-badge-details');
            if (markerId && addrDetails) this._fillAddressDetails(addrDetails, markerId);
        }

        details.style.display = 'block';
    }

    _findMarkerIdByElement(el) {
        for (const [id, markerData] of this._markers) {
            if (markerData.marker?.getElement?.() === el) return id;
        }
        return null;
    }

    _setActiveSummaryChip(el, activeChip) {
        el.querySelectorAll('.marker-summary-chip').forEach(chip => {
            const isActive = chip === activeChip;
            chip.style.background = isActive ? '#1e3a5f' : 'transparent';
            chip.style.borderColor = isActive ? '#3b82f6' : 'transparent';
            chip.querySelector('.marker-summary-chip__value').style.color = isActive ? '#93c5fd' : '#f3f4f6';
            // The property list beneath an active chip carries the same fill,
            // so the two read as one highlighted block for this feature
            // rather than a plain list hanging off a highlighted label.
            const details = chip.closest('.marker-summary-item')?.querySelector('.marker-summary-details');
            if (details) details.style.background = isActive ? '#1e3a5f' : 'transparent';
        });
    }

    /**
     * What a not-yet-named marker's id editor opens pre-filled with: the
     * reverse-geocoded address's own name (see nominatim-search.js's
     * reverseGeocodeAddress and _resolveMarkerAddress, which stashes the
     * result on `markerData.address`) rather than the bare auto-numbered id -
     * "Assagao Church" is worth keeping as-is, "3" is not. A point that
     * matched no named POI has no `name` - `displayName`'s own leading part
     * (Nominatim's most-specific component, same idea as `parts[0]`) is the
     * next best thing. Falls back to the id itself if the address hasn't
     * resolved yet, or carries neither.
     */
    _defaultMarkerLabel(markerId) {
        const markerData = this._markers.get(markerId);
        const address = markerData?.address;
        const fromDisplayName = address?.displayName?.split(',')[0]?.trim();
        return address?.name || fromDisplayName || idToLabel(markerData?.urlId ?? '');
    }

    /** Scroll/selection guards and the "show all properties" toggle inside a rendered feature table. */
    _attachFeatureDetailsHandlers(root) {
        const details = root.querySelector('.feature-badge-details');
        if (!details) return;

        const showAllBtn = details.querySelector('.badge-show-all-props-btn');
        if (!showAllBtn) return;

        showAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const shown = details.querySelector('.badge-shown-properties');
            const all = details.querySelector('.badge-all-properties');
            const total = showAllBtn.dataset.total;
            const isShowingAll = all.style.display !== 'none';
            all.style.display = isShowingAll ? 'none' : 'block';
            if (shown) shown.style.display = isShowingAll ? 'block' : 'none';
            showAllBtn.textContent = isShowingAll ? `Show all ${total} properties` : 'Show less';
        });
    }

    /**
     * Wires every property row (see _buildFeatureRowsHTML's `interactive`):
     * clicking one selects it - highlighting it, hiding any other row's own
     * actions, and copying `key\tvalue` to the clipboard as a quick
     * reference - and reveals its Replace/Add/Remove Filter buttons.
     * Hovering a row (or its Add/Remove button specifically) only previews
     * what that action would do on the map; only an actual click ever
     * touches `activeConditions`, the layer's own config, or the URL (all
     * three are _applyFeatureFilter's job), so glancing at a row never has a
     * side effect by itself.
     *
     * Once a property is already part of the filter, the only thing left to
     * offer is dropping it again - not replacing or re-adding what's already
     * there - so its row shows just "Remove From Filter" (see
     * isConditionActive). Otherwise: the filter opens narrowed to
     * inspect.id's own value by default (see `activeConditions`'s initial
     * value below) - but since that field uniquely names one feature
     * already, "Add"ing it to anything else would just collapse back to the
     * same single feature "Replace" already gives you, so its row never
     * offers that option. The same reasoning gates every *other* row's own
     * "Add": from that one-feature starting filter, adding a second property
     * on top of it is equally pointless - only once the filter has actually
     * been replaced with something broader does combining further make
     * sense.
     */
    _attachFeatureRowActionHandlers(details, f) {
        const rows = [...details.querySelectorAll('.feature-row')].filter(row => row.dataset.fieldKey);
        if (!rows.length) return;

        const layerConfig = this._stateManager.getLayerConfig(f.layerId);
        const idField = layerConfig?.inspect?.id || null;
        const properties = f.feature?.properties || {};

        let activeConditions = (idField && properties[idField] !== undefined)
            ? [{ key: idField, value: properties[idField] }]
            : [];
        let selectedKey = null;

        const isIdOnlyFilter = () => activeConditions.length === 1 && activeConditions[0].key === idField;
        const applyConditions = () => this._applyFeatureFilter(f.layerId, activeConditions);

        const setHighlighted = (btn, on) => {
            if (!btn) return;
            btn.style.background = on ? 'rgba(59, 130, 246, 0.35)' : 'rgba(59, 130, 246, 0.15)';
            btn.style.borderColor = on ? '#3b82f6' : 'rgba(59, 130, 246, 0.4)';
            btn.style.color = on ? '#ffffff' : '#93c5fd';
        };

        /**
         * A live preview only - never touches `activeConditions`, the
         * layer's own config, or the URL (that's all _applyFeatureFilter,
         * only ever run from a click below). Lets hovering a row or its Add
         * button show what committing it would look like on the map without
         * it being saved unless the button is actually clicked.
         */
        const previewConditions = (conditions) => {
            if (!this._map || !f.layerId) return;
            const saved = this._originalLayerFilters?.get(f.layerId);
            const filter = conditions.length
                ? ['all', ...conditions.map(({ key: k, value }) => ['==', ['get', k], value])]
                : null;
            this._getMapboxSubLayerIds(f.layerId).forEach(subLayerId => {
                try {
                    this._map.setFilter(subLayerId, filter ?? saved?.perSubLayer?.get(subLayerId) ?? null);
                } catch (e) {
                    // Layer may have been removed from the map since.
                }
            });
        };
        // Back to whatever is actually committed, not necessarily "no filter".
        const cancelPreview = () => previewConditions(activeConditions);

        const isConditionActive = (key) => activeConditions.some(c => c.key === key);

        const syncRowActions = () => {
            rows.forEach(row => {
                const key = row.dataset.fieldKey;
                const isSelected = key === selectedKey;
                row.style.background = isSelected ? '#1e3a5f' : 'transparent';

                const actions = row.querySelector('.feature-row-actions');
                if (!actions) return;
                actions.style.display = isSelected ? 'flex' : 'none';
                if (!isSelected) return;

                const replaceBtn = actions.querySelector('[data-action="replace"]');
                const addBtn = actions.querySelector('[data-action="add"]');
                const removeBtn = actions.querySelector('[data-action="remove"]');

                // Already part of the filter - the only thing left to offer
                // is dropping it, not replacing or re-adding what's already
                // there.
                if (isConditionActive(key)) {
                    if (replaceBtn) replaceBtn.style.display = 'none';
                    if (addBtn) addBtn.style.display = 'none';
                    if (removeBtn) removeBtn.style.display = 'inline-flex';
                    return;
                }
                if (removeBtn) removeBtn.style.display = 'none';

                if (key === idField) {
                    if (replaceBtn) replaceBtn.style.display = 'inline-flex';
                    if (addBtn) addBtn.style.display = 'none';
                } else {
                    if (replaceBtn) replaceBtn.style.display = 'inline-flex';
                    if (addBtn) addBtn.style.display = isIdOnlyFilter() ? 'none' : 'inline-flex';
                }
            });
        };

        rows.forEach(row => {
            const key = row.dataset.fieldKey;

            row.addEventListener('click', (e) => {
                if (e.target.closest('.feature-row-action')) return;
                e.stopPropagation();

                navigator.clipboard?.writeText?.(`${key}\t${properties[key]}`).catch(() => {});
                selectedKey = selectedKey === key ? null : key;
                syncRowActions();
            });

            const replaceBtn = row.querySelector('[data-action="replace"]');
            const addBtn = row.querySelector('[data-action="add"]');
            const removeBtn = row.querySelector('[data-action="remove"]');
            // Same reasoning as the summary row's own pick checkbox
            // (_attachMarkerSummaryHandlers): stop the press from bubbling
            // into the row's own click above, or the balloon drag beyond it.
            [replaceBtn, addBtn, removeBtn].forEach(btn => btn?.addEventListener('mousedown', (e) => e.stopPropagation()));

            // Hovering the row previews what its Replace Filter button would
            // do - and highlights that button - without saving anything; only
            // an actual click (below) ever touches the filter. Skipped once
            // this property is already part of the filter: there's no Replace
            // button showing then (see syncRowActions), only Remove, which
            // previews its own effect below instead. A hidden/unselected
            // row's actions never receive a real pointer event in the first
            // place, so none of this needs an `isSelected` guard of its own.
            row.addEventListener('mouseenter', () => {
                if (isConditionActive(key)) return;
                previewConditions([{ key, value: properties[key] }]);
                setHighlighted(replaceBtn, true);
            });
            row.addEventListener('mouseleave', () => {
                if (isConditionActive(key)) return;
                cancelPreview();
                setHighlighted(replaceBtn, false);
            });

            // Hovering Add specifically previews the combined filter instead
            // of Replace's, and highlights Add instead - falling back to the
            // row's own Replace preview on its way out rather than cancelling
            // outright, since the pointer is still over the row at that point.
            addBtn?.addEventListener('mouseenter', () => {
                previewConditions([...activeConditions.filter(c => c.key !== key), { key, value: properties[key] }]);
                setHighlighted(replaceBtn, false);
                setHighlighted(addBtn, true);
            });
            addBtn?.addEventListener('mouseleave', () => {
                previewConditions([{ key, value: properties[key] }]);
                setHighlighted(addBtn, false);
                setHighlighted(replaceBtn, true);
            });

            // Hovering Remove previews the filter with just this one
            // condition dropped - the mirror image of Add's preview above.
            removeBtn?.addEventListener('mouseenter', () => {
                previewConditions(activeConditions.filter(c => c.key !== key));
                setHighlighted(removeBtn, true);
            });
            removeBtn?.addEventListener('mouseleave', () => {
                cancelPreview();
                setHighlighted(removeBtn, false);
            });

            replaceBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                activeConditions = [{ key, value: properties[key] }];
                applyConditions();
                setHighlighted(replaceBtn, false);
                syncRowActions();
            });

            addBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                activeConditions = [...activeConditions.filter(c => c.key !== key), { key, value: properties[key] }];
                applyConditions();
                setHighlighted(addBtn, false);
                syncRowActions();
            });

            removeBtn?.addEventListener('click', (e) => {
                e.stopPropagation();
                activeConditions = activeConditions.filter(c => c.key !== key);
                applyConditions();
                setHighlighted(removeBtn, false);
                syncRowActions();
            });
        });

        // Narrows to just this feature the moment its details open, same
        // starting point every time - see the doc comment above.
        applyConditions();
    }

    /**
     * Every real Mapbox GL style layer id this app's layer renders as - a
     * config layer often becomes more than one style layer (fill/line/circle
     * passes), all tagged with the same `metadata.groupId` at add time (same
     * pattern map-feature-control-iframe.js's _reorderLayers reads).
     */
    _getMapboxSubLayerIds(layerId) {
        const styleLayers = this._map?.getStyle?.()?.layers || [];
        return styleLayers.filter(l => l.metadata?.groupId === layerId).map(l => l.id);
    }

    /**
     * The live config entry a layer's own controls (opacity slider, compare,
     * this quick filter) all read and write in place - the same group
     * map-feature-control-iframe.js's _updateLayerOpacity mutates, and the
     * same `id`/`_prefixedId`/`_originalId` match shortcut-menu-base.js's
     * own _getGroupElement uses, so this finds a layer under whichever form
     * of its id the caller happens to have.
     */
    _getLayerGroup(layerId) {
        const groups = window.layerControl?._state?.groups;
        if (!groups) return null;
        return groups.find(g => g.id === layerId || g._prefixedId === layerId || g._originalId === layerId) || null;
    }

    /**
     * Records a layer's filter exactly once, the first time this session
     * ever touches it - both the real filter already sitting on each of its
     * style layers, and whatever `filter` its own config carried (or didn't)
     * - so however many times a property pick rewrites either afterward,
     * _restoreOriginalLayerFilter always has the layer's true starting
     * point (not just "no filter") to put back.
     */
    _saveOriginalLayerFilter(layerId) {
        if (!this._originalLayerFilters) this._originalLayerFilters = new Map();
        if (this._originalLayerFilters.has(layerId)) return;

        const perSubLayer = new Map();
        this._getMapboxSubLayerIds(layerId).forEach(subLayerId => {
            let filter = null;
            try {
                filter = this._map.getFilter(subLayerId) ?? null;
            } catch (e) {
                // Layer may not exist yet, or getFilter isn't supported on it.
            }
            perSubLayer.set(subLayerId, filter);
        });

        this._originalLayerFilters.set(layerId, {
            perSubLayer,
            groupFilter: this._getLayerGroup(layerId)?.filter
        });
    }

    /**
     * Puts back whatever filter a layer had before a property pick ever
     * touched it - on the map itself, and on its config entry (so a
     * restored layer stops carrying a `filter` the URL would otherwise keep
     * re-sharing, see _applyFeatureFilter).
     */
    _restoreOriginalLayerFilter(layerId) {
        const saved = this._originalLayerFilters?.get(layerId);
        if (!saved) return;

        saved.perSubLayer.forEach((filter, subLayerId) => {
            try {
                this._map.setFilter(subLayerId, filter);
            } catch (e) {
                // Layer may have been removed from the map since.
            }
        });

        const group = this._getLayerGroup(layerId);
        if (group) {
            if (saved.groupFilter === undefined) delete group.filter;
            else group.filter = saved.groupFilter;
        }
    }

    /**
     * Applies (`conditions.length > 0`) or clears (back to the original -
     * see _restoreOriginalLayerFilter) the quick property filter for a
     * layer's every real style layer, and mirrors it onto the layer's own
     * config entry (`group.filter`) so it's a real, sharable property of the
     * layer rather than a Mapbox-only side effect - url-manager.js already
     * serializes any non-default `filter` on a layer's config into the
     * `?layers=` URL the same way it already does for `opacity` (see
     * docs/API.md), so this alone is what makes the filter link-shareable.
     * No-ops quietly with nothing to filter (no map yet, e.g. in a unit
     * test, or a layer that isn't actually on the map any more).
     */
    _applyFeatureFilter(layerId, conditions) {
        if (!this._map || !layerId) return;
        const subLayerIds = this._getMapboxSubLayerIds(layerId);
        if (!subLayerIds.length) return;

        this._saveOriginalLayerFilter(layerId);

        if (!conditions.length) {
            this._restoreOriginalLayerFilter(layerId);
            this._activeFeatureFilterLayerId = null;
            window.urlManager?.updateURL({ updateLayers: true });
            return;
        }

        const filter = ['all', ...conditions.map(({ key, value }) => ['==', ['get', key], value])];
        subLayerIds.forEach(subLayerId => {
            try {
                this._map.setFilter(subLayerId, filter);
            } catch (e) {
                console.warn(`[MapMarkerManager] Could not set filter on "${subLayerId}":`, e);
            }
        });
        const group = this._getLayerGroup(layerId);
        if (group) group.filter = filter;
        this._activeFeatureFilterLayerId = layerId;
        window.urlManager?.updateURL({ updateLayers: true });
    }

    /**
     * Wires the header _buildMarkerMenuHeaderHTML renders: the underlined id,
     * and the options button that reveals to its right once the marker opens.
     *
     * The label itself sanitizes as the user types (spaces -> `_`, the
     * shorthand grammar's own `(),:` dropped and everything else kept, matching
     * shorthand-id-utils.sanitizeId), and commits
     * on blur or Enter (not a Save button - unlike the comment box, a bad
     * rename has an unambiguous, non-destructive fallback: just revert the
     * field to the last good id). A duplicate or otherwise-rejected id briefly
     * flashes a red outline and reverts rather than silently doing nothing.
     */
    _attachMarkerIdRowHandlers(el, markerId) {
        const group = el.querySelector('.marker-menu-header');
        const input = el.querySelector('.marker-id-input');
        if (!group || !input) return;

        const badge = group.querySelector('.marker-id-badge');
        const badgeText = badge.querySelector('.marker-id-text');
        const inputWrap = input.closest('.marker-id-input-wrap');

        // The label is sized to its text so it reads as a name next to the pin
        // rather than as a form field stretched to some arbitrary width. `ch` is
        // the width of a "0" - an id of capitals and underscores runs wider than
        // that and would be clipped - so measure the real string in the input's
        // own font instead of counting characters.
        const ruler = document.createElement('span');
        ruler.setAttribute('aria-hidden', 'true');
        ruler.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;pointer-events:none;';
        group.appendChild(ruler);

        const sizeToContent = () => {
            const style = window.getComputedStyle(input);
            ruler.style.font = style.font;
            ruler.style.fontSize = style.fontSize;
            ruler.style.fontFamily = style.fontFamily;
            ruler.style.fontWeight = style.fontWeight;
            ruler.style.letterSpacing = style.letterSpacing;
            ruler.textContent = input.value || ' ';

            // Zero while the marker is still unlaid-out (or under a DOM that
            // doesn't lay out at all, e.g. jsdom) - fall back to the estimate.
            const measured = Math.ceil(ruler.getBoundingClientRect().width);
            input.style.width = measured > 0
                ? `${measured + 2}px`
                : `${Math.max(2, input.value.length + 1)}ch`;

            // The width above is what the text would take on one line - past
            // the textarea's own max-width (labelStyle) it wraps instead of
            // growing further, so the height has to follow along too. Reset
            // first: a textarea's scrollHeight only ever grows on its own,
            // never shrinks back down as content is deleted.
            input.style.height = 'auto';
            if (input.scrollHeight > 0) input.style.height = `${input.scrollHeight}px`;
        };
        sizeToContent();

        this._syncIdActions(el);

        if (!this._isTouch) {
            // Previews the input it is about to become: the same dark fill
            // `.marker-id-input` edits in, so hovering the label hints at the
            // click-to-rename affordance before the dotted underline (which
            // only shows once the marker is expanded) would.
            badge.addEventListener('mouseenter', () => {
                badge.style.background = '#111827';
            });
            badge.addEventListener('mouseleave', () => {
                badge.style.background = 'transparent';
            });
        }

        // At rest the id is a badge; clicking it swaps in the input to rename,
        // and blurring swaps back. Both live in the DOM already (see
        // _buildMarkerMenuHeaderHTML), so this only flips which one is showing.
        // A press anywhere outside the marker ends the edit. That press is also a
        // map click, which would drop a new marker where the user was only trying
        // to dismiss the field - so swallow the click it is about to produce, the
        // same way a marker drag release does (see `_suppressClickUntil`).
        // Whether the press that is about to blur the input landed inside this
        // marker. Reaching for a feature row or the options button blurs the
        // field just as clicking the map does, but it is not walking away from
        // the marker - so a brand-new one must not be destroyed for it.
        let pressWasInside = false;

        const dismissOutside = (e) => {
            pressWasInside = el.contains(e.target);
            if (pressWasInside) return;
            // Not for a first edit: that marker is about to be discarded, so the
            // click should go through and drop the next one where it landed -
            // the marker follows your clicks until you name one.
            if (el.dataset.idInitialEdit === '1') return;
            this._stateManager._suppressClickUntil = Date.now() + MARKER_DRAG_CLICK_SUPPRESS_MS;
        };

        const saveBtn = group.querySelector('.marker-id-save');
        const deleteBtn = group.querySelector('.marker-id-delete');
        const clearBtn = group.querySelector('.marker-id-clear');

        /**
         * Checked on every keystroke rather than only at save time, so a
         * collision is flagged while it's still just text in the field instead
         * of surfacing only after a rejected Enter/click - see save() below,
         * which still guards against the same thing for the initial value
         * startEdit prefills (the resolved address name, or another marker's
         * id, could already collide before the user has typed anything).
         */
        const syncValidity = () => {
            const markerData = this._markers.get(markerId);
            const sanitized = sanitizeId(input.value);
            const duplicate = sanitized !== markerData?.urlId && markerRegistry.has(sanitized);
            saveBtn.disabled = duplicate;
            saveBtn.title = duplicate ? 'Cannot save duplicate label' : 'Save id (Enter)';
            saveBtn.style.opacity = duplicate ? '0.4' : '1';
            saveBtn.style.cursor = duplicate ? 'not-allowed' : 'pointer';
            input.style.borderColor = duplicate ? MARKER_ID_ERROR_COLOR : MARKER_ID_INPUT_BORDER;
            return duplicate;
        };

        // Name-picker widget: which badge indices are currently "picked" into
        // the id, in the order they were checked (see _applyLabelPick below).
        // Rebuilt fresh by detectLabelPicks every time editing opens, so this
        // only has to survive for the life of one edit session.
        let labelPickOrder = [];

        /**
         * Every pickable row, in the same order _buildMarkerSummaryHTML shows
         * them - the real features (inspector order), then the address last.
         * The address entry's label reads null until _resolveMarkerAddress
         * lands (see _renderMarkerAddress), same as its chip showing
         * "Locating…" until then - renderLabelPicks/detectLabelPicks both
         * treat a null label as "leave this one out" rather than picking the
         * placeholder text.
         */
        // A comma can't survive in an id (see shorthand-id-utils.js's
        // ID_FORBIDDEN_RE - sanitizeId strips it outright, along with the
        // whitespace either side of it collapsing to `_`), so joining picks
        // with one would leave no trace of where a name ended and the next
        // began. A hyphen is a plain, allowed id character, so it survives
        // sanitizeId untouched and reads as a name-piece separator - use it
        // as this widget's own delimiter, not a comma.
        const LABEL_PICK_SEPARATOR = '-';

        const orderedPickables = () => {
            const markerData = this._markers.get(markerId);
            const entries = this._featuresInInspectorOrder(markerData?.badgeFeatures || [])
                .map(({ f, index }) => ({ index, getLabel: () => this._getBadgeLabelInfo(f).value }));
            entries.push({ index: ADDRESS_BADGE_INDEX, getLabel: () => markerData?.address?.text });
            return entries;
        };

        /** A picked row's label text, read the same way its chip already shows it. */
        const labelForBadgeIndex = (index) => {
            const label = orderedPickables().find(e => e.index === index)?.getLabel();
            return label ? String(label) : null;
        };

        /**
         * Rebuilds the whole id field from labelPickOrder - never a splice
         * into the existing text - so unchecking a name can't leave a stray
         * or double separator behind for save's sanitizeId to trip on.
         */
        const renderLabelPicks = () => {
            input.value = labelPickOrder.map(labelForBadgeIndex).filter(Boolean).join(LABEL_PICK_SEPARATOR);
            sizeToContent();
            syncValidity();
        };

        /**
         * The name-picker widget itself: checking a feature row's box appends
         * its label to the id, hyphen-separated, in the order checked;
         * unchecking drops just that name. Exposed on `el` so
         * _attachMarkerSummaryHandlers (wired separately, before this) can
         * reach it once a checkbox actually changes.
         */
        el._applyLabelPick = (index, checked) => {
            labelPickOrder = labelPickOrder.filter(i => i !== index);
            if (checked) labelPickOrder.push(index);
            renderLabelPicks();
        };

        /**
         * Pre-checks whichever rows the current id could have come from this
         * same picker, so reopening a label it already built lets you add or
         * drop a name instead of starting over. Only an exact match counts:
         * tries the longest inspector-ordered prefix of the feature list
         * whose picked-and-sanitized join equals the id exactly - a partial
         * or reordered match can't be told apart from a hand-typed
         * coincidence, so it's left alone (empty picks) rather than guessed
         * at. `sanitizeId` normalizes both sides the way a save would (spaces
         * to `_` - see shorthand-id-utils.js), which is what lets this
         * compare a hyphen-joined candidate against a hand-typed id that
         * happens to use the same separator.
         */
        const detectLabelPicks = () => {
            const markerData = this._markers.get(markerId);
            const ordered = orderedPickables();
            const currentId = markerData?.urlId || '';

            labelPickOrder = [];
            for (let k = ordered.length; k > 0; k--) {
                const prefix = ordered.slice(0, k);
                const labels = prefix.map(e => e.getLabel());
                // An unresolved address can't have contributed to a saved id yet.
                if (labels.some(l => !l)) continue;
                const candidate = sanitizeId(labels.join(LABEL_PICK_SEPARATOR));
                if (candidate && candidate === currentId) {
                    labelPickOrder = prefix.map(e => e.index);
                    break;
                }
            }

            el.querySelectorAll('.marker-summary-pick').forEach(cb => {
                cb.checked = labelPickOrder.includes(parseInt(cb.dataset.badgeIndex, 10));
            });
        };

        const startEdit = ({ initial = false } = {}) => {
            if (el.dataset.idEditing === '1') return;
            // Captured before anything below touches the badge - true only for
            // the single-tap open off the placeholder (see the badge click
            // handler), never for the arm-then-edit path on an already-named one.
            const openedFromPlaceholder = badgeText.textContent === MARKER_ID_PLACEHOLDER;
            el.dataset.idEditing = '1';
            // A marker created by a map click opens straight into its editor and
            // has not been committed to yet, so abandoning that first edit
            // abandons the marker (see discard).
            if (initial) el.dataset.idInitialEdit = '1';
            pressWasInside = false;
            badge.style.display = 'none';
            if (inputWrap) inputWrap.style.display = 'inline-block';
            input.hidden = false;
            saveBtn.style.display = 'flex';
            deleteBtn.style.display = 'flex';
            clearBtn.style.display = 'flex';
            // Wider than the ordinary menu cap (see MARKER_ID_EDIT_MAX_WIDTH):
            // the header row also has to fit the save/delete/options buttons
            // and the clear icon alongside the textarea, which the ordinary
            // cap leaves it no room to grow into. Reset by endEdit.
            const contentEl = el.querySelector('.marker-content');
            if (contentEl) contentEl.style.maxWidth = `${MARKER_ID_EDIT_MAX_WIDTH}px`;
            const currentUrlId = this._markers.get(markerId)?.urlId ?? badgeText.textContent;
            // A plain auto-numbered id (see nextSerialId) hasn't been named yet -
            // lead with the reverse-geocoded address name, if one has come back
            // in time, rather than a bare "1" the user would just delete anyway.
            input.value = /^\d+$/.test(currentUrlId)
                ? this._defaultMarkerLabel(markerId)
                : idToLabel(currentUrlId);

            // Opening the placeholder's editor already commits that default
            // label - the point of the placeholder was to invite a name, and
            // the resolved address name (or the plain id, absent one) is as
            // good a name as asking the user to retype it. Save stays offered
            // regardless, in case they'd rather type over it right away.
            if (openedFromPlaceholder) {
                const markerData = this._markers.get(markerId);
                const sanitized = sanitizeId(input.value);
                if (markerData && sanitized
                    && (sanitized === markerData.urlId || this.renameMarkerUrlId(markerId, sanitized))) {
                    markerData.saved = true;
                }
            }
            sizeToContent();
            syncValidity();
            this._syncIdActions(el);
            // Reveals the name-picker checkboxes and pre-checks whichever
            // rows the id already came from (see detectLabelPicks) - after
            // the placeholder auto-save above, so it reads the id that save
            // actually committed rather than the placeholder it replaced.
            el.querySelectorAll('.marker-summary-pick').forEach(cb => { cb.style.display = 'inline-block'; });
            detectLabelPicks();
            input.focus();
            // Selected, so typing replaces the id outright - renaming is the
            // common case here, appending to it is not.
            input.select();
            // Capture, so it still runs for a press the map would otherwise
            // consume before it bubbles anywhere useful.
            document.addEventListener('mousedown', dismissOutside, true);
            document.addEventListener('touchstart', dismissOutside, true);
        };

        // Exposed so other code (currently just tests) can drive the editor
        // without duplicating any of this closure's state.
        el._startIdEdit = startEdit;

        // Entry point for the shortcut menu's "Edit Label" (see
        // MapMarkerManager.startIdEdit) - selects the marker and jumps
        // straight into the editor, same as the label's own two-step
        // click-to-arm-then-edit ends up doing, but in one call since a menu
        // pick is already a deliberate "edit this" action.
        el._openIdEditor = () => {
            const openedFromPlaceholder = badgeText.textContent === MARKER_ID_PLACEHOLDER;
            this._selectMarker(markerId);
            startEdit({ initial: openedFromPlaceholder });
        };

        const endEdit = () => {
            if (el.dataset.idEditing !== '1') return;
            // Cleared first, so the blur that follows knows the edit is already
            // resolved and doesn't discard on top of a save.
            delete el.dataset.idEditing;
            delete el.dataset.idInitialEdit;
            document.removeEventListener('mousedown', dismissOutside, true);
            document.removeEventListener('touchstart', dismissOutside, true);
            const urlId = this._markers.get(markerId)?.urlId ?? sanitizeId(input.value);
            badgeText.textContent = idToLabel(urlId);
            badge.title = idToLabel(urlId);
            // Once an edit has happened the badge always shows a real id, never
            // the placeholder again - so its muted color (set at first render,
            // see _buildMarkerMenuHeaderHTML) needs to brighten back up too.
            badge.style.color = MARKER_ID_TEXT_COLOR;
            input.hidden = true;
            if (inputWrap) inputWrap.style.display = 'none';
            saveBtn.style.display = 'none';
            saveBtn.disabled = false;
            saveBtn.title = 'Save id (Enter)';
            saveBtn.style.opacity = '1';
            saveBtn.style.cursor = 'pointer';
            input.style.borderColor = MARKER_ID_INPUT_BORDER;
            deleteBtn.style.display = 'none';
            clearBtn.style.display = 'none';
            badge.style.display = 'flex';
            this._syncIdActions(el);
            // Hides the name-picker checkboxes and forgets what was picked -
            // detectLabelPicks re-derives it from whatever the id ended up as
            // next time editing opens, rather than carrying stale picks
            // forward across a save that changed the feature list underneath.
            labelPickOrder = [];
            el.querySelectorAll('.marker-summary-pick').forEach(cb => {
                cb.style.display = 'none';
                cb.checked = false;
            });
            // Reapplies the ordinary (non-editing) width cap now that
            // MARKER_ID_EDIT_MAX_WIDTH's wider one no longer applies - inlined
            // rather than calling _syncMarkerContent itself, which would also
            // re-run its unsaved-marker cleanup check with `idEditing` already
            // cleared above, and read as this edit having abandoned the marker
            // even on a path (e.g. discard()'s "kept" branch) that didn't.
            const contentEl = el.querySelector('.marker-content');
            if (contentEl) {
                contentEl.style.maxWidth = `${MARKER_ID_MAX_WIDTH}px`;
                // Same reasoning as the width cap above: editing alone (not
                // just selection/hover) was enough to opt into the more
                // opaque fill, so ending it needs its own re-check too.
                const shown = el.classList.contains('marker-selected') || el.dataset.markerHover === '1';
                contentEl.style.background = shown ? MARKER_PANEL_BG_ACTIVE : MARKER_PANEL_BG;
            }
            input.blur();
        };

        // Deliberately no mousedown guard of its own: the panel around the label
        // already stops the press (see _attachBalloonDragHandler), so dragging
        // the label repositions the panel like dragging anywhere else on it.
        //
        // The first click on the label focuses the marker; only a second one
        // opens the editor, so reaching for a marker can't rename it by
        // accident. Armed on the label itself rather than read off
        // `marker-selected`, because a marker is already selected the moment it
        // is created - which would otherwise make a fresh marker one stray click
        // from a rename. Enter on the focused label fires this same click
        // natively, so it needs no separate key handling.
        //
        // The one exception is the placeholder itself: "Click to save label" is
        // already an instruction to click it, so a single tap opens the editor
        // right away instead of asking for a second one first.
        // Bound to both events, same reasoning as shortcutsBtn below: mapbox's
        // own touch handling on the marker element can swallow the synthetic
        // 'click' a tap would otherwise produce, leaving a touch user's first
        // (or only) tap on the badge doing nothing. `touchend`'s preventDefault
        // heads that phantom click off, so this still runs exactly once.
        const openBadge = (e) => {
            e.stopPropagation();
            if (e.type === 'touchend') e.preventDefault();
            if (badgeText.textContent === MARKER_ID_PLACEHOLDER) {
                this._selectMarker(markerId);
                startEdit({ initial: true });
                return;
            }
            if (el.dataset.idArmed !== '1') {
                el.dataset.idArmed = '1';
                this._selectMarker(markerId);
                return;
            }
            startEdit();
        };
        badge.addEventListener('click', openBadge);
        if (this._isTouch) badge.addEventListener('touchend', openBadge);

        const shortcutsBtn = group.querySelector('.marker-id-shortcuts');
        const openShortcuts = (e) => {
            e.stopPropagation();
            if (e.type === 'touchend') e.preventDefault();
            if (!window.shortcutMenu) return;
            const p = e.touches?.[0] || e.changedTouches?.[0] || e;
            window.shortcutMenu._lngLat = this._markers.get(markerId)?.lngLat;
            window.shortcutMenu._show(p.clientX, p.clientY);
        };
        shortcutsBtn.addEventListener('click', openShortcuts);
        if (this._isTouch) shortcutsBtn.addEventListener('touchend', openShortcuts);

        // Same reasoning as the comment textarea: without this, using the
        // field at all would drag the marker balloon out from under the cursor.
        ['mousedown', 'click'].forEach(type => input.addEventListener(type, (e) => e.stopPropagation()));

        /**
         * Renames the marker. A rejected id (empty, or already taken) keeps the
         * edit open with the text intact so it can be corrected - closing on a
         * rejection would throw away what was typed with nothing to show for it.
         */
        const save = () => {
            const markerData = this._markers.get(markerId);
            if (!markerData) return endEdit();

            // Already flagged (disabled button, red outline, tooltip) by
            // syncValidity as the text was typed - Enter shouldn't slip a
            // duplicate past that just because the button itself is disabled.
            if (syncValidity()) {
                input.focus();
                return;
            }

            const sanitized = sanitizeId(input.value);
            if (sanitized !== markerData.urlId
                && (!sanitized || !this.renameMarkerUrlId(markerId, sanitized))) {
                input.style.borderColor = MARKER_ID_ERROR_COLOR;
                setTimeout(() => { input.style.borderColor = MARKER_ID_INPUT_BORDER; }, 800);
                input.focus();
                return;
            }

            // Naming a marker is what marks it as one to keep - accepting the id
            // it was given counts just as much as changing it.
            markerData.saved = true;
            endEdit();
            // Naming is the last step of creating a marker, so hand the panel
            // back to hover: it stays open while the pointer is still on it and
            // closes when that leaves, rather than holding focus - and staying
            // open - until something elsewhere is pressed. Not on touch, which
            // has no hover to hand it to.
            if (!this._isTouch) this._selectMarker(null);
        };

        /**
         * Escape, or clicking away. Normally that just leaves the id as it was -
         * but abandoning a brand-new marker's first edit abandons the marker
         * itself: dropping one is a commit-or-cancel gesture, so a marker you
         * never got round to naming does not stay behind.
         */
        const discard = () => {
            // Staying within the marker just closes the editor - the rows, the
            // options and the feature tables all have to remain reachable on a
            // marker that has not been named yet.
            if (!pressWasInside
                && el.dataset.idInitialEdit === '1'
                && !this._markers.get(markerId)?.saved) {
                // Deferred out of the blur that triggered it: tearing the marker
                // out of the DOM while the browser is still dispatching a blur on
                // a node inside it throws NotFoundError ("the node to be removed
                // is no longer a child... Perhaps it was moved in a 'blur' event
                // handler?"). removeMarker is a no-op if something else got there
                // first, so a racing click that clears it is harmless.
                setTimeout(() => this.removeMarker(markerId), 0);
                return;
            }
            input.value = idToLabel(this._markers.get(markerId)?.urlId ?? input.value);
            sizeToContent();
            endEdit();
        };

        input.addEventListener('input', () => {
            const cursor = input.selectionStart;
            // Spaces are allowed here and an underscore typed directly shows as
            // one: this field is the name, not the id. sanitizeId does the
            // reverse on commit, so what gets stored is still `a_b`.
            const shown = input.value.replace(/_/g, ' ').replace(/[^A-Za-z0-9 ]/g, '');
            if (shown !== input.value) {
                input.value = shown;
                if (cursor !== null) input.setSelectionRange(cursor, cursor);
            }
            sizeToContent();
            syncValidity();
        });

        /**
         * Pressing either button would otherwise blur the input first, and blur
         * discards - so the action would be thrown away by the very press asking
         * for it. preventDefault on the press keeps focus where it is.
         *
         * On touch that same preventDefault also cancels the synthesized click,
         * so these buttons were unreachable with a finger: the handler has to be
         * bound to touchend as well. Only one of the two ever fires - a
         * prevented touchstart produces no click - so there is no double-run.
         */
        const wireEditAction = (button, run) => {
            ['mousedown', 'touchstart'].forEach(type => {
                button.addEventListener(type, (e) => e.preventDefault());
            });
            const handler = (e) => {
                e.stopPropagation();
                run();
            };
            button.addEventListener('click', handler);
            button.addEventListener('touchend', handler);
        };

        wireEditAction(saveBtn, save);
        wireEditAction(clearBtn, () => {
            input.value = '';
            sizeToContent();
            input.focus();
        });
        wireEditAction(deleteBtn, () => {
            endEdit();
            this.removeMarker(markerId);
        });

        input.addEventListener('blur', () => {
            // endEdit clears this first, so a blur it triggers itself is inert
            // and cannot discard on top of a save.
            if (el.dataset.idEditing !== '1') return;
            discard();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                save();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                // An explicit cancel, whatever was last pressed.
                pressWasInside = false;
                discard();
            }
        });
    }

    /**
     * Whether a marker's id actions (options/move) are showing. A collapsed
     * marker is just its label - nothing else about it is on offer - so both
     * buttons stay hidden until it opens up, either by hover-preview or by
     * being the one in focus (see _selectMarker).
     *
     * The move handle is stricter still: it only appears once *selected*
     * (not merely hovered), since dragging is something you do to the marker
     * you're working with, not one you're just passing over.
     */
    _syncIdActions(el) {
        const shortcuts = el.querySelector('.marker-id-shortcuts');
        const moveHandle = el.querySelector('.marker-id-move');
        // Pushes the trailing action buttons to the end of the header - kept
        // hidden whenever none of them are, so a collapsed chip (just the id
        // badge) doesn't pick up an extra gap on its trailing edge from a
        // flex item with nothing after it (see _buildMarkerMenuHeaderHTML's
        // `.marker-menu-header-spacer`).
        const spacer = el.querySelector('.marker-menu-header-spacer');
        if (!shortcuts && !moveHandle && !spacer) return;

        // Editing already offers its own save/delete actions right alongside
        // it (see _buildMarkerMenuHeaderHTML) - the general options/move
        // buttons would just be clutter next to those, for actions unrelated
        // to naming the marker.
        if (el.dataset.idEditing === '1') {
            if (shortcuts) shortcuts.style.display = 'none';
            if (moveHandle) moveHandle.style.display = 'none';
            if (spacer) spacer.style.display = 'flex';
            return;
        }

        const focused = el.classList.contains('marker-selected');
        // The options button belongs to an open marker, alongside its rows -
        // a chip is just a name. Removal and collapse are deliberately absent:
        // clicking away closes a marker, and add-mode keeps the ones you want.
        const expanded = focused || el.dataset.markerHover === '1';
        if (shortcuts) shortcuts.style.display = expanded ? 'flex' : 'none';
        if (moveHandle) moveHandle.style.display = focused ? 'flex' : 'none';
        if (spacer) spacer.style.display = expanded ? 'flex' : 'none';
    }

    /**
     * Marker select mode: the marker you last clicked (or just created) is the
     * one in focus, and the only one showing its id actions. Selecting one
     * deselects the rest, so those actions never appear on two markers at once.
     */
    _selectMarker(markerId) {
        this._selectedMarkerId = markerId;

        this._markers.forEach((markerData, id) => {
            const el = markerData.marker?.getElement();
            if (!el) return;
            const selected = id === markerId;
            el.classList.toggle('marker-selected', selected);
            // A marker that loses focus forgets its armed label, so coming back
            // to it starts from the same click-to-focus step.
            if (!selected) delete el.dataset.idArmed;
            this._syncIdActions(el);
            this._syncMarkerContent(el, id);
        });
    }

    /**
     * A marker only opens into a menu while it is hovered or has focus.
     * Otherwise the panel is just its header - a chip carrying the id - so a
     * screen with several markers reads as a set of names rather than a pile of
     * overlapping tables.
     *
     * An unsaved marker is the exception: it exists only to invite a name (see
     * the placeholder badge, MARKER_ID_PLACEHOLDER), so once it loses focus
     * without one it has nothing left to say, and is removed outright rather
     * than lingering as a bare "Click to save label" chip until the next
     * marker replaces it (_clearUnsavedMarkers, which still runs at that point
     * as a backstop for markers created some other way). Not while its id is
     * actively being edited, though - that abandon-or-keep decision already
     * belongs to _attachMarkerIdRowHandlers' own discard(), which knows about
     * cases (e.g. reaching for a feature row inside the same marker) this
     * plain hover/select check does not.
     */
    _syncMarkerContent(el, markerId) {
        const selected = el.classList.contains('marker-selected');
        const hovered = el.dataset.markerHover === '1';
        const show = selected || hovered;

        if (!show && markerId && el.dataset.idEditing !== '1' && !this._markers.get(markerId)?.saved) {
            this.removeMarker(markerId);
            return;
        }

        const body = el.querySelector('.marker-menu-body');
        const content = el.querySelector('.marker-content');
        if (!body || !content) return;

        // A long id wraps rather than ellipsising or running off across the
        // map - collapsed or open, the badge's own max-width (see labelStyle
        // in _buildMarkerMenuHeaderHTML) wraps it the same way either time.
        // The balloon just needs to be at least that wide too, so the badge
        // has room to wrap inside it rather than spilling past its edge.
        // Editing gets a wider cap of its own (see MARKER_ID_EDIT_MAX_WIDTH):
        // the id textarea needs more room alongside the save/delete/options
        // buttons than the ordinary menu width leaves it, and the id row is
        // the only thing that cares.
        const editing = el.dataset.idEditing === '1';
        // A quiet, translucent chip at rest so the map reads through it, and
        // a more solid fill once it's the one actually being read or acted on.
        content.style.background = (show || editing) ? MARKER_PANEL_BG_ACTIVE : MARKER_PANEL_BG;
        // Glows the whole marker (tail + panel) as one outline - see
        // MARKER_GLOW_FILTER for why this is a filter on `el` rather than a
        // box-shadow on the panel alone.
        el.style.filter = show ? MARKER_GLOW_FILTER : 'none';
        body.style.display = show ? 'flex' : 'none';
        // Menu width only once it is a menu; as a chip it stays as wide as its id.
        content.style.minWidth = show ? `${MARKER_MENU_MIN_WIDTH}px` : '';
        content.style.maxWidth = `${editing ? MARKER_ID_EDIT_MAX_WIDTH : MARKER_ID_MAX_WIDTH}px`;
        // The id's dotted underline only means something once there is a menu
        // open beneath it to click into - a collapsed chip reads as a plain
        // label instead of inviting a click nothing else on it would explain.
        const badge = el.querySelector('.marker-id-badge');
        if (badge) badge.style.textDecorationLine = show ? 'underline' : 'none';
        // An open marker overlaps its neighbours, so it has to sit above them -
        // otherwise a menu opens underneath the chips around it.
        el.style.zIndex = hovered ? MARKER_Z_HOVERED : (selected ? MARKER_Z_SELECTED : '');
        // The tail doubles as the handle for dragging the marker's actual
        // location (see _buildMarkerLeaderHTML) - live only while the marker
        // is expanded, so brushing past a collapsed chip's tail can't
        // relocate it by accident. `pointer-events: none` (rather than
        // leaving the drag handler itself to check) keeps a real press from
        // ever hit-testing the tail at all while it's off.
        const tail = el.querySelector('.marker-leader-line');
        if (tail) tail.style.pointerEvents = show ? 'auto' : 'none';

        // Opening changes the panel's size, so the corner nearest the point can
        // change with it.
        this._syncMarkerLeader(el);

        if (!show) {
            this._closeAllSummaryDetails(el);
        }
    }

    /**
     * Wires the comment box that leads every marker balloon: auto-grows with
     * its content, reveals a Save button only once the text actually changes
     * from what was prefilled, and writes through to the notes sheet exactly
     * like the old "Add Note" popup form did.
     *
     * Editing an existing note (`noteEntry` set) updates that row in place —
     * matched server-side by its original latitude/longitude/timestamp, which
     * are unique per note — instead of appending a duplicate row.
     */
    _attachCommentSectionHandlers(el, lngLat, noteEntry) {
        const section = el.querySelector('.marker-comment-section');
        const textarea = section?.querySelector('.marker-comment-input');
        const saveBtn = section?.querySelector('.marker-comment-save-btn');
        if (!section || !textarea || !saveBtn) return;

        const existingProps = noteEntry?.feature?.properties;
        const match = existingProps ? {
            latitude: existingProps.latitude,
            longitude: existingProps.longitude,
            timestamp: existingProps.timestamp
        } : null;

        let originalValue = textarea.value;

        const resize = () => {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        };
        resize();

        // The marker balloon itself is draggable; typing/clicking in the comment
        // box must not trigger that drag.
        ['mousedown', 'click'].forEach(type => {
            textarea.addEventListener(type, (e) => e.stopPropagation());
            saveBtn.addEventListener(type, (e) => e.stopPropagation());
        });

        textarea.addEventListener('input', () => {
            resize();
            const changed = textarea.value.trim() !== originalValue.trim();
            saveBtn.style.display = changed ? 'block' : 'none';
            if (changed) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save';
            }
        });

        saveBtn.addEventListener('click', async () => {
            const notes = textarea.value.trim();
            if (!notes) return;

            const layerConfig = this._getWritableNotesLayer();
            const saveUrl = layerConfig?.saveUrl || window.GOOGLE_SHEETS_SAVE_URL;
            if (!saveUrl) {
                saveBtn.textContent = 'Click to Retry';
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';

            try {
                const { saveRow, captureMapContext } = await import('./google-sheets-writer.js');
                await saveRow({
                    saveUrl,
                    url: layerConfig.url,
                    match,
                    values: match
                        ? { notes }
                        : {
                            latitude: lngLat.lat,
                            longitude: lngLat.lng,
                            notes,
                            timestamp: new Date().toISOString(),
                            ...captureMapContext()
                        }
                });

                originalValue = notes;
                saveBtn.style.display = 'none';
                MapContextMessagesControl.show('Comment saved', { duration: 3000 });

                const api = this._mapboxAPI || window.layerControl?._mapboxAPI;
                if (api?.refreshLayerNow) {
                    setTimeout(() => api.refreshLayerNow(layerConfig.id, layerConfig), 2000);
                }
            } catch (error) {
                console.error('[MapMarkerManager] Failed to save comment:', error);
                saveBtn.disabled = false;
                saveBtn.textContent = 'Click to Retry';
            }
        });
    }

    // Only layers configured for write-back (a saveUrl, or a global default) can receive notes.
    _getWritableNotesLayer() {
        const groups = window.layerControl?._state?.groups || [];
        const csvLayers = groups.filter(g => g.type === 'csv' && (g.saveUrl || window.GOOGLE_SHEETS_SAVE_URL));
        return csvLayers.find(g => g.id === 'notes') || csvLayers[0] || null;
    }

    _escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Location of the "current" marker — the one most recently added or
     * navigated to via _navigateMarker (see `_currentMarkerIndex`) — or null
     * if no marker is on the map. Used e.g. by the Street View toolbar button
     * to search for imagery near an existing selection instead of falling
     * back to the map center.
     */
    getCurrentMarkerLngLat() {
        if (this._markers.size === 0) return null;
        const markerArray = Array.from(this._markers.values());
        const idx = Math.min(this._currentMarkerIndex, markerArray.length - 1);
        return markerArray[idx]?.lngLat || null;
    }

    /**
     * Every marker currently on the map as plain {id, lngLat, label, urlId}
     * data — used by the "Markers" section of map-nearby-features-control.js's
     * header-nav list. `label` reuses the same feature-label logic
     * _updateSelectionLayer uses for its exported GeoJSON's `name` property.
     * `urlId` is the marker's own `markers=`/badge id (marker-registry.js) —
     * used by location-navigator-control.js, which labels its "Saved Markers"
     * list by id rather than by feature content.
     */
    getMarkers() {
        return Array.from(this._markers.entries()).map(([id, markerData]) => ({
            id,
            lngLat: markerData.lngLat,
            label: this._describeMarkerLabel(markerData),
            urlId: markerData.urlId
        }));
    }

    /**
     * The raw features a marker was created/upgraded with, or `null` if there
     * is no such marker - used by shortcut-menu-base.js's _ensureMarkerAt to
     * tell a still-empty placeholder apart from one that already has its own
     * selection/content before deciding whether to upgrade it.
     */
    getMarkerFeatures(markerId) {
        return this._markers.get(markerId)?.features || null;
    }

    /**
     * A marker's `markers=`/route-reference id (marker-registry.js), or
     * `null` if there is no such marker - used by search/route-store.js's
     * _write() to derive each waypoint's `route-<rid>:` shorthand argument
     * from live marker state rather than storing a second copy of it.
     */
    getMarkerUrlId(markerId) {
        return this._markers.get(markerId)?.urlId || null;
    }

    /**
     * The real map marker referenced by a `markers=`/route-waypoint shorthand
     * id (marker-registry.js), or `null` if none has that id right now -
     * used by url-manager.js's applyRouteWaypointStyling() to turn a
     * `route-<rid>:` layer's `_waypointMarkerIds` (see route-url-api.js) into
     * the real markers to recolor.
     */
    getMarkerByUrlId(urlId) {
        for (const markerData of this._markers.values()) {
            if (markerData.urlId === urlId) return markerData.id;
        }
        return null;
    }

    /**
     * Renames a marker's `markers=`/route-reference id (see
     * marker-registry.js), driven by the inline "ID" input in its popup
     * (_buildMarkerMenuHeaderHTML/_attachMarkerIdRowHandlers below). Rejects an
     * invalid or already-used id (the input reverts to the last good value in
     * that case). A route referencing this marker doesn't need to be told
     * separately - RouteStore._write() derives each waypoint's shorthand id
     * from the marker's live `urlId` every time it (re)writes the URL, so the
     * next `updateURL()` (triggered here) already reflects the rename; a
     * `route-<rid>:` layer resolved from the URL on load carries its
     * reference as a snapshot instead (route-url-api.js's
     * `_waypointMarkerIds`), so that snapshot is also patched in place here.
     * Returns true on success.
     */
    renameMarkerUrlId(markerId, newUrlId) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return false;

        const sanitized = sanitizeId(newUrlId);
        if (!isValidId(sanitized)) return false;
        if (sanitized !== markerData.urlId && markerRegistry.has(sanitized)) return false;

        const oldUrlId = markerData.urlId;
        markerRegistry.remove(oldUrlId);
        markerData.urlId = sanitized;
        markerRegistry.set(sanitized, { id: sanitized, lng: markerData.lngLat.lng, lat: markerData.lngLat.lat, name: '', description: '' });

        window.layerControl?._state?.groups?.forEach(group => {
            if (!Array.isArray(group._waypointMarkerIds)) return;
            const idx = group._waypointMarkerIds.indexOf(oldUrlId);
            if (idx === -1) return;
            group._waypointMarkerIds[idx] = sanitized;
            if (typeof group._originalJson === 'string') {
                group._originalJson = group._originalJson.replace(
                    new RegExp(`(?<=[(,])${oldUrlId}(?=[,)])`),
                    sanitized
                );
            }
        });

        window.urlManager?.updateURL({ updateLayers: true });
        return true;
    }

    /**
     * Restoring markers from `?markers=` (url-manager.js's
     * restoreMarkersFromSelectionLayer, driven through the same click/
     * selection pipeline a real click uses) creates each marker with a fresh
     * auto-numbered `urlId` — it has no way to thread the original shared id
     * through that generic pipeline. This reconciles the two afterward: for
     * each `{id, lng, lat}` marker-registry.js parsed straight from the URL,
     * finds the real marker at that point and renames it back to the id the
     * link actually said, so a route referencing that id (route-url-api.js's
     * `_waypointMarkerIds`) resolves correctly once applyRouteWaypointStyling
     * runs right after this.
     */
    reconcileMarkerUrlIds(entries) {
        // Markers can share a location exactly (a link that pins several ids to
        // one point), and findMarkerNear always answers with the first match - so
        // without claiming them, every entry would rename the same marker in turn
        // and the rest would keep their auto-numbered ids.
        const claimed = new Set();

        (entries || []).forEach(({ id, lng, lat }) => {
            const markerId = this.findMarkerNear({ lng, lat }, 5, claimed);
            const markerData = markerId && this._markers.get(markerId);
            if (!markerData) return;

            claimed.add(markerId);
            if (markerData.urlId === id) return;

            markerRegistry.remove(markerData.urlId);
            markerData.urlId = id;
            markerRegistry.set(id, { id, lng: markerData.lngLat.lng, lat: markerData.lngLat.lat, name: '', description: '' });

            const el = markerData.marker.getElement();
            const badgeText = el?.querySelector('.marker-id-text');
            if (badgeText) {
                badgeText.textContent = idToLabel(id);
                badgeText.closest('.marker-id-badge').title = idToLabel(id);
            }
            const input = el?.querySelector('.marker-id-input');
            if (input) input.value = idToLabel(id);
        });
    }

    /**
     * Recolors/labels every real marker referenced by a `route-<rid>:` URL
     * shorthand layer's waypoint ids (route-url-api.js's
     * `_waypointMarkerIds`) as a route waypoint - the same look
     * search/route-store.js gives a drawn route's waypoints (adoptAsWaypoint's
     * pin recolor, setMarkerRefLabel's badge) - reusing those two methods
     * rather than a third copy of the styling. Markers restore from
     * `markers=` after routes are already resolved (see map-init.js's
     * ordering note in route-url-api.js's docstring), so this runs once,
     * right after that restoration, from url-manager.js.
     */
    applyRouteWaypointStyling() {
        const groups = window.layerControl?._state?.groups || [];
        groups.forEach(group => {
            const waypointIds = group._waypointMarkerIds;
            if (!Array.isArray(waypointIds)) return;

            waypointIds.forEach((urlId, index) => {
                const markerId = this.getMarkerByUrlId(urlId);
                if (!markerId) return;
                this.adoptAsWaypoint(markerId, { pinColor: WAYPOINT_PIN_COLOR });
                this.setMarkerRefLabel(markerId, group.id, `${group.id}-${index + 1}`, { color: WAYPOINT_PIN_COLOR });
            });
        });
    }

    _describeMarkerLabel(markerData) {
        const featureLabel = this.describeFeatures(markerData.features);
        if (featureLabel) return featureLabel;
        // No features here to name it after — the reverse-geocoded address
        // (see _resolveMarkerAddress) is already just its first two parts
        // (reverseGeocodeAddress's default `detail`), so it reads like "Panaji,
        // Goa" rather than a full postal address.
        if (markerData.address?.text) return markerData.address.text;
        return `${markerData.lngLat.lat.toFixed(4)}, ${markerData.lngLat.lng.toFixed(4)}`;
    }

    /**
     * A label for a set of selected features - the same "first field of each
     * feature, joined" rule _describeMarkerLabel uses for a marker already on
     * the map, exposed standalone so callers that only have a fresh feature
     * query (not yet a marker) - e.g. shortcut-menu-base.js naming a route
     * endpoint - can reuse it. Returns null (not a fallback string) when there
     * are no features, so callers know to fall back to something else, like a
     * geocoded address.
     */
    describeFeatures(features) {
        if (!features || features.length === 0) return null;
        return features.map(f => {
            const layerConfig = this._stateManager.getLayerConfig(f.layerId);
            const inspectConfig = layerConfig?.inspect || {};
            const labelField = inspectConfig.label || inspectConfig.id || 'id';
            return f.feature.properties?.[labelField] || f.featureId;
        }).join(', ');
    }

    /**
     * Centers/fits the map on one marker (reusing zoomToSelected's
     * features-bbox-or-point logic) — used to jump to a marker chosen from
     * the "Markers" section of map-nearby-features-control.js's list rather
     * than by clicking it directly on the map.
     */
    focusMarker(markerId) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;
        this.zoomToSelected(markerData.lngLat);
    }

    /**
     * Finds a marker within pixel tolerance of a lngLat, so callers like the
     * long-press shortcut menu can reuse a marker pressed directly on
     * it instead of creating a duplicate at (almost) the same spot.
     *
     * `exclude` skips marker ids already spoken for, so a caller walking a list
     * of co-located points pairs each one with a different marker instead of
     * every lookup answering with the same first match (see
     * reconcileMarkerUrlIds).
     */
    findMarkerNear(lngLat, thresholdPx = 40, exclude = null) {
        const point = this._map.project(lngLat);
        for (const [id, data] of this._markers) {
            if (exclude?.has(id)) continue;
            const markerPoint = this._map.project(data.lngLat);
            if (Math.hypot(markerPoint.x - point.x, markerPoint.y - point.y) <= thresholdPx) {
                return id;
            }
        }
        return null;
    }

    /**
     * Opens a marker's id editor from outside its own popup - e.g. the
     * shortcut menu's "Edit Label" (see shortcut-menu-base.js), which resolves
     * a markerId via findMarkerNear and hands it here rather than duplicating
     * the editor's own state.
     */
    startIdEdit(markerId) {
        const el = this._markers.get(markerId)?.marker?.getElement();
        el?._openIdEditor?.();
    }

    /** Moves an existing marker, e.g. to follow the waypoint it stands for. */
    moveMarker(markerId, lngLat) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;
        markerData.lngLat = lngLat;
        markerData.marker.setLngLat([lngLat.lng, lngLat.lat]);
        // The old address describes where it used to be; look the new one up.
        markerData.address = null;
        this._resolveMarkerAddress(markerId);
        if (markerData.urlId) {
            const entry = markerRegistry.get(markerData.urlId);
            markerRegistry.set(markerData.urlId, { ...(entry || { id: markerData.urlId, name: '', description: '' }), lng: lngLat.lng, lat: lngLat.lat });
        }
        this._updateSelectionLayer();
    }

    /**
     * Hands an existing marker over to a route as one of its waypoints: it
     * takes the route's pin colour and reports drags and its own removal back,
     * rather than being re-queried from whatever sits under it. Lets the marker
     * a destination click already dropped become that route's waypoint instead
     * of stacking a second pin on the same spot (see search/route-store.js).
     *
     * Also marks the marker saved: an unsaved marker is removed the moment it
     * loses focus (see _syncMarkerContent), which would otherwise delete a
     * brand-new marker - and the route pinned to it - the instant the route
     * pick's own menu/selection closes.
     */
    adoptAsWaypoint(markerId, { pinColor, onDrag, onDragEnd, onRemove } = {}) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;

        markerData.role = 'route-waypoint';
        markerData.saved = true;
        markerData.onDrag = onDrag;
        markerData.onDragEnd = onDragEnd;
        markerData.onRemove = onRemove;

        if (pinColor) {
            markerData.pinColor = pinColor;
            const el = markerData.marker.getElement();
            const tail = el?.querySelector('.marker-tail polygon');
            if (tail) tail.setAttribute('stroke', pinColor);
        }
    }

    /**
     * Names a marker after something meaningful - a route endpoint's
     * resolved address/feature label (see shortcut-menu-base.js's
     * _resolveEndpointLabel, search/route-store.js's route.names) - instead
     * of leaving its badge on the auto-numbered id "saved" quietly gave it
     * (see adoptAsWaypoint), which would otherwise still read as a bare
     * number or, worse, the "Click to save label" placeholder. Only touches
     * a marker that hasn't already been given a real name: one already
     * `saved` under a non-numeric id was either typed by the user or named
     * by an earlier call here, and either way outranks this default.
     */
    setDefaultMarkerLabel(markerId, label) {
        const markerData = this._markers.get(markerId);
        if (!markerData || !label) return;
        if (markerData.saved && !/^\d+$/.test(markerData.urlId)) return;

        const live = new Set([...this._markers.values()]
            .map(m => m.urlId)
            .filter(id => id !== markerData.urlId));
        const newUrlId = uniqueId(labelToId(label), live);

        markerRegistry.remove(markerData.urlId);
        markerData.urlId = newUrlId;
        markerData.saved = true;
        markerRegistry.set(newUrlId, { id: newUrlId, lng: markerData.lngLat.lng, lat: markerData.lngLat.lat, name: '', description: '' });

        const el = markerData.marker.getElement();
        const badgeText = el?.querySelector('.marker-id-text');
        if (badgeText) {
            badgeText.textContent = idToLabel(newUrlId);
            const badge = badgeText.closest('.marker-id-badge');
            if (badge) {
                badge.title = idToLabel(newUrlId);
                badge.style.color = MARKER_ID_TEXT_COLOR;
            }
        }
        const input = el?.querySelector('.marker-id-input');
        if (input) input.value = idToLabel(newUrlId);
    }

    /**
     * Renders (updates, or removes when `refLabel` is falsy) one route's ref
     * badge on a marker's id label - used for a route waypoint's `ref`
     * (`{mode}-{distanceText}:{stop_no}`, e.g. "walking-1.2km:3" - see
     * search/route-geojson.js's buildRouteFeatureCollection and
     * search/route-store.js's _syncMarkers, which keeps it current as
     * waypoints are added, removed, or reordered), so each stop along a
     * route can be pointed at visually by a short code rather than only by
     * position.
     *
     * Keyed by `routeId` (not a single value) because a marker can be a stop
     * on more than one route at once - each gets its own badge
     * (markerData.routeRefs tracks all of them), all living together inline
     * in a `.marker-id-refs` row of their own below the id text (badge is
     * flex-direction: column - see _buildMarkerMenuHeaderHTML), rather than
     * sharing a line with the id itself. That row only wraps onto a further
     * line once it runs past the badge's own max-width - the same as a long
     * id label wraps on its own. `options.color` becomes that badge's
     * background - the same color as the route's own line (see
     * search/route-store.js's WAYPOINT_PIN_COLOR) - so a badge reads as
     * belonging to that route even with several shown at once.
     *
     * The prefix (everything before the last `:`) is editable the same way
     * the marker id is - click to rename, Enter/blur to save, Escape to
     * cancel (see _startRefLabelEdit) - via `options.onRenameRef`. The
     * `:stop_no` suffix is never user-typed: it tracks the waypoint's
     * position in its route, so renaming only ever touches the prefix.
     */
    setMarkerRefLabel(markerId, routeId, refLabel, { color = WAYPOINT_PIN_COLOR, onRenameRef = null } = {}) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;
        if (!markerData.routeRefs) markerData.routeRefs = new Map();

        const badge = markerData.marker.getElement()?.querySelector('.marker-id-badge');

        if (!refLabel) {
            markerData.routeRefs.delete(routeId);
            const existing = badge && this._findRefLabelEl(badge, routeId);
            existing?.remove();
            // No stops left to show - drop the now-empty row rather than
            // leaving a blank line under the marker's id.
            if (badge && markerData.routeRefs.size === 0) badge.querySelector('.marker-id-refs')?.remove();
            return;
        }

        markerData.routeRefs.set(routeId, { label: refLabel, color, onRenameRef });
        if (!badge) return;

        let row = badge.querySelector('.marker-id-refs');
        if (!row) {
            row = document.createElement('span');
            row.className = 'marker-id-refs';
            // Its own line below the id text (badge is flex-direction:
            // column - see _buildMarkerMenuHeaderHTML) - every route's badge
            // lives inline together within this row, wrapping onto a further
            // line only once the row itself runs past the badge's own
            // max-width, the same as a long id label wraps on its own.
            row.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                row-gap: 2px;
                column-gap: 4px;
                margin-top: 2px;
            `;
            badge.appendChild(row);
        }

        let label = this._findRefLabelEl(badge, routeId);
        if (!label) {
            label = document.createElement('span');
            label.className = 'marker-id-ref';
            label.dataset.routeId = routeId;
            label.title = 'Click to rename';
            label.style.cssText = `
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 16px;
                height: 16px;
                padding: 0 4px;
                border-radius: 8px;
                font-size: 10px;
                font-weight: 700;
                line-height: 1;
                color: #fff;
                flex-shrink: 0;
                cursor: pointer;
            `;
            row.appendChild(label);
            label.addEventListener('click', (e) => {
                e.stopPropagation();
                this._startRefLabelEdit(markerId, routeId);
            });
        }
        label.style.background = color;
        label.textContent = refLabel;
    }

    /** The `.marker-id-ref` badge for one specific route, if the marker's badge has one. */
    _findRefLabelEl(badge, routeId) {
        return Array.from(badge.querySelectorAll('.marker-id-ref')).find(el => el.dataset.routeId === String(routeId)) || null;
    }

    /**
     * Swaps a route waypoint's ref badge for a small inline input, seeded
     * with just the prefix (the part before the last `:`) - the stop_no
     * suffix is shown as static text alongside it and never enters the
     * field, so there is nothing for the user to type that could change it.
     * Enter or blur sanitizes and saves via the marker's onRenameRef handler
     * (see search/route-store.js's _waypointHandlers); Escape reverts.
     */
    _startRefLabelEdit(markerId, routeId) {
        const markerData = this._markers.get(markerId);
        const entry = markerData?.routeRefs?.get(routeId);
        if (!entry?.onRenameRef) return;

        const badge = markerData.marker.getElement()?.querySelector('.marker-id-badge');
        const label = badge && this._findRefLabelEl(badge, routeId);
        if (!label) return;
        if (label.querySelector('input')) return; // already editing

        const currentRef = entry.label || '';
        const sepIndex = currentRef.lastIndexOf(':');
        const prefix = sepIndex === -1 ? currentRef : currentRef.slice(0, sepIndex);
        const stopSuffix = sepIndex === -1 ? '' : currentRef.slice(sepIndex);

        label.textContent = '';
        label.style.cursor = 'text';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = prefix;
        input.spellcheck = false;
        input.autocomplete = 'off';
        input.style.cssText = `
            width: ${Math.max(3, prefix.length + 1)}ch;
            min-width: 24px;
            background: #111827;
            border: 1px solid #6b7280;
            border-radius: 3px;
            color: #fff;
            font: inherit;
            font-size: 10px;
            font-weight: 700;
            padding: 0 2px;
        `;
        ['mousedown', 'click'].forEach(type => input.addEventListener(type, (e) => e.stopPropagation()));

        const suffixEl = document.createElement('span');
        suffixEl.textContent = stopSuffix;
        suffixEl.style.cssText = 'pointer-events: none; margin-left: 1px;';

        label.appendChild(input);
        label.appendChild(suffixEl);
        input.focus();
        input.select();

        let settled = false;
        const finish = (save) => {
            if (settled) return;
            settled = true;
            label.style.cursor = 'pointer';

            if (save) {
                const sanitized = sanitizeRouteRefPrefix(input.value);
                const candidate = `${sanitized}:${stopSuffix.slice(1) || '1'}`;
                if (sanitized && isValidRouteRefId(candidate)) {
                    entry.onRenameRef(sanitized);
                    return; // onRenameRef -> setMarkerRefLabel rebuilds the badge
                }
            }
            // Rejected or cancelled: just restore the badge text.
            this.setMarkerRefLabel(markerId, routeId, currentRef, entry);
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));
    }

    /**
     * The inverse of adoptAsWaypoint for one route: a marker dropped off
     * `routeId` (see search/route-store.js's removeMarkerFromRoute) loses
     * that route's own ref badge, but only reverts to a plain
     * marker - pin color reset, drag/close/rename handlers dropped - once it
     * isn't a stop on any *other* route either (a marker shared by several
     * routes keeps behaving/looking like a waypoint, and keeps whichever
     * other routes' badges it still has, until the last one lets go of it).
     */
    releaseWaypoint(markerId, routeId) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;

        this.setMarkerRefLabel(markerId, routeId, null);
        if (markerData.routeRefs?.size) return;

        markerData.role = null;
        markerData.pinColor = null;
        markerData.onDrag = null;
        markerData.onDragEnd = null;
        markerData.onRemove = null;

        const tail = markerData.marker.getElement()?.querySelector('.marker-tail polygon');
        if (tail) tail.setAttribute('stroke', '');
    }

    /**
     * Focuses a marker's comment input, e.g. right after the shortcut menu's
     * "Comments" action creates or locates the marker for a given location.
     */
    focusCommentInput(markerId) {
        const textarea = this._markers.get(markerId)?.marker?.getElement()?.querySelector('.marker-comment-input');
        if (!textarea) return;
        textarea.focus();
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
    }

    _expandBadgeValue(valueSpan) {
        if (!valueSpan || !valueSpan.dataset.full) return;
        valueSpan.textContent = valueSpan.dataset.full;
        valueSpan.style.whiteSpace = 'normal';
        valueSpan.style.overflow = 'visible';
        valueSpan.style.textOverflow = 'clip';
        // A single long unbroken token (an id-like string with no spaces)
        // would otherwise ignore the normal wrap and push past the badge's
        // width even with max-width set — force a mid-word break so it wraps
        // within the container instead.
        valueSpan.style.overflowWrap = 'anywhere';
        valueSpan.style.wordBreak = 'break-word';
    }

    _collapseBadgeValue(valueSpan) {
        if (!valueSpan || !valueSpan.dataset.short) return;
        valueSpan.textContent = valueSpan.dataset.short;
        valueSpan.style.whiteSpace = 'nowrap';
        valueSpan.style.overflow = 'hidden';
        valueSpan.style.textOverflow = 'ellipsis';
    }

    /**
     * Dim every badge in the marker except the hovered one, signalling that the
     * hovered feature's layer is isolated. Restored on mouseout.
     */
    _setSiblingBadgesDimmed(badge, dimmed) {
        const container = badge.parentElement;
        if (!container) return;
        container.querySelectorAll('.feature-badge').forEach(b => {
            // Active badge always full opacity; siblings dim to 0.5 while isolating.
            b.style.opacity = (b === badge || !dimmed) ? '1' : '0.5';
        });
    }

    _setBadgeCollapsed(badge) {
        badge.classList.remove('badge-selected');
        const details = badge.querySelector('.feature-badge-details');
        if (details) details.style.display = 'none';
        badge.style.background = 'transparent';
        const valueSpan = badge.querySelector('.badge-value');
        if (valueSpan) valueSpan.style.color = '#f3f4f6';
        this._collapseBadgeValue(valueSpan);
    }

    _setBadgeSelected(badge) {
        badge.classList.add('badge-selected');
        const details = badge.querySelector('.feature-badge-details');
        if (details) details.style.display = 'block';
        badge.style.background = '#1e3a5f';
        const valueSpan = badge.querySelector('.badge-value');
        if (valueSpan) valueSpan.style.color = '#93c5fd';
        this._expandBadgeValue(valueSpan);
    }

    /**
     * Toggle a selection-marker badge between collapsed and selected (expanded) state.
     * Selecting expands the attribute table and isolates the layer; deselecting
     * collapses it and clears isolation. Zooming to the feature is a manual action
     * (see the layer actions menu's "Zoom to Feature" item), not automatic here.
     */
    _toggleBadgeSelected(badge, f) {
        const wasSelected = badge.classList.contains('badge-selected');

        // Only one badge per marker stays expanded at a time. Collapse siblings
        // without restoring the view — we're about to either
        // select this badge or toggle it off, which handles the view itself.
        const container = badge.parentElement;
        if (container) {
            container.querySelectorAll('.feature-badge.badge-selected').forEach(b => {
                if (b !== badge) {
                    this._setBadgeCollapsed(b);
                    this._selectedBadges.delete(b);
                }
            });
        }

        if (wasSelected) {
            this._deselectBadge(badge);
        } else {
            this._selectBadge(badge, f);
        }
    }

    _selectBadge(badge, f) {
        this._setBadgeSelected(badge);
        this._selectedBadges.add(badge);

        if (!f) return;

        // On desktop, isolation is a hover-only effect (see the badge mouseenter/
        // mouseleave handlers). Touch devices have no hover, so apply isolation on
        // select instead; it persists until the badge is deselected.
        if (this._isTouch) {
            const lc = this._stateManager.getLayerConfig(f.layerId);
            const isBasemap = Array.isArray(lc?.tags) && lc.tags.includes('basemap');
            window.layerControl?.isolation?.isolate(f.layerId, isBasemap);
            this._setSiblingBadgesDimmed(badge, true);
        }

        // Layer's inspect.onClick handler (config/{atlas}.js) adds extra HTML
        // beyond the plain fields table.
        const details = badge.querySelector('.feature-badge-details');
        if (details) {
            this._loadInspectionHandlerHTML(details, f.layerId, f.featureId);
        }
    }

    _deselectBadge(badge) {
        this._setBadgeCollapsed(badge);
        this._selectedBadges.delete(badge);

        // On touch, isolation/dimming were applied on select, so clear them here.
        if (this._isTouch) {
            window.layerControl?.isolation?.clear();
            this._setSiblingBadgesDimmed(badge, false);
        }
    }

    _blockMapEvents(el) {
        // Mapbox appends marker elements inside the map's canvas container, which is
        // also where its own DOM event handlers are bound - so anything not stopped
        // here reaches the map as if the user had interacted with the map itself.
        //
        // mousemove/mouseover: Mapbox's mousemove handler runs queryRenderedFeatures
        // and sets hover state on whatever feature sits beneath this marker. The
        // marker (and its badges) should fully capture the pointer instead.
        // mouseenter/leave still fire, so the marker's own intentional feature
        // highlighting is unaffected.
        //
        // click: a click that reaches the map is a selection at that point, which in
        // replace mode clears every marker and builds a new one - i.e. clicking a
        // marker would silently replace it with a copy of itself. Clicking a marker
        // means "focus this marker" (see _selectMarker), never "select the map here".
        //
        // dblclick: reaches the map as double-click-to-zoom, so double-clicking
        // inside the id field zoomed the map instead of selecting the word under
        // the cursor. Only propagation is stopped, never the default, so the
        // browser's own text selection still happens.
        //
        // Bubble phase, so the marker's own children still receive their events; and
        // stopPropagation rather than stopImmediatePropagation, so the capture-phase
        // select listener addMarker registers on this same element still runs.
        ['mousemove', 'mouseover', 'click', 'dblclick'].forEach(type => {
            el.addEventListener(type, (e) => e.stopPropagation());
        });
    }

    _showHoverMarker(lngLat, labelText, features) {
        // Same feature(s) as currently shown — just reposition the existing marker
        // instead of tearing down and rebuilding its DOM every mousemove tick. The
        // rebuild is what made the label jump/stutter or lag behind the cursor.
        const key = features.map(f => `${f.layerId}:${f.featureId}`).sort().join('|');
        if (this._hoverMarker && this._hoverMarkerKey === key) {
            this._hoverMarker.setLngLat([lngLat.lng, lngLat.lat]);
            return;
        }

        // Remove existing hover marker
        this._clearHoverMarker();

        const el = document.createElement('div');
        el.className = 'hover-marker';
        // Same layout as the selection marker: an action row on top and the feature
        // badges below. The action row is kept as empty reserved space so the badges
        // line up — the buttons only appear once the location is clicked (selected).
        // The hover popup is purely a visual label: pointer-events are disabled so the
        // mouse passes straight through to the map, letting Mapbox keep updating hover
        // state on features beneath the popup. Clicking the underlying feature still
        // selects it (the map's own click handler queries and selects), which rebuilds
        // this as an interactive selection marker.
        el.style.cssText = 'display: flex; flex-direction: column; align-items: flex-start; gap: 4px; pointer-events: none; cursor: pointer; transform: none !important; transition: none !important;';

        const infoSize = 20;
        el.innerHTML = `
            <div class="marker-action-row" style="display: flex; flex-direction: row; align-items: center; gap: 4px; height: ${infoSize}px; flex-shrink: 0;"></div>
            <div class="marker-content" style="display: flex; flex-direction: column; align-items: stretch; gap: 0; max-width: 240px; background: ${MARKER_PANEL_BG}; border: 1px solid ${MARKER_PANEL_BORDER}; border-radius: 8px; box-shadow: ${MARKER_PANEL_SHADOW};">
                ${this._buildMarkerBadgesHTML(features, lngLat)}
            </div>
        `;

        const marker = new mapboxgl.Marker({
            element: el,
            anchor: 'top-left',
            offset: [-(infoSize / 2), -(infoSize / 2)]
        })
            .setLngLat([lngLat.lng, lngLat.lat])
            .addTo(this._map);

        // No badge handlers or hover-blocking for the hover popup — it is pointer-events:
        // none, so all interaction passes through to the map beneath it.

        this._hoverMarker = marker;
        this._hoverMarkerKey = key;
    }

    _clearHoverMarker() {
        if (this._hoverMarker) {
            this._hoverMarker.remove();
            this._hoverMarker = null;
        }
        this._hoverMarkerKey = null;
    }

    _findMarkerByFeatures(hoveredFeatures) {
        if (!hoveredFeatures || hoveredFeatures.length === 0) return null;

        // Create a set of hovered feature composite keys
        const hoveredKeys = new Set(
            hoveredFeatures.map(f => `${f.layerId}:${f.featureId}`)
        );

        // Find a marker that contains exactly the same features (or is a superset)
        for (const markerData of this._markers.values()) {
            const markerKeys = new Set(
                markerData.features.map(f => `${f.layerId}:${f.featureId}`)
            );

            // Check if all hovered features are in this marker
            let allHoveredFeaturesInMarker = true;
            for (const key of hoveredKeys) {
                if (!markerKeys.has(key)) {
                    allHoveredFeaturesInMarker = false;
                    break;
                }
            }

            // If all hovered features are in this marker, it's a match
            if (allHoveredFeaturesInMarker) {
                return markerData;
            }
        }

        return null;
    }

    _setMarkerHoverState(markerId, isHovered) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;

        const markerEl = markerData.marker.getElement();
        if (!markerEl) return;

        const contentEl = markerEl.querySelector('.marker-content');
        if (!contentEl) return;

        const badges = markerEl.querySelectorAll('.feature-badge');
        badges.forEach(b => {
            // Don't override the persistent styling of a selected (expanded) badge.
            if (b.classList.contains('badge-selected')) return;
            b.style.background = isHovered ? '#374151' : 'transparent';
        });
    }

    _clearAllMarkerHoverStates() {
        this._markers.forEach((markerData, markerId) => {
            this._setMarkerHoverState(markerId, false);
        });
    }

    /**
     * Drop duplicate features that share the same layer + feature id. queryRenderedFeatures
     * returns a feature once per tile it intersects, so a feature straddling a tile boundary
     * comes back multiple times and would otherwise render duplicate badges.
     */
    _dedupeFeatures(features) {
        if (!Array.isArray(features)) return features;
        const seen = new Set();
        return features.filter(f => {
            const key = `${f.layerId}:${f.featureId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Where a marker's content (badges/comment box) sits relative to the lngLat
     * it's added at, in screen pixels. The clicked point is the marker's own
     * top-left corner (see addMarker), so the panel hangs down and to the right
     * of it - clear of the point by the anchor gap on both axes, and below the
     * id row. Reused by shortcut-menu.js so its long-press menu opens in the
     * same place a marker's own popup would.
     */
    getContentOffset() {
        return {
            x: MARKER_ANCHOR_GAP,
            y: MARKER_ANCHOR_GAP + MARKER_ID_ROW_HEIGHT + MARKER_ACTION_ROW_GAP
        };
    }

    /**
     * The `markers=` id a new marker gets: a caller-supplied one - a chosen
     * search result's label (map-search-control.js's _addResultMarker), or the
     * id a shared link already named this marker by (restoreMarkersFromSelection
     * Layer) - turned into a valid id, or the next serial number when none was
     * given.
     *
     * A requested id only collides with ids held by *live* markers. An id that
     * only the registry holds is a placeholder hydrated from `?markers=` for a
     * marker not built yet (see map-init.js), and the marker being built for it
     * right now is exactly who should claim it - otherwise it would be pushed to
     * a `_2` suffix by its own placeholder. Serial numbering still steps over
     * both, so an auto-numbered marker never lands on a reserved id.
     */
    _resolveNewUrlId(requested) {
        const live = new Set([...this._markers.values()].map(m => m.urlId).filter(Boolean));

        if (requested) {
            const base = labelToId(requested);
            if (isValidId(base)) return uniqueId(base, live);
        }

        return nextSerialId([...new Set([...markerRegistry.allIds(), ...live])]);
    }

    addMarker(lngLat, features, options = {}) {
        // `role` marks a marker that belongs to something else and shouldn't be
        // rebuilt from whatever is under it: a route waypoint (see
        // search/route-store.js) is a point on a route first and a map
        // selection second, so it keeps its identity across a drag and reports
        // the move back through onDrag/onDragEnd instead.
        const {
            pendingLayerIds = null,
            onRemove = null,
            onDrag = null,
            onDragEnd = null,
            onRenameRef = null,
            role = null,
            pinColor = '#f97316',
            urlId: requestedUrlId = null,
            select: selectOnCreate = true,
            saved: savedOnCreate = false
        } = options;
        features = this._dedupeFeatures(features);
        const markerId = `marker-${Date.now()}-${this._markers.size}`;
        const markerNumber = this._markers.size + 1;

        const el = document.createElement('div');
        el.className = 'selection-marker';
        // The clicked point is the element's own top-left corner, so the whole
        // popup hangs down and to the right of it, clear of the point in both
        // directions - the padding is that gap, and the leader line crosses it
        // diagonally back to the point.
        //
        // `pointer-events: none` because that gap is empty space, not part of
        // the marker: it is only there to hold the panel off its point, so the
        // map has to stay reachable through it. Left hit-testable it swallowed
        // hovers and, since mapbox binds its marker drag to this element,
        // dragging that empty strip moved the marker instead of panning the map.
        // The panel and the tail turn hit-testing back on for themselves.
        //
        // No `position` here: mapbox's own .mapboxgl-marker sets `absolute`, and
        // an inline value overrides it - which drops every marker into normal
        // flow, stacking each one further down the page than the last. Absolute
        // is also a containing block, so the leader still anchors to this element.
        el.style.cssText = `display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: ${MARKER_ANCHOR_GAP}px 0 0 ${MARKER_ANCHOR_GAP}px; pointer-events: none;`;

        // A clicked notes-layer feature gets its own editable "Comment" rendering
        // instead of the generic badge, so pull it out of the badge list here.
        // Only special-case it while the notes layer is actually active — otherwise
        // a note feature would vanish from the badge list with no comment box to
        // show it in instead.
        const isNotesActive = this._isNotesLayerActive();
        const noteEntry = isNotesActive ? this._findNoteEntry(features) : null;
        const badgeFeatures = noteEntry ? features.filter(f => f !== noteEntry) : features;
        // The id this marker is referenced by in `markers=`/a route's
        // `route-<rid>:` waypoint list (see marker-registry.js) - user-renamable
        // via the input below.
        // A drag re-queries the drop point through the generic selection pipeline,
        // which has no way to pass options here - so the dragged marker leaves its
        // identity behind for the marker about to replace it (see
        // _handleMarkerDragEnd). One-shot: only the first marker built claims it.
        const adopted = this._adoptedIdentity;
        this._adoptedIdentity = null;

        const urlId = this._resolveNewUrlId(requestedUrlId ?? adopted?.urlId);
        // Moving a saved marker doesn't unsave it.
        const saved = savedOnCreate || !!adopted?.saved;

        // The corner the tail meets is square, the other three rounded, so the
        // pointer reads as an extension of the panel rather than a shape stuck
        // to a rounded box.
        //
        // One panel, not a label plus a balloon: the id is the panel's header, so
        // an unfocused marker is that panel shrunk to its header - a chip - and
        // focusing it grows the same box downward into a menu of what is here.
        // The clicked point is the panel's top-left corner, with the tail running
        // up to it. Matches .shortcut-menu's surface (see css/styles.css) since
        // it is the same kind of thing.
        el.innerHTML = `
            ${this._buildMarkerLeaderHTML()}
            <div class="marker-content" style="position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 0; background: ${MARKER_PANEL_BG}; border: 1px solid ${MARKER_PANEL_BORDER}; border-radius: ${MARKER_CORNER_RADIUS}px; box-shadow: ${MARKER_PANEL_SHADOW}; pointer-events: auto;">
                ${this._buildMarkerMenuHeaderHTML(urlId, saved)}
                <div class="marker-menu-body" style="display: none; flex-direction: column; align-items: stretch;
                           max-height: ${MARKER_BODY_MAX_HEIGHT}; overflow-y: auto; overflow-x: hidden;">
                    ${this._buildCommentSectionHTML(noteEntry)}
                    ${this._buildMarkerSummaryHTML(badgeFeatures, lngLat)}
                </div>
            </div>
        `;

        // top-left: the element's top-left corner is the clicked point, which is
        // exactly where the tail's tip is drawn.
        const marker = new mapboxgl.Marker({
            element: el,
            anchor: 'top-left',
            offset: [0, 0],
            draggable: true
        })
            .setLngLat([lngLat.lng, lngLat.lat])
            .addTo(this._map);

        // Backreference so code rendered inside this marker's popup (e.g. an
        // inspect.onClick handler in config/{atlas}.js) can reposition the pin
        // itself — see config/mapillary.js's "Follow" mode, which walks up to
        // `.selection-marker` and reads this to keep the marker glued to a
        // location that updates after the popup opens.
        el._mapboxMarker = marker;

        // While dragging, the marker behaves like the mouse pointer hovering the map
        // (live preview of whatever is beneath it) rather than selecting anything.
        // Only on release does it re-query and act like a click at the drop point.
        // Mapbox fires 'drag' on every pointermove tick, which can outpace the
        // display's refresh rate; running the feature query + hover pipeline
        // synchronously on each one backs up the main thread and makes the marker's
        // own position updates (driven by the same thread) stutter or lag behind the
        // cursor. Coalesce to at most one query per animation frame.
        let dragRAF = null;
        marker.on('dragstart', () => this._handleMarkerDragStart(markerId));
        marker.on('drag', () => {
            if (dragRAF) return;
            dragRAF = requestAnimationFrame(() => {
                dragRAF = null;
                this._handleMarkerDrag(marker, markerId);
            });
        });
        marker.on('dragend', () => {
            if (dragRAF) {
                cancelAnimationFrame(dragRAF);
                dragRAF = null;
            }
            this._handleMarkerDragEnd(marker, markerId);
        });

        // Selection markers are already selected; badge clicks just toggle their expanded state.
        this._attachBadgeHandlers(el, badgeFeatures, lngLat, false);
        this._attachAddressBadgeHandler(el, markerId);
        this._attachCommentSectionHandlers(el, lngLat, noteEntry);
        this._attachMarkerSummaryHandlers(el, badgeFeatures, lngLat);
        this._attachMarkerIdRowHandlers(el, markerId);
        this._blockMapEvents(el);

        // The body itself is now the scrollable surface (it caps at
        // MARKER_BODY_MAX_HEIGHT once open), so a scroll/swipe through a long
        // list of features must not reach the map's own scroll-zoom/drag-pan
        // handlers underneath it.
        const menuBody = el.querySelector('.marker-menu-body');
        if (menuBody) {
            ['wheel', 'touchmove', 'touchstart'].forEach(type => {
                menuBody.addEventListener(type, (e) => e.stopPropagation());
            });
        }

        // Capture phase: badges, chips and the id label all stop their own
        // clicks from bubbling, but clicking any of them still means "this is
        // the marker I'm working with".
        const select = () => this._selectMarker(markerId);
        el.addEventListener('click', select, true);
        if (this._isTouch) el.addEventListener('touchend', select, true);

        const markerData = {
            id: markerId,
            urlId,
            marker,
            lngLat,
            features,
            // The note-filtered array the summary rows/checkboxes actually
            // index into (see badgeFeatures above) - kept alongside the full
            // `features` so the name-picker widget (_applyLabelPick) can map
            // a row's data-badge-index back to a real feature without
            // recomputing the notes filter itself.
            badgeFeatures,
            contentEl: null,
            panelOffset: null,
            panelAnchor: 'top-left',
            onRemove,
            onDrag,
            onDragEnd,
            onRenameRef,
            role,
            // Set once its id is deliberately saved (see the id header's save
            // action), or carried in from a link, which named it already. A
            // saved marker is one the user meant to keep, so dropping a new
            // marker leaves it alone - only an explicit clear removes it.
            saved
        };
        // Reclaiming a placeholder entry: keep the name/description the shared
        // link carried rather than blanking them (see marker-registry.js's
        // parseMarkersParam). A dragged marker's entry is already gone by now, so
        // its details come from what it handed over instead.
        const reclaimed = markerRegistry.get(urlId)
            || (adopted?.urlId === urlId ? adopted : null);
        markerRegistry.set(urlId, {
            id: urlId,
            lng: lngLat.lng,
            lat: lngLat.lat,
            name: reclaimed?.name || '',
            description: reclaimed?.description || '',
            ...(reclaimed?.offset ? { offset: reclaimed.offset } : {})
        });

        // Only the tail drags the actual location (mapbox's own marker drag, see
        // _buildMarkerLeaderHTML). The panel has its own independent drag that
        // just repositions it on screen for decluttering, without touching
        // lngLat or re-querying.
        const contentEl = el.querySelector('.marker-content');
        if (contentEl) {
            markerData.contentEl = contentEl;
            this._attachBalloonDragHandler(contentEl, markerId);
        }

        this._markers.set(markerId, markerData);
        this._currentMarkerIndex = this._markers.size - 1;
        this._resolveMarkerAddress(markerId);

        // A marker you just dropped is the one you are working with. A rebuild
        // passes select:false: restoring a shared link redraws each marker once
        // per layer that resolves, for many seconds, and every one of those
        // would otherwise yank focus off whatever the user had clicked.
        if (selectOnCreate) this._selectMarker(markerId);
        else this._syncMarkerContent(el, markerId);

        // Nothing has a measurable size until the browser has laid the marker
        // out, and the leader line is drawn from measurements.
        requestAnimationFrame(() => {
            this._applyStoredPanelOffset(markerId);
            this._syncMarkerLeader(el);
        });

        // Hover to highlight features on map (desktop only — avoids synthetic
        // touch hover events flickering feature state on mobile).
        if (!this._isTouch) {
            el.addEventListener('mouseenter', () => {
                // The marker (buttons + badges) sits over its own features; suppress
                // the redundant hover popup while the pointer is anywhere over it,
                // even where rounded corners/gaps would leak through to the map.
                this._pointerOverMarker = true;
                this._clearHoverMarker();
                // The pointer is no longer over the map canvas, so the mousemove-driven
                // hover query won't fire to clear whatever was hovered right before
                // entering the box — clear it explicitly so only this marker's own
                // features end up highlighted.
                this._stateManager.handleMapMouseLeave();
                this._setMarkerFeaturesHoverState(markerId, true);
                // Hovering a marker opens it up the same way focusing it does,
                // so its options and badges can be read without committing to it.
                el.dataset.markerHover = '1';
                this._syncIdActions(el);
                this._syncMarkerContent(el, markerId);
            });

            el.addEventListener('mouseleave', () => {
                this._pointerOverMarker = false;
                this._setMarkerFeaturesHoverState(markerId, false);
                delete el.dataset.markerHover;
                this._syncIdActions(el);
                this._syncMarkerContent(el, markerId);
            });
        }

        // Update selection layer
        this._updateSelectionLayer();

        this._markerAddedListeners.forEach(cb => cb(markerId, lngLat));

        return markerId;
    }

    _handleMarkerDragStart(markerId) {
        this._draggingMarkerId = markerId;
    }

    /**
     * While the marker is being dragged, treat its current position exactly like a
     * mouse hover — query what's beneath it and run it through the same hover
     * pipeline normal map mousemove uses, so the same hover popup/highlight preview
     * follows the marker instead of nothing happening until it's dropped.
     */
    _handleMarkerDrag(marker, markerId) {
        const lngLat = marker.getLngLat();
        const point = this._map.project(lngLat);

        const markerData = this._markers.get(markerId);
        if (markerData) {
            markerData.lngLat = lngLat;
            // Whoever owns this marker follows it live - a route redraws itself
            // under the cursor rather than snapping only on release.
            markerData.onDrag?.(lngLat);
        }

        const interactiveFeatures = this._stateManager.getFeaturesAtPoint(point, lngLat)
            .filter(({ layerId }) => this._stateManager.isLayerInteractive(layerId));

        this._stateManager.handleFeatureHovers(interactiveFeatures, lngLat);
    }

    /**
     * Re-query features at a dragged marker's new position and dispatch them
     * through the same selection pipeline as a map click, so the marker (and its
     * badges) rebuild as if the user had clicked at the drop point.
     *
     * This only touches the dragged marker itself: its own old feature selections
     * are dropped (removeMarker, same scoped cleanup as closing it) and the new
     * ones are added without the usual "replace" clearing a fresh click would do
     * — otherwise moving one marker in a multi-marker selection would wipe out
     * every other marker and feature selected alongside it.
     */
    _handleMarkerDragEnd(marker, markerId) {
        this._draggingMarkerId = null;

        // A marker with an owner keeps its identity: re-querying the drop point
        // would tear this marker down and build a fresh one from whatever
        // happens to be under it, which for a route waypoint would break the
        // route it belongs to. Report the move and stop.
        const owned = this._markers.get(markerId);
        if (owned?.role) {
            owned.lngLat = marker.getLngLat();
            owned.onDragEnd?.(owned.lngLat);
            owned.address = null;
            this._resolveMarkerAddress(markerId);
            if (owned.urlId) {
                const entry = markerRegistry.get(owned.urlId);
                markerRegistry.set(owned.urlId, { ...(entry || { id: owned.urlId, name: '', description: '' }), lng: owned.lngLat.lng, lat: owned.lngLat.lat });
            }
            this._updateSelectionLayer();
            return;
        }

        // Touch browsers fire a phantom click at the drop point shortly after this
        // (see `_suppressClickUntil`'s definition) that would otherwise undo the
        // re-query this method is about to do on its own. Suppress it.
        if (this._isTouch) {
            this._stateManager._suppressClickUntil = Date.now() + MARKER_DRAG_CLICK_SUPPRESS_MS;
        }

        const lngLat = marker.getLngLat();
        const point = this._map.project(lngLat);

        const interactiveFeatures = this._stateManager.getFeaturesAtPoint(point, lngLat)
            .filter(({ layerId }) => this._stateManager.isLayerInteractive(layerId));

        // Moving a marker doesn't make it a different marker: the rebuild below
        // must come back with the same `markers=` id, or dragging would silently
        // renumber it (and break any route referencing it). An owned marker keeps
        // its identity by never being rebuilt at all - see the early return above.
        const identity = this._captureMarkerIdentity(markerId);

        this.removeMarker(markerId);

        const wasSuppressed = this._suppressReplaceClear;
        this._suppressReplaceClear = true;
        this._adoptedIdentity = identity;
        try {
            if (interactiveFeatures.length > 0) {
                this._stateManager.handleFeatureClicks(interactiveFeatures);
            } else {
                this._stateManager.handleFeatureClicks([], lngLat);
            }
        } finally {
            this._suppressReplaceClear = wasSuppressed;
            this._adoptedIdentity = null;
        }
    }

    /**
     * Drag the panel to move the panel: a purely visual drag — a CSS transform
     * on it — that repositions it for readability without ever touching the
     * marker's lngLat.
     *
     * The press is stopped rather than left to bubble, which does double duty:
     * the panel sits inside the marker element mapbox reads its own marker-drag
     * from, so a press that escaped the panel would move the marker and
     * re-query the location on top of this drag. Moving the marker is what the
     * tail is for (see _buildMarkerLeaderHTML).
     */
    _attachBalloonDragHandler(contentEl, markerId) {
        const DRAG_THRESHOLD = 4;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let offsetY = 0;
        let lastDx = 0;
        let lastDy = 0;
        let moved = false;

        const getPoint = (e) => (e.touches && e.touches.length ? e.touches[0] : e);

        // A real mouse drag still ends with mousedown and mouseup sharing the
        // same target regardless of how far the pointer travelled in between,
        // so release fires an ordinary 'click' right after it - a separate
        // event from the mouseup onUp already sees, dispatched fresh from
        // `document` down to whatever's under the pointer. Left unswallowed,
        // that click reads as "the user picked this marker" to addMarker's own
        // click->select listener on the marker element, and selects it - which
        // pins the panel open even once the pointer has moved well clear of it
        // (_syncMarkerContent only collapses an unselected marker on
        // hover-leave). Listening on `document` rather than the marker element
        // matters: a capture listener runs in DOM order regardless of when it
        // was registered, so `document`'s always fires before one on a
        // descendant does - whereas a listener on the marker element itself
        // would run too late, since addMarker's own is attached there first.
        // Added only while a drag is in progress (see onDown/onUp below), and
        // removed a tick after release rather than immediately, so it is still
        // there to catch this specific click before going away.
        const swallowClick = (e) => {
            if (moved) {
                e.stopPropagation();
                e.preventDefault();
                moved = false;
            }
        };

        const onMove = (e) => {
            const point = getPoint(e);
            const dx = point.clientX - startX;
            const dy = point.clientY - startY;
            if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true;
            if (moved) {
                lastDx = dx;
                lastDy = dy;
                contentEl.style.transform = `translate3d(${offsetX + dx}px, ${offsetY + dy}px, 0)`;
                // The tail follows the panel, re-picking the nearer top corner
                // as it goes - that is the whole reason it is recomputed rather
                // than a fixed shape stuck to one corner.
                this._syncMarkerLeader(contentEl.closest('.selection-marker') || contentEl.parentElement);
                e.preventDefault();
            }
        };

        const onUp = (e) => {
            if (moved) {
                // This event (touchend/mouseup) is what mapbox's own marker
                // drag, and addMarker's touchend->select listener on the marker
                // element, would otherwise see too - both live on/under the
                // marker element, a descendant of `window`, so stopping it here
                // (capture phase, already running on window) reaches them before
                // they do regardless of when their own listeners were attached.
                // Left unstopped, a drag-to-reposition reads as "the user picked
                // this marker" and selects it, pinning the panel open even once
                // the pointer has moved well clear of it (_syncMarkerContent
                // only collapses an unselected marker on hover-leave).
                e?.stopPropagation();

                // Touch browsers can fire a phantom click well after this
                // release - long after `swallowClick` above has already
                // removed itself (a tick later, see onUp's cleanup) - and it
                // can land anywhere, including outside the marker entirely
                // (e.g. the map canvas). `_suppressClickUntil` is the map's own
                // longer-lived guard against that one; this is not a duplicate
                // of it.
                if (this._isTouch) {
                    this._stateManager._suppressClickUntil = Date.now() + MARKER_DRAG_CLICK_SUPPRESS_MS;
                }

                offsetX += lastDx;
                offsetY += lastDy;

                // Kept as a pixel offset from the marker, not as a second map
                // location: the panel belongs to its marker, so it should hold
                // the same place beside it at every zoom. The marker element is
                // what mapbox moves, so the offset needs no upkeep - and it is
                // what `?markers=` carries (see _setMarkerPanelOffset).
                const markerData = this._markers.get(markerId);
                if (markerData) {
                    this._setMarkerPanelOffset(markerData, offsetX, offsetY);
                    // Dragging past the point sideways changes which corner faces it.
                    this._rebasePanelAnchor(markerData);
                    offsetX = markerData.panelOffset.x;
                    offsetY = markerData.panelOffset.y;
                    window.urlManager?.updateURL({ updateLayers: true });
                }
            }
            this._stateManager._isDraggingMarkerPanel = false;
            window.removeEventListener('mousemove', onMove, true);
            window.removeEventListener('mouseup', onUp, true);
            window.removeEventListener('touchmove', onMove, true);
            window.removeEventListener('touchend', onUp, true);
            window.removeEventListener('touchcancel', onUp, true);
            // The 'click' this release is about to produce (see `swallowClick`)
            // hasn't been dispatched yet - removing this now would let it
            // through, undoing the whole point of adding it.
            setTimeout(() => document.removeEventListener('click', swallowClick, true), 0);
        };

        const onDown = (e) => {
            // Mapbox reads its own marker drag off the element this panel sits
            // inside, so any press on the panel must never bubble up to it -
            // regardless of whether this press goes on to arm anything below.
            e.stopPropagation();

            // Only the move handle arms a drag - and only once the marker is
            // the one in focus (see _syncIdActions, which is what shows the
            // handle in the first place). The rest of the panel used to drag
            // from anywhere on it; that made an ordinary click on the header
            // too easy to mistake for the start of a drag.
            if (!e.target.closest('.marker-id-move')) return;
            const markerEl = contentEl.closest('.selection-marker');
            if (!markerEl?.classList.contains('marker-selected')) return;

            const point = getPoint(e);
            startX = point.clientX;
            startY = point.clientY;
            moved = false;
            // Restored (or previously dragged) panels start from where they are,
            // not from the default position.
            const stored = this._markers.get(markerId)?.panelOffset;
            if (stored) {
                offsetX = stored.x;
                offsetY = stored.y;
            }
            // The drag tracks via window-level listeners, so the pointer spends most
            // of the gesture directly over the map canvas. Tell the map's own
            // mousemove hover query to stand down for the duration (see the
            // `_isDraggingMarkerPanel` check in map-feature-control-iframe.js) —
            // otherwise it fights the drag for the main thread and flips hover state
            // on whatever feature happens to be underneath.
            this._stateManager._isDraggingMarkerPanel = true;
            this._stateManager.handleMapMouseLeave();
            // Capture phase, not bubble: a release over a feature-badge hits the
            // badge's own touchend handler, which calls stopPropagation() (see
            // _attachBadgeHandlers) and would otherwise stop this touchend from ever
            // bubbling up to window, leaking these listeners permanently — see below.
            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
            window.addEventListener('touchmove', onMove, { passive: false, capture: true });
            window.addEventListener('touchend', onUp, true);
            // Without this, a touch drag interrupted mid-gesture (e.g. the browser
            // reclassifying it as a native page pan partway through, or its touchend
            // landing on a descendant that stops propagation) leaves these window-level
            // listeners attached forever. The next unrelated touch — like panning the
            // map somewhere else entirely — then gets misread as a continuation of
            // this drag, yanking the balloon to wherever that new touch happens to land.
            window.addEventListener('touchcancel', onUp, true);
            document.addEventListener('click', swallowClick, true);
        };

        contentEl.addEventListener('mousedown', onDown);
        contentEl.addEventListener('touchstart', onDown);
    }

    _setMarkerFeaturesHoverState(markerId, hoverState) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;

        // Set hover state for all features in this marker
        markerData.features.forEach(({ feature, layerId, featureId }) => {
            this._stateManager.setFeatureHoverState(layerId, featureId, hoverState);
        });
    }

    /**
     * Load and render a layer's custom inspect.onClick handler (config/{atlas}.js)
     * into a `.custom-html-container` inside `details`, for the marker badge's
     * expanded attribute table. Mark the container with data-needs-handler/
     * data-atlas/data-handler/data-feature-data before calling this.
     */
    async _loadInspectionHandlerHTML(details, layerId, featureId) {
        const needsHandler = details.dataset.needsHandler === 'true';
        const customContainer = details.querySelector('.custom-html-container');
        if (!needsHandler || !customContainer || customContainer.dataset.loaded) return;

        const atlasName = details.dataset.atlas;
        const handlerName = details.dataset.handler;
        const layerConfig = this._stateManager.getLayerConfig(layerId);
        let feature;
        try {
            feature = JSON.parse(decodeURIComponent(details.dataset.featureData));
        } catch (e) {}

        if (!feature || !atlasName || !handlerName) return;

        customContainer.innerHTML = '<div style="color: #94a3b8; font-size: 10px; padding: 4px;">Loading...</div>';

        try {
            const { handlerLoader } = await import('./inspection-handler-loader.js');

            // Execute handler - the HTML contains inline scripts that will run
            const customHTML = await handlerLoader.executeHandler(atlasName, handlerName, {
                feature,
                featureId,
                layerConfig,
                properties: feature.properties
            });

            if (customHTML) {
                // Insert HTML and manually execute scripts
                customContainer.innerHTML = customHTML;

                // Extract and execute script tags
                const scripts = customContainer.querySelectorAll('script');
                scripts.forEach(oldScript => {
                    const newScript = document.createElement('script');
                    Array.from(oldScript.attributes).forEach(attr => {
                        newScript.setAttribute(attr.name, attr.value);
                    });
                    newScript.textContent = oldScript.textContent;
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                });
            } else {
                customContainer.innerHTML = '';
            }
            customContainer.dataset.loaded = 'true';
        } catch (error) {
            console.error('[MapMarkerManager] Error loading handler:', error);
            customContainer.innerHTML = `<div style="color: #f87171; font-size: 10px; padding: 4px;">Error loading details</div>`;
        }
    }

    /**
     * Shortcut export triggered from the layer actions menu in a marker badge.
     * "export-selected" exports only the single feature the menu was opened
     * from; "export-layer" pulls every feature currently loaded for that
     * layer's source, regardless of selection.
     */
    async _handleLayerExportAction(action, format, layerId, featureData) {
        const exportControl = window.exportControl;
        if (!exportControl || !layerId || !format) return;

        const config = { format, exportSelectedOnly: true };
        const layerConfig = this._stateManager.getLayerConfig(layerId);

        if (action === 'export-selected') {
            if (!featureData) return;
            let feature;
            try {
                feature = JSON.parse(decodeURIComponent(featureData));
            } catch (err) {
                console.warn('[MapMarkerManager] Could not parse feature for export:', err);
                return;
            }
            config.customSelectedFeatures = [{ feature, layerId, layerConfig }];
        }

        if (action === 'export-layer') {
            const sourceId = layerConfig?.source || `${layerConfig?.type}-${layerId}`;
            let features = [];
            try {
                features = this._map.querySourceFeatures(sourceId, { sourceLayer: layerConfig?.sourceLayer }) || [];
            } catch (err) {
                console.warn(`[MapMarkerManager] Could not query features for layer "${layerId}":`, err);
            }
            if (features.length === 0) return;
            config.customSelectedFeatures = features.map(feature => ({ feature, layerId, layerConfig }));
        }

        await exportControl._handleExport(config);
    }

    _navigateMarker(direction) {
        const markerArray = Array.from(this._markers.values());
        if (markerArray.length <= 1) return;

        this._currentMarkerIndex = (this._currentMarkerIndex + direction + markerArray.length) % markerArray.length;
        const targetMarker = markerArray[this._currentMarkerIndex];

        this._isProgrammaticZoom = true;
        this._map.flyTo({
            center: [targetMarker.lngLat.lng, targetMarker.lngLat.lat],
            duration: 500
        });
        // Reset flag after zoom completes
        setTimeout(() => {
            this._isProgrammaticZoom = false;
        }, 700);
    }

    /**
     * Fits the camera to a set of selected features — either just the marker
     * near `lngLat` (e.g. opened via that marker's own shortcut trigger) if
     * it has any, or every marker's features on the map otherwise. Markers
     * with no features (empty-map-click pins) still fold their point into the
     * bounds so a lone pin is at least centered/visible.
     */
    zoomToSelected(lngLat) {
        if (!this._map || this._markers.size === 0) return;

        let markers = [...this._markers.values()];
        if (lngLat) {
            const markerId = this.findMarkerNear(lngLat);
            const markerData = markerId ? this._markers.get(markerId) : null;
            if (markerData?.features.length > 0) {
                markers = [markerData];
            }
        }

        let bounds = null;
        markers.forEach(markerData => {
            if (markerData.features.length > 0) {
                markerData.features.forEach(f => {
                    bounds = CameraUtils.extendBbox(bounds, CameraUtils.computeGeojsonBbox(f.feature));
                });
            } else {
                const { lng, lat } = markerData.lngLat;
                bounds = CameraUtils.extendBbox(bounds, [lng, lat, lng, lat]);
            }
        });

        if (!bounds) return;
        CameraUtils.fitBounds(this._map, bounds, { duration: 1000 });
    }

    _zoomToFeature(feature) {
        if (!this._map || !feature) return;

        if (!feature.geometry || !feature.geometry.coordinates) {
            console.warn('[MapMarkerManager] Feature has no valid geometry');
            return;
        }

        const bbox = CameraUtils.computeGeojsonBbox(feature);
        if (!bbox) {
            console.warn('[MapMarkerManager] Could not compute bbox for feature');
            return;
        }

        // Override CameraUtils' default maxZoom (16, tuned for fitting a whole
        // newly-added layer) — a single feature is often much smaller than that,
        // so the cap would otherwise zoom OUT instead of in when already closer.
        CameraUtils.fitBounds(this._map, bbox, { duration: 1000, maxZoom: 20 });
    }

    /**
     * `{urlId, saved, ...registry fields}` for a marker that's about to be
     * rebuilt, or `null` if it never had an id - shared by _handleMarkerDragEnd
     * and removeMarkerKeepingIdentity below so a marker rebuilt either way
     * (dragged onto new features, or upgraded from feature-less by
     * shortcut-menu-base.js's _ensureMarkerAt) comes back with the same
     * `markers=` id and saved/name/description rather than a fresh
     * auto-numbered one.
     */
    _captureMarkerIdentity(markerId) {
        const markerData = this._markers.get(markerId);
        return markerData?.urlId
            ? { urlId: markerData.urlId, saved: !!markerData.saved, ...(markerRegistry.get(markerData.urlId) || {}) }
            : null;
    }

    /**
     * Removes `markerId` but keeps its identity (see _captureMarkerIdentity)
     * staged for the very next addMarker() call to reclaim (see its own
     * `adopted` handling) - used by shortcut-menu-base.js's _ensureMarkerAt
     * when it rebuilds a still-empty marker to carry newly-found features, so
     * that upgrade doesn't silently drop whatever id/name the marker already
     * had. One-shot: the following addMarker() call must be synchronous, the
     * same way _handleMarkerDragEnd's own use of this pattern is.
     */
    removeMarkerKeepingIdentity(markerId) {
        this._adoptedIdentity = this._captureMarkerIdentity(markerId);
        this.removeMarker(markerId);
    }

    /**
     * `silent` skips the marker's `onRemove` callback (see addMarker's
     * `options.onRemove`) — used when this manager's own caller is the one
     * driving the removal (e.g. streetview-control.js tearing down its own
     * tracking pin on panel close) and doesn't need to hear its own echo.
     */
    removeMarker(markerId, { silent = false } = {}) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;

        if (this._selectedMarkerId === markerId) this._selectedMarkerId = null;

        // Deselect any expanded badges in this marker so the saved view is restored.
        this._deselectMarkerBadges(markerData);

        // Removing the element from the DOM while the pointer sits on it (e.g.
        // hitting its own trash action) doesn't fire a real 'mouseleave', so
        // _pointerOverMarker would otherwise stay stuck true and suppress every
        // hover popup until some other marker's mouseenter/mouseleave cycle reset it.
        const markerEl = markerData.marker?.getElement?.();
        if (markerEl?.matches?.(':hover')) {
            this._pointerOverMarker = false;
        }

        if (markerEl) this._closeAllSummaryDetails(markerEl);

        // An unsaved marker can be destroyed outright the moment it loses
        // focus (see _syncMarkerContent) - it was never a deliberate choice
        // to keep, so any quick property filter a feature row of its left
        // active (_applyFeatureFilter) goes with it too. A saved marker's
        // filter survives its own removal, though: by the time you've named
        // a marker, filtering the layer by one of its properties has become
        // a decision about the layer, not leftover state from a marker that
        // happened to still be open.
        if (!markerData.saved && this._activeFeatureFilterLayerId) {
            this._restoreOriginalLayerFilter(this._activeFeatureFilterLayerId);
            this._activeFeatureFilterLayerId = null;
        }

        // Drop the feature selections anchored at this marker so closing it also
        // clears the highlight (not just the marker dot). Other markers keep their
        // own selections.
        markerData.features.forEach(({ featureId, layerId }) => {
            if (featureId && layerId) {
                this._stateManager._deselectFeature(featureId, layerId);
            }
        });

        markerData.marker.remove();
        this._markers.delete(markerId);
        if (markerData.urlId) markerRegistry.remove(markerData.urlId);

        if (this._markers.size > 0) {
            this._currentMarkerIndex = Math.min(this._currentMarkerIndex, this._markers.size - 1);
        }

        // Update selection layer
        this._updateSelectionLayer();

        if (!silent) markerData.onRemove?.();
    }

    clearAllMarkers() {
        const onRemoveCallbacks = [];
        this._markers.forEach((markerData, id) => {
            this._deselectMarkerBadges(markerData);
            const markerEl = markerData.marker?.getElement?.();
            if (markerEl?.matches?.(':hover')) {
                this._pointerOverMarker = false;
            }
            markerData.marker.remove();
            this._markers.delete(id);
            // Same cleanup removeMarker does - without it every cleared marker's
            // id lingers in the registry and reappears in `?markers=`.
            if (markerData.urlId) markerRegistry.remove(markerData.urlId);
            if (markerData.onRemove) onRemoveCallbacks.push(markerData.onRemove);
        });
        this._currentMarkerIndex = 0;
        this._selectedMarkerId = null;

        // Update selection layer
        this._updateSelectionLayer();

        onRemoveCallbacks.forEach(cb => cb());
    }

    /** Whether a given marker id is still present on the map. */
    hasMarker(markerId) {
        return this._markers.has(markerId);
    }

    /**
     * Moves an existing marker to a new location in place, keeping its
     * features/badges untouched — e.g. for a marker whose location tracks
     * something external (see streetview-control.js's "Pin Location"
     * checkbox, which glues a marker to the currently viewed Mapillary photo).
     */
    updateMarkerLocation(markerId, lngLat) {
        const markerData = this._markers.get(markerId);
        if (!markerData) return;
        markerData.lngLat = lngLat;
        markerData.marker.setLngLat([lngLat.lng, lngLat.lat]);
        this._updateSelectionLayer();
    }

    /**
     * Deselect any expanded badges belonging to a marker (used on teardown) so
     * isolation is cleared and the pre-zoom view is restored once nothing remains.
     */
    _deselectMarkerBadges(markerData) {
        const markerEl = markerData.marker?.getElement?.();
        if (!markerEl) return;
        markerEl.querySelectorAll('.feature-badge.badge-selected').forEach(b => this._deselectBadge(b));
    }

    /**
     * Update the selection GeoJSON layer with current marker positions
     */
    _updateSelectionLayer() {
        // Get mapboxAPI from global layerControl if not set
        if (!this._mapboxAPI && window.layerControl?._mapboxAPI) {
            this._mapboxAPI = window.layerControl._mapboxAPI;
        }

        if (!this._mapboxAPI) {
            // Expected transiently during startup: restoreMarkersFromSelectionLayer now
            // renders markers as soon as their location is known, which can be before
            // MapLayerControl.renderToContainer() has finished constructing its MapboxAPI
            // instance. Self-resolves — the next call (as more layers resolve, or any
            // later marker add/remove) succeeds once window.layerControl._mapboxAPI exists.
            return;
        }

        // Create GeoJSON from current markers
        const features = [];
        this._markers.forEach((markerData, markerId) => {
            // Extract feature labels for the name property (or use location if no features)
            const name = this._describeMarkerLabel(markerData);

            // Store feature references for restoration (use raw feature IDs)
            const featureRefs = markerData.features.map(f => {
                const rawFeatureId = this._stateManager._extractRawFeatureId(f.featureId);
                return {
                    layerId: f.layerId,
                    featureId: rawFeatureId
                };
            });

            // Create a point feature at the marker location
            const feature = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [markerData.lngLat.lng, markerData.lngLat.lat]
                },
                properties: {
                    id: markerId,
                    name: name,
                    featureCount: markerData.features.length,
                    features: featureRefs,
                    // Where this point is, as ordinary attributes. The address is
                    // resolved asynchronously, so it is absent until the lookup
                    // returns; the coordinates are always known.
                    $coordinates: this._coordinateField(markerData.lngLat).name,
                    ...(markerData.address?.text ? { $address: markerData.address.text } : {})
                }
            };

            features.push(feature);
        });

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        // Update the selection layer
        this._mapboxAPI.updateGeoJSONLayerData(this._selectionLayerId, geojson);

        // Also update the layer control's state if available
        if (window.layerControl) {
            const layerGroup = window.layerControl._state.groups.find(g => g.id === this._selectionLayerId);
            if (layerGroup) {
                layerGroup.geojson = geojson;

                // Trigger URL update
                if (window.urlManager) {
                    window.urlManager.updateURL({ updateLayers: true });
                }
            }
        }
    }

    async restoreMarkersFromSelectionLayer() {
        if (!window.layerControl) {
            console.warn('[MarkerManager] Layer control not available');
            return false;
        }

        const selectionLayer = window.layerControl._state.groups.find(g => g.id === this._selectionLayerId);
        const markerPoints = (selectionLayer?.geojson?.features || []).filter(f => f.geometry?.type === 'Point');
        if (markerPoints.length === 0) {
            return false;
        }

        // Older shared URLs carry explicit layerId/featureId refs per marker (see
        // UrlManager.parseMarkersFromURL); newer URLs carry only the click location, and
        // the features present there are recovered below by re-querying that point once
        // its layers are ready — exactly as if the user clicked there fresh.
        const withRefs = markerPoints.filter(f => Array.isArray(f.properties?.features) && f.properties.features.length > 0);
        const locationsOnly = markerPoints.filter(f => !Array.isArray(f.properties?.features) || f.properties.features.length === 0);

        // No refs to target specific layers for location-only markers, so stream against
        // the URL's queryable (non-raster) layers instead. Raster/style layers never
        // register with the state manager and can't be queried anyway — see
        // _isQueryableLayerType. Computed up front (before building states below) since
        // location-only states need it as their initial pending-layer set.
        const locationLayerIds = [];
        if (locationsOnly.length > 0) {
            window.layerControl._state.groups.forEach(group => {
                if (group.initiallyChecked && this._isQueryableLayerType(group)) {
                    locationLayerIds.push(group.id);
                }
            });
        }

        // Show a marker at every restored location immediately — the click point is
        // already known, so there's no need to wait for every layer to finish loading
        // before putting a pin down. Each layer that hasn't resolved yet renders as a
        // "Locating…" placeholder badge (see _createPendingLayerBadgeHTML) instead of a
        // generic spinner, and _upsertStreamingMarkerVisual rebuilds the marker in place
        // as each one resolves below — real badges replacing placeholders, always in the
        // inspector's layer order regardless of arrival order.
        const toState = (feature, refs, pendingLayerIds) => {
            const [lng, lat] = feature.geometry.coordinates;
            const state = {
                lngLat: { lng, lat },
                refs: refs || null,
                markerId: null,
                // The id `?markers=` gave this point (UrlManager.parseMarkersFromURL
                // puts it here), so the marker is built under its real name.
                urlId: feature.properties?.urlId || null,
                foundFeatures: [],
                pendingLayerIds: new Set(pendingLayerIds)
            };
            this._upsertStreamingMarkerVisual(state);
            return state;
        };
        const withRefsState = withRefs.map(f => toState(f, f.properties.features || [], (f.properties.features || []).map(r => r.layerId)));
        const locationsOnlyState = locationsOnly.map(f => toState(f, null, locationLayerIds));

        const refLayerIds = new Set();
        withRefsState.forEach(state => state.refs.forEach(ref => refLayerIds.add(ref.layerId)));

        // Track which layers are still pending so a spinner placeholder card can be
        // shown for each, in the same order real feature cards are displayed.
        const pendingLayerIds = this._getAllActiveLayersInInspectorOrder()
            .map(l => l.id)
            .filter(id => refLayerIds.has(id) || locationLayerIds.includes(id));
        window.featureControl?.sendFeatureQueryPending?.(pendingLayerIds);

        const allRestoredFeatures = [];
        const layerResolutions = [];

        // Force "add" mode for the whole streaming window so every marker layers onto
        // the others instead of clearing them, same as _handleMarkerDragEnd re-selecting
        // after a drag.
        const wasSuppressed = this._suppressReplaceClear;
        this._suppressReplaceClear = true;

        try {
            // Ref-based markers: each ref names its own layer, so resolve it as soon as
            // THAT layer is ready instead of waiting on the slowest one in the set.
            refLayerIds.forEach(layerId => {
                layerResolutions.push(this._waitForSingleLayerReady(layerId).then(async () => {
                    for (const state of withRefsState) {
                        const ref = state.refs.find(r => r.layerId === layerId);
                        if (!ref) continue;

                        const restored = await this._restoreFeatureFromRef(ref);
                        if (restored) {
                            const withLngLat = { ...restored, lngLat: state.lngLat };
                            state.foundFeatures.push(withLngLat);
                            allRestoredFeatures.push(withLngLat);

                            await this._stateManager._executeInspectionHandler(restored.feature, layerId, state.lngLat);
                            this._stateManager._emitStateChange('feature-click', {
                                feature: restored.feature,
                                featureId: restored.featureId,
                                layerId,
                                lngLat: state.lngLat,
                                fromURL: true,
                                fromMarkerRestore: true
                            });
                        }
                        state.pendingLayerIds.delete(layerId);
                        this._upsertStreamingMarkerVisual(state);
                        window.featureControl?.sendFeatureQueryResolved?.(layerId);
                    }
                }));
            });

            // Location-only markers: query every pending location against each layer as
            // soon as THAT layer is ready, instead of waiting for every layer in the set.
            locationLayerIds.forEach(layerId => {
                layerResolutions.push(this._waitForSingleLayerReady(layerId).then(async () => {
                    for (const state of locationsOnlyState) {
                        const point = this._map.project([state.lngLat.lng, state.lngLat.lat]);
                        const found = this._stateManager.getFeaturesAtPoint(point, state.lngLat)
                            .filter(f => f.layerId === layerId && this._stateManager.isLayerInteractive(f.layerId));

                        for (const f of found) {
                            const restored = this._selectRestoredFeature(f.feature, f.layerId, state.lngLat);
                            state.foundFeatures.push(restored);
                            allRestoredFeatures.push(restored);

                            await this._stateManager._executeInspectionHandler(restored.feature, layerId, state.lngLat);
                            this._stateManager._emitStateChange('feature-click', {
                                feature: restored.feature,
                                featureId: restored.featureId,
                                layerId,
                                lngLat: state.lngLat,
                                fromURL: true,
                                fromMarkerRestore: true
                            });
                        }
                        state.pendingLayerIds.delete(layerId);
                        this._upsertStreamingMarkerVisual(state);
                        window.featureControl?.sendFeatureQueryResolved?.(layerId);
                    }
                }));
            });

            await Promise.allSettled(layerResolutions);

            // Every state's pendingLayerIds has been drained to empty by now (each
            // layerId is deleted right before its last _upsertStreamingMarkerVisual
            // call above) — any location where nothing was ever found has already
            // settled into a normal empty/coords marker via that same call, so there's
            // nothing further to do here.
        } finally {
            this._suppressReplaceClear = wasSuppressed;
        }

        if (this._markers.size > 0) {
            this._stateManager._updateLineSortKeys();
        }

        // Notify other listeners (e.g. map-browser.html, URL sync) of the full
        // restoration so the status bar with the Clear / Add / Zoom buttons shows. Every
        // marker above was created manually (bypassing the normal click pipeline), so the
        // fromMarkerRestore flag tells _handleSelection not to re-add them — mirrors the
        // event sequence in UrlManager.applySelectionsFromURL. Per-feature 'feature-click'
        // events were already emitted as each one streamed in above; this is just the
        // final consolidated summary.
        if (allRestoredFeatures.length > 0) {
            this._stateManager._emitStateChange('feature-click-multiple', {
                selectedFeatures: allRestoredFeatures,
                clearedFeatures: [],
                fromURL: true,
                fromMarkerRestore: true
            });
        }

        return true;
    }

    /**
     * Select a feature directly in the state manager, bypassing handleFeatureClicks
     * (which would re-trigger the normal click pipeline's _handleSelection listener and
     * create a duplicate marker — restoreMarkersFromSelectionLayer manages its own marker
     * per location via _upsertStreamingMarkerVisual instead). Mirrors the per-feature
     * bookkeeping handleFeatureClicks does internally.
     */
    _selectRestoredFeature(feature, layerId, lngLat) {
        const sm = this._stateManager;
        const featureId = sm._getFeatureId(feature);
        const compositeKey = sm._getCompositeKey(layerId, featureId);
        const alreadySelected = sm._selectedFeatures.has(compositeKey);

        sm._updateFeatureState(compositeKey, { feature, layerId, isSelected: true, lngLat, timestamp: Date.now() });

        if (!alreadySelected) {
            sm._selectedFeatures.add(compositeKey);
            sm._setMapboxFeatureStateAllLayers(featureId, layerId, { selected: true });
        }

        return { featureId, layerId, feature, lngLat };
    }

    /**
     * Create or refresh the on-map marker for a location being streamed in during
     * restoreMarkersFromSelectionLayer, so exactly one pin ever exists per location from
     * the moment its location is known — with a "Locating…" placeholder badge for each
     * layer still pending — while real badges grow in (and placeholders drop away) as
     * more layers resolve. Badge order always follows the inspector's layer order (see
     * LayerOrderManager), not arrival order.
     */
    _upsertStreamingMarkerVisual(state) {
        // This is the same marker being redrawn as another layer resolves, not a
        // new one - so it keeps its `markers=` id across the rebuild. Freeing the
        // registry slot first lets addMarker reclaim that exact id; without both
        // halves the id churns upward on every rebuild (a 6-marker link restoring
        // over 5 layers ends up at 30+) and every abandoned id stays in the
        // registry, which is what url-manager.js serializes back into `?markers=`.
        // First draw uses the id the shared link named this marker by, so it is
        // correct on screen immediately instead of being auto-numbered and
        // renamed seconds later once every layer has resolved. Rebuilds keep
        // whatever the marker currently has (it may since have been renamed).
        let urlId = state.urlId || null;
        // Only the marker that already had focus keeps it through its own
        // rebuild; a rebuild never takes focus from another marker.
        let wasSelected = false;
        if (state.markerId) {
            const existing = this._markers.get(state.markerId);
            if (existing) {
                urlId = existing.urlId;
                wasSelected = this._selectedMarkerId === state.markerId;
                existing.marker.remove();
                this._markers.delete(state.markerId);
            }
        }
        state.markerId = this.addMarker(state.lngLat, this._sortFeaturesByInspectorOrder(state.foundFeatures), {
            pendingLayerIds: state.pendingLayerIds,
            urlId,
            // Restoring a link is not the user picking a marker out: they all
            // come back as plain labels, and only a rebuild of the one that
            // already had focus keeps it.
            select: wasSelected,
            // A marker written into a link was named on purpose, so it is a
            // keeper from the moment it comes back - dropping new markers
            // around it leaves it alone.
            saved: true
        });
    }

    /**
     * Order features by the shared layer display order, regardless of the order
     * their layers actually resolved in.
     */
    _sortFeaturesByInspectorOrder(features) {
        const order = new Map(this._getAllActiveLayersInInspectorOrder().map((l, i) => [l.id, i]));
        return [...features].sort((a, b) => {
            const aOrder = order.has(a.layerId) ? order.get(a.layerId) : Infinity;
            const bOrder = order.has(b.layerId) ? order.get(b.layerId) : Infinity;
            return aOrder - bOrder;
        });
    }

    /**
     * Whether a layer group's type is one that (a) actually registers with the state
     * manager and (b) is queryable via queryRenderedFeatures — i.e. worth waiting on
     * before re-querying a restored marker's location. Mirrors the skip conditions in
     * MapLayerControls._registerLayerWithStateManager and MapFeatureStateManager._isRasterLayer.
     */
    _isQueryableLayerType(group) {
        if (!group.type || group.type === 'style') return false;
        const nonQueryableTypes = ['tms', 'wmts', 'img', 'raster-style-layer', 'cog', 'wms'];
        if (nonQueryableTypes.includes(group.type)) return false;
        const isVectorLike = group.type === 'geojson' || group.type === 'vector' || group.type === 'csv' || group.type === 'sheet' || group.type === 'js';
        if (isVectorLike && (group.inspect === false || group.inspect === null)) return false;
        return true;
    }

    /**
     * Wait for a single layer to become queryable — registered with the state manager
     * AND its own Mapbox source loaded — without waiting on any other layer. Lets
     * restoreMarkersFromSelectionLayer stream results in per layer instead of being held
     * back by the slowest one in the set (e.g. a big vector tile or raster layer).
     */
    async _waitForSingleLayerReady(layerId, timeout = 10000) {
        const startTime = Date.now();
        while (!this._stateManager.isLayerRegistered(layerId)) {
            if (Date.now() - startTime > timeout) {
                console.warn(`[MarkerManager] Timeout waiting for layer to register: ${layerId}`);
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        const layerConfig = this._stateManager.getLayerConfig(layerId);
        const sourceId = layerConfig?.source || `${layerConfig?.type}-${layerId}`;
        while (!(this._map.getSource(sourceId) && this._map.isSourceLoaded(sourceId))) {
            if (Date.now() - startTime > timeout) {
                console.warn(`[MarkerManager] Timeout waiting for source to load: ${sourceId}`);
                return false;
            }
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return true;
    }

    async _restoreFeatureFromRef(ref, retries = 3) {
        const { layerId, featureId } = ref;

        if (!this._stateManager.isLayerRegistered(layerId)) {
            console.warn(`[MarkerManager] Layer ${layerId} not registered`);
            return null;
        }

        const layerConfig = this._stateManager.getLayerConfig(layerId);
        if (!layerConfig) {
            console.warn(`[MarkerManager] Layer config not found for ${layerId}`);
            return null;
        }

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const features = this._map.querySourceFeatures(
                    layerConfig.source || `${layerConfig.type}-${layerId}`,
                    {
                        sourceLayer: layerConfig.sourceLayer
                    }
                );

                const matchingFeature = features.find(f => {
                    const fid = this._stateManager._getFeatureId(f);
                    const rawFid = this._stateManager._extractRawFeatureId(fid);
                    return rawFid === featureId || fid === featureId;
                });

                if (matchingFeature) {
                    const fullFeatureId = this._stateManager._getFeatureId(matchingFeature);
                    const compositeKey = this._stateManager._getCompositeKey(layerId, fullFeatureId);

                    this._stateManager._updateFeatureState(compositeKey, {
                        feature: matchingFeature,
                        layerId,
                        isSelected: true,
                        timestamp: Date.now()
                    });

                    this._stateManager._selectedFeatures.add(compositeKey);
                    this._stateManager._setMapboxFeatureState(fullFeatureId, layerId, { selected: true });

                    return {
                        feature: matchingFeature,
                        featureId: fullFeatureId,
                        layerId
                    };
                }

                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.warn(`[MarkerManager] Error restoring feature ${featureId} from layer ${layerId} (attempt ${attempt + 1}):`, error);
                if (attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }

        console.warn(`[MarkerManager] Feature ${featureId} not found in layer ${layerId}`);
        return null;
    }

}

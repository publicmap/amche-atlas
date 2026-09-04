/**
 * ShortcutMenu - Right-click / long-press context menu for quick access to
 * frequently used app actions.
 *
 * Desktop: right-click on the map.
 * Touch: long-press on the map. Mobile browsers are inconsistent about firing
 * a native `contextmenu` DOM event on long-press over a canvas (Mapbox's
 * touch handlers can swallow the touch sequence before it gets there), so
 * long-press is also detected explicitly with a touch timer below.
 *
 * Opening the menu also drops a plain marker at that point (see
 * ShortcutMenuBase._ensureMarkerAt) - or reuses one already there - without
 * running the selection pipeline: no feature query, no highlighting, no
 * inspector. It's just a handle on the spot the menu was opened at, until
 * "Select Here" (ShortcutMenuBase._selectFeaturesAtPoint) is explicitly
 * chosen to actually select whatever is under it.
 *
 * The menu itself opens offset from the click point by
 * ShortcutMenuBase._pinContentOffset (see MapMarkerManager.getContentOffset),
 * the same offset that marker's own content popup would open at - so the
 * menu appears exactly where that marker's badges will once one is selected,
 * instead of jumping between the two positions.
 *
 * The menu item tree, flyout rendering, and action handlers live in
 * ShortcutMenuBase (shortcut-menu-base.js) - shared with
 * HeaderShortcutMenuControl (header-shortcut-menu-control.js) so both entry
 * points always offer the same shortcuts. This class only owns how the menu
 * is triggered and positioned: at the right-click/long-press point.
 */
import { ShortcutMenuBase } from './shortcut-menu-base.js';

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD = 10;

export class ShortcutMenu extends ShortcutMenuBase {
    constructor() {
        super();

        this._touchTimer = null;
        this._touchStart = null;
        this._longPressFired = false;

        this._handleContextMenu = this._handleContextMenu.bind(this);
        this._handleTouchStart = this._handleTouchStart.bind(this);
        this._handleTouchMove = this._handleTouchMove.bind(this);
        this._handleTouchEnd = this._handleTouchEnd.bind(this);
        this._suppressNextClick = this._suppressNextClick.bind(this);
    }

    onAdd(map) {
        this._attachMap(map);

        map.on('contextmenu', this._handleContextMenu);
        map.on('movestart', this._hide);
        map.on('zoomstart', this._hide);

        const canvasContainer = map.getCanvasContainer();
        canvasContainer.addEventListener('touchstart', this._handleTouchStart, { passive: true });
        canvasContainer.addEventListener('touchmove', this._handleTouchMove, { passive: true });
        canvasContainer.addEventListener('touchend', this._handleTouchEnd, { passive: true });
        canvasContainer.addEventListener('touchcancel', this._handleTouchEnd, { passive: true });
        this._canvasContainer = canvasContainer;

        // Not a corner control - no button to render in the map chrome.
        return null;
    }

    onRemove() {
        if (this._map) {
            this._map.off('contextmenu', this._handleContextMenu);
            this._map.off('movestart', this._hide);
            this._map.off('zoomstart', this._hide);
        }
        if (this._canvasContainer) {
            this._canvasContainer.removeEventListener('touchstart', this._handleTouchStart);
            this._canvasContainer.removeEventListener('touchmove', this._handleTouchMove);
            this._canvasContainer.removeEventListener('touchend', this._handleTouchEnd);
            this._canvasContainer.removeEventListener('touchcancel', this._handleTouchEnd);
            this._canvasContainer = null;
        }

        if (this._touchTimer) {
            clearTimeout(this._touchTimer);
            this._touchTimer = null;
        }

        this._detachMap();
    }

    /**
     * Start the long-press timer on single-finger touch. Multi-finger touches
     * (pinch-zoom) are left alone.
     */
    _handleTouchStart(e) {
        if (e.touches.length !== 1) {
            this._clearTouchTimer();
            return;
        }

        // Clear any stale pending timer before recording the new touch — order
        // matters here, since _clearTouchTimer also resets _touchStart and must
        // not run after it's set below.
        this._clearTouchTimer();

        const touch = e.touches[0];
        this._touchStart = { x: touch.clientX, y: touch.clientY };
        this._longPressFired = false;

        this._touchTimer = setTimeout(() => {
            this._touchTimer = null;
            this._longPressFired = true;

            const rect = this._map.getContainer().getBoundingClientRect();
            this._lngLat = this._map.unproject([
                this._touchStart.x - rect.left,
                this._touchStart.y - rect.top
            ]);
            this._ensureMarkerAt(this._lngLat, { pending: true });
            const offset = this._pinContentOffset();
            this._show(this._touchStart.x + offset.x, this._touchStart.y + offset.y);

            // The finger is usually still down when the menu opens; the tap/click
            // that follows on lift-off would otherwise fall through to the map's
            // own selection handling. Swallow exactly one.
            document.addEventListener('click', this._suppressNextClick, true);
        }, LONG_PRESS_MS);
    }

    /**
     * Cancel the pending long-press if the finger moves enough to look like a
     * pan/drag rather than a stationary press.
     */
    _handleTouchMove(e) {
        if (!this._touchTimer || !this._touchStart || e.touches.length !== 1) return;

        const touch = e.touches[0];
        const dx = touch.clientX - this._touchStart.x;
        const dy = touch.clientY - this._touchStart.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_THRESHOLD) {
            this._clearTouchTimer();
        }
    }

    _handleTouchEnd() {
        this._clearTouchTimer();
    }

    _clearTouchTimer() {
        if (this._touchTimer) {
            clearTimeout(this._touchTimer);
            this._touchTimer = null;
        }
        this._touchStart = null;
    }

    _suppressNextClick(e) {
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener('click', this._suppressNextClick, true);
    }

    _handleContextMenu(e) {
        e.preventDefault();
        this._lngLat = e.lngLat;
        this._ensureMarkerAt(this._lngLat, { pending: true });

        const point = e.originalEvent.touches?.[0] || e.originalEvent;
        const offset = this._pinContentOffset();
        this._show(point.clientX + offset.x, point.clientY + offset.y);
    }
}

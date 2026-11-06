/**
 * The action in the header of Find's "On the map" list: Clear all, which
 * turns into Undo for a few seconds after it runs. (Maps with no features in
 * view are left out by Find's in-view filter, js/console/find-filters.js.)
 *
 * Clear takes the overlays first and leaves the basemaps; a second Clear with
 * only basemaps left takes those too (MapBrowserControl.hideAllLayers). Each
 * Clear is one undo step. With nothing left on the map, Undo with an empty
 * stack restores the atlas's default maps instead.
 */
import { el, icon } from './find-rows.js';

const UNDO_MS = 5000;

export class OnMapActions {
    constructor() {
        this._undoStack = [];
        this._undoTimer = null;
        this._undoActive = false;
        this._undoExpired = false;
        this._layers = null;

        this.el = el('span', 'console-onmap-actions');

        this._clearBtn = el('button', 'console-link console-onmap-clear');
        this._clearBtn.type = 'button';
        this._clearIcon = icon('trash');
        this._clearText = el('span');
        this._clearBtn.append(this._clearIcon, this._clearText);
        this._clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._onClearClick();
        });

        this.el.append(this._clearBtn);
        this._setMode('remove');
    }

    update(layers) {
        this._layers = layers;
        this._syncMode();
    }

    destroy() {
        clearTimeout(this._undoTimer);
    }

    _setMode(mode) {
        this._mode = mode;
        const undo = mode === 'undo';
        this._clearIcon.name = undo ? 'arrow-counterclockwise' : 'trash';
        this._clearText.textContent = undo ? 'Undo' : 'Clear all';
        this._clearBtn.title = undo ? 'Restore the maps you just cleared' : 'Remove every map (basemaps go once nothing else is left)';
    }

    _syncMode() {
        const empty = Array.isArray(this._layers) && this._layers.every(l => l.id === 'locations');
        if (!empty) this._undoExpired = false;
        this._setMode(this._undoActive || (empty && !this._undoExpired) ? 'undo' : 'remove');
    }

    _armUndoTimer() {
        this._undoActive = true;
        clearTimeout(this._undoTimer);
        this._undoTimer = setTimeout(() => {
            this._undoStack = [];
            this._undoActive = false;
            this._undoExpired = true;
            this._syncMode();
        }, UNDO_MS);
    }

    _onClearClick() {
        const control = window.browserControl;
        if (!control) return;
        if (this._mode === 'undo') {
            const batch = this._undoStack.pop();
            if (batch) batch.forEach(layerId => control._handleLayerToggle(layerId, true));
            else control.restoreDefaultLayers();
            if (this._undoStack.length) this._armUndoTimer();
            else {
                clearTimeout(this._undoTimer);
                this._undoActive = false;
                this._undoExpired = false;
            }
            this._syncMode();
            return;
        }
        const { removed, exhausted } = control.hideAllLayers({ basemapsWhenEmpty: true });
        if (removed.length) this._undoStack.push(removed);
        if (exhausted && this._undoStack.length) this._armUndoTimer();
        this._setMode(exhausted ? 'undo' : 'remove');
    }
}

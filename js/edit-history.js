/**
 * Undo / redo for an edit session: the layer's configuration as the map's URL
 * carries it, one snapshot per settled change. The first snapshot is the layer
 * as the edit began, so undo never goes back past it.
 */

const LIMIT = 100;

export class EditHistory {
    constructor() {
        this._entries = [];
        this._index = -1;
    }

    /** Start over from a snapshot (the layer as it is when editing begins). */
    reset(snapshot = null) {
        this._entries = snapshot === null ? [] : [snapshot];
        this._index = this._entries.length - 1;
    }

    get current() {
        return this._entries[this._index] ?? null;
    }

    get canUndo() {
        return this._index > 0;
    }

    get canRedo() {
        return this._index >= 0 && this._index < this._entries.length - 1;
    }

    /** Note a change. Identical to where we are: nothing to record. A change after an undo drops the redo branch. */
    record(snapshot) {
        if (snapshot === this.current) return false;
        this._entries = this._entries.slice(0, this._index + 1);
        this._entries.push(snapshot);
        if (this._entries.length > LIMIT) this._entries.shift();
        this._index = this._entries.length - 1;
        return true;
    }

    undo() {
        if (!this.canUndo) return null;
        this._index -= 1;
        return this.current;
    }

    redo() {
        if (!this.canRedo) return null;
        this._index += 1;
        return this.current;
    }
}

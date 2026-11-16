const EDIT_HISTORY_LIMIT = 100;
const EDIT_HISTORY_COALESCE_MS = 1500;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

class EditHistory {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.buttons = [];
        this.shortcuts = { undo: IS_MAC ? '⌘Z' : 'Ctrl+Z', redo: IS_MAC ? '⇧⌘Z' : 'Ctrl+Y' };
        document.addEventListener('keydown', e => this._onKey(e));
        document.addEventListener('DOMContentLoaded', () => {
            const host = document.getElementById('edit-history-controls');
            if (host) this.mount(host);
        });
    }

    record(target, label, coalesceKey = null) {
        const now = Date.now();
        const last = this.undoStack[this.undoStack.length - 1];
        if (coalesceKey && last && last.target === target && last.coalesceKey === coalesceKey
            && !this.redoStack.length && now - last.at < EDIT_HISTORY_COALESCE_MS) {
            last.at = now;
            return;
        }
        this.undoStack.push({ target, label, coalesceKey, at: now, state: target.snapshot() });
        if (this.undoStack.length > EDIT_HISTORY_LIMIT) this.undoStack.shift();
        this.redoStack = this.redoStack.filter(entry => entry.target !== target);
        this._render();
    }

    clear(target) {
        this.undoStack = this.undoStack.filter(entry => entry.target !== target);
        this.redoStack = this.redoStack.filter(entry => entry.target !== target);
        this._render();
    }

    _lastActive(stack) {
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].target.isActive()) return i;
        }
        return -1;
    }

    _step(from, to) {
        const index = this._lastActive(from);
        if (index < 0) return false;
        const [entry] = from.splice(index, 1);
        to.push({ ...entry, coalesceKey: null, state: entry.target.snapshot() });
        entry.target.restore(entry.state);
        this._render();
        return true;
    }

    undo() {
        return this._step(this.undoStack, this.redoStack);
    }

    redo() {
        return this._step(this.redoStack, this.undoStack);
    }

    _onKey(e) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const key = e.key.toLowerCase();
        const isUndo = key === 'z' && !e.shiftKey;
        const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey);
        if (!isUndo && !isRedo) return;
        const el = document.activeElement;
        if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
        if (document.querySelector('.modal[style*="display: block"]')) return;
        e.preventDefault();
        if (isUndo) this.undo();
        else this.redo();
    }

    mount(host) {
        const btn = (dir, icon) => `<button type="button" data-history="${dir}" class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-default">${icon}<span>${dir === 'undo' ? 'Undo' : 'Redo'}</span></button>`;
        host.innerHTML = `<div class="flex gap-2">
            ${btn('undo', '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466"/></svg>')}
            ${btn('redo', '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></svg>')}
        </div>`;
        host.querySelectorAll('[data-history]').forEach(button => {
            button.addEventListener('click', () => this[button.dataset.history]());
            this.buttons.push(button);
        });
        this._render();
    }

    _render() {
        this.buttons = this.buttons.filter(button => button.isConnected);
        const stacks = { undo: this.undoStack, redo: this.redoStack };
        this.buttons.forEach(button => {
            const dir = button.dataset.history;
            const stack = stacks[dir];
            const index = this._lastActive(stack);
            button.disabled = index < 0;
            button.title = index < 0
                ? `Nothing to ${dir} (${this.shortcuts[dir]})`
                : `${dir === 'undo' ? 'Undo' : 'Redo'} ${stack[index].label} (${this.shortcuts[dir]})`;
        });
    }

    refresh() {
        this._render();
    }
}

window.editHistory = new EditHistory();

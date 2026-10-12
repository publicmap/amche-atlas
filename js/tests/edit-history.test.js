import { describe, it, expect } from 'vitest';
import { EditHistory } from '../edit-history.js';

describe('EditHistory', () => {
    const started = () => { const h = new EditHistory(); h.reset('a'); return h; };

    it('has nothing to undo or redo at the start', () => {
        const h = started();
        expect([h.canUndo, h.canRedo, h.current]).toEqual([false, false, 'a']);
    });

    it('records changes and steps back and forward through them', () => {
        const h = started();
        h.record('b'); h.record('c');
        expect(h.undo()).toBe('b');
        expect(h.undo()).toBe('a');
        expect(h.undo()).toBeNull();
        expect(h.redo()).toBe('b');
        expect(h.redo()).toBe('c');
        expect(h.redo()).toBeNull();
    });

    it('ignores a snapshot identical to the current one', () => {
        const h = started();
        expect(h.record('a')).toBe(false);
        expect(h.canUndo).toBe(false);
    });

    it('drops the redo branch when a change follows an undo', () => {
        const h = started();
        h.record('b'); h.record('c');
        h.undo();
        h.record('d');
        expect(h.canRedo).toBe(false);
        expect(h.undo()).toBe('b');
    });

    it('keeps a bounded history', () => {
        const h = started();
        for (let i = 0; i < 150; i++) h.record(`s${i}`);
        let steps = 0;
        while (h.undo() !== null) steps++;
        expect(steps).toBe(99);
    });
});

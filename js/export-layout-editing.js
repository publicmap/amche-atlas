/**
 * Editing an export page's text element (js/export-layout.js) in place: plain
 * text only, Escape (or Enter in a single-line element) to finish, and keys
 * kept from the app's shortcuts while typing.
 */
export function bindInlineEditing(item, { multiline = true, onInput, onDone }) {
    item.addEventListener('input', () => onInput?.());
    item.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && !multiline && !e.shiftKey)) {
            e.preventDefault();
            item.blur();
        }
    });
    item.addEventListener('paste', (e) => {
        if (item.contentEditable === 'plaintext-only') return;
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    item.addEventListener('blur', () => {
        item.removeAttribute('contenteditable');
        item.classList.remove('is-editing');
        const text = item.innerText.replace(/ /g, ' ').trim();
        item.textContent = text;
        onDone?.(text);
    });
}

function caretRangeAt(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    const position = document.caretPositionFromPoint?.(x, y);
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    return range;
}

/** Start editing with the caret where the pointer is, or at the end. */
export function startInlineEditing(item, ev) {
    try {
        item.contentEditable = 'plaintext-only';
    } catch (e) {
        item.contentEditable = 'true';
    }
    item.classList.add('is-editing');
    item.focus();

    const range = ev ? caretRangeAt(ev.clientX, ev.clientY) : null;
    const selection = window.getSelection();
    selection.removeAllRanges();
    if (range && item.contains(range.startContainer)) {
        selection.addRange(range);
    } else {
        const end = document.createRange();
        end.selectNodeContents(item);
        end.collapse(false);
        selection.addRange(end);
    }
}

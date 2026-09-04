/**
 * AutocompleteBadgeInput - a reusable "value shown as a badge; click it to
 * edit as a text field with a categorized autocomplete dropdown" control.
 * Generic and app-wide reusable: nothing here is specific to routing or
 * waypoints - it just needs a flat list of `{ category, icon, label, subtext,
 * value }` items and callbacks for what to do with a choice.
 *
 * Wraps autoComplete.js (https://tarekraafat.github.io/autoComplete.js) for
 * the dropdown's matching, keyboard nav (Up/Down/Enter), and ARIA plumbing;
 * this class owns the badge<->input mode switch, grouping already-ordered
 * items under a heading per `category`, and a parse-on-blur fallback for
 * free text that never matched a list item (e.g. typed coordinates or a
 * place name to geocode).
 *
 * "Controlled" like a form component: the value itself lives with the
 * caller. Call render(display) whenever it changes elsewhere (e.g. a GPS fix
 * arriving); this component calls back through onSelect() whenever the user
 * picks or types a new one, and the caller applies that to its own model
 * before calling render() again.
 *
 * Editing starts with an empty field (the current value shows only as a
 * placeholder) so every suggestion shows immediately on focus rather than
 * whatever matches the existing value; a clear (×) button appears alongside
 * the field once there's something typed to clear. The field reverts back to
 * a badge on blur, on Escape (discarding what was typed), or as soon as the
 * pointer leaves the field and its dropdown entirely (mouseleave) - not just
 * on blur, so a mouse user never has to click away to close it.
 */
import autoComplete from '@tarekraafat/autocomplete.js';

let instanceCounter = 0;

export class AutocompleteBadgeInput {
    /**
     * @param {() => Array<{category:string, icon:string, label:string, subtext?:string, value:*, checked?:boolean, onHover?:(enter:boolean)=>void}>} getItems -
     *   rebuilt fresh each time the field is focused or the query changes, so it can reflect live state (markers, GPS, features in view).
     * @param {(text:string) => (object|null|Promise<object|null>)} [parseText] -
     *   called with the typed text on blur/Enter when nothing in the list matched it. Returning an item (same shape as a list item) commits it; null/undefined reverts to the previous value.
     * @param {(item:object) => void} onSelect - a list item or a parsed item was committed as this field's value.
     * @param {string} [placeholder]
     */
    constructor({ getItems, parseText, onSelect, placeholder = 'Type to search…', debounceMs = 80 } = {}) {
        this._getItems = getItems;
        this._parseText = parseText;
        this._onSelect = onSelect;
        this._placeholder = placeholder;
        this._debounceMs = debounceMs;
        this._id = `ac-badge-input-${++instanceCounter}`;
        this._root = null;
        this._badge = null;
        this._input = null;
        this._clearBtn = null;
        this._ac = null;
        this._display = { label: '', icon: 'crosshair', subtext: '', isUnset: true, isPending: false };
    }

    mount() {
        this._root = document.createElement('div');
        this._root.className = 'ac-badge-input';
        // Leaving the whole field (input + its dropdown, both descendants of
        // root - see _enterEdit) reverts it to a badge, same as a blur -
        // moving the pointer down into the dropdown to click a suggestion
        // never leaves root, so this doesn't fight that.
        this._root.addEventListener('mouseleave', () => this._commitTyped());
        this._showBadge();
        return this._root;
    }

    /** Updates the badge's shown value. A no-op while the field is being edited. */
    render(display) {
        this._display = { ...this._display, ...display };
        if (this._badge) this._paintBadge();
    }

    get element() { return this._root; }

    /** The currently focusable element - the badge, or the input while editing. */
    focusableElement() { return this._input || this._badge; }

    destroy() {
        this._teardownInput();
        this._root?.parentNode?.removeChild(this._root);
        this._root = null;
    }

    _paintBadge() {
        const { icon, label, subtext, isUnset, isPending } = this._display;
        this._badge.innerHTML = '';
        const iconEl = document.createElement('sl-icon');
        iconEl.setAttribute('name', icon || 'crosshair');
        const text = document.createElement('div');
        text.className = 'shortcut-menu-item-text';
        const labelEl = document.createElement('span');
        labelEl.className = 'shortcut-menu-item-label';
        labelEl.textContent = isUnset ? this._placeholder : label;
        const subtextEl = document.createElement('span');
        subtextEl.className = 'shortcut-menu-item-subtext';
        subtextEl.textContent = subtext || '';
        text.append(labelEl, subtextEl);
        const pencil = document.createElement('sl-icon');
        pencil.className = 'ac-badge-input-edit-icon';
        pencil.setAttribute('name', 'pencil');
        this._badge.append(iconEl, text, pencil);
        this._badge.classList.toggle('is-unset', !!isUnset);
        this._badge.classList.toggle('is-pending', !!isPending);
        this._badge.setAttribute('aria-label', `${isUnset ? this._placeholder : label}. Click to edit`);
    }

    _showBadge() {
        this._root.innerHTML = '';
        this._badge = document.createElement('button');
        this._badge.type = 'button';
        this._badge.className = 'shortcut-menu-item shortcut-menu-item-origin ac-badge-input-badge';
        this._badge.addEventListener('click', () => this._enterEdit());
        this._paintBadge();
        this._root.appendChild(this._badge);
    }

    _enterEdit() {
        // Starts empty (the current value shows as a placeholder instead) so
        // the very first .start() below shows every suggestion, not just ones
        // matching whatever was already chosen.
        const placeholderText = this._display.isUnset ? this._placeholder : this._display.label;
        this._root.innerHTML = '';
        this._input = document.createElement('input');
        this._input.type = 'text';
        this._input.id = this._id;
        this._input.className = 'shortcut-menu-item shortcut-menu-item-origin ac-badge-input-field';
        this._input.autocomplete = 'off';
        this._input.spellcheck = false;
        this._input.placeholder = placeholderText;
        this._root.appendChild(this._input);

        this._clearBtn = document.createElement('button');
        this._clearBtn.type = 'button';
        this._clearBtn.className = 'ac-badge-input-clear';
        this._clearBtn.setAttribute('aria-label', 'Clear');
        this._clearBtn.innerHTML = '<sl-icon name="x-lg"></sl-icon>';
        // Keeps focus in the input instead of blurring it (the default action
        // of a mousedown outside the currently-focused element).
        this._clearBtn.addEventListener('mousedown', (e) => e.preventDefault());
        this._clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._input.value = '';
            this._input.focus();
            this._ac?.start();
        });
        this._root.appendChild(this._clearBtn);

        // Capture: must run before autoComplete.js's own keydown handler on
        // this same element (Escape there just clears the text; Enter there
        // is a no-op with nothing highlighted).
        this._input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopImmediatePropagation();
                e.preventDefault();
                this._teardownInput();
                this._showBadge();
                this._badge.focus();
            } else if (e.key === 'Enter' && (this._ac?.cursor ?? -1) < 0) {
                e.stopImmediatePropagation();
                e.preventDefault();
                this._commitTyped();
            }
        }, true);

        // A list click's own mousedown (see autoComplete.js) prevents this
        // blur from firing before the 'selection' event does; this only
        // fires for a genuine "leave the field" - tab away, click outside.
        this._input.addEventListener('blur', () => {
            setTimeout(() => {
                if (this._input && document.activeElement !== this._input) this._commitTyped();
            }, 0);
        });

        this._ac = new autoComplete({
            selector: `#${this._id}`,
            placeHolder: placeholderText,
            threshold: 0,
            debounce: this._debounceMs,
            resultsList: {
                class: 'ac-badge-input-list',
                element: (list, feedback) => this._renderGroups(list, feedback),
                noResults: true,
                maxResults: 40
            },
            resultItem: {
                element: (el, result) => this._renderItem(el, result),
                selected: 'ac-badge-input-item-active'
            },
            data: {
                // autoComplete.js always calls .then() on this, even for a
                // synchronous source.
                src: () => Promise.resolve(this._getItems() || []),
                searchEngine: (query, item) => this._match(query, item)
            },
            events: {
                input: {
                    selection: (event) => this._commitItem(event.detail.selection.value)
                }
            }
        });

        requestAnimationFrame(() => {
            this._input?.focus();
            this._input?.select();
            this._ac?.start();
        });
    }

    _match(query, item) {
        if (!query) return item.label;
        return item.label.toLowerCase().includes(query.toLowerCase()) ? item.label : undefined;
    }

    _renderItem(el, result) {
        const item = result.value;
        el.classList.add('shortcut-menu-item', 'ac-badge-input-item');
        el.innerHTML = '';
        const icon = document.createElement('sl-icon');
        icon.setAttribute('name', item.icon || 'geo-alt');
        const text = document.createElement('div');
        text.className = 'shortcut-menu-item-text';
        const label = document.createElement('span');
        label.className = 'shortcut-menu-item-label';
        label.textContent = item.label;
        const subtext = document.createElement('span');
        subtext.className = 'shortcut-menu-item-subtext';
        subtext.textContent = item.subtext || '';
        text.append(label, subtext);
        el.append(icon, text);
        if (item.checked) el.classList.add('is-checked');
        if (item.onHover) {
            el.addEventListener('mouseenter', () => item.onHover(true));
            el.addEventListener('mouseleave', () => item.onHover(false));
        }
    }

    /**
     * Items arrive already grouped and ordered (see getItems' contract); this
     * just walks the freshly-built <li>s in lockstep with the matches that
     * produced them and inserts a heading before the first row of each new
     * category, rather than resorting anything.
     */
    _renderGroups(list, feedback) {
        if (feedback.results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'shortcut-menu-item ac-badge-input-empty';
            empty.textContent = 'No matches';
            list.appendChild(empty);
            return;
        }

        const rows = Array.from(list.children);
        let lastCategory = null;
        feedback.results.forEach((result, i) => {
            const category = result.value.category;
            if (category !== lastCategory) {
                const heading = document.createElement('div');
                heading.className = 'ac-badge-input-group-heading';
                heading.textContent = category;
                list.insertBefore(heading, rows[i]);
                lastCategory = category;
            }
        });
    }

    _commitItem(item) {
        this._teardownInput();
        if (item) this._onSelect?.(item);
        this._showBadge();
    }

    async _commitTyped() {
        if (!this._input) return;
        const text = this._input.value.trim();
        const previousLabel = this._display.isUnset ? '' : this._display.label;
        this._teardownInput();
        // Falls back to the previous badge immediately - onSelect (once/if the
        // parse below resolves) repaints it with the new value via render().
        this._showBadge();

        if (!text || text === previousLabel || !this._parseText) return;

        let item = null;
        try {
            item = await this._parseText(text);
        } catch (error) {
            console.error('[AutocompleteBadgeInput] parseText failed:', error);
        }
        if (item) this._onSelect?.(item);
    }

    _teardownInput() {
        if (!this._input) return;
        this._ac?.unInit?.();
        this._ac = null;
        this._input = null;
        this._clearBtn = null;
    }
}

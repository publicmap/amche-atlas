/**
 * ShortcutFlyout - the reusable flyout panels for header-nav menus that need
 * per-row submenus (see map-nearby-features-control.js). Renders a flat list
 * of `{ icon, label, subtext, ariaLabel, checked, action, actions, onHover }`
 * items into a panel anchored to whichever row opened it: `'side'` (the default)
 * puts it beside the row, flipping to the left when it wouldn't fit on the
 * right; `'below'` drops it under the anchor, matched to its width, for rows
 * that read as dropdown buttons rather than submenu rows.
 *
 * Panels stack by `level`, so a submenu row can itself carry a submenu: an
 * item with `actions` (a function returning more items) gets a chevron that
 * opens the next level beside it. Opening any level closes the levels below
 * it, and only one panel exists per level - opening from another row at the
 * same level replaces its contents in place.
 *
 * Focus moves into a panel on open and back to the anchor row on close, so a
 * keyboard or screen-reader user is never left focused on a hidden element.
 */
export class ShortcutFlyout {
    constructor() {
        this._panels = [];
    }

    mount() {
        this._ensurePanel(0);
    }

    unmount() {
        this._panels.forEach(panel => panel.el.parentNode?.removeChild(panel.el));
        this._panels = [];
    }

    _ensurePanel(level) {
        while (this._panels.length <= level) {
            const el = document.createElement('div');
            el.className = 'shortcut-menu shortcut-submenu';
            el.style.display = 'none';
            el.setAttribute('role', 'menu');
            document.body.appendChild(el);
            this._panels.push({ el, anchor: null });
        }
        return this._panels[level];
    }

    get isOpen() {
        return this._panels.some(panel => panel.anchor);
    }

    contains(target) {
        return this._panels.some(panel => panel.el.contains(target));
    }

    buttons() {
        return this._panels
            .filter(panel => panel.anchor)
            .flatMap(panel => Array.from(panel.el.querySelectorAll('button')));
    }

    toggle(anchor, items, options = {}) {
        const level = options.level ?? 0;
        if (this._panels[level]?.anchor === anchor) this.closeFrom(level, { restoreFocus: true });
        else this.open(anchor, items, options);
    }

    open(anchor, items, { placement = 'side', level = 0, focusIndex = 0 } = {}) {
        if (items.length === 0) return;
        this.closeFrom(level + 1);

        const panel = this._ensurePanel(level);
        panel.el.innerHTML = '';
        items.forEach(item => panel.el.appendChild(this._buildRow(item, level)));

        panel.anchor = anchor;
        panel.el.style.display = 'block';
        const anchorRect = anchor.getBoundingClientRect();
        panel.el.style.minWidth = placement === 'below' ? `${anchorRect.width}px` : '';

        const flyoutRect = panel.el.getBoundingClientRect();
        const maxTop = window.innerHeight - flyoutRect.height - 8;
        const maxLeft = window.innerWidth - flyoutRect.width - 8;

        if (placement === 'below') {
            panel.el.style.left = `${Math.max(8, Math.min(anchorRect.left, maxLeft))}px`;
            panel.el.style.top = `${Math.max(8, Math.min(anchorRect.bottom + 4, maxTop))}px`;
        } else {
            let left = anchorRect.right + 4;
            if (left + flyoutRect.width > window.innerWidth - 8) {
                left = anchorRect.left - flyoutRect.width - 4;
            }
            panel.el.style.left = `${Math.max(8, left)}px`;
            panel.el.style.top = `${Math.max(8, Math.min(anchorRect.top, maxTop))}px`;
        }

        const rows = panel.el.querySelectorAll('button.shortcut-menu-item:not(.shortcut-menu-row-actions)');
        (rows[focusIndex] || rows[0])?.focus();
    }

    /** Closes every level. */
    close({ restoreFocus = false } = {}) {
        this.closeFrom(0, { restoreFocus });
    }

    /** Closes only the innermost open panel - what Escape should do. */
    closeDeepest({ restoreFocus = false } = {}) {
        const level = this._panels.reduce((deepest, panel, i) => (panel.anchor ? i : deepest), -1);
        if (level >= 0) this.closeFrom(level, { restoreFocus });
    }

    closeFrom(level, { restoreFocus = false } = {}) {
        for (let i = this._panels.length - 1; i >= level; i--) {
            const panel = this._panels[i];
            if (!panel.anchor) continue;
            const anchor = panel.anchor;
            panel.anchor = null;
            panel.el.style.display = 'none';
            panel.el.innerHTML = '';
            if (restoreFocus && i === level) anchor?.focus();
        }
    }

    _buildRow(item, level) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shortcut-menu-item';
        button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
        if (item.checked !== undefined) {
            button.setAttribute('aria-checked', String(item.checked));
            button.classList.toggle('is-checked', item.checked);
        }
        if (item.ariaLabel) button.setAttribute('aria-label', item.ariaLabel);

        const icon = document.createElement('sl-icon');
        icon.setAttribute('name', item.icon);
        button.appendChild(icon);

        const text = document.createElement('div');
        text.className = 'shortcut-menu-item-text';

        const label = document.createElement('span');
        label.className = 'shortcut-menu-item-label';
        label.textContent = item.label;
        text.appendChild(label);

        if (item.subtext) {
            const subtext = document.createElement('span');
            subtext.className = 'shortcut-menu-item-subtext';
            subtext.textContent = item.subtext;
            text.appendChild(subtext);
        }

        button.appendChild(text);

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            item.action();
        });

        // Pointer and focus are treated as the same "this row is the one being
        // looked at" signal, so a keyboard or screen-reader user tabbing
        // through gets whatever preview a mouse user gets on hover.
        if (item.onHover) {
            button.addEventListener('mouseenter', () => item.onHover(true));
            button.addEventListener('focus', () => item.onHover(true));
            button.addEventListener('mouseleave', () => item.onHover(false));
            button.addEventListener('blur', () => item.onHover(false));
        }

        if (!item.actions) return button;

        // A row with its own submenu: two sibling buttons in a wrapper, so the
        // row's primary action and its submenu are each reachable on their own
        // by tab/swipe (same shape as the menu rows in
        // map-nearby-features-control.js).
        const wrapper = document.createElement('div');
        wrapper.className = 'shortcut-menu-row';
        wrapper.appendChild(button);

        const actions = document.createElement('button');
        actions.type = 'button';
        actions.className = 'shortcut-menu-item shortcut-menu-row-actions';
        actions.setAttribute('aria-label', `Actions for ${item.label}`);
        const chevron = document.createElement('sl-icon');
        chevron.className = 'shortcut-menu-chevron';
        chevron.setAttribute('name', 'chevron-right');
        actions.appendChild(chevron);
        actions.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle(actions, item.actions(), { level: level + 1 });
        });
        if (item.onHover) {
            // Same row, so reaching for its chevron must not read as leaving.
            actions.addEventListener('mouseenter', () => item.onHover(true));
            actions.addEventListener('focus', () => item.onHover(true));
            actions.addEventListener('mouseleave', () => item.onHover(false));
            actions.addEventListener('blur', () => item.onHover(false));
        }
        wrapper.appendChild(actions);

        return wrapper;
    }
}

/**
 * ShortcutFlyout - a single reusable flyout panel for header-nav menus that
 * need per-row submenus (see map-nearby-features-control.js). Renders a flat
 * list of `{ icon, label, subtext, checked, action }` items into one shared
 * `.shortcut-submenu` panel anchored to whichever row opened it: `'side'`
 * (the default) puts it beside the row, flipping to the left when it wouldn't
 * fit on the right; `'below'` drops it under the anchor, matched to its width,
 * for rows that read as dropdown buttons rather than submenu rows.
 *
 * Only one flyout is open at a time — opening from another row replaces the
 * contents in place. Focus moves into the flyout on open and back to the
 * anchor row on close, so a keyboard or screen-reader user is never left
 * focused on a hidden element.
 */
export class ShortcutFlyout {
    constructor() {
        this._el = null;
        this._anchor = null;
    }

    mount() {
        this._el = document.createElement('div');
        this._el.className = 'shortcut-menu shortcut-submenu';
        this._el.style.display = 'none';
        this._el.setAttribute('role', 'menu');
        document.body.appendChild(this._el);
    }

    unmount() {
        this._el?.parentNode?.removeChild(this._el);
        this._el = null;
        this._anchor = null;
    }

    get isOpen() {
        return !!this._anchor;
    }

    contains(target) {
        return !!this._el?.contains(target);
    }

    buttons() {
        return this._el && this._anchor ? Array.from(this._el.querySelectorAll('button')) : [];
    }

    toggle(anchor, items, options) {
        if (this._anchor === anchor) this.close();
        else this.open(anchor, items, options);
    }

    open(anchor, items, { placement = 'side' } = {}) {
        if (!this._el || items.length === 0) return;

        this._el.innerHTML = '';
        items.forEach(item => this._el.appendChild(this._buildRow(item)));

        this._anchor = anchor;
        this._el.style.display = 'block';
        const anchorRect = anchor.getBoundingClientRect();
        this._el.style.minWidth = placement === 'below' ? `${anchorRect.width}px` : '';

        const flyoutRect = this._el.getBoundingClientRect();
        const maxTop = window.innerHeight - flyoutRect.height - 8;
        const maxLeft = window.innerWidth - flyoutRect.width - 8;

        if (placement === 'below') {
            this._el.style.left = `${Math.max(8, Math.min(anchorRect.left, maxLeft))}px`;
            this._el.style.top = `${Math.max(8, Math.min(anchorRect.bottom + 4, maxTop))}px`;
        } else {
            let left = anchorRect.right + 4;
            if (left + flyoutRect.width > window.innerWidth - 8) {
                left = anchorRect.left - flyoutRect.width - 4;
            }
            this._el.style.left = `${Math.max(8, left)}px`;
            this._el.style.top = `${Math.max(8, Math.min(anchorRect.top, maxTop))}px`;
        }

        this._el.querySelector('button')?.focus();
    }

    close({ restoreFocus = false } = {}) {
        if (!this._el) return;
        const anchor = this._anchor;
        this._anchor = null;
        this._el.style.display = 'none';
        this._el.innerHTML = '';
        if (restoreFocus) anchor?.focus();
    }

    _buildRow(item) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shortcut-menu-item';
        button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
        if (item.checked !== undefined) {
            button.setAttribute('aria-checked', String(item.checked));
            button.classList.toggle('is-checked', item.checked);
        }

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

        return button;
    }
}

/**
 * Find's section tabs (js/console/find-panel.js): Routes, Locations, Places,
 * Features and Map side by side above Find's one scrolling list, each with how
 * many it holds. A tab scrolls the list to its section, and the tab of the
 * section in view follows the scroll. A section with nothing in it has no tab.
 */
import { el, icon } from './find-rows.js';

export class FindSections {
    constructor({ views, onOpen }) {
        this._views = views;
        this._onOpen = onOpen;
        this._tabs = new Map();
        this.el = null;
    }

    mount() {
        this.el = el('div', 'console-tabs');
        this.el.setAttribute('role', 'tablist');
        Object.entries(this._views).forEach(([id, view]) => {
            const tab = el('button', 'console-tab');
            tab.type = 'button';
            tab.dataset.view = id;
            tab.setAttribute('role', 'tab');
            const count = el('span', 'console-tab-count');
            tab.append(icon(view.icon || 'map'), el('span', 'console-tab-name', view.label), count);
            tab.addEventListener('click', () => this._onOpen(id));
            this._tabs.set(id, { tab, count });
            this.el.appendChild(tab);
        });
        return this.el;
    }

    /** @param {string} open - the section in view; @param {Object<string, number>} counts; @param {boolean} matching - counts are query matches */
    sync(open, counts = {}, matching = false) {
        let shown = 0;
        this._tabs.forEach(({ tab, count }, id) => {
            const value = counts[id] || 0;
            tab.hidden = !value;
            if (value) shown++;
            count.textContent = String(value);
            count.classList.toggle('is-result', matching);
            const label = this._views[id].label;
            tab.title = matching ? `${label}: ${value} matching` : `${label}: ${value}`;
            tab.setAttribute('aria-label', tab.title);
        });
        this.el.hidden = shown < 2;
        this.setActive(open);
    }

    setActive(open) {
        this._tabs.forEach(({ tab }, id) => {
            tab.classList.toggle('active', id === open);
            tab.setAttribute('aria-selected', String(id === open));
        });
        const active = this._tabs.get(open)?.tab;
        if (active && !active.hidden && this.el.scrollWidth > this.el.clientWidth) {
            active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }
}

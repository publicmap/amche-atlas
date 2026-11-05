/**
 * Find's sections as a horizontal accordion (js/console/find-panel.js): Map,
 * Features, Pins and Routes side by side, one open at a time. The open one
 * fills the width with its list; each closed one is a narrow strip with its
 * icon, its name running down it and how many it holds - maps on the map,
 * saved features, pins and routes, or with a query how many match. A strip
 * opens its section; the query in the search field stays.
 */
import { el, icon } from './find-rows.js';

export class FindSections {
    constructor({ views, onOpen }) {
        this._views = views;
        this._onOpen = onOpen;
        this._strips = new Map();
        this.el = null;
    }

    /** Builds the row around `body`, the open section's content. */
    mount(body) {
        this.el = el('div', 'console-acc');
        this._body = body;
        Object.entries(this._views).forEach(([id, view]) => {
            const strip = el('button', 'console-acc-strip');
            strip.type = 'button';
            strip.dataset.view = id;
            const count = el('span', 'console-acc-count');
            strip.append(icon(view.icon || 'map'), count, el('span', 'console-acc-name', view.label));
            strip.addEventListener('click', () => this._onOpen(id));
            this._strips.set(id, { strip, count });
            this.el.appendChild(strip);
        });
        this.el.appendChild(body);
        return this.el;
    }

    /** @param {string} open - the open section; @param {Object<string, number>} counts; @param {boolean} matching - counts are query matches */
    sync(open, counts = {}, matching = false) {
        const ids = [...this._strips.keys()];
        ids.forEach((id, index) => {
            const { strip, count } = this._strips.get(id);
            const value = counts[id] || 0;
            strip.style.order = String(index * 2);
            strip.hidden = id === open;
            count.textContent = String(value);
            count.classList.toggle('is-empty', !value);
            count.classList.toggle('is-result', matching);
            const label = this._views[id].label;
            strip.title = matching ? `${label}: ${value} matching` : `${label}: ${value}`;
            strip.setAttribute('aria-label', strip.title);
        });
        this._body.style.order = String(ids.indexOf(open) * 2 + 1);
    }
}

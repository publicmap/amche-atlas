/**
 * How Find's lists are narrowed (js/console/find-panel.js), from two buttons
 * at the right end of the search field. Either mode is on, never both:
 *
 * - filter (the funnel, the default): the maps listed are those on the map,
 *   and every list keeps to the map view (js/console/find-scope.js). The
 *   funnel opens a row of the two toggles under the search field, each
 *   counting what it leaves out; the funnel counts both while the row is shut.
 * - tags (the diagram): every map, wherever it lies, narrowed by the tag
 *   chips that open under the search field instead. Leaving it brings the
 *   filters back as they were.
 *
 * In Find's atlas mode the filters act on atlases: there is no "On the map"
 * toggle, and the tags are the atlases' own (js/console/find-atlases.js).
 */
import { el, icon } from './find-rows.js';
import { isIncludingOutside, setIncludeOutside, setBrowseAll } from './find-scope.js';

function button(className, onClick) {
    const node = el('button', className);
    node.type = 'button';
    const glyph = icon('funnel');
    const count = el('span', 'console-filter-count');
    node.append(glyph, count);
    // Keeps the search field's focus, so the query can be typed on
    node.addEventListener('mousedown', (e) => e.preventDefault());
    node.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return { node, glyph, count };
}

function setCount(count, value) {
    count.textContent = value ? String(value) : '';
    count.hidden = !value;
}

function setTitle(node, title) {
    node.title = title;
    node.setAttribute('aria-label', title);
}

export class FindFilters {
    constructor({ onChange } = {}) {
        this._onChange = onChange;
        this.mode = 'filter';
        this.activeOnly = true;
        this.rowOpen = false;
        this._kept = true;

        this.el = el('span', 'console-filters');
        this._tags = button('console-filter', () => this._setTags(this.mode !== 'tags'));
        this._funnel = button('console-filter', () => {
            if (this.mode === 'tags') {
                this._setTags(false);
                this.rowOpen = true;
            } else this.rowOpen = !this.rowOpen;
            this._onChange?.();
        });
        this.el.append(this._tags.node, this._funnel.node);

        this.row = el('div', 'console-filter-row');
        this._active = button('console-filter-chip', () => {
            this.activeOnly = !this.activeOnly;
            this._onChange?.();
        });
        this._active.node.insertBefore(el('span', '', 'On the map'), this._active.count);
        this._view = button('console-filter-chip', () => setIncludeOutside(!isIncludingOutside()));
        this._view.node.insertBefore(el('span', '', 'In map view'), this._view.count);
        this.row.append(this._active.node, this._view.node);
        this.sync();
    }

    /** Atlas mode: only the in-view toggle applies. */
    setAtlasMode(on) {
        this.atlasMode = !!on;
        this._active.node.hidden = this.atlasMode;
        this.sync();
    }

    get browsingTags() {
        return this.mode === 'tags';
    }

    _setTags(on) {
        if (on) {
            this._kept = this.activeOnly;
            this.activeOnly = false;
            this.rowOpen = false;
        } else {
            this.activeOnly = this._kept;
        }
        this.mode = on ? 'tags' : 'filter';
        setBrowseAll(on);
        this._onChange?.();
    }

    /** @param {{inactive?: number, outside?: number}} hidden - what each filter leaves out */
    sync({ inactive = 0, outside = 0 } = {}) {
        const tags = this.mode === 'tags';
        const inView = !isIncludingOutside();
        const left = (this.activeOnly && !this.atlasMode ? inactive : 0) + (inView ? outside : 0);

        this._tags.glyph.name = tags ? 'diagram-3-fill' : 'diagram-3';
        this._tags.node.classList.toggle('on', tags);
        this._tags.node.setAttribute('aria-pressed', String(tags));
        const things = this.atlasMode ? 'atlas' : 'map';
        setTitle(this._tags.node, tags ? `Browsing every ${things} by tag - click to filter instead` : `Browse every ${things} by tag`);

        this._funnel.glyph.name = tags ? 'funnel' : 'funnel-fill';
        this._funnel.node.classList.toggle('on', !tags);
        this._funnel.node.classList.toggle('open', !tags && this.rowOpen);
        this._funnel.node.setAttribute('aria-expanded', String(!tags && this.rowOpen));
        setCount(this._funnel.count, !tags && !this.rowOpen ? left : 0);
        setTitle(this._funnel.node, tags ? 'Filter to the maps on the map and the map view'
            : `${left ? `Filters leave out ${left} - ` : 'Filters - '}${this.rowOpen ? 'hide them' : 'show them'}`);

        this.row.hidden = tags || !this.rowOpen;
        this._paintChip(this._active, this.activeOnly, inactive, 'eye-fill', 'eye',
            this.activeOnly ? `Only maps on the map${inactive ? ` - click to include ${inactive} more` : ''}` : 'Including maps not on the map - click for only those on it');
        this._paintChip(this._view, inView, outside, 'aspect-ratio-fill', 'aspect-ratio',
            inView ? `Only results within the map view${outside ? ` - click to include ${outside} more outside it` : ''}` : 'Including results outside the map view - click for only those within it');
    }

    _paintChip({ node, glyph, count }, on, hidden, iconOn, iconOff, title) {
        glyph.name = on ? iconOn : iconOff;
        node.classList.toggle('on', on);
        node.setAttribute('aria-pressed', String(on));
        setCount(count, on ? hidden : 0);
        setTitle(node, title);
    }
}

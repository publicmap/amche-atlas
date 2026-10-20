const PANEL_ID = 'amche-search-suggestions'

/**
 * The bridge between MapSearchControl's results and the map console's Find
 * list (js/console/find-panel.js). Callers hand it labeled sections of
 * GeoJSON-feature-like items; Find groups and draws them inside the console,
 * and this keeps the combobox side: ARIA (aria-activedescendant,
 * aria-expanded) and arrow/Enter keyboard highlighting across whatever rows
 * Find is currently showing.
 *
 * Marker/camera/layer-toggle behavior stays in map-search-control.js; a row's
 * own click handler (Find's) is what Enter triggers, so keyboard and pointer
 * always do the same thing.
 */
export class SearchSuggestionsPanel {
    constructor(searchBoxEl, { onSelect, onHover } = {}) {
        this.searchBoxEl = searchBoxEl
        this.onSelect = onSelect || (() => {})
        this.onHover = onHover || (() => {})
        this.flatItems = [] // [{ item, el, id }] in display order
        this.highlightedIndex = -1
        this._wiredFind = null
    }

    get id() {
        return PANEL_ID
    }

    get _find() {
        return window.mapConsole?.find || null
    }

    isVisible() {
        return this.flatItems.length > 0
    }

    _getComboboxInput() {
        return this.searchBoxEl.shadowRoot?.querySelector('input[role="combobox"]') ||
            this.searchBoxEl.querySelector('input[role="combobox"]') ||
            this.searchBoxEl.shadowRoot?.querySelector('input') ||
            this.searchBoxEl.querySelector('input')
    }

    _currentQuery() {
        return this._getComboboxInput()?.value || ''
    }

    _wire(find) {
        if (this._wiredFind === find) return
        this._wiredFind = find
        // Find also redraws on its own (a filter chip, a layer toggled on the
        // map), so the keyboard list follows every redraw, not just ours.
        find.onEntriesChanged = (entries) => this._sync(entries)
    }

    /**
     * @param {Array<{ ariaLabel: string, items: object[] }>} sections
     *   Each item is a GeoJSON-like feature (properties.name / properties.place_name).
     *   Find maps each section's ariaLabel to a type filter.
     */
    render(sections) {
        const find = this._find
        if (!find) return
        this._wire(find)
        find.setQuery(this._currentQuery())
        find.renderResults((sections || []).filter(s => s.items && s.items.length))
        this._updateComboboxAria(this.isVisible())
    }

    _sync(entries) {
        const previouslyHighlighted = this.flatItems[this.highlightedIndex]?.item || null
        this.flatItems = (entries || []).map((entry, index) => {
            const id = `${PANEL_ID}-option-${index}`
            entry.el.id = id
            entry.el.setAttribute('role', 'option')
            return { item: entry.item, el: entry.el, id }
        })
        // Carried over by object identity, so a background redraw (debounced
        // place results arriving) doesn't drop the row the keyboard is on.
        this.highlightedIndex = previouslyHighlighted
            ? this.flatItems.findIndex(entry => entry.item === previouslyHighlighted)
            : -1
        this._paintHighlight()
    }

    _setHighlight(index) {
        const entry = this.flatItems[index]
        if (!entry) return
        const previous = this.flatItems[this.highlightedIndex]
        if (previous && previous !== entry) this.onHover(previous.item, this.highlightedIndex, false)
        this.highlightedIndex = index
        this._paintHighlight()
        entry.el.scrollIntoView({ block: 'nearest' })
        this.onHover(entry.item, index, true)
    }

    _paintHighlight() {
        this.flatItems.forEach((entry, index) => {
            entry.el.classList.toggle('highlighted', index === this.highlightedIndex)
        })
        const input = this._getComboboxInput()
        if (!input) return
        const entry = this.flatItems[this.highlightedIndex]
        if (entry) input.setAttribute('aria-activedescendant', entry.id)
        else input.removeAttribute('aria-activedescendant')
    }

    /**
     * Called from the host's keydown handler. Returns true if the key was
     * handled (host should preventDefault and stop further processing).
     * Escape is left to the console, which closes Find.
     */
    handleKeydown(event) {
        if (!this.isVisible()) return false

        // Home/End are deliberately NOT handled here even though they're part
        // of the listbox pattern - this is a text input, and users expect
        // Home/End to move the text cursor, not the highlighted option.
        switch (event.key) {
            case 'ArrowDown':
                this._setHighlight(this.highlightedIndex < this.flatItems.length - 1 ? this.highlightedIndex + 1 : 0)
                return true
            case 'ArrowUp':
                this._setHighlight(this.highlightedIndex > 0 ? this.highlightedIndex - 1 : this.flatItems.length - 1)
                return true
            case 'Enter':
                if (this.highlightedIndex >= 0) {
                    this.flatItems[this.highlightedIndex].el.click()
                    return true
                }
                return false
            default:
                return false
        }
    }

    _updateComboboxAria(expanded) {
        const input = this._getComboboxInput()
        if (!input) return
        input.setAttribute('aria-expanded', String(expanded))
        if (expanded) {
            input.setAttribute('aria-controls', PANEL_ID)
        } else {
            input.removeAttribute('aria-activedescendant')
        }
    }

    clear() {
        const wasVisible = this.isVisible()
        this.flatItems = []
        this.highlightedIndex = -1
        const find = this._find
        if (find) {
            this._wire(find)
            find.setQuery(this._currentQuery())
            find.renderResults([])
        }
        if (wasVisible) this._updateComboboxAria(false)
    }
}

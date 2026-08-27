const PANEL_ID = 'amche-search-suggestions'

/**
 * The single, shared fixed-position suggestions dropdown for the map search
 * box. Owns the DOM, positioning, ARIA (role="listbox" > role="group" per
 * section > role="option" per item, aria-activedescendant, aria-expanded),
 * and keyboard highlighting. Callers only ever provide data (GeoJSON-like
 * features, grouped into labeled sections) and get index-based callbacks
 * back - marker/camera behavior stays in map-search-control.js.
 *
 * Being the one owner of this DOM node (rather than each suggestion source
 * injecting its own independently-positioned panel) is what prevents two
 * suggestion sources from ever visually overlapping.
 */
export class SearchSuggestionsPanel {
    constructor(searchBoxEl, { onSelect, onHover } = {}) {
        this.searchBoxEl = searchBoxEl
        this.onSelect = onSelect || (() => {})
        this.onHover = onHover || (() => {})
        this.$panel = null
        this.flatItems = [] // [{ item, id }], index-aligned across all sections
        this.highlightedIndex = -1
    }

    get id() {
        return PANEL_ID
    }

    isVisible() {
        return !!this.$panel && this.$panel.length > 0
    }

    _getComboboxInput() {
        return this.searchBoxEl.shadowRoot?.querySelector('input[role="combobox"]') ||
            this.searchBoxEl.querySelector('input[role="combobox"]') ||
            this.searchBoxEl.shadowRoot?.querySelector('input') ||
            this.searchBoxEl.querySelector('input')
    }

    _escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
    }

    /**
     * @param {Array<{ ariaLabel: string, items: object[], attribution?: string }>} sections
     *   Each item is a GeoJSON-like feature (properties.name / properties.place_name).
     *   Sections with no items are dropped.
     */
    render(sections) {
        const nonEmptySections = (sections || []).filter(s => s.items && s.items.length)

        if (!nonEmptySections.length) {
            this.clear()
            return
        }

        this._teardownDom()
        this.flatItems = []

        const sectionsHtml = nonEmptySections.map((section) => {
            const itemsHtml = section.items.map((feature, indexInSection) => {
                const flatIndex = this.flatItems.length
                const optionId = `${PANEL_ID}-option-${flatIndex}`
                this.flatItems.push({ item: feature, id: optionId })

                const name = this._escapeHtml(feature.properties?.name)
                const desc = this._escapeHtml(feature.properties?.place_name)
                const isCadastralPlot = !!feature.properties?._isCadastralParquet

                return `
                    <div class="mbx09bc48e7--Suggestion local-suggestion${isCadastralPlot ? ' cadastral-plot-suggestion' : ''}"
                         role="option"
                         tabindex="-1"
                         id="${optionId}"
                         data-flat-index="${flatIndex}"
                         aria-posinset="${indexInSection + 1}"
                         aria-setsize="${section.items.length}"
                         style="
                             display: flex !important;
                             align-items: center;
                             padding: 8px 12px;
                             cursor: pointer;
                             background: #1f2937;
                             border-bottom: 1px solid #374151;
                             min-height: 40px;
                             font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                         ">
                        <div class="mbx09bc48e7--SuggestionIcon" aria-hidden="true" style="margin-right: 8px; font-size: 16px;">📍</div>
                        <div class="mbx09bc48e7--SuggestionText" style="flex: 1; overflow: hidden;">
                            <div class="mbx09bc48e7--SuggestionName" style="font-weight: 500; color: #f3f4f6; font-size: 14px; line-height: 1.2;">${name}</div>
                            <div class="mbx09bc48e7--SuggestionDesc" style="color: #9ca3af; font-size: 12px; line-height: 1.2; margin-top: 2px;">${desc}</div>
                        </div>
                    </div>
                `
            }).join('')

            const attributionHtml = section.attribution ? `
                <div class="local-suggestion-attribution" aria-hidden="true" style="
                    padding: 4px 12px;
                    font-size: 11px;
                    color: #6b7280;
                    text-align: right;
                    background: #1f2937;
                    border-bottom: 1px solid #374151;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                ">${this._escapeHtml(section.attribution)}</div>
            ` : ''

            return `<div role="group" aria-label="${this._escapeHtml(section.ariaLabel || 'Suggestions')}">${itemsHtml}${attributionHtml}</div>`
        }).join('')

        const rect = this.searchBoxEl.getBoundingClientRect()
        const $panel = $(`<div id="${PANEL_ID}" role="listbox" aria-label="Search suggestions"></div>`)
        $panel.css({
            position: 'fixed',
            top: `${rect.bottom}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            zIndex: 9999
        })
        $panel.html(sectionsHtml)
        $('body').append($panel)
        this.$panel = $panel

        $panel.find('[role="option"]')
            .on('click', (event) => {
                this._select(parseInt($(event.currentTarget).data('flat-index'), 10))
            })
            .on('mouseenter', (event) => {
                $(event.currentTarget).css('background-color', '#374151')
                this._setHighlight(parseInt($(event.currentTarget).data('flat-index'), 10))
            })
            .on('mouseleave', (event) => {
                $(event.currentTarget).css('background-color', '#1f2937')
                this.onHover(parseInt($(event.currentTarget).data('flat-index'), 10), false)
            })

        this.highlightedIndex = -1
        this._updateComboboxAria(true)
    }

    _select(index) {
        if (!this.flatItems[index]) return
        this.onSelect(index)
    }

    _setHighlight(index) {
        if (!this.flatItems[index]) return
        this.highlightedIndex = index
        const input = this._getComboboxInput()
        if (input) {
            input.setAttribute('aria-activedescendant', this.flatItems[index].id)
        }
        this.onHover(index, true)
    }

    /**
     * Called from the host's keydown handler. Returns true if the key was
     * handled (host should preventDefault and stop further processing).
     */
    handleKeydown(event) {
        if (!this.isVisible() || this.flatItems.length === 0) return false

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
                    this._select(this.highlightedIndex)
                    return true
                }
                return false
            case 'Escape':
                this.clear()
                return true
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

    _teardownDom() {
        if (this.$panel) {
            this.$panel.remove()
            this.$panel = null
        }
    }

    clear() {
        const wasVisible = this.isVisible()
        this._teardownDom()
        this.flatItems = []
        this.highlightedIndex = -1
        if (wasVisible) this._updateComboboxAria(false)
    }
}

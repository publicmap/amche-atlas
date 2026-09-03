const PANEL_ID = 'amche-search-suggestions'

/**
 * The single, shared fixed-position suggestions dropdown for the map search
 * box. Owns the DOM, positioning, ARIA (role="listbox" > role="group" per
 * section > role="option" per item, aria-activedescendant, aria-expanded),
 * and keyboard highlighting. Callers provide data (GeoJSON-feature-like items,
 * grouped into labeled sections; an optional top-level `icon` string overrides
 * the default 📍) and get the selected/hovered item (plus its flat index)
 * back - marker/camera/layer-toggle behavior stays in map-search-control.js.
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

    /**
     * Where our panel should start: below Mapbox's own native suggestions
     * dropdown when it's currently showing something (it can run
     * concurrently with ours - see map-search-control.js's
     * shouldBypassSearchSuggest), so the two stack instead of ours covering
     * it. Never touches that dropdown itself, only reads its position - same
     * "don't mutate Mapbox's own listbox" rule as _getMapboxListbox() in
     * map-search-control.js, and the same substring-matched selector (this
     * widget doesn't set role="listbox"; its classes are per-build-hashed,
     * e.g. "mbx0cedb16f--Results").
     */
    _getAnchorBottom(searchBoxRect) {
        const mapboxResults = this.searchBoxEl.shadowRoot?.querySelector('[class*="Results"]') ||
            this.searchBoxEl.querySelector('[class*="Results"]')
        if (mapboxResults) {
            const resultsRect = mapboxResults.getBoundingClientRect()
            if (resultsRect.height > 0) {
                return Math.max(searchBoxRect.bottom, resultsRect.bottom)
            }
        }
        return searchBoxRect.bottom
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

        // Rebuilds happen often and asynchronously (debounced place results
        // arriving, the staggered re-render retries in
        // map-search-control.js's scheduleSuggestionInjection) while the user
        // may be mid-keyboard-navigation. Losing the highlight on every
        // rebuild would make Enter silently do nothing (or fall through to
        // Mapbox's own native suggest handling) - so carry it forward by
        // object identity if that item is still present in the new content.
        const previouslyHighlighted = this.highlightedIndex >= 0
            ? this.flatItems[this.highlightedIndex]?.item
            : null

        this._teardownDom()
        this.flatItems = []

        const sectionsHtml = nonEmptySections.map((section) => {
            const itemsHtml = section.items.map((feature, indexInSection) => {
                const flatIndex = this.flatItems.length
                const optionId = `${PANEL_ID}-option-${flatIndex}`
                this.flatItems.push({ item: feature, id: optionId })

                const name = this._escapeHtml(feature.properties?.name)
                const desc = this._escapeHtml(feature.properties?.place_name)
                const icon = this._escapeHtml(feature.icon || '📍')
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
                        <div class="mbx09bc48e7--SuggestionIcon" aria-hidden="true" style="margin-right: 8px; font-size: 16px;">${icon}</div>
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
            top: `${this._getAnchorBottom(rect)}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            // The control corner it now lives in does not take pointer events
            pointerEvents: 'auto',
            zIndex: 9999
        })
        $panel.html(sectionsHtml)
        // Into the map's top-left control corner rather than <body>: that corner
        // is a stacking context of its own (Mapbox gives it position:absolute
        // with z-index:2, inside #map's own z-index:1), so a body-level panel
        // outranks every control in it no matter what z-index they carry - which
        // put this dropdown over the layer stack's hover flyouts
        // (js/layer-stack-strip.js). Sharing the corner, the two order by
        // z-index as intended. It stays position:fixed - no ancestor here sets a
        // transform - so the viewport coordinates above are unaffected, and it
        // contributes nothing to the corner's layout.
        const $host = $(this.searchBoxEl.closest('.mapboxgl-ctrl-top-left') ||
            this.searchBoxEl.closest('.mapboxgl-map') || document.body)
        $host.append($panel)
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
                const index = parseInt($(event.currentTarget).data('flat-index'), 10)
                this.onHover(this.flatItems[index]?.item, index, false)
            })

        // Restore the previous highlight if that item is still here (by
        // reference - see the comment above). Set directly rather than via
        // _setHighlight() so a silent background rebuild doesn't re-fire
        // onHover() (which would spuriously move the map/toggle a marker
        // popup the user never asked to hover again).
        this.highlightedIndex = previouslyHighlighted
            ? this.flatItems.findIndex(entry => entry.item === previouslyHighlighted)
            : -1
        if (this.highlightedIndex >= 0) {
            const input = this._getComboboxInput()
            if (input) input.setAttribute('aria-activedescendant', this.flatItems[this.highlightedIndex].id)
        }

        this._updateComboboxAria(true)
    }

    _select(index) {
        const entry = this.flatItems[index]
        if (!entry) return
        this.onSelect(entry.item, index)
    }

    _setHighlight(index) {
        const entry = this.flatItems[index]
        if (!entry) return
        this.highlightedIndex = index
        const input = this._getComboboxInput()
        if (input) {
            input.setAttribute('aria-activedescendant', entry.id)
        }
        this.onHover(entry.item, index, true)
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

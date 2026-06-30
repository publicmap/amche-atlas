import {
    detectVillageFromMapCenter,
    getVillageList,
    isCadastralSearchEnabled,
    parseVillageEntryKey,
    queryCadastralPlotsByVillage,
    villageEntryKey,
} from './cadastral-search.js'

export class CadastralSearchUI {
    constructor(map, searchControl) {
        this.map = map
        this.searchControl = searchControl
        this.visible = false
        this.selectedVillage = null
        this.userPickedVillage = false
        this._debounceTimer = null
        this._pendingSurvey = null
        this._blurTimer = null

        this._buildDOM()
        this._bindEvents()
        this._hookMapboxSearchFocus()
        this._loadVillages()
    }

    isActive() {
        return this.visible
    }

    _buildDOM() {
        const searchBox = document.getElementById('mapbox-search-box')
        if (!searchBox) return

        this.searchBoxEl = searchBox

        this.panel = document.createElement('div')
        this.panel.className = 'cadastral-search-panel hidden'
        this.panel.innerHTML = `
            <sl-select id="cadastral-village-select" class="cadastral-village-select"
                placeholder="Village" hoist clearable size="small"></sl-select>
            <sl-input id="cadastral-survey-input" class="cadastral-survey-input"
                placeholder="Survey no." clearable size="small"></sl-input>
        `

        this.resultsEl = document.createElement('div')
        this.resultsEl.className = 'cadastral-results hidden'
        this.resultsEl.setAttribute('role', 'listbox')

        this.dropdown = document.createElement('div')
        this.dropdown.className = 'cadastral-dropdown hidden'
        this.dropdown.appendChild(this.panel)
        this.dropdown.appendChild(this.resultsEl)

        document.body.appendChild(this.dropdown)

        this.villageSelect = this.panel.querySelector('#cadastral-village-select')
        this.surveyInput = this.panel.querySelector('#cadastral-survey-input')
    }

    async _loadVillages() {
        if (!this.villageSelect) return

        const villages = await getVillageList()
        const fragment = document.createDocumentFragment()

        villages
            .slice()
            .sort((a, b) => a.village.localeCompare(b.village))
            .forEach(entry => {
                const opt = document.createElement('sl-option')
                opt.value = villageEntryKey(entry)
                opt.textContent = `${entry.village} — ${entry.taluka}`
                fragment.appendChild(opt)
            })

        this.villageSelect.appendChild(fragment)

        if (this.visible && !this.userPickedVillage && !this.selectedVillage) {
            this._syncVillageFromMap()
        }
    }

    _bindEvents() {
        if (!this.dropdown) return

        this.dropdown.addEventListener('mousedown', e => {
            const interactive = e.target.closest('sl-input, sl-select, input, button, [tabindex]')
            if (!interactive) e.preventDefault()
        })
        this.dropdown.addEventListener('focusin', () => {
            clearTimeout(this._blurTimer)
        })
        this.dropdown.addEventListener('focusout', () => {
            clearTimeout(this._blurTimer)
            this._blurTimer = setTimeout(() => {
                if (!this._dropdownHasFocus()) this._hide()
            }, 150)
        })

        const onResize = () => { if (this.visible) this._positionDropdown() }
        window.addEventListener('resize', onResize)
        window.addEventListener('scroll', onResize, true)

        this.villageSelect?.addEventListener('sl-change', () => {
            this.userPickedVillage = true
            this.selectedVillage = parseVillageEntryKey(this.villageSelect.value)
            sessionStorage.setItem('cadastral-village', this.villageSelect.value)
            this._runSearch()
        })

        this.villageSelect?.addEventListener('sl-clear', () => {
            this.selectedVillage = null
            this.userPickedVillage = true
            sessionStorage.removeItem('cadastral-village')
            this._clearResults()
        })

        this.surveyInput?.addEventListener('sl-input', () => {
            clearTimeout(this._debounceTimer)
            this._debounceTimer = setTimeout(() => this._runSearch(), 250)
        })

        this.surveyInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault()
                this._selectFirstResult()
            }
        })

        this.map.on('moveend', () => {
            if (this.userPickedVillage) return
            this._syncVillageFromMap()
        })
    }

    _stackHasFocus() {
        const active = document.activeElement
        if (!active || !this.searchBoxEl) return false
        if (this.searchBoxEl === active || this.searchBoxEl.contains(active)) return true
        const host = active.getRootNode?.()?.host
        return Boolean(host && (host === this.searchBoxEl || this.searchBoxEl.contains(host)))
    }

    _dropdownHasFocus() {
        const active = document.activeElement
        if (!active || !this.dropdown) return false
        return this.dropdown.contains(active)
    }

    _positionDropdown() {
        const rect = this.searchBoxEl.getBoundingClientRect()
        this.dropdown.style.position = 'fixed'
        this.dropdown.style.left = rect.left + 'px'
        this.dropdown.style.top = rect.bottom + 4 + 'px'
        this.dropdown.style.width = rect.width + 'px'
    }

    _hookMapboxSearchFocus() {
        const searchEl = this.searchControl?.searchBox
        if (!searchEl) return

        const show = () => this._show()
        const scheduleHide = () => {
            clearTimeout(this._blurTimer)
            this._blurTimer = setTimeout(() => {
                if (!this._stackHasFocus() && !this._dropdownHasFocus()) this._hide()
            }, 150)
        }

        searchEl.addEventListener('click', show)
        searchEl.addEventListener('clear', () => {
            if (this.visible) {
                this.dropdown.classList.remove('hidden')
                this.panel.classList.remove('hidden')
            }
        })

        const attachInputListeners = () => {
            const input = searchEl.querySelector('input') ||
                searchEl.shadowRoot?.querySelector('input[role="combobox"], input')
            if (input && !input._cadastralHooked) {
                input.addEventListener('focus', show)
                input.addEventListener('blur', scheduleHide)
                input.addEventListener('input', () => {
                    if (input.value) {
                        this.dropdown.classList.add('hidden')
                    } else {
                        if (this.visible) {
                            this.dropdown.classList.remove('hidden')
                            this.panel.classList.remove('hidden')
                        }
                    }
                })
                input._cadastralHooked = true
            }
        }

        attachInputListeners()
        new MutationObserver(attachInputListeners).observe(searchEl, {
            childList: true,
            subtree: true,
        })
        if (searchEl.shadowRoot) {
            new MutationObserver(attachInputListeners).observe(searchEl.shadowRoot, {
                childList: true,
                subtree: true,
            })
        }
        setTimeout(attachInputListeners, 100)
        setTimeout(attachInputListeners, 500)
    }

    _show() {
        if (!isCadastralSearchEnabled()) return

        this.visible = true
        this._positionDropdown()
        this.dropdown.classList.remove('hidden')
        this.panel.classList.remove('hidden')

        if (this.userPickedVillage) return

        const saved = sessionStorage.getItem('cadastral-village')
        if (saved && !this.selectedVillage) {
            this.villageSelect.value = saved
            this.selectedVillage = parseVillageEntryKey(saved)
        } else {
            this._syncVillageFromMap()
        }
    }

    _hide() {
        this.visible = false
        this.panel.classList.add('hidden')
        this._clearResults()
        this.dropdown.classList.add('hidden')
    }

    _syncVillageFromMap() {
        const entry = detectVillageFromMapCenter(this.map)
        if (!entry) return

        this.selectedVillage = entry
        this.villageSelect.value = villageEntryKey(entry)
    }

    _getSurveyRaw() {
        return this.surveyInput?.value?.trim() || ''
    }

    _runSearch() {
        const surveyRaw = this._getSurveyRaw()
        if (!this.selectedVillage?.village || !surveyRaw) {
            this._clearResults()
            return
        }

        this._pendingSurvey = surveyRaw
        queryCadastralPlotsByVillage(this.selectedVillage.village, surveyRaw)
            .then(features => {
                if (this._pendingSurvey !== surveyRaw) return
                this._renderResults(features)
                this.searchControl.localSuggestions = features
                this.searchControl.clearSuggestionMarkers()
                if (features.length) {
                    this.searchControl.createSuggestionMarkers()
                    this.searchControl.showSuggestionMarkers()
                }
            })
            .catch(err => console.error('[cadastral-ui]', err))
    }

    _renderResults(features) {
        if (!features.length) {
            this._clearResults()
            return
        }

        this.resultsEl.innerHTML = features.map((feature, index) => `
            <button type="button" class="cadastral-result" role="option"
                data-index="${index}" tabindex="-1">
                <span class="cadastral-result__icon" aria-hidden="true">📍</span>
                <span class="cadastral-result__text">${this.searchControl._escapeHtml(feature.properties.name)}</span>
            </button>
        `).join('')

        this.resultsEl.classList.remove('hidden')

        this.resultsEl.querySelectorAll('.cadastral-result').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation()
                const index = Number(btn.dataset.index)
                const feature = features[index]
                if (!feature) return

                this._clearResults()
                this._hide()
                this.searchControl.handleRetrieve(new CustomEvent('retrieve', {
                    detail: { features: [feature] },
                }))
                this.searchControl.suppressSuggestions()
            })
        })
    }

    _selectFirstResult() {
        const first = this.resultsEl.querySelector('.cadastral-result')
        first?.click()
    }

    _clearResults() {
        this.resultsEl.innerHTML = ''
        this.resultsEl.classList.add('hidden')
        this.searchControl?.clearSuggestionMarkers()
        if (this.searchControl) {
            this.searchControl.localSuggestions = []
        }
    }
}

export function initCadastralSearchUI(map, searchControl) {
    if (!isCadastralSearchEnabled()) return null
    if (window.cadastralSearchUI) return window.cadastralSearchUI

    const ui = new CadastralSearchUI(map, searchControl)
    window.cadastralSearchUI = ui
    return ui
}

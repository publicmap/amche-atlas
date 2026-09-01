import {
    detectVillageFromMapCenter,
    filterVillageList,
    getVillageCenter,
    getVillageList,
    isCadastralSearchEnabled,
    parseVillageEntryKey,
    queryCadastralPlotsByVillage,
    villageEntryKey,
} from './cadastral-search.js'

const MOBILE_BREAKPOINT = '(max-width: 768px)'

export class CadastralSearchUI {
    constructor(map, searchControl) {
        this.map = map
        this.searchControl = searchControl
        this.visible = false
        this.selectedVillage = null
        this.userPickedVillage = false
        this._debounceTimer = null
        this._pickerDebounceTimer = null
        this._pendingSurvey = null
        this._blurTimer = null
        this._villageList = []
        this._pickerMode = null
        this._pickerTrigger = null
        this._pendingPickerSurvey = null
        this._mobileMq = window.matchMedia(MOBILE_BREAKPOINT)

        this._buildDOM()
        this._bindEvents()
        this._setupMobilePicker()
        this._hookMapboxSearchFocus()
        this._loadVillages()
    }

    isActive() {
        return this.visible
    }

    _isMobileLayout() {
        return this._mobileMq.matches
    }

    _buildDOM() {
        const searchBox = document.getElementById('mapbox-search-box')
        if (!searchBox) return

        this.searchBoxEl = searchBox

        this.panel = document.createElement('div')
        this.panel.className = 'cadastral-search-panel hidden'
        this.panel.innerHTML = `
            <sl-select id="cadastral-village-select"
                class="cadastral-village-select cadastral-desktop-only"
                placeholder="Village" hoist clearable size="small"></sl-select>
            <sl-input id="cadastral-survey-input"
                class="cadastral-survey-input cadastral-desktop-only"
                placeholder="Survey no." clearable size="small"></sl-input>
            <button type="button" id="cadastral-village-trigger"
                class="cadastral-village-trigger cadastral-mobile-only cadastral-field-trigger"
                role="combobox" aria-haspopup="dialog" aria-expanded="false"
                aria-label="Select village">
                <span class="cadastral-field-trigger__label">Village</span>
            </button>
            <button type="button" id="cadastral-survey-trigger"
                class="cadastral-survey-trigger cadastral-mobile-only cadastral-field-trigger"
                role="combobox" aria-haspopup="dialog" aria-expanded="false"
                aria-label="Select survey number" aria-disabled="true" disabled>
                <span class="cadastral-field-trigger__label">Survey no.</span>
            </button>
        `

        this.resultsEl = document.createElement('div')
        this.resultsEl.className = 'cadastral-results hidden'
        this.resultsEl.setAttribute('role', 'listbox')

        this.dropdown = document.createElement('div')
        this.dropdown.className = 'cadastral-dropdown hidden'
        this.dropdown.appendChild(this.panel)
        this.dropdown.appendChild(this.resultsEl)

        this.pickerDrawer = document.createElement('sl-drawer')
        this.pickerDrawer.id = 'cadastral-picker-drawer'
        this.pickerDrawer.className = 'cadastral-picker-drawer drawer-placement-bottom'
        this.pickerDrawer.placement = 'bottom'
        this.pickerDrawer.label = 'Select'
        this.pickerDrawer.innerHTML = `
            <div class="cadastral-picker-body">
                <sl-input id="cadastral-picker-search" class="cadastral-picker-search"
                    placeholder="Search" clearable size="small"></sl-input>
                <div id="cadastral-picker-list" class="cadastral-picker-list"
                    role="listbox"></div>
            </div>
        `

        document.body.appendChild(this.dropdown)
        document.body.appendChild(this.pickerDrawer)

        this.villageSelect = this.panel.querySelector('#cadastral-village-select')
        this.surveyInput = this.panel.querySelector('#cadastral-survey-input')
        this.villageTrigger = this.panel.querySelector('#cadastral-village-trigger')
        this.surveyTrigger = this.panel.querySelector('#cadastral-survey-trigger')
        this.pickerSearch = this.pickerDrawer.querySelector('#cadastral-picker-search')
        this.pickerList = this.pickerDrawer.querySelector('#cadastral-picker-list')
    }

    async _loadVillages() {
        if (!this.villageSelect) return

        this._villageList = await getVillageList()
        const fragment = document.createDocumentFragment()

        this._villageList
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
        this._syncTriggerLabels()
    }

    _isPickerOpen() {
        return Boolean(this.pickerDrawer?.open)
    }

    _setupMobilePicker() {
        this.pickerDrawer.addEventListener('sl-after-show', () => {
            this._refreshPickerList()
        })

        this.pickerDrawer.addEventListener('sl-hide', () => {
            const active = document.activeElement
            if (active && this.pickerDrawer.contains(active)) active.blur()
            if (this._pickerTrigger) {
                this._pickerTrigger.setAttribute('aria-expanded', 'false')
            }
            this.dropdown?.classList.remove('cadastral-dropdown--picker-open')
            this._pickerMode = null
            this._pickerTrigger = null
            if (this._isMobileLayout() && this._getSurveyRaw()) {
                this._runSearch()
            }
        })

        this._mobileMq.addEventListener('change', () => {
            if (!this._isMobileLayout()) this._closePicker()
            this._syncTriggerLabels()
        })

        this._attachPickerSearchListeners()
    }

    _attachPickerSearchListeners() {
        if (this.pickerDrawer._pickerInputHooked) return
        this.pickerDrawer._pickerInputHooked = true

        const onPickerInput = () => {
            clearTimeout(this._pickerDebounceTimer)
            this._pickerDebounceTimer = setTimeout(() => this._refreshPickerList(), 200)
        }

        this.pickerSearch?.addEventListener('sl-input', onPickerInput)
        this.pickerSearch?.addEventListener('sl-change', onPickerInput)
        this.pickerDrawer.addEventListener('input', (event) => {
            if (event.composedPath().includes(this.pickerSearch)) onPickerInput()
        }, true)
    }

    _refreshPickerList() {
        const query = this.pickerSearch?.value ?? ''
        if (this._pickerMode === 'village') {
            this._updateVillagePicker(query)
        } else if (this._pickerMode === 'survey') {
            this._updateSurveyPicker(query)
        }
    }

    _syncTriggerLabels() {
        if (!this.villageTrigger || !this.surveyTrigger) return

        const villageLabel = this.villageTrigger.querySelector('.cadastral-field-trigger__label')
        const surveyLabel = this.surveyTrigger.querySelector('.cadastral-field-trigger__label')

        if (this.selectedVillage) {
            villageLabel.textContent = `${this.selectedVillage.village} — ${this.selectedVillage.taluka}`
            villageLabel.classList.add('cadastral-field-trigger__label--filled')
        } else {
            villageLabel.textContent = 'Village'
            villageLabel.classList.remove('cadastral-field-trigger__label--filled')
        }

        const surveyRaw = this._getSurveyRaw()
        if (surveyRaw) {
            surveyLabel.textContent = surveyRaw
            surveyLabel.classList.add('cadastral-field-trigger__label--filled')
        } else {
            surveyLabel.textContent = 'Survey no.'
            surveyLabel.classList.remove('cadastral-field-trigger__label--filled')
        }

        const hasVillage = Boolean(this.selectedVillage?.village)
        this.surveyTrigger.disabled = !hasVillage
        this.surveyTrigger.setAttribute('aria-disabled', hasVillage ? 'false' : 'true')
    }

    _openPicker(mode) {
        if (!this._isMobileLayout()) return
        if (mode === 'survey' && !this.selectedVillage?.village) return

        this._pickerMode = mode
        this._pickerTrigger = mode === 'village' ? this.villageTrigger : this.surveyTrigger
        this._pickerTrigger.setAttribute('aria-expanded', 'true')

        this._clearResults()
        this.dropdown?.classList.add('cadastral-dropdown--picker-open')

        const title = mode === 'village' ? 'Select village' : 'Select survey number'
        this.pickerDrawer.label = title

        const placeholder = mode === 'village' ? 'Search villages' : 'Type to search survey numbers'
        this.pickerSearch.placeholder = placeholder
        this.pickerSearch.value = mode === 'survey' ? this._getSurveyRaw() : ''

        this._renderPickerPlaceholder(mode)
        this.pickerDrawer.show()

        requestAnimationFrame(() => {
            const input = this.pickerSearch.shadowRoot?.querySelector('input')
            input?.focus?.()
            this._refreshPickerList()
        })
    }

    _closePicker() {
        if (this.pickerDrawer.open) this.pickerDrawer.hide()
    }

    _renderPickerPlaceholder(mode) {
        const message = mode === 'village'
            ? 'Type to filter villages'
            : 'Type to search survey numbers'
        this.pickerList.innerHTML = `
            <div class="cadastral-picker-hint">${message}</div>
        `
    }

    _renderPickerList(items, onSelect) {
        if (!items.length) {
            this.pickerList.innerHTML = `
                <div class="cadastral-picker-hint">No matches found</div>
            `
            return
        }

        this.pickerList.innerHTML = items.map((item, index) => `
            <button type="button" class="cadastral-picker-item" role="option"
                data-index="${index}" tabindex="-1">${this.searchControl._escapeHtml(item.label)}</button>
        `).join('')

        this.pickerList.querySelectorAll('.cadastral-picker-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = Number(btn.dataset.index)
                onSelect(items[index])
            })
        })
    }

    _updateVillagePicker(query) {
        const matches = filterVillageList(this._villageList, query)
        const items = matches.map(entry => ({
            label: `${entry.village} — ${entry.taluka}`,
            entry,
        }))
        this._renderPickerList(items, ({ entry }) => {
            this._selectVillage(entry)
            this._closePicker()
        })
    }

    _updateSurveyPicker(query) {
        if (!query.trim()) {
            this._renderPickerPlaceholder('survey')
            return
        }

        this._pendingPickerSurvey = query
        queryCadastralPlotsByVillage(this.selectedVillage.village, this.selectedVillage.taluka, query, 50)
            .then(features => {
                if (this._pickerMode !== 'survey') return
                if (this._pendingPickerSurvey !== query) return
                this._renderPickerPlotResults(features)
            })
            .catch(err => console.error('[cadastral-ui]', err))
    }

    _renderPickerPlotResults(features) {
        if (!features.length) {
            this.pickerList.innerHTML = `
                <div class="cadastral-picker-hint">No matches found</div>
            `
            return
        }

        this.pickerList.innerHTML = features.map((feature, index) => `
            <button type="button" class="cadastral-result cadastral-picker-plot-result" role="option"
                data-index="${index}" tabindex="-1">
                <span class="cadastral-result__icon" aria-hidden="true">📍</span>
                <span class="cadastral-result__text">${this.searchControl._escapeHtml(feature.properties.name)}</span>
            </button>
        `).join('')

        this.pickerList.querySelectorAll('.cadastral-picker-plot-result').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = Number(btn.dataset.index)
                const feature = features[index]
                if (feature) this._selectPlotResult(feature)
            })
        })
    }

    _selectPlotResult(feature) {
        const surveyRaw = feature.properties._surveyRaw || ''
        if (surveyRaw) {
            this.surveyInput.value = surveyRaw
            this._syncTriggerLabels()
        }
        this._clearResults()
        this._closePicker()
        this._hide()
        this.searchControl.handleRetrieve(new CustomEvent('retrieve', {
            detail: { features: [feature] },
        }))
        this.searchControl.suppressSuggestions()
    }

    _selectVillage(entry) {
        this.userPickedVillage = true
        this.selectedVillage = entry
        const key = villageEntryKey(entry)
        this.villageSelect.value = key
        sessionStorage.setItem('cadastral-village', key)
        this._syncTriggerLabels()
        this._flyToVillage(this.selectedVillage)
        this._runSearch()
    }

    _bindEvents() {
        if (!this.dropdown) return

        this.dropdown.addEventListener('mousedown', e => {
            const interactive = e.target.closest(
                'sl-input, sl-select, input, button, [tabindex], .cadastral-field-trigger',
            )
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
            this._syncTriggerLabels()
            this._flyToVillage(this.selectedVillage)
            this._runSearch()
        })

        this.villageSelect?.addEventListener('sl-clear', () => {
            this.selectedVillage = null
            this.userPickedVillage = true
            sessionStorage.removeItem('cadastral-village')
            this._syncTriggerLabels()
            this._clearResults()
        })

        this.surveyInput?.addEventListener('sl-input', () => {
            this._syncTriggerLabels()
            clearTimeout(this._debounceTimer)
            this._debounceTimer = setTimeout(() => this._runSearch(), 250)
        })

        this.surveyInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault()
                this._selectFirstResult()
            }
        })

        this.villageTrigger?.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            this._openPicker('village')
        })

        this.surveyTrigger?.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!this.selectedVillage?.village) return
            this._openPicker('survey')
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
        if (this.dropdown.contains(active)) return true
        if (this._isPickerOpen() && this.pickerDrawer.contains(active)) return true
        const host = active.getRootNode?.()?.host
        return Boolean(host && (this.dropdown.contains(host) || this.pickerDrawer?.contains(host)))
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

        if (this.userPickedVillage) {
            this._syncTriggerLabels()
            return
        }

        const saved = sessionStorage.getItem('cadastral-village')
        if (saved && !this.selectedVillage) {
            this.villageSelect.value = saved
            this.selectedVillage = parseVillageEntryKey(saved)
        } else {
            this._syncVillageFromMap()
        }
        this._syncTriggerLabels()
    }

    _hide() {
        this.visible = false
        this._closePicker()
        this.panel.classList.add('hidden')
        this._clearResults()
        this.dropdown.classList.add('hidden')
    }

    _syncVillageFromMap() {
        const entry = detectVillageFromMapCenter(this.map)
        if (!entry) return

        this.selectedVillage = entry
        this.villageSelect.value = villageEntryKey(entry)
        this._syncTriggerLabels()
    }

    _flyToVillage(villageEntry) {
        if (!villageEntry?.village) return
        getVillageCenter(villageEntry.village, villageEntry.taluka).then(center => {
            if (!center) return
            this.map.flyTo({ center: [center.lon, center.lat], zoom: 14 })
        }).catch(() => {})
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
        queryCadastralPlotsByVillage(this.selectedVillage.village, this.selectedVillage.taluka, surveyRaw)
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

        if (this._isMobileLayout()) {
            if (this._isPickerOpen() && this._pickerMode === 'survey') {
                this._renderPickerPlotResults(features)
            }
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

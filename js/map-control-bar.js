export class MapControlBar {
    constructor() {
        this._el = null;
        this._iconEl = null;
        this._nameEl = null;
        this._countEl = null;
        this._iconKey = null;
        this._imageKey = null;
        this._main = null;
        this._trigger = null;
        this._observer = null;
        this._layers = null;
        this._onAtlasChanged = () => this.update(this._layers);
    }

    mount(hostEl, { triggerButton = null, onSummaryClick = null, onSummaryEnter = null, onSummaryLeave = null, onToggleHidden = null, searchEl = null } = {}) {
        this._trigger = triggerButton;
        this._el = document.createElement('div');
        this._el.className = 'map-control-bar';

        this._el.addEventListener('pointerenter', () => onSummaryEnter?.());
        this._el.addEventListener('pointerleave', () => onSummaryLeave?.());

        this._main = document.createElement('button');
        this._main.type = 'button';
        this._main.className = 'map-control-bar-main';
        this._main.title = 'Browse all maps';
        this._main.addEventListener('click', (e) => {
            e.stopPropagation();
            if (searchEl?.classList.contains('searching')) {
                searchEl.querySelector('.map-search-btn')?.click();
                return;
            }
            this._trigger?.click();
        });
        this._main.addEventListener('pointerenter', () => {
            this._trigger?.dispatchEvent(new Event('pointerenter'));
        }, { once: true });

        this._iconEl = document.createElement('span');
        this._iconEl.className = 'map-control-bar-icon';
        const iconWrap = document.createElement('span');
        iconWrap.className = 'map-control-bar-icon-wrap';
        const spinner = document.createElement('sl-spinner');
        spinner.className = 'map-control-bar-spinner';
        iconWrap.append(this._iconEl, spinner);

        const text = document.createElement('span');
        text.className = 'map-control-bar-text';
        this._nameEl = document.createElement('span');
        this._nameEl.className = 'map-control-bar-name';
        this._countEl = document.createElement('span');
        this._countEl.className = 'map-control-bar-count';
        this._mountSummary({ onSummaryClick, onSummaryEnter, onSummaryLeave, onToggleHidden });
        text.append(this._nameEl);
        const chevron = document.createElement('sl-icon');
        chevron.className = 'map-control-bar-chevron';
        chevron.name = 'chevron-down';
        this._main.append(iconWrap, text, chevron);

        const head = document.createElement('div');
        head.className = 'map-control-bar-head';
        head.append(this._main);
        if (searchEl) head.append(searchEl);
        this._el.append(head, this._countEl);
        hostEl.appendChild(this._el);
        hostEl.classList.add('has-map-control-bar');

        window.addEventListener('atlasChanged', this._onAtlasChanged);

        if (this._trigger) {
            const sync = () => this._el?.classList.toggle('active', this._trigger.classList.contains('active'));
            this._observer = new MutationObserver(sync);
            this._observer.observe(this._trigger, { attributes: true, attributeFilter: ['class'] });
            sync();
        }
    }

    setVisible(visible) {
        if (this._el) this._el.style.display = visible ? '' : 'none';
    }

    update(layers) {
        if (!this._el) return;
        this._layers = layers;
        this._syncClearMode();
        const registry = window.layerRegistry;
        const resolved = registry?._currentAtlasSet;
        const atlasId = resolved ? registry.getCurrentAtlas() : null;
        const metadata = atlasId ? registry.getAtlasMetadata(atlasId) : null;
        const name = metadata ? (metadata.name || atlasId) : '';

        this._nameEl.textContent = name || 'Loading Atlas';
        this._nameEl.classList.toggle('placeholder', !name);
        this._main.title = name ? `${name} - browse all maps` : 'Browse all maps';
        this._setIcon(metadata?.icon || null);
        this._setBackground(metadata?.headerImage || null);
    }

    _mountSummary({ onToggleHidden }) {
        this._mountHiddenToggle(onToggleHidden);
        this._clearBtn = this._createAction('', 'trash', '', () => this._onClearClick());
        this._clearIcon = this._clearBtn.querySelector('sl-icon');
        this._undoStack = [];
        this._undoTimer = null;
        this._undoActive = false;
        this._undoExpired = false;
        this._setClearMode('remove');
        this._countEl.append(
            this._createAction('Add Map', 'plus-lg', 'Create or import a map', () => window.browserControl?.openCreator()),
            this._hiddenEl,
            this._clearBtn
        );
    }

    _setClearMode(mode) {
        this._clearMode = mode;
        const undo = mode === 'undo';
        this._clearIcon.name = undo ? 'arrow-counterclockwise' : 'trash';
        const title = undo ? 'Restore removed maps' : 'Remove all maps (basemaps go once nothing else is left)';
        this._clearBtn.title = title;
        this._clearBtn.setAttribute('aria-label', title);
    }

    _armUndoTimer() {
        this._undoActive = true;
        clearTimeout(this._undoTimer);
        this._undoTimer = setTimeout(() => {
            this._undoStack = [];
            this._undoActive = false;
            this._undoExpired = true;
            this._syncClearMode();
        }, 5000);
    }

    _syncClearMode() {
        const empty = Array.isArray(this._layers) && this._layers.every(l => l.id === 'selection');
        if (!empty) this._undoExpired = false;
        this._setClearMode(this._undoActive || (empty && !this._undoExpired) ? 'undo' : 'remove');
    }

    _onClearClick() {
        const control = window.browserControl;
        if (!control) return;
        if (this._clearMode === 'undo') {
            const batch = this._undoStack.pop();
            if (batch) batch.forEach(layerId => control._handleLayerToggle(layerId, true));
            else control.restoreDefaultLayers();
            if (this._undoStack.length) this._armUndoTimer();
            else {
                clearTimeout(this._undoTimer);
                this._undoActive = false;
                this._undoExpired = false;
            }
            this._syncClearMode();
            return;
        }
        const { removed, exhausted } = control.hideAllLayers({ basemapsWhenEmpty: true });
        if (removed.length) this._undoStack.push(removed);
        if (exhausted && this._undoStack.length) this._armUndoTimer();
        this._setClearMode(exhausted ? 'undo' : 'remove');
    }

    _mountHiddenToggle(onToggleHidden) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'map-control-bar-hidden-toggle';
        toggle.hidden = true;
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            onToggleHidden?.(!this._hiddenShown);
        });
        this._hiddenEl = toggle;
        this._hiddenShown = false;
    }

    setHidden(count, shown) {
        if (!this._hiddenEl) return;
        this._hiddenShown = !!shown;
        this._hiddenEl.hidden = !count;
        this._hiddenEl.textContent = `${count} hidden`;
        this._hiddenEl.classList.toggle('active', !!shown);
        this._hiddenEl.title = shown ? 'Hide maps with no features in view' : 'Show maps with no features in view';
    }

    _createAction(text, iconName, title, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'map-control-bar-action';
        button.title = title;
        button.setAttribute('aria-label', title);
        const icon = document.createElement('sl-icon');
        icon.name = iconName;
        button.appendChild(icon);
        if (text) button.append(text);
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return button;
    }

    get el() {
        return this._el;
    }

    setSummaryActive(active, sticky = false) {
        this._countEl?.classList.toggle('sticky', !!active && sticky);
    }

    setMinWidth(px) {
        if (this._el) this._el.style.minWidth = px ? `${px}px` : '';
    }

    setLoading(loading) {
        this._el?.classList.toggle('loading', !!loading);
    }

    _setBackground(src) {
        if (src === this._imageKey) return;
        this._imageKey = src;
        if (src) this._el.style.setProperty('--bar-image', `url("${src.replace(/"/g, '%22')}")`);
        else this._el.style.removeProperty('--bar-image');
    }

    _setIcon(src) {
        if (src === this._iconKey) return;
        this._iconKey = src;
        this._iconEl.replaceChildren();
        if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            this._iconEl.appendChild(img);
        } else {
            this._iconEl.appendChild(document.createElement('sl-icon')).name = 'map';
        }
    }

    destroy() {
        window.removeEventListener('atlasChanged', this._onAtlasChanged);
        this._observer?.disconnect();
        clearTimeout(this._undoTimer);
        this._el?.parentNode?.classList.remove('has-map-control-bar');
        this._el?.remove();
        this._el = null;
    }
}

/**
 * ShareUrlPanel - the share-a-link UI that used to live inside
 * map-export.html's "Link" export type. It renders two views of the same
 * state:
 *
 *  - `buildInlineSection()` - a compact QR thumbnail plus the share URL and a
 *    copy button, appended to the map location menu
 *    (map-location-menu-control.js)
 *  - `openModal()` - a fullscreen, across-the-room-scannable QR with the full
 *    URL, a copy button, and the "Customize URL" parameter editor for trimming
 *    or tweaking parameters before sharing
 *
 * The URL is read from `window.location.href` - url-manager.js already keeps
 * that current (debounced) as the map moves - and re-read by `refresh()` while
 * the menu is open. Re-reading keeps each parameter's enabled/disabled state
 * but takes fresh values, so unchecking e.g. `layers` survives panning.
 */

const PARAM_ORDER = ['atlas', 'layers', 'lat', 'lng', 'zoom', 'bearing', 'pitch'];
const COPY_FEEDBACK_MS = 2000;

export class ShareUrlPanel {
    constructor() {
        this._sourceUrl = '';
        this._params = {};
        this._inline = null;
        this._modal = null;
        this._copyTimers = new Set();

        this._handleModalKeydown = this._handleModalKeydown.bind(this);
    }

    /**
     * Compact row for the location menu: QR thumbnail (opens the modal), the
     * share URL, and a copy button. `onOpenModal` lets the host close its menu
     * before the modal takes over the screen.
     */
    buildInlineSection({ onOpenModal } = {}) {
        this._syncFromLocation();

        const root = document.createElement('div');
        root.className = 'location-share';

        const qrButton = document.createElement('button');
        qrButton.type = 'button';
        qrButton.className = 'location-share-qr';
        qrButton.title = 'Show QR code fullscreen';
        qrButton.setAttribute('aria-label', 'Show QR code fullscreen');

        const qr = this._createQrElement(72);
        qrButton.appendChild(qr);
        qrButton.addEventListener('click', (e) => {
            e.stopPropagation();
            onOpenModal?.();
            this.openModal();
        });

        const main = document.createElement('div');
        main.className = 'location-share-main';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'location-share-url';
        input.readOnly = true;
        input.addEventListener('click', (e) => {
            e.stopPropagation();
            input.select();
        });

        const copyButton = this._createCopyButton('Copy link', 'location-share-copy');

        main.appendChild(input);
        main.appendChild(copyButton);
        root.appendChild(qrButton);
        root.appendChild(main);

        this._inline = { root, qr, input };
        this._updateViews();
        return root;
    }

    /** Re-reads the browser URL and updates whichever views are mounted. */
    refresh() {
        if (this._syncFromLocation()) this._updateViews();
    }

    openModal() {
        this.closeModal();
        this._syncFromLocation();

        const overlay = document.createElement('div');
        overlay.className = 'share-modal-overlay';

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'share-modal-close';
        closeButton.innerHTML = '&times;';
        closeButton.setAttribute('aria-label', 'Close');
        closeButton.addEventListener('click', () => this.closeModal());

        const content = document.createElement('div');
        content.className = 'share-modal-content';

        const qrWrap = document.createElement('div');
        qrWrap.className = 'share-modal-qr';
        const size = Math.max(200, Math.min(360, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.55)));
        const qr = this._createQrElement(size);
        qrWrap.appendChild(qr);

        const urlText = document.createElement('div');
        urlText.className = 'share-modal-url';

        const actions = document.createElement('div');
        actions.className = 'share-modal-actions';

        const copyButton = this._createCopyButton('Copy link', 'share-modal-btn');

        const customizeButton = document.createElement('button');
        customizeButton.type = 'button';
        customizeButton.className = 'share-modal-btn';
        customizeButton.innerHTML = '<sl-icon name="sliders"></sl-icon><span>Customize URL</span>';

        const params = document.createElement('div');
        params.className = 'share-modal-params';
        params.style.display = 'none';
        customizeButton.addEventListener('click', () => {
            const isOpen = params.style.display !== 'none';
            params.style.display = isOpen ? 'none' : 'flex';
            customizeButton.classList.toggle('is-active', !isOpen);
        });

        actions.appendChild(copyButton);
        actions.appendChild(customizeButton);
        content.appendChild(qrWrap);
        content.appendChild(urlText);
        content.appendChild(actions);
        content.appendChild(params);
        overlay.appendChild(closeButton);
        overlay.appendChild(content);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeModal();
        });

        document.body.appendChild(overlay);
        document.addEventListener('keydown', this._handleModalKeydown);

        this._modal = { overlay, qr, urlText, params };
        this._renderParamEditor();
        this._updateViews();
    }

    closeModal() {
        if (!this._modal) return;
        document.removeEventListener('keydown', this._handleModalKeydown);
        this._modal.overlay.parentNode?.removeChild(this._modal.overlay);
        this._modal = null;
    }

    destroy() {
        this.closeModal();
        this._copyTimers.forEach(timer => clearTimeout(timer));
        this._copyTimers.clear();
        this._inline?.root?.parentNode?.removeChild(this._inline.root);
        this._inline = null;
    }

    buildShareUrl() {
        try {
            const url = new URL(this._sourceUrl || window.location.href);
            const search = new URLSearchParams();
            for (const [key, data] of Object.entries(this._params)) {
                if (data.enabled && data.value) search.set(key, data.value);
            }
            url.search = search.toString();
            return url.toString();
        } catch (error) {
            console.debug('[ShareUrlPanel] Failed to build share URL:', error);
            return this._sourceUrl || window.location.href;
        }
    }

    _handleModalKeydown(e) {
        if (e.key === 'Escape') this.closeModal();
    }

    /**
     * Returns true when the browser URL changed since the last sync (and the
     * views therefore need updating).
     */
    _syncFromLocation() {
        const href = window.location.href;
        if (href === this._sourceUrl) return false;
        this._sourceUrl = href;

        const previous = this._params;
        this._params = {};

        try {
            const url = new URL(href);
            for (const [key, value] of url.searchParams.entries()) {
                this._params[key] = { value, enabled: previous[key]?.enabled ?? true };
            }
        } catch (error) {
            console.debug('[ShareUrlPanel] Failed to parse URL:', error);
        }

        if (this._modal) this._renderParamEditor();
        return true;
    }

    _updateViews() {
        const url = this.buildShareUrl();

        if (this._inline) {
            this._inline.input.value = url;
            this._inline.input.title = url;
            this._inline.qr.setAttribute('value', url);
        }

        if (this._modal) {
            this._modal.urlText.textContent = url;
            this._modal.qr.setAttribute('value', url);
        }
    }

    _createQrElement(size) {
        const qr = document.createElement('sl-qr-code');
        qr.setAttribute('size', String(size));
        qr.setAttribute('value', '');
        qr.setAttribute('label', 'Link to this map view');
        return qr;
    }

    _createCopyButton(label, className) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.innerHTML = `<sl-icon name="clipboard"></sl-icon><span>${label}</span>`;
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this._copy(button, label);
        });
        return button;
    }

    async _copy(button, label) {
        const url = this.buildShareUrl();

        try {
            await navigator.clipboard.writeText(url);
        } catch (error) {
            console.debug('[ShareUrlPanel] Clipboard write failed:', error);
            this._inline?.input?.select();
            return;
        }

        button.classList.add('is-copied');
        button.innerHTML = '<sl-icon name="check-circle"></sl-icon><span>Copied!</span>';

        const timer = setTimeout(() => {
            this._copyTimers.delete(timer);
            if (!button.isConnected) return;
            button.classList.remove('is-copied');
            button.innerHTML = `<sl-icon name="clipboard"></sl-icon><span>${label}</span>`;
        }, COPY_FEEDBACK_MS);
        this._copyTimers.add(timer);
    }

    /**
     * One row per URL parameter: a checkbox to include it in the shared link
     * and an editable value. Known parameters lead in a readable order, the
     * rest follow in whatever order the URL had them.
     */
    _renderParamEditor() {
        if (!this._modal) return;
        const container = this._modal.params;
        container.innerHTML = '';

        const keys = [
            ...PARAM_ORDER.filter(key => this._params[key]),
            ...Object.keys(this._params).filter(key => !PARAM_ORDER.includes(key))
        ];

        if (!keys.length) {
            const empty = document.createElement('div');
            empty.className = 'share-modal-params-empty';
            empty.textContent = 'This link has no parameters to customize.';
            container.appendChild(empty);
            return;
        }

        keys.forEach(key => {
            const data = this._params[key];

            const row = document.createElement('div');
            row.className = 'share-modal-param-row';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = data.enabled;
            checkbox.setAttribute('aria-label', `Include ${key}`);

            const label = document.createElement('div');
            label.className = 'share-modal-param-label';
            label.textContent = key;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'share-modal-param-input';
            input.value = data.value;
            input.disabled = !data.enabled;

            checkbox.addEventListener('change', () => {
                data.enabled = checkbox.checked;
                input.disabled = !checkbox.checked;
                this._updateViews();
            });

            input.addEventListener('input', () => {
                data.value = input.value;
                this._updateViews();
            });

            row.appendChild(checkbox);
            row.appendChild(label);
            row.appendChild(input);
            container.appendChild(row);
        });
    }
}

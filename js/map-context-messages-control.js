/**
 * MapContextMessagesControl - Shows dismissible contextual message bars above the
 * attribution control at the bottom of the map.
 *
 * Other modules never need to hold a reference to the control instance - messages
 * are shown/closed by dispatching window CustomEvents (or via the static
 * show()/close() helpers below, which just wrap those events).
 *
 * Messages auto-close after DEFAULT_DURATION_MS unless a caller passes a longer
 * `duration`, or `duration: 0` to keep one up until explicitly closed (e.g. a
 * suggestion the user should be able to act on whenever they notice it).
 * Re-showing the same `id` (to update its text, e.g. swapping "Loading..." for
 * "Added...") restarts its timer rather than stacking a second one.
 *
 * Usage:
 * ```js
 * const id = MapContextMessagesControl.show('Loading map "Roads"');
 * // ...later
 * MapContextMessagesControl.close(id);
 * ```
 */
const SHOW_EVENT = 'map-context-message:show';
const CLOSE_EVENT = 'map-context-message:close';

let messageCounter = 0;
function generateMessageId() {
    messageCounter += 1;
    return `map-context-message-${Date.now()}-${messageCounter}`;
}

export class MapContextMessagesControl {
    static DEFAULT_DURATION_MS = 5000;

    constructor() {
        this._map = null;
        this._container = null;
        this._messages = new Map();
        this._timers = new Map();
        this._resizeObserver = null;

        this._handleShow = this._handleShow.bind(this);
        this._handleClose = this._handleClose.bind(this);
    }

    /**
     * Dispatch a message to any mounted MapContextMessagesControl.
     * @param {string} html - HTML content to render for the message
     * @param {{id?: string, duration?: number}} [options] - `duration` in ms
     *   (default DEFAULT_DURATION_MS); pass 0 to keep the message up until it's
     *   explicitly closed.
     * @returns {string} the message id, usable with close()
     */
    static show(html, options = {}) {
        const id = options.id || generateMessageId();
        const duration = options.duration === undefined
            ? MapContextMessagesControl.DEFAULT_DURATION_MS
            : options.duration;
        window.dispatchEvent(new CustomEvent(SHOW_EVENT, { detail: { id, html, duration } }));
        return id;
    }

    /**
     * Close a previously shown message by id.
     * @param {string} id
     */
    static close(id) {
        if (!id) return;
        window.dispatchEvent(new CustomEvent(CLOSE_EVENT, { detail: { id } }));
    }

    onAdd(map) {
        this._map = map;

        this._container = document.createElement('div');
        this._container.className = 'map-context-messages';

        window.addEventListener(SHOW_EVENT, this._handleShow);
        window.addEventListener(CLOSE_EVENT, this._handleClose);

        map.getContainer().appendChild(this._container);
        this._observeAttribution();

        return this._container;
    }

    onRemove() {
        window.removeEventListener(SHOW_EVENT, this._handleShow);
        window.removeEventListener(CLOSE_EVENT, this._handleClose);
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._container?.parentNode?.removeChild(this._container);
        this._container = null;
        this._messages.clear();
        this._timers.forEach(timer => clearTimeout(timer));
        this._timers.clear();
        this._map = null;
    }

    // Keeps the message stack's bottom offset in sync with the attribution
    // control's height, since it can wrap to two lines on narrow screens.
    _observeAttribution() {
        const attribEl = this._map.getContainer().querySelector('.mapboxgl-ctrl-bottom-right');
        if (!attribEl || typeof ResizeObserver === 'undefined') return;

        const update = () => {
            const height = attribEl.getBoundingClientRect().height;
            this._container.style.bottom = `${height + 8}px`;
        };

        this._resizeObserver = new ResizeObserver(update);
        this._resizeObserver.observe(attribEl);
        update();
    }

    _handleShow(event) {
        const { id, html, duration } = event.detail || {};
        if (!html) return;
        const messageId = id || generateMessageId();

        const existing = this._messages.get(messageId);
        if (existing) {
            existing.querySelector('.map-context-message__body').innerHTML = html;
            this._scheduleAutoClose(messageId, duration);
            return;
        }

        const el = document.createElement('div');
        el.className = 'map-context-message';
        el.dataset.messageId = messageId;

        const body = document.createElement('div');
        body.className = 'map-context-message__body';
        body.innerHTML = html;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'map-context-message__close';
        closeBtn.setAttribute('aria-label', 'Dismiss message');
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', () => this._close(messageId));

        el.appendChild(body);
        el.appendChild(closeBtn);

        this._messages.set(messageId, el);
        this._container.appendChild(el);
        this._scheduleAutoClose(messageId, duration);
    }

    // (Re)schedules a message's auto-close, replacing any timer already running
    // for that id. `duration` falsy-but-defined-as-0 (or negative) means "keep
    // open until explicitly closed".
    _scheduleAutoClose(id, duration) {
        const existingTimer = this._timers.get(id);
        if (existingTimer) clearTimeout(existingTimer);
        this._timers.delete(id);

        if (!duration || duration <= 0) return;

        const timer = setTimeout(() => this._close(id), duration);
        this._timers.set(id, timer);
    }

    _handleClose(event) {
        const { id } = event.detail || {};
        if (id) this._close(id);
    }

    _close(id) {
        const timer = this._timers.get(id);
        if (timer) clearTimeout(timer);
        this._timers.delete(id);

        const el = this._messages.get(id);
        if (!el) return;
        this._messages.delete(id);

        el.classList.add('map-context-message--closing');
        const remove = () => el.remove();
        el.addEventListener('transitionend', remove, { once: true });
        setTimeout(remove, 300);
    }
}

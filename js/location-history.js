/**
 * The place menu's Map History section (js/map-location-menu-control.js): back /
 * forward through the steps js/map-history.js records, and the recent steps
 * around the current one to jump to directly. Collapsed by default; whether
 * it is open is remembered per browser.
 */
const LIST_SIZE = 6;
const OPEN_KEY = 'amche_place_history_open';
const ICONS = { view: 'geo-alt', layers: 'layers', settings: 'sliders' };

function layerTitle(id) {
    return window.layerRegistry?.getLayer?.(id, null, true)?.title || id;
}

function names(ids) {
    const titles = ids.map(layerTitle);
    return titles.length > 2 ? `${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more` : titles.join(', ');
}

export function stepLabel(step, isFirst) {
    if (isFirst) return step.place ? `Opened at ${step.place}` : 'Opened the map';
    if (step.kind === 'layers') {
        return [step.added?.length ? `Added ${names(step.added)}` : '', step.removed?.length ? `Removed ${names(step.removed)}` : '']
            .filter(Boolean).join(' · ');
    }
    if (step.kind === 'settings') return 'Changed pins or map settings';
    return step.place ? `Moved to ${step.place}` : 'Moved the map';
}

export function timeAgo(at, now = Date.now()) {
    const minutes = Math.floor((now - at) / 60000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes} min`;
    return `${Math.round(minutes / 60)} h`;
}

function navButton(icon, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-history-nav';
    button.title = label;
    button.setAttribute('aria-label', label);
    const iconEl = document.createElement('sl-icon');
    iconEl.setAttribute('name', icon);
    button.appendChild(iconEl);
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return button;
}

function isOpen() {
    try { return localStorage.getItem(OPEN_KEY) === '1'; } catch (error) { return false; }
}

function rememberOpen(open) {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (error) { /* storage unavailable */ }
}

/**
 * @param {HTMLElement} section - the menu section to fill; gets `is-collapsed`
 * @returns {{destroy: Function}}
 */
export function buildHistorySection(history, section) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'place-label place-label-toggle';
    const title = document.createElement('span');
    title.textContent = 'Map History';
    const summary = document.createElement('span');
    summary.className = 'place-label-side';
    const chevron = document.createElement('sl-icon');
    chevron.className = 'place-label-chevron';
    chevron.setAttribute('name', 'chevron-down');
    toggle.append(title, summary, chevron);

    const el = document.createElement('div');
    el.className = 'place-history';

    const setOpen = (open) => {
        section.classList.toggle('is-collapsed', !open);
        toggle.setAttribute('aria-expanded', String(open));
        el.hidden = !open;
    };
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = section.classList.contains('is-collapsed');
        rememberOpen(open);
        setOpen(open);
    });
    section.append(toggle, el);
    setOpen(isOpen());

    const render = () => {
        const { steps, index } = history;
        summary.textContent = steps.length > 1 ? `Step ${index + 1} of ${steps.length}` : '';
        el.replaceChildren();

        const bar = document.createElement('div');
        bar.className = 'place-history-bar';
        const back = navButton('arrow-counterclockwise', 'Undo: back one step', () => history.back());
        const forward = navButton('arrow-clockwise', 'Redo: forward one step', () => history.forward());
        back.disabled = !history.canBack();
        forward.disabled = !history.canForward();
        const count = document.createElement('span');
        count.className = 'place-history-count';
        count.textContent = steps.length ? `Step ${index + 1} of ${steps.length}` : 'No steps yet';
        bar.append(back, count, forward);
        el.appendChild(bar);

        const end = Math.min(steps.length, Math.max(index + 1 + Math.floor(LIST_SIZE / 2), LIST_SIZE));
        const start = Math.max(0, end - LIST_SIZE);
        const list = document.createElement('ol');
        list.className = 'place-history-list';
        for (let i = end - 1; i >= start; i--) {
            const step = steps[i];
            const item = document.createElement('li');
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'place-history-step' + (i === index ? ' current' : '') + (i > index ? ' undone' : '');
            if (i === index) row.setAttribute('aria-current', 'step');
            const icon = document.createElement('sl-icon');
            icon.setAttribute('name', i === 0 ? 'house' : ICONS[step.kind] || 'geo-alt');
            const label = document.createElement('span');
            label.className = 'place-history-label';
            label.textContent = stepLabel(step, i === 0);
            const time = document.createElement('span');
            time.className = 'place-history-time';
            time.textContent = timeAgo(step.at);
            row.append(icon, label, time);
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                history.go(i);
            });
            item.appendChild(row);
            list.appendChild(item);
        }
        if (steps.length) el.appendChild(list);
    };

    const unsubscribe = history.onChange(render);
    render();
    return { destroy: unsubscribe };
}

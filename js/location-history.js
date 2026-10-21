/**
 * The Share panel's History tab (js/share-view-panel.js): undo / redo through
 * the steps js/map-history.js records, and the recent steps around the
 * current one to jump to directly.
 */
const LIST_SIZE = 6;
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

// The keyboard shortcut as the platform writes it (js/keyboard-controller.js)
const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Cmd' : 'Ctrl';

function navButton(icon, text, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-history-nav';
    button.title = label;
    button.setAttribute('aria-label', label);
    const iconEl = document.createElement('sl-icon');
    iconEl.setAttribute('name', icon);
    const textEl = document.createElement('span');
    textEl.textContent = text;
    button.append(iconEl, textEl);
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return button;
}

/**
 * Fills `host` with undo / redo (redo only while there is a step to go
 * forward to) around the step count, then the recent steps, newest first.
 * @returns {{destroy: Function}}
 */
export function buildHistoryControls(history, host) {
    const back = navButton('arrow-counterclockwise', `Undo (${MOD}+Z)`, 'Undo: back one step', () => history.back());
    const forward = navButton('arrow-clockwise', `Redo (${MOD}+Shift+Z)`, 'Redo: forward one step', () => history.forward());
    const count = document.createElement('span');
    count.className = 'place-history-count';
    const bar = document.createElement('div');
    bar.className = 'place-history-bar';
    bar.append(back, count, forward);

    const render = () => {
        const { steps, index } = history;
        back.disabled = !history.canBack();
        forward.hidden = !history.canForward();
        count.textContent = steps.length ? `${index + 1} / ${steps.length}` : '0 / 0';
        count.title = steps.length ? `Step ${index + 1} of ${steps.length}` : 'No steps yet';
        host.replaceChildren(bar);

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
        if (steps.length) host.appendChild(list);
    };

    const unsubscribe = history.onChange(render);
    render();
    return { destroy: unsubscribe };
}

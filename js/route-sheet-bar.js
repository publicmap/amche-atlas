/**
 * The sync bar over a sheet-backed route layer's legend (js/route-legend.js):
 * where its routes come from and when they were read, what Save would write
 * (routes changed or added, stops added, routes deleted), Refresh and Save,
 * and - in conflict mode - each conflicted row with Insert as new or Discard
 * (js/route-sheet-layer.js). Nothing is written to the sheet without Save.
 */
import { routeHost } from './console/route-actions.js';

function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
}

function action(label, iconName, onClick, { primary = false, disabled = false, title = '' } = {}) {
    const button = node('button', 'route-sheet-btn' + (primary ? ' primary' : ''));
    button.type = 'button';
    button.disabled = disabled;
    if (title) button.title = title;
    const glyph = document.createElement('sl-icon');
    glyph.name = iconName;
    button.append(glyph, node('span', '', label));
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return button;
}

function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function summary(pending) {
    const parts = [];
    if (pending.routes.length) parts.push(plural(pending.routes.length, 'route') + ' changed');
    if (pending.locations.length) parts.push(plural(pending.locations.length, 'location') + ' to save');
    if (pending.deleted.length) parts.push(plural(pending.deleted.length, 'route') + ' deleted');
    return parts.join(', ');
}

function conflictRow(sheets, groupId, conflict, busy) {
    const item = node('div', 'route-sheet-conflict');
    const what = conflict.table === 'routes' ? `Route ${conflict.id}` : `Stop ${conflict.id}`;
    const why = { changed: 'was changed in the sheet', deleted: 'was deleted in the sheet', exists: 'was added in the sheet too' }[conflict.reason] || 'changed in the sheet';
    item.appendChild(node('div', 'route-sheet-conflict-text', `${what} ${why}`));
    const buttons = node('div', 'route-sheet-actions');
    if (conflict.local) buttons.appendChild(action('Insert as new', 'plus-square', () => sheets.resolve(groupId, conflict, 'insert'), { disabled: !!busy, title: 'Keep your version as a new row; the sheet’s row stays as it is' }));
    buttons.appendChild(action('Discard mine', 'x-square', () => sheets.resolve(groupId, conflict, 'discard'), { disabled: !!busy, title: 'Drop your version and take the sheet’s' }));
    item.appendChild(buttons);
    return item;
}

export function routeSheetBar(groupId) {
    const host = routeHost();
    const sheets = host?.routeSheets;
    if (!sheets?.owns(groupId)) return null;
    const bar = node('div', 'route-sheet-bar');
    const render = () => {
        if (!bar.isConnected && bar.dataset.mounted) {
            host.removeEventListener('route-sheet-changed', onChange);
            host.removeEventListener('routes-changed', onChange);
            return;
        }
        const state = sheets.state(groupId);
        if (!state) return;
        const conflicted = state.conflicts.length > 0;
        const changes = summary(state.pending);
        const head = node('div', 'route-sheet-head');
        const glyph = document.createElement('sl-icon');
        glyph.name = 'table';
        const when = state.loadedAt ? `read ${state.loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
        head.append(glyph, node('span', 'route-sheet-title', 'Google Sheet'), node('span', 'route-sheet-when', state.readOnly ? `${when} · read only` : when));
        const status = node('div', 'route-sheet-status' + (state.error ? ' error' : ''), state.busy || state.error || changes || 'No unsaved changes');
        const buttons = node('div', 'route-sheet-actions');
        buttons.appendChild(action('Refresh', 'arrow-clockwise', () => {
            if (!changes || window.confirm('Refreshing discards your unsaved changes. Refresh anyway?')) sheets.refresh(groupId);
        }, { disabled: !!state.busy, title: 'Read the sheet again' }));
        if (!state.readOnly) {
            buttons.appendChild(action('Save', 'cloud-upload', () => sheets.save(groupId), {
                primary: true,
                disabled: !!state.busy || !changes || conflicted,
                title: conflicted ? 'Settle the conflicts first' : 'Write your changes to the sheet (it is checked for newer changes first)'
            }));
        }
        bar.classList.toggle('in-conflict', conflicted);
        bar.replaceChildren(head, status, buttons, ...state.conflicts.map(c => conflictRow(sheets, groupId, c, state.busy)));
        if (state.message && !state.error) bar.appendChild(node('div', 'route-sheet-note', state.message));
    };
    const onChange = (e) => {
        if (e.type === 'route-sheet-changed' && e.detail?.groupId !== groupId) return;
        render();
    };
    host.addEventListener('route-sheet-changed', onChange);
    host.addEventListener('routes-changed', onChange);
    render();
    bar.dataset.mounted = '1';
    return bar;
}

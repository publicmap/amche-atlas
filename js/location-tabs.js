/**
 * Tabs inside a place menu section (js/map-location-menu-control.js): a tab
 * strip, then one panel per tab with only the selected one shown.
 *
 * @param {HTMLElement} section - where the strip and panels go
 * @param {Array<{id: string, label: string, icon?: string}>} tabs
 * @param {string} selected - the id of the tab shown first
 * @param {(id: string) => void} [onSelect]
 * @param {HTMLElement} [stripHost] - where the strip goes instead, e.g. the section's label
 * @returns {Object<string, HTMLElement>} each tab's panel, by id
 */
export function buildTabs(section, tabs, selected, onSelect = () => {}, stripHost = section) {
    const strip = document.createElement('div');
    strip.className = 'place-tabs';
    strip.setAttribute('role', 'tablist');
    const buttons = [];
    const panels = {};

    const select = (id, focus = false) => {
        buttons.forEach(button => {
            const on = button.dataset.tab === id;
            button.setAttribute('aria-selected', String(on));
            button.tabIndex = on ? 0 : -1;
            panels[button.dataset.tab].hidden = !on;
            if (on && focus) button.focus();
        });
    };

    tabs.forEach(({ id, label, icon }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'place-tab';
        button.id = `place-tab-${id}`;
        button.dataset.tab = id;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', `place-tabpanel-${id}`);
        if (icon) {
            const iconEl = document.createElement('sl-icon');
            iconEl.className = 'place-tab-icon';
            iconEl.setAttribute('name', icon);
            button.appendChild(iconEl);
        }
        const text = document.createElement('span');
        text.className = 'place-tab-text';
        text.textContent = label;
        button.appendChild(text);
        button.addEventListener('click', () => {
            select(id);
            onSelect(id);
        });
        button.addEventListener('keydown', (e) => {
            const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
            if (!step) return;
            e.preventDefault();
            const next = tabs[(tabs.findIndex(tab => tab.id === id) + step + tabs.length) % tabs.length].id;
            select(next, true);
            onSelect(next);
        });
        buttons.push(button);
        strip.appendChild(button);

        const panel = document.createElement('div');
        panel.className = 'place-tabpanel';
        panel.id = `place-tabpanel-${id}`;
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', button.id);
        panels[id] = panel;
    });

    stripHost.appendChild(strip);
    Object.values(panels).forEach(panel => section.appendChild(panel));
    select(tabs.some(tab => tab.id === selected) ? selected : tabs[0].id);
    return panels;
}

/**
 * A close button at the end of a menu's tab strip, so the menu shows how to
 * close it rather than relying on its trigger being clicked again.
 *
 * @param {HTMLElement} host - the row holding the tab strip
 * @param {() => void} onClose
 */
export function addCloseButton(host, onClose) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-close';
    button.title = 'Close ( Esc )';
    button.setAttribute('aria-label', 'Close');
    const icon = document.createElement('sl-icon');
    icon.setAttribute('name', 'x-lg');
    button.appendChild(icon);
    button.addEventListener('click', onClose);
    host.appendChild(button);
    return button;
}

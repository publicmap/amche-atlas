// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { MapMarkerManager } = await import('../map-marker-manager.js');

/**
 * The popup builders and their handlers only touch `this._isTouch`, the layer
 * config lookup, and the active-layer order - so exercise them on a bare
 * prototype instance rather than standing up a whole map.
 */
/** Focus the marker, then click the label again - the two-step the design asks for. */
function openEditor(el) {
    const badge = el.querySelector('.marker-id-badge');
    badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));   // focuses
    badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));   // edits
}

function makeManager({ isTouch = false, layers = [] } = {}) {
    const manager = Object.create(MapMarkerManager.prototype);
    manager._isTouch = isTouch;
    manager._markers = new Map();
    manager._selectedBadges = new Set();
    manager._stateManager = {
        getLayerConfig: (id) => layers.find(l => l.id === id) || null
    };
    manager._getAllActiveLayersInInspectorOrder = () => layers;
    manager._stateManager._suppressClickUntil = 0;
    return manager;
}

function feature(layerId, props) {
    return { layerId, featureId: `${layerId}-1`, feature: { properties: props } };
}

const LNG_LAT = { lng: 73.8187, lat: 15.54845 };

describe('marker popup layout', () => {
    let host;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
    });

    describe('id label at the clicked point', () => {
        it('renders the id as a badge at 16px, non-bold, with the input hidden', () => {
            const manager = makeManager();
            host.innerHTML = manager._buildMarkerIdRowHTML('Assagao_Survey_17_1');

            const badge = host.querySelector('.marker-id-badge');
            expect(badge.querySelector('.marker-id-text').textContent).toBe('Assagao_Survey_17_1');
            expect(badge.hidden).toBe(false);
            expect(badge.style.fontSize).toBe('16px');
            expect(badge.style.fontWeight).toBe('400');

            expect(host.querySelector('.marker-id-input').hidden).toBe(true);
            expect(host.querySelector('.marker-id-actions').style.display).toBe('none');
            expect(host.querySelector('.marker-id-remove sl-icon').getAttribute('name')).toBe('trash3');
            expect(host.querySelector('.marker-id-collapse sl-icon').getAttribute('name')).toBe('x-circle');
            // The "more layers" summary is gone; its shortcuts menu moved here.
            expect(host.querySelector('.marker-id-shortcuts sl-icon').getAttribute('name')).toBe('three-dots-vertical');
            expect(host.querySelector('.marker-id-pencil').getAttribute('name')).toBe('pencil-square');
        });

        it('points at the clicked point with a tail, not a pin', () => {
            const manager = makeManager();
            host.innerHTML = manager._buildMarkerTailHTML();

            const tail = host.querySelector('.marker-tail');
            // Anchored to the element's top-left corner, which is the clicked point.
            expect(tail.style.top).toBe('0px');
            expect(tail.style.left).toBe('0px');
            // Tip on that corner, base along the label's top edge.
            expect(tail.querySelector('polygon').getAttribute('points')).toBe('0,0 0,16 16,16');
        });

        it('renders the trash action in red', () => {
            const manager = makeManager();
            host.innerHTML = manager._buildMarkerIdRowHTML('1');
            const icon = host.querySelector('.marker-id-remove sl-icon');
            expect(icon.style.color).toBe('rgb(239, 68, 68)');
        });
    });

    describe('summary chips', () => {
        it('renders one chip per selected feature, in inspector order', () => {
            const layers = [{ id: 'plots' }, { id: 'wards' }];
            const manager = makeManager({ layers });
            // Passed in reverse of the inspector order to prove it re-sorts.
            const features = [feature('wards', { id: 'Ward 4' }), feature('plots', { id: '17/1' })];

            host.innerHTML = manager._buildMarkerSummaryHTML(features, LNG_LAT);
            const chips = [...host.querySelectorAll('.marker-summary-chip')];

            expect(chips.map(c => c.querySelector('.marker-summary-chip__value').textContent)).toEqual(['17/1', 'Ward 4']);
            // The index still points back into the original features array.
            expect(chips.map(c => c.dataset.badgeIndex)).toEqual(['1', '0']);
        });

        it('stacks the badges vertically', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }, { id: 'wards' }] });
            const features = [feature('plots', { id: '17/1' }), feature('wards', { id: 'Ward 4' })];

            host.innerHTML = manager._buildMarkerSummaryHTML(features, LNG_LAT);
            const row = host.querySelector('.marker-summary-row');

            expect(row.style.flexDirection).toBe('column');
            expect(host.querySelector('.marker-summary-chip').style.width).toBe('100%');
        });

        it('falls back to a single address chip when nothing is selected', () => {
            const manager = makeManager();
            host.innerHTML = manager._buildMarkerSummaryHTML([], LNG_LAT);

            const chips = host.querySelectorAll('.marker-summary-chip');
            expect(chips).toHaveLength(1);
            expect(chips[0].classList.contains('marker-summary-chip--address')).toBe(true);
            // Coordinates stand in until the reverse geocode lands.
            expect(chips[0].querySelector('.marker-summary-chip__value').textContent).toBe('15.5485, 73.8187');
        });

        it('rewrites the address chip once the geocode returns', () => {
            const manager = makeManager();
            const el = document.createElement('div');
            el.innerHTML = `
                <div class="address-badge" style="display:none"><span class="address-badge-value"></span></div>
                ${manager._buildMarkerSummaryHTML([], LNG_LAT)}
            `;

            manager._renderMarkerAddress({
                marker: { getElement: () => el },
                address: { text: 'Assagao, Bardez, Goa' }
            });

            expect(el.querySelector('.marker-summary-chip--address').querySelector('.marker-summary-chip__value').textContent)
                .toBe('Assagao, Bardez, Goa');
        });
    });

    describe('chip -> feature flyout', () => {
        function mount(manager, features) {
            const el = document.createElement('div');
            el.innerHTML = `
                <div class="marker-content" style="display:flex">
                    ${manager._buildMarkerSummaryHTML(features, LNG_LAT)}
                    ${manager._buildFeatureFlyoutHTML()}
                </div>
            `;
            host.appendChild(el);
            manager._markers.set('m1', { id: 'm1', urlId: '1', lngLat: LNG_LAT, marker: { getElement: () => el } });
            manager._stateManager.setFeatureHoverState = vi.fn();
            manager._loadInspectionHandlerHTML = vi.fn();
            manager._attachLayerActionsMenuHandlers = vi.fn();
            manager._fillAddressDetails = vi.fn();
            manager._buildFeatureFlyoutContentHTML = vi.fn((f) => ({
                header: `<div class="marker-flyout-drag-handle">${f.layerId}</div>`,
                body: `<div class="feature-badge-details">${f.feature.properties.id}</div>`
            }));
            manager._attachMarkerSummaryHandlers(el, features, LNG_LAT);
            return el;
        }

        it('opens one feature\'s table to the right on hover', () => {
            const layers = [{ id: 'plots' }, { id: 'wards' }];
            const manager = makeManager({ layers });
            const features = [feature('plots', { id: '17/1' }), feature('wards', { id: 'Ward 4' })];
            const el = mount(manager, features);

            el.querySelectorAll('.marker-summary-chip')[1].dispatchEvent(new Event('mouseenter'));

            const flyout = el.querySelector('.marker-feature-flyout');
            expect(flyout.style.display).toBe('block');
            // Positioned beside the badge stack, not stacked inside it.
            expect(flyout.style.left).toBe('100%');
            // Just that one feature's table, not every selected feature's.
            expect(manager._buildFeatureFlyoutContentHTML).toHaveBeenCalledTimes(1);
            expect(flyout.querySelector('.feature-badge-details').textContent).toBe('Ward 4');
        });

        it('swaps the flyout to the other feature rather than stacking both', () => {
            const layers = [{ id: 'plots' }, { id: 'wards' }];
            const manager = makeManager({ layers });
            const features = [feature('plots', { id: '17/1' }), feature('wards', { id: 'Ward 4' })];
            const el = mount(manager, features);
            const chips = el.querySelectorAll('.marker-summary-chip');

            chips[0].dispatchEvent(new Event('mouseenter'));
            chips[1].dispatchEvent(new Event('mouseenter'));

            const tables = el.querySelectorAll('.feature-badge-details');
            expect(tables).toHaveLength(1);
            expect(tables[0].textContent).toBe('Ward 4');
        });

        it('leads the table with the layer as a draggable header', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const features = [feature('plots', { id: '17/1' })];
            const el = mount(manager, features);

            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            const flyout = el.querySelector('.marker-feature-flyout');
            const header = flyout.querySelector('.marker-feature-flyout__header .marker-flyout-drag-handle');
            expect(header).not.toBeNull();
            // The header precedes the fields in the DOM - it is a header, not a footer.
            expect(header.compareDocumentPosition(flyout.querySelector('.feature-badge-details')))
                .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        });

        it('marks the active chip and stays open when the pointer leaves it', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const features = [feature('plots', { id: '17/1' })];
            const el = mount(manager, features);
            const chip = el.querySelector('.marker-summary-chip');

            chip.dispatchEvent(new Event('mouseenter'));
            expect(chip.style.borderColor).toBe('rgb(59, 130, 246)');

            chip.dispatchEvent(new Event('mouseleave'));
            expect(el.querySelector('.marker-feature-flyout').style.display).toBe('block');
        });

        it('repositions the flyout by dragging its layer header', async () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const features = [feature('plots', { id: '17/1' })];
            const el = mount(manager, features);
            el.querySelector('.marker-summary-chip').dispatchEvent(new Event('mouseenter'));

            const flyout = el.querySelector('.marker-feature-flyout');
            const handle = flyout.querySelector('.marker-flyout-drag-handle');

            handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
            // The map sits the drag out rather than running its hover query on
            // every move underneath it - that is what made this crawl.
            expect(manager._stateManager._isDraggingMarkerPanel).toBe(true);

            window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 130 }));
            // Painted once per frame, not once per move event.
            expect(flyout.style.transform).toBe('');
            await new Promise(requestAnimationFrame);
            expect(flyout.style.transform).toBe('translate3d(40px, 30px, 0)');

            window.dispatchEvent(new MouseEvent('mouseup', { clientX: 140, clientY: 130 }));
            expect(manager._stateManager._isDraggingMarkerPanel).toBe(false);
        });

        it('coalesces a burst of moves into a single paint', async () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            el.querySelector('.marker-summary-chip').dispatchEvent(new Event('mouseenter'));

            const flyout = el.querySelector('.marker-feature-flyout');
            flyout.querySelector('.marker-flyout-drag-handle')
                .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }));

            for (let i = 1; i <= 20; i++) {
                window.dispatchEvent(new MouseEvent('mousemove', { clientX: i, clientY: i }));
            }
            await new Promise(requestAnimationFrame);

            // Only the latest position, not twenty intermediate ones.
            expect(flyout.style.transform).toBe('translate3d(20px, 20px, 0)');
            window.dispatchEvent(new MouseEvent('mouseup', { clientX: 20, clientY: 20 }));
        });

        it('shows the reverse-geocoded address for the address chip', () => {
            const manager = makeManager();
            const el = mount(manager, []);

            el.querySelector('.marker-summary-chip--address').dispatchEvent(new Event('mouseenter'));

            expect(el.querySelector('.marker-feature-flyout').style.display).toBe('block');
            expect(manager._fillAddressDetails).toHaveBeenCalled();
        });
    });

    describe('click-to-edit id', () => {
        function mountIdRow(manager, markerId = 'm1', urlId = '1') {
            const el = document.createElement('div');
            el.innerHTML = `
                <div class="marker-action-row">${manager._buildMarkerIdRowHTML(urlId)}</div>
                <div class="marker-content" style="display:flex"></div>
            `;
            host.appendChild(el);
            manager._markers.set(markerId, { id: markerId, urlId, lngLat: LNG_LAT, marker: { getElement: () => el } });
            manager.removeMarker = vi.fn();
            manager._attachMarkerIdRowHandlers(el, markerId);
            return el;
        }

        // jsdom does not lay out, so `hidden` reads true there even when an
        // inline `display` would beat the UA's `[hidden] { display: none }` and
        // leave badge and input rendering side by side in a real browser.
        it('declares no inline display on either label, so `hidden` actually hides', () => {
            const manager = makeManager();
            host.innerHTML = manager._buildMarkerIdRowHTML('home');

            // The badge does declare `display: flex` (it lays out the text and
            // pencil), so it is toggled by display, not by [hidden].
            expect(host.querySelector('.marker-id-input').style.display).toBe('');
        });

        it('needs two clicks: the first focuses, the second opens the editor', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const badge = el.querySelector('.marker-id-badge');
            const input = el.querySelector('.marker-id-input');

            // A marker is selected the moment it is created, so a fresh one must
            // still take a deliberate click on the label before it can be renamed.
            manager._selectMarker('m1');
            badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(input.hidden).toBe(true);

            badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(input.hidden).toBe(false);
        });

        it('re-arms the two-step once the marker loses focus', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const other = document.createElement('div');
            manager._markers.set('m2', { id: 'm2', urlId: '2', lngLat: LNG_LAT, marker: { getElement: () => other } });

            el.querySelector('.marker-id-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            manager._selectMarker('m2');   // focus moves away

            el.querySelector('.marker-id-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(el.querySelector('.marker-id-input').hidden).toBe(true);
        });

        it('swaps the badge for a focused input on click', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const badge = el.querySelector('.marker-id-badge');
            const input = el.querySelector('.marker-id-input');

            openEditor(el);

            expect(badge.style.display).toBe('none');
            expect(input.hidden).toBe(false);
            expect(input.value).toBe('home');
            expect(document.activeElement).toBe(input);
        });

        it('selects the existing id so typing replaces it', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');
            const select = vi.spyOn(input, 'select');

            openEditor(el);

            expect(select).toHaveBeenCalled();
        });

        it('shows the save button only while editing', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const saveBtn = el.querySelector('.marker-id-save');
            expect(saveBtn.querySelector('sl-icon').getAttribute('name')).toBe('check-circle');
            expect(saveBtn.style.display).toBe('none');

            openEditor(el);
            expect(saveBtn.style.display).toBe('flex');

            el.querySelector('.marker-id-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(saveBtn.style.display).toBe('none');
        });

        it('saves on Enter', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const badge = el.querySelector('.marker-id-badge');
            const input = el.querySelector('.marker-id-input');
            manager.renameMarkerUrlId = vi.fn((id, next) => {
                manager._markers.get(id).urlId = next;
                return true;
            });

            openEditor(el);
            input.value = 'shop';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

            expect(manager.renameMarkerUrlId).toHaveBeenCalledWith('m1', 'shop');
            expect(input.hidden).toBe(true);
            expect(badge.style.display).toBe('flex');
            expect(badge.querySelector('.marker-id-text').textContent).toBe('shop');
            expect(badge.title).toBe('shop');
        });

        it('saves on the check button', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');
            manager.renameMarkerUrlId = vi.fn((id, next) => {
                manager._markers.get(id).urlId = next;
                return true;
            });

            openEditor(el);
            input.value = 'shop';
            el.querySelector('.marker-id-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(manager.renameMarkerUrlId).toHaveBeenCalledWith('m1', 'shop');
            expect(el.querySelector('.marker-id-text').textContent).toBe('shop');
        });

        it('keeps focus on the save press, so blur cannot discard the save first', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            openEditor(el);

            const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            el.querySelector('.marker-id-save').dispatchEvent(press);

            expect(press.defaultPrevented).toBe(true);
        });

        it('discards on blur rather than saving', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');
            manager.renameMarkerUrlId = vi.fn(() => true);

            openEditor(el);
            input.value = 'typed_but_not_saved';
            input.dispatchEvent(new Event('blur'));

            expect(manager.renameMarkerUrlId).not.toHaveBeenCalled();
            expect(el.querySelector('.marker-id-text').textContent).toBe('home');
        });

        it('keeps the edit open when a rename is rejected, text intact', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');
            manager.renameMarkerUrlId = vi.fn(() => false);   // e.g. the id is taken

            openEditor(el);
            input.value = 'taken';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

            // Still editing, so the id can be corrected instead of being lost.
            expect(input.hidden).toBe(false);
            expect(input.value).toBe('taken');
            expect(input.style.borderColor).toBe('rgb(239, 68, 68)');
        });

        it('does not let the dismissing click also select the map', () => {
            const manager = makeManager();
            manager._stateManager._suppressClickUntil = 0;
            const el = mountIdRow(manager, 'm1', 'home');

            openEditor(el);
            // Press on the map to dismiss: that same press becomes a map click,
            // which would otherwise drop a marker where the user meant to dismiss.
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

            expect(manager._stateManager._suppressClickUntil).toBeGreaterThan(Date.now());
        });

        it('does not suppress clicks for a press inside the marker', () => {
            const manager = makeManager();
            manager._stateManager._suppressClickUntil = 0;
            const el = mountIdRow(manager, 'm1', 'home');

            openEditor(el);
            el.querySelector('.marker-id-input').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

            expect(manager._stateManager._suppressClickUntil).toBe(0);
        });

        it('stops watching for outside presses once the edit ends', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');

            openEditor(el);
            input.dispatchEvent(new Event('blur'));

            manager._stateManager._suppressClickUntil = 0;
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

            expect(manager._stateManager._suppressClickUntil).toBe(0);
        });

        it('abandons the edit on Escape without renaming', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');
            manager.renameMarkerUrlId = vi.fn(() => true);

            openEditor(el);
            input.value = 'scrapped';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            input.dispatchEvent(new Event('blur'));

            expect(manager.renameMarkerUrlId).not.toHaveBeenCalled();
            expect(el.querySelector('.marker-id-text').textContent).toBe('home');
        });
    });

    describe('marker select mode', () => {
        function mountMarker(manager, markerId, urlId) {
            const el = document.createElement('div');
            el.innerHTML = `<div class="marker-action-row">${manager._buildMarkerIdRowHTML(urlId)}</div>`;
            host.appendChild(el);
            manager._markers.set(markerId, { id: markerId, urlId, lngLat: LNG_LAT, marker: { getElement: () => el } });
            manager._attachMarkerIdRowHandlers(el, markerId);
            return el;
        }

        it('shows the id actions on the selected marker only', () => {
            const manager = makeManager();
            const a = mountMarker(manager, 'a', '1');
            const b = mountMarker(manager, 'b', '2');

            manager._selectMarker('a');
            expect(a.querySelector('.marker-id-actions').style.display).toBe('flex');
            expect(b.querySelector('.marker-id-actions').style.display).toBe('none');

            // Selecting another hands the actions over rather than showing both.
            manager._selectMarker('b');
            expect(a.querySelector('.marker-id-actions').style.display).toBe('none');
            expect(b.querySelector('.marker-id-actions').style.display).toBe('flex');
            expect(manager._selectedMarkerId).toBe('b');
        });

        it('keeps the actions up after the pointer leaves a selected marker', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'a', '1');
            const group = el.querySelector('.marker-id-group');

            manager._selectMarker('a');
            group.dispatchEvent(new Event('mouseenter'));
            group.dispatchEvent(new Event('mouseleave'));

            expect(el.querySelector('.marker-id-actions').style.display).toBe('flex');
        });

        it('still previews the actions on hover when not selected', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'a', '1');
            const group = el.querySelector('.marker-id-group');
            const actions = el.querySelector('.marker-id-actions');

            group.dispatchEvent(new Event('mouseenter'));
            expect(actions.style.display).toBe('flex');

            group.dispatchEvent(new Event('mouseleave'));
            expect(actions.style.display).toBe('none');
        });

        it('shows them permanently on touch, which has no hover', () => {
            const manager = makeManager({ isTouch: true });
            const el = mountMarker(manager, 'a', '1');
            expect(el.querySelector('.marker-id-actions').style.display).toBe('flex');
        });
    });

    describe('focus is released by pressing away', () => {
        function mountMarker(manager, markerId) {
            const el = document.createElement('div');
            el.className = 'selection-marker';
            el.innerHTML = `${manager._buildMarkerIdRowHTML('1')}<div class="marker-content" style="display:none"></div>`;
            host.appendChild(el);
            manager._markers.set(markerId, { id: markerId, urlId: '1', lngLat: LNG_LAT, marker: { getElement: () => el } });
            manager._setupOutsidePressListener();
            return el;
        }

        it('drops focus when the press lands outside every marker', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'a');
            manager._selectMarker('a');
            expect(el.querySelector('.marker-content').style.display).toBe('flex');

            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

            expect(manager._selectedMarkerId).toBe(null);
            expect(el.classList.contains('marker-selected')).toBe(false);
            // Back to just its label.
            expect(el.querySelector('.marker-content').style.display).toBe('none');
        });

        it('keeps focus for a press inside the marker itself', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'a');
            manager._selectMarker('a');

            el.querySelector('.marker-id-badge').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

            expect(manager._selectedMarkerId).toBe('a');
        });
    });

    describe('clicking a marker does not reach the map', () => {
        /**
         * Mapbox appends marker elements inside the map's canvas container, which
         * is where its own click handler is bound - so a click that bubbles out of
         * a marker reads as a map click, and in replace mode that clears every
         * marker and builds a new one at the same point. Clicking a marker would
         * replace it with a copy of itself.
         */
        function mountInFakeCanvasContainer(manager, markerId = 'm1') {
            const canvasContainer = document.createElement('div');
            const el = document.createElement('div');
            el.innerHTML = `
                <div class="marker-action-row">
                    <span class="marker-pin-btn"></span>
                    ${manager._buildMarkerIdRowHTML('1')}
                </div>
                <div class="marker-content" style="display:flex"></div>
            `;
            canvasContainer.appendChild(el);
            host.appendChild(canvasContainer);

            manager._markers.set(markerId, { id: markerId, urlId: '1', lngLat: LNG_LAT, marker: { getElement: () => el } });
            manager._attachMarkerIdRowHandlers(el, markerId);
            manager._blockMapEvents(el);
            el.addEventListener('click', () => manager._selectMarker(markerId), true);

            const mapClick = vi.fn();
            canvasContainer.addEventListener('click', mapClick);
            return { el, mapClick };
        }

        it('swallows a click on the pin before the map sees it', () => {
            const manager = makeManager();
            const { el, mapClick } = mountInFakeCanvasContainer(manager);

            el.querySelector('.marker-pin-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(mapClick).not.toHaveBeenCalled();
        });

        it('selects the marker on that same click', () => {
            const manager = makeManager();
            const { el } = mountInFakeCanvasContainer(manager, 'm9');

            el.querySelector('.marker-pin-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(manager._selectedMarkerId).toBe('m9');
            expect(el.classList.contains('marker-selected')).toBe(true);
        });

        it('swallows clicks on the balloon too', () => {
            const manager = makeManager();
            const { el, mapClick } = mountInFakeCanvasContainer(manager);

            el.querySelector('.marker-content').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(mapClick).not.toHaveBeenCalled();
        });

        it('still lets the id badge open its editor', () => {
            const manager = makeManager();
            const { el, mapClick } = mountInFakeCanvasContainer(manager);

            openEditor(el);

            expect(el.querySelector('.marker-id-input').hidden).toBe(false);
            expect(mapClick).not.toHaveBeenCalled();
        });
    });

    describe('balloon placement', () => {
        it('hangs the balloon down and right of the clicked point', () => {
            const manager = makeManager();
            // The clicked point is the marker's own top-left corner, so the
            // content sits flush with it and a tail + id row below.
            expect(manager.getContentOffset()).toEqual({ x: 0, y: 46 });
        });
    });

    describe('id row actions', () => {
        function mountIdRow(manager, markerId = 'm1') {
            const el = document.createElement('div');
            el.innerHTML = `
                <div class="marker-action-row">${manager._buildMarkerIdRowHTML('1')}</div>
                <div class="marker-content" style="display:flex"></div>
            `;
            host.appendChild(el);
            manager._markers.set(markerId, { id: markerId, urlId: '1', lngLat: LNG_LAT, marker: { getElement: () => el } });
            manager.removeMarker = vi.fn();
            manager._attachMarkerIdRowHandlers(el, markerId);
            return el;
        }

        it('reveals the actions on hover and hides them again on leave', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const group = el.querySelector('.marker-id-group');
            const actions = el.querySelector('.marker-id-actions');

            group.dispatchEvent(new Event('mouseenter'));
            expect(actions.style.display).toBe('flex');

            group.dispatchEvent(new Event('mouseleave'));
            expect(actions.style.display).toBe('none');
        });

        it('keeps the actions up while the id is being edited', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);

            openEditor(el);
            el.querySelector('.marker-id-group').dispatchEvent(new Event('mouseleave'));

            expect(el.querySelector('.marker-id-actions').style.display).toBe('flex');
        });

        it('shows the actions permanently on touch, which has no hover', () => {
            const manager = makeManager({ isTouch: true });
            const el = mountIdRow(manager);
            expect(el.querySelector('.marker-id-actions').style.display).toBe('flex');
        });

        it('does not remove the marker when its pin is clicked', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm7');

            // The pin as addMarker builds it, minus the map plumbing.
            const pin = document.createElement('span');
            pin.className = 'marker-pin-btn';
            el.querySelector('.marker-action-row').insertBefore(pin, el.querySelector('.marker-id-group'));

            pin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            pin.dispatchEvent(new Event('touchend', { bubbles: true }));

            expect(manager.removeMarker).not.toHaveBeenCalled();
        });

        it('removes the marker from the trash action', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm7');

            el.querySelector('.marker-id-remove').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(manager.removeMarker).toHaveBeenCalledWith('m7');
        });

        it('collapses to just the label, and the same button restores it', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const content = el.querySelector('.marker-content');
            const btn = el.querySelector('.marker-id-collapse');
            manager._selectMarker('m1');
            expect(content.style.display).toBe('flex');

            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(content.style.display).toBe('none');
            expect(btn.querySelector('sl-icon').getAttribute('name')).toBe('plus-circle');

            btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(content.style.display).toBe('flex');
            expect(btn.querySelector('sl-icon').getAttribute('name')).toBe('x-circle');
        });

        it('shows only the label once the marker loses focus', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const other = document.createElement('div');
            manager._markers.set('m2', { id: 'm2', urlId: '2', lngLat: LNG_LAT, marker: { getElement: () => other } });

            manager._selectMarker('m1');
            expect(el.querySelector('.marker-content').style.display).toBe('flex');

            // Focus moves to another marker: this one folds back to its label.
            manager._selectMarker('m2');
            expect(el.querySelector('.marker-content').style.display).toBe('none');
            // The id row itself always stays.
            expect(el.querySelector('.marker-id-badge')).not.toBeNull();
        });

        it('takes the feature flyout down with the balloon', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const flyout = document.createElement('div');
            flyout.className = 'marker-feature-flyout';
            flyout.style.display = 'block';
            el.querySelector('.marker-content').appendChild(flyout);

            manager._selectMarker(null);

            expect(flyout.style.display).toBe('none');
        });

        it('sizes the edit input to its text so it reads as a label', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const input = el.querySelector('.marker-id-input');

            openEditor(el);
            // jsdom lays nothing out, so the character-count fallback applies.
            expect(input.style.width).toBe('2ch');

            input.value = 'Assagao_Survey_17_1';
            input.dispatchEvent(new Event('input'));
            expect(input.style.width).toBe('20ch');
        });

        it('measures the real text width when the DOM actually lays out', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const input = el.querySelector('.marker-id-input');
            const ruler = el.querySelector('.marker-id-group span[aria-hidden="true"]');

            // Stand in for a laid-out browser: 11px per character.
            ruler.getBoundingClientRect = () => ({ width: ruler.textContent.length * 11 });

            input.value = 'ASSAGAO_17';
            input.dispatchEvent(new Event('input'));

            // 10 chars * 11px, + the 2px slack - not the 11ch a count would give.
            expect(input.style.width).toBe('112px');
        });

        it('does not let padding eat into either label box', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            // border-box (Tailwind's preflight default) would subtract the 7px
            // side padding from the width and clip the text.
            expect(el.querySelector('.marker-id-badge').style.boxSizing).toBe('content-box');
            expect(el.querySelector('.marker-id-input').style.boxSizing).toBe('content-box');
        });

        it('caps a long id with an ellipsis rather than running off the map', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const badge = el.querySelector('.marker-id-badge');

            expect(badge.style.maxWidth).toBe('240px');
            expect(badge.style.textOverflow).toBe('ellipsis');
            // The full id stays reachable as a tooltip.
            expect(badge.title).toBe('1');
        });
    });
});

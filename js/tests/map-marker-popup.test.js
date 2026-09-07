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
        it('underlines the id instead of carrying an edit icon', () => {
            const manager = makeManager();
            host.innerHTML = manager._buildMarkerMenuHeaderHTML('Assagao_Survey_17_1');

            const badge = host.querySelector('.marker-id-badge');
            expect(badge.querySelector('.marker-id-text').textContent).toBe('Assagao Survey 17 1');
            // The underline is the affordance - no pencil beside every marker.
            expect(badge.style.textDecoration).toContain('underline');
            expect(host.querySelector('.marker-id-pencil')).toBeNull();
            expect(host.querySelector('.marker-id-input').hidden).toBe(true);
        });

        it('offers options on the right of the header, and nothing else', () => {
            const manager = makeManager();
            host.innerHTML = manager._buildMarkerMenuHeaderHTML('1');

            expect(host.querySelector('.marker-id-shortcuts sl-icon').getAttribute('name')).toBe('three-dots-vertical');
            expect(host.querySelector('.marker-id-shortcuts').style.display).toBe('none');
            // Removal and collapse are gone: click away to close, add-mode to keep.
            expect(host.querySelector('.marker-id-remove')).toBeNull();
            expect(host.querySelector('.marker-id-collapse')).toBeNull();
        });

        it('joins the panel to its point with a leader tail, not a pin', () => {
            const manager = makeManager();
            host.innerHTML = manager._buildMarkerLeaderHTML();

            const leader = host.querySelector('.marker-leader');
            // A real drawing surface centred on the point: an outermost <svg>
            // will not reliably paint outside its own viewport, and the tail has
            // to be able to run in any direction from the point.
            expect(Number(leader.getAttribute('width'))).toBeGreaterThan(0);
            expect(parseFloat(leader.style.left)).toBeLessThan(0);
            expect(parseFloat(leader.style.top)).toBeLessThan(0);
            // A filled triangle, so it can taper - a stroked line cannot - in the
            // panel's own colour, so the two read as one callout.
            const tails = leader.querySelectorAll('.marker-leader-line');
            expect(tails).toHaveLength(1);
            expect(tails[0].tagName.toLowerCase()).toBe('polygon');
            expect(tails[0].getAttribute('fill')).toBe('#1f2937');
            expect(leader.querySelector('circle')).toBeNull();
        });

        describe('the tail follows the panel', () => {
            /**
             * `el` is anchored at the point, so the point is the origin and the
             * panel's rect is wherever it has been dragged to.
             */
            function mountAt(manager, { left, top, width = 200, height = 60 }) {
                const el = document.createElement('div');
                el.innerHTML = `${manager._buildMarkerLeaderHTML()}<div class="marker-content"></div>`;
                host.appendChild(el);
                el.getBoundingClientRect = () => ({ left: 0, top: 0 });
                el.querySelector('.marker-content').getBoundingClientRect =
                    () => ({ left, top, width, height });
                return el;
            }
            /** The tail's three corners, relative to the point at its centre. */
            const tailPoints = (el) => el.querySelector('.marker-leader-line')
                .getAttribute('points').split(' ')
                .map(pair => pair.split(',').map(Number))
                .map(([x, y]) => [x - 1200, y - 1200]);
            /** Where the tail meets the panel: the midpoint of its base. */
            const tailBase = (el) => {
                const [, b, c] = tailPoints(el);
                return [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
            };
            /** How wide the tail is where it meets the panel. */
            const tailWidth = (el) => {
                const [, b, c] = tailPoints(el);
                return Math.hypot(b[0] - c[0], b[1] - c[1]);
            };

            it('runs to the top-left corner when the panel is below-right', () => {
                const manager = makeManager();
                const el = mountAt(manager, { left: 20, top: 16 });
                manager._syncMarkerLeader(el);

                expect(el.dataset.leaderCorner).toBe('top-left');
                // 3px inside that corner, so the panel covers where it lands.
                expect(tailBase(el)).toEqual([23, 19]);
                // That corner squares off; the other three stay rounded.
                expect(el.querySelector('.marker-content').style.borderRadius).toBe('0px 8px 8px 8px');
            });

            it('tapers from nothing at the point to 4px at the panel', () => {
                const manager = makeManager();
                const el = mountAt(manager, { left: 20, top: 16 });
                manager._syncMarkerLeader(el);

                // The apex sits exactly on the point, so the tail has no width there.
                expect(tailPoints(el)[0]).toEqual([0, 0]);
                expect(tailWidth(el)).toBeCloseTo(4, 1);
            });

            it('keeps the base square to the direction of travel', () => {
                const manager = makeManager();
                // Anchor sitting straight below the point: the base runs horizontally.
                const el = mountAt(manager, { left: -3, top: 37 });
                manager._syncMarkerLeader(el);

                const [, b, c] = tailPoints(el);
                expect(b[1]).toBeCloseTo(c[1], 5);
                expect(tailWidth(el)).toBeCloseTo(4, 1);
            });

            it('switches to the top-right corner when dragged left of the point', () => {
                const manager = makeManager();
                const el = mountAt(manager, { left: -220, top: 16 });
                manager._syncMarkerLeader(el);

                expect(el.dataset.leaderCorner).toBe('top-right');
                expect(tailBase(el)).toEqual([-23, 19]);
                expect(el.querySelector('.marker-content').style.borderRadius).toBe('8px 0px 8px 8px');
            });

            it('still joins a top corner when the panel is dragged above the point', () => {
                const manager = makeManager();
                const el = mountAt(manager, { left: 20, top: -100 });
                manager._syncMarkerLeader(el);

                // Never a bottom corner: the panel grows downwards, so joining it
                // at the bottom would put the tail on the moving edge.
                expect(el.dataset.leaderCorner).toBe('top-left');
                expect(tailBase(el)).toEqual([23, -97]);
                expect(el.querySelector('.marker-content').style.borderRadius).toBe('0px 8px 8px 8px');
            });

            it('takes the nearer top corner when dragged up and left', () => {
                const manager = makeManager();
                const el = mountAt(manager, { left: -220, top: -100 });
                manager._syncMarkerLeader(el);

                expect(el.dataset.leaderCorner).toBe('top-right');
                expect(el.querySelector('.marker-content').style.borderRadius).toBe('8px 0px 8px 8px');
            });

            it('leaves an unmeasurable panel alone rather than drawing to nowhere', () => {
                const manager = makeManager();
                const el = mountAt(manager, { left: 0, top: 0, width: 0, height: 0 });
                manager._syncMarkerLeader(el);

                expect(el.dataset.leaderCorner).toBeUndefined();
                expect(tailPoints(el)).toEqual([[0, 0], [0, 0], [0, 0]]);
            });

            it('draws no tail at all when the anchor sits on the point', () => {
                const manager = makeManager();
                // Inset by 3, so a panel offset by -3 puts its anchor on the point.
                const el = mountAt(manager, { left: -3, top: -3 });
                manager._syncMarkerLeader(el);

                // Nowhere to taper towards, and normalising by zero would be NaN.
                expect(tailPoints(el)).toEqual([[0, 0], [0, 0], [0, 0]]);
            });

            it('never insets past the middle of a panel smaller than the inset', () => {
                const manager = makeManager();
                const el = mountAt(manager, { left: 10, top: 10, width: 4, height: 4 });
                manager._syncMarkerLeader(el);

                // Half the panel, not 3 - the base stays within the surface that
                // is meant to cover it.
                expect(tailBase(el)).toEqual([12, 12]);
            });
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

            // Features in inspector order, then the address of the point itself.
            expect(chips.map(c => c.querySelector('.marker-summary-chip__value').textContent))
                .toEqual(['17/1', 'Ward 4', 'Locating…']);
            // The index still points back into the original features array.
            expect(chips.map(c => c.dataset.badgeIndex)).toEqual(['1', '0', '-2']);
        });

        it('renders each feature as a menu row with a submenu chevron', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }, { id: 'wards' }] });
            const features = [feature('plots', { id: '17/1' }), feature('wards', { id: 'Ward 4' })];

            host.innerHTML = manager._buildMarkerSummaryHTML(features, LNG_LAT);
            const row = host.querySelector('.marker-summary-row');
            const items = host.querySelectorAll('.marker-summary-chip');

            expect(row.style.flexDirection).toBe('column');
            // Same vocabulary as the long-press shortcut menu.
            items.forEach(i => expect(i.classList.contains('shortcut-menu-item')).toBe(true));
            expect(items[0].querySelector('.shortcut-menu-chevron').getAttribute('name')).toBe('chevron-right');
            expect(host.querySelector('.shortcut-menu-divider')).not.toBeNull();
        });

        it('keeps the address row even when features were selected', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            host.innerHTML = manager._buildMarkerSummaryHTML([feature('plots', { id: '17/1' })], LNG_LAT);

            const address = host.querySelector('.marker-summary-chip--address');
            expect(address).not.toBeNull();
            // Last, after the features, not instead of them.
            expect(host.querySelectorAll('.marker-summary-chip')[1]).toBe(address);
        });

        it('is the only chip when nothing is selected', () => {
            const manager = makeManager();
            host.innerHTML = manager._buildMarkerSummaryHTML([], LNG_LAT);

            const chips = host.querySelectorAll('.marker-summary-chip');
            expect(chips).toHaveLength(1);
            expect(chips[0].classList.contains('marker-summary-chip--address')).toBe(true);
            // Pending, not a pair of coordinates standing in for it - those are
            // a field inside the address now (see the $coordinates field).
            expect(chips[0].querySelector('.marker-summary-chip__value').textContent).toBe('Locating…');
        });

        it('carries the coordinates as a field of the address, not a row of its own', () => {
            const manager = makeManager();
            manager._markers.set('m1', {
                id: 'm1', urlId: '1', lngLat: LNG_LAT,
                address: { text: 'Assagao', parts: [{ key: 'suburb', value: 'Assagao' }] }
            });
            // The linked-hierarchy follow-up is a second network request; the
            // first, flat render is what this asserts on.
            manager._queueAddressLookup = () => new Promise(() => {});
            const details = document.createElement('div');

            manager._fillAddressDetails(details, 'm1');

            // Leading the hierarchy it sits in, `lng,lat` in one copyable string.
            expect(details.textContent).toContain('$coordinates');
            expect(details.textContent).toContain('73.818700,15.548450');
            expect(details.textContent.indexOf('$coordinates'))
                .toBeLessThan(details.textContent.indexOf('suburb'));
        });

        it('shows no coordinates badge on a popup with nothing selected', () => {
            const manager = makeManager();
            host.innerHTML = manager._buildMarkerBadgesHTML([], LNG_LAT);

            // A popup whose whole content is a pair of numbers says nothing the
            // address row below it doesn't.
            expect(host.querySelector('[data-badge-index="-1"]')).toBeNull();
            expect(host.textContent).not.toContain('73.81');
        });

        it('rewrites the address row once the geocode returns', () => {
            const manager = makeManager();
            const el = document.createElement('div');
            // A selection marker's menu, with no legacy `.address-badge` in it -
            // only the hover marker still carries that.
            el.innerHTML = manager._buildMarkerSummaryHTML([], LNG_LAT);

            manager._renderMarkerAddress({
                marker: { getElement: () => el },
                address: { text: 'Assagao, Bardez, Goa' }
            });

            expect(el.querySelector('.marker-summary-chip--address .marker-summary-chip__value').textContent)
                .toBe('Assagao, Bardez, Goa');
        });

        it('still fills the hover marker\'s stacked address badge', () => {
            const manager = makeManager();
            const el = document.createElement('div');
            el.innerHTML = '<div class="address-badge" style="display:none"><span class="address-badge-value"></span></div>';

            manager._renderMarkerAddress({
                marker: { getElement: () => el },
                address: { text: 'Assagao, Bardez, Goa' }
            });

            expect(el.querySelector('.address-badge-value').textContent).toBe('Assagao, Bardez, Goa');
            expect(el.querySelector('.address-badge').style.display).toBe('flex');
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

        const settle = () => new Promise(resolve => setTimeout(resolve, 220));

        it('marks the active row while hovering it', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            const chip = el.querySelector('.marker-summary-chip');

            chip.dispatchEvent(new Event('mouseenter'));
            expect(chip.style.borderColor).toBe('rgb(59, 130, 246)');
        });

        it('closes again when the pointer leaves an unpinned row', async () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            const chip = el.querySelector('.marker-summary-chip');
            const flyout = el.querySelector('.marker-feature-flyout');

            chip.dispatchEvent(new Event('mouseenter'));
            expect(flyout.style.display).toBe('block');

            chip.dispatchEvent(new Event('mouseleave'));
            await settle();
            expect(flyout.style.display).toBe('none');
            // ...and the row stops reading as active.
            expect(chip.style.borderColor).toBe('transparent');
        });

        it('stays open while the pointer moves into the table itself', async () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            const chip = el.querySelector('.marker-summary-chip');
            const flyout = el.querySelector('.marker-feature-flyout');

            chip.dispatchEvent(new Event('mouseenter'));
            // Leaving the row starts the close, but reaching the table cancels it -
            // otherwise the table would be unreachable.
            chip.dispatchEvent(new Event('mouseleave'));
            flyout.dispatchEvent(new Event('mouseenter'));
            await settle();

            expect(flyout.style.display).toBe('block');
        });

        it('pins on click, so it survives the pointer leaving', async () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            const chip = el.querySelector('.marker-summary-chip');
            const flyout = el.querySelector('.marker-feature-flyout');

            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            chip.dispatchEvent(new Event('mouseleave'));
            await settle();

            expect(flyout.style.display).toBe('block');
            expect(el.dataset.flyoutPinned).toBe('0');
        });

        it('unpins when the same row is clicked again', async () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            const chip = el.querySelector('.marker-summary-chip');
            const flyout = el.querySelector('.marker-feature-flyout');

            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(flyout.style.display).toBe('none');
            expect(el.dataset.flyoutPinned).toBeUndefined();
        });

        it('moves the pin to another row rather than keeping both', () => {
            const layers = [{ id: 'plots' }, { id: 'wards' }];
            const manager = makeManager({ layers });
            const features = [feature('plots', { id: '17/1' }), feature('wards', { id: 'Ward 4' })];
            const el = mount(manager, features);
            const chips = el.querySelectorAll('.marker-summary-chip');

            chips[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            chips[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(el.dataset.flyoutPinned).toBe('1');
            expect(el.querySelectorAll('.feature-badge-details')).toHaveLength(1);
        });

        it('drops the pin when the marker itself closes', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            // appendChild, not innerHTML += : re-parsing the element would throw
            // away every listener mount() just attached.
            const body = document.createElement('div');
            body.className = 'marker-menu-body';
            el.appendChild(body);

            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(el.dataset.flyoutPinned).toBe('0');

            manager._syncMarkerContent(el);

            expect(el.dataset.flyoutPinned).toBeUndefined();
            expect(el.querySelector('.marker-feature-flyout').style.display).toBe('none');
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
                <div class="marker-content">
                    ${manager._buildMarkerMenuHeaderHTML(urlId)}
                    <div class="marker-menu-body" style="display:none"></div>
                </div>
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
            host.innerHTML = manager._buildMarkerMenuHeaderHTML('home');

            // The badge does declare `display: flex` (it lays out the text and
            // pencil), so it is toggled by display, not by [hidden].
            expect(host.querySelector('.marker-id-input').style.display).toBe('');
        });

        it('shows the id with spaces while storing it with underscores', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'Assagao_Survey_17');
            const badge = el.querySelector('.marker-id-badge');
            const input = el.querySelector('.marker-id-input');

            expect(badge.querySelector('.marker-id-text').textContent).toBe('Assagao Survey 17');

            openEditor(el);
            // The editor is the name, not the storage form.
            expect(input.value).toBe('Assagao Survey 17');
        });

        it('stores a typed space as an underscore', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');
            manager.renameMarkerUrlId = vi.fn((id, next) => {
                manager._markers.get(id).urlId = next;
                return true;
            });

            openEditor(el);
            input.value = 'my shop';
            input.dispatchEvent(new Event('input'));
            // Typing leaves the space alone rather than flipping to an underscore.
            expect(input.value).toBe('my shop');

            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            expect(manager.renameMarkerUrlId).toHaveBeenCalledWith('m1', 'my_shop');
            // ...and it reads back as a name again.
            expect(el.querySelector('.marker-id-text').textContent).toBe('my shop');
        });

        it('shows an underscore typed directly as a space too', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');

            openEditor(el);
            input.value = 'a_b';
            input.dispatchEvent(new Event('input'));

            expect(input.value).toBe('a b');
        });

        it('marks the marker saved once its id is committed', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');
            manager.renameMarkerUrlId = vi.fn((id, next) => {
                manager._markers.get(id).urlId = next;
                return true;
            });

            expect(manager._markers.get('m1').saved).toBeFalsy();

            openEditor(el);
            input.value = 'my shop';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

            // A named marker is one to keep (see _clearUnsavedMarkers).
            expect(manager._markers.get('m1').saved).toBe(true);
        });

        it('counts accepting the id unchanged as saving it', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            manager.renameMarkerUrlId = vi.fn();

            openEditor(el);
            el.querySelector('.marker-id-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(manager.renameMarkerUrlId).not.toHaveBeenCalled();
            expect(manager._markers.get('m1').saved).toBe(true);
        });

        it('hands the panel back to hover once the id is saved', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            manager.renameMarkerUrlId = vi.fn();

            openEditor(el);
            el.querySelector('.marker-id-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            // Naming it is the end of creating it: hover decides whether the
            // panel stays open from here, so moving off it closes it instead of
            // it holding focus until something elsewhere is pressed.
            expect(manager._selectedMarkerId).toBe(null);
            expect(el.classList.contains('marker-selected')).toBe(false);
        });

        it('keeps focus after saving on touch, which has no hover to hand it to', () => {
            const manager = makeManager({ isTouch: true });
            const el = mountIdRow(manager, 'm1', 'home');
            manager.renameMarkerUrlId = vi.fn();

            openEditor(el);
            el.querySelector('.marker-id-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(manager._selectedMarkerId).toBe('m1');
        });

        it('does not mark it saved when the edit is discarded', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');

            openEditor(el);
            input.value = 'typed_but_not_saved';
            input.dispatchEvent(new Event('blur'));

            expect(manager._markers.get('m1').saved).toBeFalsy();
        });

        it('does not mark it saved when the rename is rejected', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');
            manager.renameMarkerUrlId = vi.fn(() => false);

            openEditor(el);
            input.value = 'taken';
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

            expect(manager._markers.get('m1').saved).toBeFalsy();
        });

        describe('a brand-new marker is commit-or-cancel', () => {
            it('is destroyed when its first edit is abandoned', async () => {
                const manager = makeManager();
                const el = mountIdRow(manager, 'm1', '1');
                manager.removeMarker = vi.fn();

                el._startIdEdit({ initial: true });
                el.querySelector('.marker-id-input').dispatchEvent(new Event('blur'));
                // Deferred off the blur, so it can't be asserted synchronously.
                await new Promise(resolve => setTimeout(resolve, 0));

                // Never named, so it does not stay behind.
                expect(manager.removeMarker).toHaveBeenCalledWith('m1');
            });

            it('survives reaching for something else inside the same marker', async () => {
                const manager = makeManager();
                const el = mountIdRow(manager, 'm1', '1');
                manager.removeMarker = vi.fn();

                el._startIdEdit({ initial: true });
                // A press on a feature row / the options button blurs the input
                // just as a map click does - but it is not walking away.
                el.querySelector('.marker-menu-body').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                el.querySelector('.marker-id-input').dispatchEvent(new Event('blur'));
                await new Promise(resolve => setTimeout(resolve, 0));

                expect(manager.removeMarker).not.toHaveBeenCalled();
                // The editor still closes - it just doesn't take the marker with it.
                expect(el.dataset.idEditing).toBeUndefined();
            });

            it('is still destroyed by a press outside it', async () => {
                const manager = makeManager();
                const el = mountIdRow(manager, 'm1', '1');
                manager.removeMarker = vi.fn();

                el._startIdEdit({ initial: true });
                document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                el.querySelector('.marker-id-input').dispatchEvent(new Event('blur'));
                await new Promise(resolve => setTimeout(resolve, 0));

                expect(manager.removeMarker).toHaveBeenCalledWith('m1');
            });

            it('is destroyed on Escape too', async () => {
                const manager = makeManager();
                const el = mountIdRow(manager, 'm1', '1');
                manager.removeMarker = vi.fn();

                el._startIdEdit({ initial: true });
                el.querySelector('.marker-id-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                await new Promise(resolve => setTimeout(resolve, 0));

                expect(manager.removeMarker).toHaveBeenCalledWith('m1');
            });

            it('survives once its id has been saved', async () => {
                const manager = makeManager();
                const el = mountIdRow(manager, 'm1', '1');
                manager.removeMarker = vi.fn();
                manager.renameMarkerUrlId = vi.fn(() => true);

                el._startIdEdit({ initial: true });
                el.querySelector('.marker-id-input').value = 'site_a';
                el.querySelector('.marker-id-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
                // A later edit, abandoned, must not destroy it.
                openEditor(el);
                el.querySelector('.marker-id-input').dispatchEvent(new Event('blur'));
                await new Promise(resolve => setTimeout(resolve, 0));

                expect(manager.removeMarker).not.toHaveBeenCalled();
            });

            it('lets the dismissing click through, so it drops the next marker', () => {
                const manager = makeManager();
                manager._stateManager._suppressClickUntil = 0;
                const el = mountIdRow(manager, 'm1', '1');
                manager.removeMarker = vi.fn();

                el._startIdEdit({ initial: true });
                document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

                // Unlike an ordinary edit, this click is not swallowed - the
                // marker follows your clicks until you name one.
                expect(manager._stateManager._suppressClickUntil).toBe(0);
            });

            it('still swallows the dismissing click for an ordinary edit', () => {
                const manager = makeManager();
                manager._stateManager._suppressClickUntil = 0;
                const el = mountIdRow(manager, 'm1', 'home');

                openEditor(el);
                document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

                expect(manager._stateManager._suppressClickUntil).toBeGreaterThan(Date.now());
            });
        });

        it('offers a red delete button only while editing', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const del = el.querySelector('.marker-id-delete');

            expect(del.querySelector('sl-icon').getAttribute('name')).toBe('trash-fill');
            expect(del.querySelector('sl-icon').style.color).toBe('rgb(239, 68, 68)');
            expect(del.style.display).toBe('none');

            openEditor(el);
            expect(del.style.display).toBe('flex');

            el.querySelector('.marker-id-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(del.style.display).toBe('none');
        });

        it('deletes the marker from that button', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            manager.removeMarker = vi.fn();

            openEditor(el);
            el.querySelector('.marker-id-delete').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(manager.removeMarker).toHaveBeenCalledWith('m1');
        });

        it('keeps focus on the delete press, so blur cannot pre-empt it', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            openEditor(el);

            const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            el.querySelector('.marker-id-delete').dispatchEvent(press);

            expect(press.defaultPrevented).toBe(true);
        });

        it('exposes the editor so a new marker can open in it', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');

            expect(typeof el._startIdEdit).toBe('function');
            el._startIdEdit();

            expect(el.querySelector('.marker-id-input').hidden).toBe(false);
            expect(el.querySelector('.marker-id-save').style.display).toBe('flex');
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

        it('is reachable by touch, where the focus guard cancels the click', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');
            manager.renameMarkerUrlId = vi.fn((id, next) => {
                manager._markers.get(id).urlId = next;
                return true;
            });

            openEditor(el);
            input.value = 'shop';
            // preventDefault on touchstart keeps focus, but also means no
            // synthesized click ever arrives - so touchend has to carry it.
            el.querySelector('.marker-id-save').dispatchEvent(new Event('touchend', { bubbles: true }));

            expect(manager.renameMarkerUrlId).toHaveBeenCalledWith('m1', 'shop');
        });

        it('deletes by touch as well', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            manager.removeMarker = vi.fn();

            openEditor(el);
            el.querySelector('.marker-id-delete').dispatchEvent(new Event('touchend', { bubbles: true }));

            expect(manager.removeMarker).toHaveBeenCalledWith('m1');
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
            el.innerHTML = `<div class="marker-content">${manager._buildMarkerMenuHeaderHTML(urlId)}<div class="marker-menu-body" style="display:none"></div></div>`;
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
            expect(a.querySelector('.marker-id-shortcuts').style.display).toBe('flex');
            expect(b.querySelector('.marker-id-shortcuts').style.display).toBe('none');

            // Selecting another hands the actions over rather than showing both.
            manager._selectMarker('b');
            expect(a.querySelector('.marker-id-shortcuts').style.display).toBe('none');
            expect(b.querySelector('.marker-id-shortcuts').style.display).toBe('flex');
            expect(manager._selectedMarkerId).toBe('b');
        });

        it('keeps the actions up after the pointer leaves a selected marker', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'a', '1');
            const group = el.querySelector('.marker-menu-header');

            manager._selectMarker('a');
            group.dispatchEvent(new Event('mouseenter'));
            group.dispatchEvent(new Event('mouseleave'));

            expect(el.querySelector('.marker-id-shortcuts').style.display).toBe('flex');
        });

        it('still previews the actions on hover when not selected', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'a', '1');
            const group = el.querySelector('.marker-menu-header');
            const actions = el.querySelector('.marker-id-shortcuts');

            group.dispatchEvent(new Event('mouseenter'));
            expect(actions.style.display).toBe('flex');

            group.dispatchEvent(new Event('mouseleave'));
            expect(actions.style.display).toBe('none');
        });

        it('shows them permanently on touch, which has no hover', () => {
            const manager = makeManager({ isTouch: true });
            const el = mountMarker(manager, 'a', '1');
            expect(el.querySelector('.marker-id-shortcuts').style.display).toBe('flex');
        });
    });

    describe('focus is released by pressing away', () => {
        function mountMarker(manager, markerId) {
            const el = document.createElement('div');
            el.className = 'selection-marker';
            el.innerHTML = `<div class="marker-content">${manager._buildMarkerMenuHeaderHTML('1')}<div class="marker-menu-body" style="display:none"></div></div>`;
            host.appendChild(el);
            manager._markers.set(markerId, { id: markerId, urlId: '1', lngLat: LNG_LAT, marker: { getElement: () => el } });
            manager._setupOutsidePressListener();
            return el;
        }

        it('drops focus when the press lands outside every marker', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'a');
            manager._selectMarker('a');
            expect(el.querySelector('.marker-menu-body').style.display).toBe('flex');

            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

            expect(manager._selectedMarkerId).toBe(null);
            expect(el.classList.contains('marker-selected')).toBe(false);
            // Back to just its label.
            expect(el.querySelector('.marker-menu-body').style.display).toBe('none');
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
                    ${manager._buildMarkerMenuHeaderHTML('1')}
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

        it('swallows a double-click, which the map would take as zoom', () => {
            const manager = makeManager();
            const { el, mapClick } = mountInFakeCanvasContainer(manager);
            const canvasContainer = el.parentElement;
            const mapDblClick = vi.fn();
            canvasContainer.addEventListener('dblclick', mapDblClick);

            const evt = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
            el.querySelector('.marker-id-badge').dispatchEvent(evt);

            expect(mapDblClick).not.toHaveBeenCalled();
            // Propagation only - the browser still selects the word under the cursor.
            expect(evt.defaultPrevented).toBe(false);
            expect(mapClick).not.toHaveBeenCalled();
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

    describe('no hover popup while a marker is being repositioned', () => {
        function hoverData() {
            return {
                lngLat: LNG_LAT,
                hoveredFeatures: [{ ...feature('plots', { id: '17/1' }), lngLat: LNG_LAT }]
            };
        }

        it('drops the popup while the marker is under the pointer being dragged', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            manager._clearHoverMarker = vi.fn();
            manager._showHoverMarker = vi.fn();
            manager._draggingMarkerId = 'm1';

            manager._handleBatchHover(hoverData());

            // The panel travels with the marker and the drop re-queries into it,
            // so a popup beside it would only say the same thing twice.
            expect(manager._showHoverMarker).not.toHaveBeenCalled();
            expect(manager._clearHoverMarker).toHaveBeenCalled();
        });

        it('still shows it when no marker is being dragged', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            manager._clearHoverMarker = vi.fn();
            manager._showHoverMarker = vi.fn();
            manager._clearAllMarkerHoverStates = vi.fn();

            manager._handleBatchHover(hoverData());

            expect(manager._showHoverMarker).toHaveBeenCalled();
        });
    });

    describe('two drags: the panel moves itself, the tail moves the marker', () => {
        function mountDraggable(manager, markerId = 'm1') {
            const el = document.createElement('div');
            el.className = 'selection-marker';
            el.innerHTML = `${manager._buildMarkerLeaderHTML()}`
                + `<div class="marker-content">${manager._buildMarkerMenuHeaderHTML('1')}</div>`;
            host.appendChild(el);
            const contentEl = el.querySelector('.marker-content');
            manager._stateManager.handleMapMouseLeave = () => {};
            manager._markers.set(markerId, {
                id: markerId, urlId: '1', lngLat: LNG_LAT, contentEl,
                panelOffset: { x: 16, y: 16 }, panelAnchor: 'top-left',
                marker: { getElement: () => el }
            });
            manager._attachBalloonDragHandler(contentEl, markerId);
            return { el, contentEl, tail: el.querySelector('.marker-leader-line') };
        }

        /** Drag `target` by (dx, dy) the way the panel's own handler sees it. */
        function drag(target, dx, dy) {
            target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + dx, clientY: 100 + dy }));
            window.dispatchEvent(new MouseEvent('mouseup', {}));
        }

        it('offsets the panel when the panel is dragged', () => {
            const manager = makeManager();
            const { contentEl } = mountDraggable(manager);

            drag(contentEl, 40, 30);

            expect(manager._markers.get('m1').panelOffset).toEqual({ x: 56, y: 46 });
            expect(contentEl.style.transform).toContain('translate(56px, 46px)');
        });

        it('offsets the panel when it is dragged by its header, as before', () => {
            const manager = makeManager();
            const { el, contentEl } = mountDraggable(manager);

            drag(el.querySelector('.marker-id-badge'), 40, 30);

            expect(manager._markers.get('m1').panelOffset).toEqual({ x: 56, y: 46 });
            expect(contentEl.style.transform).toContain('translate(56px, 46px)');
        });

        it('keeps that press off mapbox, which would move the marker as well', () => {
            const manager = makeManager();
            const { el, contentEl } = mountDraggable(manager);
            // Mapbox reads its marker drag off the map container this marker
            // sits in, so a press that escaped the panel would move the marker
            // and re-query the location on top of the panel's own drag.
            const reachedMapbox = vi.fn();
            el.addEventListener('mousedown', reachedMapbox);

            contentEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

            expect(reachedMapbox).not.toHaveBeenCalled();
        });

        it('marks the tail as the handle for the marker itself, and nothing else in the leader', () => {
            const manager = makeManager();
            const { el, tail } = mountDraggable(manager);

            // The surface spans 1200px in every direction, so only the triangle
            // drawn on it may hit-test - and it says so with a move cursor.
            expect(el.querySelector('.marker-leader').style.pointerEvents).toBe('none');
            expect(tail.style.pointerEvents).toBe('auto');
            expect(tail.style.cursor).toBe('move');
            // 4px of paint is too fine to aim at, so an invisible stroke widens
            // the target without widening the tail.
            expect(tail.getAttribute('stroke')).toBe('transparent');
            expect(Number(tail.getAttribute('stroke-width'))).toBeGreaterThan(4);
        });

        it('lets a press on the tail reach mapbox, which is what moves the marker', () => {
            const manager = makeManager();
            const { el, tail } = mountDraggable(manager);
            const reachedMapbox = vi.fn();
            el.addEventListener('mousedown', reachedMapbox);

            drag(tail, 40, 30);

            expect(reachedMapbox).toHaveBeenCalled();
            // The panel is the marker's furniture: it travels with the marker,
            // so its own offset is untouched.
            expect(manager._markers.get('m1').panelOffset).toEqual({ x: 16, y: 16 });
        });
    });

    describe('balloon placement', () => {
        it('hangs the balloon down and right of the clicked point', () => {
            const manager = makeManager();
            // The clicked point is the marker's own top-left corner, and the
            // panel clears it on both axes by the anchor gap.
            expect(manager.getContentOffset()).toEqual({ x: 16, y: 46 });
        });
    });

    describe('id row actions', () => {
        function mountIdRow(manager, markerId = 'm1') {
            const el = document.createElement('div');
            el.innerHTML = `
                <div class="marker-content">
                    ${manager._buildMarkerMenuHeaderHTML('1')}
                    <div class="marker-menu-body" style="display:none"></div>
                </div>
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
            const group = el.querySelector('.marker-menu-header');
            const actions = el.querySelector('.marker-id-shortcuts');

            group.dispatchEvent(new Event('mouseenter'));
            expect(actions.style.display).toBe('flex');

            group.dispatchEvent(new Event('mouseleave'));
            expect(actions.style.display).toBe('none');
        });

        it('keeps the actions up while the id is being edited', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);

            openEditor(el);
            el.querySelector('.marker-menu-header').dispatchEvent(new Event('mouseleave'));

            expect(el.querySelector('.marker-id-shortcuts').style.display).toBe('flex');
        });

        it('shows the actions permanently on touch, which has no hover', () => {
            const manager = makeManager({ isTouch: true });
            const el = mountIdRow(manager);
            expect(el.querySelector('.marker-id-shortcuts').style.display).toBe('flex');
        });



        it('grows from a chip into a menu when focused, and back', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const body = el.querySelector('.marker-menu-body');
            manager._selectMarker('m1');
            expect(body.style.display).toBe('flex');
            // The panel widens into a menu only once it is open.
            expect(el.querySelector('.marker-content').style.minWidth).toBe('220px');

            manager._selectMarker(null);
            expect(body.style.display).toBe('none');
            expect(el.querySelector('.marker-content').style.minWidth).toBe('');
        });

        it('raises the open marker above its neighbours', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const other = document.createElement('div');
            other.innerHTML = '<div class="marker-content"><div class="marker-menu-body"></div></div>';
            manager._markers.set('m2', { id: 'm2', urlId: '2', lngLat: LNG_LAT, marker: { getElement: () => other } });

            // Mapbox leaves markers unstacked, so they overlap in DOM order.
            expect(el.style.zIndex).toBe('');

            manager._selectMarker('m1');
            expect(el.style.zIndex).toBe('2');
            expect(other.style.zIndex).toBe('');

            // Hover wins over selection: the marker under the pointer is on top.
            other.dataset.markerHover = '1';
            manager._syncMarkerContent(other);
            expect(other.style.zIndex).toBe('3');

            delete other.dataset.markerHover;
            manager._syncMarkerContent(other);
            expect(other.style.zIndex).toBe('');
        });

        it('shows only the label once the marker loses focus', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const other = document.createElement('div');
            manager._markers.set('m2', { id: 'm2', urlId: '2', lngLat: LNG_LAT, marker: { getElement: () => other } });

            manager._selectMarker('m1');
            expect(el.querySelector('.marker-menu-body').style.display).toBe('flex');

            // Focus moves to another marker: this one folds back to its label.
            manager._selectMarker('m2');
            expect(el.querySelector('.marker-menu-body').style.display).toBe('none');
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
            const ruler = el.querySelector('.marker-menu-header span[aria-hidden="true"]');

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

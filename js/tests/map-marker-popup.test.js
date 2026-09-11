// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { MapMarkerManager } = await import('../map-marker-manager.js');
const markerRegistry = await import('../marker-registry.js');

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
        it('dot-underlines the id instead of carrying an edit icon', () => {
            const manager = makeManager();
            host.innerHTML = manager._buildMarkerMenuHeaderHTML('Assagao_Survey_17_1');

            const badge = host.querySelector('.marker-id-badge');
            expect(badge.querySelector('.marker-id-text').textContent).toBe('Assagao Survey 17 1');
            // The underline is the affordance - no pencil beside every marker.
            expect(badge.style.textDecorationStyle).toBe('dotted');
            expect(host.querySelector('.marker-id-pencil')).toBeNull();
            expect(host.querySelector('.marker-id-input').hidden).toBe(true);
        });

        it('only draws that underline once the marker is expanded', () => {
            const manager = makeManager();
            const el = document.createElement('div');
            el.innerHTML = `
                <div class="marker-content">
                    ${manager._buildMarkerMenuHeaderHTML('home')}
                    <div class="marker-menu-body" style="display:none"></div>
                </div>
            `;
            host.appendChild(el);
            const badge = el.querySelector('.marker-id-badge');

            // Collapsed to a plain chip: no underline yet.
            expect(badge.style.textDecorationLine).toBe('none');

            el.classList.add('marker-selected');
            manager._syncMarkerContent(el);
            expect(badge.style.textDecorationLine).toBe('underline');

            el.classList.remove('marker-selected');
            manager._syncMarkerContent(el);
            expect(badge.style.textDecorationLine).toBe('none');
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
            expect(tails[0].getAttribute('fill')).toBe('rgba(31, 41, 55, 0.7)');
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
            });

            it('still joins a top corner when the panel is dragged above the point', () => {
                const manager = makeManager();
                const el = mountAt(manager, { left: 20, top: -100 });
                manager._syncMarkerLeader(el);

                // Never a bottom corner: the panel grows downwards, so joining it
                // at the bottom would put the tail on the moving edge.
                expect(el.dataset.leaderCorner).toBe('top-left');
                expect(tailBase(el)).toEqual([23, -97]);
            });

            it('takes the nearer top corner when dragged up and left', () => {
                const manager = makeManager();
                const el = mountAt(manager, { left: -220, top: -100 });
                manager._syncMarkerLeader(el);

                expect(el.dataset.leaderCorner).toBe('top-right');
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

        it("shows each row's field title as a muted subheader beneath its value", () => {
            const layers = [{ id: 'plots', inspect: { label: 'id', title: 'Survey No' } }];
            const manager = makeManager({ layers });
            const features = [feature('plots', { id: '17/1' })];

            host.innerHTML = manager._buildMarkerSummaryHTML(features, LNG_LAT);
            const chip = host.querySelector('.marker-summary-chip');
            const value = chip.querySelector('.marker-summary-chip__value');
            const field = chip.querySelector('.marker-summary-chip__field');

            expect(value.textContent).toBe('17/1');
            expect(field.textContent).toBe('Survey No');
            // Below, not above: it follows the value in the DOM.
            expect(value.compareDocumentPosition(field)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        });

        it("shows 'Address' as the field title on the address row's own subheader", () => {
            const manager = makeManager();

            host.innerHTML = manager._buildMarkerSummaryHTML([], LNG_LAT);

            const chip = host.querySelector('.marker-summary-chip--address');
            expect(chip.querySelector('.marker-summary-chip__field').textContent).toBe('Address');
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
            // A hairline on every row instead of one thick divider above the list.
            expect(host.querySelector('.shortcut-menu-divider')).toBeNull();
            host.querySelectorAll('.marker-summary-item').forEach(item => {
                expect(item.style.borderTop).toContain('1px');
            });
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

    describe('chip -> accordion details', () => {
        function mount(manager, features) {
            const el = document.createElement('div');
            el.innerHTML = `
                <div class="marker-content" style="display:flex">
                    ${manager._buildMarkerSummaryHTML(features, LNG_LAT)}
                </div>
            `;
            host.appendChild(el);
            manager._markers.set('m1', { id: 'm1', urlId: '1', lngLat: LNG_LAT, marker: { getElement: () => el } });
            manager._stateManager.setFeatureHoverState = vi.fn();
            manager._loadInspectionHandlerHTML = vi.fn();
            manager._attachLayerActionsMenuHandlers = vi.fn();
            manager._fillAddressDetails = vi.fn();
            manager._buildFeatureFlyoutContentHTML = vi.fn((f) =>
                `<div class="feature-badge-details">${f.feature.properties.id}</div>`);
            manager._attachMarkerSummaryHandlers(el, features, LNG_LAT);
            return el;
        }

        it('expands one feature\'s table inline beneath its own row on click', () => {
            const layers = [{ id: 'plots' }, { id: 'wards' }];
            const manager = makeManager({ layers });
            const features = [feature('plots', { id: '17/1' }), feature('wards', { id: 'Ward 4' })];
            const el = mount(manager, features);
            const items = el.querySelectorAll('.marker-summary-item');

            items[1].querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            const details = items[1].querySelector('.marker-summary-details');
            expect(details.style.display).toBe('block');
            // Just that one feature's table, not every selected feature's.
            expect(manager._buildFeatureFlyoutContentHTML).toHaveBeenCalledTimes(1);
            expect(details.querySelector('.feature-badge-details').textContent).toBe('Ward 4');
            // The other row stays collapsed.
            expect(items[0].querySelector('.marker-summary-details').style.display).toBe('none');
        });

        it('closes the other row rather than stacking both open (accordion)', () => {
            const layers = [{ id: 'plots' }, { id: 'wards' }];
            const manager = makeManager({ layers });
            const features = [feature('plots', { id: '17/1' }), feature('wards', { id: 'Ward 4' })];
            const el = mount(manager, features);
            const chips = el.querySelectorAll('.marker-summary-chip');

            chips[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            chips[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));

            const open = [...el.querySelectorAll('.marker-summary-details')]
                .filter(d => d.style.display !== 'none');
            expect(open).toHaveLength(1);
            expect(open[0].querySelector('.feature-badge-details').textContent).toBe('Ward 4');
        });

        it("collapses the chip's icon into the full layer-info row above the label once expanded", () => {
            const manager = makeManager({ layers: [{ id: 'plots', title: 'Plots' }] });
            const features = [feature('plots', { id: '17/1' })];
            const el = mount(manager, features);
            const chip = el.querySelector('.marker-summary-chip');
            const icon = chip.querySelector('.marker-summary-chip__icon');
            const layerRow = chip.querySelector('.marker-layer-info-row');
            const value = chip.querySelector('.marker-summary-chip__value');

            // Collapsed: just the small icon beside the value, no layer row.
            expect(icon.style.visibility).not.toBe('hidden');
            expect(layerRow.style.display).toBe('none');

            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            // `visibility`, not `display: none` - the icon keeps its place in
            // the row so the value beside it doesn't shift left to fill the gap.
            expect(icon.style.visibility).toBe('hidden');
            expect(layerRow.style.display).toBe('flex');
            // Above the value, not below it.
            expect(layerRow.compareDocumentPosition(value)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(icon.style.visibility).toBe('visible');
            expect(layerRow.style.display).toBe('none');
        });

        it("opens map-information.html for the layer and feature when its layer-info row is clicked", () => {
            const manager = makeManager({ layers: [{ id: 'plots', title: 'Plots' }] });
            const features = [feature('plots', { id: '17/1' })];
            const el = mount(manager, features);
            const chip = el.querySelector('.marker-summary-chip');
            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            const posted = vi.fn();
            const originalPostMessage = window.postMessage;
            window.postMessage = posted;
            try {
                chip.querySelector('.marker-layer-info-row')
                    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
            } finally {
                window.postMessage = originalPostMessage;
            }

            expect(posted).toHaveBeenCalledTimes(1);
            const message = posted.mock.calls[0][0];
            expect(message.type).toBe('open-layer-info');
            expect(message.layer.id).toBe('plots');
            expect(message.feature.properties.id).toBe('17/1');
        });

        it('marks the active row and rotates its chevron open while expanded', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            const chip = el.querySelector('.marker-summary-chip');

            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(chip.style.borderColor).toBe('rgb(59, 130, 246)');
            expect(chip.getAttribute('aria-expanded')).toBe('true');
            expect(chip.querySelector('.marker-summary-chevron').getAttribute('name')).toBe('chevron-down');
        });

        it("carries the chip's own active fill down into its property list, so the two read as one block", () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            const chip = el.querySelector('.marker-summary-chip');
            const details = el.querySelector('.marker-summary-details');

            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(details.style.background).toBe(chip.style.background);

            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(details.style.background).toBe('transparent');
        });

        it('collapses again when the same row is clicked a second time', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            const chip = el.querySelector('.marker-summary-chip');
            const details = el.querySelector('.marker-summary-details');

            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(details.style.display).toBe('none');
            expect(chip.style.borderColor).toBe('transparent');
            expect(chip.getAttribute('aria-expanded')).toBe('false');
            expect(chip.querySelector('.marker-summary-chevron').getAttribute('name')).toBe('chevron-right');
        });

        it('collapses every open row when the marker itself closes', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            // appendChild, not innerHTML += : re-parsing the element would throw
            // away every listener mount() just attached.
            const body = document.createElement('div');
            body.className = 'marker-menu-body';
            el.appendChild(body);

            const chip = el.querySelector('.marker-summary-chip');
            const details = el.querySelector('.marker-summary-details');
            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(details.style.display).toBe('block');

            manager._syncMarkerContent(el);

            expect(details.style.display).toBe('none');
            expect(chip.getAttribute('aria-expanded')).toBe('false');
        });

        it('shows the reverse-geocoded address for the address chip', () => {
            const manager = makeManager();
            const el = mount(manager, []);

            el.querySelector('.marker-summary-chip--address').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(el.querySelector('.marker-summary-details').style.display).toBe('block');
            expect(manager._fillAddressDetails).toHaveBeenCalled();
        });
    });

    describe('quick property filter', () => {
        function mount(manager, features, { markerId = 'm1' } = {}) {
            const el = document.createElement('div');
            el.innerHTML = `
                <div class="marker-content">
                    ${manager._buildMarkerSummaryHTML(features, LNG_LAT)}
                </div>
            `;
            host.appendChild(el);
            manager._markers.set(markerId, { id: markerId, urlId: '1', lngLat: LNG_LAT, marker: { getElement: () => el } });
            manager._attachMarkerSummaryHandlers(el, features, LNG_LAT);
            return el;
        }

        /** A fake mapbox map: just enough of getStyle/getFilter/setFilter to exercise the filter logic. */
        function makeMap(styleLayers) {
            const filters = new Map();
            return {
                getStyle: () => ({ layers: styleLayers }),
                getFilter: (id) => filters.get(id),
                setFilter: (id, filter) => filters.set(id, filter),
                _filters: filters
            };
        }

        /** Row for `key`, inside a feature's expanded details. */
        function rowFor(el, key) {
            return [...el.querySelectorAll('.feature-row')].find(r => r.dataset.fieldKey === key);
        }

        const originalLayerControl = window.layerControl;
        const originalUrlManager = window.urlManager;
        afterEach(() => {
            window.layerControl = originalLayerControl;
            window.urlManager = originalUrlManager;
        });

        it("filters to inspect.id's own value the moment the row opens", () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot', 'survey'], fieldTitles: ['Plot', 'Survey'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            const el = mount(manager, [feature('plots', { plot: '17/1', survey: '17' })]);

            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(manager._map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'plot'], '17/1']]);
        });

        it('clicking a row selects it and copies its key\\tvalue to the clipboard, without touching the filter', () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot', 'survey'], fieldTitles: ['Plot', 'Survey'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            const el = mount(manager, [feature('plots', { plot: '17/1', survey: 17 })]);
            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            const writeText = vi.fn().mockResolvedValue();
            Object.assign(navigator, { clipboard: { writeText } });

            const surveyRow = rowFor(el, 'survey');
            surveyRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(writeText).toHaveBeenCalledWith('survey\t17');
            expect(surveyRow.style.background).toBe('rgb(30, 58, 95)');
            // Merely selecting it is not itself a filter action.
            expect(manager._map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'plot'], '17/1']]);
        });

        it('offers only Replace Filter on another row while the filter is still just inspect.id', () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot', 'survey'], fieldTitles: ['Plot', 'Survey'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            const el = mount(manager, [feature('plots', { plot: '17/1', survey: '17' })]);
            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };

            const surveyRow = rowFor(el, 'survey');
            surveyRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(surveyRow.querySelector('[data-action="replace"]').style.display).toBe('inline-flex');
            expect(surveyRow.querySelector('[data-action="add"]').style.display).toBe('none');
        });

        it('offers both actions on another row once the filter has actually been replaced with something else', () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot', 'survey', 'district'], fieldTitles: ['Plot', 'Survey', 'District'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            const el = mount(manager, [feature('plots', { plot: '17/1', survey: '17', district: '01' })]);
            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };

            const surveyRow = rowFor(el, 'survey');
            surveyRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            surveyRow.querySelector('[data-action="replace"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(manager._map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'survey'], '17']]);

            const districtRow = rowFor(el, 'district');
            districtRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(districtRow.querySelector('[data-action="replace"]').style.display).toBe('inline-flex');
            expect(districtRow.querySelector('[data-action="add"]').style.display).toBe('inline-flex');

            districtRow.querySelector('[data-action="add"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(manager._map._filters.get('plots-fill')).toEqual([
                'all', ['==', ['get', 'survey'], '17'], ['==', ['get', 'district'], '01']
            ]);
        });

        it("offers only Remove From Filter for inspect.id's own row while it's the one active, and only Replace once it isn't", () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot', 'survey'], fieldTitles: ['Plot', 'Survey'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            const el = mount(manager, [feature('plots', { plot: '17/1', survey: '17' })]);
            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };

            const plotRow = rowFor(el, 'plot');
            plotRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            // inspect.id is already part of the filter - only Remove is offered.
            expect(plotRow.querySelector('.feature-row-actions').style.display).toBe('flex');
            expect(plotRow.querySelector('[data-action="replace"]').style.display).toBe('none');
            expect(plotRow.querySelector('[data-action="add"]').style.display).toBe('none');
            expect(plotRow.querySelector('[data-action="remove"]').style.display).toBe('inline-flex');

            // Replace with something else, then come back to inspect.id's row.
            const surveyRow = rowFor(el, 'survey');
            surveyRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            surveyRow.querySelector('[data-action="replace"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            plotRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(plotRow.querySelector('[data-action="replace"]').style.display).toBe('inline-flex');
            expect(plotRow.querySelector('[data-action="add"]').style.display).toBe('none');
            expect(plotRow.querySelector('[data-action="remove"]').style.display).toBe('none');
        });

        it('offers only Remove From Filter once a property has been added, and dropping it falls back to Replace/Add', () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot', 'survey', 'district'], fieldTitles: ['Plot', 'Survey', 'District'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            const el = mount(manager, [feature('plots', { plot: '17/1', survey: '17', district: '01' })]);
            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };

            const surveyRow = rowFor(el, 'survey');
            surveyRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            surveyRow.querySelector('[data-action="replace"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            const districtRow = rowFor(el, 'district');
            districtRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            districtRow.querySelector('[data-action="add"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(manager._map._filters.get('plots-fill')).toEqual([
                'all', ['==', ['get', 'survey'], '17'], ['==', ['get', 'district'], '01']
            ]);

            // Both are now part of the filter - each shows only Remove.
            surveyRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(surveyRow.querySelector('[data-action="remove"]').style.display).toBe('inline-flex');
            expect(surveyRow.querySelector('[data-action="replace"]').style.display).toBe('none');

            surveyRow.querySelector('[data-action="remove"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(manager._map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'district'], '01']]);
            // Dropped back out of the filter - Replace/Add are offered again.
            expect(surveyRow.querySelector('[data-action="remove"]').style.display).toBe('none');
            expect(surveyRow.querySelector('[data-action="replace"]').style.display).toBe('inline-flex');
        });

        it("previews Replace on hover without saving it, then commits only on click", () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot', 'survey'], fieldTitles: ['Plot', 'Survey'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            const el = mount(manager, [feature('plots', { plot: '17/1', survey: '17' })]);
            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };

            const surveyRow = rowFor(el, 'survey');
            surveyRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const committed = manager._map._filters.get('plots-fill');
            expect(committed).toEqual(['all', ['==', ['get', 'plot'], '17/1']]);

            surveyRow.dispatchEvent(new MouseEvent('mouseenter'));
            expect(manager._map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'survey'], '17']]);
            const replaceBtn = surveyRow.querySelector('[data-action="replace"]');
            expect(replaceBtn.style.background).toBe('rgba(59, 130, 246, 0.35)');

            surveyRow.dispatchEvent(new MouseEvent('mouseleave'));
            // Reverted - the preview was never saved.
            expect(manager._map._filters.get('plots-fill')).toEqual(committed);
            expect(replaceBtn.style.background).toBe('rgba(59, 130, 246, 0.15)');

            replaceBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(manager._map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'survey'], '17']]);
        });

        it('previews Add (combined with the current filter) on hover, separately from Replace', () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot', 'survey', 'district'], fieldTitles: ['Plot', 'Survey', 'District'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            const el = mount(manager, [feature('plots', { plot: '17/1', survey: '17', district: '01' })]);
            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };

            const surveyRow = rowFor(el, 'survey');
            surveyRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            surveyRow.querySelector('[data-action="replace"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            const districtRow = rowFor(el, 'district');
            districtRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            districtRow.querySelector('[data-action="add"]').dispatchEvent(new MouseEvent('mouseenter'));

            expect(manager._map._filters.get('plots-fill')).toEqual([
                'all', ['==', ['get', 'survey'], '17'], ['==', ['get', 'district'], '01']
            ]);

            districtRow.querySelector('[data-action="add"]').dispatchEvent(new MouseEvent('mouseleave'));
            // Only committed the earlier Replace, so hovering off Add drops
            // straight back to district's own Replace preview, not the
            // combined filter that was never clicked.
            expect(manager._map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'district'], '01']]);
        });

        it('previews dropping a property on hover over Remove From Filter', () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot', 'survey'], fieldTitles: ['Plot', 'Survey'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            const el = mount(manager, [feature('plots', { plot: '17/1', survey: '17' })]);
            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            navigator.clipboard = { writeText: vi.fn().mockResolvedValue() };

            const plotRow = rowFor(el, 'plot');
            plotRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const removeBtn = plotRow.querySelector('[data-action="remove"]');

            removeBtn.dispatchEvent(new MouseEvent('mouseenter'));
            // Nothing left to filter by - previews back to no filter at all
            // (the layer's own original, saved the moment the row first opened).
            expect(manager._map._filters.get('plots-fill')).toBeNull();

            removeBtn.dispatchEvent(new MouseEvent('mouseleave'));
            expect(manager._map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'plot'], '17/1']]);
        });

        it('retains the filter when the row just collapses - collapsing is not undoing it', () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot'], fieldTitles: ['Plot'] } }];
            const manager = makeManager({ layers });
            const map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            manager._map = map;
            const el = mount(manager, [feature('plots', { plot: '17/1' })]);
            const chip = el.querySelector('.marker-summary-chip');
            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'plot'], '17/1']]);

            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'plot'], '17/1']]);
        });

        it('restores the filter when an unsaved marker is destroyed outright, not collapsed first', () => {
            // The path an unsaved marker takes losing focus (_syncMarkerContent)
            // goes straight to removeMarker - never through
            // _closeAllSummaryDetails - so a filter left active by an expanded
            // row would otherwise have nothing left to restore it.
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot'], fieldTitles: ['Plot'] } }];
            const manager = makeManager({ layers });
            const map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            manager._map = map;
            const el = mount(manager, [feature('plots', { plot: '17/1' })]);
            const markerData = manager._markers.get('m1');
            markerData.features = [];
            markerData.marker.remove = () => {};
            markerData.saved = false;

            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'plot'], '17/1']]);

            manager.removeMarker('m1');

            expect(map._filters.get('plots-fill')).toBeNull();
        });

        it('retains the filter when a saved marker is removed - it is a decision about the layer by then', () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot'], fieldTitles: ['Plot'] } }];
            const manager = makeManager({ layers });
            const map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            manager._map = map;
            const el = mount(manager, [feature('plots', { plot: '17/1' })]);
            const markerData = manager._markers.get('m1');
            markerData.features = [];
            markerData.marker.remove = () => {};
            markerData.saved = true;

            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'plot'], '17/1']]);

            manager.removeMarker('m1');

            expect(map._filters.get('plots-fill')).toEqual(['all', ['==', ['get', 'plot'], '17/1']]);
        });

        it("mirrors the filter onto the layer's own config entry and syncs the URL", () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot'], fieldTitles: ['Plot'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            const group = { id: 'plots' };
            window.layerControl = { _state: { groups: [group] } };
            const updateURL = vi.fn();
            window.urlManager = { updateURL };

            const el = mount(manager, [feature('plots', { plot: '17/1' })]);
            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(group.filter).toEqual(['all', ['==', ['get', 'plot'], '17/1']]);
            expect(updateURL).toHaveBeenCalledWith({ updateLayers: true });
        });

        it("drops the config entry's filter (rather than leaving it null) once the layer's original filter is restored", () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot'], fieldTitles: ['Plot'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            // No `filter` to begin with - the common case for a layer nobody
            // has authored one for.
            const group = { id: 'plots' };
            window.layerControl = { _state: { groups: [group] } };
            window.urlManager = { updateURL: vi.fn() };

            const el = mount(manager, [feature('plots', { plot: '17/1' })]);
            const chip = el.querySelector('.marker-summary-chip');
            chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(group.filter).toBeDefined();

            const markerData = manager._markers.get('m1');
            markerData.features = [];
            markerData.marker.remove = () => {};
            markerData.saved = false;
            manager.removeMarker('m1');

            expect('filter' in group).toBe(false);
        });

        it("restores a layer's own authored filter, not just clears it, once its marker is removed", () => {
            const layers = [{ id: 'plots', inspect: { id: 'plot', fields: ['plot'], fieldTitles: ['Plot'] } }];
            const manager = makeManager({ layers });
            manager._map = makeMap([{ id: 'plots-fill', metadata: { groupId: 'plots' } }]);
            const authoredFilter = ['==', ['get', 'district'], '01'];
            const group = { id: 'plots', filter: authoredFilter };
            window.layerControl = { _state: { groups: [group] } };
            window.urlManager = { updateURL: vi.fn() };

            const el = mount(manager, [feature('plots', { plot: '17/1' })]);
            el.querySelector('.marker-summary-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(group.filter).toEqual(['all', ['==', ['get', 'plot'], '17/1']]);

            const markerData = manager._markers.get('m1');
            markerData.features = [];
            markerData.marker.remove = () => {};
            markerData.saved = false;
            manager.removeMarker('m1');

            expect(group.filter).toBe(authoredFilter);
        });
    });

    describe('name-picker widget', () => {
        function mount(manager, features, { markerId = 'm1', urlId = '1', saved = true, address = null } = {}) {
            const el = document.createElement('div');
            el.innerHTML = `
                <div class="marker-content">
                    ${manager._buildMarkerMenuHeaderHTML(urlId, saved)}
                    <div class="marker-menu-body" style="display:none">
                        ${manager._buildMarkerSummaryHTML(features, LNG_LAT)}
                    </div>
                </div>
            `;
            host.appendChild(el);
            manager._markers.set(markerId, {
                id: markerId, urlId, lngLat: LNG_LAT, saved, features, badgeFeatures: features, address,
                marker: { getElement: () => el }
            });
            manager.removeMarker = vi.fn();
            manager._attachMarkerSummaryHandlers(el, features, LNG_LAT);
            manager._attachMarkerIdRowHandlers(el, markerId);
            return el;
        }

        const picks = (el) => [...el.querySelectorAll('.marker-summary-pick')];

        it('hides the checkboxes until the id is being edited', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);

            expect(picks(el)[0].style.display).toBe('none');

            openEditor(el);
            expect(picks(el)[0].style.display).toBe('inline-block');

            el.querySelector('.marker-id-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(picks(el)[0].style.display).toBe('none');
        });

        it('keeps focus on the id textarea instead of letting the press blur it into discarding the edit', () => {
            // A checkbox is focusable, so an ordinary click would first move
            // focus onto it - blurring the id textarea, which discards the
            // whole edit (see discard()) before the checkbox's own `change`
            // handler ever runs. The press has to preventDefault to stop that,
            // the same way wireEditAction's save/delete/clear buttons already do.
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            openEditor(el);
            const [plotPick] = picks(el);

            const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            plotPick.dispatchEvent(mousedown);

            expect(mousedown.defaultPrevented).toBe(true);
            // The editor is still open - nothing was discarded.
            expect(el.querySelector('.marker-id-input').hidden).toBe(false);
        });

        it('offers a checkbox for the address row too, appending its resolved text once picked', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })], { address: { text: 'Assagao, Bardez' } });
            openEditor(el);
            const input = el.querySelector('.marker-id-input');

            const addressItem = el.querySelector('.marker-summary-chip--address').closest('.marker-summary-item');
            const addressPick = addressItem.querySelector('.marker-summary-pick');
            expect(addressPick).not.toBeNull();

            addressPick.checked = true;
            addressPick.dispatchEvent(new Event('change'));
            expect(input.value).toBe('Assagao, Bardez');
        });

        it('does not append anything for an address checked before it has resolved', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            // No `address` - still "Locating…" when the box is checked.
            const el = mount(manager, [feature('plots', { id: '17/1' })]);
            openEditor(el);
            const input = el.querySelector('.marker-id-input');

            const addressPick = el.querySelector('.marker-summary-chip--address')
                .closest('.marker-summary-item').querySelector('.marker-summary-pick');
            addressPick.checked = true;
            addressPick.dispatchEvent(new Event('change'));

            expect(input.value).toBe('');
        });

        it("appends a checked row's label to the id, hyphen-separated, in check order", () => {
            const manager = makeManager({ layers: [{ id: 'plots' }, { id: 'wards' }] });
            const features = [feature('plots', { id: '17/1' }), feature('wards', { id: 'Ward 4' })];
            const el = mount(manager, features);
            openEditor(el);
            const input = el.querySelector('.marker-id-input');
            const [plotPick, wardPick] = picks(el);

            wardPick.checked = true;
            wardPick.dispatchEvent(new Event('change'));
            expect(input.value).toBe('Ward 4');

            plotPick.checked = true;
            plotPick.dispatchEvent(new Event('change'));
            // Checked second, so it lands after - not sorted back into row order.
            expect(input.value).toBe('Ward 4-17/1');
        });

        it('drops just the unchecked name, leaving no stray separator behind', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }, { id: 'wards' }] });
            const features = [feature('plots', { id: '17/1' }), feature('wards', { id: 'Ward 4' })];
            const el = mount(manager, features);
            openEditor(el);
            const input = el.querySelector('.marker-id-input');
            const [plotPick, wardPick] = picks(el);

            plotPick.checked = true;
            plotPick.dispatchEvent(new Event('change'));
            wardPick.checked = true;
            wardPick.dispatchEvent(new Event('change'));
            expect(input.value).toBe('17/1-Ward 4');

            plotPick.checked = false;
            plotPick.dispatchEvent(new Event('change'));
            expect(input.value).toBe('Ward 4');
        });

        it('pre-checks the rows an existing id was built from', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }, { id: 'wards' }] });
            const features = [feature('plots', { id: '17/1' }), feature('wards', { id: 'Ward 4' })];
            // Matches sanitizeId('17/1-Ward 4') exactly.
            const el = mount(manager, features, { urlId: '17/1-Ward_4' });

            openEditor(el);

            const [plotPick, wardPick] = picks(el);
            expect(plotPick.checked).toBe(true);
            expect(wardPick.checked).toBe(true);
        });

        it('pre-checks the address too when the id was built including it', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const features = [feature('plots', { id: '17/1' })];
            // Matches sanitizeId('17/1-Assagao') exactly - the address always
            // comes last, same as its row.
            const el = mount(manager, features, { urlId: '17/1-Assagao', address: { text: 'Assagao' } });

            openEditor(el);

            const [plotPick, addressPick] = picks(el);
            expect(plotPick.checked).toBe(true);
            expect(addressPick.checked).toBe(true);
        });

        it('leaves the picks unchecked when the id does not match any combination', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }] });
            const el = mount(manager, [feature('plots', { id: '17/1' })], { urlId: 'home' });

            openEditor(el);

            expect(picks(el)[0].checked).toBe(false);
        });

        it('lets an already-detected pick be unchecked to drop it', () => {
            const manager = makeManager({ layers: [{ id: 'plots' }, { id: 'wards' }] });
            const features = [feature('plots', { id: '17/1' }), feature('wards', { id: 'Ward 4' })];
            const el = mount(manager, features, { urlId: '17/1-Ward_4' });
            openEditor(el);
            const input = el.querySelector('.marker-id-input');
            const [plotPick] = picks(el);

            plotPick.checked = false;
            plotPick.dispatchEvent(new Event('change'));

            expect(input.value).toBe('Ward 4');
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

        describe('typing a duplicate id', () => {
            afterEach(() => markerRegistry.setAll([]));

            it('disables the save button and explains why, and outlines the input in error color', () => {
                markerRegistry.setAll([{ id: 'shop', lng: 0, lat: 0 }]);
                const manager = makeManager();
                const el = mountIdRow(manager, 'm1', 'home');
                const saveBtn = el.querySelector('.marker-id-save');
                const input = el.querySelector('.marker-id-input');

                openEditor(el);
                input.value = 'shop';
                input.dispatchEvent(new Event('input'));

                expect(saveBtn.disabled).toBe(true);
                expect(saveBtn.title).toBe('Cannot save duplicate label');
                expect(input.style.borderColor).toBe('rgb(239, 68, 68)');
            });

            it('re-enables it once the text no longer collides', () => {
                markerRegistry.setAll([{ id: 'shop', lng: 0, lat: 0 }]);
                const manager = makeManager();
                const el = mountIdRow(manager, 'm1', 'home');
                const saveBtn = el.querySelector('.marker-id-save');
                const input = el.querySelector('.marker-id-input');

                openEditor(el);
                input.value = 'shop';
                input.dispatchEvent(new Event('input'));
                input.value = 'shopfront';
                input.dispatchEvent(new Event('input'));

                expect(saveBtn.disabled).toBe(false);
                expect(saveBtn.title).toBe('Save id (Enter)');
                expect(input.style.borderColor).not.toBe('rgb(239, 68, 68)');
            });

            it('does not flag the marker\'s own current id as a duplicate of itself', () => {
                markerRegistry.setAll([{ id: 'home', lng: 0, lat: 0 }]);
                const manager = makeManager();
                const el = mountIdRow(manager, 'm1', 'home');
                const saveBtn = el.querySelector('.marker-id-save');

                openEditor(el);

                expect(saveBtn.disabled).toBe(false);
            });

            it('does nothing on Enter while a duplicate is showing, rather than renaming to it', () => {
                markerRegistry.setAll([{ id: 'shop', lng: 0, lat: 0 }]);
                const manager = makeManager();
                const el = mountIdRow(manager, 'm1', 'home');
                const input = el.querySelector('.marker-id-input');
                manager.renameMarkerUrlId = vi.fn();

                openEditor(el);
                input.value = 'shop';
                input.dispatchEvent(new Event('input'));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

                expect(manager.renameMarkerUrlId).not.toHaveBeenCalled();
                expect(input.hidden).toBe(false);
            });

            it('clears the disabled state and the outline once the edit ends', () => {
                markerRegistry.setAll([{ id: 'shop', lng: 0, lat: 0 }]);
                const manager = makeManager();
                const el = mountIdRow(manager, 'm1', 'home');
                const saveBtn = el.querySelector('.marker-id-save');
                const input = el.querySelector('.marker-id-input');

                openEditor(el);
                input.value = 'shop';
                input.dispatchEvent(new Event('input'));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

                expect(saveBtn.disabled).toBe(false);
                expect(input.style.borderColor).not.toBe('rgb(239, 68, 68)');
            });
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

        it('gives the input a minimum width and a clear button', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');

            expect(el.querySelector('.marker-id-input').style.minWidth).toBe('140px');

            const clearBtn = el.querySelector('.marker-id-clear');
            expect(clearBtn.style.display).toBe('none');

            openEditor(el);
            expect(clearBtn.style.display).toBe('flex');

            el.querySelector('.marker-id-input').value = 'something';
            clearBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(el.querySelector('.marker-id-input').value).toBe('');
            expect(document.activeElement).toBe(el.querySelector('.marker-id-input'));
        });

        it('uses a plain x icon for the clear button, placed inside the input', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const wrap = el.querySelector('.marker-id-input-wrap');
            const input = wrap.querySelector('.marker-id-input');
            const clearBtn = wrap.querySelector('.marker-id-clear');

            expect(clearBtn.querySelector('sl-icon').getAttribute('name')).toBe('x');
            // "Inside" the input: an absolutely-positioned overlay sharing the
            // input's own relatively-positioned wrapper, not a separate cell
            // in the header row.
            expect(wrap.style.position).toBe('relative');
            expect(clearBtn.style.position).toBe('absolute');
            expect(wrap.contains(input)).toBe(true);
            expect(wrap.contains(clearBtn)).toBe(true);
        });

        it('wraps to a second line instead of growing past the input\'s own max-width', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');

            expect(input.style.whiteSpace).toBe('pre-wrap');
            expect(input.style.overflowWrap).toBe('break-word');
            expect(parseInt(input.style.maxWidth, 10)).toBeGreaterThan(0);
        });

        it('keeps the id textarea within the balloon\'s own box model, so it never renders wider than the popup', () => {
            const manager = makeManager();
            const el = mountIdRow(manager, 'm1', 'home');
            const input = el.querySelector('.marker-id-input');

            openEditor(el);

            const contentMaxWidth = parseInt(el.querySelector('.marker-content').style.maxWidth, 10);
            const inputOuterWidth = parseInt(input.style.maxWidth, 10)
                + 18 /* padding-right, reserved for the clear icon */
                + 3 /* the shared label's padding-left */
                + 2 /* 1px border on both sides */;

            expect(inputOuterWidth).toBeLessThan(contentMaxWidth);
        });
    });

    describe('a not-yet-named marker\'s placeholder', () => {
        function mountRow(manager, { markerId = 'm1', urlId = '1', saved = false, address = null } = {}) {
            const el = document.createElement('div');
            el.innerHTML = `
                <div class="marker-content">
                    ${manager._buildMarkerMenuHeaderHTML(urlId, saved)}
                    <div class="marker-menu-body" style="display:none"></div>
                </div>
            `;
            host.appendChild(el);
            manager._markers.set(markerId, { id: markerId, urlId, lngLat: LNG_LAT, address, marker: { getElement: () => el } });
            manager.removeMarker = vi.fn();
            manager._attachMarkerIdRowHandlers(el, markerId);
            return el;
        }

        it('shows "Click to save label" instead of the bare auto-numbered id', () => {
            const manager = makeManager();
            const el = mountRow(manager, { urlId: '3' });

            expect(el.querySelector('.marker-id-text').textContent).toBe('Click to save label');
        });

        it('opens the editor on a single click, skipping the usual arm step', () => {
            const manager = makeManager();
            const el = mountRow(manager, { urlId: '3' });

            el.querySelector('.marker-id-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(el.querySelector('.marker-id-input').hidden).toBe(false);
        });

        it('prefills the editor from the resolved address name rather than the bare id', () => {
            const manager = makeManager();
            const el = mountRow(manager, { urlId: '3', address: { name: 'Assagao Church' } });

            el.querySelector('.marker-id-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(el.querySelector('.marker-id-input').value).toBe('Assagao Church');
        });

        it('falls back to displayName\'s leading part when the address matched no named POI', () => {
            const manager = makeManager();
            const el = mountRow(manager, {
                urlId: '3',
                address: { name: null, displayName: 'Fontainhas, Panaji, North Goa, Goa, 403001, India' }
            });

            el.querySelector('.marker-id-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(el.querySelector('.marker-id-input').value).toBe('Fontainhas');
        });

        it('falls back to the bare id when no address name has resolved yet', () => {
            const manager = makeManager();
            const el = mountRow(manager, { urlId: '3' });

            el.querySelector('.marker-id-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(el.querySelector('.marker-id-input').value).toBe('3');
        });

        it('does not source the default label from the address once the id is not a bare number', () => {
            const manager = makeManager();
            const el = mountRow(manager, { urlId: 'home', saved: true, address: { name: 'Assagao Church' } });

            openEditor(el);

            expect(el.querySelector('.marker-id-input').value).toBe('home');
        });

        it('mutes the placeholder\'s text color', () => {
            const manager = makeManager();
            const el = mountRow(manager, { urlId: '3' });

            expect(el.querySelector('.marker-id-badge').style.color).toBe('rgb(107, 114, 128)');
        });

        it('does not mute an already-named badge', () => {
            const manager = makeManager();
            const el = mountRow(manager, { urlId: 'home', saved: true });

            expect(el.querySelector('.marker-id-badge').style.color).toBe('rgb(243, 244, 246)');
        });

        it('already saves the marker under its default label the moment the editor opens', () => {
            const manager = makeManager();
            const el = mountRow(manager, { urlId: '3', address: { name: 'Assagao Church' } });
            manager.renameMarkerUrlId = vi.fn((id, next) => {
                manager._markers.get(id).urlId = next;
                return true;
            });

            el.querySelector('.marker-id-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(manager.renameMarkerUrlId).toHaveBeenCalledWith('m1', 'Assagao_Church');
            expect(manager._markers.get('m1').saved).toBe(true);
        });

        it('still offers the save button after that auto-save, in case they type over it', () => {
            const manager = makeManager();
            const el = mountRow(manager, { urlId: '3', address: { name: 'Assagao Church' } });
            manager.renameMarkerUrlId = vi.fn((id, next) => {
                manager._markers.get(id).urlId = next;
                return true;
            });

            el.querySelector('.marker-id-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }));

            expect(el.querySelector('.marker-id-save').style.display).toBe('flex');
        });

        it('survives an abandoned edit, since the placeholder already committed a name', () => {
            const manager = makeManager();
            const el = mountRow(manager, { urlId: '3', address: { name: 'Assagao Church' } });
            manager.removeMarker = vi.fn();
            manager.renameMarkerUrlId = vi.fn((id, next) => {
                manager._markers.get(id).urlId = next;
                return true;
            });

            el.querySelector('.marker-id-badge').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            el.querySelector('.marker-id-input').dispatchEvent(new Event('blur'));

            expect(manager.removeMarker).not.toHaveBeenCalled();
        });
    });

    describe('an unsaved marker that loses focus', () => {
        function mountMarker(manager, markerId, { saved = false } = {}) {
            const el = document.createElement('div');
            el.className = 'selection-marker';
            el.innerHTML = `<div class="marker-content">${manager._buildMarkerMenuHeaderHTML('1', saved)}<div class="marker-menu-body" style="display:none"></div></div>`;
            host.appendChild(el);
            manager._markers.set(markerId, {
                id: markerId, urlId: '1', lngLat: LNG_LAT, saved, features: [],
                marker: { getElement: () => el, remove: () => el.remove() }
            });
            return el;
        }

        it('is removed outright once deselected, rather than left as a collapsed chip', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'm1');
            manager._selectMarker('m1');
            expect(manager._markers.has('m1')).toBe(true);

            manager._selectMarker(null);

            expect(manager._markers.has('m1')).toBe(false);
            expect(el.isConnected).toBe(false);
        });

        it('is removed once hovering off it too, with nothing else taking focus', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'm1');
            el.dataset.markerHover = '1';
            manager._syncMarkerContent(el, 'm1');
            expect(manager._markers.has('m1')).toBe(true);

            delete el.dataset.markerHover;
            manager._syncMarkerContent(el, 'm1');

            expect(manager._markers.has('m1')).toBe(false);
        });

        it('leaves a saved marker alone, collapsing it to a chip instead', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'm1', { saved: true });
            manager._selectMarker('m1');

            manager._selectMarker(null);

            expect(manager._markers.has('m1')).toBe(true);
            expect(el.isConnected).toBe(true);
            expect(el.querySelector('.marker-menu-body').style.display).toBe('none');
        });

        it('is not torn out from under an active rename by some other marker taking focus', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'm1');
            manager._attachMarkerIdRowHandlers(el, 'm1');
            manager._selectMarker('m1');
            el._startIdEdit({ initial: true });

            const other = document.createElement('div');
            manager._markers.set('m2', {
                id: 'm2', urlId: '2', lngLat: LNG_LAT, saved: true, features: [],
                marker: { getElement: () => other, remove: () => {} }
            });
            manager._selectMarker('m2');

            expect(manager._markers.has('m1')).toBe(true);
        });
    });

    describe('marker select mode', () => {
        function mountMarker(manager, markerId, urlId) {
            const el = document.createElement('div');
            el.innerHTML = `<div class="marker-content">${manager._buildMarkerMenuHeaderHTML(urlId)}<div class="marker-menu-body" style="display:none"></div></div>`;
            host.appendChild(el);
            manager._markers.set(markerId, { id: markerId, urlId, lngLat: LNG_LAT, saved: true, marker: { getElement: () => el } });
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

        it('fills the selected marker in more solidly than an unselected one', () => {
            const manager = makeManager();
            const a = mountMarker(manager, 'a', '1');
            const b = mountMarker(manager, 'b', '2');

            manager._selectMarker('a');
            expect(a.querySelector('.marker-content').style.background).toBe('rgba(31, 41, 55, 0.9)');
            expect(b.querySelector('.marker-content').style.background).toBe('rgba(31, 41, 55, 0.7)');

            manager._selectMarker(null);
            expect(a.querySelector('.marker-content').style.background).toBe('rgba(31, 41, 55, 0.7)');
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

        it('still previews the actions when the marker itself is hovered, not selected', () => {
            const manager = makeManager();
            const el = mountMarker(manager, 'a', '1');
            const actions = el.querySelector('.marker-id-shortcuts');

            // Hovering the marker (set by addMarker's own mouseenter/mouseleave,
            // simulated directly here) previews the actions same as selecting it.
            el.dataset.markerHover = '1';
            manager._syncIdActions(el);
            expect(actions.style.display).toBe('flex');

            delete el.dataset.markerHover;
            manager._syncIdActions(el);
            expect(actions.style.display).toBe('none');
        });

        it('needs the marker hovered or selected even on touch - a collapsed chip shows only its label', () => {
            const manager = makeManager({ isTouch: true });
            const el = mountMarker(manager, 'a', '1');
            expect(el.querySelector('.marker-id-shortcuts').style.display).toBe('none');

            manager._selectMarker('a');
            expect(el.querySelector('.marker-id-shortcuts').style.display).toBe('flex');
        });
    });

    describe('focus is released by pressing away', () => {
        function mountMarker(manager, markerId) {
            const el = document.createElement('div');
            el.className = 'selection-marker';
            el.innerHTML = `<div class="marker-content">${manager._buildMarkerMenuHeaderHTML('1')}<div class="marker-menu-body" style="display:none"></div></div>`;
            host.appendChild(el);
            manager._markers.set(markerId, { id: markerId, urlId: '1', lngLat: LNG_LAT, saved: true, marker: { getElement: () => el } });
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

        it('offsets the panel when dragged by its move handle while focused', () => {
            const manager = makeManager();
            const { el, contentEl } = mountDraggable(manager);
            el.classList.add('marker-selected');

            drag(el.querySelector('.marker-id-move'), 40, 30);

            expect(manager._markers.get('m1').panelOffset).toEqual({ x: 56, y: 46 });
            expect(contentEl.style.transform).toContain('translate(56px, 46px)');
        });

        it('does not drag via the move handle unless the marker is focused', () => {
            const manager = makeManager();
            const { el, contentEl } = mountDraggable(manager);
            // Not selected.

            drag(el.querySelector('.marker-id-move'), 40, 30);

            expect(manager._markers.get('m1').panelOffset).toEqual({ x: 16, y: 16 });
            expect(contentEl.style.transform).not.toContain('translate3d');
        });

        it('no longer drags from the header/badge - only the move handle arms it', () => {
            const manager = makeManager();
            const { el, contentEl } = mountDraggable(manager);
            el.classList.add('marker-selected');

            drag(el.querySelector('.marker-id-badge'), 40, 30);

            expect(manager._markers.get('m1').panelOffset).toEqual({ x: 16, y: 16 });
            expect(contentEl.style.transform).not.toContain('translate3d');
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

        it('marks the tail as the handle for the marker itself, but only once expanded', () => {
            const manager = makeManager();
            const { el, tail } = mountDraggable(manager);

            // The surface spans 1200px in every direction, so only the triangle
            // drawn on it may ever hit-test - and it says so with a move cursor.
            expect(el.querySelector('.marker-leader').style.pointerEvents).toBe('none');
            expect(tail.style.cursor).toBe('move');
            // 4px of paint is too fine to aim at, so an invisible stroke widens
            // the target without widening the tail.
            expect(tail.getAttribute('stroke')).toBe('transparent');
            expect(Number(tail.getAttribute('stroke-width'))).toBeGreaterThan(4);

            // Collapsed by default - a press glancing off it must not relocate
            // the marker until it's the one in focus (see _syncMarkerContent).
            expect(tail.style.pointerEvents).toBe('none');

            // appendChild, not innerHTML += : re-parsing the element would throw
            // away every listener mount() just attached.
            const body = document.createElement('div');
            body.className = 'marker-menu-body';
            el.appendChild(body);
            el.classList.add('marker-selected');
            manager._syncMarkerContent(el, 'm1');

            expect(tail.style.pointerEvents).toBe('auto');
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

        it('does not select the marker off the click a real drag still produces on release', () => {
            const manager = makeManager();
            const { el, contentEl } = mountDraggable(manager);
            el.classList.add('marker-selected');

            // Stands in for addMarker's own click->select listener on the
            // marker element (also capture-phase) - a fix that only stopped
            // propagation on contentEl, a descendant visited later in the
            // capture phase, would already be too late to catch this.
            const select = vi.fn();
            el.addEventListener('click', select, true);

            drag(el.querySelector('.marker-id-move'), 40, 30);
            // A real drag still ends with mousedown and mouseup sharing the
            // same target, so the browser fires an ordinary click right after -
            // `drag()` only replays the mouse events, so it is dispatched here.
            contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

            expect(select).not.toHaveBeenCalled();
        });
    });

    describe('balloon placement', () => {
        it('hangs the balloon down and right of the clicked point', () => {
            const manager = makeManager();
            // The clicked point is the marker's own top-left corner, and the
            // panel clears it on both axes by the anchor gap.
            expect(manager.getContentOffset()).toEqual({ x: 16, y: 56 });
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
            manager._markers.set(markerId, { id: markerId, urlId: '1', lngLat: LNG_LAT, saved: true, marker: { getElement: () => el } });
            manager.removeMarker = vi.fn();
            manager._attachMarkerIdRowHandlers(el, markerId);
            return el;
        }

        it('reveals the actions once the marker is hovered or selected, and hides them again once it is not', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const actions = el.querySelector('.marker-id-shortcuts');

            el.dataset.markerHover = '1';
            manager._syncIdActions(el);
            expect(actions.style.display).toBe('flex');

            delete el.dataset.markerHover;
            manager._syncIdActions(el);
            expect(actions.style.display).toBe('none');
        });

        it('hides the options button while the id is being edited - save/delete cover it instead', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);

            openEditor(el);
            el.querySelector('.marker-menu-header').dispatchEvent(new Event('mouseleave'));

            expect(el.querySelector('.marker-id-shortcuts').style.display).toBe('none');
            expect(el.querySelector('.marker-id-save').style.display).toBe('flex');
            expect(el.querySelector('.marker-id-delete').style.display).toBe('flex');
        });

        it('hides the options button while editing even on touch, which otherwise shows it permanently', () => {
            const manager = makeManager({ isTouch: true });
            const el = mountIdRow(manager);

            openEditor(el);

            expect(el.querySelector('.marker-id-shortcuts').style.display).toBe('none');
        });

        it('needs the marker hovered or selected even on touch - a collapsed chip shows only its label', () => {
            const manager = makeManager({ isTouch: true });
            const el = mountIdRow(manager);
            expect(el.querySelector('.marker-id-shortcuts').style.display).toBe('none');

            manager._selectMarker('m1');
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

        it('collapses any expanded accordion row when the balloon folds up', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const details = document.createElement('div');
            details.className = 'marker-summary-details';
            details.style.display = 'block';
            el.querySelector('.marker-content').appendChild(details);

            manager._selectMarker(null);

            expect(details.style.display).toBe('none');
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

        it('caps a long id at a fixed width rather than running off the map', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const badge = el.querySelector('.marker-id-badge');

            expect(badge.style.maxWidth).toBe('240px');
            // Wraps onto another line instead of ellipsising - the full id
            // stays visible, and reachable as a tooltip too either way.
            expect(badge.style.whiteSpace).toBe('normal');
            expect(badge.title).toBe('1');
        });

        it('keeps the same wrapping cap whether collapsed or expanded', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);
            const badge = el.querySelector('.marker-id-badge');

            manager._selectMarker('m1');
            expect(badge.style.maxWidth).toBe('240px');

            manager._selectMarker(null);
            expect(badge.style.maxWidth).toBe('240px');
        });

        it('gives the id textarea more room than the ordinary menu cap while it is open', () => {
            const manager = makeManager();
            const el = mountIdRow(manager);

            openEditor(el);

            expect(el.querySelector('.marker-content').style.maxWidth).toBe('320px');

            el.querySelector('.marker-id-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

            expect(el.querySelector('.marker-content').style.maxWidth).toBe('240px');
        });
    });
});

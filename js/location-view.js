/**
 * The place menu's Map view tab (js/map-location-menu-control.js): the camera
 * and the 3D terrain, every value a scrub (js/value-scrub.js) you drag, type
 * or double-click back to its default.
 *
 * - Camera: the centre and zoom, then bearing, pitch and perspective (the
 *   field of view), and Reset to look straight down, north up.
 * - 3D terrain: on or off, its vertical scale and source, and the layers that
 *   go with relief - buildings (from either vendor), contours, hillshade.
 * - More: the terrain mesh, fog, orbiting, terrain that dances to the
 *   microphone, and pitch that follows the device's tilt.
 *
 * Terrain state lives in js/terrain-3d-control.js (window.terrain3DControl),
 * which also owns the URL parameters; this tab follows it through onChange()
 * and the camera through the map's move events.
 */
import { createScrub } from './value-scrub.js';
import { BUILDING_SOURCES } from './terrain-3d-control.js';
import { trackEvent } from './analytics.js';

const RAD = Math.PI / 180;
const DEFAULT_FOV = 0.643;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function switchButton(label, title, onToggle) {
    const button = el('button', 'place-switch');
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.title = title;
    button.innerHTML = '<span class="place-switch-track" aria-hidden="true"></span>';
    button.append(el('span', null, label));
    button.addEventListener('click', () => onToggle(button.getAttribute('aria-checked') !== 'true'));
    return button;
}

function chip(label, title, onToggle) {
    const button = el('button', 'place-chip', label);
    button.type = 'button';
    button.title = title;
    button.addEventListener('click', () => onToggle(button.getAttribute('aria-pressed') !== 'true'));
    return button;
}

function select(label, options, onChange) {
    const node = el('select', 'place-select');
    node.setAttribute('aria-label', label);
    options.forEach(({ id, name }) => node.appendChild(Object.assign(el('option', null, name), { value: id })));
    node.addEventListener('change', () => onChange(node.value));
    return node;
}

function compartment(title, ...headExtras) {
    const box = el('section', 'place-compartment place-view-box');
    box.setAttribute('aria-label', title);
    const head = el('div', 'place-compartment-title place-view-head');
    head.append(el('span', null, title), ...headExtras);
    box.appendChild(head);
    return box;
}

/**
 * @param {HTMLElement} panel - the tab's panel
 * @param {Object} map
 * @returns {{refresh: () => void, destroy: () => void}}
 */
export function buildViewPanel(panel, map) {
    const terrain = window.terrain3DControl;

    // Camera
    const reset = el('button', 'place-view-reset', 'Reset');
    reset.type = 'button';
    reset.title = 'Look straight down with north up';
    reset.addEventListener('click', () => {
        terrain?.setFov(DEFAULT_FOV);
        map.easeTo({ bearing: 0, pitch: 0, duration: 600 });
        map.once('moveend', () => {
            terrain?.setBearing(0);
            terrain?.setPitch(0);
        });
    });
    const camera = compartment('Camera', reset);
    const centre = el('div', 'place-view-centre');
    const centreValue = el('span', 'place-readout-value');
    centre.append(el('span', 'place-readout-label', 'Centre'), centreValue);

    const bearing = createScrub({
        label: 'Bearing', icon: 'compass', min: 0, max: 360, step: 1, pxPerStep: 1, wrap: true, defaultValue: 0,
        format: v => `${Math.round(v)}°`,
        onInput: v => (terrain ? terrain.setBearing(v) : map.setBearing(v))
    });
    const pitch = createScrub({
        label: 'Pitch', icon: 'triangle', min: 0, max: 85, step: 1, pxPerStep: 2, defaultValue: 0,
        format: v => `${Math.round(v)}°`,
        onInput: v => (terrain ? terrain.setPitch(v) : map.setPitch(v))
    });
    const perspective = createScrub({
        label: 'Perspective', icon: 'arrows-angle-expand', min: 6, max: 86, step: 0.5, pxPerStep: 2,
        defaultValue: DEFAULT_FOV / RAD,
        format: v => `${v.toFixed(1)}°`,
        onInput: v => terrain?.setFov(v * RAD),
        title: 'The camera\'s field of view: drag for a wider or narrower lens · click to type · double-click to reset'
    });
    const cameraGrid = el('div', 'place-readouts place-scrubs');
    cameraGrid.append(bearing.el, pitch.el, perspective.el);
    camera.append(centre, cameraGrid);

    // 3D terrain
    const terrainSwitch = switchButton('3D terrain', 'Show the ground\'s relief in 3D', (on) => {
        terrain?.setEnabled(on);
        trackEvent('terrain_3d_toggle', { enabled: on });
    });
    const relief = compartment('Terrain', terrainSwitch);
    const scale = createScrub({
        label: 'Vertical scale', icon: 'arrow-bar-up', min: 0, max: terrain?.options.maxExaggeration ?? 20, step: 0.1, pxPerStep: 3,
        defaultValue: terrain?.options.initialExaggeration ?? 1.5,
        format: v => `${v.toFixed(1)}×`,
        onInput: (v) => {
            terrain?.setExaggeration(v);
            if (terrain && !terrain.getEnabled()) terrain.setEnabled(true);
        }
    });
    const sourceCell = el('label', 'place-select-cell');
    sourceCell.append(el('span', 'place-scrub-label', 'Source'));
    const source = select('Terrain source', terrain?.getTerrainSources() || [], id => terrain?.setTerrainSource(id));
    sourceCell.appendChild(source);
    const reliefGrid = el('div', 'place-readouts place-scrubs place-scrubs-2');
    reliefGrid.append(scale.el, sourceCell);

    const buildings = chip('Buildings', 'Extruded building footprints', on => terrain?.setBuildingsVisible(on));
    const buildingSource = select('Building source',
        Object.entries(BUILDING_SOURCES).map(([id, { label }]) => ({ id, name: label })),
        id => terrain?.setBuildingSource(id));
    buildingSource.classList.add('place-chip-select');
    const contours = chip('Contours', 'Elevation contour lines from Mapbox Terrain', on => terrain?.setContoursVisible(on));
    const hillshade = chip('Hillshade', 'Shaded relief from the terrain source', (on) => {
        if (on && !terrain?.getEnabled()) terrain?.setEnabled(true);
        terrain?.setHillshade(on);
    });
    const chips = el('div', 'place-chips');
    chips.append(buildings, buildingSource, contours, hillshade);
    relief.append(reliefGrid, chips);

    // More
    const more = el('details', 'place-view-more');
    const summary = el('summary', null);
    summary.innerHTML = '<sl-icon name="chevron-right"></sl-icon><span>More</span>';
    const optionList = el('div', 'place-view-options');
    more.append(summary, optionList);
    const options = [
        ['wireframe', 'Terrain mesh', 'Show the triangles the terrain is drawn with', v => terrain?.setWireframe(v), () => terrain?.getWireframe()],
        ['fog', 'Atmospheric fog', 'Fade the distance into haze', v => terrain?.setFog(v), () => terrain?.getFog()],
        ['animate', 'Orbit', 'Turn the camera slowly around the centre', v => terrain?.setAnimate(v), () => terrain?.getAnimate()],
        ['sound', 'Dancing terrain', 'Raise the terrain with the microphone\'s volume', v => terrain?.setVisualizeSound(v), () => terrain?.getVisualizeSound()],
        ['device', 'Tilt with device', 'Set the pitch by tilting this device', v => terrain?.setLockToDeviceOrientation(v), () => terrain?.getLockToDeviceOrientation()]
    ].map(([id, label, title, apply, read]) => {
        const button = switchButton(label, title, apply);
        button.dataset.option = id;
        optionList.appendChild(button);
        return { button, read };
    });

    panel.append(camera, relief, more);

    const tabIcon = document.getElementById(panel.getAttribute('aria-labelledby'))?.querySelector('.place-tab-icon');
    const renderTerrain = () => {
        const on = !!terrain?.getEnabled();
        tabIcon?.classList.toggle('is-on', on);
        terrainSwitch.setAttribute('aria-checked', String(on));
        scale.set(terrain?.getExaggeration() ?? 0);
        scale.el.classList.toggle('is-off', !on);
        source.value = terrain?.getTerrainSource() || '';
        sourceCell.classList.toggle('is-off', !on);
        hillshade.setAttribute('aria-pressed', String(on && !!terrain?.getHillshade()));
        perspective.set((terrain?.getFov() ?? DEFAULT_FOV) / RAD);
        pitch.setDisabled(!!terrain?.getLockToDeviceOrientation());
        options.forEach(({ button, read }) => button.setAttribute('aria-checked', String(!!read())));
    };

    // Buildings and contours are ordinary layers, switched from anywhere.
    const renderLayers = () => {
        const showBuildings = !!terrain?.getBuildingsVisible();
        buildings.setAttribute('aria-pressed', String(showBuildings));
        buildingSource.hidden = !showBuildings;
        if (showBuildings) buildingSource.value = terrain.getBuildingSource();
        contours.setAttribute('aria-pressed', String(!!terrain?.getContoursVisible()));
    };

    const renderCamera = () => {
        const c = map.getCenter();
        centreValue.textContent = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} · z${map.getZoom().toFixed(1)}`;
        bearing.set(((map.getBearing() % 360) + 360) % 360);
        pitch.set(map.getPitch());
    };

    renderTerrain();
    renderLayers();
    renderCamera();
    map.on('move', renderCamera);
    const offTerrain = terrain?.onChange(renderTerrain);
    return {
        refresh: renderLayers,
        destroy: () => {
            map.off('move', renderCamera);
            offTerrain?.();
        }
    };
}

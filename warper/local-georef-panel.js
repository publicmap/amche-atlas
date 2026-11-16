const LOCAL_GEOREF_HELP = {
    bbox: 'Drag the image to move it, corners or edges to resize, and the top handle or just outside a corner to rotate around the anchor (crosshair). Drag the anchor to set the pivot; hold Alt to resize around it, Shift to keep proportions or snap rotation to 15°.',
    points: 'Double-click the same place on both maps to add a control point (key 1 to add, 2 to move). The box corners start as points; the preview fits all points once there are 3.'
};

const LOCAL_GEOREF_ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M18 12a6 6 0 1 1-2-4.5" fill="none" stroke="white" stroke-width="4"/><path d="M18 12a6 6 0 1 1-2-4.5" fill="none" stroke="black" stroke-width="2"/><path d="M13 4h5v5z" fill="black" stroke="white"/></svg>')}") 12 12, grab`;

function localGeorefHandleElement(kind) {
    const el = document.createElement('div');
    if (kind === 'rotate-zone') {
        el.style.cssText = `width:36px;height:36px;border-radius:9999px;cursor:${LOCAL_GEOREF_ROTATE_CURSOR};`;
        el.title = 'Drag to rotate';
        return el;
    }
    const [width, height] = { anchor: [22, 22], rotate: [20, 20], corner: [14, 14], 'edge-ns': [18, 10], 'edge-ew': [10, 18] }[kind];
    const cursor = { anchor: 'crosshair', rotate: LOCAL_GEOREF_ROTATE_CURSOR, corner: 'nwse-resize', 'edge-ns': 'ns-resize', 'edge-ew': 'ew-resize' }[kind];
    el.style.cssText = `width:${width}px;height:${height}px;border-radius:${kind === 'corner' || kind.startsWith('edge') ? '3px' : '9999px'};background:white;border:2px solid #2563eb;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:${cursor};display:flex;align-items:center;justify-content:center;`;
    if (kind === 'anchor') {
        el.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#2563eb" stroke-width="1.5"><circle cx="8" cy="8" r="4"/><path d="M8 0v5M8 11v5M0 8h5M11 8h5"/></svg>';
        el.title = 'Anchor: rotation and Alt-scaling pivot here. Drag to move, double-click to reset.';
    }
    if (kind === 'rotate') el.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="#2563eb"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></svg>';
    return el;
}

function buildLocalGeorefPanel(georef) {
    const panel = document.createElement('div');
    panel.className = 'bg-white rounded border border-blue-200 shadow-sm p-3 text-xs text-gray-700 space-y-2';
    const modeButton = (mode, label) => `<button type="button" data-georef-mode="${mode}" class="flex-1 px-2 py-1 rounded">${label}</button>`;
    panel.innerHTML = `
        <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-sm truncate" data-georef-name></span>
            <button type="button" data-georef-close class="text-gray-400 hover:text-gray-700 text-lg leading-none" title="Discard">&times;</button>
        </div>
        <div class="flex gap-1 p-0.5 rounded bg-gray-100">${modeButton('bbox', 'Box')}${modeButton('points', 'Control points')}</div>
        <p class="text-gray-500" data-georef-help></p>
        <p class="text-gray-400">Nothing is uploaded until you save.</p>
        <label class="flex items-center gap-2">Opacity <input type="range" min="0" max="1" step="0.05" data-georef-opacity class="flex-1"></label>
        <div class="font-mono text-[10px] text-gray-500" data-georef-info></div>
        <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" data-georef-export class="flex-1 whitespace-nowrap px-2 py-1.5 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50">Export GeoTIFF</button>
            <button type="button" data-georef-save class="flex-1 whitespace-nowrap px-2 py-1.5 bg-green-600 text-white rounded hover:bg-green-700">Save to Mapwarper</button>
        </div>`;
    panel.querySelector('[data-georef-name]').textContent = `${georef.file.name} (${georef.bitmap.width}×${georef.bitmap.height})`;
    const opacity = panel.querySelector('[data-georef-opacity]');
    opacity.value = georef.opacity;
    opacity.addEventListener('input', () => {
        georef.opacity = parseFloat(opacity.value);
        referenceMap.setPaintProperty(LOCAL_GEOREF_LAYER, 'raster-opacity', georef.opacity);
    });
    panel.querySelectorAll('[data-georef-mode]').forEach(button => {
        button.addEventListener('click', () => georef.setMode(button.dataset.georefMode));
    });
    panel.querySelector('[data-georef-close]').addEventListener('click', () => georef.close());
    panel.querySelector('[data-georef-export]').addEventListener('click', e => georef.exportGeoTIFF(e.currentTarget));
    panel.querySelector('[data-georef-save]').addEventListener('click', () => georef.saveToMapwarper());
    const history = document.getElementById('edit-history-controls');
    history.parentNode.insertBefore(panel, history);
    georef.panel = panel;
    updateLocalGeorefPanel(georef);
    return panel;
}

function updateLocalGeorefPanel(georef) {
    const panel = georef.panel;
    if (!panel || !georef.box) return;
    panel.querySelectorAll('[data-georef-mode]').forEach(button => {
        const on = button.dataset.georefMode === georef.mode;
        button.classList.toggle('bg-white', on);
        button.classList.toggle('shadow', on);
        button.classList.toggle('font-semibold', on);
        button.classList.toggle('text-gray-500', !on);
    });
    panel.querySelector('[data-georef-help]').textContent = LOCAL_GEOREF_HELP[georef.mode];
    const info = panel.querySelector('[data-georef-info]');
    if (georef.mode === 'bbox') {
        const { lon, lat } = georef.center();
        const degrees = ((georef.box.angle * 180 / Math.PI) % 360 + 360) % 360;
        info.textContent = `Centre ${lat.toFixed(5)}, ${lon.toFixed(5)}  Rotation ${degrees.toFixed(1)}°`;
    } else {
        const count = georef.points.gcps().length;
        info.textContent = `${count} complete control point${count === 1 ? '' : 's'}${georef.points.corners ? ' · affine preview' : ' · 3 needed for a preview'}`;
    }
    panel.querySelector('[data-georef-export]').disabled = georef.mode === 'points' && !georef.points.corners;
}

window.localGeorefHandleElement = localGeorefHandleElement;
window.buildLocalGeorefPanel = buildLocalGeorefPanel;
window.updateLocalGeorefPanel = updateLocalGeorefPanel;

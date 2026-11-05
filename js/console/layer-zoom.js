/**
 * The zoom button on every map row in Find (js/console/find-browse.js,
 * js/layer-stack-strip.js). It doubles as its own undo: the first click
 * remembers the view and zooms to the map, a second click with no hand-made
 * move since flies back. One zoom is remembered for all rows, so every button
 * for that map turns into its return button at once.
 */
import { el, icon } from './find-rows.js';
import { layerBbox, zoomTo } from './find-scope.js';

let zoomed = null;
let watchedMap = null;

function keyOf(layer) {
    return layer._prefixedId || layer.id;
}

// A programmatic move (the zoom itself) has no originalEvent
function watch(map) {
    if (watchedMap === map) return;
    watchedMap = map;
    map.on?.('movestart', (e) => {
        if (e?.originalEvent && zoomed) setZoomed(null);
    });
}

function setZoomed(next) {
    zoomed = next;
    document.querySelectorAll('.console-zoom[data-layer-key]').forEach(paint);
}

function paint(button) {
    const title = button.dataset.layerTitle;
    const back = zoomed?.key === button.dataset.layerKey;
    const label = button.disabled ? `${title} covers the whole map`
        : back ? `Return to the view before zooming to ${title}` : `Zoom to ${title}`;
    button.classList.toggle('zoomed', back);
    button.title = label;
    button.setAttribute('aria-label', label);
    button.replaceChildren(icon(back ? 'arrow-counterclockwise' : 'zoom-in'));
}

export function toggleLayerZoom(layer) {
    const map = window.map;
    if (!map) return;
    watch(map);
    const key = keyOf(layer);
    if (zoomed?.key === key) {
        const { view } = zoomed;
        setZoomed(null);
        map.flyTo(view);
        return;
    }
    const view = { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    // MapBrowserControl also honours the layer's minzoom and writes ?zoomTo=
    if (window.layerRegistry?.getLayer?.(key)) window.postMessage({ type: 'zoom-to-layer', layerId: key }, '*');
    else zoomTo({ bbox: layerBbox(layer) });
    setZoomed({ key, view });
}

export function layerZoomButton(layer, { outside = false } = {}) {
    const button = el('button', 'console-zoom' + (outside ? ' outside' : ''));
    button.type = 'button';
    button.dataset.layerKey = keyOf(layer);
    button.dataset.layerTitle = layer.title || layer.name || layer.id;
    button.disabled = !layerBbox(layer);
    paint(button);
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLayerZoom(layer);
    });
    return button;
}

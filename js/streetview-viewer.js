/**
 * Standalone MapillaryJS viewer for streetview.html.
 *
 * Deliberately knows nothing about the host app's map, layers, or Mapillary
 * tile schema — it only creates/updates a MapillaryJS Viewer and talks to its
 * parent window purely via postMessage, so it can be reused/customized
 * independently of whatever embeds it (see js/streetview-control.js).
 */

import { MAPILLARY_ACCESS_TOKEN } from './mapillary-utils.js';

const MAPILLARYJS_VERSION = '4.1.2';
const MAPILLARYJS_JS_URL = `https://unpkg.com/mapillary-js@${MAPILLARYJS_VERSION}/dist/mapillary.js`;
const MAPILLARYJS_CSS_URL = `https://unpkg.com/mapillary-js@${MAPILLARYJS_VERSION}/dist/mapillary.css`;

const viewerEl = document.getElementById('streetview-viewer');
const followCheckbox = document.getElementById('streetview-follow');
const perspectiveCheckbox = document.getElementById('streetview-perspective');

let viewer = null;
let followEnabled = true;
let perspectiveEnabled = true;

function post(message) {
    window.parent.postMessage(message, '*');
}

function showMessage(text) {
    viewerEl.innerHTML = `<div style="padding:12px;color:#9ca3af;font-size:12px;">${text}</div>`;
}

function showLoading(text) {
    viewerEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:12px;color:#9ca3af;font-size:12px;">
            <svg style="width:14px;height:14px;animation:sv-spin 1s linear infinite;flex-shrink:0;" fill="none" viewBox="0 0 24 24">
                <circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>${text}</span>
        </div>
    `;
}

function loadCss(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

function loadScriptOnce(src) {
    if (!window.__mapillaryJSLoadPromise) {
        window.__mapillaryJSLoadPromise = new Promise((resolve, reject) => {
            if (window.mapillary) { resolve(window.mapillary); return; }
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve(window.mapillary);
            script.onerror = () => reject(new Error('Failed to load MapillaryJS'));
            document.head.appendChild(script);
        });
    }
    return window.__mapillaryJSLoadPromise;
}

function wireViewerEvents() {
    viewer.on('load', () => emitState('image'));
    viewer.on('image', () => emitState('image'));
    viewer.on('pov', () => emitState('pov'));
    viewer.on('fov', () => emitState('fov'));
}

// moveTo() throws if called before the viewer's first image has finished
// loading (isNavigable still false right after construction), which a quick
// second click while the panel is already open can easily race.
function waitForNavigable(timeoutMs = 8000) {
    if (viewer.isNavigable) return Promise.resolve();
    return new Promise((resolve) => {
        let settled = false;
        const onNavigable = () => {
            if (!settled && viewer.isNavigable) {
                settled = true;
                viewer.off?.('navigable', onNavigable);
                resolve();
            }
        };
        viewer.on('navigable', onNavigable);
        setTimeout(() => {
            if (!settled) {
                settled = true;
                viewer.off?.('navigable', onNavigable);
                resolve();
            }
        }, timeoutMs);
    });
}

// The viewer's getters can briefly reject right around the very first 'load'
// before its internal camera state is ready, so retry a few times.
function emitState(reason, retriesLeft = 5) {
    if (!viewer) return;
    Promise.all([viewer.getPosition(), viewer.getPointOfView(), viewer.getFieldOfView()])
        .then(([position, pov, fov]) => {
            post({
                type: 'streetview-state',
                reason,
                lng: position.lng,
                lat: position.lat,
                bearing: pov.bearing,
                tilt: pov.tilt,
                fov,
                follow: followEnabled,
                perspective: perspectiveEnabled
            });
        })
        .catch(() => {
            if (retriesLeft > 0) setTimeout(() => emitState(reason, retriesLeft - 1), 400);
        });
}

async function openImage(imageId) {
    if (!imageId) {
        showMessage('No nearby Mapillary imagery found.');
        return;
    }

    showLoading('Loading street-level imagery...');

    try {
        const mapillary = await loadScriptOnce(MAPILLARYJS_JS_URL);
        loadCss(MAPILLARYJS_CSS_URL);

        if (!viewer) {
            viewerEl.innerHTML = '';
            // cover:false - MapillaryJS's default "click to load" cover screen
            // would otherwise leave the viewer non-navigable (moveTo() throws
            // "not supported when viewer is not navigable") until the user
            // clicks through it; we're opening this deliberately via our own
            // UI action, so load and activate immediately instead.
            viewer = new mapillary.Viewer({
                accessToken: MAPILLARY_ACCESS_TOKEN,
                container: 'streetview-viewer',
                imageId,
                component: { cover: false }
            });
            wireViewerEvents();
        } else {
            await waitForNavigable();
            await viewer.moveTo(imageId);
        }
    } catch (error) {
        showMessage('Error loading street-level view: ' + (error && error.message ? error.message : error));
    }
}

followCheckbox.addEventListener('change', () => {
    followEnabled = followCheckbox.checked;
    emitState('options');
});
perspectiveCheckbox.addEventListener('change', () => {
    perspectiveEnabled = perspectiveCheckbox.checked;
    emitState('options');
});

window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'streetview-open') openImage(data.imageId);
});

showMessage('Waiting for a photo location...');
post({ type: 'streetview-ready' });

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
const pinLocationCheckbox = document.getElementById('streetview-pin-location');

let viewer = null;
let followEnabled = true;
let perspectiveEnabled = true;
let pinLocationEnabled = true;

function post(message) {
    window.parent.postMessage(message, '*');
}

function showMessage(text) {
    viewerEl.innerHTML = `<div style="padding:12px;color:#9ca3af;font-size:12px;">${text}</div>`;
}

// No image at all nearby - unlike showMessage(), also tells the parent panel
// so it can shrink to fit this short message instead of staying sized for a
// full photo (see streetview-control.js's _collapsePanelForNoImage).
function showNoImageMessage() {
    viewerEl.innerHTML = `
        <div style="padding:14px;color:#9ca3af;font-size:12px;line-height:1.6;">
            <div style="margin-bottom:8px;">No street-level imagery found near this location.</div>
            <div>Try <a href="https://www.mapillary.com/app" target="_blank" style="color:#60a5fa;text-decoration:none;">browsing Mapillary's coverage map</a> for imagery elsewhere.</div>
            <div style="margin-top:8px;">Missing here? <a href="https://www.mapillary.com/download" target="_blank" style="color:#60a5fa;text-decoration:none;">Capture some yourself</a> with the free Mapillary app.</div>
        </div>
    `;
    post({ type: 'streetview-no-image' });
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
                perspective: perspectiveEnabled,
                pinLocation: pinLocationEnabled
            });
        })
        .catch(() => {
            if (retriesLeft > 0) setTimeout(() => emitState(reason, retriesLeft - 1), 400);
        });
}

// A single click can match more than one Mapillary layer at the same point
// (e.g. a coverage-photos point sitting on its own coverage line), so the
// click dispatcher can invoke this twice in a row for one physical click.
// Chaining calls onto this promise (rather than letting them run
// concurrently) ensures a second call always waits for the first's viewer
// construction/moveTo() to fully settle first - otherwise MapillaryJS's
// internal request queue cancels the earlier one and rejects it with
// "Request aborted by a subsequent request to id X".
let openChain = Promise.resolve();

function openImage(imageId) {
    openChain = openChain.then(() => doOpenImage(imageId));
    return openChain;
}

async function doOpenImage(imageId) {
    if (!imageId) {
        showNoImageMessage();
        return;
    }

    // Only show the loading placeholder (which replaces #streetview-viewer's
    // innerHTML) before the viewer exists. Doing this on every call - even
    // when just moving an already-open viewer to a new image - would rip
    // MapillaryJS's own mounted canvas out of the DOM out from under it,
    // permanently hanging that in-flight moveTo() since it depends on the
    // canvas it no longer has a live reference to.
    if (!viewer) showLoading('Loading street-level imagery...');

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
pinLocationCheckbox.addEventListener('change', () => {
    pinLocationEnabled = pinLocationCheckbox.checked;
    emitState('options');
});

window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'streetview-open') openImage(data.imageId);
});

showMessage('Waiting for a photo location...');
post({ type: 'streetview-ready' });

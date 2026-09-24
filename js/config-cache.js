/**
 * Process-wide cache for the small JSON configs fetched during startup
 * (`config/_defaults.json`, `config/*.atlas.json`, a remote `?atlas=<url>`).
 *
 * Four independent callers need the same one or two files, and they run
 * concurrently rather than in sequence, so the browser's HTTP cache never
 * gets a chance to help - by the time one response lands the others are
 * already in flight:
 *
 *   js/splash-screen-manager.js  the atlas named in the URL, to show its name
 *   js/layer-registry.js         every atlas, to build the layer registry
 *   js/map-init.js               twice: the fast path that builds the map
 *                                options, then the full loadConfiguration
 *   js/map-layer-controls.js     the defaults, for layer-type styling
 *
 * Keyed by URL and holding the in-flight promise, so concurrent callers
 * share one round trip. Nothing is ever invalidated: these files can't
 * change within a page load.
 *
 * Every caller gets its own deep copy of the parsed JSON. Config objects are
 * mutated freely downstream (map-init rewrites `map.style`, flips
 * `initiallyChecked`, attaches `defaults`), so handing out a shared object
 * would turn a caching change into a spooky-action-at-a-distance bug.
 */

// url -> Promise<ConfigResult> (the uncloned original)
const cache = new Map();

/**
 * @typedef {object} ConfigResult
 * @property {boolean} ok        True only when the request succeeded AND the body parsed as JSON.
 * @property {number} status     HTTP status, or 0 when the request itself threw (offline, CORS).
 * @property {string} contentType Response content-type, for callers that need to spot a
 *                                static host's SPA fallback (200 + text/html, not a real 404).
 * @property {object|null} json  Parsed body, or null when !ok.
 * @property {string|null} error Human-readable reason when !ok.
 */

function deepCopy(value) {
    if (value === null || typeof value !== 'object') return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

async function load(url) {
    let response;
    try {
        response = await fetch(url);
    } catch (error) {
        return { ok: false, status: 0, contentType: '', json: null, error: error.message };
    }

    // Defensive: a real Response always has headers, a hand-rolled stub in a
    // test or a service worker may not.
    const contentType = (response.headers && response.headers.get('content-type')) || '';

    if (!response.ok) {
        return { ok: false, status: response.status, contentType, json: null, error: `HTTP ${response.status}` };
    }

    try {
        return { ok: true, status: response.status, contentType, json: await response.json(), error: null };
    } catch (error) {
        // A static host answering a missing file with its SPA fallback lands
        // here: 200 OK, an HTML body, and a JSON parse error.
        const isHtml = error.message.includes('JSON') || error.message.includes('DOCTYPE');
        return {
            ok: false,
            status: response.status,
            contentType,
            json: null,
            error: isHtml ? 'Invalid JSON response (likely HTML/404 page)' : error.message
        };
    }
}

/**
 * Fetch a config file, reusing an in-flight or completed request for the same
 * URL. Failures are cached too, so a missing file is probed once per page load
 * rather than once per caller.
 * @param {string} url
 * @returns {Promise<ConfigResult>} with `json` deep-copied per call
 */
export async function fetchConfigResult(url) {
    let pending = cache.get(url);
    if (!pending) {
        pending = load(url);
        cache.set(url, pending);
    }
    const result = await pending;
    return result.json ? { ...result, json: deepCopy(result.json) } : result;
}

/**
 * The parsed config, or null if it couldn't be fetched or parsed.
 * @param {string} url
 * @returns {Promise<object|null>}
 */
export async function fetchConfigJson(url) {
    return (await fetchConfigResult(url)).json;
}

/**
 * Drop cached entries. Only needed by tests - nothing in the app re-reads a
 * config within a page load.
 */
export function clearConfigCache() {
    cache.clear();
}

/**
 * GoogleSheetsWriter - Appends a row to a Google Sheet via a bound Apps Script web app.
 *
 * There is no OAuth / sign-in: the sheet owner deploys a small Apps Script web app
 * (Execute as: me, Access: Anyone) and the browser POSTs the note to it. The script
 * runs under the owner's account and appends the row, so any visitor can add a note
 * without authenticating and without the "unverified app" consent screen.
 *
 * Each sheet has its own deployed script URL, configured per-layer as `saveUrl`.
 * See docs/API.md -> "Writing notes back to a Google Sheet" for the script and setup.
 */

export function extractGid(url) {
    const match = String(url || '').match(/[?&#]gid=([0-9]+)/);
    return match ? match[1] : '';
}

/**
 * Append a row to a Google Sheet through its Apps Script web app.
 * @param {Object} opts
 * @param {string} opts.saveUrl - Deployed Apps Script web app URL (…/exec)
 * @param {string} [opts.url] - The layer's CSV url; its gid selects the target tab
 * @param {Object} opts.values - { latitude, longitude, notes, timestamp }
 */
export async function appendRow({ saveUrl, url, values }) {
    if (!saveUrl) {
        throw new Error('Missing saveUrl. Add an Apps Script web app URL to the layer config (see docs/API.md).');
    }

    const body = JSON.stringify({ gid: extractGid(url), ...values });

    let response;
    try {
        response = await fetch(saveUrl, {
            method: 'POST',
            // text/plain keeps this a "simple" request so the browser skips the CORS
            // preflight (OPTIONS), which Apps Script web apps do not answer.
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body,
            redirect: 'follow'
        });
    } catch (e) {
        throw new Error('Save endpoint blocked (CORS/401). In Apps Script: Manage deployments → Edit → New version, set "Who has access" to Anyone (not "Anyone with Google account"). Test the /exec URL in an incognito tab — it should return {"status":"ok"}.');
    }

    const text = await response.text();
    let result;
    try {
        result = JSON.parse(text);
    } catch (e) {
        throw new Error(`Unexpected response from save endpoint: ${text.slice(0, 200)}`);
    }

    if (!response.ok || result.status === 'error') {
        throw new Error(result.message || `Save failed (${response.status}).`);
    }
    return result;
}

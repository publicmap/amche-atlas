/**
 * TextbSync - Overwrites a textb.org pad (https://r-w-x.org/r/textb), a
 * realtime collaborative editor built on Google's MobWrite. Used as a
 * lightweight cross-origin "write" transport: pushing text to a pad by ID
 * means anyone who can reach `/r/<id>/` — a plain-text URL — can read it
 * back (e.g. GeoLibre's `?url=` project loader).
 *
 * textb.org's `/mobwrite/` sync endpoint sends no CORS headers, so a
 * cross-origin page can POST to it (fire-and-forget, `mode: 'no-cors'`) but
 * can never read the response. That rules out driving MobWrite's own
 * stateful client library (it needs to read every round trip). Instead this
 * reads the pad's current text from the CORS-enabled `/r/<id>/` endpoint,
 * computes a diff-match-patch delta to the desired text, and blind-POSTs a
 * two-request handshake mirroring what a real MobWrite client sends:
 *
 * 1. `r:1:` with empty text — bootstraps the session. Empirically (see the
 *    exploration that led here) the server always replies to this with
 *    `F:1:<id>`, regardless of the pad's real edit history, so the reply
 *    never needs to be read to know what version number comes next.
 * 2. `d:1:<delta>` — the real edit, addressed as `F:1:<id>` per the above.
 *
 * Skipping either step, or getting the version numbers wrong, makes the
 * server reject the edit and echo back its existing content unchanged.
 *
 * Usage:
 * ```javascript
 * import { TextbSync } from './textb-sync.js';
 *
 * await TextbSync.publish('uxzp6fd1lp', jsonString);
 * // https://textb.org/r/uxzp6fd1lp/ now serves jsonString
 * ```
 */

const DMP_SCRIPT_URL = 'https://textb.org/static/js/mobwrite/diff_match_patch.js';
const SYNC_GATEWAY = 'https://textb.org/mobwrite/';
const HANDSHAKE_SETTLE_MS = 500;
const VERIFY_DELAY_MS = 1000;

let dmpLoadPromise = null;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

async function ensureDiffMatchPatchLoaded() {
    if (window.diff_match_patch) return window.diff_match_patch;
    if (!dmpLoadPromise) {
        dmpLoadPromise = loadScript(DMP_SCRIPT_URL).then(() => window.diff_match_patch);
    }
    return dmpLoadPromise;
}

// Cross-origin and no CORS headers on this endpoint, so the response is
// unreadable — fire the request and move on.
function blindPost(data) {
    return fetch(SYNC_GATEWAY, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'q=' + encodeURIComponent(data)
    });
}

export class TextbSync {
    static rawUrl(padId) {
        return `https://textb.org/r/${padId}/`;
    }

    /**
     * Overwrites the pad at `padId` with `text`. Resolves once `/r/<padId>/`
     * reflects the new text; rejects if it still doesn't after one retry.
     */
    static async publish(padId, text) {
        const DiffMatchPatch = await ensureDiffMatchPatchLoaded();
        const dmp = new DiffMatchPatch();
        const rawUrl = this.rawUrl(padId);

        for (let attempt = 0; attempt < 2; attempt++) {
            const currentContent = await fetch(rawUrl).then(r => r.text());
            if (currentContent === text) return;

            const diffs = dmp.diff_main(currentContent, text, true);
            dmp.diff_cleanupSemantic(diffs);
            const delta = dmp.diff_toDelta(diffs);

            await blindPost(`u:amche-atlas\nF:0:${padId}\nr:1:\n\n`);
            await new Promise(r => setTimeout(r, HANDSHAKE_SETTLE_MS));
            await blindPost(`u:amche-atlas\nF:1:${padId}\nd:1:${delta}\n\n`);
            await new Promise(r => setTimeout(r, VERIFY_DELAY_MS));

            const finalContent = await fetch(rawUrl).then(r => r.text());
            if (finalContent === text) return;
        }

        throw new Error('textb.org did not accept the sync after retrying');
    }
}

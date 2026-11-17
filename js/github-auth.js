/**
 * GitHub sign-in for the layer editor: the OAuth web flow in a popup
 * (github-callback.html), with the code exchanged for a token by the
 * project's server (server/server.js /github/token) so the app's client
 * secret never reaches the browser. The token (gist scope only) is kept in
 * this browser.
 */

const SERVER = 'https://amche-atlas-production.up.railway.app';
const TOKEN_KEY = 'amche-github-token';
const CHANNEL = 'amche-github-oauth';
const TIMEOUT_MS = 5 * 60 * 1000;

export function githubToken() {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

export function signOutGithub() {
    try {
        localStorage.removeItem(TOKEN_KEY);
    } catch {
        // Storage blocked: nothing kept to remove
    }
}

function callbackUrl() {
    return new URL('github-callback.html', window.location.href).href;
}

function waitForCode(state) {
    return new Promise((resolve, reject) => {
        const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
        const done = () => {
            clearTimeout(timer);
            channel?.close();
            window.removeEventListener('message', onWindowMessage);
        };
        const handle = (data) => {
            if (data?.type !== 'github-oauth' || data.state !== state) return;
            done();
            if (data.code) resolve(data.code);
            else reject(new Error(data.error || 'GitHub sign-in was cancelled'));
        };
        const onWindowMessage = (event) => {
            if (event.origin === window.location.origin) handle(event.data);
        };
        const timer = setTimeout(() => {
            done();
            reject(new Error('GitHub sign-in timed out'));
        }, TIMEOUT_MS);
        if (channel) channel.onmessage = (event) => handle(event.data);
        window.addEventListener('message', onWindowMessage);
    });
}

/**
 * Sign in with GitHub. Call straight from a click: the popup opens before
 * anything is awaited so the browser doesn't block it.
 * @returns {Promise<string>} the token
 */
export async function signInGithub() {
    const popup = window.open('', 'amche-github-signin', 'width=520,height=700');
    if (!popup) throw new Error('Allow pop-ups for this site to sign in to GitHub');
    try {
        const configResponse = await fetch(`${SERVER}/github/config`);
        const config = await configResponse.json().catch(() => ({}));
        if (configResponse.status === 404) throw new Error('the map server does not support GitHub sign-in yet (redeploy server/server.js)');
        if (!configResponse.ok) throw new Error(config.error || `the map server returned ${configResponse.status}`);

        const state = crypto.randomUUID();
        const redirectUri = callbackUrl();
        const code = waitForCode(state);
        popup.location.href = `https://github.com/login/oauth/authorize?${new URLSearchParams({
            client_id: config.client_id,
            scope: 'gist',
            state,
            redirect_uri: redirectUri,
            allow_signup: 'true'
        })}`;

        const tokenResponse = await fetch(`${SERVER}/github/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: await code, redirect_uri: redirectUri })
        });
        const data = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !data.access_token) throw new Error(data.error || 'GitHub sign-in failed');

        try {
            localStorage.setItem(TOKEN_KEY, data.access_token);
        } catch {
            // Storage blocked: the token still works for this save
        }
        return data.access_token;
    } catch (error) {
        try { popup.close(); } catch { /* already gone */ }
        throw error;
    }
}

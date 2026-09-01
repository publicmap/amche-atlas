// ==UserScript==
// @name         amche HSAC Land Record Bridge
// @namespace    https://amche.in/
// @version      1.0.0
// @description  Answers land-record lookups from an open amche.in tab using your own logged-in HSAC EODB session. Credentials never leave hsac.in.
// @author       publicmap
// @match        https://hsac.in/eodb/*
// @match        https://hsac.org.in/eodb/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/**
 * Why this exists
 * ---------------
 * hsac.in gates /eodb_backend/mapserver/* behind a phone+OTP session and refuses
 * cross-origin requests outright (403, no CORS headers). This script runs *in the
 * hsac.in tab*, so the session cookie is attached by the browser and the request
 * signing key stays in hsac.in's own localStorage. amche.in only ever sees the
 * XML answer - never the cookie, the signing key or your phone number.
 *
 * Install: Tampermonkey/Violentmonkey, or paste this whole file into the devtools
 * console on an open hsac.in/eodb tab for a one-off session.
 */

(function () {
    'use strict';

    const SIGN_KEY_STORAGE = 'eodb_req_sign_key';
    const DEVICE_ID_STORAGE = 'eodb_device_id';
    const DEVICE_IMEI_STORAGE = 'eodb_device_imei';
    const KNOWN_ORIGINS_STORAGE = 'amche_bridge_origins';
    const API_PREFIX = '/eodb_backend';
    const HEARTBEAT_MS = 2000;

    const ALLOWED_ORIGINS = [
        /^https:\/\/amche\.in$/,
        /^https:\/\/[a-z0-9-]+\.amche\.in$/,
        /^https:\/\/publicmap\.github\.io$/,
        /^http:\/\/localhost(:\d+)?$/,
        /^http:\/\/127\.0\.0\.1(:\d+)?$/
    ];

    // Concrete origins to announce to before any amche tab has talked to us.
    // Wildcards can't be a postMessage target, so anything else is learned on first contact.
    const DEFAULT_ANNOUNCE_ORIGINS = [
        'https://amche.in',
        'https://publicmap.github.io',
        'http://localhost:4035',
        'http://127.0.0.1:4035'
    ];

    const isAllowedOrigin = (origin) => ALLOWED_ORIGINS.some((re) => re.test(origin));

    const readStorage = (key) => {
        try { return window.localStorage.getItem(key); } catch { return null; }
    };

    function knownOrigins() {
        try {
            const stored = JSON.parse(readStorage(KNOWN_ORIGINS_STORAGE) || '[]');
            return Array.isArray(stored) ? stored.filter(isAllowedOrigin) : [];
        } catch { return []; }
    }

    function rememberOrigin(origin) {
        if (knownOrigins().includes(origin)) return;
        try {
            window.localStorage.setItem(KNOWN_ORIGINS_STORAGE, JSON.stringify(knownOrigins().concat(origin)));
        } catch {}
    }

    // Mirrors the site's own path normalisation before signing:
    // query stripped, /eodb_backend prefix stripped, trailing slashes trimmed, lowercased.
    function normalisePath(url) {
        let path = String(url || '').split('?')[0].trim();
        if (!path) return '/';
        if (!path.startsWith('/')) path = `/${path}`;
        if (path === API_PREFIX) {
            path = '/';
        } else {
            path = path.replace(/^\/eodb_backend(?=\/|$)/i, '');
            if (!path.startsWith('/')) path = `/${path}`;
        }
        if (path.length > 1) path = path.replace(/\/+$/, '');
        return path.toLowerCase();
    }

    async function sign(key, method, path, signedAt, body) {
        const enc = new TextEncoder();
        const cryptoKey = await window.crypto.subtle.importKey(
            'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const payload = `${method}\n${path}\n${signedAt}\n${body || ''}`;
        const sig = await window.crypto.subtle.sign('HMAC', cryptoKey, enc.encode(payload));
        return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function requestHeaders(method, url) {
        const headers = {
            'X-Device-Id': readStorage(DEVICE_ID_STORAGE) || `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            'X-Device-Info': `${navigator.platform || 'Unknown-Platform'} | ${navigator.userAgent || 'Unknown-UA'}`.slice(0, 500)
        };
        const imei = (typeof window.__DEVICE_IMEI__ === 'string' && window.__DEVICE_IMEI__.trim())
            || readStorage(DEVICE_IMEI_STORAGE);
        if (imei) headers['X-Device-Imei'] = String(imei).trim().slice(0, 64);

        const signKey = readStorage(SIGN_KEY_STORAGE);
        if (signKey) {
            const signedAt = String(Date.now());
            headers['X-Signed-At'] = signedAt;
            headers['X-Signature'] = await sign(signKey, method.toUpperCase(), normalisePath(url), signedAt, '');
        }
        return headers;
    }

    async function fetchLandRecord(params) {
        const query = new URLSearchParams({
            Dcode1: params.dCode ?? '',
            Tcode1: params.tCode ?? '',
            Nvcode1: params.vCode ?? '',
            Mustno1: params.murabbaNo ?? '',
            Khasra1: params.khasraNo ?? ''
        }).toString();

        const url = `${API_PREFIX}/mapserver/land-record/Owner_name?${query}`;
        const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: await requestHeaders('GET', url)
        });

        return {
            ok: response.ok,
            status: response.status,
            xml: await response.text()
        };
    }

    function badge() {
        const el = document.createElement('div');
        el.textContent = 'amche bridge active';
        el.style.cssText = [
            'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647',
            'background:#111827', 'color:#9ca3af', 'border:1px solid #374151',
            'border-radius:4px', 'padding:4px 8px', 'font:11px/1.4 system-ui,sans-serif',
            'pointer-events:none', 'opacity:0.85'
        ].join(';');
        document.body.appendChild(el);
        return (text, colour) => {
            el.textContent = text;
            el.style.color = colour || '#9ca3af';
        };
    }

    const setBadge = badge();
    let served = 0;

    /**
     * Reloading the amche tab throws away its handle on this window, so the bridge
     * announces itself to whoever opened it. The opener reference survives that reload,
     * and each announcement is addressed to one exact origin, so nothing leaks.
     */
    function announce() {
        let opener;
        try {
            opener = window.opener;
            if (!opener || opener.closed) return;
        } catch { return; }

        const payload = { type: 'hsac-bridge-ready', signedIn: !!readStorage(SIGN_KEY_STORAGE) };
        new Set(DEFAULT_ANNOUNCE_ORIGINS.concat(knownOrigins())).forEach((origin) => {
            try { opener.postMessage(payload, origin); } catch {}
        });
    }

    window.addEventListener('message', async (event) => {
        if (!event.data || !isAllowedOrigin(event.origin)) return;
        rememberOrigin(event.origin);
        const reply = (payload) => {
            if (event.source) event.source.postMessage(payload, event.origin);
        };

        if (event.data.type === 'hsac-bridge-ping') {
            reply({ type: 'hsac-bridge-ready', signedIn: !!readStorage(SIGN_KEY_STORAGE) });
            return;
        }

        if (event.data.type !== 'hsac-land-record') return;

        const { requestId, params } = event.data;
        try {
            const result = await fetchLandRecord(params || {});
            setBadge(`amche bridge - ${++served} lookup${served === 1 ? '' : 's'}`, result.ok ? '#34d399' : '#f87171');
            reply({ type: 'hsac-land-record-result', requestId, ...result });
        } catch (error) {
            setBadge('amche bridge - error', '#f87171');
            reply({ type: 'hsac-land-record-result', requestId, ok: false, status: 0, error: error.message });
        }
    });

    announce();
    setInterval(announce, HEARTBEAT_MS);

    console.log('[amche-bridge] HSAC land record bridge ready');
})();

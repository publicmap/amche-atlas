import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 8080;

// Enhanced CORS configuration
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'If-Match'],
    exposedHeaders: ['*'],
    credentials: false,
    maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.get('/proxy', async (req, res) => {
    try {
        const targetUrl = req.query.url;
        const customReferer = req.query.referer;
        const cacheSeconds = parseInt(req.query.cache) || 3600;

        if (!targetUrl) {
            return res.status(400).json({
                error: 'Missing url parameter',
                usage: '/proxy?url=<target_url>&referer=<optional_referer>&cache=<optional_cache_seconds>',
                examples: [
                    '/proxy?url=https://example.com/image.jpg',
                    '/proxy?url=https://example.com/tile.png&referer=https://example.com/',
                    '/proxy?url=https://example.com/api&cache=300'
                ]
            });
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(targetUrl);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid URL provided' });
        }

        const refererHeader = customReferer || `${parsedUrl.protocol}//${parsedUrl.host}/`;

        console.log(`[Proxy] ===== New Request =====`);
        console.log(`[Proxy] ${req.method} ${targetUrl}`);
        console.log(`[Proxy] Referer: ${refererHeader}`);
        console.log(`[Proxy] Request origin: ${req.headers.origin || 'none'}`);

        // Byte-range reads (PMTiles, COG) pass through so only the requested
        // bytes are fetched; identity encoding keeps the offsets meaningful.
        const rangeHeader = req.headers.range;
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'Accept': 'image/webp,image/avif,image/jxl,image/heic,image/heic-sequence,video/*;q=0.8,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': rangeHeader ? 'identity' : 'gzip, deflate, br',
                'Referer': refererHeader,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                ...(rangeHeader ? { 'Range': rangeHeader } : {}),
                ...(req.headers['if-match'] ? { 'If-Match': req.headers['if-match'] } : {})
            }
        });

        console.log(`[Proxy] Response status: ${response.status} ${response.statusText}`);
        console.log(`[Proxy] Response content-type: ${response.headers.get('content-type')}`);

        if (!response.ok) {
            console.error(`[Proxy] ❌ Target returned ${response.status}: ${response.statusText}`);
            console.error(`[Proxy] Target URL: ${targetUrl}`);
            console.error(`[Proxy] Response headers:`, Object.fromEntries(response.headers));

            // For 403 errors, provide more details
            if (response.status === 403) {
                const bodyText = await response.text();
                console.error(`[Proxy] Response body:`, bodyText.substring(0, 500));
            }

            return res.status(response.status).json({
                error: 'Target request failed',
                status: response.status,
                statusText: response.statusText,
                targetUrl: targetUrl
            });
        }

        console.log(`[Proxy] ✓ Success! Returning ${response.headers.get('content-length') || 'unknown'} bytes`);

        // Set CORS headers FIRST to ensure they're not overridden
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Expose-Headers', '*');
        res.setHeader('Cache-Control', `public, max-age=${cacheSeconds}`);

        // Set content type from response
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        for (const header of ['content-range', 'accept-ranges', 'etag', 'last-modified']) {
            const value = response.headers.get(header);
            if (value) res.setHeader(header, value);
        }
        res.status(response.status);

        // Get the response body
        const buffer = await response.arrayBuffer();

        // Send the response
        res.send(Buffer.from(buffer));

    } catch (error) {
        console.error('[Proxy] Error:', error.message);
        res.status(500).json({ error: 'Proxy request failed', message: error.message });
    }
});

app.get('/overpass-share', async (req, res) => {
    const id = String(req.query.id || '');
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        return res.status(400).json({ error: 'Invalid id' });
    }

    try {
        console.log(`[OverpassShare] Resolving https://overpass-turbo.eu/s/${id}`);
        const upstream = await fetch(`https://overpass-turbo.eu/s/${id}`, {
            redirect: 'manual',
            signal: AbortSignal.timeout(10000)
        });

        const location = upstream.headers.get('location');
        if (!location) {
            console.error(`[OverpassShare] No Location header (status ${upstream.status})`);
            return res.status(502).json({ error: 'No redirect Location from overpass-turbo' });
        }

        const params = new URL(location).searchParams;
        const query = params.get('Q');
        if (!query) {
            const hasLegacy = params.has('q');
            return res.status(502).json({
                error: hasLegacy
                    ? 'This is a legacy Overpass Turbo share URL (?q=). Open it in overpass-turbo.eu, copy the query, and paste it directly.'
                    : 'Could not extract query from redirect'
            });
        }

        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.json({ query });
    } catch (error) {
        console.error('[OverpassShare] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

const mahaSession = { cookies: null, expires: 0 };

function extractSetCookies(headers) {
    return typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : (() => { const out = []; headers.forEach((v, k) => { if (k === 'set-cookie') out.push(v); }); return out; })();
}

async function getMahaSession() {
    if (mahaSession.cookies && Date.now() < mahaSession.expires) {
        return mahaSession.cookies;
    }
    console.log('[MahaBhunaksha] Acquiring new session...');
    const cookieMap = new Map();
    let url = 'https://mahabhunakasha.mahabhumi.gov.in/27/index.html';

    for (let i = 0; i < 8; i++) {
        const cookieStr = [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
        const res = await fetch(url, {
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                ...(cookieStr ? { 'Cookie': cookieStr } : {})
            }
        });
        for (const c of extractSetCookies(res.headers)) {
            const [kv] = c.split(';');
            const eq = kv.indexOf('=');
            if (eq > 0) cookieMap.set(kv.substring(0, eq).trim(), kv.substring(eq + 1).trim());
        }
        console.log(`[MahaBhunaksha] Step ${i} status=${res.status} cookies=${[...cookieMap.keys()].join(',')}`);
        if (res.status < 300 || res.status >= 400) break;
        const loc = res.headers.get('location');
        if (!loc) break;
        url = loc.startsWith('http') ? loc : new URL(loc, url).href;
    }

    mahaSession.cookies = [...cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    mahaSession.expires = Date.now() + 25 * 60 * 1000;
    console.log('[MahaBhunaksha] Session acquired:', mahaSession.cookies);
    return mahaSession.cookies;
}

app.get('/maha-bhunaksha', async (req, res) => {
    const { giscode, plotno } = req.query;
    if (!giscode || !plotno) {
        return res.status(400).json({ error: 'Missing giscode or plotno' });
    }

    const apiUrl = 'https://mahabhunakasha.mahabhumi.gov.in/rest/MapInfo/getPlotInfo';
    const body = `state=27&giscode=${encodeURIComponent(giscode)}&plotno=${encodeURIComponent(plotno)}&srs=4326`;

    try {
        const cookies = await getMahaSession();
        console.log('[MahaBhunaksha] POST', giscode, plotno);
        const response = await fetch(apiUrl, {
            method: 'POST',
            signal: AbortSignal.timeout(15000),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'https://mahabhunakasha.mahabhumi.gov.in/27/index.html',
                'Origin': 'https://mahabhunakasha.mahabhumi.gov.in',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
                'Cookie': cookies
            },
            body
        });

        const text = await response.text();
        console.log('[MahaBhunaksha] Response', response.status, text.substring(0, 200));

        if (response.status === 204 || !text.trim()) {
            return res.json({});
        }

        if (!response.ok) {
            mahaSession.cookies = null;
            return res.status(response.status).json({ error: `API returned ${response.status}`, body: text.substring(0, 500) });
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.send(text);
    } catch (error) {
        console.error('[MahaBhunaksha] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        endpoint: '/proxy',
        parameters: {
            url: {
                required: true,
                description: 'Target URL to fetch'
            },
            referer: {
                required: false,
                description: 'Custom Referer header (defaults to target origin)'
            },
            cache: {
                required: false,
                description: 'Cache duration in seconds (default: 3600)'
            }
        },
        examples: {
            simple: '/proxy?url=https://example.com/image.jpg',
            with_referer: '/proxy?url=https://api.example.com/data&referer=https://example.com/',
            with_cache: '/proxy?url=https://api.example.com/live-data&cache=60',
            gatishakti_test: '/proxy?url=https://ugi.pmgatishakti.gov.in/ugi-public-api-3/gis/mirroeLiss/IV/10/721/467&referer=https://ugi.pmgatishakti.gov.in/'
        }
    });
});

app.get('/test-gatishakti', async (req, res) => {
    const testUrl = 'https://ugi.pmgatishakti.gov.in/ugi-public-api-3/gis/mirroeLiss/IV/10/721/467';

    try {
        console.log(`[Test] Fetching ${testUrl}`);

        const response = await fetch(testUrl, {
            method: 'GET',
            headers: {
                'Accept': 'image/webp,image/avif,image/jxl,image/heic,image/heic-sequence,video/*;q=0.8,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': 'https://ugi.pmgatishakti.gov.in/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        res.json({
            status: response.ok ? 'success' : 'failed',
            statusCode: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers),
            contentType: response.headers.get('content-type'),
            bodySize: response.headers.get('content-length')
        });

    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message,
            stack: error.stack
        });
    }
});

// GitHub sign-in (OAuth web flow) for saving layer data as gists. The app's
// client secret stays here; the browser only ever sees the client id and the
// user's token. A local dev server (localhost) needs its own OAuth app, since
// GitHub only redirects to the callback URL's own host.
const GITHUB_APPS = [
    { local: false, id: process.env.GITHUB_CLIENT_ID, secret: process.env.GITHUB_CLIENT_SECRET },
    { local: true, id: process.env.GITHUB_DEV_CLIENT_ID, secret: process.env.GITHUB_DEV_CLIENT_SECRET }
];

function githubApp(req) {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.get('origin') || '');
    return GITHUB_APPS.find(entry => entry.local === local && entry.id && entry.secret);
}

app.get('/github/config', (req, res) => {
    const github = githubApp(req);
    if (!github) return res.status(503).json({ error: 'GitHub sign-in is not set up on this server' });
    res.json({ client_id: github.id });
});

app.post('/github/token', express.json(), async (req, res) => {
    const github = githubApp(req);
    if (!github) return res.status(503).json({ error: 'GitHub sign-in is not set up on this server' });
    const { code, redirect_uri } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Missing code' });
    try {
        const response = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: github.id, client_secret: github.secret, code, redirect_uri })
        });
        const data = await response.json();
        if (!data.access_token) return res.status(400).json({ error: data.error_description || data.error || 'GitHub did not return a token' });
        res.json({ access_token: data.access_token, scope: data.scope });
    } catch (error) {
        res.status(502).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`[Proxy] Server running on port ${PORT}`);
    console.log(`[Proxy] Generic endpoint: http://localhost:${PORT}/proxy?url=<target>&referer=<optional>&cache=<optional>`);
    console.log(`[Proxy] Health check: http://localhost:${PORT}/health`);
});

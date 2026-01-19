import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.options('*', cors());

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

        console.log(`[Proxy] ${req.method} ${targetUrl}`);
        console.log(`[Proxy] Referer: ${refererHeader}`);

        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'Referer': refererHeader,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            console.error(`[Proxy] Target returned ${response.status}: ${response.statusText}`);
            return res.status(response.status).json({
                error: 'Target request failed',
                status: response.status,
                statusText: response.statusText
            });
        }

        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        res.setHeader('Cache-Control', `public, max-age=${cacheSeconds}`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));

    } catch (error) {
        console.error('[Proxy] Error:', error.message);
        res.status(500).json({ error: 'Proxy request failed', message: error.message });
    }
});

app.get('/expand', async (req, res) => {
    try {
        const targetUrl = req.query.url;

        if (!targetUrl) {
            return res.status(400).json({
                error: 'Missing url parameter',
                usage: '/expand?url=<shortened_url>',
                examples: [
                    '/expand?url=https://maps.app.goo.gl/abc123',
                    '/expand?url=https://goo.gl/maps/xyz789'
                ]
            });
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(targetUrl);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid URL provided' });
        }

        console.log(`[Expand] Following redirects for: ${targetUrl}`);

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        };

        let currentUrl = targetUrl;
        let redirectCount = 0;
        const maxRedirects = 10;

        try {
            while (redirectCount < maxRedirects) {
                const response = await fetch(currentUrl, {
                    method: 'HEAD',
                    redirect: 'manual',
                    headers: headers
                });

                const statusCode = response.status;
                console.log(`[Expand] Response status: ${statusCode} for ${currentUrl}`);

                if (statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308) {
                    const location = response.headers.get('location');

                    if (!location) {
                        console.log(`[Expand] No Location header found, stopping at: ${currentUrl}`);
                        break;
                    }

                    let nextUrl;
                    if (location.startsWith('http://') || location.startsWith('https://')) {
                        nextUrl = location;
                    } else if (location.startsWith('/')) {
                        const urlObj = new URL(currentUrl);
                        nextUrl = `${urlObj.protocol}//${urlObj.host}${location}`;
                    } else {
                        const urlObj = new URL(currentUrl);
                        nextUrl = `${urlObj.protocol}//${urlObj.host}/${location}`;
                    }

                    console.log(`[Expand] Redirect ${redirectCount + 1}: ${currentUrl} -> ${nextUrl}`);
                    currentUrl = nextUrl;
                    redirectCount++;
                } else {
                    console.log(`[Expand] Non-redirect status, final URL: ${currentUrl}`);
                    break;
                }
            }

            if (redirectCount >= maxRedirects) {
                console.log(`[Expand] Max redirects (${maxRedirects}) reached`);
            }

        } catch (fetchError) {
            console.error(`[Expand] Request failed:`, fetchError.message);
        }

        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        res.json({
            original: targetUrl,
            expanded: currentUrl,
            redirected: currentUrl !== targetUrl,
            redirectCount: redirectCount
        });

    } catch (error) {
        console.error('[Expand] Error:', error.message);
        res.status(500).json({ error: 'URL expansion failed', message: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        endpoints: {
            proxy: {
                path: '/proxy',
                description: 'Proxy requests to avoid CORS issues',
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
                }
            },
            expand: {
                path: '/expand',
                description: 'Expand shortened URLs by following redirects',
                parameters: {
                    url: {
                        required: true,
                        description: 'Shortened URL to expand'
                    }
                }
            }
        },
        examples: {
            proxy_simple: '/proxy?url=https://example.com/image.jpg',
            proxy_with_referer: '/proxy?url=https://api.example.com/data&referer=https://example.com/',
            proxy_with_cache: '/proxy?url=https://api.example.com/live-data&cache=60',
            expand_goo_gl: '/expand?url=https://maps.app.goo.gl/abc123'
        }
    });
});

app.listen(PORT, () => {
    console.log(`[Proxy] Server running on port ${PORT}`);
    console.log(`[Proxy] Generic endpoint: http://localhost:${PORT}/proxy?url=<target>&referer=<optional>&cache=<optional>`);
    console.log(`[Proxy] Health check: http://localhost:${PORT}/health`);
});

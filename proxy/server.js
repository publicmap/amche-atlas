import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 8080;

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
            with_cache: '/proxy?url=https://api.example.com/live-data&cache=60'
        }
    });
});

app.listen(PORT, () => {
    console.log(`[Proxy] Server running on port ${PORT}`);
    console.log(`[Proxy] Generic endpoint: http://localhost:${PORT}/proxy?url=<target>&referer=<optional>&cache=<optional>`);
    console.log(`[Proxy] Health check: http://localhost:${PORT}/health`);
});

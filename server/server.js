import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 8080;

// Enhanced CORS configuration
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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

        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'Accept': 'image/webp,image/avif,image/jxl,image/heic,image/heic-sequence,video/*;q=0.8,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': refererHeader,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
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

        // Get the response body
        const buffer = await response.arrayBuffer();

        // Send the response
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

app.listen(PORT, () => {
    console.log(`[Proxy] Server running on port ${PORT}`);
    console.log(`[Proxy] Generic endpoint: http://localhost:${PORT}/proxy?url=<target>&referer=<optional>&cache=<optional>`);
    console.log(`[Proxy] Health check: http://localhost:${PORT}/health`);
});

import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/bhuvan/*', async (req, res) => {
    try {
        const bhuvanPath = req.params[0];
        const queryString = req.url.split('?')[1];
        const bhuvanUrl = `https://bhuvan-ras1.nrsc.gov.in/${bhuvanPath}${queryString ? '?' + queryString : ''}`;

        console.log(`[Proxy] ${req.method} ${bhuvanUrl}`);

        const response = await fetch(bhuvanUrl, {
            method: req.method,
            headers: {
                'Referer': 'https://bhuvanmaps.nrsc.gov.in/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });

        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        res.setHeader('Cache-Control', 'public, max-age=86400');
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

app.get('/bhuvan-cache/*', async (req, res) => {
    try {
        const cachePath = req.params[0];
        const bhuvanUrl = `https://bhuvan-ras2.nrsc.gov.in/${cachePath}`;

        console.log(`[Proxy] ${req.method} ${bhuvanUrl}`);

        const response = await fetch(bhuvanUrl, {
            method: req.method,
            headers: {
                'Referer': 'https://bhuvanpanchayat.nrsc.gov.in/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });

        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        res.setHeader('Cache-Control', 'public, max-age=86400');
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

app.get('/mosdac/*', async (req, res) => {
    try {
        const mosdacPath = req.params[0];
        const mosdacUrl = `https://www.mosdac.gov.in/${mosdacPath}`;

        console.log(`[Proxy] ${req.method} ${mosdacUrl}`);

        const response = await fetch(mosdacUrl, {
            method: req.method,
            headers: {
                'Referer': 'https://www.mosdac.gov.in/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });

        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));

    } catch (error) {
        console.error('[Proxy] MOSDAC Error:', error.message);
        res.status(500).json({ error: 'Proxy request failed', message: error.message });
    }
});

app.get('/imd/*', async (req, res) => {
    try {
        const imdPath = req.params[0];
        const imdUrl = `https://mausam.imd.gov.in/${imdPath}`;

        console.log(`[Proxy] ${req.method} ${imdUrl}`);

        const response = await fetch(imdUrl, {
            method: req.method,
            headers: {
                'Referer': 'https://mausam.imd.gov.in/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });

        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        res.setHeader('Cache-Control', 'public, max-age=300');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));

    } catch (error) {
        console.error('[Proxy] IMD Error:', error.message);
        res.status(500).json({ error: 'Proxy request failed', message: error.message });
    }
});

app.get('/proxy', async (req, res) => {
    try {
        const targetUrl = req.query.url;

        if (!targetUrl) {
            return res.status(400).json({ error: 'Missing url parameter', usage: '/proxy?url=https://example.com/image.jpg' });
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(targetUrl);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid URL provided' });
        }

        console.log(`[Proxy] ${req.method} ${targetUrl}`);

        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'Referer': `${parsedUrl.protocol}//${parsedUrl.host}/`,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        });

        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));

    } catch (error) {
        console.error('[Proxy] Generic Error:', error.message);
        res.status(500).json({ error: 'Proxy request failed', message: error.message });
    }
});

app.options('*', cors());

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        endpoints: {
            bhuvan: '/bhuvan/tilecache/tilecache.py?...',
            mosdac: '/mosdac/look/3R_IMG/preview/...',
            imd: '/imd/Satellite/rswmo_vis.jpg',
            generic: '/proxy?url=https://example.com/image.jpg'
        }
    });
});

app.listen(PORT, () => {
    console.log(`[Proxy] Server running on port ${PORT}`);
    console.log(`[Proxy] Bhuvan WMS: http://localhost:${PORT}/bhuvan/tilecache/tilecache.py?...`);
    console.log(`[Proxy] MOSDAC: http://localhost:${PORT}/mosdac/look/3R_IMG/preview/...`);
    console.log(`[Proxy] IMD Mausam: http://localhost:${PORT}/imd/Satellite/rswmo_vis.jpg`);
    console.log(`[Proxy] Generic: http://localhost:${PORT}/proxy?url=https://example.com/...`);
});

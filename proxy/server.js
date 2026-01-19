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

        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));

    } catch (error) {
        console.error('[Proxy] Error:', error.message);
        res.status(500).json({ error: 'Proxy request failed', message: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`[Proxy] Server running on port ${PORT}`);
    console.log(`[Proxy] Bhuvan WMS: http://localhost:${PORT}/bhuvan/tilecache/tilecache.py?...`);
    console.log(`[Proxy] Bhuvan Cache: http://localhost:${PORT}/bhuvan-cache/cachebcg/...`);
});

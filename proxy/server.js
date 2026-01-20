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

        let currentUrl = targetUrl;
        let redirectCount = 0;
        const maxRedirects = 10;

        while (redirectCount < maxRedirects) {
            const response = await fetch(currentUrl, {
                method: 'GET',
                redirect: 'manual',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'max-age=0'
                }
            });

            const statusCode = response.status;
            console.log(`[Expand] Response status: ${statusCode}`);

            if (statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308) {
                const location = response.headers.get('location');

                if (!location) {
                    console.log('[Expand] Redirect status but no Location header');
                    break;
                }

                console.log(`[Expand] Redirect ${redirectCount + 1}: ${location}`);

                if (location.startsWith('http://') || location.startsWith('https://')) {
                    currentUrl = location;
                } else {
                    const baseUrl = new URL(currentUrl);
                    currentUrl = new URL(location, baseUrl).href;
                }

                redirectCount++;
            } else if (statusCode === 200) {
                console.log('[Expand] Got 200 OK, checking if HTML contains redirect');

                // For 200 responses, check if the body contains a redirect
                const html = await response.text();

                // Log the first 1000 characters of HTML to debug (increased to see more of the script)
                console.log('[Expand] HTML preview:', html.substring(0, 1000));

                // Check for meta refresh
                const metaRefreshMatch = html.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^;]*;\s*url=([^"']+)["']/i);
                if (metaRefreshMatch) {
                    const redirectUrl = metaRefreshMatch[1];
                    console.log(`[Expand] Found meta refresh redirect: ${redirectUrl}`);
                    currentUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, currentUrl).href;
                    redirectCount++;
                    continue;
                }

                // Check for JavaScript redirect with more patterns
                const jsRedirectMatch = html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i) ||
                                       html.match(/location\.replace\(["']([^"']+)["']\)/i) ||
                                       html.match(/location\.href\s*=\s*["']([^"']+)["']/i) ||
                                       html.match(/window\.location\s*=\s*["']([^"']+)["']/i);
                if (jsRedirectMatch) {
                    const redirectUrl = jsRedirectMatch[1];
                    console.log(`[Expand] Found JavaScript redirect: ${redirectUrl}`);
                    currentUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, currentUrl).href;
                    redirectCount++;
                    continue;
                }

                // Check for data-url attribute (common in Google's dynamic links)
                const dataUrlMatch = html.match(/data-url=["']([^"']+)["']/i);
                if (dataUrlMatch) {
                    const redirectUrl = dataUrlMatch[1];
                    console.log(`[Expand] Found data-url redirect: ${redirectUrl}`);
                    currentUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, currentUrl).href;
                    redirectCount++;
                    continue;
                }

                // Check for Firebase Dynamic Links script data (script tag with data-id="_gd")
                const scriptMatch = html.match(/<script data-id="_gd"[^>]*>(.*?)<\/script>/s);
                if (scriptMatch) {
                    const scriptContent = scriptMatch[1];
                    console.log('[Expand] Found _gd script, parsing content');

                    // Try to parse the script content as JSON or extract URLs from it
                    try {
                        // Look for any google.com/maps URL in the script content
                        const scriptUrlMatch = scriptContent.match(/https:\/\/(?:www\.)?google\.com\/maps\/[^"'\s,}]+/i);
                        if (scriptUrlMatch) {
                            const redirectUrl = scriptUrlMatch[0];
                            console.log(`[Expand] Found Google Maps URL in script: ${redirectUrl}`);
                            currentUrl = redirectUrl;
                            redirectCount++;
                            continue;
                        }

                        // Also try to find "link" or "url" properties in JSON-like structure
                        const linkMatch = scriptContent.match(/["']?(?:link|url|deepLink)["']?\s*:\s*["']([^"']+)["']/i);
                        if (linkMatch) {
                            const redirectUrl = linkMatch[1];
                            console.log(`[Expand] Found link property in script: ${redirectUrl}`);
                            currentUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, currentUrl).href;
                            redirectCount++;
                            continue;
                        }
                    } catch (error) {
                        console.log('[Expand] Error parsing script content:', error.message);
                    }
                }

                // Check for any URL in the entire HTML that looks like a Google Maps URL
                // This will search the full HTML, not just the script content
                const mapsUrlMatch = html.match(/https:\\?\/\\?\/(?:www\.)?google\.com\\?\/maps\\?\/[^"'\s<>\\]+/i);
                if (mapsUrlMatch) {
                    let redirectUrl = mapsUrlMatch[0];

                    // Unescape backslashes (\\/ becomes /)
                    redirectUrl = redirectUrl.replace(/\\\//g, '/');

                    // Decode Unicode escapes (like \u003d for =)
                    redirectUrl = redirectUrl.replace(/\\u([0-9a-f]{4})/gi, (match, code) => {
                        return String.fromCharCode(parseInt(code, 16));
                    });

                    console.log(`[Expand] Found Google Maps URL in HTML: ${redirectUrl}`);
                    currentUrl = redirectUrl;
                    redirectCount++;
                    continue;
                }

                console.log('[Expand] No redirect found in HTML, reached final destination');
                break;
            } else {
                console.log(`[Expand] Unexpected status code: ${statusCode}`);
                break;
            }
        }

        const wasRedirected = currentUrl !== targetUrl;
        console.log(`[Expand] Final URL after ${redirectCount} redirects: ${currentUrl}`);

        res.json({
            original: targetUrl,
            expanded: currentUrl,
            redirected: wasRedirected,
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
            proxy: '/proxy',
            expand: '/expand'
        },
        parameters: {
            proxy: {
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
            expand: {
                url: {
                    required: true,
                    description: 'Shortened URL to expand'
                }
            }
        },
        examples: {
            proxy_simple: '/proxy?url=https://example.com/image.jpg',
            proxy_with_referer: '/proxy?url=https://api.example.com/data&referer=https://example.com/',
            proxy_with_cache: '/proxy?url=https://api.example.com/live-data&cache=60',
            expand: '/expand?url=https://maps.app.goo.gl/abc123'
        }
    });
});

app.listen(PORT, () => {
    console.log(`[Proxy] Server running on port ${PORT}`);
    console.log(`[Proxy] Generic endpoint: http://localhost:${PORT}/proxy?url=<target>&referer=<optional>&cache=<optional>`);
    console.log(`[Proxy] Health check: http://localhost:${PORT}/health`);
});

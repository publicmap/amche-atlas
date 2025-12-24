const { test, expect } = require('@playwright/test');

test('spider test: verify all internal links and check for console errors', async ({ page }) => {
    const visited = new Set();
    const queue = ['/'];
    const errors = [];
    const brokenLinks = [];

    // Listen for console errors
    page.on('console', msg => {
        if (msg.type() === 'error') {
            errors.push(`Console error on ${page.url()}: ${msg.text()}`);
        }
    });

    // Listen for page errors (e.g. unhandled exceptions)
    page.on('pageerror', exception => {
        errors.push(`Page error on ${page.url()}: ${exception.message}`);
    });

    while (queue.length > 0) {
        const currentPath = queue.shift();
        if (visited.has(currentPath)) continue;
        visited.add(currentPath);

        console.log(`Visiting: ${currentPath}`);

        // Navigate to the page
        const response = await page.goto(currentPath, { waitUntil: 'domcontentloaded' });

        // Check for 404 or other error status codes
        if (response.status() >= 400) {
            brokenLinks.push(`${currentPath} returned status ${response.status()}`);
            continue;
        }

        // Find all links on the page
        const links = await page.$$eval('a', anchors => anchors.map(a => a.getAttribute('href')));

        for (const link of links) {
            if (!link) continue;

            // Handle internal links only
            // We assume internal links start with / or are relative and don't start with http/https/mailto
            // For this simple spider, let's just look for startsWith('/') or same-origin

            let u;
            try {
                u = new URL(link, page.url());
            } catch (e) {
                // Invalid URL, skip
                continue;
            }

            // Only crawl same origin
            const origin = new URL(page.url()).origin;
            if (u.origin !== origin) continue;

            // Clean up hash/query for the queue to avoid duplicates of same page unless we want to test params
            // For a basic spider, we might want to strip hash.
            const path = u.pathname;

            // Avoid crawling non-html resources if possible, though Playwright handles them fine usually.
            // We'll skip some common extensions just in case
            if (path.match(/\.(png|jpg|jpeg|gif|svg|pdf|zip)$/i)) continue;

            if (!visited.has(path) && !queue.includes(path)) {
                queue.push(path);
            }
        }
    }

    // Report results
    if (brokenLinks.length > 0) {
        console.error('Broken links found:', brokenLinks);
    }
    if (errors.length > 0) {
        console.error('Console errors found:', errors);
    }

    expect(brokenLinks.length, `Found ${brokenLinks.length} broken links`).toBe(0);
    expect(errors.length, `Found ${errors.length} console/page errors`).toBe(0);
});

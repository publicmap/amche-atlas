const CACHE_NAME = 'amche-goa-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/offline.html',
    '/styles.css',
    '/config/_defaults.json',
    '/js/geolocation-control.js',
    '/js/mapbox-gl-view-control.js',
    '/js/map-init.js',
    '/js/map-layer-controls.js',
    '/js/map-utils.js',
    '/js/layer-order-manager.js',
    '/js/map-feature-state-manager.js',
    '/js/pwa/state-persistence.js',
    '/assets/img/icon-192x192.png',
    '/assets/img/icon-512x512.png'
];

// Optional external resources to cache (will not fail installation if unavailable)
const OPTIONAL_ASSETS = [
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.19.1/cdn/shoelace.js',
    'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.19.1/cdn/themes/light.css',
    'https://code.jquery.com/jquery-3.7.1.min.js',
    'https://api.mapbox.com/mapbox-gl-js/v3.11.0/mapbox-gl.css',
    'https://api.mapbox.com/mapbox-gl-js/v3.11.0/mapbox-gl.js',
    'https://api.mapbox.com/search-js/v1.0.0/web.js',
    'https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap'
];

// Helper function to cache a single asset and ignore failures
const cacheAsset = async (cache, url) => {
    try {
        await cache.add(url);
        console.log(`Cached: ${url}`);
    } catch (error) {
        console.warn(`Failed to cache: ${url}`, error);
    }
};

// Install event - cache initial assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);

            // First, try to cache critical assets
            await cache.addAll(ASSETS_TO_CACHE);

            // Then, try to cache optional assets but continue even if they fail
            await Promise.allSettled(
                OPTIONAL_ASSETS.map(url => cacheAsset(cache, url))
            );

            return self.skipWaiting();
        })()
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter((cacheName) => {
                    return cacheName !== CACHE_NAME;
                }).map((cacheName) => {
                    return caches.delete(cacheName);
                })
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
    // Handle only GET requests
    if (event.request.method !== 'GET') return;

    // Skip some cross-origin requests that don't need caching
    if (!event.request.url.startsWith(self.location.origin) &&
        !event.request.url.includes('cdn.jsdelivr.net') &&
        !event.request.url.includes('api.mapbox.com') &&
        !event.request.url.includes('fonts.googleapis.com') &&
        !event.request.url.includes('code.jquery.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Return cached response if found
                if (response) {
                    return response;
                }

                // Clone the request
                const fetchRequest = event.request.clone();

                // Make network request and cache the response
                return fetch(fetchRequest)
                    .then((response) => {
                        // Check if response is valid
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Clone the response
                        const responseToCache = response.clone();

                        // Open cache and store the new response
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            })
                            .catch(err => console.warn('Failed to update cache:', err));

                        return response;
                    })
                    .catch(() => {
                        // Fallback for image requests
                        if (event.request.url.match(/\.(jpg|jpeg|png|gif|svg)$/)) {
                            return caches.match('/assets/img/offline-image.png')
                                .catch(() => new Response('Image not available offline', {status: 404}));
                        }
                        // Return the offline page for HTML requests
                        if (event.request.headers.get('Accept') &&
                            event.request.headers.get('Accept').includes('text/html')) {
                            return caches.match('/offline.html')
                                .catch(() => new Response('Offline content not available', {status: 503}));
                        }

                        // Default fallback
                        return new Response('Content not available offline', {status: 503});
                    });
            })
    );
}); 
/**
 * PWA Service Worker.
 * unfortunately this file has to be in the root folder so that it has access to all the assets to be cached.
 *
 */

const CACHE_NAME = 'amche-goa-v1';

const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/offline.html',
    '/css/styles.css',
    '/css/layer-interactions.css',
    '/config/_defaults.json',
    '/js/main.bundle.js',
    '/assets/img/icon-192x192.png',
    '/assets/img/icon-512x512.png',

    'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
    'https://cdn.jsdelivr.net/npm/marked@14.1.3/marked.min.js',
    'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js',
    'https://cdn.jsdelivr.net/npm/mapbox-gl@3.16.0/dist/mapbox-gl.min.js',
    'https://cdn.jsdelivr.net/npm/mapbox-gl@3.16.0/dist/mapbox-gl.min.css',
    'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.19.1/cdn/shoelace.js',
    'https://cdn.jsdelivr.net/npm/@mapbox/search-js-web@1.0.0/dist/mapboxsearch.min.js',
    'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.19.1/cdn/themes/light.min.css',
    'https://fonts.googleapis.com/css2?family=Open+Sans:wght@600&display=swap'
];

// Install event - cache initial assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await cache.addAll(ASSETS_TO_CACHE);
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
        !event.request.url.includes('fonts.googleapis.com')) {
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
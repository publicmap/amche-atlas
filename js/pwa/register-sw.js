// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/js/pwa/service-worker.js')
            .catch((error) => {
                console.error('Service Worker registration failed:', error);
            });
    });
}

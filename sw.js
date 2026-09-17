const ASSETS = ['./', './index.html', './manifest.json', './icon.svg', './assets/styles.css', './assets/core.js', './assets/app.js', './assets/billing.js', './assets/enhancements.js', './assets/workspace.css', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];
const scope = new URL(self.registration.scope);
const CACHE_PREFIX = 'rental-app-'+encodeURIComponent(scope.pathname)+'-';
const CACHE_NAME = CACHE_PREFIX+'1.4.0-status-docs-1';
const allowedPaths = new Set(ASSETS.map(path => new URL(path, scope).pathname));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && (k.startsWith(CACHE_PREFIX) || (scope.pathname==='/rental-app/' && /^rental-(?:v\d+|foundation-)/.test(k)))).map(k => caches.delete(k)))
    )
  );
});

// Cache only this release's static files, never cloud data or POST requests.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== scope.origin || !allowedPaths.has(url.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(e.request, {ignoreSearch: true});
    // Static hosts may redirect index.html to /. A followed redirect stored by
    // addAll cannot be returned unchanged to a navigation with redirect=manual.
    // Rebuild only cached successful responses; network/auth redirects still
    // pass through normally, and no application storage is changed.
    if (cached && cached.redirected && cached.ok) {
      return new Response(cached.body, {
        status: cached.status, statusText: cached.statusText, headers: cached.headers
      });
    }
    return cached || fetch(e.request);
  })());
});

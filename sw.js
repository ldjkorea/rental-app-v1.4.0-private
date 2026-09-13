const ASSETS = ['./', './index.html', './manifest.json', './icon.svg', './assets/styles.css', './assets/core.js', './assets/app.js', './assets/billing.js', './assets/enhancements.js', './assets/workspace.css'];
const scope = new URL(self.registration.scope);
const CACHE_PREFIX = 'rental-app-'+encodeURIComponent(scope.pathname)+'-';
const CACHE_NAME = CACHE_PREFIX+'1.4.0';
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
    return (await cache.match(e.request, {ignoreSearch: true})) || fetch(e.request);
  })());
});

// Service worker: de app zelf werkt ook zonder netwerk. Cijfers komen van Windsor.ai en worden door app.js bewaard.
const CACHE = 'koetsier-media-v1';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'vendor/d3.min.js',
  'icons/logo.webp', 'icons/favicon-32.png', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('koetsier-media-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Eigen bestanden: eerst het netwerk (zodat updates snel binnenkomen), anders uit de cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/km-data/')) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html')))
  );
});

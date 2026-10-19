// Service worker van de clubapp: app-schil en laatst bekeken data blijven offline te openen.
const CACHE = 'vve-club-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/club.css',
  'js/app.js', 'js/api.js', 'js/config.js', 'data/snapshot.json',
  '../icons/logo.png', '../icons/icon-192.png', '../icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('vve-club-') && k !== CACHE).map((k) => caches.delete(k)),
  )).then(() => self.clients.claim()));
});

// Network-first: altijd de nieuwste versie, de cache alleen als er geen verbinding is.
// Ook de WordPress-API van de clubsite gaat zo, zodat nieuws offline leesbaar blijft.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const own = url.origin === location.origin;
  if (!own && !url.pathname.includes('/wp-json/')) return;
  e.respondWith(
    fetch(e.request, own ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || (own && e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
